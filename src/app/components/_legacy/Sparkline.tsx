"use client";

type Bar = { close: number; high?: number; low?: number; volume?: number; open?: number };

export default function Sparkline({
  points,
  width = 420,
  height = 120,
  positive = true,
}: {
  points: Bar[];
  width?: number;
  height?: number;
  positive?: boolean;
}) {
  if (!points.length) return <div className="spark-empty">No history</div>;
  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const coords = closes.map((close, index) => {
    const x = (index / Math.max(closes.length - 1, 1)) * (width - 8) + 4;
    const y = height - 10 - ((close - min) / span) * (height - 20);
    return `${x},${y}`;
  });
  const line = coords.join(" ");
  const area = `4,${height - 4} ${line} ${width - 4},${height - 4}`;
  const stroke = positive ? "#22c55e" : "#ef4444";
  const gradId = `spark-${positive ? "u" : "d"}-${closes.length}`;

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Stacked price + volume chart inspired by ai-stock-dashboard technical panel. */
export function TechChart({
  points,
  sma20,
  sma50,
}: {
  points: Bar[];
  sma20?: number | null;
  sma50?: number | null;
}) {
  if (!points.length) return <div className="spark-empty">No history</div>;

  const w = 720;
  const priceH = 180;
  const volH = 56;
  const gap = 12;
  const totalH = priceH + gap + volH;
  const closes = points.map((p) => p.close);
  const highs = points.map((p) => p.high ?? p.close);
  const lows = points.map((p) => p.low ?? p.close);
  const vols = points.map((p) => p.volume ?? 0);
  const min = Math.min(...lows, sma20 ?? Infinity, sma50 ?? Infinity);
  const max = Math.max(...highs, sma20 ?? -Infinity, sma50 ?? -Infinity);
  const span = max - min || 1;
  const maxVol = Math.max(...vols, 1);
  const n = points.length;

  const xAt = (i: number) => (i / Math.max(n - 1, 1)) * (w - 16) + 8;
  const yAt = (v: number) => priceH - 8 - ((v - min) / span) * (priceH - 16);

  const line = closes.map((c, i) => `${xAt(i)},${yAt(c)}`).join(" ");
  const area = `8,${priceH - 4} ${line} ${w - 8},${priceH - 4}`;
  const last = closes[closes.length - 1];
  const first = closes[0];
  const up = last >= first;
  const stroke = up ? "#22c55e" : "#ef4444";

  const smaLine = (level: number | null | undefined, color: string) => {
    if (level == null || Number.isNaN(level)) return null;
    const y = yAt(level);
    return <line x1={8} x2={w - 8} y1={y} y2={y} stroke={color} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85" />;
  };

  return (
    <div className="tech-chart">
      <svg viewBox={`0 0 ${w} ${totalH}`} role="img" aria-label="Price and volume">
        <defs>
          <linearGradient id="techFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={w} height={priceH} fill="transparent" />
        {smaLine(sma50 ?? null, "#60a5fa")}
        {smaLine(sma20 ?? null, "#f59e0b")}
        <polygon points={area} fill="url(#techFill)" />
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xAt(n - 1)} cy={yAt(last)} r="3.5" fill={stroke} />
        <g transform={`translate(0, ${priceH + gap})`}>
          {vols.map((vol, i) => {
            const barW = Math.max(1.5, (w - 16) / n - 1);
            const h = (vol / maxVol) * (volH - 4);
            const prev = i === 0 ? points[0].close : points[i - 1].close;
            const green = points[i].close >= prev;
            return (
              <rect
                key={i}
                x={xAt(i) - barW / 2}
                y={volH - h}
                width={barW}
                height={h}
                fill={green ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)"}
              />
            );
          })}
        </g>
      </svg>
      <div className="tech-legend">
        <span><i style={{ background: stroke }} /> Price</span>
        <span><i style={{ background: "#f59e0b" }} /> SMA20</span>
        <span><i style={{ background: "#60a5fa" }} /> SMA50</span>
        <span><i style={{ background: "rgba(34,197,94,0.55)" }} /> Volume</span>
      </div>
    </div>
  );
}

export function RangeMeter({ position }: { position: number | null }) {
  const pct = position == null ? 50 : Math.max(0, Math.min(1, position)) * 100;
  return (
    <div className="range-meter" aria-label="Range">
      <span>Low</span>
      <div className="range-track"><i style={{ left: `${pct}%` }} /></div>
      <span>High</span>
    </div>
  );
}

export function InsightCards({
  items,
}: {
  items: Array<{ tone: "bear" | "bull" | "info"; text: string }>;
}) {
  if (!items.length) return null;
  return (
    <div className="insight-stack">
      {items.map((item) => (
        <div key={item.text} className={`insight-card ${item.tone}`}>{item.text}</div>
      ))}
    </div>
  );
}
