import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { deriveVpPlays } from "@/lib/vp-plays";
import { fetchLiveBoard, LIVE_DEFAULT_SYMBOLS } from "@/lib/python-service";
import { getTraderPlan } from "@/lib/trader-plan";
import { DEFAULT_TIMEZONE, nowContext } from "@/lib/timezone";

db.exec(`
CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('above','below')),
  price REAL NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_price REAL,
  triggered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(active, symbol);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  symbol TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, created_at DESC);
`);

export type PriceAlert = {
  id: string;
  symbol: string;
  direction: "above" | "below";
  price: number;
  note: string | null;
  active: boolean;
  last_price: number | null;
  triggered_at: string | null;
  created_at: string;
};

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  symbol: string | null;
  read: boolean;
  meta_json: string | null;
  created_at: string;
};

function mapAlert(row: Record<string, unknown>): PriceAlert {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    direction: row.direction === "below" ? "below" : "above",
    price: Number(row.price),
    note: row.note == null ? null : String(row.note),
    active: Boolean(row.active),
    last_price: row.last_price == null ? null : Number(row.last_price),
    triggered_at: row.triggered_at == null ? null : String(row.triggered_at),
    created_at: String(row.created_at),
  };
}

function mapNote(row: Record<string, unknown>): AppNotification {
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    body: String(row.body),
    symbol: row.symbol == null ? null : String(row.symbol),
    read: Boolean(row.read),
    meta_json: row.meta_json == null ? null : String(row.meta_json),
    created_at: String(row.created_at),
  };
}

export function listPriceAlerts(includeInactive = false): PriceAlert[] {
  const rows = includeInactive
    ? db.prepare(`SELECT * FROM price_alerts ORDER BY datetime(created_at) DESC`).all()
    : db.prepare(`SELECT * FROM price_alerts WHERE active=1 ORDER BY datetime(created_at) DESC`).all();
  return (rows as Array<Record<string, unknown>>).map(mapAlert);
}

export function createPriceAlert(input: {
  symbol: string;
  direction: "above" | "below";
  price: number;
  note?: string;
}): PriceAlert {
  const id = randomUUID();
  const symbol = input.symbol.trim().toUpperCase();
  db.prepare(
    `INSERT INTO price_alerts (id, symbol, direction, price, note, active) VALUES (?,?,?,?,?,1)`,
  ).run(id, symbol, input.direction, input.price, input.note?.trim() || null);
  return listPriceAlerts(true).find((a) => a.id === id)!;
}

export function deletePriceAlert(id: string) {
  db.prepare(`DELETE FROM price_alerts WHERE id=?`).run(id);
}

export function setPriceAlertActive(id: string, active: boolean) {
  db.prepare(`UPDATE price_alerts SET active=? WHERE id=?`).run(active ? 1 : 0, id);
}

export function listNotifications(limit = 80): AppNotification[] {
  const rows = db
    .prepare(`SELECT * FROM notifications ORDER BY datetime(created_at) DESC LIMIT ?`)
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(mapNote);
}

export function unreadNotificationCount() {
  return (db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE read=0`).get() as { c: number }).c;
}

export function markNotificationRead(id: string, read = true) {
  db.prepare(`UPDATE notifications SET read=? WHERE id=?`).run(read ? 1 : 0, id);
}

export function markAllNotificationsRead() {
  db.prepare(`UPDATE notifications SET read=1 WHERE read=0`).run();
}

export function pushNotification(input: {
  kind: string;
  title: string;
  body: string;
  symbol?: string | null;
  meta?: Record<string, unknown>;
}) {
  // Dedupe identical kind+symbol+title in last 2 hours
  const recent = db
    .prepare(
      `SELECT id FROM notifications
       WHERE kind=? AND IFNULL(symbol,'')=IFNULL(?, '') AND title=?
         AND datetime(created_at) >= datetime('now', '-2 hours')
       LIMIT 1`,
    )
    .get(input.kind, input.symbol ?? null, input.title) as { id?: string } | undefined;
  if (recent?.id) return recent.id;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO notifications (id, kind, title, body, symbol, read, meta_json) VALUES (?,?,?,?,?,0,?)`,
  ).run(
    id,
    input.kind,
    input.title,
    input.body,
    input.symbol ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
  );
  return id;
}

async function fetchLastPrices(symbols: string[]): Promise<Record<string, number>> {
  const clean = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!clean.length) return {};
  const url = process.env.ZK_PYTHON_URL || "http://127.0.0.1:8765";
  try {
    const response = await fetch(`${url}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbols: clean }),
      signal: AbortSignal.timeout(45000),
    });
    const body = await response.json();
    const out: Record<string, number> = {};
    for (const row of (body.quotes || []) as Array<{ symbol?: string; price?: number }>) {
      if (row.symbol && row.price != null && Number.isFinite(Number(row.price))) {
        out[String(row.symbol).toUpperCase()] = Number(row.price);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function evaluatePriceAlert(alert: PriceAlert, last: number): boolean {
  if (alert.direction === "above") return last >= alert.price;
  return last <= alert.price;
}

/** Cron tick: price alerts + forming/live VP setups on leveraged ETF universe. */
export async function runNotificationTick(opts: { timeZone?: string } = {}) {
  const now = nowContext(opts.timeZone || DEFAULT_TIMEZONE);
  const plan = getTraderPlan();
  const alerts = listPriceAlerts(false);
  const symbols = [
    ...alerts.map((a) => a.symbol),
    ...plan.universe,
    ...LIVE_DEFAULT_SYMBOLS,
  ];
  const prices = await fetchLastPrices(symbols);

  let priceHits = 0;
  for (const alert of alerts) {
    const last = prices[alert.symbol];
    if (last == null) continue;
    db.prepare(`UPDATE price_alerts SET last_price=? WHERE id=?`).run(last, alert.id);
    if (!evaluatePriceAlert(alert, last)) continue;
    pushNotification({
      kind: "price",
      title: `${alert.symbol} ${alert.direction} ${alert.price}`,
      body: `${now.clock}: ${alert.symbol} last ${last.toFixed(2)} hit your ${alert.direction} ${alert.price} alert.${alert.note ? ` Note: ${alert.note}` : ""} Write before you act.`,
      symbol: alert.symbol,
      meta: { alertId: alert.id, last, target: alert.price, direction: alert.direction },
    });
    db.prepare(`UPDATE price_alerts SET active=0, triggered_at=? WHERE id=?`).run(new Date().toISOString(), alert.id);
    priceHits += 1;
  }

  let setupHits = 0;
  try {
    const board = await fetchLiveBoard("15m", [...new Set(plan.universe)].slice(0, 10), true);
    for (const tape of board.symbols || []) {
      if (tape.error || !tape.last) continue;
      const plays = deriveVpPlays(tape).filter((p) => p.status === "live" || p.status === "forming");
      const hot = plays.filter((p) => p.heat >= 70).slice(0, 2);
      for (const play of hot) {
        pushNotification({
          kind: "setup",
          title: `${tape.symbol}: ${play.name} (${play.status})`,
          body: `${now.clock}: ${play.tagline}. ${play.watch} Invalidation: ${play.invalidation}. Heat ${play.heat}. Write the decision before any click.`,
          symbol: tape.symbol,
          meta: { playId: play.id, status: play.status, heat: play.heat, bias: play.bias },
        });
        setupHits += 1;
      }
    }
  } catch (err) {
    pushNotification({
      kind: "system",
      title: "Setup scan skipped",
      body: `${now.clock}: live board unavailable — ${err instanceof Error ? err.message : "error"}. Price alerts still checked.`,
    });
  }

  // Morning: open Premarket + write-before-trade (weekdays ~6–10 local)
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: now.timeZone, hour: "numeric", hour12: false }).format(new Date()),
  );
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: now.timeZone, weekday: "short" }).format(new Date());
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  if (isWeekday && hour >= 6 && hour <= 10) {
    pushNotification({
      kind: "premarket",
      title: "Check Premarket",
      body: `${now.clock}: Open Premarket — economic calendar, earnings, and sector heatmap before you trade. Leveraged ETFs only; write thesis + invalidation first.`,
      meta: { href: "/premarket" },
    });
    pushNotification({
      kind: "reminder",
      title: "Write before you trade",
      body: `${now.clock}: Leveraged ETFs only. Identify trend + swing. Note thesis and invalidation before any buy/sell. No options.`,
    });
  }

  return {
    ok: true,
    at: now.line,
    priceHits,
    setupHits,
    pricesChecked: Object.keys(prices).length,
    unread: unreadNotificationCount(),
  };
}

export function notificationsForAi(limit = 8) {
  return listNotifications(limit)
    .filter((n) => !n.read)
    .map((n) => ({
      kind: n.kind,
      title: n.title,
      body: n.body,
      symbol: n.symbol,
      at: n.created_at,
    }));
}
