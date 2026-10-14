// Demo data: three shops, each with its own catalogue (valid EAN-13 barcodes + in-store
// locations), one staff login per shop, and a set of coupons.
//
// Seeding is idempotent: it adds whatever is missing and leaves existing rows (and any
// bills/accounts already in the database) alone, so a new shop or new location data lands
// on an existing database without `npm run reset-db`.
const bcrypt = require('bcryptjs');
const { db, tx } = require('./db');

function ean13(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return first12 + ((10 - (sum % 10)) % 10);
}

// Each product: [name, price in rupees, aisle, shelf, section]
const SHOPS = [
  {
    name: 'Fresh Mart',
    address: '12 MG Road',
    icon: '🛒',
    tagline: 'Daily groceries, fruits and household essentials',
    hours: '8:00 AM - 10:00 PM, all days',
    phone: '+91 80 4000 1201',
    barcodePrefix: '8901234',
    staff: ['Fresh Mart Staff', 'staff@freshmart.com'],
    products: [
      ['Toned Milk 1L', 62, 'Aisle 1', 'Shelf 2', 'Dairy & Chilled'],
      ['Butter 100g', 58, 'Aisle 1', 'Shelf 3', 'Dairy & Chilled'],
      ['Eggs (12 pack)', 84, 'Aisle 1', 'Shelf 1', 'Dairy & Chilled'],
      ['Brown Bread 400g', 45, 'Aisle 2', 'Shelf 1', 'Bakery'],
      ['Cream Biscuits 120g', 30, 'Aisle 2', 'Shelf 4', 'Bakery'],
      ['Basmati Rice 1kg', 120, 'Aisle 3', 'Shelf 2', 'Staples & Grains'],
      ['Whole Wheat Flour 5kg', 245, 'Aisle 3', 'Shelf 1', 'Staples & Grains'],
      ['Masala Tea 250g', 140, 'Aisle 4', 'Shelf 3', 'Tea & Coffee'],
      ['Cola 750ml', 40, 'Aisle 5', 'Shelf 1', 'Beverages'],
      ['Orange Juice 1L', 99, 'Aisle 5', 'Shelf 2', 'Beverages'],
      ['Potato Chips 52g', 20, 'Aisle 6', 'Shelf 2', 'Snacks'],
      ['Instant Noodles 70g', 14, 'Aisle 6', 'Shelf 3', 'Snacks'],
      ['Toothpaste 100g', 75, 'Aisle 7', 'Shelf 2', 'Personal Care'],
      ['Dishwash Liquid 500ml', 110, 'Aisle 8', 'Shelf 1', 'Home Care'],
    ],
  },
  {
    name: 'City Super Store',
    address: '48 Station Road',
    icon: '🏪',
    tagline: 'Everything under one roof, open till late',
    hours: '9:00 AM - 11:00 PM, all days',
    phone: '+91 80 4000 2202',
    barcodePrefix: '8902345',
    staff: ['City Super Staff', 'staff@citysuper.com'],
    products: [
      ['Toned Milk 1L', 64, 'Lane A', 'Rack 1', 'Dairy'],
      ['Butter 100g', 60, 'Lane A', 'Rack 2', 'Dairy'],
      ['Eggs (12 pack)', 90, 'Lane A', 'Rack 3', 'Dairy'],
      ['Brown Bread 400g', 48, 'Lane B', 'Rack 1', 'Bakery'],
      ['Cream Biscuits 120g', 32, 'Lane B', 'Rack 3', 'Bakery'],
      ['Basmati Rice 1kg', 115, 'Lane C', 'Rack 2', 'Staples'],
      ['Whole Wheat Flour 5kg', 245, 'Lane C', 'Rack 1', 'Staples'],
      ['Olive Oil 500ml', 520, 'Lane C', 'Rack 4', 'Cooking Oils'],
      ['Masala Tea 250g', 135, 'Lane D', 'Rack 2', 'Tea & Coffee'],
      ['Cola 750ml', 38, 'Lane E', 'Rack 1', 'Beverages'],
      ['Potato Chips 52g', 20, 'Lane F', 'Rack 2', 'Snacks'],
      ['Instant Noodles 70g', 15, 'Lane F', 'Rack 3', 'Snacks'],
      ['Toothpaste 100g', 72, 'Lane G', 'Rack 2', 'Personal Care'],
    ],
  },
  {
    name: 'Meesh Games',
    address: '3 Brigade Lane',
    icon: '🎮',
    tagline: 'Video games, board games, toys and collectibles',
    hours: '11:00 AM - 9:00 PM, closed on Monday',
    phone: '+91 80 4000 3303',
    barcodePrefix: '8903456',
    staff: ['Meesh Games Staff', 'staff@meeshgames.com'],
    products: [
      ['PS5 Controller DualSense', 5499, 'Aisle 1', 'Shelf 1', 'Console Accessories'],
      ['Xbox Wireless Controller', 4799, 'Aisle 1', 'Shelf 2', 'Console Accessories'],
      ['Gaming Headset RGB', 2299, 'Aisle 1', 'Shelf 3', 'Console Accessories'],
      ['Nintendo Switch Game Card Case', 699, 'Aisle 1', 'Shelf 4', 'Console Accessories'],
      ['FIFA 24 (PS5)', 3999, 'Aisle 2', 'Shelf 1', 'Video Games'],
      ['Minecraft (Switch)', 2999, 'Aisle 2', 'Shelf 2', 'Video Games'],
      ['Spider-Man 2 (PS5)', 4499, 'Aisle 2', 'Shelf 3', 'Video Games'],
      ['Mario Kart 8 Deluxe', 3499, 'Aisle 2', 'Shelf 4', 'Video Games'],
      ['Monopoly Classic Board Game', 899, 'Aisle 3', 'Shelf 1', 'Board Games'],
      ['UNO Card Game', 249, 'Aisle 3', 'Shelf 2', 'Board Games'],
      ['Chess Set Wooden', 749, 'Aisle 3', 'Shelf 3', 'Board Games'],
      ['Jenga Tower Game', 599, 'Aisle 3', 'Shelf 4', 'Board Games'],
      ['LEGO Classic Bricks 500pc', 2499, 'Aisle 4', 'Shelf 1', 'Building Toys'],
      ['Rubik Cube 3x3', 299, 'Aisle 4', 'Shelf 2', 'Building Toys'],
      ['Hot Wheels 5-Car Pack', 799, 'Aisle 5', 'Shelf 1', 'Toys & Figures'],
      ['Remote Control Car 1:18', 1899, 'Aisle 5', 'Shelf 2', 'Toys & Figures'],
      ['Teddy Bear 40cm', 1099, 'Aisle 5', 'Shelf 3', 'Toys & Figures'],
      ['Action Figure Superhero 6in', 1299, 'Aisle 5', 'Shelf 4', 'Toys & Figures'],
      ['Jigsaw Puzzle 1000pc', 649, 'Aisle 6', 'Shelf 1', 'Puzzles & Games'],
      ['Playing Cards Premium', 199, 'Aisle 6', 'Shelf 2', 'Puzzles & Games'],
      ['Gift Card ₹1000', 1000, 'Counter', 'Counter Display', 'Gift Cards'],
    ],
  },
];

// shopName null = usable at any shop.
const COUPONS = [
  {
    code: 'WELCOME50',
    title: '₹50 off your first bill',
    description: 'Flat ₹50 off on a bill of ₹300 or more. Valid at any shop.',
    kind: 'flat',
    value: 5000,
    minSpend: 30000,
    shopName: null,
    welcome: true,
  },
  {
    code: 'FRESH10',
    title: '10% off groceries',
    description: 'Get 10% off at Fresh Mart on bills above ₹500, up to ₹150 off.',
    kind: 'percent',
    value: 10,
    minSpend: 50000,
    maxDiscount: 15000,
    shopName: 'Fresh Mart',
    welcome: true,
  },
  {
    code: 'MEESH15',
    title: '15% off games & toys',
    description: 'Get 15% off at Meesh Games on bills above ₹1500, up to ₹500 off.',
    kind: 'percent',
    value: 15,
    minSpend: 150000,
    maxDiscount: 50000,
    shopName: 'Meesh Games',
    welcome: true,
  },
  {
    code: 'PLAYTIME200',
    title: '₹200 off toys',
    description: 'Flat ₹200 off at Meesh Games on bills above ₹2000.',
    kind: 'flat',
    value: 20000,
    minSpend: 200000,
    shopName: 'Meesh Games',
    welcome: false,
  },
  {
    code: 'CITY25',
    title: '₹25 off at City Super',
    description: 'Flat ₹25 off at City Super Store on bills above ₹250.',
    kind: 'flat',
    value: 2500,
    minSpend: 25000,
    shopName: 'City Super Store',
    welcome: false,
  },
];

/**
 * Removes catalogue rows a shop no longer lists - for example products seeded under an older
 * barcode scheme - so the same item never appears twice. Carts still holding a retired row are
 * moved onto the current row for the same product, so nobody's bill changes. Paid bills keep
 * their own item snapshot and are never touched.
 */
function retireStaleProducts(shopId, wanted) {
  const MAX_QTY = 99;
  const keep = new Set(wanted.map((p) => p.barcode));
  const byName = new Map();
  for (const p of wanted) {
    const row = db.prepare('SELECT id FROM products WHERE shop_id = ? AND barcode = ?').get(shopId, p.barcode);
    if (row) byName.set(p.name, row.id);
  }

  for (const old of db.prepare('SELECT id, name FROM products WHERE shop_id = ?').all(shopId)) {
    if (keep.has(db.prepare('SELECT barcode FROM products WHERE id = ?').get(old.id).barcode)) continue;

    const replacementId = byName.get(old.name);
    if (replacementId && replacementId !== old.id) {
      for (const item of db.prepare('SELECT cart_id, quantity FROM cart_items WHERE product_id = ?').all(old.id)) {
        const already = db
          .prepare('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?')
          .get(item.cart_id, replacementId);
        if (already) {
          db.prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?').run(
            Math.min(MAX_QTY, already.quantity + item.quantity),
            item.cart_id,
            replacementId
          );
          db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(item.cart_id, old.id);
        } else {
          db.prepare('UPDATE cart_items SET product_id = ? WHERE cart_id = ? AND product_id = ?').run(
            replacementId,
            item.cart_id,
            old.id
          );
        }
      }
    }

    // Anything still referenced (no current equivalent) stays, so no cart loses an item.
    if (!db.prepare('SELECT 1 FROM cart_items WHERE product_id = ?').get(old.id)) {
      db.prepare('DELETE FROM products WHERE id = ?').run(old.id);
    }
  }
}

function seedShops() {
  let added = 0;
  const staffHash = bcrypt.hashSync('staff123', 10);

  for (const shop of SHOPS) {
    let row = db.prepare('SELECT id FROM shops WHERE name = ?').get(shop.name);
    if (!row) {
      const id = db
        .prepare('INSERT INTO shops (name, address, icon, tagline, hours, phone) VALUES (?, ?, ?, ?, ?, ?)')
        .run(shop.name, shop.address, shop.icon, shop.tagline, shop.hours, shop.phone).lastInsertRowid;
      row = { id: Number(id) };
      added++;
    } else {
      // Keep presentation details in step with this file without touching the shop's history.
      db.prepare('UPDATE shops SET address = ?, icon = ?, tagline = ?, hours = ?, phone = ? WHERE id = ?').run(
        shop.address,
        shop.icon,
        shop.tagline,
        shop.hours,
        shop.phone,
        row.id
      );
    }

    const wanted = shop.products.map(([name, price, aisle, shelf, section], i) => ({
      barcode: ean13(shop.barcodePrefix + String(i + 1).padStart(5, '0')),
      name,
      priceCents: price * 100,
      aisle,
      shelf,
      section,
    }));

    for (const p of wanted) {
      const existing = db.prepare('SELECT id FROM products WHERE shop_id = ? AND barcode = ?').get(row.id, p.barcode);
      if (existing) {
        db.prepare('UPDATE products SET name = ?, price_cents = ?, aisle = ?, shelf = ?, section = ? WHERE id = ?').run(
          p.name,
          p.priceCents,
          p.aisle,
          p.shelf,
          p.section,
          existing.id
        );
      } else {
        db.prepare(
          'INSERT INTO products (shop_id, barcode, name, price_cents, aisle, shelf, section) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(row.id, p.barcode, p.name, p.priceCents, p.aisle, p.shelf, p.section);
      }
    }

    retireStaleProducts(row.id, wanted);

    if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(shop.staff[1])) {
      db.prepare('INSERT INTO users (name, email, password_hash, role, shop_id) VALUES (?, ?, ?, ?, ?)').run(
        shop.staff[0],
        shop.staff[1],
        staffHash,
        'staff',
        row.id
      );
    }
  }
  return added;
}

function seedCoupons() {
  // Demo coupons expire a month out, refreshed on every start so the demo never shows expired ones.
  const expires = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  for (const c of COUPONS) {
    const shopId = c.shopName ? db.prepare('SELECT id FROM shops WHERE name = ?').get(c.shopName)?.id ?? null : null;
    const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(c.code);
    if (existing) {
      db.prepare(
        'UPDATE coupons SET title = ?, description = ?, kind = ?, value = ?, min_spend_cents = ?, max_discount_cents = ?, shop_id = ?, expires_at = ? WHERE id = ?'
      ).run(c.title, c.description, c.kind, c.value, c.minSpend, c.maxDiscount ?? null, shopId, expires, existing.id);
    } else {
      db.prepare(
        `INSERT INTO coupons (code, title, description, kind, value, min_spend_cents, max_discount_cents, shop_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(c.code, c.title, c.description, c.kind, c.value, c.minSpend, c.maxDiscount ?? null, shopId, expires);
    }
  }
}

/** Coupons every customer starts with. Called on register and when a profile is opened. */
function grantWelcomeCoupons(userId) {
  const codes = COUPONS.filter((c) => c.welcome).map((c) => c.code);
  if (!codes.length) return;
  const rows = db
    .prepare(`SELECT id FROM coupons WHERE active = 1 AND code IN (${codes.map(() => '?').join(',')})`)
    .all(...codes);
  for (const r of rows) {
    db.prepare('INSERT OR IGNORE INTO user_coupons (user_id, coupon_id) VALUES (?, ?)').run(userId, r.id);
  }
}

function seed() {
  return tx(() => {
    const added = seedShops();
    seedCoupons();
    return added > 0;
  });
}

module.exports = { seed, ean13, grantWelcomeCoupons };
