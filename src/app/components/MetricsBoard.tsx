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

function toneClass(tone: "pos" | "neg" | "neutral") {
  if (tone === "pos") return "text-success";
  if (tone === "neg") return "text-error";
  return "";
}

function pfTone(metrics: TradeMetrics): "pos" | "neg" | "neutral" {
  if (metrics.profitFactorInfinite || (metrics.profitFactor != null && metrics.profitFactor >= 1.5)) return "pos";
  if (metrics.profitFactor != null && metrics.profitFactor < 1) return "neg";
  return "neutral";
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
  const pfDisplay = metrics.profitFactorInfinite ? "∞" : fmtRatio(metrics.profitFactor);
  const pf = pfTone(metrics);

  const winPct = metrics.winPct ?? 0;
  const pfNorm = metrics.profitFactorInfinite
    ? 100
    : Math.min(100, ((metrics.profitFactor ?? 0) / 3) * 100);
  const rrNorm = Math.min(100, ((metrics.rewardRisk ?? 0) / 3) * 100);

  return (
    <section className="card bg-base-200 border border-base-300 shadow-sm">
      <div className="card-body gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-bold tracking-tight">{title}</h3>
            {subtitle ? <p className="text-xs opacity-50">{subtitle}</p> : null}
          </div>
          <div className={`badge badge-lg font-bold ${metrics.realizedPnl >= 0 ? "badge-success" : "badge-error"}`}>
            Net {money(metrics.realizedPnl, 0)}
          </div>
        </div>

        <div className="stats stats-vertical lg:stats-horizontal w-full bg-base-100 border border-base-300 shadow-none">
          <div className="stat py-3">
            <div className="stat-title text-xs">Win rate</div>
            <div className="stat-value text-2xl">{fmtPct(metrics.winPct)}</div>
            <div className="stat-desc">
              {metrics.winCount}W / {metrics.lossCount}L · {metrics.tradeCount} closes
            </div>
          </div>
          <div className="stat py-3">
            <div className="stat-title text-xs">Profit factor</div>
            <div className={`stat-value text-2xl ${toneClass(pf)}`}>{pfDisplay}</div>
            <div className="stat-desc">
              +{money(metrics.grossWin, 0).replace("+", "")} / {money(Math.abs(metrics.grossLoss), 0).replace("+", "")} loss
            </div>
          </div>
          <div className="stat py-3">
            <div className="stat-title text-xs">R:R (avg)</div>
            <div className="stat-value text-2xl">{fmtRatio(metrics.rewardRisk)} : 1</div>
            <div className="stat-desc">
              avg W {metrics.avgWin == null ? "—" : money(metrics.avgWin, 0)} · avg L{" "}
              {metrics.avgLoss == null ? "—" : money(metrics.avgLoss, 0)}
            </div>
          </div>
          <div className="stat py-3">
            <div className="stat-title text-xs">Expectancy</div>
            <div className={`stat-value text-2xl ${pnlClass(metrics.expectancy ?? 0)}`}>
              {metrics.expectancy == null ? "—" : money(metrics.expectancy, 2)}
            </div>
            <div className="stat-desc">per close</div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-box border border-base-300 bg-base-100 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="opacity-60">Win %</span>
              <span className="font-bold">{fmtPct(metrics.winPct)}</span>
            </div>
            <progress
              className={`progress w-full h-2 ${winPct >= 50 ? "progress-success" : winPct >= 40 ? "progress-warning" : "progress-error"}`}
              value={winPct}
              max={100}
            />
            <p className="mt-2 text-[11px] opacity-50">Target ≥ 50% with positive R:R</p>
          </div>
          <div className="rounded-box border border-base-300 bg-base-100 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="opacity-60">Profit factor</span>
              <span className={`font-bold ${toneClass(pf)}`}>{pfDisplay}</span>
            </div>
            <progress
              className={`progress w-full h-2 ${pf === "pos" ? "progress-success" : pf === "neg" ? "progress-error" : "progress-warning"}`}
              value={pfNorm}
              max={100}
            />
            <p className="mt-2 text-[11px] opacity-50">Scale marks 0 → 3.0</p>
          </div>
          <div className="rounded-box border border-base-300 bg-base-100 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="opacity-60">R:R</span>
              <span className="font-bold">{fmtRatio(metrics.rewardRisk)}x</span>
            </div>
            <progress
              className={`progress w-full h-2 ${(metrics.rewardRisk ?? 0) >= 1.2 ? "progress-success" : (metrics.rewardRisk ?? 0) < 1 ? "progress-error" : "progress-warning"}`}
              value={rrNorm}
              max={100}
            />
            <p className="mt-2 text-[11px] opacity-50">
              Best {metrics.bestTrade == null ? "—" : money(metrics.bestTrade, 0)} · worst{" "}
              {metrics.worstTrade == null ? "—" : money(metrics.worstTrade, 0)}
            </p>
          </div>
        </div>

        {metrics.equityCurve && metrics.equityCurve.length > 1 ? (
          <WeekSpark curve={metrics.equityCurve} />
        ) : null}
      </div>
    </section>
  );
}

function WeekSpark({ curve }: { curve: Array<{ t: string; pnl: number }> }) {
  const w = 720;
  const h = 96;
  const padX = 8;
  const padY = 10;
  const vals = curve.map((c) => c.pnl);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const range = max - min || 1;
  const zeroY = padY + (1 - (0 - min) / range) * (h - padY * 2);
  const line = curve
    .map((c, i) => {
      const x = padX + (i / Math.max(1, curve.length - 1)) * (w - padX * 2);
      const y = padY + (1 - (c.pnl - min) / range) * (h - padY * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area =
    `${line} L${padX + (w - padX * 2)},${h - padY} L${padX},${h - padY} Z`;
  const end = vals[vals.length - 1] ?? 0;
  const stroke = end >= 0 ? "var(--color-success)" : "var(--color-error)";
  const fill = end >= 0 ? "color-mix(in oklab, var(--color-success) 22%, transparent)" : "color-mix(in oklab, var(--color-error) 22%, transparent)";

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide opacity-50">Equity curve</span>
        <span className={`text-xs font-bold ${pnlClass(end)}`}>{money(end, 0)} cum</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" role="img" aria-label="Cumulative equity curve">
        <line x1={padX} x2={w - padX} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
        <path d={area} fill={fill} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function WeeklyPnlChart({
  weeks,
}: {
  weeks: MetricsForwardFile["weeks"];
}) {
  if (!weeks.length) return null;
  const w = 640;
  const h = 200;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const maxAbs = Math.max(1, ...weeks.map((x) => Math.abs(x.realizedPnl)));
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const midY = padT + chartH / 2;
  const gap = 8;
  const barW = Math.max(10, (chartW - gap * (weeks.length - 1)) / weeks.length);

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-bold tracking-tight text-sm">Weekly realized</h4>
          <p className="text-[11px] opacity-50">Forward window by week</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48" role="img" aria-label="Weekly realized PnL bars">
        <line x1={padL} x2={w - padR} y1={midY} y2={midY} stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
        {weeks.map((wk, i) => {
          const x = padL + i * (barW + gap);
          const mag = (Math.abs(wk.realizedPnl) / maxAbs) * (chartH / 2 - 4);
          const y = wk.realizedPnl >= 0 ? midY - mag : midY;
          const fill =
            wk.realizedPnl >= 0
              ? "var(--color-success)"
              : "var(--color-error)";
          return (
            <g key={wk.id}>
              <rect x={x} y={y} width={barW} height={Math.max(3, mag)} rx="4" fill={fill} opacity="0.9" />
              <text
                x={x + barW / 2}
                y={h - 14}
                textAnchor="middle"
                className="fill-current"
                style={{ fontSize: 10, opacity: 0.55 }}
              >
                {wk.id.replace(/^\d{4}-/, "")}
              </text>
              <text
                x={x + barW / 2}
                y={wk.realizedPnl >= 0 ? y - 6 : y + mag + 12}
                textAnchor="middle"
                style={{ fontSize: 9, fontWeight: 700, fill }}
              >
                {money(wk.realizedPnl, 0)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ForwardMetricsBoard({ forward }: { forward: MetricsForwardFile }) {
  if (!forward.weeks.length) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-extrabold tracking-tight">From {forward.fromWeek} forward</h3>
          <p className="text-xs opacity-50">{forward.note || "Weekly metrics stack as weeks complete."}</p>
        </div>
      </div>

      <MetricsGrid
        metrics={forward.cumulative}
        title="Cumulative"
        subtitle={`${forward.weeks.length} week(s) in window`}
      />

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <WeeklyPnlChart weeks={forward.weeks} />
        </div>
        <div className="xl:col-span-2">
          <div className="card bg-base-200 border border-base-300 shadow-sm h-full">
            <div className="card-body gap-2 p-0">
              <div className="px-4 pt-4">
                <h4 className="font-bold tracking-tight text-sm">Week ledger</h4>
                <p className="text-[11px] opacity-50">WR · PF · R:R · expectancy</p>
              </div>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Week</th>
                      <th>PnL</th>
                      <th>WR</th>
                      <th>PF</th>
                      <th>R:R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...forward.weeks].reverse().map((w) => (
                      <tr key={w.id} className="hover">
                        <td className="font-semibold">{w.id.replace(/^\d{4}-/, "")}</td>
                        <td className={`font-semibold ${pnlClass(w.realizedPnl)}`}>{money(w.realizedPnl, 0)}</td>
                        <td>{w.winPct == null ? "—" : `${w.winPct.toFixed(0)}%`}</td>
                        <td>{w.profitFactor == null ? "—" : w.profitFactor.toFixed(2)}</td>
                        <td>{w.rewardRisk == null ? "—" : w.rewardRisk.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
