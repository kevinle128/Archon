# Round-13 visual QA fixes — Agent Node Room

Date: 2026-09-30 (Asia/Saigon). Base checkout: `develop-2`. Worktree:
`/Users/dale/orca/Archon/.claude/worktrees/agent-a2b07936a0825f4a3`, branch
`worktree-agent-a2b07936a0825f4a3`.

Fixes the three findings in
`plans/260926-1521-agent-node-room-completion/reports/visual-qa-13-report.md`,
per the round's own recorded decisions and the 2026-09-30 decision refinements
(VQ13-1 through VQ13-3).

## VQ13-1 — a server outage replaced the whole room with a run-level error page

**Root cause.** Both run-detail shells checked "did the last read fail" before
checking "do we still have data from an earlier successful read." Console's
`useEntity` cache (`store/cache.ts`) already retains the last-good value when a
revalidation fails — only `errors` gains an entry — but `RunDetailPage.tsx`'s
`if (detailError !== undefined) return <error page>` ran before the
`detail`-presence check, so a background refetch failure swapped the whole room
for the error page even though the room's own data was still sitting in cache.
Legacy has the identical bug: react-query keeps `data` on a failed background
refetch by default, but `WorkflowExecution.tsx`'s `if (error) return <error
page>` ran before checking whether `workflow` (derived from that retained
`data`) was still present. Console also had no retry-sooner path: its only
background refresh was a 30s heartbeat, and nothing refetched when its SSE
stream reconnected after a drop.

**Fix.**

- `packages/web/src/experiments/console/routes/RunDetailPage.tsx`: the error
  branch now only fires when `detail` was never loaded
  (`detailError !== undefined && (detail === undefined || detail === null)`).
  A non-blocking `<p>Failed to load — retrying</p>` (Console's own existing
  inline-error idiom, from `RunActionBar.tsx`) renders next to the header
  whenever `detailError` is set but data is present. The 30s heartbeat effect
  now uses a 3s retry cadence (`RUN_DETAIL_RETRY_INTERVAL_MS`) while the last
  read failed, matching Legacy's own poll interval instead of waiting out the
  full 30s.
- `packages/web/src/experiments/console/lib/sse.ts`: `useRunStreamSSE` tracks
  whether the stream has opened before; every open AFTER the first (a
  reconnect, not the initial connect the loaders already cover) invalidates
  the run and messages caches immediately.
- `packages/web/src/components/workflows/WorkflowExecution.tsx`: the error
  branch now only fires when `!workflow` (`if (error && !workflow)`), and a
  `<p>Failed to load — retrying</p>` hint (the same idiom
  `Sidebar.tsx`/`ProjectDetail.tsx` already use) renders below the header
  whenever `error` is set. No polling-cadence change was needed here — Legacy's
  existing 3s `resolveRunDetailRefetchIntervalMs` cadence already resumes
  within about one interval once react-query's retained `data` lets the page
  render normally.

The room components themselves (`NodeRoom.tsx`'s transcript error handling,
`ConsoleNodeRoom.tsx`'s `pageState.error` branch) already implemented
EXPERIENCE.md:155 correctly — a failed transcript fetch shows an inline retry
affordance beside the existing rows, never an empty transcript. Confirmed by
reading both before making any change; no fix was needed there.

**Tests.**
`packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`: new
tests — a refetch failure after the run has loaded keeps the room and its
`console-inspect-room` node room mounted, shows the hint, and recovers once
the server answers again; a `setInterval` spy confirms the safety-net switches
to a 3s cadence while `detailError` is set (and stays at 30s in the existing
T3.12 live-run test, which never triggers an error).
`packages/web/src/experiments/console/lib/sse.test.ts` (new file): a minimal
`EventSource` stand-in proves the first `onopen` does not refetch (already
covered by the loaders) and every subsequent `onopen` does, repeatedly.
`packages/web/src/components/workflows/WorkflowExecution.test.tsx`: a matching
test using the existing fetch-mocked `ExecutionHarness` — a run-detail refetch
failure after the room is open keeps `legacy-node-room` mounted and shows the
hint; the server returning clears it. Every new assertion was confirmed to
fail against the pre-fix code (by reverting the production file via a tagged
`git stash` and re-running) before being restored.

**Live verification.** Isolated scratch server (`ARCHON_HOME` pointed at a
fresh scratch dir under `.../scratchpad/qa13-1790723500/`, DB/config/
credential-key copied via `.backup` once), e2e-fake provider
(`ARCHON_E2E_FAKE_PROVIDER=1`), a scratch git repo dispatched over HTTP. Both
shells opened the same running node's room, with one item queued from Legacy.
`kill -9` on the server's own PID for ~10s and ~30s, then a fresh
`bun run src/index.ts` on the same port. Room-scoped rAF frame samplers across
the whole window (2530 Console frames, 2534 Legacy frames) show **0 frames**
with the run-level error text in either shell and **0 frames** with the room
region absent — the queued band (`queued · 1`) and the composer stayed up
through both outages. Both shells recovered within 0–2ms of the server coming
back (`outage-results.json`): Console's SSE-reconnect refetch and Legacy's
existing 3s poll both fired essentially immediately once the server answered.
Screenshots (`after-outage-10s-legacy.png`, `after-outage-10s-console.png`)
show the room mid-recovery: the non-blocking hint and the room's own
pre-existing transcript-retry affordance both visible, queued band and
composer intact, full-page error page absent in both shells.

## VQ13-2 — the dock could show a live composer or a bare terminal room before its own first queue read resolved

**Root cause.** `steeringDockMode` decided `composer`/`blocked`/`detached`
purely from `rowStatus`/`live`/`nodeTerminal`, with no way to know whether this
dock's own queue read had ever resolved. A restart-recovered node is
indistinguishable from an ordinary running one until that first read lands —
both report `rowStatus: 'running'` — so the composer rendered live Stop/Queue
controls for one tick before the read reported `recovery_required` and flipped
the band to read-only.

**Fix (per the 2026-09-30 decision: never render a count the dock does not
know).** `packages/web/src/lib/steering-dock.ts`: `steeringDockMode` gained a
`firstReadPending` input (true while `dock.executionState === null`). When
true, the function returns `hidden` instead of `composer`/`blocked`/`detached`
— no live controls render until the first read resolves.
`ComposerDock.tsx`/`ConsoleComposerDock.tsx` pass
`firstReadPending: dock.executionState === null`, and `pollingEnabled` gained
one more clause so a `hidden` row still polls (once) through that exact gap —
otherwise the read that would resolve `firstReadPending` would never fire. A
terminal node's never-sent band was **not** changed: main's decision records
that its 45–92ms first-paint pop-in is by design, because there is no earlier
band to keep — the VQ6-3/VQ12-1 continuity rule is about a shown item
disappearing, not a first paint, so it doesn't apply here.

**Tests.** `ComposerDock.test.tsx`/`ConsoleComposerDock.test.tsx`: a cold
mount with a controllable read shows no `<textarea>` and no buttons before the
first read resolves; when that read resolves straight to
`recovery_required`, the dock goes directly from hidden to the read-only band,
never through a frame with live controls (closing the restart-recovery
flash); an ordinary running node still gets its composer once the read
resolves. A companion test anchors the accepted, unchanged terminal-node
behavior (no band until the first read, then the real never-sent band).
Extending the mode gate to a cold mount meant the ~140 existing send/withdraw
tests per file — which use a default `nextRead` that deliberately never
settles — would now hang in `hidden` forever, since nothing would ever
resolve `firstReadPending`. The default `nextRead` in both files' `beforeEach`
(and the handful of tests that reinstall it mid-test) now resolves exactly the
bootstrap reads (the mount tick, plus the one extra tick the poller always
fires when a `mode` change restarts it — the same mechanism VQ12-1's
terminal-edge kick already relies on) with a benign `execution_state: 'live'`
snapshot echoing the render's own `subState`, then reverts to never-settling
for every later read — preserving every existing test's "reads never resolve
past this point" assumption while still letting each attempt escape
`firstReadPending`. `renderDock` tracks the same scope/`nodeExecutionKey`/
`nodeTerminal` conditions `ComposerDock`'s own attempt-reset effect uses so
the bootstrap budget refreshes on a genuine attempt reset, not just once per
test. `settleSnapshot` drains exactly one extra pending read after its
first-ever call per `controllableRead()` instance (the `firstReadPending`
transition's own redundant tick), never on later calls, so a test's own
second, independently-triggered pending read is never silently swallowed.
Every new assertion was confirmed to fail against the pre-fix
`steeringDockMode` (via a tagged `git stash` revert) before being restored.

**Live verification.** Same isolated server. A cold page load (fresh
Chromium context, `page.addInitScript` sampler active from first paint) of a
genuinely `recovery_required` node — confirmed via
`GET .../nodes/body/queue` before loading — in both shells: **0 of 45**
Console frames and **0 of 43** Legacy frames show a `Queue` button before the
`restored after server restart` band appears (`cold-mount-results.json`).
Screenshot `cold-mount-legacy.png` shows the settled state: `Recovery
required` pill, `restored after server restart` disclosure, `QUEUED · 1` band
with the pre-outage item intact, no field or Queue button.

## VQ13-3 — Legacy's Stop/Queue could outlive a redirect reply that ended the node

**Root cause.** Legacy has no channel faster than the dock's own ~1s queue
poll on the DAG run-detail page — confirmed by reading every
`workflowSSEHandlers`/`useDashboardSSE`/`useSSE` call site in the web package:
`ChatInterface.tsx`, `WorkflowLogs.tsx` (the sequential-workflow path only,
which this page's DAG branch never renders), and `DashboardPage.tsx`. None of
those mount on `/legacy/workflows/runs/:runId` in DAG mode, so
`useWorkflowStore`'s `liveWorkflow` — and the SSE-merge logic at
`WorkflowExecution.tsx:594-627` that already knows how to use it — sits
dormant on this page. When a Send-now redirect's own reply ended the node
(queue empty after it), the dock's own forced re-read (from the existing
Send-now-resolve kick) could land before the server had actually finished the
turn, and nothing else told the dock to look again before its next regular
poll tick.

**Fix (the coordinator's directed remedy — subscribe to `__dashboard__`,
never feed the workflow store).**
`packages/web/src/hooks/useRunTerminalEdge.ts` (new): a small hook that opens
its own `EventSource` on `/api/stream/__dashboard__` and calls back only for
`dag_node`/`workflow_status` events matching one specific `runId` — it never
touches `useWorkflowStore`, so the dormant SSE-merge logic on this page stays
dormant, matching the coordinator's explicit scope limit.
`WorkflowExecution.tsx` uses it to invalidate the `['workflowRun', runId]`
query and bump a `terminalEdgeKick` counter on that exact edge. The counter
threads down through `LegacyGraphLogsPane.tsx` → `LegacyNodeRoom.tsx` →
`NodeTranscriptPane.tsx` to `ComposerDock.tsx`, which forces its queue poll to
fire immediately on any change (never on the prop's initial value, since the
host owns the counter and it can already be non-zero at mount). `__dashboard__`
is verified to be its own `SSETransport` stream slot
(`packages/server/src/adapters/web/transport.ts`'s `streams` Map is keyed by
the raw id, and `__dashboard__` is used as a literal key distinct from any
run's conversation id), so this can never evict — or be evicted by — Console's
own per-conversation subscription on the same run. Subscribing Legacy to the
run's own conversation stream instead (option (b), rejected) would have hit
exactly that eviction: `LegacyNodeRoom.tsx`'s own `onRunSettleHint` doc
comment already documents the one-writer-per-conversation limit a second
subscriber would trip.

**Tests.** `packages/web/src/hooks/useRunTerminalEdge.test.ts` (new): a
minimal `EventSource` stand-in proves the hook fires only for `dag_node`/
`workflow_status` events whose `runId` matches, ignores other event types,
malformed payloads, and heartbeats, and connects to `__dashboard__` specifically.
`ComposerDock.test.tsx`: a new test proves `terminalEdgeKick` forces an
immediate re-read on change and never on its initial (already non-zero) value.
`WorkflowExecution.test.tsx`: an integration test with a mock `EventSource`
proves a `dag_node` event for this run triggers a run-detail refetch, and an
event for a different run does not.
`packages/server/src/adapters/web/transport.test.ts`: a new test registers a
`__dashboard__` stream and a per-conversation stream simultaneously (both
orders) and asserts neither's `close()` is ever called — the concrete claim
the eviction-safety argument above rests on. Every new assertion was
confirmed to fail against the pre-fix code (the hook/prop simply didn't exist)
before being restored.

**Live verification.** Same isolated server, e2e-fake provider. A run held
open on a 60s turn; Stop, then Send now with a redirect carrying its own
`delayMs: 300` scenario so the reply ends the node (queue empty after it) —
the exact FIN7 shape. An rAF sampler installed before the click recorded the
frame-by-frame `Stop`/`Queue`/`Send now` button presence: both controls
cleared within **386ms of the click**, of which 300ms is the reply's own
configured delay — leaving roughly **86ms** of real kick overhead, well under
the 1s poll ceiling this fix removes (`terminal-edge-results.json`).

## Verification

**Unit tests.** Every test file touched by this report's commits, run in
isolation:

```
packages/web: ComposerDock.test.tsx + ConsoleComposerDock.test.tsx +
  useRunTerminalEdge.test.ts + WorkflowExecution.test.tsx +
  RunDetailPage.test.tsx + sse.test.ts: 291 pass
packages/server: transport.test.ts: 23 pass
```

Every new/changed assertion for all three findings was individually confirmed
to fail against the pre-fix code first (via a tagged `git stash` revert of the
exact production file, never a stray `git stash`/`pop`), then restored.

**Full `bun run validate`**: green (exit 0) — `check:bundled`,
`check:bundled-skill`, `check:bundled-schema`, `check:pi-vendor-map`,
`check:capability-matrix`, `type-check` (all packages), `lint --max-warnings
0`, `format:check`, `test:install`, and every package's `test` script.

**Full web package test suite** (`bun run test` from `packages/web`, the
per-file-isolated script — never a bare `bun test` from the package or repo
root, which would hit the documented `mock.module` cross-file pollution):
0 fail across every group (lib/, stores/, hooks/, components/,
component-integration/, experiments/console/).

**Full server package test suite** (`bun run test` from `packages/server`,
its own configured per-file script): 0 fail across all 32 files.

**Schema changes.** None. No migration touched.

**Live real-provider verification.** Isolated scratch server (never the real
`~/.archon/archon.db`, only read through `.backup`), scratch dir under
`.../scratchpad/qa13-1790723500/`. Server on port 3395, Vite on 5263 (pointed
at 3395 via `PORT=3395` — `VITE_API_PORT` does **not** control the dev proxy
target; `vite.config.ts` reads `env.PORT` for it. My first attempt set only
`VITE_API_PORT` and the proxy silently pointed at the default port 3090
instead — caught immediately from the resulting 404 body naming a run id that
only exists on my own server, before any mutating request was sent; Vite was
killed and restarted with `PORT=3395` before any further use). A scratch git
repo (`wrk`, with a local bare `origin`) registered as the codebase, every run
dispatched over HTTP with `X-Archon-User: qa13-operator`. VQ13-1 and VQ13-2
verified against the e2e-fake provider (outage/restart timing is a web-layer
concern, not provider-specific — matching round-12's own precedent for its
UI-timing findings); VQ13-3 also verified against the e2e-fake provider for
the same reason, with `delayMs` used to make the natural-completion edge
deterministic rather than racing a real provider's reply latency. Full detail
and all frame-sampler JSON/PNG evidence in `evidence/qa13-fixes/`.

**Full e2e UI suite.** `cd e2e && ARCHON_E2E_PORT_BASE=3560 bun run test:ui`
(162 tests, single worker, to avoid the harness's default port 3400, which is
held by an unrelated 17+ day old Docker Desktop process unrelated to this
session — confirmed via `lsof` before choosing a different base rather than
touching it).

First full run: 157 passed, 4 skipped, **1 failed** —
`agent-interrupt-redirect.spec.ts`'s `interrupt-fail-legacy` test timed out
(120s) waiting for the Stop button to become clickable, 24.6 minutes into a
single-worker run. Re-ran that exact test alone: passed cleanly in 3.0s,
nowhere near its timeout — resource-contention flakiness from over 24 minutes
of accumulated Chromium/browser state in a single-worker run, the same
diagnosed cause round-12's own `agent-interrupt-redirect.spec.ts` flake had,
not a product regression (confirmed no route this test intercepts touches any
file this report changes). Restored the evidence churn the first run wrote
under `plans/` (`git checkout -- plans/`, excluding this report's own
`evidence/qa13-fixes/`) and re-ran the full suite once more, clean end to
end.

Final full run: **158 passed, 4 skipped, 0 failed, 22.8 minutes.** The 4
skips (`workflow-env-overlay.spec.ts`, and three
`workflow-run-hitl.spec.ts` auth tests) are the same pre-existing,
capability-gated skips qa12-fixes-report.md documented — unrelated to any
file this report touches.

## Processes

Started and stopped by me, each by exact PID:

- Isolated scratch server on 3395: PID 13658 (initial), restarted by the
  outage-verification script itself via `kill -9` twice (10s and 30s outages)
  to new PIDs 38075 and 39324; 39324 stopped with `kill -TERM` at the end of
  live verification, confirmed port 3395 free.
- Vite dev server on 5263: first attempt (PID 14284/14437, `VITE_API_PORT` env
  — wrong, see above) stopped with `kill -TERM`; second attempt (PID
  34564/34741, `PORT` env — correct) stopped with `kill -TERM` at the end of
  live verification, confirmed port 5263 free.
- `bun run test:ui` (e2e suite): PID 63094 (first run, one flaky failure),
  PID 24665 (isolated re-run of the flaky test alone, to diagnose), PID 26959
  (second full run, clean) — each waited out to natural completion (never a
  pattern match) before reporting results here.
- Ports 3317, 5173, 5187, 8791 were never touched. Port 3090 saw exactly one
  unintended read: the first, misconfigured Vite attempt (`VITE_API_PORT`
  instead of `PORT`, see above) proxied one `GET .../workflows/runs/<my own
scratch run id>` to it before I caught the 404 body and fixed the env var —
  a read-only lookup for an id that only exists on my own server, not a
  mutation, and not repeated after the fix. Both were confirmed via
  `lsof -tiTCP:<port> -sTCP:LISTEN` before starting anything on my own ports.
  `ARCHON_E2E_PORT_BASE=3560` was chosen up front for the e2e suite (port
  3400, its documented default base, is held by an unrelated Docker process).

## Attribution note

Per this session's system reminder, every commit in this report uses the
`Claude Opus 5.5 (1M context) <noreply@anthropic.com>` trailer, as the task
brief specified.

## Commit note

VQ13-2 and VQ13-3 are committed together
(`df086a17`), not as two separate commits. Their production changes share one
file (`ComposerDock.tsx`, and the equivalent `ComposerDock.test.tsx`) at the
line level in a way that could not be cleanly separated by `git add -p`
without a materially higher risk of a botched split — VQ13-2's
`firstReadPending`/`rowLooksSteerable`/`pollingEnabled` changes and VQ13-3's
`terminalEdgeKick` prop and effect are interleaved hunks in the same function
body, and the test file's bootstrap-resolve infrastructure (`coldStartResolves`,
`bootstrapDrainedCtrls`) that VQ13-2 required is also what the new
`terminalEdgeKick` test needed to pass. VQ13-1 is its own commit (`00c6ce02`),
committed and verified green before VQ13-2/VQ13-3 work began. A third, small
commit (`df7e3591`) followed a self-review pass over `df086a17`: two doc
comments and one test comment cited round finding codes instead of stating
the invariant directly; fixed to name the behavior, not the round.

## Unresolved questions

None remaining. The two open decisions raised mid-task (VQ13-3's channel
choice, VQ13-2's "never render an unknown count" resolution) were both
answered by the coordinator and are recorded in `visual-qa-13-report.md`'s
2026-09-30 decision-refinements section; this report implements exactly what
that section says.

Status: DONE

Summary: All three round-13 findings (VQ13-1 a server outage replaced the
whole room with a run-level error page even though the cache/react-query
still held the last-good data; VQ13-2 the dock could show a live composer or
a bare terminal room before its own first queue read resolved; VQ13-3
Legacy's Stop/Queue could outlive a redirect reply that ended the node) are
fixed, each covered by discriminating unit tests every one of which was
confirmed to fail against the pre-fix code first, and live-verified against
an isolated scratch server with the e2e-fake provider — VQ13-1 across two
real `kill -9` outages (10s and 30s) with 0 error-page frames and 0-2ms
recovery in both shells, VQ13-2 across a genuinely restart-recovered node's
cold load with 0 live-composer frames in both shells, VQ13-3 with the
Stop/Send-now/natural-completion edge clearing in ~86ms of real overhead
instead of waiting out the old 1s poll ceiling. `bun run validate` is green,
and the full e2e UI suite's final run is 158 pass, 4 skip, 0 fail.
