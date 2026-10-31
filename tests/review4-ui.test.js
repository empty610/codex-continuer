import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const executable = fileURLToPath(new URL('../node_modules/electron/dist/electron.exe', import.meta.url));
test('real DOM retains custom intervals and the add-and-monitor choice in both languages and layouts',
  { skip: process.platform !== 'win32' || !existsSync(executable), timeout: 25000 }, async () => {
    const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-review4-ui-'));
    try {
      try {
        await promisify(execFile)(executable, [fileURLToPath(new URL('./fixtures/review4-ui.cjs', import.meta.url))], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: '', CONTINUER_TEST_REVIEW4_DIR: directory }, windowsHide: true, timeout: 23000,
        });
      } catch (error) { if (existsSync(join(directory, 'result.json'))) error.message += '\n' + readFileSync(join(directory, 'result.json'), 'utf8'); throw error; }
      const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
      assert.equal(result.error, undefined); assert.equal(result.passed, true); assert.equal(result.results.length, 2);
    } finally { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
