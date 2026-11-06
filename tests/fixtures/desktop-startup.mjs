import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import * as fs from 'node:fs';
const require=createRequire(import.meta.url), repo=process.cwd(), out=resolve('.cache/isolated-desktop-fixture');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function scenario(hidden,automatic=false,failure=false,reopen=null,exitDuring=null){
const handlers=new Map(),workArea={x:0,y:0,width:1920,height:1080},trace=[];
const startGate=deferred(),stopGate=deferred();let ensureCalls=0;
let win,menu,lastStatus,identity,stopCalls=0,quitCalls=0;let saved={follow:false,expanded:false,hidden,compactSize:256,positions:{},offsets:{}};
const app=new EventEmitter();Object.assign(app,{setName(){},setPath(){},requestSingleInstanceLock:value=>{identity=value;return true;},whenReady:()=>Promise.resolve(),quit(){quitCalls++;app.emit('before-quit',{preventDefault(){}});}});
class Window extends EventEmitter {
 constructor(options){super();win=this;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.visible=false;this.webContents=new EventEmitter();Object.assign(this.webContents,{id:1,setWindowOpenHandler(){},send(){},session:{setPermissionRequestHandler(){},setCertificateVerifyProc(){},webRequest:{onBeforeSendHeaders(){}}}});}
 getBounds(){return {...this.bounds};} setBounds(b){this.bounds={...b};trace.push({setBounds:b});}
 isDestroyed(){return false;}isVisible(){return this.visible;}isFocused(){return !!this.focused;}showInactive(){this.visible=true;}hide(){this.visible=false;}focus(){this.focused=true;}
 async loadURL(){this.loaded=true;if(failure)throw Error('Mock page load failure');}
}
class Tray extends EventEmitter {setToolTip(){}setContextMenu(){}destroy(){}}
const mocks={
 electron:{app,BrowserWindow:Window,screen:{on(){},getPrimaryDisplay:()=>({workArea}),getDisplayMatching:()=>({workArea})},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},Tray,Menu:{buildFromTemplate:items=>{menu=items;return {popup(){}};}},nativeImage:{createFromPath:()=>({})},dialog:{showErrorBox:()=>{}},globalShortcut:{register(){},unregisterAll(){}}},
 '../server/config.cjs':{dataDir:join(out,'mock-window-data'),port:4317,appInfo:()=>({version:'0.7.0'})},
 '../server/logging.cjs':{installLogs(){}},'../server/local-tls.cjs':{readIdentity:()=>({certificate:'mock'}),matchesCertificate:()=>false},
 'node:fs':{mkdirSync(){},readFileSync:()=>JSON.stringify(saved),writeFileSync:(file,text)=>{if(String(file).endsWith('widget-preferences.json'))saved=JSON.parse(text);else if(String(file).endsWith('widget-status.json'))lastStatus=JSON.parse(text);},existsSync:()=>false},
 'node:child_process':{spawn(){throw Error('Unexpected process launch');}},
};
const context=vm.createContext({console,setImmediate,setTimeout,clearTimeout,__dirname:join(repo,'desktop')});
const script=new vm.Script('(function(module){'+fs.readFileSync(join(repo,'desktop/runtime.cjs'),'utf8')+'\n})',{filename:join(repo,'desktop/runtime.cjs'),importModuleDynamically:async name=>{
 const values=name==='../public/i18n.js'?{interfaceText:id=>id}:name==='../plugin/runtime.js'?{ensureService:async()=>{ensureCalls++;if(exitDuring?.startsWith('service'))await startGate.promise;},stopBackground:async()=>{stopCalls++;if(exitDuring)await stopGate.promise;}}:null;if(!values)throw Error('Unexpected import '+name);
 const m=new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});await m.link(()=>{});await m.evaluate();return m;
}});
const mod={exports:{}};script.runInContext(context)(mod);
const runtime=mod.exports.createDesktopRuntime({load:name=>mocks[name]??(name.startsWith('.')?require(join(repo,'desktop',name)):require(name)),processInfo:{env:{},argv:automatic?['--auto']:[],pid:1,platform:'win32'}});
if(reopen==='before-window')app.emit('second-instance',{},[],repo,identity);
if(exitDuring?.startsWith('service')){
 for(let i=0;i<100&&!ensureCalls;i++)await new Promise(r=>setTimeout(r,5));assert.equal(ensureCalls,1);
 app.emit('second-instance',{},['--quit'],repo,identity);
 for(let i=0;i<100&&!stopCalls;i++)await new Promise(r=>setTimeout(r,5));assert.equal(stopCalls,1);
 if(exitDuring==='service-error')startGate.reject(Error('Startup cancelled'));else startGate.resolve();
 await new Promise(r=>setTimeout(r,20));assert.equal(win,undefined,'quit cancels the pending window creation');assert.equal(quitCalls,0,'startup callbacks must not interrupt background shutdown');
 stopGate.resolve();await new Promise(r=>setTimeout(r,20));assert.equal(lastStatus.exitReason,'user-quit');
 return {exitDuring,stopCalls,quitCalls,exitReason:lastStatus.exitReason};
}
for(let i=0;i<100&&!win?.loaded;i++)await new Promise(r=>setTimeout(r,10));
assert.ok(win.loaded);
const event={sender:win.webContents,senderFrame:{url:'https://127.0.0.1:4317/widget'}},control=(action,value)=>handlers.get('continuer:control')(event,action,value);
await new Promise(r=>setTimeout(r,20));
if(failure){assert.equal(stopCalls,0);assert.equal(quitCalls,1);assert.equal(lastStatus.exitReason,'startup-failed');return {failure,stopCalls,quitCalls,exitReason:lastStatus.exitReason};}
if(exitDuring==='renderer'){
 app.emit('second-instance',{},['--quit'],repo,identity);
 for(let i=0;i<100&&!stopCalls;i++)await new Promise(r=>setTimeout(r,5));assert.equal(stopCalls,1);
 control('renderer-ready');menu.find(item=>item.label==='native.open_quota_and_work_panel').click();
 assert.equal(win.visible,false,'late readiness and tray clicks must not reveal an exiting window');assert.equal(lastStatus.ready,false);
 stopGate.resolve();await new Promise(r=>setTimeout(r,20));assert.equal(lastStatus.exitReason,'user-quit');
 return {exitDuring,stopCalls,quitCalls,exitReason:lastStatus.exitReason};
}
if(reopen==='before-renderer')app.emit('second-instance',{},[],repo,identity);
if(reopen==='tray-before-renderer')menu.find(item=>item.label==='native.open_quota_and_work_panel').click();
control('renderer-ready');const afterStartup=runtime.state();
assert.equal(afterStartup.hidden,false);assert.equal(afterStartup.visible,true);
if(reopen){assert.equal(win.focused,true,'manual reveal must survive renderer startup');assert.equal(afterStartup.expanded,true);control('expand',false);runtime.finishTransition();}
win.bounds={x:650,y:240,width:256,height:256};runtime.savePosition();control('reset-position');
assert.deepEqual(win.getBounds(),{x:1648,y:808,width:256,height:256});
const reset=win.getBounds();
win.bounds={x:700,y:300,width:256,height:256};runtime.savePosition();menu.find(item=>item.label==='ui.reset_widget_position').click();assert.deepEqual(win.getBounds(),reset);
control('quit');await new Promise(r=>setTimeout(r,20));assert.equal(stopCalls,1);assert.equal(lastStatus.exitReason,'user-quit');
return {savedHidden:hidden,automatic,reopen,afterStartup,reset,stopCalls,exitReason:lastStatus.exitReason};
}
const results=[];
for(const [hidden,automatic,failure] of [[true,false,false],[true,true,false],[false,false,false],[false,true,true],[false,false,true]])results.push(await scenario(hidden,automatic,failure));
for(const reopen of ['before-window','before-renderer','tray-before-renderer'])results.push(await scenario(true,true,false,reopen));
for(const exitDuring of ['service','service-error','renderer'])results.push(await scenario(false,false,false,null,exitDuring));
console.log(JSON.stringify(results));
