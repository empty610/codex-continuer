import { errorResponse, message as textMessage } from '../public/message.js';
import { createServer } from 'node:https';
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
import exitState from './exit-state.cjs';
import localTls from './local-tls.cjs';
import { clientErrorResponse, createRequestLimiter } from './http-policy.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const port = Number(process.env.PORT || (demo ? 4318 : config.port));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid Continuer port');
const origin = `https://127.0.0.1:${port}`;
const dataDir = config.dataDir;
if (process.argv.includes('--observe-only') && exitState.requested(dataDir, demo)) throw Error('Continuer 已退出，请先手动打开挂件。');
if (!process.argv.includes('--observe-only')) exitState.clear(dataDir, demo);
logging.installLogs(dataDir, demo ? 'demo' : 'service');
logging.rotateLogs(dataDir);
const releaseLease = await acquireLease(dataDir, demo ? 'demo-service' : 'service');
process.once('exit', releaseLease);
const accessToken = access.createToken(dataDir, demo);
const secureOptions = await localTls.serverOptions(dataDir, demo, accessToken);
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
const allowRequest = createRequestLimiter();
const server = createServer(secureOptions, async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'");
  // Loopback binding + exact Host + same-origin mutations prevent DNS rebinding/CSRF.
  if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, errorResponse(textMessage("error.loopback_required")));
  if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, errorResponse(textMessage("error.cross_origin")));
  if (req.method !== 'GET' && (req.headers['x-continuer-client'] !== '1' || !req.headers['content-type']?.startsWith('application/json'))) return json(res, 403, errorResponse(textMessage("error.invalid_origin")));
  try {
    const url = new URL(req.url, origin);
    if (url.origin !== origin) return json(res, 403, errorResponse(textMessage("error.invalid_origin")));
    if (url.pathname.startsWith('/api/')) {
      const authorized = access.authorized(req, accessToken);
      if (!allowRequest(authorized, req.method)) { res.setHeader('Retry-After', '1'); return json(res, 429, errorResponse(textMessage("error.request_rate"))); }
      if (!authorized) return json(res, 401, errorResponse(textMessage("error.api_credentials")));
    }
    if (await routeApi(req, res, url)) return;
    if (await serveStatic(req, res, url)) return;
    json(res, 404, errorResponse(textMessage("error.not_found")));
  } catch (error) { json(res, 400, clientErrorResponse(error)); }
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
