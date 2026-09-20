---
phase: 3
title: 'Phase 3: Actual-terminal catch-up and node-wide transcript gate'
status: done
priority: P1
effort: '10h'
dependencies: [1, 2]
gate: 'Phase 2 tests and typecheck pass'
---

# Phase 3: Actual-terminal catch-up and node-wide transcript gate

## Goal

Make both run-detail parents reliably observe real node terminal evidence
after workflow Cancel, close the exact scoped execution and every uniquely
proven loop owner of a transactionally purged parked Ask in the existing server
read projection, derive node terminality only from raw event-backed execution
history, and provide written operator ids from
a separate complete node-wide transcript drain begun after terminal evidence.
This must also work while the operator has a completed loop iteration selected.

## Files

Server execution-history projection:

- Modify `packages/server/src/routes/workflow-execution-history.ts`.
- Modify `packages/server/src/routes/workflow-execution-history.test.ts` first.

Shared model:

- Modify `packages/web/src/lib/execution-room-model.ts`.
- Modify `packages/web/src/lib/execution-room-model.test.ts` first.

Legacy refresh, derivation, and pass-through:

- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.test.tsx` first.
- Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`.
- Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` first.
- Modify `packages/web/src/components/workflows/LegacyNodeRoom.tsx`.
- Modify `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` first.
- Modify `packages/web/src/components/workflows/NodeTranscriptPane.tsx`.
- Modify `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` first.

Console refresh, derivation, and pass-through:

- Modify `packages/web/src/experiments/console/routes/RunDetailPage.tsx`.
- Modify `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx` first.
- Modify `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`.
- Modify `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` first.
- Modify `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`.
- Modify `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` first.

No route, API schema, executor, registry, database write/schema, or generated
type changes.

## Verified timing and identity constraints

`cancelWorkflowRun` publishes `cancelled` and discards steering handles before
the executor records `node_failed`. The API may settle projected `nodeStates`
immediately, so those states are not event proof. `nodeExecutions` is rebuilt
from lifecycle events and retains the open execution as `running` until the
terminal event arrives. `buildLogRows` uses it as authoritative when present.

A node parked at Ask is the exception to "the executor later records
`node_failed`": cancellation transactionally purges its persisted interaction,
but the executor has already returned and no process owns a later terminal
write. Run detail already passes all interactions, including purged rows and
their server-minted execution scopes, into the execution-history projection.
The projection must close that exact scoped execution instead of leaving
terminal catch-up running forever. Unscoped or ambiguous legacy data stays
open and fails safe; no run/event row is mutated or synthesized.

Answered Ask resume exposes a related projection gap. The resumed invocation
writes new lifecycle starts; after its terminal pairs, the pre-pause open
segment can remain falsely running. Prompt resumes reuse the interaction
occurrence; loop resumes can mint new owner occurrences while the answered
interaction scope identifies the parked execution and its owner chain through
`loop_ancestry`. The read projection must require the matching persisted
`interaction_resolved` event with `resumed:true`, then retire only scoped
pre-resolution segments whose corresponding later starts prove they were
superseded. It must keep every ambiguous case open.

A selected finished iteration has a terminal row while a later occurrence is
still live. Conversely, its occurrence transcript does not contain operator
rows delivered in the later occurrence. Therefore neither selected-row status
nor the displayed transcript can drive Story 2.11. The terminal signal and
delivery comparison must both be node-scoped.

`workflow retry-node` and generic workflow Resume keep the same run/node
identity, and a short execution may be terminal again before the next client
refresh. Ordered events provide the durable logical execution boundary. A
prompt Ask resume reuses its occurrence, but a loop Ask resume may mint a new
outer occurrence. Fold `interaction_resolved` with `kind:'ask', resumed:true`
so the next same-node `node_started` retains the prior logical key; every other
start adopts its occurrence id (or event-id fallback). `node_retry_requested`,
retry epoch alone, and run `started_at` are not substitutes: the first two do
not cover generic Resume, while `started_at` also changes for an Ask resume
that must retain its queue.

## Test-first matrix

### Server execution-history projection

| ID   | Test                                       | Required assertion                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3.1 | scoped purged Ask closes exact execution   | A purged interaction with node/occurrence/attempt scope projects only its matching open execution as `failed`, uses `resolved_at` as the end, and calculates duration only from valid ordered endpoints.                                                                                     |
| T3.2 | re-ask/loop purge closes scoped owners     | A newer scoped attempt may adopt one unambiguous same-node occurrence; nested loop ancestry closes each uniquely matched pre-resolution owner iteration/container and no sibling.                                                                                                            |
| T3.3 | ambiguous or unrelated purge fails closed  | Missing scope/resolution time, permission kind, sibling node, unmatched scope, multiple matching/owning candidates, pending, and answered interactions do not terminalize an execution.                                                                                                      |
| T3.4 | answered Ask resume retires parked segment | Only a matching `interaction_resolved` event with `resumed:true` plus later corresponding starts retires the scoped pre-resolution execution and uniquely proven nested loop owners; later executions remain, while `resumed:false`, no later start, or ambiguous candidates change nothing. |

Use real `PendingInteraction` and `WorkflowEventRow` shapes. The projection is
read-only: tests must assert the input events/interactions are unchanged and no
new lifecycle row is fabricated.

### Shared raw-history helpers

| ID   | Test                                          | Required assertion                                                                                                                                                                                                                                                 |
| ---- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T3.5 | unsettled history table                       | Undefined/empty/all terminal return false; `running`, `awaiting`, pending/future unknown statuses return true; projected `nodeStates` are not inputs.                                                                                                              |
| T3.6 | node terminal requires evidence history       | Missing node, pending-only, running, or awaiting returns false; one or more executions all in terminal statuses return true.                                                                                                                                       |
| T3.7 | older iteration does not mask live occurrence | Completed iteration plus running/awaiting occurrence is false; after that occurrence becomes failed/completed it is true.                                                                                                                                          |
| T3.8 | nodes are isolated                            | Terminal history for sibling B cannot mark selected A terminal; terminal statuses are `completed`, `failed`, and `skipped`.                                                                                                                                        |
| T3.9 | logical execution key is stable and ordered   | Normal starts adopt occurrence/event identity; a resumed Ask keeps the prior key even when its next loop outer start has a new occurrence; retry/resume changes it; sibling/iteration events are ignored and a terminal/retry request clears an unused Ask marker. |

Use the generated `NodeExecution` and `WorkflowEvent` shapes or structural
readonly subsets; do not duplicate an enum in a public type. Unknown statuses
fail closed. Order events by `event_order`, then timestamp and persisted id,
matching the server projection rather than trusting array order.

### Parent refresh behavior

| ID    | Test                            | Required assertion                                                                                                                                   |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3.10 | Legacy live cadence unchanged   | Live run continues existing 3 s refetch.                                                                                                             |
| T3.11 | Legacy terminal catch-up        | `cancelled` + raw running execution keeps 3 s fetches; after raw failed execution or exact purged-Ask projection it stops; unmount clears the timer. |
| T3.12 | Console live behavior unchanged | SSE and existing 30 s live heartbeat remain; no duplicate 3 s live interval.                                                                         |
| T3.13 | Console terminal catch-up       | Terminal run + raw unsettled invalidates the run at 3 s; it stops at lifecycle or scoped-purge settlement and unmount.                               |
| T3.14 | settled terminal stays idle     | Both parents make no periodic terminal request when raw history is settled/empty.                                                                    |

Use fake timers and the current query/entity harnesses. No test may expect a
status write, inferred failure, or wall-clock terminal mutation.

### Node-terminal derivation/pass-through

| ID    | Test                                        | Required assertion                                                                                                                                                                            |
| ----- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3.15 | Legacy wrapper passes exact node inputs     | Selected A receives the raw-history terminal signal and logical execution key; sibling history is ignored.                                                                                    |
| T3.16 | Console wrapper passes exact node inputs    | Same matrix through `RunDetailPage` → `ConsoleInspectPane` → room without using settled `nodeStates` as terminal proof.                                                                       |
| T3.17 | occurrence selection preserves node history | Selected old completed occurrence with a live occurrence stays nonterminal; its unchanged logical execution key lets the dock keep A across the occurrence switch and a later empty snapshot. |

Pin prop pass-through in the wrapper tests rather than relying on incidental
DOM status labels.

### Node-wide reconciliation drain (same cases in both pane tests)

| ID    | Test                                     | Required assertion                                                                                                                                                                                 |
| ----- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3.18 | no pre-evidence drain                    | `nodeTerminal:false`, including run `cancelled` and selected row `completed`, never starts/publishes reconciliation.                                                                               |
| T3.19 | terminal request is node-wide            | At false→true, loader options omit `occurrenceId` and `attemptId` even when a finished occurrence is selected; displayed occurrence rows/state do not change.                                      |
| T3.20 | complete absence restores                | Complete error-free node-wide result lacking observed A supplies an empty written set and dock restores A.                                                                                         |
| T3.21 | written operator row filters             | Node-wide operator text row with A's id yields no finished box.                                                                                                                                    |
| T3.22 | only operator ids count                  | Assistant/tool/malformed metadata ids do not count as delivery.                                                                                                                                    |
| T3.23 | incomplete/error fails safe and retries  | No set is published; transient error retries at 1 s while mounted; a later complete result reconciles.                                                                                             |
| T3.24 | reset aborts stale work                  | Run/node change, unmount, execution-key replacement, or `nodeTerminal:true→false` aborts request/timer, clears written ids, and ignores late completion; occurrence-only selection does not.       |
| T3.25 | same-run/node retry/resume starts fresh  | A new logical execution key clears old A history/result and retry UUID even on terminal→terminal; retained draft receives a new id on submit, while Ask continuation and selection preserve state. |
| T3.26 | finished-iteration observer is recovered | Receipt observed in the read-only shared band is compared with node-wide rows and restored after the overall node evidence.                                                                        |

Build rows with the real message shape: `kind:'text'`,
`metadata.origin:'operator'`, and `metadata.message_id`. Make queue snapshots
configurable so tests exercise the real dock and its observed ledger.

## Implementation steps

### A. Close scoped purged interactions in the read projection

1. In `projectWorkflowExecutionHistory`, handle only
   `kind:'ask', status:'purged'` interactions after lifecycle pairing and before
   returning history. Require node id plus a complete execution scope. Prefer exact occurrence+attempt;
   allow a single same-node/same-occurrence fallback for re-ask scope rollover,
   mirroring the current pending-interaction projection and clearing stale
   start timing. Require a parseable non-null `resolved_at` (normalize `Date`
   to ISO), mark only that entry `failed`, set `ended_at` to that value, and
   calculate duration only from retained valid ordered timestamps. Do not
   mutate inputs, fabricate an event, close by node alone, or change
   pending/permission behavior. For a purged scope with `loop_ancestry`, retain
   raw start kind, iteration, and ancestry-prefix identity in file-local
   indexes, then fail every uniquely matched open owner represented by that
   chain: its loop iteration and, when present, the normal loop's outer
   `node_started` container. Evaluate ambiguity per owner and leave zero/multiple
   matches untouched; never close a sibling from node id alone.
   For `kind:'ask', status:'answered'` with a valid resolution time, first
   require the matching persisted `interaction_resolved` event (same node and
   `tool_use_id`, `kind:'ask'`, `resumed:true`). Retire the matching open
   pre-resolution execution only when a later corresponding start exists. Apply
   the same ancestry-prefix rule to every loop owner, requiring its own later
   start; keep all later executions. `resumed:false`, zero/multiple candidates,
   or no later start remain untouched.
   Build small file-local indexes by event kind, node, scope, ancestry prefix,
   iteration, and tool id so the added fold visits events, interactions, and
   their already-loaded ancestry entries once rather than nesting whole-list
   scans. Reuse them for purge and answer handling; do not introduce a
   cross-module abstraction or public field.

### B. Raw execution helpers

2. Add `hasUnsettledNodeExecutions(executions)` and
   `hasTerminalNodeEvidence(executions, nodeId)` to
   `execution-room-model.ts`. Accept the API's optional array. Share one local
   terminal-status predicate: only `completed`, `failed`, and `skipped` are
   terminal. Any other status makes its own execution unsettled; the global
   helper sees every execution, while the selected-node helper first filters by
   node. Missing selected-node history is false.
   Add `latestNodeExecutionKey(events, nodeId)` beside them. Sort with the
   server's event-order/time/id precedence and fold exact-node events. A normal
   `node_started` adopts nonempty `data.occurrence_id` or the event-id fallback.
   An `interaction_resolved` with `data.kind === 'ask'` and
   `data.resumed === true` arms one continuation: the next same-node
   `node_started` consumes it without changing the current key (or adopts its
   identity when history has no earlier key). An exact-node terminal or
   `node_retry_requested` clears an unused marker. Ignore loop-iteration starts,
   sibling events, array position, and client time.

### C. Terminal-run catch-up

3. In `WorkflowExecution`, make React Query refetch every 3 s when the run is
   live **or** terminal with any raw unsettled execution; otherwise false.
4. In `RunDetailPage`, preserve SSE and the 30 s live heartbeat. Add a distinct
   3 s invalidation interval only for terminal + raw unsettled. Clear it on
   settlement/unmount and do not stack it with the live heartbeat.
5. Do not add timeout inference, backoff policy, background service, or run
   mutation. A missing event remains visibly/unambiguously unsettled.

### D. Derive and pass node terminality and execution identity

6. `LegacyGraphLogsPane` derives the selected node's terminal signal from raw
   `nodeExecutions` and execution key from raw `events`, then passes both through
   `LegacyNodeRoom` to `NodeTranscriptPane` and `ComposerDock`.
7. `RunDetailPage` passes raw executions into `ConsoleInspectPane`; it derives
   the selected node terminal signal and execution key from `rawEvents`, then
   passes both to `ConsoleNodeRoom` and `ConsoleComposerDock`. Keep Console
   isolated from Legacy imports.
8. Default new pass-through props to false/null in leaf tests/callers so this
   phase does not broaden terminality or invent execution identity for missing
   legacy data.
9. In both panes, replace only the dock's occurrence-scoped React key with a
   stable run/node key. Keep `pageState`, todo, scroll, and displayed transcript
   keys occurrence-scoped. Pin that an observed receipt survives selecting a
   different occurrence even when the next queue snapshot is empty.

### E. Dedicated node-wide terminal drain

10. Add reconciliation state/ref separate from the displayed `pageState`. When
    `nodeTerminal` is true, call `drainNodeMessages` with a `kind:'node'`
    selection whose `rowId` scopes reconciliation to run/node/execution key.
    Because loader options still carry no occurrence/attempt fields, it returns
    all rows for the node. Never feed its intermediate states into transcript
    rendering.
11. Publish `collectWrittenOperatorMessageIds(next.rows)` only after
    `complete:true` and `error:null`. On an error or non-aborted incomplete
    result, schedule another node-wide drain after 1 s while mounted/terminal;
    clear the timer on cleanup. This is read-only recovery from transport
    failure, not lifecycle inference.
12. On run/node change, `nodeExecutionKey` change, or `nodeTerminal:false`, abort
    the controller, clear the retry timer and written-id state, and ignore late
    promises. If a changed execution is already terminal, begin its new drain
    after reset; do not require an observed false→true edge. Do not reset for an
    occurrence-only selection or same-key Ask resume. Pass the terminal signal,
    execution key, and written-id set to the dock.
13. Keep the existing selected-transcript polling, rows, errors, Retry action,
    scroll state, and occurrence filters unchanged.

## Verification

```bash
bun test packages/server/src/routes/workflow-execution-history.test.ts
bun test packages/web/src/lib/execution-room-model.test.ts
NODE_ENV=development bun test packages/web/src/components/workflows/WorkflowExecution.test.tsx
NODE_ENV=development bun test packages/web/src/experiments/console/routes/RunDetailPage.test.tsx
NODE_ENV=development bun test packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx
NODE_ENV=development bun test packages/web/src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx
NODE_ENV=development bun test packages/web/src/components/workflows/NodeTranscriptPane.test.tsx
NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx
bun test packages/web/src/experiments/console/console-isolation.test.ts
bun --filter @archon/server type-check
bun --filter @archon/web test
bun --filter @archon/web type-check
bun x eslint packages/server/src/routes/workflow-execution-history.ts packages/server/src/routes/workflow-execution-history.test.ts packages/web/src/lib/execution-room-model.ts packages/web/src/lib/execution-room-model.test.ts packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx packages/web/src/components/workflows/LegacyNodeRoom.tsx packages/web/src/components/workflows/LegacyNodeRoom.test.tsx packages/web/src/components/workflows/NodeTranscriptPane.tsx packages/web/src/components/workflows/NodeTranscriptPane.test.tsx packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx --max-warnings 0
```

Pass condition: T3.1–T3.26 pass, cadence and cleanup are deterministic under
fake timers, both displayed transcript paths remain unchanged, Console
isolation passes, and suite/type/lint gates are clean.

## Operational and performance limits

Additional traffic is limited to:

- one run-detail request every 3 s while a mounted terminal run still has raw
  unsettled execution history; and
- one node-wide transcript drain at actual terminal evidence, using the existing
  sequential 100-row pages and captured high-water mark, retried at 1 s only
  after transport/incomplete failure while that room remains mounted.

Both stop on settlement/completion or unmount. No global cache, daemon,
mutation, or persisted data is added. Server projection adds no query or wire
field and stays linear in the already-loaded events, interactions, and ancestry
entries. If evidence never becomes complete, the client makes no `NEVER SENT`
claim.

## Rollback

Revert the eighteen files. The Phase 2 props default to false/null, so removing
the refresh/derivation/drain wiring safely disables the result without a data
or API rollback.
