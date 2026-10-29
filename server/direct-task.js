import { MessageError, activityFields, setActivity, message as textMessage } from '../public/message.js';
import { randomUUID } from 'node:crypto';
import { ClientError } from './http-policy.js';
import { checkedProjectPath } from './project-path.js';
import { isWriterConflict, parseOutcome } from './policy.js';
import { OUTPUT_LIMIT, retainOutput, outcomeSummary } from './output.js';

/**
 * @typedef {object} DirectTask
 * @property {'direct'} mode
 * @property {string} prompt Original goal; never a monitoring note.
 * @property {number} rounds Execution rounds; manual resume resets this counter.
 * @property {boolean} continuous Whether another round may be scheduled.
 * @property {string} status A member of DIRECT_TASK_STATUSES.
 */
export const DIRECT_TASK_STATUSES = Object.freeze(['queued', 'waiting', 'starting', 'running', 'approval', 'pausing', 'paused', 'blocked', 'failed', 'completed']);
export const ACTIVE_TURN_STATUSES = Object.freeze(['running', 'approval', 'pausing']);
const inFlight = ['starting', ...ACTIVE_TURN_STATUSES];
export const isDirectTask = task => task?.mode === 'direct' || (task != null && task.mode === undefined);
export const isActiveDirectTask = task => isDirectTask(task) && inFlight.includes(task.status);
export const isRunnableDirectTask = (task, now = Date.now()) => isDirectTask(task)
  && (task.status === 'queued' || (task.status === 'waiting' && task.continuous)) && (!task.retryAt || now >= task.retryAt);

export function createDirectTask(input, { demo = false } = {}) {
  for (const key of ['name', 'cwd', 'prompt']) if (typeof input[key] !== 'string' || !input[key].trim()) throw new ClientError(textMessage("error.enter_a_name_project_directory_and_work_goal"));
  if (input.name.length > 120 || input.prompt.length > 12000) throw new ClientError(textMessage("error.name_or_goal_is_too_long"));
  const cwd = checkedProjectPath(input.cwd, { demo }), now = Date.now();
  return { id: randomUUID(), mode: 'direct', name: input.name.trim(), cwd, prompt: input.prompt.trim(), threadId: null, continuous: input.continuous === true, status: 'queued', ...activityFields(textMessage("task.waiting_for_scheduling")), rounds: 0, plan: [], output: '', createdAt: now, updatedAt: now };
}

export function waitForThread(task, reason) {
  task.status = task.continuous ? 'waiting' : 'blocked';
  task.waitReason = task.continuous ? reason : null;
  task.retryAt = task.continuous ? Date.now() + 30000 : 0;
  const id = reason === 'writer' ? (task.continuous ? 'task.wait_writer_retry' : 'task.wait_writer_manual')
    : (task.continuous ? 'task.wait_thread_retry' : 'task.wait_thread_manual');
  setActivity(task, textMessage(id));
}

function prepare(task) {
  let changed = false;
  if (task.mode === undefined) { task.mode = 'direct'; changed = true; }
  if (task.rounds === undefined) { task.rounds = 0; changed = true; }
  if (task.plan?.length > 100) { task.plan = task.plan.slice(0, 100); changed = true; }
  for (const step of task.plan || []) if (typeof step.step === 'string' && step.step.length > 2000) { step.step = outcomeSummary(step.step); changed = true; }
  if (typeof task.output === 'string' && task.output.length > OUTPUT_LIMIT) {
    task.outcome = parseOutcome(task.output); retainOutput(task, task.output); changed = true;
  }
  if (task.status === 'blocked' && task.continuous && isWriterConflict({ message: task.activity })) {
    task.lastError = task.activity; waitForThread(task, 'writer'); changed = true;
  }
  if (isActiveDirectTask(task)) {
    task.status = 'blocked'; setActivity(task, textMessage("task.service_restarted_confirm_the_original_chat_has_stopped")); changed = true;
  }
  return changed;
}

function validate(task) {
  if (!DIRECT_TASK_STATUSES.includes(task.status)) throw new MessageError(textMessage("error.direct_state"));
  if (task.rounds !== undefined && (!Number.isSafeInteger(task.rounds) || task.rounds < 0)) throw new MessageError(textMessage("error.direct_rounds"));
  if (task.wake !== undefined || task.sentCount !== undefined || task.continuationMessage !== undefined) throw new MessageError(textMessage("error.direct_monitor_fields"));
}

function action(task, action, value) {
  if (action === 'continuous') {
    if (typeof value !== 'boolean') throw new ClientError(textMessage("error.invalid_switch_value"));
    task.continuous = value;
    if (!value && ['waiting', 'queued'].includes(task.status)) { task.status = 'paused'; setActivity(task, textMessage("task.continuous_work_disabled")); }
    if (value && task.status === 'blocked' && isWriterConflict({ message: task.activity })) waitForThread(task, 'writer');
  } else if (action === 'pause') {
    const active = ACTIVE_TURN_STATUSES.includes(task.status);
    task.status = active ? 'pausing' : 'paused'; setActivity(task, active ? textMessage("task.pausing") : textMessage("task.work_paused"));
    task.waitReason = null; task.retryAt = 0;
    return { kind: 'pause-turn', interrupt: active && !!task.turnId };
  } else if (action === 'resume') {
    if (isActiveDirectTask(task)) throw new ClientError(textMessage("error.work_is_still_running_or_stopping"));
    task.status = 'queued'; task.rounds = 0; task.retryAt = 0; setActivity(task, textMessage("task.waiting_for_available_quota"));
  } else if (action === 'complete') {
    if (isActiveDirectTask(task)) throw new ClientError(textMessage("error.pause_the_work_first"));
    task.status = 'completed'; setActivity(task, textMessage("task.user_marked_complete"));
  } else throw new ClientError(textMessage("error.unsupported_action"));
  if (task.status !== 'waiting') { task.waitReason = null; if (task.status === 'paused') task.retryAt = 0; }
  return { kind: 'changed', activate: action === 'resume' || (action === 'continuous' && value === true) };
}

function restoreBackup(task) {
  task.continuous = false; task.status = 'blocked'; task.turnId = null;
  setActivity(task, textMessage("task.backup_restored_check_the_original_chats_and_projects"));
}

export const directTaskModel = Object.freeze({ prepare, validate, action, restoreBackup, retryStorage() {} });
