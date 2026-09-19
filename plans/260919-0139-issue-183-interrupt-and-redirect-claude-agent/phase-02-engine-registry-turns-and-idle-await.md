---
phase: 2
title: 'Registry, executor classification, and idle-await'
status: pending
priority: P1
dependencies: [1]
---

# Phase 2: Registry, executor classification, and idle-await

## Goal

Make interruption a race-safe transition inside the existing in-process steering handle, and apply the same end-cause/redirect behavior to direct AI nodes, AI loop nodes, and provider-calling nodes nested in loop groups. Node Cancel and all terminal cleanup remain authoritative.

## Files

| File                                               | Change                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/workflows/src/steering-registry.ts`      | Add capability-aware registration, active-turn tokens, idempotent interrupt settlement, optional projected sub-state, atomic intent-aware acceptance, and one-shot idle waiters. |
| `packages/workflows/src/steering-registry.test.ts` | Exhaustively test state transitions, duplicate receipts, ordering, races, close/park/discard, and stale tokens.                                                                  |
| `packages/workflows/src/dag-executor.ts`           | Thread a fresh interrupt controller through each provider pass; classify turn ends; settle tool/status rows; await explicit redirect; mirror behavior in AI loops.               |
| `packages/workflows/src/dag-executor.test.ts`      | Add direct, loop, loop-group, structured-output, cancellation, transcript, session, and race tests.                                                                              |

No new engine schema file, database state, or workflow event type is needed.

## Registry contract

Preserve the existing process singleton, `live | parked | closed` phase, receipt-order queue, accepted-id memory, and synchronous last gate. Extend `register(runId, nodeId, { interruptible })`; an existing live/parked handle may only be reused when its interruptibility agrees, otherwise fail fast because that indicates overlapping executions for one key.

### Active turn identity

Use a monotonically increasing turn token so old cleanup cannot mutate a new turn:

- `beginTurn(controller)` starts `generating`, stores the controller under a fresh token, and returns the token. It is valid only on a live interruptible handle and fails fast until the prior token is settled, even if that prior stream has ended.
- `endTurnStream(token)` clears the controller only when the token matches. It does not resolve an interrupt that is waiting for executor classification; a stale token is a safe no-op.
- `settleTurn(token, outcome)` resolves that token's pending interrupt once and clears it; a stale/duplicate token is a safe no-op so a late `finally` cannot damage a newer turn.
- `interrupt()` synchronously aborts the currently stored turn controller, sets the operator-interrupt flag/receipt once, and returns a shared promise. Repeated calls during the same turn share the promise; idle calls return idle immediately.
- The executor can query the flag only by matching token; settling clears it so a resumed turn cannot inherit stale interruption state.
- A call after `endTurnStream` but before `settleTurn` waits for classification and never aborts an old controller.

Settlement values cover `idle-after-interrupt`, `generating`, `node_finished`, and internal `not_steerable_here` for a park/discard race. The server maps them to the existing public response/error contract.

### Atomic message acceptance

Replace the route's separate enqueue/state/send-now operations with one synchronous `accept(message, intent)` mutation:

- accepted ids always replay their original receipt and never enqueue or release twice;
- a new message accepted while generating returns `state:'queued'`;
- a new message accepted while idle returns `state:'awaiting_send_now'`;
- `intent:'queue'` while idle leaves the waiter unresolved;
- `intent:'send_now'` while idle appends the new message, drains the whole queue in receipt order, moves the handle to generating, and resolves the waiter in the same tick;
- `send_now` while generating/interrupting behaves as Queue and waits for the normal boundary;
- park/close retain the existing refusal and duplicate-replay rules.

The receipt is immutable. Do not rewrite `awaiting_send_now` to `queued` after release.

### Idle waiter and cleanup

`enterIdle(token)` projects `idle-after-interrupt`, resolves an in-flight interrupt request as idle, and returns one waiter carrying the drained redirect batch or a terminal wake reason. Only the first of Send now, handle discard, or the cancel-status poll wins. Teardown clears timers/listeners and settles:

- natural empty terminal / close: `node_finished`;
- ask park or unavailable live handle: `not_steerable_here`;
- run discard: wake the executor, which re-reads status and takes the existing Cancel path;
- test clear: no unresolved promises.

The projected `steeringSubState` exists only when an interruptible handle is live and is exactly `generating | idle-after-interrupt`; the in-flight `interrupting` flag is not projected.

## Executor integration

### Per-provider-call lifecycle

For each `runStreamPass` invocation—not merely each outer guidance turn:

1. Create a fresh turn controller only when the resolved provider capability is interruptible.
2. Register it with the handle immediately before `sendQuery` and pass its signal as `interruptSignal`.
3. Capture normalized `terminalReason`, result/session id, and whether the handle reports an operator interrupt for this token.
4. In `finally`, call `endTurnStream(token)`; after the stream outcome is known, call `settleTurn(token, classifiedOutcome)`.
5. Never reuse the controller or flag on a re-ask or guidance turn.

Loop-group body nodes already execute through the direct-node path under a namespaced `stepName`; retain that key and prove it with a test rather than adding a third implementation.

### Classification and validation order

Implement the five cases from plan D5. Positional requirements:

1. Capture result/throw evidence and end the active stream.
2. Check node/iteration Cancel first; its current failed-Cancel behavior remains unchanged.
3. In the result handler, recognize the typed interrupt terminal reason before the existing generic `msg.isError` failure guard. A matching operator-interrupted result is interrupted even if the SDK also sets `isError`/an error subtype; an unmarked error result remains a genuine failure.
4. If the end is actually interrupted, skip the entire structured-output validation/re-ask block and take idle entry before batch emission, credit exhaustion, empty-output failure, natural queue drain, loop completion checks, or node completion.
5. If Stop raced a natural unmarked result, retain normal validation. However, add the operator-interrupt flag to `canReask` so the executor does not start another provider pass after Stop claimed the turn slot; validation may therefore succeed normally or terminate normally on a miss, but never silently re-ask.
6. A throw is converted to interrupted only when the matching turn was operator-interrupted, its interrupt signal is aborted, and a narrow helper recognizes the provider abort error name/code or known third-party abort message; all other errors follow the existing failure path. Test an unrelated error racing Stop as a genuine failure.

For Claude results, recognize only `aborted_streaming` and `aborted_tools` as interrupt terminal reasons. Do not classify from result presence alone, a broad string prefix, or human-readable error prose when the provider supplies a typed terminal marker. Third-party thrown-error classification is allowed only in the narrow throw branch above and must remain ready for later stream-abort provider stories.

Before the interrupted branch, preserve accounting that is independent of output validity: the per-pass usage recorder still runs, and captured cost/tokens fold into the node/loop totals exactly once. Do not batch-send partial assistant text, run text-based credit/empty-output classifiers, or evaluate loop completion against the interrupted partial. A redirected next turn retains the accumulated usage/cost; provider budget/credit enforcement is not reset or bypassed.

An abort-marked result also overrides the normal “wait for live background Agent tasks after result” rule. Stop is a deliberate request to end the current turn: do not announce that the engine is waiting for those tasks or hold the stream open for their follow-up result. Settle any corresponding in-flight tool/task card as interrupted, suppress the generic incomplete-background-task warning for this deliberate end, and proceed to the single interrupted status row and idle-await. Retain normal background-task waiting for every natural result.

### Tool and status settlement

Current result handlers mark every still-open `runningTools` entry `unknown` and clear the map. Change that exact settlement point:

- for an abort-marked interrupted result, close remaining entries as `interrupted`;
- for a provider-emitted interrupted `tool_result`, retain its existing record and do not emit a duplicate;
- for an interrupted throw, settle still-open entries before leaving the scope that owns the map;
- on idle entry, write one and only one status row with state `interrupted`.

The existing agent-history fold uses a following interrupted status row to override the preceding tool card, so ordering is part of the test. Await that status write before `enterIdle` resolves the interrupt request, giving the UI a committed transcript outcome before it renders/focuses the idle dock. Do not emit `node_failed`, `dag_node_failed`, completion, or validation-miss events for an interrupted turn.

### Natural boundary versus idle redirect

- Natural result plus pending queue: require a fresh session id, drain, settle the interrupt route as `generating`, and start the next outer turn.
- Natural result plus empty queue: seal synchronously with `closeIfEmpty()`, settle `node_finished`, and complete normally.
- Interrupted result/throw: require the verified resumable session id, enter idle even when messages are already queued, and wait for explicit Send now.
- Send now wake: join the drained messages with the existing double-newline convention, create a fresh transcript attempt, and run the next turn with the interrupted turn's session id.
- Missing session id before either natural drain or interrupted idle is a fail-fast node error; keep the queue intact for reconciliation and never start a fresh provider session.

For AI loops, the redirect runs inside the same loop iteration, before `until`, `until_field`, `until_bash`, interactive-gate, or max-iteration decisions. It does not increment the iteration count. Loop-group bodies inherit the direct behavior.

### Cancel while idle

Idle-await has no provider stream to drive the existing cancel poll. Add a scoped timer using `CANCEL_CHECK_INTERVAL_MS` and `shouldContinueStreamingForStatus`; stop it on every wake. Same-process `discardRun` also wakes immediately after the database terminal write. Both paths rejoin the existing Cancel/terminal logic instead of inventing a new lifecycle.

Do not add Story 2.12's inactivity timeout or keepalive here.

## Tests first

### Registry

1. Tokens increase; stale end/settle cannot clear or resolve a newer turn.
2. First interrupt aborts synchronously once; concurrent/repeated interrupt calls share one outcome.
3. Interrupt during the post-stream classification window touches no controller and receives the classified outcome.
4. Idle repeat interrupt is an immediate idempotent idle result.
5. `accept(queue)` and `accept(send_now)` produce the correct immutable receipt in generating and idle states.
6. Idle Send now drains old then new receipt order exactly once; duplicate id replays without another wake/drain.
7. Send during interrupting queues and remains for explicit Send now if the end is interrupted.
8. close/park/discard/clear settle interrupt and idle waiters and retain existing queue/idempotency rules.
9. Non-interruptible handles queue normally but expose no sub-state and refuse interrupt internally.

### Executor matrix

Run all critical rows against direct AI and AI-loop paths; add a focused loop-group namespaced-body case:

| Scenario                                             | Expected                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| abort-marked result after Stop                       | idle, same session retained, no validation/re-ask/failure/completion               |
| abort-marked result also carrying `isError`/subtype  | interrupt marker wins generic SDK error guard; idle, not failed                    |
| abort-like throw after Stop                          | same interrupted behavior, no `dag_node_failed`                                    |
| unmarked natural result wins Stop race + queue       | normal validation, auto-drain, route settles generating                            |
| unmarked natural result wins Stop race + empty queue | normal completion, route settles finished                                          |
| Cancel co-fires                                      | existing Cancel failure wins; no idle                                              |
| interrupted structured-output pass                   | no schema validation or validation-miss event                                      |
| Stop on invalid natural result                       | no new re-ask after Stop                                                           |
| outstanding and already-settled tool calls           | exactly one interrupted outcome per applicable tool and one status row             |
| interrupt with live background tasks                 | no background wait/follow-up or generic incomplete warning; interrupted settlement |
| interrupted result with usage/cost                   | accounting retained exactly once; no batch partial or completion checks            |
| Send now with two old plus one new receipt           | one next turn, double-newline prompt in receipt order, same session                |
| missing interrupted session id                       | explicit failure; no fresh session or lost queue                                   |
| idle discard / remote status cancel                  | waiter/timer cleaned and existing terminal path reached                            |
| second interrupt after resumed generation            | fresh token/controller; no stale-flag contamination                                |

Also pin existing behavior for non-interrupt-capable providers and calls with no steering handle.

## Validation

```bash
cd packages/workflows
bun test src/steering-registry.test.ts
bun test src/dag-executor.test.ts -t 'interrupt'
bun test src/dag-executor.test.ts -t 'queued guidance'
bun run type-check
cd ../..
bun --filter @archon/workflows test
```

Broaden to the full workflows package test script because `dag-executor.ts` is shared.

## Completion criteria

- Registry transitions are synchronous where races require them and every promise/timer settles.
- Direct, loop, and loop-group paths satisfy the same end-cause and same-session contract.
- Cancel, AskHuman park/resume, credit limits, idle timeout, and Story 2.1 natural queue draining retain their existing tests.

## Risks and rollback

- `dag-executor.ts` has duplicated direct/loop stream handling. Share only small pure classification/types if it reduces divergence; do not attempt an unrelated executor refactor.
- The highest data-integrity risk is clearing `runningTools` before marking interruption; tests must assert persisted row order, not only returned node state.
- Rollback restores the registry's existing queue-only methods and removes the executor branch; no persisted format changes.
