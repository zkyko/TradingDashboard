"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OptionsCalendarDay, OptionsCalendarMonth } from "@/lib/options-reflection";
import { daysInMonth, weekdayForDateKey } from "@/lib/timezone";
import { useFormat } from "@/app/components/useFormat";
import { useTimezone } from "@/app/components/useTimezone";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function OptionsPnlCalendar({ privacy = false }: { privacy?: boolean }) {
  const format = useFormat();
  const { timezone, setTimezone, options } = useTimezone();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<OptionsCalendarMonth | null>(null);
  const [selected, setSelected] = useState<OptionsCalendarDay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const money = (n: number) => (privacy ? "••••" : format.currency(n));
  const signed = (n: number) => {
    if (privacy) return "••••";
    return `${n > 0 ? "+" : ""}${format.currency(n)}`;
  };

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/options/calendar?year=${year}&month=${month}&tz=${encodeURIComponent(timezone)}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Calendar failed.");
      setData(body as OptionsCalendarMonth);
      setSelected((prev) => {
        if (!prev) return null;
        return (body as OptionsCalendarMonth).days.find((d) => d.date === prev.date) || null;
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
    const map = new Map<string, OptionsCalendarDay>();
    for (const day of data?.days || []) map.set(day.date, day);
    return map;
  }, [data]);

  const cells = useMemo(() => {
    const total = daysInMonth(year, month);
    const firstKey = `${year}-${String(month).padStart(2, "0")}-01`;
    const startPad = weekdayForDateKey(firstKey, timezone);
    const out: Array<{ key: string; dayNum: number | null; entry: OptionsCalendarDay | null }> = [];
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
    <section className="terminal-panel pnl-calendar">
      <div className="panel-head">
        <span>Options PnL calendar</span>
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

      <p className="muted" style={{ margin: "0 14px 10px", fontSize: 12 }}>
        Day color = matched open→close round-trip PnL on close date. Hover days also carry tape cashflow.
      </p>

      {error && <p className="error-box">{error}</p>}

      <div className="calendar-summary">
        <span>Month PnL <b className={(data?.monthPnl ?? 0) >= 0 ? "positive" : "negative"}>{signed(data?.monthPnl ?? 0)}</b></span>
        <span>Closes <b>{format.number(data?.monthTrades ?? 0)}</b></span>
        <span>Tape CF <b className={(data?.monthCashflow ?? 0) >= 0 ? "positive" : "negative"}>{signed(data?.monthCashflow ?? 0)}</b></span>
      </div>

      <div className="calendar-grid" role="grid" aria-label="Monthly options realized PnL">
        {WEEKDAYS.map((d) => <div key={d} className="calendar-dow">{d}</div>)}
        {cells.map((cell) => {
          if (cell.dayNum == null) return <div key={cell.key} className="calendar-cell empty" />;
          const pnl = cell.entry?.pnl ?? 0;
          const has = Boolean(cell.entry && (cell.entry.trades > 0 || cell.entry.orders > 0));
          const tone = !cell.entry?.trades ? (has ? "flat" : "") : pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat";
          const active = selected?.date === cell.key;
          return (
            <button
              key={cell.key}
              type="button"
              className={`calendar-cell ${tone}${active ? " active" : ""}`}
              onClick={() => setSelected(cell.entry || {
                date: cell.key, pnl: 0, trades: 0, wins: 0, losses: 0, cashflow: 0, orders: 0, closes: [],
              })}
            >
              <span className="day-num">{cell.dayNum}</span>
              {cell.entry?.trades
                ? <span className="day-pnl">{money(pnl)}</span>
                : <span className="day-pnl muted">{has ? "tape" : "—"}</span>}
              {cell.entry?.trades ? <span className="day-n">{cell.entry.trades}</span> : null}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="calendar-day-panel">
          <div className="panel-head">
            <span>{selected.date}</span>
            <span className="muted">{selected.orders} orders · CF {signed(selected.cashflow)}</span>
          </div>
          <div className="calendar-day-stats">
            <div><span>Round-trip PnL</span><b className={selected.pnl >= 0 ? "positive" : "negative"}>{signed(selected.pnl)}</b></div>
            <div><span>Closes</span><b>{format.number(selected.trades)}</b></div>
            <div><span>Wins</span><b className="positive">{format.number(selected.wins)}</b></div>
            <div><span>Losses</span><b className="negative">{format.number(selected.losses)}</b></div>
          </div>
          {selected.closes.length === 0 ? (
            <div className="terminal-empty compact">No matched round-trip closes this day.</div>
          ) : (
            <div className="mini-table calendar-trades">
              <div className="mini-row head">
                <span>Time</span><span>Contract</span><span>Hold</span><span>PnL</span>
              </div>
              {selected.closes.map((trade, i) => (
                <div className="mini-row" key={`${trade.contract}-${trade.closedAt}-${i}`}>
                  <span>{format.dateTime(trade.closedAt, { hour: "2-digit", minute: "2-digit" })}</span>
                  <b>{trade.contract}</b>
                  <span>{trade.holdHours < 24 ? `${trade.holdHours.toFixed(1)}h` : `${(trade.holdHours / 24).toFixed(1)}d`}</span>
                  <span className={trade.pnl >= 0 ? "positive" : "negative"}>{signed(trade.pnl)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
