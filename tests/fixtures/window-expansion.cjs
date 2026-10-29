const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

const directory = process.env.CONTINUER_TEST_EXPANSION_DIR;
const root = path.resolve(__dirname, '../..'), main = path.join(root, 'desktop/main.cjs');
const localRequire = createRequire(main), { expandFromCard } = localRequire('./geometry.cjs');
const { createDesktopRuntime } = localRequire('./runtime.cjs');
app.setPath('userData', path.join(directory, 'profile'));
app.on('window-all-closed', () => {});
const delay = () => new Promise(resolve => setTimeout(resolve, 30));
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1, `${actual} should stay within one DIP of ${expected}`);

app.whenReady().then(async () => {
  const work = screen.getPrimaryDisplay().workArea, cases = [];
  for (const point of [
    { x: work.x + work.width - 200, y: work.y + 40 },
    { x: work.x + 30, y: work.y + work.height - 190 },
    { x: work.x + Math.floor(work.width / 2), y: work.y + 80 },
  ]) {
    const native = new BrowserWindow({ ...point, width: 160, height: 160, show: false, frame: false, thickFrame: false, transparent: true, resizable: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const window = { getBounds: () => native.getBounds(), setBounds: (bounds, animate) => native.setBounds(bounds, animate), isDestroyed: () => native.isDestroyed(), isVisible: () => false, isFocused: () => true, showInactive() {}, focus() {}, hide() {}, webContents: { send() {} } };
    const preferences = { follow: false, expanded: false, hidden: false, compactSize: 160, offsets: {}, positions: { expanded: { x: work.x + 5, y: work.y + 5, width: 432, height: 720 } } };
    const appStub = { setName() {}, setPath() {}, requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then: () => ({ catch() {} }) }) };
    const layout = createDesktopRuntime({ window, load: name => name === 'electron' ? { app: appStub, screen } : name === '../server/config.cjs' ? { dataDir: directory, port: 4317, appInfo: () => ({}) } : name === '../server/logging.cjs' ? { installLogs() {} } : name === 'node:fs' ? { ...fs, readFileSync: file => file === path.join(directory, 'widget-preferences.json') ? JSON.stringify(preferences) : fs.readFileSync(file, 'utf8'), writeFileSync() {} } : localRequire(name),
      processInfo: { env: {}, argv: [], platform: process.platform, pid: process.pid } });
    const getDebug = () => ({ preferences: layout.preferences, state: layout.state() });
    layout.show(); await delay();
    const origin = native.getBounds(); layout.savePosition();
    let firstExpanded;
    for (let cycle = 0; cycle < 12; cycle++) {
      const before = structuredClone(getDebug());
      layout.changeExpanded(true); layout.show(true, true); await delay();
      const expanded = native.getBounds(), expected = expandFromCard(origin, screen.getDisplayMatching(origin).workArea, { width: 432, height: 720 });
      fs.writeFileSync(path.join(directory, 'latest.json'), JSON.stringify({point,cycle,origin,before,expanded,expected,after:getDebug()}));
      closeTo(expanded.x, expected.x); closeTo(expanded.y, expected.y);
      if (!firstExpanded) firstExpanded = expanded;
      closeTo(expanded.x, firstExpanded.x); closeTo(expanded.y, firstExpanded.y);
      if (cycle === 0) { native.setBounds({ ...expanded, x: work.x + 5, y: work.y + 5 }); layout.savePosition(); }
      layout.changeExpanded(false); layout.show(true, true); await delay();
      const compact = native.getBounds(); closeTo(compact.x, origin.x); closeTo(compact.y, origin.y);
    }
    cases.push({ compact: origin, expanded: firstExpanded, cycles: 12 });
    native.destroy();
  }
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ passed: true, cases }));
  app.quit();
}).catch(error => { fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ error: error.stack })); app.exit(1); });
