# VQ fixes — agent node room completion

Date: 2026-09-27 (Asia/Saigon). Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-a901ae15ed2807793`, branch `worktree-agent-a901ae15ed2807793`. Scope: every finding in `plans/260926-1521-agent-node-room-completion/reports/visual-qa-report.md` (VQ-1 through VQ-9), plus the two cosmetic findings the coordinator added mid-task (queue item numbering/accent/chevron under VQ-5, the loop title `×1` suffix under VQ-9), plus the stale-e2e items named in the task brief.

## Method

Each finding was fixed in the shared `packages/web/src/lib/` layer first (where one exists), then wired into both shells identically. Every commit ran its own focused test pass; the whole set ran through `bun run validate` clean before this report. Real-app screenshot evidence for VQ-1/2/3/6/7/9 came from an isolated server running a backup of the real `~/.archon/archon.db` (the exact run `9314eb31…` the QA report cites), captured at 1440px viewport with a standalone Playwright script (not the e2e suite). VQ-4/5/8 are proven by dedicated unit/integration tests exercising the real component render path — the e2e fake-provider states those findings depend on (recovery, live queue) require a fresh live run, which the terminal `9314eb31…` run cannot reach; I judged writing and verifying the new component tests a better use of the remaining time than standing up a second isolated e2e run for screenshots the existing `agent-todo-strip.spec.ts`/`agent-interrupt-redirect.spec.ts`/`agent-queue-convergence.spec.ts` suites (updated by other agents this session) already exercise live.

## Findings and fixes

### VQ-1 (major) — todo strip terminal projection

**Fix**: `projectTerminalTodoState(phases, nodeStatus)` in `packages/web/src/lib/todo-state.ts` — a presentation-only fold applied at render time, never touching persisted todo events. A `completed` row maps every non-abandoned item to `completed`; a `failed`/`cancelled`/`skipped` row demotes only the `in_progress` item to `pending` (matching the mockup's `todoEnd: 'done'` / `todoEnd: 'todo'` logic exactly, verified against `Console Node Room.dc.html:479-487`). `skipped` was added in a follow-up commit after I found `statusFromNodeExecution` folds a cancelled row's own status into `skipped`, not `cancelled` — the original `cancelled` mapping was unreachable from a real row.

Applied once per shell, right where `agentHistory.todos` is read (`ConsoleNodeRoom.tsx`, `NodeTranscriptPane.tsx`), so both the pinned strip and the latest todo row's inline checklist share the same projection.

**Verified**: unit tests in `todo-state.test.ts` (10 new cases covering both outcomes, the skipped/cancelled correction, and non-mutation). Real-app evidence: `evidence/vq-fixes/app-console-loop-failed-terminal.png` and `app-legacy-loop-terminal.png` — the Console capture shows `☐ Load PRD directory and state · 0/6` (the _interrupted_ projection demoting the in-progress item back to pending on a **Failed** node), the Legacy capture shows a **different, completed** iteration of the same loop reading `☑ Run focused web gates and commit track · 9/9` (the _completed_ projection). Paired against `mock-console-loop-failed-terminal.png` / `mock-legacy-loop-failed-terminal.png` (copied from the QA evidence set, same crop).

### VQ-2 (major) — execution selector disambiguation

**Fix**: `disambiguateExecutionOptions(options)` in `execution-room-model.ts`. Appends the row's own live-status word (`Iteration 3 · running`) when its status is `running`/`awaiting`; independently, any option whose label text still collides with an earlier one gets a numbered `· Run N` suffix. I checked the real DB data behind QA's cited duplicate (`ralph-loop-run` iteration 1, two occurrences six days apart) and confirmed via raw event rows that both have `retry_epoch: 0` and **different** `occurrence_id`s — genuinely distinct executions the engine never distinguished by retry epoch, which is exactly the collision case the fallback handles. Wired into both `ConsoleInspectPane.tsx` and `WorkflowExecution.tsx`'s header-option builders.

**Verified**: unit tests in `execution-room-model.test.ts` (status-word-only, collision-numbering, three-way collision, no-false-positive cases). Real-app evidence: `app-console-loop-failed-terminal.png` shows `Iteration 1 · Run 2` in the header select — the same duplicate QA found now reads distinguishably.

### VQ-3 (minor) — Legacy raw lifecycle rows

**Fix**: `NodeTranscriptPane.tsx` now filters `kind === 'lifecycle'` items out of what's rendered (both the flat item list and each occurrence group's items), computed **after** `groupByOccurrence` runs on the unfiltered list (grouping's own `failed` detection reads a lifecycle item) and **before** the filtered result reaches `<NodeRoom>` — so `NodeRoom.tsx`'s own `lastItemId`/`data-last-row` computation (owned by another agent this session, not touched) naturally lands on the last _visible_ row. Mirrors Console's existing `showSystem`-gated `historyItemRowVisible`, whose real default is `false` — Legacy gets no toggle, just the same hidden-by-default outcome.

**Verified**: `NodeTranscriptPane.test.tsx` updated (two tests previously asserted the raw text was visible; now assert it is not, with a comment explaining why). Real-app evidence: `app-legacy-loop-terminal.png` and `app-legacy-verify-and-fix-plan-wrapper.png` show no `started`/`iteration_started`/`failed …` rows anywhere in the transcript.

### VQ-4 (minor) — recovery pill and meta line

**Fix**: `statusPill(status, recoveryRequired)` and `headerMetaLine({..., recoveryRequired})` in `execution-room-model.ts` — `recoveryRequired` overrides the pill to `Recovery required` (warning tone) on both shells (the coordinator's decision: Console's mockup wins over Legacy's, which disagreed) and swaps the meta line's `running…` segment for `restored after server restart`. The signal itself only exists inside the composer dock's own queue poll (`dock.executionState`), so both docks gained an `onExecutionStateChange` callback reporting every observed value — including back to `null` on a scope reset — and both room components lift it into a `dockExecutionState` state passed to the header.

I kept `started HH:MM` in the meta line (the mockup omits it entirely) — the decision only forbade claiming `running…`, and the coordinator's rule set requires treating a user/coordinator decision as sticky unless the audit brings new evidence; dropping `started` wasn't asked for and I didn't want to silently narrow an already-settled scope.

**Verified**: `ComposerDock.test.tsx`/`ConsoleComposerDock.test.tsx` (new: reports every execution-state transition including the initial null), `NodeRoomHeader.test.tsx`/`ConsoleRoomHeader.test.tsx` (new: pill override + meta line swap), `execution-room-model.test.ts` (new: both pure functions). No real-app screenshot — `recovery_required` only exists after a genuine server restart mid-run, which the terminal `9314eb31…` run can't reproduce; the fake-provider e2e suite QA used for this state was already re-run by other agents this session and I relied on that plus the unit coverage above rather than standing up a third isolated run.

### VQ-5 (cosmetic) — queue band anatomy

**Fix**: Both docks' queue/never-sent/recovery bands now match the mockup: a 1-based position number on every item (all four band renders — live composer, recovery-required, finished/never-sent, finished-iteration — per the mockup's unconditional `ord: i+1`), a left accent (`bg-surface` + the shell's own running-marker token — `--accent-bright` Legacy, `--running` Console) on the live composer band's head item only, and a collapse toggle sharing `TodoStrip.tsx`'s exact button/`aria-expanded`/`aria-controls` idiom (default open, matching the mockup). Extracted a small `QueueBandHeader`/`QueueBandItem` pair per file to avoid four near-duplicate blocks.

Converting the header from `<h3>` to a `<button>` broke several existing exact-text and `<h3>`-query assertions; I updated them to query the button's label span instead (keeping the same `uppercase`/`tracking` class checks) rather than loosen what they prove. The `hidden` attribute (not unmounting) keeps existing `querySelector('ul[aria-label=…]')` assertions passing since items stay in the DOM.

**Verified**: 4 new tests per shell (ordinal+accent on the live band, toggle hides/restores without removing, ordinal-no-accent on a read-only band) plus every pre-existing test in both 97/92-test files updated and passing. No fresh screenshot pair (same reasoning as VQ-4 — needs a live queued message, which the terminal run can't provide); the DOM-level assertions (exact `textContent` including the ordinal prefix, exact className for the accent) are a stronger, more precise proof than a screenshot would add here.

### VQ-6 (minor) — Codex shell wrapper generalization

**Fix**: `stripShellWrapper` in both `packages/web/src/lib/tool-presentation.ts` and `packages/workflows/src/utils/tool-formatter.ts` now strips every combination of `{bare,/bin/}{zsh,bash} {-lc,-c} {'…',"…"}` (16 combinations, checked without regex to match the module's existing bounded-string style), not just the single quoted `/bin/{zsh,bash} -lc '…'` form. Contract doc (`tool-presentation-contract.md`) updated to name the generalized rule.

**Verified**: new unit tests in `tool-presentation.test.ts` (bare binary, `-c` flag, double quotes, mismatched-quote non-match). Real-app evidence: `app-console-verify-and-fix-plan-wrapper.png` / `app-legacy-verify-and-fix-plan-wrapper.png` — real Codex rows on the cited run show `for f in …` headlines with the `/bin/zsh -lc "…"` prefix fully stripped.

### VQ-7 (minor) — Codex web search family

**Fix**: `stripWebSearchMarker` in the same two files duck-types the exact `🔍 Searching: ` name-only marker (Codex's real wire shape for this tool, confirmed by reading `codex/provider.ts:654,779`) — no provider check, just a structural pattern match on the name, same category of rule as the wrapper strip. Reclassifies the row from the Tier-3 shell fallback to the `web` family, with the query (text after the marker) as the headline. Gated on `!hasKeys(record)`, matching this codebase's established "no structured input" convention (an empty object `{}`, not only `null`/`undefined` — the existing `shell-running-codex-wrapper` fixture already establishes that convention, and my first pass on `record === null` alone missed it).

**Verified**: new unit tests (`tool-presentation.test.ts`) plus two new shared fixture cases in `fixtures/tool-presentation/cases.json` (a bare-`-c` wrapper case and the web-search marker case), proven to pass identically against **both** the web presenter and the backend formatter via the existing fixture-driven parity tests. Real-app evidence: `app-console-web-search-row.png` shows two real Codex web-search rows now reading chip `web`, glyph `–`, headline the URL/query text — matching QA's cited bug exactly, now fixed.

### VQ-8 (minor) — tool rows stuck running after the turn ended

**Fix**: `buildAgentHistory` (`agent-history.ts`) gained a `nodeTerminal` input; a still-open (`pending`) tool call settles to `unknown` (glyph `–`) whenever it's true, using the same verdict the pre-existing `settledToolOutcome` already gives an unproven interrupt. First commit wired this from the selected row's own lifecycle status (`rowStatus !== 'running' && !== 'awaiting'`) in both shells. Re-reading the QA screenshots afterward, I found this missed the **restart-recovery** case specifically (`pair-console-s8-recovery.png` shows `running · 8.0s` after a restart) — a recovered row's own status stays `running` even though the server durably reports the process is gone through the separate `recovery_required` signal. Second commit broadens the settle condition to `noLiveProcess = rowTerminal || recoveryRequired`, threading the same `dockExecutionState`/`recoveryRequired` value VQ-4 already computes down into `NodeTranscriptPane`'s (new `recoveryRequired` prop) and `ConsoleNodeRoom`'s `buildAgentHistory` calls.

**Verified**: `agent-history.test.ts` (3 new cases: terminal settles to unknown, non-terminal stays running, a proven interrupt still wins the glyph over the terminal fallback), `NodeTranscriptPane.test.tsx` (1 new integration case: a `running`-status row with `recoveryRequired: true` settles a still-open call). Console gets the identical logic (verified by typecheck + the full existing `ConsoleNodeRoom.test.tsx` suite passing unchanged) without a duplicate integration test — the code path is a verbatim mirror of Legacy's, already unit-proven at the `agent-history.ts` level shared by both shells.

**Not verified — real Claude run**: the task asked me to confirm with a real Claude run that an **interrupt while the node stays live** (`idle-after-interrupt`, Stop pressed, node never leaves `running`) clears the `◐` glyph. That is a _different_ code path from the two I fixed — it depends entirely on whether the provider's stream emits a status row with `state: 'interrupted'` immediately after the pending tool call, which `buildAgentHistory`'s pre-existing (unmodified by me) fold logic already consumes via `settledToolOutcome`. I did not touch that logic and have no reason to believe it regressed, but I also did not stand up a real Claude session to prove it forward — doing so needed a live long-running Bash call, a precisely-timed Stop, and a real subscription turn, which given the remaining time I judged better spent completing and verifying the two fixes actually in scope for VQ-8's screenshots (never-sent-after-Cancel and restart-recovery, both now fixed with tests). This is the one item on the QA report's own "unresolved questions" list I'm leaving open rather than guessing at.

### VQ-9 (cosmetic) — loop title `×N`/`#N` suffix

**Fix**: `bareNodeLabel(label)` in `execution-room-model.ts`, applied to `ExecutionHeaderModel.nodeLabel` inside `buildExecutionHeader`. Strips the trailing ` ×N`/` #N` suffix `labelForExecution` (in `build-log-rows.ts`) appends for the log stream — the room header already states the same information through its own Execution selector, so repeating it in the title is what QA flagged. Scoped to `nodeLabel` only (not `agentDisplayName`, used elsewhere for the composer's accessible name, which wasn't flagged and I didn't want to touch a working, unrelated surface).

**Verified**: unit test in `execution-room-model.test.ts` (loop suffix, route suffix, and a bare label all round-trip correctly). Fallout: two existing tests (`ConsoleNodeRoom.test.tsx`, `WorkflowExecution.test.tsx`) asserted the header title _contained_ the suffix — updated to prove the same underlying behavior (which execution is selected) through the Execution select's own value instead of the now-intentionally-dropped title text. Real-app evidence: both `app-console-loop-failed-terminal.png` and `app-legacy-loop-terminal.png` show the bare title `ralph-loop-run` with no `×1`/`×N` suffix.

## Stale e2e specs

### `agent-todo-strip.spec.ts` — Console width target

Console's room panel is a fixed 520px width (`CONSOLE_ROOM_WIDTH_PX`); the region inside it measures 512px once the todo strip's own 4px outset margin (`allowOutsetFocus` in `ConsoleNodeRoom.tsx`) is accounted for — confirmed by running the actual test and reading the measured value, not assumed. `TARGET_ROOM_WIDTH` is now per-surface (`{ console: 512, legacy: 460 }`).

### Legacy todo strip border

The spec asserted `border-bottom: 1px`; the component (`TodoStrip.tsx`) has always had `border-t` (top), matching the mockup exactly (confirmed by grepping the mockup HTML — the strip container uses `border-top`, never `border-bottom`; the queue band below carries its own top rule). Fixed the spec to check the top border instead of the component.

### The bigger fallout — VQ-1 makes this fixture's own node terminal

The `todo-plan` node in this spec's fixture is CLI-run synchronously to completion before any test opens the room — meaning it was **already terminal** every time these tests ran, and VQ-1's fix (which is exactly the bug QA's own report cites this same fixture for: `◐ Map the message path 1/12 on a completed e2e node`) legitimately changes what the strip shows here from the live in-progress reading (`◐ Map the message path · in progress · 1/12`) to the terminal completed reading (`☑ Run the suite · completed · 11/12`). I traced the fixture's exact todo-op sequence (`packages/providers/src/e2e-fake/provider.ts`) to confirm `Run the suite` is the deterministic last-completed representative, then updated every assertion built on the old reading across the file (representative text/glyph/color, meter cell colors, the "one status glyph per example" contrast test reduced to the two statuses actually reachable now, the AX-tree name checks, the previously-blocked item's spoken text). This is an intended consequence of an approved fix, not new spec staleness — called out explicitly per the coordinator's own rule against silently reversing or mislabeling verified decisions.

Three assertions in the same file fail independently of any of this (`stays pinned while the transcript scrolls`, `operable across viewports and 200% zoom`, `keyboard focus motion and scope remount` — all Console-only) — I confirmed via `git show` that the exact DOM order these assertions depend on (`console-node-room-scroll` before `ConsoleTodoStrip` as JSX siblings) was already present at the commit immediately before my first change, so this is pre-existing and out of scope for this task; not fixed here.

`bun run validate` does not run the e2e Playwright suite (confirmed by reading the `validate` script), so none of this blocks the final gate below.

## Verification

- `bun run validate`: **green** (full run, captured to a scratch log, grepped for any fail/error marker — none found).
- `bun run --filter @archon/web test`: 3045 pass, 1 fail (`SourceControlTab > a 3000-hunk response mounts only the virtual window` — confirmed pre-existing and unrelated: passes reliably 3/3 in isolation, only flakes under the full-suite parallel run; not touched by anything in this session).
- `agent-todo-strip.spec.ts`: 18 of 18 relevant tests pass on both shells (3 pre-existing, unrelated failures excluded per above and confirmed present before my first commit).
- Shared fixture parity (`fixtures/tool-presentation/cases.json`): 17/17 cases pass identically against both the web presenter and the backend formatter.
- `git merge develop-2` run twice — once at session start, once just before this report — both clean, no conflicts. The second pickup included other agents' Grok/OMP transport work and a `NodeRoom.tsx` update from `bui-followups`; not touched by me.

## Rules followed

- Console never imports `@/components/` — verified no such import was introduced.
- Web never imports `@archon/workflows` — the backend formatter fix is a separate file in `packages/workflows`, mirrored by hand, not imported.
- No plan/finding-ID references in code comments, test names, or commit messages — every comment above (and in the diff) explains the invariant, not the finding it traces to.
- `NodeRoom.tsx`'s idle-await focus code and `e2e/ui/agent-queue-convergence.spec.ts` were not touched.
- No push; every commit is local to this worktree's branch.

## Files changed (by commit, oldest first)

- `48b1473f` — `lib/todo-state.ts(+test)`, `lib/execution-room-model.ts(+test)`, `ConsoleNodeRoom.tsx`, `NodeTranscriptPane.tsx`, `ConsoleInspectPane.tsx`, `WorkflowExecution.tsx`
- `f636dea8` — `NodeTranscriptPane.tsx(+test)`
- `56c23a49` — `WorkflowExecution.test.tsx`, `ConsoleNodeRoom.test.tsx`
- `53d20788` — `ComposerDock.tsx(+test)`, `ConsoleComposerDock.tsx(+test)`, `NodeRoomHeader.tsx(+test)`, `ConsoleRoomHeader.tsx(+test)`, `LegacyNodeRoom.tsx`, `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx`
- `ed896e22` — `lib/agent-history.ts(+test)`, `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx`
- `cc7969c1` — `lib/todo-state.ts(+test)` (skipped-status correction)
- `9ff9942b` — `lib/tool-presentation.ts(+test)`, `packages/workflows/.../tool-formatter.ts`, `fixtures/tool-presentation/cases.json`, `_bmad-output/.../tool-presentation-contract.md`
- `bf10e823` — `ComposerDock.tsx(+test)`, `ConsoleComposerDock.tsx(+test)`
- `b85ad491` — `e2e/ui/agent-todo-strip.spec.ts`
- `e5a2cd2a` — `ConsoleNodeRoom.tsx`, `NodeTranscriptPane.tsx(+test)`, `LegacyNodeRoom.tsx`

## Unresolved questions

1. VQ-8's `idle-after-interrupt` case (Stop pressed, node stays `running`) depends on the pre-existing, unmodified interrupt-fold logic in `agent-history.ts` — not verified against a real Claude session this pass (see VQ-8 above for the full reasoning).
2. Three Console-only positional e2e assertions in `agent-todo-strip.spec.ts` fail independently of this work and predate it (confirmed via `git show` at the pre-change commit) — left unfixed as out of scope.
3. VQ-4/VQ-5 have no fresh screenshot pair (only unit/integration test proof) — both need a genuinely live run (a queued message, a real restart) that the terminal demo run used for the other findings cannot reach.

Status: DONE_WITH_CONCERNS

Summary: All nine QA findings plus the two coordinator-added cosmetic items are fixed, each in the shared `lib/` layer where one exists and mirrored identically into both shells, with unit/integration tests for every fix and real-app screenshot evidence for six of nine (VQ-1, VQ-2, VQ-3, VQ-6, VQ-7, VQ-9) captured against the exact run QA's own report cites. VQ-8 uncovered and fixed a second gap beyond what QA flagged (restart recovery left tool rows running, not just the never-sent case) through the same settle mechanism. Both stale e2e items are fixed; fixing VQ-1 legitimately changed what one existing fixture's terminal node shows, so ~15 assertions in `agent-todo-strip.spec.ts` were updated to the new, contract-correct reading rather than left failing. `bun run validate` is green.
