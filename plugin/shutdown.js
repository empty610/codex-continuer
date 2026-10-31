import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import exitState from '../server/exit-state.cjs';
import { alive, diagnostic } from '../server/health.js';
import { assertServiceIdentity } from './local-client.js';

export async function stopBackground({ root, dataDir, request, demo = false, cleanup = async (phase, pid = 0, snapshot = []) => {
  const stdout = await new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'plugin/stop-owned.ps1'), '-PluginRoot', root, '-DataDir', dataDir, '-Phase', phase, '-ServicePid', String(pid), ...(phase === 'service' ? ['-ReadSnapshot'] : [])], { windowsHide: true, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(phase === 'service' ? JSON.stringify(snapshot) : '');
  });
  if (phase === 'capture') return JSON.parse(stdout);
}, isAlive = alive, wait = delay, graceMs = 2500 }) {
  // Explicit reopening clears this latch; passive MCP reads and autostart do not.
  exitState.mark(dataDir, demo);
  const errors = [];
  if (!demo) try { await cleanup('watcher'); } catch (error) { errors.push(error.message); }
  let pid = diagnostic(join(dataDir, demo ? 'demo-service.lock' : 'service.lock'))?.pid;
  let verified = false, snapshot = [];
  try {
    const state = await request('/api/state', undefined, { timeoutMs: 2000 });
    assertServiceIdentity(state, { root, dataDir });
    pid = state.diagnostics.pid;
    verified = true;
  } catch (error) {
    if (error.cause?.code !== 'ECONNREFUSED') console.error('正常停止未完成，将核验本应用进程后结束：' + error.message);
  }
  // Preserve process identities before graceful shutdown can orphan descendants.
  if (Number.isInteger(pid) && pid > 0) {
    try { snapshot = await cleanup('capture', pid) || []; } catch (error) { errors.push(error.message); }
  }
  if (verified) try { await request('/api/shutdown', {}, { timeoutMs: 5000 }); }
  catch (error) { console.error('正常停止未完成，将核验本应用进程后结束：' + error.message); }
  for (let elapsed = 0; Number.isInteger(pid) && pid > 0 && isAlive(pid) && elapsed < graceMs; elapsed += 100) await wait(100);
  try { await cleanup('service', Number.isInteger(pid) && pid > 0 ? pid : 0, snapshot); } catch (error) { errors.push(error.message); }
  if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) errors.push('Continuer service is still running.');
  if (errors.length) throw Error(errors.join('\n'));
}
