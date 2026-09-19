---
phase: 2
title: 'Implement the Codex provider/executor slice and conformance'
status: pending
priority: P1
effort: '1.5d'
dependencies: [1]
---

# Phase 2: implement the Codex provider/executor slice and conformance

## Goal

Implement operator stream-abort without changing node Cancel semantics, make a redirected guidance turn fail rather than lose its Codex thread, teach the executor the normalized marker, and expose the capability only when the complete path is green.

Before editing, re-read the Phase 1 report and replace every reference to “measured abort terminal” below with the exact observed variant, or the narrow enumerated OS variants if they differ. A blocked Phase 1 means this phase does not start.

## Files

| File                                            | Change                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/providers/src/types.ts`               | Export `STREAM_ABORT_TERMINAL_REASON`; document that `MessageChunk.terminalReason` may be provider-native or provider-normalized; widen `interruptSignal` docs to native and stream-abort providers; clarify that explicit `forkSession:false` requests in-place continuation. Do not add a new request field. |
| `packages/providers/src/codex/provider.ts`      | Separate signal ownership, retain a new-thread id before abort, normalize only the measured operator-abort terminal, suppress cold retry, make retry delay interruptible, and enforce strict in-place resume when `forkSession === false`.                                                                     |
| `packages/providers/src/codex/capabilities.ts`  | Change `interrupt` from `false` to `'stream-abort'` only after provider and executor behavior is implemented in the same feature slice.                                                                                                                                                                        |
| `packages/providers/src/codex/provider.test.ts` | Add focused signal, terminal, retry, strict-resume, and capability tests using the existing SDK mocks.                                                                                                                                                                                                         |
| `packages/workflows/src/dag-executor.ts`        | Import the shared constant and add it to `INTERRUPT_TERMINAL_REASONS`. No new Codex branch.                                                                                                                                                                                                                    |
| `packages/workflows/src/dag-executor.test.ts`   | Add narrow Codex-shaped direct, AI-loop, and loop-group conformance cases through a provider whose type is `codex`.                                                                                                                                                                                            |

No server, route, steering-registry, or web file belongs in this phase. `mockCodexCapabilities` in `dag-executor.test.ts` is not the feature gate and need not be edited: executor registration reads the real provider registry.

## Provider design

### Per-attempt state and signal precedence

For each attempt keep local state rather than adding provider-global mutable state:

- `knownThreadId`, seeded from `thread.id ?? resumeSessionId`;
- `operatorInterruptRequested`;
- `operatorAbortForwarded` for this attempt only;
- the existing fresh `attemptController` passed to the SDK.

Wire the raw signals independently:

1. Node `abortSignal`: abort the attempt immediately. At every catch/terminal boundary, check it first and throw the existing `Query aborted`; it wins when Cancel and Stop co-fire.
2. Operator `interruptSignal`: mark intent. If `knownThreadId` is present, set `operatorAbortForwarded` and abort the attempt. If it is absent, leave the SDK running only until the normalizer consumes `thread.started`.
3. On `thread.started`, store the non-empty id before invoking a small callback that forwards any pending operator interrupt. A missing/empty id is a provider failure, not an interrupt result.
4. Remove both listeners in `finally`. Preserve the existing #1735 rule: do not abort the attempt controller merely as cleanup.

Pass the raw node signal—not the per-attempt signal—to any normalizer checks that mean whole-node Cancel. Do not add operator-interrupt checks between arbitrary events: after the SDK controller is aborted, continue consuming buffered events until the measured terminal so an already-buffered `item.completed` can yield its normal successful `tool_result`.

Special cases:

- A pre-aborted operator signal on a resumed thread has a known id, so return the marker without spawning another turn.
- A pre-aborted operator signal on a new thread still starts the stream, consumes `thread.started`, retains the id, and then forwards the abort.
- If the SDK fails before a new thread ever supplies an id, surface that failure. Never synthesize a marker with an undefined id.

### Terminal classification

Create one local predicate/helper tied to the Phase 1 evidence. If the OS results differ, enumerate those observed variants explicitly; do not collapse them into a broad crash matcher. It may produce the marker only when:

- node Cancel is not set;
- `operatorAbortForwarded` is true for the current attempt; and
- the iterator/result/throw matches the exact terminal variant recorded by Phase 1.

If Phase 1 records a clean close as the terminal, that clean close is accepted only under the same forwarded-attempt condition. `turn.completed` always produces the existing natural result even when Stop raced it. An unrelated `turn.failed`, unknown throw, or a crash before the operator abort was forwarded follows the existing error path. Do not classify with the broad `SUBPROCESS_CRASH_PATTERNS` list.

The normalized chunk is minimal:

```ts
{
  type: 'result',
  sessionId: knownThreadId,
  terminalReason: STREAM_ABORT_TERMINAL_REASON,
}
```

Do not invent usage, structured output, `stopReason`, or an error subtype for an interrupted turn. This is the chunk before the existing `withResumedOutcome()` wrapper adds its normal `resumed` observability field, so tests should use structural matching rather than require exact object equality.

### Retry and backoff

- Check node Cancel first, then an operator interrupt outcome, before `classifyAndEnrichCodexError()` can label the SDK kill retryable.
- Once operator intent exists, never cold-retry an error from that turn. A recognized forwarded abort returns the marker; an unknown terminal fails explicitly.
- Replace the bare retry sleep with a small abort-aware delay which cleans up its timer/listeners. Stop during backoff ends the retry sequence immediately and throws the retained provider error. It must not return an interrupt marker even when an id is known: the preceding unmarked error happened before Stop and remains a real failure.
- Preserve retry behavior for calls where neither signal fired.

### Strict in-place resume

Derive:

```ts
const strictInPlaceResume = resumeSessionId !== undefined && requestOptions?.forkSession === false;
```

In this mode:

- an initial synchronous `resumeThread()` error is enriched and thrown; do not call `startThread()` or emit “Starting fresh conversation”;
- if the skill-catalog compatibility path recreates the client, it must call `resumeThread()` with the same id and fail if that cannot be constructed;
- a retryable subprocess error fails instead of reaching the attempt>0 `startThread()` branch.

Keep the current fallback and warning unchanged when `strictInPlaceResume` is false. This preserves ordinary/persisted-session compatibility while making the Story 2.4 promise enforceable.

## Executor integration

Add the shared constant to `INTERRUPT_TERMINAL_REASONS`; do not add provider-name conditionals. Existing five-case classification, idle waiter, queue draining, tool settlement, validation suppression, sub-state projection, and server response remain the owners of the behavior.

The capability flip and marker recognition must be delivered together. An implementation commit/PR revision may have red tests while being developed, but no reviewable green revision may advertise `'stream-abort'` without executor recognition or vice versa.

## Tests first

### Provider tests

Use the existing `mockStartThread`, `mockResumeThread`, and `mockRunStreamed` fixtures. Pin only the terminal shape actually measured in Phase 1.

1. Capability declares `'stream-abort'` and the existing snapshot is updated.
2. Stop after `thread.started` aborts the attempt signal (which is distinct from both raw caller signals), yields one marker carrying that new id, and never retries.
3. Stop already pending on a new thread waits for `thread.started`, stores its id, then aborts; it never emits an id-less marker.
4. Stop on a resumed thread uses the seeded id; a pre-aborted signal produces the marker without calling `runStreamed()`.
5. An `item.completed` buffered after abort still yields a successful `tool_result` before the marker; an open tool remains open for executor settlement.
6. A natural `turn.completed` racing Stop remains an unmarked natural result with its normal usage.
7. The measured abort throw/result/close normalizes only after this attempt forwarded Stop. The same shape without that fact and an unknown error after Stop are real failures.
8. Node Cancel returns `Query aborted` and wins when node Cancel and Stop co-fire.
9. Stop during retry backoff cancels the delay, performs no further spawn, and surfaces the retained unmarked error even when a resumable id exists.
10. Operator abort never takes the crash classifier's cold retry path. Signal listeners and timers are detached after success, interrupt, and failure.
11. `resumeSessionId + forkSession:false` refuses all three cold-start doors: initial resume construction failure, compatibility-client resume failure, and retryable stream crash. Assert `startThread()` is never called and the error is explicit.
12. A resume with `forkSession` omitted retains the existing best-effort start-fresh fallback and warning, proving compatibility was intentionally bounded.

Keep the current node-abort, fresh-signal-per-retry, usage, skill-catalog, and model-error tests green.

### Executor conformance tests

Reuse Story 2.3 helpers; do not duplicate its full provider-independent matrix or deep-equal two large captures.

1. **Direct Codex node:** yield assistant text, an open tool, and a `stream_aborted` result with `sess-1`; assert Stop settles the tool `interrupted`, writes one interrupted row, emits no failure, leaves the node `running`, and projects `generating → idle-after-interrupt`. Then `Send now` drains old+new receipts in order with `resumeSessionId === 'sess-1'`, `forkSession === false`, and projects `generating` again.
2. **Classification boundary:** an unmarked Codex crash while the operator flag is set still fails. The existing Story 2.3 natural-race and node-Cancel tests remain the provider-independent proof for those cases.
3. **AI loop:** interrupt inside an iteration, resume `sess-1` in that same iteration, and do not consume an extra iteration before the loop's normal completion check.
4. **Loop-group body:** the provider-calling body parks and resumes under its namespaced step key.
5. Ensure the test provider returns `getType() === 'codex'`, so the real capability registry must expose the handle. A test that forces `interruptible: true` manually would not prove the capability flip.

## Implementation order

1. Reconcile this phase with the passing spike report and name the exact accepted terminal variant(s) in tests/comments.
2. Add red provider tests for signal ownership, early id retention, classification, retry suppression, and strict resume.
3. Export the marker and implement provider behavior; keep `interrupt: false` while the behavior tests (all except the deliberately red capability assertion) are being made green.
4. Add red executor conformance tests and teach the executor the marker.
5. Flip Codex capability to `'stream-abort'`; run provider and workflow tests together so this is the first green enabled state.
6. Run type-check and lint before Phase 3.

## Verification

```bash
cd packages/providers
bun test src/codex/provider.test.ts
bun test src/registry.test.ts

cd ../workflows
bun test src/dag-executor.test.ts -t 'Codex interrupt'
bun test src/dag-executor.test.ts
bun test src/steering-registry.test.ts

cd ../..
bun run type-check
bun run lint --max-warnings 0
```

## Failure handling and rollback

- If the mocked implementation needs a broader abort classifier than the spike supports, stop and rerun/extend the spike; do not guess.
- If deferring abort until `thread.started` cannot be implemented without losing events or hanging, keep the capability false and report the blocker.
- If strict resume breaks an existing Codex caller, prove whether that caller sends `forkSession:false`. Do not restore cold fallback for guidance; choose a caller-specific contract only with new evidence.
- Rollback sets the capability back to `false` and removes the provider interrupt wiring. The executor marker remains inert and safe.
