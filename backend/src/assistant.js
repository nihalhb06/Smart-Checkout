// In-app help assistant. Rule-based on purpose: it needs no API key, works offline and
// always answers from this shop's real catalogue, so "where is X?" is never invented.
const express = require('express');
const { db } = require('./db');
const { requireAuth } = require('./auth');

const money = (cents) => '₹' + (cents / 100).toFixed(2);

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Words that carry no product meaning, dropped before matching product names.
const STOP_WORDS = new Set(
  ('a an the is are was were do does did can could would should will i me my mine you your yours we our it its this that these those' +
    ' of for to in on at by with from about into over and or but if then than so as be been being have has had not no yes please' +
    ' where which what how who whom when why whose there here tell show find get give know want need looking look search locate' +
    ' kept keep placed place put stored store shop stores shops item items product products thing things stuff section buy' +
    ' available availability stock any some much many cost costs price prices rate rates aisle aisles lane lanes shelf shelves rack racks')
    .split(' ')
);

const tokens = (s) => normalize(s).split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w));

const has = (text, re) => re.test(text);

/** Scores the shop's products against free text and returns the best matches. */
function matchProducts(shopId, text, limit = 4) {
  const query = normalize(text);
  const queryWords = tokens(text);
  if (!query) return [];

  const products = db
    .prepare('SELECT name, barcode, price_cents AS priceCents, aisle, shelf, section FROM products WHERE shop_id = ?')
    .all(shopId);

  const scored = [];
  for (const p of products) {
    const name = normalize(p.name);
    const nameWords = tokens(p.name);
    let score = 0;

    if (name && query.includes(name)) score += 100; // full product name appears in the question
    for (const w of queryWords) {
      if (nameWords.includes(w)) score += 12;
      else if (name.includes(w)) score += 7;
      else if (nameWords.some((nw) => nw.startsWith(w) || w.startsWith(nw))) score += 4;
    }
    // A question that names a section ("where are the board games") should surface that section.
    if (p.section && queryWords.some((w) => normalize(p.section).includes(w))) score += 3;

    if (score > 0) scored.push({ product: p, score });
  }

  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
  const best = scored[0]?.score ?? 0;
  // Keep only matches close to the best one, so one good hit isn't buried in weak ones.
  return scored
    .filter((s) => s.score >= Math.max(4, best * 0.5))
    .slice(0, limit)
    .map((s) => s.product);
}

/** True section match: the whole section name appears in the question ("where are the board games"). */
function exactSectionMatch(shopId, text) {
  const query = normalize(text);
  const sections = db
    .prepare("SELECT DISTINCT section FROM products WHERE shop_id = ? AND section <> ''")
    .all(shopId)
    .map((r) => r.section);
  // Longest match wins, so "Puzzles & Games" beats "Games" when both appear.
  return (
    sections
      .filter((s) => normalize(s) && query.includes(normalize(s)))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

function matchSection(shopId, text) {
  const queryWords = tokens(text);
  if (!queryWords.length) return null;
  const sections = db
    .prepare("SELECT DISTINCT section FROM products WHERE shop_id = ? AND section <> '' ORDER BY section")
    .all(shopId)
    .map((r) => r.section);
  let best = null;
  for (const section of sections) {
    const words = tokens(section);
    const hits = queryWords.filter((w) => words.includes(w) || words.some((sw) => sw.startsWith(w))).length;
    if (hits && (!best || hits > best.hits)) best = { section, hits };
  }
  return best?.section ?? null;
}

const whereText = (p) => {
  const parts = [p.aisle, p.shelf].filter(Boolean).join(', ');
  if (!parts) return `${p.name} is in the ${p.section || 'store'}`;
  return `${p.name} — ${parts}${p.section ? ` (${p.section})` : ''}`;
};

function shopSections(shopId) {
  return db
    .prepare(
      `SELECT section, COUNT(*) AS n, MIN(aisle) AS aisle FROM products
       WHERE shop_id = ? AND section <> '' GROUP BY section ORDER BY aisle, section`
    )
    .all(shopId);
}

/** Reply describing one whole section and where it is. */
function sectionAnswer(shopId, section) {
  const rows = db
    .prepare(
      `SELECT name, barcode, price_cents AS priceCents, aisle, shelf, section
       FROM products WHERE shop_id = ? AND section = ? ORDER BY name`
    )
    .all(shopId, section);
  const aisles = [...new Set(rows.map((r) => r.aisle).filter(Boolean))].join(' and ');
  return {
    reply:
      `The **${section}** section is in ${aisles || 'the store'}. It has ${rows.length} item${
        rows.length === 1 ? '' : 's'
      }:\n` +
      rows
        .slice(0, 8)
        .map((r) => `• ${r.name} — ${money(r.priceCents)} (${[r.aisle, r.shelf].filter(Boolean).join(', ')})`)
        .join('\n') +
      (rows.length > 8 ? `\n…and ${rows.length - 8} more.` : ''),
    suggestions: ['What sections are here?', 'How do I pay?', 'My offers'],
    products: rows.slice(0, 4),
  };
}

function cheapestAndDearest(shopId) {
  return {
    cheapest: db
      .prepare('SELECT name, price_cents AS priceCents FROM products WHERE shop_id = ? ORDER BY price_cents LIMIT 1')
      .get(shopId),
    dearest: db
      .prepare('SELECT name, price_cents AS priceCents FROM products WHERE shop_id = ? ORDER BY price_cents DESC LIMIT 1')
      .get(shopId),
  };
}

const DEFAULT_CHIPS = ['How does this app work?', 'How do I pay?', 'What offers do I have?', 'What can you do?'];

/** A real product from this shop, so suggestion chips never offer milk at a games shop. */
function sampleProductName(shopId) {
  return (
    db
      .prepare("SELECT name FROM products WHERE shop_id = ? AND section <> '' ORDER BY price_cents LIMIT 1")
      .get(shopId)?.name ?? null
  );
}

function starterChips(shopId) {
  const sample = shopId && sampleProductName(shopId);
  return [
    ...(sample ? [`Where is ${sample}?`] : []),
    'What sections are here?',
    'Shop timings',
    'How do I pay?',
  ];
}

/**
 * Works out a reply for one message.
 * Returns { reply, suggestions, products } - products are rendered as location cards by the app.
 */
function answer({ message, shop, userId }) {
  const text = normalize(message);
  if (!text) {
    return { reply: 'Ask me anything about the app or the shop.', suggestions: DEFAULT_CHIPS };
  }

  const shopId = shop?.id;
  const shopName = shop?.name || 'the shop';
  const inShop = !!shopId;

  const wantsLocation = has(
    text,
    /\b(where|whereabouts|which aisle|which lane|which shelf|which rack|which section|locate|location|find|aisle|lane|shelf|rack|kept|placed)\b/
  );
  const wantsPrice = has(text, /\b(price|cost|costs|how much|rate|mrp|expensive|cheap|cheapest)\b/);
  const wantsStock = has(text, /\b(stock|available|availability|do you have|got any|sell|sells|carry)\b/);

  // ---- Greetings and small talk ----
  if (has(text, /^(hi|hii+|hey+|hello+|yo|namaste|hola|good (morning|afternoon|evening))\b/)) {
    return {
      reply: `Hi! I'm the Smart Checkout assistant${inShop ? ` for ${shopName}` : ''}. I can tell you where an item is, what it costs, how the app works, and what offers you have.`,
      suggestions: inShop ? starterChips(shopId) : DEFAULT_CHIPS,
    };
  }
  if (has(text, /\b(thanks|thank you|thankyou|thx|ty|great|awesome|cool|nice)\b/) && text.length < 30) {
    return { reply: 'Happy to help! Anything else?', suggestions: DEFAULT_CHIPS };
  }
  if (has(text, /\b(bye|goodbye|see you|that s all|thats all)\b/)) {
    return { reply: 'Happy shopping! Tap the chat button any time you need me.', suggestions: [] };
  }

  // ---- What the assistant / app can do ----
  if (has(text, /\b(what can you do|who are you|what are you|help me|what do you do|your name|commands)\b/) || text === 'help') {
    return {
      reply:
        'I can help with:\n' +
        '• Finding an item — "where is the milk?" tells you the aisle and shelf\n' +
        '• Prices — "how much is UNO?"\n' +
        '• Store info — sections, timings, address and phone number\n' +
        '• The app — scanning, quantities, paying, bill IDs and refunds\n' +
        '• Your account — offers, coupons and past bills',
      suggestions: inShop ? starterChips(shopId) : DEFAULT_CHIPS,
    };
  }

  if (has(text, /\b(what (is|does) (this|the) app|about (this|the) app|how does (this|the) app work|smart checkout|how to use|how do i use|scan and go)\b/)) {
    return {
      reply:
        `Smart Checkout lets you skip the billing queue. You scan products yourself as you shop, watch your e-bill build up live, then pay in the app and walk out.\n\n` +
        `1. Pick your shop\n2. Scan each product's barcode with the camera — it's added to your bill\n3. Use + / − to change quantity, or the bin icon to remove\n4. Tap "End shopping & pay" and pay by UPI or card\n5. You get a bill ID, and the shop's staff get the same bill instantly`,
      suggestions: ['How do I scan?', 'How do I pay?', 'What is a bill ID?', 'Can I remove an item?'],
    };
  }

  // ---- Coupons / offers (before sections: "what offers do I have" must not read as a section query) ----
  if (has(text, /\b(coupon|coupons|offer|offers|discount|promo|promotion|deal|deals|voucher|cashback|sale)\b/)) {
    const rows = userId
      ? db
          .prepare(
            `SELECT c.code, c.title, c.min_spend_cents AS minSpend, uc.used_at AS usedAt, s.name AS shopName
             FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
             LEFT JOIN shops s ON s.id = c.shop_id
             WHERE uc.user_id = ? AND c.active = 1 ORDER BY uc.used_at IS NOT NULL, c.id`
          )
          .all(userId)
      : [];
    const open = rows.filter((r) => !r.usedAt);
    return {
      reply: open.length
        ? `You have ${open.length} offer${open.length === 1 ? '' : 's'}:\n${open
            .map(
              (r) =>
                `• **${r.code}** — ${r.title}${r.shopName ? ` (${r.shopName} only)` : ' (any shop)'}${
                  r.minSpend ? `, min spend ${money(r.minSpend)}` : ''
                }`
            )
            .join('\n')}\n\nOpen Profile → My coupons for the full terms.`
        : 'You have no active offers right now. New coupons show up in Profile → My coupons.',
      suggestions: ['How do I pay?', 'What sections are here?'],
    };
  }

  // ---- Item location / price / stock, driven by a product match ----
  if (inShop) {
    // A question naming a whole section ("where are the board games") gets the section, not one item.
    const namedSection = exactSectionMatch(shopId, message);
    const products = matchProducts(shopId, message);
    const namesProductExactly = products.length && normalize(message).includes(normalize(products[0].name));
    if (namedSection && !namesProductExactly && !wantsPrice) {
      return sectionAnswer(shopId, namedSection);
    }

    if (products.length) {
      const top = products[0];

      if (wantsPrice && !wantsLocation) {
        const lines = products.map((p) => `• ${p.name} — ${money(p.priceCents)}`).join('\n');
        return {
          reply:
            products.length === 1
              ? `${top.name} costs ${money(top.priceCents)}. You'll find it at ${[top.aisle, top.shelf].filter(Boolean).join(', ')}.`
              : `Prices at ${shopName}:\n${lines}`,
          suggestions: [`Where is ${top.name}?`, 'My offers', 'How do I pay?'],
          products,
        };
      }

      if (wantsStock && !wantsLocation) {
        return {
          reply:
            `Yes — ${shopName} stocks ${top.name} at ${money(top.priceCents)}. It's in ${[top.aisle, top.shelf]
              .filter(Boolean)
              .join(', ')}${top.section ? ` (${top.section})` : ''}.` +
            (products.length > 1 ? `\n\nAlso related: ${products.slice(1).map((p) => p.name).join(', ')}.` : ''),
          suggestions: [`Where is ${top.name}?`, `How much is ${top.name}?`, 'What sections are here?'],
          products,
        };
      }

      // Default for a product mention: where it is, plus the price.
      const extra = products.slice(1);
      return {
        reply:
          `${top.name} is in **${top.aisle}**${top.shelf ? `, **${top.shelf}**` : ''}${
            top.section ? ` — the ${top.section} section` : ''
          }. It costs ${money(top.priceCents)}.` +
          (extra.length ? `\n\nNearby matches:\n${extra.map((p) => `• ${whereText(p)}`).join('\n')}` : ''),
        suggestions: [`How much is ${top.name}?`, 'What sections are here?', 'How do I pay?'],
        products,
      };
    }

    // No product matched, but the question leans towards a section.
    const section = matchSection(shopId, message);
    if (section && (wantsLocation || wantsStock)) return sectionAnswer(shopId, section);

    // ---- Sections / what the shop sells ----
    if (
      has(
        text,
        /\b(sections|departments|categories|aisles|lanes|layout|store map|shop map|browse|what do you sell|what does .*sell|sold here|what can i buy|list of items|full list)\b/
      )
    ) {
      const sections = shopSections(shopId);
      return {
        reply: sections.length
          ? `${shopName} has ${sections.length} sections:\n${sections
              .map((s) => `• ${s.section} — ${s.aisle} (${s.n} item${s.n === 1 ? '' : 's'})`)
              .join('\n')}\n\nAsk me "where is <item>?" for an exact shelf.`
          : `I don't have a section list for ${shopName} yet.`,
        suggestions: starterChips(shopId),
      };
    }

    // ---- Cheapest / most expensive ----
    if (wantsPrice && has(text, /\b(cheapest|lowest|budget|most expensive|costliest|highest|dearest)\b/)) {
      const { cheapest, dearest } = cheapestAndDearest(shopId);
      const askCheap = has(text, /\b(cheapest|lowest|budget)\b/);
      const p = askCheap ? cheapest : dearest;
      return {
        reply: p
          ? `The ${askCheap ? 'cheapest' : 'most expensive'} item at ${shopName} is ${p.name} at ${money(p.priceCents)}.`
          : 'This shop has no products listed yet.',
        suggestions: ['What sections are here?', 'My offers'],
      };
    }
  }

  // ---- Shop information ----
  if (has(text, /\b(timing|timings|hours|open|opens|close|closes|closing|opening|when.*open)\b/)) {
    return {
      reply: inShop
        ? `${shopName} is open ${shop.hours}.`
        : 'Pick a shop first and I can tell you its opening hours.',
      suggestions: inShop ? ['Shop address', 'Phone number', 'What sections are here?'] : DEFAULT_CHIPS,
    };
  }
  if (has(text, /\b(address|located|where is the (shop|store)|directions|reach|how to get)\b/)) {
    return {
      reply: inShop ? `${shopName} is at ${shop.address}. Open ${shop.hours}.` : 'Pick a shop first and I can give you its address.',
      suggestions: inShop ? ['Shop timings', 'Phone number', 'What sections are here?'] : DEFAULT_CHIPS,
    };
  }
  if (has(text, /\b(phone|contact|call|number|helpline|customer care|support)\b/)) {
    return {
      reply: inShop
        ? `You can call ${shopName} on ${shop.phone || 'the number on your receipt'}. In-store staff can also help at the counter.`
        : 'Pick a shop and I can share its contact number.',
      suggestions: inShop ? ['Shop timings', 'Shop address'] : DEFAULT_CHIPS,
    };
  }
  if (inShop && has(text, /\b(about|tell me about|info|information|which shop|this shop|this store)\b/)) {
    const sections = shopSections(shopId);
    const count = db.prepare('SELECT COUNT(*) AS n FROM products WHERE shop_id = ?').get(shopId).n;
    return {
      reply: `${shop.icon || ''} ${shopName}\n${shop.tagline || ''}\n\n• Address: ${shop.address}\n• Open: ${shop.hours}\n• Phone: ${
        shop.phone || '—'
      }\n• ${count} products across ${sections.length} sections`,
      suggestions: ['What sections are here?', ...starterChips(shopId).slice(0, 1), 'My offers'],
    };
  }

  // ---- How the app works ----
  if (has(text, /\b(scan|scanning|barcode|camera|qr)\b/)) {
    return {
      reply:
        'Point your phone camera at the barcode on the product — it is added to your e-bill straight away, with a buzz to confirm. Scanning the same item again will not double it; use the + button to add more. No camera? Type the barcode number in the box under the scanner and tap Add.',
      suggestions: ['Can I remove an item?', 'How do I pay?', 'What is a bill ID?'],
    };
  }
  if (has(text, /\b(remove|delete|quantity|qty|change.*(item|amount)|wrong item|mistake|undo)\b/)) {
    return {
      reply:
        'On the scan screen each line of your bill has − and + to change quantity, and a bin icon to remove the item completely. The total updates instantly. You can edit freely until you tap "End shopping & pay".',
      suggestions: ['How do I pay?', 'How do I scan?', 'What is a bill ID?'],
    };
  }
  if (has(text, /\b(pay|payment|paying|checkout|upi|card|gpay|google pay|phonepe|paytm|cash|netbanking)\b/)) {
    return {
      reply:
        'Tap "End shopping & pay" at the bottom of your bill, then pick how to pay:\n\n• UPI app — opens GPay / PhonePe / Paytm with the exact amount and the bill ID in the note. After paying, come back and tap "I have paid".\n• Card — a secure payment page opens in the app.\n\nOnce payment succeeds you get a bill ID, and the shop staff see the same bill on their dashboard immediately.',
      suggestions: ['What is a bill ID?', 'Can I get a refund?', 'My offers'],
    };
  }
  if (has(text, /\b(bill id|bill number|receipt|invoice|proof|show.*(bill|receipt)|past bill|my bill|history|bills)\b/)) {
    return {
      reply:
        'Every paid bill gets a short unique bill ID (for example 4827). It is your proof of purchase — show it to staff at the exit if they ask. All your bills live under "My past bills" in your profile, with items, totals and whether staff have reviewed them.',
      suggestions: ['Can I get a refund?', 'How do I pay?', 'My offers'],
    };
  }
  if (has(text, /\b(refund|return|returns|exchange|replace|cancel.*(bill|order)|money back)\b/)) {
    return {
      reply:
        'Refunds and returns are handled by the shop staff at the counter — show them your bill ID and they can look the bill up on their dashboard. If a payment failed but money left your account, it is reversed automatically by your bank; the app will not have created a bill ID in that case.',
      suggestions: ['What is a bill ID?', 'Phone number', 'How do I pay?'],
    };
  }
  if (has(text, /\b(queue|line|counter|exit|security|leave|walk out|checkout counter)\b/)) {
    return {
      reply:
        'That is the whole point of Smart Checkout — once you have paid in the app there is no billing queue. Walk to the exit and show your bill ID if staff ask. They already have your bill on their dashboard.',
      suggestions: ['How do I pay?', 'What is a bill ID?'],
    };
  }

  // ---- Account / profile ----
  if (has(text, /\b(profile|account|my details|my info|email|password|dark mode|theme|settings|log out|logout)\b/)) {
    return {
      reply:
        'Your profile holds your details, how much you have spent, your coupons and all your past bills. You will also find the Appearance switch there — System, Light or Dark.',
      suggestions: ['My offers', 'What is a bill ID?'],
    };
  }

  // ---- Cart questions ----
  if (has(text, /\b(cart|basket|my total|total so far|how many items|trolley)\b/)) {
    const cart = userId
      ? db
          .prepare(
            `SELECT c.id, s.name AS shopName,
                    (SELECT COALESCE(SUM(ci.quantity), 0) FROM cart_items ci WHERE ci.cart_id = c.id) AS items,
                    (SELECT COALESCE(SUM(ci.quantity * p.price_cents), 0) FROM cart_items ci
                       JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = c.id) AS totalCents
             FROM carts c JOIN shops s ON s.id = c.shop_id
             WHERE c.user_id = ? AND c.status IN ('active', 'pending_payment') ORDER BY c.id DESC LIMIT 1`
          )
          .get(userId)
      : null;
    return {
      reply:
        cart && cart.items > 0
          ? `Your bill at ${cart.shopName} has ${cart.items} item${cart.items === 1 ? '' : 's'}, totalling ${money(cart.totalCents)}.`
          : 'Your bill is empty right now. Scan a product barcode to start adding items.',
      suggestions: inShop ? ['How do I pay?', ...starterChips(shopId).slice(0, 1)] : ['How do I pay?', 'How do I scan?'],
    };
  }

  // ---- Safety net: if a product almost matched, offer it ----
  if (inShop) {
    const loose = matchProducts(shopId, message, 3);
    if (loose.length) {
      return {
        reply: `I'm not sure what you meant, but did you mean one of these?\n${loose.map((p) => `• ${whereText(p)}`).join('\n')}`,
        suggestions: loose.map((p) => `Where is ${p.name}?`).slice(0, 3),
        products: loose,
      };
    }

    // Asked for something this shop doesn't stock - say so, and name a shop that does.
    if (wantsLocation || wantsStock || wantsPrice) {
      const elsewhere = db
        .prepare(
          `SELECT s.name AS shopName, p.name, p.price_cents AS priceCents FROM products p
           JOIN shops s ON s.id = p.shop_id WHERE p.shop_id <> ?`
        )
        .all(shopId)
        .map((row) => ({ row, score: tokens(message).filter((w) => normalize(row.name).includes(w)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.row;

      return {
        reply: elsewhere
          ? `${shopName} doesn't stock that. ${elsewhere.shopName} has ${elsewhere.name} at ${money(
              elsewhere.priceCents
            )} — you can switch shops from the shop list.`
          : `I couldn't find that in ${shopName}. Try the product's exact name, or ask "what sections are here?" to see what this shop stocks.`,
        suggestions: ['What sections are here?', 'What can you do?'],
      };
    }
  }

  return {
    reply:
      "Sorry, I didn't understand that. I can help you find an item in the shop, check a price, explain how scanning and paying work, or show your offers and bills.",
    suggestions: inShop ? [...starterChips(shopId).slice(0, 2), 'How do I pay?', 'What can you do?'] : DEFAULT_CHIPS,
  };
}

const router = express.Router();
router.use(requireAuth);

router.post('/', (req, res) => {
  const message = String(req.body.message || '').slice(0, 300);
  const shopId = Number(req.body.shopId) || null;
  const shop = shopId ? db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId) : null;
  res.json(answer({ message, shop, userId: req.user.id }));
});

// Opening message + starter chips, so the chat is never an empty box.
router.get('/intro', (req, res) => {
  const shopId = Number(req.query.shopId) || null;
  const shop = shopId ? db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId) : null;
  res.json({
    reply: shop
      ? `Hi! I'm your ${shop.name} assistant. Ask me where an item is, what it costs, or how the app works.`
      : "Hi! I'm the Smart Checkout assistant. Ask me how the app works, or pick a shop and I'll help you find things in it.",
    suggestions: shop ? starterChips(shop.id) : DEFAULT_CHIPS,
  });
});

module.exports = { router, answer };
