// Customer profile: account details, shopping stats and coupons.
const express = require('express');
const { db, httpError } = require('./db');
const { requireAuth } = require('./auth');
const { grantWelcomeCoupons } = require('./seed');

function couponView(row) {
  return {
    code: row.code,
    title: row.title,
    description: row.description,
    kind: row.kind,
    value: row.value,
    minSpendCents: row.min_spend_cents,
    maxDiscountCents: row.max_discount_cents,
    shopName: row.shop_name || null,
    expiresAt: row.expires_at,
    used: !!row.used_at,
    usedAt: row.used_at,
    billCode: row.bill_code,
    expired: !!row.expires_at && row.expires_at < new Date().toISOString().slice(0, 10),
  };
}

function listCoupons(userId) {
  return db
    .prepare(
      `SELECT c.*, s.name AS shop_name, uc.used_at, uc.bill_code
       FROM user_coupons uc
       JOIN coupons c ON c.id = uc.coupon_id
       LEFT JOIN shops s ON s.id = c.shop_id
       WHERE uc.user_id = ? AND c.active = 1
       ORDER BY uc.used_at IS NOT NULL, c.expires_at, c.id`
    )
    .all(userId)
    .map(couponView);
}

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) throw httpError(401, 'Please log in again');

  // Customers created before coupons existed still get their welcome set.
  grantWelcomeCoupons(user.id);

  const stats = db
    .prepare(
      `SELECT COUNT(*) AS billCount, COALESCE(SUM(total_cents), 0) AS totalSpentCents
       FROM bills WHERE user_id = ?`
    )
    .get(user.id);

  const itemsScanned = db
    .prepare(
      `SELECT COALESCE(SUM(json_extract(value, '$.quantity')), 0) AS n
       FROM bills, json_each(bills.items_json) WHERE bills.user_id = ?`
    )
    .get(user.id).n;

  const favourite = db
    .prepare(
      `SELECT s.name AS shopName, COUNT(*) AS visits FROM bills b JOIN shops s ON s.id = b.shop_id
       WHERE b.user_id = ? GROUP BY b.shop_id ORDER BY visits DESC, s.name LIMIT 1`
    )
    .get(user.id);

  const coupons = listCoupons(user.id);

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      memberSince: user.created_at ? user.created_at.replace(' ', 'T') + 'Z' : null,
    },
    stats: {
      billCount: stats.billCount,
      totalSpentCents: stats.totalSpentCents,
      itemsScanned: Number(itemsScanned) || 0,
      favouriteShop: favourite?.shopName ?? null,
      couponsAvailable: coupons.filter((c) => !c.used && !c.expired).length,
    },
    coupons,
  });
});

router.patch('/', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2) throw httpError(400, 'Please enter your name');
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

module.exports = { router, listCoupons };
