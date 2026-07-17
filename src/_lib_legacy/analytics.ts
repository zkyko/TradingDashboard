import { db } from "./db";
import { dayKeyInZone, DEFAULT_TIMEZONE, monthKey } from "./timezone";

export type Fill = {
  id: number;
  ticker: string;
  side: string;
  quantity: number;
  price: number;
  executed_at: string;
  decision_id: number | null;
};

export type ClosedTrade = {
  ticker: string;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  openedAt: string;
  closedAt: string;
  side: "LONG" | "SHORT";
};

export type AnalyticsBundle = {
  generatedAt: string;
  equity: number | null;
  snapshotAt: string | null;
  metrics: {
    realizedPnl: number;
    tradeCount: number;
    winCount: number;
    lossCount: number;
    winRate: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    bestTrade: number | null;
    worstTrade: number | null;
    linkedFillRate: number | null;
    fillCount: number;
    openLots: number;
  };
  equityCurve: Array<{ t: string; pnl: number }>;
  weekdayPnl: Array<{ day: string; pnl: number; trades: number }>;
  byTicker: Array<{ ticker: string; pnl: number; trades: number; wins: number }>;
  bySide: Array<{ side: string; pnl: number; trades: number }>;
  deciles: Array<{ bucket: number; label: string; avgPnl: number; count: number }>;
  patterns: string[];
  recentTrades: ClosedTrade[];
  snapshots: Array<{ t: string; equity: number }>;
};

export type CalendarDay = {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  closes: ClosedTrade[];
};

export type CalendarMonth = {
  year: number;
  month: number;
  timeZone: string;
  days: CalendarDay[];
  monthPnl: number;
  monthTrades: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function loadFills(): Fill[] {
  return db.prepare(`
    SELECT id, ticker, side, quantity, price, executed_at, decision_id
    FROM executions
    WHERE quantity > 0 AND price > 0
    ORDER BY datetime(executed_at) ASC, id ASC
  `).all() as Fill[];
}

/** FIFO close-outs from Robinhood fills → realized trades. */
export function buildClosedTrades(fills: Fill[] = loadFills()): { trades: ClosedTrade[]; openLots: number } {
  type Lot = { qty: number; price: number; openedAt: string; side: "LONG" | "SHORT" };
  const books = new Map<string, Lot[]>();
  const trades: ClosedTrade[] = [];

  for (const fill of fills) {
    const ticker = fill.ticker.toUpperCase();
    const side = fill.side.toUpperCase();
    const qty = Number(fill.quantity);
    const price = Number(fill.price);
    if (!qty || !price) continue;
    const lots = books.get(ticker) ?? [];
    books.set(ticker, lots);

    if (side === "BUY") {
      let remaining = qty;
      // Cover short lots first
      while (remaining > 0 && lots.length && lots[0].side === "SHORT") {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.qty);
        const pnl = (lot.price - price) * matched;
        trades.push({
          ticker,
          qty: matched,
          entryPrice: lot.price,
          exitPrice: price,
          pnl,
          pnlPct: lot.price ? (pnl / (lot.price * matched)) * 100 : 0,
          openedAt: lot.openedAt,
          closedAt: fill.executed_at,
          side: "SHORT",
        });
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-9) lots.shift();
      }
      if (remaining > 1e-9) {
        lots.push({ qty: remaining, price, openedAt: fill.executed_at, side: "LONG" });
      }
    } else if (side === "SELL") {
      let remaining = qty;
      while (remaining > 0 && lots.length && lots[0].side === "LONG") {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.qty);
        const pnl = (price - lot.price) * matched;
        trades.push({
          ticker,
          qty: matched,
          entryPrice: lot.price,
          exitPrice: price,
          pnl,
          pnlPct: lot.price ? (pnl / (lot.price * matched)) * 100 : 0,
          openedAt: lot.openedAt,
          closedAt: fill.executed_at,
          side: "LONG",
        });
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-9) lots.shift();
      }
      if (remaining > 1e-9) {
        lots.push({ qty: remaining, price, openedAt: fill.executed_at, side: "SHORT" });
      }
    }
  }

  let openLots = 0;
  for (const lots of books.values()) openLots += lots.length;
  return { trades, openLots };
}

function quantileBuckets(values: number[], buckets = 10) {
  if (!values.length) return [] as Array<{ bucket: number; label: string; avgPnl: number; count: number }>;
  const sorted = [...values].sort((a, b) => a - b);
  const size = Math.ceil(sorted.length / buckets) || 1;
  const out: Array<{ bucket: number; label: string; avgPnl: number; count: number }> = [];
  for (let i = 0; i < buckets; i++) {
    const slice = sorted.slice(i * size, (i + 1) * size);
    if (!slice.length) continue;
    const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
    out.push({
      bucket: i + 1,
      label: `D${i + 1}`,
      avgPnl: avg,
      count: slice.length,
    });
  }
  return out;
}

function detectPatterns(trades: ClosedTrade[], fills: Fill[]) {
  const patterns: string[] = [];
  if (!trades.length) {
    patterns.push("No closed round-trips yet from fills.");
    return patterns;
  }

  const byTicker = new Map<string, { pnl: number; n: number }>();
  for (const trade of trades) {
    const row = byTicker.get(trade.ticker) ?? { pnl: 0, n: 0 };
    row.pnl += trade.pnl;
    row.n += 1;
    byTicker.set(trade.ticker, row);
  }
  const top = [...byTicker.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (top) patterns.push(`Most active: ${top[0]} (${top[1].n} closes, ${top[1].pnl >= 0 ? "+" : ""}$${top[1].pnl.toFixed(2)})`);

  let streak = 0;
  let bestStreak = 0;
  let lossStreak = 0;
  let bestLoss = 0;
  for (const trade of trades) {
    if (trade.pnl > 0) {
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      lossStreak = 0;
    } else if (trade.pnl < 0) {
      lossStreak += 1;
      bestLoss = Math.max(bestLoss, lossStreak);
      streak = 0;
    }
  }
  if (bestStreak) patterns.push(`Best win streak: ${bestStreak}`);
  if (bestLoss) patterns.push(`Worst loss streak: ${bestLoss}`);

  const weekday = new Map<number, number>();
  for (const trade of trades) {
    const d = new Date(trade.closedAt).getUTCDay();
    weekday.set(d, (weekday.get(d) ?? 0) + trade.pnl);
  }
  const bestDay = [...weekday.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bestDay) patterns.push(`Strongest weekday: ${WEEKDAYS[bestDay[0]]} ($${bestDay[1].toFixed(2)})`);

  const linked = fills.filter((f) => f.decision_id != null).length;
  const rate = fills.length ? linked / fills.length : 0;
  patterns.push(`Fills linked to a plan: ${(rate * 100).toFixed(0)}%`);

  const shorts = trades.filter((t) => t.side === "SHORT").length;
  const longs = trades.length - shorts;
  patterns.push(`Long closes ${longs} · short covers ${shorts}`);

  return patterns;
}

export function computeAnalytics(opts?: { since?: string }): AnalyticsBundle {
  const fillsAll = loadFills();
  const { trades: allTrades, openLots } = buildClosedTrades(fillsAll);
  const since = opts?.since;
  const trades = since
    ? allTrades.filter((t) => String(t.closedAt).slice(0, 10) >= since)
    : allTrades;
  const fills = since
    ? fillsAll.filter((f) => String(f.executed_at).slice(0, 10) >= since)
    : fillsAll;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const realizedPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : null;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins.length ? Number.POSITIVE_INFINITY : null;
  const winRate = trades.length ? wins.length / trades.length : null;
  const expectancy = trades.length ? realizedPnl / trades.length : null;

  let running = 0;
  const equityCurve = trades.map((t) => {
    running += t.pnl;
    return { t: t.closedAt, pnl: running };
  });

  const weekdayMap = new Map<string, { pnl: number; trades: number }>();
  for (const day of WEEKDAYS) weekdayMap.set(day, { pnl: 0, trades: 0 });
  for (const trade of trades) {
    const label = WEEKDAYS[new Date(trade.closedAt).getUTCDay()];
    const row = weekdayMap.get(label)!;
    row.pnl += trade.pnl;
    row.trades += 1;
  }

  const tickerMap = new Map<string, { pnl: number; trades: number; wins: number }>();
  for (const trade of trades) {
    const row = tickerMap.get(trade.ticker) ?? { pnl: 0, trades: 0, wins: 0 };
    row.pnl += trade.pnl;
    row.trades += 1;
    if (trade.pnl > 0) row.wins += 1;
    tickerMap.set(trade.ticker, row);
  }

  const sideMap = new Map<string, { pnl: number; trades: number }>();
  for (const trade of trades) {
    const row = sideMap.get(trade.side) ?? { pnl: 0, trades: 0 };
    row.pnl += trade.pnl;
    row.trades += 1;
    sideMap.set(trade.side, row);
  }

  const linked = fills.filter((f) => f.decision_id != null).length;
  const snapshot = db.prepare("SELECT account_equity,captured_at FROM position_snapshots ORDER BY captured_at DESC LIMIT 1").get() as
    | { account_equity: number; captured_at: string }
    | undefined;
  const snapshots = db.prepare("SELECT captured_at AS t, account_equity AS equity FROM position_snapshots ORDER BY captured_at").all() as Array<{ t: string; equity: number }>;

  return {
    generatedAt: new Date().toISOString(),
    equity: snapshot?.account_equity ?? null,
    snapshotAt: snapshot?.captured_at ?? null,
    metrics: {
      realizedPnl,
      tradeCount: trades.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      bestTrade: trades.length ? Math.max(...trades.map((t) => t.pnl)) : null,
      worstTrade: trades.length ? Math.min(...trades.map((t) => t.pnl)) : null,
      linkedFillRate: fills.length ? linked / fills.length : null,
      fillCount: fills.length,
      openLots,
    },
    equityCurve,
    weekdayPnl: WEEKDAYS.map((day) => ({ day, ...weekdayMap.get(day)! })),
    byTicker: [...tickerMap.entries()]
      .map(([ticker, row]) => ({ ticker, ...row }))
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 12),
    bySide: [...sideMap.entries()].map(([side, row]) => ({ side, ...row })),
    deciles: quantileBuckets(trades.map((t) => t.pnl)),
    patterns: detectPatterns(trades, fills),
    recentTrades: [...trades].reverse().slice(0, 20),
    snapshots,
  };
}

/** Day-bucketed realized PnL for a calendar month in the trader's timezone. */
export function computeCalendarMonth(
  year: number,
  month: number,
  timeZone = DEFAULT_TIMEZONE,
): CalendarMonth {
  const y = Math.max(2000, Math.min(2100, Math.floor(year)));
  const m = Math.max(1, Math.min(12, Math.floor(month)));
  const prefix = monthKey(y, m);
  const { trades } = buildClosedTrades();
  const byDay = new Map<string, CalendarDay>();

  for (const trade of trades) {
    const date = dayKeyInZone(trade.closedAt, timeZone);
    if (!date.startsWith(prefix)) continue;
    const row = byDay.get(date) ?? { date, pnl: 0, trades: 0, wins: 0, losses: 0, closes: [] };
    row.pnl += trade.pnl;
    row.trades += 1;
    if (trade.pnl > 0) row.wins += 1;
    else if (trade.pnl < 0) row.losses += 1;
    row.closes.push(trade);
    byDay.set(date, row);
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    year: y,
    month: m,
    timeZone,
    days,
    monthPnl: days.reduce((s, d) => s + d.pnl, 0),
    monthTrades: days.reduce((s, d) => s + d.trades, 0),
  };
}
