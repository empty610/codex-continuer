import { MessageError, activityFields, setActivity, message as textMessage } from '../public/message.js';
import { randomUUID } from 'node:crypto';
import { ClientError } from './http-policy.js';
import { isWriterConflict } from './policy.js';

/**
 * @typedef {object} MonitorTask
 * @property {'quota-wake'} mode
 * @property {string} note Local note; never an execution goal.
 * @property {string} continuationMessage Message for future recovery deliveries.
 * @property {number} sentCount Confirmed queue deliveries; resume never resets it.
 * @property {boolean} continuous Whether quota monitoring is enabled.
 * @property {object} wake The recovery episode and delivery claim.
 * @property {string} status A member of MONITOR_TASK_STATUSES.
 */
export const MONITOR_TASK_STATUSES = Object.freeze(['monitoring', 'waiting', 'paused', 'blocked', 'completed']);
export const isMonitorTask = task => task?.mode === 'quota-wake';
export const isEnabledMonitorTask = task => isMonitorTask(task) && task.continuous === true && ['monitoring', 'waiting'].includes(task.status);
const executionFields = ['prompt', 'rounds', 'plan', 'output', 'outputTruncated', 'outcome', 'toolCount', 'turnId', 'lastError'];

export function resetWake(task) {
  task.wake = { armed: false, delivery: 'idle' };
  task.status = task.continuous ? 'monitoring' : 'paused';
  task.waitReason = null; task.retryAt = 0;
  setActivity(task, task.continuous ? textMessage("task.monitoring_quota_a_continuation_message_will_be_sent") : textMessage("task.quota_recovery_monitoring_paused"));
}

export function enforceWakeLimit(task, limit) {
  if ((task.sentCount || 0) < limit) return false;
  task.continuous = false;
  if (task.wake?.delivery !== 'uncertain') {
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

export function createMonitorTask(threadId, thread, note = '', continuationMessage = '') {
  validateMonitorInput(note, continuationMessage);
  const now = Date.now();
  return { id: randomUUID(), mode: 'quota-wake', threadId, name: (thread.name || thread.preview || 'Codex 会话').slice(0, 80), cwd: thread.cwd, note: note.trim(), continuationMessage: continuationMessage.trim(), continuous: false, status: 'paused', ...activityFields(textMessage("task.chat_added_enable_monitoring_to_send_a_message")), sentCount: 0, wake: { armed: false, delivery: 'idle' }, createdAt: now, updatedAt: now };
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
  if (!task.wake) { task.wake = { armed: false, delivery: 'idle' }; changed = true; }
  if (task.wake.delivery === 'pending' && (!task.wake.episodeId || !Number.isFinite(task.wake.exhaustedAt))) {
    task.wake.delivery = 'uncertain'; task.continuous = false; task.status = 'blocked';
    setActivity(task, textMessage("task.this_legacy_record_lacks_proof_of_quota_exhaustion")); changed = true;
  }
  if (typeof task.note !== 'string') { task.note = task.prompt || ''; changed = true; }
  if (!Number.isInteger(task.sentCount) || task.sentCount < 0) { task.sentCount = Math.max(0, Number.isInteger(task.rounds) ? task.rounds : 0); changed = true; }
  for (const key of executionFields) if (key in task) { delete task[key]; changed = true; }
  if (task.wake.delivery === 'sending') {
    task.wake.delivery = 'uncertain'; task.status = 'blocked'; setActivity(task, textMessage("task.the_previous_delivery_is_unconfirmed_check_the_original")); changed = true;
  }
  if (enforceWakeLimit(task, settings.maxWakeSends)) changed = true;
  return changed;
}

function validate(task) {
  if (!MONITOR_TASK_STATUSES.includes(task.status)) throw new MessageError(textMessage("error.monitor_state"));
  if ((task.sentCount !== undefined && (!Number.isSafeInteger(task.sentCount) || task.sentCount < 0))
    || (task.rounds !== undefined && (!Number.isSafeInteger(task.rounds) || task.rounds < 0))) throw new MessageError(textMessage("error.monitor_count"));
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
  if (action === 'message') {
    if (typeof value !== 'string' || value.length > 12000) throw new ClientError(textMessage("error.continuation_messages_must_be_text_of_up_to"));
    task.continuationMessage = value.trim(); task.updatedAt = Date.now();
    return { kind: 'changed', logMessage: textMessage("log.continuation_message_updated") };
  }
  if ((sending || task.wake?.delivery === 'uncertain') && (action === 'pause' || (action === 'continuous' && value === false))) {
    task.continuous = false; task.status = 'paused'; task.waitReason = null; task.retryAt = 0;
    setActivity(task, textMessage("task.monitoring_paused_delivery_is_still_unconfirmed_check_the"));
    return { kind: 'changed' };
  }
  if (sending) throw new ClientError(textMessage("error.delivery_is_still_being_confirmed_wait_before_enabling"));
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
  if (task.wake?.armed || task.wake?.delivery === 'sending') task.wake.delivery = 'uncertain';
}

function retryStorage(task) {
  if (task.wake?.delivery !== 'sending') return;
  task.wake.delivery = 'uncertain'; task.status = 'blocked'; setActivity(task, textMessage("task.the_delivery_record_could_not_be_saved_check"));
}

export const monitorTaskModel = Object.freeze({ prepare, validate, action, restoreBackup, retryStorage });
