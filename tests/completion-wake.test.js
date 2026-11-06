import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Manager } from '../server/manager.js';
import { QueueSender } from '../server/queue-sender.js';
import { Store, validateState } from '../server/store.js';
import { validate } from '../plugin/tools.js';
import { interruptedThread } from './fixtures/thread-history.js';

const threadId = '11111111-1111-4111-8111-111111111111';
const quota = usedPercent => ({ rateLimits: { primary: { usedPercent } } });
const finished = (id = 'final-turn', phase = 'final_answer') => ({ id, status: 'completed', itemsView: 'full', items: [
  { type: 'userMessage', id: 'instruction' }, { type: 'agentMessage', phase, text: 'PRIVATE ANSWER BODY' },
] });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function fixture(t, { saved, store, enabled = true } = {}) {
  const rpc = new EventEmitter(), commands = [], saves = [], reads = [];
  let thread = interruptedThread(threadId, { turns: [finished()] });
  rpc.ready = true; rpc.close = () => {};
  rpc.call = async (method, params) => {
    reads.push({ method, params });
    if (method === 'thread/turns/list') return { data: structuredClone(thread.turns.slice(-1)) };
    return { thread: structuredClone(params.includeTurns ? thread : { ...thread, turns: [] }) };
  };
  const sender = new QueueSender({ binary: 'mock-codex', run: async (_binary, args) => { commands.push(args); return `Queued message ${threadId}`; } });
  const m = new Manager(rpc, store || { load: () => saved && structuredClone(saved), save: state => { validateState(state); saves.push(structuredClone(state)); } }, { demo: true, wakeSender: sender });
  m.connection.status = 'connected'; t.after(() => m.stop());
  const task = m.state.tasks[0] || await m.importThread(threadId, 'Local note', 'QUOTA MESSAGE', { completionMonitoring: enabled, completionMessage: 'FINAL MESSAGE', completionRepeat: true, completionMaxSends: 100 });
  const tick = async () => { m.completionChecks.clear(); m.setQuota(quota(0)); await m.tick(); };
  return { m, task, rpc, sender, commands, saves, reads, tick, setThread: value => { thread = value; }, sent: () => commands.filter(args => args.includes('--message')) };
}

test('completion follow-up needs explicit opt-in and monitoring; sends its own editable message once per final turn', async t => {
  const f = await fixture(t, { enabled: false });
  await f.tick(); await f.m.action(f.task.id, 'resume'); await f.tick(); assert.equal(f.sent().length, 0);
  await f.m.action(f.task.id, 'completion', { enabled: true, message: '  下一项工作\n先运行测试  ' });
  await f.tick(); await f.tick();
  assert.equal(f.sent().length, 1); assert.equal(f.sent()[0].at(-1), '下一项工作\n先运行测试');
  assert.equal(f.task.continuationMessage, 'QUOTA MESSAGE'); assert.equal(f.task.sentCount, 1);
  await f.m.action(f.task.id, 'pause'); await f.m.action(f.task.id, 'resume'); await f.tick(); assert.equal(f.sent().length, 1);
  f.setThread(interruptedThread(threadId, { turns: [finished('second-final')] })); await f.tick();
  assert.equal(f.sent().length, 2); assert.equal(f.task.completion.lastTurnId, 'second-final');
  assert.ok(!JSON.stringify(f.saves).includes('PRIVATE ANSWER BODY'));
  assert.equal(f.m.snapshot({ details: false }).tasks[0].completionMessage, undefined);
});

test('complete-reply claim and both messages survive isolated disk restart without replaying the same final answer', async t => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-completion-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); });
  const store = new Store(join(directory, 'state.json'));
  const first = await fixture(t, { store }); await first.m.action(first.task.id, 'resume'); await first.tick(); first.m.stop();
  const restored = await fixture(t, { store }); await restored.tick();
  assert.equal(restored.sent().length, 0); assert.equal(restored.task.sentCount, 1);
  assert.equal(restored.task.completionMessage, 'FINAL MESSAGE'); assert.equal(restored.task.continuationMessage, 'QUOTA MESSAGE');
  restored.m.stop();
});

test('only complete replies on the newest instruction trigger, including paginated history', async t => {
  const f = await fixture(t); await f.m.action(f.task.id, 'resume');
  const bad = [
    { status: { type: 'active' }, turns: [finished()] },
    { turns: [finished('old'), { ...finished('new'), status: 'interrupted' }] },
    { turns: [{ ...finished(), status: 'failed' }] },
    { turns: [finished('comment', 'commentary')] },
    { turns: [{ ...finished(), itemsView: 'summary' }] },
    { turns: [{ ...finished(), items: [...finished().items, { type: 'userMessage' }] }] },
    { turns: [] }, { status: { type: 'future-state' } },
  ];
  for (const overrides of bad) { f.setThread(interruptedThread(threadId, overrides)); await f.tick(); }
  assert.equal(f.sent().length, 0); assert.equal(f.task.sentCount, 0);
  f.setThread(interruptedThread(threadId, { historyMode: 'paginated', turns: [finished()] })); await f.tick();
  assert.equal(f.sent().length, 1);
  assert.ok(f.reads.some(read => read.method === 'thread/turns/list' && read.params.itemsView === 'full'));
});

test('final reply monitoring honors poll cadence and current quota rather than requiring exhaustion', async t => {
  const f = await fixture(t); await f.m.action(f.task.id, 'resume');
  f.m.setQuota(quota(100)); await f.m.tick(); assert.equal(f.sent().length, 0);
  f.m.setQuota(quota(0)); f.m.wakeSampledAt -= 90001; await f.m.tick(); assert.equal(f.sent().length, 0);
  await f.tick(); const count = f.reads.length; await f.m.tick();
  assert.equal(f.reads.length, count); assert.equal(f.sent().length, 1);
  assert.equal(f.task.wake.armed, false); assert.equal(f.task.wake.delivery, 'idle');
});

test('new instructions arriving during capability probe cancel a stale final follow-up', async t => {
  for (const active of [true, false]) {
    const f = await fixture(t); await f.m.action(f.task.id, 'resume');
    f.sender.run = async (_binary, args) => {
      f.commands.push(args);
      if (args.includes('--help')) f.setThread(interruptedThread(threadId, active ? { status: { type: 'active' } } : { turns: [finished('newer-final')] }));
      return '';
    };
    await f.tick(); assert.equal(f.sent().length, 0); assert.equal(f.task.sentCount, 0); assert.equal(f.task.completion.delivery, 'idle');
  }
});

test('a new reply starting during the final paginated read cancels the completion follow-up', async t => {
  const f=await fixture(t);await f.m.action(f.task.id,'resume');
  f.setThread(interruptedThread(threadId,{historyMode:'paginated',turns:[finished()]}));
  const call=f.rpc.call;let pages=0;
  f.rpc.call=async(method,params)=>{
    const result=await call(method,params);
    if(method==='thread/turns/list' && ++pages===2) f.setThread(interruptedThread(threadId,{historyMode:'paginated',status:{type:'active'},turns:[finished()]}));
    return result;
  };
  await f.tick();assert.equal(pages,2);assert.equal(f.sent().length,0);assert.equal(f.task.sentCount,0);
  assert.equal(f.task.completion.delivery,'idle');
});

test('pause, epoch invalidation, stale quota, disconnect and lowered limits all cancel before queue side effect', async t => {
  for (const change of ['pause', 'toggle', 'stale', 'disconnect', 'limit']) {
    const f = await fixture(t); await f.m.action(f.task.id, 'resume');
    const entered = deferred(), release = deferred();
    f.sender.run = async (_binary, args) => { f.commands.push(args); if (args.includes('--help')) { entered.resolve(); await release.promise; } return ''; };
    const pending = f.tick(); await entered.promise;
    assert.equal(f.saves.at(-1).tasks[0].completion.delivery, 'sending');
    if (change === 'pause') await f.m.action(f.task.id, 'pause');
    if (change === 'toggle') { f.m.updateSettings({ enabled: false }); f.m.updateSettings({ enabled: true }); }
    if (change === 'stale') f.m.wakeSampledAt -= 90001;
    if (change === 'disconnect') f.rpc.emit('disconnect', 'Fixture disconnect');
    if (change === 'limit') { f.task.sentCount = 1; f.m.updateSettings({ maxWakeSends: 1 }); }
    release.resolve(); await pending;
    assert.equal(f.sent().length, 0, change); assert.equal(f.m.wakeExecutions.size, 0);
  }
});

test('uncertain delivery blocks automatic retries and restart; manual resume skips that answer', async t => {
  const f = await fixture(t); await f.m.action(f.task.id, 'resume');
  f.task.status='waiting'; f.task.waitReason='thread'; f.task.retryAt=Date.now()+60000;
  f.sender.run = async (_binary, args) => { if (args.includes('--message')) throw Error('queue result unknown'); return ''; };
  await f.tick(); assert.equal(f.task.completion.delivery, 'uncertain'); assert.equal(f.task.status, 'blocked'); assert.equal(f.task.sentCount, 0);
  assert.equal(f.task.waitReason,null); assert.equal(f.task.retryAt,0);
  const restored = await fixture(t, { saved: f.saves.at(-1) }); await restored.tick(); assert.equal(restored.sent().length, 0);
  await restored.m.action(restored.task.id, 'resume'); await restored.tick(); assert.equal(restored.sent().length, 0);
  restored.setThread(interruptedThread(threadId, { turns: [finished('next-final')] })); await restored.tick(); assert.equal(restored.sent().length, 1);
});

test('restart during in-flight delivery becomes uncertain and never silently replays', async t => {
  const f = await fixture(t); await f.m.action(f.task.id, 'resume');
  Object.assign(f.task.completion, { delivery: 'sending', turnId: 'final-turn' }); f.m.changed();
  f.task.waitReason='quota';f.task.retryAt=Date.now()+60000;f.m.changed();
  const restored = await fixture(t, { saved: f.saves.at(-1) }); await restored.tick();
  assert.equal(restored.task.completion.delivery, 'uncertain'); assert.equal(restored.task.continuous, false); assert.equal(restored.task.status, 'blocked');
  assert.equal(restored.task.waitReason,null);assert.equal(restored.task.retryAt,0);
  assert.equal(restored.sent().length, 0);
});

test('storage failure before or after queue effect stops scheduling without replaying the claimed answer', async t => {
  for (const stage of ['claim', 'confirm']) {
    let fail = false, durable;
    const store = { load: () => null, save: state => {
      const delivery = state.tasks[0]?.completion?.delivery;
      if (fail && delivery === (stage === 'claim' ? 'sending' : 'sent')) throw Error('fixture disk failure');
      validateState(state); durable = structuredClone(state);
    } };
    const f = await fixture(t, { store }); await f.m.action(f.task.id, 'resume'); fail = true;
    await assert.rejects(f.tick(), /disk failure/);
    assert.equal(f.m.persistence.status, 'error'); assert.equal(f.m.state.settings.enabled, false);
    assert.equal(f.sent().length, stage === 'claim' ? 0 : 1); assert.equal(f.task.sentCount, stage === 'claim' ? 0 : 1);
    fail = false; f.m.recoverStorage('retry');
    const restored = await fixture(t, { saved: durable });
    restored.m.updateSettings({ enabled: true }); await restored.m.action(restored.task.id, 'resume'); await restored.tick();
    assert.equal(restored.sent().length, 0, stage);
  }
});

test('pausing while queue confirmation is in flight keeps the pause and the confirmed deduplication record', async t => {
  const f = await fixture(t); await f.m.action(f.task.id, 'resume');
  const entered = deferred(), release = deferred();
  f.sender.run = async (_binary, args) => {
    f.commands.push(args);
    if (args.includes('--message')) { entered.resolve(); await release.promise; }
    return '';
  };
  const pending = f.tick(); await entered.promise; await f.m.action(f.task.id, 'pause');
  release.resolve(); await pending;
  assert.equal(f.sent().length, 1); assert.equal(f.task.sentCount, 1); assert.equal(f.task.continuous, false); assert.equal(f.task.status, 'paused');
  await f.m.action(f.task.id, 'resume'); await f.tick(); assert.equal(f.sent().length, 1);
});

test('send cap is shared across quota and final-answer deliveries and never resets on resume', async t => {
  const f = await fixture(t); f.m.updateSettings({ maxWakeSends: 2 }); await f.m.action(f.task.id, 'resume');
  f.setThread(interruptedThread(threadId)); f.m.setQuota(quota(100)); await f.m.tick(); await f.tick();
  assert.equal(f.sent()[0].at(-1), 'QUOTA MESSAGE');
  f.setThread(interruptedThread(threadId, { turns: [finished()] })); await f.tick();
  assert.equal(f.sent()[1].at(-1), 'FINAL MESSAGE'); assert.equal(f.task.sentCount, 2); assert.equal(f.task.continuous, false);
  await assert.rejects(f.m.action(f.task.id, 'resume'), /上限/);
  f.m.updateSettings({ maxWakeSends: 3 }); await f.m.action(f.task.id, 'resume'); await f.tick(); assert.equal(f.sent().length, 2);
});

test('blank completion message follows saved language and validation never changes a valid configuration', async t => {
  const f = await fixture(t); await f.m.action(f.task.id, 'completion', { enabled: true, message: ' \n ' });
  f.m.updateSettings({ language: 'en' }); await f.m.action(f.task.id, 'resume'); await f.tick(); assert.equal(f.sent()[0].at(-1), 'Continue');
  const before = structuredClone(f.task);
  for (const value of [null, [], { enabled: 'on', message: '' }, { enabled: true, message: null }, { enabled: true, message: 'x'.repeat(12001) }]) {
    await assert.rejects(f.m.action(f.task.id, 'completion', value)); assert.deepEqual(f.task, before);
  }
  for (const patch of [{ completionMonitoring: 'on' }, { completionMessage: null }, { completion: { delivery: 'sending' } }]) {
    Object.assign(f.task, patch); assert.throws(() => validateState(f.m.state)); Object.assign(f.task, structuredClone(before));
  }
  for (const args of [{ completionMonitoring: true }, { completionMessage: 'Continue' }]) assert.throws(() => validate('continuer_import_session', { threadId, ...args }));
  assert.throws(() => validate('continuer_task_action', { id: f.task.id, action: 'completion', value: true }));
});
