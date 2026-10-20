import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * SQLite via node:sqlite (spec 12.5). Rules: WAL; indexes on customer_id and dates; every "today" query takes the sandbox
 * clock as a parameter (never SQL date('now')); seed and reset run in-process inside one transaction.
 */
export type Db = DatabaseSync;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  source TEXT NOT NULL,
  signup_date TEXT NOT NULL,
  plan_cadence_days INTEGER NOT NULL,
  suggested_cadence_days INTEGER,
  size TEXT NOT NULL DEFAULT '12 oz',
  plan_type TEXT NOT NULL DEFAULT 'payg',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  consent_delivery INTEGER NOT NULL DEFAULT 0,
  consent_delivery_at TEXT,
  consent_offers INTEGER NOT NULL DEFAULT 0,
  consent_offers_at TEXT,
  signup_answers TEXT NOT NULL DEFAULT '{}',
  cancelled_at INTEGER,
  gift_ends TEXT,
  in_pilot INTEGER NOT NULL DEFAULT 0,
  base_arrival TEXT,
  proposal_count INTEGER NOT NULL DEFAULT 0,
  checkin_cycles_skipped INTEGER NOT NULL DEFAULT 0,
  held_until TEXT,
  cancel_prev_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_source ON customers(source);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  delivered_date TEXT,
  status TEXT NOT NULL,
  size TEXT NOT NULL DEFAULT '12 oz',
  price REAL NOT NULL DEFAULT 0,
  items TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_deliveries_customer ON deliveries(customer_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_date ON deliveries(scheduled_date, status);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id, at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason_code TEXT,
  status TEXT NOT NULL,
  offer_id INTEGER,
  snapshot TEXT NOT NULL DEFAULT '{}',
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_customer ON messages(customer_id, at);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status, at);
CREATE INDEX IF NOT EXISTS idx_messages_at ON messages(at);

CREATE TABLE IF NOT EXISTS projections (
  customer_id TEXT PRIMARY KEY,
  computed_at INTEGER NOT NULL,
  as_of_day INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  events_hash TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  family TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  audience TEXT NOT NULL DEFAULT '{}',
  holdout_mode TEXT NOT NULL DEFAULT 'global',
  holdout_pct REAL NOT NULL DEFAULT 0,
  caps TEXT NOT NULL DEFAULT '{}',
  approval_required INTEGER NOT NULL DEFAULT 0,
  budget REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  template TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  scheduled_at INTEGER,
  paused_reason TEXT
);

CREATE TABLE IF NOT EXISTS offer_assignments (
  offer_id INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  family TEXT NOT NULL,
  arm TEXT NOT NULL,
  message_id INTEGER,
  accepted_at INTEGER,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (offer_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_assign_customer ON offer_assignments(customer_id);

CREATE TABLE IF NOT EXISTS experiment_membership (
  customer_id TEXT NOT NULL,
  offer_id INTEGER NOT NULL,
  family TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  outcome_closes_at INTEGER NOT NULL,
  PRIMARY KEY (customer_id, offer_id)
);

CREATE TABLE IF NOT EXISTS global_holdout (
  customer_id TEXT PRIMARY KEY,
  assigned_at INTEGER NOT NULL,
  until_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_customer ON notes(customer_id, at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  customer_id TEXT,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit_log(customer_id, at);

CREATE TABLE IF NOT EXISTS retail_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  kind TEXT NOT NULL,
  bags_per_week INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS retail_lots (
  code TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  roast TEXT NOT NULL,
  roast_date TEXT NOT NULL,
  shipped_date TEXT NOT NULL,
  bags INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lots_account ON retail_lots(account_id, shipped_date);

CREATE TABLE IF NOT EXISTS qr_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_code TEXT NOT NULL,
  at INTEGER NOT NULL,
  customer_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_scans_lot ON qr_scans(lot_code, at);
CREATE INDEX IF NOT EXISTS idx_scans_at ON qr_scans(at);

CREATE TABLE IF NOT EXISTS qr_signups (
  customer_id TEXT PRIMARY KEY,
  scan_id INTEGER NOT NULL,
  lot_code TEXT NOT NULL,
  phone TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const TABLES = ["customers", "deliveries", "events", "messages", "projections", "offers", "offer_assignments", "experiment_membership", "global_holdout", "notes", "audit_log", "settings", "retail_accounts", "retail_lots", "qr_scans", "qr_signups"] as const;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  if (path !== ":memory:") db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside one transaction; rolls back on any error. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function resetTables(db: Db): void {
  for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM sqlite_sequence");
}

export function all<T = Record<string, unknown>>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T = Record<string, unknown>>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = get<{ value: string }>(db, "SELECT value FROM settings WHERE key = ?", key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  run(db, "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
}
