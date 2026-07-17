#!/usr/bin/env node
/**
 * Pull Robinhood (MCP) into local SQLite, then refresh review JSON.
 * Does not need the Next.js server.
 *
 *   npm run sync:rh
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dbPath = path.join(root, "data", "thesis-loop.db");

function contentJson(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const text = blocks.find((b) => b?.type === "text")?.text;
  if (!text) throw new Error("Robinhood MCP returned no JSON text content.");
  return JSON.parse(text);
}

function toolData(result) {
  const parsed = contentJson(result);
  return parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
}

function cursorFromNext(next) {
  if (!next) return null;
  try {
    return new URL(String(next)).searchParams.get("cursor");
  } catch {
    return null;
  }
}

async function pagedRead(client, tool, collection, baseArguments) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 100; page++) {
    const result = toolData(
      await client.callTool({
        name: tool,
        arguments: { ...baseArguments, ...(cursor ? { cursor } : {}) },
      }),
    );
    rows.push(...(result[collection] ?? []));
    cursor = cursorFromNext(result.next);
    if (!cursor) break;
  }
  return rows;
}

async function fetchSnapshot(Database) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  const command = path.join(root, "node_modules", ".bin", "mcp-remote");
  const args = ["https://agent.robinhood.com/mcp/trading", "--transport", "http-only"];
  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: "zkyko-sync", version: "0.3.0" });
  await client.connect(transport);

  try {
    const tools = await client.listTools();
    const needed = [
      "get_accounts",
      "get_portfolio",
      "get_equity_positions",
      "get_equity_orders",
      "get_option_orders",
    ];
    for (const name of needed) {
      if (!tools.tools.some((t) => t.name === name)) {
        throw new Error(`Required MCP tool '${name}' missing`);
      }
    }

    const db = new Database(dbPath);
    const lastBrokerage = db
      .prepare("SELECT captured_at FROM brokerage_snapshots ORDER BY captured_at DESC LIMIT 1")
      .get()?.captured_at;
    const fullHistory = !lastBrokerage;
    const since = lastBrokerage || new Date(Date.now() - 7 * 86400000).toISOString();
    const emptyOptions = !db.prepare("SELECT 1 FROM broker_option_orders LIMIT 1").get();
    db.close();

    const accountResult = await client.callTool({ name: "get_accounts", arguments: {} });
    const accounts = (toolData(accountResult).accounts ?? []).filter(
      (a) => !a.deactivated && !a.permanently_deactivated && a.state === "active",
    );
    if (!accounts.length) throw new Error("No active Robinhood accounts");

    const accountSnapshots = await Promise.all(
      accounts.map(async (account) => {
        const accountNumber = String(account.account_number);
        const optionArgs = { account_number: accountNumber };
        if (!emptyOptions) optionArgs.created_at_gte = since;
        const [portfolio, positions, orders, optionOrders] = await Promise.all([
          client.callTool({ name: "get_portfolio", arguments: { account_number: accountNumber } }),
          pagedRead(client, "get_equity_positions", "positions", { account_number: accountNumber }),
          pagedRead(client, "get_equity_orders", "orders", {
            account_number: accountNumber,
            ...(fullHistory ? {} : { created_at_gte: since }),
          }),
          pagedRead(client, "get_option_orders", "orders", optionArgs),
        ]);
        return {
          accountNumber,
          portfolio: toolData(portfolio),
          positions,
          orders,
          optionOrders,
        };
      }),
    );

    const positions = accountSnapshots.flatMap(({ positions }) =>
      positions.map((p) => ({
        ticker: String(p.symbol),
        quantity: Number(p.quantity),
        averagePrice: p.average_buy_price == null ? undefined : Number(p.average_buy_price),
      })),
    );
    const orders = accountSnapshots.flatMap(({ accountNumber, orders }) =>
      orders.map((o) => ({ ...o, account_number: accountNumber })),
    );
    const optionOrders = accountSnapshots.flatMap(({ accountNumber, optionOrders }) =>
      optionOrders.map((o) => ({ ...o, account_number: accountNumber })),
    );
    const executions = orders.flatMap((order) => {
      const fills = order.executions ?? [];
      return fills.map((fill) => ({
        externalId: String(fill.id),
        ticker: String(order.symbol),
        side: String(order.side).toUpperCase(),
        quantity: Number(fill.quantity),
        price: Number(fill.price),
        executedAt: String(fill.timestamp),
      }));
    });

    return {
      capturedAt: new Date().toISOString(),
      accountEquity: accountSnapshots.reduce(
        (sum, { portfolio }) => sum + Number(portfolio.total_value ?? 0),
        0,
      ),
      accounts,
      portfolios: accountSnapshots.map(({ accountNumber, portfolio }) => ({
        accountNumber,
        data: portfolio,
      })),
      positions,
      orders,
      optionOrders,
      executions,
    };
  } finally {
    await client.close();
  }
}

function reconcile(Database, snapshot) {
  const db = new Database(dbPath);
  const fingerprint = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const tx = db.transaction(() => {
    const prior = db.prepare("SELECT COUNT(*) AS c FROM position_snapshots").get().c;
    const isBaseline = prior === 0;
    const inserted = db
      .prepare(
        "INSERT OR IGNORE INTO position_snapshots (captured_at,account_equity,positions_json,fingerprint) VALUES (?,?,?,?)",
      )
      .run(snapshot.capturedAt, snapshot.accountEquity, JSON.stringify(snapshot.positions), fingerprint);
    db.prepare(
      "INSERT OR IGNORE INTO brokerage_snapshots (captured_at,accounts_json,portfolios_json,positions_json,fingerprint) VALUES (?,?,?,?,?)",
    ).run(
      snapshot.capturedAt,
      JSON.stringify(snapshot.accounts),
      JSON.stringify(snapshot.portfolios),
      JSON.stringify(snapshot.positions),
      fingerprint,
    );

    for (const order of snapshot.orders) {
      const accountNumber = String(order.account_number ?? "");
      const mask = accountNumber ? `••••${accountNumber.slice(-4)}` : "UNKNOWN";
      db.prepare(`INSERT INTO broker_orders (external_id,account_mask,ticker,side,state,order_type,quantity,filled_quantity,average_price,limit_price,stop_price,placed_agent,created_at,last_transaction_at,raw_json,synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(external_id) DO UPDATE SET state=excluded.state,filled_quantity=excluded.filled_quantity,average_price=excluded.average_price,last_transaction_at=excluded.last_transaction_at,raw_json=excluded.raw_json,synced_at=CURRENT_TIMESTAMP`)
        .run(
          String(order.id),
          mask,
          String(order.symbol),
          String(order.side).toUpperCase(),
          String(order.state),
          `${order.trigger === "stop" ? "STOP_" : ""}${String(order.type).toUpperCase()}`,
          order.quantity == null ? null : Number(order.quantity),
          Number(order.cumulative_quantity ?? 0),
          order.average_price == null ? null : Number(order.average_price),
          order.price == null ? null : Number(order.price),
          order.stop_price == null ? null : Number(order.stop_price),
          order.placed_agent == null ? null : String(order.placed_agent),
          String(order.created_at),
          order.last_transaction_at == null ? null : String(order.last_transaction_at),
          JSON.stringify(order),
        );
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
          order.processed_premium == null || order.processed_premium === ""
            ? null
            : Number(order.processed_premium),
          String(order.created_at),
          order.updated_at == null && order.last_transaction_at == null
            ? null
            : String(order.updated_at ?? order.last_transaction_at),
          JSON.stringify(order),
        );
    }

    let newFills = 0;
    for (const execution of snapshot.executions) {
      const insertedFill = db
        .prepare(
          `INSERT OR IGNORE INTO executions (external_id,ticker,side,quantity,price,executed_at,decision_id) VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          execution.externalId,
          execution.ticker,
          execution.side,
          execution.quantity,
          execution.price,
          execution.executedAt,
          null,
        );
      if (insertedFill.changes) newFills += 1;
    }
    return {
      snapshotInserted: Boolean(inserted.changes),
      newFills,
      baseline: isBaseline,
      equity: snapshot.accountEquity,
      executions: snapshot.executions.length,
    };
  });
  const result = tx();
  db.close();
  return result;
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error("Missing", dbPath);
    process.exit(1);
  }
  const Database = require("better-sqlite3");
  console.log("Pulling Robinhood via MCP…");
  const snapshot = await fetchSnapshot(Database);
  const result = reconcile(Database, snapshot);
  console.log(JSON.stringify({ ok: true, ...result, capturedAt: snapshot.capturedAt }, null, 2));

  // Refresh review JSON (preserves notes)
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "sync-review-data.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sync-review exit ${code}`))));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
