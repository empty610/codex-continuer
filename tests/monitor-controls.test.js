import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';
import { QueueSender } from '../server/queue-sender.js';
import { validateState } from '../server/store.js';
import { validate } from '../plugin/tools.js';
import { interruptedThread } from './fixtures/thread-history.js';

const threadId='11111111-1111-4111-8111-111111111111';
const quota=usedPercent=>({rateLimits:{primary:{usedPercent}}});
const final=id=>interruptedThread(threadId,{turns:[{id,status:'completed',itemsView:'full',items:[{type:'userMessage'},{type:'agentMessage',phase:'final_answer',text:'Answer'}]}]});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
async function fixture(t,options={},saved) {
  const rpc=new EventEmitter(),commands=[],saves=[];let thread=final('first');
  rpc.ready=true;rpc.close=()=>{};rpc.call=async()=>({thread:structuredClone(thread)});
  const sender=new QueueSender({binary:'mock',run:async(_bin,args)=>{commands.push(args);return '';}});
  const m=new Manager(rpc,{load:()=>saved&&structuredClone(saved),save:state=>{validateState(state);saves.push(structuredClone(state));}},{demo:true,wakeSender:sender});
  m.connection.status='connected';t.after(()=>m.stop());
  const task=m.state.tasks[0]||await m.importThread(threadId,'note','QUOTA',{completionMonitoring:true,completionMessage:'ANSWER',...options});
  const tick=async()=>{m.completionChecks.clear();m.setQuota(quota(0));await m.tick();};
  const cycle=async()=>{m.setQuota(quota(100));await m.tick();await tick();};
  return {m,task,rpc,sender,commands,saves,tick,cycle,setThread:value=>{thread=value;},sent:()=>commands.filter(args=>args.includes('--message'))};
}

test('answer-only monitoring sends once by default and never arms quota recovery',async t=>{
  const f=await fixture(t,{quotaMonitoring:false});await f.m.action(f.task.id,'resume');
  f.m.setQuota(quota(100));await f.m.tick();assert.equal(f.task.wake.armed,false);
  await f.tick();assert.equal(f.sent().length,1);assert.equal(f.sent()[0].at(-1),'ANSWER');
  assert.equal(f.task.completionSends,1);assert.equal(f.task.completionMonitoring,false);assert.equal(f.task.continuous,false);
  f.setThread(final('second'));await f.tick();assert.equal(f.sent().length,1);
  await f.m.action(f.task.id,'completion-monitoring',true);assert.equal(f.task.completionSends,0);assert.equal(f.task.continuous,false);
  await f.m.action(f.task.id,'resume');f.setThread(final('first'));await f.tick();assert.equal(f.sent().length,1,'Re-enabling cannot replay the previous final');
  f.setThread(final('second'));await f.tick();assert.equal(f.sent().length,2);assert.equal(f.task.sentCount,2);
});

test('quota-only monitoring uses only quota messages and switches do not activate a paused record',async t=>{
  const f=await fixture(t,{completionMonitoring:false});
  await f.m.action(f.task.id,'quota-monitoring',false);await f.m.action(f.task.id,'quota-monitoring',true);
  assert.equal(f.task.continuous,false);await f.m.action(f.task.id,'resume');
  f.setThread(interruptedThread(threadId));await f.cycle();assert.equal(f.sent()[0].at(-1),'QUOTA');assert.equal(f.task.completionSends,0);
  f.setThread(final('done'));await f.cycle();assert.equal(f.sent().length,1);
});

test('repeat count stops only reply monitoring; quota monitoring keeps working independently',async t=>{
  const f=await fixture(t,{completionRepeat:true,completionMaxSends:3});await f.m.action(f.task.id,'resume');
  for(let i=1;i<=3;i++){f.setThread(final('reply-'+i));await f.tick();await f.tick();assert.equal(f.sent().length,i);}
  assert.equal(f.task.completionMonitoring,false);assert.equal(f.task.quotaMonitoring,true);assert.equal(f.task.continuous,true);assert.equal(f.task.completionSends,3);
  f.setThread(final('fourth'));await f.tick();assert.equal(f.sent().length,3);
  f.setThread(interruptedThread(threadId));await f.cycle();assert.equal(f.sent().at(-1).at(-1),'QUOTA');assert.equal(f.task.sentCount,4);assert.equal(f.task.completionSends,3);
});

test('pause, restart and message edits preserve the current repeat count and delivery deduplication',async t=>{
  const f=await fixture(t,{completionRepeat:true,completionMaxSends:2});await f.m.action(f.task.id,'resume');await f.tick();
  await f.m.action(f.task.id,'pause');await f.m.action(f.task.id,'resume');
  await f.m.action(f.task.id,'completion',{enabled:true,message:'Edited',repeat:true,maxSends:2,quotaMonitoring:true});
  assert.equal(f.task.completionSends,1);const restored=await fixture(t,{},f.m.state);
  await restored.tick();assert.equal(restored.sent().length,0);
  restored.setThread(final('second'));await restored.tick();assert.equal(restored.sent()[0].at(-1),'Edited');assert.equal(restored.task.completionSends,2);assert.equal(restored.task.completionMonitoring,false);
});

test('lowering the repeat budget applies immediately without resetting quota or cumulative counts',async t=>{
  const f=await fixture(t,{completionRepeat:true,completionMaxSends:5});await f.m.action(f.task.id,'resume');await f.tick();
  await f.m.action(f.task.id,'completion',{enabled:true,message:'Changed',repeat:false,maxSends:5,quotaMonitoring:true});
  assert.equal(f.task.completionMonitoring,false);assert.equal(f.task.completionSends,1);assert.equal(f.task.sentCount,1);assert.equal(f.task.continuous,true);
  await f.m.action(f.task.id,'completion',{enabled:true,message:'Changed',repeat:true,maxSends:2,quotaMonitoring:true});assert.equal(f.task.completionSends,0);
  await f.tick();assert.equal(f.sent().length,1,'An explicit new run still cannot replay an old answer');
});

test('disabling quota monitoring cancels a pending queue probe without cancelling reply monitoring',async t=>{
  const f=await fixture(t);f.setThread(interruptedThread(threadId));await f.m.action(f.task.id,'resume');
  f.m.setQuota(quota(100));await f.m.tick();const entered=deferred(),release=deferred();
  f.sender.run=async(_bin,args)=>{f.commands.push(args);if(args.includes('--help')){entered.resolve();await release.promise;}return '';};
  const pending=f.tick();await entered.promise;await f.m.action(f.task.id,'quota-monitoring',false);release.resolve();await pending;
  assert.equal(f.sent().length,0);assert.equal(f.task.wake.delivery,'idle');assert.equal(f.task.completionMonitoring,true);assert.equal(f.task.continuous,true);
  f.setThread(final('next'));await f.tick();assert.equal(f.sent()[0].at(-1),'ANSWER');
});

test('disabling reply monitoring during its queue probe leaves quota monitoring available',async t=>{
  const f=await fixture(t);await f.m.action(f.task.id,'resume');const entered=deferred(),release=deferred();
  f.sender.run=async(_bin,args)=>{f.commands.push(args);if(args.includes('--help')){entered.resolve();await release.promise;}return '';};
  const pending=f.tick();await entered.promise;await f.m.action(f.task.id,'completion-monitoring',false);release.resolve();await pending;
  assert.equal(f.sent().length,0);assert.equal(f.task.completionSends,0);assert.equal(f.task.continuous,true);
  f.setThread(interruptedThread(threadId));await f.cycle();assert.equal(f.sent()[0].at(-1),'QUOTA');
});

test('global send cap still overrides larger reply budgets and enabling neither monitor cannot run',async t=>{
  const f=await fixture(t,{completionRepeat:true,completionMaxSends:5});f.m.updateSettings({maxWakeSends:2});await f.m.action(f.task.id,'resume');
  await f.tick();f.setThread(final('second'));await f.tick();assert.equal(f.task.sentCount,2);assert.equal(f.task.continuous,false);assert.equal(f.task.completionSends,2);
  const none=await fixture(t,{quotaMonitoring:false,completionMonitoring:false});await assert.rejects(none.m.action(none.task.id,'resume'),/请先开启/);
});

test('invalid independent policies are atomic and cannot be enabled through MCP',async t=>{
  const f=await fixture(t);const before=structuredClone(f.task);
  for(const patch of [{quotaMonitoring:'on'},{repeat:'on'},{maxSends:0},{maxSends:101},{maxSends:1.5},{maxSends:null}]){
    await assert.rejects(f.m.action(f.task.id,'completion',{enabled:true,message:'new',...patch}));assert.deepEqual(f.task,before);
  }
  for(const patch of [{completionRepeat:1},{quotaMonitoring:null},{completionMaxSends:0},{completionSends:-1}]){
    Object.assign(f.task,patch);assert.throws(()=>validateState(f.m.state));Object.assign(f.task,structuredClone(before));
  }
  for(const action of ['quota-monitoring','completion-monitoring'])assert.throws(()=>validate('continuer_task_action',{id:f.task.id,action,value:true}));
});

test('legacy records migrate to their previous repeated-monitor behavior without starting work',async t=>{
  const f=await fixture(t);for(const key of ['quotaMonitoring','completionRepeat','completionMaxSends','completionSends'])delete f.task[key];
  const restored=await fixture(t,{},f.m.state);
  assert.equal(restored.task.quotaMonitoring,true);assert.equal(restored.task.completionRepeat,true);assert.equal(restored.task.completionMaxSends,100);assert.equal(restored.task.completionSends,0);assert.equal(restored.sent().length,0);
});
