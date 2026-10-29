import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createLocalClient, assertServiceIdentity, samePath } from '../plugin/local-client.js';
import { message, formatMessage, MessageError } from '../public/message.js';

test('local transport reads current credentials and TLS identity for each request and retains payloads', async () => {
  const calls = []; let generation = 0;
  const request = createLocalClient({ origin: 'https://127.0.0.1:4317', readAccessToken: () => 'fixture-' + generation,
    identityOptions: () => ({ generation }), fetchLocal: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ saved: true }) }; } });
  assert.deepEqual(await request('/api/state'), { saved: true }); generation++;
  const payload = { value: '继续\n<custom>"text"' }; await request('/api/tasks/fixture', payload, { timeoutMs: 150 });
  assert.equal(calls[0][1].headers.Authorization, 'Bearer fixture-0'); assert.equal(calls[0][1].method, undefined);
  assert.equal(calls[1][1].headers.Authorization, 'Bearer fixture-1'); assert.equal(calls[1][1].headers['X-Continuer-Client'], '1');
  assert.deepEqual(JSON.parse(calls[1][1].body), payload); assert.deepEqual(calls[1][2], { generation: 1 });
  assert.ok(calls[1][1].signal instanceof AbortSignal);
});

test('invalid paths are rejected before reading credentials or sending a request', async () => {
  const request = createLocalClient({ origin: 'https://127.0.0.1:4317', readAccessToken: () => { throw Error('Credential read'); }, fetchLocal: () => { throw Error('Network call'); } });
  for (const path of ['https://other.invalid/api/state', '//other.invalid/api/state', '/widget', '/api/\\other', null]) await assert.rejects(request(path), /Invalid API path/);
});

test('local transport preserves structured service errors and leaves untyped diagnostics unchanged', async () => {
  const info = message('runtime.build_mismatch'); let response = { error: formatMessage(info), errorInfo: info };
  const request = createLocalClient({ origin: 'https://127.0.0.1:4317', readAccessToken: () => null, identityOptions: () => ({}), fetchLocal: async () => ({ ok: false, json: async () => response }) });
  await assert.rejects(request('/api/state'), error => error instanceof MessageError && error.messageInfo.id === info.id);
  response = { error: 'External diagnostic' }; await assert.rejects(request('/api/state'), error => error.message === response.error && !error.messageInfo);
});

test('service identity distinguishes build compatibility from shutdown ownership and normalizes paths consistently', () => {
  const dataDir = resolve('fixture-data'), root = resolve('fixture-root'), appInfo = { protocolVersion: 4, buildId: 'current' };
  const state = { app: 'codex-continuer', ...appInfo, diagnostics: { dataDir, projectRoot: root } };
  assert.equal(assertServiceIdentity(state, { dataDir, appInfo }), state);
  state.buildId = 'old'; assert.throws(() => assertServiceIdentity(state, { dataDir, appInfo }), { code: 'SERVICE_BUILD_MISMATCH' });
  assert.equal(assertServiceIdentity(state, { root, dataDir }), state);
  state.diagnostics.projectRoot = 'foreign'; assert.throws(() => assertServiceIdentity(state, { root, dataDir }), { code: 'SERVICE_OWNER_MISMATCH' });
  assert.equal(samePath(root.toUpperCase(), root.toLowerCase(), 'win32'), true);
  assert.equal(samePath(root.toUpperCase(), root.toLowerCase(), 'linux'), false);
  assert.equal(samePath(null, root), false);
});
