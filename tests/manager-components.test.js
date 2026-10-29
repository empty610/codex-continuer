import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, prepareState } from '../server/state-lifecycle.js';
import { StatePersistence } from '../server/state-persistence.js';
import { TurnController } from '../server/turn-controller.js';

function fixture(saved = initialState()) {
  const writes = [], sent = [], errors = [], trace = [];
  let fail = false, backup = initialState(false);
  const persistence = new StatePersistence({
    load: () => structuredClone(saved),
    save: state => {
      trace.push('save');
      if (fail) throw Error('fixture disk unavailable');
      writes.push(structuredClone(state));
    },
    restoreBackup: transform => {
      const state = structuredClone(backup);
      transform(state);
      return state;
    },
  }, error => errors.push(error));
  persistence.load();
  const rpc = { ready: true, send: message => { trace.push('send'); sent.push(message); }, call: async () => ({}) };
  const turns = new TurnController(rpc, {
    persistence,
    canSchedule: () => persistence.healthy && persistence.state.settings.enabled,
    hasExecutionQuota: () => true,
    isStopped: () => false,
    changed: options => persistence.changed(options),
    log: () => {},
    invalidateQuota: () => {},
    onError: error => errors.push(error),
  });
  return { persistence, turns, writes, sent, errors, trace, fail: value => { fail = value; }, backup: value => { backup = value; } };
}

test('startup migration is independent of RPC and preserves legacy monitoring semantics', () => {
  const state = initialState(false);
  state.settings.pollSeconds = 120; delete state.settings.maxWakeSends;
  state.tasks = [
    { id: 'old', threadId: 'external', status: 'blocked', activity: 'thread external already has an active writer', continuous: true, prompt: 'Local note', rounds: 12 },
    { id: 'done', status: 'completed' },
    { id: 'active', status: 'running', continuous: true, rounds: 1 },
  ];
  assert.equal(prepareState(state), true);
  assert.equal(state.settings.enabled, false);
  assert.equal(state.settings.pollSeconds, 90);
  assert.equal(state.settings.maxWakeSends, 20);
  assert.deepEqual(state.tasks.map(task => task.id), ['old', 'active']);
  assert.equal(state.tasks[0].mode, 'quota-wake');
  assert.equal(state.tasks[0].note, 'Local note');
  assert.equal(state.tasks[0].sentCount, 0);
  assert.equal(state.tasks[0].status, 'monitoring');
  assert.equal('rounds' in state.tasks[0], false);
  assert.equal('prompt' in state.tasks[0], false);
  assert.equal(state.tasks[1].status, 'blocked');
  const migrated = structuredClone(state);
  assert.equal(prepareState(state), false);
  assert.deepEqual(state, migrated);
});

test('migration save failures report the error and disable scheduling before use', () => {
  const state = initialState(); delete state.settings.maxWakeSends;
  const errors = [];
  const persistence = new StatePersistence({ load: () => state, save: () => { throw Error('fixture disk unavailable'); } }, error => errors.push(error));
  assert.doesNotThrow(() => persistence.load());
  assert.equal(errors.length, 1);
  assert.equal(persistence.healthy, false);
  assert.equal(persistence.state.settings.enabled, false);
  assert.match(persistence.status.message, /disk unavailable/);
});

test('backup replacement cancels deferred writes and turn handling reads the restored state', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), oldState = f.persistence.state;
  const oldTask = { id: 'old', threadId: 'old-chat', turnId: 'old-turn', status: 'running', output: '', rounds: 1 };
  oldState.tasks.push(oldTask);
  f.persistence.changed({ deferSave: true });
  const backup = initialState();
  backup.tasks.push({ id: 'restored', threadId: 'restored-chat', status: 'paused', continuous: true, rounds: 1, output: '', plan: [] });
  f.backup(backup); f.persistence.restoreBackup();
  t.mock.timers.tick(1000);
  assert.equal(f.writes.length, 0);
  assert.equal(f.persistence.pending, false);
  assert.notEqual(f.persistence.state, oldState);
  const restored = f.persistence.state.tasks[0];
  assert.equal(restored.status, 'blocked');
  assert.equal(restored.continuous, false);
  Object.assign(restored, { status: 'running', turnId: 'restored-turn' });
  const delta = (threadId, turnId, text) => f.turns.event({ method: 'item/agentMessage/delta', params: { threadId, turnId, delta: text } });
  delta('old-chat', 'old-turn', 'obsolete output');
  delta('restored-chat', 'restored-turn', 'current output');
  t.mock.timers.tick(250);
  assert.equal(oldTask.output, '');
  assert.equal(restored.output, 'current output');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].tasks.map(task => task.id), ['restored']);
});

test('standalone turn approvals commit before sending and keep requests after a failed save', () => {
  const f = fixture(), other = fixture();
  const task = { id: 'work', threadId: 'chat', turnId: 'turn', status: 'running', cwd: 'E:\\fixture', rounds: 1 };
  f.persistence.state.tasks.push(task);
  f.turns.request({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'chat', turnId: 'turn', command: 'echo fixture' } });
  assert.equal(task.status, 'approval');
  assert.equal(other.turns.approvals.size, 0);
  const token = f.turns.approvals.get('1').detailToken;
  f.fail(true); f.trace.length = 0;
  assert.throws(() => f.turns.approve(1, 'accept', token), /disk unavailable/);
  assert.deepEqual(f.trace, ['save']);
  assert.equal(f.sent.length, 0);
  assert.equal(f.turns.approvals.size, 1);
  f.fail(false); f.persistence.retry(); f.trace.length = 0;
  f.turns.approve(1, 'decline', token);
  assert.deepEqual(f.trace, ['save', 'send', 'save']);
  assert.equal(f.turns.approvals.size, 0);
  assert.equal(task.status, 'running');
});
