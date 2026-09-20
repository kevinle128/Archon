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

Make both idle-await sites in the DAG executor consume the `expired` wake by
failing the node exactly once with `interrupted by operator, no redirect
received` on a dedicated branch — never `finishCancelled`, never the
completing idle-timeout path — while leaving `send_now` and `terminated`
handling byte-for-byte unchanged, and prove the cancel poll, exactly-once, and
fresh-session-on-retry properties with characterization tests.

## Context links

- `packages/workflows/src/dag-executor.ts`: `raceIdleWake` (~520),
  `finishCancelled` (~3274), prompt/command idle site (~3548–3585), loop idle
  site (~7165–7225), `failLoopIteration` (~6132), completed-via-idle-timeout
  message (~3524–3535), session cursor (~10562), persisted session (~10403).
- `packages/workflows/src/dag-executor.test.ts`: interrupt describe helpers
  `liveHandle`, `awaitIdle`, `sendNow`, `enqueue`, `nodeFailedError`,
  `storedEventTypes`; the existing tests "interrupt discards the idle waiter
  into the existing Cancel path" and "interrupt losing to node Cancel…".
- `_bmad-output/specs/spec-agent-node-room/engine-integration.md` — idle-await
  bound paragraph; `steering-test-plan.md` — "Engine — idle-await lifecycle".

## Key insights

- `raceIdleWake` needs no logic change; only its return type widens. The
  executor branches on `wake.kind` after the race.
- The prompt/command site returns from `executeNodeInternal`, so its finalizer
  must mirror `finishCancelled` (seal, event, emitter, status row, throttle
  cleanup, typed return). The loop site already has `failLoopIteration` for
  terminal iteration failures and must use it so loop accounting
  (`loopIterations`, cost, tokens) stays correct.
- The `finally` block (~3910) already warns `dag.steering_queue_unconsumed`
  with a count and closes/unregisters the handle. Sealing inside the finalizer
  first makes the route answer 409 before the terminal write, matching the
  Cancel path's ordering.
- `nodeIdleTimedOut` is set only by `withIdleTimeout`'s `onTimeout`; the fail
  branch never touches it, so the `completed via idle timeout` message and the
  `!nodeIdleTimedOut` natural-boundary gate are unreachable from expiry.

## File inventory

| File                                              | Action | Size  | Test impact                                           |
| ------------------------------------------------- | ------ | ----- | ----------------------------------------------------- |
| `packages/workflows/src/dag-executor.ts`          | Modify | ~+80  | Two idle sites, one new finalizer, one exported const |
| `packages/workflows/src/dag-executor.test.ts`     | Modify | ~+260 | New tests in the interrupt describe (T2.x)            |

## Tests before

Inside the existing interrupt/idle describe (its shared `afterEach` already
calls `getSteeringRegistry().clearForTests()`, which after Phase 1 also
restores the default duration — the reset is structural, not a new
`afterEach`). Set `setIdleAwaitInactivityMsForTests(ms)` at the top of each
timer test. Use real short durations (30–80 ms); no fake timers in this file
(plan decision 4).
<!-- Updated: Red Team 2026-09-20 — Assumption Destroyer F1 -->

| ID    | Test                                                         | Required assertion                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2.1  | expiry fails a prompt node on the explicit branch            | Abort-marked result + `interrupt()`; no send. `nodeFailedError(store,'review') === IDLE_AWAIT_EXPIRED_ERROR`; exactly one `node_failed` for `review`; no `node_completed`; last status row is `failed` with that detail; `sendQuery` called once. |
| T2.2  | expiry never takes the completing idle-timeout path          | Platform messages contain no `completed via idle timeout`; the `node_failed` data has no `idle_timeout`/`timed out` wording; the node's return `state` is `failed` (assert via emitter or a downstream `when:` node that must not run).            |
| T2.3  | keepalive extends the deadline                               | Timer 60 ms; after `awaitIdle`, call `handle.keepalive()` at ~40 ms (returns `'rearmed'`); at ~80 ms no `node_failed` yet; by ~160 ms `node_failed` with the exact error.                                                                          |
| T2.4  | send_now before expiry clears the timer                      | Timer 60 ms; `sendNow` at ~10 ms; the redirect turn runs on the interrupted session id (existing assertion); after ≥120 ms total, exactly zero `node_failed` and the node completes normally.                                                    |
| T2.5  | cancel poll still wins during idle-await                     | Timer 500 ms; flip `getWorkflowRunStatus` to `cancelled` after idle; `nodeFailedError === 'Cancelled by user'`; after a further 600 ms there is still exactly one `node_failed` (timer torn down).                                                |
| T2.5b | loop-site cancel during idle tears the timer down too        | Same as T2.5 on a `loop:` node: the terminated fallthrough awaits a status read and a platform message before `failLoopIteration` seals the handle; assert exactly one `node_failed` (`Workflow cancelled`) after a further 600 ms and that `clearTimeout` ran (spy). <!-- Updated: Red Team 2026-09-20 — Failure Mode F3 --> |
| T2.6  | expiry then discard produces one terminal outcome            | Timer 30 ms; after expiry, `discardRun`; exactly one `node_failed` with the expiry error; handle unregistered.                                                                                                                                    |
| T2.7  | loop node expiry fails the iteration through the loop path   | `loop:` node with abort-marked result; `nodeFailedError(store,'my-loop') === IDLE_AWAIT_EXPIRED_ERROR`; a platform message names the iteration; loop `node_failed` data carries `iteration`.                                                       |
| T2.8  | loop_group body expiry fails the group                       | `grp.body` idle → expiry; `nodeFailedError(store,'grp.body') === IDLE_AWAIT_EXPIRED_ERROR` **exactly** on the namespaced body row (the row the dock is mounted on); the outer `grp` row carries the existing composite `Loop-group node 'grp' failed at iteration 1: …` wrapper containing the string; no further iteration starts. <!-- Updated: Red Team 2026-09-20 — Failure Mode F2 --> |
| T2.9  | queued messages at expiry are counted, never drained         | `enqueue` two queue-intent rows while idle; after expiry `mockLogFn` has a `dag.steering_queue_unconsumed` call with `queuedCount: 2`; `sendQuery` called once; no operator rows written.                                                          |
| T2.10 | retry after expiry starts a fresh session                    | Run to expiry (`sessionId: 'sess-1'` on the interrupted turn); run the same DAG again with `retryContext: { targetNodeId: 'review', retryEpoch: 1, invalidatedNodeIds: [] }`; the second `sendQuery`'s resume argument is `undefined`.             |
| T2.11 | interrupted session is never persisted                       | `persist_session: true` variant of T2.10: `store.upsertWorkflowNodeSession` is never called with `'sess-1'`; the retry pass resolves `getWorkflowNodeSession` (returning null) and sends with resume `undefined`.                                 |

## Refactor (protected changes)

1. Export `IDLE_AWAIT_EXPIRED_ERROR = 'interrupted by operator, no redirect
   received'` from `dag-executor.ts` with a docblock: owner-ratified string;
   the web keeps a local copy (Phase 4) — change both together.
2. `raceIdleWake`: no logic change; return type already `SteeringIdleWake`.
   Update its docblock: "First of send_now / expiry / discard / terminal
   status wins".
3. Prompt/command site: add `finishIdleAwaitExpired` beside `finishCancelled`:
   `steeringHandle?.close()`; `getLog().warn({ nodeId, workflowRunId,
   durationMs }, 'dag.node_idle_await_expired')`; `logNodeError(...)`;
   `createWorkflowEvent({ event_type: 'node_failed', data: withLifecycleScopeData(...,
   { error: IDLE_AWAIT_EXPIRED_ERROR, duration_ms, ...iterationData }) })`
   (fire-and-forget with the standard persist-failed catch); `emitter.emit({
   type: 'node_failed', … })`; `await recordFailedStatus(IDLE_AWAIT_EXPIRED_ERROR)`;
   delete the two throttle-map keys; return `{ state: 'failed', output:
   nodeOutputText, error: IDLE_AWAIT_EXPIRED_ERROR }` — no `sessionId`.
   Branch: after the `send_now` `continue turns`, add
   `if (wake.kind === 'expired') return await finishIdleAwaitExpired();`
   before the existing terminated fall-through. Keep the terminated path
   exactly as is.
4. Loop site: after the `send_now` branch add
   `if (wake.kind === 'expired') { steering.steeringHandle?.close(); log
   'loop_node.idle_await_expired'; await safeSendMessage(platform,
   conversationId, \`Loop node '${node.id}' interrupted by operator during
   iteration ${String(i)} — no redirect received\`, msgContext); return await
   failLoopIteration(IDLE_AWAIT_EXPIRED_ERROR, { costUsd: loopTotalCostUsd,
   ...(loopTotalTokens !== undefined ? { tokens: loopTotalTokens } : {}),
   loopIterations: i, data: { iteration: i } }, IDLE_AWAIT_EXPIRED_ERROR); }`
   — same four-argument `safeSendMessage` shape as the terminated branch
   directly below it.
   <!-- Updated: Red Team 2026-09-20 — Assumption Destroyer F4 -->
5. Do not modify `withIdleTimeout`, `nodeIdleTimedOut`, `finishCancelled`, or
   the natural-boundary last gate.
6. Verify the `finally` block still runs `close()` + `unregister` after the
   finalizer (idempotent seal) and still warns on unconsumed queue.

## Tests after

T2.1–T2.11 pass. Existing interrupt describe tests pass unchanged, including
the DeepSeek exactness guard describe that shares the singleton — it must see
the 30-minute default again because `clearForTests()` restores it.

## Regression gate

```bash
bun test packages/workflows/src/dag-executor.test.ts
bun --filter @archon/workflows type-check
bun x eslint packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts --max-warnings 0
```

Pass condition: all tests green; zero lint warnings; no `Bun.sleep`-based test
exceeds 1 s wall time (timers are ≤ 600 ms).

## Test scenario matrix

| Path     | Scenario                                       | Tests          |
| -------- | ---------------------------------------------- | -------------- |
| Critical | explicit fail branch, exact error, once         | T2.1, T2.6     |
| Critical | never the completing idle timeout               | T2.2           |
| Critical | cancel poll reachable; send_now clears timer    | T2.4, T2.5     |
| High     | loop and loop_group parity                      | T2.7, T2.8, T2.5b |
| High     | fresh session on retry; nothing persisted       | T2.10, T2.11   |
| Medium   | keepalive from the handle side extends deadline | T2.3           |
| Medium   | unconsumed queue count for 2.11 recovery        | T2.9           |

## Dependency map

- Requires Phase 1 (`expired` wake, test hook).
- Feeds Phase 4 (error constant spelling) and Phase 5 (E2E observes
  `node_failed.data.error`).

## Risk assessment

- Forgetting the loop site would leave `expired` treated as `terminated`
  there (silent Cancel wording) — T2.7 pins it.
- A retry test that accidentally inherits the cursor from a *previous
  completed* node would mask AC5 — use a single-node DAG in T2.10.

## Security considerations

No message content in any new log line; the warning carries counts and ids
only.

## Rollback

Revert the two files; Phase 1's `expired` wake then falls into the existing
terminated path (a Cancel-worded failure) until re-applied.
