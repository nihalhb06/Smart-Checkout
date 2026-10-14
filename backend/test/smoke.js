// End-to-end check of the whole flow against an in-memory database:
//   register -> pick shop -> scan -> change quantity -> delete -> checkout -> pay -> bill -> staff sees it.
process.env.DB_PATH = ':memory:';
const assert = require('node:assert/strict');
const { seed } = require('../src/seed');
const { createApp } = require('../src/server');

seed();
const server = createApp().listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };

  try {
    // Staff opens the live stream first so we can check the push.
    const staffLogin = await call('POST', '/api/auth/login', { body: { email: 'staff@freshmart.com', password: 'staff123' } });
    assert.equal(staffLogin.status, 200);
    const staffToken = staffLogin.data.token;
    const pushed = [];
    const ac = new AbortController();
    fetch(`${base}/api/staff/stream?token=${staffToken}`, { signal: ac.signal }).then(async (r) => {
      const dec = new TextDecoder();
      for await (const chunk of r.body) pushed.push(dec.decode(chunk));
    }).catch(() => {});

    const reg = await call('POST', '/api/auth/register', { body: { name: 'Test Customer', email: 'c@test.com', password: 'secret1' } });
    assert.equal(reg.status, 201);
    const token = reg.data.token;
    assert.equal((await call('POST', '/api/auth/register', { body: { name: 'Dup', email: 'c@test.com', password: 'secret1' } })).status, 409);
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'c@test.com', password: 'wrong' } })).status, 401);

    const shops = (await call('GET', '/api/shops', { token })).data.shops;
    assert.equal(shops.length, 3);
    const shop = shops.find((s) => s.name === 'Fresh Mart');
    const games = shops.find((s) => s.name === 'Meesh Games');
    assert.ok(games, 'Meesh Games should be seeded');
    assert.equal(games.icon, '🎮');
    assert.ok(games.productCount > 0);

    const cart = (await call('POST', '/api/carts', { token, body: { shopId: shop.id } })).data.cart;
    const catalogue = (await call('GET', '/api/demo/catalogue')).data.shops.find((s) => s.id === shop.id).products;
    const milk = catalogue.find((p) => p.name.startsWith('Toned Milk'));
    const bread = catalogue.find((p) => p.name.startsWith('Brown Bread'));

    let r = await call('POST', `/api/carts/${cart.id}/scan`, { token, body: { barcode: milk.barcode } });
    assert.equal(r.data.cart.totalCents, 6200);
    // Scanning the same product again must NOT raise the quantity (only + does).
    r = await call('POST', `/api/carts/${cart.id}/scan`, { token, body: { barcode: milk.barcode } });
    assert.equal(r.data.cart.items[0].quantity, 1);
    assert.equal(r.data.alreadyInCart, true);
    r = await call('POST', `/api/carts/${cart.id}/scan`, { token, body: { barcode: bread.barcode } });
    assert.equal(r.data.cart.totalCents, 6200 + 4500);
    assert.equal((await call('POST', `/api/carts/${cart.id}/scan`, { token, body: { barcode: '0000000000000' } })).status, 404);

    const milkId = r.data.cart.items.find((i) => i.name.startsWith('Toned Milk')).productId;
    const breadId = r.data.cart.items.find((i) => i.name.startsWith('Brown Bread')).productId;
    r = await call('PATCH', `/api/carts/${cart.id}/items/${milkId}`, { token, body: { quantity: 3 } });
    assert.equal(r.data.cart.totalCents, 6200 * 3 + 4500);
    r = await call('DELETE', `/api/carts/${cart.id}/items/${breadId}`, { token });
    assert.equal(r.data.cart.totalCents, 6200 * 3);

    // Checkout, failed payment first, then success.
    const pay = (await call('POST', '/api/payments', { token, body: { cartId: cart.id } })).data.payment;
    assert.equal(pay.amountCents, 18600);
    assert.equal((await call('POST', `/api/carts/${cart.id}/scan`, { token, body: { barcode: milk.barcode } })).status, 409);

    const complete = (card) => fetch(`${base}/pay/${pay.id}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card }),
    }).then(async (x) => ({ status: x.status, data: await x.json() }));

    assert.equal((await complete('4000 0000 0000 0002')).data.status, 'failed');
    // A declined card leaves the payment open: retry on the same payment.
    const pay2 = pay;
    const ok = (await complete('4242 4242 4242 4242')).data;
    assert.equal(ok.status, 'succeeded');
    assert.equal((await complete('4242 4242 4242 4242')).data.billCode, ok.billCode); // idempotent
    assert.match(ok.billCode, /^\d{4,}$/);

    const status = (await call("GET", `/api/payments/${pay2.id}`, { token })).data.payment;
    assert.equal(status.status, 'succeeded');
    assert.equal(status.billCode, ok.billCode);
    assert.equal((await call('GET', `/api/bills/${ok.billCode}`, { token })).data.bill.totalCents, 18600);

    // Staff got it.
    await new Promise((res) => setTimeout(res, 200));
    assert.ok(pushed.join('').includes(ok.billCode), 'staff stream should have received the bill');
    const list = (await call('GET', '/api/staff/bills', { token: staffToken })).data;
    assert.equal(list.bills[0].code, ok.billCode);
    assert.equal(list.bills[0].customer.email, 'c@test.com');
    assert.equal(list.stats.pending, 1);
    const rev = await call('POST', `/api/staff/bills/${ok.billCode}/review`, { token: staffToken, body: { note: 'ok' } });
    assert.equal(rev.data.bill.reviewed, true);

    // Second purchase, paid through a UPI app ("I have paid").
    assert.equal(ok.billCode, (await call('GET', `/api/payments/${pay2.id}`, { token })).data.payment.billCode);
    const cart2 = (await call('POST', '/api/carts', { token, body: { shopId: shop.id } })).data.cart;
    assert.notEqual(cart2.id, cart.id);
    await call('POST', `/api/carts/${cart2.id}/scan`, { token, body: { barcode: bread.barcode } });
    const upiPay = (await call('POST', '/api/payments', { token, body: { cartId: cart2.id } })).data.payment;
    assert.match(upiPay.upi.link, /^upi:\/\/pay\?pa=.+&pn=Fresh%20Mart&am=45\.00&cu=INR/);
    assert.ok(decodeURIComponent(upiPay.upi.link).includes(`bill ${upiPay.billCode}`), 'bill ID is in the UPI note');
    const upiOk = await call('POST', `/api/payments/${upiPay.id}/confirm-upi`, { token });
    assert.equal(upiOk.status, 200);
    assert.equal(upiOk.data.payment.billCode, upiPay.billCode); // the reserved ID becomes the bill ID
    const upiBill = (await call('GET', `/api/bills/${upiPay.billCode}`, { token })).data.bill;
    assert.equal(upiBill.paymentMethod, 'upi');
    assert.equal(upiBill.totalCents, 4500);

    // Other shop's staff and customers can't see it; customers can't use staff API.
    assert.equal((await call('GET', '/api/staff/bills', { token })).status, 403);
    const other = await call('POST', '/api/auth/login', { body: { email: 'staff@citysuper.com', password: 'staff123' } });
    assert.equal((await call('GET', `/api/staff/bills/${ok.billCode}`, { token: other.data.token })).status, 404);

    // ---- Profile: details, stats and coupons ----
    const profile = (await call('GET', '/api/profile', { token })).data;
    assert.equal(profile.user.email, 'c@test.com');
    assert.equal(profile.stats.billCount, 2);
    assert.equal(profile.stats.totalSpentCents, 18600 + 4500);
    assert.equal(profile.stats.itemsScanned, 4); // 3 milk + 1 bread
    assert.equal(profile.stats.favouriteShop, 'Fresh Mart');
    assert.ok(profile.coupons.some((c) => c.code === 'WELCOME50'), 'welcome coupon is granted');
    assert.ok(profile.stats.couponsAvailable >= 1);
    const renamed = await call('PATCH', '/api/profile', { token, body: { name: 'Test Shopper' } });
    assert.equal(renamed.data.user.name, 'Test Shopper');
    assert.equal((await call('PATCH', '/api/profile', { token, body: { name: 'x' } })).status, 400);

    // ---- Assistant: item location is answered from the real catalogue ----
    const ask = (message, shopId) => call('POST', '/api/assistant', { token, body: { message, shopId } });
    const milkWhere = (await ask('where is the milk', shop.id)).data;
    assert.match(milkWhere.reply, /Toned Milk/);
    assert.match(milkWhere.reply, /Aisle 1/);
    assert.ok(milkWhere.products.length > 0, 'location answers carry product cards');

    const unoWhere = (await ask('where can i find uno', games.id)).data;
    assert.match(unoWhere.reply, /UNO Card Game/);
    assert.match(unoWhere.reply, /Aisle 3/);

    const sectionAsk = (await ask('where are the board games', games.id)).data;
    assert.match(sectionAsk.reply, /Board Games/);
    assert.match(sectionAsk.reply, /Monopoly/);

    // A shop that doesn't stock an item points at one that does.
    assert.match((await ask('do you have olive oil', shop.id)).data.reply, /City Super Store/);
    // App questions and offers must not be mistaken for catalogue lookups.
    assert.match((await ask('how do i pay', games.id)).data.reply, /UPI/);
    assert.match((await ask('what offers do i have', games.id)).data.reply, /WELCOME50/);
    assert.match((await ask('what does this app do', games.id)).data.reply, /Smart Checkout/);
    assert.ok((await ask('zzzqqq nonsense', games.id)).data.suggestions.length > 0, 'fallback still suggests chips');
    assert.ok((await call('GET', `/api/assistant/intro?shopId=${games.id}`, { token })).data.suggestions.length > 0);

    // Locations reach the demo barcode page too.
    const gamesCatalogue = (await call('GET', '/api/demo/catalogue')).data.shops.find((s) => s.id === games.id);
    assert.ok(gamesCatalogue.products.every((p) => p.aisle && p.shelf), 'every game product has a location');

    ac.abort();
    console.log('All smoke checks passed.');
    process.exitCode = 0;
  } catch (err) {
    console.error('SMOKE TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    setTimeout(() => process.exit(process.exitCode), 100);
  }
});
