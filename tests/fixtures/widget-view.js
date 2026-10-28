import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { VisibleFeed, LazyResource, setHtml } from '../../public/view-lifecycle.js';
import { TaskDetails } from '../../public/task-details.js';
import { ApprovalDetails } from '../../public/approval-details.js';
import { storageNotice } from '../../public/storage-status.js';
import { taskMode, wakeExplanation } from '../../public/task-mode.js';
import { quotaWindow, resetCountdown } from '../../public/quota-display.js';
import { pixelText } from '../../public/rhine-readout.js';
import * as i18n from '../../public/i18n.js';

export function widgetView({ reducedMotion = true, threads = async () => ({ data: [], nextCursor: null }) } = {}) {
  const elements = new Map(), requests = [], sources = [], intervals = new Map(), timeouts = new Map(), events = new Map();
  let now = Date.now();
  let serial = 0, desktopListener;
  const classes = initial => { const values = new Set(initial); return { contains: key => values.has(key), add: key => values.add(key), remove: key => values.delete(key), toggle(key, on = !values.has(key)) { on ? values.add(key) : values.delete(key); } }; };
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', open: false, writes: 0, dataset: {}, classList: classes([]), style: { setProperty() {} },
      set innerHTML(value) { this.html = value; this.writes++; }, get innerHTML() { return this.html || ''; },
      addEventListener(name, callback) { (this.events ||= new Map()).set(name, callback); }, emit(name) { this.events?.get(name)?.(); }, setAttribute() {}, replaceChildren() {}, close() { this.open = false; }, showModal() { this.open = true; }, querySelectorAll: () => [], closest: () => null,
    });
    return elements.get(selector);
  };
  const desktop = { expanded: false, visible: false, follow: false, compactSize: 256, panelSize: { width: 414, height: 702 } };
  const bridge = { onState: callback => { desktopListener = callback; }, async control(action) { if (action === 'renderer-ready') desktop.visible = true; return { ...desktop }; } };
  class Feed extends VisibleFeed { constructor(options) { super({ ...options, create: () => { const source = { close() { this.closed = true; } }; sources.push(source); return source; } }); } }
  const document = { hidden: false, activeElement: null, body: { classList: classes(['collapsed']) }, documentElement: { style: { setProperty() {} } }, querySelector: element, importNode: value => value, addEventListener(name, callback) { events.set(name, callback); } };
  class ViewDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = { document, window: { continuerDesktop: bridge, matchMedia: () => ({ matches: reducedMotion }), addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, Date: ViewDate,
    ...i18n, tr: i18n.t,
    TaskDetails, ApprovalDetails, VisibleFeed: Feed, LazyResource, setHtml, storageNotice, taskMode, wakeExplanation,
    quotaWindow: (state, slot, connected) => quotaWindow(state, slot, connected, now), resetCountdown: value => resetCountdown(value, now), pixelText, accessHeaders: () => ({}),
    AbortSignal, getComputedStyle: () => ({ opacity: '1' }), DOMParser: class { parseFromString() { return { querySelector: () => null, documentElement: {} }; } },
    setInterval(callback, period) { const id = ++serial; intervals.set(id, { callback, period, at: now + period }); return id; }, clearInterval: id => intervals.delete(id),
    setTimeout(callback, period) { const id = ++serial; timeouts.set(id, { callback, at: now + period }); return id; }, clearTimeout: id => timeouts.delete(id),
    async fetch(path) { requests.push(path); const data = path.startsWith('/api/threads') ? await threads(path) : {}; return { ok: true, json: async () => data, text: async () => '<svg/>' }; },
  };
  Object.defineProperty(context, 'wakeExplanation', { get: () => wakeExplanation });
  const source = readFileSync(new URL('../../public/widget.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
  runInNewContext(source, context);
  return { requests, sources, intervals, timeouts, element, now: () => now,
    action(action, id) { return events.get('click')({ target: { closest: () => ({ dataset: { action, id } }) } }); },
    advance(duration) {
      const end = now + duration;
      while (true) {
        const next = [...intervals, ...timeouts].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at;
        if (intervals.has(id)) timer.at += timer.period; else timeouts.delete(id);
        timer.callback();
      }
      now = end;
    },
    desktop(change) { Object.assign(desktop, change); desktopListener({ ...desktop }); },
    message(index, state) { sources[index].onmessage({ data: JSON.stringify(state) }); },
    flush: () => new Promise(resolve => setImmediate(resolve)),
  };
}
