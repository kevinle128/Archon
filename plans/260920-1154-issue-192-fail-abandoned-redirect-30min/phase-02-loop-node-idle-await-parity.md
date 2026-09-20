---
title: "Phase 2: Loop-node idle-await parity"
status: todo
---

# Phase 2: Loop-node idle-await parity

## Context links

- Phase 1 (primitives + constants reused here).
- `steering-test-plan.md`: *"every engine turn-loop assertion also runs against
  `executeLoopNode` … plus the loop-only case — `Send now` continues the interrupted iteration
  on the same session before the normal loop-completion check."*
- Scout: `plans/reports/scout-260920-1843-executor-fail-retry.md` (loop fail family).

## Overview

AI loop nodes are steerable in v1, so the 30-minute idle-await bound must apply identically to
`executeLoopNode`. The only difference from Phase 1 is the **fail family**: the loop path uses
`failLoopIteration` (`dag-executor.ts:6132-6166`) → `failLoopNode` (`:5864+`), not
`finishCancelled`.

## Key insights

- Loop idle-await handling: `dag-executor.ts:7165-7220` mirrors the node block —
  `enterIdle(turnToken)` → `raceIdleWake` → `send_now` continues the interrupted iteration on the
  same session before the loop-completion check; else terminates via the loop cancel path.
- Loop teardown `finally` is the wrapper at `:5684-5731` (`unregister` at `:5727`); it already
  handles an ordinary `state:'failed'` return with no new code.
- The same injected `idleAwaitTimeoutMs` from Phase 1 must reach this call site.

## Requirements

- [ ] `executeLoopNode` idle-await (`:7195`) calls the Phase-1 `raceIdleWake(…, handle,
      idleAwaitTimeoutMs)`.
- [ ] Add a `wake.kind === 'expired'` branch that fails the loop with
      `IDLE_AWAIT_NO_REDIRECT_ERROR` via `failLoopIteration`/`failLoopNode` (loop family), never
      `finishCancelled`, never a completing idle-timeout, never `node_completed`.
- [ ] `Send now` before expiry continues the interrupted iteration on the same session
      (unchanged); expiry occurs before the normal loop-completion check.

## TDD — Tests Before

Re-run the Phase-1 engine matrix (items 6–10) against `executeLoopNode` (`dag-executor.test.ts`),
one Claude + one non-Claude fixture:

1. Loop interrupt → idle; silence past injected timeout → loop node fails once with
   `IDLE_AWAIT_NO_REDIRECT_ERROR`; assert loop-family fail event, negatives (no `node_completed`,
   no `nodeIdleTimedOut`, no completing-idle-timeout).
2. Loop keepalive re-arm keeps the iteration alive; fails only after a fresh interval.
3. Loop `Send now` before expiry continues the interrupted iteration on the same session and
   reaches the loop-completion check normally.
4. Loop cancel-poll still reaches the node with no stream.

## Refactor

- Update the loop call site to the new `raceIdleWake` signature; keep the loop cancel/terminate
  branch unchanged; only add the `expired` branch.

## TDD — Tests After

- Loop items 1–4 pass; the loop-completion check is unaffected on non-interrupted iterations
  (existing loop tests stay green).

## Todo

- [ ] Write loop idle-await tests (1–4); run — fail.
- [ ] Wire `raceIdleWake` + `expired` branch into `executeLoopNode` via the loop fail family.
- [ ] Green loop tests.

## Success criteria

- [ ] `bun test packages/workflows/src/dag-executor.test.ts` green including loop idle-await.
- [ ] Loop and node expiry share the constant + message but use their own fail families.

## Regression gate

```
bun test packages/workflows/src/dag-executor.test.ts
bun --filter @archon/workflows type-check
```

## Risk assessment

- Using the node fail family inside the loop would corrupt loop iteration/state accounting —
  assert the loop fail flows through `failLoopIteration`/`failLoopNode`.

## Next steps

Phase 3 exposes the keepalive route that drives `recordComposerActivity()`.
