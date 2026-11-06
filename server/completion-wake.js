import { MessageError, setActivity, taskActivityMessage, message as textMessage } from '../public/message.js';
import { quotaAvailable } from './policy.js';
import { defaultContinuation } from '../public/i18n.js';
import { readThreadReplySnapshot } from './thread-reply.js';
import { enforceWakeLimit, enforceCompletionLimit, completionLimit, isEnabledMonitorTask } from './monitor-task.js';

// A completed final answer ends an instruction, not necessarily the project.
// Each final turn can queue one independently configured follow-up message.
export async function tickCompletionWake(manager, epoch = manager.scheduleEpoch) {
  for (const task of manager.state.tasks) {
    if (!manager.canSchedule(epoch)) break;
    if (!isEnabledMonitorTask(task) || task.completionMonitoring !== true) continue;
    if (enforceCompletionLimit(task)) { manager.changed(); continue; }
    if (enforceWakeLimit(task, manager.state.settings.maxWakeSends)) { manager.changed(); continue; }
    if ((manager.completionChecks.get(task.id) || 0) > Date.now()
      || !quotaAvailable(manager.wakeQuota, manager.wakeSampledAt, manager.state.settings.minimumRemaining)) continue;
    manager.completionChecks.set(task.id, Date.now() + manager.state.settings.pollSeconds * 1000);
    const completion = task.completion ||= { delivery: 'idle' };
    if (['sending', 'uncertain'].includes(completion.delivery)) continue;
    const permitted = () => manager.canSchedule(epoch) && isEnabledMonitorTask(task) && task.completionMonitoring === true
      && task.completion === completion && manager.state.tasks.includes(task)
      && (task.sentCount || 0) < manager.state.settings.maxWakeSends
      && (task.completionSends || 0) < completionLimit(task)
      && quotaAvailable(manager.wakeQuota, manager.wakeSampledAt, manager.state.settings.minimumRemaining);
    manager.wakeExecutions.set(task.id, completion);
    try {
      let reply;
      try { reply = await readThreadReplySnapshot(manager.rpc, task.threadId); }
      catch { reply = { state: 'unknown' }; }
      if (!permitted() || reply.state !== 'complete' || !reply.turnId || reply.turnId === completion.lastTurnId) continue;
      if (!manager.wakeSender) continue;
      const turnId = reply.turnId;
      const inspectReply = async () => {
        if (!permitted()) throw Object.assign(new MessageError(textMessage('error.paused_no_continuation_message_sent')), { cancelled: true });
        let current;
        try { current = await readThreadReplySnapshot(manager.rpc, task.threadId); }
        catch { current = { state: 'unknown' }; }
        if (!permitted()) throw Object.assign(new MessageError(textMessage('error.paused_no_continuation_message_sent')), { cancelled: true });
        if (current.state !== 'complete' || current.turnId !== turnId) {
          throw Object.assign(new MessageError(textMessage('task.completion_changed')), { waitForReply: true });
        }
      };
      try {
        // Persist the claim before the queue side effect. A crash cannot replay it.
        Object.assign(completion, { delivery: 'sending', turnId });
        setActivity(task, textMessage('task.completion_sending')); manager.changed();
        const result = await manager.wakeSender.send(task.threadId, {
          message: task.completionMessage?.trim() || defaultContinuation(manager.state.settings.language),
          shouldSend: permitted, beforeSend: inspectReply,
        });
        Object.assign(completion, { delivery: 'sent', lastTurnId: turnId, sentAt: Date.now(), queueId: result?.queueId || null });
        task.sentCount = (task.sentCount || 0) + 1;
        task.completionSends = (task.completionSends || 0) + 1;
        // Consume any quota recovery for the answered instruction as well.
        task.wake = { armed: false, delivery: 'idle' }; task.retryAt = 0; task.waitReason = null;
        if (task.continuous && task.status !== 'paused') task.status = 'monitoring';
        setActivity(task, textMessage(task.continuous ? 'task.completion_queued' : 'task.completion_queued_paused'));
        enforceCompletionLimit(task);
        enforceWakeLimit(task, manager.state.settings.maxWakeSends);
        manager.log(taskActivityMessage(task), 'success', task.id);
      } catch (error) {
        if (manager.persistence.status !== 'ok') throw error;
        if (error.cancelled || error.waitForReply || error.safeToRetry) {
          completion.delivery = 'idle';
        } else {
          completion.delivery = 'uncertain';
          task.waitReason = null; task.retryAt = 0;
          if (task.status !== 'paused') task.status = 'blocked';
        }
        setActivity(task, error); manager.log(taskActivityMessage(task), 'warning', task.id);
      }
      manager.changed();
    } finally { manager.wakeExecutions.delete(task.id); }
  }
}
