import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { basename, join } from 'node:path';
import { createLifecycle } from '../plugin/lifecycle.js';
import widgetStateModule from '../server/widget-state.cjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const unavailable = () => Object.assign(Error('No listener'), { cause: { code: 'ECONNREFUSED' } });
function fixture(overrides = {}) {
  const root = join(process.cwd(), 'fixture-plugin'), dataDir = join(root, 'fixture-data');
  const info = { app: 'codex-continuer', protocolVersion: 4, buildId: 'fixture-build' };
  const state = { ...info, diagnostics: { dataDir, projectRoot: root, pid: 123 }, settings: { enabled: true }, observationOnly: false };
  const launches = [], reads = [], diagnostics = new Map(); let clock = 0, exited = false, clears = 0;
  const host = { root, dataDir, port: 4317, platform: 'win32', serviceNode: 'fixture-node', widgetNode: 'fixture-widget-node',
    appInfo: () => info, request: async () => state, exists: () => true, alive: pid => pid === 123,
    diagnostic: path => diagnostics.get(basename(path)),
    launch: (command, args, name, env) => { const child = new EventEmitter(); child.on('error', () => {}); launches.push({ command, args, name, env, child }); return child; },
    quit: { requested: () => exited, clear: () => { exited = false; clears++; } },
    shutdown: async () => { exited = true; }, now: () => clock,
    wait: async ms => { clock += ms; }, ...overrides };
  const request = host.request;
  host.request = async (...args) => { reads.push(args); return request(...args); };
  const lifecycle = createLifecycle(host);
  return { lifecycle, host, state, info, launches, reads, diagnostics, set exited(value) { exited = value; }, get exited() { return exited; }, get clears() { return clears; }, get now() { return clock; } };
}
const readyWidget = f => {
  const files = widgetStateModule.widgetState(f.host.dataDir, f.host.port, f.host.demo || false);
  f.diagnostics.set(basename(files.status), { ...files.identity, ready: true, buildId: f.info.buildId, pid: 123, follow: false });
};

test('constructing a lifecycle does no I/O and a warm query reuses the verified snapshot without altering scheduling', async () => {
  const f = fixture(); assert.equal(f.reads.length, 0); assert.equal(f.launches.length, 0);
  assert.equal(await f.lifecycle.ensureService(), f.state);
  assert.equal(f.reads.length, 1); assert.equal(f.launches.length, 0); assert.equal(f.clears, 0);
  assert.equal(f.state.settings.enabled, true); assert.equal(f.state.observationOnly, false);
});

test('parallel cold queries share one observation-only launch and release the startup promise on success', async () => {
  const initial = deferred(); let reads = 0;
  const f = fixture({ demo: true, request: async () => ++reads === 1 ? initial.promise : f.state });
  const queries = Array.from({ length: 20 }, () => f.lifecycle.ensureService());
  assert.ok(queries.every(value => value === queries[0])); initial.reject(unavailable());
  assert.ok((await Promise.all(queries)).every(value => value === f.state));
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.launches[0].args, [join(f.host.root, 'server/index.js'), '--observe-only', '--demo']);
  assert.equal(f.launches[0].command, 'fixture-node'); assert.deepEqual(f.launches[0].env, { PORT: '4317' });
  await f.lifecycle.ensureService(); assert.equal(reads, 3); assert.equal(f.launches[0].child.listenerCount('error'), 1);
});

test('only an absent service permits startup; authentication, TLS and foreign service errors never spawn another process', async () => {
  for (const error of [Error('HTTP 401'), Object.assign(Error('Invalid TLS identity'), { code: 'CERT_HAS_EXPIRED' }), Object.assign(Error('Request timed out'), { name: 'TimeoutError' })]) {
    const f = fixture({ request: async () => { throw error; } });
    await assert.rejects(f.lifecycle.ensureService(), value => value === error); assert.equal(f.launches.length, 0);
  }
  for (const patch of [{ app: 'foreign' }, { buildId: 'old-build' }, { protocolVersion: 3 }, { diagnostics: { dataDir: 'other' } }]) {
    const f = fixture(); Object.assign(f.state, patch);
    await assert.rejects(f.lifecycle.ensureService(), error => error.code?.startsWith('SERVICE_'));
    assert.equal(f.launches.length, 0);
  }
});

test('post-launch readiness uses the same service identity rules as a warm query', async () => {
  let reads = 0; const f = fixture({ request: async () => { if (++reads === 1) throw unavailable(); return { ...f.state, diagnostics: { dataDir: 'foreign' } }; } });
  await assert.rejects(f.lifecycle.ensureService(), { code: 'SERVICE_OWNER_MISMATCH' });
  assert.equal(f.launches.length, 1); assert.equal(reads, 2);
});

test('spawn failure is reported promptly and a later query may retry', async () => {
  let failed = true, waits = 0, reads = 0; const error = Error('Mock executable missing');
  const f = fixture({ request: async () => { if (reads++ < 2) throw unavailable(); return f.state; },
    wait: async () => { waits++; if (failed) { failed = false; f.launches.at(-1).child.emit('error', error); } } });
  await assert.rejects(f.lifecycle.ensureService(), value => value === error);
  assert.equal(waits, 1); assert.equal(f.launches[0].child.listenerCount('error'), 1);
  assert.equal(await f.lifecycle.ensureService(), f.state); assert.equal(reads, 3); assert.equal(f.launches.length, 2);
});

test('the readiness deadline bounds all retries and the transport receives only the remaining time budget', async () => {
  const f = fixture({ serviceTimeoutMs: 450, request: async () => { throw unavailable(); } });
  await assert.rejects(f.lifecycle.ensureService(), { code: 'SERVICE_START_TIMEOUT' });
  assert.equal(f.now, 450); assert.equal(f.launches.length, 1);
  assert.deepEqual(f.reads.map(args => args[2].timeoutMs), [2000, 300, 150]);
  assert.equal(f.launches[0].child.listenerCount('error'), 1);
});

test('exit blocks passive and automatic startup before I/O; explicit start clears only its own latch', async () => {
  const f = fixture(); f.exited = true;
  await assert.rejects(f.lifecycle.ensureService(), { code: 'EXIT_REQUESTED' });
  await assert.rejects(f.lifecycle.openWidget({ automatic: true }), { code: 'EXIT_REQUESTED' });
  assert.equal(f.reads.length, 0); assert.equal(f.clears, 0);
  assert.equal(await f.lifecycle.startService(), f.state); assert.equal(f.exited, false); assert.equal(f.clears, 1);
});

test('exiting during an initial query or startup wait prevents any later launch or readiness acceptance', async () => {
  for (const launched of [false, true]) {
    const pending = deferred(); let reads = 0;
    const f = fixture({ request: async () => { if (++reads === 1 && launched) throw unavailable(); return pending.promise; } });
    const query = f.lifecycle.ensureService();
    const expectedReads = launched ? 2 : 1;
    for (let attempt = 0; f.reads.length < expectedReads && attempt < 10; attempt++) await Promise.resolve();
    assert.equal(f.reads.length, expectedReads);
    await f.lifecycle.stopBackground(); pending.resolve(f.state);
    await assert.rejects(query, { code: 'EXIT_REQUESTED' });
    assert.equal(f.launches.length, launched ? 1 : 0); assert.equal(f.exited, true);
  }
});

test('concurrent exits share one shutdown and manual reopening waits for it before clearing the latch', async () => {
  const pending = deferred(); let exits = 0;
  const f = fixture({ shutdown: async () => { exits++; f.exited = true; await pending.promise; } }); readyWidget(f);
  const stop = f.lifecycle.stopBackground(); assert.equal(f.lifecycle.stopBackground(), stop);
  await assert.rejects(f.lifecycle.ensureService(), { code: 'EXIT_REQUESTED' });
  const reopen = f.lifecycle.openWidget(); await Promise.resolve(); assert.equal(f.clears, 0); assert.equal(f.launches.length, 0);
  pending.resolve(); await stop; assert.equal(exits, 1);
  assert.equal((await reopen).ready, true); assert.equal(f.clears, 1); assert.equal(f.launches.length, 1);

  for (const action of ['startService', 'openWidget']) {
    const first = deferred(), second = deferred(); let count = 0;
    const raced = fixture({ shutdown: async () => { raced.exited = true; await (++count === 1 ? first.promise : second.promise); } });
    const stopping = raced.lifecycle.stopBackground();
    const laterExit = stopping.then(() => raced.lifecycle.stopBackground());
    const reopening = raced.lifecycle[action]();
    first.resolve(); await assert.rejects(reopening, { code: 'EXIT_REQUESTED' });
    second.resolve(); await laterExit;
    assert.equal(raced.clears, 0); assert.equal(raced.exited, true); assert.equal(raced.launches.length, 0);
  }
});

test('a manual restart cannot reuse an earlier query or accept its stale response after exit', async () => {
  const oldRead = deferred(), newRead = deferred(); let reads = 0;
  const f = fixture({ request: () => ++reads === 1 ? oldRead.promise : reads === 2 ? newRead.promise : f.state });
  const old = f.lifecycle.ensureService().catch(error => error);
  await f.lifecycle.stopBackground(); const restart = f.lifecycle.startService();
  for (let attempt = 0; reads < 2 && attempt < 10; attempt++) await Promise.resolve();
  oldRead.resolve({ ...f.state, old: true }); newRead.resolve(f.state);
  const [outdated, current] = await Promise.all([old, restart]);
  assert.equal(outdated.code, 'EXIT_REQUESTED'); assert.equal(current, f.state); assert.equal(reads, 2);
  await f.lifecycle.ensureService(); assert.equal(reads, 3);
});

test('a widget wait from an earlier opening cannot overwrite a reopened widget even on its final attempt', async () => {
  const held = deferred(), f = fixture({ widgetAttempts: 1, wait: () => held.promise });
  const old = f.lifecycle.openWidget().catch(error => error);
  for (let attempt = 0; f.launches.length < 1 && attempt < 10; attempt++) await Promise.resolve();
  assert.equal(f.launches.length, 1);
  await f.lifecycle.stopBackground(); readyWidget(f);
  const current = f.lifecycle.openWidget(); held.resolve();
  const [outdated, ready] = await Promise.all([old, current]);
  assert.equal(outdated.code, 'EXIT_REQUESTED'); assert.equal(ready.ready, true); assert.equal(f.launches.length, 2);
  assert.ok(f.launches.every(item => item.child.listenerCount('error') === 1));
});

test('a synchronous stop notification from host I/O invalidates its caller without losing the returned promise', async () => {
  for (const action of ['ensureService', 'openWidget']) {
    let stopped;
    const f = fixture({ request: () => { stopped = f.lifecycle.stopBackground(); return f.state; } });
    await assert.rejects(f.lifecycle[action](), { code: 'EXIT_REQUESTED' });
    await stopped; assert.equal(f.launches.length, 0); assert.equal(f.exited, true);
  }
});

test('manual callers joining automatic opening share one widget and restore one watcher', async () => {
  const pending = deferred(), f = fixture({ request: () => pending.promise }); readyWidget(f);
  f.diagnostics.set('autostart-preferences.json', { enabled: true });
  const automatic = f.lifecycle.openWidget({ automatic: true });
  const manual = Array.from({ length: 10 }, () => f.lifecycle.openWidget()); pending.resolve(f.state);
  assert.equal((await automatic).ready, true); await Promise.all(manual);
  assert.deepEqual(f.launches.map(item => item.name), ['widget', 'watcher']);
  assert.deepEqual(f.launches[0].args, [join(f.host.root, 'desktop/main.cjs'), '--auto']);
  assert.equal(f.launches[0].env.CONTINUER_NODE, 'fixture-widget-node'); assert.equal(f.launches[0].env.ELECTRON_RUN_AS_NODE, undefined);
});

test('automatic and demo openings leave the watcher alone and automatic opening does not clear exit intent', async () => {
  for (const demo of [false, true]) {
    const f = fixture({ demo }); readyWidget(f); f.diagnostics.set('autostart-preferences.json', { enabled: true });
    await f.lifecycle.openWidget({ automatic: !demo });
    assert.deepEqual(f.launches.map(item => item.name), ['widget']); assert.equal(f.clears, demo ? 1 : 0);
  }
});

test('widget readiness requires a live process from this build and a failed opening can retry', async () => {
  const f = fixture({ widgetAttempts: 2 });
  f.diagnostics.set('widget-status.json', { ready: true, pid: 123, buildId: 'old' });
  await assert.rejects(f.lifecycle.openWidget(), { code: 'WIDGET_START_TIMEOUT' });
  f.diagnostics.set('widget-status.json', { ready: true, pid: 999, buildId: f.info.buildId });
  await assert.rejects(f.lifecycle.openWidget(), { code: 'WIDGET_START_TIMEOUT' });
  readyWidget(f); assert.equal((await f.lifecycle.openWidget()).mode, 'independent');
  assert.equal(f.launches.length, 3); assert.ok(f.launches.every(item => item.child.listenerCount('error') === 1));
});

test('widget readiness rejects another mode, origin, directory and legacy diagnostics', async () => {
  for (const patch of [{ demo: true }, { origin: 'https://127.0.0.1:4318' }, { dataDir: 'other' }, { dataDir: undefined }]) {
    const f = fixture({ widgetAttempts: 1 }); readyWidget(f);
    Object.assign(f.diagnostics.get('widget-status.json'), patch);
    await assert.rejects(f.lifecycle.openWidget(), { code: 'WIDGET_START_TIMEOUT' });
  }
  const demo = fixture({ demo: true, port: 4318, widgetAttempts: 1 });
  demo.diagnostics.set('widget-status.json', { ready: true, buildId: demo.info.buildId, pid: 123, follow: false });
  await assert.rejects(demo.lifecycle.openWidget(), { code: 'WIDGET_START_TIMEOUT' });
  readyWidget(demo);
  assert.equal((await demo.lifecycle.openWidget()).ready, true);
});

test('widget spawn errors release the opening promise without starting a watcher', async () => {
  let fail = true; const error = Error('Mock Electron spawn failed');
  const f = fixture({ wait: async () => { if (fail) { fail = false; f.launches.at(-1).child.emit('error', error); } } });
  f.diagnostics.set('autostart-preferences.json', { enabled: true });
  await assert.rejects(f.lifecycle.openWidget(), value => value === error);
  assert.deepEqual(f.launches.map(item => item.name), ['widget']); readyWidget(f);
  await f.lifecycle.openWidget(); assert.deepEqual(f.launches.map(item => item.name), ['widget', 'widget', 'watcher']);
});

test('watcher startup respects ownership and retains the source-only fallback', async () => {
  for (const watcher of ['owned', 'foreign', 'fallback']) {
    const f = fixture({ exists: path => watcher !== 'fallback' || !path.endsWith('continuer-monitor.exe') }); readyWidget(f);
    f.diagnostics.set('autostart-preferences.json', { enabled: true });
    f.diagnostics.set('autostart-status.json', { pid: 123, pluginRoot: watcher === 'owned' ? f.host.root : 'foreign' });
    await f.lifecycle.openWidget(); const launched = f.launches.filter(item => item.name === 'watcher');
    assert.equal(launched.length, watcher === 'owned' ? 0 : 1);
    if (watcher === 'foreign') assert.deepEqual(launched[0].args, ['--watch', 'fixture-widget-node', f.host.root, f.host.dataDir]);
    if (watcher === 'fallback') { assert.equal(launched[0].command, 'powershell.exe'); assert.ok(launched[0].args.includes(join(f.host.root, 'desktop/watch-codex.ps1'))); }
  }
});

test('missing desktop and Node report a typed failure without unrelated process launches', async () => {
  const desktop = fixture({ exists: () => false }); await assert.rejects(desktop.lifecycle.openWidget(), { code: 'DESKTOP_MISSING' }); assert.equal(desktop.launches.length, 0);
  const node = fixture({ serviceNode: '', request: async () => { throw unavailable(); } }); await assert.rejects(node.lifecycle.ensureService(), { code: 'NODE_MISSING' }); assert.equal(node.launches.length, 0);
});

test('stopping a service never starts one and can stop an older build only in the expected data directory', async () => {
  const absent = fixture({ request: async () => { throw unavailable(); } }); assert.deepEqual(await absent.lifecycle.stopService(), { running: false }); assert.equal(absent.launches.length, 0);
  const old = fixture(); old.state.buildId = 'old'; await old.lifecycle.stopService(); assert.deepEqual(old.reads.map(args => args[0]), ['/api/state', '/api/shutdown']); assert.equal(old.clears, 0);
  const foreign = fixture(); foreign.state.diagnostics.dataDir = 'foreign'; await assert.rejects(foreign.lifecycle.stopService(), { code: 'SERVICE_OWNER_MISMATCH' }); assert.equal(foreign.reads.length, 1);
});
