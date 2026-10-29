import { boundedMessage, isMessage, messageText, messageFields, setActivity, message as textMessage } from '../public/message.js';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ClientError } from './http-policy.js';
import { quotaAvailable, progress, buckets, MAX_POLL_SECONDS } from './policy.js';
import { tickQuotaWake } from './quota-wake.js';
import { removeCompletedTasks } from './state-lifecycle.js';
import { createDirectTask, isActiveDirectTask, isRunnableDirectTask } from './direct-task.js';
import { createMonitorTask, validateMonitorInput, isMonitorTask, enforceWakeLimit } from './monitor-task.js';
import { taskModel } from './task-model.js';
import { StatePersistence } from './state-persistence.js';
import { TurnController } from './turn-controller.js';
import config from './config.cjs';
import { compactSummary } from './summary.js';

export class Manager extends EventEmitter {
  constructor(rpc, store, { demo = false, wakeSender = null, observeOnly = false } = {}) {
    super();
    this.rpc = rpc;
    this.store = store;
    this.demo = demo;
    this.wakeSender = wakeSender;
    this.wakeQuota = null; this.wakeSampledAt = null;
    this.observationOnly = observeOnly;
    this.scheduleEpoch = 0; this.stopped = false;
    this.wakeExecutions = new Map(); this.detailVersions = new WeakMap();
    this.connection = { status: 'disconnected', ...messageFields(textMessage("connection.connecting_to_local_codex")) };
    this.quota = null;
    this.sampledAt = null;
    this.importingThreads = new Set();
    this.storage = new StatePersistence(store, error => {
      this.scheduleEpoch++;
      this.emit('change'); this.emit('persistence-error', error);
    });
    this.turns = new TurnController(rpc, {
      persistence: this.storage,
      canSchedule: epoch => this.canSchedule(epoch),
      hasExecutionQuota: () => this.hasExecutionQuota(),
      isStopped: () => this.stopped,
      changed: options => this.changed(options),
      log: (...args) => this.log(...args),
      invalidateQuota: () => { this.sampledAt = null; },
      onError: error => this.emit('operation-error', error),
    });
    this.storage.load();
    rpc.on('notification', msg => this.safely(() => this.event(msg)));
    rpc.on('request', msg => this.safely(() => this.request(msg)));
    rpc.on('disconnect', (message, messageInfo) => {
      this.scheduleEpoch++;
      this.connection = { status: 'disconnected', ...messageFields({ message, messageInfo }) };
      this.sampledAt = null;
      this.wakeSampledAt = null;
      this.approvals.clear();
      this.executions.clear();
      for (const t of this.state.tasks) if (isActiveDirectTask(t)) {
        t.status = 'blocked'; setActivity(t, textMessage("task.connection_interrupted_check_the_original_work_before_resuming"));
      }
      this.safely(() => this.changed());
    });
  }
  get state() { return this.storage.state; }
  get persistence() { return this.storage.status; }
  get pendingSave() { return this.storage.pending; }
  get approvals() { return this.turns.approvals; }
  get executions() { return this.turns.executions; }
  snapshot({ details = true } = {}) {
    const snapshot = { ...this.state, ...config.appInfo(), settings: { ...this.state.settings, enabled: this.state.settings.enabled && !this.observationOnly }, observationOnly: this.observationOnly,
      persistence: { ...this.persistence, ...this.store.status?.(), pending: this.pendingSave },
      tasks: this.state.tasks.map(task => this.taskSnapshot(task)), connection: this.connection, quota: this.quota, sampledAt: this.sampledAt, demo: this.demo, approvals: [...this.approvals.values()] };
    return details ? snapshot : compactSummary(snapshot);
  }
  taskSnapshot(id) {
    const task = typeof id === 'object' ? id : this.state.tasks.find(t => t.id === id);
    if (!task) return null;
    const fields = ['name', 'prompt', 'note', 'continuationMessage', 'output', 'outputTruncated', 'plan', 'outcome', 'cwd', 'activity', 'activityMessage', 'toolCount', 'lastError', 'turnId'];
    const values = fields.map(key => task[key]);
    const previous = this.detailVersions.get(task);
    if (!previous || values.some((value, index) => value !== previous.values[index])) this.detailVersions.set(task, { values, revision: (previous?.revision || 0) + 1 });
    return { ...task, progress: isMonitorTask(task) ? null : progress(task.plan), detailRevision: this.detailVersions.get(task).revision };
  }
  canSchedule(epoch = this.scheduleEpoch) {
    return epoch === this.scheduleEpoch && !this.stopped && !this.observationOnly && this.persistence.status === 'ok' && this.state.settings.enabled && this.rpc.ready && this.connection.status === 'connected';
  }
  hasExecutionQuota() {
    return quotaAvailable(this.quota, this.sampledAt, this.state.settings.minimumRemaining)
      && quotaAvailable(this.wakeQuota, this.wakeSampledAt, this.state.settings.minimumRemaining);
  }
  safely(action) {
    try { return action(); } catch (error) { this.emit('operation-error', error); }
  }
  async safelyAsync(action) {
    try { return await action(); } catch (error) { this.emit('operation-error', error); }
  }
  storageFailure(error) { this.storage.fail(error); }
  activate() {
    if (this.persistence.status !== 'ok') throw new ClientError(textMessage("error.data_could_not_be_saved_recover_storage_before"));
    this.observationOnly = false;
  }
  recoverStorage(source = 'retry') {
    if (this.wakeExecutions.size) throw new ClientError(textMessage("error.a_continuation_message_is_still_being_sent_wait"));
    if (source === 'backup') {
      if (this.scheduling || this.executions.size || this.state.tasks.some(isActiveDirectTask)) throw new ClientError(textMessage("error.confirm_current_work_has_stopped_before_restoring_a"));
      this.scheduleEpoch++;
      this.storage.restoreBackup();
      this.approvals.clear();
    } else if (source === 'retry') {
      if (this.persistence.needsRestore) throw new ClientError(textMessage("error.the_main_state_file_is_corrupt_choose_restore"));
      this.scheduleEpoch++;
      this.storage.retry();
    } else throw new ClientError(textMessage("error.invalid_recovery_method"));
    this.emit('change');
  }
  clearCompletedTasks() {
    const completedIds = removeCompletedTasks(this.state);
    for (const [id, request] of this.approvals) if (completedIds.has(request.taskId)) this.approvals.delete(id);
    return completedIds.size > 0;
  }
  changed(options = {}) {
    if (!options.deferSave) this.clearCompletedTasks();
    this.storage.changed(options);
    // Consumers coalesce this invalidation signal and request the latest snapshot.
    this.emit('change');
  }
  flush() { this.storage.flush(); }
  log(value, type = 'info', taskId = null) {
    const info = boundedMessage(isMessage(value) ? value : value?.messageInfo);
    this.state.logs.unshift({ id: randomUUID(), time: Date.now(), message: messageText(value).slice(0, 2600), ...(info ? { messageInfo: info } : {}), type, taskId });
    this.state.logs = this.state.logs.slice(0, 300);
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.rpc.connect();
      const result = await this.rpc.call('account/rateLimits/read');
      this.setQuota(result);
      this.connection = { status: 'connected', ...messageFields(textMessage(this.demo ? 'connection.demo' : 'connection.codex_connected')) };
      this.changed();
    } catch (error) {
      this.sampledAt = null;
      this.wakeSampledAt = null;
      this.connection = { status: 'disconnected', ...messageFields(error), message: String(error.message).slice(0, 2400) };
      this.changed();
    } finally { this.refreshing = false; }
    await this.tick();
  }
  setQuota(result, authoritative = true) {
    this.quota = result;
    this.sampledAt = Date.now();
    if (authoritative) { this.wakeQuota = result; this.wakeSampledAt = this.sampledAt; }
    this.state.history.push({ time: this.sampledAt, values: buckets(result).map(b => ({ id: b.limitId || 'codex', used: b.primary?.usedPercent ?? null })) });
    this.state.history = this.state.history.slice(-240);
  }
  start() {
    this.stopped = false;
    void this.safelyAsync(() => this.refresh());
    this.timer = setInterval(() => {
      if (!this.sampledAt || !this.wakeSampledAt || Date.now() - this.wakeSampledAt >= this.state.settings.pollSeconds * 1000) void this.safelyAsync(() => this.refresh());
      else void this.safelyAsync(() => this.tick());
    }, 1000);
  }
  stop() {
    this.stopped = true; this.scheduleEpoch++;
    clearInterval(this.timer);
    this.executions.clear();
    try { this.flush(); } finally { this.rpc.close(); }
  }
  async shutdown() {
    this.stopped = true; this.scheduleEpoch++;
    clearInterval(this.timer);
    this.state.settings.enabled = false;
    this.safely(() => this.changed());
    await Promise.all(this.state.tasks.filter(isActiveDirectTask).map(t => this.action(t.id, 'pause').catch(() => {})));
    this.executions.clear();
    try { this.flush(); } finally { this.rpc.close(); }
  }
  async tick() {
    if (this.scheduling || !this.canSchedule()) return;
    const epoch = this.scheduleEpoch;
    this.scheduling = true;
    try {
      await tickQuotaWake(this, epoch);
      if (!this.canSchedule(epoch)) return;
      if (this.state.tasks.some(isActiveDirectTask)) return;
      const task = this.state.tasks.find(task => isRunnableDirectTask(task));
      if (!task) return;
      if (!this.hasExecutionQuota()) {
        if (task.status !== 'waiting' || task.waitReason !== 'quota') { task.status = 'waiting'; task.waitReason='quota'; setActivity(task, textMessage("task.quota_is_low_or_unknown_waiting_for_fresh")); this.changed(); }
        return;
      }
      await this.run(task, epoch);
    } finally { this.scheduling = false; }
  }
  run(task, epoch = this.scheduleEpoch) { return this.turns.run(task, epoch); }
  event({ method, params: p = {} }) {
    if (method === 'account/rateLimits/updated') {
      const merged = p.rateLimitsByLimitId ? p : p.rateLimits?.limitId && this.quota?.rateLimitsByLimitId
        ? { ...p, rateLimitsByLimitId: { ...this.quota.rateLimitsByLimitId, [p.rateLimits.limitId]: p.rateLimits } } : p;
      // Partial events must not freshen other buckets: the polling sample stays authoritative.
      const previousSample = this.sampledAt;
      this.setQuota(merged, false);
      this.wakeSampledAt = null;
      if (merged !== p && Object.keys(merged.rateLimitsByLimitId).length > 1) this.sampledAt = previousSample;
      this.changed(); return;
    }
    this.turns.event({ method, params: p });
  }
  request(message) { return this.turns.request(message); }
  approve(id, decision, token) { return this.turns.approve(id, decision, token); }
  create(input) {
    if (this.state.tasks.length >= 100) throw new ClientError(textMessage("error.up_to_records_are_supported_end_unused_work"));
    const task = createDirectTask(input, { demo: this.demo });
    this.state.tasks.unshift(task); this.log(textMessage("log.work_added", { name: task.name })); this.changed(); this.activate(); return task;
  }
  async action(id, action, value) {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task) throw new ClientError(textMessage("error.work_item_not_found"));
    const transition = taskModel(task).action(task, action, value, {
      sending: this.wakeExecutions.has(task.id), maxWakeSends: this.state.settings.maxWakeSends,
    });
    if (transition.logMessage) this.log(transition.logMessage, 'info', task.id);
    if (transition.kind === 'pause-turn') {
      this.turns.cancelApprovals(task);
      this.safely(() => this.changed());
      if (transition.interrupt) await this.turns.interruptTask(task);
      return;
    }
    this.changed();
    if (transition.activate) this.activate();
  }
  updateSettings(input) {
    const s = this.state.settings;
    if (input.language !== undefined && !['zh', 'en'].includes(input.language)) throw new ClientError('Invalid language: use zh or en');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new ClientError(textMessage("error.invalid_switch_value"));
    for (const [key, min, max] of [['pollSeconds', 10, MAX_POLL_SECONDS], ['minimumRemaining', 1, 99], ['maxRounds', 1, 100], ['maxWakeSends', 1, 100]]) {
      if (input[key] !== undefined) { if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new ClientError(textMessage("error.setting_range", { name: key, min: min, max: max })); }
    }
    for (const key of ['pollSeconds', 'minimumRemaining', 'maxRounds', 'maxWakeSends']) if (input[key] !== undefined) s[key] = input[key];
    if (input.enabled !== undefined) s.enabled = input.enabled;
    if (input.language !== undefined) s.language = input.language;
    if (input.enabled === false) this.scheduleEpoch++;
    for (const task of this.state.tasks) if (isMonitorTask(task)) enforceWakeLimit(task, s.maxWakeSends);
    this.log(textMessage("log.scheduling_settings_updated")); this.changed();
    if (input.enabled === true) this.activate();
  }
  async listThreads(cursor = null) { await this.rpc.connect?.(); return this.rpc.call('thread/list', { limit: 30, sortKey: 'updated_at', cursor }); }
  async importThread(id, note = '', continuationMessage = '') {
    if (this.state.tasks.some(t => t.threadId === id)) throw new ClientError(textMessage("error.this_chat_has_already_been_added"));
    if (this.importingThreads.has(id)) throw new ClientError(textMessage("error.this_chat_is_being_added_do_not_import"));
    if (this.state.tasks.length >= 100) throw new ClientError(textMessage("error.up_to_records_are_supported_end_unused_work"));
    validateMonitorInput(note, continuationMessage);
    // Reserve before yielding: HTTP and MCP imports share this manager.
    this.importingThreads.add(id);
    try {
      const { thread } = await this.rpc.call('thread/read', { threadId: id, includeTurns: false });
      // Another task path may have claimed the thread while the read was pending.
      if (this.state.tasks.some(t => t.threadId === id)) throw new ClientError(textMessage("error.this_chat_has_already_been_added"));
      if (this.state.tasks.length >= 100) throw new ClientError(textMessage("error.up_to_records_are_supported_end_unused_work"));
      const task = createMonitorTask(id, thread, note, continuationMessage);
      this.state.tasks.unshift(task); this.log(textMessage("log.chat_added", { name: task.name })); this.changed(); return task;
    } finally { this.importingThreads.delete(id); }
  }
}
