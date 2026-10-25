// A fragment is never sent in an HTTP URL. Clear it before making requests.
// sessionStorage is scoped to this origin (including its port), unlike cookies.
const storageKey = 'continuer-access';
if (typeof window !== 'undefined' && typeof location !== 'undefined') {
  const token = new URLSearchParams(location.hash.slice(1)).get('access');
  if (token) {
    history.replaceState(null, '', location.pathname + location.search);
    if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem(storageKey, token);
  }
}
export function accessHeaders() {
  const token = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(storageKey);
  return token ? { Authorization: 'Bearer ' + token } : {};
}

// Native EventSource cannot send authorization headers. Preserve its small
// onmessage/onerror/close contract using a bounded fetch stream with retries.
export class AuthenticatedSource {
  constructor(path, { request = fetch, retryMs = 3000 } = {}) {
    Object.assign(this, { path, request, retryMs }); this.closed = false;
    this.connect();
  }
  async connect() {
    while (!this.closed) {
      const controller = this.controller = new AbortController();
      let reader, retry = true;
      try {
        const response = await this.request(this.path, { headers: accessHeaders(), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal });
        if (!response.ok) { retry = response.status !== 401; throw Error(response.status === 401 ? '请用启动脚本重新打开 Continuer' : '实时连接失败'); }
        reader = response.body.getReader();
        const decoder = new TextDecoder(); let pending = '', data = [], size = 0;
        while (!this.closed) {
          const chunk = await reader.read(); if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let end;
          while ((end = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
            if (line.length + size > 1024 * 1024) throw Error('实时消息超过长度限制');
            if (!line) { if (data.length) this.onmessage?.({ data: data.join('\n') }); data = []; size = 0; }
            else if (line.startsWith('data:')) { const value = line.slice(5).replace(/^ /, ''); data.push(value); size += value.length; }
            if (this.closed) break;
          }
          if (pending.length + size > 1024 * 1024) throw Error('实时消息超过长度限制');
        }
        if (!this.closed) throw Error('实时连接已断开');
      } catch (error) { if (!this.closed) this.onerror?.(error); }
      finally { controller.abort(); await reader?.cancel().catch(() => {}); }
      if (this.closed || !retry) return;
      await new Promise(resolve => { this.resume = resolve; this.timer = setTimeout(resolve, this.retryMs); });
    }
  }
  close() { this.closed = true; this.controller?.abort(); clearTimeout(this.timer); this.resume?.(); }
}
