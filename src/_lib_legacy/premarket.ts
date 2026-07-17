import { pythonHealth } from "@/lib/python-service";

const DEFAULT_URL = process.env.ZK_PYTHON_URL || "http://127.0.0.1:8765";

export type PremarketQuote = {
  symbol: string;
  display?: string;
  name: string;
  group: string;
  price?: number;
  prevClose?: number;
  changePct?: number;
  weekChangePct?: number;
  high?: number;
  low?: number;
  volume?: number;
  spark?: number[];
  error?: string | null;
};

export type PremarketPayload = {
  ok: boolean;
  dayKey: string;
  timezone: string;
  windowDays: number;
  updatedAt: string;
  clock: string;
  indices: PremarketQuote[];
  heatmap: PremarketQuote[];
  leaders: PremarketQuote[];
  laggards: PremarketQuote[];
  earnings: Array<Record<string, unknown>>;
  economics: Array<Record<string, unknown>>;
  ipos: Array<Record<string, unknown>>;
  splits: Array<Record<string, unknown>>;
  calendarError?: string | null;
  note?: string;
  source?: string;
  error?: string;
};

export async function fetchPremarketBoard(days = 7): Promise<PremarketPayload> {
  const healthy = await pythonHealth();
  if (!healthy) {
    return {
      ok: false,
      error: "Python analyze service is offline.",
      dayKey: "",
      timezone: "America/Chicago",
      windowDays: days,
      updatedAt: new Date().toISOString(),
      clock: "",
      indices: [],
      heatmap: [],
      leaders: [],
      laggards: [],
      earnings: [],
      economics: [],
      ipos: [],
      splits: [],
    };
  }
  const response = await fetch(`${DEFAULT_URL}/premarket?days=${days}`, {
    signal: AbortSignal.timeout(90000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || body.error || `Premarket ${response.status}`);
  }
  return body as PremarketPayload;
}
