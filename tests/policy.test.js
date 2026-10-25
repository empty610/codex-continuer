import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaAvailable, isQuotaError, isWriterConflict, progress, parseOutcome, buckets } from '../server/policy.js';
const now = Date.now();
const quota = (primary, secondary) => ({ rateLimitsByLimitId: { codex: { primary: { usedPercent: primary, resetsAt: 1 }, secondary: secondary === undefined ? null : { usedPercent: secondary } } } });
test('both quota windows must recover; a past reset never grants quota', () => {
  assert.equal(quotaAvailable(quota(80, 100), now), false);
  assert.equal(quotaAvailable(quota(100, 20), now), false);
  assert.equal(quotaAvailable(quota(90, 95), now), true);
});
test('missing, null and stale quota samples do not permit execution', () => {
  assert.equal(quotaAvailable(null, now), false);
  assert.equal(quotaAvailable(quota(null), now), false);
  assert.equal(quotaAvailable(quota(10), now - 91000), false);
  assert.equal(quotaAvailable(quota(10), null), false);
});
test('honor multiple buckets and legacy payloads', () => {
  const payload = quota(10); payload.rateLimitsByLimitId.other = { primary: { usedPercent: 100 } };
  assert.equal(quotaAvailable(payload, now), false);
  assert.equal(quotaAvailable({ rateLimits: { primary: { usedPercent: 10 } } }, now), true);
  assert.equal(buckets(payload).length, 2);
});
test('classify quota failures by typed codes, not arbitrary error text', () => {
  assert.equal(isQuotaError({ codexErrorInfo: 'usageLimitExceeded' }), true);
  assert.equal(isQuotaError({ codexErrorInfo: 'rateLimitExceeded' }), true);
  assert.equal(isQuotaError({ message: '429 quota', codexErrorInfo: 'unauthorized' }), false);
});

test('recognize only the explicit thread writer conflict as retryable ownership contention',()=>{
  assert.equal(isWriterConflict(new Error('thread abc-123 already has an active writer')),true);
  assert.equal(isWriterConflict({rpcError:{message:'thread abc already has an active writer'}}),true);
  for(const message of ['unauthorized','connection timed out','not an active writer','unrelated: thread abc already has an active writer'])
    assert.equal(isWriterConflict(new Error(message)),false);
});
test('derive progress from completed plan steps only', () => {
  assert.equal(progress([]), null);
  assert.equal(progress([{ status: 'completed' }, { status: 'inProgress' }, { status: 'pending' }]), 33);
});
test('unstructured or malformed outcomes stop automatic continuation', () => {
  assert.equal(parseOutcome('All done!').status, 'blocked');
  assert.equal(parseOutcome('{"status":"done"}').status, 'blocked');
  assert.equal(parseOutcome('{"status":"done","summary":"Tests passed"}').status, 'done');
});
