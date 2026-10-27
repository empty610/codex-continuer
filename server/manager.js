import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { quotaAvailable, isQuotaError, isWriterConflict, parseOutcome, progress, buckets, MAX_POLL_SECONDS } from './policy.js';
import { resetWake, tickQuotaWake, enforceWakeLimit } from './quota-wake.js';
import { OUTPUT_LIMIT, retainOutput, outcomeSummary } from './output.js';
import config from './config.cjs';
import { compactSummary } from './summary.js';

const outcomeSchema = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'continue', 'blocked'] }, summary: { type: 'string' } }, required: ['status', 'summary'], additionalProperties: false };
const instructions = '\n请维护可验证的步骤计划。仅在原始目标全部完成并验证后返回 status=done；还有可独立推进的工作则返回 continue；需要用户输入或权限则返回 blocked。summary 简述证据或阻塞原因。不要因为额度不足声称完成。';
const OUTPUT_SAVE_INTERVAL_MS = 250;
const TURN_EVENTS = new Set(['turn/started', 'turn/completed', 'turn/plan/updated', 'item/agentMessage/delta', 'item/started', 'item/completed']);
const ACTIVE_TURN_STATUSES = ['running', 'approval', 'pausing'];
const START_EVENT_LIMIT = 256;
const START_EVENT_BYTES = 4 * 1024 * 1024;

export class Manager extends EventEmitter {
  constructor(rpc, store, { demo = false, wakeSender = null, observeOnly = false } = {}) {
    super();
    this.rpc = rpc;
    this.store = store;
    this.demo = demo;
    this.wakeSender = wakeSender;
    this.wakeQuota = null; this.wakeSampledAt = null;
    this.persistence = { status: 'ok', message: null };
    this.observationOnly = observeOnly;
    this.scheduleEpoch = 0; this.stopped = false;
    this.wakeExecutions = new Map(); this.detailVersions = new WeakMap();
    try { this.state = store.load(); }
    catch (error) { this.persistence = { status: 'error', message: error.message, needsRestore: true }; }
    this.state ||= { settings: { enabled: !this.persistence.needsRestore, pollSeconds: 30, minimumRemaining: 5, maxRounds: 20, maxWakeSends: 20 }, tasks: [], logs: [], history: [] };
    this.connection = { status: 'disconnected', message: '正在连接本机 Codex…' };
    this.quota = null;
    this.sampledAt = null;
    this.approvals = new Map();
    this.importingThreads = new Set();
    this.executions = new Map();
    this.pendingSave = false;
    this.saveTimer = null;
    let migrated = this.clearCompletedTasks();
    if (this.state.logs.length > 300) { this.state.logs = this.state.logs.slice(0, 300); migrated = true; }
    if (this.state.history.length > 240) { this.state.history = this.state.history.slice(-240); migrated = true; }
    for (const entry of this.state.logs) if (typeof entry.message === 'string' && entry.message.length > 2600) { entry.message = entry.message.slice(0, 2600); migrated = true; }
    const settings = this.state.settings;
    const pollSeconds = Number.isInteger(settings.pollSeconds) ? Math.max(10, Math.min(MAX_POLL_SECONDS, settings.pollSeconds)) : 30;
    if (settings.pollSeconds !== pollSeconds) { settings.pollSeconds = pollSeconds; migrated = true; }
    if (!Number.isInteger(settings.maxWakeSends) || settings.maxWakeSends < 1 || settings.maxWakeSends > 100) {
      settings.maxWakeSends = Number.isInteger(settings.maxRounds) ? Math.max(1, Math.min(100, settings.maxRounds)) : 20;
      migrated = true;
    }
    for (const task of this.state.tasks) {
      if (task.continuous === undefined) { task.continuous = false; migrated = true; }
      if (task.mode !== 'quota-wake' && task.rounds === undefined) { task.rounds = 0; migrated = true; }
      if (typeof task.activity === 'string' && task.activity.length > 2400) { task.activity = task.activity.slice(0, 2400); migrated = true; }
      if (task.plan?.length > 100) { task.plan = task.plan.slice(0, 100); migrated = true; }
      for (const step of task.plan || []) if (typeof step.step === 'string' && step.step.length > 2000) { step.step = outcomeSummary(step.step); migrated = true; }
      if (typeof task.output === 'string' && task.output.length > OUTPUT_LIMIT) {
        task.outcome = parseOutcome(task.output);
        retainOutput(task, task.output);
        migrated = true;
      }
    }
    for (const task of this.state.tasks) {
      if (!task.mode && ['waiting', 'blocked'].includes(task.status) && task.threadId && task.continuous && (task.waitReason === 'writer' || isWriterConflict({ message: task.activity }))) {
        task.mode = 'quota-wake'; resetWake(task);
        // Legacy writer waits counted direct turns, never queued messages.
        task.sentCount = 0; migrated = true;
      }
      if (task.mode === 'quota-wake') {
        if (!task.wake) { task.wake = { armed: false, delivery: 'idle' }; migrated = true; }
        if (task.wake.delivery === 'pending' && (!task.wake.episodeId || !Number.isFinite(task.wake.exhaustedAt))) {
          task.wake.delivery = 'uncertain'; task.continuous = false; task.status = 'blocked';
          task.activity = '旧监测记录缺少额度耗尽依据，请检查原聊天后重新开启监测'; migrated = true;
        }
        if (typeof task.note !== 'string') { task.note = task.prompt || ''; migrated = true; }
        if (!Number.isInteger(task.sentCount) || task.sentCount < 0) { task.sentCount = Math.max(0, Number.isInteger(task.rounds) ? task.rounds : 0); migrated = true; }
        if ('prompt' in task || 'rounds' in task) { delete task.prompt; delete task.rounds; migrated = true; }
        if (task.wake?.delivery === 'sending') {
          task.wake.delivery = 'uncertain'; task.status = 'blocked'; task.activity = '上次发送结果未确认，请检查原聊天后重新开启监测';
        }
        if (enforceWakeLimit(task, settings.maxWakeSends)) migrated = true;
        continue;
      }
      if (task.status === 'blocked' && task.continuous && isWriterConflict({message:task.activity})) {
        task.lastError=task.activity;
        this.waitForThread(task,'writer');
      }
      if (['running', 'starting', 'approval', 'pausing'].includes(task.status)) {
        task.status = 'blocked';
        task.activity = '服务重启，请确认原会话已停止后手动继续';
      }
    }
    if (migrated) {
      try { this.store.save(this.state); } catch (error) { this.storageFailure(error); }
    }
    rpc.on('notification', msg => this.safely(() => this.event(msg)));
    rpc.on('request', msg => this.safely(() => this.request(msg)));
    rpc.on('disconnect', message => {
      this.scheduleEpoch++;
      this.connection = { status: 'disconnected', message };
      this.sampledAt = null;
      this.wakeSampledAt = null;
      this.approvals.clear();
      this.executions.clear();
      for (const t of this.state.tasks) if (['running', 'starting', 'approval', 'pausing'].includes(t.status)) {
        t.status = 'blocked'; t.activity = '连接中断，请检查原任务后手动继续';
      }
      this.safely(() => this.changed());
    });
  }
  snapshot({ details = true } = {}) {
    const snapshot = { ...this.state, ...config.appInfo(), settings: { ...this.state.settings, enabled: this.state.settings.enabled && !this.observationOnly }, observationOnly: this.observationOnly,
      persistence: { ...this.persistence, ...this.store.status?.(), pending: this.pendingSave },
      tasks: this.state.tasks.map(task => this.taskSnapshot(task)), connection: this.connection, quota: this.quota, sampledAt: this.sampledAt, demo: this.demo, approvals: [...this.approvals.values()] };
    return details ? snapshot : compactSummary(snapshot);
  }
  taskSnapshot(id) {
    const task = typeof id === 'object' ? id : this.state.tasks.find(t => t.id === id);
    if (!task) return null;
    const fields = ['name', 'prompt', 'note', 'output', 'outputTruncated', 'plan', 'outcome', 'cwd', 'activity', 'toolCount', 'lastError', 'turnId'];
    const values = fields.map(key => task[key]);
    const previous = this.detailVersions.get(task);
    if (!previous || values.some((value, index) => value !== previous.values[index])) this.detailVersions.set(task, { values, revision: (previous?.revision || 0) + 1 });
    return { ...task, progress: task.mode === 'quota-wake' ? null : progress(task.plan), detailRevision: this.detailVersions.get(task).revision };
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
  storageFailure(error) {
    this.scheduleEpoch++;
    this.persistence = { ...this.persistence, status: 'error', message: error.message, failedAt: Date.now() };
    this.state.settings.enabled = false;
    this.emit('change'); this.emit('persistence-error', error);
  }
  activate() {
    if (this.persistence.status !== 'ok') throw new Error('数据保存失败，恢复存储后再开启调度');
    this.observationOnly = false;
  }
  recoverStorage(source = 'retry') {
    if (this.wakeExecutions.size) throw new Error('续作消息仍在发送，请等待发送结果确认后再恢复存储');
    if (source === 'backup') {
      if (this.scheduling || this.executions.size || this.state.tasks.some(t => ['starting', ...ACTIVE_TURN_STATUSES].includes(t.status))) throw new Error('请先确认当前工作已停止，再恢复备份');
      this.scheduleEpoch++;
      this.state = this.store.restoreBackup(state => {
        state.settings.enabled = false;
        for (const task of state.tasks) {
          task.continuous = false; task.status = 'blocked'; task.turnId = null;
          task.activity = '已恢复备份，请检查原聊天和项目状态后手动继续';
          if (task.wake?.armed || task.wake?.delivery === 'sending') task.wake.delivery = 'uncertain';
        }
      });
      this.approvals.clear(); this.persistence = { status: 'ok', message: null }; this.pendingSave = false;
      this.emit('change');
    } else if (source === 'retry') {
      if (this.persistence.needsRestore) throw new Error('主状态文件损坏，请明确选择恢复备份');
      this.scheduleEpoch++;
      for (const task of this.state.tasks) if (task.wake?.delivery === 'sending') { task.wake.delivery = 'uncertain'; task.status = 'blocked'; task.activity = '发送记录保存失败，请检查原聊天后手动继续'; }
      this.state.settings.enabled = false; this.pendingSave = true; this.flush(); this.emit('change');
    } else throw new Error('恢复方式无效');
  }
  clearCompletedTasks() {
    const completedIds = new Set(this.state.tasks.filter(t => t.status === 'completed').map(t => t.id));
    if (!completedIds.size) return false;
    this.state.tasks = this.state.tasks.filter(t => !completedIds.has(t.id));
    for (const [id, request] of this.approvals) if (completedIds.has(request.taskId)) this.approvals.delete(id);
    return true;
  }
  changed({ deferSave = false } = {}) {
    if (!deferSave) this.clearCompletedTasks();
    this.pendingSave = true;
    if (deferSave) {
      // One deadline from the first fragment; continuous output cannot postpone it.
      if (!this.saveTimer) this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        try { this.flush(); }
        catch { /* flush recorded the failure; keep the service available. */ }
      }, OUTPUT_SAVE_INTERVAL_MS);
    } else this.flush();
    // Consumers coalesce this invalidation signal and request the latest snapshot.
    this.emit('change');
  }
  flush() {
    clearTimeout(this.saveTimer); this.saveTimer = null;
    if (!this.pendingSave) return;
    try { this.store.save(this.state); }
    catch (error) { this.storageFailure(error); throw error; }
    // Keep the pending flag on failure so a later change/flush can retry.
    this.pendingSave = false;
    this.persistence = { status: 'ok', message: null };
  }
  log(message, type = 'info', taskId = null) {
    this.state.logs.unshift({ id: randomUUID(), time: Date.now(), message: String(message).slice(0, 2600), type, taskId });
    this.state.logs = this.state.logs.slice(0, 300);
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.rpc.connect();
      const result = await this.rpc.call('account/rateLimits/read');
      this.setQuota(result);
      this.connection = { status: 'connected', message: this.demo ? '演示数据 · 不执行真实任务' : 'Codex App Server 已连接' };
      this.changed();
    } catch (error) {
      this.sampledAt = null;
      this.wakeSampledAt = null;
      this.connection = { status: 'disconnected', message: String(error.message).slice(0, 2400) };
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
    await Promise.all(this.state.tasks.filter(t => ['running', 'starting', 'approval', 'pausing'].includes(t.status)).map(t => this.action(t.id, 'pause').catch(() => {})));
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
      if (this.state.tasks.some(t => ['starting', 'running', 'approval', 'pausing'].includes(t.status))) return;
      const task = this.state.tasks.find(t => t.mode !== 'quota-wake' && (t.status === 'queued' || (t.status === 'waiting' && t.continuous)) && (!t.retryAt || Date.now() >= t.retryAt));
      if (!task) return;
      if (!this.hasExecutionQuota()) {
        if (task.status !== 'waiting' || task.waitReason !== 'quota') { task.status = 'waiting'; task.waitReason='quota'; task.activity = '可用额度不足或未知，等待新额度样本'; this.changed(); }
        return;
      }
      await this.run(task, epoch);
    } finally { this.scheduling = false; }
  }
  waitForThread(task,reason) {
    task.status=task.continuous ? 'waiting' : 'blocked';
    task.waitReason=task.continuous ? reason : null;
    task.retryAt=task.continuous ? Date.now()+30000 : 0;
    const message=reason==='writer' ? '原会话被其他 Codex 客户端占用' : '原会话仍在运行';
    task.activity=message+(task.continuous ? '，30 秒后自动重试' : '，请等待原会话结束后再继续');
  }
  async run(task, epoch = this.scheduleEpoch) {
    if (!this.canSchedule(epoch)) return;
    const execution = { pending: false, events: [], bytes: 0, overflow: false };
    this.executions.set(task.id, execution);
    const current = () => this.executions.get(task.id) === execution;
    const previousRounds=task.rounds;
    const permitted = () => {
      if (!current() || task.status !== 'starting') return false;
      if (this.canSchedule(epoch) && this.hasExecutionQuota()) return true;
      task.status = 'queued'; task.activity = '启动已取消，等待有效调度和新鲜额度'; this.changed(); return false;
    };
    try {
      task.turnId = null;
      task.status = 'starting'; task.waitReason=null; task.activity = '正在恢复会话…'; this.changed();
      if (task.rounds >= this.state.settings.maxRounds) {
        task.status = 'blocked'; task.activity = '已达到自动执行轮次上限，请手动继续'; this.changed(); return;
      }
      if (task.threadId) {
        const read = await this.rpc.call('thread/read', { threadId: task.threadId, includeTurns: false });
        if (!permitted()) return;
        if (read.thread.status?.type === 'active') { this.waitForThread(task,'thread'); this.changed(); return; }
        await this.rpc.call('thread/resume', { threadId: task.threadId, cwd: task.cwd, excludeTurns: true, approvalPolicy: 'on-request', sandbox: 'workspace-write' });
      } else {
        const result = await this.rpc.call('thread/start', { cwd: task.cwd, approvalPolicy: 'on-request', sandbox: 'workspace-write' });
        if (!current()) return;
        task.threadId = result.thread.id;
      }
      if (!current()) return;
      if (task.status !== 'starting') { this.changed(); return; }
      if (!permitted()) return;
      task.output = ''; task.outputTruncated = false; task.outcome = null;
      task.toolCount = 0; task.rounds++; task.status = 'running'; task.updatedAt = Date.now();
      this.changed();
      execution.pending = true;
      const result = await this.rpc.call('turn/start', {
        threadId: task.threadId,
        input: [{ type: 'text', text: `${task.rounds > 1 ? '继续原目标，先检查已有成果，避免重复操作。\n' : ''}${task.prompt}${instructions}`, text_elements: [] }],
        outputSchema: outcomeSchema,
      });
      if (!current()) return;
      if (typeof result.turn?.id !== 'string' || !result.turn.id) throw new Error('未收到有效的轮次 ID，请检查原会话后手动继续');
      execution.pending = false;
      if (ACTIVE_TURN_STATUSES.includes(task.status)) task.turnId = result.turn.id;
      this.log(`开始工作：${task.name}`, 'success', task.id);
      if (execution.overflow) {
        task.status = 'pausing'; task.activity = '启动期间通知超过缓存上限，正在中断，请检查原会话后手动继续';
        this.log(`${task.name}：${task.activity}`, 'warning', task.id);
      }
      const events = execution.events; execution.events = []; execution.bytes = 0;
      for (const event of events) event.request ? this.request(event.message) : this.event(event.message);
      this.changed();
      if (task.status === 'pausing' && task.turnId === result.turn.id) {
        try { await this.rpc.call('turn/interrupt', { threadId: task.threadId, turnId: task.turnId }); }
        catch (error) {
          if (!current() || task.status !== 'pausing' || task.turnId !== result.turn.id) return;
          task.status = 'blocked'; task.activity = `未确认中断：${error.message}`;
          this.log(`${task.name}：${task.activity}`, 'warning', task.id); this.changed();
        }
      }
    } catch (error) {
      if (!current()) return;
      if (['paused', 'pausing'].includes(task.status)) task.status = 'paused';
      else if (isWriterConflict(error)) {
        task.rounds=previousRounds; task.turnId=null; task.lastError=error.message;
        this.waitForThread(task,'writer');
      }
      else { task.status = 'blocked'; task.activity = String(error.message).slice(0, 2400); }
      this.log(`${task.name}：${task.activity}`, 'warning', task.id); this.changed();
    } finally {
      if (current()) {
        this.executions.delete(task.id);
        for (const event of execution.events) if (event.request) this.rejectRequest(event.message);
      }
    }
  }
  matchesTurn(task, params) {
    const turnId = params.turnId ?? params.turn?.id;
    return task.mode !== 'quota-wake' && ACTIVE_TURN_STATUSES.includes(task.status)
      && task.threadId === params.threadId && typeof task.turnId === 'string' && !!task.turnId
      && turnId === task.turnId && (params.turnId == null || params.turn?.id == null || params.turnId === params.turn.id);
  }
  rejectRequest(msg) {
    this.rpc.send({ id: msg.id, error: { code: -32601, message: 'This client requires manual handling for this request.' } });
  }
  deferTurnEvent(task, message, request = false) {
    const execution = this.executions.get(task.id);
    if (!execution?.pending) return false;
    // Notifications may precede the turn/start response. Its ID is authoritative.
    const bytes = execution.overflow ? 0 : Buffer.byteLength(JSON.stringify(message));
    if (execution.overflow || execution.events.length >= START_EVENT_LIMIT || execution.bytes + bytes > START_EVENT_BYTES) {
      for (const event of execution.events) if (event.request) this.rejectRequest(event.message);
      execution.events = []; execution.bytes = 0; execution.overflow = true;
      if (request) this.rejectRequest(message);
    } else {
      execution.events.push({ message, request }); execution.bytes += bytes;
    }
    return true;
  }
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
    if (!TURN_EVENTS.has(method)) return;
    const task = this.state.tasks.find(t => t.threadId === p.threadId);
    if (!task) return;
    if (task.mode === 'quota-wake') return;
    if (this.deferTurnEvent(task, { method, params: p })) return;
    if (!this.matchesTurn(task, p)) return;
    if (method === 'turn/completed' && !['completed', 'failed', 'interrupted'].includes(p.turn?.status)) return;
    task.updatedAt = Date.now();
    if (method === 'turn/started') { task.activity = 'Codex 正在处理目标'; }
    else if (method === 'turn/plan/updated') { task.plan = p.plan.slice(0, 100).map(step => ({ ...step, step: outcomeSummary(step.step) })); task.activity = outcomeSummary(p.explanation || task.plan.find(s => s.status === 'inProgress')?.step || '计划已更新'); }
    else if (method === 'item/agentMessage/delta') {
      retainOutput(task, p.delta, true);
      task.outcome = null;
    }
    else if (method === 'item/started') {
      const item = p.item;
      if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch'].includes(item.type)) task.toolCount++;
      task.activity = ({ commandExecution: '正在执行命令', fileChange: '正在修改文件', reasoning: '正在分析', agentMessage: '正在生成回复', mcpToolCall: '正在调用工具' })[item.type] || '正在工作';
    } else if (method === 'item/completed' && p.item.type === 'agentMessage') {
      const text = p.item.text ?? task.output;
      // Parse the complete JSON before retaining only its display tail.
      task.outcome = parseOutcome(text);
      if (p.item.text != null) retainOutput(task, text);
    }
    else if (method === 'turn/completed') {
      for (const [id, request] of this.approvals) if (request.taskId === task.id) this.approvals.delete(id);
      task.turnId = null;
      if (p.turn.status === 'interrupted' || task.status === 'pausing') {
        task.status = 'paused'; task.activity = '工作已暂停';
      } else if (p.turn.status === 'failed') {
        const limited = isQuotaError(p.turn.error);
        task.status = limited && task.continuous ? 'waiting' : 'failed';
        task.waitReason=task.status==='waiting' ? 'quota' : null;
        task.activity = String(p.turn.error?.message || '本轮执行失败').slice(0, 2400);
        task.retryAt = Date.now() + 60000;
        if (limited) this.sampledAt = null;
      } else {
        const outcome = task.outcome || parseOutcome(task.output);
        task.activity = outcome.summary;
        task.status = outcome.status === 'done' ? 'completed' : outcome.status === 'continue' && task.continuous && task.toolCount > 0 ? 'queued' : 'blocked';
        if (outcome.status === 'continue' && task.toolCount === 0) task.activity += '（本轮无工具活动，已停止自动续作）';
        task.retryAt = Date.now() + 5000;
      }
      this.log(`${task.name}：${task.activity}`, task.status === 'completed' ? 'success' : 'info', task.id);
    } else return;
    this.changed({ deferSave: method === 'item/agentMessage/delta' });
  }
  request(msg) {
    const task = this.state.tasks.find(t => t.threadId === msg.params?.threadId);
    if (task && task.mode !== 'quota-wake' && this.deferTurnEvent(task, msg, true)) return;
    if (!task || !this.matchesTurn(task, msg.params || {})) { this.rejectRequest(msg); return; }
    if (task.status === 'pausing') { this.rejectRequest(msg); return; }
    // File changes need a complete patch/scope view. Until that exists, leave
    // these requests to the original Codex client instead of approving blindly.
    const supported = msg.method === 'item/commandExecution/requestApproval';
    const commandFields = ['threadId', 'turnId', 'itemId', 'approvalId', 'command', 'reason', 'cwd', 'commandActions', 'kind', 'startedAtMs'];
    // CLI 0.153.2 permits null optional scope fields. A non-null scope needs
    // its own review UI; unknown fields still fail closed, even when null.
    const absentScopeFields = ['additionalPermissions', 'availableDecisions', 'environmentId', 'networkApprovalContext', 'proposedExecpolicyAmendment', 'proposedNetworkPolicyAmendments'];
    const reviewable = typeof msg.params.command === 'string' && !!msg.params.command.trim() && msg.params.command.length <= 12000
      && Object.keys(msg.params).every(key => commandFields.includes(key) || (absentScopeFields.includes(key) && msg.params[key] === null))
      && (msg.params.kind === undefined || msg.params.kind === 'command')
      && (msg.params.startedAtMs === undefined || Number.isSafeInteger(msg.params.startedAtMs))
      && (msg.params.reason == null || (typeof msg.params.reason === 'string' && msg.params.reason.length <= 2000))
      && (msg.params.cwd == null || typeof msg.params.cwd === 'string');
    if (supported && reviewable) {
      if (this.approvals.size >= 50) { this.rejectRequest(msg); return; }
      this.approvals.set(String(msg.id), { id: msg.id, detailToken: randomUUID(), taskId: task.id, threadId: task.threadId, turnId: task.turnId, method: msg.method, reason: msg.params.reason || '操作需要授权', command: msg.params.command || '', cwd: msg.params.cwd || task.cwd });
      task.status = 'approval'; task.activity = '等待你批准操作';
      this.log(`${task.name} 等待操作授权`, 'warning', task.id);
    } else {
      this.rejectRequest(msg);
      this.cancelApprovals(task);
      task.status = 'pausing'; task.activity = msg.method === 'item/fileChange/requestApproval' ? '文件修改范围无法完整审阅，已拒绝；请在原 Codex 中核对后手动继续' : reviewable ? '需要用户输入，请在 Codex 中处理后继续' : '授权内容超出可审阅范围，已拒绝，请在原 Codex 会话核对后继续';
      if (task.turnId) void this.safelyAsync(() => this.interruptTask(task));
    }
    this.changed();
  }
  cancelApprovals(task) {
    for (const [id, request] of this.approvals) if (request.taskId === task.id) {
      this.approvals.delete(id);
      this.safely(() => this.rpc.send({ id: request.id, result: { decision: 'decline' } }));
    }
  }
  async interruptTask(task) {
    const threadId = task.threadId, turnId = task.turnId;
    try { await this.rpc.call('turn/interrupt', { threadId, turnId }); }
    catch (error) {
      if (!this.state.tasks.includes(task) || task.status !== 'pausing' || task.threadId !== threadId || task.turnId !== turnId) return;
      task.status = 'blocked'; task.activity = `未确认中断：${error.message}`; this.changed(); throw error;
    }
  }
  approve(id, decision, token) {
    if (this.persistence.status !== 'ok') throw new Error('请先恢复数据保存，再处理授权');
    const request = this.approvals.get(String(id));
    if (!request || typeof token !== 'string' || token !== request.detailToken || !['accept', 'decline'].includes(decision)) throw new Error('授权请求已过期或决定无效');
    if (request.method !== 'item/commandExecution/requestApproval' || typeof request.command !== 'string' || !request.command.trim()) throw new Error('授权内容无法完整审阅，请在原 Codex 中处理');
    const task = this.state.tasks.find(t => t.id === request.taskId);
    if (this.stopped || !this.rpc.ready || !task || task.status !== 'approval' || !this.matchesTurn(task, request)) throw new Error('授权所属轮次已失效或正在暂停');
    // Confirm storage before granting an operation permission.
    this.pendingSave = true; this.flush();
    this.rpc.send({ id: request.id, result: { decision } });
    this.approvals.delete(String(id));
    const remaining = [...this.approvals.values()].some(other => other.taskId === task.id);
    task.status = remaining ? 'approval' : 'running'; task.activity = remaining ? '仍有操作等待授权' : decision === 'accept' ? '已批准，继续执行' : '已拒绝操作';
    this.changed();
  }
  create(input) {
    if (this.state.tasks.length >= 100) throw new Error('最多管理 100 条记录，请先结束不再需要的工作');
    for (const key of ['name', 'cwd', 'prompt']) if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error('请填写名称、项目目录和工作目标');
    if (input.name.length > 120 || input.prompt.length > 12000) throw new Error('名称或目标过长');
    if (!this.demo && (!isAbsolute(input.cwd) || !statSync(input.cwd).isDirectory())) throw new Error('项目目录必须是存在的绝对路径');
    const task = { id: randomUUID(), name: input.name.trim(), cwd: input.cwd.trim(), prompt: input.prompt.trim(), threadId: null, continuous: input.continuous === true, status: 'queued', activity: '等待调度', rounds: 0, plan: [], output: '', createdAt: Date.now(), updatedAt: Date.now() };
    this.state.tasks.unshift(task); this.log(`添加工作：${task.name}`); this.changed(); this.activate(); return task;
  }
  async action(id, action, value) {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task) throw new Error('任务不存在');
    if (task.mode === 'quota-wake') {
      if ((this.wakeExecutions.has(task.id) || task.wake?.delivery === 'uncertain') && (action === 'pause' || (action === 'continuous' && value === false))) {
        task.continuous = false; task.status = 'paused'; task.waitReason = null; task.retryAt = 0;
        task.activity = '监测已暂停，发送结果仍需确认；请核对原聊天，已发出的消息无法撤回'; this.changed(); return;
      }
      if (this.wakeExecutions.has(task.id)) {
        throw new Error('续作消息发送结果仍在确认，请等待后再开启或结束监测');
      }
      if ((action === 'resume' || (action === 'continuous' && value === true)) && (task.sentCount || 0) >= this.state.settings.maxWakeSends) throw new Error('已达到原聊天发送次数上限，请提高发送上限后再开启监测；累计次数不会重置');
      if (action === 'continuous') {
        if (typeof value !== 'boolean') throw new Error('开关值无效');
        if (task.continuous !== value) { task.continuous = value; resetWake(task); }
      } else if (action === 'pause') { task.continuous = false; resetWake(task); }
      else if (action === 'resume') { task.continuous = true; resetWake(task); }
      else if (action === 'complete') { task.continuous = false; task.status = 'completed'; this.log(`已结束监测：${task.name}；工作结果请在原聊天确认`, 'info', task.id); }
      else throw new Error('不支持的操作');
      this.changed(); if (action === 'resume' || (action === 'continuous' && value === true)) this.activate(); return;
    }
    if (action === 'continuous') {
      if (typeof value !== 'boolean') throw new Error('开关值无效');
      task.continuous = value;
      if (!value && ['waiting', 'queued'].includes(task.status)) { task.status = 'paused'; task.activity = '持续工作已关闭'; }
      if (value && task.status==='blocked' && isWriterConflict({message:task.activity})) this.waitForThread(task,'writer');
    } else if (action === 'pause') {
      const active = ['running', 'approval', 'pausing'].includes(task.status);
      task.status = active ? 'pausing' : 'paused'; task.activity = active ? '正在暂停' : '工作已暂停';
      task.waitReason = null; task.retryAt = 0;
      this.cancelApprovals(task);
      this.safely(() => this.changed());
      if (task.turnId && active) {
        await this.interruptTask(task);
      }
      return;
    } else if (action === 'resume') {
      if (['starting', 'running', 'approval', 'pausing'].includes(task.status)) throw new Error('任务尚在运行或停止中');
      task.status = 'queued'; task.rounds = 0; task.retryAt = 0; task.activity = '等待可用额度';
    } else if (action === 'complete') {
      if (['starting', 'running', 'approval', 'pausing'].includes(task.status)) throw new Error('请先暂停任务');
      task.status = 'completed'; task.activity = '用户确认完成';
    } else throw new Error('不支持的操作');
    if (task.status!=='waiting') { task.waitReason=null; if (task.status==='paused') task.retryAt=0; }
    this.changed();
    if (action === 'resume' || (action === 'continuous' && value === true)) this.activate();
  }
  updateSettings(input) {
    const s = this.state.settings;
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('开关值无效');
    for (const [key, min, max] of [['pollSeconds', 10, MAX_POLL_SECONDS], ['minimumRemaining', 1, 99], ['maxRounds', 1, 100], ['maxWakeSends', 1, 100]]) {
      if (input[key] !== undefined) { if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error(`${key} 必须为 ${min}–${max} 的整数`); }
    }
    for (const key of ['pollSeconds', 'minimumRemaining', 'maxRounds', 'maxWakeSends']) if (input[key] !== undefined) s[key] = input[key];
    if (input.enabled !== undefined) s.enabled = input.enabled;
    if (input.enabled === false) this.scheduleEpoch++;
    for (const task of this.state.tasks) if (task.mode === 'quota-wake') enforceWakeLimit(task, s.maxWakeSends);
    this.log('调度设置已更新'); this.changed();
    if (input.enabled === true) this.activate();
  }
  async listThreads(cursor = null) { await this.rpc.connect?.(); return this.rpc.call('thread/list', { limit: 30, sortKey: 'updated_at', cursor }); }
  async importThread(id, note = '') {
    if (this.state.tasks.some(t => t.threadId === id)) throw new Error('该会话已添加');
    if (this.importingThreads.has(id)) throw new Error('该会话正在添加，请勿重复导入');
    if (this.state.tasks.length >= 100) throw new Error('最多管理 100 条记录，请先结束不再需要的工作');
    if (typeof note !== 'string' || note.length > 12000) throw new Error('监测备注必须为不超过 12000 字符的文本');
    // Reserve before yielding: HTTP and MCP imports share this manager.
    this.importingThreads.add(id);
    try {
      const { thread } = await this.rpc.call('thread/read', { threadId: id, includeTurns: false });
      // Another task path may have claimed the thread while the read was pending.
      if (this.state.tasks.some(t => t.threadId === id)) throw new Error('该会话已添加');
      if (this.state.tasks.length >= 100) throw new Error('最多管理 100 条记录，请先结束不再需要的工作');
      const task = { id: randomUUID(), mode: 'quota-wake', threadId: id, name: (thread.name || thread.preview || 'Codex 会话').slice(0, 80), cwd: thread.cwd, note: note.trim(), continuous: false, status: 'paused', activity: '会话已添加，开启额度监测后在恢复时发送“继续”；工作结果请在原聊天确认', sentCount: 0, wake: { armed: false, delivery: 'idle' }, plan: [], output: '', createdAt: Date.now(), updatedAt: Date.now() };
      this.state.tasks.unshift(task); this.log(`已添加会话：${task.name}`); this.changed(); return task;
    } finally { this.importingThreads.delete(id); }
  }
}
