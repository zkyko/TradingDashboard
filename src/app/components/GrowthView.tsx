"use client";

import { money, pct, pnlClass } from "@/lib/review/format";
import type { EquityFile, TradesFile, WeeksIndexFile } from "@/lib/review/types";
import type { GoalPlan } from "@/lib/review/goal";
import type { EdgeProfile } from "@/lib/review/edge";
import GoalProgress from "@/app/components/GoalProgress";
import EdgeProfileCard from "@/app/components/EdgeProfile";

function sparkPath(points: Array<{ x: number; y: number }>, w: number, h: number) {
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
  const path = sparkPath(points, w, h);

  const weekBars = [...weeks.weeks].slice(0, 12).reverse();
  const barMax = Math.max(1, ...weekBars.map((x) => Math.abs(x.realizedPnl)));

  return (
    <div className="review-page">
      <header className="review-hero">
        <p className="review-eyebrow">Account</p>
        <h1>Growth</h1>
        <p className="review-lede">Equity snapshots and weekly realized — the long arc, not the tick.</p>
      </header>

      <GoalProgress goal={goal} />

      <EdgeProfileCard edge={edge} />

      <section className="review-scoreboard">
        <div className="score-card score-main">
          <span className="score-label">Equity now</span>
          <strong>{money(end, 0).replace(/^[+−]/, "")}</strong>
          <span className={`score-meta ${pnlClass(change)}`}>
            {money(change, 0)} ({pct(changePct, 1)}) from first snapshot
          </span>
        </div>
        <div className="score-card">
          <span className="score-label">Max drawdown</span>
          <strong className={pnlClass(maxDd)}>{money(maxDd, 0)}</strong>
          <span className="score-meta">From peak in series</span>
        </div>
        <div className="score-card">
          <span className="score-label">Closed trades</span>
          <strong>{trades.trades.length}</strong>
          <span className="score-meta">{trades.openLots} open lots</span>
        </div>
      </section>

      <section className="review-panel">
        <h2>Equity curve</h2>
        {series.length < 2 ? (
          <p className="muted">Need more snapshots — run sync:agent after Robinhood pulls.</p>
        ) : (
          <svg className="growth-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Equity curve">
            <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="growth-line" />
          </svg>
        )}
        {equity.latest ? (
          <p className="score-meta">
            Last snapshot {new Date(equity.latest.t).toLocaleString()} · {money(equity.latest.equity, 2).replace(/^[+−]/, "")}
          </p>
        ) : null}
      </section>

      <section className="review-panel">
        <h2>Weekly realized</h2>
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
      </section>
    </div>
  );
}
