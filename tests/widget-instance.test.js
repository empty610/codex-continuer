import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const executable = fileURLToPath(new URL('../node_modules/electron/dist/electron.exe', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/widget-instance.cjs', import.meta.url));
for (const order of [['live', 'demo'], ['demo', 'live']]) {
  test(`native widget locks isolate ${order.join(' then ')} and route duplicate requests to their own mode`,
    { skip: process.platform !== 'win32' || !existsSync(executable), timeout: 25000 }, async () => {
      const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-widget-instance-'));
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: '', CONTINUER_TEST_INSTANCE_DIR: directory };
      const children = [], completed = [];
      const read = mode => { try { return JSON.parse(readFileSync(join(directory, mode + '.json'), 'utf8')); } catch { return {}; } };
      const waitFor = async (check, message) => { for (let i = 0; i < 70; i++) { if (check()) return; await delay(50); } throw Error(message); };
      try {
        for (const mode of order) {
          const child = spawn(executable, [fixture], { env: { ...env, CONTINUER_TEST_INSTANCE_MODE: mode }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
          let errors = ''; child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
          children.push(child);
          const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(read(mode).error || errors || `exit ${code}`))); });
          exit.catch(() => {}); completed.push(exit);
          await waitFor(() => read(mode).ready, `No ready ${mode} instance: ${errors}`);
          assert.equal(read(mode).acquired, true);
        }
        assert.notEqual(read('live').userData, read('demo').userData);
        for (const mode of order) {
          await promisify(execFile)(executable, [fixture, '--auto'], { env: { ...env, CONTINUER_TEST_INSTANCE_MODE: mode, CONTINUER_TEST_INSTANCE_PORT: '4319' }, windowsHide: true, timeout: 5000 });
          await waitFor(() => read(mode).secondInstances === 1, `No mismatched ${mode} request received`);
          assert.equal(read(mode).hidden, true, 'Another service origin must not reveal this widget');
          await promisify(execFile)(executable, [fixture, '--auto'], { env: { ...env, CONTINUER_TEST_INSTANCE_MODE: mode }, windowsHide: true, timeout: 5000 });
          // The losing instance writes its lock result; wait for the owner to
          // record the forwarded event before checking routing.
          await waitFor(() => read(mode).secondInstances === 2, `No forwarded ${mode} request`);
          assert.equal(read(mode).hidden, false);
        }
        assert.equal(read('live').identity.demo, false); assert.equal(read('demo').identity.demo, true);
        writeFileSync(join(directory, order[0] + '.stop'), ''); await completed[0];
        assert.equal(children[1].exitCode, null, 'Stopping one mode must leave the other process alive');
      } finally {
        for (const mode of order) writeFileSync(join(directory, mode + '.stop'), '');
        for (const child of children) if (child.exitCode === null) {
          // Give the test-only stop marker a bounded chance before terminating
          // just the process handle created by this test.
          await Promise.race([completed[children.indexOf(child)].catch(() => {}), delay(1500)]);
          if (child.exitCode === null) child.kill();
        }
        await Promise.allSettled(completed);
        assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    });
}
