import CalendarView from "@/app/components/CalendarView";
import { buildGoalPlan } from "@/lib/review/goal";
import {
  loadCalendarIndex,
  loadEquity,
  loadLatestWeek,
  loadMetricsForward,
  loadSizing,
  loadWeeksIndex,
} from "@/lib/review/load";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const equity = loadEquity();
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
      goal={buildGoalPlan(latest, { goal: 100_000, startEquity })}
    />
  );
}
