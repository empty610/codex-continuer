import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import settings from '../server/config.cjs';
import logging from '../server/logging.cjs';
import { diagnostic, alive } from '../server/health.js';
import access from '../server/access.cjs';
import exitState from '../server/exit-state.cjs';
import localTls from '../server/local-tls.cjs';
import { createLocalClient } from './local-client.js';
import { createLifecycle } from './lifecycle.js';
import { stopBackground as stopOwnedBackground } from './shutdown.js';

// This adapter is the only place where the lifecycle binds to this host.
export const { root, dataDir, port } = settings;
export const origin = `https://127.0.0.1:${port}`;
const demo = process.env.CONTINUER_DEMO === '1';
export const readAccessToken = () => access.readToken(dataDir, demo);
export const request = createLocalClient({
  origin, readAccessToken,
  identityOptions: () => localTls.requestOptions(dataDir, demo),
  fetchLocal: (...args) => localTls.fetchLocal(...args),
});

export function launch(command, args, name, extraEnv = {}) {
  mkdirSync(dataDir, { recursive: true });
  logging.rotateLogs(dataDir);
  const out = openSync(join(dataDir, `${name}-stdout.log`), 'a');
  let err;
  try {
    err = openSync(join(dataDir, `${name}-stderr.log`), 'a');
    const child = spawn(command, args, { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err], env: { ...process.env, ...extraEnv, CONTINUER_DATA_DIR: dataDir } });
    child.on('error', () => {}); child.unref(); return child;
  } finally { closeSync(out); if (err !== undefined) closeSync(err); }
}

const lifecycle = createLifecycle({
  root, dataDir, port, demo,
  serviceNode: settings.config.nodePath || (process.versions.electron ? process.env.CONTINUER_NODE || 'node' : process.execPath),
  widgetNode: settings.config.nodePath || process.env.CONTINUER_NODE || process.execPath,
  appInfo: settings.appInfo, request, launch, exists: existsSync, diagnostic, alive,
  quit: { requested: () => exitState.requested(dataDir, demo), clear: () => exitState.clear(dataDir, demo) },
  shutdown: () => stopOwnedBackground({ root, dataDir, request, demo }),
});
export const { ensureService, startService, openWidget, stopService, stopBackground } = lifecycle;
