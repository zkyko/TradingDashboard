"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { money, pnlClass, tiltLabel } from "@/lib/review/format";
import { localePath } from "@/lib/locale";
import type { CalendarIndexFile, DaySummary, MetricsForwardFile, SizingFile, WeekReviewFile, WeeksIndexFile } from "@/lib/review/types";
import type { GoalPlan } from "@/lib/review/goal";
import type { EdgeProfile } from "@/lib/review/edge";
import SizingCard from "@/app/components/SizingCard";
import GoalProgress from "@/app/components/GoalProgress";
import EdgeProfileCard from "@/app/components/EdgeProfile";
import { ForwardMetricsBoard } from "@/app/components/MetricsBoard";
import DashHeader, { StatCard } from "@/app/components/DashHeader";

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
  goal,
  edge,
}: {
  calendar: CalendarIndexFile;
  weeks: WeeksIndexFile;
  currentWeek: WeekReviewFile | null;
  locale: string;
  sizing: SizingFile;
  forward: MetricsForwardFile;
  goal: GoalPlan;
  edge: EdgeProfile;
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

  const soxl = edge.soxl;
  const weekPnl = currentWeek?.realizedPnl ?? 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <DashHeader
        title="Dashboard"
        subtitle="PnL heat-map, hold-time edge, and the $100k path — synced from Robinhood."
        actions={
          <>
            {currentWeek ? (
              <Link href={localePath(locale, `/history/${currentWeek.id}`)} className="btn btn-primary btn-sm">
                Open {currentWeek.id}
              </Link>
            ) : null}
            <Link href={localePath(locale, "/growth")} className="btn btn-ghost btn-sm border border-base-300">
              Growth
            </Link>
            <Link href={localePath(locale, "/history")} className="btn btn-ghost btn-sm border border-base-300">
              Weeks
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Equity"
          value={money(goal.equity, 0).replace(/^[+−]/, "")}
          hint={`${goal.progressPct.toFixed(2)}% of $100k`}
          tone="primary"
        />
        <StatCard
          label="This week"
          value={<span className={pnlClass(weekPnl)}>{money(weekPnl, 0)}</span>}
          hint={
            currentWeek
              ? `${currentWeek.tradeCount} closes · ${tiltLabel(currentWeek.tilt.state)}`
              : "No week loaded"
          }
          tone={weekPnl >= 0 ? "success" : "error"}
        />
        <StatCard
          label="SOXL expectancy"
          value={
            soxl ? (
              <span className={pnlClass(soxl.expectancy)}>{money(soxl.expectancy, 2)}</span>
            ) : (
              "—"
            )
          }
          hint={soxl ? `${soxl.n} closes · WR ${soxl.winPct.toFixed(0)}%` : "Need SOXL sample"}
          tone={soxl && soxl.expectancy >= 0 ? "success" : "warning"}
        />
        <StatCard
          label="Month"
          value={<span className={pnlClass(month.realizedPnl)}>{money(month.realizedPnl, 0)}</span>}
          hint={`${month.tradeCount} closes · ${monthLabel(month.month)}`}
          tone={month.realizedPnl >= 0 ? "success" : "error"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <section className="card bg-base-200 border border-base-300 shadow-sm xl:col-span-3">
          <div className="card-body gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold tracking-tight">Trading calendar</h3>
                <p className="text-xs opacity-50">Daily realized heat-map</p>
              </div>
              <div className="join">
                <button
                  type="button"
                  className="btn btn-sm join-item"
                  disabled={!older}
                  onClick={() => older && setActiveMonth(older)}
                >
                  ←
                </button>
                <span className="btn btn-sm join-item no-animation pointer-events-none font-semibold">
                  {monthLabel(month.month)}
                </span>
                <button
                  type="button"
                  className="btn btn-sm join-item"
                  disabled={!newer}
                  onClick={() => newer && setActiveMonth(newer)}
                >
                  →
                </button>
              </div>
            </div>

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
                      <em className="opacity-40">—</em>
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
          </div>
        </section>

        <section className="card bg-base-200 border border-base-300 shadow-sm xl:col-span-2">
          <div className="card-body gap-3 p-4 sm:p-5">
            <div>
              <h3 className="font-bold tracking-tight">Offer health → process</h3>
              <p className="text-xs opacity-50">Gates and edge band from your tape</p>
            </div>
            <div className="space-y-3">
              {(edge.verdict
                ? [
                    { label: "Strength", value: 78, color: "progress-success" },
                    { label: "Hold band", value: soxl && soxl.expectancy > 0 ? 72 : 35, color: "progress-info" },
                    { label: "Leak control", value: edge.nonSoxl && edge.nonSoxl.pnl < 0 ? 28 : 70, color: "progress-warning" },
                    { label: "Sizing gates", value: Math.round((sizing.gatesPassed / Math.max(1, sizing.gates.length)) * 100), color: sizing.gatesPassed === sizing.gates.length ? "progress-success" : "progress-error" },
                  ]
                : []
              ).map((row) => (
                <div key={row.label}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="opacity-70">{row.label}</span>
                    <span className="font-semibold">{row.value}%</span>
                  </div>
                  <progress className={`progress ${row.color} w-full`} value={row.value} max={100} />
                </div>
              ))}
            </div>
            <ul className="mt-1 space-y-2 text-sm">
              <li className="rounded-lg bg-base-100 border border-base-300 px-3 py-2">{edge.verdict.strength}</li>
              <li className="rounded-lg bg-base-100 border border-base-300 px-3 py-2">{edge.verdict.rule}</li>
            </ul>
          </div>
        </section>
      </div>

      <GoalProgress goal={goal} />

      <div className="grid gap-4 xl:grid-cols-2">
        <SizingCard sizing={sizing} />
        <EdgeProfileCard edge={edge} />
      </div>

      <ForwardMetricsBoard forward={forward} />

      <section className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold tracking-tight">Recent week activity</h3>
              <p className="text-xs opacity-50">Archive of weekly reviews</p>
            </div>
            <Link href={localePath(locale, "/history")} className="btn btn-ghost btn-xs">
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Closes</th>
                  <th>WR</th>
                  <th>PF</th>
                  <th>R:R</th>
                  <th className="text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {weeks.weeks.slice(0, 10).map((w) => (
                  <tr key={w.id} className="hover">
                    <td>
                      <Link href={localePath(locale, `/history/${w.id}`)} className="link link-hover font-semibold">
                        {w.id}
                      </Link>
                      {w.hasNotes ? <span className="badge badge-ghost badge-xs ml-2">notes</span> : null}
                    </td>
                    <td>{w.tradeCount ?? "—"}</td>
                    <td>{w.winPct != null ? `${w.winPct.toFixed(0)}%` : "—"}</td>
                    <td>{w.profitFactor != null ? w.profitFactor.toFixed(2) : "—"}</td>
                    <td>{w.rewardRisk != null ? w.rewardRisk.toFixed(2) : "—"}</td>
                    <td className={`text-right font-semibold ${pnlClass(w.realizedPnl)}`}>
                      {money(w.realizedPnl, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
