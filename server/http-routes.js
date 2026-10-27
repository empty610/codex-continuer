import { readJsonBody } from './http-body.js';
import { ClientError } from './http-policy.js';

export function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Route dispatch owns HTTP translation; Manager retains all execution policy.
export function createApiRouter({ manager, health, stream, rpc, demo, summary, stop }) {
  const mutations = new Map([
    ['/api/refresh', () => manager.refresh()],
    ['/api/settings', input => manager.updateSettings(input)],
    ['/api/storage/recover', input => manager.recoverStorage(input.source)],
    ['/api/tasks', input => manager.create(input)],
    ['/api/import', input => {
      if (input.note !== undefined && input.prompt !== undefined) throw new ClientError('请仅提供监测备注 note；prompt 为旧版兼容字段');
      return manager.importThread(input.threadId, input.note ?? input.prompt);
    }],
    ['/api/approval', input => manager.approve(input.id, input.decision, input.token)],
  ]);
  if (demo) mutations.set('/api/demo/quota', input => { rpc.used = input.exhausted ? 100 : 35; return manager.refresh(); });
  return async (req, res, url) => {
    const path = url.pathname;
    if (!path.startsWith('/api/')) return false;
    if (req.method === 'GET') {
      if (path === '/api/state') json(res, 200, summary());
      else if (path === '/api/health') json(res, 200, health.snapshot());
      else if (path === '/api/logs') json(res, 200, { logs: manager.state.logs });
      else if (/^\/api\/tasks\/[^/]+$/.test(path)) {
        const task = manager.taskSnapshot(decodeURIComponent(path.split('/').pop()));
        json(res, task ? 200 : 404, task ? { task } : { error: '任务不存在' });
      } else if (path === '/api/events') {
        if (!stream.add(req, res, summary())) json(res, 429, { error: '实时连接已达上限，请关闭多余页面' });
      } else if (path === '/api/threads') json(res, 200, await manager.listThreads(url.searchParams.get('cursor')));
      else return false;
      return true;
    }
    if (req.method !== 'POST') return false;
    if (/^\/api\/approvals\/[^/]+$/.test(path)) {
      const input = await readJsonBody(req), approval = manager.approvals.get(decodeURIComponent(path.split('/').pop()));
      if (typeof input.token === 'string' && approval && approval.detailToken === input.token) json(res, 200, { approval });
      else json(res, 404, { error: '授权请求已失效' });
      return true;
    }
    const taskId = /^\/api\/tasks\/[^/]+$/.test(path) ? decodeURIComponent(path.split('/').pop()) : null;
    const mutation = mutations.get(path) || (taskId !== null ? input => manager.action(taskId, input.action, input.value) : null);
    if (!mutation && path !== '/api/shutdown') return false;
    const input = await readJsonBody(req);
    if (path === '/api/shutdown') {
      await manager.safelyAsync(() => manager.shutdown()); json(res, 200, { stopped: true }); setTimeout(() => stop('manual-shutdown'), 150); return true;
    }
    await mutation(input); json(res, 200, summary()); return true;
  };
}
