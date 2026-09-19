---
phase: 3
title: 'Executor persistence and ordering'
status: pending
priority: P1
dependencies: [1, 2]
---

# Phase 3: executor persistence and ordering

## Goal

Enable the sole live writer only after the read side is safe. Preserve each
drained message's id and sender through both executor turn loops, write one
verbatim operator row under the caused turn's attempt, and prove order,
attribution, prompt stability, and failure behavior.

## Evidence anchors

- `packages/workflows/src/steering-registry.ts`:
  `QueuedOperatorMessage` and FIFO `drain()`.
- `packages/workflows/src/node-transcript.ts`: awaited, payload-safe,
  fail-open append boundary.
- `packages/workflows/src/transcript-execution-scope.ts`:
  `newTranscriptAttempt` and `transcriptMetadata`.
- `packages/workflows/src/dag-executor.ts`:
  - direct `turns:` head, interrupt wake, and natural drain;
  - loop `turns:` head, prompt selection, interrupt wake, and natural drain;
  - both paths rotate attempt scope before a guidance turn and start the
    provider only later.
- `packages/workflows/src/dag-executor.test.ts`: existing #181 natural-drain and
  #183 interrupt/redirect harnesses, including direct, loop, and loop-group
  cases. Reuse them rather than build another executor fixture.

## Files

| File                                             | Change                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `packages/workflows/src/node-transcript.ts`      | Add one shared sequential operator-row helper.                                           |
| `packages/workflows/src/node-transcript.test.ts` | Prove exact row shape, order, null identity, and per-row fail-open continuation.         |
| `packages/workflows/src/dag-executor.ts`         | Carry drained objects and record them at the first successful provider-stream seam.      |
| `packages/workflows/src/dag-executor.test.ts`    | Extend existing natural/interrupt direct/loop/loop-group tests with the contract matrix. |

The metadata schema was widened in Phase 1. Do not modify the registry, send
or interrupt routes, store/database implementation, migrations, providers, or
workflow event model.

## Implementation sequence

### 1. Add a small writer helper

Add `appendOperatorTranscript` beside `appendToolResultTranscript`. Its input
contains run id, executor `stepName`, the current transcript execution scope,
and `readonly QueuedOperatorMessage[]`. A type-only import from the registry is
sufficient and creates no runtime dependency cycle.

For each message, in array order, await `appendNodeTranscript` with:

```ts
{
  workflow_run_id,
  node_id,
  kind: 'text',
  payload: { text: message.message },
  metadata: transcriptMetadata(scope, {
    origin: 'operator',
    operator_user_id: message.operatorUserId,
    message_id: message.messageId,
  }),
}
```

Do not trim, combine, retry, write a status/event, or add stream metadata. Do
not add another catch/log layer: `appendNodeTranscript` already catches each
append and logs only identity plus error type. Sequential awaits ensure a first
failure does not prevent later loop iterations because the inner helper
resolves fail-open.

Writer tests use two differently attributed messages and assert exact inputs,
explicit null identity, no stream fields, and original whitespace. Make the
first mock append reject and prove the second is attempted and the helper
resolves. Reuse the existing logging test to retain the no-payload guarantee.

### 2. Change the direct turn loop without changing prompts

Add `turnGuidanceMessages: readonly QueuedOperatorMessage[]` next to the direct
turn state. At both delivery points:

- interrupt wake with `kind === 'send_now'`; and
- natural-boundary `steeringHandle.drain()`;

assign the drained array instead of immediately joining it. Keep the existing
session id, `turnIsGuidance`, settlement, and `continue turns` behavior
unchanged.

At the top of the guidance branch, after
`executionScope = newTranscriptAttempt(executionScope)` and before
`reaskPrompt = turnPrompt`:

1. set `turnPrompt` from
   `turnGuidanceMessages.map(item => item.message).join('\n\n')`;
2. retain a pending receipt context containing the rotated scope and messages.

Pass that context only to guidance turn pass zero of `runStreamPass`. Inside
the existing provider-stream `try`:

- immediately before processing the first yielded `MessageChunk`, await
  `appendOperatorTranscript` and mark the context recorded;
- if the stream completes normally without yielding, append immediately after
  the `for await` loop;
- if stream startup throws before either seam, let the existing error path run
  and write no operator receipt;
- never pass the context to a structured-output re-ask.

This preserves the provider prompt byte-for-byte, places operator rows before
the first caused transcript row, and writes only after the provider stream has
successfully yielded or completed. Do not add a second catch around the
provider: transcript append itself remains fail-open through the helper.

### 3. Mirror the same data flow in the loop path

Add the message-array state next to `turnGuidancePrompt`. Replace only the two
loop drain-site joins with array assignment. At the loop guidance head, after
`iterationExecutionScope = newTranscriptAttempt(...)`:

- derive the unchanged double-newline `turnGuidancePrompt`;
- retain the iteration receipt context with `iterationExecutionScope` and the
  executor's namespaced `stepName`.

On re-ask attempt zero, append at the same first-yield/normal-empty-completion
seam, before the loop processes the first provider chunk. A startup throw
writes no receipt; later re-asks receive no context and cannot duplicate it.

Leave template substitution, loop variables, iteration accounting,
completion re-evaluation, re-asks, and session threading untouched. A guidance
turn remains inside the same loop iteration and never consumes an iteration.

### 4. Extend the existing executor matrix

Use a typed test helper that filters `NodeMessage` rows with a type predicate
(`kind === 'text' && metadata?.origin === 'operator'`) so `payload.text`
narrows without a cast. Add assertions to the closest existing #181/#183
scenario rather than creating nine mostly duplicate workflows.

| Path / condition                                          | Required proof                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct natural drain, two messages from different senders | Two rows in FIFO order; exact text/id/sender; last prior-turn seq < operator seqs < caused assistant seq; caused attempt shared; prompt is the same double-newline string. |
| Direct interrupt -> idle -> `Send now`                    | Existing `interrupted` status seq < queued rows plus typed row < resumed echo; all caller ids preserved; rows share resumed attempt and not interrupted attempt.           |
| Loop natural drain                                        | Rows remain inside the current iteration ancestry and precede the caused output; no iteration is consumed.                                                                 |
| Loop interrupt redirect                                   | Same interrupted/order/attempt guarantees under iteration scope.                                                                                                           |
| Loop-group body                                           | Row uses the namespaced body `node_id`, proving the direct helper receives `stepName`.                                                                                     |
| Null identity                                             | Metadata contains `operator_user_id: null`, not omission.                                                                                                                  |
| Structured-output re-ask                                  | Exactly one operator row even if the caused turn re-asks; the re-ask prompt behavior remains unchanged.                                                                    |
| No delivery                                               | A cancel/discard from idle-await, a resumability failure before drain, and a provider startup throw before first yield/normal completion write no operator row.            |
| Append failure                                            | Reject one of three operator appends; the node still completes, exactly the other two audit rows exist, and the provider received all three guidance messages in order.    |

Also preserve all existing #181/#183 assertions; especially session continuity,
node lifecycle, interrupt classification, and no extra turn-start event.

### 5. Prove the delivery seam, not just final order

Add two direct-path tests around the first stream item:

1. a guidance provider that throws before its first yield writes no operator
   row and follows the existing node-failure path;
2. a provider whose first yield is held proves `beginTurn` is already
   registered, then releases it and asserts the operator append completes
   before that first chunk is added to the transcript.

This avoids widening the existing unregistered between-turn Stop race: the
provider turn is registered before the new awaited audit work. A Stop during
the append targets that live turn through the existing interrupt machinery.
Do not use fire-and-forget writes or invent a provider acknowledgement/state;
neither is required to establish the common stream seam.

## Focused verification

```bash
cd packages/workflows
bun test src/node-transcript.test.ts
bun test src/dag-executor.test.ts -t 'operator'
bun test src/dag-executor.test.ts
bun test src/steering-registry.test.ts
bun run type-check
cd ../.. && bun run lint --max-warnings 0
```

Use the package test script—not root `bun test`—for broader coverage. Point any
diagnostic executor run at an empty temporary `ARCHON_HOME` and verify it does
not create a real database, because `mock.module` leakage must not conceal I/O.

## Exit criteria

- Every delivered array member maps one-to-one to a complete operator row.
- Direct, loop, and loop-group paths agree on shape, ordering, scope, and
  session behavior.
- Prompt bytes and existing provider behavior are unchanged.
- Undelivered guidance writes nothing; a transcript failure does not fail or
  alter the provider turn.
- Startup failure and first-yield ordering prove the shared delivery seam.
- All new rows are readable/renderable by the already-landed Phase 1/2 code.

## Rollback note

Reverting the two executor data-flow changes and the helper stops future rows.
Do not revert the Phase 1 metadata parser after any row has been stored: older
strict readers reject the persisted keys and can take the whole node transcript
route down.
