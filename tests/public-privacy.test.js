import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { publicFiles } from '../scripts/source-files.js';
import { checkPublic } from '../scripts/check-public.js';

test('public privacy guard rejects live identifiers in every exported text surface', t => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-public-privacy-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); });
  for (const name of publicFiles()) { const target = join(directory, name); mkdirSync(dirname(target), { recursive: true }); copyFileSync(name, target); }
  assert.ok(checkPublic(directory).files > 100);
  const credentialFile = join(directory, 'tests/quota-wake.test.js'), credentialOriginal = readFileSync(credentialFile);
  writeFileSync(credentialFile, credentialOriginal.toString() + '\nBearer ' + 'a'.repeat(64));
  assert.throws(() => checkPublic(directory), /local Bearer credential/);
  writeFileSync(credentialFile, credentialOriginal);
  for (const name of ['server/tls-live.json', 'plugin/access-demo.token', 'public/runtime.json', 'tests/.env.local', 'desktop/private.pfx']) {
    const file = join(directory, name); writeFileSync(file, 'synthetic-private-data');
    assert.throws(() => checkPublic(directory), error => error.message.includes(name + ': private runtime file'));
    rmSync(file);
  }
  // Deliberately assembled so the regression source never embeds a live ID.
  const candidate = ['01abcdef', '1111', '7111', '8111', '111111111111'].join('-');
  for (const name of ['tests/quota-wake.test.js', 'scripts/check.js', 'mcp.json', 'CONTRIBUTING.md', '.github/workflows/windows.yml']) {
    const file = join(directory, name), original = readFileSync(file);
    writeFileSync(file, original.toString() + '\n' + candidate);
    assert.throws(() => checkPublic(directory), error => error.message.includes(name + ': live conversation identifier') && !error.message.includes(candidate));
    writeFileSync(file, original);
  }
  assert.ok(checkPublic(directory).files > 100);
});
