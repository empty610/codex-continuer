import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { dispatch } from '../plugin/tools.js';
import access from '../server/access.cjs';
import { pinnedFetch } from './fixtures/local-fetch.js';

test('HTTP and MCP imports share one reservation and persist one recovery delivery', { timeout: 30000 }, async () => {
  const temporaryRoot = realpathSync(tmpdir());
  const dataDir = mkdtempSync(join(temporaryRoot, 'continuer-import-http-'));
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  // Use the production HTTP server and demo adapter. Delay only the demo read
  // so both entry points overlap; no Codex process or real queue is involved.
  const bootstrap = `
    import { DemoRpc } from ${JSON.stringify(new URL('../server/demo.js', import.meta.url).href)};
    const call = DemoRpc.prototype.call;
    DemoRpc.prototype.call = async function(method, params) {
      if (method === 'thread/read') await new Promise(resolve => setTimeout(resolve, 100));
      return call.call(this, method, params);
    };
    await import(${JSON.stringify(new URL('../server/index.js', import.meta.url).href)});
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', bootstrap, '--', '--demo'], {
    env: { ...process.env, PORT: String(port), CONTINUER_DATA_DIR: dataDir },
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exited = once(child, 'exit');
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const origin = `https://127.0.0.1:${port}`, fetch = pinnedFetch(dataDir, true);
  async function request(path, body) {
    const response = await fetch(origin + path, {
      signal: AbortSignal.timeout(3000), headers: { Authorization: 'Bearer ' + access.readToken(dataDir, true) },
      ...(body === undefined ? {} : { method: 'POST', headers: { Authorization: 'Bearer ' + access.readToken(dataDir, true), 'Content-Type': 'application/json', 'X-Continuer-Client': '1' }, body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    return result;
  }
  try {
    let ready = false, startupError;
    // A cold Windows TLS identity can take longer under concurrent CI load.
    const startupDeadline = Date.now() + 20000;
    while (Date.now() < startupDeadline) {
      if (child.exitCode !== null) throw Error(`Demo server exited: ${stderr}`);
      try { await request('/api/state'); ready = true; break; } catch (error) { startupError = error; await delay(50); }
    }
    assert.equal(ready, true, stderr || startupError?.message);
    const threadId = '11111111-1111-4111-8111-111111111111';
    const input = { threadId, prompt: 'Isolated import regression' };
    const runtime = { ensureService: async () => {}, request };
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => index % 2
      ? dispatch('continuer_import_session', input, runtime)
      : request('/api/import', input)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 19);
    const imported = (await request('/api/state')).tasks.filter(task => task.threadId === threadId);
    assert.equal(imported.length, 1); assert.equal(imported[0].status, 'paused');
    await request(`/api/tasks/${imported[0].id}`, { action: 'continuous', value: true });
    await request('/api/demo/quota', { exhausted: true });
    await request('/api/demo/quota', { exhausted: false });
    await Promise.all(Array.from({ length: 10 }, () => request('/api/refresh', {})));
    const persisted = JSON.parse(readFileSync(join(dataDir, 'demo-state.json'), 'utf8')).tasks.filter(task => task.threadId === threadId);
    assert.equal(persisted.length, 1); assert.equal(persisted[0].sentCount, 1);
    assert.equal(persisted[0].wake.delivery, 'sent');
    // The real HTTP routes share the tighter limits and mode-specific schema.
    await assert.rejects(request('/api/settings', { pollSeconds: 91 }), /90/);
    await request('/api/settings', { pollSeconds: 90, maxWakeSends: 1 });
    const capped = (await request('/api/state')).tasks.find(task => task.id === imported[0].id);
    assert.equal(capped.status, 'paused'); assert.equal(capped.continuous, false);
    await assert.rejects(request(`/api/tasks/${capped.id}`, { action: 'resume' }), /上限/);
    const another = '22222222-2222-4222-8222-222222222222';
    await dispatch('continuer_import_session', { threadId: another, note: 'Local monitoring note', continuationMessage: '先验证测试，再继续实现。' }, runtime);
    const noted = (await request('/api/state')).tasks.find(task => task.threadId === another);
    const detail = await request(`/api/tasks/${noted.id}`);
    assert.equal(detail.task.note, 'Local monitoring note'); assert.equal(noted.note, undefined); assert.equal(noted.prompt, undefined);
    assert.equal(noted.notePreview, 'Local monitoring note'); assert.equal(noted.noteTruncated, false);
    assert.equal(detail.task.continuationMessage, '先验证测试，再继续实现。');
    assert.equal(noted.continuationMessage, undefined);
    const stored = JSON.parse(readFileSync(join(dataDir, 'demo-state.json'), 'utf8')).tasks.find(task => task.id === noted.id);
    assert.equal(stored.continuationMessage, '先验证测试，再继续实现。'); assert.equal(stored.note, 'Local monitoring note');
    const edited = await request(`/api/tasks/${noted.id}`, { action: 'message', value: '改为先检查阻塞，再继续。\n保留多行指令。' });
    const editedSummary = edited.tasks.find(task => task.id === noted.id);
    assert.ok(editedSummary.detailRevision > noted.detailRevision);
    assert.equal(editedSummary.status, 'paused'); assert.equal(editedSummary.sentCount, 0);
    assert.equal((await request(`/api/tasks/${noted.id}`)).task.continuationMessage, '改为先检查阻塞，再继续。\n保留多行指令。');
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'demo-state.json'), 'utf8')).tasks.find(task => task.id === noted.id).note, 'Local monitoring note');
    await assert.rejects(request(`/api/tasks/${noted.id}`, { action: 'message', value: null }), /续作消息/);
    await request(`/api/tasks/${noted.id}`, { action: 'message', value: ' \n ' });
    assert.equal((await request(`/api/tasks/${noted.id}`)).task.continuationMessage, '');
    const localized = await request('/api/settings', { language: 'en' });
    assert.equal(localized.settings.language, 'en');
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'demo-state.json'), 'utf8')).settings.language, 'en');
    await assert.rejects(request('/api/settings', { language: 'en-US' }), /language/);
    await assert.rejects(request('/api/import', { threadId: 'unused', continuationMessage: 123 }), /续作消息/);
    assert.equal(noted.sentCount, 0); assert.equal(noted.progress, null);
    await assert.rejects(request('/api/import', { threadId: 'unused', prompt: 'Goal', note: 'Note' }), /note/);
    await request(`/api/tasks/${capped.id}`, { action: 'complete' });
    const ended = await request('/api/state');
    assert.equal(ended.tasks.some(task => task.id === capped.id), false);
    assert.match(ended.logs.find(log => log.taskId === capped.id).message, /结束监测/);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    assert.equal(dirname(realpathSync(dataDir)), temporaryRoot);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
