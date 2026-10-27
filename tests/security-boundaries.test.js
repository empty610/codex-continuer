import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { tools, dispatch } from '../plugin/tools.js';
import { localProjectPath, checkedProjectPath } from '../server/project-path.js';
import { ClientError, clientErrorMessage, createRequestLimiter } from '../server/http-policy.js';
import { Manager } from '../server/manager.js';

test('MCP cannot authorize work or widen policy, even with an agent-supplied confirmation', async () => {
  let calls = 0; const runtime = { ensureService: async () => { calls++; }, request: async () => { calls++; return { tasks: [] }; } };
  const blocked = [
    ['continuer_create_task', { name: 'fixture', cwd: 'E:\\fixture', prompt: 'fixture', continuous: false }],
    ['continuer_task_action', { id: 'fixture', action: 'resume' }],
    ['continuer_task_action', { id: 'fixture', action: 'continuous', value: true }],
    ['continuer_update_settings', { enabled: true }],
    ...['maxRounds', 'maxWakeSends', 'minimumRemaining', 'pollSeconds'].map(key => ['continuer_update_settings', { enabled: false, [key]: 10 }]),
    ['continuer_import_session', { threadId: 'fixture', confirmed: true }],
  ];
  for (const [name, input] of blocked) await assert.rejects(dispatch(name, input, runtime));
  assert.equal(calls, 0); assert.equal(tools.some(tool => tool.name === 'continuer_create_task'), false);
  for (const args of [{ id: 'fixture', action: 'pause' }, { id: 'fixture', action: 'continuous', value: false }]) await dispatch('continuer_task_action', args, runtime);
  await dispatch('continuer_update_settings', { enabled: false }, runtime);
  assert.equal(calls, 6);
});

const rejectedPaths = ['\\\\host\\share', '//host/share', '\\/host/share', '/\\host/share', '\\\\?\\C:\\folder', '\\\\.\\C:\\folder', '\\??\\C:\\folder', 'C:folder', '\\folder', '/folder', 'C:\\\\host', 'C:\\folder:stream', 'C:\\bad\0folder'];
test('network and device paths are rejected before filesystem access', () => {
  let stats = 0; const stat = () => { stats++; return { isDirectory: () => true }; };
  for (const path of rejectedPaths) assert.throws(() => checkedProjectPath(path, { stat }), /本地盘符/);
  assert.equal(stats, 0);
  assert.equal(checkedProjectPath(' E:/fixture/../project ', { stat }), 'E:\\project'); assert.equal(stats, 1);
  assert.equal(localProjectPath('C:\\'), 'C:\\');
});

test('persisted direct tasks with unsafe cwd cannot reach any execution RPC', async () => {
  for (const cwd of rejectedPaths) {
    let calls = 0; const rpc = new EventEmitter(); rpc.ready = true; rpc.call = async () => { calls++; throw Error('Unexpected RPC'); }; rpc.close = () => {};
    const state = { settings: { enabled: true, pollSeconds: 30, maxRounds: 20, maxWakeSends: 20, minimumRemaining: 5 }, tasks: [{ id: 'fixture', name: 'fixture', cwd, prompt: 'fixture', status: 'queued', rounds: 0, continuous: true, plan: [], output: '' }], logs: [], history: [] };
    const manager = new Manager(rpc, { load: () => state, save() {} }, { demo: true }); manager.connection.status = 'connected';
    manager.setQuota({ rateLimits: { primary: { usedPercent: 0 } } });
    await manager.run(state.tasks[0]); assert.equal(calls, 0); assert.equal(state.tasks[0].status, 'blocked');
    assert.equal(manager.state.tasks.length, 1); manager.stop();
  }
});

test('HTTP errors expose only intentional validation messages', () => {
  const privateMessage = 'fixture internal path and credential';
  assert.equal(clientErrorMessage(new ClientError('名称过长')), '名称过长');
  assert.equal(clientErrorMessage(Object.assign(Error(privateMessage), { code: 'ENOENT' })), '项目目录不存在');
  assert.doesNotMatch(clientErrorMessage(Error(privateMessage)), /fixture|credential|path/);
  assert.doesNotMatch(clientErrorMessage({ message: privateMessage, expose: true }), /fixture/);
});

test('request budgets refill without untrusted traffic starving authenticated reads or writes', () => {
  let now = 0; const allow = createRequestLimiter(() => now);
  for (let i = 0; i < 60; i++) assert.equal(allow(false, 'GET'), true);
  assert.equal(allow(false, 'POST'), false); assert.equal(allow(true, 'GET'), true); assert.equal(allow(true, 'POST'), true);
  for (let i = 1; i < 120; i++) assert.equal(allow(true, 'POST'), true);
  assert.equal(allow(true, 'POST'), false); assert.equal(allow(true, 'GET'), true);
  now = 1000; assert.equal(allow(false, 'GET'), true); assert.equal(allow(true, 'POST'), true);
});
