const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, httpError } = require('./db');
const { grantWelcomeCoupons } = require('./seed');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, shopId: u.shop_id };
}

function signToken(u) {
  return jwt.sign({ id: u.id, role: u.role, shopId: u.shop_id }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const payload = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
  if (!payload) return next(httpError(401, 'Please log in again'));
  req.user = payload;
  next();
}

function requireStaff(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'staff' || !req.user.shopId) return next(httpError(403, 'Staff access only'));
    next();
  });
}

const router = express.Router();

router.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) throw httpError(400, 'Please enter your name');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Please enter a valid email');
  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw httpError(409, 'An account with this email already exists');
  }
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 10), 'customer');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  grantWelcomeCoupons(user.id);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw httpError(401, 'Incorrect email or password');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) throw httpError(401, 'Please log in again');
  res.json({ user: publicUser(user) });
});

module.exports = { router, requireAuth, requireStaff, verifyToken };
