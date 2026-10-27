import test from 'node:test';
import assert from 'node:assert/strict';
import { VisibleFeed, LazyResource, setHtml } from '../public/view-lifecycle.js';
import { dispatch } from '../plugin/tools.js';
import { widgetView } from './fixtures/widget-view.js';

function fixture(bootstrap = () => false) {
  let visible = false; const sources = [], states = [];
  const feed = new VisibleFeed({ visible: () => visible, bootstrap, receive: state => states.push(state), error() {}, create: () => {
    const source = { closed: false, close() { this.closed = true; } }; sources.push(source); return source;
  } });
  return { feed, sources, states, show: value => { visible = value; feed.sync(); }, emit: (index, value) => sources[index].onmessage({ data: JSON.stringify(value) }) };
}

test('hidden browser views open no stream; show/hide owns exactly one current subscription', () => {
  const f = fixture(); f.feed.sync(); assert.equal(f.sources.length, 0);
  f.show(true); f.show(true); assert.equal(f.sources.length, 1); f.emit(0, { version: 1 });
  f.show(false); assert.equal(f.sources[0].closed, true);
  f.emit(0, { version: 'stale' }); assert.deepEqual(f.states, [{ version: 1 }]);
  f.show(true); f.emit(1, { version: 2 }); assert.deepEqual(f.states, [{ version: 1 }, { version: 2 }]);
  f.feed.close(); f.emit(1, { version: 'closed' }); assert.equal(f.sources[1].closed, true);
  assert.deepEqual(f.states, [{ version: 1 }, { version: 2 }]);
  f.feed.sync(); assert.equal(f.sources.length, 3); f.feed.close();
});

test('native hidden bootstrap completes readiness, then releases its initial subscription', () => {
  let ready = false; const f = fixture(() => !ready);
  f.feed.sync(); f.emit(0, { tasks: [] }); assert.equal(f.sources[0].closed, false);
  ready = true; f.feed.sync(); assert.equal(f.sources[0].closed, true);
  f.show(false); assert.equal(f.sources.length, 1);
  f.show(true); assert.equal(f.sources.length, 2); f.feed.close();
});

test('a native one-snapshot bootstrap does not reconnect while hidden', () => {
  let ready = false; const f = fixture(() => !ready);
  f.feed.receive = value => { f.states.push(value); ready = true; };
  f.feed.sync(); f.emit(0, {}); f.feed.sync();
  assert.equal(f.sources.length, 1); assert.equal(f.sources[0].closed, true);
});

test('unused artwork does not load; first use is shared and later use is cached', async () => {
  let loads = 0, finish;
  const resource = new LazyResource(() => { loads++; return new Promise(resolve => { finish = resolve; }); });
  assert.equal(loads, 0);
  const first = resource.ensure(), second = resource.ensure(); await Promise.resolve(); assert.equal(loads, 1);
  finish(); await Promise.all([first, second]); await resource.ensure(); assert.equal(loads, 1);
});

test('failed artwork requests use a retry delay instead of retrying every render', async t => {
  t.mock.timers.enable({ apis: ['Date'] }); let loads = 0;
  const resource = new LazyResource(async () => { loads++; throw Error('fixture'); });
  await assert.rejects(resource.ensure()); await resource.ensure(); assert.equal(loads, 1);
  t.mock.timers.tick(30001); await assert.rejects(resource.ensure()); assert.equal(loads, 2);
});

test('identical rendering preserves nodes without serializing or replacing the DOM', () => {
  let writes = 0;
  const element = { set innerHTML(_value) { writes++; }, get innerHTML() { throw Error('DOM should not be serialized to compare it'); } };
  assert.equal(setHtml(element, '<button>fixture</button>'), true);
  assert.equal(setHtml(element, '<button>fixture</button>'), false);
  assert.equal(setHtml(element, '<button>updated</button>'), true); assert.equal(writes, 2);
});

test('MCP status reuses the verified handshake snapshot without another full state read', async () => {
  let reads = 0;
  const state = { tasks: [], approvals: [], settings: { enabled: false }, app: 'codex-continuer' };
  const result = await dispatch('continuer_status', {}, { ensureService: async () => { reads++; return state; }, request: async () => { throw Error('Redundant state request'); } });
  assert.equal(reads, 1); assert.equal(result.settings.enabled, false);
});

test('opening a widget delegates its own startup check rather than checking it twice', async () => {
  let opens = 0;
  await dispatch('continuer_open_widget', {}, { ensureService: async () => { throw Error('Duplicate startup check'); }, openWidget: async () => { opens++; return { ready: true }; } });
  assert.equal(opens, 1);
});

test('widget loads only its current view, stops idle work while hidden and restores fresh state', async () => {
  const f = widgetView(); await f.flush();
  const state = { connection: { status: 'connected' }, settings: { enabled: false, pollSeconds: 30, minimumRemaining: 5, maxRounds: 20, maxWakeSends: 20 }, sampledAt: Date.now(), quota: { rateLimits: { primary: { usedPercent: 10, resetsAt: Date.now() / 1000 + 3600 } } }, tasks: [], approvals: [], logs: [] };
  f.message(0, state); await f.flush();
  assert.equal(f.requests.filter(path => path === '/rhine-signal-loop.svg').length, 1);
  assert.equal(f.requests.includes('/api/threads'), false); assert.equal(f.element('#tasks').writes, 0);
  f.desktop({ expanded: true }); await f.flush();
  assert.equal(f.requests.filter(path => path === '/api/threads').length, 1); assert.equal(f.element('#tasks').writes, 1);
  const writes = f.element('#tasks').writes;
  f.message(0, { ...state, sampledAt: Date.now() + 1 }); assert.equal(f.element('#tasks').writes, writes);
  f.desktop({ visible: false }); assert.equal(f.intervals.size, 0); assert.equal(f.sources[0].closed, true);
  f.desktop({ visible: true }); await f.flush();
  assert.equal(f.requests.filter(path => path === '/api/threads').length, 1); assert.equal(f.sources.length, 2);
  f.message(1, { ...state, tasks: [{ id: 'new', name: 'New fixture', status: 'paused', cwd: 'fixture', rounds: 0 }] });
  assert.equal(f.element('#tasks').writes, writes + 1); assert.match(f.element('#tasks').innerHTML, /New fixture/);
  f.desktop({ expanded: false }); await f.flush();
  assert.equal(f.requests.filter(path => path === '/rhine-signal-loop.svg').length, 1);
  f.desktop({ visible: false }); assert.equal(f.intervals.size, 0);
});

async function quotaView(reducedMotion = false) {
  const view = widgetView({ reducedMotion }); await view.flush();
  const now = view.now();
  const sample = { connection: { status: 'connected' }, settings: { enabled: false }, sampledAt: now, quota: { rateLimits: {
    primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: now / 1000 + 3600 },
    secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: now / 1000 + 7200 },
  } }, tasks: [], approvals: [], logs: [] };
  view.message(0, sample); await view.flush(); return view;
}

test('quota carousel dwells for twelve seconds and switches all values at the fade midpoint', async () => {
  const view = await quotaView(), mini = view.element('#mini');
  assert.equal(view.element('#mini-quota').textContent, '77');
  view.advance(11999); assert.equal(mini.classList.contains('is-refreshing'), false);
  view.advance(1); assert.equal(mini.classList.contains('is-refreshing'), true);
  view.advance(499); assert.equal(view.element('#mini-window').textContent, '五小时可用额度');
  view.advance(1); assert.equal(view.element('#mini-quota').textContent, '39'); assert.equal(view.element('#mini-window').textContent, '七天可用额度');
  assert.equal(view.element('#mini-reset').textContent, '01:59:48');
  view.advance(500); assert.equal(mini.classList.contains('is-refreshing'), false);
  view.advance(11000); assert.equal(mini.classList.contains('is-refreshing'), true);
  view.advance(500); assert.equal(view.element('#mini-quota').textContent, '77'); assert.equal(view.element('#mini-window').textContent, '五小时可用额度');
  assert.equal(view.requests.filter(path => path === '/rhine-signal-loop.svg').length, 1);
});

test('hiding or expanding during a quota fade cancels the pending swap and animation timers', async () => {
  const view = await quotaView(), mini = view.element('#mini');
  view.advance(12250); assert.equal(mini.classList.contains('is-refreshing'), true);
  view.desktop({ visible: false }); assert.equal(view.intervals.size, 0); assert.equal(view.timeouts.size, 0); assert.equal(mini.classList.contains('is-refreshing'), false);
  view.advance(2000); assert.equal(view.element('#mini-quota').textContent, '77');
  view.desktop({ visible: true }); view.advance(12250);
  view.desktop({ expanded: true }); assert.equal(mini.classList.contains('is-refreshing'), false); assert.equal(view.timeouts.size, 0);
});

test('reduced motion retains the longer dwell and switches without fade timers', async () => {
  const view = await quotaView(true);
  view.advance(11999); assert.equal(view.element('#mini-quota').textContent, '77');
  view.advance(1); assert.equal(view.element('#mini-quota').textContent, '39');
  assert.equal(view.element('#mini').classList.contains('is-refreshing'), false); assert.equal(view.timeouts.size, 0);
  view.advance(12000); assert.equal(view.element('#mini-quota').textContent, '77');
});
