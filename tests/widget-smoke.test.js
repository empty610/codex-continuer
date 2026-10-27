import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import access from '../server/access.cjs';
import { pinnedFetch } from './fixtures/local-fetch.js';

const executable = fileURLToPath(new URL('../node_modules/electron/dist/electron.exe', import.meta.url));
for (const expanded of [false, true]) test(`hidden isolated widget is ready without loading unused views (expanded: ${expanded})`, { skip: process.platform !== 'win32' || !existsSync(executable), timeout: 40000 }, async () => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-widget-smoke-'));
  writeFileSync(join(directory, 'widget-preferences.json'), JSON.stringify({ follow: false, hidden: true, expanded }));
  const trace = join(directory, 'requests.jsonl'), preload = new URL('./fixtures/widget-trace.mjs', import.meta.url);
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, CONTINUER_DATA_DIR: directory, CONTINUER_DEMO: '1', CONTINUER_PORT: String(port), PORT: String(port), ELECTRON_RUN_AS_NODE: undefined };
  const server = spawn(process.execPath, ['server/index.js', '--demo', '--observe-only'], { env: { ...env, CONTINUER_TEST_TRACE_FILE: trace, NODE_OPTIONS: `--import=${preload.href}` }, windowsHide: true, stdio: 'ignore' });
  const secureFetch = pinnedFetch(directory, true);
  const authenticatedFetch = (url, options = {}) => secureFetch(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + access.readToken(directory, true) } });
  let widget;
  try {
    let running = false;
    for (let i = 0; i < 300; i++) {
      try { const response = await authenticatedFetch(`https://127.0.0.1:${port}/api/health`); running = response.ok; if (running) break; } catch {}
      await delay(50);
    }
    assert.equal(running, true);
    let nativeErrors = '';
    widget = spawn(executable, ['--disable-gpu', 'desktop/main.cjs'], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    widget.stderr.on('data', chunk => { nativeErrors = (nativeErrors + chunk).slice(-2500); });
    const exited = once(widget, 'exit'); let status;
    for (let i = 0; i < 120; i++) {
      try { status = JSON.parse(readFileSync(join(directory, 'widget-status.json'), 'utf8')); } catch {}
      if (status?.ready || widget.exitCode !== null) break;
      await delay(75);
    }
    let diagnostic = '';
    try { diagnostic = readFileSync(join(directory, 'widget-stderr.log'), 'utf8').slice(-1500); } catch {}
    const responses = existsSync(trace + '.responses') ? readFileSync(trace + '.responses', 'utf8').slice(-3000) : '';
    assert.equal(status?.ready, true, `exit=${widget.exitCode}; ${diagnostic}; ${nativeErrors}; responses=${responses}`); assert.equal(status.visible, false); assert.equal(status.hidden, true);
    assert.equal(status.follow, false); assert.equal(status.buildId.length, 20);
    const health = await (await authenticatedFetch(`https://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.widget.ready, true); assert.equal(health.observationOnly, true);
    let clients = health.resources.sseClients;
    for (let i = 0; clients && i < 25; i++) { await delay(50); clients = (await (await authenticatedFetch(`https://127.0.0.1:${port}/api/health`)).json()).resources.sseClients; }
    assert.equal(clients, 0, 'Hidden widget must release its bootstrap stream');
    const requests = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(requests.includes('/api/health'), 'The trace must record the known health route');
    assert.equal(requests.includes('/api/threads'), false, 'Hidden widgets should not load session lists');
    assert.equal(requests.includes('/rhine-signal-loop.svg'), false, 'Hidden widgets should not load the animation');
    spawn(executable, ['--disable-gpu', 'desktop/main.cjs', '--quit'], { env, windowsHide: true, stdio: 'ignore' }).unref();
    await Promise.race([exited, delay(10000).then(() => { throw Error('Isolated widget did not quit'); })]);
    const stopped = JSON.parse(readFileSync(join(directory, 'widget-status.json'), 'utf8'));
    assert.equal(stopped.ready, false); assert.equal(stopped.exitReason, 'user-quit');
    if (server.exitCode === null) await Promise.race([once(server, 'exit'), delay(3000).then(() => { if (server.exitCode === null) throw Error('Widget exit left its service running'); })]);
    assert.notEqual(server.exitCode, null); assert.equal(existsSync(join(directory, 'quit-demo.request')), true);
  } finally {
    if (widget && widget.exitCode === null) { const closed = once(widget, 'exit'); widget.kill(); await closed; }
    const exited = server.exitCode === null ? once(server, 'exit') : Promise.resolve();
    try { await authenticatedFetch(`https://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Continuer-Client': '1' }, body: '{}' }); } catch {}
    await Promise.race([exited, delay(2000)]); if (server.exitCode === null) { server.kill(); await exited; }
    await delay(200); assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
