// Use real Electron single-instance locks with no renderer, service or watcher.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const load = createRequire(path.resolve(__dirname, '../../desktop/main.cjs'));
const { createDesktopRuntime } = load('./runtime.cjs');
const directory = process.env.CONTINUER_TEST_INSTANCE_DIR;
const mode = process.env.CONTINUER_TEST_INSTANCE_MODE;
if (!directory || !['live', 'demo'].includes(mode)) throw Error('Isolated instance test configuration required');
const record = { mode, secondInstances: 0 }, output = path.join(directory, mode + (process.argv.includes('--auto') ? '-duplicate' : '') + '.json');
const persist = () => fs.writeFileSync(output, JSON.stringify(record));
process.on('uncaughtException', error => { record.error = error.stack; persist(); electron.app.exit(1); });
const preferences = { follow: false, expanded: false, hidden: true, compactSize: 160, offsets: {}, positions: {} };
const app = {
  setName: value => electron.app.setName(value),
  setPath: (name, value) => { fs.mkdirSync(value, { recursive: true }); record[name] = value; electron.app.setPath(name, value); },
  requestSingleInstanceLock: identity => { record.identity = identity; record.acquired = electron.app.requestSingleInstanceLock(identity); persist(); return record.acquired; },
  quit: () => electron.app.exit(0),
  whenReady: () => ({ then: () => ({ catch() {} }) }),
  on: (name, handler) => {
    if (name === 'second-instance') electron.app.on(name, (...args) => {
      handler(...args); record.secondInstances++; record.hidden = layout.preferences.hidden; persist();
    });
  },
};
const layout = createDesktopRuntime({
  // No window is supplied: duplicate --auto requests cannot load a renderer.
  processInfo: { env: { CONTINUER_DEMO: mode === 'demo' ? '1' : '' }, argv: process.argv, pid: process.pid, platform: process.platform },
  load: name => name === 'electron' ? { app } :
    name === '../server/config.cjs' ? { dataDir: directory, port: Number(process.env.CONTINUER_TEST_INSTANCE_PORT || (mode === 'demo' ? 4318 : 4317)), appInfo: () => ({ buildId: 'fixture' }) } :
    name === '../server/logging.cjs' ? { installLogs() {} } :
    name === 'node:fs' ? { mkdirSync() {}, readFileSync: () => JSON.stringify(preferences), writeFileSync() {}, existsSync: () => false } : load(name),
});
electron.app.whenReady().then(() => { record.ready = true; persist(); });
const stop = path.join(directory, mode + '.stop');
setInterval(() => { if (fs.existsSync(stop)) electron.app.exit(0); }, 50);
setTimeout(() => electron.app.exit(2), 12000);
