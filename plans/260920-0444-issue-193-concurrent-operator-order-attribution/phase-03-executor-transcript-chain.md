---
phase: 3
title: 'Executor transcript chain'
status: pending
priority: P1
effort: '4h'
dependencies: [1, 2]
---

# Phase 3: Executor transcript chain

## Goal

Prove that the executor writes a mixed-operator drained batch as transcript
rows whose `seq` order equals registry receipt order, each carrying the correct
`operator_user_id` and `message_id` under the caused turn's attempt, for direct
nodes, the idle `send_now` path, and AI loop nodes; and that two nodes running
concurrently never receive each other's rows. Then prove the read model resolves
the matching sender per row and per node.

## Scout pass (run before editing)

1. `awk 'NR>=26515 && NR<=26640' packages/workflows/src/dag-executor.test.ts`
   — confirm helpers `liveHandle`, `enqueue(runId, stepName, id, text, operatorUserId='op-1')`,
   `isOperatorTextRow`, `storedEventTypes`, `createMockStore`, `invokeDag`,
   `sendQueryArg` and the `#181` describe's `beforeEach`.
2. `grep -n "function sendNow\|function awaitIdle\|function transcriptStates" packages/workflows/src/dag-executor.test.ts`
   — helpers used by the `#183` describe (~27266+).
3. Confirm the loop-node guidance test at ~26960 and the loop interrupt test
   at ~27935 for the loop mirror shape.
4. In `api.workflow-runs.test.ts`, find the `/messages` display-name block
   (~3440-3710) and its mocks `mockListNodeMessages`,
   `mockGetUserDisplayNamesByIds`, `MOCK_RUNNING_RUN`.

## Context links

- Direct drain: `packages/workflows/src/dag-executor.ts` ~3690-3715
- `send_now` wake and same-session redirect: ~3560-3585
- Row write at first chunk: ~2475-2486 (`recordOperatorReceiptIfNeeded`)
- Loop drain: ~7440-7460; loop row write: ~6417-6433
- Writer: `packages/workflows/src/node-transcript.ts:70-91`
- Read model: `packages/server/src/routes/api.ts:5842-5964`
- Existing two-sender test: `dag-executor.test.ts:26646` (op-a, op-b in one turn)

## Key insights

- The executor never inspects `operatorUserId`; it forwards the drained array.
  The test's job is to show `seq` order equals array order and that the
  metadata survives the `transcriptMetadata(scope, …)` merge.
- Concurrent nodes in one DAG layer share one `mockSendQueryDag`; branch on
  the prompt argument to give each node its own script, and enqueue to each
  node's own handle from inside its first turn.
- The interleaving that matters at this layer is "A queued, B queued, A queued
  again" across turn boundaries: a1 before turn 1 ends, then during turn 2 b1
  and a2 arrive, then turn 3 is caused by `[b1, a2]`. This shows receipt order
  across turns and per-sender order across turns.

## Requirements

- Functional: per-row `operator_user_id`/`message_id` equal the drained
  message; rows ordered by `seq` in receipt order; all rows of one batch share
  the caused turn's `attempt_id`; loop rows carry `loop_ancestry`; cross-node
  rows land only under their own `node_id`; read model resolves names per
  sender and never projects node A's senders for node B.
- Characterization note: the prompt assertions pin today's delivery mechanism
  (drained messages joined with `\n\n` into one resumed-session prompt). When
  soft-inject (CAP-5, G2–G4) ships, the prompt-string assertions will need
  revisiting; the row-order and attribution assertions will not.
  <!-- Updated: Red Team 2026-09-20 — finding A6 (soft-inject forward note) -->
- Non-functional: deterministic; reuse existing helpers; no new mock modules.

## Files to create / modify

- Modify: `packages/workflows/src/dag-executor.test.ts`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts` (read-model block)
- Modify (only on a red test): `packages/workflows/src/dag-executor.ts`, `packages/server/src/routes/api.ts`

## Tests before (write first)

In `describe('executeDagWorkflow -- queued guidance (#181)')`:

1. **mixed-operator guidance across two boundaries keeps receipt order, per-
   sender order, and attribution** — turn 1 enqueues `a1` (op-a); turn 2 (the
   guidance turn for `[a1]`) enqueues `b1` (op-b), `a2` (op-a), `b2` (op-b);
   turn 3 is caused by `[b1, a2, b2]`; turn 3 ends with an empty queue. Assert
   three `sendQuery` calls; prompt 2 is `a1` text; prompt 3 joins `b1\n\na2\n\nb2`;
   operator rows by `seq` are `[a1, b1, a2, b2]` with senders
   `[op-a, op-b, op-a, op-b]` and matching `message_id`s; rows `b1,a2,b2` share
   turn 3's `attempt_id` and `a1` shares turn 2's; each sender's subsequence
   is in its own written order.
2. **two concurrent nodes keep their operators' rows apart** — DAG
   `[{id:'node-a'},{id:'node-b'}]` (no `depends_on`); each first turn enqueues
   to its own handle (`op-a` → node-a, `op-b` → node-b, plus one `op-a` message
   to node-b to prove isolation is by node, not by sender). Assert
   `listNodeMessages(RUN_ID,'node-a')` operator rows contain only node-a ids
   and `node-b` only node-b ids; the `op-a` row under node-b carries `op-a`.

In `describe('executeDagWorkflow -- interrupt and redirect (#183)')`:

3. **Send now by a second operator drains the first operator's awaiting items
   first, all attributed** — mirror the test at ~27432 but **do not use the
   polling `awaitIdle()` helper** (`dag-executor.test.ts:27341-27349` loops on
   `Bun.sleep(1)`, which contradicts this plan's determinism constraint).
   Instead capture the interrupt promise through a test-owned deferred: the
   test creates `let signalInterrupt!: (p: Promise<string>) => void; const
   interruptStarted = new Promise<Promise<string>>(r => { signalInterrupt = r; })`
   before `invokeDag`; turn 1 calls `signalInterrupt(liveHandle(...).interrupt())`;
   the test then does `const outcome = await (await interruptStarted)` and
   asserts `outcome === 'idle-after-interrupt'`. This resolves exactly when
   the executor calls `enterIdle`, which is the state the test needs. Do not
   `await` a `let interruptOutcome` assigned inside the generator — at that
   point it is still `undefined`, `await undefined` returns immediately, and
   the test silently races the executor. Then `enqueue` `a1` (op-a) and `a2` (op-a),
   then `sendNow` `b1` by op-b (extend `sendNow`/`steeringMessage` in the #183
   describe to accept an operator id, defaulting to the current `'op-1'`).
   Assert prompt 2 is `a1\n\na2\n\nb1`; rows `[a1,a2,b1]` with senders
   `[op-a,op-a,op-b]`; all three share the redirect turn's `attempt_id`; the
   `interrupted` status row precedes them.
   <!-- Updated: Red Team 2026-09-20 — finding F4 (timer poll in awaitIdle) -->

Loop mirror (same describe as the loop guidance test at ~26960):

4. **loop guidance from two operators lands inside the iteration in receipt
   order with attribution and loop ancestry** — iteration 1 enqueues `a1`
   (op-a), `b1` (op-b); the guidance turn completes the loop. Assert prompt 2
   joins `a1\n\nb1`; rows `[a1,b1]` with senders `[op-a,op-b]`; both carry
   `loop_ancestry: [{node_id:'my-loop', iteration:1}]` and the caused turn's
   `attempt_id`.

Read model (`api.workflow-runs.test.ts`, after the A/B/A test at ~3501):

5. **display-name lookup is scoped to the requested node's rows** — mock
   `listNodeMessages` to return node `plan` rows from `user-a` and `user-b`
   for `/nodes/plan/messages`, and separately node `review` rows from
   `user-c` for `/nodes/review/messages`. Assert the first request calls
   `getUserDisplayNamesByIds` with exactly `['user-a','user-b']` and the
   second with exactly `['user-c']`; names project per row; a `user-b` row
   never receives `user-a`'s name.
6. **interleaved senders with one unknown id and one null id resolve per row**
   — rows `[user-a, user-x(unknown), null, user-b]` → names
   `['A', 'user-x'.slice(0,8), null, 'B']`.

## Refactor (protected code)

None expected. A red test 2 would mean rows are keyed by something other than
`stepName`; a red test 1 would mean the drain or writer reorders. Fix minimally
and document.

## Tests after

None beyond the "before" set.

## Regression gate

```bash
cd packages/workflows && bun test src/dag-executor.test.ts
cd packages/server && bun test src/routes/api.workflow-runs.test.ts
```

## Implementation steps

1. Run the scout pass; note the exact helper signatures.
2. Extend `enqueue`/`sendNow` helpers with an optional operator id parameter
   (keep defaults so existing tests are untouched).
3. Add tests 1–4 in `dag-executor.test.ts`; add tests 5–6 in
   `api.workflow-runs.test.ts`.
4. Run the regression gate; fix production code only on red.
5. Write `reports/phase-03-evidence.md`.

## Todo

- [ ] helpers extended without changing existing behavior
- [ ] executor tests 1–4 green
- [ ] read-model tests 5–6 green
- [ ] evidence report written

## Success criteria

- Rows, order, attribution, attempt scoping, and loop ancestry are asserted in
  one place per path (direct, send_now, loop, concurrent nodes).
- `bun test src/dag-executor.test.ts` remains under its current wall-clock
  (no new timers).

## Risk assessment

- Medium: `dag-executor.test.ts` is 28k lines; anchors drift. The scout pass
  and helper reuse limit blast radius.

## Security considerations

- Confirms the permanent audit trail attributes each message to its actual
  sender and that a node's transcript never contains another node's steering.

## Next steps

Phase 4 proves the same in the browser on both shells with two identities.
