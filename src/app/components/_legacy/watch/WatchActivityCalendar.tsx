"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { daysInMonth, weekdayForDateKey } from "@/lib/timezone";
import { useFormat } from "@/app/components/useFormat";
import { useTimezone } from "@/app/components/useTimezone";
import type { WatchActivity, WatchCalendarDay, WatchCalendarMonth } from "@/lib/watchlist-activity";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WatchActivityCalendar({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string, day?: string) => void;
}) {
  const format = useFormat();
  const { timezone, setTimezone, options } = useTimezone();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<WatchCalendarMonth | null>(null);
  const [selected, setSelected] = useState<WatchCalendarDay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/watchlist/calendar?year=${year}&month=${month}&tz=${encodeURIComponent(timezone)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Calendar failed.");
      setData(body as WatchCalendarMonth);
      setSelected((prev) => {
        if (!prev) return null;
        return (body as WatchCalendarMonth).days.find((d) => d.date === prev.date) || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar failed.");
    } finally {
      setBusy(false);
    }
  }, [year, month, timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, WatchCalendarDay>();
    for (const day of data?.days || []) map.set(day.date, day);
    return map;
  }, [data]);

  const cells = useMemo(() => {
    const total = daysInMonth(year, month);
    const firstKey = `${year}-${String(month).padStart(2, "0")}-01`;
    const startPad = weekdayForDateKey(firstKey, timezone);
    const out: Array<{ key: string; dayNum: number | null; entry: WatchCalendarDay | null }> = [];
    for (let i = 0; i < startPad; i++) out.push({ key: `pad-${i}`, dayNum: null, entry: null });
    for (let d = 1; d <= total; d++) {
      const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ key, dayNum: d, entry: byDate.get(key) || null });
    }
    return out;
  }, [year, month, timezone, byDate]);

  const shiftMonth = (delta: number) => {
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(date.getUTCFullYear());
    setMonth(date.getUTCMonth() + 1);
    setSelected(null);
  };

  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));

  return (
    <section className="terminal-panel watch-cal">
      <div className="panel-head">
        <span>Watch calendar</span>
        <div className="calendar-toolbar">
          <label className="calendar-tz">
            <span className="sr-only">Timezone</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} aria-label="Timezone">
              {options.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
          <strong>{monthLabel}</strong>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          <button type="button" onClick={() => void load()} disabled={busy}>{busy ? "…" : "Refresh"}</button>
        </div>
      </div>

      {error && <p className="error-box">{error}</p>}

      <div className="calendar-summary">
        <span>Updates <b>{format.number(data?.monthCount ?? 0)}</b></span>
        <span>Active days <b>{format.number(data?.days.length ?? 0)}</b></span>
      </div>

      <div className="calendar-grid" role="grid" aria-label="Watchlist activity by day">
        {WEEKDAYS.map((d) => <div key={d} className="calendar-dow">{d}</div>)}
        {cells.map((cell) => {
          if (cell.dayNum == null) return <div key={cell.key} className="calendar-cell empty" />;
          const has = Boolean(cell.entry?.count);
          const active = selected?.date === cell.key;
          return (
            <button
              key={cell.key}
              type="button"
              className={`calendar-cell watch-day${has ? " has" : ""}${active ? " active" : ""}`}
              onClick={() => setSelected(cell.entry || { date: cell.key, count: 0, symbols: [], activities: [] })}
            >
              <span className="day-num">{cell.dayNum}</span>
              {has ? (
                <div className="day-symbols">
                  {cell.entry!.symbols.slice(0, 3).map((s) => (
                    <span key={s} className="day-sym">{s}</span>
                  ))}
                  {cell.entry!.symbols.length > 3 && <span className="day-sym more">+{cell.entry!.symbols.length - 3}</span>}
                </div>
              ) : (
                <span className="day-pnl muted">—</span>
              )}
              {has && <span className="day-n">{cell.entry!.count}</span>}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="calendar-day-panel">
          <div className="panel-head">
            <span>{selected.date}</span>
            <span className="muted">{selected.count ? `${selected.count} updates` : "No updates"}</span>
          </div>
          {selected.activities.length === 0 ? (
            <div className="terminal-empty compact">No watch activity this day</div>
          ) : (
            <div className="watch-day-feed">
              {selected.activities.map((act: WatchActivity, i) => (
                <button
                  type="button"
                  className="watch-day-row"
                  key={`${act.id}-${act.symbol}-${i}`}
                  onClick={() => onOpenSymbol(act.symbol, selected.date)}
                >
                  <b>{act.symbol}</b>
                  <span className={`kind-chip kind-${act.kind}`}>{act.kind}</span>
                  <span>{act.summary || "—"}</span>
                  <time>{format.dateTime(act.createdAt, { hour: "2-digit", minute: "2-digit" })}</time>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
