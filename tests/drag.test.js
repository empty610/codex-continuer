import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerDrag } from '../desktop/pointer-drag.cjs';
import { placeIndependent, samePlacementContext, expandFromCard } from '../desktop/geometry.cjs';

function fixture() {
  let cursor={x:800,y:400}, bounds={x:720,y:320,width:161,height:160}, tick;
  const moves=[], finishes=[];
  let starts=0;
  const drag=createPointerDrag({
    getCursor:()=>({...cursor}), getBounds:()=>({...bounds}),
    setPosition:(x,y)=>{moves.push({x,y});bounds={...bounds,x,y};},
    onMove:()=>starts++, onFinish:moved=>finishes.push(moved),
    schedule:callback=>{tick=callback;return 1;}, cancel:()=>{tick=null;},
  });
  return {drag,moves,finishes,get starts(){return starts;},get bounds(){return bounds;},get scheduled(){return !!tick;},cursor:value=>{cursor=value;},tick:()=>tick?.()};
}

test('holding still for repeated polling ticks never moves or commits a position',()=>{
  const f=fixture();f.drag.start(1);
  for(let i=0;i<10000;i++) f.tick();
  assert.equal(f.drag.active,true);
  assert.deepEqual(f.drag.finish(1),{id:1,moved:false});
  assert.deepEqual(f.moves,[]);assert.deepEqual(f.finishes,[false]);
  assert.equal(f.starts,0);assert.equal(f.scheduled,false);
});

test('cursor jitter inside six DIP remains a click, including release',()=>{
  const f=fixture();f.drag.start(1);
  for(const cursor of [{x:803,y:404},{x:794,y:400},{x:800,y:406}]){f.cursor(cursor);f.tick();}
  assert.equal(f.drag.finish(1).moved,false);assert.deepEqual(f.moves,[]);
});

test('drag uses the desktop cursor delta once and stays still while held at the new point',()=>{
  const f=fixture();f.drag.start(1);f.cursor({x:830,y:420});f.tick();
  assert.deepEqual(f.moves,[{x:750,y:340}]);
  for(let i=0;i<1000;i++)f.tick();
  assert.equal(f.moves.length,1);assert.equal(f.starts,1);
  assert.equal(f.drag.finish(1).moved,true);assert.deepEqual(f.finishes,[true]);
});

test('release never adds a position update even between polling ticks',()=>{
  const f=fixture();f.drag.start(1);f.cursor({x:815,y:395});
  assert.equal(f.drag.finish(1).moved,false);assert.deepEqual(f.moves,[]);
});

test('cancellation stops polling without applying a cursor movement after losing focus',()=>{
  const f=fixture();f.drag.start(1);f.cursor({x:1200,y:900});
  assert.equal(f.drag.finish().moved,false);
  assert.deepEqual(f.moves,[]);assert.equal(f.scheduled,false);
});

test('late or duplicate completion cannot end a new drag or discard its moved result',()=>{
  const f=fixture();f.drag.start(1);f.cursor({x:820,y:400});f.tick();
  assert.equal(f.drag.finish().moved,true);
  assert.equal(f.drag.finish(1).moved,true);assert.deepEqual(f.finishes,[true]);
  assert.equal(f.drag.start(2).ok,true);assert.equal(f.drag.start(3).ok,false);
  f.drag.finish(1);assert.equal(f.drag.active,true);
  f.drag.finish(2);assert.equal(f.drag.active,false);
});

test('a drag returning to its starting position still suppresses the click',()=>{
  const f=fixture();f.drag.start(1);f.cursor({x:830,y:400});f.tick();f.cursor({x:800,y:400});f.tick();
  assert.equal(f.drag.finish(1).moved,true);assert.deepEqual(f.bounds,{x:720,y:320,width:161,height:160});
});

test('fractional DPI window readback never creeps during independent placement',()=>{
  const work={x:0,y:0,width:1920,height:1080},size={width:160,height:160};
  const saved={x:1293,y:316,width:161,height:161};
  for(const position of [undefined,saved]) {
    let current={...saved};
    for(let i=0;i<1000;i++) {
      const next=placeIndependent(position,current,work,size);
      assert.deepEqual(next,{x:1293,y:316,...size});
      current={...next,width:161,height:161};
    }
  }
});

test('independent placement clamps saved locations and anchors a first expansion at the bottom right',()=>{
  const work={x:0,y:0,width:1920,height:1080},current={x:1000,y:700,width:160,height:160};
  assert.deepEqual(placeIndependent(undefined,current,work,{width:432,height:720}),{x:728,y:140,width:432,height:720});
  assert.deepEqual(placeIndependent({x:1900,y:-20},current,work,{width:432,height:720}),{x:1488,y:0,width:432,height:720});
});

test('fast drag sampling uses a single timer only during an active gesture',()=>{
  const scheduled=[],cancelled=[];
  const drag=createPointerDrag({getCursor:()=>({x:0,y:0}),getBounds:()=>({x:0,y:0,width:160,height:160}),setPosition:()=>{},
    schedule:(_callback,interval)=>{scheduled.push(interval);return scheduled.length;},cancel:id=>cancelled.push(id)});
  assert.deepEqual(scheduled,[]);
  drag.start(1);drag.start(2);
  assert.deepEqual(scheduled,[1]);
  drag.finish(1);drag.finish(1);
  assert.deepEqual(cancelled,[1]);
  drag.start(3);drag.finish(3);
  assert.deepEqual(scheduled,[1,1]);assert.deepEqual(cancelled,[1,2]);
});

test('movement reads native bounds once and ignores fractional DPI readback while stopped',()=>{
  let tick,reads=0,moves=0,cursor={x:100,y:100};
  const drag=createPointerDrag({
    getCursor:()=>cursor,
    getBounds:()=>{reads++;return {x:500,y:300,width:161,height:161};},
    setPosition:()=>moves++,schedule:callback=>{tick=callback;},cancel:()=>{},
  });
  drag.start(1);cursor={x:130,y:120};tick();
  for(let i=0;i<1000;i++)tick();
  drag.finish(1);
  assert.equal(reads,1);assert.equal(moves,1);
});

test('release preserves the displayed position even if the cursor moves before IPC completion',()=>{
  const f=fixture();f.drag.start(1);f.cursor({x:830,y:420});f.tick();
  f.cursor({x:860,y:440});
  assert.equal(f.drag.finish(1).moved,true);
  assert.deepEqual(f.moves,[{x:750,y:340}]);
});

test('every position update uses the original window dimensions',()=>{
  let cursor={x:100,y:100},tick;
  const bounds={x:700,y:300,width:161,height:161},seen=[];
  const drag=createPointerDrag({getCursor:()=>cursor,getBounds:()=>({...bounds}),
    setPosition:(_x,_y,size)=>seen.push({...size}),schedule:callback=>{tick=callback;},cancel:()=>{}});
  drag.start(1);
  for(let i=1;i<=100;i++){cursor={x:100+i*10,y:100+i};tick();}
  drag.finish(1);
  assert.equal(seen.length,100);
  assert.ok(seen.every(size=>size.width===161&&size.height===161));
});

test('manual drop stays authoritative until an actual placement context change',()=>{
  const drop={mode:'compact',follow:false,compactSize:160,anchor:{x:0,y:0,width:1000,height:900}};
  assert.equal(samePlacementContext(drop,{...drop,anchor:{x:100,y:100,width:800,height:700}}),true);
  for(const change of [{mode:'expanded'},{compactSize:200},{follow:true}])
    assert.equal(samePlacementContext(drop,{...drop,...change}),false);
  const following={...drop,follow:true};
  assert.equal(samePlacementContext(following,{...following,anchor:{...following.anchor}}),true);
  assert.equal(samePlacementContext(following,{...following,anchor:{...following.anchor,x:1}}),false);
});

test('panel expansion preserves the card corner that has room on its current display',()=>{
  const work={x:0,y:0,width:1920,height:1080},size={width:432,height:720};
  assert.deepEqual(expandFromCard({x:1300,y:100,width:160,height:160},work,size),{x:1028,y:100,...size});
  assert.deepEqual(expandFromCard({x:50,y:850,width:160,height:160},work,size),{x:50,y:290,...size});
  assert.deepEqual(expandFromCard({x:1300,y:850,width:160,height:160},work,size),{x:1028,y:290,...size});
  assert.deepEqual(expandFromCard({x:-1250,y:80,width:160,height:160},{x:-1280,y:0,width:1280,height:800},size),{x:-1250,y:80,...size});
  assert.deepEqual(expandFromCard({x:100,y:30,width:160,height:160},{x:0,y:0,width:360,height:600},size),{x:0,y:0,width:360,height:600});
});
