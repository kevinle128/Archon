# Round-14 visual QA fixes — Agent Node Room

Date: 2026-09-30 (Asia/Saigon). Base checkout: `develop-2`. Worktree:
`/Users/dale/orca/Archon/.claude/worktrees/agent-a965b615375ec801d`, branch
`worktree-agent-a965b615375ec801d`.

Fixes the two findings in
`plans/260926-1521-agent-node-room-completion/reports/visual-qa-14-report.md`,
per that round's own recorded Decisions section (VQ14-1 and VQ14-2).

## VQ14-1 — the dashboard SSE stream evicted every other dashboard subscriber

**Root cause.** `SSETransport` kept exactly one writer per stream id and
closed the previous one on every new `registerStream` call for that id. The
`__dashboard__` id is subscribed to by several independent surfaces at once —
a Legacy run page's terminal-edge probe (`useRunTerminalEdge`), the Console
runs list, and the standalone Legacy dashboard page — so a second subscriber
evicted the first every time, and both reconnected in a loop roughly every 3s
(the browser's `EventSource` auto-reconnect delay). When a node turned
terminal during the disconnected half of that cycle, the Legacy composer's
`Stop`/`Queue` controls waited out the dock's own ~1s poll again instead of
clearing on the terminal-edge kick — the exact residual the round-13 fix's own
decision refinement had assumed away ("its own stream slot, so it evicts no
stream"), which round 14 measured and found false.

**Fix (per the round's own decision: the dashboard stream is a broadcast
channel).** `packages/server/src/adapters/web/transport.ts`: `SSETransport`
gained a second map, `broadcastStreams: Map<string, Set<SSEWriter>>`, used
only for the `__dashboard__` id — every other id keeps today's single-writer
map and eviction exactly as before. `registerStream`/`removeStream`/
`hasActiveStream`/`emit`/`emitWorkflowEvent` (`writeToStream`) all branch on
the id: for `__dashboard__` they add/remove one entry in the subscriber set
and fan out a write to every open subscriber, buffering only while the set is
empty (matching the single-writer path's existing buffer-on-disconnect
behavior). A write failure or an explicit close removes only that one
subscriber, never the whole set. The zombie reaper (`start()`) and `stop()`
were extended to sweep/close every broadcast subscriber, not just the
single-writer map. `useRunTerminalEdge.ts`'s doc comment, which asserted
`__dashboard__` "is its own stream slot... so this never contends," was
corrected to state the actual invariant now enforced: every subscriber fans
out independently, so no `__dashboard__` connection is ever evicted by
another one.

**Tests.** `packages/server/src/adapters/web/transport.test.ts`: new tests —
two dashboard subscribers both stay connected and both receive every event;
closing one leaves the other receiving; a write failure on one subscriber
removes only that subscriber and the other keeps receiving; the dashboard
fan-out buffers only while every subscriber is gone, then replays to the
reconnecting one; a three-subscriber test names the exact real surfaces from
the round's decision (a second Legacy run tab, the Console runs page, the
Legacy dashboard page) and asserts none evicts any other; and a regression
test confirming per-conversation (non-broadcast) eviction is byte-for-byte
unchanged alongside a broadcast subscriber. Every new assertion was confirmed
to fail against the pre-fix `transport.ts` (by reverting the production file
via `git checkout --` while keeping the new tests, then restoring the fix)
before being restored — the two-subscriber test failed with `oldStream.close`
having been called once, exactly the eviction this fix removes.

**Live verification.** Isolated scratch server (`ARCHON_HOME` under a fresh
scratch dir, DB/config/credential-key copied via `.backup` once), e2e-fake
provider (`ARCHON_E2E_FAKE_PROVIDER=1`), Vite launched with **both** `PORT`
and `VITE_API_PORT` set to the scratch server's port (3415) — confirmed in the
browser's own request log before measuring anything: the Console runs page's
`__dashboard__` stream requested `localhost:3415` directly (bypassing the
proxy, as designed), while Legacy's relative URLs correctly show as the
page's own origin (5283) even though Vite proxies them server-side to 3415 —
that is not a defect, only Console's absolute-host path is asserted on. A
scratch git repo (`wrk`, local bare `origin`) registered as a folder-in-place
codebase, every run dispatched over HTTP with `X-Archon-User: qa14-operator`.

- **Disconnect measurement.** A second Legacy run tab, the Console runs page,
  and the Legacy dashboard page were all opened on `__dashboard__`
  simultaneously and held for 30s. **0 `error` events** on any of the three
  EventSource connections (`vq14-1-results.json`'s `disconnect30s`) — the
  pre-fix signature was an `error`/`open` pair on each stream roughly every
  3s, so a clean 30s window covering ~10 such cycles is a strong negative
  result.
- **Terminal-edge kick, 10 cycles.** With those same three companion
  subscribers still open throughout, a fourth Legacy tab ran 10 FIN-shape
  cycles (Stop → typed Send now carrying `<<E2E_SCENARIO>>{"delayMs":100}`, so
  the reply ends the node ~100ms later), sampled by an in-page rAF watcher
  recording the room's exact `Stop`/`Queue`/`Send now`/pill state on every
  distinct change. In **10/10** cycles the sampler recorded exactly two
  distinct frames for the whole redirect-to-terminal window: the pre-send
  idle state (`Send now`, no `Stop`, no `Queue`), then — 132–208ms later,
  matching the ~100ms configured reply delay plus kick overhead — the
  terminal state with no dock at all (`evidence/qa14-fixes/vq14-1-results.json`'s
  `finResults[].frames`). **Zero frames in any cycle ever showed `Stop` or
  `Queue`** between the redirect and the terminal read: the round's own
  ~1000ms poll-ceiling defect (stale live controls surviving past the
  terminal edge) did not reproduce even transiently. (An earlier informal
  observation from a differently-shaped manual cycle suggested a brief
  `Stop`+`Queue` reappearance before clearing; this precise, saved trace
  shows that reappearance does not happen in the FIN-shape cycle at all — the
  dock's mode goes directly from `composer` to hidden/terminal, so there is
  no intermediate live-control frame to observe, not merely a fast one.)
- **Console runs page starvation check.** Across the whole session (setup +
  10 cycles), the Console runs page's own `__dashboard__` `onmessage` log
  recorded **592** `dag_node`/`workflow_status` messages — it was not
  starved by the other three concurrent subscribers.

Evidence: `evidence/qa14-fixes/vq14-1-results.json` and `vq14-1-run.log`.

## VQ14-2 — a survivor tab could show a live composer briefly after a restart

**Root cause.** `steeringDockMode`'s `firstReadPending` gate (introduced for
round 13's VQ13-2) only covers the very first read on cold mount
(`dock.executionState === null`). A tab that survives a server restart
already has a non-null `executionState` from before the outage, so that gate
does not re-arm. `syncProjectedSubState` applied the host page's projected
`subState` unconditionally on every prop change — and that projection comes
from the run page's own, separately-cadenced run read, which can recover from
the outage _before_ this dock's own queue read does and report an optimistic
sub-state (a restart-recovered node briefly read back as still `generating`).
The result: for 97–180ms after the server answered again, a Stopped node
could show `QUEUED · n` + a live `Queue` button instead of the frozen
`WILL SEND · n` + `Send now`, and a live (never-Stopped) node could drop
`Stop` while keeping `Queue` — a live composer neither dock had itself read.

**Fix (per the round's own decision: the VQ13-2 rule also applies to
survivor tabs).** `packages/web/src/lib/steering-dock.ts`: `SteeringDockState`
gained `lastReadFailed: boolean` (default `false`), set by the new exported
`markQueueReadFailed()` (idempotent) and cleared unconditionally by
`applyQueueSnapshot` the instant a read succeeds — even when every other
field in the snapshot happens to be unchanged from before the failure, so the
`unchanged`-snapshot fast path can never mask a lifted freeze.
`syncProjectedSubState` now returns its input unchanged when
`state.lastReadFailed` is true, before applying any projection — the same
pattern `firstReadPending` established for the cold-mount gate, but keyed off
state the dock already carries instead of a new parameter, so the existing
`setDock(current => syncProjectedSubState(current, subState))` call site in
both dock components needed no change. `ComposerDock.tsx` and
`ConsoleComposerDock.tsx`: the queue-polling `onError` handler, previously
wired only for `finished-iteration` mode, now runs unconditionally and calls
`markQueueReadFailed` whenever the read's normalized status is a genuine
connectivity failure (`0` or `≥500`) — a `409`/`422` is a real answer _from_
the server, not a failure to reach it, so those never set the freeze. Every
other branch of that handler (detached/409/notify-and-stop) is unchanged and
still gated to `finished-iteration` mode only.

**Tests.** `packages/web/src/lib/steering-dock.test.ts`: new tests for
`markQueueReadFailed` (sets the flag, idempotent on a second call);
`syncProjectedSubState` ignores a fresh projection entirely while
`lastReadFailed` is true and resumes applying projections once cleared; and
`applyQueueSnapshot` clears the flag even when the snapshot's own fields are
otherwise identical to the failed state (proving the fast path can't mask
it). `ComposerDock.test.tsx`/`ConsoleComposerDock.test.tsx`: two new
integration tests per file reproduce the exact restart-survivor race —
(a) a Stopped node (`idle-after-interrupt`, `Send now` shown) whose own read
fails, then a re-render projects `generating` (the wrong flip toward a live
`Queue`-only composer) — the dock still shows `Send now`, unchanged, until
its own next read reports `recovery_required`; (b) a live (`generating`)
node whose own read fails, then a re-render drops the projection to
`undefined` (the actual observed trigger — not just a different value, a
lost one) — `Stop` stays up, never silently dropped, until the same read
lands. Every new assertion in all four files was confirmed to fail against
the pre-fix code first: reverting only `steering-dock.ts`'s field/gate would
have broken the import (`markQueueReadFailed` doesn't exist pre-fix), so the
component-level tests were checked by reverting only `ComposerDock.tsx`'s
`onError` wiring (which never called `markQueueReadFailed`) while keeping
`steering-dock.ts` fixed — with the flag never set, `syncProjectedSubState`'s
gate is dead code from the component's own perspective, and both new tests
failed exactly as expected (`Stop` disappeared) before the fix was restored.

**Live verification.** Same isolated server and codebase, both a Legacy tab
and a Console tab open on the same run at once (the brief's exact
requirement). A node was Stopped and one item queued (`WILL SEND · 1`,
`Send now`, textarea present — the exact survivor-tab shape from the round's
own O1–O4 batches) in both shells. An rAF sampler in each page recorded that
shell's _exact_ steering-button set, textarea presence, and the "restored
after server restart" marker every frame from just before the kill onward.
The server's own PID was killed with `kill -9`, held down 12s, and restarted
with the identical launch line (including `ARCHON_E2E_FAKE_PROVIDER=1`) on
the same port, new PID recorded — repeated **3 times**, each restart
targeting the exact PID the previous restart produced (`evidence/qa14-fixes/
vq14-2-run-{1,2,3}.log`).

In all 3 runs, in **both shells**, every frame before "restored" showed
**exactly** the frozen pre-outage steering-control set (unchanged from
`Send now`, the same queue-band buttons, the field present) — the only
permitted addition being the room's own, already-accepted `Retry`
connectivity hint (round 13's VQ13-1 fix; not a steering control), which the
analysis excludes before comparing. **0/3 runs × 2 shells = 0/6 observations
showed an unexpected steering-control frame** (`unexpected=0` in every
`vq14-2-results-{1,2,3}.json`). The transition was atomic in every
observation: the very next distinct frame after the server answered healthy
showed `restored: true`, `field: false`, and the read-only `queued · 1`
band — no intermediate frame ever showed a different composer state en
route, in either shell, in any of the 3 runs. Round 14's own pre-fix
measurement was 5/10 affected tabs, so 0/6 post-fix is a meaningful result,
not proof against every possible timing — stated as "0/3 in each shell,"
not "fixed for all time."

## Verification

**Unit tests.** Every test file touched by this report's commits, run in
isolation:

```
packages/server: transport.test.ts: 30 pass
packages/web: steering-dock.test.ts + ComposerDock.test.tsx +
  ConsoleComposerDock.test.tsx: 426 pass
```

Every new/changed assertion for both findings was individually confirmed to
fail against the pre-fix code first (production file reverted via
`git checkout --`, never a stray `git stash`/`pop`, then restored).

**Full `bun run validate`**: green (exit 0) — `check:bundled`,
`check:bundled-skill`, `check:bundled-schema`, `check:pi-vendor-map`,
`check:capability-matrix`, `type-check` (all packages), `lint --max-warnings
0`, `format:check`, `test:install`, and every package's `test` script.

**Schema changes.** None. No migration touched.

**`.agents/skills/verify-archon/visual-config.json`**: checked for pins on
every file this report touches (`transport.ts`, `steering-dock.ts`,
`ComposerDock.tsx`, `ConsoleComposerDock.tsx`, `useRunTerminalEdge.ts`) —
none are pinned, so no pin refresh or `features/run-ui.json`
`visualBinding()` update was needed.

**Live real-provider verification.** Isolated scratch server (never the real
`~/.archon/archon.db`, only read through `.backup`), scratch dir under
`.../scratchpad/qa14-live/`. Server on port 3415, Vite on 5283 with **both**
`PORT` and `VITE_API_PORT` set to 3415 (confirmed in the browser's own
request log before measuring anything — Console's stream requests went to
`localhost:3415`, matching the round-14 report's own disclosed harness
lesson). A scratch folder-in-place git repo (`wrk`) registered as the
codebase, every run dispatched over HTTP with `X-Archon-User:
qa14-operator`. Both findings verified against the e2e-fake provider
(dashboard fan-out and dock-freeze timing are web/server-layer concerns, not
provider-specific — matching prior rounds' own precedent for UI-timing
findings). Full frame-sampler JSON evidence in `evidence/qa14-fixes/`.

**Full e2e UI suite.** `cd e2e && ARCHON_E2E_PORT_BASE=3570 bun run test:ui`
(162 tests, single worker, avoiding port 3400 which an unrelated Docker
process holds).

First full run: **157 passed, 4 skipped, 1 failed, 22.5 min.**
`agent-queue-guidance.spec.ts`'s `route-smoke` test failed on one assertion —
expected HTTP 409 (`recovery_required`) from a detached CLI run's node,
received 422 (`not_steerable_here`). Re-ran that exact test alone: **passed
in 30.7s**, nowhere near its timeout. The race is between
`waitForNodeStarted`'s own REST poll seeing the `node_started` event and the
separate CLI process's executor durably stamping that node's `provider_id` —
neither is touched by anything in this report, and `waitForNodeStarted`
polls a plain REST endpoint, not any SSE stream. This is the same class of
late-in-a-single-worker-run flake round-13's own report diagnosed and
confirmed by the identical isolated-pass method. The 4 skips
(`workflow-env-overlay.spec.ts` and three `workflow-run-hitl.spec.ts` auth
tests) are the exact same pre-existing, capability-gated skips round-13's
report documented — unrelated to any file this report touches.

Restored the evidence churn the first run wrote under `plans/`
(`git checkout -- plans/`, excluding this report's own
`evidence/qa14-fixes/`) and re-ran the full suite once more.

Second full run: **158 passed, 4 skipped, 0 failed, 23.0 min.**

## Side effects (disclosed)

- **Early dispatches, before the scratch workflow file was discoverable.**
  While setting up the scratch codebase, two dispatch attempts named a
  workflow the codebase's registered path didn't yet resolve
  (`cmd.workflow_not_found`); the server accepted the request anyway and, per
  its own documented not-found fallback, processed the message as ordinary
  chat. No mutating action against the scratch repo resulted. (The Codex
  activity visible in the log at the same moments is the title generator,
  disclosed separately below — not a consequence of the fallback itself.)
- **Codebase registration churn.** The scratch codebase was registered,
  deleted, and re-registered twice while diagnosing an unrelated local-git
  default-branch quirk in the scratch bare repo (its `HEAD`/branch naming,
  not anything under test) before settling on a folder-in-place registration.
  Each delete correctly reported `external_repo_skip_deletion` and left the
  scratch repo on disk untouched.
- **My first VQ14-2 verification script's own process never exited on its
  own, and terminating it killed its spawned replacement server as a side
  effect — a stdio-piping bug in my own throwaway tooling, not a product or
  environment fault.** That script spawned the restarted server with
  `stdio: ['ignore', 'pipe', 'pipe']` and piped its stdout/stderr into a log
  file via `child.stdout.pipe(logStream)` from inside the script's own Node
  process. `child.unref()` only releases the `ChildProcess` handle; the
  piped `Readable` it created stays attached and keeps that process's own
  event loop alive, so the script printed `DONE` and never exited on its
  own. Seeing no further output after a while (misreadable as "stuck" —
  the tool output was also fully buffered behind a `tail -100`, which cannot
  flush before EOF either way), I sent it `kill -TERM` on its own PID. That
  signal is what actually ended the still-running script; ending it closed
  its held read end of the pipe, and the spawned server, mid-write to that
  now-broken pipe, terminated on the next log line (`SIGPIPE`). I only
  noticed the server was gone when a follow-up script (adding a Console-tab
  check to the same restart) got `ConnectionRefused` on its very first
  request. I restarted the server directly (the same proven, unpiped launch
  line used for every other server start in this session) and fixed the
  script to hand each spawned server a raw file descriptor instead of a
  piped stream, which also let the script exit on its own afterward — that
  fixed script is what produced the 3-run, both-shells VQ14-2 evidence
  above. Separately, an earlier attempt at reconnecting to a persistent
  browser over CDP (to add the Console-tab check without re-running the
  whole restart, before I had the stdio fix) launched a headless Chromium
  instance that never bound its debugging port within 60s under this
  machine's resource contention from an unrelated, already-running large
  Chrome process, and was killed with `kill -9`; confirmed no orphaned
  helper processes remained. That CDP approach was abandoned in favor of
  just fixing the script and re-running it normally, which is what
  succeeded. Both are disclosed for completeness — neither affected the
  final VQ14-2 evidence, and no other process's data was touched.
- **Every conversation created during setup fired a fire-and-forget
  title-generation call that failed on an unrelated, pre-existing Codex API
  incompatibility.** `generateAndSetTitle` (`packages/core/src/services/
title-generator.ts`) runs on every new conversation's first message using
  the codebase's default assistant — Codex, for this scratch codebase — and
  is designed to never throw past its own boundary. Codex here rejected the
  request with `"tools cannot be used with reasoning.effort 'minimal':
web_search"`, a real API-side incompatibility unrelated to anything this
  report touches; the conversation's title simply stayed unset each time
  (`title.generate_empty`), which is the function's own documented failure
  mode. This is not specific to a misrouted workflow dispatch — it fired for
  every conversation `POST /api/conversations` created in this session
  (roughly a dozen, across both live-verification scripts and my own manual
  setup calls), including ones whose workflow dispatch succeeded normally.
- The real `~/.archon/archon.db` was only ever read through `.backup`.
  Everything else lives under `.../scratchpad/qa14-live/` and
  `.../scratchpad/qa14-fixes/` (backups of the fixed files used to prove the
  new tests fail pre-fix).

## Processes

Started and stopped by me, each by exact PID:

- Isolated scratch server on 3415, each restart with the identical launch
  line (`ARCHON_E2E_FAKE_PROVIDER=1`, same `ARCHON_HOME`, same port): PID
  88638 (initial) → `kill -9` for the aborted first VQ14-2 attempt (the
  stdio-piping bug) → PID 17686 (died on its own from that bug, not killed
  by me) → PID 43269 (restarted directly; served the `bun run validate`/build
  window and both full e2e suite runs) → `kill -9` for VQ14-2 evidence run 1
  (after the stdio fix) → PID 94173 → `kill -9` for run 2 → PID 96613 →
  `kill -9` for run 3 → PID 99168, stopped with `kill -TERM` at the very end;
  port 3415 confirmed free afterward.
- Vite dev server on 5283 (`PORT=3415 VITE_API_PORT=3415`): PID 85693
  (`npx`, exited on its own once its node child did) / 85822 (node),
  stopped with `kill -TERM`; port 5283 confirmed free afterward.
- A headless Chromium instance launched for an abandoned CDP-based
  verification attempt (PID 37341 + its helper/GPU children, disclosed
  above) never bound its debugging port within 60s and was killed with
  `kill -9`; confirmed no orphaned helper processes remained afterward
  (`ps aux | grep chrome-profile` empty).
- `bun run test:ui` (e2e suite, both runs): launched via the harness's own
  background-task tracking rather than a manually captured shell PID; both
  runs were waited out to their own natural completion (never pattern-killed)
  and neither left a process behind — confirmed via `ps aux` after each run
  and again in the final sweep below.
- Final sweep: `ps aux | grep "qa14-live\|qa14-fixes"` after stopping
  everything above returned nothing.
- Ports 3090, 3317, 5173, 5187, 8791 were never touched. Port 3400 was
  avoided by using `ARCHON_E2E_PORT_BASE=3570` as instructed.

## Commit note

VQ14-1 (`8ae3b3e9`) and VQ14-2 (`90f4e879`) are separate commits, matching
the file-ownership split between the two findings (`transport.ts` +
`transport.test.ts` only for VQ14-1; `steering-dock.ts`, both dock
components, and their tests plus one doc-comment fix in
`useRunTerminalEdge.ts` for VQ14-2 — the doc-comment fix belongs with VQ14-2's
commit because it corrects a claim the VQ14-1 fix falsified, but the
correction itself is about `useRunTerminalEdge`'s own reasoning, not
`transport.ts`).

## Unresolved questions

None. Both decisions in `visual-qa-14-report.md`'s Decisions section were
implemented exactly as written; no design fork required a coordinator
decision during implementation.

Status: DONE

Summary: Both round-14 findings (VQ14-1 the dashboard SSE stream evicted
every other dashboard subscriber roughly every 3s, breaking the round-13
terminal-edge fix whenever a second dashboard surface was open; VQ14-2 a
survivor tab could show a live, unconfirmed composer for up to ~180ms after
a server restart before its own read caught up) are fixed, each covered by
discriminating unit tests every one of which was confirmed to fail against
the pre-fix code first, and live-verified against an isolated scratch server
with the e2e-fake provider — VQ14-1 with a 30s hold showing 0 disconnects
across three simultaneous dashboard subscribers and 10/10 terminal-edge
cycles showing zero frames with a stale `Stop`/`Queue` at all, VQ14-2 with 3
independent real `kill -9` restarts, both a Legacy and a Console tab open
throughout, showing 0/6 shell-observations with any steering-control frame
other than the frozen pre-outage one before landing on the read-only recovery
band. `bun run validate` is green, and the full e2e UI suite's final run is
158 pass, 4 skip, 0 fail (a first run's one failure was an unrelated,
pre-existing timing flake, confirmed by an isolated re-run and matching
round-13's own precedent for this class of issue).
