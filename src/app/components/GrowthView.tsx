"use client";

import { money, pct, pnlClass } from "@/lib/review/format";
import type { EquityFile, TradesFile, WeeksIndexFile } from "@/lib/review/types";
import type { GoalPlan } from "@/lib/review/goal";
import type { EdgeProfile } from "@/lib/review/edge";
import GoalProgress from "@/app/components/GoalProgress";
import EdgeProfileCard from "@/app/components/EdgeProfile";
import DashHeader, { StatCard } from "@/app/components/DashHeader";

function sparkPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

export default function GrowthView({
  equity,
  trades,
  weeks,
  goal,
  edge,
}: {
  equity: EquityFile;
  trades: TradesFile;
  weeks: WeeksIndexFile;
  goal: GoalPlan;
  edge: EdgeProfile;
}) {
  const series = equity.series.length
    ? equity.series
    : trades.trades.reduce<Array<{ t: string; equity: number }>>((acc, t) => {
        const prev = acc.length ? acc[acc.length - 1].equity : 0;
        acc.push({ t: t.closedAt, equity: prev + t.pnl });
        return acc;
      }, []);

  const start = series[0]?.equity ?? 0;
  const end = series[series.length - 1]?.equity ?? equity.latest?.equity ?? 0;
  const change = end - start;
  const changePct = start ? (change / start) * 100 : 0;

  let peak = -Infinity;
  let maxDd = 0;
  for (const p of series) {
    peak = Math.max(peak, p.equity);
    maxDd = Math.min(maxDd, p.equity - peak);
  }

  const w = 640;
  const h = 180;
  const pad = 12;
  const xs = series.map((p) => p.equity);
  const min = Math.min(...xs, 0);
  const max = Math.max(...xs, 1);
  const points = series.map((p, i) => ({
    x: pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2),
    y: pad + (1 - (p.equity - min) / (max - min || 1)) * (h - pad * 2),
  }));
  const path = sparkPath(points);

  const weekBars = [...weeks.weeks].slice(0, 12).reverse();
  const barMax = Math.max(1, ...weekBars.map((x) => Math.abs(x.realizedPnl)));
  const soxl = edge.soxl;

  return (
    <div className="space-y-4 sm:space-y-5">
      <DashHeader
        title="Growth"
        subtitle="Equity path, drawdown, and measured averages toward $100k."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Equity now"
          value={money(end, 0).replace(/^[+−]/, "")}
          hint={
            <span className={pnlClass(change)}>
              {money(change, 0)} ({pct(changePct, 1)}) from start
            </span>
          }
          tone="primary"
        />
        <StatCard
          label="Max drawdown"
          value={<span className={pnlClass(maxDd)}>{money(maxDd, 0)}</span>}
          hint="From peak in series"
          tone="error"
        />
        <StatCard
          label="Closed trades"
          value={trades.trades.length}
          hint={`${trades.openLots} open lots`}
        />
        <StatCard
          label="SOXL sleeve"
          value={soxl ? <span className={pnlClass(soxl.pnl)}>{money(soxl.pnl, 0)}</span> : "—"}
          hint={soxl ? `${soxl.n} closes · med hold ${Math.round(soxl.medHoldMin)}m` : "—"}
          tone={soxl && soxl.pnl >= 0 ? "success" : "warning"}
        />
      </div>

      <GoalProgress goal={goal} />

      <div className="grid gap-4 xl:grid-cols-5">
        <section className="card bg-base-200 border border-base-300 shadow-sm xl:col-span-3">
          <div className="card-body gap-3 p-4 sm:p-5">
            <div>
              <h3 className="font-bold tracking-tight">Equity curve</h3>
              <p className="text-xs opacity-50">Account snapshots over time</p>
            </div>
            {series.length < 2 ? (
              <p className="text-sm opacity-60">Need more snapshots — run sync:rh.</p>
            ) : (
              <svg className="growth-chart w-full text-primary" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Equity curve">
                <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            )}
            {equity.latest ? (
              <p className="text-xs opacity-50">
                Last snapshot {new Date(equity.latest.t).toLocaleString()} ·{" "}
                {money(equity.latest.equity, 2).replace(/^[+−]/, "")}
              </p>
            ) : null}
          </div>
        </section>

        <section className="card bg-base-200 border border-base-300 shadow-sm xl:col-span-2">
          <div className="card-body gap-3 p-4 sm:p-5">
            <div>
              <h3 className="font-bold tracking-tight">Weekly realized</h3>
              <p className="text-xs opacity-50">Last 12 weeks</p>
            </div>
            <div className="week-bars">
              {weekBars.map((wk) => (
                <div key={wk.id} className="week-bar-col" title={wk.label}>
                  <div
                    className={`week-bar ${wk.realizedPnl >= 0 ? "pos" : "neg"}`}
                    style={{ height: `${Math.max(4, (Math.abs(wk.realizedPnl) / barMax) * 100)}%` }}
                  />
                  <span>{wk.id.replace(/^\d{4}-/, "")}</span>
                  <em className={pnlClass(wk.realizedPnl)}>{money(wk.realizedPnl, 0)}</em>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <EdgeProfileCard edge={edge} />
    </div>
  );
}
