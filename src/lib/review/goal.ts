import { money } from "@/lib/review/format";

export type GoalPlan = {
  goal: number;
  equity: number;
  progressPct: number;
  remaining: number;
  tradesAt2pct: number;
  tradesAt25pct: number;
  tradesAt3pct: number;
  weeksAt5Trades2: number;
  weeksAt5Trades3: number;
  startEquity: number | null;
  multipleNeeded: number;
};

export function buildGoalPlan(
  equity: number,
  opts: { goal?: number; startEquity?: number | null } = {},
): GoalPlan {
  const goal = opts.goal ?? 100_000;
  const eq = Math.max(0, equity);
  const progressPct = goal > 0 ? Math.min(100, (eq / goal) * 100) : 0;
  const remaining = Math.max(0, goal - eq);
  const multipleNeeded = eq > 0 ? goal / eq : Infinity;

  const tradesFor = (r: number) => {
    if (eq <= 0 || eq >= goal) return 0;
    return Math.ceil(Math.log(goal / eq) / Math.log(1 + r));
  };

  const tradesAt2pct = tradesFor(0.02);
  const tradesAt25pct = tradesFor(0.025);
  const tradesAt3pct = tradesFor(0.03);

  return {
    goal,
    equity: eq,
    progressPct,
    remaining,
    tradesAt2pct,
    tradesAt25pct,
    tradesAt3pct,
    weeksAt5Trades2: Math.ceil(tradesAt2pct / 5),
    weeksAt5Trades3: Math.ceil(tradesAt3pct / 5),
    startEquity: opts.startEquity ?? null,
    multipleNeeded,
  };
}
