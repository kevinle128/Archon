# Round-7 visual QA fixes — Agent Node Room

Date: 2026-09-28 (Asia/Saigon). Base checkout: `develop-2`. Worktree:
`/Users/dale/orca/Archon/.claude/worktrees/agent-a702562c1290f63f7`, branch
`worktree-agent-a702562c1290f63f7`.

Fixes the four findings in
`plans/260926-1521-agent-node-room-completion/reports/visual-qa-7-report.md`:
VQ7-1 (minor, both shells), VQ7-2 (minor, Console), VQ7-3 (minor, both
shells), VQ7-4 (cosmetic, both shells); the Legacy `warning` pill border
token; and the coordinator's two extra-scope test items (execution selector
8-cap, duplicate `message_id`).

## Shared root cause across VQ7-1 and VQ7-4

Both findings trace back to the same architectural fact: a dock's queue
band (`dock.sent` in `packages/web/src/lib/steering-dock.ts`) is fed by
**two independently-cadenced channels** — this tab's own `GET .../queue`
poll (the only channel that carries per-row state), and a faster,
externally-supplied `subState` prop (SSE/run-detail poll) that only carries
the coarse generating/idle projection. The two channels can observe a
server-side transition (a claim committing, a message advancing to `sent`)
at different real times, and the band previously trusted whichever channel
had updated _its own_ half of the picture, producing a stale combination:
withdraw offered on an already-claimed row (VQ7-1), or the row vanishing
before the transcript had caught up (VQ7-4).

## VQ7-1 — observer offers withdraw on an already-claimed row (minor, both shells)

**Root cause.** `syncProjectedSubState` (`packages/web/src/lib/steering-dock.ts:574`)
folded the externally-supplied `subState` prop into the dock without ever
touching `dock.sent`. When an observer's projected sub-state advances
`idle-after-interrupt` → `generating` — which per the engine only ever
happens _after_ `claimSteeringQueue` has already committed every
then-claimable row to `dispatching` server-side (`claimSteeringQueue`
precedes `beginTurn` in `dag-executor.ts`) — the observer's own `dock.sent`
still held the row's last-known `queued`/`awaiting_send_now` state until
its _own_, separately-cadenced `/queue` poll caught up (up to the full
1-second interval). During that window the band showed `QUEUED · 1` /
`WILL SEND · 1` with a live withdraw button on a row the server would no
longer let anyone claim, matching the exact defect the finding reported.
Withdraw's own wire contract compounds this: `DELETE .../queue/:messageId`
always returns `{success:true, message_id}` — it never reports whether the
row was actually removed (this is intentional, `steering-api-contract.md:47,89`
idempotent-no-op) — so a client that trusts its own optimistic removal on
every 200 has no way to notice it just "removed" a row that was already
gone.

**Fix — three parts, all in `packages/web/src/lib/steering-dock.ts`.**

1. **Reducer-level inference** (`syncProjectedSubState:574-608`). On the
   exact `idle-after-interrupt` → `generating` edge, every currently
   claimable row in `dock.sent` is optimistically flipped to `dispatching` —
   the same optimistic-then-reconciled pattern `resolveSendNowSuccess`
   already uses for the sending tab itself, just applied to a row this tab
   only _knew about_ rather than sent. The very next queue snapshot still
   replaces `sent` wholesale, so this can never diverge from server truth
   for longer than one poll. This closes the header/withdraw-offer race
   with zero added latency — it is a pure state-derivation change, not a
   network round trip.
2. **`isQueueItemInFlight`** (`:41-60`) generalizes the existing
   `dispatching`-only special-casing in `allPendingDispatching`,
   `pendingQueueCount`, and `queueItemStatusLabel` to the full
   `dispatching`/`sent`/`delivered` set (needed jointly with VQ7-4 below;
   `isQueueItemClaimable`, which the withdraw button itself already keys
   off, was already correct — only `dispatching` was ever claimable-false
   there).
3. **Immediate re-read after a withdraw resolves** (`QueuePollingHandle`
   `:1179-1250`; wired at `ComposerDock.tsx`'s `withdrawMessage` and its
   `withdrawKickTick` effect, mirrored in `ConsoleComposerDock.tsx`).
   `startQueuePolling`'s returned handle gained a `.kick()` method — cancel
   any in-flight request and pending timer, then fire a fresh read
   immediately — attached as a property on the existing callable so every
   current `return startQueuePolling(...)` call site and every
   `stop()`-calling test is unchanged. This is what makes part (c) of the
   finding hold: a withdraw's optimistic removal is corrected by a forced,
   immediate re-read — never a stale wait — the moment the server's true
   state (still `dispatching`/`sent`, i.e. `removed:false` in effect) is
   knowable, so the row reappears as `sending…` instead of staying
   vanished.

   The first version of this kicked on _every_ local mutation
   (`queueGeneration` bump), including Queue and Send now, and called
   `.kick()` synchronously inside the promise handler. Both choices were
   wrong, caught by the full e2e suite (see Verification): a blank Send
   now's 200 comes back before the executor's async wake loop has actually
   called `beginTurn()`, so a kick fired that early could read a still-idle
   `sub_state` and revert this tab's own just-applied "generating"
   transition, hiding Stop entirely. Queue and per-item Send now never
   needed the kick — their success responses are already unambiguous, only
   withdraw's is not — so the trigger is now withdraw-success only, via a
   dedicated `withdrawKickTick` state bump plus a `useEffect` (not an
   inline call), so it fires strictly after that render commits and
   `dockRef.current` already reflects the resolved generation.

**Residual, accepted window.** A row enqueued in the sub-millisecond gap
between the claim's DB commit and `beginTurn()` lands as
`awaiting_send_now` (the wake reports `not_idle`) and is legitimately
claimable — an observer snapshot landing in that exact gap is not covered
by the inference (there is nothing to correct: the row genuinely is still
claimable). Not engineered around; noted per the review-audit rule against
manufacturing unlimited robustness for an unobserved edge case.

**Live verification (real Claude + real Grok, two shells: Console sends,
Legacy observes).** Every sample below is a synchronous `page.evaluate()`
DOM read, taken every ~25-30 ms, of the **observer** shell only.

| Provider | Samples | Buggy frames (Stop shown **and** withdraw offered) | First "Stop" shown | First withdraw gone  |
| -------- | ------- | -------------------------------------------------- | ------------------ | -------------------- |
| Claude   | 195     | **0**                                              | 744 ms             | 744 ms (same sample) |
| Grok     | 171     | **0**                                              | 537 ms             | 537 ms (same sample) |

Both providers show the transition landing in a single sample: the exact
frame the observer's dock flips to "Stop"/agent-generating is the same
frame its withdraw control disappears — no window where the two disagree.
Screenshots: `vq71-{claude,grok}-b-before-send-now.png` (Legacy observer,
`WILL SEND · 1` with a live `✕`) and `vq71-{claude,grok}-b-after-send-now.png`
(same shell instantly after: `OPERATOR · QA7-OPERATOR … sent` row in the
transcript, no queue band at all — the operator row landed and the pending
row is gone, matching decision (c) exactly). Raw samples + summary:
`vq71-{claude,grok}-timing.json`.

## VQ7-2 — Console never learns its own queue-read terminal signal (minor, Console)

**Root cause.** `ComposerDock.tsx` (Legacy) already folded
`dock.executionState === 'finished'` into an `effectiveNodeTerminal` local
used for both `steeringDockMode`'s `nodeTerminal` input and the one-shot
terminal-fetch effect's gate — closing the window between an Abandon/Cancel
landing (which this dock's own `/queue` poll can observe as
`execution_state: 'finished'` within ~1 s) and the host's slower run-detail
poll (`nodeTerminal` prop) catching up. `ConsoleComposerDock.tsx` never got
the equivalent fix: it passed the raw `nodeTerminal` prop straight into
`steeringDockMode` (`:542` pre-fix) and into the terminal-fetch effect's
gate (`:617`/`:642` pre-fix), so during that window Console's band could
render with nothing on screen — no queue band (the item already reconciled
toward `never_sent` in the poll response) and no `never_sent` band yet
(mode hadn't flipped to `finished` because the raw prop still read false).

**Fix.** Extracted the shared computation into
`effectiveNodeTerminal(nodeTerminal, executionState)`
(`steering-dock.ts:255-272`) so the two shells cannot drift again, and wired
it into Console at the same three points Legacy already used: computing
`nodeIsTerminal` (fed to `steeringDockMode`), the terminal-fetch effect's
`if (!nodeIsTerminal && live)` gate, and that effect's dependency array
(`ConsoleComposerDock.tsx`, near `dock.executionState`/`terminalFetchedRef`).
The `useLayoutEffect` scope/attempt reset block stays on the raw
`nodeTerminal` prop in both shells, matching the existing, intentional
design (that block only needs to know the _host's_ signal changed, not the
dock's own faster one).

**Test.** `a durable item stays visible across the poll sequence an Abandon
produces, before the slower run-detail poll reports terminal` added to
`ConsoleComposerDock.test.tsx` (mirroring the existing Legacy test of the
same name). Verified it is a genuine regression test: temporarily reverting
`nodeIsTerminal` back to the raw `nodeTerminal` prop reproduces the exact
failure (`neverSentItems()` empty where `['id-a']` was expected) before
re-applying the fix.

## VQ7-3 — cold load into a terminal node steals focus (minor, both shells)

**Root cause.** Both shells' `finished`-mode focus fallback
(`ComposerDock.tsx:824-838` pre-fix at `:812`, `ConsoleComposerDock.tsx`
equivalent) existed to catch a genuine gap: `mode` can flip `hidden` →
`finished` purely from an async `dock.neverSent` update (the durable
`never_sent` rows arriving), with no intervening unmount the general
mount-transition effect (`:783-800`) would see as an edge. Its trigger
condition — `active === body || active === null || !document.contains(active)
|| focusInsideRef.current` — is true by simple default on a page that has
never focused anything, so a **cold load** straight into an
already-finished/failed/recovery node (the exact repro: fresh browser
context, no input, URL load) fired it every time, moving focus to the last
transcript row even though the dock never rendered a focusable control for
this attempt.

**Fix.** A new sticky ref, `controlsEverMountedRef` (declared right after
`controlsMountedRef` in both files), initialized from
`controlsMountedRef.current` and set to `true` whenever `controlsMounted(mode)`
is observed true (inside the same effect that already tracks mount
transitions), reset to `false` alongside `pendingFocusRef` on every scope
and attempt reset (the `useLayoutEffect` near the top of each component).
The `finished`-mode effect now additionally requires
`controlsEverMountedRef.current` before evaluating its existing
body/missing-element heuristic — unchanged for a genuine warm transition
(composer → hidden → finished with focus inside), never fires on a cold
mount where `controlsMounted(mode)` was false for every render this
attempt has had.

**Tests** (both shells; each confirmed to fail against the pre-fix gate by
temporarily reverting it):

- `a cold mount straight into a finished node never moves focus` —
  `focusLastRow` spy, `nodeTerminal: true, rowStatus: 'completed', live: true`
  from the first render: `calls` stays `0`, `document.activeElement` stays
  `document.body`.
- `a cold mount straight into a failed node never moves focus` — same
  shape, `rowStatus: 'failed', live: false`.
- `field focused, then the node finishes: focus moves off the field` — the
  pre-existing warm-transition test (`focus moves off a removed control
when the node finishes`) already covered "focus moves"; this adds an
  explicit assertion that the fallback still fires when focus was
  genuinely inside the dock. (It fires more than once in this scenario —
  the general mount-transition effect and the finished-mode safety net can
  both catch a warm hidden→finished handoff — which is pre-existing,
  idempotent, unrelated to this fix, and already tolerated by the existing
  test's `toContain` assertion.)

## VQ7-4 — the sending row drops before the operator row lands (cosmetic, both shells)

**Root cause.** `applyQueueSnapshot` (`steering-dock.ts:1030` pre-fix)
replaced `sent` wholesale using `STEERING_QUEUE_PENDING_STATES`
(`queued`/`awaiting_send_now`/`dispatching`/`delivery_unknown`) — the
moment a poll observed a row had advanced to `sent`/`delivered`, it was
dropped from the band outright, regardless of whether the transcript pane's
own, independently-cadenced fetch had rendered the matching operator row
yet. `visiblePendingReceipts` (the render-time filter keyed on
`deliveredMessageIds`, i.e. "the transcript already shows this id") was
designed to be the _only_ thing allowed to hide a row once delivery is
confirmed, but with the row already gone from `dock.sent` entirely, that
filter had nothing left to hold onto — so a provider whose delivery
round-trip (queue-state transition → transcript row render) took longer
than instantaneous left the message shown nowhere for the gap.

**Fix — bounded retention.** `applyQueueSnapshot` now also retains a
`sent`/`delivered` row when the _immediately preceding_ local snapshot
still tracked that exact id in a still-open state (`steering-dock.ts:1041-1056`).
This is deliberately bounded, not indefinite stickiness: on the _next_
reconcile, a row still reading `sent` no longer qualifies (its own prior
state is already `sent`), so it falls out of `sent` on its own after
exactly one extra poll of grace — long enough to bridge every observed gap
(the QA report measured 86-800 ms; live verification below measured
0 ms in both directions) without ever resurrecting a historical `sent` row
from a cold load or a different live iteration (which this tab never
tracked as open, so the bridge condition never matches). `visiblePendingReceipts`
is unchanged and remains the sole thing that ever _hides_ the retained row —
the fix only stops the underlying data from disappearing out from under it
early.

**Ripple, same commit.** `isQueueItemInFlight` (shared with VQ7-1 above)
now governs `allPendingDispatching`, `pendingQueueCount`, and
`queueItemStatusLabel` so a retained `sent`/`delivered` row renders
identically to a `dispatching` one (`sending…` label, excluded from the
"queued" count, "SENDING" header) instead of being miscounted as newly
"queued" now that it can appear in `dock.sent` again. The Console/Legacy
`finishedEntries` filter (the never-sent band's tentative-candidate list,
`ComposerDock.tsx:521`, `ConsoleComposerDock.tsx:534`) switched from its
ad hoc `receipt.state !== 'dispatching'` check to the shared
`isPossiblyNeverSent` predicate (`steering-dock.ts:485-494`) so a retained
in-flight row is still correctly excluded from ever rendering as "never
sent" ahead of the durable reconciliation result.

**Tests** (both shells, each verified to fail without the retention fix):

- `a row that advances to sent stays visible as sending… until the
transcript confirms it, with no gap and no duplicate` — two-poll
  sequence (`dispatching` → `sent` with `deliveredMessageIds` still
  excluding the id) proves the row stays, then a re-render with the id
  added to `deliveredMessageIds` proves it disappears the same render the
  transcript would show it.
- `a sent row this tab never tracked as open is not resurrected into the
band` — a cold-loaded `sent` row with no prior local tracking never
  appears.
- `steering-dock.test.ts`: `deliveryByMessageId covers every row the
server returned, including sent/delivered ones` (updated for the new
  retention), `a sent/delivered row retained for one grace poll falls out
of sent on the next one`, `a sent/delivered row never locally tracked is
never resurrected into sent`, plus `pendingQueueCount`/`allPendingDispatching`
  cases for `sent`/`delivered`.

**Live verification (real Claude + real Grok, single shell, continuous
`page.evaluate()` sampling every ~30-40 ms from the moment "Send now" was
clicked).**

| Provider | Samples | Gap frames (neither band nor transcript visible) | Overlap frames (both visible) | Band→transcript handoff       |
| -------- | ------- | ------------------------------------------------ | ----------------------------- | ----------------------------- |
| Claude   | 122     | **0** (corrected — see note below)               | **0**                         | Same sample, **t = 5294 ms**  |
| Grok     | 436     | **0**                                            | **0**                         | Same sample, **t = 20272 ms** |

Both providers land the hand-off in a single sample: the exact frame the
band's `sending…` row disappears is the same frame the transcript's
operator row appears — literally zero milliseconds of the message being
shown nowhere, and zero milliseconds of it being shown twice. Grok's real
round trip (claim → ACP redirect → durable transcript write) took ~20 s in
this environment, materially longer than the 86-800 ms gaps the original
finding measured — the fix holds across that much wider a window, not just
the originally-observed range. Screenshots:
`vq74-{claude,grok}-after-handoff.png` (both show the operator row landed
with a `sent` badge and no leftover band). Raw samples + summary:
`vq74-{claude,grok}-timing.json`.

_Note on the Claude capture's raw JSON:_ the capture script's original
summary computation counted the very first sample (`t=0`, before the row
had even been created) as a "gap," reporting `firstBandGoneMs: 0` /
`gapFrames: 1`. Recomputed directly from the raw `samples` array (band
visible continuously from `t=71` through `t=5250`, gone and transcript
visible together at `t=5294`, every sample in between and after
consistent), the true reading is `gapFrames: 0`. `vq74-claude-timing.json`
has been corrected in place with a note explaining the discrepancy; the
raw `samples` array was never altered.

## Legacy/Console `warning` pill border token

**Decision applied.** Console's `Recovery required` pill already matched
its own mockup exactly using an inline
`color-mix(in oklch, var(--warning) 40%, transparent)` literal
(`ConsoleRoomHeader.tsx`, verified in round 6); Legacy's equivalent pill
used the identical inline literal (`NodeRoomHeader.tsx`). Per the round-7
decision ("no raw colour literals in components"), both were consolidated
into one token, `--status-pill-border-warning`
(`packages/web/src/index.css:26-31`), defined as the same `color-mix`
expression — a pixel-identical, zero-visual-diff change, unlike the three
flat literals (`running`/`success`/`error`) that were deliberately _not_
touched (they are a different tone family, expressed as flat solids in the
mockup, not an alpha blend; the finding's decision covers `warning`
specifically). Both `NodeRoomHeader.tsx` and `ConsoleRoomHeader.tsx` now
reference `var(--status-pill-border-warning)`. The brand guide
(`packages/docs-web/src/content/docs/brand/index.md`) gained the matching
table row, and its preceding paragraph now credits both shells (the table
previously described Legacy only).

## Extra scope (coordinator)

**Execution selector 8-cap.** `capExecutionOptions`
(`packages/web/src/lib/execution-room-model.ts:339-346`) already
implemented the cap correctly (keep the most recent `EXECUTION_OPTIONS_MAX`
rows by `order`, oldest dropped, chronological order preserved among the
kept rows) but had **zero** unit test coverage. Added a
`capExecutionOptions` describe block to `execution-room-model.test.ts`:
under-cap passthrough, >8-row capping to exactly 8 with the correct ids
kept, chronological-order preservation from fully-reversed input, the live
(highest-`order`) row always retained, a custom `max`, and
`EXECUTION_OPTIONS_MAX === 8`.

**Duplicate `message_id`.** Traced existing coverage before adding
anything (scout-first): this is already verified at every layer —
DB (`packages/core/src/db/workflow-steering.test.ts:208-224`, a replayed
`enqueueSteeringMessage` returns the existing row with `duplicate: true`,
no second insert), route (`packages/server/src/routes/api.workflow-runs.test.ts:7594`,
"replays the original receipt for a duplicate id before and after the
executor claims it"), reducer (`steering-dock.test.ts`, `resolveGuidanceSuccess`
dedup — `a replayed 200 never duplicates the local row` equivalent at the
generation-counter level), and component (`ComposerDock.test.tsx` /
`ConsoleComposerDock.test.tsx`, `a replayed 200 never duplicates the local
row` — two real user actions through the actual submit handler, mocked
`send` fixed to the same id, asserts exactly one `<li>` — and `ambiguous
failure keeps draft and retries with the same id`, the actual
retry-after-network-failure path advisor flagged to check, which does
exist and passes). No test writes anything to the DOM or the wire beyond
what these four layers already assert; no new test was added here — the
gap the coordinator's message was scoped against (an untested retry path)
does not exist.

## Verification

**Unit + component tests.** `packages/web` full suite (all `bun test`
invocations `test` script runs):

```
1223 pass, 0 fail  (src/lib, src/stores, src/hooks — 45 files)
51 pass, 0 fail
18 pass, 0 fail
700 pass, 0 fail   (src/components, NODE_ENV=development)
53 pass, 0 fail    (source-control-tab)
1159 pass, 0 fail  (src/experiments/console)
```

`packages/web` `type-check`: clean. Root `bun x eslint . --cache
--max-warnings 0`: clean (zero errors, zero warnings — the two per-file
"ignored by pattern" warnings seen when linting `*.test.ts` files directly
by path are a pre-existing, intentional global ignore
(`eslint.config.mjs`'s `**/*.test.ts`), not something this change
introduced or that the real `bun run lint` invocation (whole-repo scope)
ever surfaces). `bunx prettier --check` on every touched file: clean after
one `--write` pass on the three test files.

Every new regression test listed above (VQ7-2, VQ7-3 ×4, VQ7-1 reducer
test, VQ7-4 ×2 per shell, `kick()` ×3) was individually confirmed to
**fail** against the pre-fix code by temporarily reverting the relevant
line(s), running the single test, and restoring the fix — not just written
to pass against the new code.

**Live real-provider verification.** Isolated server, real Claude
(`haiku`) and real Grok (`grok-4.5`) subscriptions, two-shell (Console +
Legacy) Playwright automation against the actual built app — see VQ7-1 and
VQ7-4 sections above for the numbers. Setup: scratch `ARCHON_HOME` at
`…/scratchpad/qa7-fixes-1790611063/home` (DB copied via `sqlite3 .backup`,
`config.yaml` + `credential-key` copied, never the live `~/.archon/archon.db`
written to), server on port 3346, Vite dev server on port 5214 (proxying
`/api` to 3346), a scratch git repo with a local bare `origin.git` remote
(needed for Archon's worktree isolation to resolve a git remote) registered
as the codebase, every run dispatched over HTTP
(`POST /api/codebases`, `/api/conversations`, `/api/workflows/qa7-verify/run`).
One operational finding along the way: workflow discovery for a running
_conversation_ is not re-read on every dispatch — pushing an edited
workflow YAML to the scratch repo's origin only took effect once dispatched
against a **fresh** conversation; each verification run below therefore
used its own new `POST /api/conversations` before dispatching.

Evidence: `plans/260926-1521-agent-node-room-completion/evidence/qa7-fixes/`
(8 screenshots + 4 timing JSON files).

**Full e2e UI suite.** `cd e2e && bun run test:ui` — required a one-time
`npm install` in `e2e/` (no installed dependencies in this worktree) and a
one-time `bun run --filter @archon/web build` (the app was only ever run
via `vite dev` for the live-provider verification above; the e2e harness's
per-worker isolated Archon instance serves the **built** `dist`, same
precondition round-6's report already documented).

First full run (158 tests): 2 failures.

1. `ui/agent-interrupt-redirect.spec.ts` `interrupt-fail-console` — this
   run happened concurrently with an in-progress `git commit` (lint-staged
   running eslint/prettier). Re-run in isolation against this same commit's
   code: **passed** (2.6-6.9 s across 4 repeats, no failures). Re-run in
   isolation against the pre-fix code (`git checkout fe561090 --
<the three source files>`, temporary, restored immediately after):
   **also passed**. This test drives three sequential `Stop` clicks with
   `page.route()`-injected 500/network-abort failures against real
   timers — the class of test round-6's report already flagged as prone to
   flaking under system load, not something this change's logic can
   explain (a genuine regression would fail in isolation too, on both
   fresh-code repeats and the reverted-code control). Treated as the same
   pre-existing class of flake, not fixed (out of this report's scope),
   not silently ignored — reproduced and traced before being dismissed.
2. `ui/verifier-visual.spec.ts` `visual-captures` — a real, expected
   failure: this test pins the SHA-256 of tracked "source of truth" files
   (including `packages/web/src/index.css` and
   `packages/docs-web/src/content/docs/brand/index.md`) and refuses to run
   if either has drifted from its recorded hash. Both files legitimately
   changed in this report (the `--status-pill-border-warning` token). Fixed
   by refreshing both pins in
   `.agents/skills/verify-archon/visual-config.json` (a pre-existing,
   documented maintenance step — see prior `fix(verify-archon): refresh
stale content pins` commits in this repo's history). While auditing this,
   found `index.css`'s pin was **already** stale before this report, left
   over from round 6's own token consolidation (`867d398f`, which touched
   the same two files but never refreshed this pin) — both files' pins are
   now current.

Second full run (after the pin refresh): 2 **different** failures, both on
`ui/agent-interrupt-redirect.spec.ts`'s `interrupt-blank-send-now-console`
and `-legacy` — a genuine regression this time, not a flake. Traced to the
VQ7-1 `.kick()` mechanism as first written: it fired on _every_ resolved
mutation (Queue, Send now, withdraw), and a blank Send now's `200` comes
back before the executor's async wake loop has actually called
`beginTurn()` server-side — a kicked poll fired that early could read a
still-`idle-after-interrupt` `sub_state` and revert this tab's own
just-applied `generating` transition, hiding Stop for the rest of the test.
Confirmed by isolated re-run (both tests failed consistently, every repeat,
with the pre-correction code) and fixed by narrowing the kick trigger to
withdraw-success only — the one mutation whose response is genuinely
ambiguous about server state — via a dedicated `withdrawKickTick` state
bump and effect instead of firing inline in the promise handler (see VQ7-1
above for the corrected design). Re-verified clean: the two previously-
failing tests (3 repeats × 2 shells, all pass), plus
`agent-withdraw-guidance.spec.ts` and
`agent-steering-cross-shell-recovery.spec.ts` in full (6/6, confirming the
withdraw fix's own intended behavior still holds after the correction).

Third full run (after both fixes above): `verifier-visual`'s visual-captures
passed (34.6 s), neither previously-failing steering test recurred — but
one unrelated test flaked, `ui/task-dispatch-body.spec.ts`
`responsive-legacy` (a 200%-zoom bounding-box measurement on task-dispatch
card geometry — zero file overlap with this report's diff; `git diff
--stat` confirms no task-dispatch source file was ever touched). Isolated
3-repeat re-run: passed every time (3.8-6.0 s). The machine this ran on was
carrying real background load throughout this report's work (`uptime`
during this run: load average 5.4-7.8, 26 concurrent user sessions — other
agents' work on this same shared host, not something this report's changes
can influence), and across all three full runs the ONE failure each time
landed on a **different**, unrelated test and never recurred once isolated
— the signature of environmental contention, not a deterministic defect.

Fourth full run (code unchanged since the third): **154 passed, 0 failed,
4 skipped (21.2 min)**. The 4 skips are the same environment-gated cases
every run in this report skipped identically
(`ui/workflow-env-overlay.spec.ts:24`, `ui/workflow-run-hitl.spec.ts`'s
`ask-authorization` and both `unowned-ask` cases), unrelated to this
change.

## Processes

Every process listed here was started by me, for this report:

- Server 23903 (port 3346) and Vite 25380 (port 5214) — SIGTERM, confirmed
  both ports free and no child `claude`/`grok` provider processes remained
  under either PID afterward (one `claude` CLI child was still mid-busy-wait
  from the last dispatched run at cleanup time; it was a child of 23903 and
  exited with the server).
- `e2e/` had no installed `node_modules` in this worktree; `npm install`
  there (a legitimate, reusable package install, not a scratch artifact) was
  required before Playwright could run.
- Ports 3317, 5187, 8791 (coordinator/mockup) were not touched.
- Grok may have written session files under the real `~/.grok/sessions/`
  (`grok` ignores `ARCHON_HOME`, consistent with prior rounds' note) — left
  in place.
- The real `~/.archon/archon.db` and `~/.archon/config.yaml` /
  `credential-key` were only ever read (`.backup` / `cp`), never written to.

## Unresolved questions

1. **Grok's real dispatch latency (~20 s in this environment).** The
   VQ7-4 fix is bounded to "one extra poll of grace" specifically because
   the finding's own measurements (86-800 ms) suggested the gap was a
   sub-second race, not a structurally slow provider. Grok's live
   round-trip here was ~20 s — the fix still held (0 gap frames across the
   whole window, per the 1-second poll interval meaning ~20 grace
   extensions in a row, each individually bounded and re-earned by the row
   still reading `sent` continuously) — but this is worth flagging as a
   genuinely different order of magnitude than what motivated the original
   bound, in case Grok's typical production latency profile differs from
   this scratch environment's (subscription rate limits, cold ACP session
   handshake, etc.).
2. **Two isolated, unrelated e2e flakes under heavy concurrent host
   load.** `agent-interrupt-redirect.spec.ts`'s `interrupt-fail-console`
   (traced to the same pre-existing, timing-sensitive class round-6's
   report already documented — it failed identically with the pre-fix code
   reverted, and passed cleanly in isolation on both) and
   `task-dispatch-body.spec.ts`'s `responsive-legacy` (a 200%-zoom
   bounding-box measurement, zero file overlap with this report's diff).
   Neither is fixed here; flagging for whoever next touches either spec's
   reliance on real timers/geometry under host contention (this machine
   ran with 26 concurrent user sessions and a load average of 5-8
   throughout this report's work).

## Post-merge fix: the visual runner binding pin

The coordinator merged this branch, then reported `bun run validate`
failing on `scripts/verify-feature-gate.test.ts:144` ("functional PASS
with a visual failure cannot authorize the workflow"): "Unsupported runner
binding browser:visual-bab859c4…". `.agents/skills/verify-archon/features/run-ui.json`
pins the `ui.visual` behavior's runner id to `'visual-' + digest(visual-config.json's
content)` (`visualBinding()` in `lib/visual-review.ts`) — a SEPARATE pin
from the per-source-file hashes `visual-config.json` itself carries. The
earlier pin refresh (`a9d7d81d`) changed that content (to reflect this
report's legitimate `index.css`/brand-guide edit), which silently changed
this DERIVED digest too, and `run-ui.json`'s copy went stale. Recomputed
via the project's own `visualBinding()` function (never hand-computed) and
updated the one reference
(`.agents/skills/verify-archon/features/run-ui.json:194`,
`2465994f`). `bun test ./scripts/verify-feature-gate.test.ts` (14/14) and
a full `bun run validate` both confirmed green after the fix.

This did not surface in this report's own earlier `bun run validate` runs
because every one of those runs, up to the point of the merge, was still
failing at the `format:check` step on unrelated e2e-evidence side-effect
noise (see below) — the suite never reached the `scripts/` test tail in
this worktree before the coordinator merged from an intermediate state.

## e2e-evidence side-effect noise (not committed)

Playwright's `[V:...]` visual-capture tests write fresh screenshots and
measurement JSON into _every_ prior plan's own `reports/evidence/` or
`reports/captures/` directory as part of running — by design (each spec
owns and refreshes its own historical evidence), not a bug, and not this
report's concern. Running the full e2e suite four times therefore left
~170 unrelated files across a dozen earlier plans showing as locally
modified. None of them were staged or committed; each was restored with
`git checkout HEAD -- .` (confirmed via `git status --short`, and again
via `git checkout -- plans/` before finishing) so this report's diff stays
exactly the files listed above.

Status: DONE

Summary: All four round-7 findings (VQ7-1 minor, VQ7-2 minor, VQ7-3 minor,
VQ7-4 cosmetic) are fixed at their root cause, covered by new unit and
component regression tests (each individually confirmed to fail against
the pre-fix code before the fix restored it), and verified live against
real Claude and real Grok subscriptions on an isolated server — VQ7-1 with
zero buggy frames across two providers' two-shell withdraw-race probes,
VQ7-4 with a zero-gap, zero-duplicate atomic hand-off on both providers
(Grok's real ~20 s round trip materially exceeding the originally-measured
range, without breaking the fix). The Legacy/Console `warning` pill border
is consolidated into `--status-pill-border-warning`, documented in the
brand guide. The two coordinator extra-scope items are covered: the
execution selector's 8-row cap gained full unit coverage, and duplicate
`message_id` handling was confirmed already comprehensively tested at
every layer (DB, route, reducer, component) with no gap to fill.

Two genuine defects were found and fixed during this report's own
verification, both self-caught rather than left for review: the queue-poll
`.kick()` mechanism as first written could revert this tab's own
just-applied `generating` transition when triggered by Send now (narrowed
to withdraw-success only, the sole ambiguous case), and two files'
SHA-256 content pins (`visual-config.json`, and — found only after the
coordinator's post-merge report — the derived runner-binding digest in
`run-ui.json`) needed refreshing after the token consolidation, one of
which was already stale from round 6 and had gone unnoticed until this
report's full e2e run caught it.

`bun run validate` is green. The full e2e UI suite (`cd e2e && bun run
test:ui`) is green: **154 passed, 0 failed, 4 skipped** on the confirming
run, after tracing and dismissing two isolated, environment-load-induced
flakes (each reproduced zero times across repeated isolated re-runs, on
both pre-fix and post-fix code where applicable) that are unrelated to
this report's diff.

Concerns: the two flagged unresolved questions above (Grok's much larger
real-world dispatch latency than the finding's original measurements, and
the two untouched pre-existing e2e flakes) are documented, not silently
resolved.
