const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { db } = require('./db');
const { seed } = require('./seed');
const auth = require('./auth');
const carts = require('./carts');
const payments = require('./payments');
const bills = require('./bills');
const assistant = require('./assistant');
const profile = require('./profile');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth.router);

  app.get('/api/shops', auth.requireAuth, (req, res) => {
    res.json({
      shops: db
        .prepare('SELECT id, name, address, icon, tagline, hours, phone FROM shops ORDER BY name')
        .all()
        .map((s) => ({
          ...s,
          productCount: db.prepare('SELECT COUNT(*) AS n FROM products WHERE shop_id = ?').get(s.id).n,
        })),
    });
  });

  app.use('/api/carts', carts.router);
  app.use('/api/payments', payments.apiRouter);
  app.use('/api/bills', bills.customerRouter);
  app.use('/api/staff', bills.staffRouter);
  app.use('/api/assistant', assistant.router);
  app.use('/api/profile', profile.router);

  // Demo helper: product list per shop so barcodes can be shown on screen and scanned (see /barcodes).
  app.get('/api/demo/catalogue', (req, res) => {
    const shops = db.prepare('SELECT id, name, icon FROM shops ORDER BY id').all();
    res.json({
      shops: shops.map((s) => ({
        ...s,
        products: db
          .prepare(
            `SELECT barcode, name, price_cents AS priceCents, aisle, shelf, section
             FROM products WHERE shop_id = ? ORDER BY section, name`
          )
          .all(s.id),
      })),
    });
  });

  app.use('/pay', payments.pageRouter);
  app.get('/staff', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'staff.html')));
  app.get('/barcodes', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'barcodes.html')));
  app.get('/', (req, res) => res.redirect('/staff'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong on the server' : err.message });
  });
  return app;
}

module.exports = { createApp };

if (require.main === module) {
  if (seed()) console.log('Seeded demo shops, products and staff accounts.');
  const port = Number(process.env.PORT) || 4000;
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`\nSmart Checkout backend running on port ${port}`);
    console.log(`  Staff dashboard : http://localhost:${port}/staff`);
    console.log(`  Demo barcodes   : http://localhost:${port}/barcodes`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  Phone can reach : http://${n.address}:${port}`);
      }
    }
    const staff = db.prepare("SELECT email FROM users WHERE role = 'staff' ORDER BY id").all();
    console.log(`\nStaff logins (password staff123):\n${staff.map((s) => `  ${s.email}`).join('\n')}\n`);
  });
}
