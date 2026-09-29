# Round-11 visual QA fixes — Agent Node Room

Date: 2026-09-29 (Asia/Saigon). Base checkout: `develop-2`. Worktree:
`/Users/dale/orca/Archon/.claude/worktrees/agent-a2c81374f072edbde`, branch
`worktree-agent-a2c81374f072edbde`.

Fixes the three findings in
`plans/260926-1521-agent-node-room-completion/reports/visual-qa-11-report.md`
(VQ11-1 minor, VQ11-2 minor, VQ11-3 cosmetic), per the round's own recorded
decisions.

## VQ11-1 — a finished node flashed `Recovery required` and kept a live dock, Legacy shell (minor)

**Root cause.** `isRoomRecoveryRequired` (added by an unrelated same-day
commit, `154b0375`) treated a dock read of `finished` the same as
`recovery_required` for as long as the row/run status it feeds still read
non-terminal — a deliberate bridge meant only for a restart-recovered node's
gap between its dock's own fast queue poll and the run entity's slower
refetch. In practice the bridge fired on **every** ordinary completion or
live Abandon, not only a restart-recovered node: a node's dock read moves to
`finished` (from `live`/`recovery_required`) routinely before the room's own
`status` prop (fed by a slower poll/SSE) catches up to a terminal value, and
during that ordinary gap the pill incorrectly claimed the server had reported
`recovery_required`, which it never did. `steeringDockMode` had a matching
gap on the composer side: a node already proven terminal (via
`nodeTerminal`, which folds in this same dock-own `finished` read) with
nothing undelivered to show fell through to the ordinary row-status table
instead of hiding, so the live field and `Queue` button stayed up for the
same window.

**Fix.** `packages/web/src/lib/execution-room-model.ts`: removed
`isRoomRecoveryRequired` entirely. Both node rooms now read the literal
server-reported signal only — `recoveryRequired={dockExecutionState ===
'recovery_required'}` — matching what the composer dock's own internal
`steeringDockMode` call already did on the `recoveryRequired` parameter (that
call was never the buggy one; only the two room headers were).
`packages/web/src/lib/steering-dock.ts`: `steeringDockMode` gained one new
branch — a node already proven terminal (`nodeTerminal === true`, folding in
this dock's own `finished` read) with nothing undelivered hides outright,
checked after the finished-iteration branch (so a completed occurrence on a
still-live loop still reads as history, not as the node itself being done)
and before the ordinary row-status table.

Preserving the _reason_ `154b0375` existed — closing the gap fast, not
inferring recovery from it — Legacy gained the same forced run-entity
refetch Console already had on the dock's `finished` edge
(`shouldRefetchRunOnDockFinished`, unchanged). `LegacyNodeRoom.tsx` threads
this through a new `onRunSettleHint` callback instead of reaching into
`useQueryClient()` directly — `LegacyNodeRoom` is rendered standalone (via
`renderToStaticMarkup`, no `QueryClientProvider`) by a dozen existing tests
for its non-agent room kinds, so a direct react-query dependency there would
have broken every one of them. The callback is threaded
`WorkflowExecution.tsx` (owns the `queryClient`, mirrors the existing
`invalidateAskQueries` pattern) → `LegacyGraphLogsPane.tsx` → `LegacyNodeRoom.tsx`.

**Tests.** `packages/web/src/lib/steering-dock.test.ts`: rewrote the one
existing assertion that encoded the bug (`nodeTerminal: true` + empty
`neverSent` expected `'composer'`/`'blocked'`/`'detached'`) to expect
`'hidden'` in every case, plus the finished-iteration-still-wins and
nonempty-neverSent-still-`'finished'` cases unchanged. `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`:
rewrote the one test that asserted the old (buggy) `Recovery required` text
to assert the opposite — no `Recovery required`, no live composer, and the
pill settles to the durable terminal outcome once the forced refetch lands;
added a companion test proving the pill still claims recovery for the
literal `recovery_required` signal. Two existing "pass-through pins" tests
that queried a `<textarea>` (now correctly absent once the dock hides) were
repointed at the room's own wrapper region, which renders regardless of dock
mode. `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`:
extended `renderRoom` to support the real `NodeRoomHeader`
(`headerModel`/`onSelectRow`/`onClose`) and added two new tests mirroring
Console's — no false recovery claim plus an `onRunSettleHint` call on the
dock-finished edge, and the literal-signal-only pill. The same
textarea-scoping fix applied to its two existing pass-through tests. Every
new/changed assertion was confirmed to fail against the pre-fix code (the
un-reverted `isRoomRecoveryRequired`/pre-fix `steeringDockMode`) before being
restored.

Investigated and ruled out a loop-iteration false positive: `execution_state:
'finished'` cannot fire mid-loop between iterations, because one steering
handle is registered once before the per-iteration loop starts
(`dag-executor.ts:6505`/loop's `for` loop starting at `:6552`) and stays open
across every iteration until the whole loop node's own `finally` closes it
(`:6199-6203`) — `handleClosed` is never true between iterations.

**Live verification.** Isolated scratch server, real Claude subscription
(haiku), `qa11-real-claude`/`qa11-real-claude-slow` workflows. Scenario A
(natural completion, Legacy watching only): opened Legacy before the ~8s node
finished, polled the full page text every ~150ms — `Recovery required` never
appeared across 61 samples, the pill reached `Completed`, and no
textarea/Queue button remained afterward. Scenario B (Abandon mid-run, Legacy
AND Console both watching): confirmed the Stop button (proving the node was
actually running) before POSTing `/abandon` — neither shell ever showed
`Recovery required`, and both reached a terminal pill (Console on its very
first poll). Evidence: `evidence/qa11-fixes/vq11-1-live-verification.txt`.

## VQ11-2 — an observing shell painted a false `Never sent` for one frame (minor)

**Root cause.** Both docks' `finishedEntries` (the never-sent band's source
list) unconditionally folded in `dock.sent` — this tab's own locally-tracked
pending queue — alongside the server's durable `dock.neverSent` rows. That
local snapshot can be one poll stale relative to what a **different** tab
just did to the same row: another shell's Send now can claim and deliver an
item in the same instant the node finishes, and the faster external signals
that open the band (`nodeTerminal` prop, `!live`) can land before this dock's
own next queue read has caught up. In that gap, `dock.sent` still called the
row `queued` even though the server already delivered it, painting a false
`Never sent` for exactly one render. A second, independent bug compounded
it: the render block that lists the band's rows mapped `dock.sent` directly
(not through `finishedEntries`), so even gating `finishedEntries` alone would
not have stopped the wrong row from being rendered once the band opened for
any other, legitimate reason.

**Fix.** `packages/web/src/lib/steering-dock.ts`: `isPossiblyNeverSent`
stays (still correctly excludes in-flight states); its doc comment now
states the precondition callers must apply. Both dock components
(`packages/web/src/components/workflows/ComposerDock.tsx`,
`packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`)
now gate the local queue on `dock.executionState === 'finished'` — the one
signal that is _this dock's own_ queue read, not a faster external prop —
before trusting `dock.sent` at all: a single server response saying both
"this node is done" and "this row is still queued" in the same breath has
exactly one possible outcome, so it is trustworthy; a `nodeTerminal`/`!live`
read from a different, faster channel is not. The gated list
(`trustedPendingReceipts`) is now the _single_ source both the band's
header/count **and** the rendered `<li>` rows read, so they can never
disagree with each other — the second bug above is fixed by construction,
not by a second, parallel gate.

**Tests.** `packages/web/src/lib/steering-dock.test.ts`: `isPossiblyNeverSent`
coverage retained. `ComposerDock.test.tsx`/`ConsoleComposerDock.test.tsx`
(both shells): added a new test simulating the exact race — a fresh queue
read shows the item `queued` (dock mounts live), then the external
`nodeTerminal`/`rowStatus` props flip to terminal on a re-render with **no**
new queue snapshot (this dock's own poll has not caught up yet) — asserts no
`Never sent` band renders in that gap; then the dock's own terminal one-shot
fetch resolves reporting the item was actually `delivered` — asserts the
band still never renders. Fixing the gate surfaced three **pre-existing**
tests that encoded the old (buggy) contract as passing assertions — a
`delivery_unknown`-row test that relied on the ungated `dock.sent` render to
show a row the gate now correctly excludes at `execution_state: 'live'`
(fixed by adding `execution_state: 'finished'` to that fixture, which is what
the real server would report once the run/node is genuinely done); a
withdraw test whose second `settleSnapshot` call resolved the wrong one of
two pending reads (the withdraw's own now-discarded corrective re-read, queued
before the terminal one-shot fetch) — fixed by draining the stale read first;
and a cancelled-run test relying on the ungated `dock.sent` to show a
still-`queued` item as read-only before the server's own reconciliation
landed — fixed by setting `execution_state: 'finished'` on its snapshot,
matching what `api.ts`'s `isFinished` computation actually reports the
instant `run.status` itself is terminal, regardless of whether that specific
row's own reconciliation write has landed yet. Every new/changed assertion
was confirmed to fail against the pre-fix code before being restored.

**Live verification.** Same isolated scratch server, restarted with
`ARCHON_E2E_FAKE_PROVIDER=1`. Dispatched `qa11-fake-steer` (interruptible
e2e-fake node), opened Console (sender) and Legacy (observer) on the same
run. Console clicked Stop, typed plain text (no `<<E2E_SCENARIO>>`
directive, so the redirect turn completes immediately) and clicked Send now.
Legacy was polled for the full page text every ~44ms from the instant
Console's Send now click fired through 8s after — `NEVER SENT`/`none of this
was sent` never appeared once across 180 samples, and Legacy's final state
correctly read `Completed`. Evidence: `evidence/qa11-fixes/vq11-2-3-live-verification.txt`.

## VQ11-3 — the dispatch-failure alert always read "automatic", even after a manual retry failed (cosmetic)

**Root cause.** `revertSteeringQueueClaim` recorded `last_error` and
incremented `dispatch_failure_count` on every retryable dispatch failure, but
never recorded **which kind** of attempt (the executor's own automatic
wake-and-claim, or an operator-triggered Send now) claimed the entry before
failing. `dispatchFailureDisclosure` therefore always rendered "automatic
dispatch failed", even for a manual retry's own second failure.

**Fix — additive schema (both dialects).**
`remote_agent_steering_queue_entries` gains `last_failure_kind VARCHAR(16)`
(Postgres, nullable, no `DEFAULT` needed) / `last_failure_kind TEXT`
(SQLite) — added to both `CREATE TABLE` bodies for a fresh install and a
trailing `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for an existing database,
mirroring the exact pattern `dispatch_failure_count` itself already
established on this same table. `COMMENT ON COLUMN` added in the trailing
indexes/comments section. `bun run generate:bundled-schema` regenerated;
SQLite mirror (`createSchema()` + `migrateColumns()`) updated by hand
alongside it.

**Store.** `revertSteeringQueueClaim(workflowRunId, nodeId, messageIds,
failureMessage, failureKind)` — new required
`failureKind: 'automatic' | 'send_now'` parameter, written alongside
`last_error`/`dispatch_failure_count` in the same `UPDATE`.

**Executor.** Both the direct-node stream-pass loop and the loop-node
iteration loop (`packages/workflows/src/dag-executor.ts`) already branch on
exactly which wake produced the guidance turn that is about to be retried
(`wake.kind === 'send_now'` for an operator retry vs. the natural
auto-drain claim after a turn's own boundary) — a new per-turn
`turnGuidanceKind` variable, set at each of those three existing branch
points (both `send_now` sites, the one auto-drain site) in each of the two
executor functions, is now threaded into the `revertSteeringQueueClaim` call
so the durable record reflects the real attempt, not an assumed one.

**API + wire types.** `GET .../nodes/:nodeId/queue` now carries
`last_failure_kind` on every row (`queuedGuidanceMessageSchema`,
`api.ts`'s response mapping). `packages/web/src/lib/steering-dock.ts`:
`LocalSentReceipt`/`QueuedGuidanceRow` gained the field;
`dispatchFailureDisclosure(lastError, lastFailureKind)` now names the actual
attempt ("automatic dispatch" or "Send now"), falling back to "automatic"
only for `null` (pre-existing data from before this field existed — the only
kind that could have failed before Send now retry was itself trackable).

**Tests.** `packages/core/src/db/workflow-steering.test.ts`: every
`revertSteeringQueueClaim` test now passes and asserts `failureKind`,
including the idempotency test (a same-state no-op must not flip
`last_failure_kind` either) and the repeated-cycle test (the durable field
reflects the _latest_ attempt). `packages/workflows/src/dag-executor.test.ts`:
extended the two existing dispatch-failure tests (auto-drain-then-park, and
repeated-failure-after-a-Send-now-retry) with `last_failure_kind` assertions
proving the executor-level plumbing end to end (`automatic` for the first,
`send_now` for the retry). `packages/server/src/routes/api.workflow-runs.test.ts`:
the mock steering store's `revertSteeringQueueClaim` now records
`failureKind`; the "exposes failure evidence" test extended to assert
`last_failure_kind: 'automatic'`; several pre-existing exact-equality
response-shape assertions updated for the new field, not weakened.
`packages/web/src/lib/steering-dock.test.ts`: `dispatchFailureDisclosure`
test extended to cover all three inputs (`'automatic'`, `'send_now'`,
`null`). `ComposerDock.test.tsx`/`ConsoleComposerDock.test.tsx` (both
shells): new test asserting a `last_failure_kind: 'send_now'` snapshot
renders "Send now failed …", not "automatic dispatch failed …". Every
new/changed assertion was confirmed to fail against the pre-fix code before
being restored.

**Schema-upgrade verification.** `bun run check:schema-upgrades` (real
PostgreSQL, `PGHOST=127.0.0.1 PGPORT=55432 PGUSER=pgcheck
PGPASSWORD=pgcheck`): fresh install OK (94 indexes), every prior release
baseline (v0.2.13 through v0.9.0, 8 distinct schema versions across 22 tags)
upgrades and converges idempotently, with only the pre-existing, expected
`remote_agent_codebases_kind_check` divergence.

**Live verification.** Same fake-provider scratch server. Dispatched
`qa11-fake-steer-fast` (a 4s tool window so the first turn ends **naturally**
— auto-send only claims after a natural boundary, never an operator-driven
interrupt, per the auto-send route's own documented contract). Enabled
auto-send via `PUT .../auto-send`, queued a malformed
`<<E2E_USAGE>>malformed, never closes` message before the first turn ended.
Auto-send claimed it on the natural boundary; the fake provider's directive
parser threw; the dock's one assertive alert read exactly `automatic
dispatch failed · e2e-fake: found <<E2E_USAGE>> without a closing
<</E2E_USAGE>> in the usage directive · Send now to retry`. Clicked Send now
to manually retry (re-claims the same malformed entry, fails again); the
alert updated to `Send now failed · e2e-fake: found <<E2E_USAGE>> without a
closing <</E2E_USAGE>> in the usage directive · Send now to retry` — the
copy correctly named the manual attempt instead of repeating "automatic".
Evidence: `evidence/qa11-fixes/vq11-2-3-live-verification.txt`.

No spec doc hard-codes the old "automatic dispatch failed" literal text —
`control-states.md`'s own description ("The dock renders that evidence as
one assertive error on the item, offering `Send now`") already describes the
invariant without naming a fixed string, so no doc update was needed beyond
this report and the code's own comments.

## Verification

**Unit tests.** Every test file touched by this report's commits, run in
isolation:

```
packages/web: steering-dock.test.ts 175 pass, execution-room-model.test.ts 151 pass,
  ComposerDock.test.tsx 118 pass, ConsoleComposerDock.test.tsx 113 pass,
  ConsoleNodeRoom.test.tsx 140 pass, LegacyNodeRoom.test.tsx 55 pass,
  LegacyGraphLogsPane.test.tsx 46 pass, WorkflowExecution.test.tsx 20 pass
packages/core: workflow-steering.test.ts 31 pass
packages/workflows: dag-executor.test.ts 713 pass, subrun.test.ts 69 pass
packages/server: api.workflow-runs.test.ts 336 pass, 9 todo
```

Every regression test added or changed for all three findings was
individually confirmed to **fail** against the pre-fix code first
(temporarily reverting the specific new logic, or running the original
fixture against the new code), then restored — not just written to pass
against the new code.

Full package suites, each package's own `bun run test`: `@archon/web` 1166 +
707 + 53 pass across its three legs, `0 fail`. `@archon/core`,
`@archon/workflows`, `@archon/server` each `0 fail` (run individually and in
the full `bun run validate`).

`bun --filter '*' type-check`: clean across all 13 packages.
`bun x eslint . --max-warnings 0`: clean. `bunx prettier --check .`: clean.

**Full `bun run validate`**: run after each of the three commits, every run
green (exit 0): `check:bundled`, `check:bundled-skill`,
`check:bundled-schema`, `check:pi-vendor-map`, `check:capability-matrix`,
`type-check`, `lint --max-warnings 0`, `format:check`, `test:install`, and
every package's `test` script.

**Schema-upgrade verification** (VQ11-3 only, additive column): see the
dedicated subsection above — green against a live PostgreSQL instance across
every prior release baseline.

**Live real-provider verification.** Isolated scratch server (never
`.../scratchpad/archon-home`, a freshly named
`.../scratchpad/qa11-fixes-1790682702/`), DB copied via `sqlite3 .backup`,
`config.yaml`/`credential-key` copied, the real `~/.archon/archon.db` never
written to. Server on port 3355, Vite on 5223 (proxying to 3355). A scratch
git repo (with a local bare `origin`) registered as the codebase, restarted
once (with `ARCHON_E2E_FAKE_PROVIDER=1`) between the VQ11-1 real-Claude pass
and the VQ11-2/VQ11-3 fake-provider pass. Every run dispatched over HTTP. See
the per-finding sections above for exact numbers; full detail in
`evidence/qa11-fixes/`.

**Full e2e UI suite.** See the dedicated section below.

## Full e2e UI suite

`cd e2e && bun run test:ui` (162 tests, single worker), after `bun run
--filter @archon/web build` so the served dist matched every commit in this
report.

Result: **158 pass, 4 skip, 0 fail, 22.8 minutes** — identical to the
pre-existing baseline (the qa10-fixes report's own full run recorded the
same 158/4/0/22.8m). `agent-queue-guidance.spec.ts`,
`agent-steering-cross-shell-recovery.spec.ts`, `agent-never-sent.spec.ts`,
`agent-interrupt-redirect.spec.ts`, `agent-idle-await-expiry.spec.ts`, and
`agent-withdraw-guidance.spec.ts` — the specs whose composer-dock/queue-read
machinery this report's three fixes touch most directly — all passed on both
shells. Full log: `evidence/qa11-fixes/e2e-full-run.txt`.

## Processes

Every process listed here was started by me, for this report:

- Scratch server, started twice (real-Claude pass, then restarted with
  `ARCHON_E2E_FAKE_PROVIDER=1` for the fake-provider pass): PIDs
  78386/78390 (first), 58752/58754 (second). Both stopped cleanly via
  `kill -TERM` on the exact PIDs recorded at start; confirmed port 3355 free
  after each stop, before the next start.
- Vite dev server, one instance: PID 19958 (`PORT=3355 vite --port 5223
--strictPort`), verified up via `curl http://localhost:5223/` returning
  200 before use. Stopped cleanly via `kill -TERM`, confirmed port 5223 free
  afterward.
- Playwright's own Chromium instances, one per standalone verification
  script invocation, each closed via `browser.close()` inside the script
  itself.
- Ports 3090, 3317, 5173, 5187, 8791 were never touched. Resolved my own
  ports (3355/5223) via `lsof -tiTCP:<port> -sTCP:LISTEN` before each start,
  never incrementing to a new port on conflict.

## Attribution note

This session's system reminder specifies
`Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (matching the task
brief's own trailer); every commit in this report uses that trailer.

## Unresolved questions

1. **VQ11-2's fix relies on this dock's own next queue poll (or its
   terminal one-shot fetch) to correct a stale local row — there is a brief
   window where the band is empty instead of showing the correct content,
   not merely wrong-then-right.** This is the intended, decided trade-off
   ("never show a wrong answer" over "never show nothing" — matches the
   round's own decision text), and the live verification confirms the final
   state always settles correctly; flagged for visibility, not as an open
   defect.
2. **Loop-node VQ11-3 coverage is code-reviewed, not test-covered.** The
   prompt-node executor path has two dedicated dag-executor tests exercising
   `turnGuidanceKind` end to end; the loop-node executor path received the
   identical three-site edit (mirrored line-for-line) but has no dedicated
   loop-node dispatch-failure test of its own — the QA report's own evidence
   table for Story 7.5 covered both node kinds live (F75/F75L), and this
   report's own live verification used a prompt node only. Judged acceptable
   given the mirrored code is identical in shape to the tested prompt-node
   path and the shared `revertSteeringQueueClaim`/schema layer is fully
   covered independent of which executor calls it — stated here rather than
   silently skipped.

Status: DONE

Summary: All three round-11 findings (VQ11-1 false `Recovery required`
flash + lingering live dock on a finished node in Legacy, VQ11-2 a
one-frame false `Never sent` on an observing shell, VQ11-3 the
dispatch-failure alert always claiming "automatic") are fixed, each covered
by discriminating unit/integration tests every one of which was confirmed to
fail against the pre-fix code first, and live-verified end to end — VQ11-1
against a real Claude subscription (natural completion and a live Abandon,
both shells), VQ11-2 and VQ11-3 against the e2e-fake provider (a two-shell
immediate-completion race, and an automatic-then-manual dispatch-failure
retry). VQ11-3's additive schema change is verified with
`check:schema-upgrades` against a live PostgreSQL instance across every
prior release baseline. `bun run validate` is green after every commit in
this report. The full e2e UI suite result is reported in the section above.
