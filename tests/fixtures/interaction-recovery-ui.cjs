const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), out = process.env.CONTINUER_INTERACTION_TEST_DIR;
if(!out) throw Error('Isolated test directory required');
app.setPath('userData', path.join(out, 'isolated-profile'));
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = { version: '0.7.0', scenarios: [], errors: [] };
let win, server, state, fullTask, failSettings=false, failDetail=false, pending = [], apiCalls = [];
function initial() {
  return { instanceId:'first-service',snapshotRevision:1,app:'codex-continuer',version:'0.7.0',buildId:'round1-isolated',protocolVersion:4,
    settings:{enabled:false,language:'zh',pollSeconds:30,minimumRemaining:5,maxRounds:20,maxWakeSends:20},
    connection:{status:'connected'},sampledAt:Date.now(),quota:{rateLimits:{primary:{usedPercent:20,windowDurationMins:300},secondary:{usedPercent:30,windowDurationMins:10080}}},
    tasks:[{id:'work',mode:'direct',name:'审查示例工作',cwd:'E:\\fixture',prompt:'仅模拟，不执行真实工作',status:'paused',continuous:false,rounds:1,detailRevision:1,
      plan:[],output:Array.from({length:100},(_,i)=>`第 ${i+1} 行：用于检查阅读位置与文本选择。`).join('\n')}],
    approvals:[],logs:[],history:[],diagnostics:{autostart:{enabled:false}},persistence:{status:'ok'} };
}
const response = (res,value) => { res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value)); };
async function record(name,details) { result.scenarios.push({name,...details});fs.writeFileSync(path.join(out,'ui-results.json'),JSON.stringify(result,null,2)); }
app.whenReady().then(async()=>{
  try {
    const {createStaticAssets}=await import('../../server/static-assets.js');
    const serve=createStaticAssets(root);
    server=createServer(async(req,res)=>{
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname.startsWith('/fixture/')) {res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head></head><body></body></html>');return;}
      if(url.pathname.startsWith('/api/')) {
        let body='';for await(const part of req) body+=part;
        apiCalls.push({path:url.pathname,body});
        if(url.pathname==='/api/tasks' && req.method==='POST') {pending.push({res,value:structuredClone(state)});return;}
        if(url.pathname==='/api/settings'){ if(failSettings){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Simulated save failure'}));return;} Object.assign(state.settings,JSON.parse(body));state.snapshotRevision++; }
        if(url.pathname==='/api/threads'){const start=Number(url.searchParams.get('cursor')||0),end=Math.min(start+30,301);return response(res,{data:Array.from({length:end-start},(_,i)=>({id:'chat-'+(start+i+1),name:'Chat '+(start+i+1)})),nextCursor:end<301?String(end):null});}
        if(url.pathname==='/api/tasks/work'){if(failDetail){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Simulated detail failure'}));return;}return response(res,{task:fullTask||state.tasks[0]});}
        return response(res,state);
      }
      if(await serve(req,res,url)) return;
      res.writeHead(404);res.end();
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    for(const surface of ['page','widget']) {
      state=initial();fullTask=null;failSettings=false;failDetail=false;pending=[];apiCalls=[];
      win=new BrowserWindow({show:false,width:surface==='page'?1180:432,height:surface==='page'?880:720,
        webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
      win.webContents.on('console-message',d=>{if(d.level==='error') result.errors.push(d.message);});
      await win.loadURL(`http://127.0.0.1:${server.address().port}/fixture/${surface}`);
      win.webContents.debugger.attach();
      const send=(method,params)=>win.webContents.debugger.sendCommand(method,params);
      const {result:object}=await send('Runtime.evaluate',{expression:'globalThis'});
      const parsed=await send('Runtime.callFunctionOn',{objectId:object.objectId,
        functionDeclaration:`function(html){const d=new DOMParser().parseFromString(html,'text/html');d.querySelectorAll('script').forEach(s=>s.remove());document.documentElement.replaceWith(document.importNode(d.documentElement,true));}`,
        arguments:[{value:fs.readFileSync(path.join(root,'public',surface==='page'?'index.html':'widget.html'),'utf8')}]});
      assert.equal(parsed.exceptionDetails,undefined);win.webContents.debugger.detach();
      const ev=code=>win.webContents.executeJavaScript(code);
      const until=async code=>{for(let i=0;i<100;i++){if(await ev(code))return;await sleep(30);}throw Error('Timeout: '+code);};
      const feed=()=>{state.snapshotRevision++;return ev(`window.testFeed.onmessage({data:${JSON.stringify(JSON.stringify(state))}})`);};
      await ev(`(async()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});
        window.createSource=()=>{const s={close(){}};window.testFeed=s;setTimeout(()=>s.onmessage({data:${JSON.stringify(JSON.stringify(state))}}),0);return s;};
        ${surface==='widget'?`const desktop={expanded:true,visible:true,follow:false,compactSize:256,panelSize:{width:414,height:702}};window.continuerDesktop={onState(c){window.desktopListener=c;},async control(){return {...desktop};}};`:''}
        await import('/${surface==='page'?'app':'widget'}.js');})()`);
      await until("!!document.querySelector('[data-action=detail]')");await sleep(250);
      fs.writeFileSync(path.join(out,`${surface}-overview.png`),(await win.webContents.capturePage()).toPNG());
      await ev("document.querySelector('[data-action=detail]').click()");
      await until("!!document.querySelector('#modal pre') && document.querySelector('#modal pre').textContent.includes('第 100 行')");
      const before=await ev(`(()=>{const p=document.querySelector('#modal pre');window.oldOutput=p;p.scrollTop=300;const r=document.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,20);const s=getSelection();s.removeAllRanges();s.addRange(r);return {scroll:p.scrollTop,selection:s.toString()};})()`);
      state.logs=[{id:'update',time:Date.now(),message:'Unrelated refresh',type:'info'}];await feed();
      const after=await ev("({scroll:document.querySelector('#modal pre').scrollTop,selection:getSelection().toString(),sameNode:window.oldOutput===document.querySelector('#modal pre')})");
      assert.equal(after.sameNode,true);assert.equal(after.scroll,before.scroll);assert.equal(after.selection,before.selection);
      state.tasks[0].output+='\nNew output after the reading position';state.tasks[0].detailRevision++;await feed();
      await until("document.querySelector('#modal pre').textContent.includes('New output after the reading position')");
      assert.equal(await ev("document.querySelector('#modal pre').scrollTop"),before.scroll);
      assert.equal(await ev("getSelection().toString()"),before.selection);
      await record('detail-reading-preserved',{surface,before,after});
      const close=async()=>{await ev("document.querySelector('#modal').close()");await sleep(40);};
      await close();
      await ev("document.querySelector('[data-action=new]').click();document.querySelector('[name=name]').value='first';document.querySelector('[name=cwd]').value='E:\\fixture';document.querySelector('[name=prompt]').value='mock';document.querySelector('#modal form').requestSubmit()");
      for(let i=0;i<100&&!pending.length;i++)await sleep(20);assert.equal(pending.length,1);
      await close();await ev("document.querySelector('[data-action=new]').click();document.querySelector('[name=name]').value='second draft'");
      state.settings.enabled=true;state.tasks.push({id:'newer',name:'New live record',mode:'direct',status:'paused',rounds:0});await feed();
      const old=pending.shift();response(old.res,old.value);await sleep(150);
      assert.equal(await ev("document.querySelector('#modal').open"),true);
      assert.equal(await ev("document.querySelector('[name=name]').value"),'second draft');
      assert.equal(await ev("!!document.querySelector('[data-action=detail][data-id=newer]')"),true);
      await record('old-save-keeps-new-draft-and-live-state',{surface});await close();
      await ev("document.querySelector('[data-action=new]').click();document.querySelector('[name=name]').value='slow';document.querySelector('[name=cwd]').value='E:\\fixture';document.querySelector('[name=prompt]').value='mock';document.querySelector('#modal form').requestSubmit()");
      for(let i=0;i<100&&!pending.length;i++)await sleep(20);assert.equal(pending.length,1);
      state.settings.language='en';await feed();
      assert.equal(await ev("document.querySelector('#modal [type=submit]').disabled"),true);
      // requestSubmit also exercises the handler guard, independently of disabled UI.
      await ev("document.querySelector('#modal form').requestSubmit()");await sleep(100);assert.equal(pending.length,1);
      const saved=pending.shift();response(saved.res,state);await sleep(100);
      assert.equal(await ev("document.querySelector('#modal').open"),false);
      await record('language-retains-submission-lock',{surface});
      state.settings.language='zh';await feed();
      if(surface==='page') {
        await ev("document.querySelector('[data-page=settings]').click()");
        await ev("document.querySelector('[name=minimumRemaining]').value='17'");
        state.connection={status:'disconnected',message:'Mock disconnect'};await feed();
        assert.equal(await ev("document.querySelector('#settings-connection').textContent"),'未连接');
        assert.equal(await ev("document.querySelector('[name=minimumRemaining]').value"),'17');
        failSettings=true;await ev("document.querySelector('#settings-form').requestSubmit()");
        await until("document.querySelector('#settings-error').textContent.includes('Simulated save failure')");
        failSettings=false;await ev("document.querySelector('#settings-form').requestSubmit()");
        await until("!document.querySelector('#settings-form [type=submit]').disabled");
        assert.equal(await ev("document.querySelector('#settings-error').textContent"),'');
        await record('settings-live-status-and-error-recovery',{surface});
        await ev("document.querySelector('[data-page=overview]').click()");
      }
      // The final server page remains reachable after the 300-chat window fills.
      if(surface==='page') {
        await ev("document.querySelector('[data-action=import]').click()");
        await until("document.querySelectorAll('.thread-option').length===30");
        for(let i=0;i<12;i++){
          if(!await ev("!!document.querySelector('[data-action=more-threads]')"))break;
          await ev("document.querySelector('[data-action=more-threads]').click()");
          await until("!document.querySelector('[data-action=more-threads]') || !document.querySelector('[data-action=more-threads]').disabled");
        }
        assert.equal(await ev("!!document.querySelector('[data-id=chat-301]')"),true);await close();
      } else {
        for(let i=0;i<12;i++){
          if(await ev("document.querySelector('#session-more').hidden"))break;
          await ev("document.querySelector('#session-more').click()");
          await until("document.querySelector('#session-more').hidden || !document.querySelector('#session-more').disabled");
        }
        assert.equal(await ev("!!document.querySelector('option[value=chat-301]')"),true);
      }
      await record('older-chat-reachable',{surface});
      fullTask={id:'work',mode:'quota-wake',name:'Monitor',status:'paused',note:'Local note',continuationMessage:'Old saved message',completionMessage:'Separate completion',detailInstanceId:'first-service',detailRevision:1};
      state.tasks=[{id:'work',mode:'quota-wake',name:'Monitor',status:'paused',notePreview:'Local note',detailInstanceId:'first-service',detailRevision:1}];
      failDetail=true;await feed();await ev("document.querySelector('[data-action=detail]').click()");await sleep(150);
      assert.equal(await ev("document.querySelector('[data-action=edit-message]').disabled"),true);
      assert.equal(await ev("document.querySelector('#modal-body').textContent.includes('完整详情尚未加载')"),true);
      assert.equal(await ev("document.querySelector('#modal-body').textContent.includes('备注未填写')"),false);
      await close();failDetail=false;await ev("document.querySelector('[data-action=detail]').click()");
      await until("!document.querySelector('[data-action=edit-message]').disabled");
      await ev("window.testFeed.onerror(new Error('Mock disconnect'))");
      state.instanceId='restarted-service';state.snapshotRevision=0;state.tasks[0].detailInstanceId=state.instanceId;
      fullTask={...fullTask,detailInstanceId:state.instanceId,continuationMessage:'New persisted message'};
      await feed();await until("document.querySelector('#modal-body').textContent.includes('New persisted message')");
      await ev("document.querySelector('[data-action=edit-message]').click()");
      assert.equal(await ev("document.querySelector('[name=continuationMessage]').value"),'New persisted message');
      await record('missing-and-restarted-details',{surface});await close();
      if(surface==='widget'){
        state.connection={status:'connected'};state.sampledAt=Date.now();state.quota={rateLimits:{primary:{usedPercent:20,windowDurationMins:60}}};
        await ev("window.desktopListener({expanded:false,visible:true,follow:false,compactSize:256,panelSize:{width:414,height:702}})");await feed();
        assert.equal(await ev("document.querySelector('#mini-window').textContent"),'1小时可用额度');
        await record('actual-quota-period',{surface});
      }
      win.destroy();win=null;
    }
    result.completed=true;
  }catch(error){result.error=error.stack;process.exitCode=1;}
  finally{win?.destroy();for(const item of pending)item.res.destroy();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'ui-results.json'),JSON.stringify(result,null,2));app.exit(process.exitCode||0);}
});
setTimeout(()=>{fs.writeFileSync(path.join(out,'ui-timeout.json'),JSON.stringify(result,null,2));app.exit(2);},45000);
