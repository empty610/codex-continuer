import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import settings from '../server/config.cjs';
import logging from '../server/logging.cjs';
import { diagnostic, alive } from '../server/health.js';
import access from '../server/access.cjs';
import exitState from '../server/exit-state.cjs';

export const root = settings.root;
const config = settings.config;
export const dataDir = settings.dataDir;
export const port = settings.port;
export const origin = `http://127.0.0.1:${port}`;
export const readAccessToken = () => access.readToken(dataDir, process.env.CONTINUER_DEMO === '1');
export async function request(path, payload, { timeoutMs = 35000 } = {}) {
  const token = readAccessToken();
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'X-Continuer-Client': '1' }) }, ...(payload === undefined ? {} : { method: 'POST', body: JSON.stringify(payload) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
export function launch(command, args, name, extraEnv = {}) {
  mkdirSync(dataDir, { recursive: true });
  logging.rotateLogs(dataDir);
  const out = openSync(join(dataDir, `${name}-stdout.log`), 'a');
  const err = openSync(join(dataDir, `${name}-stderr.log`), 'a');
  try {
    const child = spawn(command, args, { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err], env: { ...process.env, ...extraEnv, CONTINUER_DATA_DIR: dataDir } });
    child.on('error', () => {}); child.unref(); return child;
  } finally { closeSync(out); closeSync(err); }
}
let starting;
function verifiedService(state) {
  if (state.app !== 'codex-continuer') throw new Error('Port belongs to another application');
  if (state.protocolVersion !== settings.appInfo().protocolVersion || state.buildId !== settings.appInfo().buildId) throw new Error('运行服务与当前插件构建不一致，请先停止并重新启动 Continuer');
  const directory = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  if (typeof state.diagnostics?.dataDir !== 'string' || directory(state.diagnostics.dataDir) !== directory(dataDir)) throw new Error('该端口服务使用不同的数据目录，请检查路径后重新启动 Continuer');
  return state;
}
export async function ensureService() {
  if (exitState.requested(dataDir, process.env.CONTINUER_DEMO === '1')) throw Error('Continuer 已退出，请先手动打开挂件。');
  if (starting) return starting;
  starting = (async () => {
    try {
      const state = await request('/api/state');
      return verifiedService(state);
    } catch (error) {
      if (!error.cause || error.cause.code !== 'ECONNREFUSED') throw error;
    }
    const node = config.nodePath || (process.versions.electron ? process.env.CONTINUER_NODE || 'node' : process.execPath);
    if (!node) throw new Error('缺少 Node.js 路径，请重新运行插件安装器');
    if (exitState.requested(dataDir, process.env.CONTINUER_DEMO === '1')) throw Error('Continuer 已退出，请先手动打开挂件。');
    // Opening a widget or reading MCP state never restores saved scheduling by itself.
    const child = launch(node, [join(root, 'server/index.js'), '--observe-only', ...(process.env.CONTINUER_DEMO === '1' ? ['--demo'] : [])], 'service', { PORT: String(port) });
    let spawnError; child.once('error', e => { spawnError = e; });
    for (let i = 0; i < 60; i++) {
      if (spawnError) throw spawnError;
      await new Promise(resolve => setTimeout(resolve, 150));
      let state;
      try { state = await request('/api/state'); } catch (error) { if (error.cause?.code === 'ECONNREFUSED') continue; throw error; }
      return verifiedService(state);
    }
    throw new Error('本地服务启动失败，请查看 data/service-stderr.log');
  })().finally(() => { starting = null; });
  return starting;
}
export async function openWidget({ automatic = false } = {}) {
  if (automatic && exitState.requested(dataDir, process.env.CONTINUER_DEMO === '1')) throw Error('Continuer 已退出，自动启动已暂停。');
  if (!automatic) exitState.clear(dataDir, process.env.CONTINUER_DEMO === '1');
  await ensureService();
  const executable = join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  if (!existsSync(executable)) throw new Error('缺少桌面运行时，请在项目目录运行 npm install 后重新构建插件');
  launch(executable, [join(root, 'desktop/main.cjs'), ...(automatic ? ['--auto'] : [])], 'widget', { ELECTRON_RUN_AS_NODE: undefined, CONTINUER_NODE: config.nodePath || process.execPath, CONTINUER_PORT: String(port) });
  for (let attempt = 0; attempt < 60; attempt++) {
    const widget = diagnostic(join(dataDir, 'widget-status.json'));
    if (widget?.ready && widget.buildId === settings.appInfo().buildId && alive(widget.pid)) {
      const watcher = diagnostic(join(dataDir, 'autostart-status.json'));
      const currentWatcher = typeof watcher?.pluginRoot === 'string' && resolve(watcher.pluginRoot).toLowerCase() === resolve(root).toLowerCase() && alive(watcher.pid);
      if (!automatic && process.env.CONTINUER_DEMO !== '1' && diagnostic(join(dataDir, 'autostart-preferences.json'))?.enabled && !currentWatcher) {
        const node = config.nodePath || process.env.CONTINUER_NODE || process.execPath, native = join(root, 'desktop/continuer-monitor.exe');
        if (existsSync(native)) launch(native, ['--watch', node, root, dataDir], 'watcher');
        else launch('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'desktop/watch-codex.ps1'), '-NodePath', node, '-PluginRoot', root, '-DataDir', dataDir], 'watcher');
      }
      return { launched: true, ready: true, mode: widget.follow ? 'follow-codex' : 'independent', message: '挂件已就绪。可使用 Ctrl+Alt+C 展开。' };
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('挂件未在时限内就绪，请查看 /api/health 和 widget-stderr.log');
}
