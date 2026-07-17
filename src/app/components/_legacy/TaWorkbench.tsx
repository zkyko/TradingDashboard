"use client";

import { useMemo } from "react";
import {
  computeIndicators,
  computeRiskMetrics,
  lastNumber,
  type OhlcvBar,
} from "@/lib/technicals";

type Panel = "price" | "volume" | "macd" | "rsi";

function seriesPath(
  values: Array<number | null>,
  xAt: (i: number) => number,
  yAt: (v: number) => number,
): string {
  const parts: string[] = [];
  let drawing = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) {
      drawing = false;
      continue;
    }
    const cmd = drawing ? "L" : "M";
    parts.push(`${cmd}${xAt(i)},${yAt(v)}`);
    drawing = true;
  }
  return parts.join(" ");
}

function yScale(values: number[], height: number, pad = 8) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
}

/** Multi-panel TA workbench — descriptive market math only. */
export default function TaWorkbench({ bars }: { bars: OhlcvBar[] }) {
  const model = useMemo(() => {
    if (bars.length < 2) return null;
    const indicators = computeIndicators(bars);
    const closes = bars.map((b) => b.close);
    const risk = computeRiskMetrics(closes);
    return { indicators, risk, closes };
  }, [bars]);

  if (!bars.length || !model) return <div className="spark-empty">No history</div>;

  const { indicators } = model;
  const w = 720;
  const panels: Array<{ id: Panel; h: number }> = [
    { id: "price", h: 200 },
    { id: "volume", h: 52 },
    { id: "macd", h: 72 },
    { id: "rsi", h: 64 },
  ];
  const gap = 10;
  const totalH = panels.reduce((s, p) => s + p.h, 0) + gap * (panels.length - 1);
  const n = bars.length;
  const xAt = (i: number) => (i / Math.max(n - 1, 1)) * (w - 16) + 8;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const priceVals = [
    ...closes,
    ...highs,
    ...lows,
    ...indicators.sma20.filter((v): v is number => v != null),
    ...indicators.sma50.filter((v): v is number => v != null),
    ...indicators.bbUpper.filter((v): v is number => v != null),
    ...indicators.bbLower.filter((v): v is number => v != null),
  ];
  const yPrice = yScale(priceVals, panels[0].h);
  const last = closes[closes.length - 1];
  const first = closes[0];
  const up = last >= first;
  const stroke = up ? "#22c55e" : "#ef4444";

  const vols = bars.map((b) => b.volume ?? 0);
  const maxVol = Math.max(...vols, 1);

  const macdVals = [
    ...indicators.macd.filter((v): v is number => v != null),
    ...indicators.macdSignal.filter((v): v is number => v != null),
    ...indicators.macdHist.filter((v): v is number => v != null),
    0,
  ];
  const yMacd = yScale(macdVals.length ? macdVals : [0], panels[2].h);

  const rsiVals = indicators.rsi.filter((v): v is number => v != null);
  const yRsi = yScale(rsiVals.length ? [...rsiVals, 30, 70] : [0, 100], panels[3].h);

  let yOffset = 0;
  const panelY: Record<Panel, number> = { price: 0, volume: 0, macd: 0, rsi: 0 };
  for (const p of panels) {
    panelY[p.id] = yOffset;
    yOffset += p.h + gap;
  }

  return (
    <div className="tech-chart ta-workbench">
      <svg viewBox={`0 0 ${w} ${totalH}`} role="img" aria-label="Technical analysis panels">
        <defs>
          <linearGradient id="taFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Price + MAs + Bollinger */}
        <g transform={`translate(0, ${panelY.price})`}>
          <text x="8" y="14" className="ta-label" fill="#71717a" fontSize="10">Price · SMA · BB</text>
          <path d={seriesPath(indicators.bbUpper, xAt, yPrice)} fill="none" stroke="#60a5fa" strokeWidth="1" opacity="0.45" />
          <path d={seriesPath(indicators.bbLower, xAt, yPrice)} fill="none" stroke="#60a5fa" strokeWidth="1" opacity="0.45" />
          <path d={seriesPath(indicators.bbMid, xAt, yPrice)} fill="none" stroke="#60a5fa" strokeWidth="1" opacity="0.25" />
          <path d={seriesPath(indicators.sma50, xAt, yPrice)} fill="none" stroke="#60a5fa" strokeWidth="1.3" strokeDasharray="4 3" />
          <path d={seriesPath(indicators.sma20, xAt, yPrice)} fill="none" stroke="#f59e0b" strokeWidth="1.3" strokeDasharray="4 3" />
          <path
            d={`M${xAt(0)},${panels[0].h - 4} ${closes.map((c, i) => `L${xAt(i)},${yPrice(c)}`).join(" ")} L${xAt(n - 1)},${panels[0].h - 4} Z`}
            fill="url(#taFill)"
          />
          <polyline
            points={closes.map((c, i) => `${xAt(i)},${yPrice(c)}`).join(" ")}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>

        {/* Volume */}
        <g transform={`translate(0, ${panelY.volume})`}>
          <text x="8" y="12" className="ta-label" fill="#71717a" fontSize="10">Volume</text>
          {vols.map((vol, i) => {
            const barW = Math.max(1.5, (w - 16) / n - 1);
            const h = (vol / maxVol) * (panels[1].h - 16);
            const prev = i === 0 ? closes[0] : closes[i - 1];
            const green = closes[i] >= prev;
            return (
              <rect
                key={i}
                x={xAt(i) - barW / 2}
                y={panels[1].h - h}
                width={barW}
                height={h}
                fill={green ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)"}
              />
            );
          })}
        </g>

        {/* MACD */}
        <g transform={`translate(0, ${panelY.macd})`}>
          <text x="8" y="12" className="ta-label" fill="#71717a" fontSize="10">MACD</text>
          <line x1={8} x2={w - 8} y1={yMacd(0)} y2={yMacd(0)} stroke="#3f3f46" strokeWidth="1" />
          {indicators.macdHist.map((v, i) => {
            if (v == null) return null;
            const barW = Math.max(1.5, (w - 16) / n - 1);
            const y0 = yMacd(0);
            const y1 = yMacd(v);
            return (
              <rect
                key={i}
                x={xAt(i) - barW / 2}
                y={Math.min(y0, y1)}
                width={barW}
                height={Math.max(1, Math.abs(y1 - y0))}
                fill={v >= 0 ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)"}
              />
            );
          })}
          <path d={seriesPath(indicators.macd, xAt, yMacd)} fill="none" stroke="#a78bfa" strokeWidth="1.4" />
          <path d={seriesPath(indicators.macdSignal, xAt, yMacd)} fill="none" stroke="#f472b6" strokeWidth="1.2" />
        </g>

        {/* RSI */}
        <g transform={`translate(0, ${panelY.rsi})`}>
          <text x="8" y="12" className="ta-label" fill="#71717a" fontSize="10">RSI 14</text>
          <line x1={8} x2={w - 8} y1={yRsi(70)} y2={yRsi(70)} stroke="#ef4444" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <line x1={8} x2={w - 8} y1={yRsi(30)} y2={yRsi(30)} stroke="#22c55e" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <path d={seriesPath(indicators.rsi, xAt, yRsi)} fill="none" stroke="#38bdf8" strokeWidth="1.6" />
        </g>
      </svg>
      <div className="tech-legend">
        <span><i style={{ background: stroke }} /> Price</span>
        <span><i style={{ background: "#f59e0b" }} /> SMA20</span>
        <span><i style={{ background: "#60a5fa" }} /> SMA50 / BB</span>
        <span><i style={{ background: "#a78bfa" }} /> MACD</span>
        <span><i style={{ background: "#38bdf8" }} /> RSI</span>
      </div>
      <p className="ta-disclaimer muted">Descriptive market math — not a recommendation.</p>
    </div>
  );
}

export function RiskStrip({ bars }: { bars: OhlcvBar[] }) {
  const risk = useMemo(() => {
    if (bars.length < 2) return null;
    return computeRiskMetrics(bars.map((b) => b.close));
  }, [bars]);

  if (!risk) return null;

  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const num = (v: number | null) => (v == null ? "—" : v.toFixed(2));

  return (
    <div className="risk-strip" aria-label="Risk metrics">
      <div><span>Total return</span><b className={(risk.totalReturn ?? 0) >= 0 ? "positive" : "negative"}>{pct(risk.totalReturn)}</b></div>
      <div><span>Ann. vol</span><b>{pct(risk.annVol)}</b></div>
      <div><span>Sharpe (252)</span><b>{num(risk.sharpe)}</b></div>
      <div><span>Max DD</span><b className="negative">{pct(risk.maxDrawdown)}</b></div>
    </div>
  );
}

export function useBarTechnicals(bars: OhlcvBar[]) {
  return useMemo(() => {
    if (!bars.length) return null;
    const indicators = computeIndicators(bars);
    const risk = computeRiskMetrics(bars.map((b) => b.close));
    const lastVol = bars[bars.length - 1]?.volume ?? null;
    const volAvg = lastNumber(indicators.volSma);
    return {
      indicators,
      risk,
      rsi: lastNumber(indicators.rsi),
      sma20: lastNumber(indicators.sma20),
      sma50: lastNumber(indicators.sma50),
      volAvg,
      volRatio: lastVol != null && volAvg ? lastVol / volAvg : null,
    };
  }, [bars]);
}
