---
phase: 1
title: 'Transcript metadata and executor operator rows'
status: pending
priority: P1
effort: '1 session'
dependencies: []
---

# Phase 1: transcript metadata and executor operator rows

## Goal

Make the engine record every delivered operator message as one ordinary
`text` transcript row with additive `origin`, `operator_user_id`, and
`message_id` metadata, written by the executor at the head of the guidance turn
it caused — on both the direct-node and loop-node paths — and prove ordering,
attempt placement, prompt-byte stability, and fail-open behaviour before any
server or web code changes.

## Evidence anchors

- Strict metadata schema: `packages/workflows/src/schemas/node-execution.ts:29-43`
  (`nodeTranscriptMetadataSchema`, `.strict()`; `message_id` already at `:34`).
- Row schemas and `AppendNodeMessageInput`: `packages/workflows/src/schemas/node-message.ts`.
- Scope helpers: `transcriptMetadata(scope, extra)` and `newTranscriptAttempt`
  in `packages/workflows/src/transcript-execution-scope.ts:128-133` and `:41-43`.
- Fail-open writer and its tool-result sibling: `packages/workflows/src/node-transcript.ts`.
- `QueuedOperatorMessage` (`messageId`, `message`, `operatorUserId: string | null`,
  `receivedAt`): `packages/workflows/src/steering-registry.ts:34-39`.
- Direct node path, `packages/workflows/src/dag-executor.ts`:
  - `scopeMeta()` / `recordNodeStatus` helpers `:2136-2149`;
  - `turns:` loop head with the guidance-turn attempt rotation `:3263-3286`
    (`let turnPrompt = finalPrompt;` `:3263`, `executionScope = newTranscriptAttempt(executionScope);` `:3275`, `let reaskPrompt = turnPrompt;` `:3291`);
  - interrupt → idle-await → `send_now` redirect `:3480-3521`
    (`turnPrompt = wake.messages.map(item => item.message).join('\n\n');` `:3510`);
  - natural-boundary drain `:3617-3648`
    (`turnPrompt = drained.map(item => item.message).join('\n\n');` `:3640`).
- Loop node path, same file:
  - `recordLoopStatus(scope, state, detail?)` `:5721-5732`;
  - per-iteration turn state `:6131-6137` (`let turnGuidancePrompt: string | undefined;` `:6135`);
  - `turns:` head with attempt rotation `:6148-6154`;
  - prompt selection `:6269-6272` (`turnGuidancePrompt !== undefined ? turnGuidancePrompt : substitute…`);
  - interrupt → `send_now` redirect `:7060-7105` (`turnGuidancePrompt = wake.messages…join` `:7101`);
  - natural-boundary drain `:7310-7360` (`turnGuidancePrompt = drained…join` `:7355`).
- Executor test harness: `createMockStore()` captures `appendNodeMessage` rows
  with monotonically increasing `seq` and serves them through
  `listNodeMessages` (`packages/workflows/src/dag-executor.test.ts:138-268`);
  the `#181` block (`:26509`) has `enqueue`, `invokeDag`, `sendQueryArg`; the
  `#183` block (`:27068`) has `sendNow`, `awaitIdle`, `transcriptStates`
  (`:27120-27175`).
- Existing schema compatibility tests:
  `packages/workflows/src/schemas/node-execution.test.ts:22+`; writer tests:
  `packages/workflows/src/node-transcript.test.ts`.

## Files

| File | Action |
|------|--------|
| `packages/workflows/src/schemas/node-execution.ts` | Add `origin` and `operator_user_id` to `nodeTranscriptMetadataSchema`. |
| `packages/workflows/src/schemas/node-execution.test.ts` | Round-trip and strictness tests for the operator triple. |
| `packages/workflows/src/node-transcript.ts` | Add `appendOperatorTranscript(store, input)` — one text row per message, sequential, fail-open. |
| `packages/workflows/src/node-transcript.test.ts` | Tests for row shape, order, null user, and fail-open on the new helper. |
| `packages/workflows/src/dag-executor.ts` | Carry `turnGuidanceMessages` across both `turns:` loops; derive the prompt and write operator rows at each loop head. |
| `packages/workflows/src/dag-executor.test.ts` | Extend the `#181`/`#183` blocks with the operator-row matrix. |

Do not modify the registry, the send/interrupt/withdraw/queue routes, the
database layer, migrations, or any provider. No change to
`packages/workflows/src/index.ts` — the helper is imported by the executor
from `./node-transcript` like its siblings.

## TDD sequence

Write and run each red test before the code that turns it green.

### Step 1 — schema (red → green)

In `node-execution.test.ts`, inside `describe('node message metadata compatibility')`
after the `accepts provider outcome and exit code on result rows` test:

- `accepts the operator triple on a text row` — parse
  `{ execution: <valid scope>, origin: 'operator', operator_user_id: 'user-1', message_id: '<uuid>' }`
  and expect equality.
- `accepts a null operator_user_id for identity-less installs` — same with
  `operator_user_id: null`.
- `rejects an unknown origin value` — `origin: 'assistant'` fails.
- `still rejects unknown keys` — `{ origin: 'operator', speaker: 'x' }` fails
  (strictness preserved).

Then edit `nodeTranscriptMetadataSchema`:

```ts
message_id: z.string().min(1).optional(),   // existing; an operator row stores the send-route message_id here
…
outcome: …,
exit_code: …,
/** Operator guidance receipt (#188): who said it and which send it was. */
origin: z.enum(['operator']).optional(),
operator_user_id: z.string().min(1).nullable().optional(),
```

Run: `cd packages/workflows && bun test src/schemas/node-execution.test.ts`.

### Step 2 — writer helper (red → green)

In `node-transcript.test.ts`, after the `appends a second tool row…` test, add
tests driving a mock store whose `appendNodeMessage` records inputs:

- `writes one operator text row per message in receipt order` — two messages
  → two `kind: 'text'` inputs in order, each with `payload.text` equal to the
  verbatim message and `metadata` equal to
  `{ execution: scope, origin: 'operator', operator_user_id: 'op-1', message_id: 'm-1' }`
  (`m-2` on the second); no `text_mode`, `stream_id`, or `block_id`.
- `records a null operator_user_id explicitly` — `operatorUserId: null` →
  `metadata.operator_user_id === null` (present, not omitted).
- `fails open per row and never logs the message body` — store rejects on the
  first append; the second still lands; the helper resolves; captured log
  argument contains `workflowRunId`, `nodeId`, `kind: 'text'`, `errorType`
  and does **not** contain the message string (mirror the existing
  `fails open and excludes the payload from logs` test's logger capture).

Then add to `node-transcript.ts`:

```ts
import type { QueuedOperatorMessage } from './steering-registry';
import type { TranscriptExecutionScope } from './schemas/node-execution';
import { transcriptMetadata } from './transcript-execution-scope';

/**
 * Record delivered operator guidance (#188): one ordinary `text` row per
 * message, in receipt order, carrying the additive operator triple. Written by
 * the executor at the head of the turn the guidance causes, so `seq` places it
 * between the turn it interrupted/followed and the turn it started. Fail-open
 * like every transcript write — a lost receipt is reconciled client-side, never
 * a node failure.
 */
export async function appendOperatorTranscript(
  store: IWorkflowNodeMessageStore,
  input: {
    workflow_run_id: string;
    node_id: string;
    scope: TranscriptExecutionScope;
    messages: readonly QueuedOperatorMessage[];
  }
): Promise<void> {
  for (const message of input.messages) {
    await appendNodeTranscript(store, {
      workflow_run_id: input.workflow_run_id,
      node_id: input.node_id,
      kind: 'text',
      payload: { text: message.message },
      metadata: transcriptMetadata(input.scope, {
        origin: 'operator',
        operator_user_id: message.operatorUserId,
        message_id: message.messageId,
      }),
    });
  }
}
```

`steering-registry.ts` has no imports, so the type-only import introduces no
cycle (verify with `bun run type-check`). The send route already rejects blank
messages (`sendWorkflowNodeBodySchema`), so `payload.text` `min(1)` cannot
trip on a delivered message.

Run: `cd packages/workflows && bun test src/node-transcript.test.ts`.

### Step 3 — executor matrix (red)

Add a helper next to `transcriptStates` in the `#183` block (and re-use it from
the `#181` block by hoisting it above both `describe`s, or duplicating the
five-line body — either is fine, the harness already duplicates `liveHandle`):

```ts
type OperatorRow = { seq: number; text: string; metadata: NodeMessage['metadata'] };
async function operatorRows(store, runId, stepName): Promise<OperatorRow[]> {
  const rows = await store.listNodeMessages(runId, stepName);
  return rows
    .filter(
      (r): r is Extract<NodeMessage, { kind: 'text' }> =>
        r.kind === 'text' && r.metadata?.origin === 'operator'
    )
    .map(r => ({ seq: r.seq, text: r.payload.text, metadata: r.metadata }));
  // The type predicate is required: a boolean filter does not narrow `r.payload`
  // for the following `.map`, so `r.payload.text` would not type-check.
}
```

Add these tests (names are the contract; put the `#181` ones after
`drains queued guidance as one follow-up turn resuming the settled session` and
the `#183` ones after `interrupt parks an abort-marked result in idle and Send now drains…`):

1. `#181` — `records one operator row per drained message at the natural boundary, in receipt order`:
   two enqueues during turn 1 → after the run, `operatorRows` has two rows with
   texts `first note`, `second note`; `metadata.origin === 'operator'`,
   `operator_user_id === 'op-1'`, `message_id` equal to the enqueue ids; every
   operator `seq` is greater than every turn-1 row `seq` and less than every
   turn-2 row `seq` (identify turn-2 rows by the second assistant text);
   `sendQueryArg(1, 0)` still equals `'first note\n\nsecond note'`.
2. `#181` — `writes operator rows under the guidance turn's attempt, not the settled turn's`:
   the operator rows' `metadata.execution.attempt_id` equals the redirect
   turn's assistant row `attempt_id` and differs from turn 1's; `occurrence_id`
   is shared.
3. `#181` — `records a null operator_user_id when the sender had no identity`:
   enqueue with `operatorUserId: null` (extend the local `enqueue` helper with an
   optional override) → `metadata.operator_user_id === null`.
4. `#181` — `records loop guidance rows inside the iteration under the loop's namespaced scope`:
   extend `delivers loop guidance inside the current iteration` (or add a
   sibling) to assert one operator row whose `seq` sits between the
   `iteration_started`-turn rows and the guidance-turn rows, and whose
   `execution.loop_ancestry` matches the iteration.
5. `#183` (place it there — its fixture lives in that block) —
   `records operator rows for a loop-group body node under the namespaced step name`:
   reuse the loop-group fixture from `interrupt of a loop-group body node parks under the namespaced step name`
   with queue intent → `operatorRows(store, RUN_ID, '<group>.<node>')` has one row.
6. `#183` — `records operator rows after the interrupted status row and before the redirect turn`:
   in the existing interrupt→`Send now` scenario, assert three operator rows in
   order `old note one`, `old note two`, `new instruction`; the `interrupted`
   status row `seq` < first operator `seq`; the `redirected output` assistant
   row `seq` > last operator `seq`; `message_id` values match `m-old-1`,
   `m-old-2`, `m-new`.
7. `#183` — `writes no operator row when idle-await ends without a redirect`:
   in the discard/cancel scenario (`interrupt discards the idle waiter into the existing Cancel path`)
   assert `operatorRows` is empty.
8. `#183` — `an operator-row append failure does not fail the guidance turn`:
   wrap `store.appendNodeMessage` to reject once when
   `input.metadata?.origin === 'operator'` in a three-message redirect. Assert
   all three precisely so the test cannot pass trivially: the run completes
   (`node_completed`, no `node_failed`); `operatorRows` has exactly two
   entries (the rejected one is lost, not retried); and
   `sendQueryArg(1, 0)` still contains all three messages in order.
9. `#183` — `records operator rows inside a loop iteration redirect`:
   extend `interrupt in an AI loop idles inside the iteration and Send now resumes without consuming one`
   with the same seq/attempt assertions as test 6.

Run to confirm red: `cd packages/workflows && bun test src/dag-executor.test.ts -t "operator row"`.

### Step 4 — executor (green)

Direct node path (`dag-executor.ts`):

1. Import `appendOperatorTranscript` beside `appendNodeTranscript` and
   `type QueuedOperatorMessage` from `./steering-registry`.
2. Next to `let turnIsGuidance = false;` (`:3265`) declare
   `let turnGuidanceMessages: readonly QueuedOperatorMessage[] = [];`.
3. In the guidance branch at the `turns:` head (`:3270-3276`), after
   `executionScope = newTranscriptAttempt(executionScope);` — this block runs
   before `let reaskPrompt = turnPrompt;` (`:3291`), which is what lets the
   re-ask path re-ask the guidance text; the write must stay inside this
   block, never after the re-ask setup — add:

   ```ts
   // Operator receipt rows (#188): written under the attempt this guidance
   // causes, after the rotation and before the provider pass, so `seq`
   // places them between the turn they interrupted/followed and the turn
   // they start. Prompt bytes keep the #181 double-newline join.
   turnPrompt = turnGuidanceMessages.map(item => item.message).join('\n\n');
   await appendOperatorTranscript(deps.store, {
     workflow_run_id: workflowRun.id,
     node_id: stepName,
     scope: executionScope,
     messages: turnGuidanceMessages,
   });
   ```

4. At the `send_now` wake (`:3508-3513`) replace the join with
   `turnGuidanceMessages = wake.messages;` (keep `turnResumeId`, `turnIsGuidance`).
5. At the natural drain (`:3634-3642`) replace the join with
   `turnGuidanceMessages = drained;`.

Loop node path:

6. Next to `let turnGuidancePrompt: string | undefined;` (`:6135`) declare
   `let turnGuidanceMessages: readonly QueuedOperatorMessage[] = [];`.
7. In the guidance branch at the loop `turns:` head (`:6152-6154`), after
   `iterationExecutionScope = newTranscriptAttempt(iterationExecutionScope);`
   add the same derivation + write using `iterationExecutionScope` and
   `turnGuidancePrompt = …join('\n\n')`.
8. Replace the two joins (`:7101`, `:7355`) with
   `turnGuidanceMessages = wake.messages;` / `= drained;`.

`turnGuidancePrompt`'s existing consumers (`:6270`) and the direct path's
`reaskPrompt = turnPrompt` (`:3291`) are downstream of the head, so re-ask on a
guidance turn still re-asks the guidance text.

**Known, accepted boundary widening (red-team F1).** Between the drain
site's `settleTurn` (clears `currentTurn`, `steering-registry.ts:205-210`)
and `beginTurn` inside `runStreamPass`, the executor is synchronous today, so
a Stop landing there resolves `'generating'` (`:243-248`) within a microtask.
The awaited operator-row writes make that window as long as the sequential
appends (local DB milliseconds per message). A Stop pressed inside it still
resolves `'generating'` — the same visible, already-specified outcome as a
Stop racing a natural boundary (#183) — so the press is spent, not silently
lost, and the operator's next Stop lands on the new turn. Fire-and-forget
writes were rejected because `seq` ordering before the redirect turn's first
row is the acceptance criterion and concurrent appends do not guarantee it;
registering a pre-turn interrupt slot in the registry is a possible follow-up
if the window proves user-visible. Add the executor test
`a Stop during the operator-row write resolves generating and the redirect turn stays interruptible`:
make the mock store's operator append await a deferred, call
`interrupt()` while it is pending, expect `'generating'`, release the write,
then interrupt turn 2 and expect `'idle-after-interrupt'`. Nothing else in the drain sites
changes: `settleTurn`, `turnResumeId`, `continue turns`, the resumability
failures, and every log line stay as they are.

Run green: `cd packages/workflows && bun test src/dag-executor.test.ts`.

## Verification

```bash
cd packages/workflows
bun test src/schemas/node-execution.test.ts
bun test src/node-transcript.test.ts
bun test src/dag-executor.test.ts
bun test src/steering-registry.test.ts        # untouched, must stay green
cd ../.. && bun run type-check && bun run lint
```

Also run the executor test file with `ARCHON_HOME` pointed at an empty temp
dir and confirm no `archon.db` appears (AGENTS.md mock-isolation audit).

## Success criteria

- [ ] Four new schema tests green; strictness preserved.
- [ ] Three new writer tests green; log capture never contains message text.
- [ ] Nine executor tests green covering direct natural, direct interrupt,
      loop natural, loop interrupt, loop-group body, null identity, attempt
      placement, no-redirect, and fail-open.
- [ ] `sendQueryArg` prompt assertions in every pre-existing `#181`/`#183`
      test still pass unchanged.
- [ ] Type-check and lint clean with zero warnings.

## Risks and rollback

The change is confined to one schema, one helper, and eight small executor
edits; reverting the executor edits restores the string-join drain sites
byte-for-byte. The schema addition is additive and safe to leave in place on
rollback.
