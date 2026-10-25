import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';

const threadId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const thread = id => ({ thread: { id, name: 'Original', cwd: 'E:\\project' } });
const quota = usedPercent => ({ rateLimits: { primary: { usedPercent }, secondary: { usedPercent: 10 } } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(read = async id => thread(id)) {
  const rpc = new EventEmitter(); rpc.ready = true;
  const reads = [], saves = [], sends = [];
  rpc.call = (method, params) => {
    assert.equal(method, 'thread/read');
    reads.push(params.threadId); return read(params.threadId);
  };
  const m = new Manager(rpc, { load: () => null, save: state => saves.push(structuredClone(state)) }, {
    demo: true, wakeSender: { send: async id => { sends.push(id); return { queueId: 'fixture' }; } },
  });
  m.connection.status = 'connected';
  return { m, reads, saves, sends };
}

test('20 parallel imports create one paused record and one message per quota recovery', async () => {
  const gate = deferred(); const { m, reads, saves, sends } = setup(() => gate.promise);
  const pending = Promise.allSettled(Array.from({ length: 20 }, () => m.importThread(threadId, 'Original goal')));
  gate.resolve(thread(threadId));
  const results = await pending;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 19);
  assert.deepEqual(reads, [threadId]);
  assert.equal(m.state.tasks.length, 1); assert.equal(saves.length, 1);
  const task = m.state.tasks[0];
  assert.equal(task.status, 'paused'); assert.equal(task.continuous, false);
  assert.equal(saves[0].tasks.length, 1); assert.equal(m.state.logs.length, 1);
  await m.action(task.id, 'continuous', true);
  m.setQuota(quota(100)); await m.tick();
  m.setQuota(quota(0)); await Promise.all(Array.from({ length: 20 }, () => m.tick()));
  await m.tick(); assert.deepEqual(sends, [threadId]); assert.equal(task.sentCount, 1);
  m.setQuota(quota(100)); await m.tick(); m.setQuota(quota(0)); await m.tick();
  assert.deepEqual(sends, [threadId, threadId]); assert.equal(task.sentCount, 2);
});

test('a failed read releases the import reservation and permits a retry', async () => {
  const gate = deferred(); let attempts = 0;
  const { m, reads, saves } = setup(id => ++attempts === 1 ? gate.promise : Promise.resolve(thread(id)));
  const first = assert.rejects(m.importThread(threadId, 'Original goal'), /offline/);
  await assert.rejects(m.importThread(threadId, 'Concurrent goal'), /正在添加|已添加/);
  gate.reject(new Error('offline')); await first;
  assert.equal(m.state.tasks.length, 0); assert.equal(saves.length, 0);
  const task = await m.importThread(threadId, 'Retry goal');
  assert.equal(task.note, 'Retry goal'); assert.equal(m.state.tasks.length, 1);
  assert.deepEqual(reads, [threadId, threadId]);
});

test('different chats can be imported while another chat is waiting for its read', async () => {
  const first = deferred(), second = deferred();
  const { m, reads } = setup(id => id === threadId ? first.promise : second.promise);
  const pending = Promise.all([m.importThread(threadId, 'First goal'), m.importThread(otherId, 'Second goal')]);
  assert.deepEqual(reads, [threadId, otherId]);
  second.resolve(thread(otherId)); first.resolve(thread(threadId));
  const tasks = await pending;
  assert.equal(new Set(tasks.map(t => t.threadId)).size, 2); assert.equal(m.state.tasks.length, 2);
});

test('existing records reject another import without re-reading or resetting monitoring', async () => {
  const { m, reads, saves } = setup(); const task = await m.importThread(threadId, 'Original goal');
  await m.action(task.id, 'continuous', true); m.setQuota(quota(100)); await m.tick();
  const before = structuredClone(task), savesBefore = saves.length;
  await assert.rejects(m.importThread(threadId, 'Replacement goal'), /已添加/);
  assert.deepEqual(task, before); assert.equal(saves.length, savesBefore); assert.deepEqual(reads, [threadId]);
});

test('the commit check detects a record added by another path during the read', async () => {
  const gate = deferred(); const { m, saves } = setup(() => gate.promise);
  const pending = assert.rejects(m.importThread(threadId, 'Imported goal'), /已添加/);
  const existing = { id: 'other-record', threadId, status: 'paused', continuous: false, prompt: 'Existing goal', plan: [] };
  m.state.tasks.push(existing); gate.resolve(thread(threadId)); await pending;
  assert.deepEqual(m.state.tasks, [existing]); assert.equal(saves.length, 0);
});

test('invalid input does not reserve a chat and a completed record can be imported again', async () => {
  const { m, reads } = setup();
  await assert.rejects(m.importThread(threadId, 12), /备注/);
  const first = await m.importThread(threadId, 'First goal');
  await m.action(first.id, 'complete');
  const second = await m.importThread(threadId, 'Second goal');
  assert.notEqual(first.id, second.id); assert.equal(second.status, 'paused');
  assert.equal(m.state.tasks.length, 1); assert.deepEqual(reads, [threadId, threadId]);
});
