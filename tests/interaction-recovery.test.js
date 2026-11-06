import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';
import { initialState } from '../server/state-lifecycle.js';
import { TaskDetails } from '../public/task-details.js';
import { StateSnapshots } from '../public/interaction-state.js';
import { quotaWindow } from '../public/quota-display.js';

function fixture() {
  let saved = initialState(false), fail = false;
  const rpc = new EventEmitter(); Object.assign(rpc, { ready: true, used: 0, calls: [], async connect() {}, close() {} });
  rpc.call = async (method, params) => {
    rpc.calls.push(method);
    if (method === 'thread/read') return { thread: { id: params.threadId, name: 'Fixture', cwd: 'E:/fixture' } };
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: rpc.used } } };
    if (method === 'thread/start') return { thread: { id: 'fixture' } };
    if (method === 'turn/start') return { turn: { id: 'fixture-turn' } };
    return {};
  };
  const store = { load: () => structuredClone(saved), save(value) { if (fail) throw Error('Disk full'); saved = structuredClone(value); } };
  return { rpc, manager: () => new Manager(rpc, store, { demo: true }), set fail(value) { fail = value; }, get saved() { return saved; } };
}

for (const operation of ['create', 'import']) test(`${operation} can be retried after a failed save without a duplicate or phantom record`, async () => {
  const f = fixture(), m = f.manager();
  const add = () => operation === 'create'
    ? m.create({ name: 'One record', cwd: 'E:/fixture', prompt: 'Isolated', continuous: false })
    : m.importThread('fixture-thread', 'Note', 'Message');
  try {
    f.fail = true; await assert.rejects(async () => add(), /Disk full/);
    assert.equal(m.state.tasks.length, 0); assert.equal(f.saved.tasks.length, 0);
    assert.equal(m.persistence.status, 'error'); assert.equal(m.state.settings.enabled, false);
    f.fail = false; await add();
    assert.equal(m.state.tasks.length, 1); assert.equal(f.saved.tasks.length, 1);
    assert.equal(m.persistence.status, 'ok'); assert.equal(f.rpc.calls.includes('turn/start'), false);
  } finally { f.fail = false; m.stop(); }
});

test('a one-shot task waiting for initial quota starts once and never schedules another turn', async () => {
  const f = fixture(), m = f.manager();
  try {
    m.updateSettings({ enabled: true });
    const task = m.create({ name: 'One shot', cwd: 'E:/fixture', prompt: 'Isolated', continuous: false });
    f.rpc.used = 100; await m.refresh(); assert.equal(task.status, 'waiting');
    f.rpc.used = 0; await m.refresh();
    assert.equal(task.status, 'running'); assert.equal(f.rpc.calls.filter(x => x === 'turn/start').length, 1);
    m.event({ method: 'turn/completed', params: { threadId: task.threadId, turn: { id: task.turnId, status: 'completed' } } });
    for (let i = 0; i < 3; i++) await m.tick();
    assert.equal(f.rpc.calls.filter(x => x === 'turn/start').length, 1);
  } finally { m.stop(); }
});

test('reconnected details read the persisted message even when the numeric revision repeats', async () => {
  const f = fixture(); let m = f.manager(), reads = 0;
  try {
    const task = await m.importThread('fixture-thread', 'Note', 'Old message');
    const cache = new TaskDetails(async () => { reads++; return { task: structuredClone(m.taskSnapshot(task.id)) }; }, () => {});
    const before = m.snapshot({ details: false }).tasks[0];
    cache.read(before); await new Promise(setImmediate);
    await m.action(task.id, 'message', 'New message'); m.stop(); m = f.manager();
    const after = m.snapshot({ details: false }).tasks[0];
    assert.equal(after.detailRevision, before.detailRevision);
    assert.notEqual(after.detailInstanceId, before.detailInstanceId);
    cache.read(after); assert.equal(cache.ready(after), false); await new Promise(setImmediate);
    assert.equal(cache.read(after).continuationMessage, 'New message');
    assert.equal(cache.ready(after), true); assert.equal(reads, 2);
  } finally { m.stop(); }
});

test('late HTTP state cannot replace newer live state or return to a retired service', () => {
  const f = fixture(), first = f.manager(), second = f.manager(), snapshots = new StateSnapshots();
  try {
    const old = first.snapshot({ details: false });
    first.updateSettings({ enabled: true });
    const live = first.snapshot({ details: false });
    assert.equal(snapshots.accept(old), old); assert.equal(snapshots.accept(live), live);
    assert.equal(snapshots.accept(old), live);
    const restarted = second.snapshot({ details: false });
    assert.equal(snapshots.accept(restarted), restarted); assert.equal(snapshots.accept(live), restarted);
  } finally { first.stop(); second.stop(); }
});

test('a weekly-only sample is not borrowed for the five-hour slot; other durations retain their identity', () => {
  const now = Date.now(), sample = primary => ({ connection: {status:'connected'}, sampledAt:now, quota:{rateLimits:{primary}} });
  const weekly = sample({usedPercent:40,windowDurationMins:10080});
  assert.equal(quotaWindow(weekly,'primary',true,now).remaining,null);
  assert.equal(quotaWindow(weekly,'secondary',true,now).remaining,60);
  assert.equal(quotaWindow(sample({usedPercent:20,windowDurationMins:60}),'primary',true,now).windowMinutes,60);
});
