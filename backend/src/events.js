// Server-Sent Events hub: pushes new/updated bills to the staff dashboard of the right shop.
const clients = new Map(); // shopId -> Set<res>

function subscribe(shopId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write('event: ready\ndata: {}\n\n');

  if (!clients.has(shopId)) clients.set(shopId, new Set());
  clients.get(shopId).add(res);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => {
    clearInterval(heartbeat);
    clients.get(shopId)?.delete(res);
  });
}

function publish(shopId, event, data) {
  const set = clients.get(shopId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

module.exports = { subscribe, publish };
