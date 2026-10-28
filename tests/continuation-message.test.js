import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Manager } from '../server/manager.js';
import { QueueSender } from '../server/queue-sender.js';
import { Store, validateState } from '../server/store.js';
import { dispatch, validate } from '../plugin/tools.js';

const threadId = '33333333-3333-4333-8333-333333333333';
const quota = usedPercent => ({ rateLimits: { primary: { usedPercent } } });
function manager(store = { load: () => null, save() {} }) {
  const rpc = new EventEmitter(), calls = [];
  rpc.ready = true; rpc.close = () => {};
  rpc.call = async () => ({ thread: { name: 'Fixture', cwd: 'E:\\fixture' } });
  const sender = new QueueSender({ binary: 'mock-codex', run: async (_binary, args) => { calls.push(args); return `Queued message ${threadId}`; } });
  const m = new Manager(rpc, store, { demo: true, wakeSender: sender });
  m.connection.status = 'connected';
  return { m, calls, async cycle() { m.setQuota(quota(100)); await m.tick(); m.setQuota(quota(0)); await m.tick(); } };
}

test('custom multiline message survives a real isolated store restart and reaches only the selected chat once per recovery', async t => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-message-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); });
  const store = new Store(join(directory, 'state.json'));
  const custom = '优先完成测试，遇到阻塞时说明原因。\n保留 "引号"、`代码`、$() 和 <标签>。';
  const original = manager(store), task = await original.m.importThread(threadId, '只在首页显示的备注', custom);
  await original.cycle(); assert.equal(original.calls.length, 0, 'Import stays paused');
  original.m.stop();
  const restored = manager(store), current = restored.m.state.tasks[0];
  t.after(() => restored.m.stop());
  assert.equal(current.note, task.note); assert.equal(current.continuationMessage, custom);
  await restored.m.action(current.id, 'resume');
  restored.m.setQuota(quota(0)); await restored.m.tick(); assert.equal(restored.calls.length, 0);
  await restored.cycle(); await restored.m.tick();
  assert.deepEqual(restored.calls, [['queue', '--help'], ['queue', '--thread', threadId, '--message', custom]]);
  assert.equal(current.sentCount, 1);
  await restored.cycle(); assert.equal(current.sentCount, 2); assert.equal(restored.calls.at(-1).at(-1), custom);
  assert.ok(restored.calls.every(args => !args.includes(task.note)), 'Notes never enter the queue');
});

test('empty, whitespace and legacy records all send the default continuation', async () => {
  for (const message of ['', ' \r\n\t ', undefined]) {
    const f = manager(), task = await f.m.importThread(threadId, 'Local only', message);
    if (message === undefined) delete task.continuationMessage;
    await f.m.action(task.id, 'resume'); await f.cycle();
    assert.equal(f.calls.at(-1).at(-1), '继续'); assert.equal(task.sentCount, 1); f.m.stop();
  }
});

test('malformed or overlong messages are rejected before import or queue effects and cannot load from storage', async () => {
  const f = manager();
  for (const message of [null, 1, {}, 'x'.repeat(12001)]) {
    await assert.rejects(f.m.importThread(threadId, '', message), /续作消息/);
    await assert.rejects(f.m.wakeSender.send(threadId, { message }), /续作消息/);
    assert.throws(() => validate('continuer_import_session', { threadId, continuationMessage: message }));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.m.state.tasks.length, 0);
  const task = await f.m.importThread(threadId, '', 'x'.repeat(12000));
  validateState(f.m.state);
  task.continuationMessage = null; assert.throws(() => validateState(f.m.state), /续作消息/);
  f.m.stop();
});

test('authenticated homepage summaries include bounded notes while full message remains in details', async () => {
  const f = manager(), note = '<private>\n' + '备注'.repeat(6000);
  const task = await f.m.importThread(threadId, note.slice(0, 12000), 'Custom private message');
  const summary = f.m.snapshot({ details: false }).tasks[0];
  assert.ok(summary.notePreview.startsWith('<private>\n'));
  assert.equal(summary.notePreview.length, 500); assert.equal(summary.noteTruncated, true);
  assert.equal(summary.continuationMessage, undefined); assert.equal(summary.note, undefined);
  assert.equal(f.m.taskSnapshot(task.id).note, task.note);
  assert.equal(f.m.taskSnapshot(task.id).continuationMessage, 'Custom private message');
  f.m.stop();
});

test('MCP forwards custom messages without including private notes or messages in status', async () => {
  let forwarded;
  await dispatch('continuer_import_session', { threadId, note: 'Local note', continuationMessage: 'Custom instruction' }, {
    ensureService: async () => {}, request: async (path, body) => { forwarded = { path, body }; return { tasks: [] }; },
  });
  assert.deepEqual(forwarded, { path: '/api/import', body: { threadId, note: 'Local note', continuationMessage: 'Custom instruction' } });
  const result = await dispatch('continuer_status', {}, { ensureService: async () => ({ tasks: [{ notePreview: 'Local note', continuationMessage: 'Custom instruction' }], approvals: [] }) });
  assert.equal(result.tasks[0].notePreview, undefined); assert.equal(result.tasks[0].continuationMessage, undefined);
});

test('blank continuation follows the current saved language, including changes during an armed recovery', async () => {
  const f = manager(), task = await f.m.importThread(threadId, '本地备注', ' \n\t ');
  await f.m.action(task.id, 'resume');
  f.m.setQuota(quota(100)); await f.m.tick();
  f.m.updateSettings({ language: 'en' });
  f.m.setQuota(quota(0)); await f.m.tick();
  assert.equal(f.calls.at(-1).at(-1), 'Continue');
  f.m.updateSettings({ language: 'zh' }); await f.cycle();
  assert.equal(f.calls.at(-1).at(-1), '继续');
  task.continuationMessage = '继续处理测试；请保留这条自定义消息。';
  f.m.updateSettings({ language: 'en' }); await f.cycle();
  assert.equal(f.calls.at(-1).at(-1), task.continuationMessage);
  assert.equal(task.note, '本地备注'); assert.equal(task.sentCount, 3); f.m.stop();
});

test('language persists independently of scheduling and invalid updates cannot modify policies', async () => {
  let saved;
  const f = manager({ load: () => null, save: state => { saved = structuredClone(state); } });
  f.m.updateSettings({ enabled: false }); f.m.updateSettings({ language: 'en' });
  assert.equal(saved.settings.language, 'en'); assert.equal(saved.settings.enabled, false);
  const restored = manager({ load: () => structuredClone(saved), save() {} });
  assert.equal(restored.m.snapshot({ details: false }).settings.language, 'en');
  assert.equal(restored.m.state.settings.enabled, false);
  const before = structuredClone(restored.m.state.settings);
  for (const language of ['fr', '', null, 1, {}]) {
    assert.throws(() => restored.m.updateSettings({ language, enabled: true, maxWakeSends: 100 }));
    assert.deepEqual(restored.m.state.settings, before);
    assert.throws(() => validateState({ ...saved, settings: { ...saved.settings, language } }));
  }
  delete saved.settings.language; validateState(saved);
  const sender = new QueueSender({ run: async (_binary, args) => { if (args.includes('--message')) assert.equal(args.at(-1), 'Continue'); return ''; } });
  return sender.send(threadId, { message: ' \n ', language: 'en' }).finally(() => { f.m.stop(); restored.m.stop(); });
});
