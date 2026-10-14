// SQLite via Node's built-in node:sqlite (Node >= 22.13) - no native modules to compile.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbFile = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'shop.db');
if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'staff')),
  shop_id INTEGER REFERENCES shops(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  UNIQUE (shop_id, barcode)
);

CREATE TABLE IF NOT EXISTS carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_payment', 'paid', 'abandoned')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  cart_id INTEGER NOT NULL REFERENCES carts(id),
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  cart_id INTEGER NOT NULL UNIQUE REFERENCES carts(id),
  payment_id TEXT NOT NULL REFERENCES payments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  total_cents INTEGER NOT NULL,
  items_json TEXT NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed INTEGER NOT NULL DEFAULT 0,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'flat')),
  value INTEGER NOT NULL CHECK (value > 0),
  min_spend_cents INTEGER NOT NULL DEFAULT 0,
  max_discount_cents INTEGER,
  shop_id INTEGER REFERENCES shops(id),
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_coupons (
  user_id INTEGER NOT NULL REFERENCES users(id),
  coupon_id INTEGER NOT NULL REFERENCES coupons(id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT,
  bill_code TEXT,
  PRIMARY KEY (user_id, coupon_id)
);

CREATE INDEX IF NOT EXISTS idx_bills_shop ON bills(shop_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_bills_user ON bills(user_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id, status);
`);

function addColumn(table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('payments', 'method', "TEXT NOT NULL DEFAULT 'card'");
addColumn('payments', 'reference', 'TEXT');
addColumn('payments', 'bill_code', 'TEXT');
addColumn('shops', 'upi_id', 'TEXT');
// In-store location of a product, so the assistant can answer "where is X?".
addColumn('products', 'aisle', "TEXT NOT NULL DEFAULT ''");
addColumn('products', 'shelf', "TEXT NOT NULL DEFAULT ''");
addColumn('products', 'section', "TEXT NOT NULL DEFAULT ''");
// Shop details the assistant and the shop list present to customers.
addColumn('shops', 'icon', "TEXT NOT NULL DEFAULT '🏪'");
addColumn('shops', 'tagline', "TEXT NOT NULL DEFAULT ''");
addColumn('shops', 'hours', "TEXT NOT NULL DEFAULT '9:00 AM - 10:00 PM, all days'");
addColumn('shops', 'phone', "TEXT NOT NULL DEFAULT ''");

/** Run fn inside a write transaction; rolls back if it throws. */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Error carrying an HTTP status, turned into a JSON response by the error middleware. */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { db, tx, httpError };
