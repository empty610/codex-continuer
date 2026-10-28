const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { join } = require('node:path');
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const { place, placeIndependent, expandFromCard, offsetFrom, sizes, compactSize, samePlacementContext, restoreModePosition } = require('./geometry.cjs');
const { createPointerDrag } = require('./pointer-drag.cjs');
const runtimeConfig = require('../server/config.cjs');
const logging = require('../server/logging.cjs');
const localTls = require('../server/local-tls.cjs');

app.setName('Codex Continuer');
const dataDir = runtimeConfig.dataDir;
mkdirSync(dataDir, { recursive: true });
logging.installLogs(dataDir, 'widget');
app.setPath('userData', join(dataDir, 'desktop-profile'));
const preferenceFile = join(dataDir, 'widget-preferences.json');
let prefs = { follow: true, expanded: false, hidden: false, compactSize: 256, offsets: {}, positions: {} };
try { prefs = { ...prefs, ...JSON.parse(readFileSync(preferenceFile, 'utf8')) }; } catch {}
let preferenceError = null;
let nativeText = text => text, refreshMenu = () => {};
const save = () => { try { writeFileSync(preferenceFile, JSON.stringify(prefs)); preferenceError = null; } catch (error) { preferenceError = error.message; console.error(`挂件设置未保存：${error.message}`); } };
const port = runtimeConfig.port;
const origin = `https://127.0.0.1:${port}`;
let win, tray, widgetMenu, tracker, anchor, pointerDrag, isReady = false, targetVisible = false, closing = false, lastDiagnostic, lastSentState, menuOpen = false, dragging = false, boundsTimer;
let panelSize = { width: sizes.expanded.width - 18, height: sizes.expanded.height - 18 };
let settledPlacement, restoringMode=false, expansionOrigin=null;
let pendingTransition, transitionSequence=0, renderedExpanded=prefs.expanded;
const mode = () => prefs.expanded ? 'expanded' : 'compact';
const placementContext = () => ({ mode:mode(),follow:prefs.follow,compactSize:compactSize(prefs.compactSize),anchor:anchor ? {...anchor} : null });
if (process.argv.includes('--auto')) prefs.hidden = false;
function diagnostics() {
  if (!win || win.isDestroyed() || dragging || pointerDrag?.active) return;
  const next = JSON.stringify({ ...runtimeConfig.appInfo(), pid: process.pid, ready: isReady, visible: win.isVisible(), ...state(), bounds: win.getBounds() });
  if (next !== lastDiagnostic) { lastDiagnostic = next; try { writeFileSync(join(dataDir, 'widget-status.json'), next); } catch (error) { console.error(`挂件诊断未保存：${error.message}`); } }
}
const ownsInstance = app.requestSingleInstanceLock();
let quitting, shutdownComplete = false;
if (!ownsInstance) { app.quit(); }
else if (process.argv.includes('--quit')) { app.whenReady().then(quitAll); }
else {
  app.on('second-instance', (_event, argv) => { if (argv.includes('--quit')) { void quitAll(); return; } if (closing) return; prefs.hidden = false; if (!argv.includes('--auto')) changeExpanded(true); save(); show(!argv.includes('--auto')); });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox(nativeText('Continuer 启动失败'), error.message); app.quit(); });
}
function quitAll() {
  if (quitting) return quitting;
  closing = true; isReady = false;
  pointerDrag?.finish(); cancelTransition(); tracker?.kill(); win?.hide();
  try { writeFileSync(join(dataDir, 'widget-status.json'), JSON.stringify({ ...runtimeConfig.appInfo(), pid: process.pid, ready: false, exitReason: 'quitting', updatedAt: Date.now() })); } catch {}
  quitting = (async () => {
    try {
      const runtime = await import('../plugin/runtime.js');
      const { stopBackground } = await import('../plugin/shutdown.js');
      await stopBackground({ root: runtime.root, dataDir, request: runtime.request, demo: process.env.CONTINUER_DEMO === '1' });
    } catch (error) { console.error('退出后台进程失败：' + error.message); }
    finally { shutdownComplete = true; app.quit(); }
  })();
  return quitting;
}
function state() { return { follow: prefs.follow, expanded: prefs.expanded, hidden: prefs.hidden, preferenceError, tracking: !!anchor, visible: !!win?.isVisible(), compactSize: compactSize(prefs.compactSize), transitioning: !!boundsTimer, transition: pendingTransition ? {id:pendingTransition.id,fromExpanded:pendingTransition.fromExpanded} : null, panelSize, platform: process.platform }; }
function cancelTransition() {
  clearTimeout(boundsTimer); boundsTimer=null; pendingTransition=null;
}
function finishTransition(id=pendingTransition?.id) {
  if (!pendingTransition || pendingTransition.id!==id || !win || win.isDestroyed()) return;
  const transition=pendingTransition;
  cancelTransition();
  // Change native geometry only after the outgoing view has faded away.
  win.setBounds(transition.next,false);
  renderedExpanded=prefs.expanded;
  transition.settle(); sendState(); diagnostics();
}
function sendState() {
  if (!isReady || win.isDestroyed()) return;
  const next = state(), serialized = JSON.stringify(next);
  if (serialized !== lastSentState) { lastSentState = serialized; win.webContents.send('continuer:state', next); }
}
function position(animate = false) {
  if (!win || win.isDestroyed() || dragging || pointerDrag?.active || (boundsTimer && !animate)) return;
  // A user drop is authoritative. Do not snap it back to the work area, resize
  // it, or reinterpret it on an unchanged tracker tick.
  if (samePlacementContext(settledPlacement,placementContext())) return;
  const positionedContext=placementContext();
  const fromCard = restoringMode && prefs.expanded && expansionOrigin;
  const settle = () => {
    if (fromCard) {
      const bounds = win.getBounds();
      prefs.positions.expanded = bounds;
      if (prefs.follow && anchor) prefs.offsets.expanded = offsetFrom(anchor,bounds);
      expansionOrigin = null;
      save();
    }
    restoringMode=false; settledPlacement=fromCard ? placementContext() : positionedContext;
  };
  const current = win.getBounds();
  const saved = prefs.positions[mode()];
  const following = prefs.follow && anchor;
  const target = following ? anchor : { ...(saved || current), width: (saved || current).width + 16, height: (saved || current).height + 16 };
  const size = prefs.expanded ? sizes.expanded : { width: compactSize(prefs.compactSize), height: compactSize(prefs.compactSize) };
  const offset = prefs.follow && anchor ? (prefs.offsets[mode()] || prefs.offsets[prefs.expanded ? 'compact' : 'expanded']) : undefined;
  const desired = { x: target.x + target.width - size.width - (offset?.right ?? 16), y: target.y + target.height - size.height - (offset?.bottom ?? 16), ...size };
  const display = screen.getDisplayMatching(fromCard || desired);
  panelSize = { width: Math.min(sizes.expanded.width,display.workArea.width)-18, height: Math.min(sizes.expanded.height,display.workArea.height)-18 };
  if (!prefs.expanded) size.width=size.height=Math.min(size.width,display.workArea.width,display.workArea.height);
  let next = fromCard ? expandFromCard(fromCard,display.workArea,size) : following ? place(target, display.workArea, size, offset) : placeIndependent(saved,current,display.workArea,size);
  if (restoringMode && !fromCard) {
    const remembered=following ? (prefs.offsets[mode()] ? {x:target.x+target.width-next.width-offset.right,y:target.y+target.height-next.height-offset.bottom} : null) : saved;
    next=restoreModePosition(next,remembered,display.workArea);
  }
  // Windows fractional DPI can round a 432 DIP window to 433 on readback.
  if (Object.keys(next).some(key => Math.abs(current[key] - next[key]) > 1)) {
    cancelTransition();
    if (!animate || !win.isVisible()) { win.setBounds(next,false); renderedExpanded=prefs.expanded; settle(); }
    else {
      const id=++transitionSequence;
      pendingTransition={id,next,settle,fromExpanded:renderedExpanded};
      // Renderer acknowledges opacity=0; the timeout also handles hidden,
      // reloading, or reduced-motion renderers without leaving a stuck view.
      boundsTimer=setTimeout(()=>finishTransition(id),240);
    }
  } else { cancelTransition(); renderedExpanded=prefs.expanded; settle(); }
}
function show(force = false, animate = false) {
  if (!win || !isReady) return;
  // Tracking still records the latest anchor, but must not query/mutate the
  // window, send renderer state, or write diagnostics during a user drag.
  if (!force && !prefs.hidden && (dragging || pointerDrag?.active)) return;
  position(animate);
  if (!prefs.hidden && (force || menuOpen || !prefs.follow || targetVisible || win.isFocused())) {
    if (!win.isVisible()) win.showInactive();
    if (force) win.focus();
  } else win.hide();
  sendState(); diagnostics();
}
function beginDrag() {
  cancelTransition();
  dragging = true;
}
function savePosition() {
  const bounds = win.getBounds();
  prefs.positions[mode()] = bounds;
  if (prefs.follow && anchor) prefs.offsets[mode()] = offsetFrom(anchor,bounds);
  settledPlacement=placementContext();
  save(); diagnostics();
}
function finishDrag() {
  if (!dragging) return;
  dragging = false; savePosition();
}
function changeExpanded(expanded) {
  if (prefs.expanded === expanded) return;
  pointerDrag?.finish();
  let origin = null;
  // Record the departing mode only after its layout has settled. Never save
  // an intermediate animation rectangle as a compact or expanded position.
  if (isReady && win && !win.isDestroyed() && !boundsTimer && !dragging) {
    const bounds=win.getBounds();
    // Native dimensions can differ by several DIP during a display/DPI change.
    // The committed view mode, rather than a size tolerance, tells us whether
    // these are the departing mode's settled bounds.
    if (renderedExpanded === prefs.expanded) {
      prefs.positions[mode()]=bounds;
      if (prefs.follow && anchor) prefs.offsets[mode()]=offsetFrom(anchor,bounds);
      if (!prefs.expanded && !renderedExpanded) origin = bounds;
    }
  }
  // A remembered compact drop must not suppress a later expanded -> compact
  // layout, nor may a cancelled animation resume after a rapid reverse toggle.
  cancelTransition();
  settledPlacement=null;
  restoringMode=true;
  expansionOrigin=expanded ? origin : null;
  dragging=false;
  prefs.expanded=expanded;
}
function syncTracker() {
  if (process.platform !== 'win32') { prefs.follow = false; return; }
  if (!prefs.follow) {
    const previous = tracker; tracker = null;
    previous?.kill();
    anchor = null; targetVisible = false;
    return;
  }
  if (tracker) return;
  const native = join(__dirname, 'continuer-monitor.exe');
  const command = existsSync(native) ? native : 'powershell.exe';
  const args = command === native ? ['--track', String(process.pid)] : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, 'follow-window.ps1'), '-WidgetPid', String(process.pid)];
  const child = tracker = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (tracker !== child || closing) return;
    try {
      const result = JSON.parse(line);
      targetVisible = !!result.visible;
      anchor = result.found ? screen.screenToDipRect(null, { x: result.x, y: result.y, width: result.width, height: result.height }) : null;
      show();
    } catch {}
  });
  const ended = () => {
    lines.close();
    if (tracker !== child) return;
    tracker = null;
    if (!closing) { prefs.follow = false; anchor = null; targetVisible = false; show(true); }
  };
  child.on('error', ended);
  child.on('exit', ended);
}
async function start() {
  const { interfaceText } = await import('../public/i18n.js');
  nativeText = text => interfaceText(text, prefs.language || 'zh');
  const runtime = await import('../plugin/runtime.js');
  await runtime.ensureService();
  const display = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({ x: display.x + display.width - sizes.compact.width - 16, y: display.y + display.height - sizes.compact.height - 16, ...sizes.compact, show: false, alwaysOnTop: false, frame: false, thickFrame: false, roundedCorners: false, transparent: true, backgroundColor: '#00000000', resizable: false, skipTaskbar: true, hasShadow: false, autoHideMenuBar: true, title: 'Codex Continuer Widget', webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error('挂件页面错误：' + details.message.slice(0, 2000)); });
  for (const name of ['will-navigate', 'will-redirect']) win.webContents.on(name, (event, url) => { if (url !== origin + '/widget') event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const pinned = localTls.readIdentity(dataDir, process.env.CONTINUER_DEMO === '1').certificate;
  win.webContents.session.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === '127.0.0.1' && localTls.matchesCertificate(request.certificate.data, pinned) ? 0 : -2);
  });
  // Keep the native credential in the main process and never attach it to
  // another window, origin, static asset or redirected request.
  win.webContents.session.webRequest.onBeforeSendHeaders({ urls: [origin + '/api/*'] }, (details, callback) => {
    try {
      const token = runtime.readAccessToken();
      if (details.webContentsId === win.webContents.id && new URL(details.url).origin === origin && token) details.requestHeaders.Authorization = 'Bearer ' + token;
      callback({ requestHeaders: details.requestHeaders });
    } catch { callback({ cancel: true }); }
  });
  win.on('close', event => { if (!shutdownComplete) { event.preventDefault(); void quitAll(); } });
  // will-move is emitted for native user dragging, not our setBounds calls.
  win.on('will-move', () => { if (!dragging && !pointerDrag.active) beginDrag(); });
  win.on('moved', () => { if (dragging && !pointerDrag.active) finishDrag(); });
  pointerDrag = createPointerDrag({
    getCursor: () => screen.getCursorScreenPoint(),
    getBounds: () => win.getBounds(),
    // setPosition can accumulate fractional-DPI size rounding on every move.
    setPosition: (x,y,bounds) => win.setBounds({ x,y,width:bounds.width,height:bounds.height },false),
    onMove: cancelTransition,
    onFinish: moved => { if (moved) savePosition(); },
  });
  win.on('blur', () => pointerDrag.finish());
  win.on('hide', () => { pointerDrag.finish(); finishTransition(); });
  let rendererRestarts = 0;
  win.webContents.on('render-process-gone', (_event, detail) => {
    pointerDrag.finish(); isReady = false; lastDiagnostic = null; lastSentState = null;
    try { writeFileSync(join(dataDir, 'widget-status.json'), JSON.stringify({ ...runtimeConfig.appInfo(), pid: process.pid, ready: false, exitReason: `renderer-${detail.reason}` })); } catch {}
    if (!closing && rendererRestarts++ < 3) setTimeout(() => { if (!closing && !win.isDestroyed()) win.reload(); }, 1000 * rendererRestarts);
  });
  win.webContents.on('did-finish-load', () => { if (isReady) show(); });
  const allowed = event => event.sender === win.webContents && event.senderFrame.url === origin + '/widget';
  ipcMain.handle('continuer:control', (event, action, value) => {
    if (!allowed(event)) throw new Error('Untrusted widget request');
    if (action === 'language' && ['zh', 'en'].includes(value)) { if (prefs.language !== value) { prefs.language = value; save(); refreshMenu(); } return state(); }
    if (action === 'renderer-ready') { isReady = true; show(); return state(); }
    if (action === 'quit') { setImmediate(() => { void quitAll(); }); return { quitting: true }; }
    if (action === 'transition-ready') { finishTransition(value); return state(); }
    if (action === 'drag-start') {
      if (!Number.isInteger(value) || prefs.expanded || boundsTimer || dragging) return { ok:false };
      return pointerDrag.start(value);
    }
    if (action === 'drag-end') return pointerDrag.finish(value?.id);
    if (action !== 'state') pointerDrag.finish();
    if (action === 'expand' && typeof value === 'boolean') changeExpanded(value);
    else if (action === 'follow' && typeof value === 'boolean') { prefs.follow = value; syncTracker(); }
    else if (action === 'hide') prefs.hidden = true;
    else if (action === 'reset-position') { settledPlacement=null; prefs.offsets = {}; prefs.positions = {}; }
    else if (action === 'compact-size' && Number.isFinite(value) && value >= 160 && value <= 420) prefs.compactSize=compactSize(value);
    else if (action === 'state') return state();
    else throw new Error('Unsupported action');
    save(); show(action === 'expand',action === 'expand' || action === 'compact-size'); return state();
  });
  ipcMain.handle('continuer:pick-directory', async event => {
    if (!allowed(event)) throw new Error('Untrusted widget request');
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: nativeText('选择工作项目目录') });
    return result.canceled ? null : result.filePaths[0];
  });
  tray = new Tray(nativeImage.createFromPath(join(__dirname, 'icon.png')));
  const reveal = () => { prefs.hidden = false; changeExpanded(true); save(); show(true,true); };
  refreshMenu = () => {
    tray.setToolTip(nativeText('Codex Continuer · 额度与持续工作'));
    widgetMenu = Menu.buildFromTemplate([
      { label: nativeText('打开额度与工作面板'), click: reveal },
      { label: nativeText('跟随 Codex 窗口'), click: () => { prefs.follow = true; prefs.hidden = false; syncTracker(); save(); show(); } },
      { label: nativeText('独立显示面板'), click: () => { prefs.follow = false; syncTracker(); reveal(); } },
      { label: nativeText('重置挂件位置'), click: () => { settledPlacement=null; prefs.offsets = {}; prefs.positions = {}; save(); show(true); } },
      { type: 'separator' },
      { label: nativeText('隐藏到托盘'), click: () => { prefs.hidden = true; save(); show(); } },
      { label: nativeText('退出 Continuer'), click: () => { void quitAll(); } },
    ]);
    tray.setContextMenu(widgetMenu);
  };
  refreshMenu();
  const popupMenu = () => {
    if (menuOpen) return;
    pointerDrag.finish();
    menuOpen = true;
    widgetMenu.popup({ window: win, callback: () => { menuOpen = false; } });
  };
  win.webContents.on('context-menu', (_event,params) => { if (!params.isEditable) popupMenu(); });
  win.on('system-context-menu', event => { event.preventDefault(); popupMenu(); });
  tray.on('click', reveal);
  globalShortcut.register('CommandOrControl+Alt+C', reveal);
  const displayChanged = () => { settledPlacement=null; show(); };
  screen.on('display-removed',displayChanged);
  screen.on('display-metrics-changed',displayChanged);
  syncTracker();
  await win.loadURL(origin + '/widget');
}
app.on('before-quit', event => {
  if (!ownsInstance) return;
  if (!shutdownComplete) { event.preventDefault(); void quitAll(); return; }
  closing = true; pointerDrag?.finish(); cancelTransition(); tracker?.kill(); globalShortcut.unregisterAll(); tray?.destroy();
  try { writeFileSync(join(dataDir, 'widget-status.json'), JSON.stringify({ ...runtimeConfig.appInfo(), pid: process.pid, ready: false, exitReason: 'user-quit', updatedAt: Date.now() })); } catch {}
});
app.on('window-all-closed', () => app.quit());
