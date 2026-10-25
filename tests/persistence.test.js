import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Manager } from '../server/manager.js';
import { Store } from '../server/store.js';

const directId = '11111111-1111-4111-8111-111111111111';
const watchedId = '22222222-2222-4222-8222-222222222222';
const quota = usedPercent => ({ rateLimits: { primary: { usedPercent }, secondary: { usedPercent: 10 } } });
function setup({ store = { load: () => null, save: () => {} }, send = async () => ({}) } = {}) {
  const rpc = new EventEmitter(), saves = [];
  let closed = 0;
  rpc.ready = true; rpc.close = () => { closed++; }; rpc.send = () => {};
  rpc.call = async (_method, params) => ({ thread: { id: params?.threadId, name: 'Watched', cwd: 'E:\\project' } });
  const m = new Manager(rpc, { load: () => store.load(), save: state => { store.save(state); saves.push(structuredClone(state)); } }, { demo: true, wakeSender: { send } });
  m.connection.status = 'connected';
  const task = m.create({ name: 'Streaming', cwd: 'E:\\project', prompt: 'Isolated streaming fixture', continuous: true });
  Object.assign(task, { threadId: directId, turnId: 'turn-current', status: 'running' });
  saves.length = 0;
  const delta = text => m.event({ method: 'item/agentMessage/delta', params: { threadId: directId, turnId: 'turn-current', delta: text } });
  return { m, rpc, saves, task, delta, get closed() { return closed; } };
}

test('1000 output fragments stay live and share one bounded save without eager snapshots', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { m, saves, task, delta } = setup();
  let snapshots = 0, changes = 0;
  const snapshot = m.snapshot.bind(m);
  m.snapshot = () => { snapshots++; return snapshot(); };
  m.on('change', () => { changes++; });
  for (let i = 0; i < 1000; i++) delta('x'.repeat(64));
  assert.equal(saves.length, 0); assert.equal(task.output.length, 16000);
  assert.equal(changes, 1000); assert.equal(snapshots, 0);
  assert.equal(m.snapshot().tasks[0].output, task.output);
  t.mock.timers.tick(249); assert.equal(saves.length, 0);
  t.mock.timers.tick(1); assert.equal(saves.length, 1);
  assert.equal(saves[0].tasks[0].output, task.output);
  t.mock.timers.tick(1000); assert.equal(saves.length, 1);
});

test('continuous fragments flush every 250 ms rather than postponing the save indefinitely', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { saves, delta } = setup();
  for (let i = 0; i < 1000; i++) { delta('x'); t.mock.timers.tick(1); }
  assert.deepEqual(saves.map(state => state.tasks[0].output.length), [250, 500, 750, 1000]);
});

test('interleaved output from different tasks shares a save without losing either stream', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { m, saves, task, delta } = setup();
  const other = m.create({ name: 'Other stream', cwd: 'E:\\project', prompt: 'Other fixture', continuous: false });
  Object.assign(other, { threadId: watchedId, turnId: 'other-turn', status: 'running' }); saves.length = 0;
  for (let i = 0; i < 1000; i++) {
    delta('a');
    m.event({ method: 'item/agentMessage/delta', params: { threadId: watchedId, turnId: 'other-turn', delta: 'b' } });
  }
  assert.equal(saves.length, 0); t.mock.timers.tick(250); assert.equal(saves.length, 1);
  assert.equal(saves[0].tasks.find(t => t.id === task.id).output, 'a'.repeat(1000));
  assert.equal(saves[0].tasks.find(t => t.id === other.id).output, 'b'.repeat(1000));
});

test('pause, approvals, settings and final messages immediately save the latest buffered text', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const action of ['pause', 'approval', 'settings', 'message']) {
    const { m, saves, delta } = setup();
    delta('latest text');
    assert.equal(saves.length, 0);
    if (action === 'pause') await m.action(m.state.tasks[0].id, 'pause');
    else if (action === 'approval') m.request({ id: 10, method: 'item/commandExecution/requestApproval', params: { threadId: directId, turnId: 'turn-current', command: 'fixture' } });
    else if (action === 'settings') m.updateSettings({ enabled: false });
    else m.event({ method: 'item/completed', params: { threadId: directId, turnId: 'turn-current', item: { type: 'agentMessage', text: 'latest text' } } });
    assert.ok(saves.length > 0); assert.equal(saves.at(-1).tasks[0].output, 'latest text');
    const count = saves.length; t.mock.timers.tick(1000); assert.equal(saves.length, count);
  }
});

test('completion cancels the pending save and never restores a cleared task', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { m, saves, delta } = setup();
  delta(JSON.stringify({ status: 'done', summary: 'Fixture verified' }));
  m.event({ method: 'turn/completed', params: { threadId: directId, turn: { id: 'turn-current', status: 'completed' } } });
  assert.deepEqual(m.state.tasks, []); assert.deepEqual(saves.at(-1).tasks, []);
  const count = saves.length; t.mock.timers.tick(1000); assert.equal(saves.length, count);
});

test('stop flushes a real state file before closing RPC and the output survives restart', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const temporaryRoot = realpathSync(tmpdir());
  const dataDir = mkdtempSync(join(temporaryRoot, 'continuer-output-save-'));
  try {
    const store = new Store(join(dataDir, 'state.json'));
    const f = setup({ store }); f.delta('saved at stop');
    assert.equal(store.load().tasks[0].output, '');
    f.m.stop(); assert.equal(f.closed, 1);
    assert.equal(store.load().tasks[0].output, 'saved at stop');
    const restored = new Manager(new EventEmitter(), store, { demo: true });
    assert.equal(restored.state.tasks[0].output, 'saved at stop');
    const count = f.saves.length; t.mock.timers.tick(1000); assert.equal(f.saves.length, count);
  } finally {
    assert.equal(dirname(realpathSync(dataDir)), temporaryRoot);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('shutdown flushes fragments arriving while the interrupt is pending', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup(); let release;
  f.rpc.call = () => new Promise(resolve => { release = resolve; });
  f.delta('before '); const pending = f.m.shutdown();
  assert.equal(typeof release, 'function');
  f.delta('during interrupt'); release({}); await pending;
  assert.equal(f.saves.at(-1).tasks[0].output, 'before during interrupt');
  assert.equal(f.closed, 1);
  const count = f.saves.length; t.mock.timers.tick(1000); assert.equal(f.saves.length, count);
});

test('the recovery outbox is still persisted before sending, including buffered output', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let sent = 0;
  const f = setup({ send: async () => {
    sent++;
    const state = f.saves.at(-1);
    assert.equal(state.tasks.find(task => task.threadId === watchedId).wake.delivery, 'sending');
    assert.equal(state.tasks.find(task => task.threadId === directId).output, 'latest buffered output');
    return { queueId: 'fixture' };
  } });
  const watched = await f.m.importThread(watchedId, 'Watch fixture');
  await f.m.action(watched.id, 'continuous', true);
  f.m.setQuota(quota(100)); await f.m.tick();
  f.delta('latest buffered output');
  f.m.setQuota(quota(0)); await f.m.tick();
  assert.equal(sent, 1); assert.equal(watched.wake.delivery, 'sent');
});

test('a background save failure is reported and buffered output can be retried', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fail = false;
  const f = setup({ store: { load: () => null, save: () => { if (fail) throw Error('fixture disk unavailable'); } } });
  const errors = []; f.m.on('persistence-error', error => errors.push(error));
  fail = true; f.delta('first ');
  assert.doesNotThrow(() => t.mock.timers.tick(250));
  assert.equal(errors.length, 1); assert.equal(f.saves.length, 0);
  fail = false; f.delta('second'); t.mock.timers.tick(250);
  assert.equal(f.saves.at(-1).tasks[0].output, 'first second');
});

test('a failed immediate outbox save prevents the queue side effect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fail = false, sent = 0;
  const f = setup({ store: { load: () => null, save: () => { if (fail) throw Error('fixture disk unavailable'); } }, send: async () => { sent++; } });
  const watched = await f.m.importThread(watchedId, 'Watch fixture');
  await f.m.action(watched.id, 'continuous', true);
  f.m.setQuota(quota(100)); await f.m.tick();
  f.delta('buffered'); fail = true; f.m.setQuota(quota(0));
  await assert.rejects(f.m.tick(), /disk unavailable/); assert.equal(sent, 0);
  fail = false; f.m.stop();
});
