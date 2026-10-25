import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { validate, dispatch, tools } from '../plugin/tools.js';
import geometry from '../desktop/geometry.cjs';

test('plugin rejects ambiguous actions and out-of-range policies before starting service', async () => {
  let started = false;
  const runtime = { ensureService: async () => { started = true; } };
  for (const args of [{ id: 'a', action: 'continuous' }, { id: 'a', action: 'delete' }]) await assert.rejects(dispatch('continuer_task_action', args, runtime));
  for (const args of [{ pollSeconds: 0 }, { minimumRemaining: 100 }, { maxRounds: 1.5 }, { enabled: 'yes' }, { hidden: true }]) assert.throws(() => validate('continuer_update_settings', args));
  assert.throws(() => validate('continuer_create_task', { name: 'test', cwd: 'E:\\project', prompt: 'do work' }));
  assert.equal(started, false);
});
test('plugin status never forwards task output or performs a task mutation', async () => {
  const calls = [];
  const result = await dispatch('continuer_status', {}, { ensureService: async () => {}, request: async (...args) => { calls.push(args); return { tasks: [{ id: 'task', name: 'work', status: 'paused', output: 'private output', prompt: 'private goal' }], approvals: [] }; } });
  assert.deepEqual(calls, [['/api/state']]); assert.equal(result.tasks[0].output, undefined); assert.equal(result.tasks[0].prompt, undefined);
});
test('plugin routes explicit continuous setting without changing other policy', async () => {
  const calls = [];
  await dispatch('continuer_task_action', { id: 'task-1', action: 'continuous', value: false }, { ensureService: async () => {}, request: async (...a) => { calls.push(a); return { tasks: [] }; } });
  assert.deepEqual(calls, [['/api/tasks/task-1', { action: 'continuous', value: false }]]);
});
test('widget is clamped to work area for negative monitor coordinates and small screens', () => {
  assert.deepEqual(geometry.place({ x: -1700, y: -300, width: 1600, height: 900 }, { x: -1920, y: 0, width: 1920, height: 1080 }, { width: 432, height: 720 }), { x: -548, y: 0, width: 432, height: 720 });
  assert.deepEqual(geometry.place({ x: 100, y: 200, width: 900, height: 900 }, { x: 0, y: 0, width: 320, height: 500 }, { width: 432, height: 720 }), { x: 0, y: 0, width: 320, height: 500 });
});
test('dragged placement survives tracker ticks, follows Codex translation, and preserves compact/expanded offsets', () => {
  const anchor = { x: 100, y: 80, width: 1200, height: 900 };
  const work = { x: 0, y: 0, width: 2560, height: 1440 };
  for (const size of [geometry.sizes.compact, geometry.sizes.expanded]) {
    const dragged = { x: 350, y: 150, ...size };
    const offset = geometry.offsetFrom(anchor, dragged);
    assert.deepEqual(geometry.place(anchor, work, size, offset), dragged);
    assert.deepEqual(geometry.place({ ...anchor, x: anchor.x + 150, y: anchor.y + 50 }, work, size, offset), { ...dragged, x: 500, y: 200 });
    assert.deepEqual(geometry.place(anchor, work, size, offset), dragged);
  }
});
test('adjustable card size is bounded and remains visible on small displays', () => {
  assert.equal(geometry.compactSize(undefined),256);
  assert.equal(geometry.compactSize(100),160);
  assert.equal(geometry.compactSize(900),420);
  assert.equal(geometry.compactSize(320),320);
  const side=geometry.compactSize(420);
  const bounds=geometry.place({x:0,y:0,width:300,height:250},{x:0,y:0,width:300,height:250},{width:side,height:side});
  assert.equal(bounds.width,300); assert.equal(bounds.height,250); assert.equal(bounds.x,0); assert.equal(bounds.y,0);
});
test('MCP initialize, tool discovery and validation work over stdio without a service', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['plugin/mcp-server.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const replies = new Map();
  const lines = createInterface({ input: child.stdout });
  let stderr = ''; child.stderr.on('data', x => { stderr += x; });
  const response = id => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('MCP timeout')), 5000); replies.set(id, data => { clearTimeout(timer); resolve(data); }); });
  lines.on('line', line => { const data = JSON.parse(line); replies.get(data.id)?.(data); });
  try {
    const init = response(1); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
    assert.equal((await init).result.serverInfo.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    const list = response(2); child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    assert.equal((await list).result.tools.length, tools.length);
    const invalid = response(3); child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"continuer_task_action","arguments":{"action":"continuous","id":"test"}}}\n');
    assert.equal((await invalid).result.isError, true); assert.equal(stderr, '');
    const malformed = response(4); child.stdin.write('{"id":4,"method":42}\n');
    assert.equal((await malformed).error.code, -32600);
  } finally { child.stdin.end(); lines.close(); child.kill(); }
});
