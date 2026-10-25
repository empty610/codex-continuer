# Original-chat continuation verification

> Historical research. The current imported-chat implementation uses the queue workflow in `docs/quota-recovery-wake.md`; retained probe results are under `.cache/history/`.

Date: 2026-10-23 (Asia/Shanghai).

Update: the later investigation found and verified the official desktop CLI
`codex queue` path, which does not use this context-bound desktop-tools pipe.
That path now powers the deployed quota-recovery sender. See
[quota-recovery-wake.md](../quota-recovery-wake.md). The limitations below describe
the earlier pipe experiments, not the official CLI queue implementation.

The initial investigation was read-only. Subsequently, the user explicitly
authorized one acknowledgment-only message and one temporary native heartbeat
test in an isolated verification chat. Both tests passed; the temporary automation was
deleted immediately afterward. Production Continuer task/settings were unchanged.

## Evidence

1. The desktop-provided `wait_threads` tool successfully read an isolated verification
   chat, reporting an idle thread and a completed latest turn. This proves that
   the desktop tool route can read the owning host's live state; it does not
   exercise message sending or scheduling.
2. The installed bundled `codex-app-tools/0.1.6/server.mjs` routes calls to a
   desktop named pipe supplied through `CODEX_APP_TOOLS_PIPE_PATH`. It requires
   caller/executor thread metadata. Its catalog includes
   `send_message_to_thread`, `wait_threads`, and `automation_update`. The latter
   includes heartbeat tasks targeting an existing chat.
3. A separate Node subprocess, using the actual installed bundled bridge,
   completed MCP initialization and tool discovery in the normal Windows user
   context. The sandboxed attempt was denied pipe access (`EPERM`); the approved
   read-only normal-user attempt reached the pipe.
4. The initial separate process's `wait_threads` call without caller metadata was rejected
   with `Codex app tools require thread metadata from the executor.` Supplying the
   probe's genuine executor thread id still produced the generic host error
   `Codex app tool request failed`. A later probe ([redacted-time]) supplied
   the actual current caller turn id obtained from desktop `read_thread` and the
   actual executor-provided tool call id, in addition to the same caller thread
   id. This succeeded and returned the target verification chat's idle status and latest
   completed turn. The same probe still rejected the thread-id-only call.
   Complete live caller context therefore resolved this observed read failure.
   Do not invent identities or reuse historical call/turn ids as credentials for
   a background daemon.
5. Continuer currently launches its own `codex app-server` in `server/rpc.js`.
   Its MCP implementation exposes Continuer tools to the host; it does not provide
   a reverse desktop message client. Changing the transport of that separate
   server alone would not establish access to the desktop's existing server.

Historical probe source: `scripts/probe-desktop-bridge.js` (one-off script removed during the 2026-10-24 cleanup). Detailed discovery/result artifact:
`.cache/history/desktop-bridge-probe.json`. The probe deliberately calls only
`initialize`, `tools/list`, and the read-only `wait_threads` tool. It retains status
and schema evidence without copying the chat's assistant output.

## Official documentation

- [Scheduled tasks inside an existing chat](https://learn.chatgpt.com/docs/automations#schedule-a-task-inside-a-chat)
  explicitly supports reusing the existing chat context and minute-based
  intervals. Local-file work requires the computer and desktop app to remain
  running. This is a documented architecture option, not a completed live test.
- [Plugin extensions](https://developers.openai.com/plugins/build/extensions)
  lists extended message sending to the current conversation or a new one. It
  does not by itself establish that an independent background daemon can target
  any existing chat while the UI is closed.
- [App-server transports](https://learn.chatgpt.com/docs/app-server#protocol)
  documents stdio, WebSocket and control-socket connections. It does not establish
  that this installation exposes its desktop-owned server to Continuer.

## Conclusion and remaining acceptance work

Keeping the original chat is a supported product workflow. The most defensible
next design is desktop-owned chat scheduling (heartbeat) plus Continuer's
read-only quota/status tools, with the separate scheduler excluded for that same
task. Do not mark a task completed merely because a scheduled run completed.

The independent subprocess's read route is now verified with complete current
executor context. An unattended Continuer daemon sending directly into the
desktop chat is NOT verified: the read test ran during an active assistant turn.
It does not establish how a long-lived service would acquire valid context after
that turn ends or the desktop restarts. Discovery/read success is not message
delivery success. The internal pipe and bundled adapter are not an established
stable external integration contract.

Before deployment, test busy-chat handling, pause, stop on verified completion,
and desktop restart. A quota-exhausted/reset scenario must
also be observed: the documents reviewed do not establish quota-reset events or
automatic retry semantics for native heartbeats. A scheduled model invocation may
itself consume quota or fail before it can query Continuer, so a heartbeat is not
equivalent to token-free, immediate, quota-driven wakeup.

## Authorized end-to-end tests — passed

Target: the existing chat `[redacted-id]`. No fork or new
chat was created. The target was idle before testing.

- Single message: the supported desktop `send_message_to_thread` tool delivered
  the user's authorized acknowledgment-only prompt. The same chat replied
  `通道测试成功`; turn `[redacted-id]` completed at
  [redacted-time], after approximately 4.9 seconds.
- Scheduled trigger: the supported `automation_update` tool registered an ACTIVE
  native heartbeat with `target_thread_id` equal to the same original chat. Its
  persisted configuration was checked. The first scheduled turn
  `[redacted-id]` ran at [redacted-time] and completed at [redacted-time],
  replying `定时通道测试成功`.
- Cleanup: temporary automation `continuer` was deleted through the supported
  tool immediately after the observed run. The tool confirmed deletion and a
  filesystem check confirmed its `automation.toml` no longer exists.
- Reading both test turns confirmed acknowledgment replies with no command
  execution or file-change items. No project work was requested in either test.

Evidence: `.cache/history/native-continuation-test.json`.

This verifies original-chat message delivery and native scheduled continuation
while the desktop owns the chat. It does not verify unattended direct message
calls by Continuer without a live executor context, immediate wakeup on quota
reset, or recovery across desktop restarts. No permanent continuation schedule
was enabled by this test.
