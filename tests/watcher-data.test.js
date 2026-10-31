import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = fileURLToPath(new URL('..', import.meta.url));
test('PowerShell fallback passes its explicit data directory and restores the caller environment', { skip: process.platform !== 'win32' }, async () => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-watcher-data-'));
  try {
    for (const inherited of ['', 'another-directory']) {
      const source = join(directory, inherited || 'without-env'), dataDir = join(source, 'selected-数据');
      for (const name of ['server', 'desktop', 'plugin', 'local', 'selected-数据']) mkdirSync(join(source, name), { recursive: true });
      copyFileSync(join(root, 'desktop/watch-codex.ps1'), join(source, 'desktop/watch-codex.ps1'));
      copyFileSync(join(root, 'server/config.cjs'), join(source, 'server/config.cjs'));
      writeFileSync(join(source, 'package.json'), '{"version":"0.5.1"}');
      writeFileSync(join(source, 'plugin/open.js'), "console.log(Buffer.from(require('../server/config.cjs').dataDir,'utf16le').toString('base64'));");
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests/fixtures/watcher-host.ps1'),
        '-Watcher', join(source, 'desktop/watch-codex.ps1'), '-NodePath', process.execPath, '-PluginRoot', source, '-DataDir', dataDir], {
        env: { ...process.env, CONTINUER_DATA_DIR: inherited, LOCALAPPDATA: join(source, 'local'), CONTINUER_PORT: '4317' }, windowsHide: true, timeout: 15000,
      });
      const bytes = readFileSync(join(dataDir, 'autostart-launch.log'));
      const log = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').trim();
      assert.equal(Buffer.from(log, 'base64').toString('utf16le'), dataDir);
    }
  } finally { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); }
});
