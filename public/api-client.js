import { accessHeaders } from './access.js';
import { t as tr } from './i18n.js';
import { isMessage, message, MessageError } from './message.js';

// Both interfaces use the same transport policy and bounded request lifetime.
export function createApiClient({ request = (...args) => fetch(...args), timeoutMs = 35000 } = {}) {
  return async function api(path, body) {
    const write = body !== undefined;
    const response = await request(path, {
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'omit',
      redirect: 'error',
      headers: {
        ...accessHeaders(),
        ...(write ? { 'Content-Type': 'application/json', 'X-Continuer-Client': '1' } : {}),
      },
      ...(write ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new MessageError(isMessage(data.errorInfo) ? data.errorInfo : data.error ? null : message('ui.request_failed'), data.error || tr("ui.request_failed"));
    return data;
  };
}
