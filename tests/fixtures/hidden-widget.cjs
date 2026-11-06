const electron = require('electron');
const { createRequire } = require('node:module');
const path = require('node:path');
if (process.env.CONTINUER_DEMO !== '1' || !process.env.CONTINUER_DATA_DIR) throw Error('Isolated demo configuration required');
const load = createRequire(path.resolve(__dirname, '../../desktop/main.cjs'));
const { createDesktopRuntime } = load('./runtime.cjs');
// Exercise a deliberate hide through the production handler before readiness.
// A saved hidden preference alone no longer hides a manual cold start.
const ipcMain = { handle(name, handler) {
  electron.ipcMain.handle(name, (event, action, value) => {
    if (name === 'continuer:control' && action === 'renderer-ready') handler(event, 'hide');
    return handler(event, action, value);
  });
} };
createDesktopRuntime({ load: name => name === 'electron' ? { ...electron, ipcMain } : load(name) });
