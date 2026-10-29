import { MessageError, setActivity, taskActivityMessage, message as textMessage } from '../public/message.js';
import { randomUUID } from 'node:crypto';
import { buckets, quotaAvailable, QUOTA_TTL_MS } from './policy.js';
import { defaultContinuation } from '../public/i18n.js';
import { readThreadReply } from './thread-reply.js';
import { enforceWakeLimit, isEnabledMonitorTask } from './monitor-task.js';

export { resetWake, enforceWakeLimit } from './monitor-task.js';

export function quotaExhausted(payload) {
  return buckets(payload).some(b => Boolean(b.rateLimitReachedType) || [b.primary, b.secondary].some(w => Number.isFinite(w?.usedPercent) && w.usedPercent >= 100));
}

export async function tickQuotaWake(manager, epoch = manager.scheduleEpoch) {
  const now = Date.now();
  if (!manager.wakeSampledAt || now - manager.wakeSampledAt > QUOTA_TTL_MS) return;
  for (const task of manager.state.tasks) {
    if (!manager.canSchedule(epoch)) break;
    if (!isEnabledMonitorTask(task)) continue;
    if (enforceWakeLimit(task, manager.state.settings.maxWakeSends)) { manager.changed(); continue; }
    const wake = task.wake ||= { armed: false, delivery: 'idle' };
    if (quotaExhausted(manager.wakeQuota)) {
      if (!wake.armed) {
        Object.assign(wake, { armed: true, episodeId: randomUUID(), exhaustedAt: now, delivery: 'pending' });
        task.status = 'waiting'; task.waitReason = 'quota'; task.retryAt = 0;
        setActivity(task, textMessage("task.quota_exhaustion_confirmed_one_continuation_message_will_be"));
        manager.log(taskActivityMessage(task), 'info', task.id); manager.changed();
      }
      continue;
    }
    if (wake.armed !== true || wake.delivery !== 'pending' || (task.retryAt || 0) > now || !quotaAvailable(manager.wakeQuota, manager.wakeSampledAt, manager.state.settings.minimumRemaining)) continue;
    if (!manager.wakeSender) {
      if (task.waitReason !== 'desktop') { task.waitReason = 'desktop'; setActivity(task, textMessage("task.quota_recovered_waiting_for_message_delivery_to_become")); manager.changed(); }
      continue;
    }
    manager.wakeExecutions.set(task.id, wake);
    try {
      const permitted = () => manager.canSchedule(epoch) && isEnabledMonitorTask(task)
        && task.wake === wake && manager.state.tasks.includes(task) && (task.sentCount || 0) < manager.state.settings.maxWakeSends
        && quotaAvailable(manager.wakeQuota, manager.wakeSampledAt, manager.state.settings.minimumRemaining);
      const inspectReply = async () => {
        if (!permitted()) throw Object.assign(new MessageError(textMessage("error.paused_no_continuation_message_sent")), { cancelled: true });
        let reply;
        try { reply = await readThreadReply(manager.rpc, task.threadId); }
        catch { reply = 'unknown'; }
        if (!permitted()) throw Object.assign(new MessageError(textMessage("error.paused_no_continuation_message_sent")), { cancelled: true });
        if (reply === 'complete') throw Object.assign(new MessageError(textMessage("error.the_last_instruction_already_received_a_complete_reply")), { replyComplete: true });
        if (reply !== 'incomplete') throw Object.assign(new MessageError(reply === 'active' ? textMessage("error.the_original_chat_is_still_replying_no_continuation") : textMessage("error.reply_status_could_not_be_confirmed_no_continuation")), { waitForReply: true });
      };
      try {
        await inspectReply();
        // Durable outbox claim before the side effect. A restart leaves this uncertain.
        wake.delivery = 'sending'; setActivity(task, textMessage("task.quota_recovered_sending_a_continuation_message_to_the")); manager.changed();
        const result = await manager.wakeSender.send(task.threadId, { message: task.continuationMessage?.trim() || defaultContinuation(manager.state.settings.language), shouldSend: permitted, beforeSend: inspectReply });
        Object.assign(wake, { armed: false, delivery: 'sent', sentAt: Date.now(), queueId: result?.queueId || null });
        task.sentCount = (task.sentCount || 0) + 1;
        // A user may pause while the queue command is in flight; don't undo it.
        if (task.continuous && task.status !== 'paused') { task.status = 'monitoring'; task.waitReason = null; }
        setActivity(task, task.continuous ? textMessage("task.continuation_message_queued_monitoring_continues_check_results_in") : textMessage("task.continuation_message_queued_monitoring_paused_queued_messages_can"));
        enforceWakeLimit(task, manager.state.settings.maxWakeSends);
        manager.log(taskActivityMessage(task), 'success', task.id);
      } catch (error) {
        if (manager.persistence.status !== 'ok') throw error;
        if (error.replyComplete) {
          wake.armed = false; wake.delivery = 'idle'; task.retryAt = 0; task.waitReason = null;
          task.status = task.continuous ? 'monitoring' : 'paused';
        } else if (error.waitForReply) {
          wake.delivery = 'pending'; task.waitReason = 'thread'; task.retryAt = Date.now() + manager.state.settings.pollSeconds * 1000;
        } else if (error.cancelled) { if (wake.delivery === 'sending') wake.delivery = 'pending'; }
        else if (error.safeToRetry && task.continuous && task.status !== 'paused') {
          wake.delivery = 'pending'; task.waitReason = 'desktop'; task.retryAt = Date.now() + 60000;
        } else { wake.delivery = 'uncertain'; if (task.status !== 'paused') task.status = 'blocked'; }
        setActivity(task, error);
        manager.log(taskActivityMessage(task), error.replyComplete ? 'info' : 'warning', task.id);
      }
      manager.changed();
    } finally { manager.wakeExecutions.delete(task.id); }
  }
}
