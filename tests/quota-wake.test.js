import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';
import { QueueSender } from '../server/queue-sender.js';

const threadId = '01a16385-26c1-79e3-a661-09e3fc8ed62e';
const sample = (used, secondary = 10) => ({ rateLimits: { primary: { usedPercent: used }, secondary: { usedPercent: secondary } } });
async function setup(saved, send) {
  const rpc = new EventEmitter(); rpc.ready = true; rpc.calls = [];
  rpc.call = async (method, params) => { rpc.calls.push(method); return { thread: { id: params?.threadId, name: 'Original', cwd: 'E:\\project' } }; };
  const sends = []; const saves = [];
  const m = new Manager(rpc, { load: () => saved && structuredClone(saved), save: s => saves.push(structuredClone(s)) }, { demo: true, wakeSender: { send: send || (async id => { sends.push(id); return { queueId: 'queued' }; }) } });
  m.connection.status = 'connected';
  const t = saved ? m.state.tasks[0] : await m.importThread(threadId, 'Original goal');
  if (!saved) await m.action(t.id, 'continuous', true);
  return { m, t, sends, saves, rpc };
}

test('enabling with healthy or merely low quota does not send or take ownership', async () => {
  const { m, t, sends, rpc } = await setup();
  for (const used of [10, 96, 99, 0]) { m.setQuota(sample(used)); await m.tick(); }
  assert.equal(t.status, 'monitoring'); assert.deepEqual(sends, []);
  assert.deepEqual(rpc.calls, ['thread/read']);
});

test('confirmed exhaustion and fresh recovery enqueue exactly once despite overlapping ticks', async () => {
  const { m, t, sends } = await setup();
  m.setQuota(sample(100)); await m.tick(); const episode = t.wake.episodeId;
  m.setQuota(sample(100)); await m.tick(); assert.equal(t.wake.episodeId, episode);
  m.setQuota(sample(0)); await Promise.all([m.tick(), m.tick(), m.tick()]); await m.tick();
  assert.deepEqual(sends, [threadId]); assert.equal(t.wake.delivery, 'sent'); assert.equal(t.wake.queueId, 'queued');
  assert.equal(t.sentCount, 1); assert.equal(t.status, 'monitoring');
  m.setQuota(sample(100)); await m.tick(); assert.notEqual(t.wake.episodeId, episode);
  m.setQuota(sample(0)); await m.tick(); assert.equal(sends.length, 2);
});

test('secondary exhaustion, unknown/stale samples and quota events cannot grant recovery', async () => {
  const { m, t, sends } = await setup();
  m.setQuota(sample(0, 100)); await m.tick(); assert.equal(t.wake.armed, true);
  m.setQuota(sample(0)); m.wakeSampledAt = Date.now() - 91000; await m.tick();
  m.event({ method: 'account/rateLimits/updated', params: sample(0) }); await m.tick();
  assert.deepEqual(sends, []);
  m.setQuota({}); await m.tick(); assert.deepEqual(sends, []);
  m.setQuota(sample(0)); await m.tick(); assert.equal(sends.length, 1);
});

test('minimum remaining applies after exhaustion; reset timestamps alone are insufficient', async () => {
  const { m, sends } = await setup();
  const exhausted = sample(100); exhausted.rateLimits.primary.resetsAt = 1;
  m.setQuota(exhausted); await m.tick();
  m.setQuota(sample(99)); await m.tick(); assert.equal(sends.length, 0);
  m.setQuota(sample(95)); await m.tick(); assert.equal(sends.length, 1);
});

test('pause, continuous off, global off and completion prevent automatic messages', async () => {
  for (const action of ['pause', 'continuous', 'complete', 'global']) {
    const { m, t, sends } = await setup(); m.setQuota(sample(100)); await m.tick();
    if (action === 'global') m.updateSettings({ enabled: false }); else await m.action(t.id, action, false);
    m.setQuota(sample(0)); await m.tick(); assert.equal(sends.length, 0, action);
  }
});

test('pending exhaustion survives restart, acknowledged messages are not replayed', async () => {
  const { m } = await setup(); m.setQuota(sample(100)); await m.tick();
  const restored = await setup(m.state); restored.m.setQuota(sample(0)); await restored.m.tick();
  assert.equal(restored.sends.length, 1);
  const again = await setup(restored.m.state); again.m.setQuota(sample(0)); await again.m.tick(); assert.equal(again.sends.length, 0);
});

test('outbox is persisted before dispatch, crash or uncertain result never silently retries', async () => {
  let inspect;
  const fixture = await setup(null, async () => { inspect(); throw new Error('timeout after dispatch'); });
  const { m, t, saves } = fixture;
  inspect = () => assert.equal(saves.at(-1).tasks[0].wake.delivery, 'sending');
  m.setQuota(sample(100)); await m.tick(); const saved = structuredClone(m.state);
  saved.tasks[0].wake.delivery = 'sending';
  const crash = await setup(saved); crash.m.setQuota(sample(0)); await crash.m.tick();
  assert.equal(crash.t.status, 'blocked'); assert.equal(crash.sends.length, 0);
  m.setQuota(sample(0)); await m.tick(); assert.equal(t.status, 'blocked');
  await m.tick(); assert.equal(t.wake.delivery, 'uncertain');
});

test('preflight failure retries with backoff; repeating enable does not clear an armed episode', async () => {
  let calls = 0;
  const { m, t } = await setup(null, async () => { calls++; throw Object.assign(new Error('no queue binary'), { safeToRetry: true }); });
  m.setQuota(sample(100)); await m.tick(); const episode = t.wake.episodeId;
  await m.action(t.id, 'continuous', true); assert.equal(t.wake.episodeId, episode);
  m.setQuota(sample(0)); await m.tick(); await m.tick(); assert.equal(calls, 1);
  assert.equal(t.waitReason, 'desktop'); assert.equal(t.wake.delivery, 'pending');
});

test('legacy writer wait migrates to monitoring without fabricating an exhaustion event', async () => {
  const { m, t } = await setup(); delete t.mode; delete t.wake;
  t.status = 'waiting'; t.waitReason = 'writer';
  const restored = await setup(m.state); restored.m.setQuota(sample(0)); await restored.m.tick();
  assert.equal(restored.t.mode, 'quota-wake'); assert.equal(restored.t.status, 'monitoring'); assert.equal(restored.sends.length, 0);
});

test('queue sender uses argument arrays and the exact continuation text without permission overrides', async () => {
  const calls = [];
  const sender = new QueueSender({ binary: 'desktop-codex', run: async (...args) => { calls.push(args); return `Queued message ${threadId}`; } });
  assert.deepEqual(await sender.send(threadId), { queueId: threadId });
  assert.deepEqual(calls, [['desktop-codex', ['queue', '--help']], ['desktop-codex', ['queue', '--thread', threadId, '--message', '继续']]]);
  await assert.rejects(sender.send('bad;id'));
});

test('pause during queue capability probe cancels before the message side effect', async () => {
  let allowed = true; const calls = [];
  const sender = new QueueSender({ binary: 'codex', run: async (_b, args) => { calls.push(args); allowed = false; } });
  await assert.rejects(sender.send(threadId, { shouldSend: () => allowed }), e => e.cancelled);
  assert.equal(calls.length, 1);
});
