import type {
  BehaviorFile,
  ClosedTrade,
  FillRecord,
  TiltState,
  WeekDayPnl,
  WeekReviewFile,
  WeekTickerPnl,
} from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dayKeyInZone(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

export function startOfWeekMonday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const dow = utc.getUTCDay(); // 0 Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** ISO week id like 2026-W29 */
export function isoWeekId(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Thursday in current week decides the year
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const weekYear = date.getUTCFullYear();
  return `${weekYear}-W${String(weekNo).padStart(2, "0")}`;
}

export function weekLabel(start: string, endInclusive: string): string {
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${endInclusive}T12:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${a.toLocaleDateString("en-US", opts)} – ${b.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

export function buildClosedTrades(fills: FillRecord[]): { trades: ClosedTrade[]; openLots: number } {
  type Lot = { qty: number; price: number; openedAt: string; side: "LONG" | "SHORT" };
  const books = new Map<string, Lot[]>();
  const trades: ClosedTrade[] = [];

  for (const fill of fills) {
    const ticker = fill.ticker.toUpperCase();
    const side = fill.side.toUpperCase() as "BUY" | "SELL";
    const qty = Number(fill.quantity);
    const price = Number(fill.price);
    if (!qty || !price) continue;
    const lots = books.get(ticker) ?? [];
    books.set(ticker, lots);

    const pushTrade = (
      matched: number,
      entryPrice: number,
      exitPrice: number,
      openedAt: string,
      closedAt: string,
      tradeSide: "LONG" | "SHORT",
      pnl: number,
    ) => {
      const holdMinutes = Math.max(0, (new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 60000);
      const openDay = openedAt.slice(0, 10);
      const closeDay = closedAt.slice(0, 10);
      trades.push({
        ticker,
        qty: matched,
        entryPrice,
        exitPrice,
        pnl,
        pnlPct: entryPrice ? (pnl / (entryPrice * matched)) * 100 : 0,
        openedAt,
        closedAt,
        side: tradeSide,
        holdMinutes,
        overnight: openDay !== closeDay,
      });
    };

    if (side === "BUY") {
      let remaining = qty;
      while (remaining > 0 && lots.length && lots[0].side === "SHORT") {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.qty);
        pushTrade(matched, lot.price, price, lot.openedAt, fill.executedAt, "SHORT", (lot.price - price) * matched);
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-9) lots.shift();
      }
      if (remaining > 1e-9) lots.push({ qty: remaining, price, openedAt: fill.executedAt, side: "LONG" });
    } else {
      let remaining = qty;
      while (remaining > 0 && lots.length && lots[0].side === "LONG") {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.qty);
        pushTrade(matched, lot.price, price, lot.openedAt, fill.executedAt, "LONG", (price - lot.price) * matched);
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-9) lots.shift();
      }
      if (remaining > 1e-9) lots.push({ qty: remaining, price, openedAt: fill.executedAt, side: "SHORT" });
    }
  }

  let openLots = 0;
  for (const lots of books.values()) openLots += lots.length;
  return { trades, openLots };
}

function streakStats(trades: ClosedTrade[]) {
  let curType: "win" | "loss" | "flat" = "flat";
  let curLen = 0;
  let maxWin = 0;
  let maxLoss = 0;
  let winRun = 0;
  let lossRun = 0;
  for (const trade of trades) {
    if (trade.pnl > 0) {
      winRun += 1;
      lossRun = 0;
      maxWin = Math.max(maxWin, winRun);
      curType = "win";
      curLen = winRun;
    } else if (trade.pnl < 0) {
      lossRun += 1;
      winRun = 0;
      maxLoss = Math.max(maxLoss, lossRun);
      curType = "loss";
      curLen = lossRun;
    }
  }
  return {
    currentStreak: { type: curType, length: curLen },
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
  };
}

function countSizeEscalations(fills: FillRecord[], timeZone: string): number {
  // Within a local day, count times consecutive BUY notional increases after a losing SELL.
  const byDay = new Map<string, FillRecord[]>();
  for (const f of fills) {
    const day = dayKeyInZone(f.executedAt, timeZone);
    const list = byDay.get(day) ?? [];
    list.push(f);
    byDay.set(day, list);
  }
  let flags = 0;
  for (const list of byDay.values()) {
    let lastSellLoss = false;
    let lastBuyNotional = 0;
    // Approximate: track running inventory cost for crude loss detection is heavy; use sell after buy with price drop heuristic via sequential pairs.
    const buys: number[] = [];
    for (const f of list) {
      if (f.side === "BUY") {
        const notional = f.quantity * f.price;
        if (lastSellLoss && lastBuyNotional > 0 && notional > lastBuyNotional * 1.15) flags += 1;
        lastBuyNotional = notional;
        buys.push(f.price);
        lastSellLoss = false;
      } else {
        const ref = buys.length ? buys[buys.length - 1] : f.price;
        lastSellLoss = f.price < ref;
      }
    }
  }
  return flags;
}

export function computeBehavior(
  trades: ClosedTrade[],
  fills: FillRecord[],
  opts: { timeZone?: string; lookbackTrades?: number } = {},
): BehaviorFile {
  const timeZone = opts.timeZone ?? "America/Chicago";
  const recent = trades.slice(-Math.max(20, opts.lookbackTrades ?? 40));
  const streaks = streakStats(trades);

  const holdBuckets = {
    overnight: { n: 0, pnl: 0 },
    under15m: { n: 0, pnl: 0 },
    m15to60: { n: 0, pnl: 0 },
    over60m: { n: 0, pnl: 0 },
  };
  for (const t of recent) {
    if (t.overnight) {
      holdBuckets.overnight.n += 1;
      holdBuckets.overnight.pnl += t.pnl;
    } else if (t.holdMinutes <= 15) {
      holdBuckets.under15m.n += 1;
      holdBuckets.under15m.pnl += t.pnl;
    } else if (t.holdMinutes <= 60) {
      holdBuckets.m15to60.n += 1;
      holdBuckets.m15to60.pnl += t.pnl;
    } else {
      holdBuckets.over60m.n += 1;
      holdBuckets.over60m.pnl += t.pnl;
    }
  }

  const overnightPnl = holdBuckets.overnight.pnl;
  const sizeEscalationFlags = countSizeEscalations(fills.slice(-200), timeZone);
  const reasons: string[] = [];
  let score = 0;
  let state: TiltState = "calm";

  if (streaks.currentStreak.type === "win" && streaks.currentStreak.length >= 3) {
    state = "on_streak";
    score = Math.min(40, streaks.currentStreak.length * 8);
    reasons.push(`Win streak ×${streaks.currentStreak.length}`);
  }
  if (streaks.currentStreak.type === "loss" && streaks.currentStreak.length >= 3) {
    state = "cooling_off";
    score = Math.min(70, 30 + streaks.currentStreak.length * 10);
    reasons.push(`Loss streak ×${streaks.currentStreak.length}`);
  }
  if (holdBuckets.under15m.n >= 3 && holdBuckets.under15m.pnl < 0) {
    state = "chopping";
    score = Math.max(score, 55);
    reasons.push(`Sub-15m scalps losing ($${holdBuckets.under15m.pnl.toFixed(0)})`);
  }
  if (sizeEscalationFlags >= 2) {
    state = "revenge_sizing";
    score = Math.max(score, 75);
    reasons.push(`Size escalation after losses (${sizeEscalationFlags} flags)`);
  }
  if (overnightPnl < -50) {
    state = "overnight_hungover";
    score = Math.max(score, 80);
    reasons.push(`Overnight PnL $${overnightPnl.toFixed(0)}`);
  }
  if (!reasons.length) reasons.push("No active tilt flags in recent tape");

  return {
    updatedAt: new Date().toISOString(),
    timeZone,
    currentStreak: streaks.currentStreak,
    maxWinStreak: streaks.maxWinStreak,
    maxLossStreak: streaks.maxLossStreak,
    overnightPnl,
    holdBuckets,
    sizeEscalationFlags,
    tilt: { state, score, reasons },
    recentTrades: [...trades].reverse().slice(0, 12),
  };
}

export function tradesInWeek(trades: ClosedTrade[], start: string, endExclusive: string, timeZone: string) {
  return trades.filter((t) => {
    const day = dayKeyInZone(t.closedAt, timeZone);
    return day >= start && day < endExclusive;
  });
}

export function buildWeekReview(
  trades: ClosedTrade[],
  behavior: BehaviorFile,
  opts: {
    anchorDate?: string;
    timeZone?: string;
    existing?: Partial<WeekReviewFile> | null;
  } = {},
): WeekReviewFile {
  const timeZone = opts.timeZone ?? behavior.timeZone ?? "America/Chicago";
  const anchor = opts.anchorDate ?? dayKeyInZone(new Date().toISOString(), timeZone);
  const start = startOfWeekMonday(anchor);
  const endExclusive = addDays(start, 7);
  const endInclusive = addDays(start, 4); // Fri for label
  const id = isoWeekId(start);
  const weekTrades = tradesInWeek(trades, start, endExclusive, timeZone);
  const priorStart = addDays(start, -7);
  const priorTrades = tradesInWeek(trades, priorStart, start, timeZone);

  const dayMap = new Map<string, WeekDayPnl>();
  for (let i = 0; i < 5; i++) {
    const date = addDays(start, i);
    const label = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    dayMap.set(date, { date, label, pnl: 0, trades: 0 });
  }
  for (const t of weekTrades) {
    const date = dayKeyInZone(t.closedAt, timeZone);
    const row = dayMap.get(date);
    if (!row) continue;
    row.pnl += t.pnl;
    row.trades += 1;
  }

  const tickerMap = new Map<string, WeekTickerPnl>();
  for (const t of weekTrades) {
    const row = tickerMap.get(t.ticker) ?? { ticker: t.ticker, pnl: 0, trades: 0, wins: 0 };
    row.pnl += t.pnl;
    row.trades += 1;
    if (t.pnl > 0) row.wins += 1;
    tickerMap.set(t.ticker, row);
  }

  const realizedPnl = weekTrades.reduce((s, t) => s + t.pnl, 0);
  const winCount = weekTrades.filter((t) => t.pnl > 0).length;
  const lossCount = weekTrades.filter((t) => t.pnl < 0).length;
  const weekBehavior = computeBehavior(weekTrades, [], { timeZone });

  const existing = opts.existing ?? null;
  return {
    id,
    label: weekLabel(start, endInclusive),
    start,
    end: endExclusive,
    timeZone,
    updatedAt: new Date().toISOString(),
    realizedPnl,
    tradeCount: weekTrades.length,
    winCount,
    lossCount,
    priorWeekPnl: priorTrades.length ? priorTrades.reduce((s, t) => s + t.pnl, 0) : null,
    days: [...dayMap.values()],
    byTicker: [...tickerMap.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
    tilt: weekBehavior.tilt,
    streaks: {
      current: weekBehavior.currentStreak,
      maxWin: weekBehavior.maxWinStreak,
      maxLoss: weekBehavior.maxLossStreak,
    },
    keep: existing?.keep ?? [],
    stop: existing?.stop ?? [],
    improve: existing?.improve ?? [],
    lesson: existing?.lesson ?? "",
    mistakes: existing?.mistakes ?? [],
    openNotes: existing?.openNotes ?? [],
  };
}

export function money(n: number, digits = 0): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(digits)}`;
}
