import { db } from "@/lib/db";
import { fetchRobinhoodMorningTape, type RhScanBucket } from "@/lib/robinhood";
import { fetchLiveBoard, type LiveSymbolTape } from "@/lib/python-service";
import { deriveVpPlays, type VpPlay } from "@/lib/vp-plays";
import { pushNotification } from "@/lib/notifications";
import { getTraderPlan } from "@/lib/trader-plan";
import { DEFAULT_TIMEZONE, dayKeyInZone, nowContext } from "@/lib/timezone";

db.exec(`
CREATE TABLE IF NOT EXISTS morning_scan_runs (
  day_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

export type MorningSetup = {
  symbol: string;
  sources: string[];
  last: number | null;
  changePct: number | null;
  levels: {
    daily?: { val: number | null; poc: number | null; vah: number | null; position?: string };
    weekly?: { val: number | null; poc: number | null; vah: number | null; position?: string };
    intraday?: { val: number | null; poc: number | null; vah: number | null; position?: string };
  };
  plays: Array<Pick<VpPlay, "id" | "name" | "status" | "heat" | "tagline" | "watch" | "invalidation" | "bias">>;
  bars?: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
};

export type MorningScanResult = {
  dayKey: string;
  offline?: boolean;
  buckets: RhScanBucket[];
  symbols: string[];
  setups: MorningSetup[];
  summary: string;
  capturedAt: string;
  rhCapturedAt?: string;
};

function levelsFromTape(tape: LiveSymbolTape): MorningSetup["levels"] {
  const profiles = tape.profiles || {};
  const daily = profiles.daily;
  const weekly = profiles.weekly;
  const intraday = profiles["15m"] || profiles["30m"] || profiles["10m"];
  const pack = (snap: typeof daily) =>
    snap
      ? {
          val: snap.val ?? null,
          poc: snap.poc ?? null,
          vah: snap.vah ?? null,
          position: snap.position,
        }
      : undefined;
  return {
    daily: pack(daily),
    weekly: pack(weekly),
    intraday: pack(intraday),
  };
}

function sourceMap(buckets: RhScanBucket[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const bucket of buckets) {
    for (const row of bucket.rows) {
      const list = map.get(row.ticker) || [];
      if (!list.includes(bucket.key)) list.push(bucket.key);
      map.set(row.ticker, list);
    }
  }
  return map;
}

export function getMorningScan(dayKey?: string): MorningScanResult | null {
  const key = dayKey || dayKeyInZone(new Date(), DEFAULT_TIMEZONE);
  const row = db.prepare(`SELECT day_key, payload_json, created_at FROM morning_scan_runs WHERE day_key=?`).get(key) as
    | { day_key: string; payload_json: string; created_at: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as MorningScanResult;
  } catch {
    return null;
  }
}

export function listRecentMorningScans(limit = 7): MorningScanResult[] {
  const rows = db
    .prepare(`SELECT payload_json FROM morning_scan_runs ORDER BY day_key DESC LIMIT ?`)
    .all(limit) as Array<{ payload_json: string }>;
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.payload_json) as MorningScanResult;
      } catch {
        return null;
      }
    })
    .filter((r): r is MorningScanResult => Boolean(r));
}

/** Pull RH movers / options+stock volume, compute VAL/POC/VAH, derive VP setups. */
export async function runMorningScan(opts: { force?: boolean; timeZone?: string } = {}): Promise<MorningScanResult> {
  const tz = opts.timeZone || DEFAULT_TIMEZONE;
  const now = nowContext(tz);
  const dayKey = now.dayKey;
  if (!opts.force) {
    const existing = getMorningScan(dayKey);
    if (existing?.setups?.length) return existing;
  }

  const plan = getTraderPlan();
  const tape = await fetchRobinhoodMorningTape();
  const sources = sourceMap(tape.buckets);

  // Always include plan universe so leveraged ETFs get morning VP too
  const symbols = [...new Set([...tape.symbols, ...plan.universe])].slice(0, 28);

  let boardSymbols: LiveSymbolTape[] = [];
  try {
    const board = await fetchLiveBoard("15m", symbols, false);
    boardSymbols = board.symbols || [];
  } catch (err) {
    const partial: MorningScanResult = {
      dayKey,
      buckets: tape.buckets,
      symbols,
      setups: [],
      summary: `RH tape pulled (${symbols.length} symbols) but VP board failed: ${err instanceof Error ? err.message : "error"}`,
      capturedAt: new Date().toISOString(),
      rhCapturedAt: tape.capturedAt,
    };
    db.prepare(`INSERT OR REPLACE INTO morning_scan_runs (day_key, payload_json, created_at) VALUES (?,?,?)`).run(
      dayKey,
      JSON.stringify(partial),
      partial.capturedAt,
    );
    pushNotification({
      kind: "morning",
      title: "Morning scan — RH only",
      body: `${now.clock}: ${partial.summary}`,
      meta: { dayKey, href: "/notifications" },
    });
    return partial;
  }

  const setups: MorningSetup[] = [];
  for (const row of boardSymbols) {
    if (row.error || !row.last) continue;
    const plays = deriveVpPlays(row)
      .filter((p) => p.status === "live" || p.status === "forming")
      .filter((p) => p.heat >= 62)
      .slice(0, 3)
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        heat: p.heat,
        tagline: p.tagline,
        watch: p.watch,
        invalidation: p.invalidation,
        bias: p.bias,
      }));
    if (!plays.length) continue;
    const bars = (row.bars || [])
      .slice(-80)
      .map((b) => {
        const t = typeof b.time === "number" ? b.time : Math.floor(new Date(String(b.time)).getTime() / 1000);
        return {
          time: Number.isFinite(t) ? t : 0,
          open: Number(b.open),
          high: Number(b.high),
          low: Number(b.low),
          close: Number(b.close),
          volume: Number(b.volume || 0),
        };
      })
      .filter((b) => b.close > 0 && b.time > 0);
    setups.push({
      symbol: row.symbol,
      sources: sources.get(row.symbol) || (plan.universe.includes(row.symbol) ? ["universe"] : ["scan"]),
      last: row.last.close ?? null,
      changePct: row.changePct,
      levels: levelsFromTape(row),
      plays,
      bars: bars.length ? bars : undefined,
    });
  }

  setups.sort((a, b) => {
    const aUni = plan.universe.includes(a.symbol) ? 1 : 0;
    const bUni = plan.universe.includes(b.symbol) ? 1 : 0;
    if (bUni !== aUni) return bUni - aUni;
    return (b.plays[0]?.heat ?? 0) - (a.plays[0]?.heat ?? 0);
  });

  const top = setups.slice(0, 8);
  const summary =
    top.length === 0
      ? `No live/forming VP setups ≥62 heat across ${symbols.length} RH morning names. Still review the tape buckets.`
      : `${top.length} setups from RH gainers/losers · options vol · stock vol. Top: ${top
          .slice(0, 5)
          .map((s) => `${s.symbol} (${s.plays[0]?.name})`)
          .join(", ")}. Write thesis + invalidation before any click.`;

  const result: MorningScanResult = {
    dayKey,
    buckets: tape.buckets,
    symbols,
    setups: top,
    summary,
    capturedAt: new Date().toISOString(),
    rhCapturedAt: tape.capturedAt,
  };

  db.prepare(`INSERT OR REPLACE INTO morning_scan_runs (day_key, payload_json, created_at) VALUES (?,?,?)`).run(
    dayKey,
    JSON.stringify(result),
    result.capturedAt,
  );

  pushNotification({
    kind: "morning",
    title: `Morning scan · ${top.length} setups`,
    body: `${now.clock}: ${summary}`,
    meta: { dayKey, setupCount: top.length, href: "/notifications" },
  });

  for (const setup of top.slice(0, 6)) {
    const play = setup.plays[0];
    const d = setup.levels.daily;
    pushNotification({
      kind: "setup",
      title: `${setup.symbol}: ${play?.name || "VP setup"} (${play?.status})`,
      body: `${now.clock}: ${play?.tagline || "Watch"}. Daily VAL ${d?.val?.toFixed?.(2) ?? "—"} · POC ${d?.poc?.toFixed?.(2) ?? "—"} · VAH ${d?.vah?.toFixed?.(2) ?? "—"}. ${play?.watch || ""} Invalidation: ${play?.invalidation || "—"}. Sources: ${setup.sources.join(", ")}. Write before you act.`,
      symbol: setup.symbol,
      meta: {
        morning: true,
        dayKey,
        heat: play?.heat,
        levels: setup.levels,
        plays: setup.plays,
        sources: setup.sources,
      },
    });
  }

  return result;
}

/** Weekday local 7:25–7:40 window (default America/Chicago). */
export function isMorningScanWindow(at: Date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  if (["Sat", "Sun"].includes(weekday)) return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const mins = hour * 60 + minute;
  return mins >= 7 * 60 + 25 && mins <= 7 * 60 + 40;
}
