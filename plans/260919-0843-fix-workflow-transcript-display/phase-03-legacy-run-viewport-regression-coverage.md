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

The Legacy run shell cannot scroll as a document when transcript input reaches a boundary or the pointer leaves the transcript, and the Legacy runtime graph has no minimap while all useful graph interactions remain intact.

## Context links

- [Live Legacy scroll reproduction](./research/live-legacy-scroll-reproduction.md)
- [Structured-output and connected UI research](./research/researcher-01-structured-output-presentation.md)
- [Runtime-flow and E2E research](./research/researcher-03-e2e-tdd-runtime-flow.md)
- `e2e/ui/workflow-run-hitl-room.spec.ts`

## Requirements

- Keep `[data-testid='node-transcript-scroll']` as the only vertical scroll owner for the room body.
- Keep each absolute `sr-only` tool status label inside its own visible summary geometry.
- Make the Legacy right resizable panel shrinkable and overflow-contained.
- Contain transcript boundary overscroll with native CSS.
- Keep `document.scrollingElement.scrollTop` at zero when the pointer is inside the transcript, over the room header, or over a non-node graph area.
- Keep the root document scroll height within two pixels of its client height on split and narrow layouts.
- Preserve the room header, occurrence navigator, jump control, todo strip, Ask cards, queue composer, resize handle, and reachable transcript tail.
- Preserve visible keyboard focus, Tab and Shift+Tab order, keyboard transcript scrolling, and reachability of Ask controls and the composer at desktop and narrow widths.
- Remove only the Legacy runtime `MiniMap` and its minimap-only imports and constants.
- Preserve React Flow controls, pan, zoom, fit, node layout, focus, and node selection.

## Proven cause and repair order

Live measurement found a viewport height of `873px`, root scroll height near `18,000px`, and escaped `window.scrollY` of `668px`.
Absolutely positioned `span.sr-only` labels inside static tool-row summaries supplied the far-down boxes.
The right `legacy-run-room` panel also lacks the containment classes used by its sibling, and the transcript scroller has no overscroll rule.

1. Add a positioned containing block to both Legacy and Console tool summaries because both duplicate the same accessible label geometry.
2. Add `min-h-0 overflow-hidden` to the Legacy right resizable panel.
3. Add `overscroll-y-contain` to the transcript scroller.
4. Re-run the pointer-exit browser measurement after all three mandatory local fixes.
5. Change `Layout.main` only if those local cause-aligned fixes still leave the document scrollable; do not add a global body rule.

## Files

| File                                                                                  | Action             | Change                                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                             | Modify first       | Require the positioned Legacy tool summary and retained accessible status.                                    |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`            | Modify first       | Require the same shared geometry invariant in Console markup.                                                 |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`                  | Modify first       | Require right-panel minimum-height and overflow containment.                                                  |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`                   | Modify first       | Require the native overscroll class and unchanged scroll owner.                                               |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx`                    | Modify first       | Require Legacy controls and no runtime minimap.                                                               |
| `e2e/ui/workflow-run-hitl-room.spec.ts`                                               | Modify first       | Add long-history geometry, hidden-label, pointer-exit, and blank-region assertions at split and narrow sizes. |
| `e2e/ui/workflow-transcript-display.spec.ts`                                          | Modify first       | Add Legacy runtime graph interaction assertions for the deterministic DAG.                                    |
| `.agents/skills/verify-archon/lib/browser-scenarios.ts`                               | Modify after E2E   | Bind the stable transcript-display verification tags to one governed browser scenario.                        |
| `.agents/skills/verify-archon/features/run-ui.json`                                   | Modify after E2E   | Register the behavior, scenario, impact paths, prerequisites, and proof obligations.                          |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                  | Modify             | Position the direct tool summary containing the hidden status label.                                          |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Modify             | Apply the same positioned-summary fix to the duplicated Console row.                                          |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`                       | Modify             | Contain the right resizable panel.                                                                            |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                        | Modify             | Contain transcript overscroll.                                                                                |
| `packages/web/src/components/workflows/WorkflowDagViewer.tsx`                         | Modify             | Delete the runtime minimap and minimap-only code.                                                             |
| `packages/web/src/components/layout/Layout.tsx`                                       | Conditional modify | Add the minimum fixed-shell guard only when the RED browser metric still fails after local fixes.             |

## Function and interface checklist

- `ToolItem` summary markup stays accessible and keeps the same disclosure behavior.
- `PercentResizablePanel` receives local classes; the shared resizable primitive does not change.
- `room-scroll-follow.ts` does not change because it does not own wheel events.
- `WorkflowDagViewer` keeps the same props, view model, node types, edges, and selection callback.
- Workflow builder canvases and `RunGraphPanel` do not change.

## Tests Before

1. Preserve the live failure as a browser assertion that root scroll height exceeds the viewport and pointer-exit wheel input changes document scroll on the current source.
2. Add component class-contract tests for the summary, room panel, and transcript scroller.
3. Add the minimap absence assertion and confirm it fails while the controls assertion passes.
4. Record stable bounding boxes for the app header, run header, tabs, room header, room panel, transcript scroller, tool summaries, and their direct hidden labels.

## Implementation steps

1. Add `relative` to both direct tool-row summaries without removing `sr-only` content.
2. Add `min-h-0 overflow-hidden` to the right Legacy run panel.
3. Add `overscroll-y-contain` to the transcript scroll owner.
4. Delete `MiniMap`, `ExecutionNodeData`, status color constants, and minimap JSX from `WorkflowDagViewer`.
5. Run the browser proof after all three local CSS fixes and require every local invariant to pass.
6. If root scrolling remains possible outside the room, add `min-h-0 overflow-hidden` to the fixed shell owner selected by measured ancestry.
7. If `Layout.tsx` changes, run an executable route sweep across Legacy Chat, Dashboard, Workflows, Builder, and Settings to prove each route keeps its intended scrolling.
8. Split desktop scroll, narrow layout, and runtime graph proofs into separate `T.xlong` cases, poll stable row load and geometry, and assign stable `[V:...]` tags.
9. Register those tags in the governed `verify-archon` browser catalog and feature contract.

## Refactor

Remove imports and constants made dead by minimap deletion.
Do not add JavaScript wheel interception, a custom scroll component, or a global overflow reset.
Keep CSS ownership local and explicit.

## Tests After

```bash
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
bun run build:web
(cd e2e && npm run typecheck && npx playwright test -c playwright.config.ts ui/workflow-run-hitl-room.spec.ts --grep 'Legacy.*scroll')
(cd e2e && npx playwright test -c playwright.config.ts ui/workflow-transcript-display.spec.ts --grep 'runtime graph')
bun x tsc --noEmit -p .agents/skills/verify-archon/tsconfig.json
bun run test:verification-skills
bun run type-check
bun run lint
bun run format:check
bun run validate
```

## Test scenario matrix

| Scenario                          | Required assertion                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pointer over transcript           | Inner `scrollTop` changes and the last row becomes reachable.                                                                                                                     |
| Transcript at bottom              | Further wheel input does not move document or headers.                                                                                                                            |
| Pointer moves to room header      | Wheel input keeps document scroll at zero.                                                                                                                                        |
| Pointer moves to blank graph area | Document stays fixed while graph-native zoom may occur.                                                                                                                           |
| Long tool history                 | Every direct `sr-only` label box remains inside its summary.                                                                                                                      |
| Split viewport                    | Room resizes and both panes remain bounded.                                                                                                                                       |
| `390x844` viewport                | Single-panel room remains bounded and fully reachable.                                                                                                                            |
| Keyboard at both viewports        | Tab and Shift+Tab keep visible focus, keyboard scrolling reaches transcript boundaries, and Ask or composer controls remain reachable with focus restored after room transitions. |
| Legacy runtime graph              | No minimap; controls, zoom, pan, fit, layout, focus, and selection work.                                                                                                          |
| Console runtime graph             | No minimap already; existing controls and selection remain green without source change.                                                                                           |

## Risks and controls

- A global overflow rule can break ordinary Legacy pages, so it is prohibited without a measured route sweep.
- Hiding overflow at the wrong ancestor can clip the transcript tail, Ask card, or composer, so browser reachability assertions are mandatory.
- Removing all minimap search results would change workflow builders, so only `WorkflowDagViewer` is edited.
- Graph wheel input is valid zoom behavior, but it must never move the document.
- The Console positioned-summary change is limited to the same root geometry defect and must pass the Console isolation test.

## Security considerations

This phase changes layout and presentation only.
Accessible labels, keyboard focus, and disclosure semantics must remain present and testable.

## Regression Gate

- [ ] The current scroll failure is captured before CSS changes.
- [ ] Root scroll height is no more than two pixels above client height at both required viewports.
- [ ] Root scroll position stays zero through inner-boundary and pointer-exit cases.
- [ ] The transcript tail, Ask cards, composer, navigator, and room resize remain reachable.
- [ ] Desktop and narrow keyboard traversal, visible focus, keyboard scrolling, and focus restoration pass.
- [ ] The Legacy runtime minimap is absent and all retained graph interactions pass.
- [ ] The new `[V:...]` cases are registered in `verify-archon` and the governed scenario executes each mapped test exactly once.
- [ ] Existing Legacy and Console component isolation suites pass.
- [ ] `bun run validate` passes with zero lint warnings and no weakened tests.

## Todo

- [ ] Add RED component and browser scroll contracts.
- [ ] Fix hidden-label, panel, and overscroll containment in measured order.
- [ ] Add RED minimap absence and retained-interaction assertions.
- [ ] Remove only the Legacy runtime minimap code.
- [ ] Register the stable browser tags and governed proof obligations.
- [ ] Run focused browser proofs and the complete validation gate.

## Success criteria

The Legacy run view remains a fixed viewport shell through the exact pointer-exit trigger, and the graph stays fully usable without its runtime minimap.

## Rollback

Revert the layout classes and their verifier mappings together if they clip content or affect unrelated routes.
Restore only the `WorkflowDagViewer` minimap code and its matching proof expectations if a verified graph usability regression requires it.
