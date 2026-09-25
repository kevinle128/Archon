---
phase: 2
title: 'Phase 2: Fixed-width split owners in both shells'
status: pending
priority: P1
effort: '4h'
dependencies: [1]
---

# Phase 2: Fixed-width split owners in both shells

## Goal

Render the open Node Room as a fixed-width, non-shrinking sibling of the main
view in desktop split mode: 520px in Console and 460px in Legacy. Remove the
ratio state, the resize separators, and the panel groups from these call
paths. Single-pane behavior stays exactly as it is.

## Evidence (verified at 4039a03d)

- **Legacy.** `WorkflowExecution.tsx:379-380` reads `roomRatio` from storage;
  `:822-825` writes it; `:1020-1021` passes `roomRatio` and
  `onRoomRatioChange` into `LegacyGraphLogsPane`.
  `LegacyGraphLogsPane.tsx:71-72,197-198,250,556-606` renders a
  `ResizablePanelGroup` with `PercentResizablePanel` ids `legacy-run-view` and
  `legacy-run-room`, a `ResizableHandle aria-label="Resize node room"` in
  split mode, and `orientation` set to vertical when split and
  `useStackedViewport()` (`max-width: 899px`) are both true.
- **Console.** `RunDetailPage.tsx:177-178,475-479,789-790` holds the ratio
  state. `ConsoleInspectPane.tsx:82-83,197-198,235-236,387-440` renders a
  `ConsolePanelGroup` with `ConsolePanel` ids `console-run-view` and
  `console-run-room`, and a `ConsolePanelSeparator aria-label="Resize node room"`.
- Mode comes from `useContainerSplitMode(paneRef)` (split at ≥ 60rem), or
  `splitModeOverride` on Legacy. Single mode hides the view panel when the
  room is open and gives the room 100%.
- Existing tests: `ConsoleInspectPane.test.tsx:729,742,776` assert when the
  separator is present or absent; `RunDetailPage.test.tsx:881` asserts it is
  absent. `LegacyGraphLogsPane.test.tsx` and `WorkflowExecution.test.tsx`
  cover selection, close, and focus.
- The Playwright locator `panelLocator` accepts `[data-panel-id="<id>"]` or
  `#<id>`, and the scroll specs use `#legacy-run-room`, so the ids must stay.

## Files

- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`,
  `WorkflowExecution.tsx`, `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`,
  `packages/web/src/experiments/console/routes/RunDetailPage.tsx`
- Tests: `LegacyGraphLogsPane.test.tsx`, `WorkflowExecution.test.tsx`,
  `ConsoleInspectPane.test.tsx`, `RunDetailPage.test.tsx`,
  `packages/web/src/lib/use-container-split-mode.test.ts` (create it only if
  no test covers `modeForWidth`; export `modeForWidth` if needed)

## TDD steps

1. **Red: split geometry, both shells.** In `LegacyGraphLogsPane.test.tsx`
   (with `splitModeOverride="split"` and a selected row) and
   `ConsoleInspectPane.test.tsx` (split mode):
   - The element with id `legacy-run-room` / `console-run-room` has inline
     `style.width === '460px'` / `'520px'` and a `shrink-0` class.
   - Its previous sibling is `#legacy-run-view` / `#console-run-view` with
     `flex-1` and `min-w-0`.
   - `querySelector('[role="separator"]')` is `null`. This flips the existing
     Console assertion at `:742`.
   - Rendering again with a different transcript does not change the width
     (a rerender check).
2. **Red: single mode unchanged.** With the room open in single mode, the view
   is `hidden` and the room has no fixed inline width (it fills the
   container). With no room open, the view fills the width and no room element
   exists. Keep and adapt the existing tests at `:729` and `:776`.
3. **Red: no ratio plumbing.** In `WorkflowExecution.test.tsx` and
   `RunDetailPage.test.tsx`, seed `localStorage` with
   `archon.run-room.ratio.legacy = '60'` / `.console = '24'`, open a room in
   split mode, and assert the fixed width still applies and nothing writes
   the key (spy on `Storage.prototype.setItem`).
4. **Red: stacked reachability.** Add a unit test for `modeForWidth`: at the
   default 16px root font, a width of 899 returns `single`. This proves that
   split mode and the stacked viewport cannot coincide at default font sizes.
   If a different root font size makes the overlap reachable, stack the room
   below the main view at full width instead of removing the case, and test
   that branch.
5. Run the four test files and confirm each new test fails for the expected
   reason.
6. **Green.**
   - Delete `roomRatio`, `onRoomRatioChange`, and `handleLayoutChanged` in
     both shells, along with the state, callbacks, and props in
     `WorkflowExecution` and `RunDetailPage`.
   - Replace the panel group with
     `<div className="flex min-h-0 flex-1 flex-row">`. The view is
     `<div id="…-run-view" className="flex min-h-0 min-w-0 flex-1 flex-col" hidden={single && roomOpen}>`.
     The room is `<div id="…-run-room" className="min-h-0 min-w-0 overflow-hidden shrink-0" style={split ? { width: roomWidthPx(surface) } : undefined}>`.
     In single mode the room becomes `flex-1`.
   - In Legacy, keep the `data-testid="legacy-node-room"` wrapper and the
     header and footer structure. Keep `closeLabel` (`Back` in single mode,
     `Close` in split mode).
   - Remove the `Resizable*` and `ConsolePanel*` imports that are no longer
     used. Do not delete the primitive files.
7. Rerun until green, then run the full Legacy and Console component sets
   (listed in Phase 5) to catch regressions in focus restoration, deep
   linking, and scroll memory.

## Success criteria

- AC1, AC2, and AC5 hold at unit level, and every pre-existing selection,
  close-focus, deep-link, and scroll-memory test in these four files passes
  without its assertion being weakened.
- `bun run type-check` passes.

## Risks

- **Loss of panel-library ARIA or ids.** Only the ids are consumed (checked
  with grep in `e2e`). If any unit test queries `data-panel-id`, move it to
  the element `id`.
- **Main-view layout.** The graph canvas (React Flow) must not collapse. Keep
  `min-w-0 flex-1` on the view wrapper and check the graph in the Phase 4
  browser run.
