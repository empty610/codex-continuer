# Quota recovery sends Continue to the original chat

Implemented 2026-10-23. Imported chats use `mode: quota-wake`; legacy background
jobs created by Continuer retain their existing execution mode.

The desktop-bundled CLI in this installation supports the official `codex queue`
command. Unlike a second `thread/resume`, this queues input for the existing chat
without acquiring its writer. A user-authorized live probe queued message
`[redacted-id]` for an isolated verification chat. The desktop
consumed it, completed turn `[redacted-id]`, and replied
`队列测试成功` in approximately 3.5 seconds. The queue entry was no longer present
after consumption. No command or file-change marker was reported in that turn.

The implementation invokes CLI argument arrays without a shell and removes
assistant thread/turn-call and desktop-tool pipe environment metadata from the
child environment. It does not rely on replaying historical executor context.
No model, sandbox or approval settings are overridden. `CODEX_QUEUE_BINARY`
selects an explicit CLI; otherwise the desktop CLI is preferred over old PATH
installations. CLI stderr is not forwarded to the UI.

Each watched chat has a persisted wake record. An authoritative polling sample
with a 100%-used window or a server restriction marker arms one recovery episode.
Fresh authoritative samples must subsequently satisfy the existing all-window
minimum-remaining policy. Enabling monitoring with healthy quota does not send.
Missing, stale or partial-event samples cannot trigger recovery. Before enqueue,
the outbox is persisted as sending; after acknowledgment it is marked sent and
disarmed. The next actual exhaustion creates a new episode. A process restart
with an uncertain send blocks retransmission instead of risking duplicate input.

Global scheduling off, per-chat pause/continuous off and completion prevent new
messages. Explicit pause/reenable resets monitoring only when no delivery is in
flight; it does not force a new Continue message. Pausing an in-flight delivery
preserves its durable claim; reenable and removal wait for its result. Repeated
pause also preserves an uncertain result. A pause after enqueue cannot revoke Codex's queue.
The queue sender checks cancellation again after its CLI capability probe.

Known boundaries: the desktop/owning executor must consume the queue; queue
acknowledgment is not proof of a successful model turn or task completion. No
permanent native heartbeat is required. This change does not infer completion
from free-form desktop replies or synchronize external plans. A real exhausted
account/reset was not artificially induced; the recovery state machine is tested
using protocol substitutes, and delivery is separately proven on the real chat.

Official interface: https://learn.chatgpt.com/docs/developer-commands#codex-queue

Deployment was verified at [redacted-time]: service connected, scheduling
enabled, original chat still continuous, mode quota-wake, status monitoring,
armed=false, delivery=idle, and zero automatic messages sent. The desktop widget
was refreshed and ready. The original chat's latest turn remained the authorized
queue test, confirming that healthy quota after deployment did not trigger a
spurious Continue. All 73 tests and JavaScript syntax checks passed.

Live state proof: `.cache/history/live-quota-wake-verification.json`. A rollback copy of
the pre-deployment state and changed installed files is in
`.cache/rollback/before-quota-wake/`.

## Import concurrency fix — 2026-10-24

HTTP, widget and MCP imports share a per-thread in-flight reservation in the
manager. A second request for the same chat is rejected before another read;
the reservation is released on success or failure. A second uniqueness check
after the asynchronous read also prevents another task path from creating a
duplicate during that wait. Existing records and their monitoring state remain
unchanged when an import is rejected.

Seven added regressions cover 20 simultaneous imports, mixed HTTP/MCP requests
against an isolated demo server, one persisted record and one delivery per quota
recovery, failed-read retries, independent chats, the commit check, and reimport
after completion. All 85 tests and JavaScript syntax checks pass. These tests
use simulated quota and delivery; no real chat messages or model turns are sent.

## Output persistence batching — 2026-10-24

Streaming text now shares a bounded 250 ms save window. Outbox claims and delivery
acknowledgments still save synchronously and include the latest buffered text;
a failed outbox save cannot enqueue a message. Normal stop/shutdown flushes the
remaining fragments. Ten new regressions bring the suite to 95 passing tests,
including preservation of these delivery ordering guarantees.

## Completed output limit — 2026-10-24

Direct execution now retains at most 16000 UTF-16 units of output for both deltas
and completed messages. Structured status is parsed before truncation, with only
status and a bounded 2000-unit summary retained. New rounds clear the prior
result, and malformed final responses still block continuation. Both detail
views explain truncation, and oversized legacy output is reduced on load.
Twelve added regressions bring the suite to 107 passing tests. Imported quota
monitoring and its delivery ordering guarantees continue to pass unchanged.

## Turn event isolation — 2026-10-24

Direct execution notifications and approval requests must match the active chat
and acknowledged turn ID. Start-time notifications wait for the turn/start
response before filtering and replay; a bounded backlog prevents unbounded
retention. Disconnect invalidates pending execution contexts, and the RPC reader
ignores input from replaced or closed processes. Duplicate completion cannot
reopen or complete another round. Twenty-six new regressions bring the suite
to 133 passing tests, including quota monitoring and delivery ordering checks.

## Polling and monitoring semantics — 2026-10-24

Polling is restricted to 10–90 seconds; stale quota still expires at 90 seconds.
Legacy intervals above the maximum shrink on load without enabling scheduling.
Queue preflight rechecks quota freshness and the send budget before enqueueing.

Imported chats use an optional local note, never a new execution goal. The legacy
prompt input is accepted only as a note. Confirmed queue calls count in sentCount
against maxWakeSends (1–100 per record); direct execution keeps maxRounds. Legacy
queue counts migrate from rounds, while a new send limit initially inherits the
old configured maxRounds. Pause, resume and restart preserve the count. Reaching
the cap disables monitoring; raising it requires explicit enable afterward.
Messages already entering the queue cannot be recalled and still count on success.

Both views and MCP distinguish end-monitoring from completing project work.
External plans and completion are not inferred. Sixteen new tests plus expanded
HTTP/MCP integration bring the suite to 149 passing tests, including rendered
monitor details, migration, caps, in-flight setting changes and quota freshness.
