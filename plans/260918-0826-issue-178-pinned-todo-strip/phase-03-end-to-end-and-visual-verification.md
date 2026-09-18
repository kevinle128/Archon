---
phase: 3
title: 'Phase 3: End-to-end and visual verification'
status: pending
priority: P1
effort: '3h'
dependencies: [1, 2]
---

# Phase 3: End-to-end and visual verification

## Overview

Prove the strip on a real stored run on both surfaces, collect the geometry, contrast, keyboard, reduced-motion, and screen-reader evidence the DESIGN contract requires, run every gate, and write `reports/visual-acceptance.md` in the shape Story 1.1 established (`plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md`). No product code changes are planned here; a failure found by evidence is fixed on both surfaces together.

**Scout first (deep mode).** Re-read `e2e/ui/agent-tool-row-visual.spec.ts` helpers (`openToolRoom` `:55-72`, `boundingBox`/geometry pattern `:101-128`, focus evidence `:489-505`, `contrastRatio` `:352`, the 460 px room setup and the viewport sweep `:38-46`) and reuse them rather than re-implementing; confirm the Phase 1 spec's node ids and the Phase 2 markup before adding assertions.

## Requirements

- Functional: the Phase 1 spec is green on Console and Legacy, including the pinned assertion at both scroll extremes and the absent-strip case.
- Visual: geometry matches `plan.md` → Visual criteria at 460 px; the strip stays one column and never introduces horizontal scroll at 390 × 844 or at 200 % zoom; the checklist caps at 168 px and scrolls internally.
- Accessible: contrast ≥ 4.5:1 for every strip tone on `surface-elevated` on both shells; header target ≥ 24 × 24; chevron honours reduced motion; screen-reader pass reads section name, header state, phase headings, and per-item status words.
- Process: `bun run validate` green; local HITL suite green; PR body records the local E2E pass and `Closes #178`.

## Related Code Files

- Modify: `e2e/ui/agent-todo-strip.spec.ts` (add visual/geometry/contrast cases)
- Create: `plans/260918-0826-issue-178-pinned-todo-strip/reports/visual-acceptance.md` and `reports/evidence/*.png`
- Verify only: `e2e/ui/workflow-run-hitl.spec.ts`, `e2e/ui/workflow-run-hitl-room.spec.ts`, `e2e/ui/workflow-run-hitl-visual.spec.ts`, `e2e/ui/agent-tool-row-visual.spec.ts`
- Read-only: `_bmad-output/.../DESIGN.md:86-88, :235-247, :599-603`, `EXPERIENCE.md:121-122, :163-165`

## Implementation Steps

### Behaviour, on the real run

1. `bun run --cwd e2e test:ui -- --grep 'todo strip'` on Chromium. All Phase 1 cases must pass on both surfaces: present, pinned at both scroll extremes, one-line todo rows with no inline checklist, absent on `no-todo`, Console `Tool calls` checkbox off keeps the strip, keyboard toggle.
2. `bun run --cwd e2e test:ui:hitl` — the existing HITL specs stay green (regression: the strip mounts above every room, including rooms with no todos where it renders nothing).

### Geometry and style (extend the spec)

3. Add `[P1] [V:todo-strip-<surface>]` per surface, reusing the 460 px room setup: computed styles of the section (`background-color` = `surface-elevated`, 1 px border on the transcript edge), header (`min-height ≥ 24`, padding `6px 10px`, `TODO` label `10px`/uppercase/`0.07em`), phase heading (`10px`, uppercase, `margin-top 4px`), list (`11.5px` mono, `line-height` ≈ `21.3px` = 1.85), body `max-height 168px` + `overflow-y: auto`. Capture `todo-strip-<surface>-460.png` to the Playwright output dir.
4. Pinned evidence: after scrolling the room scroller to `scrollHeight`, capture `todo-strip-<surface>-scrolled.png` with the strip `toBeInViewport()` and the last tool row visible below it.
5. Viewport sweep (reuse `SWEEP_VIEWPORTS` at `:41-46` and the 200 % zoom step from `:545+`): at each size assert `document.documentElement.scrollWidth <= clientWidth` and that the strip header stays one line (`boundingBox().height` ≤ 2 × line height).
6. Long plan: temporarily drive the fake with an `init` of 40 items in the fixture? **No** — keep fixtures deterministic; instead assert in the component test (Phase 2) that the body carries `max-h-[168px] overflow-y-auto`, and in this spec assert the computed `max-height` only. Record the decision in the report.

### Keyboard, focus, motion

7. Tab from the run header/toolbar into the strip header: the first focusable inside the region is the strip's button (top placement), then the first row summary. Assert `:focus-visible` outline colour resolves to `--accent-bright` and outline width 2 px, using the summary's focus pattern (`:489-505`). `Space`/`Enter` toggle; focus stays on the button after toggling (no focus loss when the list is hidden).
8. Reduced motion: emulate `prefers-reduced-motion: reduce` and assert the chevron's computed `transition-duration` is `0s`; without it, `120ms`.

### Contrast

9. Extend the `[V:hitl.tool-row-contrast]` approach: resolve each strip tone (`text-secondary` label/items, `success`, `running`/`accent-bright`, `warning`, `text-primary` current item) against `surface-elevated` and against `surface-hover` (header hover), on both shells, ≥ 4.5:1. Record every ratio in the report table. If any tone fails, stop and raise with the owner — do not invent a new token (DESIGN.md Do/Don't).

### Screen reader (manual, recorded)

10. macOS VoiceOver + Safari and Windows NVDA + Firefox (or the pairings the Story 1.1 report used): navigate to the room, hear `Todo, region`, `TODO … 1/4, expanded, button`, `Research, heading`, `list, 4 items`, `completed, Read the spec`, `in progress, Locate the backoff cap`, `blocked, Run the suite, blocked: CI has one build job`. Collapse: `collapsed`. Record transcripts in the report.

### Gates and report

11. `cd packages/web && bun run test && bun run type-check && bun run lint`; `cd packages/providers && bun run test`; `cd e2e && npm run typecheck`; root `bun run validate`. Never root `bun test`.
12. Write `reports/visual-acceptance.md`: evidence sources, geometry matrix (contract / Console / Legacy / result), pinned evidence, viewport sweep, contrast table, keyboard/motion results, screen-reader transcripts, deviations with rationale (meter/Raw/body-bar exclusions, default-expanded decision, placement decision), and the local E2E pass record for the PR.
13. Open the PR from the repo template with `Closes #178`; the Validation section links the report and states that the HITL and todo-strip specs ran locally because `test.yml` does not trigger `e2e-hitl` on `develop`.

## Todo

- [ ] Phase 1 spec green on both surfaces; HITL suite green
- [ ] Geometry, pinned, sweep, focus, motion, contrast cases added and green
- [ ] Two screen-reader passes recorded
- [ ] `bun run validate` green
- [ ] `reports/visual-acceptance.md` written with evidence captures
- [ ] PR opened with `Closes #178` and the local E2E record

## Success Criteria

- [ ] Every `plan.md` acceptance criterion has passing automated evidence or a named manual record in the report.
- [ ] No contrast ratio below 4.5:1, no target below 24 × 24, no horizontal overflow at any swept viewport or at 200 % zoom.
- [ ] The strip is in the viewport at both scroll extremes on both rooms (captures attached).
- [ ] All gates pass; the diff contains only the files in the plan's inventory.

## Risk Assessment

- **Evidence reveals a token gap** (e.g. `warning` on `surface-elevated` under 4.5:1 on one shell). Stop, record the measurement, raise with the owner; the fix is a token decision, not a per-component colour.
- **Flaky pinned assertion.** `toBeInViewport()` after programmatic scroll can race a layout pass; wait for the scroller's `scrollTop` to settle before asserting, as the long-history spec does for page drains.
- **Screen-reader availability.** If one OS pairing is unavailable on the machine, record the one that ran and name the missing pairing as an open item in the PR rather than claiming both.

## Security Considerations

- Captures contain only the synthetic fixture strings from `E2E_FAKE_TODO_INPUTS`; no production payloads are recorded in the report.
