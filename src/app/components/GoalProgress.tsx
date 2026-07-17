import { money, pnlClass } from "@/lib/review/format";
import type { GoalPlan, GoalPath } from "@/lib/review/goal";

function PathCard({
  title,
  path,
  sampleLine,
  accent,
}: {
  title: string;
  path: GoalPath;
  sampleLine: string;
  accent?: boolean;
}) {
  return (
    <div className={`goal-path-card ${accent ? "accent" : ""} ${path.reachable ? "" : "blocked"}`}>
      <span className="score-label">{title}</span>
      <strong>
        {path.reachable && path.tradesNeeded != null ? `${path.tradesNeeded} trades` : "Not on path"}
      </strong>
      <em>
        avg {path.avgReturnPct >= 0 ? "+" : ""}
        {path.avgReturnPct.toFixed(3)}% equity / close
      </em>
      <em>
        {path.reachable && path.weeksAt5 != null
          ? `≈ ${path.weeksAt5} weeks @ 5 closes/wk`
          : path.note}
      </em>
      <em className="muted">{sampleLine}</em>
    </div>
  );
}

export default function GoalProgress({ goal }: { goal: GoalPlan }) {
  const pct = Math.max(0, Math.min(100, goal.progressPct));
  const milestoneMarks = [10, 25, 50, 75, 100];
  const s = goal.sample;
  const soxl = goal.soxlSample;

  return (
    <section className="review-panel goal-panel">
      <div className="goal-head">
        <div>
          <h2>$100k goal</h2>
          <p className="score-meta">
            {money(goal.equity, 0).replace(/^[+−]/, "")} now ·{" "}
            {money(goal.remaining, 0).replace(/^[+−]/, "")} to go ·{" "}
            {goal.multipleNeeded === Infinity ? "—" : `${goal.multipleNeeded.toFixed(1)}×`} from here
          </p>
        </div>
        <div className="goal-pct">
          <strong>{pct.toFixed(2)}%</strong>
          <span>of $100k</span>
        </div>
      </div>

      <div className="goal-bar-wrap" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="goal-bar-track">
          <div className="goal-bar-fill" style={{ width: `${pct}%` }} />
          {milestoneMarks.map((m) => (
            <i key={m} className="goal-mark" style={{ left: `${m}%` }} title={`${m}%`} />
          ))}
        </div>
        <div className="goal-bar-labels">
          <span>$0</span>
          <span>$25k</span>
          <span>$50k</span>
          <span>$75k</span>
          <span>$100k</span>
        </div>
      </div>

      <div className="goal-avg-strip">
        <div>
          <span className="score-label">Your avg close ({s.label})</span>
          <strong className={pnlClass(s.expectancy)}>{money(s.expectancy, 2)}</strong>
          <em>
            {s.tradeCount} trades · WR {s.winPct.toFixed(0)}% ·{" "}
            {s.avgReturnOnNotionalPct >= 0 ? "+" : ""}
            {s.avgReturnOnNotionalPct.toFixed(2)}% on notional ·{" "}
            {s.avgReturnOnEquityPct >= 0 ? "+" : ""}
            {s.avgReturnOnEquityPct.toFixed(3)}% of equity
          </em>
        </div>
        {soxl ? (
          <div>
            <span className="score-label">SOXL avg ({soxl.label})</span>
            <strong className={pnlClass(soxl.expectancy)}>{money(soxl.expectancy, 2)}</strong>
            <em>
              {soxl.tradeCount} trades · WR {soxl.winPct.toFixed(0)}% ·{" "}
              {soxl.avgReturnOnNotionalPct >= 0 ? "+" : ""}
              {soxl.avgReturnOnNotionalPct.toFixed(2)}% on notional ·{" "}
              {soxl.avgReturnOnEquityPct >= 0 ? "+" : ""}
              {soxl.avgReturnOnEquityPct.toFixed(3)}% of equity
            </em>
          </div>
        ) : null}
      </div>

      <div className={`goal-path-grid ${goal.pathSoxl ? "" : "single"}`}>
        <PathCard
          title="Path @ your all-trade avg"
          path={goal.pathAll}
          sampleLine={s.label}
        />
        {goal.pathSoxl && soxl ? (
          <PathCard
            title="Path @ your SOXL avg"
            path={goal.pathSoxl}
            sampleLine={soxl.label}
            accent
          />
        ) : null}
      </div>

      <p className="goal-footnote">
        Path uses your measured average $ expectancy ÷ equity (compounded). No assumed 2–3%.
        Notional % is what the trade itself returned on capital deployed.
      </p>
    </section>
  );
}
