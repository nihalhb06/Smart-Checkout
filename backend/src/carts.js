const express = require('express');
const { db, tx, httpError } = require('./db');
const { requireAuth } = require('./auth');
const { cartView } = require('./views');

const MAX_QTY = 99;
const router = express.Router();
router.use(requireAuth);

function ownedCart(req) {
  const cart = db.prepare('SELECT * FROM carts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!cart) throw httpError(404, 'Cart not found');
  return cart;
}

function activeCart(req) {
  const cart = ownedCart(req);
  if (cart.status !== 'active') throw httpError(409, 'This shopping session is no longer open');
  return cart;
}

/** Puts a cart that was waiting for payment back to 'active' and cancels its open payment. */
function reopenCart(cartId) {
  db.prepare("UPDATE payments SET status = 'cancelled' WHERE cart_id = ? AND status = 'pending'").run(cartId);
  db.prepare("UPDATE carts SET status = 'active' WHERE id = ? AND status = 'pending_payment'").run(cartId);
}

// Start (or resume) shopping in a shop.
router.post('/', (req, res) => {
  const shopId = Number(req.body.shopId);
  const shop = db.prepare('SELECT id FROM shops WHERE id = ?').get(shopId);
  if (!shop) throw httpError(404, 'Shop not found');

  const cart = tx(() => {
    const open = db
      .prepare("SELECT * FROM carts WHERE user_id = ? AND status IN ('active', 'pending_payment')")
      .all(req.user.id);
    let keep = null;
    for (const c of open) {
      if (c.shop_id === shopId && !keep) {
        keep = c;
        if (c.status === 'pending_payment') reopenCart(c.id);
      } else {
        reopenCart(c.id);
        db.prepare("UPDATE carts SET status = 'abandoned' WHERE id = ?").run(c.id);
      }
    }
    if (keep) return keep.id;
    return Number(db.prepare('INSERT INTO carts (user_id, shop_id) VALUES (?, ?)').run(req.user.id, shopId).lastInsertRowid);
  });
  res.status(201).json({ cart: cartView(cart) });
});

// The customer's open cart, if any (used to offer "resume shopping").
router.get('/active', (req, res) => {
  const cart = db
    .prepare("SELECT id FROM carts WHERE user_id = ? AND status IN ('active', 'pending_payment') ORDER BY id DESC LIMIT 1")
    .get(req.user.id);
  res.json({ cart: cart ? cartView(cart.id) : null });
});

router.get('/:id', (req, res) => {
  res.json({ cart: cartView(ownedCart(req).id) });
});

// Scan a barcode: adds one unit of the product.
router.post('/:id/scan', (req, res) => {
  const cart = activeCart(req);
  const barcode = String(req.body.barcode || '').trim();
  if (!barcode) throw httpError(400, 'No barcode received');
  const product = db.prepare('SELECT * FROM products WHERE shop_id = ? AND barcode = ?').get(cart.shop_id, barcode);
  if (!product) throw httpError(404, `Product not found in this shop (${barcode})`);

  const existing = db
    .prepare('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?')
    .get(cart.id, product.id);
  // Scanning adds an item once. More units are added only with the + button (PATCH below),
  // so a camera that sees the same barcode repeatedly can't inflate the quantity.
  if (!existing) {
    db.prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, 1)').run(cart.id, product.id);
  }

  res.json({
    cart: cartView(cart.id),
    scanned: { productId: product.id, name: product.name, priceCents: product.price_cents },
    alreadyInCart: !!existing,
  });
});

// Set an item's quantity (0 removes it).
router.patch('/:id/items/:productId', (req, res) => {
  const cart = activeCart(req);
  const productId = Number(req.params.productId);
  const quantity = Math.floor(Number(req.body.quantity));
  if (!Number.isFinite(quantity) || quantity < 0) throw httpError(400, 'Invalid quantity');
  if (quantity > MAX_QTY) throw httpError(400, `Maximum ${MAX_QTY} units per item`);

  const row = db.prepare('SELECT 1 FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cart.id, productId);
  if (!row) throw httpError(404, 'Item is not in your bill');

  if (quantity === 0) {
    db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cart.id, productId);
  } else {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?').run(quantity, cart.id, productId);
  }
  res.json({ cart: cartView(cart.id) });
});

router.delete('/:id/items/:productId', (req, res) => {
  const cart = activeCart(req);
  db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cart.id, Number(req.params.productId));
  res.json({ cart: cartView(cart.id) });
});

module.exports = { router, reopenCart };
