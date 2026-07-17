import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { fetchRobinhoodQuotes, fetchMarketContext, localTickerContext, type MarketContext, type RobinhoodQuote } from "./robinhood";
import { logWatchActivity } from "./watchlist-activity";

export type TickerSnapshot = {
  symbol: string;
  capturedAt: string;
  quote: RobinhoodQuote;
  changePct: number | null;
  local: ReturnType<typeof localTickerContext>;
  market: MarketContext | null;
  insight: Record<string, unknown> | null;
  source: "lookup" | "hourly" | "manual";
};

const cacheDir = path.join(process.cwd(), "data", "ticker-cache");

function ensureCacheDir() {
  fs.mkdirSync(cacheDir, { recursive: true });
}

export function tickerCachePath(symbol: string) {
  return path.join(cacheDir, `${symbol.trim().toUpperCase()}.json`);
}

export function writeTickerSnapshot(snapshot: TickerSnapshot) {
  try {
    ensureCacheDir();
    const file = tickerCachePath(snapshot.symbol);
    // Compact JSON — disk can be tight on local machines.
    fs.writeFileSync(file, JSON.stringify(snapshot), "utf8");
    return file;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    if (code === "ENOSPC") {
      console.warn(`[ticker-cache] ENOSPC writing ${snapshot.symbol}; continuing without file cache.`);
      return "";
    }
    throw error;
  }
}

export function readTickerSnapshot(symbol: string): TickerSnapshot | null {
  const file = tickerCachePath(symbol);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as TickerSnapshot;
  } catch {
    return null;
  }
}

export function deleteTickerSnapshot(symbol: string) {
  const file = tickerCachePath(symbol);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

export function applyQuoteToWatchlist(quote: RobinhoodQuote, snapshotJson: string) {
  db.prepare(`UPDATE watchlist_items
    SET last_price=?, previous_close=?, quote_time=?, bid=?, ask=?, quote_state=?, quote_json=?, updated_at=CURRENT_TIMESTAMP
    WHERE symbol=?`).run(
    quote.price,
    quote.previousClose,
    quote.quoteTime,
    quote.bid,
    quote.ask,
    quote.state,
    snapshotJson,
    quote.symbol,
  );
}

export async function buildTickerSnapshot(
  symbolRaw: string,
  source: TickerSnapshot["source"] = "lookup",
  days = 90,
  interval: "day" | "hour" | "10minute" | "5minute" = "day",
): Promise<TickerSnapshot> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error("Enter a valid ticker symbol.");
  const [quotes, local, market] = await Promise.all([
    fetchRobinhoodQuotes([symbol]),
    Promise.resolve(localTickerContext(symbol)),
    fetchMarketContext(symbol, days, interval).catch(() => null),
  ]);
  const quote = quotes.find((entry) => entry.symbol === symbol) ?? quotes[0];
  if (!quote) throw new Error(`Robinhood returned no quote for ${symbol}.`);
  const changePct = quote.previousClose ? ((quote.price / quote.previousClose) - 1) * 100 : null;
  return {
    symbol,
    capturedAt: new Date().toISOString(),
    quote,
    changePct,
    local,
    market,
    insight: null,
    source,
  };
}

export async function lookupAndStageTicker(
  symbolRaw: string,
  days = 90,
  interval: "day" | "hour" | "10minute" | "5minute" = "day",
) {
  const snapshot = await buildTickerSnapshot(symbolRaw, "lookup", days, interval);
  const file = writeTickerSnapshot(snapshot);
  const existing = db.prepare("SELECT id,status FROM watchlist_items WHERE symbol=?").get(snapshot.symbol) as { id: number; status: string } | undefined;

  if (existing) {
    applyQuoteToWatchlist(snapshot.quote, JSON.stringify(snapshot));
    db.prepare("DELETE FROM watchlist_drafts WHERE symbol=?").run(snapshot.symbol);
    return {
      snapshot,
      file,
      draftId: null as string | null,
      onWatchlist: true,
      watchlistId: existing.id,
      status: existing.status,
    };
  }

  const draftId = randomUUID();
  db.prepare(`INSERT INTO watchlist_drafts (id, symbol, payload_json, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(symbol) DO UPDATE SET id=excluded.id, payload_json=excluded.payload_json, created_at=CURRENT_TIMESTAMP`)
    .run(draftId, snapshot.symbol, JSON.stringify(snapshot));

  return {
    snapshot,
    file,
    draftId,
    onWatchlist: false,
    watchlistId: null as number | null,
    status: null as string | null,
  };
}

export function discardTickerDraft(draftId: string) {
  const draft = db.prepare("SELECT id,symbol FROM watchlist_drafts WHERE id=?").get(draftId) as { id: string; symbol: string } | undefined;
  if (!draft) throw new Error("Draft not found.");
  const onWatchlist = db.prepare("SELECT 1 FROM watchlist_items WHERE symbol=?").get(draft.symbol);
  db.prepare("DELETE FROM watchlist_drafts WHERE id=?").run(draftId);
  if (!onWatchlist) deleteTickerSnapshot(draft.symbol);
  return { symbol: draft.symbol, deletedJson: !onWatchlist };
}

export function commitTickerDraft(draftId: string, fields: {
  setup?: string;
  thesis?: string;
  timeframe?: string;
  triggerPrice?: number | null;
  invalidation?: number | null;
  target?: number | null;
}) {
  const draft = db.prepare("SELECT * FROM watchlist_drafts WHERE id=?").get(draftId) as { id: string; symbol: string; payload_json: string } | undefined;
  if (!draft) throw new Error("Draft not found. Pull the ticker again.");
  const snapshot = JSON.parse(draft.payload_json) as TickerSnapshot;
  const setup = String(fields.setup || "").trim() || "Setup pending";
  const thesis = String(fields.thesis || "").trim() || "Added from Robinhood lookup — document observable setup conditions.";
  const timeframe = String(fields.timeframe || "").trim() || "2–3 week swing";
  const quote = snapshot.quote;

  const result = db.prepare(`INSERT INTO watchlist_items
    (symbol,thesis,setup,timeframe,trigger_price,invalidation,target,status,last_price,previous_close,quote_time,bid,ask,quote_state,quote_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    draft.symbol,
    thesis,
    setup,
    timeframe,
    fields.triggerPrice ?? null,
    fields.invalidation ?? null,
    fields.target ?? null,
    "WATCHING",
    quote.price,
    quote.previousClose,
    quote.quoteTime,
    quote.bid,
    quote.ask,
    quote.state,
    JSON.stringify(snapshot),
  );

  writeTickerSnapshot({ ...snapshot, source: "lookup" });
  db.prepare("DELETE FROM watchlist_drafts WHERE id=?").run(draftId);
  const id = Number(result.lastInsertRowid);
  logWatchActivity({
    watchlistItemId: id,
    symbol: draft.symbol,
    kind: "added",
    summary: setup,
    payload: { thesis, timeframe },
  });
  return { id, symbol: draft.symbol, snapshot };
}

export async function refreshWatchlistSnapshots(source: TickerSnapshot["source"] = "hourly") {
  const rows = db.prepare("SELECT symbol FROM watchlist_items WHERE status!='ARCHIVED'").all() as Array<{ symbol: string }>;
  if (!rows.length) {
    purgeStaleDrafts();
    return { updated: 0, symbols: [] as string[] };
  }
  const quotes = await fetchRobinhoodQuotes(rows.map((row) => row.symbol));
  const updated: string[] = [];
  for (const quote of quotes) {
    const local = localTickerContext(quote.symbol);
    const changePct = quote.previousClose ? ((quote.price / quote.previousClose) - 1) * 100 : null;
    const prior = readTickerSnapshot(quote.symbol);
    const market = source === "hourly"
      ? (prior?.market ?? null)
      : await fetchMarketContext(quote.symbol).catch(() => prior?.market ?? null);
    const snapshot: TickerSnapshot = {
      symbol: quote.symbol,
      capturedAt: new Date().toISOString(),
      quote,
      changePct,
      local,
      market,
      insight: prior?.insight ?? null,
      source,
    };
    writeTickerSnapshot(snapshot);
    applyQuoteToWatchlist(quote, JSON.stringify(snapshot));
    updated.push(quote.symbol);
  }
  purgeStaleDrafts();
  return { updated: updated.length, symbols: updated };
}

export function purgeStaleDrafts(maxAgeHours = 24) {
  const stale = db.prepare(`SELECT id, symbol FROM watchlist_drafts
    WHERE datetime(created_at) < datetime('now', ?)`).all(`-${maxAgeHours} hours`) as Array<{ id: string; symbol: string }>;
  for (const draft of stale) {
    const onWatchlist = db.prepare("SELECT 1 FROM watchlist_items WHERE symbol=?").get(draft.symbol);
    db.prepare("DELETE FROM watchlist_drafts WHERE id=?").run(draft.id);
    if (!onWatchlist) deleteTickerSnapshot(draft.symbol);
  }
  return stale.length;
}
