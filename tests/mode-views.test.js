import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { taskMode, wakeExplanation } from '../public/task-mode.js';
import { widgetView } from './fixtures/widget-view.js';
import { t as tr, defaultContinuation, systemText } from '../public/i18n.js';

const settings = { enabled: true, pollSeconds: 90, minimumRemaining: 5, maxRounds: 2, maxWakeSends: 5 };
const escape = value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function productionFunction(file, name) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const firstLine = source.indexOf('\n', start), multi = source.slice(start, firstLine).trim().endsWith('{');
  const end = multi ? source.indexOf('\n}', firstLine) + 2 : firstLine;
  assert.ok(end > start);
  return source.slice(start, end);
}

test('browser settings render both limits and expose no polling option over 90 seconds', () => {
  const code = productionFunction('../public/app.js', 'settings');
  const html = runInNewContext(`${code}; settings()`, { tr, state: { settings, connection: { status: 'connected' } }, esc: escape, heading: () => '', toggle: () => '' });
  assert.match(html, /name="maxWakeSends"[^>]*value="5"/);
  assert.match(html, /name="maxRounds"[^>]*value="2"/);
  const options = [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
  assert.ok(options.includes(90)); assert.ok(options.every(n => n >= 10 && n <= 90));
});

for (const [file, name] of [['../public/app.js', 'renderDetail'], ['../public/widget.js', 'detail']]) {
  test(`${file} renders monitor notes and send counts without claiming external progress or completion`, () => {
    const body = {}, title = {}, task = { id: 'task', name: 'Monitor', mode: 'quota-wake', cwd: 'E:\\fixture', note: '<private>', continuationMessage: '<custom>\n先验证测试', sentCount: 3, status: 'paused', activity: 'Paused', threadId: 'thread', plan: [{ step: 'Obsolete plan', status: 'completed' }], output: 'Obsolete output' };
    const context = { tr, defaultContinuation, systemText, state: { settings, tasks: [task] }, taskDetails: { read: value => value }, taskMode, wakeExplanation, esc: escape, active: [], taskLabel: () => '已暂停', modalHead: () => '', badge: () => '', icon: () => '', $: selector => selector === '#modal-title' ? title : body };
    runInNewContext(`${productionFunction(file, name)}; ${name}('task')`, context);
    assert.match(body.innerHTML, /监测备注.*&lt;private&gt;/);
    assert.match(body.innerHTML, /续作消息.*&lt;custom&gt;\n先验证测试/);
    assert.match(body.innerHTML, /已排队发送 3 \/ 5 次/);
    assert.match(body.innerHTML, /结束监测并移除/);
    assert.match(body.innerHTML, /不读取原聊天进度或完成状态/);
    assert.doesNotMatch(body.innerHTML, /标记完成|Obsolete plan|Obsolete output/);
  });
}

test('browser homepage cards show escaped notes and distinguish long-note previews from task progress', () => {
  const task = { id: 'task', mode: 'quota-wake', notePreview: '<local>\n第二行…', noteTruncated: true, status: 'paused', sentCount: 0 };
  const html = runInNewContext(`${productionFunction('../public/app.js', 'taskCard')}; taskCard(task)`, {
    tr, systemText, task, state: { settings }, taskMode, esc: escape, icon: () => '', badge: () => '', toggle: () => '', active: [],
  });
  assert.match(html, /监测备注.*&lt;local&gt;\n第二行…/);
  assert.match(html, /更多内容见详情/); assert.match(html, /进度请在原聊天查看/);
  assert.doesNotMatch(html, /<local>/);
});

test('widget homepage receives persisted note previews in the state stream and updates the card', async () => {
  const view = widgetView(); await view.flush();
  const state = { connection: { status: 'connected' }, settings, tasks: [{ id: 'task', mode: 'quota-wake', status: 'paused', name: 'Fixture', notePreview: '<local>\n第二行' }], approvals: [], logs: [] };
  view.message(0, state); await view.flush(); view.desktop({ expanded: true }); await view.flush();
  assert.match(view.element('#tasks').innerHTML, /监测备注.*&lt;local&gt;\n第二行/);
  state.tasks[0].notePreview = '更新后的备注'; view.message(0, state);
  assert.match(view.element('#tasks').innerHTML, /更新后的备注/);
  assert.doesNotMatch(view.element('#tasks').innerHTML, /<local>/);
  view.desktop({ visible: false });
});
