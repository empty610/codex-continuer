import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import config from './config.cjs';

export function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !state.settings || typeof state.settings.enabled !== 'boolean'
    || !['tasks', 'logs', 'history'].every(key => Array.isArray(state[key]))) throw new Error('状态文件结构无效');
  if (state.schemaVersion != null && state.schemaVersion !== config.schemaVersion) throw new Error('状态文件版本不兼容');
  if (!state.logs.every(entry => entry && typeof entry.message === 'string') || !state.history.every(entry => entry && Array.isArray(entry.values))) throw new Error('活动或额度历史格式无效');
  if (!Number.isInteger(state.settings.pollSeconds) || !Number.isInteger(state.settings.maxRounds) || state.settings.maxRounds < 1 || state.settings.maxRounds > 100
    || !Number.isInteger(state.settings.minimumRemaining) || state.settings.minimumRemaining < 1 || state.settings.minimumRemaining > 99) throw new Error('状态文件设置无效');
  if (state.settings.maxWakeSends !== undefined && (!Number.isInteger(state.settings.maxWakeSends) || state.settings.maxWakeSends < 1 || state.settings.maxWakeSends > 100)) throw new Error('状态文件发送上限无效');
  if (state.settings.language !== undefined && !['zh', 'en'].includes(state.settings.language)) throw new Error('Invalid saved language');
  const ids = new Set(), threads = new Set();
  const statuses = ['queued', 'waiting', 'starting', 'running', 'approval', 'pausing', 'paused', 'blocked', 'failed', 'completed', 'monitoring'];
  for (const task of state.tasks) {
    if (!task || typeof task.id !== 'string' || !statuses.includes(task.status) || ids.has(task.id)) throw new Error('任务记录无效或 ID 重复');
    ids.add(task.id);
    if ((task.continuous !== undefined && typeof task.continuous !== 'boolean')
      || (task.rounds !== undefined && (!Number.isSafeInteger(task.rounds) || task.rounds < 0))
      || (task.sentCount !== undefined && (!Number.isSafeInteger(task.sentCount) || task.sentCount < 0))
      || (task.mode !== undefined && !['direct', 'quota-wake'].includes(task.mode))) throw new Error('任务模式、开关或次数无效');
    if (task.wake !== undefined) {
      const wake = task.wake;
      if (!wake || typeof wake !== 'object' || Array.isArray(wake) || typeof wake.armed !== 'boolean'
        || !['idle', 'pending', 'sending', 'sent', 'uncertain'].includes(wake.delivery)
        || (['pending', 'sending'].includes(wake.delivery) && wake.armed !== true)
        || (['idle', 'sent'].includes(wake.delivery) && wake.armed !== false)
        || (wake.episodeId !== undefined && (typeof wake.episodeId !== 'string' || !wake.episodeId))
        || (wake.exhaustedAt !== undefined && (!Number.isFinite(wake.exhaustedAt) || wake.exhaustedAt <= 0))) throw new Error('额度监测发送状态无效');
    }
    if ((task.prompt != null && (typeof task.prompt !== 'string' || task.prompt.length > 12000)) || (task.note != null && (typeof task.note !== 'string' || task.note.length > 12000))
      || (task.continuationMessage !== undefined && (typeof task.continuationMessage !== 'string' || task.continuationMessage.length > 12000))
      || (task.output != null && typeof task.output !== 'string') || (task.plan != null && (!Array.isArray(task.plan) || !task.plan.every(step => step && typeof step.step === 'string')))) throw new Error('任务目标、备注、续作消息或输出字段无效');
    if (task.threadId && task.status !== 'completed') {
      if (typeof task.threadId !== 'string' || threads.has(task.threadId)) throw new Error('状态中存在重复会话，请检查备份后恢复');
      threads.add(task.threadId);
    }
  }
  return state;
}
function readState(file) {
  if (statSync(file).size > 64 * 1024 * 1024) throw new Error('状态文件超过 64 MiB，请检查后恢复备份');
  return readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
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
        if (existsSync(this.file + '.bak')) throw new Error('主状态文件缺失，但存在备份，请明确恢复');
        return null;
      }
      const value = validateState(JSON.parse(readState(this.file)));
      this.loadError = null; return value;
    } catch (error) { this.loadError = error; throw error; }
  }
  save(state) {
    if (this.loadError) throw new Error(`状态未恢复，禁止覆盖原文件：${this.loadError.message}`);
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
