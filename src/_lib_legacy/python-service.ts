import { computeIndicators, computeRiskMetrics, lastNumber, type OhlcvBar } from "@/lib/technicals";

const DEFAULT_URL = process.env.ZK_PYTHON_URL || "http://127.0.0.1:8765";

export type AnalyzePayload = {
  indicators: ReturnType<typeof computeIndicators> & { volRatio?: Array<number | null> };
  states: Record<string, string>;
  risk: ReturnType<typeof computeRiskMetrics>;
  volumeProfile: {
    mode: string;
    bins: Array<{ priceLow: number; priceHigh: number; mid: number; volume: number }>;
    poc: number | null;
    vah: number | null;
    val: number | null;
    totalVolume: number;
  };
  last: {
    close: number | null;
    rsi: number | null;
    sma20: number | null;
    sma50: number | null;
    volRatio: number | null;
  };
  ml?: {
    predictedClose: number;
    lastClose: number;
    predictedChangePct: number | null;
    trainScore: number;
    testScore: number;
    featureImportance: Array<{ feature: string; importance: number }>;
    disclaimer: string;
  } | null;
  source?: string;
  symbol?: string;
  bars?: OhlcvBar[];
};

function tsFallback(bars: OhlcvBar[], vpMode: string): AnalyzePayload {
  const indicators = computeIndicators(bars);
  const closes = bars.map((b) => b.close);
  const risk = computeRiskMetrics(closes);
  const rsi = lastNumber(indicators.rsi);
  const sma20 = lastNumber(indicators.sma20);
  const close = closes[closes.length - 1] ?? null;
  const volRatio = (() => {
    const last = bars[bars.length - 1]?.volume ?? null;
    const avg = lastNumber(indicators.volSma);
    return last != null && avg ? last / avg : null;
  })();

  // Minimal VP fallback in TS
  const lows = bars.map((b) => b.low);
  const highs = bars.map((b) => b.high);
  const priceLow = Math.min(...lows, close ?? 0);
  const priceHigh = Math.max(...highs, close ?? 0);
  const bins = 24;
  const edges: number[] = [];
  for (let i = 0; i <= bins; i++) edges.push(priceLow + ((priceHigh - priceLow) / bins) * i || priceLow);
  const vols = new Array(bins).fill(0);
  for (const bar of bars) {
    const span = bar.high - bar.low || 1e-9;
    for (let i = 0; i < bins; i++) {
      const a = edges[i];
      const b = edges[i + 1];
      const overlap = Math.max(0, Math.min(bar.high, b) - Math.max(bar.low, a));
      if (overlap > 0) vols[i] += (bar.volume || 0) * (overlap / span);
    }
  }
  const total = vols.reduce((s, v) => s + v, 0);
  const pocIdx = vols.reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0);
  const binRows = vols.map((volume, i) => ({
    priceLow: edges[i],
    priceHigh: edges[i + 1],
    mid: (edges[i] + edges[i + 1]) / 2,
    volume,
  }));

  return {
    indicators: { ...indicators, volRatio: indicators.volSma.map(() => null) },
    states: {
      rsi: rsi == null ? "neutral" : rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral",
      vsSma20: close != null && sma20 != null ? (close >= sma20 ? "above" : "below") : "neutral",
      macd: "neutral",
      stoch: "neutral",
      volume: volRatio == null ? "normal" : volRatio >= 1.5 ? "high" : volRatio <= 0.5 ? "low" : "normal",
      bb: "neutral",
    },
    risk,
    volumeProfile: {
      mode: vpMode,
      bins: binRows,
      poc: binRows[pocIdx]?.mid ?? null,
      vah: priceHigh,
      val: priceLow,
      totalVolume: total,
    },
    last: {
      close,
      rsi,
      sma20,
      sma50: lastNumber(indicators.sma50),
      volRatio,
    },
    source: "typescript-fallback",
  };
}

async function pythonFetch(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${DEFAULT_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(init?.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.detail || body.error || `Python service ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function pythonHealth(): Promise<boolean> {
  try {
    const body = await pythonFetch("/health");
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}

export async function analyzeBars(
  bars: OhlcvBar[],
  opts: { bins?: number; vpMode?: "daily" | "session" | "visible"; includeMl?: boolean } = {},
): Promise<AnalyzePayload> {
  const vpMode = opts.vpMode || "daily";
  if (!bars.length) return tsFallback(bars, vpMode);
  try {
    return (await pythonFetch("/analyze", {
      method: "POST",
      body: JSON.stringify({
        bars,
        bins: opts.bins ?? 32,
        vp_mode: vpMode,
        include_ml: Boolean(opts.includeMl),
      }),
    })) as AnalyzePayload;
  } catch {
    return tsFallback(bars, vpMode);
  }
}

export async function predictBars(bars: OhlcvBar[]) {
  return pythonFetch("/predict", { method: "POST", body: JSON.stringify({ bars }) });
}

export async function optionsChain(symbol: string) {
  return pythonFetch(`/options/chain?symbol=${encodeURIComponent(symbol)}`);
}

export async function optionsAnalyze(symbol: string, includeMl = false) {
  return pythonFetch("/options/analyze", {
    method: "POST",
    body: JSON.stringify({ symbol, include_ml: includeMl }),
  }) as Promise<AnalyzePayload>;
}

export type OptionsHistoryMl = {
  ok: boolean;
  error?: string;
  orderCount?: number;
  cancelModel?: {
    target: string;
    trainAccuracy: number | null;
    testAccuracy: number | null;
    featureImportance: Array<{ feature: string; importance: number }>;
    note?: string;
  };
  regime?: Array<{
    t: string;
    cancelRate20: number | null;
    cashflowCum: number;
    cashflowRoll10: number | null;
  }>;
  clusters?: Array<{
    id: number;
    size: number;
    share: number;
    avgHour: number;
    avgDte: number;
    avgPremium: number;
    cancelRate: number;
    netCashflow: number;
    topUnderlyings: Record<string, number>;
    blurb: string;
  }>;
  byHour?: Array<{ hour: number; orders: number; cancelRate: number; netCashflow: number }>;
  byDow?: Array<{ dow: number; orders: number; cancelRate: number; netCashflow: number }>;
  summary?: {
    overallCancelRate: number;
    filledShare: number;
    debitShare: number;
    medianPremium: number;
    medianDte: number;
    netCashflow: number;
  };
  disclaimer?: string;
  source?: string;
};

export async function analyzeOptionsHistory(orders: unknown[]): Promise<OptionsHistoryMl> {
  return pythonFetch("/options/history", {
    method: "POST",
    body: JSON.stringify({ orders }),
  }) as Promise<OptionsHistoryMl>;
}

export type LiveInterval = "10m" | "15m" | "30m";

export type LiveBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type LivePoint = { time: number; value: number };

export type LiveTapeAnalysis = {
  last?: {
    close?: number | null;
    rsi?: number | null;
    sma20?: number | null;
    sma50?: number | null;
    volRatio?: number | null;
  } | null;
  states?: Record<string, string>;
  ml?: {
    predictedClose: number;
    lastClose: number;
    predictedChangePct: number | null;
    trainScore: number;
    testScore: number;
    disclaimer?: string;
  } | null;
  rsiSeries?: LivePoint[];
  sma20Series?: LivePoint[];
  volumeProfile?: {
    mode?: string;
    poc?: number | null;
    val?: number | null;
    vah?: number | null;
    totalVolume?: number;
  } | null;
  error?: string;
};

export type VpSnapshot = {
  mode?: string;
  poc?: number | null;
  val?: number | null;
  vah?: number | null;
  totalVolume?: number;
  position?: string;
  alert?: boolean;
} | null;

export type LiveSymbolTape = {
  symbol: string;
  yf: string;
  interval?: string;
  bars: LiveBar[];
  last: LiveBar | null;
  previousClose?: number | null;
  changePct: number | null;
  analysis?: LiveTapeAnalysis | null;
  profiles?: Record<string, VpSnapshot>;
  vpAlerts?: Array<{
    tf: string;
    position?: string;
    val?: number | null;
    poc?: number | null;
    vah?: number | null;
  }>;
  error: string | null;
};

export type LiveBoardPayload = {
  interval: LiveInterval;
  symbols: LiveSymbolTape[];
  source: string;
  updatedAt: string;
  note?: string;
};

export const LIVE_DEFAULT_SYMBOLS = [
  "SOXL",
  "SOXS",
  "SPY",
  "QQQ",
  "TSLA",
  "TSLL",
  "LABD",
  "NFXL",
  "ES=F",
] as const;

export async function fetchLiveBoard(
  interval: LiveInterval = "15m",
  symbols: string[] = [...LIVE_DEFAULT_SYMBOLS],
  includeMl = true,
): Promise<LiveBoardPayload> {
  return pythonFetch("/live/board", {
    method: "POST",
    body: JSON.stringify({
      interval,
      symbols,
      include_ml: includeMl,
    }),
  }) as Promise<LiveBoardPayload>;
}
