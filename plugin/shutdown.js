import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import exitState from '../server/exit-state.cjs';
import { alive, diagnostic } from '../server/health.js';

const execute = promisify(execFile);
const canonical = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
export async function stopBackground({ root, dataDir, request, demo = false, cleanup = async (phase, pid = 0) => {
  await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'plugin/stop-owned.ps1'), '-PluginRoot', root, '-DataDir', dataDir, '-Phase', phase, '-ServicePid', String(pid)], { windowsHide: true, timeout: 10000 });
}, isAlive = alive, wait = delay, graceMs = 2500 }) {
  // Explicit reopening clears this latch; passive MCP reads and autostart do not.
  exitState.mark(dataDir, demo);
  const errors = [];
  if (!demo) try { await cleanup('watcher'); } catch (error) { errors.push(error.message); }
  let pid = diagnostic(join(dataDir, demo ? 'demo-service.lock' : 'service.lock'))?.pid;
  try {
    const state = await request('/api/state', undefined, { timeoutMs: 2000 });
    if (state.app !== 'codex-continuer' || typeof state.diagnostics?.projectRoot !== 'string' || typeof state.diagnostics?.dataDir !== 'string'
      || canonical(state.diagnostics.projectRoot) !== canonical(root) || canonical(state.diagnostics.dataDir) !== canonical(dataDir)) throw Error('Refusing to shut down another application or data directory.');
    pid = state.diagnostics.pid;
    await request('/api/shutdown', {}, { timeoutMs: 5000 });
  } catch (error) {
    if (error.cause?.code !== 'ECONNREFUSED') console.error('正常停止未完成，将核验本应用进程后结束：' + error.message);
  }
  for (let elapsed = 0; Number.isInteger(pid) && pid > 0 && isAlive(pid) && elapsed < graceMs; elapsed += 100) await wait(100);
  try { await cleanup('service', Number.isInteger(pid) && pid > 0 ? pid : 0); } catch (error) { errors.push(error.message); }
  if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) errors.push('Continuer service is still running.');
  if (errors.length) throw Error(errors.join('\n'));
}
