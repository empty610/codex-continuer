import { MessageError, message as textMessage } from '../public/message.js';
import { directTaskModel, isDirectTask } from './direct-task.js';
import { monitorTaskModel, isMonitorTask } from './monitor-task.js';

/** @typedef {import('./direct-task.js').DirectTask | import('./monitor-task.js').MonitorTask} Task */

// Omitted mode is accepted only for compatibility with persisted direct tasks.
// Startup resolves the legacy writer migration before assigning an explicit mode.
export function taskModel(task) {
  if (isMonitorTask(task)) return monitorTaskModel;
  if (isDirectTask(task)) return directTaskModel;
  throw new MessageError(textMessage("error.task_mode"));
}

export function validateTask(task) {
  if (!task || typeof task.id !== 'string') throw new MessageError(textMessage("error.task_record"));
  if (task.continuous !== undefined && typeof task.continuous !== 'boolean') throw new MessageError(textMessage("error.task_switch"));
  if ((task.prompt != null && (typeof task.prompt !== 'string' || task.prompt.length > 12000)) || (task.note != null && (typeof task.note !== 'string' || task.note.length > 12000))
    || (task.continuationMessage !== undefined && (typeof task.continuationMessage !== 'string' || task.continuationMessage.length > 12000))
    || (task.output != null && typeof task.output !== 'string') || (task.plan != null && (!Array.isArray(task.plan) || !task.plan.every(step => step && typeof step.step === 'string')))) throw new MessageError(textMessage("error.task_fields"));
  taskModel(task).validate(task);
}
