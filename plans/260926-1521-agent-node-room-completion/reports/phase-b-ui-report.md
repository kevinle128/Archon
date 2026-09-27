# Phase B-UI report — durable steering wire contract in both Node Room shells

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-a8316a854c5280f28`
Branch: `worktree-agent-a8316a854c5280f28`
Scope: continuation of a stalled prior agent's Legacy/Console composer-dock
rewrite onto the durable steering API (server draft, widened queue states,
per-item soft injection, auto-send). Nothing pushed.

## Commits

1. `feeb81f3` fix(web): adopt durable steering wire contract in both Node Room shells
2. `1af5c54b` Merge branch 'develop-2' into worktree-agent-a8316a854c5280f28 (Phases D, F1, F2 — no conflicts)
3. `8d5764ba` fix(web): correct stale draft-persistence hint and delete control glyph

SHAs are recorded in `develop-2/tasks/b-ui-sha.txt` (oldest first: `feeb81f3`
then `8d5764ba`) for the coordinator to cherry-pick or merge.

## Goal 1 — unblock the team (type-check + tests green)

The inherited worktree had 14 uncommitted files mid-rewrite: `@archon/web`
failed to type-check with 41 errors, all in
`ConsoleComposerDock.test.tsx` — an obsolete sessionStorage-era block
(`T2.1`–`T2.18`, `T4.8`–`T4.15`) still passed the removed
`writtenOperatorMessageIds`/`storage` props. The equivalent block in the
already-fixed `ComposerDock.test.tsx` (Legacy) had been rewritten to match
the new durable-queue model with identical helper signatures, so the fix
was a scoped splice: replace Console's stale tail (from the last surviving
test through EOF) with Legacy's rewritten tail, verbatim except for two
runtime-only follow-ups the splice exposed:

- Three Console assertions still expected a visible `sent` word on a
  `queued` row. `queueItemStatusLabel` (`packages/web/src/lib/steering-dock.ts:391`)
  now renders no per-item label until delivery — Legacy's twin tests had
  already been updated to `not.toContain('sent')`; ported the same fix.
- `ConsoleInspectPane.test.tsx`'s queue-read mocks (5 call sites) returned
  `{success, queued: []}` with no `execution_state`/`auto_send`/
  `capabilities` — fields `applyQueueSnapshot`
  (`packages/web/src/lib/steering-dock.ts:829`) now dereferences
  unconditionally, crashing `ConsoleComposerDock` on mount. Fixed all five.

Result: `@archon/web` type-check and `bun run test` both clean (1131 pass,
0 fail, 86 files); full monorepo `bun run validate` clean.

## Goal 2 — merge develop-2

`git merge develop-2` (Phases D, F1, F2) resolved with **no conflicts**.
Re-ran tsc + `bun run test` + full `bun run validate` post-merge — all
green.

## Goal 3 — audit the remaining Node Room completion scope

Per the brief, this was an audit of the prior 571-line-per-file rewrite
against contract/mockup, not a rebuild. Findings:

### Fixed

1. **Stale draft-persistence hint copy.** `STEERING_SEND_HINT`
   (`steering-dock.ts:143`) still read `'Cmd/Ctrl+Enter to send · this tab
only'` — a leftover from the sessionStorage era. The draft is now
   server-saved per operator (Story 7.2), so the hint now reads
   `'Cmd/Ctrl+Enter to send · saved for you'`, matching
   `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:1234`
   ("the interface says `saved for you` or equivalent server-persistence
   copy") and `EXPERIENCE.md:96`'s paired vocabulary (`saved to server` for
   the shared queue band, `saved for you` for the per-author draft). Fixed
   the same six test assertions across `ComposerDock.test.tsx`,
   `ConsoleComposerDock.test.tsx`, `ConsoleNodeRoom.test.tsx`,
   `NodeTranscriptPane.test.tsx`, and `steering-dock.test.ts`, plus the
   equivalent `SEND_HINT` constants and one `hasThisTabOnlyInBand` →
   `hasSavedForYouInBand` rename in four **e2e** specs
   (`agent-interrupt-redirect.spec.ts:71`, `agent-finished-iteration.spec.ts:39`,
   `agent-queue-guidance.spec.ts:63`, `agent-queue-convergence.spec.ts:366-432`)
   that would otherwise have broken on this same string. Verified live: see
   `us-005-console-460-generating-queue.png` below — the running app now
   shows `saved for you` on the field hint.
2. **Delete-control glyph.** `STEERING_DELETE_LABEL` (`steering-dock.ts:749`)
   rendered the literal word `'delete'`; the Steering Dock States mockup
   (`Legacy Node Room.dc.html:265`) shows a glyph-only `✕` button with the
   accessible name carried entirely by `aria-label`. Changed the visible
   glyph to `✕` and left `deleteButtonAccessibleName` (`delete · <message>`)
   untouched — it already matches `EXPERIENCE.md:102-104`'s sentence-case
   register, not the mockup's rough `'Delete: ' + t` placeholder binding.
   Updated the two dock test files' `deleteButtons()` helper to match by
   `aria-label` instead of visible text (was `'delete'`, now
   `'✕'` for the direct text assertion; the accessible-name assertions were
   already present and unaffected). No e2e spec matched on visible delete
   text — all use `getByRole('button', {name: /^delete ·/})`, unaffected by
   the glyph change. Prior value (`'delete'`) noted here for reversibility.

### Investigated, no change needed

3. **Per-row author attribution.** `LocalSentReceipt.operatorUserId`
   (`steering-dock.ts:46`) is carried through `applyQueueSnapshot` but never
   rendered in either dock's queue-row JSX. Story 7.3's acceptance criteria
   (`epics.md:1243-1272`) require the server to retain and return each
   entry's author (a storage/API guarantee, satisfied — `operator_user_id`
   is present on every queue item per the backend phase-b-report) but do
   not require the composer's own pending-queue band to display it. The
   mockup's "operator · kevin" attribution row (`Steering Dock States.dc.html`,
   "The operator in the record" section) is a **transcript** row, not a
   composer-dock row — see finding 5. No composer-dock change needed.
4. **"Stopping…" transient.** Verified present and correct in both shells:
   `ComposerDock.tsx:1232` and `ConsoleComposerDock.tsx:1238` both render
   `stopping ? 'Stopping…' : 'Stop'`. No gap.
5. **`sent`/`delivered` labels on operator transcript rows.** The mockup's
   "operator · kevin" rows (same section as #3) show a right-aligned `sent`/
   `delivered` word next to the author label, upgrading to `delivered` "only
   after a verified provider acknowledgement matches the stamped message
   id." This rendering slot **already exists** — `OperatorHistory` in
   `packages/web/src/components/workflows/NodeRoom.tsx:302-332` (and its
   Console twin, `ConsoleAgentHistoryList.tsx`) renders `operator ·
{displayName}` plus a `data-operator-delivery` span — but that span is
   hardcoded to the literal string `'sent'` (`NodeRoom.tsx:320`), and
   `LegacyNodeRoom.test.tsx:2746` locks in that exact value as current,
   intentional behavior. This was built by the develop-2 merge's Phase D
   (`99ee755f feat(workflows,web): persist and present thinking, prompt,
and advisor rows`), not by this phase, and is consistent with the
   backend's own state today: `capabilities.delivery_ack` is `false` for
   every built-in provider (phase-b-report.md), so no message can reach
   `delivered` in production yet regardless of client wiring. `messageId`
   is already threaded onto the `AgentHistoryItem` (`agent-history.ts:436`,
   sourced from `message.metadata.message_id`) — the same id the steering
   queue keys its `sent`/`delivered`/`delivery_unknown` states by — so a
   future pass could wire the two together by looking up each operator
   item's terminal queue state and passing it into `OperatorHistory`
   instead of the hardcoded string. Flagging as ready-to-build with this
   exact seam identified, not building it now: `NodeRoom.tsx`/
   `ConsoleAgentHistoryList.tsx` are Phase D's files, not this phase's
   `packages/web/src/components/workflows/ComposerDock*`/
   `packages/web/src/experiments/console/components/ConsoleComposerDock*`
   ownership, and the change needs its own design pass (how the dock's
   already-known delivery state reaches the transcript renderer) rather
   than a bolt-on under this audit.

### New finding — not fixed, flagged for the coordinator

6. **Legacy-only focus regression in `agent-idle-await-expiry.spec.ts`.**
   Running the existing e2e suite's `[V:steer.idle-await-queued-legacy]`
   scenario (E6 NEVER SENT cause) failed deterministically, twice in a row
   (once in the full idle-await run, once retried in isolation):
   `focus left the composer — Expected: "body", Received array: ["last-row",
"scroller", "alert", "never-sent-box"]` at
   `e2e/ui/agent-idle-await-expiry.spec.ts:691`. The identical assertion on
   `console` (same test body, parameterized by surface) passes. The test
   does no UI click on the delete control or anything else this phase
   changed; it only asserts that `focusLastRow()`
   (`NodeTranscriptPane.tsx:497`) — the pre-existing steering-dock focus
   fallback — actually lands focus somewhere sane when the composer
   disappears at idle-await expiry. `focusLastRow` depends on
   `NodeRoom.tsx:1194`'s `data-last-row` marking
   (`item.id === lastItemId ? {'data-last-row': '', tabIndex: -1} : {}`),
   the same function Phase D's `99ee755f` most recently touched (the only
   commit touching `NodeRoom.tsx` besides an unrelated todo-checklist fix).
   This is outside this phase's file ownership (`NodeRoom.tsx` is Phase D's
   transcript-row file, not the composer-dock wire contract), so it was not
   fixed here. Reproduction: `cd e2e && npx playwright test --grep
'steer.idle-await-queued-legacy'`.
7. **Pre-existing CLI e2e flake, reproduced, unrelated.** The same
   `bun run validate` run that exercised this phase's fixes hit
   `packages/cli/src/commands/provider-binding.e2e.test.ts`'s
   `--transform-file` subprocess test timing out once under machine load;
   retried in isolation it passed 9/9. This exact flake is already
   documented in `develop-2` commit `47aa43d8 docs(plans): note the
pre-existing CLI e2e flake seen during validation` — noted here only to
   confirm it recurred and is not this phase's regression.
8. **`agent-queue-convergence.spec.ts` still assumes sessionStorage
   drafts.** Sanity-running `[V:steer.converge-console]` after reapplying
   the hint-copy fix (see finding 1) failed at
   `e2e/ui/agent-queue-convergence.spec.ts:544` —
   `readDraftStorage(page, runId, nodeId)` (`agent-queue-convergence.spec.ts:311`)
   reads `sessionStorage.getItem(draftStorageKey(...))` directly and gets
   `null`, because the draft moved to the server (`GET`/`PUT`/`DELETE
.../draft`) as part of this same plan's backend phase, before this
   phase started. `readDraftStorage` is called 9 times in this one file —
   this is a structural staleness (the whole "multi-tab draft convergence"
   scenario needs to read the draft via the API instead of the browser's
   storage), not a copy-string fix, and it predates this phase's work. Not
   fixed here — flagged instead of attempted under time pressure, since a
   correct fix means reworking the scenario's assertions against the new
   draft transport, not a find/replace.

## Goal 4 — visual evidence, 8 mockup sub-states × 2 shells

The mockup's own state order (`Steering Dock States.dc.html`'s `ORDER`
array): `generating, interrupting, idle, again, finishedUndelivered,
finishedClean, failed, recovery`.

Six of eight states are already covered by the existing `e2e/ui/` Playwright
suite (built for earlier steering stories on the SAME durable contract this
phase adopted) — reused rather than rebuilt, per the brief's own preference
for the real app shell over a fixture render. The remaining two
(`finishedClean`, `recovery`) have no existing coverage: `recovery`
specifically is architecturally excluded from the formal suite's `archon`
fixture, which watches its own spawned server and tears the whole test down
the instant that process exits unexpectedly — exactly what a deliberate
mid-test kill+restart does. Both were captured with a standalone,
throwaway script (`playwright-core`'s `chromium.launch()` directly, no
`@playwright/test` fixture, no real credentials — an isolated
`ARCHON_E2E_FAKE_PROVIDER=1` server on a scratch port/home) mirroring the
backend phase's own manual-verification method for the same state. The
script was never committed; it lived in the session scratchpad only.

| #   | State                 | Console                                                          | Legacy                                                           | Method                                                                      |
| --- | --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `generating`          | `us-005-console-460-generating-queue.png`                        | `us-005-legacy-460-generating-queue.png`                         | live (`steer.interrupt-visual-*`)                                           |
| 2   | `interrupting`        | `us-005-console-460-interrupting.png` (+ reduced-motion variant) | `us-005-legacy-460-interrupting.png` (+ reduced-motion variant)  | live, route-held interrupt response (`steer.interrupt-visual-*`)            |
| 3   | `idle`                | `us-005-console-460-idle.png`, `us-005-console-1440-idle.png`    | `us-005-legacy-460-idle.png`, `us-005-legacy-1440-idle.png`      | live (`steer.interrupt-visual-*`)                                           |
| 4   | `again`               | `us-005-console-460-generating-again.png`                        | `us-005-legacy-460-generating-again.png`                         | live, Send-now-continues (`steer.interrupt-visual-*`)                       |
| 5   | `finishedUndelivered` | `e4-1-console-never-sent-2.png`, `e4-8-console-*-never-sent.png` | `e4-1-legacy-never-sent-2.png`, `e4-8-legacy-460-never-sent.png` | live (`steer.never-sent-visual-*`)                                          |
| 6   | `finishedClean`       | `finishedClean-console.png`                                      | `finishedClean-legacy.png`                                       | live, standalone script                                                     |
| 7   | `failed`              | `expired-queued-console.png`, `expired-empty-console.png`        | `expired-queued-legacy.png`, `expired-empty-legacy.png`          | live, 30-min idle-await expiry (`steer.idle-await-queued-*`)                |
| 8   | `recovery`            | `recovery-console.png`                                           | `recovery-legacy.png`                                            | live, standalone script — real server kill + restart, same ARCHON_HOME/port |

Evidence lives under two locations (existing specs write to their own
plan's evidence dir; the two new captures went to this phase's):

- `plans/260919-0139-issue-183-interrupt-and-redirect-claude-agent/reports/evidence/` (rows 1, 2, 4)
- `plans/260920-1136-issue-191-recover-never-sent-messages/reports/evidence/` (row 5)
- `plans/260920-1759-issue-192-fail-abandoned-redirect-after-30-minutes/reports/evidence/` (row 7)
- `plans/260926-1521-agent-node-room-completion/evidence/phase-b-ui/` (rows 6, 8 — new this phase)

Spot-verified against the mockup by reading each screenshot directly:
row 1 shows `QUEUED · 1` / `saved to server` band, `Stop` button, and the
corrected `saved for you` field hint; row 2 shows `Stopping…`; row 6 shows
a `completed` run with no composer/controls at all; row 8 shows the exact
`restored after server restart · Resume the workflow to continue`
disclosure with no field or controls, in both shells, byte-identical to
`STEERING_RECOVERY_DISCLOSURE`.

## Tests / validate

- `@archon/web` type-check: pass (post-merge, post-fix).
- `@archon/web` `bun run test`: 1131 pass, 0 fail, 86 files (post-merge, post-fix).
- Full monorepo `bun run validate`: pass, twice (once after the wire-contract
  fix, once after the hint/glyph fix) — the only failure seen along the way
  was the pre-existing CLI e2e flake (finding 7), reproduced once and
  confirmed a load-flake by an isolated retry (9/9 pass).
- Targeted e2e re-run after the hint/glyph fix: `steer.interrupt-visual-*`,
  `steer.never-sent-visual-*`, `steer.idle-await-*` (7 of 8 pass; the one
  failure is finding 6, unrelated to the hint/glyph change — verified by
  reading the failing assertion, which never touches either changed
  string).

## Unresolved / needs orchestrator attention

- Finding 6 (Legacy-only focus regression in idle-await expiry, traced to
  `NodeRoom.tsx:1194`, Phase D's file) needs an owner — not fixed here,
  outside this phase's file ownership.
- Finding 5 (wiring real per-message delivery state into
  `OperatorHistory`'s hardcoded `'sent'`) is ready to build: the
  `message_id` correlation key already exists on both sides
  (`agent-history.ts:436`, the steering queue's `message_id`); it needs a
  design decision on how the dock's delivery-state knowledge reaches the
  transcript renderer, and touches Phase D's files, not this phase's.
- Finding 8 (`agent-queue-convergence.spec.ts`'s sessionStorage-based
  `readDraftStorage`, 9 call sites) needs an owner for a structural rework
  onto the server-draft API — predates this phase, not fixed here.
