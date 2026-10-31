import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import config from './config.cjs';
import widgetStateModule from './widget-state.cjs';

export function diagnostic(file) {
  try { if (statSync(file).size > 65536) return null; return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export class Health {
  constructor(dataDir, manager, stream) {
    this.dataDir = dataDir; this.manager = manager; this.stream = stream; this.startedAt = Date.now();
    this.file = join(dataDir, 'service-status.json'); this.previous = diagnostic(this.file);
  }
  record(status, reason = null) {
    try { writeFileSync(this.file, JSON.stringify({ ...config.appInfo(), pid: process.pid, status, reason, startedAt: this.startedAt, updatedAt: Date.now() }), { mode: 0o600 }); } catch {}
  }
  snapshot() {
    const widget = diagnostic(widgetStateModule.widgetState(this.dataDir, config.port, this.manager.demo).status);
    const watcher = diagnostic(join(this.dataDir, 'autostart-status.json'));
    const preferences = diagnostic(join(this.dataDir, 'autostart-preferences.json'));
    return { ...config.appInfo(), pid: process.pid, startedAt: this.startedAt, uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      observationOnly: this.manager.observationOnly, connection: this.manager.connection,
      persistence: { ...this.manager.persistence, ...this.manager.store.status?.(), pending: this.manager.pendingSave },
      previousExit: this.previous ? { status: this.previous.status, reason: this.previous.reason, unexpected: this.previous.status === 'running' || this.previous.status === 'crashed' } : null,
      resources: { sseClients: this.stream.clients.size, sseLimit: this.stream.limit, slowClientsDropped: this.stream.dropped, taskLimit: 100 },
      widget: { running: alive(widget?.pid), ready: !!widget?.ready && alive(widget?.pid), exitReason: widget?.exitReason || null, buildId: widget?.buildId || null },
      autostart: { enabled: preferences?.enabled ?? null, watcherRunning: alive(watcher?.pid), status: watcher?.state || watcher?.status || null },
      projectRoot: config.root, dataDir: this.dataDir };
  }
}
