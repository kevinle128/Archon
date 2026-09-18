---
phase: 1
title: 'Engine: steering registry and natural-boundary drain'
status: pending
priority: P1
dependencies: []
---

# Phase 1: Engine registry and natural-boundary drain

## Outcome

`@archon/workflows` owns a process-local registry keyed by `(runId, stepName)`. Direct AI nodes, AI loop nodes, and prompt nodes executed inside loop groups expose a live handle while a resumable provider turn is active. Guidance accepted during a turn is delivered at the next natural boundary on the immediately preceding provider session. Without guidance, existing executor behavior is unchanged.

This phase changes no database schema, workflow event shape, transcript schema, provider interface, or node status vocabulary.

## Files

| File                                               | Change                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/workflows/src/steering-registry.ts`      | New synchronous registry and handle.                                                        |
| `packages/workflows/src/steering-registry.test.ts` | New registry contract tests.                                                                |
| `packages/workflows/src/dag-executor.ts`           | Register, park, close, drain, and continue provider turns in both AI execution paths.       |
| `packages/workflows/src/dag-executor.test.ts`      | Focused executor regression and delivery tests.                                             |
| `packages/workflows/package.json`                  | Export `./steering-registry` and append the new suite to the package's explicit test chain. |
| `packages/core/src/db/workflows.ts`                | After central Cancel commits, discard this process's handles for the terminal run.          |
| `packages/core/src/db/workflows.test.ts`           | Prove active and parked handles are disposed only after the terminal database operation.    |

## Registry contract

Create a narrow module following the process-singleton pattern already used by the workflow event emitter. Its public data and operations should be equivalent to:

```ts
export interface QueuedOperatorMessage {
  readonly messageId: string;
  readonly message: string;
  readonly operatorUserId: string | null;
  readonly receivedAt: string;
}

export interface AcceptedSteeringReceipt {
  readonly messageId: string;
  readonly state: 'queued';
}

export type SteeringHandlePhase = 'live' | 'parked' | 'closed';

export type EnqueueResult =
  | { readonly ok: true; readonly duplicate: boolean; readonly receipt: AcceptedSteeringReceipt }
  | { readonly ok: false; readonly reason: 'not_live' | 'closed' };

export interface SteeringHandleSnapshot {
  readonly phase: SteeringHandlePhase;
  readonly queued: readonly QueuedOperatorMessage[];
  readonly acceptedCount: number;
}

export class NodeSteeringHandle {
  enqueue(message: QueuedOperatorMessage): EnqueueResult;
  pendingCount(): number;
  closeIfEmpty(): boolean;
  drain(): readonly QueuedOperatorMessage[];
  park(): void;
  resume(): void;
  close(): void;
  snapshot(): SteeringHandleSnapshot;
}

export class SteeringRegistry {
  register(runId: string, nodeId: string): NodeSteeringHandle;
  get(runId: string, nodeId: string): NodeSteeringHandle | undefined;
  unregister(runId: string, nodeId: string): void;
  discardRun(runId: string): { readonly handles: number; readonly queued: number };
  clearForTests(): void;
}

export function getSteeringRegistry(): SteeringRegistry;
export function createSteeringRegistry(): SteeringRegistry;
```

Names may follow nearby conventions, but preserve these invariants:

- `register` creates a live handle, resumes a parked handle with its queue intact, and replaces a previously closed handle for a genuinely new execution.
- `enqueue` is synchronous. A live handle appends exactly once in call/receipt order. A parked handle returns `not_live`; a closed handle returns `closed`.
- The handle keeps a map from every accepted id to its original receipt and original message for its entire lifetime. A duplicate returns that receipt before any phase/capacity logic, both before and after drain. A duplicate with different prose does not replace the original and exposes neither version in logs.
- `drain` atomically returns and removes the current pending items without closing the handle. Accepted-id memory remains.
- `closeIfEmpty` synchronously closes and returns `true` only when the live queue is empty. It returns `false` without mutation when items exist. Calling it immediately before either `drain` or terminal completion creates the last gate without an `await` window.
- `close` refuses later enqueues but retains queued items until cleanup can count them. `park` retains them and `resume` makes the same handle live again.
- `discardRun` closes, clears, and removes every handle for one run, returning counts for content-free logging. It never changes database lifecycle state.
- No queue-depth, message-length, or accepted-id eviction is added. In particular, the 501st accepted id must not make the first id non-idempotent.
- The singleton is production-facing; isolated registry construction and reset are for tests. Do not export internals through the workflows package root.

## Direct-node executor flow

Work in `executeNodeInternal` using stable code anchors rather than stale line numbers.

### Registration and lifecycle

1. Resolve the provider and its capabilities as today. Only after those operations succeed, register `(workflowRun.id, stepName)` when `sessionResume === true`. Providers without resume capability receive no handle and therefore cannot advertise unsafe steering.
2. Put every post-registration path under a lifecycle `try/catch/finally`. The existing AskHuman catch remains the semantic owner of ask pauses.
3. On `AskHumanAwaitingError`, call `park()` synchronously before `pauseOnAskHuman`. A resumed execution calls `register`, which resumes the same queued handle.
4. On every other thrown/returned terminal path, call `close()` before the first awaited terminal write. In `finally`, warn with `{ runId, nodeId, queuedCount }` if queued items remain, never log message text, then unregister. Skip unregister only when the handle is parked for a valid resumable pause.

### Turn loop

Wrap the current structured-output re-ask sequence in an outer provider-turn loop; do not replace it.

For each provider turn:

1. Set the turn prompt and resume id. Turn 1 uses the existing final prompt and existing resume id. A guidance turn uses the drained messages joined verbatim with `\n\n` and the session id returned by the prior turn.
2. Reset the captured result session id. A turn must positively emit its own id; an id from an older turn must never be reused.
3. Run the existing send/stream/structured-validation/re-ask flow. Re-ask prompts must use the current turn prompt as their base, not a function closure over turn 1. Re-asks retain their current fresh-session behavior.
4. For a guidance turn, remove stale `resumeInteractions`, force `forkSession: false`, and rotate transcript attempt scope while preserving the node occurrence id. Do not emit another `node_started` or any steering event.
5. Finalize that turn before resetting pass-local fields:
   - preserve the current idle-timeout notice and outcome;
   - preserve Cancel dominance and its node-level abort controller;
   - flush `batchMessages` exactly once for the settled turn (moving this inside the outer loop is mandatory because `runStreamPass` clears it on the next pass);
   - preserve the credit-exhaustion and empty-output failures;
   - fold tokens and cost across every provider pass/turn while leaving the existing per-pass usage ledger intact.
6. An idle-timeout, Cancel, credit-exhaustion, empty-output, or genuine provider error is not a natural delivery boundary. Close the handle and take today's terminal path without draining.
7. At a valid natural boundary, call `closeIfEmpty()`:
   - `true`: the handle is sealed in the same tick; break to today's single `node_completed` path;
   - `false`: if the just-ended turn returned no session id, close and fail the node with a clear resumability error **before** removing queued items;
   - otherwise call `drain()` immediately, set the joined guidance and returned session id for turn N+1, and continue the outer loop.

No `await` may occur between `closeIfEmpty() === false`, the session-id decision, and `drain()`. This is the route/executor race boundary.

### Behavior that must remain unchanged

- `nodeAbortController` remains Cancel's one-shot controller; this story adds no per-turn interrupt controller.
- Existing cancellation polling, idle timeout, throttle cleanup, tool execution, output-format validation, re-ask events, persisted-session recording, background-task warnings, and output assignment retain their current ordering and messages.
- Turn 1 batching must remain visible even when guidance creates turn 2.
- The final node output/structured output is the final guidance turn's output. Accumulated usage covers all turns. One node-start and one terminal lifecycle event are emitted.

## AI loop executor flow

`executeLoopNode` is a separate implementation and currently has no function-level lifecycle catch/finally. Add one around all post-registration work; do not claim an existing cleanup guard exists.

1. Resolve the provider, then register the same `(runId, stepName)` live handle when resume is supported.
2. Inside each existing loop iteration, wrap the current attempt/re-ask flow in an iteration-turn loop. The first turn uses the existing substituted iteration prompt and normal loop resume behavior. Guidance turns use the immediately returned session id, reset re-ask state, drop `resumeInteractions`, set `forkSession: false`, and do not consume a loop iteration.
3. After every settled turn, preserve loop cancellation, timeout, empty-output, batch/usage folding, and completion-channel behavior. Evaluate `until_field`, prose `until`, and `until_bash` against the most recent turn output in their existing order.
4. If guidance is pending, it wins the natural boundary even when that output met a completion condition or the iteration reached `max_iterations`: require the current session id, drain synchronously, run the guidance turn in the same iteration, and re-evaluate completion from its output.
5. If guidance is absent and the node is complete, use `closeIfEmpty()` as the final last gate, then follow today's success/failure result. If guidance is absent and another iteration will run, keep the handle live and advance normally.
6. A missing session id with pending guidance fails before drain, matching direct nodes.
7. Park before the AskHuman return and before the interactive between-iteration approval return. Resume re-registers the same handle. Close/unregister all terminal outcomes in the new `finally`, including early helper returns.
8. Loop-group prompt body nodes already execute through `executeNodeInternal`; verify their namespaced `stepName` is the route/registry key in tests rather than adding a third implementation.

## Terminal run cleanup outside an active executor

An AskHuman/interactive pause returns from the executor, so its parked handle has no active `finally` waiting for a later Cancel. After the existing central `cancelWorkflowRun` transaction completes, call `discardRun(runId)` in the same process and log only handle/queue counts. This covers Cancel and abandon paths that already converge on that write, including paused nodes, without adding a timer or inferring lifecycle from age.

- Run cleanup only after the database operation returns successfully. Never make a database cancel depend on registry contents.
- Treat disposal as an after-commit in-memory side effect. If defensive handling is needed, log a cleanup failure without reporting the already-committed Cancel as failed.
- An idempotent terminal cancel/no-op may also discard a deliberately stale same-process handle because persisted state is already authoritative.
- The executor may still hold the handle object while cooperative Cancel unwinds; `discardRun` marks it closed and clears its queue so it cannot drain, and later executor unregister is a safe no-op.
- Do not add a stale-timeout reaper. A manual resume/cancel from another OS process cannot reach this registry by accepted architecture; it remains an explicit process-boundary limitation rather than a guessed lifecycle mutation.

## Tests first

### Registry suite

- same singleton versus isolated instances; register/get/unregister;
- receipt order and ISO receipt time supplied by the server;
- duplicate before drain, after drain, while parked, and with different prose returns the original receipt and creates no second item;
- more than 500 accepted ids still leaves the first id idempotent;
- `closeIfEmpty` closes only an empty live handle; closed enqueue refuses;
- non-closing drain empties pending items but preserves live phase and accepted-id memory;
- park/resume retains queue; parked enqueue refuses;
- re-registering a closed execution creates fresh idempotency scope.
- `discardRun` removes every live/parked handle for only the named run, clears queued/accepted data, and leaves other runs unchanged.

### Direct-node cases

- handle is live while the controllable provider stream is open and absent after terminal cleanup;
- provider without session resume exposes no handle;
- empty-queue execution is byte-for-byte equivalent in calls, output, lifecycle events, batching, and usage;
- two messages accepted during turn 1 produce one turn-2 prompt in receipt order, resume turn 1's returned session id, keep one node occurrence, and leave the node running until turn 2 ends;
- a persisted-session turn may fork on turn 1 but the guidance turn sets `forkSession: false`; resumed ask data appears only on turn 1;
- structured-output re-ask on a guidance turn includes that guidance and retains existing re-ask semantics;
- batch-mode output from every settled turn is emitted before the next turn resets `batchMessages`;
- per-pass usage ledger remains complete and final node cost/tokens aggregate all turns;
- missing session id with a non-empty queue fails without draining or issuing a fresh-session call;
- Cancel, idle timeout, credit exhaustion, empty output, provider throw, and terminal early returns never drain queued work, close before terminal persistence, and clean the registry;
- AskHuman parks, refuses sends while parked, and resumes the same queued handle.

### Loop cases

- guidance runs as another provider turn in the current iteration and completion predicates use its output;
- guidance waiting at a would-be completion/max-iteration boundary still runs before the node finishes;
- no queued guidance advances iterations and finishes exactly as before;
- missing session id, AskHuman park/resume, interactive-gate park/resume, cancel/error cleanup, usage, and batch output match the direct-node invariants;
- a prompt node inside a loop group registers under its namespaced id and accepts the route-facing id.

### Central cancel cases

- cancelling a running handle and a parked AskHuman handle disposes them after the database transaction and logs counts without content;
- an idempotent already-terminal cancel removes a deliberately seeded stale handle;
- a database error leaves the handle unchanged, and cleanup failure cannot roll back or falsely fail a committed Cancel;
- cleanup for one run does not touch a second run.

Use controllable async generators/deferred promises; no sleeps or network calls.

## Verification

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts -t 'queued guidance')
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/workflows && bun run type-check)
bun x eslint packages/workflows/src/steering-registry.ts packages/workflows/src/steering-registry.test.ts packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts --max-warnings 0
(cd packages/core && bun test src/db/workflows.test.ts -t 'steering handle cleanup')
(cd packages/core && bun run type-check)
bun x eslint packages/core/src/db/workflows.ts packages/core/src/db/workflows.test.ts --max-warnings 0
```

Confirm `packages/workflows/package.json` includes the new registry test in its explicit package `test` script so `bun run validate` cannot omit it.

## Exit criteria

- Every handle lifecycle is explicit and terminal cleanup cannot leave a live route target.
- The no-guidance path passes all existing executor assertions without weakening them.
- Same-session, order, last-gate race, missing-session failure, per-turn batching, usage aggregation, ask parking, loop semantics, and full-lifetime idempotency have focused deterministic tests.
