"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { FieldMapping, ImportField } from "@/lib/insights";
import { useI18n, useCurrentLocale } from "@/locales/client";
import { useFormat } from "@/app/components/useFormat";
import { localePath } from "@/lib/locale";

const TARGETS: ImportField[] = ["ticker", "side", "quantity", "price", "executedAt", "externalId", "ignore"];

/** RFC-4180-ish CSV parse that keeps newlines inside quoted fields. */
function parseCsv(text: string): { columns: string[]; rows: Array<Record<string, string>> } {
  const input = text.replace(/^\uFEFF/, "");
  const rowsRaw: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (inQuotes && input[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cur.trim());
      cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cur.trim());
      if (row.some((cell) => cell.length)) rowsRaw.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  row.push(cur.trim());
  if (row.some((cell) => cell.length)) rowsRaw.push(row);
  if (!rowsRaw.length) return { columns: [], rows: [] };
  const columns = rowsRaw[0].map((c, i) => c || `Column ${i + 1}`);
  const rows = rowsRaw.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    columns.forEach((col, i) => {
      record[col] = cells[i] ?? "";
    });
    return record;
  });
  return { columns, rows };
}

export default function ImportDesk() {
  const t = useI18n();
  const format = useFormat();
  const locale = useCurrentLocale();
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [notes, setNotes] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => rows.slice(0, 8), [rows]);

  async function onFile(file: File) {
    setError("");
    setStatus("");
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.columns.length) {
      setError("CSV has no header row.");
      return;
    }
    setColumns(parsed.columns);
    setRows(parsed.rows);
    setBusy(true);
    try {
      const response = await fetch("/api/import/map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ columns: parsed.columns, rows: parsed.rows.slice(0, 5) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Mapping failed.");
      setMapping(data.mapping || {});
      setNotes(Array.isArray(data.notes) ? data.notes : []);
      setStatus(data.offline ? "Heuristic mapping (offline)" : "AI mapping ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mapping failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!rows.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows, mapping }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Import failed.");
      setStatus(`Imported ${data.inserted} fills · skipped ${data.skipped}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-desk">
      <div className="command-line">
        <span className="prompt">TL</span>
        <span>{t("import.mapHint")}</span>
        <Link href={localePath(locale, "/journal")}>{t("import.toJournal")}</Link>
      </div>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>{t("import.csvFile")}</span>
          <span>{fileName || t("import.none")}</span>
        </div>
        <div className="import-upload">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onFile(file);
            }}
          />
          <p className="muted">{t("import.help")}</p>
        </div>
      </section>

      {!!columns.length && (
        <section className="terminal-panel">
          <div className="panel-head">
            <span>{t("import.fieldMapping")}</span>
            <button type="button" onClick={() => void commit()} disabled={busy}>{t("import.importFills")}</button>
          </div>
          {!!notes.length && (
            <ul className="import-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
          )}
          <div className="import-map">
            {columns.map((col) => (
              <label key={col}>
                <span>{col}</span>
                <select
                  value={mapping[col] || "ignore"}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [col]: e.target.value as ImportField }))}
                >
                  {TARGETS.map((tgt) => <option key={tgt} value={tgt}>{tgt}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      {!!preview.length && (
        <section className="terminal-panel">
          <div className="panel-head"><span>{t("import.preview")}</span><span>{format.number(rows.length)} {t("import.rows")}</span></div>
          <div className="import-preview">
            <table>
              <thead>
                <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => <td key={c}>{row[c]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(status || error) && <p className={error ? "error-box" : "muted pad"}>{error || status}</p>}
    </div>
  );
}
