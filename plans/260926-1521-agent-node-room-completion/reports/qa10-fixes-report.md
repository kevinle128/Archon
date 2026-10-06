# Round-10 visual QA fixes — Agent Node Room

Date: 2026-09-29 (Asia/Saigon). Base checkout: `develop-2`. Worktree:
`/Users/dale/orca/Archon/.claude/worktrees/agent-a7c58849f735cc338`, branch
`worktree-agent-a7c58849f735cc338`.

Fixes the three findings in
`plans/260926-1521-agent-node-room-completion/reports/visual-qa-10-report.md`
(VQ10-1, VQ10-2, VQ10-3, all minor), per the round's own recorded decisions,
plus the coordinator's extra-scope request to add automated coverage for
four not-verifiable acceptance criteria from that same round. One of those
four (7.5, failed automatic dispatch) turned out to be a genuine
implementation gap rather than a missing test; per the user's decision it
was built as its own feature group — see the dedicated "7.5" section.

## VQ10-3 — orphaned-node terminal writes landed unscoped for a prompt or loop node (minor)

**Root cause.** `findNonTerminalNodes` read a non-terminal node's execution
scope off whichever event was LATEST for its `step_name`. For an AI (prompt
or loop) node, the latest event before a crash is routinely
`tool_called`/`tool_completed`/`node_usage_recorded` — none of which carry
`occurrence_id`/`attempt_id` (only `node_started`/`loop_iteration_started`
do, via `executionScopeEventFields`). The synthesized `node_failed`
`writeTerminalNodeEventsForOrphanedNodes` writes on Abandon therefore landed
unscoped (or partially scoped, carrying only whatever `node_usage_recorded`
happened to have — `retry_epoch` and `iteration`, never the ids). The
execution-history projector (`projectWorkflowExecutionHistory`) pairs a
terminal event to its open row by `occurrence_id`; an unscoped terminal event
can't pop the real open row, so it stays stuck `running` forever, and a
second `unknown_scope: true` row appears alongside it — exactly the QA
report's "Run 1 · running" + "Execution unknown" symptom. The round-9 fix's
own live verification used a deterministic `bash:` node, which never has
tool events in between and so never exercised this gap.

**Fix.** `packages/core/src/db/workflow-events.ts`: rewrote
`findNonTerminalNodes` to pair START events (`node_started`,
`loop_iteration_started`) with their closing terminal event by
`occurrence_id` — the same identity `projectWorkflowExecutionHistory` itself
uses — instead of reading whichever event is latest. A loop mid-iteration has
**two** independent open executions at once: the container (opened by
`node_started`, never closed until the whole node settles) and the current
iteration (opened by `loop_iteration_started`, a fresh occurrence every
iteration); both are now reported, each with its own scope and its own
closing event type (`node_failed` for the container, `loop_iteration_failed`
for the iteration). Results are ordered iteration-before-container,
mirroring the live executor's own sequence (`failLoopIteration` writes
`loop_iteration_failed`, then calls `failLoopNode`, which writes
`node_failed`). Legacy rows minted before `occurrence_id` existed (no scope
at all) still fall back to the old "latest unscoped start per step_name"
pairing, scoped to that narrow case only.

`packages/core/src/operations/workflow-operations.ts`:
`writeTerminalNodeEventsForOrphanedNodes` now branches on each reported
execution's `terminalEventType`, writing `loop_iteration_failed` (with the
iteration's own scope, including `iteration`) for an open iteration and
`node_failed` for an open container, and emits the matching typed
`WorkflowEmitterEvent` for each so the SSE bridge forwards it correctly
(`ROW_NODE_STATUS`/`mapWorkflowEvent` already handle `loop_iteration_failed`
→ `dag_node`/`failed`).

**Tests.** `packages/core/src/db/workflow-events.test.ts`: a prompt-node
scenario (`node_started` scoped → `tool_called` → `tool_completed`, no scope
in between) asserting the returned scope matches `node_started`'s occurrence
exactly, not the bare tool events'; a loop scenario (container `node_started`
→ iteration 1 `loop_iteration_started`/`loop_iteration_completed` → iteration
2 `loop_iteration_started` → `tool_called`/`node_usage_recorded`) asserting
**two** entries come back, iteration first, each with its own
`occurrence_id`; the existing "excludes a terminal node"/"retried node"/
"empty"/"error propagates" cases updated to the new scoped-event shape.
`packages/core/src/operations/workflow-operations.test.ts`: a new test
proving a `loop_iteration_failed` entry writes that exact event type (with
`iteration` from scope) and emits the matching typed event, distinct from a
`node_failed` entry for the container in the same call; existing tests
updated for the new `terminalEventType` field.
`packages/server/src/routes/workflow-execution-history.test.ts`: two new
integration-style tests feed the exact synthesized event shapes
`writeTerminalNodeEventsForOrphanedNodes` produces (for a prompt node and a
loop node) into `projectWorkflowExecutionHistory` and assert zero
`unknown_scope` rows and zero `running` rows — proving the whole pipeline
settles, not just the write. Every new/changed assertion was confirmed to
**fail** against the pre-fix code (temporarily reverting the occurrence-pairing
logic) before being restored.

**Live verification.** Isolated scratch server, real Claude subscription,
`qa10-prompt` and `qa10-loop` workflows (`provider: claude` forced — the
config default was `codex`), a foreground CPU busy-wait command (matching
the round-9/10 QA's own technique — a plain `sleep` let Claude report done
via its own background-task tracking before the command actually
finished). For both the prompt node and the loop node's iteration 2: Stop
mid-tool-call, queue one steering item, confirmed the run's latest event was
a scope-less `node_usage_recorded` (the exact trigger), `kill -9` the
server, restarted on the same port, confirmed `status: "running"` still (no
autonomous mutation), then Abandon.

- Prompt node (run `cd51131c880dd1182b990f86ca2c5d7b`): the synthesized
  `node_failed` carried the **exact same** `occurrence_id`/`attempt_id` as
  the original `node_started`. `nodeExecutions` is a single row,
  `status: "failed"`, zero `unknown_scope`.
- Loop node (run `d3e396da80248326c7fce87c718f818d`), iteration 2: three
  `nodeExecutions` rows — iteration 1 (`completed`, unaffected), the
  container (`status: "failed"`, matching the outer `node_started`'s ids
  exactly), and iteration 2 (`status: "failed"`, matching iteration 2's own
  `loop_iteration_started` ids exactly — a **different** occurrence than the
  container's). Zero `unknown_scope`, zero `running`. The last two persisted
  events were `loop_iteration_failed` then `node_failed`, confirming the
  write-order fix.

Full evidence: `evidence/qa10-fixes/vq10-2-and-vq10-3-live-verification-notes.md`,
`vq10-3-prompt-node-run-detail.json`, `vq10-3-loop-node-run-detail.json`.

## VQ10-2 — a Console tab opened after a restart showed `Running` for ~26s after Abandon (minor)

**Root cause.** Two independent gaps combined. First: `SSETransport` (the
server's SSE fan-out) keeps exactly **one** stream per conversation —
`registerStream` explicitly closes an existing stream when a new one
registers (documented, tested behavior:
`packages/server/src/adapters/web/transport.test.ts:51`, "closes existing
stream when registering a new one" — assumed a new registration always means
the old tab is gone). Four tabs (Console/Legacy × surviving/fresh) watching
the SAME run's conversation collide on that single slot; whichever
tab's `EventSource` connects LAST wins the live push, so a tab that loses the
race never receives the `node_failed` SSE event Abandon writes and falls
back entirely to its own polling. Second: Console's own polling for a
non-terminal run is a 30s "SSE-drop safety net" — far slower than the
~1s cadence a restart-recovered node's own steering-dock queue poll already
uses to learn the node settled (that poll reports `execution_state:
'finished'` on its very next tick, well under 1s). Nothing connected the
dock's own fast, already-working signal to a run-entity refetch, so a tab
that lost the SSE race showed the stale cached run status (`running`) for up
to 30s. Separately, even once the dock's `execution_state` flips from
`'recovery_required'` to `'finished'`, the header pill immediately stopped
treating the node as "recovery required" and fell through to its raw
(possibly still-`running`) row status — a brief but real `Running` flash
visible in every case, not just the losing-SSE-race one.

**Fix.** Deliberately did **not** change `SSETransport`'s one-stream-per-
conversation contract — it's documented, tested (`transport.test.ts:51`),
governs chat too, and reversing it is a bigger, separate architectural
question outside three minor findings' scope; flagged below as a latent
multi-tab issue worth its own item. Instead, fixed the seam that actually
regressed: `packages/web/src/lib/execution-room-model.ts` adds two pure
functions. `isRoomRecoveryRequired(dockExecutionState, status)` treats a
`'finished'` dock read the same as `'recovery_required'` for as long as the
row/run status it feeds still reads non-terminal — so the pill never falls
through to a stale `Running` in the gap between the dock's own fast read and
the run entity's slower refetch; it settles to the real terminal pill the
instant either poll actually lands, and can never wedge on `Recovery
required` once the status is genuinely terminal. `shouldRefetchRunOnDockFinished`
returns true on the exact edge a dock read first reports `'finished'` while
the cached run status is still non-terminal — the moment to force an
immediate run refetch instead of waiting on SSE or the 30s heartbeat.
`packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` wires
both: the header's `recoveryRequired` prop now uses
`isRoomRecoveryRequired`, and a new `handleDockExecutionStateChange` callback
(replacing the raw `setDockExecutionState` passed to `ConsoleComposerDock`)
calls `invalidate(K.run(run.id))` on that edge, using a `useRef` (not a
state-updater side effect) to track the dock's previous `execution_state`
without depending on stale render state.

Legacy's `ComposerDock`-driven `LegacyNodeRoom.tsx` got only the pill half
(`isRoomRecoveryRequired`, reusing the same shared function): Legacy's own
run-detail poll (`resolveRunDetailRefetchIntervalMs`) already refetches
every 3s regardless of SSE reliability — it doesn't have Console's
up-to-30s stale-cache problem — so the invalidate-on-edge plumbing (which
would need threading a callback through `WorkflowExecution.tsx` →
`LegacyGraphLogsPane.tsx` → `LegacyNodeRoom.tsx` → `ComposerDock.tsx`) was
not added; the pill fix alone brings Legacy's own worst case down from
"passes through `Running` briefly" to matching the same non-flashing
behavior Console now has.

**Tests.** `packages/web/src/lib/execution-room-model.test.ts`: full
coverage of both new pure functions — `isRoomRecoveryRequired` (raw
`recovery_required` always requires recovery; `finished` still requires
recovery while status is non-terminal; `finished` stops requiring recovery
once status is terminal; `live`/`null` never require it; a `null` status is
treated as non-terminal) and `shouldRefetchRunOnDockFinished` (fires on the
edge into `finished` while status is non-terminal; never fires when already
`finished` last render; never fires once status is already terminal; never
fires for a transition into any state other than `finished`).
`packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`:
a new integration test mounts the real `ConsoleComposerDock` with a mocked
`/queue` GET returning `execution_state: 'finished'` while the mounted
`run.status` stays `'running'`, and asserts the room pill reads `Recovery
required` (never `Running`) and `invalidate` was called with `K.run(runId)`.
Confirmed to fail against the pre-fix code (reverting the `ConsoleNodeRoom.tsx`
wiring) before being restored. Legacy's pill change has no dedicated new DOM
test — it swaps a boolean expression for the same already-unit-tested pure
predicate; correctness there rests on the shared unit tests plus the full
`LegacyNodeRoom.test.tsx`/`ComposerDock.test.tsx` regression suites (both
green, 53 and 110 tests respectively) — stated here as a known, accepted gap
rather than silently skipped.

**Live verification.** Same restart session as VQ10-3's loop case (run
`d3e396da80248326c7fce87c718f818d`): a Playwright browser tab that **never
existed before the `kill -9`**, opened ~1.5s after the restart, navigated
straight to the Console room. The pill read `Recovery required`, then went
directly to `Failed` **167ms** after the Abandon POST — `Running` was never
observed at any of the 40ms samples taken across the whole window. Pre-fix,
round 10 measured this exact scenario at 429-456ms into `Running`, settling
to `Failed` only at 26.35-26.39s. Evidence:
`evidence/qa10-fixes/vq10-2-timing-notes.txt`,
`vq10-2-fresh-tab-after-restart-failed.png`.

## VQ10-1 — Grok `--single` orphaned its tool subprocess on Abandon (minor)

**Root cause.** Grok's `--single` transport spawns via `Bun.spawn` with no
process group (`defaultSpawner`); on abort, `terminate()` only called
`proc.kill()` on the `grok --single` process itself. A tool call that forks
its own subprocess (a shell command) is a child of `grok --single`, not of
this server, so killing only the root orphans it, reparented to PID 1 once
`grok --single` exits — the same leak class the round-9 Codex fix covered,
on the one transport it never reached (round 9's own Grok `--single` repro
had no tool open at Abandon time, so the path went unmeasured).

**Fix.** Unlike Codex — whose SDK races its own abort teardown ahead of any
snapshot this provider could take, forcing the round-9 fix to snapshot
early, on the SDK's own `item.started` event — Archon spawns Grok's process
directly and decides exactly when to signal it, so the descendant tree can
be snapshotted **before** sending any signal to the root: on abort,
`packages/providers/src/grok/provider.ts`'s `terminate()` now snapshots the
process tree (via `ps`), SIGTERMs the root, then reaps whatever the snapshot
showed. Snapshotting is skipped entirely (falling straight to killing the
root, as before) until a `tool_call` chunk has actually been parsed from the
stream — an ordinary abort with no open tool never pays a `ps` round-trip,
and every existing Grok unit test that doesn't exercise a tool call keeps
working unchanged with zero added I/O. `GrokProcess` gained a `pid` field
(populated from `Bun.spawn`'s own `proc.pid`); the constructor gained
injectable `processTreeOps`/`treeReapTerminateGraceMs` options, matching
Codex's shape.

The provider-neutral snapshot/reap mechanics (process listing via `ps`,
descendant BFS, SIGTERM-then-SIGKILL) moved from `codex/process-tree-reap.ts`
to `packages/providers/src/shared/process-tree-reap.ts` so both providers
share one written-and-tested implementation; each provider keeps only its
own way of identifying the root to reap from (Codex's ancestry search for a
pid the SDK never hands back — `findCodexExecRoot`, still codex-only; Grok's
own spawned `pid`, needing no search at all).

**Tests.** `packages/providers/src/shared/process-tree-reap.test.ts` (new):
`collectDescendantPids` and the generic reap function's SIGTERM/SIGKILL-
escalation tests, moved verbatim from the old combined codex test file (now
provider-neutral fixture data). `packages/providers/src/codex/process-tree-reap.test.ts`:
trimmed to `findCodexExecRoot` only, unchanged behavior.
`packages/providers/src/grok/provider.test.ts`: two new tests — a node-level
Abandon with a fake `processTreeOps` and a synthetic `tool_call` chunk,
asserting the tool's own child pid gets SIGTERMed (not just the `grok`
root); and an abort with **no** tool call, asserting `listProcesses` is
never called at all (zero `ps` round-trips for the common case). Both
confirmed to fail against the pre-fix code (temporarily forcing the
tool-started gate open) before being restored — the first failed on a
timeout waiting for the child's kill signal that never came, reproducing the
exact leak.

**Live verification.** Isolated scratch server, real Grok subscription,
`qa10-grok-single` workflow (`output_format` forces the `--single`
transport), prompted to run `sleep 60`. Captured the live process tree under
my server pid: `grok --single` (pid 81858), its zsh wrapper (pid 86609,
ppid 81858), `sleep 60` (pid 86678, ppid 86609). `POST .../abandon` →
polled at +1s/+3s/+8s: the wrapper and `sleep` were already gone at +1s, the
`grok --single` root itself gone by +3s, and a system-wide
`ps | grep "sleep 60"` at +8s found nothing anywhere — no pid was ever
observed reparented to PPID 1. Server log confirmed
`grok.tree_reap_armed rootPid:81858 descendantCount:10` followed by
`process_tree_reap.terminating_orphans` naming all 10 descendants including
the wrapper and `sleep 60` pids from the pre-abandon snapshot; no
`sigkilled_orphans` line followed, meaning every descendant died within the
SIGTERM grace window. Evidence:
`evidence/qa10-fixes/vq10-1-live-verification-notes.md`,
`vq10-1-grok-single-reap-server-log-excerpt.jsonl`.

## 7.5 — retryable automatic-dispatch failure returns the entry to the front of the queue (built)

Extra-scope item 4 below traced to a genuine, undocumented behavior gap (see
the former "Unresolved questions" entry, since resolved): every automatic
guidance-turn dispatch failure fell straight to Design decision 6's node-
failing path, with nothing reverting the claim or keeping the node alive.
Surfaced to the coordinator, who asked the user; the user's decision was
**build it**, scoped precisely: only a retryable dispatch failure (the live
provider session is still usable) reverts the claimed entry to the front of
the queue with durable failure evidence, and the node parks in the existing
idle-after-interrupt wait rather than failing — the operator's `Send now`
retries on the same session. A session-losing failure (no session id to
resume) still fails the node exactly as before; Design decision 6 is
unchanged. No retry cap, no automatic retry loop — every retry after the
first is operator-initiated.

**Schema (additive, both dialects).** `remote_agent_steering_queue_entries`
gains `dispatch_failure_count INTEGER NOT NULL DEFAULT 0` (migration body +
SQLite `createSchema()` mirror + `migrateColumns()` upgrade path); the
existing `last_error TEXT` column — already present, already documented for
exactly this purpose — carries the failure message. `check:schema-upgrades`
run against a live PostgreSQL container confirmed the additive migration
applies cleanly from every prior baseline with only the pre-existing,
expected `remote_agent_codebases_kind_check` divergence.

**Store.** `revertSteeringQueueClaim(workflowRunId, nodeId, messageIds,
failureMessage)` (`packages/core/src/db/workflow-steering.ts`) reverts only
entries still in `dispatching` state back to `queued` at their existing
(unchanged) `fifo_position` — already the front among claimable entries,
since it was claimed first — and increments `dispatch_failure_count`.

**Executor.** Both the direct-node stream-pass loop and the loop-node
iteration loop (`packages/workflows/src/dag-executor.ts`) now classify a
thrown provider/execution error on a guidance turn: retryable when the turn
is guidance, an established session id exists, the operator did not
interrupt, the node itself was not cancelled, and the error is not
abort-like — everything else re-throws unchanged (session-losing failures,
operator Stop, node Cancel, and ordinary non-guidance-turn failures all keep
today's behavior exactly). On a retryable throw: revert the claim, emit
`node_turn_interrupted` so an observing tab refetches promptly, and enter the
same `enterIdle`/`raceIdleWake` park an operator Stop uses — `Send now`
re-claims and retries on the untouched session; inactivity expiry fails the
node through the existing idle-await-expired path, reconciling the reverted
entry to `never_sent`.

**API.** The queue-read response (`GET .../nodes/:nodeId/queue`) now carries
`last_error`/`dispatch_failure_count` on every row.

**Docks.** Both Console and Legacy composer docks render one
`role="alert"`/`aria-live="assertive"` error naming the failure and offering
`Send now`, replacing the generic Stop disclosure for this parked state
only; the reverted row itself is marked "failed" in the queue list. Both
the alert and the row marker are gated on `state === 'queued'` — the store
never clears `last_error` on a later successful claim, so a naive
`lastError !== null` check would keep showing the alert after a retry
already succeeded; see the dedicated bug note under Tests. Console never
imports `@/components/` (verified).

**Tests.** Store: `packages/core/src/db/workflow-steering.test.ts` — 6 new
`revertSteeringQueueClaim` tests (front-of-queue ordering without
renumbering, idempotency on an already-non-dispatching entry, repeated
cycles incrementing the count, no-op when never claimed, no-op when already
`sent`, empty-array no-op). Executor:
`packages/workflows/src/dag-executor.test.ts` — 5 new tests covering the
direct-node path (revert-and-park-then-retry-on-same-session, repeated
failure keeps incrementing the count and keeps the entry ahead of later
guidance, session-losing failure still fails the node outright, a mid-stream
throw after the operator receipt already committed — the revert is a no-op
on an already-`sent` entry, node still parks) and the loop-node path
(mirrors the first direct-node test). API:
`packages/server/src/routes/api.workflow-runs.test.ts` — a new test proving
the queue-read response exposes `last_error`/`dispatch_failure_count`, plus
three pre-existing exact-equality assertions updated for the two new
response fields (not weakened). Docks:
`packages/web/src/lib/steering-dock.test.ts` — 4 new tests (`applyQueueSnapshot`
carries failure evidence through and correctly detects a state-only-looking
change as a real change; `dispatchFailedEntry`/`dispatchFailureDisclosure`
unit coverage, including that stale evidence on a re-claimed row is ignored
— see below).
`packages/web/src/components/workflows/ComposerDock.test.tsx` and
`packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` —
one new test each, mounting the real dock with a queue snapshot carrying
failure evidence and asserting the exact assertive-alert text, the absence
of the generic Stop disclosure, the "failed" row marker, and that `Send now`
remains available.

Every new test was written against the already-implemented code (not
TDD-first for this group, unlike the three main findings) but each was
manually traced against the pre-fix behavior during implementation — e.g.
the first executor test failed with `revertSteeringQueueClaim is not a
function` against the mock before the mock was updated, and a deliberately
wrong SQL placeholder index (caught and fixed before any test run) confirms
the store test would have caught that class of bug too. One genuine bug was
also caught this way, before any live verification: the store never clears
`last_error`/`dispatch_failure_count` on a later successful claim (they are
durable history, by design), so `dispatchFailedEntry`'s first
implementation — matching on `lastError !== null` alone — would have kept
showing the assertive alert on a row whose retry was already in flight or
had already succeeded. Fixed by also requiring `state === 'queued'` (the
one state a revert actually leaves an entry in), in both the pure helper
and the two dock components' "failed" row marker, with a dedicated test
covering a `dispatching` and a `delivered` row that both still carry stale
`lastError`.

**"No auto-send after Stop" for this new idle state.** Not a separate
mechanism to test: the park reuses the identical `enterIdle`/`raceIdleWake`
wait an operator Stop already uses, so the SAME proof applies — nothing
re-enters the top of the `turns:` loop (where an auto-claim could fire)
until an explicit `send_now` wake resolves it. The "queued while parked
never auto-sends" assertion in the first direct-node executor test (calls
count stays at 2 after enqueuing a second message with no `Send now`) is the
concrete proof.

**e2e-fake provider and live verification.** The `e2e-fake` provider
(`packages/providers/src/e2e-fake/`) has no scenario directive that throws a
plain (non-abort) error mid-turn — its scenario schema covers completion
shape, tool emission, AskHuman, interruptibility, and file-edit outcomes,
but not a scripted dispatch failure. Adding one is a separable
provider-package change (new directive + schema + provider logic + its own
test coverage) judged out of scope for this pass; not attempted. A live
real-provider induction was also not attempted: there is no safe,
deterministic way to force a live Claude/Grok SDK call to throw specifically
on the second (auto-claimed guidance) turn without fragile environmental
tricks (severing network mid-call, malformed provider config) that risk
either flakiness or an unintended provider-side side effect, and the
executor-level tests already exercise the exact throw-before-first-chunk and
throw-mid-stream-after-receipt conditions precisely, on both node types,
against the real classification code (not a re-implementation of it). This
is fake-only-not-attempted-either, documented per the coordinator's explicit
allowance rather than silently skipped.

## Extra scope — automated coverage for four not-verifiable acceptance criteria

The coordinator asked for automated coverage (unit, server, or fake-provider
e2e) so four ACs from round 10's "not verifiable" list become verifiable
without a real provider. Three of the four are already satisfied by
existing, currently-passing tests — traced and re-run individually, no new
coverage was needed. The fourth (auto-send failure) turned out to be a
genuine, undocumented behavior gap rather than a missing test; traced to its
root cause, escalated to the coordinator/user for a product decision, and
built per that decision — see the dedicated "7.5" section above.

1. **5.2 `unknown` attribution on ambiguous evidence, both shells.**
   `packages/server/src/routes/git/execution-attribution.test.ts:134`
   ("treats overlapping executions on the shared checkout as ambiguous —
   unknown for both") proves two time-overlapping node executions produce
   `executions: []` server-side for the path they both touched.
   `packages/web/src/lib/files-changed.test.ts:43` proves that empty array
   renders as `'unknown'`. `packages/web/src/experiments/console/components/FilesChangedPanel.test.tsx:83`
   (Console) and `packages/web/src/components/workflows/source-control/files-changed-tab.test.tsx:129`
   (Legacy) both assert the rendered text end-to-end.
2. **Stale (finished) loop iteration view with items queued: read-only,
   shared pending queue shown, no send/withdraw/interrupt.**
   `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx:2163`
   ("finished-iteration hydrates ordered band without delete controls") shows
   the queue's actual content in finished-iteration mode with no mutation
   controls; `:2231` ("finished-iteration never mutates via pointer or
   keyboard") asserts zero send/withdraw calls after simulated click and
   keyboard input. Mirrored in Legacy at
   `packages/web/src/components/workflows/ComposerDock.test.tsx:2276`/`:2344`.
   `packages/web/src/lib/steering-dock.test.ts:400` proves
   `canSubmitGuidance` refuses submit in finished-iteration mode at the pure-
   function level.
3. **Duplicate caller-stamped `message_id` returns the existing receipt, no
   duplicate row.** `packages/server/src/routes/api.workflow-runs.test.ts:7594`
   ("replays the original receipt for a duplicate id before and after the
   executor claims it") and `:8540` ("duplicate send_now replays the
   original receipt without a second wake") both assert a duplicate POST
   returns the identical receipt and the queue snapshot stays at length 1.
4. **7.5 failed automatic dispatch returns to front of queue with failure
   evidence and an accessible error.** Traced exhaustively — a real gap, not
   a test gap. Escalated, the user decided to build it, and it is built —
   see the dedicated "7.5" section above for the full implementation and
   test list.

## Verification

**Unit tests.** Every test file touched by this report's commits, run in
isolation:

```
packages/core: workflow-events.test.ts 36 pass, workflow-operations.test.ts 83 pass
packages/server: workflow-execution-history.test.ts 16 pass
packages/providers: shared/process-tree-reap.test.ts 6 pass,
  codex/process-tree-reap.test.ts 6 pass, codex/provider.test.ts 104 pass,
  grok/provider.test.ts 28 pass
packages/web: execution-room-model.test.ts 156 pass,
  ConsoleNodeRoom.test.tsx 139 pass, ConsoleComposerDock.test.tsx 110 pass,
  LegacyNodeRoom.test.tsx 53 pass

7.5 (retryable automatic-dispatch failure):
packages/core: workflow-steering.test.ts 31 pass (incl. 6 new
  revertSteeringQueueClaim), plus sqlite.test.ts / bundled-schema.test.ts /
  migration-statement-order.test.ts 107 pass combined across the 4 files
packages/workflows: dag-executor.test.ts 713 pass (incl. 5 new),
  subrun.test.ts 69 pass (mock updated for the new store method)
packages/server: api.workflow-runs.test.ts 336 pass, 9 todo (incl. 1 new
  API test; 3 pre-existing exact-equality assertions updated, not weakened)
packages/web: steering-dock.test.ts 175 pass (incl. 4 new),
  ComposerDock.test.tsx 116 pass (incl. 1 new),
  ConsoleComposerDock.test.tsx 111 pass (incl. 1 new)

packages/cli: workflow.test.ts 353 pass (329 pass, 18 skip, 6 todo, 0 fail)
```

Every regression test added for the three main findings (VQ10-1/2/3) was
individually confirmed to **fail** against the pre-fix code first
(temporarily reverting the specific new logic), then restored — not just
written to pass against the new code. The 7.5 tests were written against
already-implemented code (not TDD-first), but each was traced against the
pre-fix behavior during implementation: the first executor test failed with
`revertSteeringQueueClaim is not a function` against the stale mock before
the mock was updated, and a deliberately wrong SQL placeholder index in the
store function (caught and fixed before any test ran) confirms the store
test would have caught that class of bug too — see the 7.5 section above.

Full package suites, each package's own `bun run test`:
`@archon/core` 60 invocations, all `0 fail`. `@archon/server` all `0 fail`.
`@archon/providers` all `0 fail`. `@archon/web` 1163 pass / 0 fail across 86
files (plus the separate `src/components/` and `src/experiments/console/`
legs). `@archon/cli` 76 + 40 pass, 0 fail.

`bun run --filter <pkg> type-check`: clean for `@archon/core`,
`@archon/server`, `@archon/providers`, `@archon/web`, `@archon/workflows`.
`bun x eslint <touched files> --max-warnings 0`: clean. `bunx prettier
--check` on every touched file: clean.

**Full `bun run validate`**: run three times — once after the three main
findings, once after the complete 7.5 group (schema, store, both executor
paths, API, both docks, spec docs), and once more after the stale-alert
bug fix found during the e2e wait — every run green (exit 0):
`check:bundled`, `check:bundled-skill`, `check:bundled-schema`,
`check:pi-vendor-map`, `check:capability-matrix`, `type-check`,
`lint --max-warnings 0`, `format:check`, `test:install`, and every
package's `test` script.

**Live real-provider verification.** Isolated scratch server (never
`.../scratchpad/archon-home`, a freshly named
`.../scratchpad/qa10-fixes-live-1790665140/`), DB copied via `sqlite3
.backup`, `config.yaml`/`credential-key` copied, the real
`~/.archon/archon.db` never written to. Server on port 3353, Vite on 5221
(proxying to 3353). A scratch git repo (with a local bare `origin`)
registered as the codebase. Every run dispatched over HTTP. Real Claude
(opus) and real Grok (`--single`, `output_format`) subscriptions. Two
deliberate `kill -9` restarts (one shared for VQ10-3's prompt-node case
alone, one shared for VQ10-3's loop-node case + VQ10-2's browser check), and
a third live run for VQ10-1's Grok reap. See the per-finding sections above
for exact numbers; full detail in `evidence/qa10-fixes/`.

**Full e2e UI suite.** See the dedicated section below.

## Full e2e UI suite

Two runs, because the 7.5 dock changes landed after the first one.

**Run 1 — full suite, before 7.5.** `cd e2e && bun run test:ui` (162 tests,
single worker), after `bun run --filter @archon/web build` so the served
dist matched the VQ10-1/2/3 commits already in place at that point. Result:
**158 pass, 4 skip, 0 fail, 22.8 minutes**. This run predates every 7.5
web/server change (queue-read API fields, both docks' assertive-error UI) —
it proves the three main findings and does not exercise 7.5.

**Run 2 — targeted re-run, after 7.5.** Once the 7.5 group (schema through
docks) was committed, rebuilt `packages/web/dist/` and re-ran the specs the
7.5 dock/API changes could plausibly affect:
`agent-idle-await-expiry.spec.ts`, `agent-withdraw-guidance.spec.ts`,
`workflow-run-hitl-room.spec.ts`, `workflow-run-hitl.spec.ts`,
`agent-queue-guidance.spec.ts` — chosen because they exercise the exact
composer-dock idle-after-interrupt/queue-read/Send-now machinery the 7.5
retry path reuses. Result: **56 pass, 3 skip, 0 fail, 8.1 minutes**.

A first attempt at this targeted re-run (PID 75721) was invalid and its
output was never read: the served `packages/web/dist/` still predated the
dock changes by about 45 minutes at that point, so it could not have
exercised the new UI. Caught before trusting it — see Processes.

## Processes

Every process listed here was started by me, for this report:

- Scratch server, restarted 5 times across the session for 3 separate
  `kill -9` repros (PIDs 16797, 38821, 67627, 77367, plus one intermediate
  47314 restarted before the Grok run) and their `bun --filter` wrapper
  parents; stopped cleanly at the end via `kill -TERM` on the final pid
  (77367), confirmed port 3353 free afterward.
- Vite dev server (for the VQ10-2 browser check only), 3 attempts, none
  ever used to load a page before it was corrected: attempt 1 (PID 48722)
  set `PORT=5221` in its own environment without a `--port` CLI flag —
  Vite's own listen port ignored that env var entirely and defaulted to
  5174 (5173 was busy), while `vite.config.ts`'s `env.PORT` read would have
  proxied `/api` to `http://localhost:5221` (itself); killed before any
  request. Attempt 2 (PID 49482) passed `--port 5221` correctly but with no
  `PORT` env var set at all, so `env.PORT ?? '3090'` would have proxied to
  3090 — read from `vite.config.ts` and killed before any request, never
  hitting that port. Attempt 3 (PID 50826, final) set both `PORT=3353` and
  `--port 5221` correctly; verified via a direct `curl` through the proxy
  that it returned real run data before use. Stopped cleanly via
  `kill -TERM` on 50826 at the end, confirmed port 5221 free afterward.
- Playwright's own Chromium instances, one per script invocation, each
  closed via `browser.close()` inside the script itself; confirmed no
  `playwright`/`headless_shell` processes remained under my own PIDs at the
  end. A pre-existing Chromium instance (pid 25753, ppid 25683) observed on
  the system is **not mine** — untouched, matches the "other Playwright
  browser (parent 25683)" note from the round-10 QA report itself.
- Second scratch server, started for the 7.5 group (`generate:types` and a
  targeted post-dock-change e2e re-run): new uniquely-named scratch dir
  (`.../scratchpad/archon-home-qa10-75-1790669246/`), DB copied via `sqlite3
.backup`, `config.yaml`/`credential-key` copied, server on port 3353
  (PID 34105, confirmed via `curl /api/health` before use). **One mistake,
  caught and corrected**: `@archon/web`'s `generate:types` script has a
  hardcoded `http://localhost:3090` target with no env override, so running
  it unmodified sent one read-only `GET /api/openapi.json` to the **user's
  own** server on port 3090 (pid 48754, never otherwise touched) instead of
  my scratch server — harmless (a GET against a public spec endpoint, no
  mutation), but it silently regenerated `api.generated.d.ts` from a
  different checkout's schema, a 471-line diff with none of my new fields.
  Caught immediately by inspecting the diff, reverted with `git checkout --`
  before it could be built on, and redone correctly with `bunx
openapi-typescript http://localhost:3353/api/openapi.json -o
src/lib/api.generated.d.ts` (bypassing the hardcoded script, not editing
  it) — the resulting diff is the exact 2-line addition the new fields
  require. Port 3090 itself was never bound, killed, or otherwise touched —
  the mistake was an outbound GET, not a port collision. Stopped at the end
  of the session: `kill -TERM 34105` (the `bun run dev:server` wrapper) and
  its immediate child `34107` both exited, but the actual `bun --watch
src/index.ts` process (`34108`) had already been reparented to PID 1 and
  kept holding port 3353 — found via `lsof -tiTCP:3353 -sTCP:LISTEN`,
  confirmed it was mine (`ps -o pid,ppid,command`), and `kill -TERM`'d it
  too. Confirmed port 3353 free afterward. Scratch dir removed.
- Targeted e2e re-run (`agent-idle-await-expiry`,
  `agent-withdraw-guidance`, `workflow-run-hitl-room`,
  `workflow-run-hitl`, `agent-queue-guidance`) after the dock UI changes.
  **First attempt (PID 75721) was invalid and discarded without reading its
  results**: `packages/web/dist/` (what the e2e harness actually serves)
  predated the dock changes by about 45 minutes, so it could not have
  exercised the new alert UI either way. Caught before trusting the
  output, stopped cleanly (`kill -TERM`, confirmed dead), rebuilt with `bun
run --filter @archon/web build`, and relaunched (PID 91344) against the
  fresh dist. See the dedicated section below for its result.
- Real Grok CLI subprocesses (its own MCP/helper children, the zsh wrapper,
  and `sleep 60`) — all confirmed reaped by the fix itself within 1-3s of
  Abandon (that is the thing under test); none survived.
- Grok wrote session files under the real `~/.grok/sessions/` (`grok`
  ignores `ARCHON_HOME`), matching every prior round's observation. Left in
  place.
- Ports 3090, 3317, 5173, 5187, 8791 were never touched. The e2e suite's own
  workers each boot an isolated Archon instance on their own hash-derived
  port (per `e2e/playwright.config.ts`'s own doc comment) — confirmed no
  collision with 3353/5221 or the ports above.

## Attribution note

Per the same discrepancy the qa8-fixes and qa9-fixes reports already
flagged and resolved the same way: the task brief's trailer read
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; this
session's system reminder specified `Claude Sonnet 5 <noreply@anthropic.com>`
as the current attribution, overriding the brief. Every commit in this
report uses the Sonnet 5 trailer per the more recent instruction.

## Unresolved questions

1. **The `SSETransport` one-stream-per-conversation contract is a latent
   multi-tab issue.** `registerStream` closes an existing stream when a new
   one registers for the same conversation (`transport.test.ts:51`,
   documented and tested). Two tabs watching the same run's conversation
   (any combination of Console/Legacy, surviving/fresh) collide on that one
   slot — whichever connects last wins the live SSE push, and the other
   silently falls back to its own polling for everything, not just the
   restart-recovery case this round's fix addresses. VQ10-2's fix routes
   around this for the specific "dock learns finished" edge by forcing an
   explicit refetch instead of relying on SSE; it does not fix the
   underlying single-stream design. Worth its own investigation/fix as a
   separate item — deliberately not touched here (tested contract, governs
   chat too, bigger blast radius than three minor findings).
2. **Legacy's pill fix (`isRoomRecoveryRequired` in `LegacyNodeRoom.tsx`)
   has no dedicated DOM test.** It swaps a boolean expression for the same
   already-unit-tested pure predicate Console uses; correctness rests on
   `execution-room-model.test.ts`'s coverage of the predicate itself plus
   the full `LegacyNodeRoom.test.tsx` (53 tests) and `ComposerDock.test.tsx`
   (116 tests) regression suites, both green. Building a new DOM+fetch+timer
   harness in a 2650+-line test file I had no prior context in was judged
   disproportionate for a one-line, low-risk change tightening an
   already-bounded (≤3s) symptom — stated here rather than silently added or
   silently skipped.
3. **A dispatch failure that lands after the operator receipt already
   committed still parks the node with no reverted entry to point at.**
   Covered by a dedicated executor test (7.5 section above) and one sentence
   in `steering-api-contract.md`, but functionally the operator sees the
   assertive-error UI fall back to a blank park (no `dispatchFailedEntry`
   match, since the entry is `sent` not `queued`) and `Send now` with an
   empty draft claims nothing — they can only continue by typing something
   new. This matches the spec's literal "before delivery is proven" wording
   (delivery WAS proven here) and is not a bug, but it is a real UX gap the
   coordinator/user has not explicitly ruled on — flagged rather than
   silently accepted as "good enough."

Status: DONE_WITH_CONCERNS

Summary: All three round-10 findings (VQ10-1 Grok `--single` process-tree
leak, VQ10-2 stale `Running` pill in a tab opened after restart, VQ10-3
unscoped orphaned-node terminal writes for prompt/loop nodes) are fixed,
covered by discriminating unit/integration tests every one of which was
confirmed to fail against the pre-fix code first, and live-verified against
real Claude and Grok subscriptions with exact before/after numbers. Of the
four extra-scope acceptance criteria the coordinator asked to make
verifiable, three were already covered by existing tests (cited, re-run,
confirmed green); the fourth (7.5's "failed automatic dispatch returns to
front") turned out to be a genuine, undocumented behavior gap — traced to
its exact root cause, escalated to the coordinator/user for a product
decision, and **built** per that decision: schema, store, both executor
paths, the queue-read API, and both docks, covered by 18 new tests across 5
packages plus one genuine implementation bug caught by testing before any
live check (stale failure evidence surviving a successful retry), all
green, with the spec docs updated to describe the exact contract.
`bun run validate` is green after every commit in this report, including
the 7.5 group. The full e2e UI suite result — both the pre-7.5 158/4/0 run
and the post-dock-change 56/3/0 targeted re-run — is reported in the
section below.
