import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { stopBackground } from '../plugin/shutdown.js';
import { alive } from '../server/health.js';
import exitState from '../server/exit-state.cjs';

function directory(t) { const parent = realpathSync.native(tmpdir()), dir = mkdtempSync(join(parent, 'continuer-exit-')); t.after(() => { assert.equal(dirname(realpathSync.native(dir)), parent); rmSync(dir, { recursive: true, force: true }); }); return dir; }
function fixture(t) {
  const dataDir = directory(t), root = join(dataDir, 'plugin'), calls = []; let running = true;
  writeFileSync(join(dataDir, 'service.lock'), JSON.stringify({ pid: 123 }));
  const options = { root, dataDir, graceMs: 0, isAlive: () => running,
    request: async path => { calls.push(path); if (path === '/api/shutdown') { running = false; return {}; } return { app: 'codex-continuer', diagnostics: { projectRoot: root, dataDir, pid: 123 } }; },
    cleanup: async (phase, pid) => { assert.equal(exitState.requested(dataDir), true); calls.push([phase, pid]); if (phase === 'service') running = false; },
  };
  return { options, calls };
}

test('exit latches before stopping the watcher and shuts down only its service', async t => {
  const f = fixture(t); await stopBackground(f.options);
  assert.deepEqual(f.calls, [['watcher', undefined], '/api/state', ['capture', 123], '/api/shutdown', ['service', 123]]);
  assert.equal(exitState.requested(f.options.dataDir), true);
});

test('shutdown timeouts still run verified process cleanup', async t => {
  const f = fixture(t); f.options.request = async () => { throw Object.assign(Error('not reachable'), { cause: { code: 'ECONNREFUSED' } }); };
  await stopBackground(f.options); assert.deepEqual(f.calls, [['watcher', undefined], ['capture', 123], ['service', 123]]);
});

test('a service on another data directory never receives a shutdown request', async t => {
  const f = fixture(t); f.options.request = async path => { assert.notEqual(path, '/api/shutdown'); return { app: 'other' }; };
  await stopBackground(f.options); assert.deepEqual(f.calls, [['watcher', undefined], ['capture', 123], ['service', 123]]);
});

test('demo exit leaves live markers and the startup watcher alone', async t => {
  const f = fixture(t); f.options.demo = true; f.options.cleanup = async phase => { assert.ok(['capture', 'service'].includes(phase)); };
  f.options.request = async path => path === '/api/shutdown' ? {} : { app: 'codex-continuer', diagnostics: { projectRoot: f.options.root, dataDir: f.options.dataDir, pid: 123 } };
  f.options.isAlive = () => false; await stopBackground(f.options);
  assert.equal(exitState.requested(f.options.dataDir, true), true); assert.equal(exitState.requested(f.options.dataDir), false);
});

test('exit cleans captured descendants even after the service exits gracefully', async t => {
  const f = fixture(t), snapshot = [{ pid: 123 }, { pid: 456 }]; let captured = false, cleaned = false;
  const request = f.options.request;
  f.options.request = async (...args) => { if (args[0] === '/api/shutdown') assert.equal(captured, true); return request(...args); };
  f.options.cleanup = async (phase, pid, saved) => {
    if (phase === 'capture') { captured = true; return snapshot; }
    if (phase === 'service') { assert.equal(f.options.isAlive(pid), false); assert.equal(saved, snapshot); cleaned = true; }
  };
  await stopBackground(f.options); assert.equal(cleaned, true);
});

test('snapshot failure still attempts graceful shutdown and verified force cleanup', async t => {
  const f = fixture(t), cleanup = f.options.cleanup;
  f.options.cleanup = async (...args) => { if (args[0] === 'capture') throw Error('snapshot unavailable'); return cleanup(...args); };
  await assert.rejects(stopBackground(f.options), /snapshot unavailable/);
  assert.ok(f.calls.includes('/api/shutdown')); assert.deepEqual(f.calls.at(-1), ['service', 123]);
});

test('full exit removes orphaned descendants without stopping an unrelated process', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const dataDir = directory(t), root = join(dataDir, '插件 with spaces'); mkdirSync(join(root, 'server'), { recursive: true }); mkdirSync(join(root, 'plugin'));
  const script = join(root, 'server/index.js'), childFile = join(dataDir, 'child.json');
  copyFileSync(new URL('./fixtures/shutdown-owned-service.cjs', import.meta.url), script);
  copyFileSync(new URL('../plugin/stop-owned.ps1', import.meta.url), join(root, 'plugin/stop-owned.ps1'));
  const server = spawn(process.execPath, [script, childFile], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }), exited = once(server, 'exit');
  let childPid;
  t.after(() => { if (server.exitCode === null) server.kill(); if (childPid && alive(childPid)) process.kill(childPid); });
  for (let i = 0; i < 40; i++) { try { childPid = JSON.parse(readFileSync(childFile, 'utf8')).pid; break; } catch { await delay(50); } }
  assert.ok(childPid);
  let orphanObserved = false;
  await stopBackground({ root, dataDir, demo: true, request: async path => {
    if (path === '/api/state') return { app: 'codex-continuer', diagnostics: { projectRoot: root, dataDir, pid: server.pid } };
    server.send('exit'); await exited;
    orphanObserved = alive(childPid);
    return {};
  } });
  for (let i = 0; i < 30 && alive(childPid); i++) await delay(50);
  assert.equal(orphanObserved, true); assert.equal(alive(childPid), false); assert.equal(alive(process.pid), true);
});

test('passive reads and automatic opening do not restart an exited app; manual opening clears the latch', t => {
  const dataDir = directory(t); exitState.mark(dataDir);
  const probe = fileURLToPath(new URL('./fixtures/shutdown-passive.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [probe], { env: { ...process.env, CONTINUER_DATA_DIR: dataDir, CONTINUER_DEMO: '' }, windowsHide: true, encoding: 'utf8' }));
  assert.deepEqual(result, { blocked: 2, before: 0, after: 1 }); assert.equal(exitState.requested(dataDir), false);
});

test('verified force cleanup terminates an owned service tree and refuses unrelated PIDs', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const dataDir = directory(t), root = join(dataDir, 'plugin'); mkdirSync(join(root, 'server'), { recursive: true });
  const script = join(root, 'server/index.js'), childFile = join(dataDir, 'child.json');
  copyFileSync(new URL('./fixtures/shutdown-owned-service.cjs', import.meta.url), script);
  const server = spawn(process.execPath, [script, childFile], { windowsHide: true, stdio: 'ignore' }), exited = once(server, 'exit');
  let childPid;
  t.after(async () => { if (server.exitCode === null) server.kill(); if (childPid && alive(childPid)) process.kill(childPid); });
  const helper = fileURLToPath(new URL('../plugin/stop-owned.ps1', import.meta.url));
  const args = pid => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-PluginRoot', root, '-DataDir', dataDir, '-Phase', 'service', '-ServicePid', String(pid)];
  const execute = promisify(execFile);
  for (let i = 0; i < 40; i++) { try { childPid = JSON.parse(readFileSync(childFile, 'utf8')).pid; break; } catch { await delay(50); } }
  assert.ok(childPid);
  await assert.rejects(execute('powershell.exe', args(process.pid), { windowsHide: true, timeout: 10000 }), /Refusing to stop/);
  assert.equal(alive(process.pid), true);
  const captureArgs = args(server.pid); captureArgs[captureArgs.indexOf('service')] = 'capture';
  const snapshot = JSON.parse((await execute('powershell.exe', captureArgs, { windowsHide: true, timeout: 10000 })).stdout);
  assert.ok(snapshot.some(item => item.pid === childPid));
  // Recycled PIDs can have the same executable and command line; creation time distinguishes them.
  for (const item of snapshot) item.created = '0';
  await new Promise((resolve, reject) => {
    const cleaner = execFile('powershell.exe', [...args(server.pid), '-ReadSnapshot'], { windowsHide: true, timeout: 10000 }, error => error ? reject(error) : resolve());
    cleaner.stdin.end(JSON.stringify(snapshot));
  });
  assert.equal(alive(server.pid), true); assert.equal(alive(childPid), true);
  await execute('powershell.exe', args(server.pid), { windowsHide: true, timeout: 10000 }); await exited;
  for (let i = 0; i < 30 && alive(childPid); i++) await delay(50);
  assert.equal(alive(childPid), false);
});

test('watcher cleanup recognizes quoted --watch arguments used by the startup bootstrap', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const dataDir = directory(t), root = join(dataDir, 'plugin'), desktop = join(root, 'desktop'); mkdirSync(desktop, { recursive: true });
  const source = join(dataDir, 'watcher.cs'), executable = join(desktop, 'continuer-monitor.exe');
  mkdirSync(join(root, 'plugin'), { recursive: true });
  const launcherPidFile = join(dataDir, 'launcher.json');
  copyFileSync(new URL('./fixtures/shutdown-owned-launcher.cjs', import.meta.url), join(root, 'plugin/open.js'));
  writeFileSync(source, 'class Watcher { static void Main(string[] args) { var info=new System.Diagnostics.ProcessStartInfo(args[1], "\\\"" + System.IO.Path.Combine(args[2],"plugin/open.js") + "\\\"");info.UseShellExecute=false;info.CreateNoWindow=true;System.Diagnostics.Process.Start(info);System.Threading.Thread.Sleep(-1); } }');
  execFileSync(join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:winexe', '/out:' + executable, source], { windowsHide: true });
  const watcher = spawn(executable, ['"--watch"', '"' + process.execPath + '"', '"' + root + '"', '"' + dataDir + '"'], { env: { ...process.env, CONTINUER_TEST_LAUNCHER_PID_FILE: launcherPidFile }, windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' });
  const exited = once(watcher, 'exit'); writeFileSync(join(dataDir, 'autostart-status.json'), JSON.stringify({ pid: watcher.pid, pluginRoot: root }));
  let launcherPid;
  try {
    for (let i = 0; i < 40; i++) { try { launcherPid = JSON.parse(readFileSync(launcherPidFile, 'utf8')).pid; break; } catch { await delay(50); } }
    assert.ok(launcherPid);
    const helper = fileURLToPath(new URL('../plugin/stop-owned.ps1', import.meta.url));
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-PluginRoot', root, '-DataDir', dataDir, '-Phase', 'watcher'], { windowsHide: true, timeout: 8000 });
    for (let i = 0; i < 30 && watcher.exitCode === null; i++) await delay(50);
    assert.equal(alive(watcher.pid), false); assert.equal(alive(launcherPid), false); await exited;
  } finally { if (watcher.exitCode === null) { watcher.kill(); await exited; } if (launcherPid && alive(launcherPid)) process.kill(launcherPid); }
});
