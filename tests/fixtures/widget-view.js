import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { VisibleFeed, LazyResource, setHtml } from '../../public/view-lifecycle.js';
import { TaskDetails } from '../../public/task-details.js';
import { ApprovalDetails } from '../../public/approval-details.js';
import { storageNotice } from '../../public/storage-status.js';
import { taskMode, wakeExplanation } from '../../public/task-mode.js';
import { quotaWindow, resetCountdown } from '../../public/quota-display.js';
import { pixelText } from '../../public/rhine-readout.js';

export function widgetView() {
  const elements = new Map(), requests = [], sources = [], intervals = new Map();
  let serial = 0, desktopListener;
  const classes = initial => { const values = new Set(initial); return { contains: key => values.has(key), add: key => values.add(key), remove: key => values.delete(key), toggle(key, on = !values.has(key)) { on ? values.add(key) : values.delete(key); } }; };
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', open: false, writes: 0, dataset: {}, classList: classes([]), style: { setProperty() {} },
      set innerHTML(value) { this.html = value; this.writes++; }, get innerHTML() { return this.html || ''; },
      addEventListener() {}, setAttribute() {}, replaceChildren() {}, close() { this.open = false; }, showModal() { this.open = true; }, querySelectorAll: () => [],
    });
    return elements.get(selector);
  };
  const desktop = { expanded: false, visible: false, follow: false, compactSize: 256, panelSize: { width: 414, height: 702 } };
  const bridge = { onState: callback => { desktopListener = callback; }, async control(action) { if (action === 'renderer-ready') desktop.visible = true; return { ...desktop }; } };
  class Feed extends VisibleFeed { constructor(options) { super({ ...options, create: () => { const source = { close() { this.closed = true; } }; sources.push(source); return source; } }); } }
  const document = { hidden: false, activeElement: null, body: { classList: classes(['collapsed']) }, documentElement: { style: { setProperty() {} } }, querySelector: element, importNode: value => value, addEventListener() {} };
  const context = { document, window: { continuerDesktop: bridge, matchMedia: () => ({ matches: true }), addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} },
    TaskDetails, ApprovalDetails, VisibleFeed: Feed, LazyResource, setHtml, storageNotice, taskMode, wakeExplanation, quotaWindow, resetCountdown, pixelText, accessHeaders: () => ({}),
    AbortSignal, getComputedStyle: () => ({ opacity: '1' }), DOMParser: class { parseFromString() { return { querySelector: () => null, documentElement: {} }; } },
    setInterval(callback, period) { const id = ++serial; intervals.set(id, { callback, period }); return id; }, clearInterval: id => intervals.delete(id), setTimeout: () => ++serial, clearTimeout() {},
    async fetch(path) { requests.push(path); return { ok: true, json: async () => ({ data: [], nextCursor: null }), text: async () => '<svg/>' }; },
  };
  const source = readFileSync(new URL('../../public/widget.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
  runInNewContext(source, context);
  return { requests, sources, intervals, element,
    desktop(change) { Object.assign(desktop, change); desktopListener({ ...desktop }); },
    message(index, state) { sources[index].onmessage({ data: JSON.stringify(state) }); },
    flush: () => new Promise(resolve => setImmediate(resolve)),
  };
}
