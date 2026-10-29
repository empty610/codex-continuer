const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const page = process.env.CONTINUER_TEST_ANIMATION_PAGE;
const output = process.env.CONTINUER_TEST_ANIMATION_OUTPUT;
const captureDir = process.env.CONTINUER_TEST_ANIMATION_CAPTURE;
const mark = stage => fs.writeFileSync(output, JSON.stringify({ stage }));
mark('starting');
app.setPath('userData', path.join(path.dirname(output), 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  mark('window-created');
  await win.loadURL('about:blank');
  win.webContents.debugger.attach();
  const command = (method, params) => win.webContents.debugger.sendCommand(method, params);
  const { result: globalObject } = await command('Runtime.evaluate', { expression: 'globalThis' });
  // HTML is protocol data, never part of executable source. Parse it inertly
  // and remove all script elements before importing the production markup.
  const { result, exceptionDetails } = await command('Runtime.callFunctionOn', {
    objectId: globalObject.objectId,
    functionDeclaration: `function (html) {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      parsed.querySelectorAll('script').forEach(script => script.remove());
      document.replaceChild(document.importNode(parsed.documentElement, true), document.documentElement);
      return { scriptsRemaining: document.querySelectorAll('script').length, scriptRan: !!globalThis.fixtureScriptRan };
    }`,
    arguments: [{ value: fs.readFileSync(page, 'utf8') }], returnByValue: true,
  });
  if (exceptionDetails) throw Error(exceptionDetails.text);
  mark('page-loaded');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  mark('media-configured');
  await win.webContents.executeJavaScript("document.querySelector('#mini').classList.add('has-art');document.querySelector('#mini').dataset.motion='running';document.querySelector('#mini-quota').textContent='77';document.querySelector('#mini-reset').textContent='02:00:00';document.querySelector('#mini-reset').classList.remove('visually-empty');document.getAnimations().forEach(a=>a.pause());");
  mark('initialized');
  const phases = [];
  for (const at of [0, 12000, 12300, 12600, 13000, 15000, 17000, 18000, 18300, 18600, 18900, 19200, 21000, 24000, 30000, 45000, 59000]) {
    phases.push(await win.webContents.executeJavaScript("document.getAnimations().forEach(a=>a.currentTime=" + at + ");({at:" + at + ",opacity:Number(getComputedStyle(document.querySelector('#gauge-readout')).opacity),animation:getComputedStyle(document.querySelector('#gauge-readout')).animationName,flight:Number(getComputedStyle(document.querySelector('.rhine-signal-launch-stage')).opacity),signal:Number(getComputedStyle(document.querySelector('.rhine-signal-data')).opacity)})"));
    if (captureDir && [0, 13000, 15000, 18000, 19200, 21000, 24000, 30000].includes(at)) {
      fs.mkdirSync(captureDir, { recursive: true });
      await new Promise(resolve => setTimeout(resolve, 40));
      fs.writeFileSync(path.join(captureDir, 'phase-' + at + '.png'), (await win.webContents.capturePage()).toPNG());
    }
  }
  const position = await win.webContents.executeJavaScript("(() => {const node=document.querySelector('.rhine-signal-data-line'),box=node.getBoundingClientRect(),label=document.querySelector('#mini-window').getBoundingClientRect(),reset=document.querySelector('#mini-reset').getBoundingClientRect();return {offset:node.transform.baseVal.consolidate().matrix.f,top:box.top,bottom:box.bottom,labelBottom:label.bottom,resetTop:reset.top};})()");
  mark('phases-checked');
  await win.webContents.executeJavaScript("document.getAnimations().forEach(a=>a.currentTime=0);document.querySelector('#mini').classList.add('is-refreshing');globalThis.fade=document.querySelector('#quota-readout').getAnimations().find(a=>a.animationName==='quota-reload');fade.pause();");
  const duration = await win.webContents.executeJavaScript('fade.effect.getTiming().duration');
  const frames = [];
  for (const at of [0, 250, 500, 750, 1000]) {
    frames.push(await win.webContents.executeJavaScript("fade.currentTime=" + at + ";if(" + at + ">=500){document.querySelector('#mini-quota').textContent='39';document.querySelector('#mini-window').textContent='七天可用额度';document.querySelector('#mini-reset').textContent='1天 02:00:00'}({at:" + at + ",opacity:Number(getComputedStyle(document.querySelector('#quota-readout')).opacity)})"));
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      await new Promise(resolve => setTimeout(resolve, 40));
      fs.writeFileSync(path.join(captureDir, 'quota-' + at + '.png'), (await win.webContents.capturePage()).toPNG());
    }
  }
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reduced = await win.webContents.executeJavaScript("({opacity:Number(getComputedStyle(document.querySelector('#gauge-readout')).opacity),animation:getComputedStyle(document.querySelector('#gauge-readout')).animationName})");
  fs.writeFileSync(output, JSON.stringify({ ...result.value, phases, frames, duration, position, reduced }));
  win.destroy(); app.quit();
}).catch(error => { fs.writeFileSync(output, JSON.stringify({ error: error.stack })); app.exit(1); });
