import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Manager } from '../server/manager.js';
import { Store } from '../server/store.js';
import { parseOutcome } from '../server/policy.js';
import { OUTPUT_LIMIT, SUMMARY_LIMIT } from '../server/output.js';

function fixture(t, store = { load: () => null, save: () => {} }) {
  const rpc = new EventEmitter();
  rpc.call = async method => method === 'thread/read' ? { thread: { status: { type: 'idle' } } } : { turn: { id: 'next-turn' } };
  rpc.close = () => {};
  const m = new Manager(rpc, store, { demo: true });
  t.after(() => m.stop());
  const task = m.create({ name: 'Output fixture', cwd: 'E:\\fixture', prompt: 'Isolated test', continuous: true });
  Object.assign(task, { status: 'running', threadId: 'fixture-thread', turnId: 'fixture-turn', toolCount: 1 });
  const event = (method, params) => m.event({ method, params: { threadId: task.threadId, turnId: task.turnId, ...params } });
  return { m, task, delta: text => event('item/agentMessage/delta', { delta: text }),
    message: text => event('item/completed', { item: { type: 'agentMessage', text } }),
    complete: () => event('turn/completed', { turn: { status: 'completed' } }) };
}

test('delta and completed text share the same tail limit and replacement clears the truncation flag', t => {
  const { m, task, delta, message } = fixture(t);
  const text = 'prefix' + 'x'.repeat(262144) + 'end';
  delta(text);
  assert.equal(task.output, text.slice(-OUTPUT_LIMIT));
  assert.equal(task.outputTruncated, true);
  message(text);
  assert.equal(task.output, text.slice(-OUTPUT_LIMIT));
  assert.equal(m.snapshot().tasks[0].output.length, OUTPUT_LIMIT);
  delta('tail'); assert.equal(task.outputTruncated, true);
  message('short final');
  assert.equal(task.output, 'short final'); assert.equal(task.outputTruncated, false);
});

test('exactly 16000 characters are preserved without reporting truncation', t => {
  const { task, message } = fixture(t);
  message('x'.repeat(OUTPUT_LIMIT));
  assert.equal(task.output.length, OUTPUT_LIMIT); assert.equal(task.outputTruncated, false);
});

for (const status of ['done', 'continue', 'blocked']) {
  test(`oversized JSON preserves ${status} separately and bounds summaries, logs and snapshots`, t => {
    const { m, task, message, complete } = fixture(t);
    message(JSON.stringify({ status, summary: 's'.repeat(262144), extra: 'discard'.repeat(262144) }));
    assert.throws(() => JSON.parse(task.output));
    assert.deepEqual(task.outcome, { status, summary: 's'.repeat(SUMMARY_LIMIT) });
    assert.ok(JSON.stringify(m.snapshot()).length < 22000);
    complete();
    assert.equal(task.status, { done: 'completed', continue: 'queued', blocked: 'blocked' }[status]);
    assert.equal(task.activity.length, SUMMARY_LIMIT);
    assert.ok(m.state.logs[0].message.length < SUMMARY_LIMIT + 100);
    assert.equal(m.state.tasks.includes(task), status !== 'done');
  });
}

test('oversized continue without tool activity stays blocked', t => {
  const { task, message, complete } = fixture(t); task.toolCount = 0;
  message(JSON.stringify({ status: 'continue', summary: 's'.repeat(262144) })); complete();
  assert.equal(task.status, 'blocked'); assert.match(task.activity, /本轮无工具活动/);
});

test('invalid or empty last messages replace prior results and cannot reuse done', t => {
  for (const text of ['invalid'.repeat(262144), '', '{"status":"done"}', 'null']) {
    const { task, message, complete } = fixture(t);
    message('{"status":"done","summary":"earlier message"}');
    message(text); complete();
    assert.equal(task.status, 'blocked'); assert.ok(task.output.length <= OUTPUT_LIMIT);
  }
});

test('new deltas invalidate a prior message result and missing final text cannot reuse it', t => {
  const { task, message, delta, complete } = fixture(t);
  message('{"status":"done","summary":"earlier message"}');
  delta('x'.repeat(262144)); message(undefined); complete();
  assert.equal(task.status, 'blocked'); assert.equal(task.outputTruncated, true);
});

test('a new round clears output, truncation and cached outcome before starting', async t => {
  const { m, task, message, complete } = fixture(t);
  message(JSON.stringify({ status: 'continue', summary: 's'.repeat(262144) })); complete();
  m.rpc.ready = true; m.connection.status = 'connected'; m.setQuota({ rateLimits: { primary: { usedPercent: 10 } } });
  await m.run(task);
  assert.equal(task.output, ''); assert.equal(task.outputTruncated, false); assert.equal(task.outcome, null);
  complete(); assert.equal(task.status, 'blocked');
});

test('short streamed JSON still supports completion without an item-completed notification', t => {
  const { task, delta, complete } = fixture(t);
  delta('{"status":"continue","summary":"verified tools"}'); complete();
  assert.equal(task.status, 'queued'); assert.equal(task.activity, 'verified tools');
});

test('truncation does not split Unicode surrogate pairs in previews or summaries', t => {
  const { task, message } = fixture(t);
  message('a😀' + 'x'.repeat(OUTPUT_LIMIT - 1));
  assert.equal(task.output, 'x'.repeat(OUTPUT_LIMIT - 1));
  assert.equal(task.outputTruncated, true);
  const outcome = parseOutcome(JSON.stringify({ status: 'blocked', summary: 'x'.repeat(SUMMARY_LIMIT - 1) + '😀end' }));
  assert.equal(outcome.summary, 'x'.repeat(SUMMARY_LIMIT - 1));
});

test('completed output stays bounded on disk and oversized legacy output is migrated on load', t => {
  const temporaryRoot = realpathSync(tmpdir()), dir = mkdtempSync(join(temporaryRoot, 'continuer-output-limit-'));
  try {
    const store = new Store(join(dir, 'state.json'));
    const { m, task, message, complete } = fixture(t, store);
    const text = JSON.stringify({ status: 'blocked', summary: 's'.repeat(2 * 1024 * 1024) });
    message(text); complete();
    assert.ok(statSync(store.file).size < 26000);
    assert.equal(store.load().tasks[0].outcome.status, 'blocked');
    // Model a state file saved by the older, uncapped completion path.
    task.output = text; delete task.outcome; delete task.outputTruncated; store.save(m.state);
    const restored = new Manager(new EventEmitter(), store, { demo: true });
    assert.equal(restored.state.tasks[0].output.length, OUTPUT_LIMIT);
    assert.equal(restored.state.tasks[0].outputTruncated, true);
    assert.equal(restored.state.tasks[0].outcome.summary.length, SUMMARY_LIMIT);
    assert.ok(statSync(store.file).size < 26000);
    assert.deepEqual(store.load(), restored.state);
  } finally {
    assert.equal(dirname(realpathSync(dir)), temporaryRoot);
    rmSync(dir, { recursive: true, force: true });
  }
});
