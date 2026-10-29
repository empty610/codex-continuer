import { setActivity, taskActivityMessage, message as textMessage } from '../public/message.js';
import { randomUUID } from 'node:crypto';
import { ClientError } from './http-policy.js';
import { localProjectPath } from './project-path.js';
import { isQuotaError, isWriterConflict, parseOutcome } from './policy.js';
import { retainOutput, outcomeSummary } from './output.js';
import { ACTIVE_TURN_STATUSES, waitForThread, isDirectTask } from './direct-task.js';

const outcomeSchema = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'continue', 'blocked'] }, summary: { type: 'string' } }, required: ['status', 'summary'], additionalProperties: false };
const instructions = '\n请维护可验证的步骤计划。仅在原始目标全部完成并验证后返回 status=done；还有可独立推进的工作则返回 continue；需要用户输入或权限则返回 blocked。summary 简述证据或阻塞原因。不要因为额度不足声称完成。';
const TURN_EVENTS = new Set(['turn/started', 'turn/completed', 'turn/plan/updated', 'item/agentMessage/delta', 'item/started', 'item/completed']);
const START_EVENT_LIMIT = 256;
const START_EVENT_BYTES = 4 * 1024 * 1024;

// Owns Codex turn execution, early-event correlation and manual approvals.
// Scheduling and persistence policy are supplied through explicit collaborators.
export class TurnController {
  constructor(rpc, { persistence, canSchedule, hasExecutionQuota, isStopped, changed, log, invalidateQuota, onError }) {
    this.rpc = rpc;
    this.persistence = persistence;
    this.canSchedule = canSchedule;
    this.hasExecutionQuota = hasExecutionQuota;
    this.isStopped = isStopped;
    this.changed = changed;
    this.log = log;
    this.invalidateQuota = invalidateQuota;
    this.onError = onError;
    this.executions = new Map();
    this.approvals = new Map();
  }
  get state() { return this.persistence.state; }
  safely(action) {
    try { return action(); } catch (error) { this.onError(error); }
  }
  async safelyAsync(action) {
    try { return await action(); } catch (error) { this.onError(error); }
  }
  async run(task, epoch) {
    if (!isDirectTask(task)) throw new ClientError(textMessage("error.monitor_execution"));
    if (!this.canSchedule(epoch)) return;
    const execution = { pending: false, events: [], bytes: 0, overflow: false };
    this.executions.set(task.id, execution);
    const current = () => this.executions.get(task.id) === execution;
    const previousRounds=task.rounds;
    const permitted = () => {
      if (!current() || task.status !== 'starting') return false;
      if (this.canSchedule(epoch) && this.hasExecutionQuota()) return true;
      task.status = 'queued'; setActivity(task, textMessage("task.start_cancelled_waiting_for_active_scheduling_and_fresh")); this.changed(); return false;
    };
    try {
      task.cwd = localProjectPath(task.cwd);
      task.turnId = null;
      task.status = 'starting'; task.waitReason=null; setActivity(task, textMessage("task.resuming_chat")); this.changed();
      if (task.rounds >= this.state.settings.maxRounds) {
        task.status = 'blocked'; setActivity(task, textMessage("task.automatic_turn_limit_reached_resume_manually_to_continue")); this.changed(); return;
      }
      if (task.threadId) {
        const read = await this.rpc.call('thread/read', { threadId: task.threadId, includeTurns: false });
        if (!permitted()) return;
        if (read.thread.status?.type === 'active') { waitForThread(task,'thread'); this.changed(); return; }
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
      if (typeof result.turn?.id !== 'string' || !result.turn.id) throw new ClientError(textMessage("error.no_valid_turn_id_received_check_the_original"));
      execution.pending = false;
      if (ACTIVE_TURN_STATUSES.includes(task.status)) task.turnId = result.turn.id;
      this.log(textMessage("log.work_started", { name: task.name }), 'success', task.id);
      if (execution.overflow) {
        task.status = 'pausing'; setActivity(task, textMessage("task.startup_events_exceeded_the_buffer_limit_interrupting_check"));
        this.log(taskActivityMessage(task), 'warning', task.id);
      }
      const events = execution.events; execution.events = []; execution.bytes = 0;
      for (const event of events) event.request ? this.request(event.message) : this.event(event.message);
      this.changed();
      if (task.status === 'pausing' && task.turnId === result.turn.id) {
        try { await this.rpc.call('turn/interrupt', { threadId: task.threadId, turnId: task.turnId }); }
        catch (error) {
          if (!current() || task.status !== 'pausing' || task.turnId !== result.turn.id) return;
          task.status = 'blocked'; setActivity(task, textMessage("task.interruption_unconfirmed", { reason: error.messageInfo || error.message }));
          this.log(taskActivityMessage(task), 'warning', task.id); this.changed();
        }
      }
    } catch (error) {
      if (!current()) return;
      if (['paused', 'pausing'].includes(task.status)) task.status = 'paused';
      else if (isWriterConflict(error)) {
        task.rounds=previousRounds; task.turnId=null; task.lastError=error.message;
        waitForThread(task,'writer');
      }
      else { task.status = 'blocked'; setActivity(task, error); }
      this.log(taskActivityMessage(task), 'warning', task.id); this.changed();
    } finally {
      if (current()) {
        this.executions.delete(task.id);
        for (const event of execution.events) if (event.request) this.rejectRequest(event.message);
      }
    }
  }
  matchesTurn(task, params) {
    const turnId = params.turnId ?? params.turn?.id;
    return isDirectTask(task) && ACTIVE_TURN_STATUSES.includes(task.status)
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
    if (!TURN_EVENTS.has(method)) return;
    const task = this.state.tasks.find(t => t.threadId === p.threadId);
    if (!task) return;
    if (!isDirectTask(task)) return;
    if (this.deferTurnEvent(task, { method, params: p })) return;
    if (!this.matchesTurn(task, p)) return;
    if (method === 'turn/completed' && !['completed', 'failed', 'interrupted'].includes(p.turn?.status)) return;
    task.updatedAt = Date.now();
    if (method === 'turn/started') { setActivity(task, textMessage("task.codex_is_working_on_the_goal")); }
    else if (method === 'turn/plan/updated') { task.plan = p.plan.slice(0, 100).map(step => ({ ...step, step: outcomeSummary(step.step) })); setActivity(task, (p.explanation || task.plan.find(s => s.status === 'inProgress')?.step) ? outcomeSummary(p.explanation || task.plan.find(s => s.status === 'inProgress')?.step) : textMessage("task.plan_updated")); }
    else if (method === 'item/agentMessage/delta') {
      retainOutput(task, p.delta, true);
      task.outcome = null;
    }
    else if (method === 'item/started') {
      const item = p.item;
      if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch'].includes(item.type)) task.toolCount++;
      setActivity(task, ({ commandExecution: textMessage("task.running_a_command"), fileChange: textMessage("task.editing_files"), reasoning: textMessage("task.analyzing"), agentMessage: textMessage("task.generating_a_response"), mcpToolCall: textMessage("task.calling_a_tool") })[item.type] || textMessage("task.working"));
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
        task.status = 'paused'; setActivity(task, textMessage("task.work_paused"));
      } else if (p.turn.status === 'failed') {
        const limited = isQuotaError(p.turn.error);
        task.status = limited && task.continuous ? 'waiting' : 'failed';
        task.waitReason=task.status==='waiting' ? 'quota' : null;
        setActivity(task, p.turn.error?.message || textMessage("task.this_turn_failed"));
        task.retryAt = Date.now() + 60000;
        if (limited) this.invalidateQuota();
      } else {
        const outcome = task.outcome || parseOutcome(task.output);
        setActivity(task, { message: outcome.summary, messageInfo: outcome.summaryMessage });
        task.status = outcome.status === 'done' ? 'completed' : outcome.status === 'continue' && task.continuous && task.toolCount > 0 ? 'queued' : 'blocked';
        if (outcome.status === 'continue' && task.toolCount === 0) setActivity(task, textMessage("task.no_tool_activity", { summary: task.activityMessage || task.activity }));
        task.retryAt = Date.now() + 5000;
      }
      this.log(taskActivityMessage(task), task.status === 'completed' ? 'success' : 'info', task.id);
    } else return;
    this.changed({ deferSave: method === 'item/agentMessage/delta' });
  }
  request(msg) {
    const task = this.state.tasks.find(t => t.threadId === msg.params?.threadId);
    if (task && isDirectTask(task) && this.deferTurnEvent(task, msg, true)) return;
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
      task.status = 'approval'; setActivity(task, textMessage("task.waiting_for_your_approval"));
      this.log(textMessage("log.is_awaiting_approval", { name: task.name }), 'warning', task.id);
    } else {
      this.rejectRequest(msg);
      this.cancelApprovals(task);
      task.status = 'pausing'; setActivity(task, msg.method === 'item/fileChange/requestApproval' ? textMessage("task.file_changes_cannot_be_fully_reviewed_and_were") : reviewable ? textMessage("task.user_input_is_required_respond_in_codex_before") : textMessage("task.approval_details_cannot_be_fully_reviewed_and_were"));
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
      task.status = 'blocked'; setActivity(task, textMessage("task.interruption_unconfirmed", { reason: error.messageInfo || error.message })); this.changed(); throw error;
    }
  }
  approve(id, decision, token) {
    if (!this.persistence.healthy) throw new ClientError(textMessage("error.recover_data_storage_before_handling_approvals"));
    const request = this.approvals.get(String(id));
    if (!request || typeof token !== 'string' || token !== request.detailToken || !['accept', 'decline'].includes(decision)) throw new ClientError(textMessage("error.approval_expired_or_decision_invalid"));
    if (request.method !== 'item/commandExecution/requestApproval' || typeof request.command !== 'string' || !request.command.trim()) throw new ClientError(textMessage("error.approval_details_cannot_be_fully_reviewed_handle_this"));
    const task = this.state.tasks.find(t => t.id === request.taskId);
    if (this.isStopped() || !this.rpc.ready || !task || task.status !== 'approval' || !this.matchesTurn(task, request)) throw new ClientError(textMessage("error.the_approval_turn_is_no_longer_active_or"));
    // Confirm storage before granting an operation permission.
    this.persistence.commit();
    this.rpc.send({ id: request.id, result: { decision } });
    this.approvals.delete(String(id));
    const remaining = [...this.approvals.values()].some(other => other.taskId === task.id);
    task.status = remaining ? 'approval' : 'running'; setActivity(task, remaining ? textMessage("task.more_operations_await_approval") : decision === 'accept' ? textMessage("task.approved_continuing") : textMessage("task.operation_declined"));
    this.changed();
  }
}
