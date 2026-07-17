export type OhlcvBar = {
  time?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type IndicatorSeries = {
  sma20: Array<number | null>;
  sma50: Array<number | null>;
  sma200: Array<number | null>;
  ema12: Array<number | null>;
  ema26: Array<number | null>;
  macd: Array<number | null>;
  macdSignal: Array<number | null>;
  macdHist: Array<number | null>;
  rsi: Array<number | null>;
  bbUpper: Array<number | null>;
  bbMid: Array<number | null>;
  bbLower: Array<number | null>;
  atr: Array<number | null>;
  stochK: Array<number | null>;
  stochD: Array<number | null>;
  volSma: Array<number | null>;
};

export type RiskMetrics = {
  totalReturn: number | null;
  annVol: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  cumulative: number[];
};

function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = values.map(() => null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = values.map(() => null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = closes.map(() => null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atr(bars: OhlcvBar[], period = 14): Array<number | null> {
  const out: Array<number | null> = bars.map(() => null);
  if (bars.length < 2) return out;
  const trs: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const high = bars[i].high;
    const low = bars[i].low;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    sum += trs[i];
    if (i >= period) sum -= trs[i - period];
    if (i >= period) out[i] = sum / period;
  }
  return out;
}

function stochastic(bars: OhlcvBar[], period = 14, smooth = 3): { k: Array<number | null>; d: Array<number | null> } {
  const k: Array<number | null> = bars.map(() => null);
  for (let i = period - 1; i < bars.length; i++) {
    const window = bars.slice(i - period + 1, i + 1);
    const highest = Math.max(...window.map((b) => b.high));
    const lowest = Math.min(...window.map((b) => b.low));
    const denom = highest - lowest || 1;
    k[i] = ((bars[i].close - lowest) / denom) * 100;
  }
  const d = sma(k.map((v) => v ?? 0), smooth).map((v, i) => (k[i] == null ? null : v));
  return { k, d };
}

/** Pure TS indicator pack (ai-stock-dashboard / pandas-style). Descriptive only. */
export function computeIndicators(bars: OhlcvBar[]): IndicatorSeries {
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume ?? 0);
  const sma20 = sma(closes, 20);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = closes.map((_, i) => (ema12[i] != null && ema26[i] != null ? (ema12[i]! - ema26[i]!) : null));
  const macdSignal = ema(macd.map((v) => v ?? 0), 9).map((v, i) => (macd[i] == null ? null : v));
  const macdHist = macd.map((v, i) => (v != null && macdSignal[i] != null ? v - macdSignal[i]! : null));
  const mid = sma20;
  const bbUpper: Array<number | null> = closes.map(() => null);
  const bbLower: Array<number | null> = closes.map(() => null);
  for (let i = 19; i < closes.length; i++) {
    const slice = closes.slice(i - 19, i + 1);
    const mean = mid[i]!;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / 20;
    const std = Math.sqrt(variance);
    bbUpper[i] = mean + 2 * std;
    bbLower[i] = mean - 2 * std;
  }
  const stoch = stochastic(bars);
  return {
    sma20,
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema12,
    ema26,
    macd,
    macdSignal,
    macdHist,
    rsi: rsi(closes, 14),
    bbUpper,
    bbMid: mid,
    bbLower,
    atr: atr(bars, 14),
    stochK: stoch.k,
    stochD: stoch.d,
    volSma: sma(vols, 20),
  };
}

export function lastNumber(series: Array<number | null | undefined>): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

export function rsiLabel(value: number | null): string {
  if (value == null) return "—";
  if (value >= 70) return "Overbought";
  if (value <= 30) return "Oversold";
  return "Neutral";
}

/** Risk metrics from close series (annualized 252). Descriptive only. */
export function computeRiskMetrics(closes: number[]): RiskMetrics {
  if (closes.length < 2) {
    return { totalReturn: null, annVol: null, sharpe: null, maxDrawdown: null, cumulative: [] };
  }
  const first = closes[0];
  const last = closes[closes.length - 1];
  const totalReturn = first ? (last / first) - 1 : null;
  const daily: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1]) daily.push(closes[i] / closes[i - 1] - 1);
  }
  const mean = daily.reduce((s, v) => s + v, 0) / (daily.length || 1);
  const variance = daily.reduce((s, v) => s + (v - mean) ** 2, 0) / (daily.length || 1);
  const annVol = daily.length ? Math.sqrt(variance) * Math.sqrt(252) : null;
  const sharpe = annVol && annVol > 0 ? (mean * 252) / annVol : null;
  let peak = closes[0];
  let maxDd = 0;
  const cumulative: number[] = [];
  let running = 1;
  for (let i = 0; i < closes.length; i++) {
    if (i > 0 && closes[i - 1]) running *= closes[i] / closes[i - 1];
    cumulative.push(running - 1);
    peak = Math.max(peak, closes[i]);
    if (peak > 0) maxDd = Math.min(maxDd, closes[i] / peak - 1);
  }
  return {
    totalReturn,
    annVol,
    sharpe,
    maxDrawdown: maxDd,
    cumulative,
  };
}
