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
  const previous = rendered.get(element);
  if (previous?.html === html && previous.first === element.firstChild) return false;
  element.innerHTML = html; rendered.set(element, { html, first: element.firstChild }); return true;
}

export function setDetailHtml(element, html) {
  const container = element.closest?.('dialog') || element;
  const scroll = container.scrollTop;
  const outputs = [...(element.querySelectorAll('pre') || [])].map(node => ({ top: node.scrollTop, bottom: node.scrollHeight > node.clientHeight && node.scrollHeight - node.clientHeight - node.scrollTop < 2 }));
  const document = element.ownerDocument, selection = document?.getSelection?.();
  let selected;
  if (selection?.rangeCount && element.contains(selection.anchorNode) && element.contains(selection.focusNode)) {
    const range = selection.getRangeAt(0), prefix = range.cloneRange();
    prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
    selected = { text: range.toString(), offset: prefix.toString().length };
  }
  if (!setHtml(element, html)) return;
  container.scrollTop = scroll;
  [...element.querySelectorAll('pre')].forEach((node, index) => { const old = outputs[index]; if (old) node.scrollTop = old.bottom ? node.scrollHeight : old.top; });
  if (selected?.text) {
    const text = element.textContent;
    let start = text.indexOf(selected.text);
    for (let at = start; at >= 0; at = text.indexOf(selected.text, at + 1)) {
      if (Math.abs(at - selected.offset) < Math.abs(start - selected.offset)) start = at;
      if (at >= selected.offset) break;
    }
    if (start < 0) return;
    const range = document.createRange(), walker = document.createTreeWalker(element, 4);
    let node, offset = 0, began = false;
    while ((node = walker.nextNode())) {
      const end = offset + node.length;
      if (!began && end > start) { range.setStart(node, start - offset); began = true; }
      if (began && end >= start + selected.text.length) { range.setEnd(node, start + selected.text.length - offset); selection.removeAllRanges(); selection.addRange(range); break; }
      offset = end;
    }
  }
}
