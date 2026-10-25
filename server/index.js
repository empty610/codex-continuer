import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexRpc } from './rpc.js';
import { DemoRpc, demoState } from './demo.js';
import { Store } from './store.js';
import { Manager } from './manager.js';
import { QueueSender } from './queue-sender.js';
import { StateStream } from './events.js';
import { Health } from './health.js';
import config from './config.cjs';
import logging from './logging.cjs';
import { acquireLease } from './lease.js';
import { createApiRouter, json } from './http-routes.js';
import { createStaticAssets } from './static-assets.js';
import access from './access.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const port = Number(process.env.PORT || (demo ? 4318 : config.port));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid Continuer port');
const origin = `http://127.0.0.1:${port}`;
const dataDir = config.dataDir;
logging.installLogs(dataDir, demo ? 'demo' : 'service');
logging.rotateLogs(dataDir);
const releaseLease = await acquireLease(dataDir, demo ? 'demo-service' : 'service');
process.once('exit', releaseLease);
const accessToken = access.createToken(dataDir, demo);
const store = new Store(resolve(dataDir, demo ? 'demo-state.json' : 'state.json'));
if (demo) { try { if (!store.load()) store.save(demoState()); } catch { /* Manager exposes recovery without overwriting damaged data. */ } }
const rpc = demo ? new DemoRpc() : new CodexRpc();
const manager = new Manager(rpc, store, { demo, observeOnly: process.argv.includes('--observe-only'), wakeSender: demo ? { send: async () => {} } : new QueueSender() });
const stream = new StateStream();
const health = new Health(dataDir, manager, stream);
const summary = () => ({ ...manager.snapshot({ details: false }), diagnostics: health.snapshot() });
let broadcastTimer;
manager.on('change', () => {
  if (!stream.clients.size || broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (!stream.clients.size) return;
    stream.broadcast(summary());
  }, 150);
});
manager.on('persistence-error', error => console.error(`输出合并保存失败：${error.message}`));
manager.on('operation-error', error => console.error(`操作未完成：${error.message}`));
const routeApi = createApiRouter({ manager, health, stream, rpc, demo, summary, stop });
const serveStatic = createStaticAssets(root);
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  // Loopback binding + exact Host + same-origin mutations prevent DNS rebinding/CSRF.
  if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { error: '请使用 127.0.0.1 访问' });
  if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: '跨站请求被拒绝' });
  if (req.method !== 'GET' && (req.headers['x-continuer-client'] !== '1' || !req.headers['content-type']?.startsWith('application/json'))) return json(res, 403, { error: '请求来源无效' });
  try {
    const url = new URL(req.url, origin);
    if (url.origin !== origin) return json(res, 403, { error: '请求来源无效' });
    if (url.pathname.startsWith('/api/') && !access.authorized(req, accessToken)) return json(res, 401, { error: '请用启动脚本重新打开 Continuer；本地 API 需要访问凭据' });
    if (await routeApi(req, res, url)) return;
    if (await serveStatic(req, res, url)) return;
    json(res, 404, { error: '接口或页面不存在' });
  } catch (error) { json(res, 400, { error: error.code === 'ENOENT' ? '项目目录不存在' : error.message }); }
});
server.listen(port, '127.0.0.1', () => { health.record('running'); console.log(`Codex Continuer ${demo ? '(DEMO)' : ''}: ${origin}`); manager.start(); });
server.on('error', error => { console.error(error.message); process.exitCode = 1; health.record('failed', 'listen-error'); manager.safely(() => manager.stop()); });
let stopping = false;
const logTimer = setInterval(() => logging.rotateLogs(dataDir), 60000); logTimer.unref();
function stop(reason = 'signal') {
  if (stopping) return; stopping = true;
  health.record('stopped', reason); manager.safely(() => manager.stop()); stream.close(); server.close(); clearTimeout(broadcastTimer); clearInterval(logTimer);
}
process.on('uncaughtExceptionMonitor', () => health.record('crashed', 'uncaught-exception'));
process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM'));
