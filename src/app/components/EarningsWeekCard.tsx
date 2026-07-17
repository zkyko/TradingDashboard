import type { EarningsWeekFile } from "@/lib/review/types";

const HEADLINE = new Set(["TSLA", "GOOGL", "IBM", "TXN", "INTC", "GM", "MMM", "SCHW", "AXP", "VZ", "T", "NOW"]);

function Chip({ ticker, name }: { ticker: string; name: string }) {
  const hot = HEADLINE.has(ticker);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
        hot ? "border-primary/40 bg-primary/10" : "border-base-300 bg-base-100"
      }`}
      title={name}
    >
      <span className="font-bold tracking-tight">{ticker}</span>
      <span className="opacity-50 hidden sm:inline">{name}</span>
    </span>
  );
}

export default function EarningsWeekCard({ earnings }: { earnings: EarningsWeekFile }) {
  if (!earnings.days.length) return null;

  return (
    <section className="card bg-base-200 border border-base-300 shadow-sm">
      <div className="card-body gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-bold tracking-tight text-lg">Earnings this week</h3>
            <p className="text-xs opacity-50">{earnings.label}</p>
          </div>
          <a
            href={earnings.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="link link-hover text-xs opacity-60"
          >
            {earnings.source} ↗
          </a>
        </div>

        <div className="grid gap-3 lg:grid-cols-5">
          {earnings.days.map((day) => (
            <div key={day.date} className="rounded-box border border-base-300 bg-base-100 p-3 flex flex-col gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide opacity-50">{day.weekday}</div>
                <div className="text-sm font-semibold tabular-nums">{day.date.slice(5)}</div>
              </div>

              <div>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-info/80">
                  Before open
                </div>
                {day.beforeOpen.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {day.beforeOpen.map((c) => (
                      <Chip key={c.ticker} ticker={c.ticker} name={c.name} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs opacity-40">—</p>
                )}
              </div>

              <div>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-warning/80">
                  After close
                </div>
                {day.afterClose.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {day.afterClose.map((c) => (
                      <Chip key={c.ticker} ticker={c.ticker} name={c.name} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs opacity-40">—</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] opacity-40">
          Macro tape context for SOXL/SOXS week — especially Wed AMC mega-cap (TSLA, GOOGL, TXN) and Thu INTC.
        </p>
      </div>
    </section>
  );
}
