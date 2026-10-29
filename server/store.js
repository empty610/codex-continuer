import { MessageError, message as textMessage } from '../public/message.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, openSync, closeSync, fstatSync } from 'node:fs';
import { dirname } from 'node:path';
import config from './config.cjs';
import { validateTask } from './task-model.js';

export function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !state.settings || typeof state.settings.enabled !== 'boolean'
    || !['tasks', 'logs', 'history'].every(key => Array.isArray(state[key]))) throw new MessageError(textMessage("error.storage_shape"));
  if (state.schemaVersion != null && state.schemaVersion !== config.schemaVersion) throw new MessageError(textMessage("error.storage_version"));
  if (!state.logs.every(entry => entry && typeof entry.message === 'string') || !state.history.every(entry => entry && Array.isArray(entry.values))) throw new MessageError(textMessage("error.storage_history"));
  if (!Number.isInteger(state.settings.pollSeconds) || !Number.isInteger(state.settings.maxRounds) || state.settings.maxRounds < 1 || state.settings.maxRounds > 100
    || !Number.isInteger(state.settings.minimumRemaining) || state.settings.minimumRemaining < 1 || state.settings.minimumRemaining > 99) throw new MessageError(textMessage("error.storage_settings"));
  if (state.settings.maxWakeSends !== undefined && (!Number.isInteger(state.settings.maxWakeSends) || state.settings.maxWakeSends < 1 || state.settings.maxWakeSends > 100)) throw new MessageError(textMessage("error.storage_send_limit"));
  if (state.settings.language !== undefined && !['zh', 'en'].includes(state.settings.language)) throw new Error('Invalid saved language');
  const ids = new Set(), threads = new Set();
  for (const task of state.tasks) {
    validateTask(task);
    if (ids.has(task.id)) throw new MessageError(textMessage("error.task_duplicate"));
    ids.add(task.id);
    if (task.threadId && task.status !== 'completed') {
      if (typeof task.threadId !== 'string' || threads.has(task.threadId)) throw new MessageError(textMessage("error.thread_duplicate"));
      threads.add(task.threadId);
    }
  }
  return state;
}
function readState(file) {
  const descriptor = openSync(file, 'r');
  try {
    if (fstatSync(descriptor).size > 64 * 1024 * 1024) throw new MessageError(textMessage("error.storage_size"));
    return readFileSync(descriptor, 'utf8').replace(/^\uFEFF/, '');
  } finally { closeSync(descriptor); }
}
function removeArchivedTasks(file, removedIds) {
  if (!existsSync(file)) return;
  let archived;
  try { archived = validateState(JSON.parse(readState(file))); }
  catch (error) {
    if (error.code) throw error;
    // A damaged recovery snapshot is diagnostic evidence, not a writable state.
    return;
  }
  const tasks = archived.tasks.filter(task => !removedIds.has(task.id));
  if (tasks.length === archived.tasks.length) return;
  archived.tasks = tasks;
  writeFileSync(file + '.tmp', JSON.stringify(archived, null, 2), { mode: 0o600, flush: true });
  renameSync(file + '.tmp', file);
}

export class Store {
  constructor(file) { this.file = file; this.loadError = null; }
  load() {
    try {
      if (!existsSync(this.file)) {
        if (existsSync(this.file + '.bak')) throw new MessageError(textMessage("error.storage_missing"));
        return null;
      }
      const value = validateState(JSON.parse(readState(this.file)));
      this.loadError = null; return value;
    } catch (error) { this.loadError = error; throw error; }
  }
  save(state) {
    if (this.loadError) throw new MessageError(textMessage("error.storage_unrecovered", { reason: this.loadError.messageInfo || this.loadError.message }));
    validateState(state); state.schemaVersion = config.schemaVersion;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600, flush: true });
    if (existsSync(this.file)) {
      const previous = validateState(JSON.parse(readState(this.file)));
      const remainingIds = new Set(state.tasks.map(task => task.id));
      const removedIds = new Set(previous.tasks.filter(task => !remainingIds.has(task.id)).map(task => task.id));
      if (removedIds.size) {
        previous.tasks = previous.tasks.filter(task => !removedIds.has(task.id));
        for (const suffix of ['.before-restore', '.restore.tmp']) removeArchivedTasks(this.file + suffix, removedIds);
      }
      // Backups retain prior values for surviving records, never deleted tasks.
      writeFileSync(this.file + '.bak.tmp', JSON.stringify(previous, null, 2), { mode: 0o600, flush: true });
      renameSync(this.file + '.bak.tmp', this.file + '.bak');
    }
    renameSync(this.file + '.tmp', this.file);
  }
  status() { return { backupAvailable: existsSync(this.file + '.bak'), loadError: this.loadError?.message || null }; }
  restoreBackup(transform) {
    const restored = validateState(JSON.parse(readState(this.file + '.bak')));
    transform(restored); validateState(restored); restored.schemaVersion = config.schemaVersion;
    // Preserve the current primary, even if it is damaged. Never restore silently.
    if (existsSync(this.file)) copyFileSync(this.file, this.file + '.before-restore');
    writeFileSync(this.file + '.restore.tmp', JSON.stringify(restored, null, 2), { mode: 0o600, flush: true });
    renameSync(this.file + '.restore.tmp', this.file);
    this.loadError = null; return restored;
  }
}
