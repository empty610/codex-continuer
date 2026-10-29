import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';
import { QueueSender } from '../server/queue-sender.js';
import { validateState } from '../server/store.js';
import { readThreadReply, turnReplyState } from '../server/thread-reply.js';
import { interruptedThread } from './fixtures/thread-history.js';
import { setLanguage, systemText } from '../public/i18n.js';
import { wakeExplanation } from '../public/task-mode.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const user = id => ({ type: 'userMessage', id, content: [{ type: 'text', text: 'Instruction' }] });
const answer = (phase = 'final_answer') => ({ type: 'agentMessage', id: 'reply', phase, text: '完整回复；不应保存到日志或任务。' });
const completed = () => ({ id: 'latest-turn', status: 'completed', itemsView: 'full', items: [user('latest-instruction'), answer()] });
const quota = usedPercent => ({ rateLimits: { primary: { usedPercent } } });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

async function fixture(t, saved) {
  const threads = new Map(), rpc = new EventEmitter(), reads = [], commands = [], saves = [];
  rpc.ready = true; rpc.close = () => {};
  rpc.call = async (method, params) => {
    reads.push({ method, params });
    const thread = threads.get(params.threadId) || interruptedThread(params.threadId);
    if (method === 'thread/read') return { thread: structuredClone(params.includeTurns ? thread : { ...thread, turns: [] }) };
    if (method === 'thread/turns/list') return { data: structuredClone(thread.turns.slice(-1)), nextCursor: null };
    throw new Error('Unexpected fixture RPC');
  };
  const sender = new QueueSender({ binary: 'mock-codex', run: async (_binary, args) => { commands.push(args); return `Queued message ${firstId}`; } });
  const m = new Manager(rpc, { load: () => saved && structuredClone(saved), save: state => { validateState(state); saves.push(structuredClone(state)); } }, { demo: true, wakeSender: sender });
  m.connection.status = 'connected'; t.after(() => m.stop());
  const task = saved ? m.state.tasks[0] : await m.importThread(firstId, 'Keep this local note', 'Custom continuation');
  if (!saved) await m.action(task.id, 'resume');
  const recover = async () => { m.setQuota(quota(100)); await m.tick(); m.setQuota(quota(0)); await m.tick(); };
  return { m, task, threads, rpc, reads, commands, saves, sender, recover, sent: () => commands.filter(args => args.includes('--message')) };
}

test('reply recognition requires the latest instruction to have a finished final reply', () => {
  const done = completed();
  assert.equal(turnReplyState(done), 'complete');
  for (const phase of [null, undefined]) assert.equal(turnReplyState({ ...done, items: [user('u'), { ...answer(), phase }] }), 'complete');
  for (const status of ['failed', 'interrupted']) assert.equal(turnReplyState({ ...done, status }), 'incomplete');
  assert.equal(turnReplyState({ ...done, status: 'inProgress' }), 'active');
  assert.equal(turnReplyState({ ...done, items: [user('u'), answer('commentary')] }), 'incomplete');
  assert.equal(turnReplyState({ ...done, items: [user('u'), { ...answer(), text: ' \n ' }] }), 'incomplete');
  assert.equal(turnReplyState({ ...done, items: [...done.items, user('newer-instruction')] }), 'incomplete');
  for (const turn of [null, {}, { ...done, status: 'future-status' }, { ...done, items: null }, { ...done, items: [null] }, { ...done, itemsView: 'summary' }, { ...done, items: [user('u'), answer('future-phase')] }]) {
    assert.equal(turnReplyState(turn), 'unknown');
  }
});

test('one recovered account skips completed chats and sends only to unfinished chats', async t => {
  const f = await fixture(t), other = await f.m.importThread(secondId, 'Other note', 'Only unfinished');
  await f.m.action(other.id, 'resume');
  f.threads.set(firstId, interruptedThread(firstId, { turns: [completed()] }));
  await f.recover();
  assert.deepEqual(f.sent().map(args => [args[2], args[4]]), [[secondId, 'Only unfinished']]);
  assert.equal(f.task.sentCount, 0); assert.equal(f.task.status, 'monitoring'); assert.equal(f.task.continuous, true);
  assert.equal(f.task.wake.armed, false); assert.equal(f.task.wake.delivery, 'idle');
  assert.equal(f.task.note, 'Keep this local note'); assert.equal(f.task.continuationMessage, 'Custom continuation');
  assert.match(f.task.activity, /完整回复.*跳过/);
  assert.ok(f.m.state.logs.every(log => !log.message.includes(answer().text)));
  assert.ok(!JSON.stringify(f.saves).includes(answer().text), 'Inspected reply bodies are never retained');
  await f.m.tick(); assert.equal(f.sent().length, 1, 'Skipped recovery is consumed, not retried every tick');
});

test('old complete replies do not suppress a newer instruction interrupted by quota', async t => {
  const f = await fixture(t), latest = interruptedThread(firstId).turns[0];
  f.threads.set(firstId, interruptedThread(firstId, { turns: [completed(), latest] }));
  await f.recover(); assert.equal(f.sent().length, 1); assert.equal(f.task.sentCount, 1);
  assert.equal(f.sent()[0].at(-1), 'Custom continuation');
});

test('a skipped reply remains skipped after restart and future instructions can still recover', async t => {
  const f = await fixture(t); f.threads.set(firstId, interruptedThread(firstId, { turns: [completed()] }));
  await f.recover(); const restored = await fixture(t, f.saves.at(-1));
  restored.threads.set(firstId, interruptedThread(firstId, { turns: [completed()] }));
  restored.m.setQuota(quota(0)); await restored.m.tick(); assert.equal(restored.sent().length, 0);
  await restored.recover(); assert.equal(restored.sent().length, 0);
  restored.threads.set(firstId, interruptedThread(firstId));
  await restored.recover(); assert.equal(restored.sent().length, 1); assert.equal(restored.task.sentCount, 1);
});

test('active replies wait and are skipped if they finish before the retry', async t => {
  const f = await fixture(t), thread = interruptedThread(firstId, { status: { type: 'active' } });
  f.threads.set(firstId, thread); await f.recover();
  assert.equal(f.sent().length, 0); assert.equal(f.commands.length, 0);
  assert.equal(f.task.wake.delivery, 'pending'); assert.equal(f.task.waitReason, 'thread');
  const readCount = f.reads.length; await f.m.tick(); assert.equal(f.reads.length, readCount, 'Waits for retry deadline');
  thread.status.type = 'idle'; thread.turns = [completed()]; f.task.retryAt = 0;
  await f.m.tick(); assert.equal(f.sent().length, 0); assert.equal(f.task.wake.delivery, 'idle');
});

test('unknown history and RPC errors defer only that chat and preserve its pending recovery', async t => {
  for (const scenario of ['error', 'missing', 'empty', 'partial', 'wrong-chat']) {
    const f = await fixture(t), original = f.rpc.call;
    f.rpc.call = async (method, params) => {
      if (!params.includeTurns) return original(method, params);
      if (scenario === 'error') throw new Error('private RPC diagnostic');
      const thread = interruptedThread(firstId);
      if (scenario === 'missing') delete thread.turns;
      if (scenario === 'empty') thread.turns = [];
      if (scenario === 'partial') thread.turns[0].itemsView = 'summary';
      if (scenario === 'wrong-chat') thread.id = secondId;
      return { thread };
    };
    await f.recover(); assert.equal(f.sent().length, 0, scenario); assert.equal(f.task.sentCount, 0);
    assert.equal(f.task.wake.armed, true); assert.equal(f.task.wake.delivery, 'pending'); assert.equal(f.task.waitReason, 'thread');
    assert.match(f.task.activity, /无法确认/); assert.ok(!JSON.stringify(f.m.state).includes('private RPC diagnostic'));
    f.rpc.call = original; f.task.retryAt = 0; await f.m.tick(); assert.equal(f.sent().length, 1, scenario);
  }
});

test('paginated history requests only the newest full turn and never hydrates all history', async t => {
  const f = await fixture(t);
  f.threads.set(firstId, interruptedThread(firstId, { historyMode: 'paginated', turns: [completed(), interruptedThread(firstId).turns[0]] }));
  await f.recover(); assert.equal(f.sent().length, 1);
  const pages = f.reads.filter(call => call.method === 'thread/turns/list'); assert.equal(pages.length, 2);
  for (const call of pages) assert.deepEqual(call.params, { threadId: firstId, limit: 1, sortDirection: 'desc', itemsView: 'full' });
  assert.ok(f.reads.every(call => call.params.includeTurns !== true));
  f.threads.get(firstId).turns.push(completed()); await f.recover(); assert.equal(f.sent().length, 1);
});

test('a final reply arriving during the queue probe prevents enqueueing and clears the outbox claim', async t => {
  const f = await fixture(t), probe = deferred(), entered = deferred();
  f.sender.run = async (_binary, args) => { f.commands.push(args); if (args.includes('--help')) { entered.resolve(); await probe.promise; } return ''; };
  f.m.setQuota(quota(100)); await f.m.tick(); f.m.setQuota(quota(0));
  const tick = f.m.tick(); await entered.promise;
  assert.equal(f.saves.at(-1).tasks[0].wake.delivery, 'sending');
  f.threads.set(firstId, interruptedThread(firstId, { turns: [completed()] })); probe.resolve(); await tick;
  assert.equal(f.sent().length, 0); assert.equal(f.task.sentCount, 0); assert.equal(f.task.wake.delivery, 'idle');
  assert.equal(f.task.status, 'monitoring'); assert.equal(f.m.wakeExecutions.size, 0);
});

test('reply inspection cannot send after pause, global disable/enable, stale quota or disconnect', async t => {
  for (const change of ['pause', 'toggle', 'stale', 'disconnect', 'limit']) {
    const f = await fixture(t), original = f.rpc.call, read = deferred(), entered = deferred();
    f.rpc.call = async (method, params) => { if (params.includeTurns) { entered.resolve(); return read.promise; } return original(method, params); };
    f.m.setQuota(quota(100)); await f.m.tick(); f.m.setQuota(quota(0));
    const tick = f.m.tick(); await entered.promise;
    if (change === 'pause') await f.m.action(f.task.id, 'pause');
    if (change === 'toggle') { f.m.updateSettings({ enabled: false }); f.m.updateSettings({ enabled: true }); }
    if (change === 'stale') f.m.wakeSampledAt -= 90001;
    if (change === 'disconnect') f.rpc.emit('disconnect', 'Fixture disconnect');
    if (change === 'limit') { f.task.sentCount = 1; f.m.updateSettings({ maxWakeSends: 1 }); }
    read.resolve({ thread: interruptedThread(firstId) }); await tick;
    assert.equal(f.sent().length, 0, change); assert.equal(f.task.sentCount, change === 'limit' ? 1 : 0); assert.equal(f.m.wakeExecutions.size, 0);
    if (change === 'limit') { assert.equal(f.task.wake.delivery, 'idle'); assert.equal(f.task.wake.armed, false); }
  }
});

test('reply recheck failures after a successful probe are retryable, never uncertain delivery', async t => {
  const f = await fixture(t); f.sender.run = async (_binary, args) => {
    f.commands.push(args); if (args.includes('--help')) f.threads.set(firstId, interruptedThread(firstId, { turns: [] })); return '';
  };
  await f.recover(); assert.equal(f.sent().length, 0); assert.equal(f.task.wake.delivery, 'pending');
  assert.equal(f.task.waitReason, 'thread'); assert.equal(f.task.status, 'waiting');
});

test('reply guard guidance and skipped/waiting activity carry English message contracts', async tcase => {
  tcase.after(() => setLanguage('zh')); setLanguage('en');
  assert.match(wakeExplanation, /complete reply/); assert.doesNotMatch(wakeExplanation, /[\p{Script=Han}]/u);
  for (const thread of [interruptedThread(firstId, { turns: [completed()] }), interruptedThread(firstId, { status: { type: 'active' } }), interruptedThread(firstId, { turns: [] })]) {
    const f = await fixture(tcase); f.threads.set(firstId, thread); await f.recover();
    assert.ok(f.task.activityMessage);
    assert.doesNotMatch(systemText(f.task.activity, f.task.activityMessage), /[\p{Script=Han}]/u);
    const log = f.m.state.logs.find(item => item.taskId === f.task.id && item.messageInfo?.id === 'log.task_activity');
    assert.ok(log); assert.doesNotMatch(systemText(log), /[\p{Script=Han}]/u);
  }
});

test('unknown runtime states never grant permission to enqueue', async () => {
  for (const status of [{ type: 'systemError' }, { type: 'future' }, undefined]) {
    const rpc = { call: async () => ({ thread: interruptedThread(firstId, { status }) }) };
    assert.equal(await readThreadReply(rpc, firstId), 'unknown');
  }
});
