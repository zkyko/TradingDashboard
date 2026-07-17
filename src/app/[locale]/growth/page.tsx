import GrowthView from "@/app/components/GrowthView";
import { loadEquity, loadTrades, loadWeeksIndex } from "@/lib/review/load";

export default function GrowthPage() {
  return (
    <GrowthView
      equity={loadEquity()}
      trades={loadTrades()}
      weeks={loadWeeksIndex()}
    />
  );
}
