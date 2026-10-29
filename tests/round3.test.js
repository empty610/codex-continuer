import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Manager } from '../server/manager.js';
import { Store } from '../server/store.js';
import { readJsonBody } from '../server/http-body.js';
import { interruptedThread } from './fixtures/thread-history.js';

const threadId = '11111111-1111-4111-8111-111111111111';
const quota = usedPercent => ({ rateLimits: { primary: { usedPercent }, secondary: { usedPercent: 10 } } });
const input = { name: 'Third round fixture', cwd: 'E:\\fixture', prompt: 'Isolated test only', continuous: true };
function temporary(t) {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'continuer-round3-'));
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true, force: true }); }); return directory;
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(t, store = { load: () => null, save() {} }, send = async () => ({ queueId: 'fixture' })) {
  const rpc = new EventEmitter(); rpc.ready = true; rpc.calls = []; rpc.sent = []; let turn = 0;
  rpc.send = message => rpc.sent.push(message); rpc.close = () => {};
  rpc.call = async (method, params) => {
    rpc.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: threadId } };
    if (method === 'thread/read') return { thread: interruptedThread(params.threadId, { name: 'Fixture', cwd: input.cwd }) };
    if (method === 'turn/start') return { turn: { id: `turn-${++turn}` } };
    return {};
  };
  const manager = new Manager(rpc, store, { demo: true, wakeSender: { send } });
  manager.connection.status = 'connected'; manager.setQuota(quota(10));
  t.after(() => manager.safely(() => manager.stop()));
  const request = (task, id = 1, command = 'fixture command') => manager.request({ id, method: 'item/commandExecution/requestApproval', params: { threadId: task.threadId, turnId: task.turnId, command } });
  return { manager, rpc, request };
}
async function sending(t) {
  const store = new Store(join(temporary(t), 'state.json')), held = deferred(), entered = deferred();
  const f = fixture(t, store, () => { entered.resolve(); return held.promise; });
  const task = await f.manager.importThread(threadId); await f.manager.action(task.id, 'resume');
  f.manager.setQuota(quota(100)); await f.manager.tick(); f.manager.setQuota(quota(10));
  const tick = f.manager.tick(); await entered.promise;
  return { ...f, store, task, held, tick };
}

for (const action of ['pause', 'continuous']) test(`pausing an in-flight send (${action}) preserves its durable claim`, async t => {
  const f = await sending(t);
  try {
    await f.manager.action(f.task.id, action, false);
    assert.equal(f.store.load().tasks[0].wake.delivery, 'sending');
    assert.equal(f.task.continuous, false);
    await assert.rejects(f.manager.action(f.task.id, 'resume'), /发送/);
    await assert.rejects(f.manager.action(f.task.id, 'continuous', true), /发送/);
    f.held.resolve({ queueId: 'confirmed' }); await f.tick;
    assert.equal(f.store.load().tasks[0].sentCount, 1); assert.equal(f.task.status, 'paused'); assert.equal(f.task.wake.delivery, 'sent');
  } finally { f.held.resolve({ queueId: 'cleanup' }); await f.tick; }
});

test('ending monitoring cannot remove an in-flight outbox record', async t => {
  const f = await sending(t);
  try { await assert.rejects(f.manager.action(f.task.id, 'complete'), /发送/); assert.equal(f.manager.state.tasks.includes(f.task), true); }
  finally { f.held.resolve({ queueId: 'confirmed' }); await f.tick; }
  await f.manager.action(f.task.id, 'complete'); assert.equal(f.manager.state.tasks.length, 0);
});

test('an uncertain queue result remains attached after pause and restart', async t => {
  const f = await sending(t);
  await f.manager.action(f.task.id, 'pause'); f.held.reject(new Error('fixture timeout')); await f.tick;
  await f.manager.action(f.task.id, 'pause');
  assert.equal(f.store.load().tasks[0].wake.delivery, 'uncertain');
  let sends = 0;
  const restored = fixture(t, f.store, async () => { sends++; });
  restored.manager.setQuota(quota(100)); await restored.manager.tick(); restored.manager.setQuota(quota(10)); await restored.manager.tick(); assert.equal(sends, 0);
});

test('paused turns cannot accept their old pending approvals', async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick(); f.request(task);
  const token = f.manager.approvals.get('1').detailToken;
  await f.manager.action(task.id, 'pause');
  assert.throws(() => f.manager.approve(1, 'accept', token), /过期|暂停|失效/);
  assert.equal(f.rpc.sent.some(message => message.result?.decision === 'accept'), false);
  assert.equal(task.status, 'pausing');
});

test('approval decisions bind the exact token and current turn', async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick(); f.request(task);
  const old = f.manager.approvals.get('1').detailToken; f.request(task);
  const current = f.manager.approvals.get('1').detailToken;
  assert.throws(() => f.manager.approve(1, 'accept', old), /过期|失效/);
  assert.throws(() => f.manager.approve(1, 'accept'), /过期|失效/);
  assert.equal(f.rpc.sent.length, 0);
  f.manager.approve(1, 'decline', current); assert.equal(f.rpc.sent[0].result.decision, 'decline');
});

test('handling one approval leaves the task waiting for its other requests', async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick(); f.request(task, 1); f.request(task, 2);
  f.manager.approve(1, 'decline', f.manager.approvals.get('1').detailToken);
  assert.equal(task.status, 'approval'); assert.equal(f.manager.approvals.size, 1);
});

for (const command of ['x'.repeat(12001), { hidden: 'not a reviewable command' }]) test(`unreviewable approval commands are rejected (${typeof command})`, async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick(); f.request(task, 1, command);
  assert.equal(f.manager.approvals.size, 0); assert.equal(f.rpc.sent[0].error.code, -32601);
  assert.equal(task.status, 'pausing'); assert.equal(f.rpc.calls.some(call => call.method === 'turn/interrupt'), true);
});

test('file-change approvals fail closed without presenting a misleading allow button', async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick();
  f.manager.request({ id: 55, method: 'item/fileChange/requestApproval', params: { threadId: task.threadId, turnId: task.turnId, itemId: 'change', reason: 'fixture reason', grantRoot: 'E:\\outside' } });
  assert.equal(f.manager.approvals.size, 0); assert.equal(f.rpc.sent[0].error.code, -32601);
  assert.equal(task.status, 'pausing'); assert.match(task.activity, /文件修改范围/);
  assert.equal(f.rpc.calls.some(call => call.method === 'turn/interrupt'), true);
  assert.throws(() => f.manager.approve(55, 'accept', 'guess'), /过期/);
});

test('commands without visible text or with undisplayed permission fields are rejected', async t => {
  for (const extras of [{ command: '' }, { command: ' ' }, { command: null }, ...[
    { additionalPermissions: { network: true } }, { proposedExecpolicyAmendment: ['all'] }, { proposedNetworkPolicyAmendments: [] },
    { environmentId: 'remote' }, { networkApprovalContext: {} }, { availableDecisions: ['acceptForSession'] }, { kind: 'stdin' }, { kind: null }, { unknownScope: null },
  ].map(scope => ({ command: 'fixture', ...scope }))]) {
    const f = fixture(t), task = f.manager.create(input); await f.manager.tick();
    f.manager.request({ id: 56, method: 'item/commandExecution/requestApproval', params: { threadId: task.threadId, turnId: task.turnId, ...extras } });
    assert.equal(f.manager.approvals.size, 0); assert.equal(f.rpc.sent[0].error.code, -32601);
  }
});

test('baseline command approvals preserve null optional scopes and review metadata', async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick();
  f.manager.request({ id: 58, method: 'item/commandExecution/requestApproval', params: {
    threadId: task.threadId, turnId: task.turnId, itemId: 'command', approvalId: null,
    command: 'echo fixture', cwd: input.cwd, reason: null, commandActions: null, kind: 'command', startedAtMs: 1000,
    additionalPermissions: null, availableDecisions: null, environmentId: null, networkApprovalContext: null,
    proposedExecpolicyAmendment: null, proposedNetworkPolicyAmendments: null,
  } });
  const approval = f.manager.approvals.get('58'); assert.ok(approval);
  assert.equal(approval.command, 'echo fixture'); assert.equal(approval.cwd, input.cwd);
  f.manager.approve(58, 'accept', approval.detailToken);
  assert.equal(f.rpc.sent.at(-1).result.decision, 'accept');
});

test('approve also rejects injected incomplete file-change records at its final boundary', async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick();
  f.manager.approvals.set('57', { id: 57, detailToken: 'fixture', method: 'item/fileChange/requestApproval', taskId: task.id, threadId: task.threadId, turnId: task.turnId });
  task.status = 'approval';
  assert.throws(() => f.manager.approve(57, 'accept', 'fixture'), /完整审阅/);
  assert.equal(f.rpc.sent.some(message => message.result?.decision === 'accept'), false);
});

test('a late interrupt failure cannot block a newer turn', async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick(); const oldTurn = task.turnId, original = f.rpc.call, held = deferred();
  f.rpc.call = (method, params) => method === 'turn/interrupt' ? held.promise : original(method, params);
  const pause = f.manager.action(task.id, 'pause');
  f.manager.event({ method: 'turn/completed', params: { threadId: task.threadId, turn: { id: oldTurn, status: 'interrupted' } } });
  await f.manager.action(task.id, 'resume'); await f.manager.tick(); const current = task.turnId;
  held.reject(new Error('late fixture interrupt failure'));
  await assert.doesNotReject(pause); assert.equal(task.status, 'running'); assert.equal(task.turnId, current); assert.notEqual(current, oldTurn);
});

test('partial quota events cannot authorize direct work while the authoritative quota is blocked', async t => {
  const f = fixture(t), task = f.manager.create(input);
  f.manager.setQuota({ rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 0 }, secondary: { usedPercent: 100 } } } });
  f.manager.event({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 0 } } } });
  await f.manager.tick(); assert.equal(f.rpc.calls.some(call => call.method === 'turn/start'), false); assert.equal(task.status, 'waiting');
  f.manager.setQuota(quota(10)); await f.manager.tick(); assert.equal(task.status, 'running');
});

test('cold-start handshake refuses a matching build from another data directory', t => {
  const directory = temporary(t), runtime = new URL('../plugin/runtime.js', import.meta.url).href, config = new URL('../server/config.cjs', import.meta.url).href;
  const code = `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';
    cp.spawn=()=>Object.assign(new EventEmitter(),{unref(){}});syncBuiltinESMExports();
    const config=(await import(${JSON.stringify(config)})).default; let calls=0;
    const localTls=(await import(${JSON.stringify(new URL('../server/local-tls.cjs', import.meta.url).href)})).default;localTls.requestOptions=()=>({});
    localTls.fetchLocal=async()=>{if(!calls++)throw Object.assign(new Error('not running'),{cause:{code:'ECONNREFUSED'}});return {ok:true,json:async()=>({...config.appInfo(),diagnostics:{dataDir:'wrong-directory'}})}};
    try {await (await import(${JSON.stringify(runtime)})).ensureService();console.log(JSON.stringify({accepted:true}));}catch(error){console.log(JSON.stringify({accepted:false,error:error.message}));}`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', code], { windowsHide: true, env: { ...process.env, CONTINUER_DATA_DIR: directory }, encoding: 'utf8', timeout: 12000 }));
  assert.equal(result.accepted, false); assert.match(result.error, /不同的数据目录/);
});

test('an approval buffered before the start response cannot undo a pending pause', async t => {
  const f = fixture(t), task = f.manager.create(input), original = f.rpc.call, held = deferred(), entered = deferred();
  f.rpc.call = (method, params) => { if (method === 'turn/start') { entered.resolve(); return held.promise; } return original(method, params); };
  const tick = f.manager.tick(); await entered.promise;
  f.manager.request({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: task.threadId, turnId: 'confirmed', command: 'fixture' } });
  await f.manager.action(task.id, 'pause'); held.resolve({ turn: { id: 'confirmed' } }); await tick;
  assert.equal(task.status, 'pausing'); assert.equal(f.manager.approvals.size, 0);
  assert.equal(f.rpc.sent[0].error.code, -32601); assert.equal(f.rpc.calls.filter(call => call.method === 'turn/interrupt').length, 1);
});

test('a current interrupt failure is still visible and blocks the affected turn', async t => {
  const f = fixture(t), task = f.manager.create(input); await f.manager.tick();
  f.rpc.call = async () => { throw new Error('current fixture failure'); };
  await assert.rejects(f.manager.action(task.id, 'pause'), /current fixture failure/);
  assert.equal(task.status, 'blocked'); assert.match(task.activity, /未确认中断/);
});

test('a partial event during thread preparation cannot grant permission to start a turn', async t => {
  const f = fixture(t), task = f.manager.create(input), held = deferred();
  f.rpc.call = () => held.promise; const run = f.manager.run(task);
  f.manager.event({ method: 'account/rateLimits/updated', params: quota(0) });
  held.resolve({ thread: { id: threadId } }); await run;
  assert.equal(task.status, 'queued'); assert.equal(task.rounds, 0);
});

test('JSON requests preserve Chinese and emoji at every byte boundary', async () => {
  const value = { prompt: '核对中文😀验收标准', name: '测试任务' }, bytes = Buffer.from(JSON.stringify(value));
  for (let index = 1; index < bytes.length; index++) {
    async function* chunks() { yield bytes.subarray(0, index); yield bytes.subarray(index); }
    assert.deepEqual(await readJsonBody(chunks()), value);
  }
});

test('malformed UTF-8, incomplete codepoints and oversized/non-object JSON are rejected', async () => {
  for (const bytes of [Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), Buffer.from([0xe4]), Buffer.from('null'), Buffer.from('[]'), Buffer.from('"text"'), Buffer.from(JSON.stringify({ prompt: '字'.repeat(40000) })), Buffer.alloc(160001, 32)]) {
    async function* chunks() { yield bytes; }
    await assert.rejects(readJsonBody(chunks()));
  }
});
