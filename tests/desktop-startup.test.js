import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('desktop startup preserves foreground requests, respects exit during startup, and resets position immediately', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./fixtures/desktop-startup.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, timeout: 10000,
  });
  const results = JSON.parse(stdout);
  assert.equal(results.length, 11);
  assert.ok(results.filter(item => item.failure).every(item => item.stopCalls === 0 && item.exitReason === 'startup-failed'));
  assert.ok(results.filter(item => item.afterStartup).every(item => item.afterStartup.visible && item.stopCalls === 1));
  assert.ok(results.filter(item => item.exitDuring).every(item => item.stopCalls === 1 && item.quitCalls === 1 && item.exitReason === 'user-quit'));
});
