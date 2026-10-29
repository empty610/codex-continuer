import { MessageError, message as textMessage } from '../public/message.js';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultContinuation } from '../public/i18n.js';

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
      if (error) reject(new MessageError(error.killed ? textMessage("error.queue_timeout") : textMessage("error.queue_failed", { code: error.code || 'unknown' })));
      else resolve(String(stdout));
    });
  });
}

// Official queue command: no thread/resume, model override or approval override.
export class QueueSender {
  constructor({ binary, run = execute } = {}) { this.binary = binary || queueBinary(); this.run = run; }
  async send(threadId, { shouldSend = () => true, beforeSend, message = '', language = 'zh' } = {}) {
    if (typeof message !== 'string' || message.length > 12000) {
      throw Object.assign(new MessageError(textMessage("error.continuation_messages_must_be_text_of_up_to")), { safeToRetry: false });
    }
    message = message.trim() || defaultContinuation(language);
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId)) {
      throw Object.assign(new MessageError(textMessage("error.invalid_original_chat_id")), { safeToRetry: false });
    }
    try { await this.run(this.binary, ['queue', '--help']); }
    catch { throw Object.assign(new MessageError(textMessage("error.codex_message_queue_unavailable_update_the_desktop_app")), { safeToRetry: true }); }
    if (!shouldSend()) throw Object.assign(new MessageError(textMessage("error.paused_no_continuation_message_sent")), { cancelled: true, safeToRetry: true });
    // Re-read after the capability probe, immediately before enqueueing. This
    // hook has no message side effect, so its errors must not become uncertain.
    await beforeSend?.();
    if (!shouldSend()) throw Object.assign(new MessageError(textMessage("error.paused_no_continuation_message_sent")), { cancelled: true, safeToRetry: true });
    try {
      const output = await this.run(this.binary, ['queue', '--thread', threadId, '--message', message]);
      const queueId = /Queued message ([0-9a-f-]{36})/i.exec(String(output))?.[1];
      return { queueId: queueId || null };
    } catch (error) {
      // A timeout/exit can occur after enqueueing. Never silently send twice.
      throw Object.assign(new MessageError(textMessage("error.delivery_unconfirmed_check_the_original_chat", { reason: error.messageInfo || error.message })), { safeToRetry: false });
    }
  }
}
