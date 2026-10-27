const { readFileSync, existsSync, readdirSync } = require('node:fs');
const { resolve, join, relative } = require('node:path');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const protocolVersion = 4, schemaVersion = 1;
let config = {};
try { config = JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')); } catch {}
const dataDir = resolve(process.env.CONTINUER_DATA_DIR || config.dataDir ||
  (config.profile !== 'portable' && existsSync(join(root, 'data')) ? join(root, 'data') : join(process.env.LOCALAPPDATA || process.env.HOME || root, 'CodexContinuer')));
const port = Number(process.env.CONTINUER_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid Continuer port');
function fingerprint(directory = root) {
  const hash = createHash('sha256').update(version);
  const visit = path => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = join(path, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) hash.update(relative(directory, file).replaceAll('\\', '/')).update(readFileSync(file));
    }
  };
  for (const folder of ['server', 'public', 'plugin', 'desktop']) visit(join(directory, folder));
  if (existsSync(join(directory, 'Enable-Autostart.ps1'))) hash.update('Enable-Autostart.ps1').update(readFileSync(join(directory, 'Enable-Autostart.ps1')));
  return hash.digest('hex').slice(0, 20);
}
let cachedInfo;
function appInfo() { return cachedInfo ||= { app: 'codex-continuer', version, buildId: fingerprint(), protocolVersion, schemaVersion }; }
module.exports = { root, config, dataDir, port, version, fingerprint, appInfo, protocolVersion, schemaVersion };
