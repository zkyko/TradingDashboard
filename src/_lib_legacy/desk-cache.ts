import { db } from "@/lib/db";
import { dayKeyInZone, DEFAULT_TIMEZONE } from "@/lib/timezone";

db.exec(`
CREATE TABLE IF NOT EXISTS desk_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_desk_cache_updated ON desk_cache(updated_at DESC);
`);

export function getDeskCache<T>(key: string): { value: T; updatedAt: string } | null {
  const row = db.prepare(`SELECT payload_json, updated_at FROM desk_cache WHERE cache_key=?`).get(key) as
    | { payload_json: string; updated_at: string }
    | undefined;
  if (!row) return null;
  try {
    return { value: JSON.parse(row.payload_json) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function setDeskCache(key: string, value: unknown) {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO desk_cache (cache_key, payload_json, updated_at) VALUES (?,?,?)
     ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
  ).run(key, JSON.stringify(value), updatedAt);
  return updatedAt;
}

export function dayCacheKey(prefix: string, dayKey = dayKeyInZone(new Date(), DEFAULT_TIMEZONE)) {
  return `${prefix}:${dayKey}`;
}

export function getDayCache<T>(prefix: string, dayKey?: string) {
  return getDeskCache<T>(dayCacheKey(prefix, dayKey));
}

export function setDayCache(prefix: string, value: unknown, dayKey?: string) {
  return setDeskCache(dayCacheKey(prefix, dayKey), value);
}

export type SparSession = {
  id: string;
  question: string;
  result: Record<string, unknown>;
  createdAt: string;
};

export function listSparSessions(limit = 12): SparSession[] {
  const hit = getDeskCache<SparSession[]>("spar:history");
  return (hit?.value || []).slice(0, limit);
}

export function pushSparSession(session: SparSession) {
  const prev = listSparSessions(40);
  const next = [session, ...prev.filter((s) => s.id !== session.id)].slice(0, 40);
  setDeskCache("spar:history", next);
  setDeskCache("spar:latest", session);
  return next;
}
