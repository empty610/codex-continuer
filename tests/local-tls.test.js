import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as tcpServer } from 'node:net';
import { createServer } from 'node:https';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import localTls from '../server/local-tls.cjs';
import access from '../server/access.cjs';

function temporary(t) {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-pinned-tls-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); });
  return directory;
}
async function identity(t, demo = false) {
  const directory = temporary(t), token = access.createToken(directory, demo);
  const options = await localTls.serverOptions(directory, demo, token);
  return { directory, token, options, client: localTls.requestOptions(directory, demo) };
}
async function listen(t, server) {
  server.on('tlsClientError', () => {});
  const sockets = new Set(); server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return `https://127.0.0.1:${server.address().port}`;
}

test('plaintext port squatters never receive the access token or private request body', async t => {
  const f = await identity(t); let received = Buffer.alloc(0);
  const origin = await listen(t, tcpServer(socket => socket.on('data', bytes => { received = Buffer.concat([received, bytes]); socket.destroy(); })));
  await assert.rejects(localTls.fetchLocal(origin + '/api/tasks', { method: 'POST', headers: { Authorization: 'Bearer ' + f.token }, body: 'private fixture objective', signal: AbortSignal.timeout(2000) }, f.client));
  assert.equal(received.includes(Buffer.from(f.token)), false);
  assert.equal(received.includes(Buffer.from('private fixture objective')), false);
  assert.ok(received.length > 0, 'listener observed only the TLS handshake');
});

test('wrong TLS identity is rejected before authenticated HTTP; the pinned service still works', async t => {
  const f = await identity(t), attacker = await identity(t); let requests = 0;
  const fake = await listen(t, createServer(attacker.options, (_req,res) => { requests++; res.end('{}'); }));
  await assert.rejects(localTls.fetchLocal(fake + '/api/state', { headers: { Authorization: 'Bearer ' + f.token } }, f.client));
  assert.equal(requests, 0);
  const real = await listen(t, createServer(f.options, (req,res) => { assert.equal(req.headers.authorization, 'Bearer ' + f.token); res.end('{"ok":true}'); }));
  assert.deepEqual(await (await localTls.fetchLocal(real + '/api/state', { headers: { Authorization: 'Bearer ' + f.token } }, f.client)).json(), { ok: true });
  const pinned = localTls.readIdentity(f.directory).certificate;
  assert.equal(localTls.matchesCertificate(pinned, pinned), true);
  assert.equal(localTls.matchesCertificate(localTls.readIdentity(attacker.directory).certificate, pinned), false);
  assert.equal(localTls.matchesCertificate('invalid', pinned), false);
});

test('TLS identities persist, separate demo/live and refuse corruption without replacement', async t => {
  const f = await identity(t), file = localTls.identityPath(f.directory), original = readFileSync(file);
  await localTls.serverOptions(f.directory, false, f.token); assert.deepEqual(readFileSync(file), original);
  assert.equal(localTls.readIdentity(f.directory, true), null);
  const demoToken = access.createToken(f.directory, true); await localTls.serverOptions(f.directory, true, demoToken);
  assert.notEqual(localTls.readIdentity(f.directory).certificate, localTls.readIdentity(f.directory, true).certificate);
  writeFileSync(file, '{damaged');
  await assert.rejects(localTls.serverOptions(f.directory, false, f.token));
  assert.equal(readFileSync(file, 'utf8'), '{damaged');
});

test('pinned transport refuses redirects, truncation, oversized responses and nonlocal schemes', async t => {
  const f = await identity(t);
  const origin = await listen(t, createServer(f.options, (req,res) => {
    if (req.url === '/redirect') { res.writeHead(302, {Location:'https://example.invalid/'}); res.end(); }
    else if (req.url === '/truncated') { res.writeHead(200, {'Content-Length':100}); res.end('{}'); }
    else res.end('x'.repeat(4 * 1024 * 1024 + 1));
  }));
  await assert.rejects(localTls.fetchLocal(origin + '/redirect', {}, f.client), /重定向/);
  await assert.rejects(localTls.fetchLocal(origin + '/truncated', { signal: AbortSignal.timeout(2000) }, f.client));
  await assert.rejects(localTls.fetchLocal(origin + '/oversized', {}, f.client), /长度/);
  await assert.rejects(localTls.fetchLocal('http://127.0.0.1:4317/', {}, f.client), /destination/);
  await assert.rejects(localTls.fetchLocal('https://example.invalid/', {}, f.client), /destination/);
});

test('retired browser URL command emits no credential and never starts a service', async t => {
  const directory = temporary(t), token = access.createToken(directory);
  try {
    await promisify(execFile)(process.execPath, ['plugin/control.js', 'url'], { env: { ...process.env, CONTINUER_DATA_DIR: directory }, windowsHide: true });
    assert.fail('Legacy URL command should fail closed');
  } catch (error) {
    assert.match(error.stderr, /浏览器凭据链接已停用/);
    assert.equal((error.stdout + error.stderr).includes(token), false);
    assert.equal(localTls.readIdentity(directory), null);
  }
});
