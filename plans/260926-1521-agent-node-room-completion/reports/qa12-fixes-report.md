# Round-12 visual QA fixes — Agent Node Room

Date: 2026-09-30 (Asia/Saigon). Base checkout: `develop-2`. Worktree:
`/Users/dale/orca/Archon/.claude/worktrees/agent-a359024bb00e0a88f`, branch
`worktree-agent-a359024bb00e0a88f`.

Fixes the four findings in
`plans/260926-1521-agent-node-room-completion/reports/visual-qa-12-report.md`,
per the round's own recorded decisions (VQ12-1 through VQ12-4 — the empty-window
trade-off was explicitly rejected for VQ12-1; none of the other findings offered
an alternative trade-off).

## VQ12-1 — the queued band could show a gap or a false relabel through the abandon window

**Root cause.** The dock's own mode computation only asked "is this node
terminal" and "is there anything queued" — it had no state for "terminal, but
this dock's own queue read has not yet reconciled." When a faster external
signal (`nodeTerminal`, `!live`) fired before this dock's own next queue poll
landed, the band either disappeared for a frame or, worse, could relabel the
item before the server had actually confirmed its fate.

**Fix.** `packages/web/src/lib/steering-dock.ts`: added a `'settling'`
`SteeringDockMode` — reached when the node is terminal (or no longer live)
but this dock has a visible pending item **and** its own `executionState`
has not yet reported `'finished'`. Added `SteeringNodeOutcome = 'completed' |
'failed' | 'skipped'` and a `nodeOutcome` field on `SteeringDockState`, fed by
a new `node_outcome` field on the queue snapshot. `ComposerDock.tsx` /
`ConsoleComposerDock.tsx`: compute `pendingSettlement` before the mode call
so `'settling'` renders the **exact same band markup** the item already had
(queued or sending), keeping it visible unchanged; only once this dock's own
`finished` read lands does the band relabel to `Never sent` or close. This is
the literal "keeps the last rendered band unchanged, forces an immediate
queue read, does not relabel until reconciled" behavior from the decision
text — implemented as a mode, not a special-cased render branch, so it composes
with the existing `pollingEnabled` gate for free.

**Tests.** `packages/web/src/lib/steering-dock.test.ts`: `mkSnapshot` gained
`node_outcome`; `applyQueueSnapshot` defensively normalizes an absent field to
`null` so older fixtures keep passing. `ComposerDock.test.tsx` /
`ConsoleComposerDock.test.tsx` (both shells): new test simulating the exact
race — a queued item visible, then the external terminal signal fires with no
new queue snapshot yet — asserts the band stays visible with its prior label,
never blank, never falsely relabeled, until the dock's own terminal read
resolves. Confirmed to fail against the pre-fix code before being restored.

**Live verification (real Claude, corrected after an initial harness bug —
see below).** 3 cycles, `qa12-real-claude-slow` workflow (Claude/haiku, one
`sleep 25 && echo done` Bash call), both shells watching the same run, one
item queued from Console, then `POST /abandon` fired externally while the
Bash tool was still in flight. Room-scoped rAF frame sampler + a capture of
every queue-endpoint response body during the window. Result across all 3
cycles, both shells: the band stays `queued · 1` (or, for Legacy cycle 1,
still `queued · 1` for one extra ~5.7ms frame after the pill itself already
flipped to `Failed` from run-detail/SSE — the dock's own queue read had not
yet reconciled) and then relabels to `never sent · 1` in the next sampled
frame, once the dock's own read (`node_outcome: "failed"`) lands. No sampled
frame in any cycle, either shell, shows the item missing. Evidence:
`evidence/qa12-fixes/phase-a-live-abandon.json`.

**Harness bug found and fixed during this verification, not a product
defect.** The first two live-verification passes used a frame sampler whose
`pill()` selector queried `document.querySelector('header, [role="region"]…
header')` — a comma-joined selector that returns the first DOM-order match
across _either_ pattern, not "this room's own header first." It matched a
different header than the one under test, so every sampled `pillText` came
back `null` on the first pass, and — before that was diagnosed — a second
pass wrongly appeared to reproduce a violation of VQ12-2 for the `Cancelled`
outcome specifically. Root-caused via `advisor`, which correctly identified
the sampler as the suspect rather than the fix: the room's own `<header>`
(carrying the pill) is a **sibling** rendered just before the `role="region"`
element in both shells, not a descendant of it — confirmed by reading
`LegacyNodeRoom.tsx`/`NodeRoom.tsx` and `ConsoleNodeRoom.tsx` directly. Fixed
by scoping every sampler query (pill, band, buttons, scroller) to the exact
room's region (matched by aria-label, not a generic tag) and its immediate
parent for the header. Re-run with the corrected sampler produced the clean,
self-consistent trace described above and in the VQ12-2 section below. The
verification script (`e2e/qa12-verify.ts`) was a temporary tool, not a
deliverable, and was deleted before finishing.

## VQ12-2 — the pill could still show `Running` for a frame after the node was already known terminal

**Root cause.** The room header's status pill (`NodeRoomHeader.tsx` /
`ConsoleRoomHeader.tsx`) read only `model.status`, fed by the run-detail/SSE
poll. The dock's own queue read could already know the node was terminal
(and had already relabeled its own band) one or more frames before that
slower, independent channel caught up.

**Fix.** `packages/server/src/routes/api.ts`: the node-queue route
(`GET .../nodes/:nodeId/queue`) now computes and returns `node_outcome` —
the node's settled status (`'completed' | 'failed' | 'skipped'`, via the
existing `projectApiWorkflowNodeStates` + `settleApiWorkflowNodeStatesForRunStatus`
pipeline) whenever `isFinished` is true, `null` otherwise.
`packages/server/src/routes/schemas/workflow.schemas.ts`: additive field on
`readWorkflowNodeQueueResponseSchema` (Zod/OpenAPI wire schema only — no
database migration). `packages/web/src/lib/execution-room-model.ts`: new
`effectiveNodeRoomStatus(status, terminalOutcome)` — returns the dock's own
outcome instead of the room's still-stale status, but only when the room
status is not already one of the terminal pill statuses (never overrides a
literal server value with an inferred one). `ComposerDock.tsx` /
`ConsoleComposerDock.tsx`: the existing `onExecutionStateChange` effect moved
from `useEffect` to `useLayoutEffect` (synchronous, before paint), and a new
`onNodeOutcomeChange` callback (also `useLayoutEffect`) lifts `dock.nodeOutcome`
to the parent room in the same commit the dock itself re-renders in.
`NodeRoomHeader.tsx` / `ConsoleRoomHeader.tsx`: compute
`effectiveNodeRoomStatus(model.status, terminalOutcome)` and use it for both
the pill and the header meta line. `NodeTranscriptPane.tsx` /
`ConsoleNodeRoom.tsx` / `LegacyNodeRoom.tsx`: thread `dockNodeOutcome` state
between the dock and the header.

**Scope note, checked and not a gap.** `node_outcome` only covers
`completed`/`failed`/`skipped` — a run-level `cancelled` outcome folds to the
node status `failed` in the same settle step every other terminal status
already uses (`terminalApiNodeStatus`), so `Failed` is what an abandoned run's
pill (and dock band) both resolve to from this same read; the distinct
`Cancelled` room-level label is a separate, pre-existing concept
(`isTerminalRunStatus`) fed by the run entity itself, not something this
fix's job to accelerate. The corrected live evidence (Legacy cycle 1) shows
exactly this: the pill and the band both settle to `Failed`/`never sent`
together, with only the ordinary single-poll gap between two genuinely
independent server reads (dock's own queue read vs. run-detail/SSE) — not a
`Running`-after-terminal frame.

**Tests.** `packages/web/src/lib/execution-room-model.test.ts`: 4 new tests
for `effectiveNodeRoomStatus` (outcome present/absent, already-terminal
status never overridden, optional-field fallback).
`ConsoleNodeRoom.test.tsx` / `LegacyNodeRoom.test.tsx`: new test asserting
the pill never renders `Running` once this dock's own read reports the node
terminal, for both a live and a restart-recovered node.
`api.workflow-runs.test.ts`: exact-equality response fixtures updated with
`node_outcome: null`; new test folding a cancelled run onto a
restart-recovered node whose own event never went terminal; per-event-type
coverage extended with outcome assertions. `packages/web/src/lib/api.generated.d.ts`
regenerated against a running scratch server. Confirmed to fail against the
pre-fix code before being restored.

**Live verification.** Same 3-cycle real-Claude Abandon run as VQ12-1 (both
findings share one live scenario, since VQ12-2's pill and VQ12-1's band are
driven by the same dock read landing in the same commit). Room-scoped sampler,
confirmed self-consistent: in every cycle, every shell, the pill transitions
directly from `Running` to a terminal value (`Failed`) with **no** sampled
frame showing `Running` after the band or the pill has already moved off it.
Evidence: `evidence/qa12-fixes/phase-a-live-abandon.json` (same file as
VQ12-1 — both findings' evidence is inherently one trace).

## VQ12-3 — focus could drop to `<body>` when a focused transcript row was removed at a loop boundary

**Root cause.** The prior focus-restoration effect only ran when the `row`
prop identity changed, on the assumption that content removal and the row
prop change land in the same commit. They do not always: a scope-keyed
content refetch can settle a render later than the prop change, so the old
effect could fire once (while the old row was still mounted, a no-op) and
never fire again once the row was actually removed — the browser's own
synchronous blur-on-removal then left focus on `<body>`.

**Fix.** `NodeTranscriptPane.tsx` / `ConsoleNodeRoom.tsx`: the focus-tracking
effect now runs after **every** commit (no dependency array) — safe because
every branch is idempotent (a still-connected tracked row, or any focus
target other than a bare `<body>`, is a no-op). `onFocusCapture` on the
scroller narrowly tracks only elements carrying `data-last-row` (not every
focusable descendant, which would have collided with the occurrence-heading
focus-restoration mechanism that lives in the same scroller). When the
tracked row is gone and focus has landed on `<body>` (or nothing), focus
moves to the new selection's last row, or — if no row exists yet — to the
scroller itself, with a `parkedOnScrollerFallbackRef` flag so a **later**
render can reclaim a real row once one appears, without overriding a
genuinely different, deliberate focus destination (the pre-existing
occurrence-navigator "focus lands on the scroller" tests exercise exactly
that different, legitimate destination, and both were re-verified passing
after this change).

**Tests.** `NodeTranscriptPane.test.tsx` / `ConsoleNodeRoom.test.tsx`: new
test — an operator-undriven loop iteration boundary removes the focused row
from the prior iteration; asserts focus never lands on `document.body` and
instead lands on the equivalent last row of the new selection. Verified via
temporary disable-and-restore (`if (true) return;` at the top of the effect)
that both new tests fail without the fix and pass with it; also re-ran the
two pre-existing occurrence-navigator focus tests to confirm they still pass
unchanged.

**Live verification.** Fake provider, `e2e-queue-guidance-loop` workflow, two
cycles (console-as-stopper, legacy-as-stopper) so both shells are exercised
as the tab under observation. Shell A queues a completion signal and clicks
Stop, with focus placed on its own last transcript row; Shell B (a second
tab on the same run) fires a blank Send now that delivers the queue and
completes the iteration boundary. A `setTimeout`-driven focus watcher (30ms
cadence, 8s window) on Shell A: console-as-stopper shows focus parked on a
`data-last-row` element for the entire window, never `<body>`;
legacy-as-stopper shows focus on a `data-last-row` element, briefly on a
non-`data-last-row` element (the intermediate boundary, ~780ms), then back on
a `data-last-row` element — `isBody` is `false` across every sampled frame in
both cycles. Evidence: `evidence/qa12-fixes/phase-b-focus-boundary.json`.

## VQ12-4 — Legacy's own `SENDING`/`Stop`/`Queue` could outlive a node its own Send now had just finished

**Root cause.** Legacy's dock only refreshed on its regular poll cadence
(up to ~1s) after its own Send now request resolved, so a node that finished
inside that same request (a redirect turn completing before the poll fired)
left stale `Stop`/`Queue`/`SENDING` controls visible for up to a second.

**Fix.** `ComposerDock.tsx` / `ConsoleComposerDock.tsx`: renamed
`withdrawKickTick`/`setWithdrawKickTick` to `forceKickTick`/`setForceKickTick`
(the mechanism already existed for withdraw; this reuses it) and added
`setForceKickTick(tick => tick + 1)` in the Send Now success handler, forcing
an immediate queue re-read the instant this dock's own request resolves,
instead of waiting for the next poll tick.

**Tests.** `ComposerDock.test.tsx` / `ConsoleComposerDock.test.tsx`: new test
asserting a queue re-read fires immediately after Send Now's own response
resolves, without waiting for the poll interval. Confirmed to fail against
the pre-fix code before being restored.

**Live verification.** Fake provider, `e2e-queue-guidance` workflow, Legacy
as sender, 2 cycles. Click Stop, type text, click Send now, capture the
response and a room-scoped frame sampler from that click. Cycle 1: `Running`
→ (25ms later) a brief frame showing `hasStop`/`hasQueue` true again (the
in-flight request's own optimistic re-render) → (26ms later) `Completed`,
band closed, no stale controls. Cycle 2: `Running` → `Completed` directly,
no stale-control frame at all. Both cycles settle within roughly 25–60ms of
the Send now response, an order of magnitude inside the pre-fix up-to-1s
window. Evidence: `evidence/qa12-fixes/phase-c-legacy-sender-kick.json`.

## e2e regression: a coordinator-directed correction, not a silent weakening

While running the six steering specs most directly touched by these fixes,
`agent-interrupt-redirect.spec.ts`'s "blank Send now delivers everything
already waiting" test failed on both shells: VQ12-4's fix made Legacy's dock
refresh at once, and this test's redirect turn had no `delayMs` directive, so
it could now complete before any frame observed the transient `Stop`/"agent
generating" state the test asserted on.

My first pass dropped those two assertions with an explanatory comment,
reasoning the delivery-correctness assertions (which remained) were the
test's real intent. The coordinator correctly flagged this as weakening a
test rather than fixing the underlying non-determinism, and directed the
actual fix already established elsewhere in this same file: give the
blank-Send-now scenario a `delayMs` (the same `<<E2E_SCENARIO>>{"echoPrompt":
true,"delayMs":…}` pattern already used at `REDIRECT_SCENARIO` and
`LOOP_REDIRECT_SCENARIO` in this file) so the transient window is
deterministically observable, and keep both assertions.

**Fix applied.** `BLANK_SEND_NOW_TEXT` now carries `delayMs: 1500` — matching
the value already proven reliable in this file's own `REDIRECT_SCENARIO` for
the identical purpose. Restored both dropped assertions
(`await expect(stopButton(room)).toBeVisible()` and
`await expect(dockStatus(room)).toContainText(AGENT_GENERATING)`). Checked the
constant's other two use sites (the echo-text wait, and the stored-message
equality assertion) — both are unaffected, since the delay only holds the
turn open longer and does not change what gets echoed or stored. Verified
the corrected scenario 5 times per shell (10 runs, all green) before the
full-file and full-suite re-runs described below. The prior commit
(`da3c4cee`, the weakening) was amended into `0498b942` with the real fix —
authorized explicitly by the coordinator ("You can amend or replace that
commit"), and safe here since nothing had been built on top of it yet.

## Verification

**Unit tests.** Every test file touched by this report's commits, run in
isolation:

```
packages/web: steering-dock.test.ts + execution-room-model.test.ts: 330 pass
  ComposerDock.test.tsx + ConsoleComposerDock.test.tsx: 235 pass
  NodeTranscriptPane.test.tsx + ConsoleNodeRoom.test.tsx + LegacyNodeRoom.test.tsx: 252 pass
packages/server: api.workflow-runs.test.ts: 337 pass, 9 todo
```

Every new/changed assertion for all four findings was individually confirmed
to fail against the pre-fix code first, then restored.

**Full `bun run validate`**: green (exit 0) after fixing one incidental
finding — the newly added evidence JSON files under
`evidence/qa12-fixes/` were not yet Prettier-formatted; `prettier --write`
on those three files was the only change needed, and a second full
`validate` run confirmed clean end to end: `check:bundled`,
`check:bundled-skill`, `check:bundled-schema`, `check:pi-vendor-map`,
`check:capability-matrix`, `type-check` (all 13 packages), `lint
--max-warnings 0`, `format:check`, `test:install`, and every package's `test`
script (0 fail throughout; the only "error"/"fail"-looking log lines are
intentional error-path logging from tests that deliberately simulate
failures).

**Schema changes.** None to the database. VQ12-2's `node_outcome` field is
additive to the Zod/OpenAPI wire schema only (`readWorkflowNodeQueueResponseSchema`);
no migration file was touched, so `check:schema-upgrades` does not apply to
this report.

**Live real-provider verification.** Isolated scratch server (never the
real `~/.archon/archon.db`), DB/config/credential-key copied once. Server on
port 3375, Vite on 5243. A scratch git repo with a local bare `origin`
registered as the codebase. VQ12-1/VQ12-2 verified against a real Claude
subscription (haiku); VQ12-3/VQ12-4 verified against the e2e-fake provider
(`ARCHON_E2E_FAKE_PROVIDER=1`, same server instance). See the per-finding
sections above for exact traces; full detail in `evidence/qa12-fixes/`.

**Full e2e UI suite.** `cd e2e && bun run test:ui` (162 tests, single
worker, `ARCHON_E2E_PORT_BASE=3550` to avoid an unrelated pre-existing
Docker service on the harness's default port 3400 — confirmed via `lsof` and
`ps` that port 3400's owner was a 17-day-old Docker Desktop process, not
mine, before choosing a different port rather than touching it).

First full run (before the coordinator's correction above) surfaced the
`agent-interrupt-redirect.spec.ts` failure described above (157 pass, 1
fail, 4 skip). A second full run, after fixing that spec, also hit one
transient failure in `agent-withdraw-guidance.spec.ts`'s
`withdraw.drain-legacy` test — a `queueGuidance` POST that never fired
within its 10s timeout. Re-ran that exact test in isolation twice (once
before, once after confirming it touches none of this report's changed
files): both isolated runs passed in ~1.1s, nowhere near the 10s budget,
indicating resource-contention flakiness from 23+ minutes of accumulated
Chromium subprocesses under a single-worker run, not a product regression.

Final full run, after the coordinator-directed fix: **158 pass, 4 skip, 0
fail, 24.0 minutes.** The 4 skips
(`workflow-env-overlay.spec.ts`, and three `workflow-run-hitl.spec.ts` auth
tests) are pre-existing and gated on capabilities not enabled in this scratch
setup — unrelated to any file this report touches. Full log:
`/tmp/qa12-e2e-full-run-3.log` (not committed — ephemeral local log, not
project evidence).

## Processes

Every process listed here was started by me, for this report:

- Scratch server, one instance: PID 77495 (`bun run src/index.ts`, port
  3375). Stopped via `kill -TERM` on the exact PID at the end of this task;
  confirmed port 3375 free afterward.
- Vite dev server, one instance: PID 78223 (`vite --port 5243 --strictPort`).
  Stopped via `kill -TERM` on the exact PID; confirmed port 5243 free
  afterward.
- e2e suite runs: each `bun run test:ui` invocation's own `bun`/`playwright`/
  worker/Chromium process tree was waited out to natural completion via its
  exact top-level PID (never a pattern match), confirmed exited before the
  next invocation started. One run (PIDs 27983/27985) was intentionally
  stopped early via `kill -TERM` on its exact PIDs when the coordinator's
  correction arrived mid-run, so the corrected spec could be re-verified
  rather than let the stale run finish.
- Playwright's own Chromium instances from the temporary `e2e/qa12-verify.ts`
  live-verification script (deleted before finishing, not a deliverable):
  each invocation closed its own `browser` before exiting.
- Ports 3090, 3317, 5173, 5187, 8791 were never touched. A pre-existing,
  17-day-old Docker Desktop process (PID 5915) was found holding port 3400
  (the e2e harness's single-worker default) — confirmed not mine via `ps`,
  left untouched, and worked around via `ARCHON_E2E_PORT_BASE=3550` instead.
  My own ports were resolved via `lsof -tiTCP:<port> -sTCP:LISTEN` before
  each start.

## Attribution note

This session's system reminder specifies
`Claude Sonnet 5 <noreply@anthropic.com>` (the trailer in effect for this
part of the session, superseding the task brief's originally stated
trailer); every commit in this report uses that trailer.

## Unresolved questions

None. All four findings are fixed, tested, and live-verified; the
coordinator's requested correction to the e2e regression fix is applied and
re-verified; the full e2e suite and `bun run validate` are both green.

Status: DONE

Summary: All four round-12 findings (VQ12-1 a queued item could show a gap
or false relabel through the abandon window, VQ12-2 the pill could show
`Running` for a frame after the node was already known terminal, VQ12-3
focus could drop to `<body>` at an operator-undriven loop iteration
boundary, VQ12-4 Legacy's `SENDING`/`Stop`/`Queue` could outlive a node its
own Send now had just finished) are fixed, each covered by discriminating
unit tests every one of which was confirmed to fail against the pre-fix code
first, and live-verified end to end — VQ12-1/VQ12-2 against a real Claude
subscription across 3 Abandon cycles on both shells (after correcting a
sampler scoping bug found and diagnosed via `advisor` mid-verification),
VQ12-3/VQ12-4 against the e2e-fake provider. One genuine e2e regression was
found in the full suite; the coordinator directed restoring the two dropped
assertions with a deterministic `delayMs` instead of the weakening I had
first applied, which is now in place and re-verified (10/10 repeat runs,
full spec file, full suite). `bun run validate` is green. The full e2e UI
suite's final run: 158 pass, 4 skip, 0 fail.
