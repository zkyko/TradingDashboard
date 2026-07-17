import Link from "next/link";
import { money, pnlClass } from "@/lib/review/format";
import { localePath } from "@/lib/locale";
import type { WeeksIndexFile } from "@/lib/review/types";
import DashHeader from "@/app/components/DashHeader";

export default function HistoryView({
  weeks,
  locale,
}: {
  weeks: WeeksIndexFile;
  locale: string;
}) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <DashHeader
        title="Weeks"
        subtitle="Weekly reviews with lessons and process notes."
      />

      {!weeks.weeks.length ? (
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body">
            <p className="opacity-60">
              No weeks yet — run <code className="font-mono text-xs">npm run sync:rh</code>.
            </p>
          </div>
        </div>
      ) : (
        <section className="card bg-base-200 border border-base-300 shadow-sm">
          <div className="card-body p-0 sm:p-0">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Lesson</th>
                    <th>WR</th>
                    <th>PF</th>
                    <th>R:R</th>
                    <th className="text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.weeks.map((w) => (
                    <tr key={w.id} className="hover">
                      <td>
                        <Link
                          href={localePath(locale, `/history/${w.id}`)}
                          className="link link-hover font-semibold"
                        >
                          {w.label || w.id}
                        </Link>
                        <div className="text-xs opacity-50">{w.id}</div>
                      </td>
                      <td className="max-w-md text-sm opacity-80">
                        {w.lesson || "No lesson written yet."}
                      </td>
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
      )}
    </div>
  );
}
