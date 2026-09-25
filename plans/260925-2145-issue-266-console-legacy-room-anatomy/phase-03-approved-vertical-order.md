---
phase: 3
title: 'Phase 3: Approved vertical order in both room bodies'
status: pending
priority: P1
effort: '3h'
dependencies: []
---

# Phase 3: Approved vertical order in both room bodies

## Goal

Both shells render their room region in the approved order: transcript
scroller, then the occurrence-controls row, then the todo strip, then the dock.
Inside the dock the queue band sits above the composer. Each shell keeps its
own markup and tokens.

## Evidence (verified at 4039a03d)

- Legacy `NodeTranscriptPane.tsx:646-651`:
  `<RoomRegion>{todo}{scroller}{controls}<ComposerDock…/></RoomRegion>`. The
  scroller (`:561-566`) is `flex min-h-0 flex-1 flex-col overflow-y-auto`, and
  `controls` (`:627-634`) holds `Jump to` and `Jump to latest`.
- Console `ConsoleNodeRoom.tsx:1126-1164`:
  `<RoomRegion allowOutsetFocus={showTodoStrip}>{ConsoleTodoStrip}{scroll div}{controls}{ConsoleComposerDock}</RoomRegion>`.
  The scroll div is `min-h-0 flex-1 overflow-y-auto`.
- The queue band is already inside both docks, before the textarea
  (`ComposerDock.tsx:773,817` then `:892`), so the approved queue → composer
  order already holds inside the dock.
- The current tests pin the old order: `NodeTranscriptPane.test.tsx:1236` and
  `ConsoleNodeRoom.test.tsx:2968` expect `strip.nextElementSibling === scroller`.
- **Order authority.** Story 3.2 AC1 puts the strip below the scroller and
  above the queue and dock. Story 10.1 Task 2 fixes
  `transcript → occurrence controls → todo → dock`. `DESIGN.md:652` puts the
  queue band below the strip and above the composer. `DESIGN.md:619`
  describes the navigator row at the region's "bottom edge", which predates
  the todo move; Story 10.1 Dev Notes say the corrected written contract wins
  over an older mock or design line.
- `EXPERIENCE.md:247`: the todo strip label is an `h3`, and the heading
  outline does not change with position.

## Files

- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`,
  `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Tests: `NodeTranscriptPane.test.tsx`, `ConsoleNodeRoom.test.tsx`,
  `packages/web/src/experiments/console/console-isolation.test.ts` (read only;
  it must stay green)

## TDD steps

1. **Red: order, both shells.** Replace the two
   `strip.nextElementSibling === scroller` assertions with a full order check
   on the room region's element children:
   - With a fixture that has todos, two or more occurrence groups (so
     `Jump to` renders), and a live dock, the child sequence is
     `[scroller, controls, strip, dock]`. Identify each child by its existing
     test id or role, not by class names.
   - With no todos, the sequence is `[scroller, controls, dock]` and nothing
     is left in the strip's place.
   - With no controls (a single occurrence while following), the sequence is
     `[scroller, strip, dock]`.
   - With a terminal node that has no dock and no todos, the scroller is the
     last child.
   - Characterization guard, which already passes today and is not a red
     step: inside the dock, the queue band header precedes the composer
     `textarea` in document order (`compareDocumentPosition`).
   Use the same case names and fixture shape in both files so the two shells
   are held to the same meaning.
2. **Red: scroller still owns the flex space.** The scroller keeps
   `min-h-0` and `flex-1`. None of `controls`, the strip, or the dock has
   `flex-1`, so the lower siblings cannot overlap the transcript.
3. Run the two files with `NODE_ENV=development` and confirm the new order
   cases fail on the old order. The dock characterization guard passes.
4. **Green.** Reorder the JSX only: move `{todo strip}` from before
   `{scroller}` to after `{controls}`. Keep the strip's `key`, props, and
   conditions unchanged.
5. **Focus and scroll regressions.** Rerun the existing tests for
   scroll-follow, `Jump to latest`, focus handoff when the dock disappears,
   and focus-last-row. For Console, check what `allowOutsetFocus` protects
   (`ConsoleNodeRoom.tsx:175-190`). If it exists to keep the strip's focus
   ring from clipping at the top edge, keep it tied to `showTodoStrip`, add a
   test that tabbing into the strip toggle shows an unclipped focus ring, and
   document the reason in one comment.
6. Run `console-isolation.test.ts` unchanged; it must pass.

## Success criteria

- AC3 and AC6 hold at unit level in both shells.
- All existing `NodeTranscriptPane` and `ConsoleNodeRoom` tests pass. The only
  assertions changed are the two old order assertions.

## Risks

- **Todo-strip E2E geometry.** `agent-todo-strip.spec.ts:518,525,978-1011`
  asserts that the strip sits above the scroller and above `Jump to latest`.
  Phase 4 inverts those checks deliberately.
- **Overlap with Story 3.2.** This phase moves the strip but does not change
  its folding, compact rows, or terminal treatment.
