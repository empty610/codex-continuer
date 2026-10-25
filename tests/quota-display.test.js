import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaDisplay, quotaWindow, resetCountdown } from '../public/quota-display.js';

const now = 1800000000000;
const primary = { usedPercent: 77, windowDurationMins: 300, resetsAt: now / 1000 + 7380 };
const secondary = { usedPercent: 40, windowDurationMins: 10080, resetsAt: now / 1000 + 180000 };
const state = windows => ({ connection: { status: 'connected' }, sampledAt: now, quota: { rateLimitsByLimitId: { codex: windows } } });
test('gauge pairs available quota with the reset of the limiting window', () => {
  assert.deepEqual(quotaDisplay(state({ primary, secondary }), true, now), { remaining: 23, resetsAt: primary.resetsAt, windowMinutes: 300 });
  assert.equal(quotaDisplay(state({ primary: { ...primary, usedPercent: 10 }, secondary: { ...secondary, usedPercent: 99 } }), true, now).resetsAt, secondary.resetsAt);
});
test('disconnected, stale and incomplete gauge samples display unknown quota', () => {
  for (const reading of [quotaDisplay(state({ primary }), false, now), quotaDisplay({ ...state({ primary }), sampledAt: now - 90001 }, true, now), quotaDisplay(state({ primary, secondary: { usedPercent: null } }), true, now)]) assert.equal(reading.remaining, null);
});
test('countdown updates in seconds and handles day boundaries and elapsed resets', () => {
  assert.equal(resetCountdown(now / 1000 + 7380, now), '02:03:00');
  assert.equal(resetCountdown(now / 1000 + 7380, now + 1000), '02:02:59');
  assert.equal(resetCountdown(now / 1000 + 90061, now), '1天 01:01:01');
  assert.equal(resetCountdown(now / 1000, now), '待刷新');
  assert.equal(resetCountdown(null, now), '待同步');
});
test('an elapsed reset never turns exhausted quota into available quota', () => {
  const reading = quotaDisplay(state({ primary: { ...primary, usedPercent: 100, resetsAt: now / 1000 - 10 } }), true, now);
  assert.equal(reading.remaining, 0);
  assert.equal(resetCountdown(reading.resetsAt, now), '待刷新');
});
test('carousel starts from five-hour quota even if the seven-day quota is lower', () => {
  const sample=state({ primary, secondary:{...secondary,usedPercent:99} });
  assert.equal(quotaWindow(sample,'primary',true,now).remaining,23);
  assert.equal(quotaWindow(sample,'secondary',true,now).remaining,1);
  assert.equal(quotaWindow(sample,'primary',true,now).resetsAt,primary.resetsAt);
  assert.equal(quotaWindow(sample,'secondary',true,now).resetsAt,secondary.resetsAt);
});
test('missing carousel windows stay unknown without borrowing the other window', () => {
  assert.equal(quotaWindow(state({primary}),'secondary',true,now).remaining,null);
  assert.equal(quotaWindow(state({primary}),'primary',false,now).remaining,null);
});
