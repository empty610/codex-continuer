import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';
import { quotaAvailable, MAX_POLL_SECONDS } from '../server/policy.js';
import { validate, tools, dispatch } from '../plugin/tools.js';
import { taskMode, wakeExplanation } from '../public/task-mode.js';

const threadId = '11111111-1111-4111-8111-111111111111';
const quota = usedPercent => ({ rateLimits: { primary: { usedPercent } } });
function fixture(saved, send) {
  const rpc = new EventEmitter(), saves = [], sent = [];
  rpc.ready = true; rpc.close = () => {}; rpc.connect = async () => {};
  rpc.call = async (method, params) => method === 'account/rateLimits/read' ? quota(0) : { thread: { id: params?.threadId, name: 'Original', cwd: 'E:\\fixture' } };
  const m = new Manager(rpc, { load: () => saved && structuredClone(saved), save: state => saves.push(structuredClone(state)) }, { demo: true, wakeSender: { send: send || (async id => { sent.push(id); return { queueId: 'fixture' }; }) } });
  m.connection.status = 'connected';
  const cycle = async () => { m.setQuota(quota(100)); await m.tick(); m.setQuota(quota(0)); await m.tick(); };
  return { m, rpc, saves, sent, cycle };
}

test('backend accepts 90 seconds while MCP cannot change execution policies', () => {
  const { m } = fixture();
  m.updateSettings({ pollSeconds: 90, maxWakeSends: 1 });
  assert.throws(() => validate('continuer_update_settings', { pollSeconds: 90, maxWakeSends: 1 }));
  const before = structuredClone(m.state.settings);
  for (const input of [{ pollSeconds: 91 }, { pollSeconds: 300 }, { pollSeconds: 9 }, { pollSeconds: 90.1 }, { maxWakeSends: 0 }, { maxWakeSends: 101 }]) {
    assert.throws(() => m.updateSettings({ enabled: false, ...input }));
    assert.throws(() => validate('continuer_update_settings', input));
    assert.deepEqual(m.state.settings, before);
  }
  assert.equal(MAX_POLL_SECONDS, 90);
  assert.deepEqual(Object.keys(tools.find(t => t.name === 'continuer_update_settings').inputSchema.properties), ['enabled']);
});

test('legacy polling values shrink to 90 and migration is saved without enabling scheduling', () => {
  const f = fixture(); f.m.state.settings.pollSeconds = 300; f.m.state.settings.enabled = false;
  delete f.m.state.settings.maxWakeSends; f.m.state.settings.maxRounds = 3;
  const restored = fixture(f.m.state);
  assert.equal(restored.m.state.settings.pollSeconds, 90);
  assert.equal(restored.m.state.settings.maxWakeSends, 3);
  assert.equal(restored.m.state.settings.enabled, false);
  assert.deepEqual(restored.saves.at(-1), restored.m.state);
  const again = fixture(restored.m.state); assert.equal(again.saves.length, 0);
});

test('90 second polling refreshes at the deadline and still refuses samples beyond 90 seconds', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000000 });
  const { m } = fixture(); m.updateSettings({ pollSeconds: 90 });
  let refreshes = 0;
  m.refresh = async () => { refreshes++; m.setQuota(quota(0)); };
  m.start(); assert.equal(refreshes, 1);
  t.mock.timers.tick(89000); assert.equal(refreshes, 1);
  t.mock.timers.tick(1000); assert.equal(refreshes, 2);
  assert.equal(quotaAvailable(quota(0), Date.now() - 90001), false);
  m.stop();
});

test('monitor imports allow optional local notes and legacy prompt becomes a note on migration', async () => {
  const f = fixture(); const task = await f.m.importThread(threadId);
  assert.equal(task.note, ''); assert.equal(task.prompt, undefined); assert.equal(task.rounds, undefined);
  assert.equal(task.sentCount, 0); assert.equal(task.continuous, false);
  delete task.note; delete task.sentCount; task.prompt = 'Legacy goal'; task.rounds = 2; task.plan = [{ status: 'completed' }];
  const restored = fixture(f.m.state), current = restored.m.state.tasks[0];
  assert.equal(current.note, 'Legacy goal'); assert.equal(current.sentCount, 2);
  assert.equal(current.prompt, undefined); assert.equal(current.rounds, undefined);
  assert.equal(restored.m.snapshot().tasks[0].progress, null);
  assert.deepEqual(restored.saves.at(-1), restored.m.state);
});

test('one-send limit is independent of direct rounds and repeated recovery cannot exceed it', async () => {
  const f = fixture(); f.m.updateSettings({ maxRounds: 100, maxWakeSends: 1 });
  const task = await f.m.importThread(threadId, 'Local note'); await f.m.action(task.id, 'resume');
  await f.cycle(); await f.cycle();
  assert.deepEqual(f.sent, [threadId]); assert.equal(task.sentCount, 1);
  assert.equal(task.status, 'paused'); assert.equal(task.waitReason, 'send-limit'); assert.equal(task.continuous, false);
  for (const action of ['resume', 'continuous']) await assert.rejects(f.m.action(task.id, action, true), /上限/);
  assert.equal(task.sentCount, 1); assert.ok(f.m.state.tasks.includes(task));
  assert.doesNotMatch(task.activity, /目标已完成/);
});

test('pause, resume and restart retain counts; raising a limit requires explicit monitoring enable', async () => {
  const f = fixture(); f.m.updateSettings({ maxRounds: 1, maxWakeSends: 2 });
  const task = await f.m.importThread(threadId); await f.m.action(task.id, 'resume'); await f.cycle();
  await f.m.action(task.id, 'pause'); await f.m.action(task.id, 'resume'); assert.equal(task.sentCount, 1);
  const restored = fixture(f.m.state); await restored.cycle();
  const current = restored.m.state.tasks[0]; assert.equal(current.sentCount, 2); assert.equal(current.status, 'paused');
  restored.m.updateSettings({ maxWakeSends: 3 }); await restored.cycle();
  assert.equal(restored.sent.length, 1); assert.equal(current.continuous, false);
  await restored.m.action(current.id, 'resume'); await restored.cycle();
  assert.equal(current.sentCount, 3); assert.equal(restored.sent.length, 2); assert.equal(current.continuous, false);
});

test('lowering a send limit cancels an armed recovery immediately', async () => {
  const f = fixture(); const task = await f.m.importThread(threadId); await f.m.action(task.id, 'resume');
  await f.cycle(); f.m.setQuota(quota(100)); await f.m.tick(); assert.equal(task.wake.armed, true);
  f.m.updateSettings({ maxWakeSends: 1 }); f.m.setQuota(quota(0)); await f.m.tick();
  assert.equal(task.continuous, false); assert.equal(task.wake.armed, false); assert.equal(f.sent.length, 1);
});

test('preflight rechecks the current cap before queueing and cancellation does not count', async () => {
  let release, check;
  const f = fixture(null, async (_id, { shouldSend }) => {
    check = shouldSend; await new Promise(resolve => { release = resolve; });
    if (!shouldSend()) throw Object.assign(new Error('cancelled before queue'), { cancelled: true });
    return {};
  });
  const task = await f.m.importThread(threadId); task.sentCount = 1; await f.m.action(task.id, 'resume');
  f.m.setQuota(quota(100)); await f.m.tick(); f.m.setQuota(quota(0)); const pending = f.m.tick();
  assert.equal(check(), true); f.m.updateSettings({ maxWakeSends: 1 }); assert.equal(check(), false);
  release(); await pending; assert.equal(task.sentCount, 1); assert.equal(task.status, 'paused');
});

test('quota must remain fresh before the queue side effect', async () => {
  let release, check;
  const f = fixture(null, async (_id, { shouldSend }) => {
    check = shouldSend; await new Promise(resolve => { release = resolve; });
    if (!shouldSend()) throw Object.assign(new Error('stale quota'), { cancelled: true });
    return {};
  });
  const task = await f.m.importThread(threadId); await f.m.action(task.id, 'resume');
  f.m.setQuota(quota(100)); await f.m.tick(); f.m.setQuota(quota(0)); const pending = f.m.tick();
  f.m.wakeSampledAt -= 90001; assert.equal(check(), false); release(); await pending;
  assert.equal(task.sentCount, 0);
});

test('unknown delivery never counts as confirmed or as completed work', async () => {
  const f = fixture(null, async () => { throw Error('unknown result'); });
  const task = await f.m.importThread(threadId); await f.m.action(task.id, 'resume'); await f.cycle();
  assert.equal(task.sentCount, 0); assert.equal(task.wake.delivery, 'uncertain'); assert.equal(task.status, 'blocked');
  f.m.updateSettings({ maxWakeSends: 1 }); assert.equal(task.status, 'blocked');
});

test('ending monitoring removes only the record and records no claim of project completion', async () => {
  const f = fixture(); const task = await f.m.importThread(threadId); await f.m.action(task.id, 'resume');
  await f.m.action(task.id, 'complete'); await f.cycle();
  assert.equal(f.m.state.tasks.length, 0); assert.equal(f.sent.length, 0);
  assert.match(f.m.state.logs[0].message, /已结束监测/); assert.match(f.m.state.logs[0].message, /原聊天确认/);
});

test('mode presentation distinguishes notes, counters, progress and end-monitoring actions', () => {
  const settings = { maxRounds: 2, maxWakeSends: 5 };
  const wake = taskMode({ mode: 'quota-wake', note: 'Local', sentCount: 3 }, settings);
  assert.match(wake.description, /监测备注.*仅本地/); assert.match(wake.counter, /3 \/ 5 次/);
  assert.equal(wake.complete, '结束监测并移除'); assert.equal(wake.resume, '开启监测'); assert.match(wake.progress, /原聊天/);
  const direct = taskMode({ prompt: 'Real execution goal', rounds: 1 }, settings);
  assert.equal(direct.description, 'Real execution goal'); assert.match(direct.counter, /1 \/ 2 轮/); assert.equal(direct.complete, '标记完成');
  assert.match(wakeExplanation, /备注不发送/); assert.match(wakeExplanation, /不读取.*完成状态/);
});

test('MCP allows optional notes, rejects ambiguous fields and returns separate send counters privately', async () => {
  for (const input of [{ threadId }, { threadId, note: '' }, { threadId, note: 'Local' }, { threadId, prompt: 'Legacy note' }]) validate('continuer_import_session', input);
  assert.throws(() => validate('continuer_import_session', { threadId, note: 'a', prompt: 'b' }));
  const result = await dispatch('continuer_status', {}, { ensureService: async () => {}, request: async () => ({ tasks: [{ mode: 'quota-wake', sentCount: 2, note: 'Private', prompt: 'Private', output: 'Private' }], approvals: [] }) });
  assert.equal(result.tasks[0].sentCount, 2); assert.equal(result.tasks[0].note, undefined); assert.equal(result.tasks[0].prompt, undefined);
});
