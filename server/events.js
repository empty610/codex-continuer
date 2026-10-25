export class StateStream {
  constructor({ limit = 16 } = {}) { this.limit = limit; this.clients = new Set(); this.dropped = 0; this.blocked = new WeakSet(); }
  write(client, frame) {
    try {
      if (client.destroyed || this.blocked.has(client) || Buffer.byteLength(frame) > 1024 * 1024) { this.drop(client); return false; }
      if (!client.write(frame)) {
        this.blocked.add(client);
        const deadline = setTimeout(() => this.drop(client), 15000); deadline.unref();
        const finished = () => { this.blocked.delete(client); clearTimeout(deadline); client.off('drain', finished); client.off('close', finished); };
        client.once('drain', finished); client.once('close', finished);
      }
      return true;
    } catch { this.drop(client); return false; }
  }
  drop(client) { this.clients.delete(client); this.dropped++; client.destroy(); }
  add(req, res, state) {
    if (this.clients.size >= this.limit) return false;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    this.clients.add(res);
    let heartbeat;
    res.once('close', () => { this.clients.delete(res); clearInterval(heartbeat); });
    if (!this.write(res, `data: ${JSON.stringify(state)}\n\n`)) return true;
    heartbeat = setInterval(() => this.write(res, ': heartbeat\n\n'), 15000);
    heartbeat.unref();
    return true;
  }
  broadcast(state) {
    if (!this.clients.size) return;
    const frame = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of this.clients) this.write(client, frame);
  }
  close() { for (const client of this.clients) client.end(); this.clients.clear(); }
}
