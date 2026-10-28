import test from 'node:test';
import assert from 'node:assert/strict';
import { t, setLanguage, locale, defaultContinuation, systemText, refreshLocalizedContent } from '../public/i18n.js';
import { taskMode, wakeExplanation } from '../public/task-mode.js';
import { resetCountdown } from '../public/quota-display.js';
import { widgetView } from './fixtures/widget-view.js';

test('translations change interface literals while preserving interpolated custom content', tcase => {
  tcase.after(() => setLanguage('zh'));
  setLanguage('en'); assert.equal(locale(), 'en-US');
  assert.equal(t('加入我的工作'), 'Add to my work');
  const custom = '继续 / 工作名称 / <script>不要改写</script>';
  assert.equal(t`监测备注：${custom}（仅本地保存）`, `Monitoring note: ${custom} (local only)`);
  assert.equal(systemText('正在执行命令'), 'Running a command');
  assert.equal(systemText('已添加会话：继续'), 'Chat added: 继续');
  assert.equal(systemText('User output: 继续'), 'User output: 继续');
  assert.equal(systemText('已结束监测：中文项目；工作结果请在原聊天确认'), 'Monitoring ended: 中文项目; check results in the original chat');
  assert.equal(systemText('中文项目：正在执行命令'), '中文项目: Running a command');
  assert.equal(systemText('maxWakeSends 必须为 1–100 的整数'), 'maxWakeSends must be an integer between 1 and 100');
  assert.equal(t`当前状态：${custom}。`, `Current status: ${custom}. `);
  assert.match(wakeExplanation, /blank sends “Continue”/);
  assert.equal(taskMode({ mode: 'quota-wake', note: custom }, { maxWakeSends: 5 }).description, `Monitoring note: ${custom} (local only)`);
  assert.equal(defaultContinuation('en'), 'Continue'); assert.equal(defaultContinuation('zh'), '继续');
  assert.equal(defaultContinuation(), '继续', 'Legacy backend calls always default to Chinese');
  assert.equal(resetCountdown(90001, 0), '1d 01:00:01');
  setLanguage('zh'); assert.equal(t('加入我的工作'), '加入我的工作'); assert.match(wakeExplanation, /留空发送“继续”/);
});

test('incoming language settings update visible widget cards and gauge without changing task content', async tcase => {
  tcase.after(() => setLanguage('zh'));
  const view = widgetView(); await view.flush();
  const task = { id: 'fixture', mode: 'quota-wake', status: 'paused', name: '继续', notePreview: '监测备注：保留中文', sentCount: 0 };
  const state = { connection: { status: 'connected' }, sampledAt: Date.now(), settings: { language: 'zh', enabled: false, minimumRemaining: 5, maxWakeSends: 5 }, tasks: [task], approvals: [], logs: [] };
  view.message(0, state); await view.flush(); view.desktop({ expanded: true }); await view.flush();
  assert.match(view.element('#tasks').innerHTML, /开启监测/);
  view.message(0, { ...state, settings: { ...state.settings, language: 'en' } });
  assert.match(view.element('#tasks').innerHTML, /Enable monitoring/);
  assert.match(view.element('#tasks').innerHTML, /Monitoring note/);
  assert.match(view.element('#tasks').innerHTML, /监测备注：保留中文/);
  assert.match(view.element('#tasks').innerHTML, />继续<\/button>/);
  assert.equal(view.element('#language').value, 'en');
  view.desktop({ expanded: false });
  assert.equal(view.element('#mini-reset-label').textContent, 'UNTIL RESET');
  view.message(0, state); view.desktop({ expanded: true });
  assert.match(view.element('#tasks').innerHTML, /开启监测/);
  view.desktop({ visible: false });
});

function sessionState(language = 'zh') {
  return { connection: { status: 'connected' }, settings: { language, enabled: false, minimumRemaining: 5, maxWakeSends: 5 }, tasks: [], approvals: [], logs: [] };
}

test('cached session choices change language immediately without refetching or translating chat names', async tcase => {
  tcase.after(() => setLanguage('zh'));
  const view = widgetView({ threads: async () => ({ data: [{ id: 'chat', name: '继续处理中文项目' }], nextCursor: 'more' }) });
  await view.flush(); view.message(0, sessionState()); await view.flush(); view.desktop({ expanded: true }); await view.flush();
  assert.match(view.element('#session-select').innerHTML, /选择当前要管理的对话/);
  const reads = view.requests.filter(path => path.startsWith('/api/threads')).length;
  view.message(0, sessionState('en'));
  assert.match(view.element('#session-select').innerHTML, /Choose a chat to manage/);
  assert.doesNotMatch(view.element('#session-select').innerHTML, /选择当前/);
  assert.match(view.element('#session-select').innerHTML, /继续处理中文项目/);
  view.element('#session-select').value = 'chat'; view.element('#session-select').onchange();
  view.message(0, sessionState());
  assert.equal(view.element('#session-select').value, 'chat');
  assert.match(view.element('#session-select').innerHTML, /选择当前要管理的对话/);
  assert.equal(view.requests.filter(path => path.startsWith('/api/threads')).length, reads);
  const writes = view.element('#session-select').writes; view.message(0, sessionState());
  assert.equal(view.element('#session-select').writes, writes, 'Unrelated updates must preserve option nodes');
  view.desktop({ visible: false });
});

test('loading, empty and failed session states remain localized through background updates', async tcase => {
  tcase.after(() => setLanguage('zh'));
  let resolve, fail = false;
  const view = widgetView({ threads: () => fail ? Promise.reject(Error('请求失败')) : new Promise(done => { resolve = done; }) });
  await view.flush(); view.message(0, sessionState()); await view.flush(); view.desktop({ expanded: true }); await view.flush();
  view.message(0, sessionState('en'));
  assert.match(view.element('#session-select').innerHTML, /Loading chats/);
  resolve({ data: [], nextCursor: null }); await view.flush();
  assert.match(view.element('#session-select').innerHTML, /No local Codex chats/);
  fail = true; view.advance(60001); await view.flush();
  assert.match(view.element('#session-preview').textContent, /Request failed/);
  view.message(0, sessionState('en'));
  assert.match(view.element('#session-preview').textContent, /Request failed/);
  view.message(0, sessionState());
  assert.match(view.element('#session-preview').textContent, /读取失败：请求失败/);
  view.desktop({ visible: false });
});

test('open forms and cached import lists switch language when another window updates settings', async tcase => {
  tcase.after(() => setLanguage('zh'));
  const view = widgetView({ threads: async () => ({ data: [{ id: 'chat', name: '我的中文对话' }] }) });
  await view.flush(); view.message(0, sessionState()); await view.flush(); view.desktop({ expanded: true }); await view.flush();
  await view.action('select-session', 'chat');
  assert.match(view.element('#modal-body').innerHTML, /续作消息（可选）/);
  view.message(0, sessionState('en'));
  assert.equal(view.element('#modal-title').textContent, 'Monitor original chat quota');
  assert.match(view.element('#modal-body').innerHTML, /Leave blank to send: Continue/);
  assert.doesNotMatch(view.element('#modal-body').innerHTML, /续作消息|监测备注/);
  await view.action('import');
  view.message(0, sessionState());
  assert.equal(view.element('#modal-title').textContent, '导入已有会话');
  assert.match(view.element('#modal-body').innerHTML, /我的中文对话/);
  view.message(0, sessionState('en'));
  assert.equal(view.element('#modal-title').textContent, 'Import an existing chat');
  assert.match(view.element('#modal-body').innerHTML, /我的中文对话/);
  view.desktop({ visible: false });
});

test('localized form redraw preserves values, checkboxes, focus, selection and scroll', () => {
  const controls = () => [
    { name: 'continuationMessage', value: '', selectionStart: 0, selectionEnd: 0, focus() { this.focused = true; }, setSelectionRange(start, end) { this.range = [start, end]; } },
    { name: 'continuous', value: 'on', checked: true },
  ];
  let inputs = controls(); inputs[0].value = '继续，保留自定义消息'; inputs[0].selectionStart = 2; inputs[0].selectionEnd = 5; inputs[1].checked = false;
  const document = { activeElement: inputs[0] }, container = { scrollTop: 87 };
  const element = { ownerDocument: document, closest: () => container,
    querySelectorAll: selector => selector === '.form-error' ? [] : inputs,
    set innerHTML(value) { this.html = value; inputs = controls(); },
  };
  refreshLocalizedContent(element, () => '<form>New labels</form>');
  assert.equal(inputs[0].value, '继续，保留自定义消息'); assert.equal(inputs[1].checked, false);
  assert.equal(inputs[0].focused, true); assert.deepEqual(inputs[0].range, [2, 5]);
  assert.equal(container.scrollTop, 87);
});

test('a delayed close event from the previous dialog does not disable localization of a newly opened form', async tcase => {
  tcase.after(() => setLanguage('zh'));
  const view = widgetView(); await view.flush(); view.message(0, sessionState()); await view.flush(); view.desktop({ expanded: true }); await view.flush();
  await view.action('new'); view.element('#close').onclick();
  await view.action('new'); view.element('#modal').emit('close');
  view.message(0, sessionState('en'));
  assert.equal(view.element('#modal-title').textContent, 'New work');
  assert.match(view.element('#modal-body').innerHTML, /Goal and acceptance criteria/);
  view.desktop({ visible: false });
});

test('failed imports can retry and a late session response cannot overwrite a different dialog', async tcase => {
  tcase.after(() => setLanguage('zh'));
  let fail = false, pending, release;
  const view = widgetView({ threads: () => fail ? Promise.reject(Error('请求失败')) : pending ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ data: [{ id: 'chat', name: '中文项目' }] }) });
  await view.flush(); view.message(0, sessionState('en')); await view.flush(); view.desktop({ expanded: true }); await view.flush();
  fail = true; await view.action('import');
  assert.match(view.element('#modal-body').innerHTML, />Retry<\/button>/);
  assert.equal(view.element('#error').textContent, 'Request failed');
  fail = false; await view.action('import');
  assert.equal(view.element('#error').textContent, '');
  assert.match(view.element('#modal-body').innerHTML, /中文项目/);
  pending = true; const request = view.action('import');
  await view.action('new'); release({ data: [{ id: 'late', name: 'Late response' }] }); await request;
  assert.equal(view.element('#modal-title').textContent, 'New work');
  assert.match(view.element('#modal-body').innerHTML, /id="new-form"/);
  assert.doesNotMatch(view.element('#modal-body').innerHTML, /Late response/);
  view.desktop({ visible: false });
});
