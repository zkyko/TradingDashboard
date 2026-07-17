import GrowthView from "@/app/components/GrowthView";
import { buildGoalPlan } from "@/lib/review/goal";
import { loadEquity, loadTrades, loadWeeksIndex } from "@/lib/review/load";

export default function GrowthPage() {
  const equity = loadEquity();
  const trades = loadTrades();
  const series = equity.series;
  const latest = equity.latest?.equity ?? series[series.length - 1]?.equity ?? 0;
  return (
    <GrowthView
      equity={equity}
      trades={trades}
      weeks={loadWeeksIndex()}
      goal={buildGoalPlan(latest, {
        goal: 100_000,
        startEquity: series[0]?.equity ?? null,
        trades: trades.trades,
        fromIso: "2026-07-13T00:00:00.000Z",
      })}
    />
  );
}
