import { buckets } from './policy.js';

export const SUMMARY_BUDGET = 768 * 1024;
const text = (value, limit) => typeof value === 'string' ? value.length > limit ? value.slice(0, limit - 1) + '…' : value : typeof value === 'object' ? null : value;
const pick = (value, keys, limit = 160) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, text(value[key], limit)]));
const windowSummary = value => value && pick(value, ['usedPercent', 'windowDurationMins', 'resetsAt']);

// Keep all managed records, but move long text to the existing detail/log APIs.
// Budgets apply to the combined UTF-8 frame, not to individual character counts.
export function compactSummary(snapshot) {
  const result = {
    ...pick(snapshot, ['app', 'version', 'buildId', 'protocolVersion', 'schemaVersion', 'sampledAt', 'demo', 'observationOnly']),
    settings: pick(snapshot.settings, ['enabled', 'language', 'pollSeconds', 'minimumRemaining', 'maxRounds', 'maxWakeSends']),
    persistence: { ...pick(snapshot.persistence, ['status', 'needsRestore', 'pending', 'failedAt', 'backupAvailable']), message: text(snapshot.persistence?.message, 2000), loadError: text(snapshot.persistence?.loadError, 2000) },
    connection: { status: snapshot.connection?.status, message: text(snapshot.connection?.message, 2000) },
    tasks: snapshot.tasks.map(task => ({
      ...pick(task, ['id', 'mode', 'name', 'threadId', 'status', 'continuous', 'rounds', 'sentCount', 'waitReason', 'retryAt', 'createdAt', 'updatedAt', 'progress', 'detailRevision']),
      cwd: text(task.cwd, 256), activity: text(task.activity, 240),
      ...(task.mode === 'quota-wake' ? { notePreview: text(task.note || '', 500), noteTruncated: (task.note?.length || 0) > 500 } : {}),
      ...(task.wake ? { wake: pick(task.wake, ['armed', 'delivery', 'episodeId', 'exhaustedAt', 'sentAt', 'queueId']) } : {}),
    })),
    approvals: snapshot.approvals.map(item => ({ ...pick(item, ['id', 'taskId', 'method', 'detailToken']), requiresDetails: (item.reason?.length || 0) > 240 || (item.command?.length || 0) > 1000 || (item.cwd?.length || 0) > 256, reason: text(item.reason, 240), command: text(item.command, 1000), cwd: text(item.cwd, 256) })),
    quota: snapshot.quota ? { rateLimitsByLimitId: Object.fromEntries(buckets(snapshot.quota).slice(0, 16).map((bucket, index) => [String(bucket.limitId || index).slice(0, 80), { ...pick(bucket, ['limitId', 'limitName', 'planType', 'rateLimitReachedType'], 80), primary: windowSummary(bucket.primary), secondary: windowSummary(bucket.secondary) }])) } : null,
    history: snapshot.history.slice(-240).map(entry => ({ time: Number.isFinite(entry.time) ? entry.time : 0, values: entry.values.slice(0, 16).map(value => ({ id: text(value?.id, 40), used: Number.isFinite(value?.used) ? value.used : null })) })),
    logs: snapshot.logs.slice(0, 50).map(entry => ({ ...pick(entry, ['id', 'time', 'type', 'taskId']), message: text(entry.message, 180) })),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > SUMMARY_BUDGET) {
    result.history = []; result.logs = [];
    result.approvals = result.approvals.map(item => ({ ...item, requiresDetails: true, command: '', reason: text(item.reason, 80) }));
    result.summaryNotice = '列表内容较多，已精简历史和授权预览；完整内容请打开详情。';
  }
  return result;
}
