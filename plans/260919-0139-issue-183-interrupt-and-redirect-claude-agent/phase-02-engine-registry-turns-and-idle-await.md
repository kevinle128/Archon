---
phase: 2
title: 'Engine: registry turns, end cause, idle-await'
status: pending
priority: P1
effort: '2d'
dependencies: [1]
---

# Phase 2: Engine — registry turns, end cause, idle-await

## Goal

The steering registry tracks the live turn and the agent sub-state; both executor AI paths give each turn a fresh per-turn interrupt signal, classify the end cause, write one `interrupted` status row, enter idle-await, and continue on the same session when `Send now` drains the queue. Cancel's controller, checks, and outcomes stay byte-for-byte.

Deep mode: this phase is an outline with verified anchors; `/ak:cook` runs a dedicated scout pass (`reports/scout-260919-0830-executor-interrupt-seam.md`) before editing.

## Context links

- `_bmad-output/specs/spec-agent-node-room/engine-integration.md` §2 (five-case rule, three placement edits) and `steering-test-plan.md` "Engine — the per-node turn loop".
- Anchors (verified 2026-09-19): `dag-executor.ts:2210` (`nodeAbortController`), `:2224` (`abortSignal` on options), `:2290-2300` (`runStreamPass` → `sendQuery` inside `withIdleTimeout`), `:2313-2330` (chunk-driven cancel poll), `:2566` (`newSessionId` from result), `:3001-3003` (handle registration), `:3022` (`turns:` loop), `:3074-3075` (`canReask`), `:3189` (Cancel check), `:3336-3357` (natural-boundary gate), `:3500-3512` (catch-block Cancel classifier), `:3554-3568` (finally teardown); loop path `:5669-5673` (registration), `:5848` (`turns:`), `:6021` (`withIdleTimeout`), `:6123-6127` (`settledTurnSessionId`), `:6580` (`canReask`), `:6868-6914` (steering boundary); `recordNodeStatus` `:2002-2010`; `discardRun` wake point `packages/core/src/db/workflows.ts:1450-1465`.

## Registry additions (`packages/workflows/src/steering-registry.ts`)

```ts
export type SteeringSubState = 'generating' | 'idle-after-interrupt';
export type InterruptOutcome = 'idle-after-interrupt' | 'generating' | 'node_finished';
export type IdleAwaitOutcome =
  | { readonly kind: 'send_now'; readonly messages: readonly QueuedOperatorMessage[] }
  | { readonly kind: 'discarded' };

class NodeSteeringHandle {
  /** Executor: the turn is streaming; `controller` is this turn's fresh interrupt controller. */
  beginTurn(controller: AbortController, interruptible: boolean): void;
  /** Route: abort the live turn's signal synchronously; resolves with the executor's classification. */
  interrupt(): Promise<InterruptOutcome> | { readonly refused: 'not_interruptible' | 'not_live' | 'closed' }; // not_live = parked at an ask
  /** Executor: classify the end; settles every pending interrupt() promise. */
  settleTurn(outcome: InterruptOutcome): void;
  /** Executor: block until Send now drains or the handle is discarded. */
  awaitRedirect(): Promise<IdleAwaitOutcome>;
  /** Route: `intent:'send_now'` — resolves the waiter with the drained queue. Returns false when not idle. */
  sendNow(): boolean;
  subState(): SteeringSubState;           // also exposed on snapshot()
}
```

Rules: `interrupt()` while `idle-after-interrupt` resolves immediately with `idle-after-interrupt` (idempotent); while no turn is live and not idle (validation window) it records `pendingInterrupt` so the executor's classification still settles it; `discard()` resolves any waiter with `discarded` and rejects nothing; `sendNow()` drains synchronously in the same tick so a route enqueue cannot land between resolve and drain. `enqueue()` on an idle handle returns receipt `state: 'awaiting_send_now'` (widen `AcceptedSteeringReceipt.state`).

## Refactor (protected change) — executor, both paths

1. **Per-turn controller.** In `runStreamPass` (`:2276`) create `const turnInterrupt = new AbortController()`, pass `interruptSignal: turnInterrupt.signal` in `passOptions` only when `getProviderCapabilities(provider).interrupt !== false`, and call `steeringHandle?.beginTurn(turnInterrupt, interruptible)` before `sendQuery`. Set `operatorInterrupt = true` from an `abort` listener on that signal; reset the flag at the top of every `turns:` iteration and every re-ask pass.
2. **Classification order** (after the stream, per spec placement): `canReask` (`:3074`) gains `&& !operatorInterrupt`; skip the whole `output_format` validation block when `operatorInterrupt` (change `:3070` to `if (!nodeOptions?.outputFormat || operatorInterrupt) break;`); keep the Cancel check (`:3189`) first; the interrupted-end branch must NOT call `steeringHandle.close()` (every other terminal branch does) because idle-await keeps accepting `Send now`; immediately after it add the interrupted-end branch: `operatorInterrupt && (lastResultTerminalReason?.startsWith('aborted_') || streamThrewAbort)` → interrupted end. A result without an abort marker is a natural end even with the flag set (case 1). Capture `terminalReason` from the result chunk next to `:2566`.
3. **Interrupted end.** Settle any entry still in `runningTools` as `tool_completed` with `outcome: 'interrupted'` (only if the provider did not already yield the `is_interrupt` result); `await recordNodeStatus('interrupted')` exactly once; `steeringHandle.settleTurn('idle-after-interrupt')`; then `const redirect = await awaitRedirect(steeringHandle)`.
4. **Idle-await helper** (`awaitRedirect`): races `handle.awaitRedirect()` against a `setInterval(CANCEL_CHECK_INTERVAL_MS)` poll of `deps.store.getWorkflowRunStatus` filtered by `shouldContinueStreamingForStatus`; on a non-streamable status abort `nodeAbortController` and return `discarded`; clear the interval on any resolution. `discarded` → take the existing Cancel path (`:3189` block re-entered by `continue`-free fallthrough: set a local `cancelledDuringIdle` and jump to the same `node_failed 'Cancelled by user'` write). `send_now` → `turnPrompt = messages.map(m => m.message).join('\n\n')`, `turnResumeId = newSessionId` (throw the existing "no session id to resume" error if undefined), `turnIsGuidance = true`, `continue turns`.
5. **Natural end.** Existing gate (`:3336`) unchanged, plus `settleTurn('generating')` when it drains and `settleTurn('node_finished')` when `closeIfEmpty()` seals; every other terminal `close()` site also calls `settleTurn('node_finished')` so a pending interrupt promise never hangs.
6. **Case 3 (thrown abort) — inside the loop, not the outer catch.** The function-level `catch` (`:3437`) sits OUTSIDE the `turns:` loop, so it cannot `continue turns`. Wrap the `runStreamPass` call inside the loop body (`:3053`) in its own `try/catch`: when `operatorInterrupt && steeringHandle !== undefined && isAbortLikeError(err)` run the same interrupted-end helper as step 3, then idle-await, then `continue turns`; every other error rethrows to the existing outer catch unchanged. This path is reachable in this story — Phase 1 throws `'Turn interrupted before start'` when the signal is already aborted and disables retry on an interrupted turn. Extract the interrupted-end + idle-await sequence into one local async helper used by the post-stream branch and this inner catch. Same shape around the loop path's pass at `:6021`.
7. **Loop path** (`executeLoopNode`, `:5848-6914`): identical per-turn controller in its `withIdleTimeout` pass (`:6021`), same flag reset per turn, `canReask` (`:6580`) guard, interrupted-end branch immediately after its Cancel check at `:6442-6455` — NOTE the asymmetry the scout verified: the loop path's Cancel check sits BEFORE structured-output validation and completion detection, so a branch placed right after it skips both for free, whereas the direct path needs the explicit `:3070` guard. Status row via `recordLoopStatus(iterationExecutionScope, 'interrupted')` (`:5429-5440`), idle-await, and `Send now` continuing the interrupted ITERATION on `settledTurnSessionId` (`:6123-6127`) before the completion/`max_iterations` checks at `:6868`. Loop-group bodies route through `runLayers` → `executeNodeInternal` with a namespaced `stepName` (e.g. `grp.review`), so the registry key already matches — no extra code (verified in `reports/scout-260919-0830-executor-interrupt-seam.md` §3).
8. **Teardown.** `finally` (`:3554`) unchanged in shape; `close()` now also settles pending waiters. `discardRun` (`core/db/workflows.ts:1450`) needs no change beyond the handle's `discard()` resolving the waiter.

## Files

| File                                               | Action | Change                                                     | Test impact               |
| -------------------------------------------------- | ------ | ---------------------------------------------------------- | ------------------------- |
| `packages/workflows/src/steering-registry.ts`      | Modify | Turn tracking, sub-state, interrupt/settle, idle-await      | registry tests            |
| `packages/workflows/src/steering-registry.test.ts` | Modify | New contract tests                                          | —                         |
| `packages/workflows/src/dag-executor.ts`           | Modify | Both AI paths as above                                      | executor tests            |
| `packages/workflows/src/dag-executor.test.ts`      | Modify | Interrupt/idle-await/loop tests                             | —                         |
| `packages/core/src/db/workflows.test.ts`           | Modify | `discardRun` wakes an idle waiter                           | —                         |

Before merging: `grep -rn "mock.module(.*steering-registry" packages` — any factory must add the new exports (`mock.module` merges, so a missing export silently un-mocks).

## Tests before

- Existing Story 2.1 executor tests (`-t 'queued guidance'`) and registry tests stay green.
- Cancel regression: a node-level abort during a turn still yields `failed — Cancelled by user`, never touches `interrupt`.
- Idle-timeout regression: `nodeIdleTimedOut` still completes-with-output / fails-empty; no idle-await entered.

## Tests after (matrix)

| #   | Scenario                                                                                                   | Path            |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | interrupt aborts only the per-turn signal; `nodeAbortController.signal.aborted === false`; node `running` | direct          |
| 2   | result with `terminalReason:'aborted_tools'` + flag → interrupted end; no validation; no re-ask; one `interrupted` status row; no `node_failed` event | direct |
| 3   | result without marker + flag → natural end; interrupt promise resolves `generating` (queued) or `node_finished` (empty) | direct   |
| 4   | thrown `Query aborted` + flag → interrupted end, not `dag_node_failed`                                      | direct          |
| 5   | thrown abort without flag → real `node_failed` (unchanged)                                                 | direct          |
| 6   | `sendNow()` with 2 queued + 1 new → next `sendQuery` prompt is the three messages in receipt order with `resumeSessionId` = interrupted turn's id | direct |
| 7   | Stop again on the resumed turn → second idle-await; flag reset proven (a stale flag never mis-routes)       | direct          |
| 8   | `discardRun` during idle-await → `Cancelled by user`, handle unregistered                                   | direct          |
| 9   | cancel poll during idle-await (status `cancelled`) → Cancel path, interval cleared                          | direct          |
| 10  | running tool at interrupt → `tool_completed` outcome `interrupted`, exactly once                            | direct          |
| 11  | 1–4, 6, 8 on `executeLoopNode`; Send now continues the same iteration before the completion check          | loop            |
| 12  | provider with `interrupt:false` never receives `interruptSignal`; `interrupt()` refused `not_interruptible` | direct          |
| 13  | every terminal `close()` settles a pending `interrupt()` promise with `node_finished`                       | direct + loop   |

## Regression gate

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts src/dag-executor.test.ts)
(cd packages/core && bun test src/db/workflows.test.ts -t 'steering')
bun run lint && bun run type-check
```

## Todo

- [ ] Scout pass on both executor paths; confirm loop-group routing and the loop status-row helper
- [ ] Registry additions + tests
- [ ] Direct path: per-turn controller, flag, classification, interrupted end, idle-await, catch case 3
- [ ] Loop path parity
- [ ] `mock.module` factory audit
- [ ] Tests After 1–13 green; regression gate green

## Success criteria

Matrix green on both paths; Cancel and idle-timeout regressions untouched; no new workflow event types; `interrupted` written through `appendNodeTranscript` only.

## Risk assessment

- Extracting the interrupted-end helper touches a 1,500-line function; keep the change additive and diff-reviewable (no reordering of existing branches).
- Idle-await with no timer (Story 2.12) is bounded only by Cancel — documented in plan.md D3.

## Next steps

Phase 3 reads `subState()`, `interrupt()`, and `sendNow()` from the route layer.
