import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../public/api-client.js';
import { taskCardHtml, taskDetailHtml, taskStatusLabel } from '../public/task-view.js';
import { newTaskForm, monitorImportForm } from '../public/task-forms.js';
import { setLanguage } from '../public/i18n.js';
import { widgetView, pageView } from './fixtures/widget-view.js';

const settings = { language: 'zh', enabled: false, pollSeconds: 30, minimumRemaining: 5, maxRounds: 10, maxWakeSends: 8 };
const snapshot = tasks => ({ version: '0.5.1', buildId: 'fixture', settings, tasks, connection: { status: 'connected' }, approvals: [], logs: [], history: [] });
const watched = () => ({ id: 'watch', name: '中文项目', mode: 'quota-wake', note: 'Local note', continuationMessage: 'Saved message', sentCount: 3, status: 'paused', detailRevision: 1 });

test('shared API preserves payloads and applies the same transport policy to reads and writes', async () => {
  const calls = [], api = createApiClient({ request: async (path, options) => {
    calls.push({ path, options }); return { ok: true, json: async () => ({ saved: true }) };
  } });
  await api('/api/state');
  const payload = { value: '继续\n"quoted" <custom>', continuous: false };
  assert.deepEqual(await api('/api/tasks/watch', payload), { saved: true });
  for (const { options } of calls) {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].options.method, undefined); assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].options.method, 'POST'); assert.deepEqual(JSON.parse(calls[1].options.body), payload);
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[1].options.headers['X-Continuer-Client'], '1');
});

test('shared API reports server errors and resolves fallback error text in the current language', async t => {
  t.after(() => setLanguage('zh'));
  const serverError = createApiClient({ request: async () => ({ ok: false, json: async () => ({ error: 'Specific error: 中文' }) }) });
  await assert.rejects(serverError('/api/state'), /Specific error: 中文/);
  const fallback = createApiClient({ request: async () => ({ ok: false, json: async () => ({}) }) });
  setLanguage('zh'); await assert.rejects(fallback('/api/state'), /请求失败/);
  setLanguage('en'); await assert.rejects(fallback('/api/state'), /Request failed/);
});

test('shared API aborts a stalled request within its configured lifetime', async () => {
  const api = createApiClient({ timeoutMs: 10, request: (_path, { signal }) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => reject(Error('Fixture did not abort')), 2000);
    signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
  }) });
  await assert.rejects(api('/api/state'), { name: 'TimeoutError' });
});

test('both card layouts share task actions and live status translations', t => {
  t.after(() => setLanguage('zh'));
  for (const layout of ['page', 'widget']) {
    for (const status of ['queued', 'waiting', 'starting', 'running', 'approval', 'pausing', 'monitoring', 'paused', 'blocked', 'failed', 'completed']) {
      const task = { ...watched(), status }, card = taskCardHtml(task, settings, layout);
      if (status === 'completed') assert.doesNotMatch(card, /data-action="(?:pause|resume)"/);
      else assert.match(card, new RegExp(`data-action="${['paused', 'blocked', 'failed'].includes(status) ? 'resume' : 'pause'}"`));
      const detail = taskDetailHtml(task, settings, { layout });
      assert.equal(detail.includes('data-action="complete"'), !['starting', 'running', 'approval', 'pausing', 'completed'].includes(status));
    }
    setLanguage('en');
    assert.equal(taskStatusLabel({ status: 'waiting', waitReason: 'desktop' }), 'Waiting for delivery');
    const card = taskCardHtml(watched(), settings, layout);
    assert.match(card, /Enable monitoring/); assert.match(card, />中文项目<\/button>/);
    setLanguage('zh'); assert.equal(taskStatusLabel({ status: 'waiting', waitReason: 'thread' }), '等待会话');
  }
});

test('shared rendering escapes all task content and keeps monitor details separate from execution output', () => {
  const unsafe = '\"><script>继续</script> & text', task = {
    ...watched(), id: unsafe, name: unsafe, note: unsafe, continuationMessage: unsafe, cwd: unsafe,
    activity: unsafe, progress: '0%;color:red', output: 'Obsolete execution output', plan: [{ step: 'Obsolete plan' }],
  };
  for (const layout of ['page', 'widget']) {
    const card = taskCardHtml(task, settings, layout), detail = taskDetailHtml(task, settings, { layout, canEdit: false });
    for (const html of [card, detail]) { assert.doesNotMatch(html, /<script>|color:red|Obsolete/); assert.match(html, /&lt;script&gt;继续&lt;\/script&gt;/); }
    assert.match(card, /width:0%/);
    assert.match(detail, /data-action="edit-message"[^>]*disabled/);
    assert.doesNotMatch(taskDetailHtml(task, settings, { layout, canEdit: true }), /data-action="edit-message"[^>]*disabled/);
    const direct = taskDetailHtml({ ...task, mode: 'direct', prompt: unsafe, output: unsafe, plan: [{ step: unsafe, status: 'inProgress' }] }, settings, { layout });
    assert.doesNotMatch(direct, /data-action="edit-message"|<script>/);
    assert.match(direct, /&lt;script&gt;继续&lt;\/script&gt;/);
  }
});

test('shared forms retain field contracts and never translate imported chat names', t => {
  t.after(() => setLanguage('zh'));
  for (const language of ['zh', 'en']) {
    setLanguage(language);
    for (const layout of ['page', 'widget']) {
      const create = newTaskForm({ layout, pickDirectory: true });
      for (const name of ['name', 'cwd', 'prompt', 'continuous']) assert.ok(create.includes(`name="${name}"`));
      assert.match(create, /name="prompt"[^>]*maxlength="12000"/);
      const form = monitorImportForm('\"<id>', { layout, thread: { name: '继续处理中文项目', cwd: '<private>' } });
      assert.match(form, /name="continuationMessage" maxlength="12000"/);
      assert.match(form, /name="note" maxlength="12000"/);
      assert.match(form, /继续处理中文项目/); assert.doesNotMatch(form, /<private>|"<id>/);
      if (language === 'en') assert.match(form, /Continuation message/);
    }
  }
});

for (const [layout, createView] of [['page', pageView], ['widget', widgetView]]) {
  test(`${layout} edits and saves through the shared client after full detail readiness`, async () => {
    const task = watched(), state = snapshot([task]);
    const view = createView({ task: async (_path, options) => {
      if (options.method !== 'POST') return { task };
      const body = JSON.parse(options.body); assert.equal(body.action, 'message');
      task.continuationMessage = body.value; return state;
    } });
    await view.flush(); view.message(0, state); await view.action('detail', task.id); await view.flush();
    await view.action('edit-message', task.id);
    assert.match(view.element('#modal-body').innerHTML, /Saved message/);
    await view.submit('message-form', { continuationMessage: 'New 中文\n"message"' }, { id: task.id });
    const writes = view.apiCalls.filter(call => call.options?.method === 'POST');
    assert.equal(writes.length, 1); assert.equal(writes[0].path, '/api/tasks/watch');
    assert.equal(task.continuationMessage, 'New 中文\n"message"');
    assert.equal(view.element('#modal').open, false);
    view.visible(false); if (layout === 'widget') view.desktop({ visible: false });
  });

  test(`${layout} submits creation and monitoring forms with the same payload fields`, async () => {
    const state = snapshot([]), view = createView({ request: async () => state });
    await view.flush(); view.message(0, state); await view.action('new');
    assert.match(view.element('#modal-body').innerHTML, /name="prompt"/);
    await view.submit(layout === 'page' ? 'task-form' : 'new-form', { name: '中文工作', cwd: 'E:\\fixture', prompt: 'Goal', continuous: 'on' });
    const create = view.apiCalls.find(call => call.path === '/api/tasks');
    assert.deepEqual(JSON.parse(create.options.body), { name: '中文工作', cwd: 'E:\\fixture', prompt: 'Goal', continuous: true });
    await view.action(layout === 'page' ? 'choose-thread' : 'select-session', 'chat');
    await view.submit('import-form', { note: 'Local note', continuationMessage: 'Continue this' }, { id: 'chat' });
    const imported = view.apiCalls.find(call => call.path === '/api/import');
    assert.deepEqual(JSON.parse(imported.options.body), { threadId: 'chat', note: 'Local note', continuationMessage: 'Continue this' });
    view.visible(false); if (layout === 'widget') view.desktop({ visible: false });
  });
}
