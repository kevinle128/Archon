---
phase: 1
title: 'Phase 1: Registry inactivity timer and keepalive'
status: pending
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Registry inactivity timer and keepalive

## Goal

Make the existing idle waiter expire after a fixed 30 minutes of inactivity,
re-arm it without waking the executor, and preserve the handle's existing
first-wins semantics. Provide deterministic test control without changing the
production singleton or sleeping on millisecond timers.

## Evidence and constraints

- Owner: `packages/workflows/src/steering-registry.ts`; tests:
  `packages/workflows/src/steering-registry.test.ts`.
- `enterIdle()` installs one `idleWaiter`. `send_now` and `seal()` already take
  and clear that waiter synchronously.
- Park, close, discard, `closeIfEmpty`, and `clearForTests` all flow through
  `seal()`/`discard()`; cancelling the timer there covers every teardown.
- Queue-intent acceptance while idle must remain queued and must neither wake
  nor re-arm the timer.
- The duration is a fixed product rule, not workflow/configuration syntax.
- Use the codebase's existing timer `unref` convention: cast the returned
  handle to `{ unref?: () => void }`, test its presence, then call it.

## Files

| File                                               | Action                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/workflows/src/steering-registry.ts`      | Add timer, scheduler seam, keepalive, wake kind, gated E2E duration resolver |
| `packages/workflows/src/steering-registry.test.ts` | Add deterministic lifecycle and resolver coverage                            |

## Design

1. Export
   `STEERING_IDLE_AWAIT_INACTIVITY_MS = 30 * 60_000` and extend
   `SteeringIdleWake` with `{ readonly kind: 'expired' }`.
2. Define a narrow scheduler type:

   ```ts
   type ScheduleIdleExpiry = (callback: () => void, delayMs: number) => () => void;
   ```

   Its production implementation creates one timeout, conditionally `unref`s
   it, and returns an idempotent function that clears it. Export the production
   function only with `@internal` if direct testing is needed.

3. `SteeringRegistry` accepts optional `idleAwaitInactivityMs` and
   `scheduleIdleExpiry` constructor options and supplies both to new handles.
   `createSteeringRegistry(options?)` forwards them. Existing register callers
   and per-handle `interruptible` options stay unchanged.
4. Store one `cancelIdleExpiry` function and a monotonic expiry generation on
   `NodeSteeringHandle`. `enterIdle(token)` installs the waiter first and then
   arms the timer. Re-arm invalidates the prior generation, cancels its job,
   and schedules a callback carrying the new generation.
5. Expiry first verifies that its captured generation is still current. A
   stale/cancelled callback is inert even if the scheduler invokes it. The
   current expiry clears its cancellation slot, synchronously takes and clears
   `idleWaiter`, and resolves `{ kind: 'expired' }`. It does not change phase,
   sub-state, queue, accepted-id memory, or turn state. Until executor teardown,
   queue-intent messages still receive `awaiting_send_now` and remain available
   to terminal reconciliation.
6. Add `keepalive(): 'rearmed' | 'not_idle'`. Return `rearmed` only when the
   handle is interruptible, `phase === 'live'`, sub-state is
   `idle-after-interrupt`, and the waiter still exists. Otherwise change
   nothing and return `not_idle`.
7. In the synchronous `send_now` release, cancel the timer before resolving
   the waiter. In `seal()`, cancel before resolving `terminated`. These are the
   only shared settlement points.
8. Add a narrow `@internal expireIdleForTests(): void` that invokes the same
   expiry transition (and cancels any scheduled job first). Executor tests use
   this instead of a mutable singleton duration.
9. Add `resolveIdleAwaitInactivityMs(environment)` and have singleton
   construction pass the runtime environment. It returns the production
   constant unless `ARCHON_E2E_FAKE_PROVIDER === '1'` exactly. Under that gate,
   accept `ARCHON_E2E_STEERING_IDLE_AWAIT_MS` only when it parses to an integer
   in `[1, STEERING_IDLE_AWAIT_INACTIVITY_MS]`; malformed, zero, negative,
   exponential overflow, fractional, and over-default values fall back.
10. Update module/type comments to distinguish timer expiry from the
    completing stream idle timeout. Add no config key, YAML field, database
    state, or message-content logging.

## Tests first

Build a small manual scheduler in the test file: collect scheduled jobs and
their delays, expose `fire(job)` and cancellation state, and never advance
global clocks.

| ID    | Case                              | Required assertions                                                                                                                                                         |
| ----- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1.1  | Production default                | Constant equals `1_800_000`; a default registry schedules that exact delay on idle entry.                                                                                   |
| T1.2  | Expiry                            | Firing the active job resolves the waiter once as `expired`; `keepalive()` is then `not_idle`.                                                                              |
| T1.3  | Re-arm                            | `keepalive()` cancels the prior job, schedules one new full-duration job, leaves the waiter pending, and preserves `idle-after-interrupt`. Firing a cancelled job is inert. |
| T1.4  | State guard                       | Generating, between-turn, queue-only, parked, closed, and already-expired handles return `not_idle` without scheduling. Only live idle returns `rearmed`.                   |
| T1.5  | `send_now` wins                   | It cancels the job, drains once in accepted order, resolves `send_now`, and a later forced callback cannot resolve again.                                                   |
| T1.6  | Queue intent                      | It neither re-arms nor resolves; expiry leaves the row pending with `awaiting_send_now`.                                                                                    |
| T1.7  | Every seal wins                   | close, park, discard, `closeIfEmpty`, and `clearForTests` cancel the active job and resolve `terminated` once.                                                              |
| T1.8  | Post-expiry reconciliation window | Phase remains live/idle; queue acceptance succeeds; `pendingCount()` reflects the row; `closeIfEmpty()` is false while queued.                                              |
| T1.9  | Deterministic first-wins orders   | Drive send then expiry, expiry then send, and teardown then expiry. In every order the waiter has one result and no queue is silently drained.                              |
| T1.10 | Registry isolation                | Two registries with different duration/scheduler options schedule independently; clearing one does not alter the other or any singleton setting.                            |
| T1.11 | E2E env gate                      | Exact fake flag plus valid lower duration is accepted. Unset/`true`/`false`/`0` fake flag, invalid duration, fraction, and value above 30 minutes all return default.       |
| T1.12 | Production scheduler              | The timeout is conditionally unref'd and its returned cancel function clears it once; test with spies/fake handles, not fake clocks.                                        |

## Verification

```bash
bun test packages/workflows/src/steering-registry.test.ts
bun --filter @archon/workflows type-check
bun x eslint packages/workflows/src/steering-registry.ts packages/workflows/src/steering-registry.test.ts --max-warnings 0
```

All existing interruption, park/resume, discard, and queue tests must remain
green. No test may leave an idle handle or real timeout alive.

## Risks and rollback

- A stale callback cannot win after re-arm because both cancellation and the
  captured generation guard the expiry transition.
- The E2E override cannot shorten a normal install because both the exact fake
  flag and bounds check are required.
- Deploy and revert this phase with Phase 2. Reverting Phase 2 alone would
  misclassify the new wake. There is no data rollback.
