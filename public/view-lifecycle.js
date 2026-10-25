import { AuthenticatedSource } from './access.js';
// The native main process injects its header for EventSource. Retain the native
// stream so hidden startup does not wait on Chromium's fetch body delivery.
// A hidden view does not need a live stream. Native startup may read exactly
// one snapshot before visibility is known, to complete its ready handshake.
export class VisibleFeed {
  constructor({ visible, receive, error, bootstrap = () => false, create = () => typeof window !== 'undefined' && window.continuerDesktop ? new EventSource('/api/events') : new AuthenticatedSource('/api/events') }) {
    Object.assign(this, { visible, receive, error, bootstrap, create }); this.source = null;
  }
  sync() {
    if (!this.visible() && !this.bootstrap()) { this.close(); return; }
    if (this.source) return;
    const source = this.create(); this.source = source;
    source.onmessage = event => {
      if (this.source !== source) return;
      this.receive(JSON.parse(event.data)); this.sync();
    };
    source.onerror = error => { if (this.source === source) this.error(error); };
  }
  close() { const source = this.source; this.source = null; source?.close(); }
}

export class LazyResource {
  constructor(load) { this.load = load; this.pending = null; this.loaded = false; this.retryAt = 0; }
  ensure() {
    if (this.loaded || Date.now() < this.retryAt) return Promise.resolve();
    if (!this.pending) this.pending = Promise.resolve().then(() => this.load()).then(() => { this.loaded = true; }, error => { this.retryAt = Date.now() + 30000; throw error; }).finally(() => { this.pending = null; });
    return this.pending;
  }
}

// Preserve focus, selection and DOM nodes if only unrelated state changed.
const rendered = new WeakMap();
export function setHtml(element, html) {
  if (rendered.get(element) === html) return false;
  element.innerHTML = html; rendered.set(element, html); return true;
}
