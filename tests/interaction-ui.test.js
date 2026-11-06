import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const executable = fileURLToPath(new URL('../node_modules/electron/dist/electron.exe', import.meta.url));

test('real interfaces preserve drafts, reading position, submission ownership and current state',
  { skip: process.platform !== 'win32' || !existsSync(executable), timeout: 50000 }, async () => {
    const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-interaction-'));
    try {
      try {
        await promisify(execFile)(executable, [fileURLToPath(new URL('./fixtures/interaction-recovery-ui.cjs', import.meta.url))], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: '', CONTINUER_INTERACTION_TEST_DIR: directory }, windowsHide: true, timeout: 47000,
        });
      } catch (error) { if (existsSync(join(directory, 'ui-results.json'))) error.message += '\n' + readFileSync(join(directory, 'ui-results.json'), 'utf8'); throw error; }
      const result = JSON.parse(readFileSync(join(directory, 'ui-results.json'), 'utf8'));
      assert.equal(result.error, undefined); assert.equal(result.completed, true); assert.equal(result.scenarios.length, 12);
      assert.deepEqual(result.errors, []);
    } finally { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
