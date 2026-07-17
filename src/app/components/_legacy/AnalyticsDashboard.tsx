"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AnalyticsBundle } from "@/lib/analytics";
import { useFormat } from "@/app/components/useFormat";
import { useI18n } from "@/locales/client";

const METRICS = [
  { id: "realizedPnl", label: "Realized PnL" },
  { id: "winRate", label: "Win rate" },
  { id: "profitFactor", label: "Profit factor" },
  { id: "expectancy", label: "Expectancy" },
  { id: "tradeCount", label: "Closes" },
  { id: "linkedFillRate", label: "Plan-linked" },
] as const;

type MetricId = (typeof METRICS)[number]["id"];

function abbreviateMoney(n: number, hidden = false) {
  if (hidden) return "••••";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatShortDate(iso: string) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function EquityCurve({
  points,
  formatMoney,
  moneyHidden = false,
}: {
  points: Array<{ t: string; pnl: number }>;
  formatMoney: (n: number) => string;
  moneyHidden?: boolean;
}) {
  const gradId = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 720, h: 280 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(320, Math.floor(entry.contentRect.width));
      const h = w < 560 ? 220 : 280;
      setSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!points.length) {
    return <div className="spark-empty">No closed trades yet — sync fills or import history to build the curve.</div>;
  }

  const { w, h } = size;
  const pad = { top: 18, right: 18, bottom: 36, left: 52 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const values = points.map((p) => p.pnl);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const xAt = (i: number) => pad.left + (i / Math.max(values.length - 1, 1)) * innerW;
  const yAt = (v: number) => pad.top + innerH - ((v - min) / span) * innerH;
  const coords = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
  const zeroY = yAt(0);
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `${coords[0].x},${zeroY} ${line} ${coords[coords.length - 1].x},${zeroY}`;
  const latest = values[values.length - 1];
  const up = latest >= 0;
  const stroke = up ? "#34d399" : "#f87171";
  const fill = up ? `url(#eq-up-${gradId})` : `url(#eq-dn-${gradId})`;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + (span * i) / ticks);

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * w;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = Math.abs(coords[i].x - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  };

  const active = hover != null ? points[hover] : points[points.length - 1];
  const activeCoord = hover != null ? coords[hover] : coords[coords.length - 1];

  return (
    <div className="equity-chart" ref={wrapRef}>
      <div className="equity-chart-meta">
        <div>
          <span>Cumulative realized</span>
          <b className={active.pnl >= 0 ? "positive" : "negative"}>{formatMoney(active.pnl)}</b>
        </div>
        <time>{formatShortDate(active.t)}</time>
      </div>
      <svg
        className="equity-svg"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Realized PnL equity curve"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`eq-up-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`eq-dn-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f87171" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={y}
                y2={y}
                className="equity-grid"
                strokeDasharray={Math.abs(tick) < 1e-9 ? "0" : "3 5"}
                opacity={Math.abs(tick) < 1e-9 ? 0.45 : 0.22}
              />
              <text x={pad.left - 10} y={y + 4} textAnchor="end" className="equity-axis">
                {abbreviateMoney(tick, moneyHidden)}
              </text>
            </g>
          );
        })}

        <polygon points={area} fill={fill} />
        <polyline
          points={line}
          fill="none"
          stroke={stroke}
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {hover != null && (
          <>
            <line
              x1={activeCoord.x}
              x2={activeCoord.x}
              y1={pad.top}
              y2={h - pad.bottom}
              className="equity-crosshair"
            />
            <circle cx={activeCoord.x} cy={activeCoord.y} r="4.5" fill={stroke} stroke="#09090b" strokeWidth="2" />
          </>
        )}

        <text x={pad.left} y={h - 12} className="equity-axis" textAnchor="start">
          {formatShortDate(points[0].t)}
        </text>
        <text x={w - pad.right} y={h - 12} className="equity-axis" textAnchor="end">
          {formatShortDate(points[points.length - 1].t)}
        </text>
      </svg>
    </div>
  );
}

function SplitBarChart({
  rows,
  labelKey,
  valueKey,
  formatMoney,
  empty = "No data",
}: {
  rows: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  formatMoney: (n: number) => string;
  empty?: string;
}) {
  if (!rows.length) return <div className="spark-empty">{empty}</div>;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(Number(r[valueKey]))), 1);

  return (
    <div className="split-bars">
      {rows.map((row) => {
        const value = Number(row[valueKey]);
        const pct = (Math.abs(value) / maxAbs) * 50;
        return (
          <div className="split-bar-row" key={String(row[labelKey])}>
            <span className="split-bar-label">{String(row[labelKey])}</span>
            <div className="split-bar-track" aria-hidden="true">
              <div className="split-bar-half left">
                {value < 0 ? <i className="neg" style={{ width: `${pct * 2}%` }} /> : null}
              </div>
              <div className="split-bar-zero" />
              <div className="split-bar-half right">
                {value >= 0 ? <i className="pos" style={{ width: `${pct * 2}%` }} /> : null}
              </div>
            </div>
            <b className={value >= 0 ? "positive" : "negative"}>{formatMoney(value)}</b>
          </div>
        );
      })}
    </div>
  );
}

function metricValue(
  data: AnalyticsBundle,
  id: MetricId,
  format: {
    currency: (n: number | null | undefined) => string;
    percent: (n: number | null | undefined) => string;
    number: (n: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  },
) {
  const m = data.metrics;
  switch (id) {
    case "realizedPnl":
      return { value: format.currency(m.realizedPnl), tone: m.realizedPnl >= 0 ? "positive" : "negative" };
    case "winRate":
      return { value: format.percent(m.winRate), tone: "" };
    case "profitFactor":
      return {
        value: m.profitFactor == null ? "—" : !Number.isFinite(m.profitFactor) ? "∞" : format.number(m.profitFactor, { maximumFractionDigits: 2, minimumFractionDigits: 2 }),
        tone: "",
      };
    case "expectancy":
      return { value: format.currency(m.expectancy), tone: (m.expectancy ?? 0) >= 0 ? "positive" : "negative" };
    case "tradeCount":
      return { value: format.number(m.tradeCount), tone: "" };
    case "linkedFillRate":
      return { value: format.percent(m.linkedFillRate), tone: "" };
  }
}

export default function AnalyticsDashboard() {
  const format = useFormat();
  const t = useI18n();
  const [data, setData] = useState<AnalyticsBundle | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/analytics?since=2026-01-01");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed");
      setData(body as AnalyticsBundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const money = format.currency;

  const summary = useMemo(() => {
    if (!data) return null;
    return METRICS.map((meta) => ({ ...meta, ...metricValue(data, meta.id, format) }));
  }, [data, format]);

  return (
    <section className="analytics-shell">
      <div className="analytics-toolbar">
        <div>
          <strong>{t("analytics.title")}</strong>
          <small>
            {busy ? t("common.loading") : data ? `Updated ${format.dateTime(data.generatedAt, { timeStyle: "medium" })}` : "—"}
            {data?.equity != null ? ` · ${t("analytics.equity")} ${format.currency(data.equity)}` : ""}
            {" · since Jan 2026"}
          </small>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void refresh()} disabled={busy}>
          {t("common.refresh")}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && summary && (
        <div className="analytics-stage">
          <div className="perf-strip" role="list">
            {summary.map((item) => (
              <div className="perf-metric" role="listitem" key={item.id}>
                <span>{item.label}</span>
                <b className={item.tone}>{item.value}</b>
              </div>
            ))}
          </div>

          <div className="analytics-main">
            <EquityCurve points={data.equityCurve} formatMoney={money} moneyHidden={format.moneyHidden} />
            <p className="widget-foot">
              FIFO closes · {format.number(data.metrics.tradeCount)} trades · {format.number(data.metrics.openLots)} open lots
            </p>
          </div>

          <div className="analytics-breakdown">
            <article>
              <header>Weekday</header>
              <SplitBarChart
                rows={data.weekdayPnl as unknown as Array<Record<string, string | number>>}
                labelKey="day"
                valueKey="pnl"
                formatMoney={money}
              />
            </article>
            <article>
              <header>By ticker</header>
              <SplitBarChart
                rows={data.byTicker as unknown as Array<Record<string, string | number>>}
                labelKey="ticker"
                valueKey="pnl"
                formatMoney={money}
              />
            </article>
            <article>
              <header>By side</header>
              <SplitBarChart
                rows={data.bySide as unknown as Array<Record<string, string | number>>}
                labelKey="side"
                valueKey="pnl"
                formatMoney={money}
              />
            </article>
          </div>

          <div className="analytics-lower">
            <article>
              <header>Patterns</header>
              <ul className="pattern-list">
                {data.patterns.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <div className="widget-foot">Trade PnL deciles</div>
              <SplitBarChart
                rows={data.deciles.map((d) => ({ day: d.label, pnl: d.avgPnl })) as unknown as Array<Record<string, string | number>>}
                labelKey="day"
                valueKey="pnl"
                formatMoney={money}
              />
            </article>
            <article>
              <header>Recent closes</header>
              <div className="mini-table">
                <div className="mini-row head">
                  <span>Closed</span><span>Ticker</span><span>Side</span><span>Qty</span><span>Entry</span><span>Exit</span><span>PnL</span>
                </div>
                {data.recentTrades.length ? data.recentTrades.map((trade, index) => (
                  <div className="mini-row" key={`${trade.ticker}-${trade.closedAt}-${index}`}>
                    <span>{format.dateTime(trade.closedAt)}</span>
                    <b>{trade.ticker}</b>
                    <span>{trade.side}</span>
                    <span>{format.number(trade.qty)}</span>
                    <span>{money(trade.entryPrice)}</span>
                    <span>{money(trade.exitPrice)}</span>
                    <span className={trade.pnl >= 0 ? "positive" : "negative"}>{money(trade.pnl)}</span>
                  </div>
                )) : <div className="spark-empty">No closes yet</div>}
              </div>
            </article>
          </div>
        </div>
      )}
    </section>
  );
}
