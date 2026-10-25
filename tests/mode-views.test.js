import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { taskMode, wakeExplanation } from '../public/task-mode.js';

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
  const html = runInNewContext(`${code}; settings()`, { state: { settings, connection: { status: 'connected' } }, esc: escape, heading: () => '', toggle: () => '' });
  assert.match(html, /name="maxWakeSends"[^>]*value="5"/);
  assert.match(html, /name="maxRounds"[^>]*value="2"/);
  const options = [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
  assert.ok(options.includes(90)); assert.ok(options.every(n => n >= 10 && n <= 90));
});

for (const [file, name] of [['../public/app.js', 'renderDetail'], ['../public/widget.js', 'detail']]) {
  test(`${file} renders monitor notes and send counts without claiming external progress or completion`, () => {
    const body = {}, title = {}, task = { id: 'task', name: 'Monitor', mode: 'quota-wake', cwd: 'E:\\fixture', note: '<private>', sentCount: 3, status: 'paused', activity: 'Paused', threadId: 'thread', plan: [{ step: 'Obsolete plan', status: 'completed' }], output: 'Obsolete output' };
    const context = { state: { settings, tasks: [task] }, taskDetails: { read: value => value }, taskMode, wakeExplanation, esc: escape, active: [], taskLabel: () => '已暂停', modalHead: () => '', badge: () => '', icon: () => '', $: selector => selector === '#modal-title' ? title : body };
    runInNewContext(`${productionFunction(file, name)}; ${name}('task')`, context);
    assert.match(body.innerHTML, /监测备注.*&lt;private&gt;/);
    assert.match(body.innerHTML, /已排队发送 3 \/ 5 次/);
    assert.match(body.innerHTML, /结束监测并移除/);
    assert.match(body.innerHTML, /不读取原聊天进度或完成状态/);
    assert.doesNotMatch(body.innerHTML, /标记完成|Obsolete plan|Obsolete output/);
  });
}
