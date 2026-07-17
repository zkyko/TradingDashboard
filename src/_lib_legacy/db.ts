import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const globalDb = globalThis as unknown as { thesisDb?: Database.Database };
export const db = globalDb.thesisDb ?? new Database(path.join(dataDir, "thesis-loop.db"));
if (process.env.NODE_ENV !== "production") globalDb.thesisDb = db;

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS playbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  criteria TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trade_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('BULL','BEAR')),
  playbook_id INTEGER NOT NULL REFERENCES playbooks(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS plan_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_plan_id INTEGER NOT NULL REFERENCES trade_plans(id),
  version INTEGER NOT NULL,
  decision_type TEXT NOT NULL,
  thesis TEXT NOT NULL,
  market_context TEXT NOT NULL,
  evidence TEXT NOT NULL,
  val REAL NOT NULL, vah REAL NOT NULL, entry REAL NOT NULL, target REAL NOT NULL,
  invalidation REAL NOT NULL, quantity REAL NOT NULL, account_equity REAL NOT NULL,
  planned_risk REAL NOT NULL, hold_until TEXT NOT NULL, trigger_price REAL,
  change_reason TEXT,
  challenge_json TEXT NOT NULL,
  answers TEXT NOT NULL,
  embedding_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(trade_plan_id, version)
);
CREATE TABLE IF NOT EXISTS executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  ticker TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL,
  executed_at TEXT NOT NULL, decision_id INTEGER REFERENCES plan_versions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS position_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL, account_equity REAL NOT NULL, positions_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ROBINHOOD_MCP', fingerprint TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER REFERENCES executions(id),
  summary TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  explanation TEXT, classification TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_plan_id INTEGER NOT NULL REFERENCES trade_plans(id),
  adhered INTEGER NOT NULL, notes TEXT NOT NULL, reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS decision_drafts (
  id TEXT PRIMARY KEY,
  plan_json TEXT NOT NULL,
  challenge_json TEXT NOT NULL,
  embedding_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  draft_id TEXT REFERENCES decision_drafts(id) ON DELETE SET NULL,
  plan_version_id INTEGER REFERENCES plan_versions(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_type TEXT NOT NULL CHECK(period_type IN ('EOD','EOW','EOM')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(period_type, period_start, period_end)
);
CREATE TABLE IF NOT EXISTS brokerage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  accounts_json TEXT NOT NULL,
  portfolios_json TEXT NOT NULL,
  positions_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS broker_orders (
  external_id TEXT PRIMARY KEY,
  account_mask TEXT NOT NULL,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL,
  state TEXT NOT NULL,
  order_type TEXT NOT NULL,
  quantity REAL,
  filled_quantity REAL NOT NULL DEFAULT 0,
  average_price REAL,
  limit_price REAL,
  stop_price REAL,
  placed_agent TEXT,
  created_at TEXT NOT NULL,
  last_transaction_at TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS watchlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  thesis TEXT NOT NULL,
  setup TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  trigger_price REAL,
  invalidation REAL,
  target REAL,
  status TEXT NOT NULL DEFAULT 'WATCHING' CHECK(status IN ('WATCHING','READY','PASSED','ARCHIVED')),
  last_price REAL,
  previous_close REAL,
  quote_time TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS broker_option_orders (
  external_id TEXT PRIMARY KEY,
  account_mask TEXT NOT NULL,
  underlying TEXT NOT NULL,
  direction TEXT NOT NULL,
  state TEXT NOT NULL,
  strategy TEXT,
  quantity REAL NOT NULL,
  filled_quantity REAL NOT NULL,
  premium REAL,
  processed_premium REAL,
  created_at TEXT NOT NULL,
  last_transaction_at TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_plan_versions_plan ON plan_versions(trade_plan_id, version);
CREATE INDEX IF NOT EXISTS idx_exceptions_status ON reconciliation_exceptions(status);
CREATE INDEX IF NOT EXISTS idx_drafts_created ON decision_drafts(created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_version ON attachments(plan_version_id);
CREATE INDEX IF NOT EXISTS idx_reports_period ON reports(period_type, period_end);
CREATE INDEX IF NOT EXISTS idx_broker_orders_created ON broker_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist_items(status);
CREATE INDEX IF NOT EXISTS idx_option_orders_created ON broker_option_orders(created_at);
`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("attachments", "watchlist_item_id", "INTEGER REFERENCES watchlist_items(id) ON DELETE CASCADE");
ensureColumn("watchlist_items", "counsel_json", "TEXT");
ensureColumn("watchlist_items", "counsel_at", "TEXT");
ensureColumn("watchlist_items", "bid", "REAL");
ensureColumn("watchlist_items", "ask", "REAL");
ensureColumn("watchlist_items", "quote_state", "TEXT");
ensureColumn("watchlist_items", "quote_json", "TEXT");
db.exec(`CREATE INDEX IF NOT EXISTS idx_attachments_watchlist ON attachments(watchlist_item_id)`);

db.exec(`
CREATE TABLE IF NOT EXISTS watchlist_drafts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_watchlist_drafts_created ON watchlist_drafts(created_at);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  ticker TEXT,
  sentiment TEXT,
  tags_json TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created ON journal_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_journal_entries_ticker ON journal_entries(ticker);
`);

ensureColumn("attachments", "journal_entry_id", "TEXT");
db.exec(`CREATE INDEX IF NOT EXISTS idx_attachments_journal ON attachments(journal_entry_id)`);
ensureColumn("journal_entries", "fingerprint", "TEXT");
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_fingerprint ON journal_entries(fingerprint) WHERE fingerprint IS NOT NULL`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS shared_snapshots (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS watchlist_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_item_id INTEGER REFERENCES watchlist_items(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('added','refresh','shot','note','counsel','analyze')),
  summary TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS accountability_briefs (
  day_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_watchlist_activity_created ON watchlist_activity(created_at);
CREATE INDEX IF NOT EXISTS idx_watchlist_activity_symbol ON watchlist_activity(symbol);
CREATE INDEX IF NOT EXISTS idx_watchlist_activity_item ON watchlist_activity(watchlist_item_id);
`);

db.prepare(`INSERT OR IGNORE INTO playbooks (name, description, criteria) VALUES (?, ?, ?)`).run(
  "VAL to VAH",
  "Swing from value-area low toward value-area high while the broader trend supports the direction.",
  "Trend identified; entry near VAL; invalidation defined; VAH target is plausible; volume profile is current."
);

export function openExceptionCount() {
  return (db.prepare("SELECT COUNT(*) AS count FROM reconciliation_exceptions WHERE status = 'OPEN'").get() as { count: number }).count;
}

export function dashboardData() {
  const openPlans = db.prepare(`SELECT tp.*, p.name AS playbook_name, pv.*
    FROM trade_plans tp JOIN playbooks p ON p.id=tp.playbook_id
    JOIN plan_versions pv ON pv.trade_plan_id=tp.id AND pv.version=tp.current_version
    WHERE tp.status='OPEN' ORDER BY tp.created_at DESC`).all();
  const exceptions = db.prepare("SELECT * FROM reconciliation_exceptions WHERE status='OPEN' ORDER BY created_at DESC").all();
  const recent = db.prepare(`SELECT tp.ticker, tp.direction, pv.*, p.name AS playbook_name
    FROM plan_versions pv JOIN trade_plans tp ON tp.id=pv.trade_plan_id JOIN playbooks p ON p.id=tp.playbook_id
    ORDER BY pv.created_at DESC LIMIT 10`).all();
  const stats = db.prepare(`SELECT
    (SELECT COUNT(*) FROM plan_versions) AS decisions,
    (SELECT COUNT(*) FROM plan_versions WHERE version > 1) AS changes,
    (SELECT COUNT(*) FROM reconciliation_exceptions) AS exceptions,
    (SELECT COUNT(*) FROM reconciliation_exceptions WHERE status='RESOLVED') AS resolved`).get();
  const latestSnapshot = db.prepare("SELECT * FROM position_snapshots ORDER BY captured_at DESC LIMIT 1").get();
  const watchlist = db.prepare(`
    SELECT id, symbol, status, setup, thesis, timeframe, trigger_price, invalidation, target, last_price, previous_close, quote_time, updated_at
    FROM watchlist_items
    WHERE status IN ('WATCHING','READY')
    ORDER BY datetime(updated_at) DESC
    LIMIT 16
  `).all();
  return { openPlans, exceptions, recent, stats, latestSnapshot, watchlist };
}
