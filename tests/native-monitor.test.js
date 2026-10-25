import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';

test('native monitor preserves launch, duplicate, desktop restart, error and pipe behavior', { skip:process.platform!=='win32', timeout:25000 }, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'continuer monitor '));
  const root=join(dir,'plugin 空间'),data=join(dir,'data 空间');
  mkdirSync(join(root,'plugin'),{recursive:true});mkdirSync(data);
  const key=join(dir,'desktop-key.txt');writeFileSync(key,'');
  // Isolate the test mutex from the real desktop watcher; all other monitor
  // code, process launching, quoting, status and retry behavior is production.
  const original=readFileSync(new URL('../desktop/monitor.cs',import.meta.url),'utf8');
  const source=original.replace('Local\\CodexContinuerStartupWatcher',`Local\\ContinuerMonitorTest_${process.pid}_${Date.now()}`);
  assert.notEqual(source,original);
  writeFileSync(join(dir,'monitor.cs'),source);
  writeFileSync(join(dir,'windows.cs'),`using System; using System.IO;
public static class ContinuerWindows {
 public static string DesktopKey() { return File.ReadAllText(Environment.GetEnvironmentVariable("CONTINUER_TEST_KEY")); }
 public static void Track(int pid) { Console.WriteLine("{\\\"pid\\\":" + pid + "}"); }
}`);
  writeFileSync(join(root,'plugin/open.js'),`const fs=require('node:fs'),path=require('node:path');
const data=process.env.CONTINUER_DATA_DIR;
if(fs.existsSync(path.join(data,'fail'))) throw Error('test launch failure');
if(!process.argv.includes('--auto')) throw Error('missing automatic flag');
fs.appendFileSync(path.join(data,'launches'), 'launched\\n');
console.log('widget opened');console.error('diagnostic stderr');`);
  const exe=join(dir,'monitor.exe');
  const compiler=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(compiler,['/nologo','/target:winexe',`/out:${exe}`,join(dir,'monitor.cs'),join(dir,'windows.cs')],{windowsHide:true});
  const env={...process.env,CONTINUER_TEST_KEY:key};
  const args=['--watch',process.execPath,root,data];
  const child=spawn(exe,args,{env,windowsHide:true,stdio:'ignore'});
  const status=()=>{try{return JSON.parse(readFileSync(join(data,'autostart-status.json'),'utf8'));}catch{return null;}};
  const launches=()=>existsSync(join(data,'launches'))?readFileSync(join(data,'launches'),'utf8').trim().split('\n').length:0;
  async function until(predicate) { const end=Date.now()+6500;while(Date.now()<end){if(predicate())return;await delay(50);}assert.fail('Monitor state timed out'); }
  try {
    await until(()=>status()?.state==='watching');
    writeFileSync(key,'desktop-1');await until(()=>status()?.state==='launched');
    assert.equal(launches(),1);assert.equal(status().pluginRoot,root);assert.equal(status().runtime,'native');
    assert.match(readFileSync(join(data,'autostart-launch.log'),'utf8'),/widget opened/);
    assert.match(readFileSync(join(data,'autostart-error.log'),'utf8'),/diagnostic stderr/);
    const duplicate=spawn(exe,args,{env,windowsHide:true,stdio:'ignore'});
    assert.equal((await once(duplicate,'exit'))[0],0);
    await delay(2100);assert.equal(launches(),1);
    writeFileSync(key,'');await until(()=>status()?.state==='watching');
    writeFileSync(key,'desktop-2');await until(()=>launches()===2);
    writeFileSync(join(data,'fail'),'1');writeFileSync(key,'desktop-3');
    await until(()=>status()?.state==='retrying');
    assert.match(readFileSync(join(data,'autostart-error.log'),'utf8'),/test launch failure/);
    await delay(2100);assert.equal(launches(),2);
    const output=execFileSync(exe,['--track','123'],{encoding:'utf8',windowsHide:true});
    assert.deepEqual(JSON.parse(output),{pid:123});
  } finally { child.kill();await once(child,'exit'); }
});
