import { mountPage } from '../../public/app.js';
import { mountWidget } from '../../public/widget.js';

export function widgetView(options = {}) { return interfaceView('widget', options); }
export function pageView(options = {}) { return interfaceView('page', options); }

function interfaceView(surface, { reducedMotion = true, threads = async () => ({ data: [], nextCursor: null }), task = async () => ({ task: null }), request = null } = {}) {
  const elements = new Map(), requests = [], apiCalls = [], sources = [], intervals = new Map(), timeouts = new Map(), events = new Map();
  let now = Date.now();
  let serial = 0, desktopListener;
  const classes = initial => { const values = new Set(initial); return { contains: key => values.has(key), add: key => values.add(key), remove: key => values.delete(key), toggle(key, on = !values.has(key)) { on ? values.add(key) : values.delete(key); } }; };
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', open: false, writes: 0, dataset: {}, classList: classes([]), style: { setProperty() {} },
      set innerHTML(value) { this.html = value; this.writes++; }, get innerHTML() { return this.html || ''; },
      addEventListener(name, callback) { (this.events ||= new Map()).set(name, callback); }, emit(name) { this.events?.get(name)?.(); }, setAttribute() {}, replaceChildren() {}, close() { this.open = false; }, showModal() { this.open = true; }, querySelectorAll: () => [], closest: () => null,
      querySelector: query => element(`${selector} ${query}`),
      elements: { namedItem: name => element(`${selector} [name=${name}]`) },
    });
    return elements.get(selector);
  };
  const desktop = { expanded: false, visible: false, follow: false, compactSize: 256, panelSize: { width: 414, height: 702 } };
  const bridge = { onState: callback => { desktopListener = callback; }, async control(action) { if (action === 'renderer-ready') desktop.visible = true; return { ...desktop }; } };
  const querySelector = selector => surface === 'page' && selector.startsWith('#settings-form') && !element('#main').innerHTML.includes('id="settings-form"') ? null : element(selector);
  const document = { hidden: false, activeElement: null, body: { classList: classes(surface === 'widget' ? ['collapsed'] : []) }, documentElement: { style: { setProperty() {} } }, querySelector, querySelectorAll: () => [], importNode: value => value, addEventListener(name, callback) { events.set(name, callback); } };
  class ViewDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  class ViewFormData {
    constructor(form) { this.values = form.values || {}; }
    [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
  }
  const context = { document, window: { continuerDesktop: surface === 'widget' ? bridge : undefined, matchMedia: () => ({ matches: reducedMotion }), addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, Date: ViewDate, FormData: ViewFormData,
    createSource() { const source = { close() { this.closed = true; } }; sources.push(source); return source; },
    AbortSignal, getComputedStyle: () => ({ opacity: '1' }), DOMParser: class { parseFromString() { return { querySelector: () => null, documentElement: {} }; } },
    setInterval(callback, period) { const id = ++serial; intervals.set(id, { callback, period, at: now + period }); return id; }, clearInterval: id => intervals.delete(id),
    setTimeout(callback, period) { const id = ++serial; timeouts.set(id, { callback, at: now + period }); return id; }, clearTimeout: id => timeouts.delete(id),
    async fetch(path, options) {
      requests.push(path); apiCalls.push({ path, options });
      const data = request ? await request(path, options) : path.startsWith('/api/threads') ? await threads(path, options) : path.startsWith('/api/tasks/') ? await task(path, options) : {};
      return { ok: true, json: async () => data, text: async () => '<svg/>' };
    },
  };
  (surface === 'widget' ? mountWidget : mountPage)(context);
  return { requests, apiCalls, sources, intervals, timeouts, element, now: () => now,
    action(action, id) { return events.get('click')({ target: { closest: () => ({ dataset: { action, id } }) } }); },
    page(page) { return events.get('click')({ target: { closest: () => ({ dataset: { page } }) } }); },
    submit(id, values, dataset = {}) {
      const form = element('#' + id); Object.assign(form, { id, values, dataset });
      return events.get('submit')({ target: form, preventDefault() {} });
    },
    visible(value) { document.hidden = !value; events.get('visibilitychange')?.(); },
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
    message(index, state) { sources[index].onmessage({ data: JSON.stringify({ version: '0.5.1', buildId: 'fixture', history: [], ...state }) }); },
    flush: () => new Promise(resolve => setImmediate(resolve)),
  };
}
