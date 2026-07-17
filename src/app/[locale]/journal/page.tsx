import JournalList from "@/app/components/JournalList";
import { listJournalEntries } from "@/lib/review/load";

export default async function JournalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const entries = listJournalEntries();
  return <JournalList entries={entries} locale={locale} />;
}
