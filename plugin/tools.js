import { MAX_POLL_SECONDS } from '../server/policy.js';
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const text = { type: 'string', minLength: 1 };
const taskInput = { ...object({ name: text, cwd: text, prompt: text, continuous: { type: 'boolean' } }), required: ['name', 'cwd', 'prompt', 'continuous'] };
export const tools = [
  { name: 'continuer_open_widget', description: '打开跟随 Codex 窗口的 Continuer 额度和任务挂件。只显示界面，不新建或继续任务。', inputSchema: object({}), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'continuer_status', description: '读取 Codex 额度、已管理任务进度、持续工作开关及连接状态。未知额度不是零。', inputSchema: object({}), annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'continuer_list_sessions', description: '分页读取可导入的 Codex 本机会话；读取不会自动接管会话。', inputSchema: object({ cursor: { type: 'string' } }), annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'continuer_create_task', description: '用户明确要求开始项目工作时创建任务。调度开启且额度允许时会执行本地代码工作。必须使用用户提供或已确认的项目目录与目标。', inputSchema: taskInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: 'continuer_import_session', description: '将原聊天加入额度恢复监测，导入后暂停。note 为可选本地备注，不发送给聊天；旧 prompt 字段仅作为备注兼容。每次确认耗尽并恢复后只发送固定“继续”，累计受 maxWakeSends 限制。不读取原聊天完成状态，不承诺完成目标。', inputSchema: { ...object({ threadId: text, note: { type: 'string', minLength: 0 }, prompt: { ...text, description: '旧版兼容备注；不发送给聊天，不可与 note 同时提供' } }), required: ['threadId'] }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'continuer_task_action', description: '按用户要求操作任务。直接执行模式 resume 排队工作，complete 标记完成并移除；原聊天模式 resume 仅开启额度监测，pause 仅暂停监测，complete 仅结束监测并移除记录，不确认原聊天工作完成。监测累计发送次数不会因暂停或重新开启而清零。', inputSchema: { ...object({ id: text, action: { enum: ['pause', 'resume', 'complete', 'continuous'], type: 'string' }, value: { type: 'boolean' } }), required: ['id', 'action'] }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: 'continuer_update_settings', description: '按用户要求调整调度、额度阈值与 10–90 秒同步周期。maxRounds 为直接执行轮次上限，maxWakeSends 为每条原聊天监测记录的累计发送次数上限。提高发送上限不会自动重启已停止的监测。', inputSchema: object({ enabled: { type: 'boolean' }, minimumRemaining: { type: 'integer', minimum: 1, maximum: 99 }, pollSeconds: { type: 'integer', minimum: 10, maximum: MAX_POLL_SECONDS }, maxRounds: { type: 'integer', minimum: 1, maximum: 100 }, maxWakeSends: { type: 'integer', minimum: 1, maximum: 100 } }), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
];
export function validate(name, input) {
  const spec = tools.find(t => t.name === name)?.inputSchema;
  if (!spec) throw new Error('Unknown tool');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Arguments must be an object');
  for (const key of spec.required || []) if (!(key in input)) throw new Error(`Missing ${key}`);
  for (const [key, value] of Object.entries(input)) {
    const rule = spec.properties[key];
    if (!rule || (rule.type === 'integer' ? !Number.isInteger(value) : typeof value !== rule.type)) throw new Error(`Invalid ${key}`);
    if (rule.enum && !rule.enum.includes(value)) throw new Error(`Invalid ${key}`);
    if (typeof value === 'string' && ((!value.trim() && rule.minLength !== 0) || value.length > 12000)) throw new Error(`Invalid ${key}`);
    if (rule.minimum != null && value < rule.minimum || rule.maximum != null && value > rule.maximum) throw new Error(`Invalid ${key}`);
  }
  if (name === 'continuer_task_action' && input.action === 'continuous' && typeof input.value !== 'boolean') throw new Error('continuous requires value');
  if (name === 'continuer_import_session' && input.note !== undefined && input.prompt !== undefined) throw new Error('Use note or legacy prompt, not both');
}
export async function dispatch(name, args, runtime) {
  validate(name, args);
  if (name === 'continuer_open_widget') return runtime.openWidget();
  const current = await runtime.ensureService();
  if (name === 'continuer_status') {
    const state = current?.tasks ? current : await runtime.request('/api/state');
    return { app: state.app, version: state.version, buildId: state.buildId, protocolVersion: state.protocolVersion, observationOnly: state.observationOnly, persistence: state.persistence, diagnostics: state.diagnostics, connection: state.connection, quota: state.quota, sampledAt: state.sampledAt, settings: state.settings, tasks: state.tasks.map(({ id, mode, name, cwd, threadId, status, progress, activity, continuous, rounds, sentCount, wake }) => ({ id, mode, name, cwd, threadId, status, progress, activity, continuous, rounds, sentCount, wake })), pendingApprovals: state.approvals.length };
  }
  if (name === 'continuer_list_sessions') return runtime.request('/api/threads' + (args.cursor ? '?cursor=' + encodeURIComponent(args.cursor) : ''));
  const routes = { continuer_create_task: '/api/tasks', continuer_import_session: '/api/import', continuer_update_settings: '/api/settings' };
  const { id, ...payload } = args;
  const result = await runtime.request(name === 'continuer_task_action' ? `/api/tasks/${encodeURIComponent(id)}` : routes[name], name === 'continuer_task_action' ? payload : args);
  return { ok: true, settings: result.settings, tasks: result.tasks.map(({ id, mode, name, status, continuous, activity, rounds, sentCount }) => ({ id, mode, name, status, continuous, activity, rounds, sentCount })) };
}
