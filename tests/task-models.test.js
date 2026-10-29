import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDirectTask, isRunnableDirectTask } from '../server/direct-task.js';
import { createMonitorTask, isEnabledMonitorTask } from '../server/monitor-task.js';
import { initialState, prepareState } from '../server/state-lifecycle.js';
import { Store, validateState } from '../server/store.js';
import { Manager } from '../server/manager.js';
import { interruptedThread } from './fixtures/thread-history.js';

const threadId = '11111111-1111-4111-8111-111111111111';
const input = { name: 'Direct work', cwd: 'E:\\fixture', prompt: 'Original goal', continuous: true };
const direct = () => createDirectTask(input, { demo: true });
const monitor = () => createMonitorTask(threadId, { name: 'Original chat', cwd: input.cwd }, 'Local note', 'Custom message');
const savedState = (...tasks) => ({ ...initialState(false), tasks });
function temporaryStore(t) {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-task-models-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); });
  return new Store(join(directory, 'state.json'));
}
function manager(t, store = { load: () => null, save() {} }) {
  const rpc = new EventEmitter(), calls = [], sent = [];
  rpc.ready = true; rpc.close = () => {}; rpc.send = message => sent.push(message);
  rpc.call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/read') return { thread: interruptedThread(params.threadId) };
    throw Error('Unexpected test RPC');
  };
  const m = new Manager(rpc, store, { demo: true, wakeSender: { send: async () => { throw Error('Unexpected queue send'); } } });
  t.after(() => m.stop());
  m.connection.status = 'connected';
  return { m, calls, sent };
}

test('new records contain only the fields and counter belonging to their mode', () => {
  const work = direct(), watch = monitor();
  assert.equal(work.mode, 'direct'); assert.equal(work.rounds, 0);
  assert.equal(work.prompt, input.prompt); assert.equal(work.status, 'queued');
  for (const key of ['wake', 'sentCount', 'continuationMessage']) assert.equal(key in work, false);
  assert.equal(watch.mode, 'quota-wake'); assert.equal(watch.sentCount, 0);
  assert.equal(watch.note, 'Local note'); assert.equal(watch.continuationMessage, 'Custom message');
  assert.equal(watch.status, 'paused'); assert.equal(watch.continuous, false);
  for (const key of ['prompt', 'rounds', 'plan', 'output', 'turnId']) assert.equal(key in watch, false);
  assert.doesNotThrow(() => validateState(savedState(work, watch)));
});

test('storage rejects cross-mode statuses and monitoring state on direct work', () => {
  for (const status of ['queued', 'starting', 'running', 'approval', 'pausing', 'failed']) {
    assert.throws(() => validateState(savedState({ ...monitor(), status })), /监测状态/);
  }
  assert.throws(() => validateState(savedState({ ...direct(), status: 'monitoring' })), /工作任务状态/);
  for (const patch of [{ wake: { armed: false, delivery: 'idle' } }, { sentCount: 1 }, { continuationMessage: 'Wrong mode' }]) {
    assert.throws(() => validateState(savedState({ ...direct(), ...patch })), /监测发送状态/);
  }
  for (const task of [{ ...direct(), rounds: -1 }, { ...monitor(), sentCount: -1 }]) {
    assert.throws(() => validateState(savedState(task)), /轮次|次数/);
  }
});

test('resume resets direct rounds while preserving monitor deliveries and execution isolation', async t => {
  const { m, calls } = manager(t), work = m.create(input), watch = await m.importThread(threadId, 'Note', 'Message');
  work.status = 'blocked'; work.rounds = 7; watch.sentCount = 7;
  m.updateSettings({ maxRounds: 1, maxWakeSends: 8 });
  await m.action(work.id, 'resume'); await m.action(watch.id, 'resume');
  assert.equal(work.rounds, 0); assert.equal(work.status, 'queued');
  assert.equal(watch.sentCount, 7); assert.equal(watch.status, 'monitoring');
  assert.equal(isRunnableDirectTask(work), true); assert.equal(isRunnableDirectTask(watch), false);
  assert.equal(isEnabledMonitorTask(work), false); assert.equal(isEnabledMonitorTask(watch), true);
  const count = calls.length, before = structuredClone(watch);
  await assert.rejects(m.run(watch), /不能启动执行轮次/);
  assert.equal(calls.length, count); assert.deepEqual(watch, before);
  assert.equal(m.executions.size, 0);
});

test('turn notifications and approvals cannot introduce execution fields into a monitor', async t => {
  const { m, sent } = manager(t), watch = await m.importThread(threadId);
  await m.action(watch.id, 'resume');
  const before = structuredClone(watch);
  m.event({ method: 'turn/plan/updated', params: { threadId, turnId: 'external-turn', plan: [{ step: 'External', status: 'completed' }] } });
  m.event({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'external-turn', delta: 'Private reply' } });
  m.event({ method: 'turn/completed', params: { threadId, turn: { id: 'external-turn', status: 'completed' } } });
  m.request({ id: 8, method: 'item/commandExecution/requestApproval', params: { threadId, turnId: 'external-turn', command: 'echo external' } });
  assert.deepEqual(watch, before); assert.equal(m.approvals.size, 0);
  assert.equal(sent.length, 1); assert.equal(sent[0].error.code, -32601);
});

test('mixed legacy records migrate once without confusing direct rounds and confirmed sends', t => {
  const store = temporaryStore(t), oldDirect = { ...direct(), status: 'paused', rounds: 3 };
  delete oldDirect.mode;
  const explicit = { ...direct(), status: 'blocked', threadId: 'explicit-chat', activity: 'thread explicit-chat already has an active writer', rounds: 4 };
  const legacyWriter = { ...direct(), status: 'blocked', threadId: 'old-chat', activity: 'thread old-chat already has an active writer', rounds: 8 };
  delete legacyWriter.mode;
  const oldMonitor = { ...monitor(), prompt: 'Migrated note', rounds: 6, plan: [{ step: 'Obsolete', status: 'completed' }], output: 'Obsolete output', turnId: 'obsolete-turn' };
  delete oldMonitor.note; delete oldMonitor.sentCount;
  store.save(savedState(oldDirect, explicit, legacyWriter, oldMonitor));
  const { m, calls } = manager(t, store), [work, current, converted, watched] = m.state.tasks;
  assert.equal(work.mode, 'direct'); assert.equal(work.rounds, 3);
  assert.equal(current.mode, 'direct'); assert.equal(current.rounds, 4); assert.equal(current.waitReason, 'writer');
  assert.equal(converted.mode, 'quota-wake'); assert.equal(converted.sentCount, 0);
  assert.equal(converted.note, input.prompt); assert.equal(converted.wake.armed, false);
  assert.equal(watched.note, 'Migrated note'); assert.equal(watched.sentCount, 6);
  assert.equal(watched.continuationMessage, 'Custom message');
  for (const record of [converted, watched]) for (const key of ['prompt', 'rounds', 'plan', 'output', 'turnId']) assert.equal(key in record, false);
  assert.equal(m.state.settings.enabled, false); assert.deepEqual(calls, []);
  assert.deepEqual(store.load(), m.state);
  const again = structuredClone(m.state);
  assert.equal(prepareState(again), false); assert.deepEqual(again, m.state);
});

test('restarting an in-flight monitor preserves its count and evidence without restarting direct work', t => {
  const store = temporaryStore(t), watch = monitor(), work = direct();
  Object.assign(watch, { sentCount: 4, continuous: true, status: 'waiting', wake: { armed: true, delivery: 'sending', episodeId: 'episode', exhaustedAt: 1000 } });
  Object.assign(work, { status: 'running', rounds: 9, threadId: 'direct-chat', turnId: 'turn' });
  store.save(savedState(work, watch));
  const { m, calls } = manager(t, store), [restoredWork, restoredMonitor] = m.state.tasks;
  assert.equal(restoredWork.mode, 'direct'); assert.equal(restoredWork.rounds, 9); assert.equal(restoredWork.status, 'blocked');
  assert.equal(restoredMonitor.sentCount, 4); assert.equal(restoredMonitor.status, 'blocked');
  assert.equal(restoredMonitor.wake.delivery, 'uncertain'); assert.equal(restoredMonitor.wake.episodeId, 'episode');
  assert.equal(restoredMonitor.note, 'Local note'); assert.equal(restoredMonitor.continuationMessage, 'Custom message');
  assert.deepEqual(store.load(), m.state); assert.deepEqual(calls, []);
});

test('backup recovery normalizes each mode and pauses both without adding direct fields to monitors', t => {
  const store = temporaryStore(t), work = direct(), watch = monitor();
  delete work.mode; work.rounds = 5;
  watch.continuous = true; watch.status = 'waiting'; watch.sentCount = 3;
  watch.wake = { armed: true, delivery: 'pending', episodeId: 'episode', exhaustedAt: 1000 };
  store.save(savedState(work, watch)); store.save(savedState(work, watch));
  const { m, calls } = manager(t, store);
  m.recoverStorage('backup');
  const [restoredWork, restoredMonitor] = m.state.tasks;
  assert.equal(restoredWork.mode, 'direct'); assert.equal(restoredWork.rounds, 5);
  assert.equal(restoredMonitor.sentCount, 3); assert.equal(restoredMonitor.wake.delivery, 'uncertain');
  assert.equal('turnId' in restoredMonitor, false);
  for (const task of m.state.tasks) { assert.equal(task.continuous, false); assert.equal(task.status, 'blocked'); }
  assert.equal(m.state.settings.enabled, false); assert.deepEqual(calls, []); assert.deepEqual(store.load(), m.state);
});
