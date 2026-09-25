---
phase: 2
title: 'Fixed-width split owners'
status: pending
dependencies: [1]
---

# Fixed-width split owners in both shells

## Context and files

Legacy: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` and `WorkflowExecution.tsx`; Console: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` and `routes/RunDetailPage.tsx`. Their paired `.test.tsx` files cover selection, closing, focus, and the current separator. `useContainerSplitMode` uses measured container width and the computed root font size; its existing test already proves 959/960 at 16px and 1199/1200 at 20px. Legacy additionally uses viewport-based `useStackedViewport()` to turn a split panel group vertical below 899px, which can overlap split mode at a non-default root font size. Remove this second policy from the Node Room path; do not change the source-control use of the hook or export `modeForWidth` just for this plan.

## Steps

1. Write focused tests for both shell owners. In split mode with a selected room, assert the **outer** `#console-run-room` / `#legacy-run-room` has 520px / 460px width and cannot shrink; the main view is mounted, occupies the remaining flex width, and no `Resize node room` separator is present. Rerender with changed transcript/selection; width remains fixed. Retain the existing ids and `data-testid="legacy-node-room"` wrapper. Update the old separator assertions rather than deleting coverage.
2. Test single mode with and without a room: the main view remains mounted but truly has `display:none` when room-open; the room has no fixed inline width and fills the container; Back restores the view and focus. Test a transition from split to single and back, including a stored old ratio value. Assert no Node Room call writes that key. Keep existing close, query opening, graph/Logs selection, run-change reset, and scroll memory tests.
3. Remove ratio state, persistence callbacks, props, and `onLayoutChanged` from both route owners and both split owners. Replace their Node Room panel groups with a horizontal flex parent. In split mode use `min-w-0 flex-1` on the main view and `shrink-0` plus the corresponding `ROOM_WIDTH_PX` value on the room; in single mode let the room use `min-w-0 flex-1 w-full`. Replace the separator's visual edge with the shell's one-pixel left border **inside** the fixed-width outer room, using each theme's existing border token; do not retain an interactive separator. Maintain a flex column/min-height chain to keep graph canvas and room scroller sized. Use mutually exclusive `hidden` versus `flex` display classes (or an explicit inline `display:none`) for the mounted main view: an HTML `hidden` attribute alone can be overridden by author CSS `display:flex`. Preserve Close versus Back labels and existing focus refs.
4. Keep the generic `components/ui/resizable.tsx` and Console primitive. They still serve other surfaces and import `PanelPercent`. Keep Console's isolation allowlist unchanged. The outer panel is the width target; Console's `RoomRegion` has a 4px inset when todo is visible, so its inner region is intentionally narrower.

## Validation

Run `LegacyGraphLogsPane.test.tsx`, `WorkflowExecution.test.tsx`, `ConsoleInspectPane.test.tsx`, and `RunDetailPage.test.tsx` from `packages/web` with `NODE_ENV=development`, then `bun run type-check` there. Characterize the 14px-root/899px-viewport overlap in the existing `use-container-split-mode.test.tsx` if needed, and verify that the Node Room uses the hook's mode rather than the old stacked viewport rule. A browser check in Phase 4 must prove the graph and Logs pane remain usable at the smallest split container and that single mode has no horizontal overflow. No API, DB, or storage migration is involved.
