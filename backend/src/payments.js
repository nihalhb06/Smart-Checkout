// Mock payment gateway that behaves like Stripe test mode:
//   4242 4242 4242 4242 -> succeeds, 4000 0000 0000 0002 -> declined, anything else -> invalid card.
// The app opens /pay/:id in a WebView ("redirect to payment gateway"). To use real Stripe later, replace
// createPayment()/completePayment() with Stripe Checkout Session + webhook; bill creation stays the same.
const crypto = require('crypto');
const express = require('express');
const { db, tx, httpError } = require('./db');
const { requireAuth } = require('./auth');
const { cartView, billView, getBillRow } = require('./views');
const { reopenCart } = require('./carts');
const { publish } = require('./events');

// Short numeric bill ID, unique across all bills. Starts at 4 digits (1000-9999) and automatically
// grows to 5, 6... digits if the shorter ones run out, so an ID is never reused.
function newBillCode() {
  for (let digits = 4; ; digits++) {
    const min = 10 ** (digits - 1);
    const span = 9 * min;
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = String(min + crypto.randomInt(span));
      if (!db.prepare('SELECT 1 FROM bills WHERE code = ? UNION SELECT 1 FROM payments WHERE bill_code = ?').get(code, code)) return code;
    }
  }
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/** Marks the payment and cart paid and writes the bill. Must run inside tx(). */
function finalizePayment(payment, method, reference) {
  const cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(payment.cart_id);
  const items = cartView(cart.id).items.map(({ barcode, name, priceCents, quantity, lineTotalCents }) => ({
    barcode, name, priceCents, quantity, lineTotalCents,
  }));
  const billCode = payment.bill_code || newBillCode();
  db.prepare("UPDATE payments SET status = 'succeeded', method = ?, reference = ? WHERE id = ?").run(method, reference, payment.id);
  db.prepare("UPDATE carts SET status = 'paid' WHERE id = ?").run(cart.id);
  db.prepare(
    `INSERT INTO bills (code, cart_id, payment_id, user_id, shop_id, total_cents, items_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(billCode, cart.id, payment.id, cart.user_id, cart.shop_id, payment.amount_cents, JSON.stringify(items));
  return { billCode, shopId: cart.shop_id };
}

function notifyStaff(shopId, billCode) {
  publish(shopId, 'bill', billView(getBillRow('b.code = ?', billCode), { includeCustomer: true }));
}

/** upi://pay deep link: opens GPay / PhonePe / Paytm etc. with payee and amount filled in. */
function upiLink({ vpa, payeeName, amountCents, ref, note }) {
  const q = new URLSearchParams({
    pa: vpa, pn: payeeName, am: (amountCents / 100).toFixed(2), cu: 'INR', tn: note, tr: ref,
  });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

// ---- JSON API used by the app ----
const apiRouter = express.Router();
apiRouter.use(requireAuth);

apiRouter.post('/', (req, res) => {
  const cartId = Number(req.body.cartId);
  const cart = db.prepare('SELECT * FROM carts WHERE id = ? AND user_id = ?').get(cartId, req.user.id);
  if (!cart) throw httpError(404, 'Cart not found');
  if (cart.status === 'paid') throw httpError(409, 'This bill is already paid');
  if (cart.status === 'abandoned') throw httpError(409, 'This shopping session was closed');

  const view = cartView(cart.id);
  if (view.items.length === 0) throw httpError(400, 'Your bill is empty - scan a product first');

  const payment = tx(() => {
    db.prepare("UPDATE payments SET status = 'cancelled' WHERE cart_id = ? AND status = 'pending'").run(cart.id);
    db.prepare("UPDATE carts SET status = 'pending_payment' WHERE id = ?").run(cart.id);
    const id = crypto.randomUUID();
    // The bill ID is reserved now so it can go into the UPI payment note and the shop can match it.
    const code = newBillCode();
    db.prepare('INSERT INTO payments (id, cart_id, amount_cents, bill_code) VALUES (?, ?, ?, ?)').run(id, cart.id, view.totalCents, code);
    return { id, code };
  });
  const shop = db.prepare('SELECT name, upi_id FROM shops WHERE id = ?').get(cart.shop_id);
  const vpa = shop.upi_id || process.env.UPI_ID || 'demoshop@upi';
  res.status(201).json({
    payment: {
      id: payment.id,
      billCode: payment.code,
      amountCents: view.totalCents,
      payUrl: `${baseUrl(req)}/pay/${payment.id}`,
      upi: {
        vpa,
        payeeName: shop.name,
        link: upiLink({ vpa, payeeName: shop.name, amountCents: view.totalCents, ref: payment.id.replace(/-/g, '').slice(0, 20), note: `${shop.name} bill ${payment.code}` }),
        isDemoVpa: !shop.upi_id && !process.env.UPI_ID,
      },
    },
  });
});

// Customer says they paid in their UPI app. A UPI app can't report the result back, so the bill is
// saved as "UPI, unverified": the UPI note contains the bill ID and staff match it with their UPI/bank app.
apiRouter.post('/:id/confirm-upi', (req, res) => {
  const result = tx(() => {
    const payment = db
      .prepare(`SELECT p.* FROM payments p JOIN carts c ON c.id = p.cart_id WHERE p.id = ? AND c.user_id = ?`)
      .get(req.params.id, req.user.id);
    if (!payment) throw httpError(404, 'Payment not found');
    if (payment.status === 'succeeded') {
      return { billCode: db.prepare('SELECT code FROM bills WHERE payment_id = ?').get(payment.id).code };
    }
    if (payment.status !== 'pending') throw httpError(409, 'This payment is no longer active');
    return { ...finalizePayment(payment, 'upi', null), isNew: true };
  });
  if (result.isNew) notifyStaff(result.shopId, result.billCode);
  res.json({ payment: { id: req.params.id, status: 'succeeded', billCode: result.billCode } });
});

apiRouter.get('/:id', (req, res) => {
  const payment = db
    .prepare(`SELECT p.* FROM payments p JOIN carts c ON c.id = p.cart_id WHERE p.id = ? AND c.user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!payment) throw httpError(404, 'Payment not found');
  const bill = db.prepare('SELECT code FROM bills WHERE payment_id = ?').get(payment.id);
  res.json({ payment: { id: payment.id, status: payment.status, failureReason: payment.failure_reason, billCode: bill?.code || null } });
});

// Customer backed out of the payment screen: go back to editing the bill.
apiRouter.post('/:id/cancel', (req, res) => {
  const payment = db
    .prepare(`SELECT p.* FROM payments p JOIN carts c ON c.id = p.cart_id WHERE p.id = ? AND c.user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!payment) throw httpError(404, 'Payment not found');
  if (payment.status === 'pending') reopenCart(payment.cart_id);
  res.json({ cart: cartView(payment.cart_id) });
});

// ---- Hosted payment page (the "gateway") ----
const pageRouter = express.Router();

pageRouter.get('/:id', (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).type('html').send(shell('Payment not found', '<p class="muted">This payment link is not valid.</p>'));
  const cart = db.prepare('SELECT c.*, s.name AS shop_name FROM carts c JOIN shops s ON s.id = c.shop_id WHERE c.id = ?').get(payment.cart_id);
  const bill = db.prepare('SELECT code FROM bills WHERE payment_id = ?').get(payment.id);

  if (payment.status === 'succeeded') {
    return res.type('html').send(shell('Payment successful', successBody(payment.amount_cents, bill?.code)));
  }
  if (payment.status !== 'pending') {
    return res.type('html').send(shell('Payment closed', '<p class="muted">This payment is no longer active. Please return to the app.</p>'));
  }
  res.type('html').send(shell('Secure payment', formBody(payment, cart.shop_name)));
});

pageRouter.post('/:id/complete', express.json(), (req, res) => {
  const card = String(req.body.card || '').replace(/\s+/g, '');
  const result = tx(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!payment) throw httpError(404, 'Payment not found');
    if (payment.status === 'succeeded') {
      return { status: 'succeeded', billCode: db.prepare('SELECT code FROM bills WHERE payment_id = ?').get(payment.id)?.code };
    }
    if (payment.status !== 'pending') throw httpError(409, 'This payment is no longer active');

    if (card === '4242424242424242') {
      const { billCode, shopId } = finalizePayment(payment, 'card', null);
      return { status: 'succeeded', billCode, shopId, isNew: true };
    }

    const reason = card === '4000000000000002' ? 'Your card was declined.' : 'Invalid card number. Use the test card shown above.';
    // Like Stripe, a declined card leaves the payment open so the customer can retry with another card.
    db.prepare('UPDATE payments SET failure_reason = ? WHERE id = ?').run(reason, payment.id);
    return { status: 'failed', reason };
  });

  if (result.isNew) {
    // Staff get the e-bill the moment payment succeeds.
    notifyStaff(result.shopId, result.billCode);
  }
  res.json({ status: result.status, billCode: result.billCode, reason: result.reason });
});

// ---- HTML ----
const rupees = (cents) => '&#8377;' + (cents / 100).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function successBody(amountCents, code) {
  return `<div class="ok">&#10003;</div>
  <h1>Payment successful</h1>
  <p class="muted">${rupees(amountCents)} paid</p>
  <p class="muted">Your bill ID</p><div class="code">${esc(code || '')}</div>
  <p class="muted">Return to the app to see your e-bill.</p>`;
}

function formBody(payment, shopName) {
  return `<p class="muted">${esc(shopName)}</p>
  <h1>${rupees(payment.amount_cents)}</h1>
  <div class="test">Test mode &mdash; no real money is charged.<br>
    Success: <b>4242 4242 4242 4242</b> &middot; Declined: <b>4000 0000 0000 0002</b></div>
  <form id="f">
    <label>Card number<input id="card" inputmode="numeric" autocomplete="off" value="4242 4242 4242 4242" maxlength="19"></label>
    <div class="row">
      <label>Expiry<input id="exp" value="12/34" maxlength="5"></label>
      <label>CVC<input id="cvc" value="123" maxlength="4" inputmode="numeric"></label>
    </div>
    <div id="err" class="err"></div>
    <button id="pay" type="submit">Pay ${rupees(payment.amount_cents)}</button>
  </form>
  <script>
    const f = document.getElementById('f'), err = document.getElementById('err'), btn = document.getElementById('pay');
    document.getElementById('card').addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
    });
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Processing...';
      try {
        const r = await fetch(location.pathname + '/complete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card: document.getElementById('card').value })
        });
        const d = await r.json();
        if (d.status === 'succeeded') { location.reload(); return; }
        err.textContent = d.reason || d.error || 'Payment failed';
      } catch (x) { err.textContent = 'Network error. Please try again.'; }
      btn.disabled = false; btn.textContent = 'Try again';
    });
  </script>`;
}

function shell(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fb;color:#1c2333}
  .card{max-width:420px;margin:24px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(20,30,60,.08);text-align:center}
  h1{margin:4px 0 16px;font-size:34px} .muted{color:#667085;margin:6px 0}
  .test{background:#fff7e0;border:1px solid #f3dc9a;border-radius:10px;padding:10px;font-size:13px;margin-bottom:18px}
  label{display:block;text-align:left;font-size:13px;color:#667085;margin-bottom:12px}
  input{display:block;width:100%;margin-top:4px;padding:12px;font-size:17px;border:1px solid #d0d5dd;border-radius:10px}
  .row{display:flex;gap:12px} .row label{flex:1}
  button{width:100%;padding:14px;font-size:17px;font-weight:600;color:#fff;background:#4f46e5;border:0;border-radius:12px;margin-top:6px}
  button:disabled{opacity:.6} .err{color:#c0392b;min-height:20px;margin:4px 0;font-size:14px}
  .ok{width:64px;height:64px;line-height:64px;margin:8px auto;border-radius:50%;background:#e6f7ee;color:#1a9d58;font-size:34px}
  .code{font-family:ui-monospace,Consolas,monospace;font-size:22px;font-weight:700;background:#eef0ff;color:#3730a3;border-radius:10px;padding:12px;margin:6px 0 14px;word-break:break-all}
</style></head><body><div class="card">${body}</div></body></html>`;
}

module.exports = { apiRouter, pageRouter };
