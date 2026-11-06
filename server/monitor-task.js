import { MessageError, activityFields, setActivity, message as textMessage } from '../public/message.js';
import { randomUUID } from 'node:crypto';
import { ClientError } from './http-policy.js';
import { isWriterConflict } from './policy.js';

/**
 * @typedef {object} MonitorTask
 * @property {'quota-wake'} mode
 * @property {string} note Local note; never an execution goal.
 * @property {string} continuationMessage Message for future recovery deliveries.
 * @property {boolean} completionMonitoring Whether complete replies trigger follow-ups.
 * @property {string} completionMessage Independent follow-up after a final reply.
 * @property {object} completion Durable final-turn claim and deduplication evidence.
 * @property {number} sentCount Confirmed queue deliveries; resume never resets it.
 * @property {boolean} continuous Master monitoring switch.
 * @property {boolean} quotaMonitoring Whether quota recovery is monitored.
 * @property {boolean} completionRepeat Whether new complete replies keep triggering.
 * @property {number} completionMaxSends Maximum completion sends per run, including the first.
 * @property {number} completionSends Confirmed completion sends in the current run.
 * @property {object} wake The recovery episode and delivery claim.
 * @property {string} status A member of MONITOR_TASK_STATUSES.
 */
export const MONITOR_TASK_STATUSES = Object.freeze(['monitoring', 'waiting', 'paused', 'blocked', 'completed']);
export const isMonitorTask = task => task?.mode === 'quota-wake';
export const isEnabledMonitorTask = task => isMonitorTask(task) && task.continuous === true && ['monitoring', 'waiting'].includes(task.status);
export const isEnabledQuotaMonitorTask = task => isEnabledMonitorTask(task) && task.quotaMonitoring !== false;
export const completionLimit = task => task.completionRepeat === false ? 1 : (task.completionMaxSends ?? 100);
function pauseUnusedMonitor(task) {
  if (task.quotaMonitoring === false && !task.completionMonitoring && task.continuous) {
    task.continuous=false; task.status='paused'; task.waitReason=null; task.retryAt=0;
  }
}
export function enforceCompletionLimit(task) {
  if (!task.completionMonitoring || (task.completionSends || 0) < completionLimit(task)) return false;
  task.completionMonitoring=false; pauseUnusedMonitor(task);
  setActivity(task,textMessage('task.completion_limit',{count:task.completionSends,limit:completionLimit(task)}));
  return true;
}
const executionFields = ['prompt', 'rounds', 'plan', 'output', 'outputTruncated', 'outcome', 'toolCount', 'turnId', 'lastError'];

export function resetWake(task) {
  // Explicit resume acknowledges ambiguity without resending the same answer.
  if (task.completion?.delivery === 'uncertain') {
    task.completion.lastTurnId = task.completion.turnId; task.completion.delivery = 'idle';
  }
  task.wake = { armed: false, delivery: 'idle' };
  task.status = task.continuous ? 'monitoring' : 'paused';
  task.waitReason = null; task.retryAt = 0;
  setActivity(task, task.continuous ? textMessage(task.completionMonitoring ? 'task.monitoring_replies_and_quota' : 'task.monitoring_quota_a_continuation_message_will_be_sent') : textMessage("task.quota_recovery_monitoring_paused"));
}

export function enforceWakeLimit(task, limit) {
  if ((task.sentCount || 0) < limit) return false;
  task.continuous = false;
  if (task.wake?.delivery !== 'uncertain' && task.completion?.delivery !== 'uncertain') {
    task.status = 'paused'; task.waitReason = 'send-limit'; task.retryAt = 0;
    if (task.wake && task.wake.delivery !== 'sending') {
      task.wake.armed = false;
      if (task.wake.delivery === 'pending') task.wake.delivery = 'idle';
    }
    setActivity(task, textMessage("monitor.send_limit", { sent: task.sentCount, limit: limit }));
  }
  return true;
}

export function validateMonitorInput(note, continuationMessage) {
  if (typeof note !== 'string' || note.length > 12000) throw new ClientError(textMessage("error.monitoring_notes_must_be_text_of_up_to"));
  if (typeof continuationMessage !== 'string' || continuationMessage.length > 12000) throw new ClientError(textMessage("error.continuation_messages_must_be_text_of_up_to"));
}

export function validateCompletionInput(enabled, message, {quotaMonitoring, repeat, maxSends} = {}) {
  if (typeof enabled !== 'boolean') throw new ClientError(textMessage('error.invalid_switch_value'));
  if ((quotaMonitoring !== undefined && typeof quotaMonitoring !== 'boolean') || (repeat !== undefined && typeof repeat !== 'boolean')) throw new ClientError(textMessage('error.invalid_switch_value'));
  if (maxSends !== undefined && (!Number.isSafeInteger(maxSends) || maxSends < 1 || maxSends > 100)) throw new ClientError(textMessage('error.completion_send_limit'));
  validateMonitorInput('', message);
}

export function createMonitorTask(threadId, thread, note = '', continuationMessage = '', { completionMonitoring = false, completionMessage = '', quotaMonitoring = true, completionRepeat = false, completionMaxSends = 20 } = {}) {
  validateMonitorInput(note, continuationMessage);
  validateCompletionInput(completionMonitoring, completionMessage, {quotaMonitoring,repeat:completionRepeat,maxSends:completionMaxSends});
  const now = Date.now();
  return { id: randomUUID(), mode: 'quota-wake', threadId, name: (thread.name || thread.preview || 'Codex 会话').slice(0, 80), cwd: thread.cwd, note: note.trim(), continuationMessage: continuationMessage.trim(), quotaMonitoring, completionMonitoring, completionRepeat, completionMaxSends, completionSends: 0, completionMessage: completionMessage.trim(), completion: { delivery: 'idle' }, continuous: false, status: 'paused', ...activityFields(textMessage("task.chat_added_enable_monitoring_to_send_a_message")), sentCount: 0, wake: { armed: false, delivery: 'idle' }, createdAt: now, updatedAt: now };
}

export function migrateLegacyWriter(task) {
  if (task.mode !== undefined || !['waiting', 'blocked'].includes(task.status) || !task.threadId || !task.continuous
    || !(task.waitReason === 'writer' || isWriterConflict({ message: task.activity }))) return false;
  task.mode = 'quota-wake'; resetWake(task);
  // Direct rounds were never confirmed queued messages.
  task.sentCount = 0;
  return true;
}

function prepare(task, settings) {
  let changed = false;
  for (const [key,value] of Object.entries({quotaMonitoring:true,completionRepeat:true,completionMaxSends:100,completionSends:0})) {
    if (task[key] === undefined) { task[key]=value; changed=true; }
  }
  if (!task.wake) { task.wake = { armed: false, delivery: 'idle' }; changed = true; }
  if (task.wake.delivery === 'pending' && (!task.wake.episodeId || !Number.isFinite(task.wake.exhaustedAt))) {
    task.wake.delivery = 'uncertain'; task.continuous = false; task.status = 'blocked';
    setActivity(task, textMessage("task.this_legacy_record_lacks_proof_of_quota_exhaustion")); changed = true;
  }
  if (typeof task.note !== 'string') { task.note = task.prompt || ''; changed = true; }
  if (!Number.isInteger(task.sentCount) || task.sentCount < 0) { task.sentCount = Math.max(0, Number.isInteger(task.rounds) ? task.rounds : 0); changed = true; }
  for (const key of executionFields) if (key in task) { delete task[key]; changed = true; }
  if (task.completion?.delivery === 'sending') {
    task.completion.delivery = 'uncertain'; task.status = 'blocked'; task.continuous = false;
    task.waitReason = null; task.retryAt = 0;
    setActivity(task, textMessage('task.the_previous_delivery_is_unconfirmed_check_the_original')); changed = true;
  }
  if (task.wake.delivery === 'sending') {
    task.wake.delivery = 'uncertain'; task.status = 'blocked'; setActivity(task, textMessage("task.the_previous_delivery_is_unconfirmed_check_the_original")); changed = true;
  }
  if (enforceWakeLimit(task, settings.maxWakeSends)) changed = true;
  if (enforceCompletionLimit(task)) changed=true;
  return changed;
}

function validate(task) {
  if ((task.quotaMonitoring !== undefined && typeof task.quotaMonitoring !== 'boolean')
    || (task.completionRepeat !== undefined && typeof task.completionRepeat !== 'boolean')
    || (task.completionMaxSends !== undefined && (!Number.isSafeInteger(task.completionMaxSends) || task.completionMaxSends < 1 || task.completionMaxSends > 100))
    || (task.completionSends !== undefined && (!Number.isSafeInteger(task.completionSends) || task.completionSends < 0))) throw new MessageError(textMessage('error.completion_send_limit'));
  if (!MONITOR_TASK_STATUSES.includes(task.status)) throw new MessageError(textMessage("error.monitor_state"));
  if ((task.sentCount !== undefined && (!Number.isSafeInteger(task.sentCount) || task.sentCount < 0))
    || (task.rounds !== undefined && (!Number.isSafeInteger(task.rounds) || task.rounds < 0))) throw new MessageError(textMessage("error.monitor_count"));
  if ((task.completionMonitoring !== undefined && typeof task.completionMonitoring !== 'boolean')
    || (task.completionMessage !== undefined && (typeof task.completionMessage !== 'string' || task.completionMessage.length > 12000))) throw new MessageError(textMessage('error.task_fields'));
  const completion = task.completion;
  if (completion !== undefined && (!completion || typeof completion !== 'object' || Array.isArray(completion)
    || !['idle', 'sending', 'sent', 'uncertain'].includes(completion.delivery)
    || (completion.turnId !== undefined && (typeof completion.turnId !== 'string' || !completion.turnId))
    || (completion.lastTurnId !== undefined && (typeof completion.lastTurnId !== 'string' || !completion.lastTurnId))
    || (completion.delivery !== 'idle' && !completion.turnId))) throw new MessageError(textMessage('error.monitor_delivery'));
  // Old records may contain direct fields; prepare migrates their note/count
  // before removing them. Delivery evidence is checked without inventing it.
  if (task.wake === undefined) return;
  const wake = task.wake;
  if (!wake || typeof wake !== 'object' || Array.isArray(wake) || typeof wake.armed !== 'boolean'
    || !['idle', 'pending', 'sending', 'sent', 'uncertain'].includes(wake.delivery)
    || (['pending', 'sending'].includes(wake.delivery) && wake.armed !== true)
    || (['idle', 'sent'].includes(wake.delivery) && wake.armed !== false)
    || (wake.episodeId !== undefined && (typeof wake.episodeId !== 'string' || !wake.episodeId))
    || (wake.exhaustedAt !== undefined && (!Number.isFinite(wake.exhaustedAt) || wake.exhaustedAt <= 0))) throw new MessageError(textMessage("error.monitor_delivery"));
}

function action(task, action, value, { sending, maxWakeSends }) {
  if (action === 'quota-monitoring' || action === 'completion-monitoring') {
    if (typeof value !== 'boolean') throw new ClientError(textMessage('error.invalid_switch_value'));
    if (value && sending) throw new ClientError(textMessage('error.delivery_is_still_being_confirmed_wait_before_enabling'));
    if (action === 'quota-monitoring') {
      task.quotaMonitoring=value;
      if (!value && task.wake?.delivery === 'pending') {
        task.wake={armed:false,delivery:'idle'};task.waitReason=null;task.retryAt=0;
        if (task.continuous && task.status==='waiting') task.status='monitoring';
      }
    } else {
      if (value && !task.completionMonitoring) task.completionSends=0;
      task.completionMonitoring=value;
    }
    pauseUnusedMonitor(task);task.updatedAt=Date.now();return {kind:'changed'};
  }
  if (action === 'completion') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ClientError(textMessage('error.invalid_switch_value'));
    validateCompletionInput(value.enabled, value.message, value);
    if (sending) throw new ClientError(textMessage('error.delivery_is_still_being_confirmed_wait_before_enabling'));
    if (value.enabled && !task.completionMonitoring) task.completionSends=0;
    task.completionMonitoring = value.enabled; task.completionMessage = value.message.trim(); task.updatedAt = Date.now();
    if (value.repeat !== undefined) task.completionRepeat=value.repeat;
    if (value.maxSends !== undefined) task.completionMaxSends=value.maxSends;
    if (value.quotaMonitoring !== undefined) task.quotaMonitoring=value.quotaMonitoring;
    if (task.quotaMonitoring === false && task.wake?.delivery === 'pending') {
      task.wake={armed:false,delivery:'idle'};task.waitReason=null;task.retryAt=0;
      if (task.continuous && task.status==='waiting') task.status='monitoring';
    }
    enforceCompletionLimit(task);pauseUnusedMonitor(task);
    return { kind: 'changed', logMessage: textMessage('log.completion_settings_updated') };
  }
  if (action === 'message') {
    if (typeof value !== 'string' || value.length > 12000) throw new ClientError(textMessage("error.continuation_messages_must_be_text_of_up_to"));
    task.continuationMessage = value.trim(); task.updatedAt = Date.now();
    return { kind: 'changed', logMessage: textMessage("log.continuation_message_updated") };
  }
  if ((sending || task.wake?.delivery === 'uncertain' || task.completion?.delivery === 'uncertain') && (action === 'pause' || (action === 'continuous' && value === false))) {
    task.continuous = false; task.status = 'paused'; task.waitReason = null; task.retryAt = 0;
    setActivity(task, textMessage("task.monitoring_paused_delivery_is_still_unconfirmed_check_the"));
    return { kind: 'changed' };
  }
  if (sending) throw new ClientError(textMessage("error.delivery_is_still_being_confirmed_wait_before_enabling"));
  if ((action === 'resume' || (action === 'continuous' && value === true)) && task.quotaMonitoring === false && !task.completionMonitoring) throw new ClientError(textMessage('error.choose_monitor'));
  if ((action === 'resume' || (action === 'continuous' && value === true)) && (task.sentCount || 0) >= maxWakeSends) throw new ClientError(textMessage("error.message_limit_reached_raise_the_limit_then_enable"));
  if (action === 'continuous') {
    if (typeof value !== 'boolean') throw new ClientError(textMessage("error.invalid_switch_value"));
    if (task.continuous !== value) { task.continuous = value; resetWake(task); }
  } else if (action === 'pause') { task.continuous = false; resetWake(task); }
  else if (action === 'resume') { task.continuous = true; resetWake(task); }
  else if (action === 'complete') {
    task.continuous = false; task.status = 'completed';
    return { kind: 'changed', logMessage: textMessage("log.monitoring_ended_check_results_in_the_original_chat", { name: task.name }) };
  } else throw new ClientError(textMessage("error.unsupported_action"));
  return { kind: 'changed', activate: action === 'resume' || (action === 'continuous' && value === true) };
}

function restoreBackup(task) {
  task.continuous = false; task.status = 'blocked';
  setActivity(task, textMessage("task.backup_restored_check_the_original_chats_and_projects"));
  if (task.completion?.delivery === 'sending') task.completion.delivery = 'uncertain';
  if (task.wake?.armed || task.wake?.delivery === 'sending') task.wake.delivery = 'uncertain';
}

function retryStorage(task) {
  if (task.completion?.delivery === 'sending') task.completion.delivery = 'uncertain';
  else if (task.wake?.delivery === 'sending') task.wake.delivery = 'uncertain';
  else return;
  task.status = 'blocked'; task.waitReason = null; task.retryAt = 0; setActivity(task, textMessage("task.the_delivery_record_could_not_be_saved_check"));
}

export const monitorTaskModel = Object.freeze({ prepare, validate, action, restoreBackup, retryStorage });
