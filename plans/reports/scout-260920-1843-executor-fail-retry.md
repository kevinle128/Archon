# Scout report: ANR Story 2.12 fail-on-expiry patterns in dag-executor.ts

Scope: read-only. No files modified.

## 1. `recordFailedStatus` and `finishCancelled`

`recordFailedStatus` is a per-node-invocation closure defined inside
`executeNodeInternal`, at `packages/workflows/src/dag-executor.ts:2185`:

```ts
const recordFailedStatus = (error: string): Promise<void> => recordNodeStatus('failed', error);
```

It delegates to `recordNodeStatus` (`dag-executor.ts:2176-2184`), which appends
one transcript row via `appendNodeTranscript(deps.store, {...kind: 'status',
payload: { state, detail: error }...})`. `recordFailedStatus` writes ONLY this
transcript row — it does not by itself emit a `node_failed` workflow event or a
`node_failed` emitter event. Every call site pairs it with its own
`deps.store.createWorkflowEvent({ event_type: 'node_failed', ... })` call and
its own `emitter.emit({ type: 'node_failed', ... })` call immediately before
invoking `recordFailedStatus` — see `finishCancelled` below for the canonical
shape, and the 4 other call sites at `dag-executor.ts:2263`, `3630`, `3676`,
`3845`, `3901`.

`finishCancelled` (verbatim, `dag-executor.ts:3274-3312`):

```ts
const finishCancelled = async (): Promise<NodeExecutionResult> => {
  steeringHandle?.close();
  const duration = Date.now() - nodeStartTime;
  getLog().info({ nodeId: node.id, durationMs: duration }, 'dag_node_cancelled_during_streaming');

  deps.store
    .createWorkflowEvent({
      workflow_run_id: workflowRun.id,
      event_type: 'node_failed',
      step_name: stepName,
      data: withLifecycleScopeData(workflowRun, undefined, executionScope, {
        error: 'Cancelled by user',
        duration_ms: duration,
        ...iterationData,
      }),
    })
    .catch((err: Error) => {
      getLog().error(
        { err, workflowRunId: workflowRun.id, eventType: 'node_failed' },
        'workflow_event_persist_failed'
      );
    });

  emitter.emit({
    type: 'node_failed',
    runId: workflowRun.id,
    nodeId: node.id,
    nodeName: node.command ?? node.id,
    error: 'Cancelled by user',
  });

  await recordFailedStatus('Cancelled by user');

  // Clean up throttle entries
  lastNodeCancelCheck.delete(`${workflowRun.id}:${node.id}`);
  lastNodeActivityUpdate.delete(`${workflowRun.id}:${node.id}`);

  return { state: 'failed', output: nodeOutputText, error: 'Cancelled by user' };
};
```

Shape to mirror for a new "expired, no redirect" fail branch: (1)
`steeringHandle?.close()` first, (2) log line, (3) fire-and-forget
`createWorkflowEvent({ event_type: 'node_failed', ... error: <message> })`,
(4) `emitter.emit({ type: 'node_failed', ..., error: <message> })`, (5)
`await recordFailedStatus(<message>)`, (6) clear the two throttle maps, (7)
`return { state: 'failed', output: nodeOutputText, error: <message> }`. The
literal string `'Cancelled by user'` is the only thing that changes for a
`interrupted by operator, no redirect received` variant — every other line is
copy-identical. The return object always has `state: 'failed'` — this is what
makes retry-after-expiry safe (see §5).

`finishCancelled` is called from exactly two sites, both inside
`executeNodeInternal`'s turn loop: the mid-stream abort check
(`dag-executor.ts:3540`, "cancelled during streaming, not idle timeout") and
the idle-await `terminated` branch (`dag-executor.ts:3583`, see §2).

## 2. Idle-await in `executeNodeInternal` (verbatim, `dag-executor.ts:3548-3584`)

```ts
if (turnInterrupted && interruptibleHandle !== undefined && lastPassToken !== undefined) {
  // The redirect resumes the session that was interrupted: this turn's
  // own emitted id when a result carried one, else the id the turn was
  // resuming (a throw can interrupt before any result arrives). A
  // fresh first turn with neither fails fast rather than dropping the
  // queued guidance into an unresumable session.
  const interruptedSessionId = newSessionId ?? turnResumeId;
  if (interruptedSessionId === undefined) {
    // Missing interrupted session id is an explicit failure (#183) —
    // never resume a fresh session and never lose the queued guidance.
    steeringHandle?.close();
    throw new Error(
      `Node '${node.id}' was interrupted but the provider turn returned no session id to resume — failing instead of losing resumability.`
    );
  }
  getLog().info({ nodeId: node.id, workflowRunId: workflowRun.id }, 'dag.node_turn_interrupted');
  // ONE 'interrupted' status row — awaited so the committed transcript
  // outcome precedes the interrupt request's resolution (the UI reads it
  // before rendering the idle dock).
  await recordNodeStatus('interrupted');
  const idleWaiter = interruptibleHandle.enterIdle(lastPassToken);
  const wake = await raceIdleWake(deps, workflowRun.id, idleWaiter);
  if (wake.kind === 'send_now') {
    // Same-session redirect: carry drained objects; join at the guidance head.
    turnGuidanceMessages = wake.messages;
    turnResumeId = interruptedSessionId;
    turnIsGuidance = true;
    continue turns;
  }
  // Discard / terminal-status wake — land on the existing Cancel path so
  // the run ends exactly as a mid-stream cancel would.
  nodeAbortController.abort();
  return await finishCancelled();
}
```

This is the exact point where a new 30-min expiry branch must be spliced: a
`wake.kind === 'terminated'` result currently ALWAYS routes to
`finishCancelled()` (Cancelled-by-user message), regardless of whether
`raceIdleWake` resolved because of a discard, a terminal run-status poll, or
(after Story 2.12) a new expiry timer. `SteeringIdleWake` (defined in
`packages/workflows/src/steering-registry.ts:97-99`) currently has exactly two
variants — `{ kind: 'send_now', messages }` and `{ kind: 'terminated' }` — so
distinguishing "operator discarded / run ended" from "30-minute timer expired"
requires either widening this union with a new `kind` (e.g. `'expired'`) or
threading a side-channel flag out of `raceIdleWake`. Neither variant exists
today; this is new surface the story must add.

## 3. Idle-await in `executeLoopNode` (verbatim, `dag-executor.ts:7165-7220`)

```ts
if (turnInterrupted && interruptibleHandle !== undefined && turnToken !== undefined) {
  // The redirect resumes the loop's conversation thread: attempt 0's
  // session id when this turn emitted one, else the inherited thread a
  // re-ask pass was anchored to. A re-ask's own throwaway session is
  // deliberately NOT a redirect target (same #2563 threading rule as
  // the natural boundary).
  const interruptedSessionId = settledTurnSessionId ?? currentSessionId;
  if (interruptedSessionId === undefined) {
    // Missing interrupted session id is an explicit failure (#183) —
    // never resume a fresh session and never lose the queued guidance.
    steering.steeringHandle?.close();
    const resumabilityError = `Loop node '${node.id}' was interrupted but the provider turn returned no session id to resume — failing instead of losing resumability.`;
    return await failLoopIteration(
      resumabilityError,
      {
        costUsd: loopTotalCostUsd,
        ...(loopTotalTokens !== undefined ? { tokens: loopTotalTokens } : {}),
        loopIterations: i,
        data: { iteration: i },
      },
      resumabilityError
    );
  }
  getLog().info(
    { nodeId: node.id, workflowRunId: workflowRun.id, iteration: i },
    'loop_node.turn_interrupted'
  );
  // ONE 'interrupted' status row — awaited so the committed transcript
  // outcome precedes the interrupt request's resolution.
  await recordLoopStatus(iterationExecutionScope, 'interrupted', String(i));
  const idleWaiter = interruptibleHandle.enterIdle(turnToken);
  const wake = await raceIdleWake(deps, workflowRun.id, idleWaiter);
  if (wake.kind === 'send_now') {
    // Same-session redirect: carry drained objects; join at the guidance head.
    turnGuidanceMessages = wake.messages;
    turnResumeId = interruptedSessionId;
    turnIsGuidance = true;
    continue turns;
  }
  // Discard / terminal-status wake — land on the existing cancel path so
  // the run ends exactly as a mid-stream stop would.
  const effectiveStatus =
    (await deps.store.getWorkflowRunStatus(workflowRun.id).catch(() => null)) ?? 'cancelled';
  await safeSendMessage(
    platform,
    conversationId,
    `Loop node '${node.id}' stopped during iteration ${String(i)} (${effectiveStatus})`,
    msgContext
  );
  return await failLoopIteration(`Workflow ${effectiveStatus}`, {
    costUsd: loopTotalCostUsd,
    ...(loopTotalTokens !== undefined ? { tokens: loopTotalTokens } : {}),
    loopIterations: i,
    data: { status: effectiveStatus, iteration: i },
  });
}
```

Structurally identical to §2's shape, but the loop path's failure helper is
`failLoopIteration` (`dag-executor.ts:6132-6166`), which records a
`loop_iteration_failed` event + `iteration_failed` status row, then delegates
to `failLoopNode` (`dag-executor.ts:5864-...`) for the terminal `node_failed`
event/emit/`recordFailedStatus`-equivalent write. A 30-min-expiry branch here
would call `failLoopIteration('interrupted by operator, no redirect received', {...}, 'interrupted by operator, no redirect received')`
instead of re-deriving `effectiveStatus` from run status. Both `finishCancelled`
(node path) and `failLoopIteration`/`failLoopNode` (loop path) are the two
distinct fail-helper families the new branch must call into — they are not
unified into one function.

## 4. Handle/registry teardown — single point on both success and fail

**Node path** (`executeNodeInternal`): the whole try/catch body is wrapped in
one `finally` block, `dag-executor.ts:3910-3927`:

```ts
  } finally {
    if (steeringHandle !== undefined) {
      const queuedCount = steeringHandle.pendingCount();
      if (queuedCount > 0) {
        // Counts only — operator message text is never logged (#181).
        getLog().warn(
          { runId: workflowRun.id, nodeId: node.id, queuedCount },
          'dag.steering_queue_unconsumed'
        );
      }
      // A parked AskHuman pause is the only outcome that intentionally leaves
      // a registered handle behind — the resumed execution inherits it.
      if (!steeringPauseCommitted) {
        steeringHandle.close();
        getSteeringRegistry().unregister(workflowRun.id, stepName);
      }
    }
  }
```

**Loop path**: `executeLoopNode` (the outer wrapper, not `executeLoopNodeInner`)
wraps the whole call in try/finally, `dag-executor.ts:5684-5731`:

```ts
async function executeLoopNode(...): Promise<NodeExecutionResult> {
  const steering: LoopSteeringLifecycle = {};
  try {
    return await executeLoopNodeInner(..., steering);
  } finally {
    const steeringHandle = steering.steeringHandle;
    if (steeringHandle !== undefined) {
      const queuedCount = steeringHandle.pendingCount();
      if (queuedCount > 0) {
        getLog().warn(
          { runId: workflowRun.id, nodeId: node.id, queuedCount },
          'dag.steering_queue_unconsumed'
        );
      }
      if (steering.steeringPauseCommitted !== true) {
        steeringHandle.close();
        getSteeringRegistry().unregister(workflowRun.id, stepNamePrefix + node.id);
      }
    }
  }
}
```

Both are exactly ONE teardown point that runs on every exit path (success
return, every `finishCancelled`/`failLoopIteration` fail return, and thrown
errors) except the AskHuman-pause path, which sets
`steeringPauseCommitted = true` specifically to SKIP `unregister` (the paused
node's handle is meant to survive for the resumed invocation to inherit). A
fail-at-30-min-expiry return is an ordinary `state: 'failed'` return — it does
NOT set `steeringPauseCommitted`, so it falls through the same
`steeringHandle.close(); getSteeringRegistry().unregister(...)` path as
`finishCancelled`/`failLoopIteration` already do. No new teardown code is
needed; the existing `finally` blocks already cover it, because `close()` was
already called explicitly inside `finishCancelled`/`failLoopIteration` before
this `finally` runs (double-close is safe — `close()` calls the private
`seal()`, which is idempotent by phase check, see `steering-registry.ts:395-397`
and the phase guard on `park`/`close`/`closeIfEmpty`).

**Queued-messages-unmatched confirmation (relevant to #2.11 reconciliation):**
`getSteeringRegistry().unregister(...)` (`steering-registry.ts:505`) and
`discardRun(...)` (`steering-registry.ts:520`) remove the `NodeSteeringHandle`
from the registry's map; the handle's own `pending` queue (still holding any
operator messages enqueued between interrupt and expiry that were never
`send_now`'d) is simply dropped with the handle object — `pendingCount()` is
read once for a `dag.steering_queue_unconsumed` WARN log line
(`dag-executor.ts:3911-3919` / `5716-5724`) but the messages themselves are
never persisted or drained anywhere on this path. Because the handle is gone
and no `send_now` receipt was ever recorded for those messages, the client's
2.11 reconciliation (which — per the story description — matches sent
messages against recorded receipts) has nothing to match them against, so
those queued messages surface as "never sent." This confirms the story's
premise: a fail-at-expiry that goes through `steeringHandle.close()` +
`unregister()` (the same path every other fail branch already uses) leaves
queued-but-undelivered messages structurally unmatched — no extra code is
needed to produce that outcome, it falls out of the existing teardown.

## 5. Retry-node uses a fresh provider session — confirmed automatic, doubly enforced

Two independent, existing mechanisms both guarantee a retried node never
resumes a session from the run that expired:

**(a) Persistence write is gated on `state === 'completed'`.**
`dag-executor.ts:10402-10424`, the only call site of
`deps.store.upsertWorkflowNodeSession` in the whole engine:

```ts
if (usesPersistedScope && persistScopeKey && output.state === 'completed') {
  try {
    if (output.sessionId !== undefined) {
      await deps.store.upsertWorkflowNodeSession({ workflow_name: workflowName, node_id: node.id, scope_key: persistScopeKey, provider, provider_session_id: output.sessionId, last_run_id: workflowRun.id });
    } else {
      await deps.store.deleteWorkflowNodeSessions({ workflow_name: workflowName, scope_key: persistScopeKey, node_id: node.id, provider });
    }
  } catch (err) { ... }
}
```

Since the new expiry branch returns `{ state: 'failed', ... }` (mirroring
`finishCancelled`, §1), this block's `output.state === 'completed'` guard is
false, so the interrupted turn's `newSessionId` is never written to
`workflow_node_sessions`. This is opt-in machinery anyway (`persist_session`
per-node or `persist_sessions` workflow default, `dag-executor.ts:10220-10224`)
— a node without it never touches this table regardless.

**(b) Retry preparation explicitly deletes any persisted session for the
target node before re-running.** `packages/core/src/operations/workflow-retry.ts:537-545`,
inside `prepareWorkflowNodeRetry`:

```ts
await Promise.all(
  invalidatedNodeIds.map(nodeId =>
    workflowNodeSessionDb.deleteWorkflowNodeSessions({
      workflow_name: run.workflow_name,
      scope_key: run.conversation_id,
      node_id: nodeId,
    })
  )
);
```

`invalidatedNodeIds` includes the retry target node id (computed by
`getRetryInvalidatedNodeIds`, `dag-executor.ts` imports it from
`@archon/workflows/retry-state`). So even in the edge case where an EARLIER,
unrelated successful run had persisted a `workflow_node_sessions` row for this
exact `(workflow_name, node_id, scope_key=conversation_id, provider)` tuple,
`workflow retry-node` purges it at prepare time — before `executeWorkflow` is
invoked (`packages/cli/src/commands/workflow.ts:3442-3496`). `resumeSessionId`
for the retried node is then computed the normal way (`dag-executor.ts:10206-10218`
`ctx.lastSequentialSession` cursor, which starts empty on a fresh retry
`executeWorkflow` call, plus the now-deleted persisted-session lookup at
`10237-10292`, which finds nothing) — i.e. `undefined`, a fresh session.

**Conclusion:** "retry re-runs with a fresh session because there is no
durable session for a steer" is automatic given existing code, on two
independent guarantees (gate-on-completed + explicit delete-on-retry-prepare).
No new code is required for this property, PROVIDED the new fail branch keeps
returning `state: 'failed'` (never `'completed'`) — which is exactly what
mirroring `finishCancelled`/`failLoopIteration` already guarantees.

## 6. Fake-timer usage in `dag-executor.test.ts`

**Bun's `setSystemTime` is imported (`dag-executor.test.ts:10`) and used in
several places, but NEVER to drive `raceIdleWake`'s own `setTimeout`.** It is
used only to jump `Date.now()` past `CANCEL_CHECK_INTERVAL_MS` (10s) between
mock-provider stream chunks, so that a DIFFERENT check —
the in-stream `Date.now()`-vs-map-timestamp comparison inside
`runStreamPass` (`dag-executor.ts:2515`) — fires deterministically without a
real 10-second wait. Representative block, `dag-executor.test.ts:6777-6807`:

```ts
    it('suppresses the incompleteness warning when the node is genuinely cancelled with live tasks', async () => {
      // setSystemTime jumps past CANCEL_CHECK_INTERVAL_MS between chunks so the
      // second status check fires deterministically (no real waiting).
      let tasksDelivered = false;
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'background_tasks', tasks: [{ taskId: 't-live', taskType: 'local_agent', description: 'still running' }] };
        tasksDelivered = true;
        setSystemTime(new Date(Date.now() + 11_000));
        yield { type: 'assistant', content: 'partial work' };
        yield { type: 'assistant', content: 'MUST NOT BE REACHED' };
      });
      const store = createMockStore();
      (store.getWorkflowRunStatus as Mock<() => Promise<string | null>>).mockImplementation(() =>
        Promise.resolve(tasksDelivered ? 'cancelled' : 'running')
      );
      try {
        await runSingleNode(store, platform, 'bg-cancelled-run');
      } finally {
        setSystemTime(); // restore the real clock
      }
      ...
    });
```

**The dedicated `describe('executeDagWorkflow -- interrupt and redirect (#183)', ...)` block
(`dag-executor.test.ts:27286-28298`) — which is the only test suite exercising
`raceIdleWake`/`enterIdle` at all, for both the plain-node path and the loop
path — uses NEITHER `setSystemTime` NOR any fake-timer library.** It drives
the race by resolving the `waiter` side directly through the steering handle's
public API and NEVER waits for the poll side's `setTimeout(tick, CANCEL_CHECK_INTERVAL_MS)`
to actually fire. Two representative patterns:

Real-timer poll helper used to detect idle entry (`dag-executor.test.ts:27379-27386`):

```ts
/** Poll until the handle projects the idle sub-state (or give up loudly). */
async function awaitIdle(runId: string, stepName: string): Promise<NodeSteeringHandle> {
  for (let i = 0; i < 2000; i++) {
    const handle = getSteeringRegistry().get(runId, stepName);
    if (handle?.steeringSubState() === 'idle-after-interrupt') return handle;
    await Bun.sleep(1);
  }
  throw new Error(`handle ${runId}/${stepName} never reached idle-after-interrupt`);
}
```

Winning the race via the `waiter` side directly, both outcomes:

- `send_now` outcome: `sendNow(runId, stepName, messageId, message)` calls
  `liveHandle(...).accept(message, 'send_now')` (`dag-executor.test.ts:27364-27376`),
  which synchronously resolves `idleWaiter` inside `NodeSteeringHandle.accept`
  (`steering-registry.ts:308-323`) — `raceIdleWake`'s `Promise.race` resolves
  on the `waiter` promise before the poll's 10s timer ever elapses.
- `terminated` outcome via discard: `getSteeringRegistry().discardRun(RUN_ID)`
  (`dag-executor.test.ts:27698-27713`) after `awaitIdle`.
- `terminated` outcome via terminal run-status: `store.getWorkflowRunStatus`
  is mocked to return `'cancelled'` (`dag-executor.test.ts:27684`), and
  because `raceIdleWake`'s internal `tick()` runs SYNCHRONOUSLY on entry
  (`dag-executor.ts:549`, "First check is immediate"), the poll side resolves
  on its first tick without needing any timer to fire at all
  (`dag-executor.test.ts:27680-27696`).

The loop-node analog test at `dag-executor.test.ts:27974-28033` ("interrupt in
an AI loop idles inside the iteration and Send now resumes without consuming
one") uses the identical `awaitIdle`/`sendNow` helpers against `liveHandle(RUN_ID, 'my-loop')`.

**Precedent for a genuinely long (30-min-scale) real timer with an injectable
duration exists elsewhere in this codebase and is the closer analog for a new
inactivity timer:** `packages/workflows/src/utils/idle-timeout.ts` defines
`STEP_IDLE_TIMEOUT_MS = 30 * 60 * 1000` (line 21) and `withIdleTimeout(generator,
timeoutMs, onTimeout?, shouldResetTimer?)` — `timeoutMs` is a plain function
parameter, not a hardcoded module constant baked into the timer call, and the
timer re-arms on every yielded value by recomputing `remaining = timeoutMs -
(Date.now() - timerStartedAt)` and creating a fresh `setTimeout` each loop
pass (`idle-timeout.ts:56-92`), resetting `timerStartedAt = Date.now()` after
each accepted yield (line 88). Its test file
(`packages/workflows/src/utils/idle-timeout.test.ts`) drives this with plain
small real millisecond values (`setTimeout(resolve, delayMs)` at line 8,
`setTimeout(r, 20)` at line 174) passed directly as the `timeoutMs` argument —
no fake timers, no `setSystemTime`. This is the pattern a testable 30-min
inactivity timer should follow: make the duration a parameter (or an
overridable exported constant analogous to `STEP_IDLE_TIMEOUT_MS`/
`CANCEL_CHECK_INTERVAL_MS`), not a hardcoded literal inside the timer-creation
call, so tests can substitute a few milliseconds.

## Answers to the specific questions

**Does `raceIdleWake` currently use `setTimeout` with `CANCEL_CHECK_INTERVAL_MS`? How would a 30-min timer + keepalive re-arm integrate?**
Yes — `dag-executor.ts:539,543`, `timer = setTimeout(tick, CANCEL_CHECK_INTERVAL_MS)`
inside the `poll` promise's self-rescheduling `tick()` closure; `waiter` is the
other race arm (`interruptibleHandle.enterIdle(token)`). A one-shot
`setTimeout` that is CLEARED and RE-CREATED on each keepalive is the pattern
already proven for a re-arming deadline in this codebase — `idle-timeout.ts`'s
loop-based `Promise.race([nextPromise, timeoutPromise])` with `clearTimeout`
per pass is the direct precedent, but it re-arms on every generator yield
(automatic), whereas Story 2.12's keepalive is an explicit external signal
(composer activity), which `NodeSteeringHandle`/`SteeringRegistry` has NO
existing primitive for today (`steering-registry.ts`'s public surface —
`beginTurn`, `endTurnStream`, `settleTurn`, `interrupt`, `enterIdle`, `accept`,
`enqueue`, `pendingCount`, `closeIfEmpty`, `drain`, `withdraw`, `park`,
`resume`, `close`, `snapshot` — has no `keepalive`/`touch` method). A
deadline-timestamp polled each `CANCEL_CHECK_INTERVAL_MS` tick (extending the
existing `poll` closure to also compare `Date.now()` against a mutable
deadline variable, bumped by a new keepalive call) fits the EXISTING
`raceIdleWake` shape with the least structural change — a bare re-armed
`setTimeout` would need a NEW mutable timer handle exposed outward (e.g. on
the `NodeSteeringHandle`) so a keepalive call from outside `raceIdleWake` can
`clearTimeout`+reschedule it, which is more invasive of the current
encapsulation (today `raceIdleWake`'s timer is fully local to its closure, and
`enterIdle`'s promise-based waiter has no reset hook). This is a design
decision for the story to make explicitly, not something already resolved by
existing code.

**How do the existing steering tests advance/control time?**
Real timers only, and only for the sub-10ms-scale polling helper `awaitIdle`
(`Bun.sleep(1)` in a loop, up to 2000 iterations). The `#183` interrupt/redirect
suite never lets `raceIdleWake`'s own `setTimeout(tick, CANCEL_CHECK_INTERVAL_MS)`
actually fire — every test resolves the race via the `waiter` side (`sendNow`,
`discardRun`) or makes the poll's FIRST SYNCHRONOUS tick already see a
terminal run status. `setSystemTime` appears elsewhere in the same file but
only for a different, `Date.now()`-comparison-based check (mid-stream cancel
throttle), not for anything backed by a live `setTimeout`. A 30-min-scale
timer test will need the duration to be an injectable parameter (mirroring
`withIdleTimeout(generator, timeoutMs, ...)` / `idle-timeout.test.ts`'s plain
small millisecond values) — `setSystemTime` alone cannot make a real
`setTimeout(fn, 30*60*1000)` fire early, since Bun's fake-clock-via-`setSystemTime`
affects `Date.now()`/`new Date()` only, not the timer wheel.

**Is there a single teardown point for the handle that runs on both success and fail?**
Yes, confirmed for both node types — `executeNodeInternal`'s `finally`
(`dag-executor.ts:3910-3927`) and `executeLoopNode`'s wrapper `finally`
(`dag-executor.ts:5714-5729`). Both run unconditionally on every return/throw
except the one deliberate opt-out (`steeringPauseCommitted`/
`steering.steeringPauseCommitted`, set only on an AskHuman pause). A new
expiry-fail branch that returns an ordinary `{ state: 'failed', ... }` (never
touching `steeringPauseCommitted`) tears down correctly through this existing
path with no new teardown code — `steeringHandle.close()` inside the new fail
branch (mirroring `finishCancelled`) plus this `finally`'s
`unregister()` is exactly the sequence every other fail branch already
exercises. `close()`/`seal()` are idempotent, so the explicit `close()` inside
the new branch and the `finally`'s `steeringHandle.close()` do not conflict.

## Unresolved questions for the story (not answerable from current code)

- `SteeringIdleWake` has only `send_now` / `terminated` today
  (`steering-registry.ts:97-99`). Distinguishing "30-min expiry" from
  "discard"/"terminal run status" inside `raceIdleWake`'s existing
  `Promise.race` requires either a third `kind` variant or a side-channel —
  neither exists yet.
- No keepalive/touch primitive exists on `NodeSteeringHandle` or
  `SteeringRegistry` for resetting an in-flight timer from composer activity —
  this is entirely new surface.
- The exact wiring choice between "poll a mutable deadline every
  `CANCEL_CHECK_INTERVAL_MS` tick" vs "one-shot `setTimeout` re-armed via a
  handle callback" is unresolved by existing code; the report above lays out
  the trade-off but does not pick one.
