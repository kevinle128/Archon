---
phase: 1
title: 'Engine: steering registry and natural-boundary drain'
status: pending
priority: P1
effort: '7h'
dependencies: []
---

# Phase 1: Engine: steering registry and natural-boundary drain

## Outcome

`@archon/workflows` owns a process-local steering registry keyed `(runId, stepName)` and `executeNodeInternal` runs a turn loop: after a turn ends naturally and the re-ask loop settles, it drains queued operator messages as turn N+1 on the same provider session, or, when the queue is empty, closes the handle in the same tick and completes the node exactly as today. No interrupt, no abort, no transcript row, no new event. Cancel's `nodeAbortController` and its three read sites are byte-for-byte unchanged.

At phase end the registry suite and the new executor cases are green, and the existing `dag-executor.test.ts` suite is green untouched.

## Context links

- `_bmad-output/specs/spec-agent-node-room/engine-integration.md` §2 (natural end auto-drains; multi-turn on one session), §3 (in-process registry).
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` (idempotent duplicate, "teardown queue check is the last gate", every rejection leaves state unchanged).
- `plans/reports/scout-260919-0007-executor-turn-loop.md` (turn mechanics with `file:line`).
- `packages/workflows/src/dag-executor.ts:2266-2300` (`runStreamPass`), `:2536` (session id capture), `:2995-3121` (re-ask loop), `:3110-3330` (post-loop checks and completion), `:3332-3340` (function-level catch, `AskHumanAwaitingError` → `pauseOnAskHuman`).
- `packages/workflows/src/event-emitter.ts:363-368` (singleton precedent).

## Preflight

1. `git status` clean; rebase on current `develop`; confirm no other open PR touches `executeNodeInternal` or adds a steering module (`rg -n 'steering' packages/`).
2. Re-run `sed -n 2266,2300p` and `sed -n 2995,3130p` on `dag-executor.ts`; anchors drift — plan text uses stable text anchors, not line numbers.
3. Confirm the `dag-executor.test.ts` fake provider fixture shape (`mockSendQueryDag`, `sessionResume: true` in the capabilities fixtures at `:301/:318`) so new cases reuse it.

## Shared API

Create `packages/workflows/src/steering-registry.ts` (exported as `@archon/workflows/steering-registry`; add the subpath to `packages/workflows/package.json` `exports`).

```ts
export interface QueuedOperatorMessage {
  readonly message_id: string;
  readonly message: string;
  readonly operator_user_id: string | null;
  readonly received_at: string; // ISO, server receipt time
}

export type SteeringHandlePhase = 'live' | 'parked' | 'closed';

export type EnqueueResult =
  | { ok: true; state: 'queued'; duplicate: boolean }
  | { ok: false; reason: 'not_live' | 'closed' | 'queue_full' };
export const STEERING_QUEUE_MAX_PENDING = 50;
export const STEERING_ACCEPTED_ID_MEMORY = 500;

export interface SteeringHandleSnapshot {
  readonly phase: SteeringHandlePhase;
  readonly queued: readonly QueuedOperatorMessage[];
}

export class NodeSteeringHandle {
  readonly runId: string;
  readonly nodeId: string;            // namespaced stepName
  get phase(): SteeringHandlePhase;
  enqueue(msg: QueuedOperatorMessage): EnqueueResult;
  /** Atomic: returns queued messages in receipt order and empties the queue;
   *  when the queue is empty, flips phase to 'closed' in the same call. */
  drainOrClose(): QueuedOperatorMessage[];
  park(): void;                        // live → parked; queue kept
  resume(): void;                      // parked → live
  snapshot(): SteeringHandleSnapshot;
}

export class SteeringRegistry {
  /** Get-or-create; a parked handle is resumed to 'live'. */
  register(runId: string, nodeId: string): NodeSteeringHandle;
  get(runId: string, nodeId: string): NodeSteeringHandle | undefined;
  unregister(runId: string, nodeId: string): void;
  clear(): void;                       // tests only
}

export function getSteeringRegistry(): SteeringRegistry;      // process singleton
export function createSteeringRegistry(): SteeringRegistry;   // isolated instance for tests
```

Rules the class enforces:

- `enqueue` on `closed` → `{ ok: false, reason: 'closed' }`; on `parked` → `{ ok: false, reason: 'not_live' }`; on `live` → append, remember `message_id` in an `accepted` set for the handle's lifetime; a repeated `message_id` returns `{ ok: true, state: 'queued', duplicate: true }` **without** a second queue entry, before or after the original drained (D6).
- `drainOrClose` on `parked` or `closed` returns `[]` and does not change phase (a parked node has nothing live to run the turn).
- `register` on an existing `closed` handle replaces it with a fresh one (a retried node is a new execution; the old accepted-id memory must not leak into it).
- Everything is synchronous; no `await` between read and phase change (single-threaded loop guarantees atomicity).

## Executor changes (`executeNodeInternal` only)

All edits sit inside the existing function-level `try { … } catch (error) { … }`. Its `try` opens **after** `runStreamPass`, `buildReaskPrompt`, and `emitReask` are declared (the `try` immediately precedes the `let reaskAttempt = 0;` line, roughly 700 lines below `runStreamPass`'s declaration), and its `catch` starts with `const err = error as Error;` followed by the throttle-map cleanup. <!-- Updated: Red Team Session 1 - anchor corrected -->

Registration (step 1) therefore happens before that `try`; the `finally` (step 7) attaches to it.

1. **Register before the first pass.** Immediately after `const streamingMode = platform.getStreamingMode();` and only when `getProviderCapabilities(provider).sessionResume === true`, do `const steering = getSteeringRegistry().register(workflowRun.id, stepName);` else `const steering = undefined;`. Key on `stepName`, never raw `node.id` (D2).
2. **Wrap the re-ask loop in a turn loop.** Around the block that begins `let reaskAttempt = 0; let reaskPrompt = finalPrompt;` and ends where the `while (true)` re-ask loop exits normally, introduce:

   ```ts
   let turnResumeId: string | undefined = resumeSessionId; // seeds turn 1
   let turnPrompt = finalPrompt;
   let turnIndex = 0;
   let turnTokens: TokenUsage | undefined;          // sum across turns (nodeTokens is last-write-wins per pass)
   turns: while (true) {
     newSessionId = undefined;                        // a turn must positively produce its own session id
     let reaskAttempt = 0;
     let reaskPrompt = turnPrompt;
     // … existing scheduleReask + re-ask while(true), with the first pass calling
     //   runStreamPass(reaskPrompt, reaskAttempt === 0 ? turnResumeId : undefined, reaskAttempt, turnIndex)
     //   (identical to today except `resumeSessionId` → `turnResumeId` and the new 4th argument) …
     turnTokens = addTokens(turnTokens, nodeTokens);

     // Natural turn boundary: drain queued guidance, or close the handle in the
     // same tick so a later send is refused rather than accepted and dropped.
     if (steering === undefined || nodeIdleTimedOut || nodeAbortController.signal.aborted) break turns;
     if (detectCreditExhaustion(nodeOutputText) !== null) break turns; // the post-loop credit branch fails the node as today
     const queued = steering.drainOrClose();
     if (queued.length === 0) break turns;
     if (newSessionId === undefined) {
       getLog().warn({ nodeId: node.id, workflowRunId: workflowRun.id, queued: queued.length }, 'steering.drain_skipped_no_session');
       break turns; // D5: never continue on a fresh session; the handle is unregistered in finally (queue discarded, logged there)
     }
     turnResumeId = newSessionId;
     turnPrompt = queued.map(m => m.message).join('\n\n');
     turnIndex++;
     getLog().info({ nodeId: node.id, workflowRunId: workflowRun.id, queued: queued.length, turnIndex }, 'steering.turn_drain_started');
   }
   nodeTokens = turnTokens; // node_completed reports every turn's work
   ```

   Only the loop scaffolding and the boundary block are new; every line of the re-ask loop stays as it is. The block after the loop (idle-timeout notice, Cancel check, batch flush, credit exhaustion, empty output, `node_completed`, throttle cleanup, `return`) runs once, unchanged. <!-- Updated: Red Team Session 1 - session id reset per turn, credit check per boundary, token fold -->
3. **`runStreamPass` gains a fourth parameter `turnIndex: number`** (one call site). Its prologue already resets `nodeOutputText`, `structuredOutput`, `batchMessages`, `nodeCostUsd`, `nodeIdleTimedOut`, `backgroundTasksIncomplete`; `reaskAttempt` resets because it is declared inside the turn loop. Change the prologue's guard from `if (passReaskAttempt > 0)` to `if (passReaskAttempt > 0 || turnIndex > 0)` so a drained turn also drops `passOptions.resumeInteractions` (an answered ask must never be re-sent on a later turn) and rotates `executionScope = newTranscriptAttempt(executionScope)`. Additionally, when `turnIndex > 0`, set `passOptions.forkSession = false`: `nodeOptionsWithAbort` bakes `forkSession: true` once at entry for a node that resumes a persisted session, and a drained turn continues a session this execution already owns — forking it would break same-session continuity exactly for `persist_session` nodes. <!-- Updated: Red Team Session 1 - resumeInteractions/forkSession per turn, attempt rotation plumbed -->
   **`buildReaskPrompt` must build on the current turn's prompt, not the closed-over `finalPrompt`**: change it to `(base: string, errors: string[])` and have `scheduleReask` pass `turnPrompt`, so a re-ask on a drained turn keeps the operator's guidance in context. <!-- Updated: Red Team Session 1 -->
   Cost folds across turns through the existing `accumulatedCostUsd` (per pass). Tokens do **not** fold today (`nodeTokens` is overwritten per pass), so the loop sums per-turn `nodeTokens` into `turnTokens` and assigns it before `node_completed`; the usage ledger already records every pass in `runStreamPass`'s `finally`.
4. **Persisted across turns:** `nodeAbortController`, `executionScope.occurrence_id`, accumulated cost/tokens, `nodeResumed` (last-write-wins, already so for re-ask). `newSessionId` is deliberately reset per turn and must be re-captured from that turn's `result` chunk (`if (msg.sessionId) newSessionId = msg.sessionId;`).
5. **`node_started` is emitted once, before turn 1, as today. Nothing is emitted at drain** (SPEC: no turn-start event from steering; D14).
6. **Park on ask-pause.** In the catch branch `if (error instanceof AskHumanAwaitingError)`, call `steering?.park()` before `pauseOnAskHuman(...)` (queue survives the answer; the resumed execution re-registers and `register` resumes the parked handle).
7. **Unregister on every terminal exit.** Add `finally { if (steering && steering.phase !== 'parked') { const left = steering.snapshot().queued.length; if (left > 0) getLog().warn({ nodeId: node.id, workflowRunId: workflowRun.id, discarded: left }, 'steering.queue_discarded'); getSteeringRegistry().unregister(workflowRun.id, stepName); } }` to the function-level try/catch. The eleven early `return` sites need no edit — `finally` covers them. The `pending` (ask) return leaves the parked handle in place by design (D7). A Cancel or idle timeout that fires with messages queued therefore discards them **loudly** (warn with the count); restoring them to the operator as `NEVER SENT` is Story 2.11. <!-- Updated: Red Team Session 1 - discard is logged -->
9. **Bounds.** The handle caps the queue at 50 pending messages (`enqueue` → `{ ok: false, reason: 'queue_full' }`) and keeps at most 500 accepted ids (FIFO eviction); the route caps `message` at 16 000 characters. The registry is one process-wide singleton, so unbounded growth would be a memory DoS on every run in the process. <!-- Updated: Red Team Session 1 -->
10. **`packages/workflows/package.json`**: append `&& bun test src/steering-registry.test.ts` to the explicit `test` chain (the chain is hand-maintained; a file not listed never runs under `bun run validate`). <!-- Updated: Red Team Session 1 -->
8. **Operator prose is verbatim.** `turnPrompt` is never passed through `buildPromptWithContext` or `substituteNodeOutputRefs`; a `$` in operator text is text.

## Tests before (red first)

Create `packages/workflows/src/steering-registry.test.ts`:

- register returns a live handle; `get` returns the same instance; `unregister` removes it; `get` on unknown key is `undefined`.
- enqueue on live appends in call order; `snapshot().queued` preserves order and `received_at`.
- duplicate `message_id` → `{ ok: true, duplicate: true }`, queue length unchanged; after `drainOrClose` the same id still replays `duplicate: true` and re-adds nothing.
- `drainOrClose` with items returns them in order, empties the queue, phase stays `live`; with an empty queue returns `[]` and phase becomes `closed`; enqueue afterwards → `{ ok: false, reason: 'closed' }`.
- `park` keeps the queue, enqueue → `not_live`, `drainOrClose` → `[]` and stays `parked`; `register` on a parked key resumes it to `live` with the queue intact.
- `register` on a closed key returns a fresh handle whose accepted-id memory is empty.
- `createSteeringRegistry()` instances are independent; `getSteeringRegistry()` returns one instance across calls; `clear()` empties it.
- the 51st pending message → `queue_full` and the queue is unchanged; draining frees capacity; the accepted-id memory evicts FIFO past 500 entries.

Add to `packages/workflows/src/dag-executor.test.ts` a `describe('queued guidance drain', …)` using the existing fake provider (`mockSendQueryDag`) driven by a controllable async generator (a deferred promise the test resolves between chunks):

- **registers on start, unregisters on completion**: `getSteeringRegistry().get(runId, nodeId)` is live while the stream is open and `undefined` after `node_completed`.
- **no provider `sessionResume` → no handle** (capabilities fixture with `sessionResume: false`).
- **natural end with an empty queue completes as today**: exactly one `sendQuery` call, one `node_completed`, handle closed then unregistered, `$node.output` equals turn 1 output.
- **natural end with two queued messages runs turn N+1 on the same session**: enqueue `m1`, `m2` while turn 1 streams; after turn 1's `result` (sessionId `s1`), `sendQuery` is called a second time with prompt `"m1\n\nm2"`, `resumeSessionId === 's1'`, and options carrying **no** `resumeInteractions` and `forkSession !== true`; still one `node_started`; exactly one `node_completed` after turn 2; `$node.output` is turn 2's text; cost and tokens on `node_completed` are the sums of both turns.
- **a persisted-session node keeps continuity**: start the node with a non-undefined `resumeSessionId` (so `forkSession: true` is baked at entry); turn 1's options carry `forkSession: true`, turn 2's carry `forkSession: false` and resume the session id turn 1 returned.
- **an ask-resumed node does not re-send the answer**: start with `resumeInteractions` set; turn 1's options carry them; turn 2's options do not.
- **a turn that returns no session id stops the chain**: turn 1 returns `s1`, turn 2's `result` lacks `sessionId`; with a message queued during turn 2, no third `sendQuery` happens and `steering.drain_skipped_no_session` is logged (the stale `s1` is never reused).
- **re-ask on a drained turn keeps the guidance**: `output_format` node; turn 2's first pass returns prose; the re-ask prompt starts with `"m1\n\nm2"` (not `finalPrompt`) plus the correction suffix.
- **credit exhaustion at the boundary is not drained past**: turn 1's output contains the SDK credit-exhaustion text and a message is queued; no second `sendQuery`; the node fails through the existing credit branch.
- **queue bounds**: the 51st pending enqueue returns `queue_full`; after 500 accepted ids the oldest id is forgotten (a replay of it is accepted as new).
- **cancel with a non-empty queue logs the discard**: `steering.queue_discarded` with `discarded: 1`.
- **messages queued during turn N+1 drain as turn N+2**; a queue empty at turn 2's end completes the node (three `sendQuery` calls total).
- **operator prose is verbatim**: a queued message containing `$ARGUMENTS` reaches the provider unchanged.
- **attempt id rotates, occurrence id does not**: transcript rows from turn 2 carry a new `execution.attempt_id` and the same `execution.occurrence_id`.
- **send after close is refused**: with a stream that pauses after `result`, call `drainOrClose` path to completion, then `enqueue` → `closed` (this is the executor-level proof of the "last gate").
- **idle timeout / abort suppresses the drain**: with a queued message and `nodeAbortController` aborted via the existing cancel poll fixture, no second `sendQuery` is made and the node fails with `Cancelled by user` exactly as today.
- **re-ask still works on the drained turn**: `output_format` node; turn 2's first pass returns prose, the re-ask runs on a fresh session (existing behaviour preserved), then validates.
- **missing session id skips the drain with a warn**: fake `result` without `sessionId` and a queued message → one `sendQuery`, node completes, `steering.drain_skipped_no_session` logged.
- **ask-pause parks the handle**: fake throws `AskHumanAwaitingError` mid-turn with a queued message; handle phase is `parked` and the queue is intact; a re-run of the node (resume path) re-registers to `live` and drains it at the next natural end.
- **loop node is never registered**: `executeLoopNode` path leaves `get(runId, nodeId)` undefined (documents D11).

## Refactor (protected changes)

- Only `executeNodeInternal` changes; `executeLoopNode`, `executeLoopGroupNode`, the cancel poll, `withIdleTimeout`, `canReask`, and the `:3124` Cancel check are untouched.
- Keep the re-ask loop body textually intact; the diff should read as "declare turn loop, rename `resumeSessionId` → `turnResumeId` in one call, add the boundary block, add `park`, add `finally`".

## Tests after

- Run the whole `dag-executor.test.ts` file: every pre-existing case passes without modification.
- Run `packages/workflows` `bun run type-check` and `lint` (zero warnings).

## Regression gate

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/workflows && bun run type-check && bun run lint)
```

## Test scenario matrix

| Path | Priority | Case |
|------|----------|------|
| Drain to same session | Critical | two queued → one turn N+1 with `resumeSessionId === s1` |
| Last-gate close | Critical | enqueue after `drainOrClose` on empty → `closed` |
| Cancel dominance | Critical | aborted controller → no drain, existing failure path |
| Idempotent duplicate | High | replay after drain, no second entry |
| Park on ask | High | queue survives `AskHumanAwaitingError`; resume re-registers |
| Verbatim prose | High | `$ARGUMENTS` not substituted |
| Attempt rotation | Medium | new `attempt_id`, same `occurrence_id` |
| No session id | Medium | warn + skip, node completes |
| No `sessionResume` | Medium | no handle |

## Todo

- [ ] `steering-registry.ts` + subpath export
- [ ] `steering-registry.test.ts` red → green
- [ ] executor turn loop, park, finally
- [ ] `dag-executor.test.ts` drain cases red → green
- [ ] existing executor suite green; type-check and lint clean

## Success criteria

- A message enqueued during turn 1 is delivered as the prompt of a second `sendQuery` on the captured session id, and the node emits one `node_started` and one `node_completed`.
- An empty queue at the natural boundary closes the handle synchronously; a subsequent enqueue is refused.
- Cancel, idle timeout, re-ask, and ask-pause behave exactly as before, with the handle parked or unregistered accordingly.

## Risk assessment

- **Wrong session on turn N+1** (fresh instead of resumed): guarded by the assertion on `resumeSessionId === 's1'`.
- **Double `node_completed`** if the completion block is accidentally inside the loop: guarded by the exactly-one assertion.
- **Handle leak on an unforeseen exit**: `finally` covers all returns and throws; the parked case is the only deliberate survivor.

## Security considerations

None new: the registry holds operator prose in memory only; `operator_user_id` is attribution, not authorization (authorization is Phase 2).

## Next steps

Phase 2 consumes `getSteeringRegistry()`, `NodeSteeringHandle.enqueue/snapshot`, and the phases `live | parked | closed`.
