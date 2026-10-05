# Round-8 visual QA fixes — Agent Node Room

Date: 2026-09-29 (Asia/Saigon). Base checkout: `develop-2`. Worktree:
`/Users/dale/orca/Archon/.claude/worktrees/agent-abe24c69af757c414`, branch
`worktree-agent-abe24c69af757c414`.

Fixes the five findings in
`plans/260926-1521-agent-node-room-completion/reports/visual-qa-8-report.md`
(VQ8-1 major, VQ8-2 major per coordinator decision, VQ8-3 minor, VQ8-4 minor,
VQ8-5 cosmetic) plus two extra-scope items the coordinator added mid-task:
(A) a Grok/DeepSeek ACP child-process leak on Abandon, and (B) a suspected
engine-correctness bug in a steered loop's `until_bash` evaluation, which
investigation closed as intended behavior.

## VQ8-1 — a restarted loop node with a queued item showed a live composer instead of recovery-required (major)

**Root cause.** `dag-executor.ts` registered a live `NodeSteeringHandle` at
two call sites — the prompt-node path (~line 3559 pre-fix) and the loop-node
path (~line 6428 pre-fix) — but only the prompt path also stamped the durable
`remote_agent_steering_node_settings.provider_id` row. After a server
restart, `classifySteeringLifecycle` reads that stamp to decide whether a
run's steering state is `recovery_required` (no live handle, but a durable
row says one existed) versus `not_steerable_here`. A restarted loop node that
had a queued item and a live handle before the crash never got the stamp, so
recovery classified it as `not_steerable_here` — the room showed a live
composer and the API answered a send with `422` instead of `409` — and the
durably-queued item was hidden behind that wrong state instead of surfaced in
the read-only recovery band.

**Fix.** Extracted a shared `registerSteeringHandle(deps, {...})`
(`packages/workflows/src/executor-shared.ts:900`) that registers the handle
**and** stamps the settings row in one call, then replaced both call sites
(`packages/workflows/src/dag-executor.ts:3559` and `:6428`) with it, so the
stamp can never drift out of sync between the two paths again. Audited every
other steering-handle registration site in the file; these were the only two.

**Tests.** `packages/workflows/src/dag-executor.test.ts`: "stamps the durable
steering settings row with the resolved provider, exactly like a prompt node"
(loop node) and the equivalent prompt-node test. `e2e/ui/agent-queue-guidance.spec.ts`:
a new `[a CLI-detached LOOP run discloses recovery-required, not a live
composer]` test mirroring the existing detached-prompt-node test, asserting
`execution_state: 'recovery_required'` and a `409` on the send route.

**Live verification.** Real Claude (`haiku`) loop workflow on an isolated
scratch server, killed with `kill -9` mid-iteration and restarted. Both
shells confirmed via direct DB query and API response codes, and
screenshotted: `evidence/qa8-fixes/vq8-1-legacy-recovery.png` and
`vq8-1-console-recovery.png`, both showing the "Recovery required" pill,
"restored after server restart" tooltip, and the disabled composer with the
queued state intact.

## VQ8-2 — the room did not follow a live loop across an iteration boundary (major, per coordinator decision)

**Decision applied verbatim:** the room follows the live execution
automatically when the viewer was on the previous live execution; it stays
put only if the viewer explicitly selected an older execution. The composer
and focus must survive the boundary.

**Root cause.** The room resolved its selected row once, at open time
(`.find()` against a pinned row id), and never revisited that choice as newer
rows arrived. When a live loop advanced to iteration 2, the pinned id still
pointed at iteration 1's now-finished row: the composer unmounted mid-turn,
the operator's draft was lost, and focus dropped to `<body>`.

**Fix.** `packages/web/src/lib/execution-room-model.ts` gained
`isLiveRowStatus`, `resolveFollowedRow<T>(selection, rows)`, and
`resolveGapHoldStatus`, plus a new required `followingLive: boolean` field on
`RoomVisitSelection` — true whenever the row was live at the moment it was
selected (auto room-open, an explicit click on the currently-live row, or "Go
to iteration N"). While `followingLive` holds, the displayed row is resolved
fresh on every render (whatever a brand-new room-open would choose right
now), so it advances to a new live row the instant one exists; an explicit
pick of a row that was **not** live when chosen stays pinned by id, so an
operator reading history on purpose is never moved. Between one iteration's
row completing and the next iteration's row starting (the loop's completion
check still deciding), nothing live exists to follow yet, so the resolver
holds the just-finished row rather than jumping anywhere —
`resolveGapHoldStatus` feeds the composer dock the **node's** own still-live
status instead of that transient row's terminal one, so the composer stays
mounted through the gap instead of dropping it. Both shells wired through the
same shared logic: `WorkflowExecution.tsx` → `LegacyGraphLogsPane.tsx` →
`LegacyNodeRoom.tsx` → `NodeTranscriptPane.tsx` (Legacy), and
`RunDetailPage.tsx` → `ConsoleInspectPane.tsx` → `ConsoleNodeRoom.tsx`
(Console).

**Tests.** `execution-room-model.test.ts`: new `isLiveRowStatus`,
`resolveFollowedRow`, `resolveGapHoldStatus` describe blocks (advance-to-live,
explicit-pin-stays, gap-holds-same-row, hold-releases-on-node-terminal,
no-op-when-already-live). `e2e/ui/agent-finished-iteration.spec.ts`: a new
test that opens the room during iteration 1, fills a draft, samples
`document.activeElement.tagName` continuously through the iteration-2
boundary (asserting it is never `BODY`), and asserts the selector reads
iteration 2, no "Go to iteration" button is shown, and the field still holds
the draft and is focused.

**Live verification.** Real Claude (`haiku`) loop workflow, room opened
during iteration 1 via the Console shell, a draft typed into the composer,
then polled through the iteration-2 boundary. `evidence/qa8-fixes/vq8-2-console-followed-iteration2.png`
shows the selector reading "Iteration 2 · running", the field still focused
(visible ring) with the draft text `qa8-vq8-2-live-draft` intact, and the
"saved for you" indicator confirming the draft was never lost.

## VQ8-3 — focus fell to `<body>` when the last transcript row lost its "last" status (minor)

**Root cause.** Only the row currently marked "last" carried `tabindex`; when
a new row became last (the turn resumed), the old row — which might still
hold focus, e.g. after Stop moved focus there — lost its `tabindex` and the
browser blurred it straight to `<body>` with nothing left to receive focus.

**Fix.** `NodeRoom.tsx` / `ConsoleAgentHistoryList.tsx`: every row now
carries `tabIndex={-1}` unconditionally; only the `data-last-row` marker
attribute is conditional on last-row status. `ComposerDock.tsx` /
`ConsoleComposerDock.tsx` gained `fallbackFocusedElementRef` plus a
`focusFallbackRow()` wrapper (replacing four raw call sites), and a new
remount-direction branch: when the dock's controls return and focus is still
exactly on the previously-recorded fallback row, focus moves back into the
dock (the Go button or the message field, depending on mode) instead of
being left stranded on a row that was never meant to be a permanent focus
destination.

**Tests.** `NodeRoom.test.tsx` / `ConsoleNodeRoom.test.tsx`: new "live focus
behavior" describe blocks using real DOM rendering, proving a previously
focused row keeps `tabindex="-1"` and stays focused after a new row becomes
last. Verified as a genuine regression test by temporarily reverting the fix
and confirming failure before restoring it.

## VQ8-4 — cold-load restart recovery still moved focus to the last row (minor)

**Root cause.** The composer dock's mount-transition effect's unmount-branch
condition included a check for `document.activeElement` being `<body>` or
absent from the document — which is also true of "nothing was ever focused
at all," so a cold page load straight into restart-recovery state (before
the first queue read classifies the node) briefly rendered the live composer
then dropped it, moving focus to the last row with a visible ring even
though the user never interacted with anything.

**Fix.** Simplified the unmount-direction check to gate purely on
`focusInsideRef.current` (focus was genuinely inside the dock), removing the
`<body>`/absent-element fallback that made a cold load indistinguishable from
a genuine focus-loss event. This shares the same effect VQ8-3 touches in both
`ComposerDock.tsx` and `ConsoleComposerDock.tsx`.

**Tests.** Covered by the same "live focus behavior" test additions as
VQ8-3 (cold-mount cases were already covered by round-7's cold-mount tests;
this fix's correctness is confirmed by the full component suite staying
green with the simplified condition — see Verification).

## VQ8-5 — a 29-35ms blank frame between Send-now click and the SENDING row (cosmetic)

**Root cause.** `beginSendNow` (`packages/web/src/lib/steering-dock.ts`)
cleared the queue band to `sent: []` and left the batch un-rendered until the
server response resolved a moment later — between the click and the first
frame showing anything, the sending shell displayed neither the queued items
nor a sending row.

**Fix.** `beginSendNow` now maps the in-flight batch to `dispatching` rows
synchronously, in the same click-handler state update
(`sent: inFlightBatch.map(entry => ({ ...entry, state: 'dispatching' }))`).
`resolveSendNowSuccess` re-asserts the same mapping defensively (no longer
the first paint, just a re-sync). `resolveSendNowFailure` now reverts by
**replacing** (dedupe by message id) instead of concatenating, so a batch
entry is never shown twice if the failure handler fires after the success
path already re-asserted it.

**Tests.** `steering-dock.test.ts`, `ComposerDock.test.tsx`,
`ConsoleComposerDock.test.tsx`: updated to assert the row appears
synchronously in the click update, and that a failed Send now reverts
without duplication.

## Extra scope (A) — Grok/DeepSeek ACP child processes survived Abandon

**Root cause.** `runGrokAcpTurn` / `runDeepseekAcpTurn` each drove their ACP
turn generator inside a `for (;;) { ... yield chunk; }` loop, and placed
their "the ACP protocol itself is stuck" fallback reap (a delayed race
against `abortSignal`) **inside that same loop's `Promise.race`**. An async
generator that has just yielded is suspended exactly there — it does not
resume, and none of its own `await`s or its `finally` block run, until an
external caller calls `.next()` on it again. The executor's idle-timeout
wrapper (`withIdleTimeout` in `dag-executor.ts`) does exactly this on abort:
it stops pulling `.next()` once it observes the node's `AbortController`
fire. So a Grok or DeepSeek ACP child stuck on a long-running tool call, once
the node aborted, would never be resumed again — the in-loop race that was
supposed to reap it never got a chance to run, and the child (and any
subprocess it had spawned for the tool call) outlived the aborted node
indefinitely. This was empirically confirmed live before being root-caused:
a real `grok agent` process stayed alive 35+ seconds past Abandon under the
first (in-loop) design.

**Fix.** Both `packages/providers/src/grok/acp-client.ts` and
`packages/providers/src/community/deepseek/acp-client.ts`: the reap is now
armed as a plain `abortSignal.addEventListener('abort', ...)` registered
once at spawn time, **outside** the turn generator's control flow — matching
the pattern the OMP provider already used correctly
(`packages/providers/src/community/omp/provider.ts:366-380`,
`ensureCancelListener`/`scheduleHardKill`). The listener fires
`abortStuckGraceMs` (production default 3s) after abort, well past the
graceful in-flight-prompt cancel path's own expected settlement time, so a
normally responsive agent's cancel always wins first; it kills the child
directly as a side effect of the abort itself, independent of whether
anything is still consuming the generator's output. The listener is also
removed in the `finally` block on a normal turn completion — the
dag-executor reuses one `AbortController` across every turn of a node, so
without this a long-running node would accumulate one dead listener per
turn.

**Audit of every provider's child-reap path**, per the coordinator's request:

- **Grok ACP** (`runGrokAcpTurn`) — was broken (above); fixed.
- **Grok `--single`** (`GrokProvider.singleQuery`,
  `packages/providers/src/grok/provider.ts:515`) — already correct: its
  `onAbort` listener is registered directly on `abortSignal`, independent of
  the generator's own `for await` loop. No fix needed; confirmed by reading
  the code, not assumed.
- **OMP RPC** (`packages/providers/src/community/omp/provider.ts:366-380`) —
  already correct; this is the reference pattern both ACP fixes now match.
- **DeepSeek ACP** (`runDeepseekAcpTurn`) — same architecture as Grok ACP,
  same bug; fixed identically.

**Tests.** The originally-committed fix's own regression test ("an abort
while stuck on an unanswered ACP request still reaps the child", both
providers) turned out **not to discriminate the actual bug**: it keeps the
turn generator parked inside its very first, still-in-flight
`gen.next()`/`Promise.race` call, which an in-loop race can still resolve —
it is why the first (broken) design passed this test and every other unit
test despite failing live. Added a second test for both providers, "a caller
that stops pulling after abort still gets the child reaped, with no further
`.next()` call": pulls one chunk, aborts, and deliberately never calls
`.next()` again — the exact shape `withIdleTimeout` produces. Verified each
new test **fails** against the original committed design (`git show
00358d16:<path>` swapped in temporarily, `child.signals` came back `[]` —
zero `SIGTERM` ever sent — for both providers) and passes against the
current one, before restoring the fix.

One deliberate, non-behavioral side effect: the thrown-error subtype on
DeepSeek's stuck-abort fallback path changed from a distinct `deepseek_aborted`
to the generic `deepseek_spawn_failed` any other unexpected mid-turn child
exit already produces (the reap now unblocks the turn by killing the child,
which resolves the same `death`-promise race an ordinary crash does, rather
than a bespoke throw). Traced before accepting: `isInterruptMarkedResult`
(`packages/workflows/src/dag-executor.ts:493-505`) also requires
`stopReason: 'aborted'`, which only the unrelated, unchanged `abortedResult()`
chunk (the graceful in-session cancel path) ever carries — `toDeepseekErrorResult`
never sets `stopReason` on a thrown error, so no classifier anywhere actually
branches on this specific subtype value. `deepseek_aborted` itself is
unchanged and still produced correctly by the graceful path.

**Live verification.** Real Grok subscription, a scratch workflow whose
prompt runs `sleep 60 && echo done` via Grok's own tool-call mechanism, on
the isolated scratch server. Dispatched, waited for the child to spawn,
called Abandon, and polled the exact PID every 200ms:

```
elapsed_ms=12    pid=15698 alive=yes
...
elapsed_ms=4927  pid=15698 alive=NO -- reaped
sleep_check_exit=1   # pgrep -fl "sleep 60" found nothing — no orphaned tool child either
```

The child reliably exits (~5-6.4s after Abandon across two runs — consistent
with `abortStuckGraceMs` (3s) plus `reapChild`'s own SIGTERM-then-SIGKILL
grace window, since Grok mid-`sleep` does not respond to the graceful ACP
cancel), and no orphaned `sleep 60` tool-call child survives either —
confirmed `pgrep -fl "grok agent"` and `pgrep -fl "sleep 60"` both return
zero matches after each run. DeepSeek was **not** live-verified: `dsh` is
installed in this environment but no DeepSeek credentials are configured
(no `DEEPSEEK_API_KEY`, no `assistants.deepseek` config), so a real,
long-running-tool-call reproduction is not possible here without fabricating
credentials. This is disclosed rather than silently skipped; the coordinator's
own instruction scoped live verification to Grok specifically ("verify live
by checking no `grok agent` process remains after Abandon") and DeepSeek to
a test-level guarantee ("add a test that the child exits on abort"), which is
met (see above).

## Extra scope (B) — a steered loop completed after one iteration although `until_bash` should have required two

**Investigation.** Reproduced and traced to the loop executor's existing,
documented turn/iteration model: a queued operator message drains as an
extra provider turn **inside the same iteration** it was delivered in, and
every completion channel (`until`/`until_bash`/`until_field`) re-evaluates
on that turn's output — this is intentional, existing behavior (comment
"#181" in the executor, and `loop-nodes.md`'s existing `until_bash` caution
block already documents two related timing-shift cases). A guidance turn's
own real work (e.g. writing the file `until_bash` checks for) can
legitimately satisfy the check within the same iteration it was queued in,
one iteration earlier than an author counting on exactly one evaluation per
iteration would expect. Surfaced this analysis to the coordinator before
treating it as closed, per the rule against silently resolving an ambiguous
engine-behavior question; the coordinator agreed it is intended behavior per
`#181` and `control-states.md` and confirmed closing it, no code fix.

**Fix.** None — the loop executor's behavior is correct and intentional.
Extended `loop-nodes.md`'s `until_bash` caution block to name this third
timing-shift case explicitly (queued guidance draining as an extra
same-iteration turn), so future authors are not surprised by it. Added a
pinning executor test, "a guidance turn that does real work can satisfy a
read-only `until_bash` within the same iteration," asserting exactly one
`loop_iteration_completed` event at `iteration === 1` after two provider
turns — so this behavior can never silently regress into the opposite (a
guidance turn no longer able to complete a loop on its own) without a test
failing.

## Verification

**Unit + component + executor tests.** Every `packages/{web,workflows,providers}`
suite touched by this report's commits:

```
packages/workflows: dag-executor.test.ts and related — all green (VQ8-1, B)
packages/web: steering-dock.test.ts, ComposerDock.test.tsx,
  ConsoleComposerDock.test.tsx, NodeRoom.test.tsx, ConsoleNodeRoom.test.tsx,
  execution-room-model.test.ts — all green (VQ8-2, 3, 4, 5)
packages/providers: 194 pass (full package.json `test` script, per-file
  invocations) — grok/acp-client.test.ts 26 pass, 0 fail;
  community/deepseek/acp-client.test.ts 43 pass, 0 fail (A)
```

Every new regression test was individually confirmed to **fail** against the
pre-fix code before the fix restored it — by temporarily reverting the
relevant source lines (VQ8-1, VQ8-3) or by swapping in the actual stale
`git show 00358d16:<path>` blob (finding A's two providers) — not just
written to pass against the new code.

`bun run --filter @archon/providers type-check`: clean. Root `bun x eslint .
--cache --max-warnings 0`: clean. `bunx prettier --check` on every touched
file: clean.

**Full `bun run validate`**: green (exit 0) after each commit group, most
recently after the finding-A follow-up (listener-leak fix + discriminating
tests, commit `db663de6`).

**Live real-provider verification.** Isolated server, real Claude (`haiku`)
and real Grok subscriptions. Scratch `ARCHON_HOME` at
`…/scratchpad/qa8-fixes-1790629390` (DB copied via `sqlite3 .backup`,
`config.yaml` + `credential-key` copied, the real `~/.archon/archon.db` never
written to), server on port 3348, Vite dev server on port 5216, a scratch
git repo with a local bare `origin.git` remote registered as the codebase,
every run dispatched over HTTP (`POST /api/codebases`, `/api/conversations`,
`/api/workflows/<name>/run`). The server was restarted once, mid-task, to
pick up the corrected Grok/DeepSeek provider source (it runs via plain `bun
src/index.ts`, no `--watch`, so a provider-package source edit does not take
effect until restart) — the stale, already-hung `grok agent` process left
over from the first (broken) live-verification attempt was confirmed dead
(`kill -9`) before the restart. Evidence: `evidence/qa8-fixes/` (3
screenshots — VQ8-1 both shells, VQ8-2 Console).

**Full e2e UI suite.** `cd e2e && bun run test:ui`, after
`bun run --filter @archon/web build` (the e2e harness serves the built
`dist`, and this report's four web commits postdate any prior build in this
worktree).

First full run (162 tests, single worker, 23.2 min): 2 failures.

1. `ui/task-dispatch-body.spec.ts` `responsive-legacy` — the exact test the
   round-7 report already documented as an environment-load flake (a
   200%-zoom bounding-box measurement, real timers, zero file overlap with
   this report's diff). Re-run in isolation: **passed** (6.1s, well under the
   10s timeout the failure hit under full-suite load).
2. `ui/workflow-transcript-display.spec.ts` `graph` ("Legacy runtime graph
   drops the minimap; controls, pan, zoom, fit, and selection remain") — new,
   not previously documented. Traced before dismissing: this report's diff
   never touches the graph's own pan/zoom/fit/minimap logic — the one file it
   touches with "Graph" in the name, `LegacyGraphLogsPane.tsx`, only threads
   a new `followingLive` prop to the room/composer beside an unmodified
   `renderGraph={renderGraph}` pass-through; the actual ReactFlow transform
   code lives elsewhere and is untouched. The failure itself is a CSS
   `transform` value polled after clicking "fit view" timing out at 10s
   against a `expect.poll`. Re-run in isolation: **passed** (3.9s). Same
   signature as the documented class of flake: a real-timer/geometry
   assertion that fails only under full-suite host contention and passes
   every time in isolation.

Second full run (code unchanged, immediately after): **158 passed, 0 failed,
4 skipped (22.8 min)**. Both previously-failing tests passed this time,
confirming both as environment-load flakes rather than regressions — neither
touches any file in this report's diff, and both reproduced zero times
across their isolated re-runs. The 4 skips are the same environment-gated
cases prior reports in this plan document
(`ui/workflow-env-overlay.spec.ts:24`, `ui/workflow-run-hitl.spec.ts`'s
`ask-authorization` and both `unowned-ask` cases), unrelated to this change.

The host carried real background load throughout both runs (`uptime`: load
average 4.2-5.3, 26 concurrent user sessions — other agents' work on this
same shared machine), consistent with the round-7 report's own documented
environment.

## Processes

Every process listed here was started by me, for this report:

- Scratch server (originally PID 82527, restarted mid-task as PID 80694,
  port 3348) and Vite (PID 66193, port 5216) — stopped at the end via their
  recorded PIDs; confirmed both ports free afterward.
- One stale `grok agent` process (PID 98651) left over from the first,
  broken live-verification attempt (30+ seconds before this report's fix)
  was killed (`kill -9`) before the server restart, once its non-reaping was
  already the confirmed evidence for finding A's root cause.
- Every `grok agent` process spawned during this report's live verification
  runs exited on its own via the fixed Abandon path; confirmed zero remain
  via `pgrep -fl "grok agent"` at the end.
- Ports 3317, 5187, 8791 (coordinator/mockup) were not touched.
- The real `~/.archon/archon.db`, `~/.archon/config.yaml`, and
  `~/.archon/credential-key` were only ever read (`.backup` / `cp`), never
  written to.

## Attribution note

The task brief's trailer read `Co-Authored-By: Claude Opus 5.5 (1M context)
<noreply@anthropic.com>`; this session's system reminder specified `Claude
Sonnet 5 <noreply@anthropic.com>` as the current attribution, overriding the
brief. Every commit in this report uses the Sonnet 5 trailer per the more
recent instruction. Flagging the discrepancy rather than silently picking
one.

One commit (`a35251b5`) is a **message-only amend** of the immediately
preceding, not-yet-pushed commit I had just made in this same session (to
add the missing attribution trailer) — no tree/diff change, same files. This
repository's stated convention prefers new commits over amends; noting the
one exception and why (fixing my own just-made mistake with zero risk of
losing work, versus leaving a commit without required attribution).

## Unresolved questions

1. **DeepSeek ACP was not live-verified** (no credentials configured in this
   environment). Unit-level coverage (including the discriminating
   parked-generator test) is complete and passing; a live check should
   happen whenever DeepSeek credentials are available in an environment that
   has them.
2. **Grok's Abandon-to-reap latency (~5-6.4s)** is longer than
   `abortStuckGraceMs` (3s) alone, consistent with Grok not responding to
   the graceful ACP cancel while mid-tool-call and the reap falling through
   to `reapChild`'s SIGTERM-then-SIGKILL window. Not a defect — the process
   does reliably die — but worth knowing if a tighter bound on real-world
   Abandon-to-dead latency is ever wanted.

Status: DONE

Summary: All five round-8 findings (VQ8-1 major, VQ8-2 major, VQ8-3 minor,
VQ8-4 minor, VQ8-5 cosmetic) are fixed at their root cause, covered by new
unit/component/e2e regression tests each individually confirmed to fail
against the pre-fix code, and live-verified against real Claude and Grok
subscriptions on an isolated server. The coordinator's two extra-scope items
are resolved: (A) the Grok and DeepSeek ACP child-process leak on Abandon is
fixed by moving the stuck-cancel reap to a plain, generator-independent
`abortSignal` listener (matching the OMP provider's already-correct
pattern), live-verified for Grok (0 processes remain, including any
tool-spawned child, after Abandon) and unit-verified for DeepSeek with a
test proven to discriminate the actual bug (not just the originally-shipped
test, which did not); (B) the suspected engine-correctness bug is confirmed
intended behavior per the executor's documented turn/iteration model,
closed with the coordinator's agreement, and pinned with a regression test
plus expanded documentation so it cannot silently regress.

`bun run validate` is green after every commit group in this report. The
full e2e UI suite (`cd e2e && bun run test:ui`) is green: **158 passed, 0
failed, 4 skipped** on the confirming second run, after tracing and
dismissing two isolated, environment-load-induced flakes on the first run
(both reproduced zero times across isolated re-runs, and neither touches a
file in this report's diff).

Concerns: DeepSeek's fix is unit-tested but not live-verified (no
credentials in this environment — see unresolved question 1).
