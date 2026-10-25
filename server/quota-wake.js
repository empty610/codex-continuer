import { randomUUID } from 'node:crypto';
import { buckets, quotaAvailable, QUOTA_TTL_MS } from './policy.js';

export function enforceWakeLimit(task, limit) {
  if ((task.sentCount || 0) < limit) return false;
  task.continuous = false;
  if (task.wake?.delivery !== 'uncertain') {
    task.status = 'paused'; task.waitReason = 'send-limit'; task.retryAt = 0;
    if (task.wake && task.wake.delivery !== 'sending') {
      task.wake.armed = false;
      if (task.wake.delivery === 'pending') task.wake.delivery = 'idle';
    }
    task.activity = `已达到原聊天发送上限（${task.sentCount}/${limit} 次），监测已停止；请查看原聊天确认工作结果`;
  }
  return true;
}

export function quotaExhausted(payload) {
  return buckets(payload).some(b => Boolean(b.rateLimitReachedType) || [b.primary, b.secondary].some(w => Number.isFinite(w?.usedPercent) && w.usedPercent >= 100));
}

export function resetWake(task) {
  task.wake = { armed: false, delivery: 'idle' };
  task.status = task.continuous ? 'monitoring' : 'paused';
  task.waitReason = null; task.retryAt = 0;
  task.activity = task.continuous ? '正在监测额度；确认耗尽后，恢复时向原聊天发送“继续”' : '额度恢复续作已暂停';
}

export async function tickQuotaWake(manager, epoch = manager.scheduleEpoch) {
  const now = Date.now();
  if (!manager.wakeSampledAt || now - manager.wakeSampledAt > QUOTA_TTL_MS) return;
  for (const task of manager.state.tasks) {
    if (!manager.canSchedule(epoch)) break;
    if (task.mode !== 'quota-wake' || task.continuous !== true || !['monitoring', 'waiting'].includes(task.status)) continue;
    if (enforceWakeLimit(task, manager.state.settings.maxWakeSends)) { manager.changed(); continue; }
    const wake = task.wake ||= { armed: false, delivery: 'idle' };
    if (quotaExhausted(manager.wakeQuota)) {
      if (!wake.armed) {
        Object.assign(wake, { armed: true, episodeId: randomUUID(), exhaustedAt: now, delivery: 'pending' });
        task.status = 'waiting'; task.waitReason = 'quota'; task.retryAt = 0;
        task.activity = '已确认额度耗尽，恢复后向原聊天发送一次“继续”';
        manager.log(`${task.name}：${task.activity}`, 'info', task.id); manager.changed();
      }
      continue;
    }
    if (wake.armed !== true || wake.delivery !== 'pending' || (task.retryAt || 0) > now || !quotaAvailable(manager.wakeQuota, manager.wakeSampledAt, manager.state.settings.minimumRemaining)) continue;
    if (!manager.wakeSender) {
      if (task.waitReason !== 'desktop') { task.waitReason = 'desktop'; task.activity = '额度已恢复，等待消息发送通道'; manager.changed(); }
      continue;
    }
    manager.wakeExecutions.set(task.id, wake);
    try {
      // Durable outbox claim before the side effect. A restart leaves this uncertain.
      wake.delivery = 'sending'; task.activity = '额度已恢复，正在向原聊天发送“继续”'; manager.changed();
      try {
        const result = await manager.wakeSender.send(task.threadId, { shouldSend: () => manager.canSchedule(epoch) && task.continuous === true && task.status !== 'paused' && task.wake === wake && manager.state.tasks.includes(task) && (task.sentCount || 0) < manager.state.settings.maxWakeSends && quotaAvailable(manager.wakeQuota, manager.wakeSampledAt, manager.state.settings.minimumRemaining) });
        Object.assign(wake, { armed: false, delivery: 'sent', sentAt: Date.now(), queueId: result?.queueId || null });
        task.sentCount = (task.sentCount || 0) + 1;
        // A user may pause while the queue command is in flight; don't undo it.
        if (task.continuous && task.status !== 'paused') { task.status = 'monitoring'; task.waitReason = null; }
        task.activity = task.continuous ? '已向原聊天排队发送“继续”，继续监测；工作结果请在原聊天确认' : '已向原聊天排队发送“继续”，监测已暂停；已排队消息无法撤回';
        enforceWakeLimit(task, manager.state.settings.maxWakeSends);
        manager.log(`${task.name}：${task.activity}`, 'success', task.id);
      } catch (error) {
        if (error.cancelled) { wake.delivery = 'pending'; }
        else if (error.safeToRetry && task.continuous && task.status !== 'paused') {
          wake.delivery = 'pending'; task.waitReason = 'desktop'; task.retryAt = Date.now() + 60000;
        } else { wake.delivery = 'uncertain'; if (task.status !== 'paused') task.status = 'blocked'; }
        task.activity = error.message;
        manager.log(`${task.name}：${error.message}`, 'warning', task.id);
      }
      manager.changed();
    } finally { manager.wakeExecutions.delete(task.id); }
  }
}
