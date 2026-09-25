---
phase: 4
title: 'Phase 4: Browser geometry and order evidence'
status: pending
priority: P1
effort: '4h'
dependencies: [2, 3]
---

# Phase 4: Browser geometry and order evidence

## Goal

Prove the anatomy in a real browser for both shells. Remove every E2E
dependency on the ratio key and the resize separator.

## Evidence (verified at 4039a03d)

- `e2e/ui/workflow-run-hitl-room.spec.ts`: `roomRatio()` (`:73-80`); the
  ratio assertions at `:215,234`; the `[V:hitl.room-ratio]` drag-and-reload
  test (`:612-640`); the separator required visible at `:978`; separator
  absence at `:212`. Viewports: `SPLIT_VIEWPORT` 1440×1000,
  `LEGACY_RATIO_VIEWPORT` 1024×900, `NARROW_VIEWPORT` 390×844.
- `e2e/ui/agent-todo-strip.spec.ts:54,155-181`: `setRoomWidth` writes
  `archon.run-room.ratio.<surface>` to reach `TARGET_ROOM_WIDTH = 460` for
  both surfaces. Strip-above-scroller checks are at `:518,525,978-1011`.
- `verifier-visual.spec.ts:176` writes the ratio key.
  `agent-tool-row-visual.spec.ts`, `file-edit-diff.spec.ts`, and
  `task-dispatch-body.spec.ts` also reference the ratio or separator (found by
  grep). `workflow-run-hitl-visual.spec.ts:57` uses the same `panelLocator`,
  and `:128-131,155-158` assert a product ratio between 0.24 and 0.6 via
  `measureProductRatio`.

## Files

- Modify: the specs listed above, plus screenshot baselines only where the
  approved width changes them.
- Evidence: `plans/260925-2145-issue-266-console-legacy-room-anatomy/reports/`

## TDD steps

1. **Red: geometry.** In `workflow-run-hitl-room.spec.ts`, replace
   `roomRatio()` with a `roomWidth(page, surface)` helper. At
   `SPLIT_VIEWPORT`, assert Console is 520 ±1 and Legacy is 460 ±1.
   Replace `[V:hitl.room-ratio]` with a fixed-width persistence test: seed
   `archon.run-room.ratio.console = '0.6'`, open the room, check the width,
   reload, reopen, check the width again, and assert that
   `separator[name="Resize node room"]` has count 0. Replace the visible
   separator assertion at `:978` with count 0. Keep the tests for close,
   deep link, focus, selection memory, and narrow Back. Decide from the
   container width at `LEGACY_RATIO_VIEWPORT` whether Legacy is in split or
   single mode, and assert the matching contract (460 ±1, or full width with
   Back).
2. **Red: order and last-row visibility.** In `agent-todo-strip.spec.ts`,
   delete `setRoomWidth` and the ratio constants, and assert each surface's
   own width (Console 520, Legacy 460) for both surfaces. Invert the order
   checks so that `scroller.bottom ≤ controls.top + 1`,
   `controls.bottom ≤ strip.top + 1`, and `strip.bottom ≤ dock.top + 1`.
   Add a case that uses the long-history fixture with the strip expanded and a
   queued message: scroll to the end and assert that the last transcript
   row's bottom is at or above `strip.top + 1` and is visible. Keep the
   strip's internal body scroll and zoom checks, adjusted for its new
   position.
3. **Visual fixtures.** In `workflow-run-hitl-visual`, replace the
   `measureProductRatio` bounds with the fixed-width assertions (Console 520
   ±1, Legacy 460 ±1, or single mode where the container is below 60rem) and
   re-pin any shifted screenshots. In `verifier-visual`, `agent-tool-row-visual`,
   `file-edit-diff`, and `task-dispatch-body`, remove the ratio-key setup and
   the desktop Console-at-460 assumptions. Measure desktop Console at 520 and
   Legacy at 460. Keep any 460px Console stress case in single-pane flow or in
   an isolated renderer fixture. Rename evidence files whose names encode the
   old width.
4. Run `(cd e2e && bun run typecheck)`. Then run the focused specs and confirm
   the new assertions pass and nothing else regresses.
5. Update only the screenshot pins whose geometry the approved width changed.
   List each updated pin, with its reason, in
   `reports/visual-pin-updates.md`.
6. Save geometry captures (Console 520, Legacy 460, the order with the
   expanded strip) into `reports/` using the specs' existing
   `captureEvidence` helper, pointed at this plan's directory where the
   helper takes a plan id.

## Success criteria

- AC1-AC5 are proven in a real browser for both shells.
- `grep -rn "run-room.ratio" e2e/ui` matches only the deliberate
  "stale key is ignored" seed.
- All listed specs pass with fixtures that do not depend on outside services.

## Risks

- **Flaky geometry at fractional device-pixel ratios.** Use ±1 CSS pixel
  tolerance. Never tolerate more.
- **Long-history fixture cost.** Reuse `requireLongHistoryFixture`. Do not
  build a new harness.
