import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertServiceIdentity, runtimeError, samePath, serviceUnavailable } from './local-client.js';
import { message, messageFields } from '../public/message.js';
import widgetStateModule from '../server/widget-state.cjs';
const { widgetState, matchesWidgetIdentity } = widgetStateModule;

// The lifecycle knows process roles and readiness. Host I/O is supplied by the
// runtime adapter; constructing it never reads state or starts a process.
export function createLifecycle({ root, dataDir, port, demo = false, platform = process.platform, serviceNode, widgetNode,
  appInfo, request, launch, exists, diagnostic, alive, quit, shutdown,
  wait = delay, now = () => performance.now(), serviceTimeoutMs = 18000, widgetAttempts = 60 }) {
  let starting, opening, stopping, generation = 0;
  const widgetFiles = widgetState(dataDir, port, demo);
  const assertOpen = (expected = generation) => {
    if (expected !== generation || stopping || quit.requested()) throw runtimeError('EXIT_REQUESTED', 'runtime.exited');
  };
  const verify = state => assertServiceIdentity(state, { dataDir, appInfo: appInfo(), platform });

  async function start(expected) {
    assertOpen(expected);
    try {
      const state = await request('/api/state', undefined, { timeoutMs: 2000 });
      assertOpen(expected); return verify(state);
    } catch (error) { if (!serviceUnavailable(error)) throw error; }
    assertOpen(expected);
    if (!serviceNode) throw runtimeError('NODE_MISSING', 'runtime.node_missing');
    // A passive query/open must not restore the saved scheduler automatically.
    const child = launch(serviceNode, [join(root, 'server/index.js'), '--observe-only', ...(demo ? ['--demo'] : [])], 'service', { PORT: String(port) });
    let spawnError;
    const failed = error => { spawnError = error; };
    child.once('error', failed);
    const deadline = now() + serviceTimeoutMs;
    try {
      while (now() < deadline) {
        assertOpen(expected); if (spawnError) throw spawnError;
        await wait(Math.min(150, Math.max(0, deadline - now())));
        assertOpen(expected); if (spawnError) throw spawnError;
        const remaining = Math.ceil(deadline - now());
        if (remaining <= 0) break;
        try {
          const state = await request('/api/state', undefined, { timeoutMs: Math.min(2000, remaining) });
          assertOpen(expected); if (spawnError) throw spawnError;
          return verify(state);
        } catch (error) { if (!serviceUnavailable(error)) throw error; }
      }
      throw runtimeError('SERVICE_START_TIMEOUT', 'runtime.service_timeout');
    } finally { child.removeListener('error', failed); }
  }

  function ensureService() {
    try { assertOpen(); } catch (error) { return Promise.reject(error); }
    const job = starting || { generation };
    if (!starting) {
      starting = job;
      job.promise = start(job.generation).finally(() => { if (starting === job) starting = null; });
    }
    return job.promise;
  }

  async function startService() {
    const expected = generation;
    if (stopping) await stopping;
    assertOpenGeneration(expected);
    quit.clear(); return ensureService();
  }

  function assertOpenGeneration(expected) {
    if (expected !== generation) throw runtimeError('EXIT_REQUESTED', 'runtime.exited');
  }

  function ensureWatcher() {
    if (demo || !diagnostic(join(dataDir, 'autostart-preferences.json'))?.enabled) return;
    const watcher = diagnostic(join(dataDir, 'autostart-status.json'));
    if (samePath(watcher?.pluginRoot, root, platform) && alive(watcher?.pid)) return;
    const native = join(root, 'desktop/continuer-monitor.exe');
    if (exists(native)) launch(native, ['--watch', widgetNode, root, dataDir], 'watcher');
    else launch('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'desktop/watch-codex.ps1'), '-NodePath', widgetNode, '-PluginRoot', root, '-DataDir', dataDir], 'watcher');
  }

  async function open(automatic, expected) {
    assertOpen(expected); await ensureService(); assertOpen(expected);
    const executable = join(root, 'node_modules/electron/dist', platform === 'win32' ? 'electron.exe' : 'electron');
    if (!exists(executable)) throw runtimeError('DESKTOP_MISSING', 'runtime.desktop_missing');
    const child = launch(executable, [join(root, 'desktop/main.cjs'), ...(automatic ? ['--auto'] : [])], 'widget', { ELECTRON_RUN_AS_NODE: undefined, CONTINUER_NODE: widgetNode, CONTINUER_PORT: String(port) });
    let spawnError;
    const failed = error => { spawnError = error; };
    child.once('error', failed);
    try {
      for (let attempt = 0; attempt < widgetAttempts; attempt++) {
        assertOpen(expected); if (spawnError) throw spawnError;
        const widget = diagnostic(widgetFiles.status);
        if (widget?.ready && widget.buildId === appInfo().buildId && matchesWidgetIdentity(widget, widgetFiles.identity, platform) && alive(widget.pid)) {
          return { launched: true, ready: true, mode: widget.follow ? 'follow-codex' : 'independent', ...messageFields(message('runtime.widget_ready')) };
        }
        await wait(150);
      }
      assertOpen(expected); if (spawnError) throw spawnError;
      throw runtimeError('WIDGET_START_TIMEOUT', 'runtime.widget_timeout');
    } finally { child.removeListener('error', failed); }
  }

  async function openWidget({ automatic = false } = {}) {
    if (automatic) assertOpen();
    else {
      const expected = generation;
      if (stopping) await stopping;
      assertOpenGeneration(expected); quit.clear();
    }
    const job = opening || { manual: !automatic, generation };
    if (!opening) {
      opening = job;
      job.promise = open(automatic, job.generation).then(result => {
        assertOpen(job.generation);
        // Manual callers joining automatic startup restore one watcher.
        if (job.manual) ensureWatcher();
        return result;
      }).finally(() => { if (opening === job) opening = null; });
    } else if (!automatic) job.manual = true;
    return job.promise;
  }

  async function stopService() {
    let state;
    try { state = await request('/api/state', undefined, { timeoutMs: 2000 }); }
    catch (error) { if (serviceUnavailable(error)) return { running: false }; throw error; }
    assertServiceIdentity(state, { dataDir, platform });
    await request('/api/shutdown', {}, { timeoutMs: 5000 });
    return { running: false, stopped: true };
  }

  function stopBackground() {
    if (!stopping) {
      generation++; starting = null; opening = null;
      // Publish the stopping state before calling host I/O, which may emit events.
      stopping = Promise.resolve().then(shutdown).finally(() => { stopping = null; });
    }
    return stopping;
  }

  return { ensureService, startService, openWidget, stopService, stopBackground };
}
