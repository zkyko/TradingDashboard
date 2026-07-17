import HistoryView from "@/app/components/HistoryView";
import { loadWeeksIndex } from "@/lib/review/load";

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <HistoryView weeks={loadWeeksIndex()} locale={locale} />;
}
