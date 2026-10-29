import test from 'node:test';
import assert from 'node:assert/strict';
import { continuationEditor } from '../public/task-mode.js';
import { widgetView, pageView } from './fixtures/widget-view.js';
import { setLanguage } from '../public/i18n.js';

const settings = { enabled: true, pollSeconds: 90, minimumRemaining: 5, maxRounds: 2, maxWakeSends: 5 };
const escape = value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
test('browser settings render both limits and expose no polling option over 90 seconds', async () => {
  const view = pageView(); await view.flush();
  view.message(0, { settings, tasks: [], connection: { status: 'connected' }, approvals: [], logs: [] });
  await view.page('settings');
  const html = view.element('#main').innerHTML;
  assert.match(html, /name="maxWakeSends"[^>]*value="5"/);
  assert.match(html, /name="maxRounds"[^>]*value="2"/);
  const options = [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
  assert.ok(options.includes(90)); assert.ok(options.every(n => n >= 10 && n <= 90));
  view.visible(false);
});

for (const [name, createView] of [['page', pageView], ['widget', widgetView]]) {
  test(`${name} renders monitor notes and send counts without claiming external progress or completion`, async () => {
    const task = { id: 'task', name: 'Monitor', mode: 'quota-wake', cwd: 'E:\\fixture', note: '<private>', continuationMessage: '<custom>\n先验证测试', sentCount: 3, status: 'paused', activity: 'Paused', threadId: 'thread', plan: [{ step: 'Obsolete plan', status: 'completed' }], output: 'Obsolete output' };
    const view = createView({ task: async () => ({ task }) }); await view.flush();
    view.message(0, { settings, tasks: [task], connection: { status: 'connected' }, approvals: [], logs: [] });
    await view.action('detail', task.id); await view.flush();
    const html = view.element('#modal-body').innerHTML;
    assert.match(html, /监测备注.*&lt;private&gt;/);
    assert.match(html, /续作消息.*&lt;custom&gt;\n先验证测试/);
    assert.match(html, /data-action="edit-message"/);
    assert.match(html, /已排队发送 3 \/ 5 次/);
    assert.match(html, /结束监测并移除/);
    assert.match(html, /上次指令后已有完整回复则跳过/);
    assert.doesNotMatch(html, /标记完成|Obsolete plan|Obsolete output/);
    view.visible(false);
    if (name === 'widget') view.desktop({ visible: false });
  });
}

test('browser homepage cards show escaped notes and distinguish long-note previews from task progress', async () => {
  const task = { id: 'task', mode: 'quota-wake', notePreview: '<local>\n第二行…', noteTruncated: true, status: 'paused', sentCount: 0 };
  const view = pageView(); await view.flush();
  view.message(0, { settings, tasks: [task], connection: { status: 'connected' }, approvals: [], logs: [] });
  const html = view.element('#main').innerHTML;
  assert.match(html, /监测备注.*&lt;local&gt;\n第二行…/);
  assert.match(html, /更多内容见详情/); assert.match(html, /进度请在原聊天查看/);
  assert.doesNotMatch(html, /<local>/);
  view.visible(false);
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

test('message editor escapes custom text and offers localized save and default-message guidance', tcase => {
  tcase.after(() => setLanguage('zh'));
  const task = { id: 'watch', continuationMessage: '</textarea><script>保持原文</script>\n第二行' };
  for (const [language, save] of [['zh', '保存消息'], ['en', 'Save message']]) {
    setLanguage(language);
    const html = continuationEditor(task, escape);
    assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;保持原文&lt;\/script&gt;\n第二行/);
    assert.ok(html.includes(save)); assert.doesNotMatch(html, /<script>/);
    assert.match(html, /name="continuationMessage"/); assert.match(html, /maxlength="12000"/);
    if (language === 'en') assert.match(html, /Leave blank.*Continue/);
  }
});

test('widget edit entry waits for complete details and cancelling never saves or sends', async () => {
  let release;
  const task = { id: 'watch', name: 'Watch', mode: 'quota-wake', status: 'paused', continuationMessage: '已保存的指令', note: 'Local note' };
  const view = widgetView({ task: () => new Promise(resolve => { release = resolve; }) }); await view.flush();
  const state = { settings, connection: { status: 'connected' }, tasks: [{ id: task.id, name: task.name, mode: task.mode, status: task.status, detailRevision: 1 }], approvals: [], logs: [] };
  view.message(0, state); await view.flush(); view.desktop({ expanded: true }); await view.flush();
  await view.action('detail', task.id);
  assert.match(view.element('#modal-body').innerHTML, /data-action="edit-message"[^>]+disabled/);
  release({ task }); await view.flush();
  await view.action('edit-message', task.id);
  assert.equal(view.element('#modal-title').textContent, '编辑续作消息');
  assert.match(view.element('#modal-body').innerHTML, /已保存的指令<\/textarea>/);
  assert.match(view.element('#modal-body').innerHTML, /id="message-form"/);
  await view.action('detail', task.id);
  assert.doesNotMatch(view.element('#modal-body').innerHTML, /id="message-form"/);
  assert.equal(task.continuationMessage, '已保存的指令');
  assert.equal(view.requests.filter(path => path === `/api/tasks/${task.id}`).length, 1);
  view.desktop({ visible: false });
});
