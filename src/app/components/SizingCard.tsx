"use client";

import { money, pnlClass } from "@/lib/review/format";
import type { SizingFile } from "@/lib/review/types";

export default function SizingCard({ sizing }: { sizing: SizingFile }) {
  if (!sizing.updatedAt) return null;
  const s = sizing.suggested;
  return (
    <section className="review-panel sizing-panel">
      <h2>Sizing · consistency first</h2>
      <p className={`sizing-headline ${s.sizeUpReady ? "ready" : "hold"}`}>{sizing.headline}</p>
      <div className="sizing-metrics">
        <div>
          <span className="score-label">Hold size</span>
          <strong>{s.holdShares} sh</strong>
        </div>
        <div>
          <span className="score-label">Consistency cap</span>
          <strong>{s.consistencyCapShares} sh</strong>
        </div>
        <div>
          <span className="score-label">If gates clear</span>
          <strong>{s.nextSharesIfReady} sh</strong>
        </div>
        <div>
          <span className="score-label">Gates</span>
          <strong>
            {sizing.gatesPassed}/{sizing.gates.length}
          </strong>
        </div>
      </div>
      <ul className="sizing-gates">
        {sizing.gates.map((g) => (
          <li key={g.id} className={g.pass ? "pass" : "fail"}>
            <span>{g.pass ? "PASS" : "FAIL"}</span>
            <div>
              <strong>{g.label}</strong>
              <em>{g.detail}</em>
            </div>
          </li>
        ))}
      </ul>
      <ul className="sizing-guidance">
        {sizing.guidance.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="score-meta">
        28d SOXL: {sizing.soxl28d.trades} closes · WR {(sizing.soxl28d.winRate * 100).toFixed(0)}% ·
        expectancy{" "}
        <span className={pnlClass(sizing.soxl28d.expectancy)}>
          {money(sizing.soxl28d.expectancy, 2)}
        </span>
        /trade · &gt;15m {money(sizing.soxl28d.over15.pnl, 0)} · ≤15m{" "}
        {money(sizing.soxl28d.under15.pnl, 0)}
      </p>
    </section>
  );
}
