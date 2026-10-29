import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../node_modules/electron/dist/electron.exe', import.meta.url));
test('real native windows expand from the card without drifting across repeated mode changes', { skip: process.platform !== 'win32' || !existsSync(executable), timeout: 20000 }, async () => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-expansion-'));
  try {
    try {
      await promisify(execFile)(executable, ['--disable-gpu', fileURLToPath(new URL('./fixtures/window-expansion.cjs', import.meta.url))], { env: { ...process.env, NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: undefined, CONTINUER_TEST_EXPANSION_DIR: directory }, windowsHide: true, timeout: 15000 });
    } catch (error) {
      if (existsSync(join(directory, 'result.json'))) error.message += '\n' + readFileSync(join(directory, 'result.json'), 'utf8');
      if (existsSync(join(directory, 'latest.json'))) error.message += '\n' + readFileSync(join(directory, 'latest.json'), 'utf8');
      throw error;
    }
    const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
    assert.equal(result.error, undefined); assert.equal(result.passed, true);
    assert.equal(result.cases.length, 3); assert.ok(result.cases.every(item => item.cycles === 12));
  } finally {
    assert.equal(dirname(realpathSync(directory)), parent);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
