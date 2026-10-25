import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../server/store.js';
import { alive, diagnostic } from '../server/health.js';
import access from '../server/access.cjs';

const execute = promisify(execFile);
async function service(t, { corrupt = false } = {}) {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-cold-start-'));
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const preload = join(directory, 'mock-channels.mjs'), callsFile = join(directory, 'calls.jsonl');
  // This preload is inherited by the launched service. Neither real Codex nor
  // real queue binaries can be reached even if the scheduling assertion fails.
  writeFileSync(preload, `
    import { appendFileSync } from 'node:fs';
    import { CodexRpc } from ${JSON.stringify(new URL('../server/rpc.js', import.meta.url).href)};
    import { QueueSender } from ${JSON.stringify(new URL('../server/queue-sender.js', import.meta.url).href)};
    const record = method => appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({method}) + '\\n');
    CodexRpc.prototype.connect = async function() { this.ready = true; };
    CodexRpc.prototype.call = async function(method, params) {
      record(method);
      if (method === 'account/rateLimits/read') return {rateLimits:{primary:{usedPercent:0}}};
      if (method === 'thread/list') return {data:[],nextCursor:null};
      if (method === 'turn/start') {
        this.emit('request',{id:88,method:'item/commandExecution/requestApproval',params:{threadId:params.threadId,turnId:'fixture-turn',reason:'Read the complete fixture command',command:'命'.repeat(5990)+'fixture-end',cwd:${JSON.stringify(directory)}}});
        return {turn:{id:'fixture-turn'}};
      }
      if (method === 'turn/interrupt') this.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});
      return {thread:{id:params?.threadId,status:{type:'idle'}}};
    };
    CodexRpc.prototype.close = function() { this.ready = false; };
    CodexRpc.prototype.send = function() { record('fixture/approval'); };
    QueueSender.prototype.send = async function() { record('fixture/queue'); return {queueId:'fixture'}; };
  `);
  const state = { schemaVersion: 1, settings: { enabled: true, pollSeconds: 30, maxRounds: 20, maxWakeSends: 20, minimumRemaining: 5 },
    tasks: [
      { id: 'direct', name: 'Fixture queued', cwd: directory, prompt: 'Private execution goal', continuous: true, rounds: 0, status: 'queued', plan: [], output: '', activity: 'Waiting' },
      { id: 'watch', name: 'Fixture watch', mode: 'quota-wake', threadId: '11111111-1111-4111-8111-111111111111', note: 'Private monitoring note', sentCount: 0, continuous: true, status: 'waiting', plan: [], output: '', activity: 'Armed', wake: { armed: true, delivery: 'pending', episodeId: 'fixture', exhaustedAt: Date.now() - 60000 } },
    ], logs: [], history: [] };
  const file = join(directory, 'state.json'), store = new Store(file); store.save(state); store.save(state);
  if (corrupt) writeFileSync(file, '{broken');
  const env = { ...process.env, CONTINUER_DATA_DIR: directory, CONTINUER_PORT: String(port), PORT: String(port), NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` };
  const request = async (path, body) => {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(4000), headers: { Authorization: 'Bearer ' + access.readToken(directory) }, ...(body === undefined ? {} : { method: 'POST', headers: { Authorization: 'Bearer ' + access.readToken(directory), 'Content-Type': 'application/json', 'X-Continuer-Client': '1' }, body: JSON.stringify(body) }) });
    const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
  };
  t.after(async () => {
    const pid = diagnostic(join(directory, 'service.lock'))?.pid;
    try { await request('/api/shutdown', {}); } catch {}
    for (let i = 0; pid && alive(pid) && i < 30; i++) await delay(50);
    // The PID comes only from this test's private directory and launched service.
    if (pid && alive(pid)) { process.kill(pid); await delay(100); }
    assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true });
  });
  const status = async (name = 'continuer_status') => {
    const code = `import {dispatch} from ${JSON.stringify(new URL('../plugin/tools.js', import.meta.url).href)}; import * as runtime from ${JSON.stringify(new URL('../plugin/runtime.js', import.meta.url).href)}; console.log(JSON.stringify(await dispatch(${JSON.stringify(name)}, {}, runtime)));`;
    const result = await execute(process.execPath, ['--input-type=module', '--eval', code], { env, timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 });
    return JSON.parse(result.stdout);
  };
  const calls = () => existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line).method) : [];
  return { directory, file, origin, env, request, status, calls };
}

test('real MCP cold startup remains read-only until explicit activation; summaries, details and assets work over HTTP', { timeout: 25000 }, async t => {
  const f = await service(t), read = await f.status();
  assert.equal(read.observationOnly, true); assert.equal(read.settings.enabled, false);
  await f.status('continuer_list_sessions'); await f.request('/api/refresh', {});
  assert.equal(f.calls().includes('turn/start'), false); assert.equal(f.calls().includes('fixture/queue'), false);
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).settings.enabled, true);
  const snapshot = await f.request('/api/state');
  assert.equal(snapshot.tasks.find(task => task.id === 'direct').prompt, undefined);
  assert.equal((await f.request('/api/tasks/direct')).task.prompt, 'Private execution goal');
  assert.equal((await f.request('/api/tasks/watch')).task.note, 'Private monitoring note');
  const visited = new Set(), queue = ['/app.js', '/widget.js'];
  while (queue.length) {
    const path = queue.shift(); if (visited.has(path)) continue; visited.add(path);
    const response = await fetch(f.origin + path); assert.equal(response.status, 200, path); assert.match(response.headers.get('content-type'), /javascript/);
    const source = await response.text();
    for (const match of source.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) queue.push('/' + match[1]);
  }
  assert.ok(visited.has('/task-mode.js')); assert.ok(visited.has('/task-details.js')); assert.ok(visited.has('/storage-status.js'));
  assert.ok(visited.has('/view-lifecycle.js'));
  const script = await fetch(f.origin + '/app.js'), etag = script.headers.get('etag'); await script.text(); assert.ok(etag);
  const unchanged = await fetch(f.origin + '/app.js', { headers: { 'If-None-Match': etag } }); assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
  const health = await f.request('/api/health'); assert.equal(health.buildId, snapshot.buildId); assert.equal(health.protocolVersion, 3);
  assert.equal(health.resources.taskLimit, 100); assert.equal(health.dataDir, f.directory);
  // A second writer cannot touch the same state, even before binding its port.
  await assert.rejects(execute(process.execPath, ['server/index.js'], { env: f.env, timeout: 5000, windowsHide: true }));
  assert.equal((await f.request('/api/state')).observationOnly, true);
  await f.request('/api/settings', { enabled: true }); await f.request('/api/refresh', {});
  assert.equal(f.calls().filter(method => method === 'turn/start').length, 1);
  assert.equal(f.calls().filter(method => method === 'fixture/queue').length, 1);
  const approval = (await f.request('/api/state')).approvals[0];
  assert.equal(approval.requiresDetails, true); assert.ok(approval.command.length <= 1000);
  const complete = await f.request(`/api/approvals/88?token=${approval.detailToken}`);
  assert.equal(complete.approval.command.endsWith('fixture-end'), true);
  await assert.rejects(f.request('/api/approvals/88?token=obsolete'), /失效/);
  await assert.rejects(f.request('/api/approval', {id:88,decision:'accept'}), /过期/);
  await assert.rejects(f.request('/api/approval', {id:88,decision:'accept',token:'obsolete'}), /过期/);
  await f.request('/api/approval', {id:88,decision:'decline',token:approval.detailToken});
  assert.equal(f.calls().filter(method => method === 'fixture/approval').length, 1);
  await assert.rejects(f.request(`/api/approvals/88?token=${approval.detailToken}`), /失效/);
});

test('all API routes reject absent, wrong, cookie and query credentials before any work', { timeout: 25000 }, async t => {
  const f = await service(t); await f.status();
  for (const path of ['/api/state', '/api/health', '/api/threads', '/api/events', '/api/logs', '/api/tasks/direct', '/api/approvals/88', '/x/../api/state', '/api/unknown']) {
    for (const headers of [{}, { Authorization: 'Bearer ' + '0'.repeat(64) }, { Cookie: 'access=' + access.readToken(f.directory) }]) {
      const response = await fetch(f.origin + path, { headers }); assert.equal(response.status, 401, path); assert.doesNotMatch(await response.text(), /Private execution goal|Private monitoring note/);
    }
  }
  assert.equal((await fetch(f.origin + '/api/state?access=' + access.readToken(f.directory))).status, 401);
  for (const path of ['/api/tasks', '/api/settings', '/api/approval', '/api/import', '/api/shutdown']) {
    const response = await fetch(f.origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Continuer-Client': '1' }, body: '{}' }); assert.equal(response.status, 401, path);
  }
  const crossOrigin = await fetch(f.origin + '/api/state', { headers: { Authorization: 'Bearer ' + access.readToken(f.directory), Origin: 'https://example.invalid' } }); assert.equal(crossOrigin.status, 403);
  assert.equal((await f.request('/api/state')).tasks.length, 2); assert.equal(f.calls().includes('turn/start'), false); assert.equal(f.calls().includes('fixture/queue'), false);
});

test('real HTTP requests preserve UTF-8 codepoints split across writes', { timeout: 25000 }, async t => {
  const f = await service(t); await f.status(); await f.request('/api/settings', { enabled: false });
  const input = { name: '分片中文任务😀', cwd: f.directory, prompt: '核对中文😀验收标准', continuous: false };
  const bytes = Buffer.from(JSON.stringify(input)), split = bytes.indexOf(Buffer.from('核')) + 1;
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest(f.origin + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Continuer-Client': '1', 'Content-Length': bytes.length, Authorization: 'Bearer ' + access.readToken(f.directory) } }, res => {
      res.setEncoding('utf8'); let content = '';
      res.on('data', chunk => { content += chunk; }); res.on('end', () => { try { assert.equal(res.statusCode, 200); resolve(JSON.parse(content)); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.write(bytes.subarray(0, split)); setTimeout(() => req.end(bytes.subarray(split)), 20);
  });
  const task = result.tasks.find(item => item.name === input.name);
  assert.ok(task); assert.equal((await f.request(`/api/tasks/${task.id}`)).task.prompt, input.prompt);
  assert.equal(f.calls().includes('turn/start'), false); assert.equal(f.calls().includes('fixture/queue'), false);
});

test('corrupt state still serves health and explicit backup recovery without starting saved work', { timeout: 25000 }, async t => {
  const f = await service(t, { corrupt: true }), read = await f.status();
  assert.equal(read.persistence.status, 'error'); assert.equal(read.persistence.backupAvailable, true);
  assert.equal(readFileSync(f.file, 'utf8'), '{broken');
  const restored = await f.request('/api/storage/recover', { source: 'backup' });
  assert.equal(restored.settings.enabled, false); assert.equal(restored.tasks.length, 2);
  assert.ok(restored.tasks.every(task => task.continuous === false && task.status === 'blocked'));
  assert.equal(readFileSync(f.file + '.before-restore', 'utf8'), '{broken');
  await f.request('/api/refresh', {});
  assert.equal(f.calls().includes('turn/start'), false); assert.equal(f.calls().includes('fixture/queue'), false);
});
