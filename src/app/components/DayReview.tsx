import Link from "next/link";
import { money, pnlClass, tiltLabel, tiltTone } from "@/lib/review/format";
import { localePath } from "@/lib/locale";
import type { DayReviewFile, TradeReview } from "@/lib/review/types";
import { MetricsGrid } from "@/app/components/MetricsBoard";

function gradeClass(g: string) {
  if (g === "A") return "grade-a";
  if (g === "C") return "grade-c";
  return "grade-b";
}

function TradeCard({ t }: { t: TradeReview }) {
  return (
    <article className={`trade-review ${gradeClass(t.grade)}`}>
      <header>
        <div>
          <strong>
            {t.ticker} · {t.qty % 1 ? t.qty.toFixed(2) : t.qty} sh
          </strong>
          <span className="muted">
            {t.entryPrice.toFixed(2)} → {t.exitPrice.toFixed(2)}
            {t.overnight ? " · overnight" : ""} · {t.holdMinutes.toFixed(0)}m
          </span>
        </div>
        <div className="trade-review-end">
          <span className={`grade-pill ${gradeClass(t.grade)}`}>Process {t.grade}</span>
          <strong className={pnlClass(t.pnl)}>{money(t.pnl, 0)}</strong>
        </div>
      </header>
      <p className="trade-review-body">{t.review}</p>
      <dl className="trade-review-meta">
        {t.whatWorked ? (
          <>
            <dt>Worked</dt>
            <dd>{t.whatWorked}</dd>
          </>
        ) : null}
        {t.whatFailed ? (
          <>
            <dt>Failed</dt>
            <dd>{t.whatFailed}</dd>
          </>
        ) : null}
        <dt>Next</dt>
        <dd>{t.nextTime}</dd>
      </dl>
    </article>
  );
}

export default function DayReview({
  day,
  locale,
}: {
  day: DayReviewFile;
  locale: string;
}) {
  const tone = tiltTone(day.tilt.state);
  const reviews = day.tradeReviews?.length
    ? day.tradeReviews
    : day.trades.map(
        (t) =>
          ({
            ...t,
            holdBucket: t.overnight ? "overnight" : t.holdMinutes <= 15 ? "sub_15m" : "session",
            grade: "B" as const,
            flags: [],
            movePts: Math.abs(t.exitPrice - t.entryPrice),
            notional: t.qty * t.entryPrice,
            review: "Re-run sync:agent to generate process reviews.",
            whatWorked: "",
            whatFailed: "",
            nextTime: "Sync reviews.",
          }) satisfies TradeReview,
      );
  const grades = day.processGrades ?? { A: 0, B: 0, C: 0 };

  return (
    <div className="review-page">
      <header className="review-hero">
        <p className="review-eyebrow">Daily review</p>
        <h1>{day.label}</h1>
        <p className="review-lede">
          <Link href={localePath(locale, `/history/${day.weekId}`)}>Week {day.weekId}</Link>
          {" · "}
          <Link href={localePath(locale, "/")}>Calendar</Link>
          {" · "}
          Process grades ignore P&L cheerleading — A/B/C is rule quality.
        </p>
      </header>

      <section className="review-scoreboard">
        <div className="score-card score-main">
          <span className="score-label">Day PnL</span>
          <strong className={pnlClass(day.realizedPnl)}>{money(day.realizedPnl, 0)}</strong>
          <span className="score-meta">
            {day.tradeCount} closes · {day.winCount}W / {day.lossCount}L
          </span>
        </div>
        <div className={`score-card tilt-card tilt-${tone}`}>
          <span className="score-label">State</span>
          <strong>{tiltLabel(day.tilt.state)}</strong>
          <ul className="tilt-reasons">
            {day.tilt.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div className="score-card">
          <span className="score-label">Process mix</span>
          <div className="streak-chips">
            <span className="chip grade-a">A ×{grades.A || 0}</span>
            <span className="chip grade-b">B ×{grades.B || 0}</span>
            <span className="chip grade-c">C ×{grades.C || 0}</span>
          </div>
          <span className="score-meta">Consistency &gt; single-day scoreboard</span>
        </div>
      </section>

      {day.metrics && day.metrics.tradeCount > 0 ? (
        <MetricsGrid
          metrics={day.metrics}
          title="Day metrics · all closes"
          subtitle="Win rate · profit factor · avg R:R · expectancy"
        />
      ) : null}

      <section className="review-panel">
        <h2>Trade reviews</h2>
        <div className="trade-review-list">
          {reviews.length === 0 ? (
            <p className="muted">No closes this day.</p>
          ) : (
            reviews.map((t, i) => (
              <TradeCard key={`${t.ticker}-${t.closedAt}-${i}`} t={t} />
            ))
          )}
        </div>
      </section>

      <section className="review-grid">
        <div className="review-panel">
          <h2>By ticker</h2>
          <ul className="ticker-list">
            {day.byTicker.length === 0 ? (
              <li className="muted">No closes</li>
            ) : (
              day.byTicker.map((t) => (
                <li key={t.ticker}>
                  <span className="ticker">{t.ticker}</span>
                  <span className={pnlClass(t.pnl)}>{money(t.pnl, 0)}</span>
                  <span className="muted">{t.trades}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>

      <section className="review-columns">
        <div className="review-col keep">
          <h2>Keep</h2>
          <ul>
            {(day.keep.length ? day.keep : ["Add via Cursor after the session"]).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="review-col stop">
          <h2>Stop</h2>
          <ul>
            {(day.stop.length ? day.stop : ["Add via Cursor after the session"]).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="review-col improve">
          <h2>Work on</h2>
          <ul>
            {(day.improve.length ? day.improve : ["Add via Cursor after the session"]).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>

      {(day.lesson || day.notes) && (
        <section className="review-panel lesson-panel">
          {day.lesson ? (
            <>
              <h2>Lesson</h2>
              <p className="lesson-text">{day.lesson}</p>
            </>
          ) : null}
          {day.notes ? (
            <>
              <h2>Notes</h2>
              <p className="lesson-text">{day.notes}</p>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
