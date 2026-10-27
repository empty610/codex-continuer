import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import access from '../server/access.cjs';
import { AuthenticatedSource } from '../public/access.js';
import { doctor } from '../scripts/doctor.js';

test('credentials are random, persistent, mode-separated and malformed files fail closed', t => {
  const parent = realpathSync(tmpdir()), dir = mkdtempSync(join(parent, 'continuer-access-'));
  t.after(() => { assert.equal(dirname(realpathSync(dir)), parent); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(access.readToken(dir), null);
  const token = access.createToken(dir), demo = access.createToken(dir, true);
  assert.match(token, /^[a-f0-9]{64}$/); assert.notEqual(token, demo); assert.equal(access.createToken(dir), token);
  const req = authorization => ({ headers: { authorization } });
  assert.equal(access.authorized(req('Bearer ' + token), token), true);
  for (const value of [undefined, token, 'Bearer ' + demo, 'Bearer ' + token + 'x', ['Bearer ' + token]]) assert.equal(access.authorized(req(value), token), false);
  const file = access.credentialPath(dir); writeFileSync(file, 'damaged');
  assert.throws(() => access.createToken(dir), /凭据文件无效/); assert.equal(readFileSync(file, 'utf8'), 'damaged');
});

test('retired browser bootstrap discards legacy credentials and never authorizes requests', () => {
  const token = 'a'.repeat(64), saved = new Map(); let replaced;
  const source = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\nthis.headers = accessHeaders();';
  saved.set('continuer-access', token);
  const context = { window: {}, location: { hash: '#access=' + token, pathname: '/', search: '' }, history: { replaceState(_state, _title, url) { replaced = url; } }, sessionStorage: { removeItem: key => saved.delete(key), getItem: key => saved.get(key) }, URLSearchParams };
  runInNewContext(source, context); assert.equal(replaced, '/'); assert.equal(context.headers.Authorization, undefined);
  assert.equal(saved.size, 0);
});

test('browser streams do not send legacy credentials, decode split UTF-8 and stop after close', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => 'b'.repeat(64) } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete globalThis.sessionStorage; });
  let options, controller, finish; const received = new Promise(resolve => { finish = resolve; });
  const source = new AuthenticatedSource('/api/events', { request: async (_path, value) => { options = value; return new Response(new ReadableStream({ start(stream) { controller = stream; } })); } });
  t.after(() => source.close());
  const messages = []; source.onmessage = event => { messages.push(JSON.parse(event.data)); source.close(); finish(); };
  const bytes = new TextEncoder().encode('data: {"text":"中文😀"}\n\ndata: {"stale":true}\n\n');
  for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
  await received; assert.deepEqual(messages, [{ text: '中文😀' }]);
  assert.equal(options.headers.Authorization, undefined); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.signal.aborted, true);
});

test('unauthorized streams do not reconnect, and oversized frames are rejected', async () => {
  for (const mode of ['unauthorized', 'oversized']) {
    let calls = 0, finish; const error = new Promise(resolve => { finish = resolve; });
    const source = new AuthenticatedSource('/api/events', { retryMs: 1, request: async () => { calls++; return mode === 'unauthorized' ? new Response('{}', { status: 401 }) : new Response('data: ' + 'x'.repeat(1024 * 1024) + '\n\n'); } });
    source.onmessage = () => assert.fail('Untrusted frame delivered'); source.onerror = value => { source.close(); finish(value); };
    assert.match((await error).message, mode === 'unauthorized' ? /启动脚本/ : /长度限制/); assert.equal(calls, 1);
  }
});

test('doctor only probes versions/help and reports queue capability separately', () => {
  const calls = [];
  const result = doctor({ env: { CODEX_BINARY: 'fixture-rpc', CODEX_QUEUE_BINARY: 'fixture-queue' }, platform: 'win32', arch: 'x64', node: '24.0.0', run: (command, args) => { calls.push([command, ...args]); return args[0] === '--version' ? 'codex-cli 0.153.2' : args[0] === 'queue' ? '--thread --message' : 'Usage'; } });
  assert.equal(result.ready, true); assert.equal(result.queue, true); assert.equal(result.modelCalls, 0); assert.equal(result.messagesSent, 0);
  assert.deepEqual(calls, [['fixture-rpc', '--version'], ['fixture-rpc', 'app-server', '--help'], ['fixture-rpc', 'plugin', '--help'], ['fixture-queue', 'queue', '--help']]);
});
