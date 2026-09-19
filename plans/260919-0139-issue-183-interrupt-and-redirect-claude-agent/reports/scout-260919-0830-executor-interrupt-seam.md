# Scout: executor interrupt seam for issue #183 (Story 2.3)

Spec read: `_bmad-output/specs/spec-agent-node-room/engine-integration.md` §2 (five-case
end-cause rule, placement rules), §3 (in-process registry / process-boundary steerability),
§4 (operator transcript row). All line anchors below verified directly against
`packages/workflows/src/dag-executor.ts` (11523 lines total) on this worktree, not from
the spec's own citations (a few of the spec's line numbers have drifted; anchors here are
current).

**Headline finding: none of the interrupt/operatorInterrupt/per-turn-signal machinery
exists yet.** `grep -n "interrupt\|Interrupt\|perTurnSignal\|AbortSignal.any\|operatorInterrupt"
dag-executor.ts steering-registry.ts` returns zero hits inside executable code (only two
unrelated comment/string matches: `dag-executor.ts:3294` "stream interruption" prose, and
`:7854` "interrupted run" prose). `steering-registry.ts` has no `interrupt()` method on
`NodeSteeringHandle` — only `enqueue/pendingCount/closeIfEmpty/drain/park/resume/close/
snapshot/discard`. `packages/server/src/routes/api.ts:1580-1583` (the Send-guidance route's
OpenAPI description) explicitly says guidance "queues identically until an idle-after-interrupt
state exists" — i.e. the send route already anticipates Story 2.3 but the interrupt route
itself is not built. This is fully greenfield work layered onto Story 2.1's registry and
turn-loop plumbing.

---

## 1. `executeNodeInternal` (direct AI/prompt nodes)

Function signature: `dag-executor.ts:1951-1975`, `stepName = stepNamePrefix + node.id`
(`:1982`).

### (a) `nodeAbortController` creation + `abortSignal` wiring
```
2209:  const nodeAbortController = new AbortController();
```
Passed into the options object used for every `sendQuery` call in this node:
```
2223:  const nodeOptionsWithAbort: SendQueryOptions | undefined = {
2224:    ...nodeOptions,
2224:    abortSignal: nodeAbortController.signal,
```
`nodeOptionsWithAbort` is built ONCE per node (outside the turn loop) and is spread into
`passOptions` fresh on every `runStreamPass` call (`:2270: const passOptions: SendQueryOptions
= { ...(nodeOptionsWithAbort ?? {}) };`). This is the one-shot node-level controller — it is
never recreated across turns.

### (b) `runStreamPass` → `aiClient.sendQuery`
`runStreamPass` is defined `:2262-2296` (annotated as the "One sendQuery stream pass" —
resets `nodeOutputText`, `structuredOutput`, `batchMessages`, `nodeCostUsd`,
`nodeIdleTimedOut`, `backgroundTasksIncomplete` at entry). The actual call:
```
2290:      for await (const msg of withIdleTimeout(
2291:        aiClient.sendQuery(attemptPrompt, cwd, attemptResumeId, passOptions),
2292:        effectiveIdleTimeout,
2293:        () => {
2294:          nodeIdleTimedOut = true;
...
2299:          nodeAbortController.abort();
2300:        }
2301:      )) {
```
Invoked from two call sites in the turn/reask loops: `:3056` (normal turn/reask attempt,
`reaskAttempt === 0 ? turnResumeId : undefined` as the resume id) — no second call site for
guidance; the SAME `runStreamPass` closure is reused for guidance turns because `turnPrompt`/
`turnResumeId` are reassigned before `continue turns` (see (e)).

### (c) `canReask` computed
```
3070:        if (!nodeOptions?.outputFormat) break;
3074:        const canReask =
3075:          reaskAttempt < maxReasks && !nodeIdleTimedOut && !nodeAbortController.signal.aborted;
```
This sits INSIDE the validate/reask `while (true)` loop, itself inside the outer `turns:`
loop, immediately after `runStreamPass` returns (`:3056-3068`) and BEFORE any Cancel check —
i.e. **validation runs unconditionally whenever `nodeOptions?.outputFormat` is set,
regardless of abort state** (only `canReask`'s decision to retry vs. throw is abort-aware).
This is the ordering the spec's §2 comment references ("stream → validation → canReask →
:3124 Cancel check → completion").

### (d) Cancel check site
```
3189:      if (nodeAbortController.signal.aborted && !nodeIdleTimedOut) {
```
This sits AFTER the entire validate/reask loop exits (`break`/throw at `:3070-3229` range)
and after the "completed via idle timeout" message block (`:3183-3193` roughly). On true
(Cancel or a non-idle abort of the node-level controller), it seals the steering handle
(`steeringHandle?.close()` at `:3192`), writes `node_failed` + `recordFailedStatus('Cancelled
by user')`, and `return`s — it does NOT throw, so the `:3489` catch-classifier never sees it
for this path.

### (e) Natural-boundary `closeIfEmpty`/drain gate
```
3335:      // Natural-boundary last gate (#181) — fully synchronous so no route-side
3336:      if (steeringHandle !== undefined && !nodeIdleTimedOut) {
3337:        if (!steeringHandle.closeIfEmpty()) {
3341:          if (newSessionId === undefined) {
3342:            steeringHandle.close();
3343:            throw new Error(...)
3347:          const drained = steeringHandle.drain();
3348:          turnPrompt = drained.map(item => item.message).join('\n\n');
3349:          turnResumeId = newSessionId;
3350:          turnIsGuidance = true;
3351:          continue turns;
3352:        }
3353:      }
3355:      steeringHandle?.close();
3356:      break turns;
```
This sits AFTER the Cancel check (d), the credit-exhaustion check (`:3244-3280`), and the
empty-output check (`:3283-3327`) — i.e. it is the LAST gate before either draining into
turn N+1 or falling through to `node_completed`.

### (f) Catch-block classifier
```
3387:  } catch (error) {
3396:    if (error instanceof AskHumanAwaitingError) {
3399:      steeringHandle?.park();
3400:      await pauseOnAskHuman(...)
3401:      steeringPauseCommitted = steeringHandle !== undefined;
3402:      return { state: 'pending', ... }
3413:    }
3417:    steeringHandle?.close();   // every OTHER terminal path seals here
...
3495:    if (
3496:      nodeAbortController.signal.aborted &&
3497:      !nodeIdleTimedOut &&
3498:      !(error instanceof AskHumanNoStarterError) &&
3499:      !(error instanceof AskHumanPauseFailedError)
3500:    ) {
3501:      getLog().info({ nodeId: node.id }, 'dag_node_cancelled_via_abort');
3502:      await recordFailedStatus('Cancelled by user');
3503:      return { state: 'failed', ..., error: 'Cancelled by user' };
3504:    }
3508:    getLog().error({ err, nodeId: node.id }, 'dag_node_failed');   // generic node_failed path
```
This is the `:3387` classifier the spec cites for a *thrown* abort (spec case 3: OMP-style
`Query aborted` throw). Note it checks `nodeAbortController.signal.aborted`, not any
per-turn signal — a per-turn interrupt throw would need its own branch here (or a check on
`operatorInterrupt`) inserted BEFORE the generic `dag_node_failed` fallthrough at `:3508`,
mirroring how `AskHumanAwaitingError` gets special-cased above it.

### (g) `newSessionId` capture — result chunk only
```
2557:        } else if (msg.type === 'result') {
...
2578:          if (msg.sessionId) newSessionId = msg.sessionId;
```
Confirmed: `newSessionId` is set ONLY inside the `msg.type === 'result'` branch of the
stream-consuming loop, and only when `msg.sessionId` is truthy. It is reset to `undefined`
at the top of every turn (`:3025: newSessionId = undefined as string | undefined;`, inside
the outer `turns:` loop, before `runStreamPass`) — so a turn that never reaches a `result`
chunk (e.g. it is interrupted mid-stream before the provider emits one) leaves
`newSessionId === undefined`, which is exactly the case (e) throw guards against for guidance
drains, and is the reason the spec calls out that an interrupted turn's session-id
availability is NOT guaranteed the same way a natural completion's is — the DeepSeek
abort-marked-`result` case (spec case 2) DOES reach this branch since it's still a `result`
chunk; the OMP throw case (spec case 3) does NOT.

### (h) `runningTools` tracking + `toolOutcome: 'interrupted'` persistence
```
2242:  const runningTools = new Map<string, RunningTool>();
2421:          runningTools.set(toolCallId, { toolName: msg.toolName, startedAt: now });
```
Tool call tracked on `msg.type === 'tool'` (`:2378-2422`); on `msg.type === 'tool_result'`
(`:2478-2528`) the matching entry is found via `findRunningTool` and removed, and BOTH the
transcript metadata AND the `tool_completed` event/DB row carry the outcome:
```
2491:            metadata: scopeMeta({
...
2496:              ...(msg.toolOutcome !== undefined ? { outcome: msg.toolOutcome } : {}),
2504:              ...(msg.toolOutcome !== undefined ? { toolOutcome: msg.toolOutcome } : {}),
2516:                  ...(msg.toolOutcome !== undefined ? { tool_outcome: msg.toolOutcome } : {}),
```
`outcome` is the transcript-metadata field name (validated by
`nodeTranscriptMetadataSchema.outcome: z.enum(['success','error','interrupted','unknown'])`,
`packages/workflows/src/schemas/node-execution.ts:37` — **`'interrupted'` is already a valid
enum value today**, presumably added for provider-level tool-interruption signalling
independent of #183). So a provider `tool_result` chunk carrying `toolOutcome: 'interrupted'`
already round-trips into `metadata.outcome` with NO schema change needed. On `msg.type ===
'result'` (stream end / natural boundary), any STILL-open `runningTools` entries are force-
closed with `toolOutcome: 'unknown'` (`:2544, :2566` and the loop-node mirror `:6095, :6362`)
— **there is no equivalent force-close on the operator-interrupt path today**; when Story 2.3
adds the interrupted-end branch, a tool left running at interrupt time should presumably be
force-closed with `toolOutcome: 'interrupted'` (not `'unknown'`) at that same point, mirroring
the existing `:2536-2566` block but keyed off `operatorInterrupt` instead of `msg.type ===
'result'`.

### Recommended insertion points (executeNodeInternal)

1. **Per-turn AbortController**: create it where `turnPrompt`/`turnResumeId`/`turnIsGuidance`
   are declared (`:3016-3018`, just above `turns: while (true) {` at `:3020`), and recreate
   it at the top of the `turns:` loop body (mirroring how the loop-node path already recreates
   `iterationAbortController` per attempt — see §2). Pass `AbortSignal.any([nodeAbortController.
   signal, perTurnController.signal])` as `abortSignal` in `passOptions` inside `runStreamPass`
   (`:2270-2271`), replacing the current flat `abortSignal: nodeAbortController.signal` baked
   into `nodeOptionsWithAbort` at `:2224` — `runStreamPass` will need to read a mutable
   per-turn signal rather than the closed-over `nodeOptionsWithAbort.abortSignal`.
2. **`operatorInterrupt` reset**: reset to `false` at the same point the per-turn controller is
   recreated (top of `turns:` loop, right where `newSessionId = undefined` already resets
   per-turn state at `:3025-3026`) — the spec is explicit this must be per-turn so a stale flag
   can never mis-route a later turn.
3. **`canReask` guard**: extend `:3074-3075` to `reaskAttempt < maxReasks && !nodeIdleTimedOut
   && !nodeAbortController.signal.aborted && !operatorInterrupt`. Also gate the validation
   block itself (`:3070`'s `if (!nodeOptions?.outputFormat) break;`) — change to `if
   (!nodeOptions?.outputFormat || operatorInterrupt) break;` so an interrupted turn's partial
   structured output is never even validated (spec requirement: "no validation-miss events for
   a turn the operator deliberately cut").
4. **Interrupted-end branch placement**: immediately AFTER the Cancel check block closes
   (after `:3229`'s closing brace, before the batch-flush code at `:3232`) — i.e. between (d)
   and the credit-exhaustion check, so "Cancel dominates by position" (Cancel's `:3189` check
   is untouched and still returns first) and the new branch is the very next thing checked.
   This branch must NOT call `steeringHandle?.close()` (unlike every other terminal branch in
   this function) — the handle must stay live/park-equivalent for idle-await to keep accepting
   `Send now`.
5. **Idle-await wait before drain**: the existing natural-boundary drain gate (e) is
   synchronous and reactive (checks `closeIfEmpty()`/`pendingCount()` once, immediately).
   Idle-await is a NEW async wait state (30-minute timer + a dedicated status-poll, per spec
   §2's "idle-await resolves exactly once") that must sit where the interrupted-end branch
   (insertion 4) hands off control — it is not a reuse of `withIdleTimeout` (no stream to wrap)
   and not a reuse of `nodeIdleTimedOut` (that outcome completes the node at `:3183`, which is
   exactly the "garbage" behavior AD-4 forbids per the spec). This is genuinely new code with
   no existing analogue in this file; the closest structural precedent is the `pauseOnAskHuman`
   call pattern at `:3400` (an async wait keyed off an external signal) but AskHuman pauses the
   whole run via DB state, whereas idle-await must NOT change run status (`shouldContinueStreamingForStatus`
   note in spec §2 footer) — it is a resolve-once race between `Send now` (via the registry
   handle draining), a timer-driven Cancel status poll, and the 30-minute timeout.

---

## 2. `executeLoopNode` (loop nodes)

Two-function split: `executeLoopNode` (`:5297-5369`, thin wrapper managing the
`LoopSteeringLifecycle` finally-block teardown identical in shape to executeNodeInternal's
finally at `:3554-3568`) delegates immediately to `executeLoopNodeInner` (`:5376` onward,
signature ends `:5423`). All line numbers below are inside `executeLoopNodeInner`.

**Key structural difference from executeNodeInternal**: the loop path already creates a
FRESH `AbortController` per reask **attempt** (not just per turn) — `iterationAbortController`
is declared once per iteration (`:5863`) but reassigned inside the `attempts: while (true)`
loop (`:5931: iterationAbortController = new AbortController();`). This means the loop path
already has finer-grained abort scoping than the direct-node path; Story 2.3's "per-turn
signal" requirement is a smaller structural delta here — the existing per-attempt controller
can plausibly be `AbortSignal.any`'d with a per-turn steering signal at the same reassignment
site, rather than needing an entirely new controller layer.

### (a) Abort-controller creation/wiring
```
5863:      let iterationAbortController = new AbortController();
5931:        iterationAbortController = new AbortController();
5983:            abortSignal: iterationAbortController.signal,
```
`:5983` is inside `iterationOptions` (per-attempt), spread into the `sendQuery` call.

### (b) `sendQuery` call
```
6011:          const generator = aiClient.sendQuery(
6012:            finalPrompt,
6013:            cwd,
6014:            reaskAttempt === 0 ? turnResumeId : undefined,
6015:            iterationOptions
6016:          );
```
Wrapped in `withIdleTimeout` at `:6021-6026` with its own `onTimeout` callback calling
`iterationAbortController.abort()` (`:6027`).

### (c) `canReask` computed
```
6579:        const canReask =
6580:          reaskAttempt < maxReasks &&
6581:          !iterationIdleTimedOut &&
6582:          !iterationAbortController.signal.aborted;
```
Gated by `if (!wantsStructured) break attempts;` at `:6576` just above (structural analogue
of executeNodeInternal's `:3070`).

### (d) Cancel check site — **different position from executeNodeInternal**
```
6442:          if (iterationAbortController.signal.aborted && !iterationIdleTimedOut) {
6443:            const effectiveStatus = streamStopStatus ?? 'cancelled';
...
6449:            return await failLoopIteration(`Workflow ${effectiveStatus}`, {...});
6455:          }
```
**This sits BEFORE the structured-output gate (c) and BEFORE completion detection** — it is
inside the `try` block immediately after the `for await` stream-consuming loop ends
(`:6403`'s closing brace region), i.e. structurally earlier than the direct-node path where
validation happens before the Cancel-equivalent check. `failLoopIteration` (`:5768-5807`)
`return`s from the whole function, so nothing after `:6455` — including the structured-output
gate at `:6576` and completion detection at `:6722+` — runs when Cancel fires. This ordering
difference means an `operatorInterrupt` branch inserted right after this Cancel block (mirroring
the direct-node "insertion point 4" recommendation) automatically satisfies "skip validation,
skip completion detection" for free — no separate guard on the structured-output block is
needed here, unlike executeNodeInternal where the guard must be added explicitly at `:3070`.

### (e) Steering (natural-boundary) drain gate
```
6873:      if (
6874:        steering.steeringHandle !== undefined &&
6875:        !iterationIdleTimedOut &&
6876:        !iterationAbortController.signal.aborted
6877:      ) {
6878:        const wouldGate = !wouldComplete && loop.interactive === true && !!loop.gate_message;
6879:        const terminalBoundary = wouldComplete || (i === loop.max_iterations && !wouldGate);
6880:        const hasQueuedGuidance = terminalBoundary
6881:          ? !steering.steeringHandle.closeIfEmpty()
6882:          : steering.steeringHandle.pendingCount() > 0;
6883:        if (hasQueuedGuidance) {
6884:          if (settledTurnSessionId === undefined) {
6885:            steering.steeringHandle.close();
6886:            return await failLoopIteration(...)
6892:          }
6893:          const drained = steering.steeringHandle.drain();
6894:          turnGuidancePrompt = drained.map(item => item.message).join('\n\n');
6895:          turnResumeId = settledTurnSessionId;
6896:          turnIsGuidance = true;
6897:          continue turns;
6898:        }
6899:      }
6900:      break turns;
```
This sits AFTER `completionDetected = fieldComplete || signalDetected || bashComplete;`
(`:6867`) — i.e. AFTER the full completion-detection sequence (`fieldComplete` at `:6722`,
`signalDetected` at `:6749`, `bashComplete`/`until_bash` block `:6759-6862`). This confirms
the spec's placement instruction literally: **the interrupted-end branch (inserted right
after (d), at ~`:6455`) must sit BEFORE `fieldComplete`/`signalDetected`/`until_bash` run at
all** — "Send now continues the interrupted iteration on the same session before the normal
loop-completion check" means the interrupt short-circuit has to happen at the SAME early
point Cancel already occupies (`:6442-6455`), not at the steering boundary (e) which is
downstream of completion detection and exists only for the *natural*-end drain case.

### (f) Catch-block classifier (loop path)
The loop iteration's own `catch (error)` is `:6459-6504` (nested inside the `attempts:` loop,
NOT the outer function-level catch): handles `AskHumanAwaitingError` (`:6461-6473`, parks the
handle exactly like (f) in executeNodeInternal), `ASK_RESUME_FAILED_MESSAGE` case
(`:6474-6489`), then falls through to a generic `err.message` → `failLoopIteration` at
`:6493-6501`. There is no separate abort-vs-throw reclassification here analogous to
executeNodeInternal's `:3495-3503` — a thrown abort (e.g. OMP's `Query aborted`, spec case 3)
would land in this generic catch and go straight to `failLoopIteration`, which always fails
the iteration. Story 2.3 will need an `operatorInterrupt`-aware branch inserted before
`:6493`'s generic fallthrough, mirroring the direct-node `:3495-3503` special case.

### `failLoopNode` / `failLoopIteration` helpers
```
5507:  const failLoopNode = async (
5514:      steering.steeringHandle?.close();
```
`failLoopNode` (`:5507-5535`ish) is the OUTER-loop failure path (whole node fails before any
iteration starts, or the max-iterations exhaustion path); it unconditionally closes the
steering handle. `failLoopIteration` (`:5768-5807`) is called from WITHIN an iteration and
itself closes the handle at `:5775` (`steering.steeringHandle?.close();`) before delegating to
`failLoopNode`. **Both existing helpers close the handle unconditionally** — an
`operatorInterrupt` path must NOT call either helper directly (or must add a bypass), since
closing the handle would make it impossible for a subsequent `Send now` to resume via the
registry. This is the loop-path equivalent of executeNodeInternal's requirement that the new
interrupted-end branch not call `steeringHandle?.close()`.

### `loopGateMeta` / resume plumbing
```
5550:  const loopGateMeta = isApprovalContext(rawApproval) ? rawApproval : undefined;
5551:  const isLoopResume = loopGateMeta?.type === 'interactive_loop' && loopGateMeta.nodeId === node.id;
5568:  if (isLoopResume && loopGateMeta?.completionSignaled === true && !feedbackGiven) {
```
`loopGateMeta` is the interactive-gate (`gate_message`) resume envelope stored on the
`ApprovalContext` — unrelated in kind to the in-process steering registry (it is a DB-durable
pause, the opposite of steering's in-process-only model per spec §3). Idle-await must NOT
reuse this mechanism — confirmed by spec §3's "no durable steering state" framing. No overlap
to worry about, but worth noting `isLoopResume`'s `completionSignaled` short-circuit
(`:5568-5607`) as a DIFFERENT resume path that must remain unaffected by the new interrupt
work (it resumes a run whose interactive loop gate already signaled completion before pause —
orthogonal to `Send now` idle-await resume).

### `settledTurnSessionId`
```
5861:      let settledTurnSessionId: string | undefined;
...
6126:                  settledTurnSessionId = msg.sessionId;
```
Set inside the `msg.type === 'result'` handling in the loop's stream-consumption block
(analogous to executeNodeInternal's `newSessionId`, item (g) above), reset to `undefined` at
the top of every `turns:` iteration (`:5861` is inside the `turns: while(true)` body, before
`attempts:`). Same interrupted-turn caveat applies: an interrupted iteration may never reach a
`result` chunk, leaving `settledTurnSessionId === undefined`.

---

## 3. Loop-group body prompt nodes

Confirmed by tracing the call path (NOT the spec, which doesn't cite this): a `loop_group`
body's nodes — including `prompt:`/`command:` AI nodes — run through the exact same generic
`runLayers` dispatcher used for the top-level DAG, namespaced via `stepNamePrefix`.

- `executeLoopGroupNode` builds `bodyStepNamePrefix = \`${stepName}.\`` at `dag-executor.ts:4566`.
- Each iteration constructs `iterCtx: RunLayersContext` with `stepNamePrefix: bodyStepNamePrefix`
  (`:4766`) and calls `await runLayers(iterCtx)` (`:4772`).
- `runLayers` is the generic per-node dispatcher (defined starting `:8720`-ish, `stepNamePrefix`
  field on `RunLayersContext` at `:8720`; `ctx.stepNamePrefix` read throughout, e.g.
  `:8748, :8940, :9019, :9160`+). It dispatches bash nodes (`:9166`), loop nodes
  (`:9195-9195`, calling `executeLoopNode` with the SAME `stepNamePrefix` it received), and —
  for `prompt:`/`command:` AI nodes — calls `executeNodeInternal` at `:9772` with
  `stepNamePrefix` forwarded unchanged (the call passes `stepNamePrefix` positionally; see the
  `executeNodeInternal(...)` argument list `:9772-9793`).
- Inside `executeNodeInternal`, `stepName = stepNamePrefix + node.id` (`:1982`) — so a
  loop_group body node `review` inside group `grp` gets `stepName = 'grp.review'`.
- The steering registry is keyed by `(runId, stepName)` — `getSteeringRegistry().register(
  workflowRun.id, stepName)` at `:3001` — so the registry key for a loop_group body prompt
  node IS the namespaced id (`'grp.review'`), confirmed directly (the existing Story 2.1 test
  at `dag-executor.test.ts:26792-26798` asserts exactly this: `getSteeringRegistry().get(RUN_ID,
  'grp.body')` is the live handle and `getSteeringRegistry().get(RUN_ID, 'body')` (bare, no
  prefix) is undefined).

**Conclusion for #183**: interrupt (like send-guidance in #181) needs no special-casing for
loop_group bodies — any AI-emitting node type (`executeNodeInternal`, `executeLoopNode`) that
runs inside a loop_group body already receives the correctly namespaced `stepName` through the
existing `stepNamePrefix` threading, so the registry lookup at the route layer (by `runId` +
namespaced `nodeId`) works unchanged. `executeLoopGroupNode` itself (the group orchestrator) has
no steering handle of its own — only its BODY nodes do.

---

## 4. `recordNodeStatus` / `appendNodeTranscript` — writing an `interrupted` status row

### Direct-node path
```
2002:  const recordNodeStatus = async (state: string, detail?: string): Promise<void> => {
2003:    await appendNodeTranscript(deps.store, {
2004:      workflow_run_id: workflowRun.id,
2005:      node_id: stepName,
2006:      kind: 'status',
2007:      payload: { state, ...(detail !== undefined ? { detail } : {}) },
2008:      metadata: scopeMeta(),
2009:    });
2010:  };
2011:  const recordFailedStatus = (error: string): Promise<void> => recordNodeStatus('failed', error);
```
`recordNodeStatus('interrupted', 'awaiting operator redirect')` (or similar) would work with
**zero schema changes**: `nodeMessageStatusPayloadSchema` (`packages/workflows/src/schemas/
node-message.ts:26-28`) is `{ state: z.string().min(1), detail: z.string().optional() }` — an
open string, not an enum. `nodeExecutionSchema.status` (`node-execution.ts:47`) is likewise
`z.string().min(1)`. So `state: 'interrupted'` round-trips today exactly like `'completed'`/
`'failed'`/`'started'` do.

### Loop path — yes, it has its OWN equivalent helper
```
5429:  const recordLoopStatus = (
5430:    scope: TranscriptExecutionScope,
5431:    state: string,
5432:    detail?: string
5433:  ): Promise<void> =>
5434:    appendNodeTranscript(deps.store, {
5435:      workflow_run_id: workflowRun.id,
5436:      node_id: stepName,
5437:      kind: 'status',
5438:      payload: { state, ...(detail !== undefined ? { detail } : {}) },
5439:      metadata: transcriptMetadata(scope),
5440:    });
```
Same shape as `recordNodeStatus` but takes an explicit `TranscriptExecutionScope` parameter
(the loop path threads `outerExecutionScope` vs. `iterationExecutionScope` depending on
whether the status is about the whole node or one iteration — e.g. `:5766
recordLoopStatus(iterationExecutionScope, 'iteration_started', String(i))` vs. `:5585
recordLoopStatus(outerExecutionScope, 'completed')`). An interrupted-end status write in the
loop path would call `recordLoopStatus(iterationExecutionScope, 'interrupted', <detail>)` —
also needs no schema change.

`appendNodeTranscript` itself (`packages/workflows/src/node-transcript.ts:14-28`) is a thin
fail-open wrapper around `store.appendNodeMessage(input)` — catches and logs (never re-throws)
so a persistence failure never fails the node. `AppendNodeMessageInput` is the discriminated-
union type from `schemas/node-message.ts:39`.

---

## 5. Tests — `dag-executor.test.ts` Story 2.1 harness

`describe('executeDagWorkflow -- queued guidance (#181)', ...)` starts at `:26268` and runs to
roughly `:26825` (end of file). Structure:

- `RUN_ID = 'steering-run-1'` constant; `beforeEach`/`afterEach` call
  `getSteeringRegistry().clearForTests()` (`:26285, :26296`) to isolate the production
  singleton registry between tests — **no `mock.module()` of `./steering-registry` anywhere**;
  tests use the REAL singleton registry directly via `getSteeringRegistry()`, imported at
  `:107: import { getSteeringRegistry, type NodeSteeringHandle } from './steering-registry';`.
- `mockSendQueryDag` / `mockGetAgentProviderDag` are the pre-existing generic AI-provider mocks
  used throughout this test file (not steering-specific); `mockGetAgentProviderDag`'s
  implementation returns `{ sendQuery: mockSendQueryDag, getType: () => 'claude', getCapabilities:
  mockClaudeCapabilities }` (`:26290-26294`) — `mockClaudeCapabilities` presumably reports
  `sessionResume: true` (required for `steeringHandle` registration to happen at all, per
  `:3001`'s `aiClient.getCapabilities().sessionResume` gate).
- `liveHandle(runId, stepName)` helper (`:26309-26312`) throws unless
  `getSteeringRegistry().get(runId, stepName)` is defined — used to fetch the handle a test
  wants to `enqueue()` onto.
- `enqueue(runId, stepName, messageId, message)` helper (`:26314-26321`) calls `liveHandle(...)
  .enqueue({ messageId, message, operatorUserId: 'op-1', receivedAt: new Date().toISOString() })`
  and throws if the enqueue is refused.
- **Mid-stream enqueue pattern**: `mockSendQueryDag.mockImplementation(async function* () {
  calls++; if (calls === 1) { enqueue(RUN_ID, 'review', 'm-1', 'first note'); enqueue(RUN_ID,
  'review', 'm-2', 'second note'); yield { type: 'assistant', content: 'turn one' }; yield {
  type: 'result', sessionId: 'sess-turn-1' }; return; } yield { type: 'assistant', content:
  'turn two' }; yield { type: 'result', sessionId: 'sess-turn-2' }; })` (`:26379-26392`). The
  enqueue calls happen SYNCHRONOUSLY inside the generator body, before the first `yield` — since
  `for await` in the executor starts executing the generator body up to its first yield when it
  first calls `.next()`, this is the "between turns" simulation: the registry receives the
  enqueue before the executor consumes the stream, exercising the natural-boundary drain path
  (e) rather than a genuine "mid-generation abort". **For #183, an analogous but distinct
  pattern would be needed to simulate a genuine interrupt**: a test would need to call
  `steeringHandle.interrupt()` (or whatever the new API is named) from OUTSIDE the generator —
  e.g. from a `setTimeout`/microtask scheduled before invoking `executeDagWorkflow`, or by
  yielding a first chunk, then interrupting between yields (since the current pattern enqueues
  before any yield, a genuine "interrupt after some tokens already streamed" test needs the
  interrupt call to happen after at least one `yield`, which requires the mock generator to
  `await` something (e.g. a `Promise` the test resolves) between yields so the interrupt call
  can race it — no existing helper for this exists; it is new test-harness work.
- `storedEventTypes(store)` / `nodeFailedError(store, stepName)` (`:26323-26337`) — inspect
  `(store.createWorkflowEvent as Mock).mock.calls` for asserting exact event sequences per node.
- `invokeDag(store, nodes, opts)` (`:26339-26361`) — builds a `createMockPlatform()`, calls
  `executeDagWorkflow(createMockDeps(store), platform, 'conv-dag', testDir, { name:
  'steering-test', nodes }, makeWorkflowRun(opts?.runId ?? RUN_ID), assistant, undefined, ...)`.
  Supports `opts.assistant: 'claude' | 'pi'` for testing best-effort-provider reask interaction
  with steering.
- Loop-node steering tests exist in the same describe block: search hits at `:26696` (
  `expect(getSteeringRegistry().get(RUN_ID, 'my-loop')).toBeUndefined()`) confirm a loop-node
  variant of the same drain test exists, built the same way (mock `sendQuery` generator +
  `enqueue()` helper), just invoking a `loop:` node instead of a `prompt:` node.
- Loop-group namespacing test: `:26792-26798` (cited in §3 above) is the proof that the
  registry key for a loop_group body node is namespaced.

### `mock.module()` grep across the repo
```
grep -rn "mock.module(" packages --include='*.test.ts' | grep -i steering
```
returns **zero results**. No test file anywhere `mock.module()`s `./steering-registry` or
`@archon/workflows/steering-registry` — every consumer (`dag-executor.test.ts`,
`steering-registry.test.ts`, `packages/core/src/db/workflows.test.ts`,
`packages/server/src/routes/api.workflow-runs.test.ts`) either imports the real module directly
(using `clearForTests()`/`createSteeringRegistry()` for isolation) or doesn't touch it at all.
**This means the AGENTS.md `mock.module()` "merges over the real module" pollution hazard
(documented for `db/workflows` and #2240) does NOT apply here** — adding new exports to
`steering-registry.ts` (e.g. an `interrupt()` method on `NodeSteeringHandle`, or a new
`InterruptResult` type) requires no factory updates anywhere, because nothing fakes this
module. The only "registry" consumers outside the workflows package are `@archon/core`'s
`db/workflows.ts` (a DB store, unrelated name collision — not the steering registry) and
`@archon/server`'s `routes/api.ts` (the real Send-guidance route, imported directly, not
mocked).

### What #183 would add to `steering-registry.ts`
Based on the spec (§1-§2) and the gaps found above, a plausible export surface addition:
- `NodeSteeringHandle.interrupt(): boolean` (or similar) — synchronously aborts the currently
  active per-turn signal; needs the handle to hold a live reference to "the current turn's
  abort function", which does not exist on the handle today (today it only holds
  enqueue/pending state, no live abort capability). This is a materially new capability, not
  an additive field — the handle would need the executor to register/deregister a per-turn
  "interruptor" callback (or an `AbortController`) as each turn starts/ends, analogous to how
  it currently gets `register()`ed once per node occurrence but would now need a per-TURN
  registration of the interrupt target.
- Since no test file mocks this module, no `mock.module()` factory list needs auditing — new
  exports are automatically visible to every consumer.

---

## 6. `package.json` test-script chain and `exports` map

`packages/workflows/package.json`:
- `"./steering-registry": "./src/steering-registry.ts"` is present in `exports`
  (alongside `.`, `./retry-state`, `./schemas/*`, `./executor`, `./loader`, `./router`,
  `./store`, `./deps`, `./event-emitter`, `./workflow-discovery`, `./model-validation`,
  `./script-discovery`, `./command-validation`, `./defaults`, `./validator`, `./dry-run`,
  `./env-overlay`, `./node-model-resolution`, `./utils/tool-formatter`,
  `./utils/workflow-requirements`, `./workflow-inputs`, `./test-utils`). No change needed for
  #183 unless a genuinely new public subpath is introduced (unlikely — the interrupt API would
  live on `NodeSteeringHandle`/`SteeringRegistry`, already exported from this subpath).
- `test` script is one long `&&`-chained sequence of individual `bun test <files>` invocations
  (Bun's per-file `mock.module()` isolation workaround). Two entries directly relevant:
  `bun test src/dag-executor.test.ts` is FIRST in the chain (its own isolated invocation,
  `package.json` line: `"test": "bun test src/dag-executor.test.ts && bun test src/loader.test.ts
  ... && bun test src/state-migration.test.ts src/dry-run.test.ts && bun test
  src/steering-registry.test.ts"`), and `bun test src/steering-registry.test.ts` is the LAST
  entry in the chain, also its own isolated invocation. Both are already isolated from each
  other and from every other suite — **#183's new tests (added to either or both files) do not
  need a new chain entry** unless a brand-new test FILE is created, in which case it must be
  appended as its own `bun test src/<newfile>.test.ts` segment (or grouped into an existing
  segment only if it shares no conflicting `mock.module()` calls with that segment's other
  files).

---

## 7. `withIdleTimeout` (`packages/workflows/src/utils/idle-timeout.ts`)

Full file read (114 lines). Key points relevant to wrapping a stream that gets interrupted
mid-way:

- It wraps an `AsyncGenerator<T>` and races `generator.next()` against its OWN idle timer
  (`Promise.race([nextPromise, timeoutPromise])`, `:71-73`) — it has no awareness of WHY
  `generator.next()` settles, only THAT it settles or times out.
- When the underlying generator's `.next()` rejects (e.g. because `aiClient.sendQuery`'s
  internal fetch/SDK call observes the combined `AbortSignal.any([...])` firing and throws),
  that rejection propagates out of `withIdleTimeout`'s `for await` to the caller
  (`runStreamPass`'s `for await (const msg of withIdleTimeout(...))` at `:2290` or the loop's
  `:6021`) — `withIdleTimeout` does not swallow generator-thrown errors; it only catches
  race-condition issues around ITS OWN timeout firing (`:80-83` explicitly `.catch()`s the
  stale `nextPromise` only in the timeout branch, to prevent an unhandled rejection, not to
  suppress the abort error itself in the normal case).
- When the underlying generator's `.next()` instead RESOLVES `{ done: true }` in response to an
  abort (i.e. the SDK provider treats an aborted signal as "stream cleanly ended" rather than
  throwing — this is the DeepSeek abort-marked-`result` case from spec case 2, OR any provider
  that yields a final chunk then ends), `withIdleTimeout` just `return`s normally (`:79`) and
  its `finally` block calls `generator.return(undefined as never)` (`:98`, guarded by `if
  (!timedOut)`) for cleanup — this is unconditional generator cleanup, unrelated to WHO
  triggered the end.
- **No changes are needed inside `withIdleTimeout` itself for #183.** The existing Cancel
  mechanism already proves an aborted `nodeAbortController`/`iterationAbortController` flows
  correctly through this wrapper today (Cancel already aborts the SAME underlying provider
  stream this new per-turn signal will also abort, via the exact same `AbortSignal` plumbing
  point). The only NEW consideration is that `AbortSignal.any([nodeAbortController.signal,
  perTurnController.signal])` composition must happen at the `passOptions`/`iterationOptions`
  construction site (executeNodeInternal `:2270`-ish / loop `:5983`), not inside
  `withIdleTimeout`, and the `onTimeout` callback passed to `withIdleTimeout` (which currently
  only calls `nodeAbortController.abort()` / `iterationAbortController.abort()`) should
  continue aborting the NODE-level controller on idle-timeout — an idle timeout is not an
  operator interrupt and must keep taking the existing `nodeIdleTimedOut` completion path
  (`:3183`), not the new interrupted-end path. This is exactly the distinction the spec labels
  "Idle-await ... reuses neither the streaming `withIdleTimeout` wrapper ... nor its
  `nodeIdleTimedOut` outcome."

---

Status: DONE
Summary: All eight requested anchors were located and verified against current source for both `executeNodeInternal` (2209/2223/3074/3189/3336/3387+3495/2578/2421+outcome-persistence) and `executeLoopNode` (5863+5931/6011/6579/6442/6873/6459-6504/6126); loop_group body prompt nodes confirmed to route through the generic `runLayers` → `executeNodeInternal` dispatcher with a namespaced `stepNamePrefix`, so the registry key already matches without extra work. `recordNodeStatus`/`recordLoopStatus` need zero schema changes to write an `interrupted` status row. No test file anywhere mocks `./steering-registry`, so new registry exports need no factory updates. `withIdleTimeout` needs no changes — Cancel already proves the abort-signal plumbing works end to end.
Concerns/Blockers: The loop path's Cancel-check ordering (before structured-output validation) differs materially from the direct-node path (validation before Cancel check) — the plan must NOT assume symmetric insertion points between the two functions; executeNodeInternal needs an explicit `operatorInterrupt` guard added to its validation-entry condition (`:3070`) to skip validation, while executeLoopNode gets that "for free" by inserting after its earlier-positioned Cancel check (`:6442-6455`). Separately, `steering-registry.ts` today has no live per-turn interrupt capability at all (no `AbortController`/interrupt-target tracking on `NodeSteeringHandle`) — this is new state to design, not just a new method; the report deliberately did not design it in depth since that is plan-writing, not scouting, but flags it as the single largest unresolved implementation surface.
