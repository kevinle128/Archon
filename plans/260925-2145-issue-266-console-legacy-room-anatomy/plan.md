---
title: 'Issue 266: match the approved Console and Legacy room anatomy'
description: 'TDD plan for Story 3.1: fixed 520px Console and 460px Legacy Node Room widths in desktop split mode, the approved transcript → controls → todo → queue → composer order in both shells, and proof that the two shells stay independent while rendering the same meaning.'
status: pending
priority: P1
effort: '5 phases · ~14h'
issue: 'https://github.com/kevinle128/Archon/issues/266'
branch: archon/thread-6983766e
tags: [issue-266, agent-node-room, story-3-1, web, e2e, feature]
blockedBy: []
blocks: []
created: 2026-09-25
mode: deep
tdd: true
verifiedAt: 4039a03d
---

# Issue 266: match the approved Console and Legacy room anatomy

## Goal and user outcome

An operator can open the same node in either Node Room shell and find the same
structure. On desktop, the Console room is exactly 520 CSS pixels wide and the
Legacy room is exactly 460 CSS pixels wide, and neither changes size until it is
closed. Top to bottom, both rooms show the header, the transcript scroller, the
occurrence controls row, the todo strip, the queue band, and the composer dock.
The lower bands never cover the last transcript row. Each shell keeps its own
markup and tokens and never imports the other shell's components.

## Requirement sources and resolved conflict

- Issue #266 and Story 3.1 in
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (lines
  887-910) are the requirements. No BMAD story file exists for 3.1, and none is
  created.
- Design authority: `DESIGN.md:537-541` fixes Console at 520px and Legacy at
  460px. `DESIGN.md:619` puts the occurrence navigator in a row that is a
  sibling of the scroller, not a child of it. `DESIGN.md:652` puts the queue
  band directly below the todo strip and directly above the composer dock.
  `EXPERIENCE.md:37` and `:138` pin the dock to the bottom of the panel.
  The UX folder is
  `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/`.
- **Conflict found.** The 2026-09-22 course correction (`epics.md:1660-1667`)
  calls Epics 1-9 historical records and gives the same width and order work
  (manifest M001 and M002) to Story 10.1, issue #265, which is `ready-for-dev`.
  Neither change exists in the code today.
- **Operator decision (2026-09-25).** Issue #266 delivers only the anatomy:
  fixed widths, vertical order, and shell independence. Issue #265 keeps the
  `Execution` selector work (M005, Story 10.1 Tasks 3-4). When this plan
  ships, `3-1-match-the-approved-console-and-legacy-room-anatomy` moves to
  `done` in `sprint-status.yaml`, as the issue's acceptance criteria require.
- Story 10.1 Tasks 1-2 and the geometry parts of its Tasks 5-7 are reused here
  as the detailed contract for M001 and M002. Phase 5 records the handoff so
  #265 does not implement them a second time.

## Acceptance criteria

| ID  | Measurable result | Proof |
| --- | --- | --- |
| AC1 | In desktop split mode (`useContainerSplitMode` returns `split`), the open Console room measures 520 ±1 CSS pixels. It shows no resize separator, and no content, rerender, or old `archon.run-room.ratio.console` value changes its width. | Unit test for the shared constant; `ConsoleInspectPane` split test; Playwright geometry in `workflow-run-hitl-room.spec.ts` |
| AC2 | In desktop split mode, the open Legacy room measures 460 ±1 CSS pixels, with the same no-separator and no-resize guarantees. | Shared constant test; `LegacyGraphLogsPane` split test; Playwright geometry |
| AC3 | In both shells, the room region's direct children appear in this order: transcript scroller, occurrence-controls row (only when present), todo strip (only when present), then the dock, with the queue band before the composer field inside the dock. Absent bands leave no empty block. | `NodeTranscriptPane.test.tsx`, `ConsoleNodeRoom.test.tsx`; Playwright box order in `agent-todo-strip.spec.ts`. Order authority: Story 3.2 AC1 (strip below the scroller, above queue and dock), Story 10.1 Task 2 (`transcript → occurrence controls → todo → dock`), and `DESIGN.md:652`. `DESIGN.md:619` puts the navigator at the region's bottom edge; Story 10.1 Dev Notes say the corrected written contract wins over an older mock or design line. |
| AC4 | With a long transcript, an expanded todo strip, and a queued message, the last transcript row can be scrolled fully into view above the todo strip's top edge. | Playwright in `agent-todo-strip.spec.ts` for both shells |
| AC5 | In single-pane mode (container narrower than 60rem), the room still uses the full available width, Back restores the primary view, and there is no horizontal overflow. | Existing single-mode unit tests kept green; narrow Playwright cases kept |
| AC6 | Legacy behaves like Console using only Legacy markup and tokens. Given the same run fixture, both shells render the same ordered regions and the same todo and queue meaning, and the Console isolation test still forbids `@/components` imports. | Paired order assertions in both room tests; `console-isolation.test.ts` |
| AC7 | Close focus restoration, query-driven opening, graph and Logs selection, run-change reset, scroll memory, scroll-follow, and the hidden main view in single mode are unchanged. | Existing unit and Playwright suites stay green |
| AC8 | Focused evidence is recorded in this plan's `reports/`, and the tracker entry moves to `done` only after every gate passes. | Phase 5 |

## Scope boundary

- **In scope:** `packages/web` (the shared geometry module, the two split
  owners, the two route owners, the two room bodies, their tests, and possibly
  `index.css`) plus the affected `e2e/ui` specs.
- **Out of scope (belongs to #265):** bounding the `Execution` selector to
  eight options, hiding it when there is one execution, choosing the live
  execution on one-to-two, and the selected-versus-live steering guard.
  Header components (`NodeRoomHeader`, `ConsoleRoomHeader`) are not changed.
- **Out of scope (belongs to Story 3.2):** todo folding, compact
  `todo updated` rows, and terminal todo treatment. This plan moves the strip
  but does not change what it contains.
- **Not allowed:** API, schema, migration, generated-type, dependency, or
  feature-flag changes. Run chrome, tabs, node lists, room titles, and the
  Close and Back action identities stay as they are. The generic resizable
  primitives (`components/ui/resizable.tsx`,
  `experiments/console/primitives/console-resizable.tsx`) stay because
  `source-control-split.tsx` and other callers still use them.

## Key design decisions

1. **Fixed width comes from one shared constant.**
   `room-split-layout.ts` becomes `ROOM_WIDTH_PX = { console: 520, legacy: 460 }`
   plus `roomWidthPx(surface)`. The ratio, clamp, percentage, and
   local-storage functions are deleted. Old `archon.run-room.ratio.*` keys are
   ignored and not migrated. `PanelPercent` stays exported from this module
   because the two resizable primitives still import it.
2. **Split mode is a plain flex row, not a panel group.** The main view is
   `min-w-0 flex-1`, and the room is a `shrink-0` sibling with an inline
   `width`. Both keep their current element ids (`legacy-run-view`,
   `legacy-run-room`, `console-run-view`, `console-run-room`) so the
   Playwright locators (`#id` / `[data-panel-id]`) and the scroll specs keep
   working. Single mode keeps its current behavior: the main view is hidden
   and the room fills the width. It can be rendered with the same flex
   structure, which lets the resizable group drop out of these two owners
   entirely.
3. **Legacy stacked orientation goes away with the panel group.**
   `useStackedViewport` (`max-width: 899px`) can only coincide with split mode
   (container ≥ 60rem) on non-default root font sizes. Phase 2 confirms this
   with a unit test on `modeForWidth`. If a stacked split remains reachable,
   stack the room below the main view at full width instead of dropping the
   case.
4. **Order is changed in markup only.** No state moves. The todo strip keeps
   its `key={resolvedScopeKey}`. Console's `RoomRegion allowOutsetFocus`
   keeps its value; Phase 3 checks that its focus ring still clears the strip
   now that the strip sits lower.
5. **Parity comes from paired tests, not shared components.** Each shell keeps
   its own JSX. Both room test files use the same order assertion helper shape
   on equivalent fixtures, and the Console isolation test remains the import
   guard.

## Phases

| # | Phase | Effort | Status |
| --- | --- | --- | --- |
| 1 | [Shared fixed-width geometry contract](./phase-01-shared-fixed-width-contract.md) | 1.5h | Pending |
| 2 | [Fixed-width split owners in both shells](./phase-02-fixed-width-split-owners.md) | 4h | Pending |
| 3 | [Approved vertical order in both room bodies](./phase-03-approved-vertical-order.md) | 3h | Pending |
| 4 | [Browser geometry and order evidence](./phase-04-browser-evidence.md) | 4h | Pending |
| 5 | [Quality gates, tracker, and #265 handoff](./phase-05-gates-tracker-handoff.md) | 1.5h | Pending |

Dependencies: 1 → 2. Phase 3 can run in parallel with Phase 2 because the two
touch different files. Phase 4 needs 2 and 3. Phase 5 needs 4.

## TDD policy

Each phase writes or changes its failing tests first, runs them to confirm they
fail for the expected reason (`bun test` from `packages/web`, with
`NODE_ENV=development` for component tests), then implements until they pass.
Never run root `bun test`. Replace old ratio assertions; do not weaken them.

## Docs impact

The only change visible to users is that the room can no longer be resized by
dragging. A grep of `packages/docs-web/src/content/docs` and `docs/` for
room resizing or the ratio found only historical implementation plans under
`docs/superpowers/plans/`. Those are stateful records, not evergreen docs, so
no docs update is planned. Phase 5 re-runs the grep before the PR.

## Risks and rollback

- **Screenshot drift.** Visual specs that pinned Console at 460px will change.
  Update only the pins whose geometry the approved width changes, and record
  each one in `reports/`.
- **Width budget.** At a 960px container, a 520px Console room leaves 440px
  for the main view. That is the approved trade-off, and below 960px the
  existing single-pane mode takes over.
- **Rollback.** The change is confined to `packages/web` and `e2e`.
  Reverting the merge commit restores the ratio layout. Stored ratio keys were
  never deleted, so the old behavior comes back intact.

## Unresolved questions

None. The overlap with #265 and the tracker conflict were resolved by the
operator on 2026-09-25.
