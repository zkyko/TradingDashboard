import { db } from "./db";
import { dayKeyInZone, daysInMonth, DEFAULT_TIMEZONE, monthKey, weekdayForDateKey } from "./timezone";

export type ActivityKind = "added" | "refresh" | "shot" | "note" | "counsel" | "analyze";

export type WatchActivity = {
  id: number;
  watchlistItemId: number | null;
  symbol: string;
  kind: ActivityKind;
  summary: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type WatchCalendarDay = {
  date: string;
  count: number;
  symbols: string[];
  activities: WatchActivity[];
};

export type WatchCalendarMonth = {
  year: number;
  month: number;
  timeZone: string;
  days: WatchCalendarDay[];
  monthCount: number;
};

export function logWatchActivity(input: {
  watchlistItemId?: number | null;
  symbol: string;
  kind: ActivityKind;
  summary?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return null;
  const result = db.prepare(`
    INSERT INTO watchlist_activity (watchlist_item_id, symbol, kind, summary, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.watchlistItemId ?? null,
    symbol,
    input.kind,
    input.summary ?? null,
    input.payload ? JSON.stringify(input.payload) : null,
  );
  return Number(result.lastInsertRowid);
}

function rowToActivity(row: Record<string, unknown>): WatchActivity {
  let payload: Record<string, unknown> | null = null;
  if (row.payload_json) {
    try { payload = JSON.parse(String(row.payload_json)); } catch { payload = null; }
  }
  return {
    id: Number(row.id),
    watchlistItemId: row.watchlist_item_id == null ? null : Number(row.watchlist_item_id),
    symbol: String(row.symbol),
    kind: String(row.kind) as ActivityKind,
    summary: row.summary == null ? null : String(row.summary),
    payload,
    createdAt: String(row.created_at),
  };
}

export function listActivityForSymbol(symbol: string, limit = 100): WatchActivity[] {
  const rows = db.prepare(`
    SELECT * FROM watchlist_activity
    WHERE symbol = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(symbol.trim().toUpperCase(), limit) as Array<Record<string, unknown>>;
  return rows.map(rowToActivity);
}

export function listActivityForItem(watchlistItemId: number, limit = 100): WatchActivity[] {
  const rows = db.prepare(`
    SELECT * FROM watchlist_activity
    WHERE watchlist_item_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(watchlistItemId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToActivity);
}

/** Also fold attachment shots + original add into the timeline if not already logged. */
export function timelineForWatchItem(watchlistItemId: number, symbol: string): WatchActivity[] {
  const logged = listActivityForItem(watchlistItemId, 200);
  const item = db.prepare(`
    SELECT id, symbol, thesis, setup, created_at FROM watchlist_items WHERE id=?
  `).get(watchlistItemId) as { id: number; symbol: string; thesis: string; setup: string; created_at: string } | undefined;

  const shots = db.prepare(`
    SELECT id, caption, created_at, original_name FROM attachments
    WHERE watchlist_item_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(watchlistItemId) as Array<Record<string, unknown>>;

  const loggedShotIds = new Set(
    logged
      .filter((a) => a.kind === "shot" && a.payload?.attachmentId)
      .map((a) => String(a.payload!.attachmentId)),
  );

  const synthetic: WatchActivity[] = shots
    .filter((s) => !loggedShotIds.has(String(s.id)))
    .map((s) => ({
      id: -Number(String(s.id).replace(/\D/g, "").slice(0, 8) || 1),
      watchlistItemId,
      symbol: symbol.toUpperCase(),
      kind: "shot" as const,
      summary: String(s.caption || s.original_name || "Screenshot"),
      payload: { attachmentId: String(s.id), url: `/api/attachments/${s.id}` },
      createdAt: String(s.created_at),
    }));

  const hasAdded = logged.some((a) => a.kind === "added");
  if (item && !hasAdded) {
    synthetic.push({
      id: -900000 - watchlistItemId,
      watchlistItemId,
      symbol: symbol.toUpperCase(),
      kind: "added",
      summary: item.setup || "Added to watch",
      payload: { thesis: item.thesis },
      createdAt: item.created_at,
    });
  }

  return [...logged, ...synthetic].sort((a, b) => {
    const ta = new Date(a.createdAt.includes("T") ? a.createdAt : `${a.createdAt}Z`).getTime();
    const tb = new Date(b.createdAt.includes("T") ? b.createdAt : `${b.createdAt}Z`).getTime();
    return tb - ta;
  });
}

export function computeWatchCalendarMonth(
  year: number,
  month: number,
  timeZone = DEFAULT_TIMEZONE,
): WatchCalendarMonth {
  const y = Math.max(2000, Math.min(2100, Math.floor(year)));
  const m = Math.max(1, Math.min(12, Math.floor(month)));
  const prefix = monthKey(y, m);

  // Broader pull then filter by timezone day
  const allRecent = db.prepare(`
    SELECT * FROM watchlist_activity
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 2000
  `).all() as Array<Record<string, unknown>>;

  const byDay = new Map<string, WatchCalendarDay>();
  for (const row of allRecent) {
    const activity = rowToActivity(row);
    const date = dayKeyInZone(activity.createdAt, timeZone);
    if (!date.startsWith(prefix)) continue;
    const day = byDay.get(date) ?? { date, count: 0, symbols: [], activities: [] };
    day.activities.push(activity);
    day.count += 1;
    if (!day.symbols.includes(activity.symbol)) day.symbols.push(activity.symbol);
    byDay.set(date, day);
  }

  // Include attachment-only days for watchlist items
  const attachments = db.prepare(`
    SELECT a.id, a.caption, a.created_at, a.original_name, a.watchlist_item_id, w.symbol
    FROM attachments a
    JOIN watchlist_items w ON w.id = a.watchlist_item_id
    WHERE a.watchlist_item_id IS NOT NULL
    ORDER BY datetime(a.created_at) DESC
    LIMIT 1000
  `).all() as Array<Record<string, unknown>>;

  for (const shot of attachments) {
    const date = dayKeyInZone(String(shot.created_at), timeZone);
    if (!date.startsWith(prefix)) continue;
    const symbol = String(shot.symbol).toUpperCase();
    const day = byDay.get(date) ?? { date, count: 0, symbols: [], activities: [] };
    const already = day.activities.some(
      (a) => a.kind === "shot" && a.payload?.attachmentId === String(shot.id),
    );
    if (!already) {
      day.activities.push({
        id: -1,
        watchlistItemId: Number(shot.watchlist_item_id),
        symbol,
        kind: "shot",
        summary: String(shot.caption || shot.original_name || "Screenshot"),
        payload: { attachmentId: String(shot.id), url: `/api/attachments/${shot.id}` },
        createdAt: String(shot.created_at),
      });
      day.count += 1;
      if (!day.symbols.includes(symbol)) day.symbols.push(symbol);
      byDay.set(date, day);
    }
  }

  const days = [...byDay.values()]
    .map((d) => ({
      ...d,
      activities: d.activities.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    year: y,
    month: m,
    timeZone,
    days,
    monthCount: days.reduce((s, d) => s + d.count, 0),
  };
}

export { daysInMonth, weekdayForDateKey };
