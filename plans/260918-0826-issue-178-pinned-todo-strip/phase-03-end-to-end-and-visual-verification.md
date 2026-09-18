---
phase: 3
title: 'End-to-end and visual verification'
status: pending
priority: P1
effort: '3h'
dependencies: [1, 2]
---

# Phase 3: End-to-end and visual verification

## Outcome

Prove the strip through real stored workflow messages on Legacy and Console, including both scrolling boundaries, the strip's own long-plan scroll, responsive behavior, design anatomy, keyboard/focus/motion, contrast, and accessibility-tree semantics. Run regression and repository gates, then record evidence without overstating unavailable manual assistive-technology coverage.

No feature work is scheduled here. Any failure must be fixed at its owning shared model or in both renderers as appropriate, then added to the evidence report.

## E2E evidence ownership

Extend `e2e/ui/agent-todo-strip.spec.ts`; do not modify the concurrently owned `agent-tool-row-visual.spec.ts`. Its helpers are file-local, so copy only the small navigation/measurement/color utilities this spec needs. Keep selectors scoped to the named room region and use semantic locators first.

Use the dedicated synthetic `e2e-todo-strip` run. Screenshots and JSON may contain only its known strings. Store durable evidence under this plan's `reports/evidence/`, following the Story 1.1 precedent; also attach captures through Playwright for failure diagnostics.

## Behavior on a real run

Run the Phase 2 behavior cases on Chromium and retain assertions for both surfaces:

- `todo-plan` has exactly one Todo section inside its room; `no-todo` has none;
- default collapsed header reports the auto-promoted item and `1/12`;
- Enter/Space toggle, keep focus, and expose the two phases/all five status treatments;
- 12 decorative meter cells; no checklist under a todo transcript row;
- Console Tool calls off keeps the strip and removes tool rows.

For pinning, do more than `toBeInViewport()`:

1. Capture strip and transcript-scroller boxes and the scroller's initial `scrollTop`.
2. Scroll transcript to its bottom and wait until `scrollTop` settles.
3. Prove first/last visible transcript rows changed and the strip's top, left, width, and height stayed within 1 px.
4. Scroll back to zero and repeat the fixed-box assertion.
5. Prove the strip does not geometrically overlap the transcript viewport or Jump button.

For the checklist's own scroll:

1. Expand the 12-item body.
2. Assert computed max-height `168px`, `overflow-y: auto`, and `scrollHeight > clientHeight`.
3. Scroll the body to its bottom; prove a final item becomes visible while the transcript `scrollTop` and strip container box stay unchanged.

## Geometry and design comparison

At a measured room width of `460 ± 2 px` on both surfaces, collect computed values and screenshots for collapsed and expanded states:

| Element         | Required evidence                                                         |
| --------------- | ------------------------------------------------------------------------- |
| Container       | full room width, flex-none, surface-elevated, no radius, 1 px bottom rule |
| Header          | one line; 6 px/10 px padding; min target ≥24 px; 8 px gaps; surface-hover |
| Label           | 10 px, 700, uppercase, 0.07em, text-secondary                             |
| Current summary | 11.5 px mono, text-primary, fixed glyph, elided item                      |
| Meter           | 12 cells, 3 px high, 2 px gap, status token mapping, aria-hidden          |
| Count/caret     | 10 px count; 9 px caret; caret 0° closed / 180° open                      |
| Body            | 4/10/8 padding, top rule, 168 px cap, actual internal overflow            |
| Phase/item      | phase 10 px/0.07em/4 px top margin; item 11.5 px/1.85 line height         |
| Current row     | surface background, text-primary, visible 2 px inset running marker       |

The canonical top position intentionally differs from the old `.dc.html` screenshots. Compare anatomy, sizing, state, and tokens to the prototypes; compare placement to SPEC/epic/architecture. Record that distinction rather than treating the old bottom order as a visual failure.

Capture at least:

- `legacy-todo-collapsed-460.png`
- `legacy-todo-expanded-460.png`
- `console-todo-collapsed-460.png`
- `console-todo-expanded-460.png`
- a scrolled-room image for each surface showing the fixed strip and changed transcript content
- `todo-strip-metrics.json` with geometry, overflow, token colors, and ratios

## Responsive and zoom matrix

Run both surfaces at:

- 1440×1000
- 1024×900
- 768×900
- 390×844
- Chromium 200% zoom emulation using the established device-metrics approach

At every size/state assert:

- Todo header stays one line; representative text elides before count/caret are lost;
- section and body stay within the room; `scrollWidth <= clientWidth` for room and body;
- page overflow is ≤1 px;
- all header controls remain visible and target size stays ≥24×24 px;
- expanding/collapsing does not cover the transcript's first row;
- internal body scroll remains usable at the narrowest width.

## Keyboard, focus, and reduced motion

For each surface:

1. Tab to the Todo header as the first focusable control inside the room region; no hidden body child enters tab order while collapsed.
2. Enter opens and Space closes; focus remains on the same button. Click has the same state transition.
3. Focus outline computes to 2 px solid opaque `--accent-bright`, with Legacy −2 px / Console +2 px offset.
   Prove the complete outline is visible on all four sides of the full-bleed Console button; do not silently switch it to the prototype's −2 px value to avoid a clipping defect.
4. With normal motion, caret transform transition is 120 ms and open rotation is 180°. With `prefers-reduced-motion: reduce`, `transition-property` is `none`; do not incorrectly require the authored duration value to become `0s`.
5. After a simulated same-scope live update, focus and expansion remain. Scope navigation mounts a new collapsed control.

## Contrast and non-color status

Resolve actual CSS colors in-browser against the effective backgrounds and write numeric ratios to the metrics JSON:

- text-secondary label/count/items on surface-elevated;
- text-primary representative/current content on surface-elevated/surface;
- completed success, in-progress running, blocked warning, pending/abandoned secondary glyphs on their actual row backgrounds;
- opaque accent-bright focus ring on surface-elevated/surface-hover (3:1 non-text floor).

Text/glyphs must clear 4.5:1. The meter and current inset marker are redundant decoration (text count, glyph, and status phrase carry the information), so do not misreport them as the sole status channel. If a required token fails, record the exact surface/value and escalate a token decision rather than inventing a local color.

## Accessibility-tree and manual AT review

Use Chromium's accessibility tree to verify:

- one region named `Todo` nested inside the node-room region;
- header role button, a useful name assembled from TODO + status/current item + count, and expanded false/true;
- meter, caret, and decorative glyphs excluded;
- phase headings and lists exposed when expanded and hidden when collapsed;
- each item exposes one status phrase; blocked reason and abandoned state are not duplicated;
- no agent-authored task/blocker text appears in ids, labels, or titles;
- focus remains on the header across activation and live rerender.

Attempt and record one Windows + NVDA + Chromium pairing and one macOS + VoiceOver + Safari/Chromium pairing. Verify navigation, collapsed/expanded announcement, phase/list traversal, five statuses, and focus retention. Do not prescribe or claim exact screen-reader punctuation. If either environment is unavailable, record the exact limitation and mark manual AT sign-off **BLOCKED**, following the prior Story 1.1 report.

## Regression and gates

Run in this order so failures stay attributable:

```bash
bun run --cwd e2e test:ui -- --grep 'todo strip'
bun run --cwd e2e test:ui:hitl

(cd packages/web && bun run test && bun run type-check)
(cd packages/providers && bun run test && bun run type-check)
(cd e2e && npm run typecheck)

bun run lint --max-warnings 0
bun run validate
```

Also verify the existing Story 1.1 visual spec if Story 1.2 has not already run it against the final branch. Never substitute root `bun test` for the package-isolated scripts.

The regression record must explicitly cover:

- Legacy/Console no-todo rooms;
- pagination, live refresh, error/retry, scroll restoration, stick-to-bottom, and Jump to latest;
- Console Tool calls toggle and isolation rule;
- non-agent Legacy rooms and exactly-one-landmark behavior;
- current Story 1.2 Raw/Input-Output baseline;
- provider behavior when `emitTodo` is absent.

## Acceptance report and PR

Create `reports/visual-acceptance.md` with:

1. commit/baseline and evidence sources;
2. behavior matrix by surface;
3. geometry table with contract/Legacy/Console/result;
4. fixed-strip and two-scroll-container proof;
5. responsive/zoom results;
6. keyboard/focus/motion results;
7. contrast table and metrics-file link;
8. Chromium AX evidence;
9. manual visual comparison, distinguishing canonical placement from prototype anatomy;
10. manual AT pairings or explicit blockers;
11. exact commands/results, deviations, and final status.

Open the PR from `.github/pull_request_template.md`, target `develop`, keep only applicable sections, link the report, state the locally run E2E suites, and include `Closes #178`. Do not mark the story done while a required manual AT blocker remains unless an authorized owner accepts an alternative.

After every implementation/evidence gate passes, let the owning BMad workflow move `1-5-track-the-agents-current-todo-state-in-a-pinned-strip` from `backlog` to `done`. Do not manually advance it before the gate, and do not confuse issue #178's stale generated `CAP-5` / `diff-hunks` footer with the canonical CAP-3 scope.

## Files

- Modify: `e2e/ui/agent-todo-strip.spec.ts`
- Create: `plans/260918-0826-issue-178-pinned-todo-strip/reports/visual-acceptance.md`
- Create: `plans/260918-0826-issue-178-pinned-todo-strip/reports/evidence/*.png`
- Create: `plans/260918-0826-issue-178-pinned-todo-strip/reports/evidence/todo-strip-metrics.json`
- Workflow-owned after gates: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
- Verify only: existing HITL and Story 1.1 visual specs
- Fix product/test files only when a failed criterion proves a cause-aligned defect

## Exit criteria

- [ ] Real stored todo/no-todo runs pass on both routes.
- [ ] Bounding boxes prove the strip does not move while transcript content scrolls.
- [ ] The 12-item body proves a separate, functional 168 px internal scroll.
- [ ] Geometry/anatomy/tokens match the resolved design contract at 460 px.
- [ ] No room/page overflow at the viewport matrix or 200% zoom.
- [ ] Required text/glyph contrast, focus contrast, target size, keyboard, and reduced-motion checks pass.
- [ ] AX evidence passes; manual AT is either passed or honestly blocks final sign-off.
- [ ] Regression suites and `bun run validate` pass.
- [ ] Evidence report and synthetic captures are complete; PR is correctly formed.

## Risks and safeguards

- A visible strip is not proof of pinning; require unchanged geometry plus changed transcript rows.
- A CSS max-height is not proof of long-plan behavior; require real `scrollHeight > clientHeight` and internal scroll.
- Screenshots support human review but never replace computed geometry, contrast, or AX assertions.
- Programmatic scroll can race layout; poll settled scroll metrics rather than adding fixed sleeps.
- Do not claim prototype parity for placement; explain the authority-resolved top-position difference.
- Do not commit any capture from a non-synthetic run.
