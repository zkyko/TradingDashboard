"use client";

type Bin = { priceLow: number; priceHigh: number; mid: number; volume: number };

export default function VolumeProfileChart({
  bins,
  poc,
  vah,
  val,
  mode,
}: {
  bins: Bin[];
  poc: number | null;
  vah: number | null;
  val: number | null;
  mode: string;
}) {
  if (!bins.length) return <div className="spark-empty">No volume profile</div>;
  const maxVol = Math.max(...bins.map((b) => b.volume), 1);
  const h = Math.max(180, bins.length * 6);
  const w = 320;

  return (
    <div className="vp-chart">
      <div className="vp-meta">
        <span>Mode <b>{mode}</b></span>
        <span>POC <b>{poc == null ? "—" : poc.toFixed(2)}</b></span>
        <span>VAH <b>{vah == null ? "—" : vah.toFixed(2)}</b></span>
        <span>VAL <b>{val == null ? "—" : val.toFixed(2)}</b></span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Volume profile">
        {bins.map((bin, i) => {
          const y = h - ((i + 1) / bins.length) * (h - 8) - 4;
          const barH = Math.max(2, (h - 8) / bins.length - 1);
          const barW = (bin.volume / maxVol) * (w - 70);
          const isPoc = poc != null && Math.abs(bin.mid - poc) < (bin.priceHigh - bin.priceLow) * 0.6;
          const inVa =
            val != null && vah != null && bin.mid >= val && bin.mid <= vah;
          return (
            <g key={i}>
              <rect
                x={60}
                y={y}
                width={barW}
                height={barH}
                fill={isPoc ? "rgba(245,158,11,0.85)" : inVa ? "rgba(96,165,250,0.55)" : "rgba(161,161,170,0.35)"}
              />
              {(i % Math.ceil(bins.length / 8) === 0) && (
                <text x={56} y={y + barH} textAnchor="end" fill="#71717a" fontSize="9">
                  {bin.mid.toFixed(0)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="muted vp-note">
        {mode === "daily"
          ? "Daily-bar composite volume-by-price (not tick/session VP)."
          : "Session/intraday profile from the loaded bars."}
      </p>
    </div>
  );
}
