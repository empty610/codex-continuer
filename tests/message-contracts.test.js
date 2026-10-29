import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { messageCatalog, message, isMessage, formatMessage, boundedMessage, MessageError, setActivity, taskActivityMessage } from '../public/message.js';
import { systemText, staticInterface, setLanguage, setFormError } from '../public/i18n.js';
import { createApiClient } from '../public/api-client.js';
import { TaskDetails } from '../public/task-details.js';
import { ClientError, clientErrorResponse } from '../server/http-policy.js';
import { Manager } from '../server/manager.js';
import { Store } from '../server/store.js';
import { StatePersistence } from '../server/state-persistence.js';
import { compactSummary } from '../server/summary.js';
import { parseOutcome } from '../server/policy.js';

const slots = text => [...new Set([...text.matchAll(/\{([A-Za-z]\w*)\}/g)].map(match => match[1]))].sort();

test('every catalog message has matching parameters and complete translations', () => {
  for (const [id, entry] of Object.entries(messageCatalog)) {
    assert.match(id, /^[a-z]+\.[a-z][a-z0-9_]*$/);
    assert.equal(typeof entry.zh, 'string', id); assert.equal(typeof entry.en, 'string', id);
    assert.ok(entry.zh && entry.en, id); assert.deepEqual(slots(entry.zh), slots(entry.en), id);
    if (id !== 'ui.language_chinese') assert.doesNotMatch(entry.en, /\p{Script=Han}/u, id);
    const params = Object.fromEntries(slots(entry.zh).map(key => [key, '<custom 中文 {value}>']));
    assert.ok(isMessage(message(id, params)), id);
    assert.ok(formatMessage(message(id, params), 'en'), id);
  }
});

test('stable IDs do not depend on Chinese wording or reinterpret interpolated user text', t => {
  t.after(() => setLanguage('zh')); setLanguage('en');
  const entry = messageCatalog['task.running_a_command'], previous = entry.zh;
  t.after(() => { entry.zh = previous; }); entry.zh = '修改过的命令提示';
  assert.equal(formatMessage(message('task.running_a_command'), 'en'), 'Running a command');
  for (const raw of ['正在执行命令', '已添加会话：继续', '中文项目：正在执行命令']) assert.equal(systemText(raw), raw);
  const task = { name: '正在执行命令' }; setActivity(task, message('task.running_a_command'));
  assert.equal(formatMessage(taskActivityMessage(task), 'en'), '正在执行命令: Running a command');
  setActivity(task, '正在执行命令'); assert.equal(task.activityMessage, undefined);
  assert.equal(formatMessage(taskActivityMessage(task), 'en'), '正在执行命令: 正在执行命令');
  task.activityMessage = { id: 'future.message', params: {} };
  assert.equal(formatMessage(taskActivityMessage(task), 'en'), '正在执行命令: 正在执行命令');
});

test('message contracts reject missing, extra and nonserializable parameters and bound nested text', () => {
  for (const info of [
    { id: 'future.message', params: {} }, { id: 'log.chat_added', params: {} },
    { id: 'task.running_a_command', params: null }, { id: 'task.running_a_command', params: false },
    { id: 'log.chat_added', params: { name: 'name', secret: 'unlisted' } },
    { id: 'log.chat_added', params: { name: undefined } }, { id: 'log.chat_added', params: { name: Infinity } },
    { id: 'log.chat_added', params: { name: { raw: 'untyped' } } },
  ]) { assert.equal(isMessage(info), false); assert.equal(boundedMessage(info), undefined); }
  assert.throws(() => message('log.chat_added'), /Invalid message contract/);
  assert.throws(() => message('future.message'), /Invalid message contract/);
  const info = message('log.task_activity', { name: 'n'.repeat(5000), activity: message('task.no_tool_activity', { summary: 's'.repeat(5000) }) });
  const bounded = boundedMessage(info, 180);
  assert.equal(bounded.params.name.length, 180); assert.equal(bounded.params.activity.params.summary.length, 180);
  assert.deepEqual(JSON.parse(JSON.stringify(bounded)), bounded);
  assert.equal(isMessage(JSON.parse(JSON.stringify(message('log.chat_added', { name: undefined })))), true);
  assert.equal(systemText({ message: 'External diagnostic', messageInfo: { id: 'future.message' } }), 'External diagnostic');
});

test('HTTP and shared API preserve error identity across serialization and language changes', async t => {
  t.after(() => setLanguage('zh')); setLanguage('zh');
  const info = message('error.setting_range', { name: 'maxWakeSends', min: 1, max: 100 });
  const response = JSON.parse(JSON.stringify(clientErrorResponse(new ClientError(info))));
  assert.equal(response.error, 'maxWakeSends 必须为 1–100 的整数'); assert.deepEqual(response.errorInfo, info);
  assert.doesNotMatch(JSON.stringify(clientErrorResponse(new Error('private diagnostic'))), /private diagnostic/);
  const api = createApiClient({ request: async () => ({ ok: false, json: async () => response }) });
  const error = await api('/fixture').catch(error => error), node = { dataset: {} };
  assert.ok(error instanceof MessageError); setFormError(node, error); assert.equal(node.textContent, response.error);
  setLanguage('en'); setFormError(node, node.errorSource);
  assert.equal(node.textContent, 'maxWakeSends must be an integer between 1 and 100');
  const legacy = createApiClient({ request: async () => ({ ok: false, json: async () => ({ error: '正在执行命令' }) }) });
  assert.equal(systemText(await legacy('/fixture').catch(error => error)), '正在执行命令');
});

test('static localization follows explicit markers while leaving unmarked content alone', t => {
  t.after(() => setLanguage('zh')); setLanguage('en');
  const text = { nodeType: 3, nodeValue: '文案已修改', isConnected: true }, user = { nodeValue: '加入我的工作' };
  const attributes = new Map([['data-i18n', 'ui.add_to_my_work'], ['data-i18n-title', 'ui.add_to_my_work']]);
  const element = { childNodes: [text], isConnected: true, getAttribute: name => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value) };
  const document = { documentElement: {}, querySelector: () => null, querySelectorAll: selector => ['[data-i18n]', '[data-i18n-title]'].includes(selector) ? [element] : [] };
  const refresh = staticInterface(document); refresh();
  assert.equal(text.nodeValue, 'Add to my work'); assert.equal(attributes.get('title'), 'Add to my work');
  assert.equal(user.nodeValue, '加入我的工作'); assert.equal(document.documentElement.lang, 'en-US');
  setLanguage('zh'); refresh(); assert.equal(text.nodeValue, '加入我的工作');
});

function manager(t, store) {
  const rpc = new EventEmitter(); rpc.ready = true; rpc.close = () => {};
  const result = new Manager(rpc, store, { demo: true }); t.after(() => result.stop()); return result;
}

test('real state storage retains message identity and preserves plain legacy logs after restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'continuer-message-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(join(directory, 'state.json')), original = manager(t, store);
  const task = original.create({ name: '中文任务', cwd: 'E:\\fixture', prompt: 'Local test', continuous: false });
  task.status = 'paused'; setActivity(task, message('task.running_a_command')); task.rounds = 3;
  original.log(taskActivityMessage(task), 'info', task.id); original.log('已添加会话：旧记录'); original.changed();
  original.stop(); const restored = manager(t, new Store(store.file)), saved = restored.state.tasks[0];
  assert.equal(saved.rounds, 3); assert.equal(saved.activity, '正在执行命令');
  assert.deepEqual(saved.activityMessage, task.activityMessage);
  setLanguage('en'); t.after(() => setLanguage('zh'));
  assert.equal(systemText(saved.activity, saved.activityMessage), 'Running a command');
  assert.equal(systemText(restored.state.logs[0]), '已添加会话：旧记录');
  assert.equal(systemText(restored.state.logs[1]), '中文任务: Running a command');
});

test('summary metadata is bounded, complete details retain full parameters and descriptor changes invalidate them', async t => {
  const m = manager(t, { load: () => null, save() {} });
  const task = m.create({ name: 'fixture', cwd: 'E:\\fixture', prompt: 'Local test', continuous: false });
  setActivity(task, message('task.no_tool_activity', { summary: 'x'.repeat(10000) }));
  m.log(taskActivityMessage(task));
  const summary = compactSummary(m.snapshot());
  assert.equal(summary.tasks[0].activityMessage.params.summary.length, 240);
  assert.equal(summary.logs[0].messageInfo.params.activity.params.summary.length, 180);
  assert.ok(!JSON.stringify(summary).includes('x'.repeat(1000)));
  const details = new TaskDetails(async () => ({ task: m.taskSnapshot(task) }), () => {});
  details.read(summary.tasks[0]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(details.read(summary.tasks[0]).activityMessage.params.summary.length, 2600);
  const revision = m.taskSnapshot(task).detailRevision;
  task.activityMessage = message('task.plan_updated');
  assert.ok(m.taskSnapshot(task).detailRevision > revision);
});

test('a later untyped persistence error clears earlier message metadata', () => {
  const storage = new StatePersistence({ load: () => null, save() {} }, () => {}); storage.load();
  storage.fail(new MessageError(message('error.storage_missing')));
  assert.ok(storage.status.messageInfo);
  storage.fail(new Error('External filesystem diagnostic'));
  assert.equal(storage.status.messageInfo, undefined); assert.equal(systemText(storage.status), 'External filesystem diagnostic');
});

test('connection refresh retains owned statuses and RPC errors but preserves external diagnostics', async t => {
  t.after(() => setLanguage('zh')); setLanguage('en');
  const m = manager(t, { load: () => null, save() {} }); m.state.settings.enabled = false;
  m.rpc.connect = async () => {}; m.rpc.call = async () => ({});
  await m.refresh(); assert.equal(systemText(m.connection), 'Demo data · No real tasks are run');
  m.demo = false; await m.refresh(); assert.equal(systemText(m.connection), 'Codex App Server connected');
  m.rpc.call = async () => { throw new MessageError(message('error.codex_disconnected')); };
  await m.refresh(); assert.ok(m.connection.messageInfo); assert.equal(systemText(m.connection), 'Codex is not connected');
  m.rpc.call = async () => { throw new Error('Codex 未连接'); };
  await m.refresh(); assert.equal(m.connection.messageInfo, undefined); assert.equal(systemText(m.connection), 'Codex 未连接');
});

test('missing outcomes localize the service fallback while valid model summaries retain their original text', t => {
  t.after(() => setLanguage('zh')); setLanguage('en');
  const fallback = parseOutcome('Incomplete JSON'), task = {};
  setActivity(task, fallback.summaryMessage || fallback.summary);
  assert.equal(task.activityMessage.id, 'task.outcome_missing'); assert.doesNotMatch(systemText(task.activity, task.activityMessage), /\p{Script=Han}/u);
  const model = parseOutcome(JSON.stringify({ status: 'blocked', summary: fallback.summary }));
  setActivity(task, model.summaryMessage || model.summary);
  assert.equal(task.activityMessage, undefined); assert.equal(systemText(task.activity), fallback.summary);
});
