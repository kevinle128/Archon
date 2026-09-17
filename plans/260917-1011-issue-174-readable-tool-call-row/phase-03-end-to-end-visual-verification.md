---
title: 'Phase 3: End-to-end visual verification'
status: todo
depends_on: [phase-01, phase-02]
---

# Phase 3: End-to-end visual verification

## Objective

Prove the issue through the closest end-user workflow and compare both product surfaces with the final Agent Node Room mockups.
This phase must validate behavior, responsive geometry, visual fidelity, accessibility, and repository quality without extending the fake provider for unit-test-only states.

## Requirements

- [ ] Use the existing fake-provider HITL workflow that already renders the same successful tool call in both surfaces.
- [ ] Keep the two updated HITL behavior specs green with one readable collapsed row.
- [ ] Use component tests for failed, malformed, interrupted, and live-transition states because the fake provider does not emit those variants.
- [ ] Verify the product row at a 460 px node-panel width.
- [ ] Compare Legacy and Console against their final mockups and the surface-independent transcript states sheet.
- [ ] Check row order, height, padding, gap, radius, font size, chip shape, glyph hierarchy, color, focus, elision, badge priority, and chevron motion.
- [ ] Use Playwright output attachments for captures and do not embed a plan ID in stable test code.
- [ ] Record the visual verdict and any accepted difference in this plan's report directory.
- [ ] Run the complete Web and repository gates after focused tests pass.

## File inventory

| Path                                                                              | Action                  | Purpose                                                                                          |
| --------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `e2e/ui/workflow-run-hitl-visual.spec.ts`                                         | Modify                  | Replace its hidden-output false-positive locator and document the Agent Node Room row authority. |
| `e2e/ui/agent-tool-row-visual.spec.ts`                                            | Create                  | Stable visual, width, focus, keyboard, and motion evidence.                                      |
| `plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md` | Create during execution | Human mockup comparison and capture references.                                                  |

Do not write new issue #174 captures into the old HITL plan capture directory.
Keep the old whole-view visual spec, but update its tool-row readiness locator so hidden payload text cannot make it pass.
Do not add fake-provider switches only to manufacture failed or malformed rows.

## Tests before implementation

Add the real-user E2E assertion before the renderer reaches green.

| Scenario                                   | Surface | Expected result                                                                                                           |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Open the inspect node in the run view      | Console | One visible tool row contains the chip and headline, starts collapsed, and does not visibly show serialized payload text. |
| Open Logs and select the same inspect node | Legacy  | The same tool call has the same row semantics and starts collapsed.                                                       |
| Activate the row with keyboard             | Both    | Native disclosure state changes and focus remains visible.                                                                |
| Set the panel to 460 px                    | Both    | The row remains one line, the headline shrinks, and the badge group does not wrap.                                        |
| Emulate reduced motion                     | Both    | Chevron transition duration is zero.                                                                                      |
| Compare product and mockup captures        | Both    | No unexplained high-salience difference remains.                                                                          |

## Visual verification matrix

| Property            | Expected value or behavior          | Evidence                                |
| ------------------- | ----------------------------------- | --------------------------------------- |
| Row font            | 12 px monospace                     | Computed style and capture.             |
| Chip and badge font | 11 px monospace                     | Computed style and capture.             |
| Row padding         | 4 px vertical and 6 px horizontal   | Bounding boxes and computed style.      |
| Row gap             | 8 px                                | Bounding boxes.                         |
| Row radius          | 6 px                                | Computed style.                         |
| Row target          | At least 24 px high                 | Bounding box assertion.                 |
| Chevron             | 9 px column, 120 ms rotation        | Computed style and interaction capture. |
| Glyph               | 12 px fixed column                  | Bounding box and capture.               |
| Focus               | 2 px `--accent-bright` outline      | Keyboard capture and computed style.    |
| Layout              | No wrapping at 460 px               | One-line bounding-box assertion.        |
| Path                | Middle elision with filename tail   | DOM and capture.                        |
| Badges              | Right aligned; duration drops first | Width-pressure assertion and capture.   |
| Motion              | No transition under reduce          | Media emulation and computed style.     |

## Interface and helper checklist

- [ ] Reuse `runHitlWorkflow()`, `openRunDetail()`, and `openLegacyRunDetail()`.
- [ ] Reuse the existing tool fixture constants.
- [ ] Use stable role, region, and `data-tool-id` locators instead of visual text alone.
- [ ] Add a deterministic helper that measures and sets the room to `460 ± 2` px before narrow-layout assertions.
- [ ] Use `testInfo.outputPath()` or attachments for all new screenshots.
- [ ] Keep mockup file paths stable and independent of the current plan directory.
- [ ] Keep visual assertions deterministic and free of network access.
- [ ] Do not add snapshot approval that can bless a wrong image without human comparison.

## Implementation steps

1. Update the existing whole-view visual spec so it locates the visible row summary instead of a visible outer card that merely contains hidden output text.
2. Add the stable visual spec with an uppercase `HITL` test title so the current CI grep includes it.
3. Add and assert a deterministic room-width helper that reaches `460 ± 2` px before row geometry checks.
4. Check long-path DOM anatomy in the Phase 2 component tests and use Phase 3 only for the real fixture's layout.
5. Add keyboard focus, reduced motion, and product screenshots to the stable visual spec.
6. Open and capture the final Console, Legacy, and transcript-state mockups through the existing Playwright local-file precedent.
7. Compare the product row with the mockups at matching panel width and record each matrix result in `reports/visual-acceptance.md`.
8. Fix every visible or measurable unexplained mismatch in the owning phase.
9. Run focused tests again after visual fixes.
10. Run the full Web package, E2E type check, Web type check, relevant E2E specs, and repository validation.
11. Update the sprint status only through its owning BMad workflow after every gate passes.

## Refactor

- [ ] Remove obsolete E2E expectations for visible Input and Output JSON.
- [ ] Consolidate repeated E2E navigation only when an existing helper already owns it.
- [ ] Keep product assertions separate from human visual comparison notes.
- [ ] Keep prior HITL captures in their old plan and write new row evidence only through Playwright output attachments.

## Tests after implementation

Run the focused E2E tests from `e2e`.

```bash
npx playwright test -c playwright.config.ts ui/workflow-run-hitl-room.spec.ts --grep "readable tool row"
npx playwright test -c playwright.config.ts ui/workflow-run-hitl.spec.ts --grep "readable tool row"
npx playwright test -c playwright.config.ts ui/workflow-run-hitl-visual.spec.ts --grep "HITL"
npx playwright test -c playwright.config.ts ui/agent-tool-row-visual.spec.ts
npm run typecheck
```

Run the broader gates from the repository root.

```bash
bun --filter @archon/web test
bun --filter @archon/web type-check
bun run validate
```

## Regression gate

- [ ] Focused shared and component tests from Phases 1 and 2 still pass.
- [ ] Both E2E surfaces pass in one run against the same stored tool call.
- [ ] The new visual test title matches the CI `--grep 'HITL'` filter.
- [ ] Visual evidence covers product and mockup at the 460 px contract.
- [ ] Web tests and Web type check pass.
- [ ] `bun run validate` passes with zero warnings.
- [ ] No unrelated pre-existing worktree file is modified.

## Dependencies

This phase depends on the shared row model and both completed renderer shells.
It does not require a provider, backend, schema, or generated-type change.
The existing fake-provider success case is the end-to-end behavior source, while Phase 1 and Phase 2 tests cover the other deterministic states.

## Risks and rollback

- Local-file mockup rendering can be blocked by browser security outside Playwright, so the test must use the repository's established Playwright local-file precedent.
- Font and antialiasing can make pixel snapshots unstable, so geometry and computed-style assertions carry the deterministic gate and screenshots carry human review.
- A broad E2E locator can match hidden diagnostic text, so visible row assertions must use the row summary and visibility checks.
- Split-pane drag math can miss the contract width, so every narrow assertion must first confirm the measured `460 ± 2` px room width.
- Rollback removes the issue-specific visual spec and restores the old E2E expectations without touching production data.

## Success criteria

- [ ] One real stored tool call renders as the required readable row in Legacy and Console.
- [ ] The 460 px, keyboard, focus, motion, elision, and badge-priority gates pass.
- [ ] The visual report records no unexplained mismatch against the final mockups.
- [ ] All focused, package, type, E2E, and repository checks pass.
