import Link from "next/link";
import { money, pnlClass } from "@/lib/review/format";
import { localePath } from "@/lib/locale";
import type { WeeksIndexFile } from "@/lib/review/types";

export default function HistoryView({
  weeks,
  locale,
}: {
  weeks: WeeksIndexFile;
  locale: string;
}) {
  return (
    <div className="review-page">
      <header className="review-hero">
        <p className="review-eyebrow">Archive</p>
        <h1>Past weeks</h1>
        <p className="review-lede">Lessons stack. Open a week to re-read the contract you made with yourself.</p>
      </header>

      {!weeks.weeks.length ? (
        <p className="muted">No weeks yet — run <code>npm run sync:agent</code>.</p>
      ) : (
        <ul className="history-list">
          {weeks.weeks.map((w) => (
            <li key={w.id}>
              <Link href={localePath(locale, `/history/${w.id}`)} className="history-card">
                <div>
                  <strong>{w.label || w.id}</strong>
                  <span className="muted">
                    {w.id}
                    {w.winPct != null ? ` · WR ${w.winPct.toFixed(0)}%` : ""}
                    {w.profitFactor != null ? ` · PF ${w.profitFactor.toFixed(2)}` : ""}
                    {w.rewardRisk != null ? ` · R:R ${w.rewardRisk.toFixed(2)}` : ""}
                  </span>
                </div>
                <strong className={pnlClass(w.realizedPnl)}>{money(w.realizedPnl, 0)}</strong>
                <p>{w.lesson || "No lesson written yet."}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
