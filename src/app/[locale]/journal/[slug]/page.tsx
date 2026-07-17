import { notFound } from "next/navigation";
import JournalList from "@/app/components/JournalList";
import { listJournalEntries, loadJournalEntry, renderMarkdown } from "@/lib/review/load";

export function generateStaticParams() {
  return listJournalEntries().map((e) => ({ slug: e.slug }));
}

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const entry = loadJournalEntry(slug);
  if (!entry) notFound();
  return (
    <JournalList
      entries={listJournalEntries()}
      locale={locale}
      activeSlug={slug}
      title={entry.meta.title}
      bodyHtml={renderMarkdown(entry.body)}
    />
  );
}
