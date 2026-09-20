---
title: 'Phase 1: Handle-owned timer and standard-node expiry'
status: completed
---

# Phase 1: Handle-owned timer and standard-node expiry

## Outcome

Add the fixed inactivity timer to the existing steering handle and route standard AI-node expiry through the same idle waiter used by `send_now` and Cancel.
The standard node must produce one explicit, structured, non-retryable failure.

## Source anchors

- `packages/workflows/src/steering-registry.ts` owns the live handle, idle waiter, `accept()`, and terminal sealing.
- `packages/workflows/src/dag-executor.ts` owns `raceIdleWake()`, `finishCancelled()`, the standard AI turn loop, and `runNodeRetryLoop()`.
- `packages/workflows/src/steering-registry.test.ts` already proves token, idle, close, discard, and send-now first-wins behavior.
- `packages/workflows/src/dag-executor.test.ts` already contains the provider interrupt fixtures and idle-entry helpers.
- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` requires fake timers and at least one Claude and one non-Claude fixture where provider behavior matters.

## Tests first

Add failing tests before implementation.
Use `jest.useFakeTimers()` and restore real timers in `finally` or `afterEach` so the large executor test file cannot leak clock state.
Do not wait on a real 30-minute timer.

### Registry tests

1. `enterIdle()` arms one timer and does not change the node from live idle before 1,800,000 milliseconds.
2. Advancing to 1,800,000 milliseconds resolves the waiter once with `{ kind: 'expired' }`, clears the projected sub-state, and closes the handle.
3. A new `send_now` id after expiry receives `closed` and cannot drain the pending queue.
4. Composer activity at any point before expiry does not resolve the waiter and gives the handle a fresh full 1,800,000-millisecond interval.
5. Activity on generating, parked, or closed handles is a no-op and creates no timer.
6. `send_now` before expiry clears the timer, resolves with the accepted batch in order, and produces no late expiry after fake time advances again.
7. Idle termination before expiry clears the timer and resolves with `terminated`.
8. Expiry, `send_now`, and idle termination are first-wins in both deterministic call orders.
9. `close()`, `park()`, `discard()`, `unregister()`, and `clearForTests()` leave no live idle timer.
10. Duplicate accepted ids keep the existing idempotency contract after close; use a new id when asserting the closed refusal.

### Standard-node executor tests

1. Drive a Claude fixture to idle, advance fake time to the deadline, and assert one `node_failed` event with the exact error and structured failure reason.
2. Repeat the expiry case with one non-Claude interrupt fixture that uses its shipped abort shape.
3. Assert no `node_completed` event, no completing stream-idle-timeout message, and no `nodeIdleTimedOut` completion behavior.
4. With `retry.on_error: all`, assert the provider starts only one attempt and no retry notice or retry delay is scheduled.
5. Re-arm with handle composer activity before the original deadline, prove the node remains idle past that old deadline, and then prove it fails after one fresh full interval.
6. Let `send_now` win and assert same-session continuation, timer cleanup, and no later failure.
7. Let the terminal-status poll win while there is no stream and assert the unchanged Cancel failure family.
8. Exercise both boundary orders for `send_now` and expiry and assert that only one result is observable.

## Implementation

### `packages/workflows/src/steering-registry.ts`

- Extend `SteeringIdleWake` with `{ readonly kind: 'expired' }`.
- Add one private timeout field to `NodeSteeringHandle`.
- Keep the fixed 1,800,000-millisecond constant module-local.
- Add private helpers that arm, clear, and expire the idle timer.
- Arm the timer inside `enterIdle()` after the waiter is installed.
- Add `recordComposerActivity(): void` to re-arm only a live idle handle with an active waiter.
- Add an idle-only `terminateIdleAwait(): void` for the executor's run-status poll.
- Make `terminateIdleAwait()` close the handle and resolve the waiter with `terminated` in one synchronous mutation.
- Make expiry close the handle and resolve the waiter with `expired` in one synchronous mutation.
- Clear the timer before `accept(..., 'send_now')` resolves the waiter.
- Clear the timer in the shared terminal `seal()` path.
- Make `SteeringRegistry.unregister()` close the handle before deleting it.
  This prevents an active timer from surviving registry removal through another held handle reference without broadening `discard()` beyond its current run-cleanup and test-cleanup contract.
- Preserve pending queue entries until existing unregister or discard cleanup so terminal reconciliation remains truthful.

Do not add a generic timer service, event emitter, activity listener registry, or clock dependency.
The handle already owns the state that the timer bounds.

### `packages/workflows/src/dag-executor.ts`

- Change `raceIdleWake()` to receive the handle.
- Keep the immediate status check and the existing 10-second poll cadence.
- When a non-continuing run status is read, call `handle.terminateIdleAwait()` instead of resolving a separate race promise.
- Await the one handle waiter and stop the status poll after any wake.
- Add module-local constants for the exact failure error and `idle_after_interrupt_timeout` reason.
- Add `failureReason?: 'idle_after_interrupt_timeout'` as an internal optional field on `NodeExecutionResult`, not on the public `NodeOutput` schema.
- Let the generic retry helper accept a `NodeOutput` with that optional internal field so deterministic results remain valid callers.
- Make `shouldRetryNodeFailure()` return false for this structured reason before ordinary transient or `on_error: all` classification.
- Add a `finishIdleExpired()` finalizer beside `finishCancelled()`.
- Close is already complete when expiry wakes, but call the idempotent close gate if that keeps the finalizer consistent.
- Persist `node_failed` with the exact error, `failure_reason`, duration, lifecycle scope, and existing iteration data.
- Emit one `node_failed` event, record failed status, clear the existing throttle maps, and return a failed result with the structured reason.
- Add an explicit `wake.kind === 'expired'` branch before the terminated branch.

Do not throw the expiry error through the broad outer catch.
That would risk a second failure event and would lose the explicit retry policy.

## Files

| File                                               | Action                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/workflows/src/steering-registry.ts`      | Modify the handle-owned idle lifecycle.                                                 |
| `packages/workflows/src/steering-registry.test.ts` | Add fake-timer, re-arm, cleanup, and first-wins tests.                                  |
| `packages/workflows/src/dag-executor.ts`           | Settle Cancel through the handle and add the standard expiry finalizer and retry guard. |
| `packages/workflows/src/dag-executor.test.ts`      | Add standard-node lifecycle tests with Claude and a non-Claude fixture.                 |

## Verification

Run the narrow tests from their package directory.
Do not run root `bun test`.

```bash
cd packages/workflows
bun test src/steering-registry.test.ts
bun test src/dag-executor.test.ts
bun run type-check
```

## Exit criteria

- [x] Every registry settlement clears its timeout and resolves the idle waiter at most once.
- [x] Standard-node expiry produces one exact, structured failure.
- [x] Automatic node retry cannot restart the abandoned redirect.
- [x] Cancel and same-session `send_now` behavior remain unchanged.
- [x] No public timeout option or workflow-language field exists.

## Risks and rollback

- A leaked timer can retain a handle and fire against a later state, so every seal and send-now test must advance fake time after settlement.
- A Cancel poll that remains a separate `Promise.race` participant can leave the handle timer live, so the poll must settle through the handle.
- Rollback removes only in-memory behavior and needs no data rollback.

## Next phase

Apply the same terminal reason and non-retryable result to `executeLoopNode` without bypassing loop iteration accounting.
