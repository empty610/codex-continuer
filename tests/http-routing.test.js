import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStaticAssets } from '../server/static-assets.js';
import { createApiRouter } from '../server/http-routes.js';

const response = () => ({ writeHead(status, headers) { Object.assign(this, { status, headers }); }, end(body) { this.body = body; } });
function temporary(t) {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-assets-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); }); return directory;
}

test('static assets revalidate without a body and edited assets invalidate the cached content', async t => {
  const root = temporary(t); mkdirSync(join(root, 'public')); const file = join(root, 'public/app.js'); writeFileSync(file, 'initial fixture');
  const serve = createStaticAssets(root), url = new URL('http://localhost/app.js'), first = response();
  await serve({ method: 'GET', headers: {} }, first, url); assert.equal(first.status, 200); assert.equal(first.body.toString(), 'initial fixture');
  const cached = response(); await serve({ method: 'GET', headers: { 'if-none-match': 'W/' + first.headers.ETag } }, cached, url);
  assert.equal(cached.status, 304); assert.equal(cached.body, undefined);
  writeFileSync(file, 'updated fixture with a different size');
  const edited = response(); await serve({ method: 'GET', headers: { 'if-none-match': first.headers.ETag } }, edited, url);
  assert.equal(edited.status, 200); assert.notEqual(edited.headers.ETag, first.headers.ETag); assert.match(edited.body.toString(), /updated/);
});

test('static dispatch does not read unknown paths or treat POSTs as files', async () => {
  const serve = createStaticAssets('deliberately-missing-fixture-root');
  for (const [method, path] of [['GET', '/package.json'], ['GET', '/server/index.js'], ['POST', '/app.js']]) assert.equal(await serve({ method, headers: {} }, response(), new URL(path, 'http://localhost')), false);
});

test('unmatched API requests do not parse bodies or invoke unrelated handlers', async () => {
  const api = createApiRouter({ manager: {}, demo: false, summary() { throw Error('Unnecessary snapshot'); } });
  for (const path of ['/api/unknown', '/api/demo/quota', '/not-an-api']) {
    const req = { method: 'POST', async *[Symbol.asyncIterator]() { throw Error('Unnecessary body read'); } };
    assert.equal(await api(req, response(), new URL(path, 'http://localhost')), false);
  }
});
