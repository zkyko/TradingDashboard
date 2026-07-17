import GrowthView from "@/app/components/GrowthView";
import { buildGoalPlan } from "@/lib/review/goal";
import { loadEquity, loadTrades, loadWeeksIndex } from "@/lib/review/load";

export default function GrowthPage() {
  const equity = loadEquity();
  const series = equity.series;
  const latest = equity.latest?.equity ?? series[series.length - 1]?.equity ?? 0;
  return (
    <GrowthView
      equity={equity}
      trades={loadTrades()}
      weeks={loadWeeksIndex()}
      goal={buildGoalPlan(latest, { goal: 100_000, startEquity: series[0]?.equity ?? null })}
    />
  );
}
