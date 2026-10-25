import { outcomeSummary } from './output.js';
export const QUOTA_TTL_MS = 90000;
export const MAX_POLL_SECONDS = QUOTA_TTL_MS / 1000;

export function buckets(payload) {
  const mapped = Object.values(payload?.rateLimitsByLimitId || {}).filter(Boolean);
  return mapped.length ? mapped : payload?.rateLimits ? [payload.rateLimits] : [];
}

// A reset timestamp alone never grants permission to run: require a fresh sample.
export function quotaAvailable(payload, sampledAt, minimum = 5, now = Date.now()) {
  if (!sampledAt || now - sampledAt > QUOTA_TTL_MS) return false;
  const all = buckets(payload);
  if (!all.length) return false;
  return all.every(bucket => {
    const windows = [bucket.primary, bucket.secondary].filter(Boolean);
    return !bucket.rateLimitReachedType && windows.length > 0 && windows.every(w => Number.isFinite(w.usedPercent) && 100 - w.usedPercent >= minimum);
  });
}

export function isQuotaError(error) {
  const code = error?.codexErrorInfo;
  return code === 'usageLimitExceeded' || code === 'rateLimitExceeded';
}

export function isWriterConflict(error) {
  return /^thread \S+ already has an active writer$/i.test(String(error?.message ?? error?.rpcError?.message ?? '').trim());
}

export function progress(plan) {
  if (!plan?.length) return null;
  return Math.round(plan.filter(step => step.status === 'completed').length / plan.length * 100);
}

export function parseOutcome(text) {
  try {
    const value = JSON.parse(text);
    if (['done', 'continue', 'blocked'].includes(value?.status) && typeof value.summary === 'string') return { status: value.status, summary: outcomeSummary(value.summary) };
  } catch { /* Missing structured outcome must not trigger an endless loop. */ }
  return { status: 'blocked', summary: '本轮已结束，未收到明确的完成状态，请检查输出后继续。' };
}
