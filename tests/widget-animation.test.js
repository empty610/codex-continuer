import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile), electron = fileURLToPath(new URL('../node_modules/electron/dist/electron.exe', import.meta.url));
test('real quota CSS stays visible across artwork phases and fades smoothly over one second', { skip: process.platform !== 'win32' || !existsSync(electron), timeout: 25000 }, async () => {
  const parent = realpathSync(tmpdir()), dir = mkdtempSync(join(parent, 'continuer-quota-animation-'));
  const output = join(dir, 'result.json'), probe = join(dir, 'probe.cjs'), page = join(dir, 'preview.html');
  const captureDir = process.env.CONTINUER_CAPTURE_DIR ? resolve(process.env.CONTINUER_CAPTURE_DIR) : null;
  const css = readFileSync(new URL('../public/widget.css', import.meta.url), 'utf8');
  const art = readFileSync(new URL('../public/rhine-signal-loop.svg', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/widget.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace('<link rel="stylesheet" href="/widget.css">', '<style>' + css + '</style>')
    .replace('<body>', '<body class="collapsed">').replace('<div id="rhine-art" aria-hidden="true"></div>', '<div id="rhine-art" aria-hidden="true">' + art + '</div>');
  writeFileSync(page, html);
  writeFileSync(probe, `
    const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const path=require('node:path');
    const mark=stage=>fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({stage}));mark('starting');
    app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({width:256,height:256,show:false,frame:false,transparent:true,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
      mark('window-created');
      await win.loadFile(${JSON.stringify(page)});
      mark('page-loaded');
      win.webContents.debugger.attach();await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      mark('media-configured');
      await win.webContents.executeJavaScript("document.querySelector('#mini').classList.add('has-art');document.querySelector('#mini').dataset.motion='running';document.querySelector('#mini-quota').textContent='77';document.querySelector('#mini-reset').textContent='02:00:00';document.querySelector('#mini-reset').classList.remove('visually-empty');document.getAnimations().forEach(a=>a.pause());");
      mark('initialized');
      const phases=[];for(const at of [0,15000,30000,45000,59000])phases.push(await win.webContents.executeJavaScript("document.getAnimations().forEach(a=>a.currentTime="+at+");({at:"+at+",opacity:Number(getComputedStyle(document.querySelector('#gauge-readout')).opacity),animation:getComputedStyle(document.querySelector('#gauge-readout')).animationName})"));
      mark('phases-checked');
      await win.webContents.executeJavaScript("document.getAnimations().forEach(a=>a.currentTime=0);document.querySelector('#mini').classList.add('is-refreshing');globalThis.fade=document.querySelector('#quota-readout').getAnimations().find(a=>a.animationName==='quota-reload');fade.pause();");
      const duration=await win.webContents.executeJavaScript('fade.effect.getTiming().duration');
      const frames=[];for(const at of [0,250,500,750,1000]){
        frames.push(await win.webContents.executeJavaScript("fade.currentTime="+at+";if("+at+">=500){document.querySelector('#mini-quota').textContent='39';document.querySelector('#mini-window').textContent='七天可用额度';document.querySelector('#mini-reset').textContent='1天 02:00:00'}({at:"+at+",opacity:Number(getComputedStyle(document.querySelector('#quota-readout')).opacity)})"));
        if(${JSON.stringify(captureDir)}){fs.mkdirSync(${JSON.stringify(captureDir)},{recursive:true});await new Promise(r=>setTimeout(r,40));fs.writeFileSync(path.join(${JSON.stringify(captureDir)},'quota-'+at+'.png'),(await win.webContents.capturePage()).toPNG());}
      }
      fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({phases,frames,duration}));win.destroy();app.quit();
    }).catch(error=>{fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({error:error.stack}));app.exit(1)});
  `);
  try {
    try { await execute(electron, ['--disable-gpu', probe], { env: { ...process.env, NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: undefined }, timeout: 20000, windowsHide: true }); }
    catch (error) { error.message += existsSync(output) ? '\nProbe: ' + readFileSync(output, 'utf8') : '\nProbe did not start'; throw error; }
    const result = JSON.parse(readFileSync(output, 'utf8')); assert.equal(result.error, undefined);
    assert.equal(result.duration, 1000);
    for (const phase of result.phases) { assert.equal(phase.opacity, 1); assert.equal(phase.animation, 'none'); }
    assert.equal(result.frames[0].opacity, 1); assert.equal(result.frames[2].opacity, 0); assert.equal(result.frames[4].opacity, 1);
    for (const index of [1, 3]) assert.ok(result.frames[index].opacity > 0 && result.frames[index].opacity < 1);
  } finally { assert.equal(dirname(realpathSync(dir)), parent); rmSync(dir, { recursive: true, force: true }); }
});
