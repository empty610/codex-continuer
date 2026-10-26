import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, validateState } from '../server/store.js';
import { Manager } from '../server/manager.js';
import { StateStream } from '../server/events.js';
import { acquireLease } from '../server/lease.js';
import { Health, diagnostic } from '../server/health.js';
import logging from '../server/logging.cjs';
import { TaskDetails } from '../public/task-details.js';
import { storageNotice } from '../public/storage-status.js';
import { sealArtifact, verifyArtifact, publishArtifact } from '../scripts/package-artifact.js';

function temporary(t) {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-reliability-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); });
  return directory;
}
function state() { return { settings: { enabled: true, pollSeconds: 30, minimumRemaining: 5, maxRounds: 20, maxWakeSends: 20 }, tasks: [], logs: [], history: [] }; }
function manager(store, observeOnly = false) {
  const rpc = new EventEmitter(); rpc.ready = true; rpc.sent = [];
  rpc.send = msg => rpc.sent.push(msg); rpc.close = () => {};
  rpc.call = async (method, params) => {
    if (method === 'turn/interrupt') rpc.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } } });
    return { thread: { id: params?.threadId, name: 'Fixture', cwd: 'E:\\fixture' } };
  };
  return { m: new Manager(rpc, store, { demo: true, observeOnly }), rpc };
}

test('state writes keep a valid backup and damaged JSON cannot be overwritten', t => {
  const file = join(temporary(t), 'state.json'), store = new Store(file), first = state();
  store.save(first); const next = structuredClone(first); next.settings.enabled = false; store.save(next);
  assert.equal(JSON.parse(readFileSync(file + '.bak', 'utf8')).settings.enabled, true);
  writeFileSync(file, '{broken'); assert.throws(() => store.load());
  assert.throws(() => store.save(state()), /禁止覆盖/); assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('missing primary with backup and incompatible schemas require explicit recovery', t => {
  const directory = temporary(t), file = join(directory, 'state.json');
  writeFileSync(file + '.bak', JSON.stringify(state()));
  const store = new Store(file); assert.throws(() => store.load(), /明确恢复/);
  assert.throws(() => validateState({ ...state(), schemaVersion: 999 }), /版本/);
  assert.throws(() => validateState({ ...state(), tasks: [{ id: 'x', status: 'paused' }, { id: 'x', status: 'paused' }] }), /重复/);
  assert.throws(() => validateState({ ...state(), tasks: [{ id: 'a', status: 'paused', threadId: 'same' }, { id: 'b', status: 'paused', threadId: 'same' }] }), /重复会话/);
});

test('corrupt startup exposes diagnostics and backup restore disables every task', t => {
  const directory = temporary(t), file = join(directory, 'state.json'), store = new Store(file);
  const saved = state(); saved.tasks = [{ id: 'watch', mode: 'quota-wake', status: 'waiting', continuous: true, note: 'Private note', sentCount: 0, threadId: 'chat', wake: { armed: true, delivery: 'pending' }, plan: [] }];
  store.save(saved); store.save(saved); writeFileSync(file, '{broken');
  const { m } = manager(store);
  assert.equal(m.snapshot().persistence.status, 'error'); assert.equal(m.snapshot().settings.enabled, false);
  assert.throws(() => m.recoverStorage('retry'), /明确选择/);
  m.recoverStorage('backup');
  assert.equal(m.state.settings.enabled, false); assert.equal(m.state.tasks[0].continuous, false);
  assert.equal(m.state.tasks[0].status, 'blocked'); assert.equal(m.state.tasks[0].wake.delivery, 'uncertain');
  assert.equal(readFileSync(file + '.before-restore', 'utf8'), '{broken');
  assert.deepEqual(store.load(), m.state);
});

test('RPC save failures are caught, disable scheduling and can be explicitly retried', async t => {
  let fail = false;
  const { m, rpc } = manager({ load: () => null, save: () => { if (fail) throw Error('disk fixture'); } });
  const task = m.create({ name: 'Fixture', cwd: 'E:\\fixture', prompt: 'Goal' });
  Object.assign(task, { status: 'running', threadId: 'thread', turnId: 'turn' });
  const errors = []; m.on('persistence-error', error => errors.push(error));
  fail = true;
  assert.doesNotThrow(() => rpc.emit('notification', { method: 'turn/plan/updated', params: { threadId: 'thread', turnId: 'turn', plan: [] } }));
  assert.equal(errors.length, 1); assert.equal(m.state.settings.enabled, false); assert.equal(m.persistence.status, 'error');
  await m.action(task.id, 'pause').catch(() => {}); assert.equal(task.status, 'paused');
  fail = false; m.recoverStorage('retry'); assert.equal(m.persistence.status, 'ok'); assert.equal(m.state.settings.enabled, false);
  m.stop();
});

test('approval and outbox side effects cannot cross a failed durable save', () => {
  let fail = false;
  const { m, rpc } = manager({ load: () => null, save: () => { if (fail) throw Error('disk fixture'); } });
  const task = m.create({ name: 'Fixture', cwd: 'E:\\fixture', prompt: 'Goal' });
  Object.assign(task, { status: 'approval', threadId: 'thread', turnId: 'turn' });
  m.approvals.set('1', { id: 1, detailToken: 'fixture', taskId: task.id, threadId: task.threadId, turnId: task.turnId }); fail = true;
  assert.throws(() => m.approve(1, 'accept', 'fixture'), /disk fixture/); assert.deepEqual(rpc.sent, []);
  fail = false; m.recoverStorage('retry'); m.stop();
});

test('observation mode masks enabled scheduling without modifying the saved preference', async () => {
  const saved = state(), writes = [], { m } = manager({ load: () => saved, save: value => writes.push(structuredClone(value)) }, true);
  m.connection.status = 'connected'; m.setQuota({ rateLimits: { primary: { usedPercent: 0 } } });
  await m.tick(); assert.equal(m.snapshot().settings.enabled, false); assert.equal(m.state.settings.enabled, true);
  assert.equal(writes.length, 0); m.updateSettings({ enabled: true }); assert.equal(m.observationOnly, false); m.stop();
});

test('summaries omit private details and remain small with maximum retained output', () => {
  const { m } = manager({ load: () => null, save: () => {} });
  const task = m.create({ name: 'Fixture', cwd: 'E:\\fixture', prompt: 'Private goal' });
  Object.assign(task, { output: 'x'.repeat(16000), plan: [{ step: 'Private plan', status: 'completed' }], note: 'Private note' });
  const summary = m.snapshot({ details: false });
  assert.equal(summary.tasks[0].output, undefined); assert.equal(summary.tasks[0].prompt, undefined); assert.equal(summary.tasks[0].plan, undefined);
  assert.ok(JSON.stringify(summary).length < 2000); assert.equal(m.snapshot().tasks[0].output.length, 16000); m.stop();
});

test('task cap is enforced at creation and after concurrent imports finish reading', async () => {
  const { m, rpc } = manager({ load: () => null, save: () => {} });
  for (let i = 0; i < 99; i++) m.create({ name: `Fixture ${i}`, cwd: 'E:\\fixture', prompt: 'Goal' });
  const releases = [];
  rpc.call = (_method, params) => new Promise(resolve => releases.push(() => resolve({ thread: { id: params.threadId, name: 'Fixture' } })));
  const pending = Promise.allSettled([m.importThread('a'), m.importThread('b')]);
  releases.forEach(release => release()); const results = await pending;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(m.state.tasks.length, 100);
  assert.throws(() => m.create({ name: 'One too many', cwd: 'E:\\fixture', prompt: 'Goal' }), /100/); m.stop();
});

class Client extends EventEmitter {
  constructor(writable = true) { super(); this.writable = writable; this.frames = []; this.destroyed = false; }
  writeHead() {}
  write(frame) { this.frames.push(frame); return this.writable; }
  destroy() { this.destroyed = true; this.emit('close'); }
  end() { this.emit('close'); }
}
test('SSE keeps one frame during backpressure, drops a slow client and caps connection count', () => {
  const stream = new StateStream({ limit: 2 }), fast = new Client(), slow = new Client(false);
  assert.equal(stream.add({}, fast, {}), true); assert.equal(stream.add({}, slow, {}), true);
  assert.equal(stream.add({}, new Client(), {}), false);
  stream.broadcast({ value: 1 }); assert.equal(slow.frames.length, 1); assert.equal(slow.destroyed, true);
  assert.equal(stream.clients.size, 1); assert.equal(stream.dropped, 1); stream.close();
});
test('SSE accepts a healthy drain and never buffers an oversized frame', () => {
  const stream = new StateStream(), client = new Client(false);
  stream.add({}, client, {}); client.emit('drain'); client.writable = true;
  stream.broadcast({ value: 'current' }); assert.equal(client.destroyed, false); assert.equal(client.frames.length, 2);
  for (let i = 0; i < 20; i++) { client.writable = false; stream.broadcast({ value: i }); client.emit('drain'); }
  assert.equal(client.listenerCount('close'), 1);
  stream.broadcast({ value: 'x'.repeat(1024 * 1024) }); assert.equal(client.destroyed, true); stream.close();
});

test('detail cache ignores stale selections and only loads each selected revision once', async () => {
  const pending = [], updates = [], details = new TaskDetails(path => new Promise(resolve => pending.push({ path, resolve })), () => updates.push(true));
  details.read({ id: 'old', detailRevision: 1 }); details.read({ id: 'new', detailRevision: 1 });
  pending[0].resolve({ task: { output: 'old' } }); await Promise.resolve(); assert.equal(updates.length, 0);
  pending[1].resolve({ task: { output: 'new' } }); await Promise.resolve();
  assert.equal(details.read({ id: 'new', detailRevision: 1 }).output, 'new'); assert.equal(pending.length, 2);
  details.read({ id: 'new', detailRevision: 2 }); assert.equal(pending.length, 3);
  details.clear(); pending[2].resolve({ task: { output: 'obsolete' } }); await Promise.resolve(); assert.equal(details.slot, null);
});

test('rotation retains bounded backups and preserves the open file path', t => {
  const directory = temporary(t), file = join(directory, 'service.log');
  for (let i = 0; i < 5; i++) { writeFileSync(file, String(i).repeat(64)); logging.rotateFile(file, 32, 3); }
  assert.equal(statSync(file).size, 0); assert.equal(readFileSync(file + '.1', 'utf8'), '4'.repeat(64));
  assert.equal(readFileSync(file + '.3', 'utf8'), '2'.repeat(64)); assert.equal(existsSync(file + '.4'), false);
});

test('service leases prevent duplicate writers and release only their own lock', async t => {
  const directory = temporary(t), release = await acquireLease(directory, 'service');
  await assert.rejects(acquireLease(directory, 'service'), /已有服务/); await release();
  const again = await acquireLease(directory, 'service'); await again(); assert.equal(existsSync(join(directory, 'service.lock')), false);
});

test('health reports previous crashes, BOM diagnostics and actual process liveness', t => {
  const directory = temporary(t); writeFileSync(join(directory, 'service-status.json'), JSON.stringify({ status: 'running' }));
  writeFileSync(join(directory, 'autostart-preferences.json'), '\uFEFF{"enabled":false}');
  writeFileSync(join(directory, 'widget-status.json'), JSON.stringify({ pid: process.pid, ready: true }));
  const { m } = manager({ load: () => null, save: () => {} }); const health = new Health(directory, m, new StateStream());
  assert.equal(health.snapshot().previousExit.unexpected, true); assert.equal(health.snapshot().autostart.enabled, false);
  assert.equal(health.snapshot().widget.ready, true); health.record('stopped', 'manual');
  assert.equal(diagnostic(join(directory, 'service-status.json')).reason, 'manual'); m.stop();
});

function artifact(directory) {
  for (const name of ['server', 'public', 'plugin', 'desktop']) { mkdirSync(join(directory, name), { recursive: true }); writeFileSync(join(directory, name, 'fixture.js'), name); }
  writeFileSync(join(directory, 'runtime.json'), '{"profile":"portable"}');
}
test('artifact checksums detect changed, missing and unlisted files', t => {
  const directory = temporary(t); artifact(directory); sealArtifact(directory); verifyArtifact(directory);
  writeFileSync(join(directory, 'stale.txt'), 'extra'); assert.throws(() => verifyArtifact(directory), /checksum/);
  rmSync(join(directory, 'stale.txt')); writeFileSync(join(directory, 'public', 'fixture.js'), 'changed');
  assert.throws(() => verifyArtifact(directory), /fingerprint/);
});
test('staged publication removes stale files and rejects unsafe paths', t => {
  const directory = temporary(t), stage = join(directory, '.codex-continuer-stage-test'), destination = join(directory, 'codex-continuer');
  artifact(stage); sealArtifact(stage); mkdirSync(destination); writeFileSync(join(destination, 'stale.txt'), 'old');
  assert.throws(() => publishArtifact(stage, join(directory, 'other')), /Unsafe/);
  publishArtifact(stage, destination); assert.equal(existsSync(join(destination, 'stale.txt')), false); verifyArtifact(destination);
  assert.equal(existsSync(destination + '.previous'), false);
});

test('storage notices show explicit recovery choices and never display an unescaped error', () => {
  const html = storageNotice({ persistence: { status: 'error', message: '<error>', backupAvailable: true } }, text => text.replaceAll('<', '&lt;'));
  assert.match(html, /重试保存/); assert.match(html, /恢复上次备份/); assert.match(html, /&lt;error>/);
});

test('portable configuration uses stable user data even when a legacy data folder exists', t => {
  const directory = temporary(t); mkdirSync(join(directory, 'server')); mkdirSync(join(directory, 'data'));
  writeFileSync(join(directory, 'server', 'config.cjs'), readFileSync(new URL('../server/config.cjs', import.meta.url)));
  writeFileSync(join(directory, 'package.json'), '{"version":"0.3.3"}'); writeFileSync(join(directory, 'runtime.json'), '{"profile":"portable"}');
  const env = { ...process.env, NODE_OPTIONS: '', CONTINUER_DATA_DIR: '', LOCALAPPDATA: join(directory, 'user-data'), CONTINUER_PORT: '4317' };
  const run = () => execFileSync(process.execPath, ['-e', 'process.stdout.write(require(process.argv[1]).dataDir)', join(directory, 'server', 'config.cjs')], { env, windowsHide: true, encoding: 'utf8' });
  assert.equal(run(), join(directory, 'user-data', 'CodexContinuer'));
  env.CONTINUER_DATA_DIR = join(directory, 'explicit-data'); assert.equal(run(), env.CONTINUER_DATA_DIR);
});

test('runtime refuses an incompatible running build before attempting to launch anything', t => {
  const env = { ...process.env, CONTINUER_DATA_DIR: temporary(t) };
  const script = `globalThis.fetch=async()=>({ok:true,json:async()=>({app:'codex-continuer',version:'0.3.3',protocolVersion:1,buildId:'obsolete'})}); const runtime=await import(${JSON.stringify(new URL('../plugin/runtime.js', import.meta.url).href)}); try{await runtime.ensureService();process.exitCode=1;}catch(error){console.log(error.message);}`;
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], { env, windowsHide: true, encoding: 'utf8' });
  assert.match(output, /构建不一致/);
  const configUrl = JSON.stringify(new URL('../server/config.cjs', import.meta.url).href);
  const wrongDirectory = `const config=(await import(${configUrl})).default; globalThis.fetch=async()=>({ok:true,json:async()=>({...config.appInfo(),diagnostics:{dataDir:'wrong-directory'}})}); const runtime=await import(${JSON.stringify(new URL('../plugin/runtime.js', import.meta.url).href)}); try{await runtime.ensureService();process.exitCode=1;}catch(error){console.log(error.message);}`;
  assert.match(execFileSync(process.execPath, ['--input-type=module', '--eval', wrongDirectory], { env, windowsHide: true, encoding: 'utf8' }), /不同的数据目录/);
});
