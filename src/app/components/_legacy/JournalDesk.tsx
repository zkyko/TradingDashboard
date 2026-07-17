"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import RichTextEditor from "./RichTextEditor";
import InsightsPanel from "./InsightsPanel";
import { useI18n, useCurrentLocale } from "@/locales/client";
import { useFormat } from "@/app/components/useFormat";
import { localePath } from "@/lib/locale";

type Entry = {
  id: string;
  title: string;
  body_html: string;
  body_text: string;
  source: string;
  ticker: string | null;
  sentiment: string | null;
  tags_json: string | null;
  updated_at: string;
  created_at: string;
};

export default function JournalDesk() {
  const t = useI18n();
  const format = useFormat();
  const locale = useCurrentLocale();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("<p></p>");
  const [ticker, setTicker] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hydratedId = useRef<string | null>(null);

  const selected = useMemo(() => entries.find((e) => e.id === selectedId) || null, [entries, selectedId]);

  const load = useCallback(async () => {
    const response = await fetch("/api/journal");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Load failed.");
    setEntries(data as Entry[]);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Load failed."));
  }, [load]);

  useEffect(() => {
    if (!selected) {
      hydratedId.current = null;
      return;
    }
    if (hydratedId.current === selected.id) return;
    hydratedId.current = selected.id;
    setTitle(String(selected.title || ""));
    setBodyHtml(String(selected.body_html || "<p></p>"));
    setTicker(selected.ticker ? String(selected.ticker) : "");
  }, [selected]);

  async function createEntry() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled", bodyHtml: "<p></p>", source: "manual" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Create failed.");
      await load();
      hydratedId.current = null;
      setSelectedId(String(data.id));
      setStatus("Created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/journal/${selectedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, bodyHtml, ticker: ticker || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed.");
      await load();
      setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry() {
    if (!selectedId) return;
    if (!window.confirm("Delete this journal entry?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/journal/${selectedId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Delete failed.");
      setSelectedId(null);
      setTitle("");
      setBodyHtml("<p></p>");
      setTicker("");
      await load();
      setStatus("Deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function autoJournal() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/journal/auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 5 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Auto journal failed.");
      await load();
      if (data.entries?.[0]?.id) {
        hydratedId.current = null;
        setSelectedId(String(data.entries[0].id));
      }
      setStatus(`Auto-drafted ${data.created} entr${data.created === 1 ? "y" : "ies"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto journal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="journal-desk">
      <div className="command-line">
        <span className="prompt">TL</span>
        <span>{t("journal.processOnly")}</span>
        <Link href={localePath(locale, "/import")}>{t("journal.csvImport")}</Link>
      </div>

      <div className="journal-layout">
        <aside className="terminal-panel journal-list">
          <div className="panel-head">
            <span>{t("journal.entries")}</span>
            <div className="journal-actions">
              <button type="button" onClick={() => void createEntry()} disabled={busy}>{t("journal.new")}</button>
              <button type="button" onClick={() => void autoJournal()} disabled={busy}>{t("journal.auto")}</button>
            </div>
          </div>
          <div className="journal-list-body">
            {entries.length === 0 ? (
              <div className="terminal-empty compact">{t("journal.noEntries")}</div>
            ) : entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`journal-list-item${entry.id === selectedId ? " active" : ""}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <b>{entry.title}</b>
                <span>
                  {entry.ticker || "—"} · {entry.source}
                  {entry.sentiment ? ` · ${entry.sentiment}` : ""}
                </span>
                <time>{format.dateTime(entry.updated_at)}</time>
              </button>
            ))}
          </div>
        </aside>

        <section className="terminal-panel journal-editor">
          <div className="panel-head">
            <span>{selected ? t("journal.edit") : t("journal.select")}</span>
            <div className="journal-actions">
              <button type="button" onClick={() => void saveEntry()} disabled={!selectedId || busy}>{t("common.save")}</button>
              <button type="button" onClick={() => void removeEntry()} disabled={!selectedId || busy}>{t("common.delete")}</button>
            </div>
          </div>
          {!selectedId ? (
            <div className="terminal-empty">{t("journal.createOrSelect")}</div>
          ) : (
            <div className="journal-editor-body">
              <div className="journal-meta">
                <label>
                  <span>{t("journal.titleField")}</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label>
                  <span>{t("journal.tickerField")}</span>
                  <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder={t("journal.optional")} />
                </label>
              </div>
              <RichTextEditor value={bodyHtml} onChange={setBodyHtml} journalEntryId={selectedId} />
              {(status || error) && (
                <p className={error ? "error-box" : "muted pad"}>{error || status}</p>
              )}
            </div>
          )}
        </section>
      </div>

      <InsightsPanel />
    </div>
  );
}
