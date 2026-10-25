import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexRpc } from '../server/rpc.js';

function fixture(t, { initialize = true, exitOnInitialize = false } = {}) {
  const children = [], notifications = [], requests = [];
  const rpc = new CodexRpc({ spawnProcess: () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.messages = [];
    child.line = message => child.stdout.write(JSON.stringify(message) + '\n');
    child.kill = () => { child.emit('exit', 0); };
    child.stdin.on('finish', () => child.emit('exit', 0));
    child.stdin.on('data', data => {
      for (const line of String(data).trim().split('\n')) {
        const message = JSON.parse(line); child.messages.push(message);
        if (message.method === 'initialize' && initialize) {
          child.line({ id: message.id, result: {} });
          if (exitOnInitialize) child.emit('exit', 1);
        }
      }
    });
    children.push(child); return child;
  } });
  t.after(() => rpc.close());
  rpc.on('notification', message => notifications.push(message)); rpc.on('request', message => requests.push(message));
  return { rpc, children, notifications, requests };
}

test('replaced child notifications and requests are ignored while current messages are delivered', async t => {
  const f = fixture(t); await f.rpc.connect(); const old = f.children[0];
  old.emit('exit', 1); await f.rpc.connect(); const current = f.children[1];
  const notification = { method: 'turn/completed', params: { threadId: 'same-thread', turn: { id: 'same-turn', status: 'completed' } } };
  const request = { id: 50, method: 'item/commandExecution/requestApproval', params: { threadId: 'same-thread', turnId: 'same-turn' } };
  old.line(notification); old.line(request);
  assert.deepEqual(f.notifications, []); assert.deepEqual(f.requests, []);
  current.line(notification); current.line(request);
  assert.deepEqual(f.notifications, [notification]); assert.deepEqual(f.requests, [request]);
});

test('a replaced child cannot resolve or reject current pending RPC calls', async t => {
  const f = fixture(t); await f.rpc.connect(); const old = f.children[0];
  old.emit('exit', 1); await f.rpc.connect(); const current = f.children[1];
  const pending = f.rpc.call('fixture'), id = f.rpc.sequence;
  old.line({ id, result: { source: 'obsolete' } }); old.emit('exit', 2);
  assert.equal(f.rpc.pending.has(id), true); assert.equal(f.rpc.ready, true);
  current.line({ id, result: { source: 'current' } });
  assert.deepEqual(await pending, { source: 'current' });
});

test('close invalidates the reader and rejects pending calls immediately', async t => {
  const f = fixture(t); await f.rpc.connect(); const child = f.children[0];
  const pending = f.rpc.call('fixture'), rejected = assert.rejects(pending, /连接已关闭/);
  f.rpc.close(); child.line({ method: 'turn/completed', params: {} });
  await rejected; assert.equal(f.rpc.ready, false); assert.equal(f.rpc.pending.size, 0); assert.deepEqual(f.notifications, []);
});

test('late initialize response after close cannot make the dead connection ready', async t => {
  const f = fixture(t, { initialize: false }); const connecting = f.rpc.connect();
  const rejected = assert.rejects(connecting, /连接已关闭/), child = f.children[0];
  const id = child.messages[0].id;
  f.rpc.close(); child.line({ id, result: {} }); await rejected;
  assert.equal(f.rpc.ready, false); assert.equal(f.rpc.child, null);
});

test('exit immediately after initialize response cannot revive a failed connection', async t => {
  const f = fixture(t, { exitOnInitialize: true });
  await assert.rejects(f.rpc.connect(), /连接已失效/);
  assert.equal(f.rpc.ready, false); assert.equal(f.rpc.child, null);
});
