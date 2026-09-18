# Scout: Executor turn structure for queued operator guidance (drain at natural turn boundary)

Goal recap: plan "queued operator guidance drained at the natural turn boundary as turn N+1
on the same provider session" for AI (`prompt:`/`command:`) DAG nodes, with **no**
interrupt/abort behavior. This report maps the exact turn mechanics in
`packages/workflows/src/dag-executor.ts` so a planner can pick an insertion point and a
cross-process delivery mechanism.

---

## 1. Structure of one "turn"

**Prompt build** (`executeNodeInternal`, `packages/workflows/src/dag-executor.ts:2060-2121`):
command/prompt body loaded → `prompt_suffix` appended → `buildPromptWithContext` (variable
substitution: `$ARGUMENTS`, `$ARTIFACTS_DIR`, etc.) → `substituteNodeOutputRefs` (`$node.output`
refs) → `finalPrompt`.

**`sendQuery` invocation** — the single call site for every pass of a node, inside
`runStreamPass` (`dag-executor.ts:2266-2967`):

```ts
// dag-executor.ts:2289-2300
for await (const msg of withIdleTimeout(
  aiClient.sendQuery(attemptPrompt, cwd, attemptResumeId, passOptions),
  effectiveIdleTimeout,
  () => {
    nodeIdleTimedOut = true;
    getLog().warn({ nodeId: node.id, timeoutMs: effectiveIdleTimeout }, 'dag_node_idle_timeout_reached');
    nodeAbortController.abort();
  }
)) { ... }
```

`IAgentProvider.sendQuery` signature (`packages/providers/src/types.ts:917-921`):
`sendQuery(prompt, cwd, resumeSessionId?, options?): AsyncGenerator<MessageChunk>`.

**Session id capture** — `sessionId` exists ONLY on the `result` chunk variant
(`packages/providers/src/types.ts:329-355`; no `sessionId` on `system`/`assistant`/`tool`
chunks at the `MessageChunk` abstraction the executor sees). Captured unconditionally:

```ts
// dag-executor.ts:2536
if (msg.sessionId) newSessionId = msg.sessionId;
```

**How the pass loop threads a resume id** — the _only_ existing multi-pass-within-one-node
loop is the structured-output reask loop (`dag-executor.ts:2992-3095`):

```ts
// dag-executor.ts:3008-3016
while (true) {
  await runStreamPass(
    reaskPrompt,
    reaskAttempt === 0 ? resumeSessionId : undefined,
    reaskAttempt
  );
  ...
```

**Important divergence a planner must not copy uncritically**: reask passes 2+ deliberately
pass `undefined` as `attemptResumeId` — a comment above (`dag-executor.ts:~3005`, "Fresh
session per reask attempt … so a prior invalid turn isn't carried forward") states each
reask starts a **fresh** session, not a continuation. Test evidence confirms two distinct
`sessionId`s per reask (`packages/workflows/src/dag-executor.test.ts:13058-13067`, `s1`/`s2`).
So the reask loop is a precedent for _how to run N sendQuery passes inside one node and
merge/accumulate their side effects_, but **not** a precedent for session continuation. A
queue-drain "turn N+1 on the same session" implementation must explicitly pass
`attemptResumeId = newSessionId` (the id captured from the prior pass's `result`), which the
reask loop does not do.

---

## 2. Natural turn end → insertion point

Sequence inside `runStreamPass`'s stream loop and after it returns (`dag-executor.ts`):

1. `msg.type === 'result'` (~2536-2678): capture `newSessionId`, tokens, cost, stopReason,
   numTurns, `resolvedModel`, `structuredOutput`, `usageBreakdown`; throw on budget-cap or
   SDK error; `break` only if `backgroundTasks.shouldBreakOnResult()` (else keep draining for
   live background Agent tasks, ~2660-2678).
2. `finally` (~2938-2963): fire-and-forget `deps.usageRecorder.recordWorkflowUsage(...)` for
   this pass's `passUsageBreakdown`.
3. Back in the reask `while (true)` (~3000-3121): if `output_format` set, validate
   `structuredOutput`; `canReask` gate (~3031: `reaskAttempt < maxReasks && !nodeIdleTimedOut &&
!nodeAbortController.signal.aborted`) decides `continue` (another `runStreamPass`, still no
   session resume) vs `break`/`throw`.
4. Idle-timeout-with-output notice (~3110-3123).
5. Cancel-during-streaming check (~3124-3163) → early `return { state: 'failed', error:
'Cancelled by user' }`.
6. Batch-mode flush, credit-exhaustion check (~3172-3212), empty-output check (~3218-3255).
7. `node_completed` event (DB write ~3259-3298 + `emitter.emit` ~3301-3308) + `recordNodeStatus('completed')` (~3311).
8. Cleanup of the two throttle Maps (~3314-3316) and the final `return { state: 'completed', ... }` (~3322-3330).

**Best insertion point**: immediately after step 3 (the reask/output_format loop has already
settled `nodeOutputText`/`structuredOutput` for this pass) and **before** step 4 (idle-timeout
notice) — i.e. right after the `while (true)` reask loop exits normally, guarded by the same
"not idle-timed-out, not aborted" condition already computed for `canReask`. Concretely: wrap
steps 4-8 in an outer `while (true)` (a **turn loop**, distinct from the existing reask loop
which stays as the inner "fix this pass's output" loop), and between "reask loop settled" and
"idle/cancel/credit/empty checks", add:

```
if (turnEndedCleanly /* !nodeIdleTimedOut && !nodeAbortController.signal.aborted */) {
  const queued = await deps.store.drainQueuedGuidance(workflowRun.id, node.id); // new capability
  if (queued.length > 0) {
    executionScope = newTranscriptAttempt(executionScope); // same occurrence, new attempt_id
    await runStreamPass(joinQueuedText(queued), newSessionId, /* passReaskAttempt reset to 0 */ 0);
    continue; // back to the top of the turn loop — re-run reask/validation for THIS new pass
  }
}
```

Only fall through to the idle/cancel/credit/empty/`node_completed` block once the queue is
empty at that point. This drains the WHOLE queue at once by looping (each queued item becomes
its own turn — reads "as turn N+1" for the first queued item; a second still-queued item
becomes turn N+2, etc.) or, if a single injected turn should carry all queued items, join them
into one prompt per your task's exact semantics — either is a small variant of the same loop.

**Per-turn reset vs. persisted state**:

- Reset every turn (currently reset inside `runStreamPass`'s prologue, `dag-executor.ts:2271-2276`):
  `nodeOutputText`, `structuredOutput`, `batchMessages`, `nodeCostUsd` (per-pass; but note
  `accumulatedCostUsd` in the reask loop, ~3017-3022, folds pass cost across passes — a
  queue-drain turn should do the same so total node cost/tokens reflect every turn),
  `nodeIdleTimedOut`, `backgroundTasksIncomplete`, `reaskAttempt` (should reset to 0 for a new
  queue-driven turn — it is a per-_validation-fix_ counter, not a per-_turn_ counter).
- Persist across turns: `nodeAbortController` (one controller for the whole node execution —
  see idle-timeout/abort caveat in §8), `newSessionId` (becomes the next turn's
  `attemptResumeId`), `executionScope.occurrence_id` (same node occurrence; only `attempt_id`
  rotates per `newTranscriptAttempt`, `packages/workflows/src/transcript-execution-scope.ts:40-42`),
  accumulated cost/tokens/numTurns totals, `nodeResumed`/`nodeResolvedModel` (last-write-wins
  fields, already designed to reflect the final pass — dag-executor.ts:2570-2578 comment
  explains this is intentional for reask and applies equally to a queue-drain turn).

---

## 3. Transcript row writer (`workflow_node_messages`)

Writer: `appendNodeTranscript(store, input)` in `packages/workflows/src/node-transcript.ts:14-31`
— an await-and-swallow wrapper around `store.appendNodeMessage(input)`
(`IWorkflowNodeMessageStore.appendNodeMessage`, `packages/workflows/src/store.ts:235`). Called
throughout `executeNodeInternal` for `kind: 'text'` (~2350), `kind: 'tool'` (~2422),
`kind: 'status'` (`recordNodeStatus`, ~2001-2009), and via `appendToolResultTranscript`
(`node-transcript.ts:37-59`) for `kind: 'tool'` result rows.

**Schema** (`packages/workflows/src/schemas/node-message.ts:15-39`): `appendNodeMessageSchema`
is a `z.discriminatedUnion('kind', [...])` over exactly `'text' | 'tool' | 'status'`, each
`.strict()`. **There is no `'operator'` (or similar) kind today** — adding an operator-guidance
transcript row requires extending this discriminated union (new payload schema + new member of
`appendNodeMessageSchema` and `nodeMessageSchema`) plus mirroring into
`packages/core/src/schemas/workflow-node-message.ts` (the row-level schema the DB layer parses
against, referenced from `packages/core/src/db/workflow-node-messages.ts:13`).

**`seq` assignment** — `packages/core/src/db/workflow-node-messages.ts`, `appendOnce`
(~90-115): `SELECT COALESCE(MAX(seq), 0) + 1 ... WHERE workflow_run_id = $1 AND node_id = $2`
inside `db.withTransaction`, with a single retry on a unique-constraint race
(`isNodeMessageSequenceConflict`, ~32-56) keyed on
`uq_workflow_node_messages_run_node_seq` / the equivalent SQLite UNIQUE message. `seq` is
therefore per-`(workflow_run_id, node_id)`, monotonic, transaction-safe — an operator-guidance
row would get the next `seq` in the same sequence as text/tool/status rows for that node, so it
interleaves correctly in transcript order.

**`occurrence_id`/`attempt_id`** — carried in `metadata.execution`
(`nodeTranscriptMetadataSchema`, `packages/workflows/src/schemas/node-execution.ts:28-42`),
minted by `mintTranscriptExecutionScope` (`transcript-execution-scope.ts:24-38`) once per node
occurrence and rotated per attempt by `newTranscriptAttempt` (`transcript-execution-scope.ts:40-42`,
same `occurrence_id`, fresh `attempt_id`) — exactly the identity scheme a queue-drained turn
should reuse (new attempt within the same node occurrence). `transcriptMetadata(scope, extra)`
(`transcript-execution-scope.ts:128-133`) is the helper that assembles the `metadata` object
passed to `appendNodeTranscript`.

---

## 4. Event emission / live status channel

Two parallel outputs on every lifecycle transition, both fire-and-forget:

1. **DB-persisted `workflow_events` row** via `deps.store.createWorkflowEvent({...})`
   (e.g. `node_started` at `dag-executor.ts:2017-2040`, `node_completed` at `~3264-3298`,
   `node_failed` at multiple sites) — durable, queryable, used for resume/audit and REST
   history.
2. **In-process emitter** via `getWorkflowEventEmitter().emit({...})`
   (`packages/workflows/src/event-emitter.ts`) — a module-level singleton
   (`getWorkflowEventEmitter()`, ~363-368), fed by `emitter.emit(...)` calls right next to the
   DB writes (e.g. `node_started` at `dag-executor.ts:2043-2056`, `node_completed` at
   `~3301-3308`). `WorkflowEmitterEvent` is a closed union (`event-emitter.ts:253-274`) —
   `node_started`/`node_completed`/`node_failed`/`node_skipped`/`node_routed`/`tool_*`/
   `task_activity`/`hook_activity`/`container_lifecycle`/etc. There is **no existing
   "node sub-state" event** distinct from these lifecycle events; live per-node status the web
   UI shows today is entirely reconstructed from this stream (transcript rows +
   started/completed/failed events), not a separate "current status" field.

**Consumer**: `packages/server/src/adapters/web/workflow-bridge.ts` subscribes to the emitter
and `switch (event.type)` (`workflow-bridge.ts:18` onward) maps each `WorkflowEmitterEvent`
variant to an SSE payload shape (e.g. `node_started`/`node_completed`/`node_failed` share one
case at `workflow-bridge.ts:91-126`).

**To add a new event type** (e.g. `node_turn_queued_guidance_applied`): (1) add the interface
to `packages/workflows/src/event-emitter.ts` and to the `WorkflowEmitterEvent` union
(~253-274); (2) call `getWorkflowEventEmitter().emit({...})` at the queue-drain insertion point
in `dag-executor.ts` (mirroring the fire-and-forget DB write + emit pattern used everywhere
else); (3) add a `case` in `packages/server/src/adapters/web/workflow-bridge.ts`'s switch to
translate it into an SSE-shaped payload for the web UI. This is a closed, additive,
three-file change with an established template (every existing event type follows exactly this
shape).

---

## 5. Run/node identity keys and every terminal exit of `executeNodeInternal`

**Keys**: `runId = workflowRun.id`; `node.id`; the throttle-map key used by cancel-check and
activity-heartbeat is `` `${workflowRun.id}:${node.id}` `` (`nodeKey`, computed fresh each loop
tick at `dag-executor.ts:2302`, looked up in module-level `Map`s `lastNodeCancelCheck`
(`dag-executor.ts:681`) and `lastNodeActivityUpdate` (`dag-executor.ts:705`)). Note `stepName`
(`stepNamePrefix + node.id`) is the DB/transcript identity (namespaced inside `loop_group`
bodies), while raw `node.id` is what in-process emitter payloads use (`dag-executor.ts:1978-1981`
comment) — a steering registry keyed for cross-process delivery should almost certainly use
`(runId, node.id)` (the un-namespaced, externally addressable id), matching `nodeKey`'s shape.

**Every terminal `return` inside `executeNodeInternal`** (function starts `dag-executor.ts:1950`):
| Line | State | Cause |
|---|---|---|
| `2089` | `failed` | command-load failure |
| `2159` | `failed` | prompt substitution failure |
| `2193` | `failed` | provider lookup failure |
| `3163` | `failed` | cancelled during streaming (abort, not idle-timeout) |
| `3212` | `failed` | credit exhaustion detected in output text |
| `3255` | `failed` | empty output (idle-timeout-before-first-token or silent close) |
| `3322` (return object built ~3322-3330) | `completed` | normal success |
| `3341` (approx, inside `catch`) | `pending` | `AskHumanAwaitingError` → `pauseOnAskHuman` |
| `3377` (approx) | `failed` | ask-resume failed (`resumeInteractions` present, error thrown) |
| `3395` (approx) | `failed` | cancelled via abort surfaced through the catch (idle-timeout excluded) |
| `3434` (approx) | `failed` | generic thrown error (default catch-all) |

Every path above (except the `pending`/AskHuman one, which is a genuine in-flight pause, not a
node conclusion) is preceded by `lastNodeCancelCheck.delete(nodeKey)` and
`lastNodeActivityUpdate.delete(nodeKey)` cleanup calls at the specific return sites (e.g.
`~3159-3160`, `~3206-3207`, `~3249-3250`, `~3314-3316`) and by the top-of-catch cleanup at
`~3335-3336`. **This is the existing precedent for "always clean up a per-(run,node) registry
entry regardless of exit path"** — but it is done by explicit delete-before-every-return calls,
not a single `try/finally`. A steering-registry teardown (unregistering a node from a queue
listener) should either follow this same explicit-delete-at-every-exit convention, or — more
robustly, since a future editor could add a new return path and forget the delete — wrap the
whole function body in one `try { ... } finally { registry.unregister(runId, node.id); }`. The
codebase does not currently use that structure for this function, so introducing it is a
judgment call for the plan, not a documented pattern.

---

## 6. `executeLoopNode`: separate implementation, not a shared helper

`executeLoopNode` (`dag-executor.ts:5150` onward) is a **fully separate function** with its
own duplicated turn/reask machinery — it does not call `executeNodeInternal` or a shared
`runStreamPass`-equivalent. Evidence of duplication:

- Its own outer per-iteration loop: `for (let i = startIteration; i <= loop.max_iterations; i++)` (`dag-executor.ts:5454`).
- Its own inner reask loop per iteration: `attempts: while (true)` (`dag-executor.ts:5644`),
  with its own `passUsageBreakdown`/`passTerminalError`/`passErrorSubtype`/`reaskAttempt`
  locals (`~5630-5663`) — structurally parallel to, but independently coded from,
  `executeNodeInternal`'s `runStreamPass`.
- Its own `withIdleTimeout(generator, effectiveIdleTimeout, () => {...})` call
  (`dag-executor.ts:5730`).
- Its own `node_completed` write block (`~6606-6661`).

(`executeLoopGroupNode`, the multi-node sub-DAG loop, is a third, separate implementation
again — it dispatches body nodes through the ordinary `executeNodeInternal`/`runLayers` path
per iteration rather than owning a stream loop itself, per its section starting
`dag-executor.ts:4369`.)

**Cost estimate for applying queue-drain to `executeLoopNode`**: non-trivial, not free. The
insertion point is structurally analogous (after the per-iteration reask loop settles, before
the `until`/`until_bash`/`until_field` completion check around `~6419-6558`), but every local
variable name, the usage-folding helper (`foldIterationUsage`, `~5612-5626`), and the
idle-timeout wrapper call are independently declared, so the same "insert a turn-loop with a
queue-check" patch must be written and tested a second time against this function's own
locals — copy-adaptation, not reuse. There is no low-risk way to introduce a shared helper
without a larger refactor of both functions (out of scope per the story's stated boundary).
Treat loop-node support as a distinct follow-up story/phase.

---

## 7. Injecting an optional port without a package-boundary violation

**Precedent pattern (heavyweight, cross-package port)**: `ContainerRunContext` /
`ContainerWriteBackBackend` (`packages/workflows/src/container-context.ts:18-48`). The
interface is defined **inside `@archon/workflows`** (no import from `@archon/isolation`, which
owns the real container backend). `ExecuteWorkflowOptions.container?: ContainerRunContext`
(`packages/workflows/src/executor.ts:557`) is the injection seam; the caller (CLI/orchestrator,
which _does_ depend on `@archon/isolation`) constructs the concrete backend object and passes
it in. `executor.ts` threads it verbatim into `executeDagWorkflow`, which threads it into
`dag-executor.ts` functions as a plain parameter (`containerCtx: ContainerRunContext` appears
as a function parameter at `dag-executor.ts:9917`, `10018`, `10192`, etc.) — a **structural**
port: `@archon/workflows` only ever sees the narrow interface shape, never the implementing
package.

**Lighter-weight precedent (in-process singleton, no cross-package types needed at all)**:
`getWorkflowEventEmitter()` (`packages/workflows/src/event-emitter.ts:363-368`) — exported from
`@archon/workflows`, imported and subscribed to by `@archon/server`
(`packages/server/src/adapters/web/workflow-bridge.ts`). No `ExecuteWorkflowOptions` field
needed at all for this one; it works because emit/subscribe is pure in-memory pub/sub inside
one Bun process.

**Which pattern fits queued operator guidance — the deciding factor is cross-process reach,
not package layering.** The event emitter (and any purely in-memory singleton Map) only works
when the writer (an `@archon/server` HTTP route enqueuing guidance) and the reader
(`dag-executor.ts`'s turn loop) share the same OS process and the same `@archon/workflows`
module instance. That is true for `bun run dev`/web-served runs, but workflows can also run as
a **detached CLI process** (`archon workflow run --detach`, per AGENTS.md) that is a different
OS process from any web server that might later want to enqueue guidance for it. An in-memory
singleton cannot be written to from outside its own process. The codebase's actual precedent
for "instruct a running node from outside the executing process" is **DB polling**, not an
in-memory registry: the cancel/pause check inside the very same stream loop already does this —

```ts
// dag-executor.ts:2312-2327
if (tickNow - (lastNodeCancelCheck.get(nodeKey) ?? 0) > CANCEL_CHECK_INTERVAL_MS) {
  lastNodeCancelCheck.set(nodeKey, tickNow);
  const streamStatus = await deps.store.getWorkflowRunStatus(workflowRun.id);
  if (!shouldContinueStreamingForStatus(streamStatus)) { ... nodeAbortController.abort(); break; }
}
```

(`shouldContinueStreamingForStatus`, `dag-executor.ts:700-702`, is exported specifically so
this policy is unit-testable independent of the 10s throttle.) A queued-guidance store should
follow this same shape: a new `IWorkflowStore`-extending narrow interface (mirroring
`IWorkflowPendingInteractionStore`, `packages/workflows/src/store.ts:238-247` — `insert`/`list`/
`resolve`-style methods) — e.g. `insertQueuedGuidance` / `drainQueuedGuidance(runId, nodeId)` —
backed by a real DB table (additive per AGENTS.md's schema rules), read via `deps.store` at the
turn boundary (no new `ExecuteWorkflowOptions` field needed, since `deps.store` is already
threaded everywhere `executeNodeInternal` runs). This works identically for web-served,
CLI-foreground, and CLI-detached runs, and requires no `@archon/workflows` → `@archon/server`
dependency (the server just calls `deps.store.insertQueuedGuidance` — or the equivalent REST
route → `@archon/core` DB helper — the same layering `pending_interactions` already uses).

`pending_interactions` (`IWorkflowPendingInteractionStore`, `store.ts:238-247`; `kind: 'ask' |
'permission'`, per AGENTS.md item 23) is adjacent but not a drop-in fit: it is fundamentally a
**blocking-gate** primitive (`status: pending|answered|purged`) which the executor treats as
"pause until answered." Queued guidance must be non-blocking by this story's own constraint
("without any interrupt/abort behaviour"), so reusing the same table/kind risks conflating two
different consumption semantics (poll-and-drain vs. pause-and-await) even though the row shape
(`workflow_run_id`, `node_id`, `tool_use_id`-like identity, JSON envelope) is superficially
similar. A new table (or a new non-blocking `kind` with explicit executor-side handling that
never pauses) is the safer additive design.

---

## 8. Idle-timeout / AbortSignal re-entrancy

`withIdleTimeout` (`packages/workflows/src/utils/idle-timeout.ts:47-102`) is a **stateless
wrapper function**, not a class or persisted object — each call opens its own `timerStartedAt`
and its own `try/finally` around the generator it's given. `runStreamPass` calls it fresh on
every pass (`dag-executor.ts:2289`), already proven safe for re-entry by the existing reask loop
(2+ passes today). A queue-drain turn re-entering it (turn N+1) is the same call shape as a
reask pass — **clean re-entry, no special handling needed**.

**Caveat**: `nodeAbortController` is created **once** per node execution
(`dag-executor.ts:2209`, `new AbortController()`) and its `.signal` is threaded into every
pass's `passOptions.abortSignal` (`nodeOptionsWithAbort`, `~2221-2223`, spread into
`passOptions` at `~2283`). It is shared, not per-pass. Consequences for a queue-drain design:
(a) if idle-timeout or user-cancel fires during turn N, `nodeAbortController.abort()` is called
and the signal stays aborted for any subsequent pass — so a queue-drain turn must gate on
`!nodeAbortController.signal.aborted` before starting turn N+1 (exactly the same guard the
reask loop already uses in `canReask`, `dag-executor.ts:3032`) and must **not** attempt to
"reset" the controller (this story explicitly excludes interrupt/abort semantics, so this is
consistent — an aborted node stays aborted, queue-drain simply never fires there); (b) no
change to the controller's lifecycle is needed to support queue-drain, only a read of its
`.signal.aborted` before deciding to loop.

---

## 9. Existing multi-turn precedent worth reusing

- **Reask loop** (`dag-executor.ts:2992-3121`) — best structural precedent for "run N
  `sendQuery` passes inside one node, accumulate cost/tokens, rotate `attempt_id`, keep one
  `node_completed`" (see §1 caveat: it does NOT continue the session — do not copy that part).
- **`persist_session`** (`dag-executor.ts:9305-9522`, keyed by
  `(workflow_name, node_id, scope_key, provider)` per AGENTS.md item 11) — a **cross-run**
  session-continuation precedent (a later, separate `workflow_runs` execution resumes a
  provider session left over from an earlier run of the same node). Confirms the codebase
  already treats "resume a specific prior session id for this node" as a normal, supported
  operation — reinforcing that turn N+1 resuming `newSessionId` is architecturally unremarkable
  here — but it is cross-run, not intra-node-execution, so its plumbing (DB-keyed session
  lookup/upsert) is not directly reusable for an intra-turn loop.
- **`manage-run-tool.ts:54`** (`packages/core/src/orchestrator/manage-run-tool.ts`) explicitly
  notes "there is no mid-turn UI-confirm primitive to block on" as the reason gate actions
  require an explicit `confirm: true` step instead of blocking. This is corroborating evidence
  that the codebase's chat-agent tooling already assumes no mid-turn interruption is available
  — consistent with (and not contradicted by) this story's constraint that queued guidance is
  drained only at a natural turn boundary, never mid-stream.
- No existing "steering"/"inject prompt into a live session" mechanism was found anywhere in
  `packages/workflows`, `packages/server`, or `packages/core` (grepped for steer/queued
  guidance/mid-turn/operator guidance) — this is genuinely new capability, not a rename of
  something that exists.

---

## Proposed minimal insertion design (pseudo-code)

```ts
// inside executeNodeInternal, replacing the single reask-loop-then-terminal-checks
// structure with an outer turn loop:

let turnResumeId = resumeSessionId; // seeds turn 1; updated to newSessionId after each turn
turnLoop: while (true) {
  // --- existing reask loop, using turnResumeId instead of resumeSessionId ---
  let reaskAttempt = 0;
  let reaskPrompt = turnResumeId === resumeSessionId ? finalPrompt : queuedPromptText;
  while (true) {
    await runStreamPass(reaskPrompt, reaskAttempt === 0 ? turnResumeId : undefined, reaskAttempt);
    // ... existing output_format validate/reask/canReask logic, unchanged ...
    break; // reask loop settled for this turn
  }

  // NEW: natural-turn-boundary queue check — only when this turn ended cleanly
  if (!nodeIdleTimedOut && !nodeAbortController.signal.aborted) {
    const queued = await deps.store.drainQueuedGuidance(workflowRun.id, node.id);
    if (queued.length > 0) {
      turnResumeId = newSessionId; // continue same provider session
      executionScope = newTranscriptAttempt(executionScope); // new attempt_id, same occurrence
      await appendNodeTranscript(deps.store, {
        // new 'operator' kind (schema addition)
        workflow_run_id: workflowRun.id,
        node_id: stepName,
        kind: 'operator',
        payload: { text: joinQueuedText(queued) },
        metadata: scopeMeta(),
      });
      queuedPromptText = joinQueuedText(queued);
      getWorkflowEventEmitter().emit({
        type: 'node_turn_queued_guidance_applied',
        runId: workflowRun.id,
        nodeId: node.id,
      });
      continue turnLoop; // turn N+1
    }
  }
  break turnLoop; // queue empty (or turn ended via idle-timeout/abort) — fall through as today
}

// existing idle-timeout notice / cancel check / credit-exhaustion / empty-output /
// node_completed block, UNCHANGED below this point
```

Key invariants this preserves: exactly one `node_completed`/`node_failed` event per node
execution (only emitted after the turn loop's final `break`); `nodeAbortController` never
reset; idle-timeout and cancel checks still run per-pass inside `runStreamPass` unchanged;
`accumulatedCostUsd`/token totals fold across every turn the same way they already fold across
reask passes.

---

## Risks

- **Unbounded turn count**: nothing in the current code bounds "how many reask attempts" beyond
  `maxReasks` (only applies to `output_format` nodes). A queue-drain loop needs its own
  explicit bound (e.g. max turns per node execution, or rely on the queue naturally draining)
  or a single slow-draining queue could keep a node "running" indefinitely — worth flagging to
  the planner even though it's out of this scout's scope to decide.
- **`reaskAttempt` scoping**: reused as both a per-pass structured-output-fix counter and
  (implicitly, if not reset) a potential turn counter — must be explicitly reset to 0 at the
  start of each new turn or `maxReasks` exhaustion from turn N could wrongly block reasking in
  turn N+1.
- **`executeLoopNode`/`executeLoopGroupNode` are excluded from this design** (§6) — if the
  planner's scope includes loop nodes, treat it as a second, independently-coded change.
- **`kind: 'operator'` schema addition** touches a `.strict()` discriminated union in two
  packages (`@archon/workflows` schema + `@archon/core`'s `workflow_node_message` row schema) —
  small but must be done together or the DB layer's `safeParse` will reject the new kind.
- **Queue storage semantics** (§7): building a new non-blocking table is recommended over
  reusing `pending_interactions`, but this adds a new additive migration — confirm with the
  planner whether that's in scope or whether an existing `workflow_runs.metadata` JSON field
  could hold a small queue instead (cheaper, but loses the same-transaction/seq guarantees
  `workflow_node_messages` gives the transcript).

Status: DONE
Summary: Full turn/session mechanics, transcript writer, event emitter, terminal-exit map, loop-node duplication, and cross-process port-injection precedent are documented with file:line evidence; a minimal turn-loop insertion point and pseudo-code are proposed, reusing the reask loop's pass-accumulation pattern but explicitly diverging from its session-continuation behavior.
Concerns/Blockers: None blocking the scout; open design decisions for the planner are listed under Risks (turn-count bound, `reaskAttempt` reset, new schema/table for the queue, loop-node scope).
