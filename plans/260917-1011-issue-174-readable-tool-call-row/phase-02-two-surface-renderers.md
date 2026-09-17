---
title: 'Phase 2: Two surface renderers'
status: todo
depends_on: [phase-01]
---

# Phase 2: Two surface renderers

## Objective

Replace the current always-open JSON cards with one native disclosure row in each target surface.
Both renderers must consume the same row model and keep only markup, local disclosure interaction, full-output diagnostics, and surface styling.

## Requirements

- [ ] Keep separate Legacy and Console markup shells.
- [ ] Do not import Legacy components from Console.
- [ ] Use one native `<details>` per tool call and make the complete `<summary>` the toggle.
- [ ] Hide the native marker and show one decorative chevron that rotates in 120 ms.
- [ ] Disable chevron motion for reduced-motion users.
- [ ] Render the fixed row order and never wrap it.
- [ ] Split path headlines into shrinkable head and fixed filename tail spans.
- [ ] End-elide text headlines.
- [ ] Keep badges at the right edge and hide duration first under width pressure.
- [ ] Render one minimal open-row facts line so a duration hidden by width pressure remains available after one disclosure.
- [ ] Use existing tokens for status, family, text, focus, border, and surface colors.
- [ ] Use the approved `color-mix` brightening for search and glob chip text and the failed exit badge where required by the design measurements.
- [ ] Give the row a 24 px minimum target and a 2 px `--accent-bright` focus-visible outline.
- [ ] Expose status and family meaning through text, title, and visually hidden labels, not color alone.
- [ ] Preserve operator toggles across polling updates.
- [ ] Open an untouched row if its outcome changes to failed.
- [ ] Do not auto-open running, interrupted, or unknown rows.
- [ ] Keep existing diagnostic payload disclosures closed until Story 1.2 replaces them with the Raw control.
- [ ] Never show serialized payload text when the outer row is collapsed or when a failed row first auto-opens.
- [ ] Preserve full-output loading and retry behavior without presenting it in the one-line summary.

## File inventory

| Path                                                                                  | Action                        | Purpose                                                                                         |
| ------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                             | Modify first                  | Legacy row, interaction, and diagnostic tests.                                                  |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                       | Modify first                  | Interactive Legacy rerender, toggle, and keyboard tests through the existing happy-dom harness. |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                  | Modify after red tests        | Legacy shell.                                                                                   |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`            | Modify first                  | Console row, interaction, and diagnostic tests.                                                 |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Modify after red tests        | Console shell shared by selected-room and inline-history uses.                                  |
| `packages/web/src/experiments/console/console-isolation.test.ts`                      | Conditional                   | Change only if an import rule needs an explicit approved shared-lib path.                       |
| `packages/web/src/lib/agent-history.test.ts`                                          | Modify after both shells move | Remove superseded context tests.                                                                |
| `packages/web/src/lib/agent-history.ts`                                               | Modify after both shells move | Remove the superseded context field and helper.                                                 |

## Tests before implementation

Write equivalent failing assertions for Legacy and Console before changing either renderer.

| Scenario                                      | Expected result                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Successful call                               | One closed details row with the five required row parts.                                                                                                     |
| Failed call                                   | One open details row with `✕` and an `exit n` badge.                                                                                                         |
| Running, interrupted, and unknown calls       | Closed rows with `◐`, `⚠`, and `–`.                                                                                                                          |
| User opens or closes a row, then props update | The selected state remains unchanged.                                                                                                                        |
| Untouched running call becomes failed         | The row opens once and remains operator-controlled afterward.                                                                                                |
| Path headline                                 | Filename tail remains visible while the leading path can shrink.                                                                                             |
| Text headline                                 | Text stays on one line and clips at the end.                                                                                                                 |
| Width pressure                                | Duration hides before exit, count, truncation, or missing-output facts.                                                                                      |
| Open-row facts                                | A duration hidden from the summary remains visible in the opened facts line.                                                                                 |
| Keyboard Enter and Space                      | The native disclosure toggles and focus remains visible.                                                                                                     |
| Accessible query                              | The row exposes status and family words without depending on color.                                                                                          |
| Collapsed row summary                         | No raw object or array dump, quoted JSON key, or visible Input or Output payload label appears; `{…}` and `[n]` are allowed only as bounded generic markers. |
| Auto-open failed row                          | Closed diagnostic payload disclosures do not expose JSON by default.                                                                                         |
| Full-output request                           | Existing fetch, loading, failure, and retry behavior still works after the row is opened.                                                                    |
| Extension slot                                | Existing after-item content stays anchored to the same tool identity.                                                                                        |

## Interface and component checklist

- [ ] Keep the shared `AgentHistoryItem` presentation model as the only source of family, headline, glyph, label, and badge decisions.
- [ ] Add only the minimal local state needed to distinguish untouched disclosure state from an operator toggle.
- [ ] Keep the existing `item.id` and `data-tool-id` stable during call/result pairing.
- [ ] Use the same DOM anatomy on both surfaces even when utility classes differ.
- [ ] Keep family chip text exact and add a family `title` or accessible-name cue.
- [ ] Mark the chevron `aria-hidden`.
- [ ] Add visually hidden status text when the visible glyph is not sufficient to name the state.
- [ ] Keep `formatToolIo()` out of the row summary.
- [ ] Keep current payload data available for the closed diagnostic disclosures and later Raw work.
- [ ] Scope collapsed-state assertions to the outer summary and separately assert that nested diagnostic disclosures are closed.
- [ ] Do not use `visibleText(markup)` or broad host `textContent` as evidence that hidden diagnostic content is visible.

## Implementation steps

1. Convert the old component assertions into row-contract assertions and confirm red tests on both surfaces.
2. Implement the Legacy `<details>` shell using the shared row presentation.
3. Add the untouched-versus-toggled disclosure state and test the running-to-failed update.
4. Keep current Input and Output diagnostic disclosures closed and below the row so failed auto-open does not reveal JSON.
5. Add the minimal facts line before the closed diagnostics and keep family-specific body content out of this story.
6. Preserve full-output loading and error retry below those disclosures.
7. Implement the same DOM anatomy in `ConsoleAgentHistoryList.tsx` without importing the Legacy shell.
8. Apply existing token-backed classes for family and status tone, hover, focus, geometry, and reduced motion.
9. Implement path middle elision with two spans and text end elision with one shrinkable span.
10. Mark duration as the lowest-priority badge and preserve the critical badges.
11. Use the existing interactive `LegacyNodeRoom.test.tsx` happy-dom harness for rerender and keyboard behavior instead of static markup.
12. Make both red E2E acceptance cases from Phase 1 green before this phase ends.

## Refactor

- [ ] Remove `toolOutcomeLabel()` and context-row rendering when the shared presentation supersedes them.
- [ ] Remove `AgentHistoryItem.context`, `TOOL_CONTEXT_KEYS`, `toolContext()`, and their old tests after both renderers move.
- [ ] Remove duplicated display decisions from both renderers.
- [ ] Keep small markup duplication because it enforces the Console isolation boundary.
- [ ] Do not create a shared React component or a new styling system.
- [ ] Keep surface differences to tokens and focus offset only.

## Tests after implementation

Run from `packages/web`.

```bash
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx
NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts
bun run type-check
```

Run the outside-in acceptance cases from `e2e`.

```bash
npx playwright test -c playwright.config.ts ui/workflow-run-hitl.spec.ts ui/workflow-run-hitl-room.spec.ts --grep "readable tool row"
```

## Regression gate

- [ ] Legacy and Console pass the same row behavior matrix.
- [ ] Console isolation tests pass.
- [ ] Existing full-output loading and retry tests pass.
- [ ] Existing empty, loading, error, filtering, and extension-slot tests pass.
- [ ] No renderer contains family detection, headline construction, or outcome mapping.
- [ ] The two HITL acceptance tests that started red in Phase 1 now pass in Legacy and Console.

## Dependencies

This phase consumes the row model from Phase 1.
The Legacy renderer is mounted by `NodeTranscriptPane.tsx` without a caller change.
The Console renderer is reused by both `ConsoleNodeRoom.tsx` and `ConsoleExecutionHistory.tsx`, so one change covers both paths.
Phase 3 verifies both mounted surfaces through the real E2E fixture.

## Risks and rollback

- Controlled disclosure state can fight native behavior, so the state must update only on an actual toggle or an untouched transition to failed.
- Hidden diagnostic content can still be read by broad text queries, so tests must distinguish visible text from DOM presence.
- Arbitrary utility classes can drift between shells, so the component matrix and visual comparison must check equivalent anatomy.
- Rollback must restore both renderer shells and the Phase 1 `AgentHistoryItem.context` contract in `agent-history.ts` and its tests.
- The safe rollback unit is all Phase 2 renderer, shared-history cleanup, and test edits together.

## Success criteria

- [ ] Legacy and Console show the same readable one-line tool row.
- [ ] All five outcomes have the correct glyph and initial open state.
- [ ] Operator disclosure choices survive polling, and untouched failures open.
- [ ] No serialized payload is visible in a default row state.
- [ ] Any summary fact dropped under width pressure remains available in the minimal open-row facts line.
- [ ] Focus, target size, motion, elision, badge priority, and color-independent meaning meet the design contract.
