import { createHash } from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { db } from "./db";
import type { RobinhoodSnapshot } from "./types";

function contentJson(result: unknown): Record<string, unknown> {
  if (typeof result === "object" && result !== null && "structuredContent" in result) {
    const structured = (result as { structuredContent?: unknown }).structuredContent;
    if (structured && typeof structured === "object") return structured as Record<string, unknown>;
  }
  const content = typeof result === "object" && result !== null && "content" in result ? (result as { content?: unknown }).content : undefined;
  const blocks = Array.isArray(content) ? content as Array<{ type?: string; text?: string }> : [];
  const text = blocks.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Robinhood MCP returned no JSON text content.");
  return JSON.parse(text) as Record<string, unknown>;
}

function toolData(result: unknown) {
  const parsed = contentJson(result);
  return (parsed.data && typeof parsed.data === "object" ? parsed.data : parsed) as Record<string, unknown>;
}

function connectionConfig() {
  const command = process.env.ROBINHOOD_MCP_COMMAND || path.join(process.cwd(), "node_modules", ".bin", "mcp-remote");
  const args = process.env.ROBINHOOD_MCP_ARGS
    ? JSON.parse(process.env.ROBINHOOD_MCP_ARGS) as string[]
    : ["https://agent.robinhood.com/mcp/trading", "--transport", "http-only"];
  return { command, args };
}

async function connectedClient() {
  const transport = new StdioClientTransport(connectionConfig());
  const client = new Client({ name: "zkyko", version: "0.2.0" });
  await client.connect(transport);
  return client;
}

function cursorFromNext(next: unknown) {
  if (!next) return null;
  try { return new URL(String(next)).searchParams.get("cursor"); } catch { return null; }
}

async function pagedRead(client: Client, tool: string, collection: string, baseArguments: Record<string, unknown>) {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const result = toolData(await client.callTool({ name: tool, arguments: { ...baseArguments, ...(cursor ? { cursor } : {}) } }));
    rows.push(...((result[collection] ?? []) as Array<Record<string, unknown>>));
    cursor = cursorFromNext(result.next);
    if (!cursor) break;
  }
  return rows;
}

export async function fetchRobinhoodSnapshot(opts: { fullOptions?: boolean } = {}): Promise<RobinhoodSnapshot> {
  const client = await connectedClient();
  try {
    const tools = await client.listTools();
    // This is the complete capability boundary for Zkyko. Never derive tool
    // permissions from descriptions or expose arbitrary Robinhood tools to a model.
    const accountTool = "get_accounts";
    const portfolioTool = "get_portfolio";
    const positionsTool = "get_equity_positions";
    const ordersTool = "get_equity_orders";
    const optionOrdersTool = "get_option_orders";
    for (const name of [accountTool, portfolioTool, positionsTool, ordersTool, optionOrdersTool]) {
      if (!tools.tools.some((t) => t.name === name)) throw new Error(`Required read-only MCP tool '${name}' was not found.`);
    }
    const accountResult = await client.callTool({ name: accountTool, arguments: {} });
    const accounts = (toolData(accountResult).accounts ?? []) as Array<Record<string, unknown>>;
    const activeAccounts = accounts.filter((account) => !account.deactivated && !account.permanently_deactivated && account.state === "active");
    if (!activeAccounts.length) throw new Error("Robinhood returned no active brokerage accounts.");

    const fullHistory = !(db.prepare("SELECT 1 FROM brokerage_snapshots LIMIT 1").get());
    const emptyOptions = !(db.prepare("SELECT 1 FROM broker_option_orders LIMIT 1").get());
    const pullAllOptions = Boolean(opts.fullOptions) || emptyOptions;
    const accountSnapshots = await Promise.all(activeAccounts.map(async (account) => {
      const accountNumber = String(account.account_number);
      const optionArgs: Record<string, unknown> = { account_number: accountNumber };
      if (!pullAllOptions) optionArgs.created_at_gte = lastBrokerageSyncTime();
      const [portfolio, positions, orders, optionOrders] = await Promise.all([
        client.callTool({ name: portfolioTool, arguments: { account_number: accountNumber } }),
        pagedRead(client, positionsTool, "positions", { account_number: accountNumber }),
        pagedRead(client, ordersTool, "orders", { account_number: accountNumber, ...(!fullHistory ? { created_at_gte: lastBrokerageSyncTime() } : {}) }),
        pagedRead(client, optionOrdersTool, "orders", optionArgs),
      ]);
      return { accountNumber, portfolio: toolData(portfolio), positions, orders, optionOrders };
    }));

    const positions = accountSnapshots.flatMap(({ positions }) => positions).map((position) => ({
      ticker: String(position.symbol),
      quantity: Number(position.quantity),
      averagePrice: position.average_buy_price == null ? undefined : Number(position.average_buy_price),
    }));
    const orders: Array<Record<string, unknown>> = accountSnapshots.flatMap(({ accountNumber, orders }) => orders.map((order) => ({ ...order, account_number: accountNumber })));
    const optionOrders: Array<Record<string, unknown>> = accountSnapshots.flatMap(({ accountNumber, optionOrders }) => optionOrders.map((order) => ({ ...order, account_number: accountNumber })));
    const executions = orders.flatMap((order) => {
      const fills = (order.executions ?? []) as Array<Record<string, unknown>>;
      return fills.map((fill) => ({
        externalId: String(fill.id), ticker: String(order.symbol),
        side: String(order.side).toUpperCase() as "BUY" | "SELL",
        quantity: Number(fill.quantity), price: Number(fill.price), executedAt: String(fill.timestamp),
      }));
    });
    return {
      capturedAt: new Date().toISOString(),
      accountEquity: accountSnapshots.reduce((sum, { portfolio }) => sum + Number(portfolio.total_value ?? 0), 0),
      accounts: activeAccounts,
      portfolios: accountSnapshots.map(({ accountNumber, portfolio }) => ({ accountNumber, data: portfolio })),
      positions,
      orders,
      optionOrders,
      executions,
    };
  } finally {
    await client.close();
  }
}

export type RobinhoodQuote = {
  symbol: string;
  price: number;
  previousClose: number;
  quoteTime: string;
  bid: number;
  ask: number;
  bidSize?: number | null;
  askSize?: number | null;
  state: string;
  lastExtendedHoursPrice?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  volume?: number | null;
  instrumentName?: string | null;
  raw?: Record<string, unknown>;
};

export type RhScanRow = {
  ticker: string;
  instrumentType?: string;
  columns: Record<string, string | number | null>;
  last?: number | null;
  changePct?: number | null;
  volume?: number | null;
  relativeVolume?: number | null;
  relativeOptionsVolume?: number | null;
  name?: string | null;
};

export type RhScanBucket = {
  key: string;
  title: string;
  scanId?: string;
  rows: RhScanRow[];
  error?: string;
};

function numCol(cols: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = cols[key];
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function mapScanResults(raw: unknown): RhScanRow[] {
  const payload = raw as Record<string, unknown>;
  const result = (payload.result && typeof payload.result === "object" ? payload.result : payload) as Record<string, unknown>;
  const rows = (result.results ?? result.items ?? []) as Array<Record<string, unknown>>;
  const out: RhScanRow[] = [];
  for (const row of rows) {
    const columns = (row.columns && typeof row.columns === "object" ? row.columns : {}) as Record<string, unknown>;
    const ticker = String(row.ticker ?? row.symbol ?? columns.Symbol ?? "").toUpperCase();
    if (!ticker) continue;
    const changeRaw = numCol(columns, "% Change", "Percent change", "Change %");
    out.push({
      ticker,
      instrumentType: row.instrument_type ? String(row.instrument_type) : undefined,
      columns: Object.fromEntries(
        Object.entries(columns).map(([k, v]) => [k, v == null ? null : typeof v === "number" ? v : String(v)]),
      ),
      last: numCol(columns, "Last", "Price", "last"),
      changePct: changeRaw == null ? null : Math.abs(changeRaw) <= 2 ? changeRaw * 100 : changeRaw,
      volume: numCol(columns, "Volume", "volume"),
      relativeVolume: numCol(columns, "Relative volume", "Rel Volume"),
      relativeOptionsVolume: numCol(columns, "Relative options volume", "Options volume"),
      name: columns.Name == null ? null : String(columns.Name),
    });
  }
  return out;
}

async function ensureScan(
  client: Client,
  title: string,
  createArgs: Record<string, unknown>,
): Promise<{ scanId: string; rows: RhScanRow[] }> {
  const listed = toolData(await client.callTool({ name: "get_scans", arguments: {} }));
  const scans = (listed.scans ?? []) as Array<Record<string, unknown>>;
  const existing = scans.find((s) => String(s.title || "") === title);
  if (existing?.scan_id) {
    const ran = toolData(await client.callTool({ name: "run_scan", arguments: { scan_id: String(existing.scan_id) } }));
    return { scanId: String(existing.scan_id), rows: mapScanResults(ran) };
  }
  const created = toolData(await client.callTool({ name: "create_scan", arguments: { ...createArgs, title } }));
  const result = (created.result && typeof created.result === "object" ? created.result : created) as Record<string, unknown>;
  const scanId = String(result.scan_id || "");
  if (!scanId) throw new Error(`create_scan did not return id for ${title}`);
  // create_scan already returns initial results
  const rows = mapScanResults(created);
  if (rows.length) return { scanId, rows };
  const ran = toolData(await client.callTool({ name: "run_scan", arguments: { scan_id: scanId } }));
  return { scanId, rows: mapScanResults(ran) };
}

/**
 * Robinhood morning tape: daily gainers/losers, high options volume, high stock volume,
 * plus curated Daily movers list. Read/scan tools only — no orders.
 */
export async function fetchRobinhoodMorningTape(): Promise<{
  buckets: RhScanBucket[];
  symbols: string[];
  capturedAt: string;
}> {
  const client = await connectedClient();
  try {
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((t) => t.name));
    for (const need of ["get_scans", "create_scan", "run_scan", "get_popular_watchlists", "get_watchlist_items"]) {
      if (!names.has(need)) throw new Error(`Robinhood MCP missing ${need}`);
    }

    const buckets: RhScanBucket[] = [];

    const gainer = await ensureScan(client, "Zkyko Daily Gainers", { preset: "DAILY_GAINERS" });
    buckets.push({ key: "gainers", title: "Daily gainers", scanId: gainer.scanId, rows: gainer.rows });

    const loser = await ensureScan(client, "Zkyko Daily Losers", { preset: "DAILY_LOSERS" });
    buckets.push({ key: "losers", title: "Daily losers", scanId: loser.scanId, rows: loser.rows });

    const opt = await ensureScan(client, "Zkyko High Options Volume", {
      preset: "HIGH_OPTIONS_VOLUME_IV",
    });
    const optRows = [...opt.rows].sort(
      (a, b) => (b.relativeOptionsVolume ?? 0) - (a.relativeOptionsVolume ?? 0),
    );
    buckets.push({
      key: "options_volume",
      title: "Highest options volume",
      scanId: opt.scanId,
      rows: optRows,
    });

    // Relative volume (stock volume proxy). Prefer equity rows; fall back to sorting options scan by Volume.
    let volRows: RhScanRow[] = [];
    let volScanId: string | undefined;
    try {
      const vol = await ensureScan(client, "Zkyko Rel Volume", {
        filters: [
          {
            filter_type: "FILTER_TYPE_RELATIVE_VOLUME",
            predicate: "PREDICATE_GREATER_THAN",
            values: ["1.5"],
            interval: "1d",
          },
        ],
      });
      volScanId = vol.scanId;
      volRows = vol.rows.filter((r) => (r.instrumentType || "EQUITY").toUpperCase() !== "CRYPTO");
    } catch (err) {
      buckets.push({
        key: "stock_volume",
        title: "Highest stock volume",
        error: err instanceof Error ? err.message : "Relative volume scan failed",
        rows: [],
      });
    }
    if (!volRows.length) {
      volRows = [...opt.rows].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    } else {
      volRows = [...volRows].sort(
        (a, b) => (b.volume ?? b.relativeVolume ?? 0) - (a.volume ?? a.relativeVolume ?? 0),
      );
    }
    const existingVol = buckets.find((b) => b.key === "stock_volume");
    if (existingVol) {
      existingVol.rows = volRows;
      existingVol.scanId = volScanId;
    } else {
      buckets.push({
        key: "stock_volume",
        title: "Highest stock volume",
        scanId: volScanId,
        rows: volRows,
      });
    }

    // Curated Robinhood "Daily movers"
    try {
      const popular = toolData(await client.callTool({ name: "get_popular_watchlists", arguments: {} }));
      const lists = (popular.lists ?? []) as Array<Record<string, unknown>>;
      const movers = lists.find((l) => /daily movers/i.test(String(l.display_name || "")));
      if (movers?.id) {
        const items = toolData(
          await client.callTool({ name: "get_watchlist_items", arguments: { list_id: String(movers.id) } }),
        );
        const rows = ((items.items ?? []) as Array<Record<string, unknown>>)
          .filter((it) => String(it.object_type || "") === "instrument" && it.symbol)
          .map((it) => ({
            ticker: String(it.symbol).toUpperCase(),
            instrumentType: "EQUITY",
            columns: {},
            last: null,
            changePct: null,
            volume: null,
            relativeVolume: null,
            relativeOptionsVolume: null,
            name: null,
          }));
        buckets.push({ key: "daily_movers", title: "RH Daily movers", rows });
      }
    } catch (err) {
      buckets.push({
        key: "daily_movers",
        title: "RH Daily movers",
        rows: [],
        error: err instanceof Error ? err.message : "Daily movers failed",
      });
    }

    const quality = (row: RhScanRow) => {
      if (!/^[A-Z]{1,5}$/.test(row.ticker)) return false;
      if (row.last != null && row.last > 0 && row.last < 2) return false;
      return true;
    };

    const pick = (key: string, n: number, sort?: (a: RhScanRow, b: RhScanRow) => number) => {
      const bucket = buckets.find((b) => b.key === key);
      if (!bucket) return [] as string[];
      const rows = sort ? [...bucket.rows].sort(sort) : bucket.rows;
      return rows.filter(quality).slice(0, n).map((r) => r.ticker);
    };

    // Skip curated daily_movers OTC junk for VP — still shown in the bucket list.
    const symbols = [
      ...pick("gainers", 6, (a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)),
      ...pick("losers", 6, (a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)),
      ...pick("options_volume", 8, (a, b) => (b.relativeOptionsVolume ?? 0) - (a.relativeOptionsVolume ?? 0)),
      ...pick("stock_volume", 8, (a, b) => (b.volume ?? b.relativeVolume ?? 0) - (a.volume ?? a.relativeVolume ?? 0)),
    ];

    return {
      buckets: buckets.map((b) => ({ ...b, rows: b.rows.filter(quality).slice(0, 15) })),
      symbols: [...new Set(symbols)].slice(0, 24),
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await client.close();
  }
}

export async function fetchRobinhoodQuotes(symbols: string[]): Promise<RobinhoodQuote[]> {
  const clean = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  if (!clean.length) return [];
  const client = await connectedClient();
  try {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === "get_equity_quotes")) throw new Error("Robinhood quote tool is unavailable.");
    const data = toolData(await client.callTool({ name: "get_equity_quotes", arguments: { symbols: clean } }));
    return ((data.results ?? []) as Array<Record<string, unknown>>).map((entry) => {
      const quote = (entry.quote ?? entry) as Record<string, unknown>;
      const close = entry.close as Record<string, unknown> | undefined;
      const instrument = (entry.instrument ?? entry.symbol_data ?? {}) as Record<string, unknown>;
      const regularTime = quote.venue_last_trade_time ? new Date(String(quote.venue_last_trade_time)).getTime() : 0;
      const nonRegularTime = quote.venue_last_non_reg_trade_time ? new Date(String(quote.venue_last_non_reg_trade_time)).getTime() : 0;
      const useExtended = nonRegularTime > regularTime;
      const price = Number(useExtended ? quote.last_non_reg_trade_price ?? quote.last_trade_price : quote.last_trade_price ?? quote.last_non_reg_trade_price);
      return {
        symbol: String(quote.symbol ?? entry.symbol ?? "").toUpperCase(),
        price,
        previousClose: Number(close?.price ?? quote.adjusted_previous_close ?? quote.previous_close ?? 0),
        quoteTime: String(
          useExtended
            ? quote.venue_last_non_reg_trade_time ?? quote.venue_last_trade_time ?? new Date().toISOString()
            : quote.venue_last_trade_time ?? quote.venue_last_non_reg_trade_time ?? new Date().toISOString(),
        ),
        bid: Number(quote.bid_price ?? 0),
        ask: Number(quote.ask_price ?? 0),
        bidSize: quote.bid_size == null ? null : Number(quote.bid_size),
        askSize: quote.ask_size == null ? null : Number(quote.ask_size),
        state: String(quote.state ?? entry.state ?? "unknown"),
        lastExtendedHoursPrice: quote.last_non_reg_trade_price == null ? null : Number(quote.last_non_reg_trade_price),
        high: quote.high_price == null && quote.high == null ? null : Number(quote.high_price ?? quote.high),
        low: quote.low_price == null && quote.low == null ? null : Number(quote.low_price ?? quote.low),
        open: quote.open_price == null && quote.open == null ? null : Number(quote.open_price ?? quote.open),
        volume: quote.volume == null ? null : Number(quote.volume),
        instrumentName: instrument.name ? String(instrument.name) : instrument.simple_name ? String(instrument.simple_name) : null,
        raw: entry,
      };
    }).filter((quote) => quote.symbol);
  } finally {
    await client.close();
  }
}

export function localTickerContext(symbol: string) {
  const ticker = symbol.trim().toUpperCase();
  const snapshot = db.prepare("SELECT positions_json,captured_at,account_equity FROM position_snapshots ORDER BY captured_at DESC LIMIT 1").get() as
    | { positions_json: string; captured_at: string; account_equity: number }
    | undefined;
  const positions = snapshot ? JSON.parse(snapshot.positions_json) as Array<{ ticker: string; quantity: number; averagePrice?: number }> : [];
  const position = positions.find((row) => row.ticker.toUpperCase() === ticker) ?? null;
  const orders = db.prepare(`SELECT external_id,side,state,order_type,quantity,filled_quantity,average_price,created_at,placed_agent
    FROM broker_orders WHERE ticker=? ORDER BY datetime(created_at) DESC LIMIT 12`).all(ticker) as Array<Record<string, unknown>>;
  const openPlan = db.prepare(`SELECT tp.id,tp.ticker,tp.direction,tp.status,pv.thesis,pv.entry,pv.invalidation,pv.target,pv.planned_risk,pv.hold_until,p.name AS playbook_name
    FROM trade_plans tp
    JOIN plan_versions pv ON pv.trade_plan_id=tp.id AND pv.version=tp.current_version
    JOIN playbooks p ON p.id=tp.playbook_id
    WHERE tp.ticker=? AND tp.status='OPEN' LIMIT 1`).get(ticker) as Record<string, unknown> | undefined;
  const watchItem = db.prepare("SELECT id,status,setup,thesis FROM watchlist_items WHERE symbol=?").get(ticker) as Record<string, unknown> | undefined;
  return {
    symbol: ticker,
    snapshotAt: snapshot?.captured_at ?? null,
    accountEquity: snapshot?.account_equity ?? null,
    position,
    orders,
    openPlan: openPlan ?? null,
    watchItem: watchItem ?? null,
  };
}

export type MarketBar = { time: string; open: number; high: number; low: number; close: number; volume: number };
export type MarketContext = {
  historicals: MarketBar[];
  fundamentals: Record<string, unknown> | null;
  technicals: {
    rsi: number | null;
    sma20: number | null;
    sma50: number | null;
    macd: Record<string, unknown> | null;
  };
  trend: {
    windowReturnPct: number | null;
    higherHighs: boolean | null;
    aboveSma20: boolean | null;
    rangePosition: number | null;
  };
};

function asBars(raw: unknown): MarketBar[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      time: String(item.begins_at ?? item.timestamp ?? item.time ?? ""),
      open: Number(item.open_price ?? item.open ?? 0),
      high: Number(item.high_price ?? item.high ?? 0),
      low: Number(item.low_price ?? item.low ?? 0),
      close: Number(item.close_price ?? item.close ?? item.price ?? 0),
      volume: Number(item.volume ?? 0),
    };
  }).filter((bar) => bar.close > 0);
}

function latestIndicatorValue(payload: Record<string, unknown>): number | null {
  const series = (payload.data ?? payload.values ?? payload.results ?? payload) as unknown;
  if (Array.isArray(series) && series.length) {
    const last = series[series.length - 1] as Record<string, unknown>;
    const value = last.value ?? last.rsi ?? last.sma ?? last.ema ?? last.close;
    return value == null ? null : Number(value);
  }
  if (typeof payload.value === "number") return Number(payload.value);
  return null;
}

/** Read-only market context for journal pages. Never calls write/order tools. */
export async function fetchMarketContext(
  symbolRaw: string,
  days = 90,
  interval: "day" | "hour" | "10minute" | "5minute" = "day",
): Promise<MarketContext & { interval: string; intervalFallback?: string }> {
  const symbol = symbolRaw.trim().toUpperCase();
  const windowDays = Math.max(5, Math.min(365 * 5, Math.round(days)));
  const end = new Date();
  const start = new Date(Date.now() - windowDays * 86400000);
  const client = await connectedClient();
  try {
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    const required = ["get_equity_historicals", "get_equity_fundamentals", "get_equity_technical_indicators"];
    for (const name of required) {
      if (!names.has(name)) throw new Error(`Required read-only MCP tool '${name}' was not found.`);
    }

    const startTime = start.toISOString();
    const endTime = end.toISOString();
    const safeCall = async (name: string, args: Record<string, unknown>) => {
      try { return toolData(await client.callTool({ name, arguments: args })); }
      catch { return null; }
    };

    let usedInterval = interval;
    let intervalFallback: string | undefined;
    let histData = await safeCall("get_equity_historicals", {
      symbols: [symbol],
      start_time: startTime,
      end_time: endTime,
      interval,
      bounds: "regular",
    });

    const parseBars = (payload: Record<string, unknown> | null): MarketBar[] => {
      if (!payload) return [];
      const histCollection = (payload.historicals ?? payload.results ?? payload[symbol] ?? payload) as unknown;
      if (Array.isArray(histCollection)) return asBars(histCollection);
      if (histCollection && typeof histCollection === "object") {
        const nested = histCollection as Record<string, unknown>;
        return asBars(nested.historicals ?? nested.data ?? nested.results ?? nested[symbol]);
      }
      return [];
    };

    let historicals = parseBars(histData);
    if (!historicals.length && interval !== "day") {
      histData = await safeCall("get_equity_historicals", {
        symbols: [symbol],
        start_time: startTime,
        end_time: endTime,
        interval: "day",
        bounds: "regular",
      });
      historicals = parseBars(histData);
      usedInterval = "day";
      intervalFallback = `Requested ${interval}; MCP returned no bars — using day.`;
    }

    const indInterval = usedInterval === "day" ? "day" : usedInterval;
    const [fundData, rsiData, sma20Data, sma50Data, macdData] = await Promise.all([
      safeCall("get_equity_fundamentals", { symbols: [symbol], bounds: "regular" }),
      safeCall("get_equity_technical_indicators", { symbol, type: "rsi", interval: indInterval, start_time: startTime, end_time: endTime, length: 14 }),
      safeCall("get_equity_technical_indicators", { symbol, type: "sma", interval: indInterval, start_time: startTime, end_time: endTime, length: 20 }),
      safeCall("get_equity_technical_indicators", { symbol, type: "sma", interval: indInterval, start_time: startTime, end_time: endTime, length: 50 }),
      safeCall("get_equity_technical_indicators", { symbol, type: "macd", interval: indInterval, start_time: startTime, end_time: endTime }),
    ]);

    const fundList = ((fundData?.results ?? fundData?.fundamentals ?? []) as Array<Record<string, unknown>>);
    const fundamentals = fundList.find((row) => String(row.symbol ?? "").toUpperCase() === symbol)
      ?? (fundData?.[symbol] as Record<string, unknown> | undefined)
      ?? (fundData && Object.keys(fundData).length ? fundData : null);

    const rsi = rsiData ? latestIndicatorValue(rsiData) : null;
    const sma20 = sma20Data ? latestIndicatorValue(sma20Data) : null;
    const sma50 = sma50Data ? latestIndicatorValue(sma50Data) : null;

    const first = historicals[0];
    const last = historicals[historicals.length - 1];
    const windowReturnPct = first && last ? ((last.close / first.close) - 1) * 100 : null;
    const recent = historicals.slice(-10);
    const higherHighs = recent.length >= 4
      ? recent[recent.length - 1].high >= Math.max(...recent.slice(0, -1).map((bar) => bar.high))
      : null;
    const aboveSma20 = last && sma20 != null ? last.close > sma20 : null;
    const windowHigh = historicals.length ? Math.max(...historicals.map((bar) => bar.high)) : null;
    const windowLow = historicals.length ? Math.min(...historicals.map((bar) => bar.low)) : null;
    const rangePosition = last && windowHigh != null && windowLow != null && windowHigh !== windowLow
      ? (last.close - windowLow) / (windowHigh - windowLow)
      : null;

    return {
      historicals,
      fundamentals,
      technicals: { rsi, sma20, sma50, macd: macdData },
      trend: { windowReturnPct, higherHighs, aboveSma20, rangePosition },
      interval: usedInterval,
      intervalFallback,
    };
  } finally {
    await client.close();
  }
}

function lastSyncTime() {
  const row = db.prepare("SELECT captured_at FROM position_snapshots ORDER BY captured_at DESC LIMIT 1").get() as { captured_at?: string } | undefined;
  return row?.captured_at ?? new Date(Date.now() - 7 * 86400000).toISOString();
}

function lastBrokerageSyncTime() {
  const row = db.prepare("SELECT captured_at FROM brokerage_snapshots ORDER BY captured_at DESC LIMIT 1").get() as { captured_at?: string } | undefined;
  return row?.captured_at ?? lastSyncTime();
}

export function reconcileSnapshot(snapshot: RobinhoodSnapshot) {
  const fingerprint = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const transaction = db.transaction(() => {
    const priorSnapshotCount = (db.prepare("SELECT COUNT(*) AS count FROM position_snapshots").get() as { count: number }).count;
    const isOnboardingBaseline = priorSnapshotCount === 0;
    const isBrokerageHistoryBaseline = (db.prepare("SELECT COUNT(*) AS count FROM brokerage_snapshots").get() as { count: number }).count === 0;
    const insertedSnapshot = db.prepare("INSERT OR IGNORE INTO position_snapshots (captured_at,account_equity,positions_json,fingerprint) VALUES (?,?,?,?)")
      .run(snapshot.capturedAt, snapshot.accountEquity, JSON.stringify(snapshot.positions), fingerprint);
    db.prepare("INSERT OR IGNORE INTO brokerage_snapshots (captured_at,accounts_json,portfolios_json,positions_json,fingerprint) VALUES (?,?,?,?,?)")
      .run(snapshot.capturedAt, JSON.stringify(snapshot.accounts), JSON.stringify(snapshot.portfolios), JSON.stringify(snapshot.positions), fingerprint);
    for (const order of snapshot.orders) {
      const accountNumber = String(order.account_number ?? "");
      const mask = accountNumber ? `••••${accountNumber.slice(-4)}` : "UNKNOWN";
      db.prepare(`INSERT INTO broker_orders (external_id,account_mask,ticker,side,state,order_type,quantity,filled_quantity,average_price,limit_price,stop_price,placed_agent,created_at,last_transaction_at,raw_json,synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(external_id) DO UPDATE SET state=excluded.state,filled_quantity=excluded.filled_quantity,average_price=excluded.average_price,last_transaction_at=excluded.last_transaction_at,raw_json=excluded.raw_json,synced_at=CURRENT_TIMESTAMP`)
        .run(String(order.id), mask, String(order.symbol), String(order.side).toUpperCase(), String(order.state), `${order.trigger === "stop" ? "STOP_" : ""}${String(order.type).toUpperCase()}`,
          order.quantity == null ? null : Number(order.quantity), Number(order.cumulative_quantity ?? 0), order.average_price == null ? null : Number(order.average_price),
          order.price == null ? null : Number(order.price), order.stop_price == null ? null : Number(order.stop_price), order.placed_agent == null ? null : String(order.placed_agent),
          String(order.created_at), order.last_transaction_at == null ? null : String(order.last_transaction_at), JSON.stringify(order));
    }
    for (const order of snapshot.optionOrders) {
      const accountNumber = String(order.account_number ?? "");
      const mask = accountNumber ? `••••${accountNumber.slice(-4)}` : "UNKNOWN";
      const strategy = String(order.opening_strategy || order.closing_strategy || order.strategy || "") || null;
      const filled = Number(order.processed_quantity ?? order.filled_quantity ?? order.cumulative_quantity ?? 0);
      db.prepare(`INSERT INTO broker_option_orders (external_id,account_mask,underlying,direction,state,strategy,quantity,filled_quantity,premium,processed_premium,created_at,last_transaction_at,raw_json,synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(external_id) DO UPDATE SET state=excluded.state,filled_quantity=excluded.filled_quantity,premium=excluded.premium,processed_premium=excluded.processed_premium,last_transaction_at=excluded.last_transaction_at,raw_json=excluded.raw_json,synced_at=CURRENT_TIMESTAMP`)
        .run(
          String(order.id),
          mask,
          String(order.chain_symbol || order.symbol || "UNKNOWN").toUpperCase(),
          String(order.direction || "unknown").toLowerCase(),
          String(order.state || "unknown"),
          strategy,
          Number(order.quantity ?? 0),
          filled,
          order.premium == null || order.premium === "" ? null : Number(order.premium),
          order.processed_premium == null || order.processed_premium === "" ? null : Number(order.processed_premium),
          String(order.created_at),
          order.updated_at == null && order.last_transaction_at == null ? null : String(order.updated_at ?? order.last_transaction_at),
          JSON.stringify(order),
        );
    }
    let exceptions = 0;
    for (const execution of snapshot.executions) {
      const matchingDecision = db.prepare(`SELECT pv.id FROM plan_versions pv JOIN trade_plans tp ON tp.id=pv.trade_plan_id
        WHERE tp.ticker=? AND datetime(pv.created_at) BETWEEN datetime(?, '-1 day') AND datetime(?, '+1 day') ORDER BY pv.created_at DESC LIMIT 1`)
        .get(execution.ticker, execution.executedAt, execution.executedAt) as { id: number } | undefined;
      const inserted = db.prepare(`INSERT OR IGNORE INTO executions (external_id,ticker,side,quantity,price,executed_at,decision_id) VALUES (?,?,?,?,?,?,?)`)
        .run(execution.externalId, execution.ticker, execution.side, execution.quantity, execution.price, execution.executedAt, matchingDecision?.id ?? null);
      if (inserted.changes && !matchingDecision && !isOnboardingBaseline && !isBrokerageHistoryBaseline) {
        db.prepare("INSERT INTO reconciliation_exceptions (execution_id,summary) VALUES (?,?)").run(
          inserted.lastInsertRowid,
          `${execution.side} ${execution.quantity} ${execution.ticker} at ${execution.price} has no matching committed decision.`
        );
        exceptions++;
      }
    }
    return { snapshotInserted: Boolean(insertedSnapshot.changes), exceptions, baseline: isOnboardingBaseline || isBrokerageHistoryBaseline };
  });
  return transaction();
}
