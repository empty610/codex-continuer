import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');

function fixture(x=700,y=300,nativeMonitor=true,rounding=0) {
  let now=0,serial=0,bounds={x,y,width:160+rounding,height:160+rounding},top=false;
  const timers=new Map(),updates=[],children=[];
  const prefs={follow:false,expanded:false,hidden:false,compactSize:160,offsets:{},positions:{}};
  const window={getBounds:()=>({...bounds}),setBounds:next=>{bounds={...next,width:next.width+rounding,height:next.height+rounding};updates.push({...next});},
    isDestroyed:()=>false,isVisible:()=>true,isFocused:()=>true,isAlwaysOnTop:()=>top,
    setAlwaysOnTop:value=>{top=value;},focus:()=>{},hide:()=>{},webContents:{send:()=>{}}};
  const app={setName:()=>{},setPath:()=>{},requestSingleInstanceLock:()=>true,on:()=>{},
    whenReady:()=>({then:()=>({catch:()=>{}})})};
  const context=vm.createContext({
    require:name=>name==='electron'?{app,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1080}}),screenToDipRect:(_window,rect)=>rect}}:
      name==='node:fs'?{mkdirSync:()=>{},readFileSync:()=>JSON.stringify(prefs),writeFileSync:()=>{},existsSync:()=>nativeMonitor}:
      name==='node:child_process'?{spawn:(command,args,options)=>{const child=new EventEmitter();Object.assign(child,{command,args,options});child.stdout={};child.stderr={resume:()=>{}};child.kill=()=>{child.killed=true;};children.push(child);return child;}}:
      name==='node:readline'?{createInterface:({input})=>{const lines=new EventEmitter();lines.close=()=>{lines.closed=true;};input.lines=lines;return lines;}}:
      name.startsWith('./')?require('../desktop/'+name.slice(2)):require(name),
    __dirname:'E:/codex_continuer/desktop',process:{env:{},argv:[],pid:1,platform:'win32'},
    performance:{now:()=>now},setTimeout:(callback,delay)=>{const id=++serial;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
  });
  vm.runInContext(source+'\nglobalThis.layout={init:w=>{win=w;isReady=true},changeExpanded,finishTransition,show,savePosition,state,getPrefs:()=>prefs,setFollow:value=>{prefs.follow=value;syncTracker();}};',context);
  const layout=context.layout;layout.init(window);
  function advance(ms=450){for(let elapsed=0;elapsed<ms;elapsed+=16){now+=16;for(const [id,timer] of [...timers])if(now>=timer.at){timers.delete(id);timer.callback();}}}
  function toggle(expanded){layout.changeExpanded(expanded);layout.show(true,true);}
  return {layout,toggle,advance,updates,children,get top(){return top;},get bounds(){return {...bounds};},move:next=>{bounds={...bounds,...next};},get timers(){return timers.size;}};
}

test('show and mode switches leave the card in the normal window layer',()=>{
  const f=fixture();f.layout.show();f.toggle(true);f.advance();f.toggle(false);f.advance();
  assert.equal(f.top,false);
});

test('independent mode has no tracker and disabling follow stops it without changing mode',()=>{
  const f=fixture();f.layout.setFollow(false);assert.equal(f.children.length,0);
  f.layout.setFollow(true);f.layout.setFollow(true);assert.equal(f.children.length,1);
  const child=f.children[0];
  child.stdout.lines.emit('line',JSON.stringify({found:true,visible:true,x:0,y:0,width:1000,height:800}));
  assert.equal(f.layout.state().tracking,true);
  f.layout.setFollow(false);assert.equal(child.killed,true);assert.equal(f.layout.state().tracking,false);
  child.stdout.lines.emit('line',JSON.stringify({found:true,visible:true,x:0,y:0,width:1000,height:800}));
  child.emit('exit',0);
  assert.equal(child.stdout.lines.closed,true);assert.equal(f.layout.getPrefs().follow,false);
  assert.equal(f.layout.state().tracking,false);
  f.layout.setFollow(true);assert.equal(f.children.length,2);
  child.emit('error',Error('late error'));assert.equal(f.layout.getPrefs().follow,true);
});

test('a tracker failure falls back to independent mode and permits a later retry',()=>{
  const f=fixture();f.layout.setFollow(true);f.children[0].emit('error',Error('spawn failed'));
  assert.equal(f.layout.getPrefs().follow,false);assert.equal(f.layout.state().tracking,false);
  f.layout.setFollow(true);assert.equal(f.children.length,2);
});

test('follow uses the hidden native monitor and retains the source-only PowerShell fallback',()=>{
  const native=fixture();native.layout.setFollow(true);
  assert.ok(native.children[0].command.endsWith('continuer-monitor.exe'));
  assert.deepEqual([...native.children[0].args],['--track','1']);
  assert.equal(native.children[0].options.windowsHide,true);
  const fallback=fixture(700,300,false);fallback.layout.setFollow(true);
  assert.equal(fallback.children[0].command,'powershell.exe');
  assert.ok(fallback.children[0].args.some(arg=>arg.endsWith('follow-window.ps1')));
  assert.equal(fallback.children[0].options.windowsHide,true);
});

test('a pinned compact drop can expand and collapse back to its original position and size',()=>{
  const f=fixture();f.layout.savePosition();
  f.toggle(true);f.advance();assert.equal(f.bounds.width,432);
  f.toggle(false);f.advance();
  assert.deepEqual(f.bounds,{x:700,y:300,width:160,height:160});
  assert.equal(f.layout.state().transitioning,false);assert.equal(f.timers,0);
});

test('moving the detailed panel never overwrites the compact position',()=>{
  const f=fixture();f.layout.savePosition();f.toggle(true);f.advance();
  f.move({x:250,y:60});f.layout.savePosition();
  f.toggle(false);f.advance();assert.deepEqual(f.bounds,{x:700,y:300,width:160,height:160});
  f.toggle(true);f.advance();
  assert.equal(f.bounds.x+f.bounds.width,860);
  assert.equal(f.bounds.y,300);
});

test('expanding from a moved card ignores an expanded position saved elsewhere',()=>{
  const f=fixture();f.layout.savePosition();f.toggle(true);f.advance();
  f.move({x:180,y:20});f.layout.savePosition();
  f.toggle(false);f.advance();f.move({x:1300,y:100});f.layout.savePosition();
  f.toggle(true);f.advance();
  assert.deepEqual(f.bounds,{x:1028,y:100,width:432,height:720});
  f.toggle(false);f.advance();assert.deepEqual(f.bounds,{x:1300,y:100,width:160,height:160});
});

test('following expansion uses the card location and persists the new offset for later tracker updates',()=>{
  const f=fixture(1300,100);f.layout.setFollow(true);
  const tracker=f.children[0];
  tracker.stdout.lines.emit('line',JSON.stringify({found:true,visible:true,x:0,y:0,width:1000,height:900}));
  f.move({x:1300,y:100});f.layout.savePosition();
  f.layout.getPrefs().offsets.expanded={right:500,bottom:300};
  f.layout.getPrefs().positions.expanded={x:68,y:0,width:432,height:720};
  f.toggle(true);f.advance();
  assert.deepEqual(f.bounds,{x:1028,y:100,width:432,height:720});
  tracker.stdout.lines.emit('line',JSON.stringify({found:true,visible:true,x:10,y:20,width:1000,height:900}));
  assert.deepEqual(f.bounds,{x:1038,y:120,width:432,height:720});
});

test('rapid reversal cancels the old timer without storing intermediate geometry',()=>{
  const f=fixture();f.layout.savePosition();
  for(let i=0;i<5;i++) {f.toggle(true);f.advance(80);f.toggle(false);f.advance(32);}
  f.advance();
  assert.deepEqual(f.bounds,{x:700,y:300,width:160,height:160});
  const compact=f.layout.getPrefs().positions.compact;
  assert.equal(compact.x,700);assert.equal(compact.y,300);assert.equal(compact.width,160);
  assert.equal(f.timers,0);
});

test('collapse restores a deliberately parked edge position and unchanged tracker ticks keep it',()=>{
  const f=fixture(-40,300);f.layout.savePosition();
  f.toggle(true);f.advance();f.toggle(false);f.advance();
  assert.deepEqual(f.bounds,{x:-40,y:300,width:160,height:160});
  for(let i=0;i<5;i++)f.layout.show();
  assert.deepEqual(f.bounds,{x:-40,y:300,width:160,height:160});
});

test('a mode transition holds native geometry until fade acknowledgement, then changes it exactly once',()=>{
  const f=fixture();f.layout.savePosition();f.toggle(true);f.advance(80);
  assert.equal(f.bounds.width,160);assert.equal(f.updates.length,0);
  const transition=f.layout.state().transition;
  assert.equal(transition.fromExpanded,false);
  f.layout.finishTransition(transition.id);
  assert.equal(f.bounds.width,432);assert.equal(f.updates.length,1);
  assert.equal(f.layout.state().transitioning,false);assert.equal(f.timers,0);
  f.advance();assert.equal(f.updates.length,1);
});

test('a stale fade acknowledgement cannot commit a reversed transition',()=>{
  const f=fixture();f.layout.savePosition();f.toggle(true);
  const id=f.layout.state().transition.id;
  f.toggle(false);f.layout.finishTransition(id);f.advance();
  assert.deepEqual(f.bounds,{x:700,y:300,width:160,height:160});
  assert.equal(f.updates.length,0);assert.equal(f.timers,0);
});

test('repeated expansion does not accumulate fractional-DPI rounding or overwrite the compact drop',()=>{
  for (const rounding of [1,4]) {
    const f=fixture(1300,100,true,rounding);f.layout.savePosition();
    for(let cycle=0;cycle<50;cycle++) {
      f.toggle(true);f.advance();
      assert.equal(f.bounds.x,1028+rounding);assert.equal(f.bounds.y,100);
      f.toggle(false);f.advance();
      assert.deepEqual(f.bounds,{x:1300,y:100,width:160+rounding,height:160+rounding});
    }
  }
});
