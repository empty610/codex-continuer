import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sealArtifact, publishArtifact } from './package-artifact.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This preview distribution is validated for Windows x64 only.');
// Generate a code-native tray icon in the Rhine-inspired charcoal/lime palette.
function icon() {
  const size = 64, pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - 31.5, y - 31.5), a = Math.atan2(y - 31.5, x - 31.5);
    let color = d < 30 ? [32, 41, 34, 255] : [0, 0, 0, 0];
    if (d > 13 && d < 20 && Math.abs(a) > .65) color = [198, 215, 158, 255];
    if (Math.hypot(x - 49, y - 33) < 5) color = [227, 159, 100, 255];
    for (let c = 0; c < 4; c++) pixels[y * (size * 4 + 1) + 1 + x * 4 + c] = color[c];
  }
  const crc = b => { let c = 0xffffffff; for (const byte of b) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([length, type, data, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
if (!existsSync(join(root, 'node_modules/electron/dist/electron.exe'))) {
  const install = join(root, 'node_modules/electron/install.js');
  if (!existsSync(install)) throw Error('Run npm ci on Windows before building this local plugin.');
  execFileSync(process.execPath, [install], { stdio: 'inherit', windowsHide: true });
  if (!existsSync(join(root, 'node_modules/electron/dist/electron.exe'))) throw Error('Electron runtime is missing after install. Check download/cache settings.');
}
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/build-monitor.ps1')], { stdio: 'inherit', windowsHide: true });
writeFileSync(join(root, 'desktop/icon.png'), icon());
const portableBuild = process.argv.includes('--portable');
const marketplace = join(root, portableBuild ? 'dist/portable-marketplace' : 'dist/marketplace');
const destination = join(marketplace, 'plugins/codex-continuer');
const dest = join(marketplace, 'plugins', `.codex-continuer-stage-${randomUUID()}`);
mkdirSync(dest, { recursive: true });
// Explicit whitelist: never copy task history, sessions, credentials, or project caches.
for (const path of ['server', 'public', 'plugin', 'desktop', 'scripts', 'third_party', 'plugin.json', 'mcp.json', 'README.md', 'Enable-Autostart.ps1', 'Start-Continuer.ps1', 'Stop-Continuer.ps1', 'Uninstall-Plugin.ps1', 'Open-Widget.cmd', 'Start.cmd', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CHANGELOG.md']) cpSync(join(root, path), join(dest, path), { recursive: true });
mkdirSync(join(dest, 'docs'), { recursive: true });
cpSync(join(root, 'docs/desktop-memory-audit.md'), join(dest, 'docs/desktop-memory-audit.md'));
cpSync(join(root, 'docs/operations.md'), join(dest, 'docs/operations.md'));
cpSync(join(root, 'docs/compatibility.md'), join(dest, 'docs/compatibility.md'));
cpSync(join(root, 'docs/portable.md'), join(dest, 'docs/portable.md'));
cpSync(join(root, 'docs/portable.md'), join(dest, 'README.md'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, license: pkg.license, private: true, type: 'module', engines: pkg.engines }, null, 2));
writeFileSync(join(dest, 'runtime.json'), JSON.stringify(portableBuild ? { profile: 'portable' } : { profile: 'local', dataDir: resolve(process.env.CONTINUER_BUILD_DATA_DIR || join(root, 'data')), nodePath: process.execPath }, null, 2));
mkdirSync(join(dest, 'node_modules/electron'), { recursive: true });
cpSync(join(root, 'node_modules/electron/dist'), join(dest, 'node_modules/electron/dist'), { recursive: true });
// Codex CLI 0.153.x also accepts the legacy plugin layout.
mkdirSync(join(dest, '.codex-plugin'), { recursive: true });
const portable = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
portable.version = pkg.version;
writeFileSync(join(dest, 'plugin.json'), JSON.stringify(portable, null, 2));
writeFileSync(join(dest, '.codex-plugin/plugin.json'), JSON.stringify({ name: pkg.name, version: pkg.version, description: portable.description, mcpServers: './.mcp.json', interface: portable.extensions['com.openai'].interface }, null, 2));
writeFileSync(join(dest, '.mcp.json'), JSON.stringify({ mcpServers: { continuer: { command: portableBuild ? 'node' : process.execPath, args: ['${PLUGIN_ROOT}/plugin/mcp-server.js'], cwd: '${PLUGIN_ROOT}' } } }, null, 2));
const manifest = sealArtifact(dest);
publishArtifact(dest, destination, root);
const catalogDir = join(marketplace, '.agents/plugins');
mkdirSync(catalogDir, { recursive: true });
writeFileSync(join(catalogDir, 'marketplace.json'), JSON.stringify({ name: 'continuer-local', interface: { displayName: 'Continuer 本地插件' }, plugins: [{ name: pkg.name, source: { source: 'local', path: './plugins/codex-continuer' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }, null, 2));
cpSync(join(root, 'Install-Portable.ps1'), join(marketplace, 'Install-Portable.ps1'));
cpSync(join(root, 'docs/portable.md'), join(marketplace, 'README.md'));
console.log(`Built Windows ${portableBuild ? 'portable' : 'local'} plugin: ${destination}\nBuild: ${manifest.buildId}\nMarketplace: ${marketplace}\nTask data remains outside the package`);
