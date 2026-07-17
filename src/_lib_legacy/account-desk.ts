import { buildClosedTrades, type ClosedTrade } from "@/lib/analytics";
import { db } from "@/lib/db";
import { dayKeyInZone, DEFAULT_TIMEZONE } from "@/lib/timezone";

export const ACCOUNT_DATA_SINCE = "2026-01-01";

export type AccountOrderRow = {
  external_id: string;
  account_mask: string | null;
  ticker: string;
  side: string;
  order_type: string | null;
  state: string | null;
  quantity: number | null;
  filled_quantity: number | null;
  average_price: number | null;
  placed_agent: string | null;
  created_at: string;
};

export type AccountVizPoint = { t: string; pnl: number };
export type AccountDayBar = { date: string; pnl: number; trades: number; orders: number };
export type AccountTickerBar = { ticker: string; pnl: number; trades: number };

export type AccountMonthRow = {
  key: string;
  label: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  orders: number;
  activeDays: number;
  topTicker: string | null;
  topTickerPnl: number | null;
  blurb: string;
};

export type AccountActivity = {
  winRate: number | null;
  avgPerClose: number | null;
  bestMonth: string | null;
  worstMonth: string | null;
  mostActiveTicker: string | null;
  planLinkedPct: number | null;
  activeDays: number;
  avgClosesPerActiveDay: number | null;
  openPlans: number;
  journalEntries: number;
  bullets: string[];
};

export type AccountDeskPayload = {
  capturedAt: string | null;
  since: string;
  dayKey: string;
  dayPnl: number;
  dayTrades: number;
  ytdPnl: number;
  ytdTrades: number;
  equityCurve: AccountVizPoint[];
  dailyBars: AccountDayBar[];
  byTicker: AccountTickerBar[];
  months: AccountMonthRow[];
  activity: AccountActivity;
  accounts: Array<{
    accountNumber: string;
    mask: string;
    nickname: string;
    state: string;
    type: string;
    optionLevel: string;
    totalValue: number;
    cash: number;
    buyingPower: number;
    unleveragedBp: number;
    marginCapacity: number;
    equityValue: number;
    optionsValue: number;
    cryptoValue: number;
    pendingDeposits: number;
  }>;
  orders: AccountOrderRow[];
  orderCount: number;
};

function maskAccount(value: unknown) {
  const text = String(value || "");
  return text ? `••••${text.slice(-4)}` : "—";
}

function sinceCutoff(iso: string) {
  return iso >= ACCOUNT_DATA_SINCE;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function monthBlurb(row: Omit<AccountMonthRow, "blurb" | "label">): string {
  if (!row.trades) return "Quiet month — almost no closed inventory.";
  const wr = row.winRate == null ? null : Math.round(row.winRate * 100);
  if (row.pnl >= 0 && wr != null && wr >= 55) {
    return `Green month with ${wr}% winners — ask whether process or luck drove it.`;
  }
  if (row.pnl < 0 && row.trades >= 8) {
    return `Busy and red (${row.trades} closes) — review size, hold time, and plan adherence.`;
  }
  if (row.trades <= 3) {
    return `Light activity (${row.trades} closes) — selective or under-engaged?`;
  }
  if (row.pnl >= 0) return `Finished green on ${row.trades} closes — protect what worked without inventing a new rule midstream.`;
  return `Finished red on ${row.trades} closes — journal the pattern, not the P&L story.`;
}

export function loadAccountDesk(timeZone = DEFAULT_TIMEZONE): AccountDeskPayload {
  const snapshot = db.prepare("SELECT * FROM brokerage_snapshots ORDER BY captured_at DESC LIMIT 1").get() as
    | Record<string, string | number>
    | undefined;
  const accountsRaw = snapshot ? (JSON.parse(String(snapshot.accounts_json)) as Array<Record<string, unknown>>) : [];
  const portfolios = snapshot
    ? (JSON.parse(String(snapshot.portfolios_json)) as Array<{ accountNumber: string; data: Record<string, unknown> }>)
    : [];

  const accounts = accountsRaw.map((account) => {
    const portfolio = portfolios.find((item) => item.accountNumber === account.account_number)?.data;
    const bp = portfolio?.buying_power as Record<string, unknown> | undefined;
    const buying = Number(bp?.buying_power || 0);
    const unleveraged = Number(bp?.unleveraged_buying_power || 0);
    return {
      accountNumber: String(account.account_number || ""),
      mask: maskAccount(account.account_number),
      nickname: String(account.nickname || account.brokerage_account_type || "Account"),
      state: String(account.state || ""),
      type: String(account.type || ""),
      optionLevel: String(account.option_level || "NONE").replace("option_level_", "L"),
      totalValue: Number(portfolio?.total_value || 0),
      cash: Number(portfolio?.cash || 0),
      buyingPower: buying,
      unleveragedBp: unleveraged,
      marginCapacity: Math.max(0, buying - unleveraged),
      equityValue: Number(portfolio?.equity_value || 0),
      optionsValue: Number(portfolio?.options_value || 0),
      cryptoValue: Number(portfolio?.crypto_value || 0),
      pendingDeposits: Number(portfolio?.pending_deposits || 0),
    };
  });

  const orders = db
    .prepare(
      `SELECT external_id, account_mask, ticker, side, order_type, state, quantity, filled_quantity, average_price, placed_agent, created_at
       FROM broker_orders
       WHERE datetime(created_at) >= datetime(?)
       ORDER BY datetime(created_at) DESC
       LIMIT 500`,
    )
    .all(ACCOUNT_DATA_SINCE) as AccountOrderRow[];

  const { trades } = buildClosedTrades();
  const ytdTrades = trades.filter((t) => sinceCutoff(String(t.closedAt).slice(0, 10)));
  const dayKey = dayKeyInZone(new Date(), timeZone);
  const dayCloses = ytdTrades.filter((t) => dayKeyInZone(t.closedAt, timeZone) === dayKey);
  const dayPnl = dayCloses.reduce((s, t) => s + t.pnl, 0);
  const ytdPnl = ytdTrades.reduce((s, t) => s + t.pnl, 0);

  let running = 0;
  const equityCurve = ytdTrades.map((t) => {
    running += t.pnl;
    return { t: t.closedAt, pnl: running };
  });

  const dayMap = new Map<string, AccountDayBar>();
  for (const trade of ytdTrades) {
    const key = dayKeyInZone(trade.closedAt, timeZone);
    if (!key) continue;
    const row = dayMap.get(key) ?? { date: key, pnl: 0, trades: 0, orders: 0 };
    row.pnl += trade.pnl;
    row.trades += 1;
    dayMap.set(key, row);
  }
  for (const order of orders) {
    const key = dayKeyInZone(order.created_at, timeZone);
    if (!key) continue;
    const row = dayMap.get(key) ?? { date: key, pnl: 0, trades: 0, orders: 0 };
    row.orders += 1;
    dayMap.set(key, row);
  }
  const dailyBars = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const tickerMap = new Map<string, AccountTickerBar>();
  for (const trade of ytdTrades) {
    const row = tickerMap.get(trade.ticker) ?? { ticker: trade.ticker, pnl: 0, trades: 0 };
    row.pnl += trade.pnl;
    row.trades += 1;
    tickerMap.set(trade.ticker, row);
  }
  const byTicker = [...tickerMap.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 8);

  // Monthly rollup
  const monthMap = new Map<string, {
    key: string;
    pnl: number;
    trades: number;
    wins: number;
    losses: number;
    orders: number;
    days: Set<string>;
    tickers: Map<string, number>;
  }>();
  for (const trade of ytdTrades) {
    const d = dayKeyInZone(trade.closedAt, timeZone);
    const key = d.slice(0, 7);
    if (!key) continue;
    const row = monthMap.get(key) ?? {
      key,
      pnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      orders: 0,
      days: new Set<string>(),
      tickers: new Map<string, number>(),
    };
    row.pnl += trade.pnl;
    row.trades += 1;
    if (trade.pnl > 0) row.wins += 1;
    if (trade.pnl < 0) row.losses += 1;
    row.days.add(d);
    row.tickers.set(trade.ticker, (row.tickers.get(trade.ticker) || 0) + trade.pnl);
    monthMap.set(key, row);
  }
  for (const order of orders) {
    const d = dayKeyInZone(order.created_at, timeZone);
    const key = d.slice(0, 7);
    if (!key) continue;
    const row = monthMap.get(key) ?? {
      key,
      pnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      orders: 0,
      days: new Set<string>(),
      tickers: new Map<string, number>(),
    };
    row.orders += 1;
    monthMap.set(key, row);
  }

  const months: AccountMonthRow[] = [...monthMap.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((row) => {
      const top = [...row.tickers.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
      const base = {
        key: row.key,
        pnl: row.pnl,
        trades: row.trades,
        wins: row.wins,
        losses: row.losses,
        winRate: row.trades ? row.wins / row.trades : null,
        orders: row.orders,
        activeDays: row.days.size,
        topTicker: top?.[0] ?? null,
        topTickerPnl: top?.[1] ?? null,
      };
      return {
        ...base,
        label: monthLabel(row.key),
        blurb: monthBlurb(base),
      };
    });

  const wins = ytdTrades.filter((t) => t.pnl > 0).length;
  const fillStats = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN decision_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
    FROM executions
    WHERE datetime(executed_at) >= datetime(?)
  `).get(ACCOUNT_DATA_SINCE) as { total: number; linked: number };
  const openPlans = (db.prepare(`SELECT COUNT(*) AS c FROM trade_plans WHERE status='OPEN'`).get() as { c: number }).c;
  const journalEntries = (db.prepare(`SELECT COUNT(*) AS c FROM journal_entries WHERE datetime(created_at) >= datetime(?)`).get(ACCOUNT_DATA_SINCE) as { c: number }).c;
  const mostActive = [...tickerMap.values()].sort((a, b) => b.trades - a.trades)[0];
  const bestMonth = months.length ? [...months].sort((a, b) => b.pnl - a.pnl)[0] : null;
  const worstMonth = months.length ? [...months].sort((a, b) => a.pnl - b.pnl)[0] : null;
  const activeDays = dailyBars.filter((d) => d.trades > 0).length;
  const planLinkedPct = fillStats.total ? fillStats.linked / fillStats.total : null;

  const bullets: string[] = [];
  bullets.push(`${ytdTrades.length} closes since ${ACCOUNT_DATA_SINCE} · realized ${ytdPnl >= 0 ? "+" : ""}${ytdPnl.toFixed(2)}.`);
  if (mostActive) bullets.push(`Most active name: ${mostActive.ticker} (${mostActive.trades} closes).`);
  if (bestMonth && worstMonth && bestMonth.key !== worstMonth.key) {
    bullets.push(`Best month ${bestMonth.label}; toughest ${worstMonth.label}.`);
  }
  if (planLinkedPct != null) {
    bullets.push(`${Math.round(planLinkedPct * 100)}% of fills linked to a written plan — accountability hinge.`);
  }
  if (openPlans) bullets.push(`${openPlans} open decision(s) still on the board.`);
  else bullets.push("No open decisions — either selective, or under-documented.");
  if (journalEntries) bullets.push(`${journalEntries} journal entries since Jan — keep connecting closes to notes.`);
  else bullets.push("Few/no journal entries since Jan — process memory is thin.");

  const activity: AccountActivity = {
    winRate: ytdTrades.length ? wins / ytdTrades.length : null,
    avgPerClose: ytdTrades.length ? ytdPnl / ytdTrades.length : null,
    bestMonth: bestMonth?.label ?? null,
    worstMonth: worstMonth?.label ?? null,
    mostActiveTicker: mostActive?.ticker ?? null,
    planLinkedPct,
    activeDays,
    avgClosesPerActiveDay: activeDays ? ytdTrades.length / activeDays : null,
    openPlans,
    journalEntries,
    bullets,
  };

  return {
    capturedAt: snapshot ? String(snapshot.captured_at) : null,
    since: ACCOUNT_DATA_SINCE,
    dayKey,
    dayPnl,
    dayTrades: dayCloses.length,
    ytdPnl,
    ytdTrades: ytdTrades.length,
    equityCurve,
    dailyBars,
    byTicker,
    months,
    activity,
    accounts,
    orders,
    orderCount: orders.length,
  };
}

/** Compact payload for AI — no account numbers / cash. */
export function accountBriefContext(desk: AccountDeskPayload = loadAccountDesk()) {
  return {
    since: desk.since,
    dayKey: desk.dayKey,
    dayPnl: desk.dayPnl,
    dayTrades: desk.dayTrades,
    ytdPnl: desk.ytdPnl,
    ytdTrades: desk.ytdTrades,
    months: desk.months.map((m) => ({
      label: m.label,
      pnl: Number(m.pnl.toFixed(2)),
      trades: m.trades,
      winRate: m.winRate == null ? null : Number((m.winRate * 100).toFixed(0)),
      activeDays: m.activeDays,
      topTicker: m.topTicker,
      blurb: m.blurb,
    })),
    activity: {
      winRate: desk.activity.winRate == null ? null : Number((desk.activity.winRate * 100).toFixed(0)),
      avgPerClose: desk.activity.avgPerClose == null ? null : Number(desk.activity.avgPerClose.toFixed(2)),
      bestMonth: desk.activity.bestMonth,
      worstMonth: desk.activity.worstMonth,
      mostActiveTicker: desk.activity.mostActiveTicker,
      planLinkedPct: desk.activity.planLinkedPct == null ? null : Number((desk.activity.planLinkedPct * 100).toFixed(0)),
      activeDays: desk.activity.activeDays,
      openPlans: desk.activity.openPlans,
      journalEntries: desk.activity.journalEntries,
      bullets: desk.activity.bullets,
    },
    byTicker: desk.byTicker.slice(0, 6),
    optionsNote: "Options history lives on the Options tab.",
  };
}

export type { ClosedTrade };
