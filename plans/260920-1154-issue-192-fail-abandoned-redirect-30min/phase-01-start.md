---
title: "Phase 1: Registry + executor idle-await expiry core"
status: todo
---

# Phase 1: Registry + executor idle-await expiry core

> This is the fully-detailed `--deep` Phase 1 — the atomicity design lives here. Phases 2–5 build
> on the primitives and constants introduced in this phase.

## Context links

- Spec authority: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (Story 2.12).
- Mechanism: `_bmad-output/specs/spec-agent-node-room/engine-integration.md` §2 (idle-await bound),
  `control-states.md` (idle-after-interrupt row), `steering-test-plan.md` (idle-await fake-timer
  section).
- Scout reports: `plans/reports/scout-260920-1843-executor-fail-retry.md`,
  `plans/reports/scout-260920-1843-server-steering-routes.md`.

## Overview

Add a fixed, injectable-duration 30-minute inactivity timer to the `idle-after-interrupt`
lifecycle so an abandoned steer **fails once** (`interrupted by operator, no redirect received`)
instead of waiting forever. Expiry resolves **through** the handle's single idle-waiter slot so
once-only is structural. Composer activity re-arms the timer; `Send now` and Cancel are unchanged.

## Key insights (from source, cite when defending)

- `raceIdleWake` (`packages/workflows/src/dag-executor.ts:521-557`) today races `waiter`
  (`send_now`/`terminated` from `NodeSteeringHandle.enterIdle`) against a terminal-status
  cancel-poll (`setTimeout(tick, CANCEL_CHECK_INTERVAL_MS)`, `:539/:543`). **No 30-min bound.**
- `NodeSteeringHandle.enterIdle(token)` (`steering-registry.ts:267-282`) returns one
  `Promise<SteeringIdleWake>` stored as `idleWaiter`, resolved by `accept(..,'send_now')`
  first-wins (`:308-323`) or terminal `seal()` (`:430-442`). There is **no** activity/keepalive
  primitive on the handle (verified against its full public surface).
- Node idle-await handling: `dag-executor.ts:3571-3583` — `enterIdle` → `raceIdleWake` →
  `send_now` continues (`continue turns`), else `finishCancelled()`. `finishCancelled`
  (`:3274-3312`) is the fail-shape template (close handle → `createWorkflowEvent(node_failed)` →
  `emitter.emit(node_failed)` → `recordFailedStatus` → clear throttle maps → `return
  {state:'failed',...}`). `recordFailedStatus(error)` = `recordNodeStatus('failed', error)`
  (`:2185`).
- Teardown is a single `getSteeringRegistry().unregister(runId, stepName)` in
  `executeNodeInternal`'s `finally` (`:3910-3927`); queued items die with the handle → 2.11 reads
  them as unmatched.
- **Testability constraint:** the existing `#183` steering suite (`dag-executor.test.ts:27286+`)
  uses real timers + `awaitIdle()` (`Bun.sleep(1)` polling) and never lets `raceIdleWake`'s
  `setTimeout` fire; `setSystemTime` cannot fast-forward a real timer. So the idle-await timeout
  **must be an injectable parameter** (precedent: `withIdleTimeout(gen, timeoutMs, …)` tested
  with small ms values).

## Requirements

- [ ] Registry: `SteeringIdleWake` gains `{ readonly kind: 'expired' }`.
- [ ] Registry: `NodeSteeringHandle.expireIdle()` — one synchronous mutation that resolves the
      live `idleWaiter` with `{ kind: 'expired' }` and seals the handle (later `accept` →
      `{ ok:false, reason:'closed' }`). Idempotent no-op when not idle/no waiter.
- [ ] Registry: composer-activity relay — `setComposerActivityListener(cb)` /
      `clearComposerActivityListener()` (executor-owned re-arm callback) and
      `recordComposerActivity()` that synchronously invokes the listener **only** on a live idle
      handle (no-op otherwise, incl. `generating`, `parked`, `closed`). Records no time.
- [ ] Executor: export `IDLE_AWAIT_TIMEOUT_MS = 30 * 60_000` and
      `IDLE_AWAIT_NO_REDIRECT_ERROR = 'interrupted by operator, no redirect received'`
      (behavior-named constants; **no** story/phase id in the name or the string beyond the spec
      wording).
- [ ] Executor: `raceIdleWake` extended to `(deps, workflowRunId, waiter, handle, idleTimeoutMs)`
      — arm a one-shot `setTimeout(() => { if (!stopped) handle.expireIdle() }, idleTimeoutMs)`,
      register a re-arm listener that `clearTimeout`+re-arms, and on settle set `stopped`,
      `clearTimeout`, `clearComposerActivityListener()`.
- [ ] Executor: inject `idleTimeoutMs` via an optional `ExecuteWorkflowOptions.idleAwaitTimeoutMs`
      (defaults to `IDLE_AWAIT_TIMEOUT_MS`) — an internal/test seam, **not** a YAML/config knob
      (NFR6 fixed).
- [ ] Executor (node path `:3571`): add `wake.kind === 'expired'` branch that fails the node with
      `IDLE_AWAIT_NO_REDIRECT_ERROR` (mirror `finishCancelled` shape, emit `node_failed`, return
      `{ state:'failed' }`), and **never** sets `nodeIdleTimedOut` / emits `node_completed`.

## Architecture / data flow

```
Stop → interrupt() → executor classifies → enterIdle(token) ─┐
                                                             ├─ raceIdleWake(waiter, handle, ms):
keepalive route → handle.recordComposerActivity() ──────────┘     arm one-shot expiry timer (ms)
        │                                                          register re-arm listener
        └─(only on live idle handle)→ listener() → clearTimeout + re-arm
Send now → accept(msg,'send_now') → resolves idleWaiter {send_now}  ─┐
Cancel   → run status flips → cancel-poll resolves {terminated}     ─┼─ Promise.race([waiter, poll])
expiry   → timer → handle.expireIdle() → resolves idleWaiter {expired}┘   → stopped; clearTimeout; clear listener
                                                                          → wake.kind:
                                                                             send_now → continue turns
                                                                             terminated → finishCancelled()
                                                                             expired → FAIL (no-redirect)
```

Once-only is structural: `expireIdle` and `accept('send_now')` both mutate the same handle on the
single event-loop thread; whichever runs first resolves the one `idleWaiter`, the other sees a
sealed/generating handle and no-ops (`accept` → `closed`, `expireIdle` → not-idle no-op).

## Related code files

| File | Action | Notes |
|---|---|---|
| `packages/workflows/src/steering-registry.ts` | modify | `SteeringIdleWake` variant; `expireIdle`; activity-listener trio; extend `seal`/phase docs |
| `packages/workflows/src/dag-executor.ts` | modify | constants; `raceIdleWake` signature + timer; node `expired` fail branch; thread `idleAwaitTimeoutMs` |
| `packages/workflows/src/steering-registry.test.ts` | modify | unit tests for `expireIdle`, activity relay, once-only |
| `packages/workflows/src/dag-executor.test.ts` | modify | engine idle-await lifecycle tests (injected small timeout) |

## TDD — Tests Before (write first, must fail before code)

Registry (`steering-registry.test.ts`), synchronous, no timers:

1. `expireIdle` on an idle handle resolves the waiter with `{ kind:'expired' }` and seals it →
   a subsequent `accept(msg,'send_now')` returns `{ ok:false, reason:'closed' }`.
2. `expireIdle` on a `generating` / non-idle / already-sealed handle is a no-op (waiter, if any,
   unresolved; phase unchanged).
3. Once-only race: after `enterIdle`, calling `accept(msg,'send_now')` first then `expireIdle`
   resolves the waiter with `send_now` and `expireIdle` is a no-op (and vice-versa — `expireIdle`
   first wins, later `send_now` → `closed`).
4. `recordComposerActivity()` invokes a registered listener exactly once per call **only** while
   idle; is a silent no-op on generating/parked/closed and after `clearComposerActivityListener`.
5. `recordComposerActivity()` never resolves the waiter and never changes `subState`.

Engine (`dag-executor.test.ts`), inject `idleAwaitTimeoutMs` small (e.g. `40`); one Claude and one
non-Claude (omp/codex) fixture per applicable case:

6. Interrupt → idle; no activity for > injected timeout → node fails once with
   `IDLE_AWAIT_NO_REDIRECT_ERROR`; assert a single `node_failed` event, `state:'failed'`, and the
   **negatives**: no `node_completed`, `nodeIdleTimedOut` never set, no "completed via idle
   timeout" log/text.
7. Interrupt → idle; `recordComposerActivity()` at ~½ the interval, repeated, keeps the node
   alive past the original deadline; it fails only after a full fresh interval of silence.
8. Interrupt → idle; `Send now` before expiry drains + continues on the same session
   (`attemptResumeId`), timer cleared, no late fail.
9. Interrupt → idle; run status flips (Cancel) → cancel-poll wins → existing `finishCancelled`
   path, timer cleared, no fail-with-no-redirect string.
10. `Send now` racing expiry: after driving to the boundary, a drained `send_now` yields a live
    turn OR the expiry fail — but **never** a success receipt on a failed node (assert the
    handle/queue/transcript are mutually consistent with the single winner).

## Refactor (protected changes)

- `raceIdleWake` signature change ripples to its two call sites (node `:3572`, loop Phase 2
  `:~7196`) — update both; keep the cancel-poll block byte-for-byte, only add the expiry timer +
  listener alongside it and the shared teardown.
- `ExecuteWorkflowOptions` gains one optional field; default preserves production behavior
  (30 min) so every existing test is unaffected.

## TDD — Tests After (new behavior)

- The tests in *Tests Before* items 1–10 now pass.
- Add a guard test that the default (no injected `idleAwaitTimeoutMs`) resolves to
  `IDLE_AWAIT_TIMEOUT_MS` (assert the exported constant equals `1_800_000`).

## Todo

- [ ] Write registry unit tests (1–5); run — they fail.
- [ ] Write engine idle-await tests (6–10) with injected timeout; run — they fail.
- [ ] Implement `SteeringIdleWake` variant + `expireIdle` + activity-listener trio.
- [ ] Implement executor constants + `raceIdleWake` timer/listener + node `expired` fail branch +
      options threading.
- [ ] Green all Phase 1 tests.

## Success criteria

- [ ] `bun test packages/workflows/src/steering-registry.test.ts` green.
- [ ] `bun test packages/workflows/src/dag-executor.test.ts` green (new idle-await cases).
- [ ] `bun --filter @archon/workflows type-check` clean.

## Regression gate

```
bun test packages/workflows/src/steering-registry.test.ts
bun test packages/workflows/src/dag-executor.test.ts
bun --filter @archon/workflows type-check
```

## Risk assessment

- **Timer leak**: an unresolved timer after settle → assert `clearTimeout` on all three wake kinds
  and on `park`/`discard` teardown (mirror the `stopped` flag already in `raceIdleWake`).
- **Listener re-entrancy**: `recordComposerActivity` firing after settle → gate the listener on
  `stopped` and drop it in teardown; registry no-ops when not idle.
- **Wrong fail family**: node path must use the `finishCancelled`-shaped node fail — **not** the
  loop family (that is Phase 2). Keep them distinct.

## Security considerations

None new — no new data stored, no new external surface (route is Phase 3). Message content is
never logged (registry invariant preserved).

## Next steps

Phase 2 applies the identical timer to `executeLoopNode` using its own fail family.
