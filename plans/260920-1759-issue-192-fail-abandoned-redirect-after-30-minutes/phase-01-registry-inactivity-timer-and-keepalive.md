---
phase: 1
title: 'Phase 1: Registry inactivity timer and keepalive'
status: pending
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: Registry inactivity timer and keepalive

## Goal

Give `NodeSteeringHandle` a fixed 30-minute inactivity timer that is armed on
idle entry, re-armed by `keepalive()`, cleared by `Send now` and every seal,
and resolves the existing single-resolve idle waiter with a new `expired` wake
— so exactly-once resolution is inherited from the waiter the executor already
parks on, and the duration is injectable for tests and the E2E runtime.

## Context links

- `packages/workflows/src/steering-registry.ts` — `enterIdle`, `accept`,
  `seal`, `SteeringIdleWake`, `SteeringRegistry`, `getSteeringRegistry`,
  `createSteeringRegistry`, `clearForTests`.
- `packages/workflows/src/steering-registry.test.ts` — describes
  `accept + enterIdle`, `interrupt`, `discardRun`, `park/resume/close`.
- `_bmad-output/specs/spec-agent-node-room/engine-integration.md` — "The
  idle-await bound" paragraph and step 2 of the multi-turn loop.
- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` — "Engine —
  idle-await lifecycle (fake timers)".
- `packages/providers/src/e2e-fake/registration.ts` — the
  `ARCHON_E2E_FAKE_PROVIDER` env-gate precedent.

## Key insights

- The waiter created by `enterIdle` is the single point of resolution; a timer
  that resolves it is automatically exclusive with `send_now` and `seal`
  because each clears `idleWaiter` before resolving.
- Bun 1.3.14 supports `jest.useFakeTimers()`, but `Bun.sleep` hangs under
  fake timers and a test that throws before `afterEach` restores real timers
  would stall every later describe on Bun's 5000 ms timeout (the "bimodal"
  class in AGENTS.md). Decision: **no fake timers anywhere in this plan.**
  Registry tests use short injected durations (5–40 ms); the 30-minute default
  is proven by spying on `globalThis.setTimeout` and asserting the delay
  argument.
  <!-- Updated: Red Team 2026-09-20 — Assumption Destroyer F5 -->
- The timer must never keep the process alive on its own: call `.unref?.()`
  on the returned handle (Bun returns a `Timer` with `unref`), guarded so the
  browser-free type is not assumed.

## File inventory

| File                                                  | Action | Size   | Test impact                                          |
| ----------------------------------------------------- | ------ | ------ | ---------------------------------------------------- |
| `packages/workflows/src/steering-registry.ts`         | Modify | ~+90   | New behaviour under test; existing tests unchanged   |
| `packages/workflows/src/steering-registry.test.ts`    | Modify | ~+220  | New `idle-await inactivity timer` describe (T1.x)    |

No new files. No changes to `dag-executor.ts` in this phase (Phase 2 consumes
the new wake kind; until then the executor's `wake.kind` switch is exhaustive
on `send_now`/else and treats `expired` like `terminated` — acceptable for
one commit, but Phase 2 must land before release).

## Tests before (write first, watch them fail)

Add `describe('idle-await inactivity timer', …)` to
`steering-registry.test.ts`. Use `createSteeringRegistry({ idleAwaitInactivityMs })`
with real short durations for every case; for the default-duration case use
`spyOn(globalThis, 'setTimeout')` and restore it in the test's `finally`.

| ID    | Test                                                     | Required assertion                                                                                                                                                                                |
| ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1.1  | default duration is exactly 30 minutes                   | `STEERING_IDLE_AWAIT_INACTIVITY_MS === 30 * 60_000`; a registry built with no option arms `enterIdle` via `setTimeout(fn, 1_800_000)` (spy on `globalThis.setTimeout`, restored in `finally`); the waiter is then resolved by `close()` so no real timer survives. |
| T1.2  | expiry resolves the idle waiter exactly once             | With `idleAwaitInactivityMs: 20`, `await enterIdle(t)` yields `{ kind: 'expired' }`; a second `enterIdle` is impossible (no live turn) and `keepalive()` afterwards returns `'not_idle'`.        |
| T1.3  | keepalive re-arms without resolving idle-await           | `idleAwaitInactivityMs: 30`: call `keepalive()` at 20 ms and 40 ms; the waiter is still pending at 55 ms and resolves `expired` by ~75 ms. `steeringSubState()` stays `idle-after-interrupt`.      |
| T1.4  | keepalive returns `'rearmed'` only while idle             | Live generating handle (after `beginTurn`) → `'not_idle'`; between turns (settled) → `'not_idle'`; idle → `'rearmed'`; closed/parked → `'not_idle'`; queue-only handle → `'not_idle'`.         |
| T1.5  | send_now cancels the timer                               | Idle handle with 20 ms timer; `accept(msg,'send_now')` at 5 ms resolves `send_now`; after 40 ms no further resolution and no thrown/unhandled rejection; `pendingCount()` is 0.                   |
| T1.6  | queue-intent accept does not re-arm or resolve           | Idle handle with 30 ms timer; `accept(msg,'queue')` at 5 ms; waiter still resolves `expired` at ~30 ms (not ~35 ms) and the message remains pending (`pendingCount() === 1`).                     |
| T1.7  | seal paths clear the timer                               | For `close()`, `park()`, and `discardRun()` with a 10 ms timer: waiter resolves `terminated`; after 30 ms real time there is no second resolution (counter on `.then`) and `clearTimeout` was called (spy).   |
| T1.8  | expiry leaves the handle live and idle-projecting        | After `expired`, `phase` is `live`, `steeringSubState()` is `idle-after-interrupt`, `accept(msg,'queue')` still succeeds with `awaiting_send_now`, and `closeIfEmpty()` returns `false`.           |
| T1.9  | expiry racing send_now is first-wins                     | 10 ms timer: `accept(msg,'send_now')` at 0 ms → waiter resolved `send_now` once and nothing after 30 ms; separately, `await` the expiry then `accept(msg,'send_now')` → `expired` once, the send lands `awaiting_send_now`, `pendingCount() === 1`. |
| T1.10 | injectable duration is per registry; test hook resets    | Two registries with different `idleAwaitInactivityMs` arm different timers; `setIdleAwaitInactivityMsForTests(5)` affects handles registered afterwards only; **`clearForTests()` restores the default** so the shared executor-suite `afterEach` structurally undoes any override. |
| T1.11 | singleton env gate is exact and bounds-checked           | `resolveIdleAwaitInactivityMs(env)` returns the 30-minute default unless `env.ARCHON_E2E_FAKE_PROVIDER === '1'` **exactly** (`'true'`, `'0'`, `'false'`, unset → default even with the ms var set); with the flag `'1'`: `'5'` → 5; `'0'`, `'-1'`, `'1e999'`, `'abc'`, `''` → default (guard: `Number.isSafeInteger(n) && n > 0`). |
| T1.12 | timer does not hold the event loop                       | The armed timer's handle has `unref` invoked when available (spy on `globalThis.setTimeout` return or assert the handle's `hasRef?.() === false`).                                                |

Run: `bun test packages/workflows/src/steering-registry.test.ts` — T1.x must
fail (missing exports/methods) before the refactor.

## Refactor (protected changes)

1. Export `STEERING_IDLE_AWAIT_INACTIVITY_MS = 30 * 60_000` with a docblock
   citing NFR6 and the owner-ratified value.
2. Extend `SteeringIdleWake` with `{ readonly kind: 'expired' }` and update
   the docblock: `expired` means the fixed inactivity timer fired first — the
   executor takes its explicit fail branch, never the completing idle timeout.
3. `NodeSteeringHandle` constructor accepts
   `{ interruptible?: boolean; idleAwaitInactivityMs?: number }`; store
   `idleAwaitInactivityMs` (default the constant). Add private
   `idleTimer: ReturnType<typeof setTimeout> | undefined`.
4. Private `armIdleTimer()`: clear any existing timer; `setTimeout(() =>
   this.expireIdle(), ms)`; call `.unref?.()`. Private `clearIdleTimer()`.
5. Private `expireIdle()`: `this.idleTimer = undefined`; if `idleWaiter` is
   undefined return; otherwise take and clear the waiter and resolve
   `{ kind: 'expired' }`. Do not change `phase` or `subState`.
6. `enterIdle(token)`: after creating the waiter, `armIdleTimer()`.
7. `keepalive(): 'rearmed' | 'not_idle'`: return `'not_idle'` unless
   `interruptible && phase === 'live' && subState === 'idle-after-interrupt'
   && idleWaiter !== undefined`; otherwise `armIdleTimer()` and return
   `'rearmed'`. Never touches the queue, accepted map, or turn state.
8. `accept()`: in the first-wins `send_now` release block, `clearIdleTimer()`
   before resolving the waiter.
9. `seal()`: `clearIdleTimer()` before resolving the waiter `terminated`.
10. `SteeringRegistry` constructor accepts `{ idleAwaitInactivityMs?: number }`
    and passes it to every `new NodeSteeringHandle`. Add
    `setIdleAwaitInactivityMsForTests(ms: number | undefined)` next to
    `clearForTests()` with the same `@internal` framing, and make
    `clearForTests()` also reset the override to the constructor value — the
    executor suite's existing shared `afterEach` already calls
    `clearForTests()`, so a Phase 2 test that throws or times out can never
    leak a shortened timer into later describes.
    <!-- Updated: Red Team 2026-09-20 — Assumption Destroyer F1 -->
11. `createSteeringRegistry(options?)` forwards the option.
12. `resolveIdleAwaitInactivityMs(env: NodeJS.ProcessEnv = process.env)`
    (exported with an `@internal` docblock for T1.11): returns the default
    unless `env.ARCHON_E2E_FAKE_PROVIDER === '1'` — an **exact** string
    comparison, deliberately stricter than `registerE2eFakeProvider`'s
    truthiness check (`registration.ts:16`), because `'false'`/`'0'` are truthy
    strings; then parses `ARCHON_E2E_STEERING_IDLE_AWAIT_MS` with `Number()`
    and accepts it only when `Number.isSafeInteger(n) && n > 0`, else the
    default. `getSteeringRegistry()` constructs the singleton with it. Comment:
    env-gated test seam, no-op in production. (Hardening the fake-provider
    gate itself is out of this story's scope — note it in the PR.)
    <!-- Updated: Red Team 2026-09-20 — Security F1, F5 -->
13. Update the module header docblock's per-turn paragraph with one sentence on
    the inactivity timer and `keepalive()`.

## Tests after (new behaviour)

All T1.x pass. Additionally re-run the existing `accept + enterIdle`,
`interrupt`, `discardRun`, and `park/resume/close` describes unchanged — they
must not require edits (the timer is invisible unless it fires, and their
handles are sealed or resolved within milliseconds).

## Regression gate

```bash
bun test packages/workflows/src/steering-registry.test.ts
bun --filter @archon/workflows type-check
bun x eslint packages/workflows/src/steering-registry.ts packages/workflows/src/steering-registry.test.ts --max-warnings 0
```

Pass condition: every test in the file passes; typecheck and lint report zero
errors and zero warnings; no test leaves a pending timer (every idle handle is
resolved or sealed before the test returns).

## Test scenario matrix (deep mode)

| Path     | Scenario                                                  | Tests        |
| -------- | --------------------------------------------------------- | ------------ |
| Critical | expiry resolves once; send_now/seal clear timer           | T1.2,5,7,9   |
| Critical | keepalive re-arms only while idle and never resolves      | T1.3,4       |
| High     | default value is 30 minutes; injectable per registry      | T1.1,10      |
| High     | env gate cannot shorten the timer without the fake flag   | T1.11        |
| Medium   | post-expiry handle state is live/idle until executor seal | T1.8         |
| Medium   | queue-intent accept is inert for the timer                | T1.6         |
| Medium   | unref'd timer                                             | T1.12        |

## Dependency map

- Feeds Phase 2 (`expired` wake + `setIdleAwaitInactivityMsForTests`).
- Feeds Phase 3 (`keepalive()` return contract).
- Feeds Phase 5 (`ARCHON_E2E_STEERING_IDLE_AWAIT_MS` gate).

## Risk assessment

- Timer leakage between tests → every test seals or resolves its handles
  before returning, and `clearForTests()` resets the duration override.
- A future refactor that resolves the waiter without clearing the timer →
  T1.7/T1.9 pin the invariant; `expireIdle` also guards on a missing waiter.

## Security considerations

None new: no message content is logged; the env gate is inert unless the
fake-provider flag is exactly `'1'`, and the parsed value is bounds-checked.

## Rollback

Revert the two files. The `expired` union member is additive; nothing
downstream is consumed until Phase 2.
