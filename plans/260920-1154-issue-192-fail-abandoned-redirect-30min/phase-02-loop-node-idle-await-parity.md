---
title: 'Phase 2: Loop parity and failure invariants'
status: completed
---

# Phase 2: Loop parity and failure invariants

## Outcome

Apply the fixed idle-after-interrupt expiry to AI loop nodes and prove the complete engine contract for both executor paths.
The loop must fail through its existing iteration and node finalizers, and automatic retry must not start a new loop attempt.

## Source anchors

- `executeLoopNode()` in `packages/workflows/src/dag-executor.ts` has its own interrupted-turn idle block.
- `failLoopIteration()` emits the iteration failure and delegates the single node terminal to `failLoopNode()`.
- The loop's `send_now` branch resumes the interrupted iteration on the same provider session before the ordinary completion checks.
- `runNodeRetryLoop()` wraps the loop result and therefore applies `retry.on_error: all` unless the structured reason blocks it.

## Tests first

Add the loop matrix to `packages/workflows/src/dag-executor.test.ts` before the branch implementation.
Use fake timers and restore them after each test.

1. A Claude loop fixture expires after 1,800,000 milliseconds and returns the exact error.
2. A non-Claude loop fixture with its real abort shape reaches the same result.
3. The persisted node terminal is one `node_failed` event with `failure_reason: 'idle_after_interrupt_timeout'`.
4. One `loop_iteration_failed` diagnostic may also exist, but there must not be a second `node_failed` terminal.
5. No `node_completed` or `loop_iteration_completed` event is emitted for the expired attempt.
6. Composer activity re-arms the full interval without advancing the loop or resolving the idle waiter.
7. `send_now` before expiry resumes the interrupted iteration on its prior session and reaches the normal completion check.
8. Cancel wins through the existing loop cancellation result and leaves no late expiry.
9. `retry.on_error: all` does not execute a second loop provider attempt after expiry.
10. Pending queued message ids have no operator transcript row after expiry.
11. The closed handle retains its pending snapshot until the existing unregister path removes it, so client reconciliation can classify the observed ids as unmatched.

## Implementation

- Pass the loop's interruptible handle to the Phase 1 `raceIdleWake()` call.
- Branch explicitly on `wake.kind === 'expired'` before the terminated path.
- Call `failLoopIteration()` with the exact user-visible error as both the iteration error and its explicit third `nodeError` argument so the default `Loop iteration N failed:` prefix is not used.
- Pass `failure_reason: 'idle_after_interrupt_timeout'` through `LoopFailureExtras.data` so `failLoopNode()` persists it on `node_failed`.
- Extend the loop failure extras with the internal camel-case `failureReason` value and return it on the loop's failed result so the shared retry loop refuses an automatic retry.
- Keep the loop iteration number, cost, token, output, and execution-scope fields that the existing finalizer already owns.
- Do not use the standard-node finalizer inside the loop.
- Do not move expiry after output validation or loop-completion evaluation.

## Engine-wide proof checks

After node and loop coverage is green, add or strengthen focused assertions for these indirect contracts:

- Expiry never calls `upsertWorkflowNodeSession` because the result is failed.
- Expiry never writes an operator transcript row for a queued but undelivered message.
- The existing stream idle timeout still has its old completion behavior and is not called by this path.
- The existing run-status Cancel poll remains reachable with no live stream.
- The registry singleton is empty after executor cleanup.

## Files

| File                                          | Action                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/workflows/src/dag-executor.ts`      | Add the loop expiry branch and structured terminal data.                            |
| `packages/workflows/src/dag-executor.test.ts` | Add loop parity, no-auto-retry, transcript, session-upsert, and cleanup assertions. |

## Verification

```bash
cd packages/workflows
bun test src/dag-executor.test.ts
bun test src/steering-registry.test.ts
bun run type-check
```

## Exit criteria

- [x] Standard and loop nodes use the same fixed handle timer and wake reason.
- [x] Each path uses its own established terminal finalizer.
- [x] Each path persists the same exact error and structured failure reason.
- [x] Neither path automatically retries, completes, persists a session, or writes a queued operator row after expiry.
- [x] Same-session loop redirect and Cancel behavior remain green.

## Risks and rollback

- Skipping `failLoopIteration()` would corrupt loop audit and status accounting.
- Prefixing the node error with loop prose would break the exact product error contract.
- Rollback needs no migration and leaves any already written failure event readable by older code.

## Next phase

Expose authenticated composer activity through the ratified bodyless keepalive route.
