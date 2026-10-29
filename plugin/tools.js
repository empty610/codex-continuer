const object = properties => ({ type: 'object', properties, additionalProperties: false });
const text = { type: 'string', minLength: 1 };
export const tools = [
  { name: 'continuer_open_widget', description: '打开跟随 Codex 窗口的 Continuer 额度和任务挂件。只显示界面，不新建或继续任务。', inputSchema: object({}), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'continuer_status', description: '读取 Codex 额度、已管理任务进度、持续工作开关及连接状态。未知额度不是零。', inputSchema: object({}), annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'continuer_list_sessions', description: '分页读取可导入的 Codex 本机会话；读取不会自动接管会话。', inputSchema: object({ cursor: { type: 'string' } }), annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'continuer_import_session', description: '将原聊天加入额度恢复监测，导入后暂停。note 为可选本地备注，不发送给聊天；旧 prompt 字段仅作为备注兼容。continuationMessage 为可选续作消息，留空发送“继续”。每次确认耗尽并恢复后先检查最新回复，上次指令已有完整回复则跳过；仍在回复或状态未知时等待重试。实际发送累计受 maxWakeSends 限制，不承诺完成项目目标。', inputSchema: { ...object({ threadId: text, note: { type: 'string', minLength: 0 }, continuationMessage: { type: 'string', minLength: 0, description: '额度恢复时发送给原聊天的消息；留空发送继续' }, prompt: { ...text, description: '旧版兼容备注；不发送给聊天，不可与 note 同时提供' } }), required: ['threadId'] }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'continuer_task_action', description: '暂停任务、关闭持续工作或结束并移除记录。原聊天 complete 仅结束监测，不确认工作完成。恢复执行、开启监测和持续工作必须由用户在挂件中操作。', inputSchema: { ...object({ id: text, action: { enum: ['pause', 'complete', 'continuous'], type: 'string' }, value: { type: 'boolean', enum: [false] } }), required: ['id', 'action'] }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
  { name: 'continuer_update_settings', description: '仅允许关闭后台调度。开启调度、调整额度阈值及执行上限必须由用户在挂件中操作。', inputSchema: { ...object({ enabled: { type: 'boolean', enum: [false] } }), required: ['enabled'] }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
];
export function validate(name, input) {
  if (name === 'continuer_create_task') throw new Error('创建或启动工作需要用户在 Continuer 挂件中操作');
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
  const routes = { continuer_import_session: '/api/import', continuer_update_settings: '/api/settings' };
  const { id, ...payload } = args;
  const result = await runtime.request(name === 'continuer_task_action' ? `/api/tasks/${encodeURIComponent(id)}` : routes[name], name === 'continuer_task_action' ? payload : args);
  return { ok: true, settings: result.settings, tasks: result.tasks.map(({ id, mode, name, status, continuous, activity, rounds, sentCount }) => ({ id, mode, name, status, continuous, activity, rounds, sentCount })) };
}
