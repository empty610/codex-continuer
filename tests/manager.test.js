import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';

class FakeRpc extends EventEmitter {
  ready = true; calls = []; used = 10; secondary = 20;
  async connect() {}
  send(message) { this.calls.push(message); }
  async call(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: this.used }, secondary: { usedPercent: this.secondary } } };
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: this.busy ? 'active' : 'idle' } } };
    if (method === 'thread/resume' && this.writerBusy) throw new Error(`thread ${params.threadId} already has an active writer`);
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    return {};
  }
  close() {}
}
function setup(saved) {
  const rpc = new FakeRpc(); const saves = []; const store = { load: () => saved ? structuredClone(saved) : null, save: state => saves.push(structuredClone(state)) };
  const m = new Manager(rpc, store, { demo: true });
  m.connection.status = 'connected';
  m.setQuota({ rateLimits: { primary: { usedPercent: 10 } } });
  return { m, rpc, saves };
}
const task = { name: 'Test', cwd: 'E:\\test', prompt: 'Test goal', continuous: true };
function finish(m, status, error) { m.event({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status, error } } }); }
test('quota exhaustion waits; fresh recovery starts exactly once under overlapping ticks', async () => {
  const { m, rpc } = setup(); rpc.used = 100;
  const t = m.create(task); await m.refresh(); assert.equal(t.status, 'waiting');
  rpc.used = 20; await Promise.all([m.refresh(), m.tick(), m.tick()]);
  assert.equal(t.status, 'running'); assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});
test('secondary exhausted prevents launch even after primary recovers', async () => {
  const { m, rpc } = setup(); rpc.secondary = 100;
  const t = m.create(task); await m.refresh(); assert.equal(t.status, 'waiting');
  assert.equal(rpc.calls.some(c => c.method === 'turn/start'), false);
});
test('manual pause and disabling continuous exclude waiting work from recovery', async () => {
  for (const action of ['pause', 'continuous']) {
    const { m, rpc } = setup(); rpc.used = 100; const t = m.create(task); await m.refresh();
    await m.action(t.id, action, false); rpc.used = 0; await m.refresh();
    assert.equal(t.status, 'paused'); assert.equal(rpc.calls.some(c => c.method === 'turn/start'), false);
  }
});
test('global scheduler disabled never launches queued jobs', async () => {
  const { m, rpc } = setup(); m.create(task); m.updateSettings({ enabled: false }); await m.tick();
  assert.equal(rpc.calls.length, 0);
});
test('completed, blocked, and no-tool outcomes stop; valid continuation queues', async () => {
  for (const [status, tools, expected] of [['done', 1, 'completed'], ['blocked', 1, 'blocked'], ['continue', 0, 'blocked'], ['continue', 1, 'queued']]) {
    const { m } = setup(); const t = m.create(task); await m.tick();
    t.output = JSON.stringify({ status, summary: 'evidence' }); t.toolCount = tools;
    finish(m, 'completed'); assert.equal(t.status, expected);
    assert.equal(m.state.tasks.includes(t), status !== 'done');
  }
});
test('quota failure waits with backoff; auth failure requires intervention', async () => {
  for (const [code, expected] of [['usageLimitExceeded', 'waiting'], ['unauthorized', 'failed']]) {
    const { m, rpc } = setup(); const t = m.create(task); await m.tick();
    finish(m, 'failed', { codexErrorInfo: code, message: code }); assert.equal(t.status, expected);
    await m.refresh(); assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  }
});
test('restart blocks in-flight tasks and preserves waiting tasks', () => {
  const { m } = setup(); const t = m.create(task); t.status = 'running';
  const { m: restored } = setup(m.state); assert.equal(restored.state.tasks[0].status, 'blocked');
  t.status = 'waiting'; const { m: waiting } = setup(m.state); assert.equal(waiting.state.tasks[0].status, 'waiting');
});
test('never resume an active externally managed thread', async () => {
  const { m, rpc } = setup(); const t = m.create(task); t.threadId = 'external'; rpc.busy = true;
  await m.tick(); assert.equal(t.status, 'waiting'); assert.equal(t.waitReason,'thread');
  assert.equal(rpc.calls.some(c => c.method === 'thread/resume' || c.method === 'turn/start'), false);
});
test('pause during thread creation prevents launching the turn', async () => {
  const { m, rpc } = setup(); const t = m.create(task); let release;
  rpc.call = () => new Promise(resolve => { release = resolve; });
  const pending = m.tick(); while (!release) await Promise.resolve(); await m.action(t.id, 'pause'); release({ thread: { id: 'late-thread' } }); await pending;
  assert.equal(t.status, 'paused'); assert.equal(t.turnId, null);
});
test('approval requests wait for explicit decision', async () => {
  const { m, rpc } = setup(); const t = m.create(task); await m.tick();
  m.request({ id: 10, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', command: 'test' } });
  assert.equal(t.status, 'approval'); assert.equal(m.approvals.size, 1);
  m.approve(10, 'decline', m.approvals.get('10').detailToken); assert.equal(m.approvals.size, 0);
  assert.deepEqual(rpc.calls.at(-1), { id: 10, result: { decision: 'decline' } });
});
test('round cap blocks repeated execution until manual resume', async () => {
  const { m, rpc } = setup(); const t = m.create(task); t.rounds = 20; await m.tick();
  assert.equal(t.status, 'blocked'); assert.equal(rpc.calls.length, 0);
  await m.action(t.id, 'resume'); assert.equal(t.rounds, 0); await m.tick(); assert.equal(t.status, 'running');
});
test('invalid settings are rejected without partial mutation', () => {
  const { m } = setup();
  assert.throws(() => m.updateSettings({ enabled: false, pollSeconds: 0 }));
  assert.equal(m.state.settings.enabled, true);
  assert.equal(m.state.settings.pollSeconds, 30);
});
test('partial quota event preserves other exhausted buckets and sample age', () => {
  const { m } = setup();
  m.quota = { rateLimitsByLimitId: { codex: { primary: { usedPercent: 100 } }, other: { primary: { usedPercent: 100 } } } };
  const age = Date.now() - 95000; m.sampledAt = age;
  m.event({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: { usedPercent: 0 } } } });
  assert.equal(m.quota.rateLimitsByLimitId.other.primary.usedPercent, 100);
  assert.equal(m.sampledAt, age);
});

test('quota recovery encountering an active writer retries after release instead of blocking forever',async()=>{
  const {m,rpc}=setup();rpc.used=100;rpc.writerBusy=true;
  const t=m.create(task);t.threadId='external';await m.refresh();assert.equal(t.waitReason,'quota');
  rpc.used=0;await m.refresh();assert.equal(t.status,'waiting');assert.equal(t.waitReason,'writer');assert.equal(t.rounds,0);
  assert.ok(t.retryAt>Date.now());
  await Promise.all([m.tick(),m.tick()]);
  assert.equal(rpc.calls.filter(c=>c.method==='thread/resume').length,1);
  assert.equal(rpc.calls.some(c=>c.method==='turn/start'),false);
  rpc.writerBusy=false;t.retryAt=0;await Promise.all([m.tick(),m.tick()]);
  assert.equal(t.status,'running');assert.equal(t.rounds,1);
  assert.equal(rpc.calls.filter(c=>c.method==='turn/start').length,1);
});

test('active-thread wait retries once idle without starting while it is active',async()=>{
  const {m,rpc}=setup();rpc.busy=true;const t=m.create(task);t.threadId='external';
  await m.tick();assert.equal(t.status,'waiting');assert.equal(t.waitReason,'thread');
  rpc.busy=false;t.retryAt=0;await m.tick();assert.equal(t.status,'running');
  assert.equal(rpc.calls.filter(c=>c.method==='thread/resume').length,1);
});

test('restart migrates only continuous tasks blocked by the exact legacy writer-conflict error to quota monitoring',()=>{
  const {m}=setup();const t=m.create(task);t.threadId='external';
  delete t.mode; // A persisted record from before explicit direct task modes.
  t.status='blocked';t.activity='thread external already has an active writer';
  const restored=setup(m.state).m.state.tasks[0];
  assert.equal(restored.status,'monitoring');assert.equal(restored.mode,'quota-wake');assert.equal(restored.wake.armed,false);assert.equal(restored.sentCount,0);
  for(const change of [{status:'paused'},{continuous:false},{activity:'unauthorized'}]) {
    const saved=structuredClone(m.state);Object.assign(saved.tasks[0],change);
    assert.equal(setup(saved).m.state.tasks[0].status,saved.tasks[0].status);
  }
});

test('finished work is removed from snapshots, persisted tasks and pending approvals', async () => {
  const { m, rpc, saves } = setup(); const t = m.create(task);
  const keep = m.create({ ...task, name: 'Keep paused' }); await m.action(keep.id, 'pause');
  await m.tick();
  m.approvals.set('old', { taskId: t.id });
  t.output = JSON.stringify({ status: 'done', summary: 'Verified complete' });
  finish(m, 'completed');
  assert.deepEqual(m.snapshot().tasks.map(t => t.id), [keep.id]);
  assert.deepEqual(saves.at(-1).tasks.map(t => t.id), [keep.id]);
  assert.equal(m.approvals.size, 0);
  await m.tick();
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  await m.importThread('thread-1', 'A new goal');
  assert.equal(m.state.tasks[0].threadId, 'thread-1');
});

test('manual completion clears the task immediately without modifying its Codex thread', async () => {
  const { m, rpc, saves } = setup(); const t = m.create(task); t.threadId = 'original';
  await m.action(t.id, 'pause');
  await m.action(t.id, 'complete');
  assert.deepEqual(m.snapshot().tasks, []);
  assert.deepEqual(saves.at(-1).tasks, []);
  assert.deepEqual(rpc.calls, []);
});

test('startup clears only completed tasks and persists cleanup even when scheduling is off', () => {
  const { m } = setup(); m.state.settings.enabled = false;
  const statuses = ['completed', 'paused', 'waiting', 'blocked', 'failed', 'queued'];
  const tasks = statuses.map(() => m.create(task));
  tasks.forEach((t, i) => { t.status = statuses[i]; });
  const { m: restored, rpc, saves } = setup(m.state);
  assert.deepEqual(restored.state.tasks.map(t => t.status).sort(), statuses.filter(s => s !== 'completed').sort());
  assert.deepEqual(saves[0].tasks, restored.state.tasks);
  assert.equal(restored.state.settings.enabled, false);
  assert.deepEqual(rpc.calls, []);
});

test('manual pause and disabling continuous cancel writer-conflict retry',async()=>{
  for(const action of ['pause','continuous']) {
    const {m,rpc}=setup();rpc.writerBusy=true;const t=m.create(task);t.threadId='external';await m.tick();
    await m.action(t.id,action,false);rpc.writerBusy=false;t.retryAt=0;await m.tick();
    assert.equal(t.status,'paused');assert.equal(rpc.calls.some(c=>c.method==='turn/start'),false);
  }
});

test('pause while waiting for a resume rejection never requeues the task',async()=>{
  const {m,rpc}=setup();const t=m.create(task);t.threadId='external';
  const original=rpc.call.bind(rpc);let rejectResume;
  rpc.call=(method,params)=>method==='thread/resume'?new Promise((_resolve,reject)=>{rejectResume=reject;}):original(method,params);
  const pending=m.tick();while(!rejectResume)await Promise.resolve();
  await m.action(t.id,'pause');rejectResume(new Error('thread external already has an active writer'));await pending;
  assert.equal(t.status,'paused');
});

test('non-continuous writer conflicts and unrelated errors still require manual action',async()=>{
  const {m,rpc}=setup();rpc.writerBusy=true;const t=m.create({...task,continuous:false});t.threadId='external';
  await m.tick();assert.equal(t.status,'blocked');assert.equal(t.retryAt,0);
  const other=setup();const u=other.m.create(task);u.threadId='other';
  other.rpc.call=async()=>{throw new Error('unauthorized');};
  await other.m.tick();assert.equal(u.status,'blocked');
});
