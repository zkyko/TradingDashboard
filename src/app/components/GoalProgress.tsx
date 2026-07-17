import { money } from "@/lib/review/format";
import type { GoalPlan } from "@/lib/review/goal";

export default function GoalProgress({ goal }: { goal: GoalPlan }) {
  const pct = Math.max(0, Math.min(100, goal.progressPct));
  const milestoneMarks = [10, 25, 50, 75, 100];

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

      <div className="goal-path-grid">
        <div className="goal-path-card">
          <span className="score-label">At +2% / trade</span>
          <strong>{goal.tradesAt2pct} trades</strong>
          <em>≈ {goal.weeksAt5Trades2} weeks @ 5 closes/wk</em>
        </div>
        <div className="goal-path-card accent">
          <span className="score-label">At +2.5% / trade</span>
          <strong>{goal.tradesAt25pct} trades</strong>
          <em>mid of your 2–3% aim</em>
        </div>
        <div className="goal-path-card">
          <span className="score-label">At +3% / trade</span>
          <strong>{goal.tradesAt3pct} trades</strong>
          <em>≈ {goal.weeksAt5Trades3} weeks @ 5 closes/wk</em>
        </div>
      </div>

      <p className="goal-footnote">
        Model assumes compounded account growth of 2–3% per closed trade (not per share move).
        Your real path is expectancy × process — green weeks stick only if size stays inside the cap.
      </p>
    </section>
  );
}
