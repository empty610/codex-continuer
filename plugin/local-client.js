import { resolve } from 'node:path';
import { isMessage, message, MessageError } from '../public/message.js';

export function runtimeError(code, id) { return Object.assign(new MessageError(message(id)), { code }); }
export const serviceUnavailable = error => error?.code === 'TLS_IDENTITY_MISSING' || error?.cause?.code === 'ECONNREFUSED';
export function samePath(left, right, platform = process.platform) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const normalize = value => platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

// Reads require the current build; shutdown may deliberately address an older
// build. Both require the expected data directory, and full exit also its root.
export function assertServiceIdentity(state, { dataDir, root, appInfo, platform = process.platform }) {
  if (state?.app !== 'codex-continuer') throw runtimeError('SERVICE_OWNER_MISMATCH', 'runtime.port_in_use');
  if (appInfo && (state.protocolVersion !== appInfo.protocolVersion || state.buildId !== appInfo.buildId)) {
    throw runtimeError('SERVICE_BUILD_MISMATCH', 'runtime.build_mismatch');
  }
  if (!samePath(state.diagnostics?.dataDir, dataDir, platform)) {
    throw runtimeError('SERVICE_OWNER_MISMATCH', 'runtime.directory_mismatch');
  }
  if (root !== undefined && !samePath(state.diagnostics?.projectRoot, root, platform)) throw runtimeError('SERVICE_OWNER_MISMATCH', 'runtime.root_mismatch');
  return state;
}

export function createLocalClient({ origin, readAccessToken, identityOptions, fetchLocal }) {
  return async function request(path, payload, { timeoutMs = 35000 } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('\\') || new URL(origin + path).origin !== origin) throw Error('Invalid API path');
    const token = readAccessToken();
    const response = await fetchLocal(origin + path, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'X-Continuer-Client': '1' }) },
      ...(payload === undefined ? {} : { method: 'POST', body: JSON.stringify(payload) }),
    }, identityOptions());
    const result = await response.json();
    if (!response.ok) throw new MessageError(isMessage(result.errorInfo) ? result.errorInfo : null, result.error || `HTTP ${response.status}`);
    return result;
  };
}
