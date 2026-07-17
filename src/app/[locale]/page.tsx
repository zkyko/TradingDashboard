import CalendarView from "@/app/components/CalendarView";
import {
  loadCalendarIndex,
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
  return (
    <CalendarView
      locale={locale}
      calendar={loadCalendarIndex()}
      weeks={loadWeeksIndex()}
      currentWeek={loadLatestWeek()}
      sizing={loadSizing()}
      forward={loadMetricsForward()}
    />
  );
}
