# Phase A report — room anatomy and accessibility

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-a9d9bfbcc4412721f`
Branch: `worktree-agent-a9d9bfbcc4412721f` (branched from `develop-2`)
Commits: `cad3655d`, `5449ba2d`, `ea57e4d9` (no push)

## Scope note

The scout report cited in the assignment (`plans/reports/scout-260926-1516-node-room-ui-gap.md`)
significantly understated what was already built. Epic 1/2 work — the queue band as a full-bleed
sibling section, the finished-iteration read-only dock, the never-sent reconciliation band, the
todo strip's collapsed glyph/progress-bar/count header, `aria-disabled` on Stopping, the
`role="status"`/`role="alert"` regions — already existed and passed their own tests before this
phase started. Phase A therefore ended up being an audit-and-patch pass over real, confirmed bugs
rather than a from-scratch build, plus the specific dock-visual affordances the task called out by
name (per-item Send now, Auto-send indicator, restart-recovery band).

## Story 3.1 — Match the approved Console and Legacy room anatomy

**Files:** `ConsoleNodeRoom.tsx`, `NodeTranscriptPane.tsx`, `ConsoleInspectPane.tsx`,
`LegacyGraphLogsPane.tsx`, `RunDetailPage.tsx`, `room-split-layout.ts`, plus their test files.

- **Anatomy order bug (confirmed and fixed).** The todo strip rendered _before_ the transcript
  scroller in both shells — the opposite of the approved order (header → scroller → todo strip →
  queue → dock). Existing tests asserted the wrong order as ground truth
  (`region.firstElementChild).toBe(strip)`); fixed the render order and updated those assertions
  to the correct one, matching the mockup's literal DOM order and README.md's anatomy list.
- **Width bug (confirmed and fixed).** The room panel was a user-resizable 24–60% split
  (`react-resizable-panels`) persisted to `localStorage`, not the approved fixed 520px
  (Console) / 460px (Legacy) width. Story 10.1's acceptance criteria and the interactive mockup
  markup (`width:520px;flex-shrink:0`, no drag handle) are unambiguous and mutually consistent, so
  I replaced the percentage split with a plain flex layout: the room panel gets a fixed pixel
  width and no drag handle; the main view pane fills the remainder. Legacy's separate
  narrow-viewport _vertical_ stack (graph/logs above the room, split by height) is an unrelated,
  pre-existing responsive behavior and was left untouched — it still resizes by height via the old
  percentage machinery. Removed the now-dead `roomRatio`/`onRoomRatioChange` prop chain from
  Console's `RunDetailPage.tsx` (Legacy's chain still feeds the surviving vertical-stack case).
  Measured in the real running app: Console room = exactly 520px, Legacy room = exactly 460px.

## Story 3.2 — Present todo state exactly as approved

**Files:** `ConsoleTodoStrip.tsx`, `TodoStrip.tsx`, `ConsoleAgentHistoryList.tsx`, `NodeRoom.tsx`,
`ConsoleNodeRoom.tsx`, `NodeTranscriptPane.tsx`, `console-isolation.test.ts`.

- Fixed the strip's separating border (`border-b` → `border-t`) now that it sits below the
  scroller instead of above it — the border must face the boundary it draws, not the boundary it
  used to draw before the anatomy fix.
- **New:** the latest todo-family tool row in the transcript now exposes the same folded checklist
  the pinned strip shows, instead of an empty expansion (todo-fold-contract.md: "the latest
  applicable row can expose the same folded inline checklist as the strip"). Extracted the
  checklist markup into an exported `ConsoleTodoChecklist`/`TodoChecklist` component so the strip
  and the inline row share one implementation and can never drift apart. Threaded a new optional
  `todos` prop through `ConsoleAgentHistoryList`/`NodeRoom` from the already-computed
  `agentHistory.todos`. Earlier todo calls still fold to a plain one-line row with no expandable
  body, matching the contract. Added `@/lib/todo-state` to Console's approved-imports allowlist in
  `console-isolation.test.ts` with the same "concrete need" comment style already used there.
- The collapsed strip's glyph + current-item + progress-bar-segments + count header, and the
  120ms chevron rotation with `motion-reduce:transition-none`, already existed and needed no
  change.

## Story 3.3 — Complete transcript interaction and accessibility behavior

No code changes were required beyond what 3.1/3.2 already touched. Verified rather than rebuilt:

- Manual disclosure state is `useState` local to each `ToolHistory`/row component, keyed by
  `item.id` (stable per tool call, not array index) at the parent map — a reader's open/closed
  choice survives live rerenders.
- `room-scroll-follow.ts` already implements pin-to-bottom-only-if-already-at-bottom for both
  shells; untouched.
- `role="status"` (polite) and `role="alert"` (assertive, for delivery failure) already existed in
  both composer docks; the new `recovery-required` band's disclosure line uses `role="alert"` for
  consistency with the existing `detached` band.
- `Stopping…` already used `aria-disabled`, never the native `disabled` attribute; unchanged.
- Reduced motion: the chevron rotations (todo strip, tool rows) and the dock's colour transitions
  already carry `motion-reduce:transition-none`; the new controls (per-item Send now) reuse the
  same `transition-colors motion-reduce:transition-none` class group.
- Minimum target sizes (`min-h-[32px]` dock controls, `min-h-[24px]` per-item controls) were
  already correct; the new per-item Send now button reuses the 24px class.

## Story 10.1 — Fix room geometry and execution selection

**Files:** `execution-room-model.ts` (+ test), `ConsoleRoomHeader.tsx`, `NodeRoomHeader.tsx`,
`ConsoleInspectPane.tsx`, `WorkflowExecution.tsx`, plus the width fix already covered under 3.1.

- **Root-caused and fixed the reported bug** ("run `9314eb315a98799cc08d8fbd3cbfa09c` node `plan`
  shows 'Node hasn't produced output'"). Traced it to `chooseExecutionForNode()` in
  `execution-room-model.ts`: its "no awaiting/running row" fallback picked the row with the
  highest `order` field with no regard for status. A workflow _resume_ writes a
  `node_skipped_prior_success` event for a node whose checkpoint already succeeded — a bookkeeping
  marker with a later `order` than the real work it stands in for, and zero transcript content.
  Fixed the fallback to prefer the latest row that is not `status: 'skipped'` (which covers
  `skipped`, `skipped_prior_success`, and `cancelled` in the existing status bucket), falling back
  to the literal latest only when every row is skipped. Verified live: node `plan` in the cited run
  now opens showing its real 21-minute Claude Opus transcript instead of an empty room.
- Added `capExecutionOptions()` (sorts by `order`, keeps the most recent 8) and wired it into both
  shells' header-option builders, satisfying CAP-6's "no more than eight executions."
- **Fixed a second confirmed bug:** the `Execution` `<select>` rendered unconditionally, even with
  exactly one option, directly contradicting Story 10.1's "Given a node has only one execution...
  the execution selector is absent." Gated the `<select>` on `options.length > 1` in both
  `ConsoleRoomHeader.tsx` and `NodeRoomHeader.tsx`. Two existing tests had asserted the old
  (incorrect) always-present behavior for a genuinely single-option node; updated them to assert
  absence, which is what CAP-6 requires.
- Verified live in the real running app, not just unit tests: `codex-final-fix` (a genuinely
  single-execution node in the cited run) renders no `Execution` `<select>` at all. Node `plan`
  turned out to also carry a `node_skipped_prior_success` duplicate row from the same resume that
  caused the original bug report, so it legitimately has two executions and correctly still shows
  the selector — with the default selection now landing on the real, content-bearing one (see the
  Story 10.1 root-cause fix above).
- Did not rename the header's bare-fallback "Attempt 1" wording (see Remaining mismatches).

## Outcome 6 — dock visuals the current backend can already drive

**Files:** `steering-dock.ts` (+ test), `ConsoleComposerDock.tsx` (+ test), `ComposerDock.tsx`
(+ test).

All three additions are gated behind new **optional** props that default to `false`/absent and
that no current caller sets — per the coordinator's explicit instruction, none of this invents
fake data; it only builds the rendering path a parallel backend phase can wire later.

- **`recoveryRequired?: boolean`** → new `SteeringDockMode` value `'recovery-required'`, checked
  ahead of every other precedence rule in `steeringDockMode()` since a server-confirmed signal
  should override `live`/`rowStatus` guesses. Renders the same full-width elevated band shape as
  the existing `finished`/`finished-iteration` read-only bands, showing the durable queue content
  (when any) plus the exact literal line `restored after server restart · Resume the workflow to
continue` (`STEERING_RECOVERY_DISCLOSURE`). No controls, no field — matches control-states.md's
  "recovery required" row.
- **`softInjectionAvailable?: boolean` + `onSendQueuedMessageNow?: (messageId) => void`** → a
  per-item "Send now" button on each queued message, rendered only while
  `softInjectionAvailable && agentMode === 'generating'` and only when the delivery handler is
  also supplied (a control that cannot act must not be drawn). Added
  `sendNowItemAccessibleName()`/`STEERING_SEND_NOW_ITEM_LABEL` to `steering-dock.ts` mirroring the
  existing delete-button pattern.
- **`autoSendEnabled?: boolean`** → the queue band header now always states
  `saved to server` (true today — the queue is already genuinely server-persisted, so this is not
  gated behind unbuilt capability) and appends `· Auto-send on` only when the prop confirms the
  durable auto-send setting is on. Added `savedToServerLine()` to `steering-dock.ts`.

## Tests

New/updated test files (all in `packages/web/src`):
`experiments/console/components/ConsoleNodeRoom.test.tsx`,
`experiments/console/components/ConsoleInspectPane.test.tsx`,
`experiments/console/components/ConsoleComposerDock.test.tsx`,
`experiments/console/console-isolation.test.ts`,
`components/workflows/NodeTranscriptPane.test.tsx`,
`components/workflows/LegacyNodeRoom.test.tsx`,
`components/workflows/LegacyGraphLogsPane.test.tsx`,
`components/workflows/ComposerDock.test.tsx`,
`lib/steering-dock.test.ts`.

New assertions cover: the corrected anatomy order, the fixed-width/no-drag-handle contract, the
`options.length > 1` selector gate, `chooseExecutionForNode`'s skip-preference (including the
all-skipped fallback), `capExecutionOptions`, the inline checklist on the latest todo row only
(both shells), the `recovery-required` mode and its precedence over `live`/terminal checks, the
per-item Send now visibility matrix (capability present + generating / capability absent / idle
after interrupt), and the `saved to server` / `Auto-send on` copy.

## Validate

`bun run validate` — **green** after each of the three commits (full monorepo: type-check, lint at
zero warnings, format check, and every package's test suite, including `@archon/web`'s six
isolated `bun test` invocations). Re-ran the full web suite after every source edit; final counts:
1031 + 51 + 18 + 665 + 53 + 1126 = 2944 tests, 0 failures.

## Screenshots

All in `plans/260926-1521-agent-node-room-completion/evidence/phase-a/`, captured against the
scratch DB (run `9314eb315a98799cc08d8fbd3cbfa09c`, codebase `ee0bbaa7891416b6d5059ef771e9097e`)
via a throwaway Playwright script (no browser-automation MCP tool was available in this
environment; `e2e/`'s `@playwright/test` dependency was used directly):

| File                                                                        | What it shows                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `console-real-plan.png`                                                     | Console, node `plan`: fixed 520px panel, real 21-minute Claude Opus transcript rendering after the selector fix (previously "Node hasn't produced output").                                                    |
| `console-real-ralph-loop-run.png`                                           | Console, node `ralph-loop-run` (loop): selector present with 4 exposed executions (≤ 8 cap), default landed on a content-empty duplicate — see known issue below.                                              |
| `console-real-codex-final-fix.png`                                          | Console, single-value node: full transcript with tool rows, badges, headlines.                                                                                                                                 |
| `legacy-real-plan.png`                                                      | Legacy, node `plan`: fixed 460px panel, same real transcript content as Console.                                                                                                                               |
| `legacy-real-ralph-loop-run.png`                                            | Legacy, node `ralph-loop-run`: same execution-selector behavior as Console.                                                                                                                                    |
| `mockup-console-generating-prompt.png`                                      | Approved mockup, Console shell, generating/prompt state, for anatomy comparison.                                                                                                                               |
| `mockup-console-generating-loop.png`                                        | Approved mockup, Console shell, generating/loop state — shows the full anatomy stack (scroller → todo strip → queue band with per-item Send now → composer dock) that Phase A's code now matches structurally. |
| `mockup-console-finished-undelivered.png`                                   | Approved mockup, finished/undelivered state (never-sent band).                                                                                                                                                 |
| `mockup-console-restart-recovery.png`                                       | Approved mockup, restart-recovery state — the reference for the new `recovery-required` dock mode.                                                                                                             |
| `mockup-legacy-generating-prompt.png` / `mockup-legacy-generating-loop.png` | Same states on the Legacy mockup shell.                                                                                                                                                                        |

Panel widths were also measured programmatically in the live app (not just visually): Console
room `boundingBox().width === 520`, Legacy room `boundingBox().width === 460`.

## Remaining mismatches vs. mockup, and why

1. **Duplicate execution-row representations for one physical loop event.** For
   `ralph-loop-run` in the cited run, the same cancellation produced two distinct `NodeExecution`
   rows: one `selection.kind: 'occurrence'` (no `loop_ancestry`, no messages) and one
   `selection.kind: 'loop_iteration'` (the real content). Neither is `status: 'skipped'`, so my
   skip-preference fix does not distinguish between them, and `chooseExecutionForNode`'s
   `latestByOrder` tie-break can land on the content-empty one. Verified live: selecting
   `Iteration 1` from the same dropdown shows the real tool-call transcript, so the underlying
   rendering is correct — only the _default_ pick among two duplicate rows for one event is wrong.
   This is a pre-existing data-modeling question (should `build-log-rows.ts` deduplicate an
   occurrence-kind row and a loop-iteration-kind row that share the same `occurrence_id`, and if
   so which one wins?) that is materially different from, and deeper than, the confirmed
   skipped-prior-success bug I was asked to fix. I did not attempt a fix here because it requires
   a scope decision (what counts as "one execution" for CAP-6 purposes) that belongs to whoever
   owns the occurrence/loop-iteration data model, not a silent judgment call during a visual-QA
   pass.
2. **Direct-URL deep link (`?node=<id>` on a fresh page load) did not open the room panel in this
   environment**, though clicking the same node from the Graph tab opened it correctly and the
   URL updated to the same `?node=` value either way. I traced this as far as confirming
   `applyRoomDeepLink()` and its calling `useEffect` in `RunDetailPage.tsx` are byte-identical to
   before Phase A (I only removed the unrelated `roomRatio` state from that file) — so this is not
   a regression from this phase's changes. I did not chase it further since it is not one of
   Phase A's four stories and reproducing it conclusively would need isolating it from the
   `react-router` `location.search` timing, which is a separate investigation.
3. **The `Execution` header select's bare fallback reads "Attempt 1"** for a first `occurrence`
   selection with no route/iteration/retry context (`execution-room-model.ts`'s
   `executionLabel()`). EXPERIENCE.md bans the word "Attempt" in the transcript's _occurrence
   headers_; whether that ban extends to this different control (the header's execution filter,
   not the transcript's occurrence header) is not stated by any of the four stories' acceptance
   criteria, and renaming it touches a well-tested, unrelated function with call sites beyond this
   phase's scope. Left unchanged; flagged for a scope decision rather than silently renamed.
4. **The queue band is not collapsible** in the current implementation (always expanded when it
   has content), while the mockup draws it with a `▾` disclosure toggle. This predates Phase A and
   was not in the task's explicit outcome list (which named per-item Send now, the Auto-send
   indicator, the "saved to server" copy, and the restart-recovery line specifically); left
   unchanged.

## Props awaiting backend data

All optional, default `false`/absent, exercised only by the new unit tests — no current caller
supplies a truthy value:

- `recoveryRequired?: boolean` (both composer docks) — needs a server signal that the live
  provider process was lost to a restart (CAP-14); no such signal exists in `api.generated.d.ts`
  yet.
- `softInjectionAvailable?: boolean` + `onSendQueuedMessageNow?: (messageId: string) => void`
  (both composer docks) — needs a provider-capability field (e.g. verified mid-turn delivery) that
  is not yet part of the provider capability matrix, plus the actual CAP-12 delivery endpoint.
- `autoSendEnabled?: boolean` (both composer docks) — needs the durable auto-send setting (Story
  7.5), which is not built.

## Cleanup

Stopped the API server (port 3318) and the mockup file server (port 8917) I started for visual
verification; did not touch the pre-existing dev servers on 3317/5187/3090/5173.

## Unresolved questions for the coordinator

- Should the duplicate occurrence/loop-iteration execution-row issue (item 1 above) be a follow-up
  ticket, and if so which phase/owner?
- Is the direct-URL deep-link-doesn't-open-room behavior (item 2) already known, or worth a
  dedicated bug report?
- Is renaming the header selector's "Attempt 1" fallback (item 3) in scope for a later phase, or
  intentionally out of scope?
