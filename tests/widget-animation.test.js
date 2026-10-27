import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile), electron = fileURLToPath(new URL('../node_modules/electron/dist/electron.exe', import.meta.url));
test('real quota CSS stays visible across artwork phases and fades smoothly over one second', { skip: process.platform !== 'win32' || !existsSync(electron), timeout: 25000 }, async () => {
  const parent = realpathSync(tmpdir()), dir = mkdtempSync(join(parent, 'continuer-quota-animation-'));
  const output = join(dir, 'result.json'), probe = join(dir, 'probe.cjs'), page = join(dir, 'preview.html');
  const captureDir = process.env.CONTINUER_CAPTURE_DIR ? resolve(process.env.CONTINUER_CAPTURE_DIR) : null;
  const css = readFileSync(new URL('../public/widget.css', import.meta.url), 'utf8');
  const art = readFileSync(new URL('../public/rhine-signal-loop.svg', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/widget.html', import.meta.url), 'utf8')
    .replace('<link rel="stylesheet" href="/widget.css">', '<style>' + css + '</style>')
    .replace('<body>', '<body class="collapsed">').replace('<div id="rhine-art" aria-hidden="true"></div>', '<div id="rhine-art" aria-hidden="true">' + art + '</div>')
    + '<SCRIPT>globalThis.fixtureScriptRan = true</SCRIPT>';
  writeFileSync(page, html);
  copyFileSync(new URL('./fixtures/widget-animation.cjs', import.meta.url), probe);
  try {
    try { await execute(electron, ['--disable-gpu', probe], { env: { ...process.env, NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: undefined, CONTINUER_TEST_ANIMATION_PAGE: page, CONTINUER_TEST_ANIMATION_OUTPUT: output, CONTINUER_TEST_ANIMATION_CAPTURE: captureDir || '' }, timeout: 20000, windowsHide: true }); }
    catch (error) { error.message += existsSync(output) ? '\nProbe: ' + readFileSync(output, 'utf8') : '\nProbe did not start'; throw error; }
    const result = JSON.parse(readFileSync(output, 'utf8')); assert.equal(result.error, undefined);
    assert.equal(result.scriptsRemaining, 0); assert.equal(result.scriptRan, false);
    assert.equal(result.duration, 1000);
    for (const phase of result.phases) { assert.equal(phase.opacity, 1); assert.equal(phase.animation, 'none'); }
    assert.equal(result.frames[0].opacity, 1); assert.equal(result.frames[2].opacity, 0); assert.equal(result.frames[4].opacity, 1);
    for (const index of [1, 3]) assert.ok(result.frames[index].opacity > 0 && result.frames[index].opacity < 1);
  } finally { assert.equal(dirname(realpathSync(dir)), parent); rmSync(dir, { recursive: true, force: true }); }
});
