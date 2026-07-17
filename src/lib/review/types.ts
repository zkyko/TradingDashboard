/** Shared contracts for static journal / weekly-review data. */

export type FillRecord = {
  id: string;
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  executedAt: string;
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
  holdMinutes: number;
  overnight: boolean;
};

export type EquityPoint = { t: string; equity: number };

export type EquityFile = {
  updatedAt: string;
  latest: { t: string; equity: number } | null;
  series: EquityPoint[];
};

export type FillsFile = {
  updatedAt: string;
  fills: FillRecord[];
};

export type TradesFile = {
  updatedAt: string;
  openLots: number;
  trades: ClosedTrade[];
};

export type TiltState =
  | "calm"
  | "on_streak"
  | "chopping"
  | "revenge_sizing"
  | "overnight_hungover"
  | "cooling_off";

export type BehaviorFile = {
  updatedAt: string;
  timeZone: string;
  currentStreak: { type: "win" | "loss" | "flat"; length: number };
  maxWinStreak: number;
  maxLossStreak: number;
  overnightPnl: number;
  holdBuckets: {
    overnight: { n: number; pnl: number };
    under15m: { n: number; pnl: number };
    m15to60: { n: number; pnl: number };
    over60m: { n: number; pnl: number };
  };
  sizeEscalationFlags: number;
  tilt: { state: TiltState; score: number; reasons: string[] };
  recentTrades: ClosedTrade[];
};

export type WeekDayPnl = { date: string; label: string; pnl: number; trades: number };

export type WeekTickerPnl = { ticker: string; pnl: number; trades: number; wins: number };

export type TradeMetrics = {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  flatCount: number;
  winRate: number | null;
  winPct: number | null;
  profitFactor: number | null;
  profitFactorInfinite?: boolean;
  rewardRisk: number | null;
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgLossAbs?: number | null;
  grossWin: number;
  grossLoss: number;
  realizedPnl: number;
  bestTrade: number | null;
  worstTrade: number | null;
  avgHoldMinutes: number | null;
  equityCurve?: Array<{ t: string; pnl: number }>;
};

export type WeekReviewFile = {
  id: string;
  label: string;
  start: string;
  end: string;
  timeZone: string;
  updatedAt: string;
  realizedPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  priorWeekPnl: number | null;
  metrics?: TradeMetrics;
  soxlMetrics?: TradeMetrics;
  days: WeekDayPnl[];
  byTicker: WeekTickerPnl[];
  tilt: { state: TiltState; score: number; reasons: string[] };
  streaks: { current: BehaviorFile["currentStreak"]; maxWin: number; maxLoss: number };
  keep: string[];
  stop: string[];
  improve: string[];
  lesson: string;
  mistakes: string[];
  openNotes: string[];
};

export type WeeksIndexFile = {
  updatedAt: string;
  weeks: Array<{
    id: string;
    label: string;
    start?: string;
    end?: string;
    realizedPnl: number;
    tradeCount?: number;
    winRate?: number | null;
    winPct?: number | null;
    profitFactor?: number | null;
    rewardRisk?: number | null;
    expectancy?: number | null;
    lesson: string;
    hasNotes?: boolean;
  }>;
};

export type MetricsForwardFile = {
  updatedAt: string;
  fromWeek: string;
  note: string;
  cumulative: TradeMetrics;
  weeks: Array<{
    id: string;
    label: string;
    start: string;
    realizedPnl: number;
    cumulativePnl: number;
    tradeCount: number;
    winPct: number | null;
    profitFactor: number | null;
    rewardRisk: number | null;
    expectancy: number | null;
    avgWin: number | null;
    avgLoss: number | null;
  }>;
};

export type DayTradeRow = {
  ticker: string;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  openedAt: string;
  closedAt: string;
  holdMinutes: number;
  overnight: boolean;
};

export type TradeReview = DayTradeRow & {
  holdBucket: string;
  grade: "A" | "B" | "C";
  flags: string[];
  movePts: number;
  notional: number;
  review: string;
  whatWorked: string;
  whatFailed: string;
  nextTime: string;
  notes?: string;
};

export type DayReviewFile = {
  id: string;
  date: string;
  label: string;
  weekday: string;
  weekId: string;
  timeZone: string;
  updatedAt: string;
  realizedPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  processGrades?: { A: number; B: number; C: number };
  metrics?: TradeMetrics;
  byTicker: WeekTickerPnl[];
  trades: DayTradeRow[];
  tradeReviews?: TradeReview[];
  tilt: { state: TiltState; score: number; reasons: string[] };
  streaks: { current: BehaviorFile["currentStreak"]; maxWin: number; maxLoss: number };
  keep: string[];
  stop: string[];
  improve: string[];
  lesson: string;
  notes: string;
};

export type SizingGate = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type SizingFile = {
  updatedAt: string;
  equity: number;
  assumptions: {
    accountNote: string;
    targetPts: number;
    riskBudgetPct: number;
    typicalShares: number;
  };
  soxl28d: {
    trades: number;
    winRate: number;
    expectancy: number;
    avgWin: number;
    avgLoss: number;
    under15: { n: number; pnl: number };
    over15: { n: number; pnl: number };
    overnight: { n: number; pnl: number };
  };
  gates: SizingGate[];
  gatesPassed: number;
  stance: string;
  headline: string;
  guidance: string[];
  suggested: {
    holdShares: number;
    consistencyCapShares: number;
    nextSharesIfReady: number;
    sizeUpReady: boolean;
  };
};

export type DaySummary = {
  date: string;
  weekday: string;
  weekId: string;
  realizedPnl: number;
  tradeCount: number;
  lesson: string;
  hasNotes?: boolean;
};

export type CalendarMonth = {
  month: string;
  days: DaySummary[];
  realizedPnl: number;
  tradeCount: number;
};

export type CalendarIndexFile = {
  updatedAt: string;
  timeZone: string;
  months: CalendarMonth[];
};

export type DaysIndexFile = {
  updatedAt: string;
  days: DaySummary[];
};

export type JournalFrontmatter = {
  title: string;
  date: string;
  tags?: string[];
  mood?: string;
  tickers?: string[];
};

export type JournalEntryMeta = JournalFrontmatter & {
  slug: string;
  path: string;
};

export type EarningsName = {
  ticker: string;
  name: string;
};

export type EarningsDay = {
  date: string;
  weekday: string;
  beforeOpen: EarningsName[];
  afterClose: EarningsName[];
};

export type EarningsWeekFile = {
  updatedAt: string;
  source: string;
  sourceUrl: string;
  weekOf: string;
  label: string;
  days: EarningsDay[];
};
