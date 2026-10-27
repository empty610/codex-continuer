import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { stopBackground } from '../plugin/shutdown.js';
import { alive } from '../server/health.js';
import exitState from '../server/exit-state.cjs';

function directory(t) { const parent = realpathSync(tmpdir()), dir = mkdtempSync(join(parent, 'continuer-exit-')); t.after(() => { assert.equal(dirname(realpathSync(dir)), parent); rmSync(dir, { recursive: true, force: true }); }); return dir; }
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
  assert.deepEqual(f.calls, [['watcher', undefined], '/api/state', '/api/shutdown', ['service', 123]]);
  assert.equal(exitState.requested(f.options.dataDir), true);
});

test('shutdown timeouts still run verified process cleanup', async t => {
  const f = fixture(t); f.options.request = async () => { throw Object.assign(Error('not reachable'), { cause: { code: 'ECONNREFUSED' } }); };
  await stopBackground(f.options); assert.deepEqual(f.calls, [['watcher', undefined], ['service', 123]]);
});

test('a service on another data directory never receives a shutdown request', async t => {
  const f = fixture(t); f.options.request = async path => { assert.notEqual(path, '/api/shutdown'); return { app: 'other' }; };
  await stopBackground(f.options); assert.deepEqual(f.calls, [['watcher', undefined], ['service', 123]]);
});

test('demo exit leaves live markers and the startup watcher alone', async t => {
  const f = fixture(t); f.options.demo = true; f.options.cleanup = async phase => { assert.equal(phase, 'service'); };
  f.options.request = async path => path === '/api/shutdown' ? {} : { app: 'codex-continuer', diagnostics: { projectRoot: f.options.root, dataDir: f.options.dataDir, pid: 123 } };
  f.options.isAlive = () => false; await stopBackground(f.options);
  assert.equal(exitState.requested(f.options.dataDir, true), true); assert.equal(exitState.requested(f.options.dataDir), false);
});

test('passive reads and automatic opening do not restart an exited app; manual opening clears the latch', t => {
  const dataDir = directory(t); exitState.mark(dataDir);
  const code = `const localTls=(await import(${JSON.stringify(new URL('../server/local-tls.cjs', import.meta.url).href)})).default;localTls.requestOptions=()=>({});let calls=0;localTls.fetchLocal=async()=>{calls++;throw Error('fixture network failure')};const runtime=await import(${JSON.stringify(new URL('../plugin/runtime.js', import.meta.url).href)});let blocked=0;for(const action of [()=>runtime.ensureService(),()=>runtime.openWidget({automatic:true})])try{await action()}catch(error){if(error.message.includes('已退出'))blocked++}const before=calls;try{await runtime.openWidget()}catch{};console.log(JSON.stringify({blocked,before,after:calls}));`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', code], { env: { ...process.env, CONTINUER_DATA_DIR: dataDir, CONTINUER_DEMO: '' }, windowsHide: true, encoding: 'utf8' }));
  assert.deepEqual(result, { blocked: 2, before: 0, after: 1 }); assert.equal(exitState.requested(dataDir), false);
});

test('verified force cleanup terminates an owned service tree and refuses unrelated PIDs', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const dataDir = directory(t), root = join(dataDir, 'plugin'); mkdirSync(join(root, 'server'), { recursive: true });
  const script = join(root, 'server/index.js'), childFile = join(dataDir, 'child.json');
  writeFileSync(script, `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('node:fs').writeFileSync(${JSON.stringify(childFile)},JSON.stringify({pid:child.pid}));setInterval(()=>{},1000);`);
  const server = spawn(process.execPath, [script], { windowsHide: true, stdio: 'ignore' }), exited = once(server, 'exit');
  let childPid;
  t.after(async () => { if (server.exitCode === null) server.kill(); if (childPid && alive(childPid)) process.kill(childPid); });
  const helper = fileURLToPath(new URL('../plugin/stop-owned.ps1', import.meta.url));
  const args = pid => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-PluginRoot', root, '-DataDir', dataDir, '-Phase', 'service', '-ServicePid', String(pid)];
  const execute = promisify(execFile);
  for (let i = 0; i < 40; i++) { try { childPid = JSON.parse(readFileSync(childFile, 'utf8')).pid; break; } catch { await delay(50); } }
  assert.ok(childPid);
  await assert.rejects(execute('powershell.exe', args(process.pid), { windowsHide: true, timeout: 10000 }), /Refusing to stop/);
  assert.equal(alive(process.pid), true);
  await execute('powershell.exe', args(server.pid), { windowsHide: true, timeout: 10000 }); await exited;
  for (let i = 0; i < 30 && alive(childPid); i++) await delay(50);
  assert.equal(alive(childPid), false);
});

test('watcher cleanup recognizes quoted --watch arguments used by the startup bootstrap', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const dataDir = directory(t), root = join(dataDir, 'plugin'), desktop = join(root, 'desktop'); mkdirSync(desktop, { recursive: true });
  const source = join(dataDir, 'watcher.cs'), executable = join(desktop, 'continuer-monitor.exe');
  mkdirSync(join(root, 'plugin'), { recursive: true });
  const launcherPidFile = join(dataDir, 'launcher.json');
  writeFileSync(join(root, 'plugin/open.js'), `require('node:fs').writeFileSync(${JSON.stringify(launcherPidFile)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`);
  writeFileSync(source, 'class Watcher { static void Main(string[] args) { var info=new System.Diagnostics.ProcessStartInfo(args[1], "\\\"" + System.IO.Path.Combine(args[2],"plugin/open.js") + "\\\"");info.UseShellExecute=false;info.CreateNoWindow=true;System.Diagnostics.Process.Start(info);System.Threading.Thread.Sleep(-1); } }');
  execFileSync(join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:winexe', '/out:' + executable, source], { windowsHide: true });
  const watcher = spawn(executable, ['"--watch"', '"' + process.execPath + '"', '"' + root + '"', '"' + dataDir + '"'], { windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' });
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
