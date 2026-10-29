import { setActivity } from '../public/message.js';
import { MAX_POLL_SECONDS } from './policy.js';
import { taskModel } from './task-model.js';
import { migrateLegacyWriter } from './monitor-task.js';

export { ACTIVE_TURN_STATUSES, waitForThread } from './direct-task.js';

export function initialState(enabled = true) {
  return { settings: { enabled, language: 'zh', pollSeconds: 30, minimumRemaining: 5, maxRounds: 20, maxWakeSends: 20 }, tasks: [], logs: [], history: [] };
}

export function removeCompletedTasks(state) {
  const ids = new Set(state.tasks.filter(task => task.status === 'completed').map(task => task.id));
  if (ids.size) state.tasks = state.tasks.filter(task => !ids.has(task.id));
  return ids;
}

// Startup transformations only touch persisted data; they never contact Codex.
export function prepareState(state) {
  let migrated = removeCompletedTasks(state).size > 0;
  if (state.logs.length > 300) { state.logs = state.logs.slice(0, 300); migrated = true; }
  if (state.history.length > 240) { state.history = state.history.slice(-240); migrated = true; }
  for (const entry of state.logs) if (typeof entry.message === 'string' && entry.message.length > 2600) { entry.message = entry.message.slice(0, 2600); migrated = true; }
  const settings = state.settings;
  const pollSeconds = Number.isInteger(settings.pollSeconds) ? Math.max(10, Math.min(MAX_POLL_SECONDS, settings.pollSeconds)) : 30;
  if (settings.pollSeconds !== pollSeconds) { settings.pollSeconds = pollSeconds; migrated = true; }
  if (!Number.isInteger(settings.maxWakeSends) || settings.maxWakeSends < 1 || settings.maxWakeSends > 100) {
    settings.maxWakeSends = Number.isInteger(settings.maxRounds) ? Math.max(1, Math.min(100, settings.maxRounds)) : 20;
    migrated = true;
  }
  for (const task of state.tasks) {
    if (task.continuous === undefined) { task.continuous = false; migrated = true; }
    if (typeof task.activity === 'string' && task.activity.length > 2400) { setActivity(task, task.activity.slice(0, 2400)); migrated = true; }
    if (migrateLegacyWriter(task)) migrated = true;
    if (taskModel(task).prepare(task, settings)) migrated = true;
  }
  return migrated;
}

export function prepareBackup(state) {
  prepareState(state);
  state.settings.enabled = false;
  for (const task of state.tasks) taskModel(task).restoreBackup(task);
}

export function prepareStorageRetry(state) {
  for (const task of state.tasks) taskModel(task).retryStorage(task);
  state.settings.enabled = false;
}
