---
phase: 2
title: 'Phase 2: Executor explicit fail branch'
status: pending
priority: P1
effort: '4h'
dependencies: [1]
---

# Phase 2: Executor explicit fail branch

## Goal

Consume the registry's `expired` wake at every idle-await execution site and
fail with the owner-ratified error exactly once, without reusing the completing
stream idle timeout, the Cancel abort signal, or a duplicate failure finalizer.
Prove that supported retry cannot resume the interrupted session.

## Evidence and constraints

- Owner: `packages/workflows/src/dag-executor.ts`; primary tests:
  `packages/workflows/src/dag-executor.test.ts`.
- `raceIdleWake()` already returns `SteeringIdleWake` and tears down its
  run-status poll in `finally`; widening the union requires only its comment to
  name expiry.
- Prompt/command idle-await lives in `executeNodeInternal`; loop-group bodies
  pass through this same function.
- AI loop idle-await lives in `executeLoopNode` and has its own
  `failLoopIteration()` accounting path.
- The generic prompt-node catch already seals, logs, writes/emits
  `node_failed`, records status, clears throttle maps, and returns no session
  id. It is the correct failure finalizer.
- `prepareWorkflowNodeRetry()` already deletes persisted sessions for every
  invalidated node, and its existing test must remain part of the proof.

## Files

| File                                                  | Action                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/workflows/src/dag-executor.ts`              | Export exact error and add two explicit expiry branches                                                     |
| `packages/workflows/src/dag-executor.test.ts`         | Add deterministic prompt, loop, race, queue, and session tests                                              |
| `packages/core/src/operations/workflow-retry.test.ts` | Rerun existing persisted-session deletion test; modify only if the supported-action assertion is incomplete |

## Design

1. Export
   `IDLE_AWAIT_EXPIRED_ERROR = 'interrupted by operator, no redirect received'`
   from `dag-executor.ts`. The web deliberately mirrors the string locally;
   Phase 5's real E2E guards cross-package drift.
2. Update `raceIdleWake()` documentation to say the first of `send_now`,
   expiry, discard, or a non-streamable run status wins. Do not change its
   implementation.
3. Immediately after the prompt site's `send_now` branch, add an explicit
   `expired` branch. Log a content-free warning with run/node/duration, then
   throw `new Error(IDLE_AWAIT_EXPIRED_ERROR)`. Do not call
   `nodeAbortController.abort()`. The existing catch is the sole writer of the
   terminal failure.
4. Keep the existing `terminated` branch byte-for-byte equivalent: it aborts
   the node controller and calls `finishCancelled()`.
5. Immediately after the loop site's `send_now` branch, recognize `expired`,
   log run/node/iteration/duration, and return
   `failLoopIteration(IDLE_AWAIT_EXPIRED_ERROR, accountingExtras,
IDLE_AWAIT_EXPIRED_ERROR)`. Do not post an additional platform message; the
   node failure and existing UI are the authority, and extra prose is not part
   of the story contract.
6. In the loop `terminated` branch, synchronously close the steering handle
   before the existing status re-read and platform message. Keep that branch's
   error/message/accounting semantics unchanged; the early idempotent close is
   necessary so the losing inactivity timer cannot fire during those awaits.
7. Do not modify `withIdleTimeout`, `nodeIdleTimedOut`, `finishCancelled`, the
   natural-boundary gate, provider session threading, or persistence logic.
8. The existing `finally` blocks continue to count unconsumed queue rows,
   close/unregister handles, and make Story 2.11 reconciliation possible.

## Tests first

After `awaitIdle`, call the live handle's `expireIdleForTests()` to drive
expiry synchronously. Use the manual registry scheduler tests from Phase 1 for
timer timing/re-arm behavior; do not duplicate that with real sleeps here.

| ID    | Case                                  | Required assertions                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2.1  | Prompt expiry                         | Exact `node_failed` error and failed status; one terminal event; no `node_completed`; one provider call.                                                                                                                                                                                     |
| T2.2  | Not stream idle timeout               | No `completed via idle timeout` message, no completion event, and no `idle_timeout` classification. The node result is failed.                                                                                                                                                               |
| T2.3  | Prompt failure uses generic finalizer | Handle is closed before the terminal write, error log/status/emitter shapes match an ordinary thrown error, and there is no new duplicate finalizer-specific event.                                                                                                                          |
| T2.4  | `send_now` wins before forced expiry  | Redirect continues on the interrupted live session, completes normally, and a stale expiry trigger cannot fail it.                                                                                                                                                                           |
| T2.5  | Cancel poll wins with no stream       | Change run status after idle; existing poll produces the existing Cancel error once. The registry job is cancelled and a forced stale expiry cannot add a failure.                                                                                                                           |
| T2.6  | Expiry wins before discard            | One expiry failure; subsequent `discardRun` does not add another terminal outcome; handle is unregistered in `finally`.                                                                                                                                                                      |
| T2.7  | AI loop expiry                        | Iteration failure and outer node failure both carry the exact expiry error; accounting/iteration data remain present; no later iteration starts.                                                                                                                                             |
| T2.8  | Loop Cancel remains unchanged         | Status-poll termination synchronously closes the handle before its first await, follows the existing `Workflow <status>` result/message branch, and makes a forced stale expiry inert.                                                                                                       |
| T2.9  | Loop-group body                       | The namespaced body row (`grp.body`) has the exact expiry error; the outer group keeps its existing composite wrapper; no later group iteration starts.                                                                                                                                      |
| T2.10 | Queued rows remain unmatched          | Queue two accepted messages before expiry; the unconsumed warning reports count 2, no operator transcript row is written, and no guidance turn runs.                                                                                                                                         |
| T2.11 | Expiry result carries no session      | Interrupted turn may report `sess-1`, but failed output has no session id and `upsertWorkflowNodeSession` is not called for it, including `persist_session: true`.                                                                                                                           |
| T2.12 | Supported retry is fresh              | Keep the core test proving `prepareWorkflowNodeRetry` deletes sessions for target and descendants. Add only the missing executor characterization, if needed, that a new DAG invocation starts with `resumeSessionId === undefined`; do not simulate around the supported deletion contract. |

Where an exact once assertion involves two contenders, drive their order
deterministically; no “as close as possible” timeout races.

## Verification

```bash
bun test packages/workflows/src/dag-executor.test.ts
bun test packages/core/src/operations/workflow-retry.test.ts
bun --filter @archon/workflows type-check
bun --filter @archon/core type-check
bun x eslint packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts packages/core/src/operations/workflow-retry.test.ts --max-warnings 0
```

Existing interrupt/redirect, idle Cancel, loop, loop-group, DeepSeek abort
classification, and persisted-session tests must remain unchanged and green.

## Risks and rollback

- Throwing is intentional here: it reuses the established terminal path and
  avoids two subtly different prompt failure writers.
- Passing the third `failLoopIteration` argument is necessary; otherwise the
  outer loop node would wrap the exact story error.
- Phase 1 and 2 deploy/revert together. No migration or durable cleanup exists.
