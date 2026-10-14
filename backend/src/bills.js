const express = require('express');
const { db, httpError } = require('./db');
const { requireAuth, requireStaff, verifyToken } = require('./auth');
const { billView, getBillRow, listBillRows } = require('./views');
const { subscribe } = require('./events');

// ---- Customer: own bills ----
const customerRouter = express.Router();
customerRouter.use(requireAuth);

customerRouter.get('/', (req, res) => {
  res.json({ bills: listBillRows('b.user_id = ?', req.user.id).map((r) => billView(r)) });
});

customerRouter.get('/:code', (req, res) => {
  const row = getBillRow('b.code = ? AND b.user_id = ?', req.params.code, req.user.id);
  if (!row) throw httpError(404, 'Bill not found');
  res.json({ bill: billView(row) });
});

// ---- Staff: bills of their own shop ----
const staffRouter = express.Router();

// EventSource cannot send headers, so the stream takes the token as a query parameter.
staffRouter.get('/stream', (req, res, next) => {
  const payload = verifyToken(String(req.query.token || ''));
  if (!payload || payload.role !== 'staff' || !payload.shopId) return next(httpError(401, 'Not allowed'));
  subscribe(payload.shopId, res);
});

staffRouter.use(requireStaff);

staffRouter.get('/bills', (req, res) => {
  const filter = String(req.query.status || 'all');
  const q = String(req.query.q || '').trim();
  let where = 'b.shop_id = ?';
  const params = [req.user.shopId];
  if (filter === 'pending') where += ' AND b.reviewed = 0';
  if (filter === 'reviewed') where += ' AND b.reviewed = 1';
  if (q) {
    where += ' AND (b.code LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const bills = listBillRows(where, ...params).map((r) => billView(r, { includeCustomer: true }));
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(reviewed = 0), 0) AS pending, COALESCE(SUM(total_cents), 0) AS revenueCents
       FROM bills WHERE shop_id = ?`
    )
    .get(req.user.shopId);
  res.json({ bills, stats: { ...stats } });
});

staffRouter.get('/bills/:code', (req, res) => {
  const row = getBillRow('b.code = ? AND b.shop_id = ?', req.params.code, req.user.shopId);
  if (!row) throw httpError(404, 'Bill not found');
  res.json({ bill: billView(row, { includeCustomer: true }) });
});

staffRouter.post('/bills/:code/review', (req, res) => {
  const row = getBillRow('b.code = ? AND b.shop_id = ?', req.params.code, req.user.shopId);
  if (!row) throw httpError(404, 'Bill not found');
  const note = String(req.body.note || '').trim().slice(0, 500);
  db.prepare(
    "UPDATE bills SET reviewed = 1, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?"
  ).run(req.user.id, note || null, row.id);
  res.json({ bill: billView(getBillRow('b.id = ?', row.id), { includeCustomer: true }) });
});

module.exports = { customerRouter, staffRouter };
