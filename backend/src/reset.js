// Deletes the database file so the next start re-seeds demo data.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
for (const f of ['shop.db', 'shop.db-wal', 'shop.db-shm']) {
  fs.rmSync(path.join(dir, f), { force: true });
}
console.log('Database removed. It will be re-seeded on next start.');
