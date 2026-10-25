# Quota recovery investigation — 2026-10-22

> Historical incident record. Imported chats now use the queue-based recovery
> workflow documented in `docs/quota-recovery-wake.md`.

Affected managed work: 创建火星探测器介绍网页.

All times below are Asia/Shanghai:

- 20:43:01 and 20:43:34: quota samples reported 100% usage.
- 20:44:05: the next authoritative sample reported 0% usage.
- 20:44:07: the scheduler attempted recovery, but `thread/resume` was rejected
  with `thread … already has an active writer`.
- The catch-all launch-error handler set the task to `blocked`. Later quota
  refreshes could not resume it because the scheduler selected only queued work
  and continuous work in `waiting`.

The scheduler was enabled, the task's continuous switch was on, and no model turn
had started (`rounds=0`). The original chat's latest turn had failed with a usage
limit error. A completed/failed turn does not itself prove that another client
has released the thread's writer ownership.

The fix treats the specific writer-conflict rejection and an explicitly active
thread as retryable waits for continuous work. It reads the original thread
before retrying, backs off for 30 seconds, and never starts a model turn when
the original thread is reported active or resume is rejected. Non-continuous
tasks and unrelated errors still require manual handling.

Existing continuous tasks blocked by the exact legacy writer error are migrated
to that wait state on service startup. Paused, completed, non-continuous, approval,
authentication, and other blocked tasks are not revived by this migration.

The widget and dashboard distinguish `等待会话` from `等待额度`. Retrying cannot
force an external writer to release ownership; execution can resume once that
owner releases the thread. This is separate from quota recovery.

All 59 automated tests pass, including quota recovery into writer contention,
successful retry after release, no duplicate starts under overlapping ticks,
startup migration, manual pause during retry, disabling continuous work, and
unrelated hard failures.

After deployment, the service was connected, automatic scheduling remained
enabled, and the affected task retained `continuous=true`. An actual retry at
20:56:32 still received writer contention and scheduled the next attempt instead
of becoming blocked. Its state was `waiting`, reason `writer`, with `rounds=0`:
the original writer had not released ownership and no model turn had started.
