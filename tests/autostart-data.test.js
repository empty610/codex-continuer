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
        mkdirSync(before, { recursive: true });
        writeFileSync(join(before, 'quit.request'), 'Previous explicit exit');
        writeFileSync(join(before, 'autostart-status.json'), JSON.stringify({pid:424242,pluginRoot:source,state:'launched'}));
        await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests/fixtures/autostart-host.ps1'),
          '-Script', join(root, 'Enable-Autostart.ps1'), '-PluginRoot', source, '-Trace', trace, '-WatcherPid', '424242', ...(disable ? ['-Disable'] : [])], { env, windowsHide: true });
        assert.equal(await selected(), before, `${variant}/${disable} must not change runtime default`);
        const preferences = JSON.parse(readFileSync(join(before, 'autostart-preferences.json'), 'utf8').replace(/^\uFEFF/, ''));
        assert.equal(preferences.enabled, !disable);
        if (variant === 'source') assert.equal(existsSync(join(source, 'data')), false);
        assert.match(readFileSync(trace, 'utf8'), /stop/,'UTF-8 without BOM must preserve the Chinese watcher path');
        assert.equal(existsSync(join(before,'quit.request')), disable, 'only explicit enable clears the user-exit latch');
        if (disable) assert.doesNotMatch(readFileSync(trace, 'utf8'), /launch:/);
        else {
          assert.match(readFileSync(trace, 'utf8'), /shortcut:.*watch-codex\.ps1/);
          assert.doesNotMatch(readFileSync(trace, 'utf8'), /registry:/);
          const shortcut = JSON.parse(readFileSync(join(source, 'fixture-startup/CodexContinuer.lnk'), 'utf8').replace(/^\uFEFF/, ''));
          const dataArgument = /(?:^|\s)-DataDir "([^"]+)"(?:\s|$)/.exec(shortcut.Arguments)?.[1];
          assert.ok(dataArgument, `${variant}/${disable}: preserve the complete data argument`);
          assert.equal(realpathSync(dataArgument), realpathSync(before), `${variant}/${disable}: shortcut selects the same physical data directory`);
          assert.equal(shortcut.WindowStyle, 7);
          if (variant === 'environment') {
            await execute('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'tests/fixtures/autostart-host.ps1'),'-Script',join(root,'Enable-Autostart.ps1'),'-PluginRoot',source,'-Trace',trace,'-WatcherPid','424242','-ExistingRegistry','-Disable'], {env,windowsHide:true});
            assert.equal(existsSync(join(source,'fixture-startup/CodexContinuer.lnk')),false);
            assert.match(readFileSync(trace,'utf8'),/registry-removed/);
          }
        }
        const stopTrace=join(source,'stop-calls.txt');
        await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'tests/fixtures/autostart-host.ps1'),'-Script',join(root,'plugin/stop-owned.ps1'),'-PluginRoot',source,'-DataDir',before,'-Trace',stopTrace,'-WatcherPid','424242','-StopOnly'],{env,windowsHide:true});
        assert.match(readFileSync(stopTrace,'utf8'),/stop/, `${variant}/${disable}: stop the selected watcher`);
      }
    }
  } finally { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); }
});

test('watcher cleanup recognizes a verified executable reported through its Windows short path', { skip: process.platform !== 'win32' }, async () => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-short-path-'));
  try {
    // No files are created in Program Files; these paths only identify a mocked process.
    const pluginRoot = join(process.env.ProgramFiles, 'continuer-fixture'), processRoot = join(process.env.SystemDrive + '/', 'PROGRA~1', 'continuer-fixture');
    writeFileSync(join(directory, 'autostart-status.json'), JSON.stringify({ pid: 424242, pluginRoot }));
    const trace = join(directory, 'stop.txt');
    await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests/fixtures/autostart-host.ps1'),
      '-Script', join(root, 'plugin/stop-owned.ps1'), '-PluginRoot', pluginRoot, '-ProcessRoot', processRoot, '-DataDir', directory,
      '-Trace', trace, '-WatcherPid', '424242', '-StopOnly'], { windowsHide: true });
    assert.match(readFileSync(trace, 'utf8'), /stop/);
  } finally { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); }
});
