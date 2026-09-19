# Claude interrupt + resume spike report

Real-SDK gate for the `interrupt: 'native'` capability seam. Sanitized — contains
no prompts, credentials, environment values, or model content.

## Command

```bash
cd packages/providers && bun run spike:interrupt:claude
# => bun src/claude/interrupt-resume-spike.ts
```

## SDK pin

`@anthropic-ai/claude-agent-sdk@0.3.209`

## Outcome

`protocol: "interrupt-turn-resume"` — gate passed. `sessionIdConsistent: true`,
`failureCategory: null`.

## Protocol observed

Three live turns against one Claude CLI subprocess lineage:

1. **New session** — streaming-input `query()`, interrupted mid-turn.
2. **Resumed session** — `resume: <sessionId>` on a fresh `query()`, interrupted
   mid-turn again.
3. **Continuation** — normal streamed user message on the same session id,
   allowed to complete un-interrupted.

## Interrupt turn evidence (identical shape on new and resumed sessions)

| Field                      | Observed                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| `interruptDelivered`       | `true` — fired on the first `assistant` event                      |
| `ackResolved`              | `true` — `Query.interrupt()` promise resolved                      |
| `still_queued`             | `[]` (`stillQueuedCount: 0`)                                       |
| Post-ack event ordering    | `assistant` → `user` → `result`                                    |
| `result.subtype`           | `error_during_execution`                                           |
| `result.is_error`          | `true`                                                             |
| `result.terminal_reason`   | `aborted_streaming`                                                |
| Post-result stream         | SDK throws `Claude Code returned an error result: [ede_diagnostic] |
|                            | result_type=user last_content_type=n/a stop_reason=null`           |
| `openIteratorAtCompletion` | `true` — input iterator still open at terminal result              |

## Key behaviors proven

- **`Query.interrupt()` requires streaming input** — it is only available on a
  `query()` whose prompt is an `AsyncIterable<SDKUserMessage>`; a string-prompt
  query exposes no `interrupt()`.
- **Do not await `interrupt()` inside the stream loop** — the acknowledgement is
  serviced by the same stream pump; `await stream.interrupt()` inside
  `for await` deadlocks. Fire it unawaited and observe resolution via `.then()`.
- **Interrupt does not close the query** — the SDK controller stays alive; the
  session id remains valid for `resume`.
- **Abort-marked terminal result** — the interrupted turn ends with a `result`
  event carrying `terminal_reason: 'aborted_streaming'`,
  `subtype: 'error_during_execution'`, `is_error: true` — sufficient for the
  engine to classify the turn as interrupted rather than failed.
- **Post-result throw is expected** — after yielding the abort-marked result,
  the SDK stream throws an error-result teardown exception
  (`result_type=user` diagnostic). Consumers see the result chunk, then a throw;
  the provider surfaces both rather than swallowing either.
- **Held-open input keeps the stream open after `result`** — the subprocess
  waits for the next streamed message, so the async iterator does not terminate
  on its own. The provider resolves the input gate when the terminal result is
  observed; input EOF lets the subprocess exit and the stream drain.
- **Session-id equality** — `newSession.sessionId === resumedSession.sessionId`
  and the continuation turn on the same id completes normally
  (`continuation.resumedSameSession: true`, `continuation.completed: true`).

## Raw JSON document

Emitted on stdout by the spike (`schemaVersion: 1`). Session ids and event-type
names only — no message bodies.
