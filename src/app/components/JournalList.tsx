import Link from "next/link";
import { localePath } from "@/lib/locale";
import type { JournalEntryMeta } from "@/lib/review/types";

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
    <div className="review-page journal-layout">
      <header className="review-hero">
        <p className="review-eyebrow">Journal</p>
        <h1>Trade journal</h1>
        <p className="review-lede">
          Entries are markdown in <code>/journal</code>. Ask Cursor to add one — Pages just reads them.
        </p>
      </header>

      <div className="journal-split">
        <aside className="journal-aside">
          <h2>Entries</h2>
          {!entries.length ? (
            <p className="muted">No entries yet.</p>
          ) : (
            <ul>
              {entries.map((e) => (
                <li key={e.slug}>
                  <Link
                    href={localePath(locale, `/journal/${e.slug}`)}
                    className={e.slug === activeSlug ? "active" : undefined}
                  >
                    <strong>{e.title}</strong>
                    <span className="muted">{e.date}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <article className="journal-article review-panel">
          {activeSlug && bodyHtml ? (
            <>
              <h2>{title}</h2>
              <div className="md-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            </>
          ) : (
            <p className="muted">Select an entry.</p>
          )}
        </article>
      </div>
    </div>
  );
}
