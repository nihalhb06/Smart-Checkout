// Shapes database rows into the JSON the apps consume. Money is always integer cents.
const { db } = require('./db');

function cartView(cartId) {
  const cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(cartId);
  const rows = db
    .prepare(
      `SELECT p.id AS productId, p.barcode, p.name, p.price_cents AS priceCents, ci.quantity
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = ? ORDER BY p.name`
    )
    .all(cartId);
  const items = rows.map((r) => ({ ...r, lineTotalCents: r.priceCents * r.quantity }));
  return {
    id: cart.id,
    shopId: cart.shop_id,
    status: cart.status,
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    totalCents: items.reduce((n, i) => n + i.lineTotalCents, 0),
  };
}

const BILL_SELECT = `
  SELECT b.*, s.name AS shop_name, u.name AS customer_name, u.email AS customer_email,
         r.name AS reviewer_name, pay.method AS payment_method, pay.reference AS payment_ref
  FROM bills b
  JOIN payments pay ON pay.id = b.payment_id
  JOIN shops s ON s.id = b.shop_id
  JOIN users u ON u.id = b.user_id
  LEFT JOIN users r ON r.id = b.reviewed_by`;

function billView(row, { includeCustomer = false } = {}) {
  const items = JSON.parse(row.items_json);
  const view = {
    code: row.code,
    shopId: row.shop_id,
    shopName: row.shop_name,
    totalCents: row.total_cents,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    items,
    paidAt: row.paid_at.replace(' ', 'T') + 'Z', // sqlite datetime('now') is UTC
    reviewed: !!row.reviewed,
    reviewedAt: row.reviewed_at ? row.reviewed_at.replace(' ', 'T') + 'Z' : null,
    reviewNote: row.review_note,
    paymentMethod: row.payment_method,
    paymentRef: row.payment_ref,
  };
  if (includeCustomer) {
    view.customer = { name: row.customer_name, email: row.customer_email };
    view.reviewedBy = row.reviewer_name || null;
  }
  return view;
}

function getBillRow(where, ...params) {
  return db.prepare(`${BILL_SELECT} WHERE ${where}`).get(...params);
}

function listBillRows(where, ...params) {
  return db.prepare(`${BILL_SELECT} WHERE ${where} ORDER BY b.paid_at DESC, b.id DESC LIMIT 200`).all(...params);
}

module.exports = { cartView, billView, getBillRow, listBillRows };
