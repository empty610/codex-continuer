import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';
import { DemoRpc } from '../server/demo.js';

const input = { name: 'Turn fixture', cwd: 'E:\\fixture', prompt: 'Isolated goal', continuous: true };
const resultText = status => JSON.stringify({ status, summary: 'Verified fixture' });
class FakeRpc extends EventEmitter {
  ready = true; calls = []; sent = []; sequence = 0;
  async call(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread-fixture' } };
    if (method === 'thread/read') return { thread: { status: { type: 'idle' } } };
    if (method === 'turn/start') return { turn: { id: `turn-${++this.sequence}` } };
    if (method === 'turn/interrupt') this.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } } });
    return {};
  }
  send(message) { this.sent.push(message); }
  close() {}
}
function fixture(t, rpc = new FakeRpc(), saved = null) {
  const saves = [], m = new Manager(rpc, { load: () => saved && structuredClone(saved), save: state => saves.push(structuredClone(state)) }, { demo: true });
  t.after(() => m.stop());
  m.connection.status = 'connected'; m.setQuota({ rateLimits: { primary: { usedPercent: 10 } } });
  const task = saved ? m.state.tasks[0] : m.create(input);
  const event = (method, data = {}, turnId = task.turnId) => m.event({ method, params: { threadId: task.threadId, turnId, ...data } });
  const finish = (status = 'completed', turnId = task.turnId, error) => event('turn/completed', { turn: { id: turnId, status, error } }, turnId);
  const message = status => event('item/completed', { item: { type: 'agentMessage', text: resultText(status) } });
  return { m, task, rpc, saves, event, finish, message };
}
function holdStart(f) {
  let resolve, reject;
  const original = f.rpc.call.bind(f.rpc);
  f.rpc.call = (method, params) => method === 'turn/start' ? new Promise((yes, no) => { resolve = yes; reject = no; }) : original(method, params);
  return { get ready() { return !!resolve; }, resolve: id => resolve({ turn: { id } }), reject: error => reject(error) };
}
async function waitForStart(held) { while (!held.ready) await Promise.resolve(); }

test('obsolete completion never changes a running, approval or pausing task or its approvals', async t => {
  for (const state of ['running', 'approval', 'pausing']) for (const status of ['completed', 'failed', 'interrupted']) {
    const f = fixture(t); await f.m.run(f.task);
    Object.assign(f.task, { status: state, output: resultText('done'), outcome: { status: 'done', summary: 'Verified' } });
    f.m.approvals.set('current', { taskId: f.task.id });
    const before = structuredClone(f.m.snapshot()), count = f.saves.length;
    f.m.event({ method: 'turn/completed', params: { threadId: f.task.threadId, turn: { id: 'obsolete-turn', status, error: { codexErrorInfo: 'usageLimitExceeded' } } } });
    assert.deepEqual(f.m.snapshot(), before); assert.equal(f.saves.length, count);
  }
});

test('wrong thread, missing IDs, conflicting IDs and nonterminal completions are ignored', async t => {
  const f = fixture(t); await f.m.run(f.task); f.task.output = resultText('done');
  const before = structuredClone(f.m.snapshot()), count = f.saves.length;
  for (const params of [
    { threadId: 'other', turn: { id: f.task.turnId, status: 'completed' } },
    { threadId: f.task.threadId, turn: { status: 'completed' } },
    { turnId: f.task.turnId, turn: { id: f.task.turnId, status: 'completed' } },
    { threadId: f.task.threadId, turnId: f.task.turnId, turn: { id: 'obsolete', status: 'completed' } },
    { threadId: f.task.threadId, turnId: 'obsolete', turn: { id: f.task.turnId, status: 'completed' } },
    { threadId: f.task.threadId, turn: { id: f.task.turnId, status: 'inProgress' } },
  ]) f.m.event({ method: 'turn/completed', params });
  assert.deepEqual(f.m.snapshot(), before); assert.equal(f.saves.length, count);
});

test('stale start, plan, output and tool notifications cannot poison the current round', async t => {
  const f = fixture(t); await f.m.run(f.task);
  const before = structuredClone(f.m.snapshot()), count = f.saves.length;
  for (const [method, data] of [
    ['turn/started', { turn: { id: 'obsolete' } }],
    ['turn/plan/updated', { plan: [{ step: 'Old plan', status: 'completed' }] }],
    ['item/agentMessage/delta', { delta: 'old text' }],
    ['item/started', { item: { type: 'commandExecution' } }],
    ['item/completed', { item: { type: 'agentMessage', text: resultText('done') } }],
  ]) f.event(method, data, 'obsolete');
  assert.deepEqual(f.m.snapshot(), before); assert.equal(f.saves.length, count);
  f.message('blocked'); f.finish(); assert.equal(f.task.status, 'blocked');
});

test('duplicate completion and late starts cannot reopen terminal or queued rounds', async t => {
  for (const [wireStatus, outcome, expected, error] of [
    ['completed', 'continue', 'queued'], ['completed', 'blocked', 'blocked'],
    ['interrupted', 'done', 'paused'], ['failed', 'done', 'failed', { codexErrorInfo: 'unauthorized' }],
    ['failed', 'done', 'waiting', { codexErrorInfo: 'usageLimitExceeded' }],
  ]) {
    const f = fixture(t); await f.m.run(f.task); const turnId = f.task.turnId;
    f.task.toolCount = 1; f.message(outcome); f.finish(wireStatus, turnId, error);
    assert.equal(f.task.status, expected); assert.equal(f.task.turnId, null);
    const before = structuredClone(f.m.snapshot()), count = f.saves.length;
    f.finish(wireStatus, turnId, error);
    f.event('turn/started', { turn: { id: turnId } }, turnId);
    f.event('item/agentMessage/delta', { delta: 'late text' }, turnId);
    assert.deepEqual(f.m.snapshot(), before); assert.equal(f.saves.length, count);
  }
});

test('valid completion clears only its own task after rejecting an older done event', async t => {
  const f = fixture(t); await f.m.run(f.task); f.message('done');
  f.finish('completed', 'obsolete'); assert.equal(f.task.status, 'running');
  const keep = f.m.create({ ...input, name: 'Keep' });
  f.finish(); assert.equal(f.task.status, 'completed');
  assert.deepEqual(f.m.state.tasks.map(task => task.id), [keep.id]);
});

test('an earlier round cannot finish or overwrite the next round in the same chat', async t => {
  const f = fixture(t); await f.m.run(f.task); const previousId = f.task.turnId;
  f.task.toolCount = 1; f.message('continue'); f.finish();
  await f.m.run(f.task); assert.notEqual(f.task.turnId, previousId);
  const before = structuredClone(f.m.snapshot()), count = f.saves.length;
  f.event('turn/started', { turn: { id: previousId } }, previousId);
  f.event('item/completed', { item: { type: 'agentMessage', text: resultText('done') } }, previousId);
  f.finish('completed', previousId);
  assert.deepEqual(f.m.snapshot(), before); assert.equal(f.saves.length, count);
  f.message('blocked'); f.finish(); assert.equal(f.task.status, 'blocked');
});

test('stale approvals and unsupported requests are rejected without interrupting the current round', async t => {
  const f = fixture(t); await f.m.run(f.task);
  const before = structuredClone(f.m.snapshot()), count = f.saves.length;
  for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'unsupported/request']) {
    f.m.request({ id: method, method, params: { threadId: f.task.threadId, turnId: 'obsolete' } });
    assert.ok(f.rpc.sent.at(-1).error);
  }
  assert.deepEqual(f.m.snapshot(), before); assert.equal(f.saves.length, count);
  assert.equal(f.rpc.calls.some(call => call.method === 'turn/interrupt'), false);
});

test('early events wait for the start response and replay only the acknowledged turn', async t => {
  const f = fixture(t), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  const before = structuredClone(f.m.snapshot());
  f.event('turn/started', { turn: { id: 'obsolete' } }, 'obsolete'); f.finish('completed', 'obsolete');
  f.event('turn/started', { turn: { id: 'new-turn' } }, 'new-turn');
  f.event('turn/plan/updated', { plan: [{ step: 'Current plan', status: 'completed' }] }, 'new-turn');
  f.event('item/started', { item: { type: 'commandExecution' } }, 'new-turn');
  f.event('item/completed', { item: { type: 'agentMessage', text: resultText('continue') } }, 'new-turn');
  f.finish('completed', 'new-turn');
  assert.deepEqual(f.m.snapshot(), before);
  held.resolve('new-turn'); await pending;
  assert.equal(f.task.status, 'queued'); assert.equal(f.task.turnId, null);
  assert.equal(f.task.toolCount, 1); assert.equal(f.task.plan[0].step, 'Current plan');
  assert.equal(f.task.activity, 'Verified fixture'); assert.equal(f.m.executions.size, 0);
});

test('completion before a late started notification is processed only once', async t => {
  const f = fixture(t), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  f.event('item/completed', { item: { type: 'agentMessage', text: resultText('blocked') } }, 'new-turn');
  f.finish('completed', 'new-turn'); f.event('turn/started', { turn: { id: 'new-turn' } }, 'new-turn');
  held.resolve('new-turn'); await pending;
  assert.equal(f.task.status, 'blocked'); assert.equal(f.task.turnId, null);
  assert.equal(f.m.state.logs.filter(log => log.message.endsWith('Verified fixture')).length, 1);
});

test('early approvals are filtered by the acknowledged ID', async t => {
  const f = fixture(t), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  for (const turnId of ['obsolete', 'new-turn']) f.m.request({ id: turnId, method: 'item/commandExecution/requestApproval', params: { threadId: f.task.threadId, turnId, command: 'fixture' } });
  assert.equal(f.m.approvals.size, 0);
  held.resolve('new-turn'); await pending;
  assert.equal(f.task.status, 'approval'); assert.deepEqual([...f.m.approvals.keys()], ['new-turn']);
  assert.equal(f.rpc.sent[0].id, 'obsolete'); assert.ok(f.rpc.sent[0].error);
  f.m.approve('new-turn', 'decline', f.m.approvals.get('new-turn').detailToken); assert.equal(f.task.status, 'running');
});

test('large final JSON before the start response retains bounded output and its real status', async t => {
  const f = fixture(t), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  f.event('item/completed', { item: { type: 'agentMessage', text: JSON.stringify({ status: 'blocked', summary: 's'.repeat(2 * 1024 * 1024) }) } }, 'new-turn');
  f.finish('completed', 'new-turn'); held.resolve('new-turn'); await pending;
  assert.equal(f.task.status, 'blocked'); assert.equal(f.task.output.length, 16000);
  assert.equal(f.task.outputTruncated, true); assert.equal(f.task.outcome.summary.length, 2000);
});

test('pause before the start response interrupts the acknowledged turn exactly once', async t => {
  const f = fixture(t), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  await f.m.action(f.task.id, 'pause'); f.finish('completed', 'obsolete');
  held.resolve('new-turn'); await pending;
  assert.equal(f.task.status, 'paused'); assert.equal(f.task.turnId, null);
  assert.deepEqual(f.rpc.calls.filter(call => call.method === 'turn/interrupt').map(call => call.params.turnId), ['new-turn']);
});

test('a failed interrupt after a delayed start is blocked rather than reported as paused', async t => {
  const f = fixture(t), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  const original = f.rpc.call.bind(f.rpc);
  f.rpc.call = (method, params) => method === 'turn/interrupt' ? Promise.reject(new Error('fixture interrupt failure')) : original(method, params);
  await f.m.action(f.task.id, 'pause'); held.resolve('new-turn'); await pending;
  assert.equal(f.task.status, 'blocked'); assert.match(f.task.activity, /未确认中断/);
});

for (const settles of ['resolve', 'reject']) test(`disconnect invalidates a delayed start ${settles} across a newer execution`, async t => {
  const f = fixture(t), original = f.rpc.call.bind(f.rpc), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  f.rpc.emit('disconnect', 'fixture disconnect'); assert.equal(f.task.status, 'blocked');
  f.rpc.call = original; f.m.connection.status = 'connected'; f.m.setQuota({ rateLimits: { primary: { usedPercent: 10 } } });
  await f.m.action(f.task.id, 'resume'); await f.m.run(f.task);
  const before = structuredClone(f.m.snapshot()), count = f.saves.length;
  settles === 'resolve' ? held.resolve('obsolete') : held.reject(new Error('late rejection'));
  await pending;
  assert.deepEqual(f.m.snapshot(), before); assert.equal(f.saves.length, count);
  assert.equal(f.task.turnId, 'turn-1');
});

test('events during thread preparation cannot bind a turn before it is started', async t => {
  const f = fixture(t); f.task.threadId = 'thread-fixture';
  let release; const original = f.rpc.call.bind(f.rpc);
  f.rpc.call = (method, params) => method === 'thread/read' ? new Promise(resolve => { release = resolve; }) : original(method, params);
  const pending = f.m.run(f.task);
  f.event('turn/started', { turn: { id: 'obsolete' } }, 'obsolete'); f.finish('completed', 'obsolete');
  assert.equal(f.task.status, 'starting'); assert.equal(f.task.turnId, null);
  release({ thread: { status: { type: 'idle' } } }); await pending;
  assert.equal(f.task.status, 'running'); assert.equal(f.task.turnId, 'turn-1');
});

test('restart blocks remembered active turns and ignores their late completion', async t => {
  const f = fixture(t); await f.m.run(f.task); f.message('done');
  const restored = fixture(t, new FakeRpc(), f.m.state);
  const before = structuredClone(restored.m.snapshot()); restored.finish();
  assert.equal(restored.task.status, 'blocked'); assert.deepEqual(restored.m.snapshot(), before);
});

for (const limit of ['count', 'bytes']) test(`start event ${limit} overflow stays bounded and interrupts rather than applying partial results`, async t => {
  const f = fixture(t), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  f.m.request({ id: 'early', method: 'item/commandExecution/requestApproval', params: { threadId: f.task.threadId, turnId: 'new-turn' } });
  if (limit === 'count') for (let i = 0; i < 300; i++) f.event('item/agentMessage/delta', { delta: 'x' }, 'new-turn');
  else f.event('item/agentMessage/delta', { delta: 'x'.repeat(4 * 1024 * 1024) }, 'new-turn');
  const execution = f.m.executions.get(f.task.id);
  assert.equal(execution.overflow, true); assert.equal(execution.events.length, 0); assert.equal(execution.bytes, 0);
  assert.ok(f.rpc.sent.some(message => message.id === 'early' && message.error));
  held.resolve('new-turn'); await pending;
  assert.equal(f.task.status, 'paused'); assert.equal(f.task.output, '');
  assert.equal(f.rpc.calls.filter(call => call.method === 'turn/interrupt').length, 1);
});

test('failed start rejects buffered approval requests and never accepts an orphan completion', async t => {
  const f = fixture(t), held = holdStart(f), pending = f.m.run(f.task); await waitForStart(held);
  f.m.request({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: f.task.threadId, turnId: 'orphan' } });
  held.reject(new Error('fixture start failure')); await pending;
  const before = structuredClone(f.m.snapshot()); f.finish('completed', 'orphan');
  assert.equal(f.task.status, 'blocked'); assert.deepEqual(f.m.snapshot(), before); assert.ok(f.rpc.sent[0].error);
});

test('demo start notification before its response still completes the current task', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, new DemoRpc()); await f.m.run(f.task);
  assert.equal(f.task.status, 'running'); assert.equal(f.task.activity, 'Codex 正在处理目标');
  t.mock.timers.tick(12500);
  assert.equal(f.task.status, 'completed'); assert.equal(f.task.toolCount, 3);
  assert.deepEqual(f.m.state.tasks, []);
});
