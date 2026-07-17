import { money, pnlClass } from "@/lib/review/format";
import type { MetricsForwardFile, TradeMetrics } from "@/lib/review/types";

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtRatio(n: number | null | undefined, infinite?: boolean, digits = 2) {
  if (infinite) return "∞";
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function Meter({
  label,
  value,
  display,
  max = 1,
  goodHigh = true,
  tone,
}: {
  label: string;
  value: number | null;
  display: string;
  max?: number;
  goodHigh?: boolean;
  tone?: "pos" | "neg" | "neutral";
}) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const cls =
    tone === "pos" ? "pos" : tone === "neg" ? "neg" : goodHigh ? (v >= 0.5 ? "pos" : "warn") : "neutral";
  return (
    <div className="metric-meter">
      <div className="metric-meter-top">
        <span>{label}</span>
        <strong className={tone === "pos" ? "pnl-pos" : tone === "neg" ? "pnl-neg" : undefined}>
          {display}
        </strong>
      </div>
      <div className="metric-meter-bar" aria-hidden="true">
        <i className={cls} style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  );
}

export function MetricsGrid({
  metrics,
  title = "Metrics",
  subtitle,
}: {
  metrics: TradeMetrics;
  title?: string;
  subtitle?: string;
}) {
  const pfDisplay = metrics.profitFactorInfinite
    ? "∞"
    : fmtRatio(metrics.profitFactor);
  const pfTone =
    metrics.profitFactorInfinite || (metrics.profitFactor != null && metrics.profitFactor >= 1.5)
      ? "pos"
      : metrics.profitFactor != null && metrics.profitFactor < 1
        ? "neg"
        : "neutral";

  return (
    <section className="review-panel metrics-panel">
      <h2>{title}</h2>
      {subtitle ? <p className="score-meta">{subtitle}</p> : null}
      <div className="metrics-stat-grid">
        <div className="metrics-stat">
          <span>Win rate</span>
          <strong>{fmtPct(metrics.winPct)}</strong>
          <em>
            {metrics.winCount}W / {metrics.lossCount}L · {metrics.tradeCount} closes
          </em>
        </div>
        <div className="metrics-stat">
          <span>Profit factor</span>
          <strong className={pfTone === "pos" ? "pnl-pos" : pfTone === "neg" ? "pnl-neg" : undefined}>
            {pfDisplay}
          </strong>
          <em>
            +{money(metrics.grossWin, 0).replace("+", "")} /{" "}
            {money(Math.abs(metrics.grossLoss), 0).replace("+", "")} loss
          </em>
        </div>
        <div className="metrics-stat">
          <span>R:R (avg)</span>
          <strong>{fmtRatio(metrics.rewardRisk)} : 1</strong>
          <em>
            avg W {metrics.avgWin == null ? "—" : money(metrics.avgWin, 0)} · avg L{" "}
            {metrics.avgLoss == null ? "—" : money(metrics.avgLoss, 0)}
          </em>
        </div>
        <div className="metrics-stat">
          <span>Expectancy</span>
          <strong className={pnlClass(metrics.expectancy ?? 0)}>
            {metrics.expectancy == null ? "—" : money(metrics.expectancy, 2)}
          </strong>
          <em>per close</em>
        </div>
        <div className="metrics-stat">
          <span>Best / worst</span>
          <strong>
            <span className="pnl-pos">{metrics.bestTrade == null ? "—" : money(metrics.bestTrade, 0)}</span>
            {" / "}
            <span className="pnl-neg">{metrics.worstTrade == null ? "—" : money(metrics.worstTrade, 0)}</span>
          </strong>
          <em>avg hold {metrics.avgHoldMinutes == null ? "—" : `${metrics.avgHoldMinutes.toFixed(0)}m`}</em>
        </div>
        <div className="metrics-stat">
          <span>Net</span>
          <strong className={pnlClass(metrics.realizedPnl)}>{money(metrics.realizedPnl, 0)}</strong>
          <em>realized</em>
        </div>
      </div>

      <div className="metrics-meters">
        <Meter
          label="Win %"
          value={metrics.winRate}
          display={fmtPct(metrics.winPct)}
          max={1}
        />
        <Meter
          label="Profit factor"
          value={
            metrics.profitFactorInfinite
              ? 1
              : metrics.profitFactor == null
                ? null
                : Math.min(metrics.profitFactor / 3, 1)
          }
          display={pfDisplay}
          max={1}
          tone={pfTone}
        />
        <Meter
          label="R:R"
          value={metrics.rewardRisk == null ? null : Math.min(metrics.rewardRisk / 3, 1)}
          display={`${fmtRatio(metrics.rewardRisk)}x`}
          max={1}
          tone={
            metrics.rewardRisk != null && metrics.rewardRisk >= 1.2
              ? "pos"
              : metrics.rewardRisk != null && metrics.rewardRisk < 1
                ? "neg"
                : "neutral"
          }
        />
      </div>

      {metrics.equityCurve && metrics.equityCurve.length > 1 ? (
        <WeekSpark curve={metrics.equityCurve} />
      ) : null}
    </section>
  );
}

function WeekSpark({ curve }: { curve: Array<{ t: string; pnl: number }> }) {
  const w = 640;
  const h = 72;
  const pad = 6;
  const vals = curve.map((c) => c.pnl);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const pts = curve
    .map((c, i) => {
      const x = pad + (i / Math.max(1, curve.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (c.pnl - min) / (max - min || 1)) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const end = vals[vals.length - 1] ?? 0;
  return (
    <div className="metrics-spark">
      <span className="score-label">Trade equity (week)</span>
      <svg viewBox={`0 0 ${w} ${h}`} className={`metrics-spark-svg ${end >= 0 ? "pos" : "neg"}`} aria-hidden>
        <path d={pts} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

export function ForwardMetricsBoard({ forward }: { forward: MetricsForwardFile }) {
  if (!forward.weeks.length) return null;
  const maxAbs = Math.max(1, ...forward.weeks.map((w) => Math.abs(w.realizedPnl)));
  const cumMax = Math.max(1, ...forward.weeks.map((w) => Math.abs(w.cumulativePnl)), 1);

  return (
    <section className="review-panel metrics-forward">
      <h2>From {forward.fromWeek} forward</h2>
      <p className="score-meta">{forward.note || "Weekly metrics stack here as weeks complete."}</p>

      <MetricsGrid
        metrics={forward.cumulative}
        title="Cumulative (this week →)"
        subtitle={`${forward.weeks.length} week(s) in window`}
      />

      <div className="forward-bars">
        {forward.weeks.map((w) => (
          <div key={w.id} className="forward-bar-col" title={w.label}>
            <div
              className={`forward-bar ${w.realizedPnl >= 0 ? "pos" : "neg"}`}
              style={{ height: `${Math.max(6, (Math.abs(w.realizedPnl) / maxAbs) * 100)}%` }}
            />
            <span>{w.id.replace(/^\d{4}-/, "")}</span>
            <em className={pnlClass(w.realizedPnl)}>{money(w.realizedPnl, 0)}</em>
            <em className="muted">
              WR {w.winPct == null ? "—" : `${w.winPct.toFixed(0)}%`}
            </em>
            <em className="muted">PF {w.profitFactor == null ? "—" : w.profitFactor.toFixed(2)}</em>
            <em className="muted">R:R {w.rewardRisk == null ? "—" : w.rewardRisk.toFixed(2)}</em>
          </div>
        ))}
      </div>

      <div className="forward-cum">
        <span className="score-label">Cumulative PnL</span>
        <div className="forward-cum-track">
          {forward.weeks.map((w) => (
            <div
              key={w.id}
              className={`forward-cum-seg ${w.cumulativePnl >= 0 ? "pos" : "neg"}`}
              style={{ flex: Math.max(0.15, Math.abs(w.cumulativePnl) / cumMax) }}
              title={`${w.id}: ${money(w.cumulativePnl, 0)} cum`}
            />
          ))}
        </div>
        <strong className={pnlClass(forward.cumulative.realizedPnl)}>
          {money(forward.cumulative.realizedPnl, 0)}
        </strong>
      </div>

      <div className="forward-table-wrap">
        <table className="forward-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>PnL</th>
              <th>WR%</th>
              <th>PF</th>
              <th>R:R</th>
              <th>Exp</th>
              <th>n</th>
            </tr>
          </thead>
          <tbody>
            {[...forward.weeks].reverse().map((w) => (
              <tr key={w.id}>
                <td>{w.id}</td>
                <td className={pnlClass(w.realizedPnl)}>{money(w.realizedPnl, 0)}</td>
                <td>{w.winPct == null ? "—" : w.winPct.toFixed(1)}</td>
                <td>{w.profitFactor == null ? "—" : w.profitFactor.toFixed(2)}</td>
                <td>{w.rewardRisk == null ? "—" : w.rewardRisk.toFixed(2)}</td>
                <td className={pnlClass(w.expectancy ?? 0)}>
                  {w.expectancy == null ? "—" : money(w.expectancy, 2)}
                </td>
                <td>{w.tradeCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
