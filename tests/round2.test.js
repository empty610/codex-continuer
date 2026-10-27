import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Manager } from '../server/manager.js';
import { Store, validateState } from '../server/store.js';
import { acquireLease } from '../server/lease.js';
import { StateStream } from '../server/events.js';
import { SUMMARY_BUDGET } from '../server/summary.js';
import { TaskDetails } from '../public/task-details.js';
import { ApprovalDetails } from '../public/approval-details.js';

const threadId = '11111111-1111-4111-8111-111111111111';
const input = { name: 'Round two fixture', cwd: 'E:\\fixture', prompt: 'Isolated fixture only', continuous: true };
const quota = usedPercent => ({ rateLimits: { primary: { usedPercent }, secondary: { usedPercent: 10 } } });
function temporary(t) {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-round2-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); });
  return directory;
}
function fixture(t, store = { load: () => null, save() {} }, send = async () => ({ queueId: 'fixture' })) {
  const rpc = new EventEmitter(); rpc.ready = true; rpc.calls = []; rpc.send = () => {}; rpc.close = () => { rpc.ready = false; };
  rpc.call = async (method, params) => {
    rpc.calls.push({ method, params });
    if (method === 'thread/read') return { thread: { id: params.threadId, name: 'Fixture', cwd: input.cwd, status: { type: 'idle' } } };
    if (method === 'thread/start') return { thread: { id: 'direct-thread' } };
    if (method === 'turn/start') return { turn: { id: 'fixture-turn' } };
    return {};
  };
  const manager = new Manager(rpc, store, { demo: true, wakeSender: { send } });
  manager.connection.status = 'connected'; manager.setQuota(quota(10));
  t.after(() => manager.safely(() => manager.stop()));
  return { manager, rpc };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function pendingSend(t, store) {
  const sent = deferred(), entered = deferred();
  const f = fixture(t, store, () => { entered.resolve(); return sent.promise; });
  const task = await f.manager.importThread(threadId); await f.manager.action(task.id, 'continuous', true);
  f.manager.setQuota(quota(100)); await f.manager.tick(); f.manager.setQuota(quota(10));
  return { ...f, task, sent, entered, begin: async () => { const tick = f.manager.tick(); await entered.promise; return { tick }; } };
}

for (const change of ['disable', 'disable-enable', 'disconnect-reconnect', 'storage-failure', 'shutdown']) test(`old scheduler cannot start another task after ${change}`, async t => {
  const f = await pendingSend(t), direct = f.manager.create(input), { tick } = await f.begin();
  if (change.startsWith('disable')) { f.manager.updateSettings({ enabled: false }); if (change === 'disable-enable') f.manager.updateSettings({ enabled: true }); }
  if (change === 'disconnect-reconnect') { f.rpc.emit('disconnect', 'fixture'); f.manager.connection.status = 'connected'; f.manager.setQuota(quota(10)); }
  if (change === 'storage-failure') f.manager.storageFailure(new Error('fixture disk'));
  if (change === 'shutdown') await f.manager.shutdown();
  f.sent.resolve({ queueId: 'confirmed' }); await tick;
  assert.equal(f.rpc.calls.filter(call => call.method === 'turn/start').length, 0); assert.equal(direct.status, 'queued');
  if (['disable-enable', 'disconnect-reconnect'].includes(change)) { await f.manager.tick(); assert.equal(direct.status, 'running'); }
});

for (const stage of ['thread/start', 'thread/read', 'thread/resume']) test(`global off/on invalidates preparation awaiting ${stage}`, async t => {
  const { manager, rpc } = fixture(t), task = manager.create(input), held = deferred(), entered = deferred(), original = rpc.call;
  if (stage !== 'thread/start') task.threadId = 'existing';
  rpc.call = async (method, params) => { if (method === stage) { entered.resolve(); return held.promise; } return original(method, params); };
  const run = manager.tick(); await entered.promise;
  manager.updateSettings({ enabled: false }); manager.updateSettings({ enabled: true });
  held.resolve({ thread: { id: 'created', status: { type: 'idle' } } }); await run;
  assert.equal(task.status, 'queued'); assert.equal(task.rounds, 0); assert.equal(manager.executions.size, 0);
  assert.equal(rpc.calls.some(call => call.method === 'turn/start'), false);
});

test('preparation cannot start a turn after its quota expires', async t => {
  const { manager, rpc } = fixture(t), task = manager.create(input), held = deferred();
  rpc.call = () => held.promise;
  const run = manager.run(task); manager.sampledAt -= 90001;
  held.resolve({ thread: { id: 'fixture' } }); await run;
  assert.equal(task.status, 'queued'); assert.equal(task.rounds, 0); assert.equal(manager.executions.size, 0);
});

test('OS lease permits only one concurrent stale-lock contender and recovers after a crash', { timeout: 15000 }, async t => {
  const directory = temporary(t); writeFileSync(join(directory, 'service.lock'), JSON.stringify({ pid: 2147483647 }));
  const workers = Array.from({ length: 6 }, () => fork(fileURLToPath(new URL('./fixtures/lease-worker.js', import.meta.url)), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  t.after(async () => { await Promise.all(workers.map(async child => { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; })); });
  await Promise.all(workers.map(child => once(child, 'message')));
  const answers = workers.map(child => once(child, 'message').then(([answer]) => ({ child, ...answer })));
  workers.forEach(child => child.send({ directory }));
  const results = await Promise.all(answers), winners = results.filter(answer => answer.type === 'acquired');
  assert.equal(winners.length, 1); assert.equal(results.filter(answer => answer.type === 'rejected').length, 5);
  const winner = winners[0].child;
  assert.equal(JSON.parse(readFileSync(join(directory, 'service.lock'), 'utf8')).pid, winner.pid);
  await assert.rejects(acquireLease(directory, 'service'), /已有服务/);
  const exited = once(winner, 'exit'); winner.kill(); await exited;
  const release = await acquireLease(directory, 'service'); await release();
});

test('leases respect legacy live owners and Windows path aliases', async t => {
  const directory = temporary(t), file = join(directory, 'service.lock');
  writeFileSync(file, JSON.stringify({ pid: process.pid }));
  await assert.rejects(acquireLease(directory, 'service'), /已有服务/);
  writeFileSync(file, JSON.stringify({ pid: 2147483647 }));
  const release = await acquireLease(directory, 'service');
  await assert.rejects(acquireLease(process.platform === 'win32' ? directory.toUpperCase() : directory, 'service'), /已有服务/);
  await release();
});

for (const result of ['success', 'cancelled', 'uncertain']) test(`recovery rejects an in-flight ${result} send and releases its registration`, async t => {
  const file = join(temporary(t), 'state.json'), store = new Store(file), f = await pendingSend(t, store), { tick } = await f.begin();
  const state = f.manager.state;
  for (const source of ['backup', 'retry']) assert.throws(() => f.manager.recoverStorage(source), /仍在发送/);
  assert.equal(f.manager.state, state);
  if (result === 'success') f.sent.resolve({ queueId: 'confirmed' });
  else f.sent.reject(Object.assign(new Error('fixture result'), result === 'cancelled' ? { cancelled: true } : {}));
  await tick;
  assert.equal(f.manager.wakeExecutions.size, 0);
  if (result === 'success') { assert.equal(store.load().tasks[0].sentCount, 1); assert.equal(store.load().tasks[0].wake.queueId, 'confirmed'); }
  f.manager.updateSettings({ enabled: false });
  assert.doesNotThrow(() => f.manager.recoverStorage('backup')); assert.equal(f.manager.state.settings.enabled, false);
});

test('a failed initial save cleans execution registration and permits explicit recovery', async t => {
  const store = new Store(join(temporary(t), 'state.json')), { manager, rpc } = fixture(t, store), task = manager.create(input), original = store.save.bind(store);
  store.save = () => { throw new Error('fixture disk'); };
  await assert.rejects(manager.run(task), /fixture disk/);
  assert.equal(manager.executions.size, 0); assert.equal(rpc.calls.length, 0); assert.equal(manager.state.settings.enabled, false);
  store.save = original; await manager.action(task.id, 'pause');
  assert.doesNotThrow(() => manager.recoverStorage('backup'));
});

test('a failed durable outbox claim releases registration without sending', async t => {
  let fail = false, sends = 0;
  const { manager } = fixture(t, { load: () => null, save() { if (fail) throw new Error('fixture disk'); } }, async () => { sends++; });
  const task = await manager.importThread(threadId); await manager.action(task.id, 'continuous', true);
  manager.setQuota(quota(100)); await manager.tick(); manager.setQuota(quota(10)); fail = true;
  await assert.rejects(manager.tick(), /fixture disk/); assert.equal(sends, 0); assert.equal(manager.wakeExecutions.size, 0);
  fail = false; manager.recoverStorage('retry'); assert.equal(task.wake.delivery, 'uncertain');
});

for (const duringSend of [false, true]) test(`lowering the wake limit preserves valid outbox state (in flight: ${duringSend})`, async t => {
  const file = join(temporary(t), 'state.json'), store = new Store(file), f = await pendingSend(t, store);
  f.task.sentCount = 1;
  if (!duringSend) {
    f.manager.updateSettings({ maxWakeSends: 1 });
    assert.equal(store.load().tasks[0].wake.delivery, 'idle');
  } else {
    const { tick } = await f.begin(); f.manager.updateSettings({ maxWakeSends: 1 });
    assert.equal(store.load().tasks[0].wake.delivery, 'sending');
    f.sent.resolve({ queueId: 'confirmed' }); await tick;
    assert.equal(store.load().tasks[0].sentCount, 2);
  }
  assert.equal(f.task.continuous, false); assert.equal(f.manager.persistence.status, 'ok'); validateState(store.load());
});

test('mode state validation rejects invalid switches, counters and outbox combinations', async t => {
  const { manager } = fixture(t); await manager.importThread(threadId);
  const valid = structuredClone(manager.state);
  for (const patch of [{ continuous: 'false' }, { continuous: 0 }, { rounds: -1 }, { rounds: 0.5 }, { sentCount: '0' }, { sentCount: -1 }, { mode: 'unknown' }, { wake: false }, { wake: {} }, { wake: { armed: 'false', delivery: 'pending' } }, { wake: { armed: false, delivery: 'pending' } }, { wake: { armed: true, delivery: 'sent' } }, { wake: { armed: false, delivery: 'unknown' } }]) {
    const state = structuredClone(valid); Object.assign(state.tasks[0], patch); assert.throws(() => validateState(state));
  }
  for (const value of ['20', 0, 101]) { const state = structuredClone(valid); state.settings.maxWakeSends = value; assert.throws(() => validateState(state)); }
  const file = join(temporary(t), 'state.json'); valid.tasks[0].wake.armed = 'false'; writeFileSync(file, JSON.stringify(valid));
  const restored = fixture(t, new Store(file)); await restored.manager.tick();
  assert.equal(restored.manager.persistence.status, 'error'); assert.equal(restored.manager.state.settings.enabled, false); assert.equal(restored.rpc.calls.length, 0);
});

test('legacy missing fields migrate safely, but pending outboxes without exhaustion evidence stay blocked', async t => {
  const { manager } = fixture(t); const task = await manager.importThread(threadId);
  const state = structuredClone(manager.state); delete state.settings.maxWakeSends; delete state.tasks[0].sentCount;
  Object.assign(state.tasks[0], { status: 'waiting', continuous: true, wake: { armed: true, delivery: 'pending' } });
  validateState(state); let sends = 0;
  const restored = fixture(t, { load: () => state, save() {} }, async () => { sends++; });
  await restored.manager.tick();
  assert.equal(restored.manager.state.tasks[0].status, 'blocked'); assert.equal(restored.manager.state.tasks[0].continuous, false); assert.equal(sends, 0);
  assert.equal(restored.manager.state.settings.maxWakeSends, 20); assert.equal(restored.manager.state.tasks[0].id, task.id);
});

test('maximum tasks, Chinese activity/logs and approvals fit the combined frame budget', t => {
  const { manager } = fixture(t);
  for (let i = 0; i < 100; i++) { const task = manager.create({ ...input, name: `Fixture ${i}` }); task.status = 'blocked'; task.activity = '错'.repeat(2400); }
  for (let i = 0; i < 50; i++) { manager.log('错'.repeat(2600)); manager.approvals.set(String(i), { id: i, detailToken: `token-${i}`, taskId: manager.state.tasks[0].id, method: 'approval', reason: '理'.repeat(2000), command: '令'.repeat(12000), cwd: '路'.repeat(1000) }); }
  validateState(manager.state);
  const snapshot = manager.snapshot({ details: false });
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < SUMMARY_BUDGET); assert.equal(snapshot.tasks.length, 100); assert.equal(snapshot.approvals.length, 50);
  assert.equal(snapshot.approvals.every(item => item.requiresDetails), true); assert.equal(manager.taskSnapshot(snapshot.tasks[0].id).activity.length, 2400);
  class Client extends EventEmitter { destroyed = false; writeHead() {} write() { return true; } destroy() { this.destroyed = true; this.emit('close'); } end() { this.emit('close'); } }
  const client = new Client(), stream = new StateStream(); stream.add({}, client, snapshot); stream.broadcast(snapshot);
  assert.equal(client.destroyed, false); assert.equal(stream.dropped, 0); stream.close();
});

test('details remain cached across unrelated changes and refresh after selected output changes', async t => {
  const { manager } = fixture(t), task = manager.create(input), other = manager.create(input);
  let reads = 0;
  const details = new TaskDetails(async () => { reads++; return { task: manager.taskSnapshot(task.id) }; }, () => {});
  const summary = () => manager.snapshot({ details: false }).tasks.find(item => item.id === task.id);
  details.read(summary()); await delay(0);
  for (let i = 0; i < 20; i++) { other.output += 'x'; manager.setQuota(quota(10)); manager.changed(); details.read(summary()); await delay(0); }
  assert.equal(reads, 1);
  task.output += 'updated'; manager.changed(); details.read(summary()); await delay(0); assert.equal(reads, 2);
  manager.snapshot = () => { throw new Error('Full snapshot must not be needed'); };
  assert.equal(manager.taskSnapshot(task.id).output, 'updated');
});

test('detail previews preserve full paths/activity and failed requests can retry', async t => {
  t.mock.timers.enable({ apis: ['Date'] }); let fail = true, reads = 0;
  const full = { id: 'task', cwd: 'p'.repeat(1500), activity: 'a'.repeat(2400) }, summary = { id: 'task', detailRevision: 1, cwd: 'p…', activity: 'a…' };
  const details = new TaskDetails(async () => { reads++; if (fail) throw new Error('fixture'); return { task: full }; }, () => {});
  details.read(summary); await Promise.resolve(); await Promise.resolve();
  details.read(summary); assert.equal(reads, 1); fail = false; t.mock.timers.tick(2001);
  details.read(summary); await Promise.resolve(); assert.equal(reads, 2); assert.equal(details.read(summary).cwd, full.cwd); assert.equal(details.read(summary).activity, full.activity);
});

test('truncated approvals cannot be accepted before full content arrives and stale details are ignored', async () => {
  const pending = [], requests = [], details = new ApprovalDetails((...args) => { requests.push(args); const held = deferred(); pending.push(held); return held.promise; }, () => {});
  const summary = { id: 1, detailToken: 'old', command: 'preview…', requiresDetails: true };
  details.readAll([summary]); assert.equal(details.ready(summary), false);
  assert.deepEqual(requests[0], ['/api/approvals/1', { token: 'old' }]);
  const current = { ...summary, detailToken: 'new' }; details.readAll([current]);
  pending[0].resolve({ approval: { ...summary, command: 'obsolete' } }); await Promise.resolve(); assert.equal(details.ready(current), false);
  pending[1].resolve({ approval: { ...current, command: 'full command' } }); await Promise.resolve();
  assert.equal(details.ready(current), true); assert.equal(details.readAll([current])[0].command, 'full command');
  details.readAll([]); assert.equal(details.slots.size, 0);
});
