import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSizeControls } from '../public/widget-size.js';

function fixture({native=true,control,storage=new Map()}={}) {
  const nodes=new Map(),classes=new Set(['collapsed']),calls=[],errors=[],windowEvents=new Map();
  const state={expanded:false,visible:true,compactSize:256,preferredPanelSize:{width:432,height:720}};
  const element=selector=>{
    if(!nodes.has(selector)) nodes.set(selector,{
      value:'',textContent:'',listeners:new Map(),capture:null,
      addEventListener(name,handler){this.listeners.set(name,handler);},
      setPointerCapture(id){this.capture=id;},hasPointerCapture(id){return this.capture===id;},releasePointerCapture(){this.capture=null;},
      emit(name,event={}){return this.listeners.get(name)?.({preventDefault(){},...event});},
    });
    return nodes.get(selector);
  };
  const window={innerWidth:256,innerHeight:256,addEventListener:(name,handler)=>windowEvents.set(name,handler)};
  const document={querySelector:element,body:{classList:{contains:name=>classes.has(name)}},documentElement:{style:{setProperty(){}}}};
  const bridge={async control(action,value){
    calls.push({action,value:structuredClone(value)});
    if(control)return control(action,value);
    if(action==='compact-size')state.compactSize=value;
    else if(action==='panel-size')state.preferredPanelSize={...value};
    else if(action==='resize' && value.expanded===state.expanded) {
      if(value.expanded)state.preferredPanelSize={width:value.width,height:value.height};else state.compactSize=value.width;
    }
    return structuredClone(state);
  }};
  const ui=mountSizeControls({document,window,bridge:native?bridge:null,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},onState:result=>{Object.assign(state,result);ui.apply(result);},onError:error=>errors.push(error)});
  if(native)ui.apply(state);
  return {state,calls,errors,storage,element,windowEvents,window,native:change=>ui.apply({...state,...change}),
    expanded(value){state.expanded=value;if(value)classes.delete('collapsed');else classes.add('collapsed');window.innerWidth=value?state.preferredPanelSize.width:state.compactSize;window.innerHeight=value?state.preferredPanelSize.height:state.compactSize;},
    flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('native size sliders send independent dimensions and retain the latest draft during slow IPC',async()=>{
  let release;
  const f=fixture({control:()=>new Promise(resolve=>{release=resolve;})});
  f.element('#compact-size').emit('input',{target:{value:'280'}});
  f.element('#compact-size').emit('input',{target:{value:'320'}});
  f.element('#panel-width').emit('input',{target:{value:'600'}});
  f.element('#panel-height').emit('input',{target:{value:'840'}});
  assert.equal(f.calls.length,1);assert.equal(f.element('#compact-size').value,320);
  f.expanded(true);f.native({expanded:true});
  release({compactSize:280,preferredPanelSize:{width:432,height:720}});await f.flush();
  assert.deepEqual(f.calls[1],{action:'compact-size',value:320});
  assert.equal(f.element('#compact-size').value,320);
  release({compactSize:320,preferredPanelSize:{width:432,height:720}});await f.flush();
  assert.deepEqual(f.calls[2],{action:'panel-size',value:{width:600,height:840}});
  release({compactSize:320,preferredPanelSize:{width:600,height:840}});await f.flush();
  assert.equal(f.element('#panel-height').value,840);assert.equal(f.errors.length,0);
});

test('corner drag resizes compact and expanded views without expanding or moving the card',async()=>{
  const f=fixture(),handle=f.element('#resize-widget');
  handle.emit('pointerdown',{button:0,pointerId:1,screenX:100,screenY:100});
  handle.emit('pointermove',{pointerId:1,screenX:148,screenY:120});await f.flush();
  handle.emit('pointerup',{pointerId:1,screenX:148,screenY:120});await f.flush();
  assert.deepEqual(f.calls,[{action:'resize',value:{expanded:false,width:304,height:304}}]);
  assert.equal(f.state.expanded,false);assert.equal(handle.capture,null);
  f.expanded(true);
  handle.emit('pointerdown',{button:0,pointerId:2,screenX:50,screenY:50});
  handle.emit('pointerup',{pointerId:2,screenX:150,screenY:90});await f.flush();
  assert.deepEqual(f.calls.at(-1),{action:'resize',value:{expanded:true,width:532,height:760}});
});

test('resize cancellation, a stationary click and a mode change never submit a stale resize',async()=>{
  const f=fixture(),handle=f.element('#resize-widget');
  const down={button:0,pointerId:3,screenX:50,screenY:50};
  handle.emit('pointerdown',down);handle.emit('pointerup',down);assert.equal(f.calls.length,0);
  handle.emit('pointerdown',down);f.windowEvents.get('blur')();handle.emit('pointermove',{...down,screenX:90});assert.equal(f.calls.length,0);
  handle.emit('pointerdown',down);f.expanded(true);handle.emit('pointermove',{...down,screenX:90});assert.equal(f.calls.length,0);
  assert.equal(handle.capture,null);
});

test('keyboard and Ctrl-wheel resizing clamp inputs and browser sizes persist without native calls',async()=>{
  const f=fixture({native:false}),handle=f.element('#resize-widget');
  handle.emit('keydown',{key:'ArrowRight'});assert.equal(f.element('#compact-size').value,264);
  f.element('#mini').emit('wheel',{ctrlKey:true,deltaY:-1});assert.equal(f.element('#compact-size').value,280);
  f.expanded(true);f.element('#panel-width').emit('input',{target:{value:'10000'}});
  f.element('#panel-height').emit('input',{target:{value:'1'}});
  assert.deepEqual(JSON.parse(f.storage.get('continuer-panel-size')),{width:960,height:400});
  const restored=fixture({native:false,storage:f.storage});
  assert.equal(restored.element('#compact-size').value,280);assert.equal(restored.element('#panel-width').value,960);
  assert.equal(restored.element('#panel-height').value,400);assert.equal(restored.calls.length,0);
});

test('a late size reply cannot restore an older native view or overwrite a newer size event',async()=>{
  let release;
  const f=fixture({control:()=>new Promise(resolve=>{release=resolve;})});
  f.element('#compact-size').emit('input',{target:{value:'280'}});
  f.expanded(true);f.native({expanded:true,compactSize:320,preferredPanelSize:{width:600,height:800}});
  release({expanded:false,compactSize:280,preferredPanelSize:{width:432,height:720}});await f.flush();
  assert.equal(f.state.expanded,true);assert.equal(f.element('#compact-size').value,320);
  assert.equal(f.element('#panel-width').value,600);
});

test('changing view cancels queued drag sizes even after switching back before the old reply arrives',async()=>{
  let release;
  const f=fixture({control:()=>new Promise(resolve=>{release=resolve;})}),handle=f.element('#resize-widget');
  handle.emit('pointerdown',{button:0,pointerId:7,screenX:100,screenY:100});
  handle.emit('pointermove',{pointerId:7,screenX:140,screenY:140});
  handle.emit('pointermove',{pointerId:7,screenX:180,screenY:180});
  assert.equal(f.calls.length,1);
  f.expanded(true);f.native({expanded:true});
  f.expanded(false);f.native({expanded:false});
  release({expanded:false,compactSize:296,preferredPanelSize:{width:432,height:720}});await f.flush();
  assert.equal(f.calls.length,1,'A queued update from the departed view must never replay');
  assert.equal(handle.capture,null,'Mode changes must release the cancelled drag');
});

test('size request failures preserve newer native events and otherwise retain the last confirmed reply',async()=>{
  for(const newerEvent of [false,true]) {
    const pending=[];
    const f=fixture({control:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
    f.element('#compact-size').emit('input',{target:{value:'280'}});
    f.element('#compact-size').emit('input',{target:{value:'320'}});
    pending[0].resolve({expanded:false,compactSize:280,preferredPanelSize:{width:432,height:720}});await f.flush();
    assert.equal(f.calls.length,2);
    if(newerEvent){f.expanded(true);f.native({expanded:true,compactSize:320,preferredPanelSize:{width:600,height:800}});}
    pending[1].reject(new Error('fixture IPC failure'));await f.flush();
    assert.equal(f.errors.length,1);
    assert.equal(f.state.expanded,newerEvent,'Failed IPC must not restore an earlier view');
    assert.equal(f.element('#compact-size').value,newerEvent?320:280);
    assert.equal(f.element('#panel-width').value,newerEvent?600:432);
    f.element('#compact-size').emit('input',{target:{value:'344'}});
    assert.equal(f.calls.length,3,'An IPC error must not strand the resize queue');
    pending[2].resolve({...f.state,compactSize:344});await f.flush();
    assert.equal(f.element('#compact-size').value,344);
  }
});
