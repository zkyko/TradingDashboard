import CalendarView from "@/app/components/CalendarView";
import { buildEdgeProfile } from "@/lib/review/edge";
import { buildGoalPlan } from "@/lib/review/goal";
import {
  loadCalendarIndex,
  loadEquity,
  loadLatestWeek,
  loadMetricsForward,
  loadSizing,
  loadTrades,
  loadWeeksIndex,
  loadEarningsWeek,
} from "@/lib/review/load";

const FORWARD_FROM = "2026-07-13T00:00:00.000Z";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const equity = loadEquity();
  const trades = loadTrades();
  const series = equity.series;
  const latest = equity.latest?.equity ?? series[series.length - 1]?.equity ?? 0;
  const startEquity = series[0]?.equity ?? null;

  return (
    <CalendarView
      locale={locale}
      calendar={loadCalendarIndex()}
      weeks={loadWeeksIndex()}
      currentWeek={loadLatestWeek()}
      sizing={loadSizing()}
      forward={loadMetricsForward()}
      goal={buildGoalPlan(latest, {
        goal: 100_000,
        startEquity,
        trades: trades.trades,
        fromIso: FORWARD_FROM,
      })}
      edge={buildEdgeProfile(trades.trades, { fromIso: FORWARD_FROM })}
      earnings={loadEarningsWeek()}
    />
  );
}
