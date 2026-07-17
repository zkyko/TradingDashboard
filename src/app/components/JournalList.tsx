import Link from "next/link";
import { localePath } from "@/lib/locale";
import type { JournalEntryMeta } from "@/lib/review/types";
import DashHeader from "@/app/components/DashHeader";

export default function JournalList({
  entries,
  locale,
  activeSlug,
  bodyHtml,
  title,
}: {
  entries: JournalEntryMeta[];
  locale: string;
  activeSlug?: string;
  bodyHtml?: string;
  title?: string;
}) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <DashHeader
        title="Journal"
        subtitle="Markdown in /journal — Cursor writes, this page reads."
      />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="card bg-base-200 border border-base-300 shadow-sm h-fit">
          <div className="card-body gap-2 p-3">
            <h3 className="text-xs font-bold uppercase tracking-wider opacity-50 px-2">Entries</h3>
            {!entries.length ? (
              <p className="px-2 text-sm opacity-60">No entries yet.</p>
            ) : (
              <ul className="menu menu-sm p-0 gap-0.5">
                {entries.map((e) => (
                  <li key={e.slug}>
                    <Link
                      href={localePath(locale, `/journal/${e.slug}`)}
                      className={e.slug === activeSlug ? "active" : undefined}
                    >
                      <span className="flex flex-col items-start gap-0.5">
                        <span className="font-semibold">{e.title}</span>
                        <span className="text-[11px] opacity-50">{e.date}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <article className="card bg-base-200 border border-base-300 shadow-sm min-h-72">
          <div className="card-body p-5">
            {activeSlug && bodyHtml ? (
              <>
                <h2 className="card-title text-xl">{title}</h2>
                <div className="md-body prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
              </>
            ) : (
              <p className="opacity-60">Select an entry.</p>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
