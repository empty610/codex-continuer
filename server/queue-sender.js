import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function queueBinary(env = process.env) {
  if (env.CODEX_QUEUE_BINARY) return env.CODEX_QUEUE_BINARY;
  if (env.CODEX_CLI_PATH && existsSync(env.CODEX_CLI_PATH)) return env.CODEX_CLI_PATH;
  const base = join(env.LOCALAPPDATA || '', 'OpenAI/Codex/bin');
  if (existsSync(base)) {
    const candidates = readdirSync(base).map(name => join(base, name, 'codex.exe')).filter(existsSync);
    candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidates.length) return candidates[0];
  }
  return 'codex';
}

function execute(binary, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_APP_TOOLS_PIPE_PATH', 'CODEX_APP_TOOLS_CALLER_HOST_ID']) delete env[key];
    execFile(binary, args, { env, windowsHide: true, timeout: 20000, maxBuffer: 65536, shell: false }, (error, stdout) => {
      if (error) reject(new Error(error.killed ? 'Codex 队列请求超时' : `Codex 队列请求失败 (${error.code || 'unknown'})`));
      else resolve(String(stdout));
    });
  });
}

// Official queue command: no thread/resume, model override or approval override.
export class QueueSender {
  constructor({ binary, run = execute } = {}) { this.binary = binary || queueBinary(); this.run = run; }
  async send(threadId, { shouldSend = () => true } = {}) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId)) {
      throw Object.assign(new Error('原聊天 ID 无效'), { safeToRetry: false });
    }
    try { await this.run(this.binary, ['queue', '--help']); }
    catch { throw Object.assign(new Error('Codex 消息队列不可用，请更新桌面端或设置 CODEX_QUEUE_BINARY'), { safeToRetry: true }); }
    if (!shouldSend()) throw Object.assign(new Error('已暂停，未发送续作消息'), { cancelled: true, safeToRetry: true });
    try {
      const output = await this.run(this.binary, ['queue', '--thread', threadId, '--message', '继续']);
      const queueId = /Queued message ([0-9a-f-]{36})/i.exec(String(output))?.[1];
      return { queueId: queueId || null };
    } catch (error) {
      // A timeout/exit can occur after enqueueing. Never silently send twice.
      throw Object.assign(new Error(`发送结果未确认，请检查原聊天：${error.message}`), { safeToRetry: false });
    }
  }
}
