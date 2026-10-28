import { t as tr } from './i18n.js';
// Display only. A countdown reaching zero never grants permission to run work.
export function quotaDisplay(state, connected = true, now = Date.now()) {
  if (!connected || state?.connection?.status !== 'connected' || !state?.sampledAt || now - state.sampledAt > 90000) return { remaining: null, resetsAt: null, windowMinutes: null };
  let buckets = Object.values(state.quota?.rateLimitsByLimitId || {}).filter(Boolean);
  if (!buckets.length && state.quota?.rateLimits) buckets = [state.quota.rateLimits];
  const windows = buckets.flatMap(b => [b.primary, b.secondary]).filter(Boolean);
  if (!windows.length || windows.some(w => !Number.isFinite(w.usedPercent))) return { remaining: null, resetsAt: null, windowMinutes: null };
  const ordered = windows.map(w => ({ remaining: Math.max(0, Math.min(100, 100 - w.usedPercent)), resetsAt: Number.isFinite(w.resetsAt) && w.resetsAt > 0 ? w.resetsAt : null, windowMinutes: w.windowDurationMins ?? null })).sort((a, b) => a.remaining - b.remaining || (b.resetsAt ?? 0) - (a.resetsAt ?? 0));
  return ordered[0];
}
export function resetCountdown(resetsAt, now = Date.now()) {
  if (!Number.isFinite(resetsAt) || resetsAt <= 0) return tr('待同步');
  const seconds = Math.ceil((resetsAt * 1000 - now) / 1000);
  if (seconds <= 0) return tr('待刷新');
  const pad = n => String(n).padStart(2, '0');
  const days = Math.floor(seconds / 86400);
  return `${days ? tr`${days}天 ` : ''}${pad(Math.floor(seconds / 3600) % 24)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
export function quotaWindow(state, slot = 'primary', connected = true, now = Date.now()) {
  if (!connected || state?.connection?.status !== 'connected' || !state?.sampledAt || now - state.sampledAt > 90000) return { remaining: null, resetsAt: null, windowMinutes: slot === 'primary' ? 300 : 10080 };
  const all = Object.values(state.quota?.rateLimitsByLimitId || {}).filter(Boolean);
  const bucket = all.find(b => b.limitId === 'codex') || all[0] || state.quota?.rateLimits;
  const targetDuration = slot === 'primary' ? 300 : 10080;
  const window = [bucket?.primary,bucket?.secondary].find(w => w?.windowDurationMins === targetDuration) || bucket?.[slot];
  return { remaining: Number.isFinite(window?.usedPercent) ? Math.max(0,Math.min(100,100-window.usedPercent)) : null, resetsAt: Number.isFinite(window?.resetsAt) && window.resetsAt > 0 ? window.resetsAt : null, windowMinutes: window?.windowDurationMins ?? targetDuration };
}
