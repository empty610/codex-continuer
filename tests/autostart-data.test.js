import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile), root = fileURLToPath(new URL('..', import.meta.url));
test('autostart enable and disable share runtime data selection without changing its default', { skip: process.platform !== 'win32' }, async () => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-autostart-'));
  try {
    for (const variant of ['source', 'existing-data', 'portable', 'configured', 'environment']) {
      for (const disable of [false, true]) {
        const source = join(directory, `${variant}-${disable}-中文`), local = join(source, 'local');
        mkdirSync(join(source, 'server'), { recursive: true }); mkdirSync(join(source, 'desktop')); mkdirSync(local);
        copyFileSync(join(root, 'server/config.cjs'), join(source, 'server/config.cjs'));
        writeFileSync(join(source, 'package.json'), '{"version":"0.5.1"}');
        writeFileSync(join(source, 'desktop/watch-codex.ps1'), '# Not executed by fixture');
        if (['existing-data', 'portable'].includes(variant)) mkdirSync(join(source, 'data'));
        if (variant === 'portable') writeFileSync(join(source, 'runtime.json'), '{"profile":"portable"}');
        if (variant === 'configured') writeFileSync(join(source, 'runtime.json'), JSON.stringify({ dataDir: join(source, 'configured-数据') }));
        const env = { ...process.env, CONTINUER_DATA_DIR: variant === 'environment' ? join(source, 'override-数据') : '', LOCALAPPDATA: local, CONTINUER_PORT: '4317' };
        const selected = async () => Buffer.from((await execute(process.execPath, ['-e', 'process.stdout.write(Buffer.from(require(process.argv[1]).dataDir, "utf16le").toString("base64"))', join(source, 'server/config.cjs')], { env })).stdout, 'base64').toString('utf16le');
        const before = await selected(), trace = join(source, 'host-calls.txt');
        await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests/fixtures/autostart-host.ps1'),
          '-Script', join(root, 'Enable-Autostart.ps1'), '-PluginRoot', source, '-Trace', trace, ...(disable ? ['-Disable'] : [])], { env, windowsHide: true });
        assert.equal(await selected(), before, `${variant}/${disable} must not change runtime default`);
        const preferences = JSON.parse(readFileSync(join(before, 'autostart-preferences.json'), 'utf8').replace(/^\uFEFF/, ''));
        assert.equal(preferences.enabled, !disable);
        if (variant === 'source') assert.equal(existsSync(join(source, 'data')), false);
        if (disable) assert.equal(existsSync(trace), false);
        else assert.match(readFileSync(trace, 'utf8'), /registry:.*watch-codex\.ps1/);
      }
    }
  } finally { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); }
});
