export type HoldBucketId =
  | "under5m"
  | "m5to15"
  | "m15to60"
  | "h1to4"
  | "sameDay4hPlus"
  | "overnight1to3d"
  | "swing3dPlus";

export type StyleId = "scalp" | "intradaySwing" | "dayHold" | "multiDaySwing";

export type BucketRow = {
  id: HoldBucketId;
  label: string;
  n: number;
  pnl: number;
  winPct: number;
  expectancy: number;
};

export type StyleRow = {
  id: StyleId;
  label: string;
  n: number;
  pnl: number;
  winPct: number;
  expectancy: number;
  medHoldMin: number;
};

export type EdgeProfile = {
  fromIso: string;
  label: string;
  all: SleeveStats;
  soxl: SleeveStats | null;
  nonSoxl: SleeveStats | null;
  /** Plain-language strength / leak lines for the UI */
  verdict: {
    strength: string;
    holdWindow: string;
    leak: string;
    rule: string;
  };
};

export type SleeveStats = {
  label: string;
  n: number;
  pnl: number;
  winPct: number;
  expectancy: number;
  avgHoldMin: number;
  medHoldMin: number;
  avgWin: number;
  avgLoss: number;
  winMedHoldMin: number | null;
  lossMedHoldMin: number | null;
  styles: StyleRow[];
  buckets: BucketRow[];
  best: TradeHit[];
  worst: TradeHit[];
};

export type TradeHit = {
  ticker: string;
  pnl: number;
  holdMinutes: number;
  closedAt: string;
};

type TradeLike = {
  ticker: string;
  pnl: number;
  holdMinutes?: number;
  openedAt?: string;
  closedAt: string;
};

const BUCKET_ORDER: HoldBucketId[] = [
  "under5m",
  "m5to15",
  "m15to60",
  "h1to4",
  "sameDay4hPlus",
  "overnight1to3d",
  "swing3dPlus",
];

const BUCKET_LABEL: Record<HoldBucketId, string> = {
  under5m: "<5m",
  m5to15: "5–15m",
  m15to60: "15–60m",
  h1to4: "1–4h",
  sameDay4hPlus: "same day 4h+",
  overnight1to3d: "1–3d overnight",
  swing3dPlus: "3d+ swing",
};

const STYLE_LABEL: Record<StyleId, string> = {
  scalp: "Scalp (<15m)",
  intradaySwing: "Intraday swing (15m–4h)",
  dayHold: "Same-day hold (4h+)",
  multiDaySwing: "Multi-day swing",
};

function holdMin(t: TradeLike): number {
  if (typeof t.holdMinutes === "number" && Number.isFinite(t.holdMinutes)) return t.holdMinutes;
  if (t.openedAt) {
    const a = Date.parse(t.openedAt);
    const b = Date.parse(t.closedAt);
    if (Number.isFinite(a) && Number.isFinite(b)) return (b - a) / 60_000;
  }
  return NaN;
}

function bucketId(m: number): HoldBucketId {
  if (m < 5) return "under5m";
  if (m < 15) return "m5to15";
  if (m < 60) return "m15to60";
  if (m < 240) return "h1to4";
  if (m < 1440) return "sameDay4hPlus";
  if (m < 4320) return "overnight1to3d";
  return "swing3dPlus";
}

function styleId(m: number): StyleId {
  if (m < 15) return "scalp";
  if (m < 240) return "intradaySwing";
  if (m < 1440) return "dayHold";
  return "multiDaySwing";
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

function sleeveStats(trades: TradeLike[], label: string): SleeveStats | null {
  const rows = trades
    .map((t) => ({ t, m: holdMin(t) }))
    .filter((x) => Number.isFinite(x.m));
  if (!rows.length) return null;

  const n = rows.length;
  const pnl = rows.reduce((s, x) => s + x.t.pnl, 0);
  const wins = rows.filter((x) => x.t.pnl > 0);
  const losses = rows.filter((x) => x.t.pnl <= 0);
  const holds = rows.map((x) => x.m);
  const avgHoldMin = holds.reduce((a, b) => a + b, 0) / n;
  const medHoldMin = median(holds) ?? 0;
  const avgWin = wins.length ? wins.reduce((s, x) => s + x.t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, x) => s + x.t.pnl, 0) / losses.length : 0;

  const styleMap = new Map<StyleId, { n: number; pnl: number; wins: number; holds: number[] }>();
  const bucketMap = new Map<HoldBucketId, { n: number; pnl: number; wins: number }>();

  for (const { t, m } of rows) {
    const sid = styleId(m);
    const bid = bucketId(m);
    const st = styleMap.get(sid) ?? { n: 0, pnl: 0, wins: 0, holds: [] };
    st.n += 1;
    st.pnl += t.pnl;
    if (t.pnl > 0) st.wins += 1;
    st.holds.push(m);
    styleMap.set(sid, st);

    const bk = bucketMap.get(bid) ?? { n: 0, pnl: 0, wins: 0 };
    bk.n += 1;
    bk.pnl += t.pnl;
    if (t.pnl > 0) bk.wins += 1;
    bucketMap.set(bid, bk);
  }

  const styles: StyleRow[] = [...styleMap.entries()]
    .map(([id, v]) => ({
      id,
      label: STYLE_LABEL[id],
      n: v.n,
      pnl: v.pnl,
      winPct: (v.wins / v.n) * 100,
      expectancy: v.pnl / v.n,
      medHoldMin: median(v.holds) ?? 0,
    }))
    .sort((a, b) => b.pnl - a.pnl);

  const buckets: BucketRow[] = BUCKET_ORDER.filter((id) => bucketMap.has(id)).map((id) => {
    const v = bucketMap.get(id)!;
    return {
      id,
      label: BUCKET_LABEL[id],
      n: v.n,
      pnl: v.pnl,
      winPct: (v.wins / v.n) * 100,
      expectancy: v.pnl / v.n,
    };
  });

  const ranked = [...rows].sort((a, b) => b.t.pnl - a.t.pnl);
  const toHit = (x: (typeof rows)[0]): TradeHit => ({
    ticker: x.t.ticker,
    pnl: x.t.pnl,
    holdMinutes: x.m,
    closedAt: x.t.closedAt,
  });

  return {
    label,
    n,
    pnl,
    winPct: (wins.length / n) * 100,
    expectancy: pnl / n,
    avgHoldMin,
    medHoldMin,
    avgWin,
    avgLoss,
    winMedHoldMin: median(wins.map((x) => x.m)),
    lossMedHoldMin: median(losses.map((x) => x.m)),
    styles,
    buckets,
    best: ranked.slice(0, 5).map(toHit),
    worst: ranked.slice(-5).reverse().map(toHit),
  };
}

function formatHold(m: number): string {
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(1)}d`;
}

function buildVerdict(all: SleeveStats, soxl: SleeveStats | null, nonSoxl: SleeveStats | null) {
  const edge = soxl ?? all;
  const bestStyle = edge.styles[0];
  const bestBucket = [...edge.buckets].sort((a, b) => b.expectancy - a.expectancy)[0];
  const worstBucket = [...edge.buckets].sort((a, b) => a.pnl - b.pnl)[0];

  const strength = bestStyle
    ? `Strength: ${bestStyle.label} — ${bestStyle.n} closes, ${bestStyle.pnl >= 0 ? "+" : ""}$${bestStyle.pnl.toFixed(0)}, $${bestStyle.expectancy.toFixed(2)}/trade (median hold ${formatHold(bestStyle.medHoldMin)}).`
    : "Strength: not enough closes yet.";

  const holdWindow = bestBucket
    ? `Best hold band: ${bestBucket.label} — ${bestBucket.n} closes, $${bestBucket.expectancy.toFixed(2)} expectancy.`
    : "Best hold band: n/a.";

  let leak = "Leak: none flagged yet (small sample).";
  if (nonSoxl && nonSoxl.pnl < 0 && Math.abs(nonSoxl.pnl) > 50) {
    leak = `Leak: non-SOXL — ${nonSoxl.n} closes, $${nonSoxl.pnl.toFixed(0)} (WR ${nonSoxl.winPct.toFixed(0)}%).`;
  } else if (worstBucket && worstBucket.pnl < -20) {
    leak = `Leak: ${worstBucket.label} — ${worstBucket.n} closes, $${worstBucket.pnl.toFixed(0)}.`;
  }

  const scalp = edge.styles.find((s) => s.id === "scalp");
  const overnight = edge.buckets.find((b) => b.id === "overnight1to3d" || b.id === "swing3dPlus");
  const ruleParts: string[] = [];
  if (bestBucket) ruleParts.push(`default hold ${bestBucket.label}`);
  if (scalp && scalp.expectancy < 0) ruleParts.push("treat <15m as off-plan");
  if (overnight && overnight.pnl < 0) ruleParts.push("overnight only with explicit thesis");
  if (nonSoxl && nonSoxl.pnl < -50) ruleParts.push("SOXL-only book until non-SOXL stops bleeding");
  const rule = `Accountable rule: ${ruleParts.length ? ruleParts.join(" · ") : "keep logging until a clear edge band emerges"}.`;

  return { strength, holdWindow, leak, rule };
}

export function buildEdgeProfile(
  trades: TradeLike[],
  opts: { fromIso?: string } = {},
): EdgeProfile {
  const fromIso = opts.fromIso ?? "2026-07-13T00:00:00.000Z";
  const forward = trades.filter((t) => t.closedAt >= fromIso);
  const use = forward.length >= 5 ? forward : trades.slice(-40);
  const label = forward.length >= 5 ? "W29 → now" : "Last 40 closes";

  const all = sleeveStats(use, `${label} · all`)!;
  const soxlTrades = use.filter((t) => String(t.ticker || "").toUpperCase() === "SOXL");
  const nonSoxlTrades = use.filter((t) => String(t.ticker || "").toUpperCase() !== "SOXL");
  const soxl = sleeveStats(soxlTrades, `${label} · SOXL`);
  const nonSoxl = sleeveStats(nonSoxlTrades, `${label} · non-SOXL`);

  return {
    fromIso,
    label,
    all,
    soxl,
    nonSoxl,
    verdict: buildVerdict(all, soxl, nonSoxl),
  };
}

export { formatHold };
