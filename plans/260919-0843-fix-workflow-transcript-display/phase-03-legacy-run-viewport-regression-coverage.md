---
phase: 3
title: 'Legacy run viewport and regression coverage'
status: pending
priority: P1
effort: 'medium'
dependencies: [1, 2]
---

# Phase 3: Legacy run viewport and regression coverage

## Outcome

The Legacy run shell stays fixed to the viewport through long-history and pointer-exit scrolling, while the transcript remains independently reachable. The Legacy runtime graph loses its minimap and retains all other useful graph interactions. Functional and visual proof is registered in the repository's verification system.

## Context and authority

- [Live Legacy scroll reproduction](./research/live-legacy-scroll-reproduction.md)
- [Structured-output and connected UI research](./research/researcher-01-structured-output-presentation.md)
- [Runtime-flow and E2E research](./research/researcher-03-e2e-tdd-runtime-flow.md)
- `_bmad-output/specs/spec-agent-node-room/SPEC.md` owns room layout, states, and accessibility.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/` contains a run graph with pan/zoom/fit controls but no minimap and keeps content inside a fixed shell.
- `e2e/ui/workflow-run-hitl-room.spec.ts` and the `verify-archon` configuration are the current executable UI proof surfaces.

## Requirements

- Preserve `[data-testid='node-transcript-scroll']` as the room body's sole vertical scroll owner.
- Keep each direct `sr-only` tool-status label inside the geometry of its own visible summary while retaining its accessible text.
- Make the Legacy right resizable panel shrinkable and overflow-contained, and contain transcript boundary overscroll with native CSS.
- Keep `document.scrollingElement.scrollTop === 0` with the pointer over the transcript, room header, or non-node graph area.
- Keep root scroll height no more than two pixels above root client height at `1440x1000` and `390x844`.
- Preserve the transcript tail, room header, occurrence navigator, jump control, todo strip, Ask cards, queue composer, resize handle, and any other state-specific controls.
- Preserve Tab/Shift+Tab order, visible focus, keyboard transcript scrolling, reachable Ask/composer controls, and focus restoration after room transitions.
- Remove only the Legacy runtime `MiniMap` and code used solely by it.
- Preserve React Flow controls, pan, zoom, fit, node layout, focus, and node selection. Preserve all workflow-builder minimaps.
- Capture and govern the structured assistant state, both viewport containment states, and runtime graph state on both configured surfaces; the Console graph is an unchanged regression reference. A tag mapping alone is not visual proof.

## Proven cause and repair order

Saved reproduction evidence measured a viewport height of `873px`, root scroll height near `18,000px`, and escaped `window.scrollY` of `668px`. Far-down absolutely positioned `span.sr-only` labels were direct children of static tool summaries. The Legacy right room panel also lacks local shrink/overflow containment, and its transcript scroller lacks an overscroll boundary. These measurements must be recaptured as a failing browser assertion before implementation because the saved artifact is prior-session evidence.

1. Add a positioned containing block to the direct tool summary in both duplicated renderers.
2. Add `min-h-0 overflow-hidden` to the Legacy right room panel.
3. Add `overscroll-y-contain` to the transcript scroller.
4. Rerun the browser geometry and pointer-exit proof.
5. Modify the shared layout only if measured ancestry still shows a root defect. `Layout.main` already has `overflow-hidden`; do not duplicate it or add a global body rule.

## Files

| File                                                                                  | Action             | Change                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                             | Modify first       | Require positioned Legacy tool summaries and retained hidden status text.                                                                |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`            | Modify first       | Require the same geometry invariant in the duplicated Console markup.                                                                    |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`                  | Modify first       | Require right-panel shrink and overflow containment.                                                                                     |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`                   | Modify first       | Require native overscroll containment and the unchanged scroll owner.                                                                    |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx`                    | Modify first       | Require retained graph controls and absence of the Legacy runtime minimap.                                                               |
| `e2e/ui/workflow-run-hitl-room.spec.ts`                                               | Modify first       | Add independent desktop and narrow long-history geometry, pointer-exit, hidden-label, tail, and keyboard assertions.                     |
| `e2e/ui/workflow-transcript-display.spec.ts`                                          | Modify first       | Add runtime graph absence and retained-interaction assertions using the deterministic Phase 2 fixture.                                   |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                  | Modify             | Position the direct Legacy tool summary.                                                                                                 |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Modify             | Apply the same direct-summary fix to the duplicated Console row.                                                                         |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`                       | Modify             | Contain the right Legacy resizable panel.                                                                                                |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                        | Modify             | Contain transcript overscroll.                                                                                                           |
| `packages/web/src/components/workflows/WorkflowDagViewer.tsx`                         | Modify             | Remove only the runtime minimap and minimap-only imports/constants.                                                                      |
| `packages/web/src/components/workflows/WorkflowCanvas.tsx`                            | Regression only    | Retain the Legacy builder minimap; do not edit this builder owner.                                                                       |
| `packages/web/src/experiments/console/builder/components/BuilderCanvas.tsx`           | Regression only    | Retain the Console builder minimap; do not edit this builder owner.                                                                      |
| `packages/web/src/experiments/console/components/RunGraphPanel.tsx`                   | Regression only    | Retain the already minimap-free Console runtime graph and its controls/selection behavior.                                               |
| `packages/web/src/components/layout/Layout.tsx`                                       | Conditional modify | Add only a measured missing fixed-shell constraint after all local fixes fail.                                                           |
| `packages/web/src/components/layout/Layout.test.tsx`                                  | Conditional modify | Prove any shared layout change across affected route shells.                                                                             |
| `.agents/skills/verify-archon/lib/browser-scenarios.ts`                               | Modify after E2E   | Map stable new functional verification tags to the browser scenario.                                                                     |
| `.agents/skills/verify-archon/features/run-ui.json`                                   | Modify after E2E   | Register behavior/scenario obligations and replace the `ui.visual` runner ID with the new visual-config digest binding.                  |
| `.agents/skills/verify-archon/visual-config.json`                                     | Modify after UI    | Add assistant-report and runtime-graph states for both surfaces at desktop/narrow viewports and refresh the Phase 2 canonical spec hash. |
| `.agents/skills/verify-archon/lib/visual-review.ts`                                   | Modify after UI    | Validate per-case run provenance because existing HITL captures and the prepared transcript-display captures use different real runs.    |
| `e2e/ui/verifier-visual.spec.ts`                                                      | Modify after UI    | Drive and capture the new configured visual states; do not rely only on existing row/raw/Ask captures.                                   |

## Tests Before

1. Recapture root/client height, root scroll position, transcript scroll position, and stable shell bounding boxes before CSS changes. Require the current source to reproduce the document overflow/pointer-exit failure.
2. Add class-contract tests for direct summaries, right room panel, and transcript scroller.
3. Add a runtime minimap-absence assertion that fails on the current `WorkflowDagViewer`, while retained controls already pass.
4. For each direct hidden status label, record its bounding box relative to its summary and expose the current outlier.
5. Add stable verification tags only after each browser test has a deterministic setup and assertion.

## Implementation steps

1. Add `relative` to both direct tool-row summaries without removing or visually exposing the `sr-only` text.
2. Add `min-h-0 overflow-hidden` to the right Legacy run panel.
3. Add `overscroll-y-contain` to the transcript scroll owner.
4. Delete `MiniMap`, `ExecutionNodeData`, status-color data, and imports that become dead only because of that removal.
5. Rerun local CSS proofs in the measured order and verify the transcript tail and controls are not clipped.
6. If root scrolling remains possible, measure the ancestor chain and add the smallest missing `min-h-0`/containment rule. If `Layout.tsx` changes, execute a route sweep across Legacy Chat, Dashboard, Workflows, Builder, and Settings to preserve each route's intended scroll owner.
7. Split desktop scroll, narrow scroll, and runtime graph into separate long browser tests. Poll for deterministic row load and geometry rather than adding sleeps.
8. Exercise graph zoom, pan, fit, keyboard focus, and node selection by observing transforms/selection/room state, not only element presence.
9. Register functional tags and the `run-ui` feature contract. Add `assistant-report` and `runtime-graph` to the visual configuration and teach the verifier to prepare the Phase 2 run, capture both surfaces at both viewports, and use the matching canonical mockup region; recompute the canonical spec hash after Phase 2's documentation update. Extend the visual manifest/reviewer schema so each case records the actual run ID used—do not attribute the new run's captures to the existing HITL run.
10. Run a fresh governed verification attempt against a clean committed implementation target as required by the verifier; do not label ordinary Playwright output as governed visual proof.

## Verification registration

Map one new `ui.transcript-display` browser scenario to exactly these executable cases:

- `[V:transcript-display.structured]` — exact and fallback content, immutable API rows, and all three mounts.
- `[V:transcript-display.legacy-scroll-desktop]` — desktop geometry, pointer exit, tail, labels, and keyboard behavior.
- `[V:transcript-display.legacy-scroll-narrow]` — the same narrow-layout obligations at `390x844`.
- `[V:transcript-display.graph]` — Legacy minimap absence, both runtime graphs' retained interactions, and builder minimap presence.

Add a matching feature behavior and proof obligations in `run-ui.json`. Keep `ui.visual` mapped to `[V:verify.visual-captures]`, but regenerate its `visual-<digest>` runner ID after updating `visual-config.json`; a stale binding must fail selection.

## Browser scenario matrix

| Scenario                         | Required assertion                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pointer over transcript          | Inner `scrollTop` changes and the final row becomes reachable.                                                                                             |
| Transcript at bottom             | Further wheel input changes neither root scroll position nor stable headers.                                                                               |
| Pointer over room header         | Wheel input keeps root scroll position at zero.                                                                                                            |
| Pointer over non-node graph area | Root stays fixed; graph-native zoom may change the React Flow transform.                                                                                   |
| Long tool history                | Every direct hidden-label box lies within its summary box and accessible text remains.                                                                     |
| `1440x1000` split view           | Both panes and resize boundary remain bounded; no horizontal document overflow.                                                                            |
| `390x844` narrow view            | The active single-panel room remains bounded, wraps content, and exposes all applicable controls.                                                          |
| Keyboard at both viewports       | Visible focus, forward/reverse traversal, transcript keyboard scrolling, applicable Ask/composer reachability, and room-transition focus restoration pass. |
| Matching report                  | Existing assistant styling/Markdown shows content without envelope in Legacy, Console selected, and Console inline history.                                |
| Ineligible report                | Original assistant bytes remain visible without clipping or fabricated UI.                                                                                 |
| Legacy runtime graph             | No minimap; controls, zoom, pan, fit, layout, focus, and node selection work.                                                                              |
| Console runtime graph            | Existing minimap-free graph and controls remain unchanged as the parity regression.                                                                        |
| Workflow builder                 | Existing minimap and builder interactions remain present.                                                                                                  |

## Focused verification

```bash
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
bun run build:web
(cd e2e && npm run typecheck && npx playwright test -c playwright.config.ts ui/workflow-run-hitl-room.spec.ts --grep 'transcript-display.legacy-scroll')
(cd e2e && npx playwright test -c playwright.config.ts ui/workflow-transcript-display.spec.ts --grep 'transcript-display.graph')
bun x tsc --noEmit -p .agents/skills/verify-archon/tsconfig.json
bun run test:verification-skills
bun run validate
```

After the implementation is committed and the visual configuration is current, perform the verifier's fresh functional and visual attempt and retain its artifacts. Install locked dependencies first; DOM component tests currently require the absent local `happy-dom` package.

## Security, reliability, performance, and operations

- This phase does not change authentication, persistence, permissions, or content parsing. Accessible names and focus behavior are explicit regression contracts.
- CSS containment avoids document-level listeners and per-wheel JavaScript. Long-history browser data must remain deterministic and bounded enough for CI.
- Do not start duplicate dev servers. Reuse the verifier/runtime harness, record owned PIDs/ports, and stop processes started for manual reproduction.
- No migration or coordinated rollout is required. The shared-layout fallback has the largest blast radius and is allowed only with measured failure plus a route sweep.

## Regression gate

- [ ] Current RED geometry and pointer-exit behavior are recorded before edits.
- [ ] Root height and scroll position pass at both required viewports; transcript tail and applicable controls remain reachable.
- [ ] Hidden labels stay accessible and geometrically contained.
- [ ] Keyboard navigation, visible focus, keyboard scroll, and focus restoration pass at both viewports.
- [ ] Legacy runtime minimap is absent and every retained graph interaction passes; builder minimaps remain.
- [ ] Functional tags, feature contract, visual configuration, capture driver, per-case run provenance, visual runner digest, and canonical spec hash agree.
- [ ] A fresh governed functional and visual attempt produces the required desktop/narrow artifacts.
- [ ] Existing Legacy/Console isolation tests and complete `bun run validate` pass without weakened assertions.

## Rollback

Revert local containment classes and their proof metadata together if they clip content. If a measured shared layout change was necessary, revert it separately and retain the local fixes. Restore only `WorkflowDagViewer`'s minimap-specific code and matching expectations if verified graph usability requires rollback; do not touch builder minimaps.
