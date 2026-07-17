export type GoalPlan = {
  goal: number;
  equity: number;
  progressPct: number;
  remaining: number;
  startEquity: number | null;
  multipleNeeded: number;
  /** Sample used for averages */
  sample: {
    label: string;
    tradeCount: number;
    expectancy: number;
    avgReturnOnNotionalPct: number;
    avgReturnOnEquityPct: number;
    winPct: number;
  };
  soxlSample: {
    label: string;
    tradeCount: number;
    expectancy: number;
    avgReturnOnNotionalPct: number;
    avgReturnOnEquityPct: number;
    winPct: number;
  } | null;
  /** Path using all-closes avg return on equity */
  pathAll: GoalPath;
  /** Path using SOXL-only avg return on equity (edge sleeve) */
  pathSoxl: GoalPath | null;
};

export type GoalPath = {
  avgReturnPct: number;
  tradesNeeded: number | null;
  weeksAt5: number | null;
  reachable: boolean;
  note: string;
};

type TradeLike = { pnl: number; qty: number; entryPrice: number; closedAt: string; ticker?: string };

function sampleStats(trades: TradeLike[], equity: number, label: string) {
  const n = trades.length;
  if (!n) {
    return {
      label,
      tradeCount: 0,
      expectancy: 0,
      avgReturnOnNotionalPct: 0,
      avgReturnOnEquityPct: 0,
      winPct: 0,
    };
  }
  const expectancy = trades.reduce((s, t) => s + t.pnl, 0) / n;
  let notionalSum = 0;
  let retSum = 0;
  let retN = 0;
  for (const t of trades) {
    const notional = t.qty * t.entryPrice;
    if (notional > 0) {
      notionalSum += notional;
      retSum += t.pnl / notional;
      retN += 1;
    }
  }
  const avgReturnOnNotionalPct = retN ? (retSum / retN) * 100 : 0;
  const avgReturnOnEquityPct = equity > 0 ? (expectancy / equity) * 100 : 0;
  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    label,
    tradeCount: n,
    expectancy,
    avgReturnOnNotionalPct,
    avgReturnOnEquityPct,
    winPct: (wins / n) * 100,
  };
}

function pathFromAvgReturnPct(
  equity: number,
  goal: number,
  avgReturnPct: number,
): GoalPath {
  const r = avgReturnPct / 100;
  if (equity <= 0) {
    return { avgReturnPct, tradesNeeded: null, weeksAt5: null, reachable: false, note: "No equity snapshot." };
  }
  if (equity >= goal) {
    return { avgReturnPct, tradesNeeded: 0, weeksAt5: 0, reachable: true, note: "Goal reached." };
  }
  if (r <= 0) {
    return {
      avgReturnPct,
      tradesNeeded: null,
      weeksAt5: null,
      reachable: false,
      note: "Average trade is ≤ 0 — not compounding toward $100k at this rate.",
    };
  }
  // Cap insane tiny positives that blow up trade counts
  const tradesNeeded = Math.ceil(Math.log(goal / equity) / Math.log(1 + r));
  if (!Number.isFinite(tradesNeeded) || tradesNeeded > 100_000) {
    return {
      avgReturnPct,
      tradesNeeded: null,
      weeksAt5: null,
      reachable: false,
      note: "Average edge too small to project a useful trade count.",
    };
  }
  return {
    avgReturnPct,
    tradesNeeded,
    weeksAt5: Math.ceil(tradesNeeded / 5),
    reachable: true,
    note: `Compounding your measured ${avgReturnPct.toFixed(3)}% of equity per close.`,
  };
}

export function buildGoalPlan(
  equity: number,
  opts: {
    goal?: number;
    startEquity?: number | null;
    trades?: TradeLike[];
    fromIso?: string;
  } = {},
): GoalPlan {
  const goal = opts.goal ?? 100_000;
  const eq = Math.max(0, equity);
  const progressPct = goal > 0 ? Math.min(100, (eq / goal) * 100) : 0;
  const remaining = Math.max(0, goal - eq);
  const multipleNeeded = eq > 0 ? goal / eq : Infinity;

  const fromIso = opts.fromIso ?? "2026-07-13T00:00:00.000Z"; // W29 forward
  const all = (opts.trades ?? []).filter((t) => t.closedAt >= fromIso);
  const soxl = all.filter((t) => String(t.ticker || "").toUpperCase() === "SOXL");

  // Prefer forward window; if empty fall back to last 40
  const useAll = all.length >= 5 ? all : (opts.trades ?? []).slice(-40);
  const useSoxl =
    soxl.length >= 5
      ? soxl
      : (opts.trades ?? []).filter((t) => String(t.ticker || "").toUpperCase() === "SOXL").slice(-40);

  const sample = sampleStats(
    useAll,
    eq,
    all.length >= 5 ? "W29 → now (all closes)" : "Last 40 closes",
  );
  const soxlSample =
    useSoxl.length > 0
      ? sampleStats(
          useSoxl,
          eq,
          soxl.length >= 5 ? "W29 → now (SOXL)" : "Recent SOXL",
        )
      : null;

  return {
    goal,
    equity: eq,
    progressPct,
    remaining,
    startEquity: opts.startEquity ?? null,
    multipleNeeded,
    sample,
    soxlSample,
    pathAll: pathFromAvgReturnPct(eq, goal, sample.avgReturnOnEquityPct),
    pathSoxl: soxlSample
      ? pathFromAvgReturnPct(eq, goal, soxlSample.avgReturnOnEquityPct)
      : null,
  };
}
