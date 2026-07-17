import type { CSSProperties } from "react";
import { money, pnlClass, tiltLabel, tiltTone } from "@/lib/review/format";
import type { BehaviorFile, WeekReviewFile } from "@/lib/review/types";
import { MetricsGrid } from "@/app/components/MetricsBoard";

function heat(pnl: number, maxAbs: number): CSSProperties {
  if (!maxAbs || !pnl) return {};
  const intensity = Math.min(1, Math.abs(pnl) / maxAbs);
  const alpha = 0.12 + intensity * 0.35;
  return {
    background: pnl >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`,
  };
}

export default function WeekReview({
  week,
  behavior,
}: {
  week: WeekReviewFile;
  behavior: BehaviorFile;
}) {
  const delta =
    week.priorWeekPnl == null ? null : week.realizedPnl - week.priorWeekPnl;
  const maxAbs = Math.max(1, ...week.days.map((d) => Math.abs(d.pnl)));
  const tone = tiltTone(week.tilt.state);
  const metrics = week.metrics;

  return (
    <div className="review-page">
      <header className="review-hero">
        <p className="review-eyebrow">Weekly review</p>
        <h1>{week.label}</h1>
        <p className="review-lede">
          Realized tape + behavior flags. Keep / stop / improve are the contract for next week.
        </p>
      </header>

      <section className="review-scoreboard">
        <div className="score-card score-main">
          <span className="score-label">Week PnL</span>
          <strong className={pnlClass(week.realizedPnl)}>{money(week.realizedPnl, 0)}</strong>
          <span className="score-meta">
            {week.tradeCount} closes · {week.winCount}W / {week.lossCount}L
            {metrics?.winPct != null ? ` · WR ${metrics.winPct.toFixed(0)}%` : ""}
            {delta != null ? (
              <>
                {" · "}
                <span className={pnlClass(delta)}>
                  {money(delta, 0)} vs prior
                </span>
              </>
            ) : null}
          </span>
        </div>

        <div className={`score-card tilt-card tilt-${tone}`}>
          <span className="score-label">State</span>
          <strong>{tiltLabel(week.tilt.state)}</strong>
          <div className="tilt-meter" aria-hidden="true">
            <i style={{ width: `${Math.min(100, week.tilt.score)}%` }} />
          </div>
          <ul className="tilt-reasons">
            {week.tilt.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>

        <div className="score-card">
          <span className="score-label">Streaks</span>
          <div className="streak-chips">
            <span className={`chip chip-${week.streaks.current.type}`}>
              Now: {week.streaks.current.type} ×{week.streaks.current.length || 0}
            </span>
            <span className="chip">Best win ×{week.streaks.maxWin}</span>
            <span className="chip chip-loss">Worst loss ×{week.streaks.maxLoss}</span>
          </div>
          <span className="score-meta">
            Overnight (recent): {money(behavior.overnightPnl, 0)} · size flags{" "}
            {behavior.sizeEscalationFlags}
          </span>
        </div>
      </section>

      {metrics ? (
        <MetricsGrid
          metrics={metrics}
          title="Week metrics · all closes"
          subtitle="Win rate · profit factor · avg R:R · expectancy"
        />
      ) : null}
      {week.soxlMetrics && week.soxlMetrics.tradeCount > 0 ? (
        <MetricsGrid
          metrics={week.soxlMetrics}
          title="SOXL only"
          subtitle="Same week, semiconductor sleeve"
        />
      ) : null}
      <section className="review-grid">
        <div className="review-panel">
          <h2>Days</h2>
          <div className="day-heat">
            {week.days.map((d) => (
              <div key={d.date} className="day-cell" style={heat(d.pnl, maxAbs)}>
                <span>{d.label}</span>
                <strong className={pnlClass(d.pnl)}>{money(d.pnl, 0)}</strong>
                <em>{d.trades} tx</em>
              </div>
            ))}
          </div>
        </div>

        <div className="review-panel">
          <h2>By ticker</h2>
          <ul className="ticker-list">
            {week.byTicker.length === 0 ? (
              <li className="muted">No closes this week</li>
            ) : (
              week.byTicker.map((t) => (
                <li key={t.ticker}>
                  <span className="ticker">{t.ticker}</span>
                  <span className={pnlClass(t.pnl)}>{money(t.pnl, 0)}</span>
                  <span className="muted">
                    {t.trades} · {t.wins}W
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="review-panel">
          <h2>Hold buckets (recent)</h2>
          <ul className="bucket-list">
            {(
              [
                ["Overnight", behavior.holdBuckets.overnight],
                ["≤15m", behavior.holdBuckets.under15m],
                ["15–60m", behavior.holdBuckets.m15to60],
                [">60m", behavior.holdBuckets.over60m],
              ] as const
            ).map(([label, row]) => (
              <li key={label}>
                <span>{label}</span>
                <span className="muted">{row.n}</span>
                <span className={pnlClass(row.pnl)}>{money(row.pnl, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="review-columns">
        <div className="review-col keep">
          <h2>Keep doing</h2>
          <ul>
            {(week.keep.length ? week.keep : ["Add notes after sync"]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="review-col stop">
          <h2>Stop doing</h2>
          <ul>
            {(week.stop.length ? week.stop : ["Add notes after sync"]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="review-col improve">
          <h2>Work on</h2>
          <ul>
            {(week.improve.length ? week.improve : ["Add notes after sync"]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {(week.lesson || week.mistakes.length > 0) && (
        <section className="review-panel lesson-panel">
          {week.lesson ? (
            <>
              <h2>Lesson</h2>
              <p className="lesson-text">{week.lesson}</p>
            </>
          ) : null}
          {week.mistakes.length > 0 ? (
            <>
              <h2>Mistakes</h2>
              <ul>
                {week.mistakes.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          ) : null}
          {week.openNotes.length > 0 ? (
            <>
              <h2>Open</h2>
              <ul>
                {week.openNotes.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      )}

      <p className="review-footnote">
        Win rate this week:{" "}
        {week.metrics?.winPct != null
          ? `${week.metrics.winPct.toFixed(0)}%`
          : week.tradeCount
            ? `${((week.winCount / week.tradeCount) * 100).toFixed(0)}%`
            : "—"}
        {week.metrics?.profitFactor != null
          ? ` · PF ${week.metrics.profitFactor.toFixed(2)}`
          : ""}
        {week.metrics?.rewardRisk != null
          ? ` · R:R ${week.metrics.rewardRisk.toFixed(2)}`
          : ""}
        .
      </p>
    </div>
  );
}
