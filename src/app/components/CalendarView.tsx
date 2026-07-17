"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { money, pnlClass, tiltLabel } from "@/lib/review/format";
import { localePath } from "@/lib/locale";
import type { CalendarIndexFile, DaySummary, MetricsForwardFile, SizingFile, WeekReviewFile, WeeksIndexFile } from "@/lib/review/types";
import SizingCard from "@/app/components/SizingCard";
import { ForwardMetricsBoard } from "@/app/components/MetricsBoard";

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildMonthGrid(month: string, days: DaySummary[]) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const cells: Array<{ date: string | null; day: DaySummary | null }> = [];
  for (let i = 0; i < startPad; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    cells.push({ date, day: byDate.get(date) ?? null });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  return cells;
}

function heat(pnl: number, maxAbs: number) {
  if (!maxAbs || !pnl) return undefined;
  const intensity = Math.min(1, Math.abs(pnl) / maxAbs);
  const alpha = 0.14 + intensity * 0.4;
  return pnl >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
}

export default function CalendarView({
  calendar,
  weeks,
  currentWeek,
  locale,
  sizing,
  forward,
}: {
  calendar: CalendarIndexFile;
  weeks: WeeksIndexFile;
  currentWeek: WeekReviewFile | null;
  locale: string;
  sizing: SizingFile;
  forward: MetricsForwardFile;
}) {
  const months = calendar.months;
  const [activeMonth, setActiveMonth] = useState(
    () => months[0]?.month ?? new Date().toISOString().slice(0, 7),
  );

  const month = useMemo(() => {
    return (
      months.find((m) => m.month === activeMonth) ?? {
        month: activeMonth,
        days: [] as DaySummary[],
        realizedPnl: 0,
        tradeCount: 0,
      }
    );
  }, [months, activeMonth]);

  const maxAbs = Math.max(1, ...month.days.map((d) => Math.abs(d.realizedPnl)));
  const cells = buildMonthGrid(month.month, month.days);
  const monthIdx = months.findIndex((m) => m.month === month.month);
  const older = months[monthIdx + 1]?.month;
  const newer = monthIdx > 0 ? months[monthIdx - 1]?.month : undefined;

  return (
    <div className="review-page">
      <header className="review-hero">
        <p className="review-eyebrow">Calendar</p>
        <h1>Trading calendar</h1>
        <p className="review-lede">
          Daily PnL heat-map into saved day and week reviews. Every sync keeps history — weeks stack forever.
        </p>
      </header>

      {currentWeek ? (
        <section className="score-card score-main cal-current-week">
          <div>
            <span className="score-label">This week · {currentWeek.id}</span>
            <strong className={pnlClass(currentWeek.realizedPnl)}>
              {money(currentWeek.realizedPnl, 0)}
            </strong>
            <span className="score-meta">
              {currentWeek.tradeCount} closes · {tiltLabel(currentWeek.tilt.state)}
              {currentWeek.lesson ? ` · ${currentWeek.lesson}` : ""}
            </span>
          </div>
          <Link className="cal-week-link" href={localePath(locale, `/history/${currentWeek.id}`)}>
            Open week review →
          </Link>
        </section>
      ) : null}

      <SizingCard sizing={sizing} />

      <ForwardMetricsBoard forward={forward} />

      <section className="review-panel cal-panel">
        <div className="cal-month-nav">
          {older ? (
            <button type="button" className="cal-nav-btn" onClick={() => setActiveMonth(older)}>
              ← {monthLabel(older)}
            </button>
          ) : (
            <span />
          )}
          <h2>{monthLabel(month.month)}</h2>
          {newer ? (
            <button type="button" className="cal-nav-btn" onClick={() => setActiveMonth(newer)}>
              {monthLabel(newer)} →
            </button>
          ) : (
            <span />
          )}
        </div>
        <p className="score-meta">
          Month {money(month.realizedPnl, 0)} · {month.tradeCount} closes
        </p>

        <div className="cal-grid-head" aria-hidden="true">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((cell, i) => {
            if (!cell.date) return <div key={`e-${i}`} className="cal-cell empty" />;
            const pnl = cell.day?.realizedPnl ?? 0;
            const trades = cell.day?.tradeCount ?? 0;
            const has = Boolean(cell.day);
            const inner = (
              <>
                <span className="cal-date">{Number(cell.date.slice(-2))}</span>
                {has ? (
                  <>
                    <strong className={pnlClass(pnl)}>{money(pnl, 0)}</strong>
                    <em>
                      {trades} tx{cell.day?.hasNotes ? " · ★" : ""}
                    </em>
                  </>
                ) : (
                  <em className="muted">—</em>
                )}
              </>
            );
            return has ? (
              <Link
                key={cell.date}
                href={localePath(locale, `/day/${cell.date}`)}
                className="cal-cell"
                style={{ background: heat(pnl, maxAbs) }}
              >
                {inner}
              </Link>
            ) : (
              <div key={cell.date} className="cal-cell muted-cell">
                {inner}
              </div>
            );
          })}
        </div>
      </section>

      <section className="review-panel">
        <h2>Weekly reviews</h2>
        <ul className="history-list">
          {weeks.weeks.map((w) => (
            <li key={w.id}>
              <Link href={localePath(locale, `/history/${w.id}`)} className="history-card">
                <div>
                  <strong>{w.label || w.id}</strong>
                  <span className="muted">
                    {w.id}
                    {w.hasNotes ? " · notes saved" : ""}
                    {w.winPct != null ? ` · WR ${w.winPct.toFixed(0)}%` : ""}
                    {w.profitFactor != null ? ` · PF ${w.profitFactor.toFixed(2)}` : ""}
                    {w.rewardRisk != null ? ` · R:R ${w.rewardRisk.toFixed(2)}` : ""}
                  </span>
                </div>
                <strong className={pnlClass(w.realizedPnl)}>{money(w.realizedPnl, 0)}</strong>
                <p>{w.lesson || "Open to write keep / stop / improve."}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
