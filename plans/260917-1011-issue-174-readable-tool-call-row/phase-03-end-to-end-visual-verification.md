---
title: 'Phase 3: End-to-end and visual verification'
status: todo
depends_on: [phase-01, phase-02]
---

# Phase 3: End-to-end and visual verification

## Objective

Prove Story 1.1 through real Legacy and Console navigation, measure the canonical 460 px panel behavior, compare only the row slice owned by this story with final design artifacts, close the native-disclosure accessibility risk, and run repository gates.

## Files

| Path                                                                              | Action                       | Purpose                                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e/ui/workflow-run-hitl-visual.spec.ts`                                         | Modify narrowly              | Replace the `.ptool`/hidden-output readiness locator with a visible direct-summary locator; retain this older suite's existing capture ownership |
| `e2e/ui/agent-tool-row-visual.spec.ts`                                            | Create                       | Stable Story 1.1 geometry, focus, keyboard, motion, and screenshots                                                                              |
| `plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md` | Create during implementation | Human comparison, contrast, viewport, and assistive-technology record                                                                            |

Do not move or rewrite the older whole-view visual suite and do not write new issue captures into its old plan directory. New screenshots use `testInfo.attach()` or `testInfo.outputPath()`.

## Automated E2E contract

Reuse `runHitlWorkflow()`, `openRunDetail()`, `openLegacyRunDetail()`, the existing inspect-node constant, and the stored successful tool fixture. Do not add provider switches solely to manufacture other visual states.

The new spec title must contain uppercase `HITL` so `.github/workflows/test.yml` includes it. Required checks:

| Scenario                  | Console                                                                                                                       | Legacy                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Real stored tool          | Direct `details[data-tool-id] > summary` is visible, chip/headline readable, row closed, output not visible                   | Same after Logs → node selection                                |
| Keyboard                  | Focus summary, Enter/Space toggles native state, visible focus remains                                                        | Same                                                            |
| 460 px room               | Helper measures room width `460 ± 2` before assertions; summary parts share one line and badges do not wrap                   | Same                                                            |
| Existing responsive sweep | At 1440, 1024, 768, and 390 px viewports, a visible room keeps the summary on one line with no transcript-specific breakpoint | Same                                                            |
| 200% zoom                 | Existing zoom path keeps the visible row operable, one-line, and free of horizontal page overflow                             | Same                                                            |
| Focus                     | Computed outline is 2 px opaque accent-bright with +2 px offset                                                               | Computed outline is 2 px opaque accent-bright with −2 px offset |
| Motion                    | Normal chevron transition is 120 ms; reduced-motion emulation reports no transition                                           | Same                                                            |
| Rest/hover                | Rest row has no inset card fill/border; hover uses surface-hover                                                              | Same                                                            |
| Capture                   | Attach desktop context and 460 px row crop with stable names                                                                  | Same                                                            |

The room-width helper may drive the existing splitter, but must assert the measured content width before every narrow check; a viewport ratio alone is not proof. Use DOM bounding boxes/tops to prove one-line layout rather than a screenshot-only judgment.

## Required-state visual acceptance

The fake-provider fixture proves the successful state end to end. Phase 2 component tests must provide the remaining production-markup evidence; the report links each assertion rather than creating fake E2E provider behavior.

| State       | Initial/open evidence                        | Required visible treatment                                                                      |
| ----------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| succeeded   | E2E + both component suites; closed          | `✓`, success tone, readable chip/headline                                                       |
| failed      | Both component suites; open                  | `✕`, failure tone, nonzero exit digits contrast, body rail/family bar, diagnostics still closed |
| running     | Both component suites; closed                | `◐` plus visible `running` badge; Legacy accent-bright and Console `--running`                  |
| interrupted | History fold + both component suites; closed | `⚠`, warning tone, visible `interrupted` badge, word `interrupted` in accessible name           |
| unknown     | Both component suites; closed                | `–`, secondary tone, visible `output unknown`, word `unknown` in accessible name                |

For all five, component assertions must check the exact production class/style/token selection, not only text. The successful E2E capture then validates those shared geometry rules in both real surfaces.

For tones absent from the success fixture (search/glob text and failed exit digits), combine a component assertion of the exact production style value with a browser calculation that resolves the same token/`color-mix` against each surface's rest/hover background. Record the numeric ratios; do not claim a screenshot contains a state it does not.

## Visual measurement matrix

Record actual values for each surface in `visual-acceptance.md`:

| Property                      | Canonical result                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Row / chip / body-bar fonts   | 12 px mono / 11 px mono / 10.5 px mono                                                                                          |
| Transcript / summary geometry | 10 px/12 px transcript padding; no adjacent card gap; 4 px/6 px summary padding; 8 px gap; 6 px radius; ≥24 px height           |
| Columns                       | Chevron 10 px text/9 px fixed column; glyph 12 px text/12 px fixed column                                                       |
| Rest/hover                    | Room surface with no card border/fill; surface-hover only on hover                                                              |
| Chip                          | 1 px family border, 1 px/7 px padding, 4 px radius, ≤24ch                                                                       |
| Expanded body                 | 2 px top/8 px bottom/29 px left margin, 2 px rail, 10 px left padding, family first in bar                                      |
| Focus                         | 2 px accent-bright; Legacy −2 px offset, Console +2 px                                                                          |
| Layout at 460 px              | One line; headline shrinks; badges do not wrap; duration is first optional fact hidden                                          |
| Other required viewports      | Existing 1440/1024/768/390 sweep and 200% zoom remain one-line and usable; no row breakpoint is added                           |
| Path/URL                      | Shrinkable head and preserved final segment                                                                                     |
| Text                          | End ellipsis                                                                                                                    |
| Chevron                       | 90° open, 120 ms; zero transition under reduced motion                                                                          |
| Contrast                      | Search/glob chip text and nonzero exit digits ≥4.5:1 on both surfaces and applicable rest/hover backgrounds; focus outline ≥3:1 |

Long-path, width-priority, failed, and multi-badge cases are synthetic component fixtures because the real E2E row does not contain those data. The report must distinguish component evidence from real-fixture evidence.

## Mockup comparison rules

Open the final mockups using the repository's existing Playwright local-file precedent and compare at the same 460 px panel width. The Console mock is authored at 520 px; override only its panel width in the review page to 460 px, assert the measured width, and leave the artifact file unchanged. Review row order, baseline, spacing, typography, chip/glyph hierarchy, token color, rest/hover/focus, elision, and open-body rail.

Record these as expected, out-of-scope differences rather than mismatches:

- No final Raw button (Story 1.2); temporary Input/Output disclosures are closed.
- No family-specific terminal/search/path/code/web body (Story 1.3).
- No inline diff (Story 1.4), folded todo strip (1.5), task cards (1.6), or occurrence navigation (1.7).
- Count/diff/body richness shown by the complete mockup may exceed the conservative Story 1.1 badges.

Any other high-salience difference owned by Story 1.1 must be fixed or explicitly treated as a blocker; do not bless it as an unexplained screenshot delta.

## Accessibility verification

Automated checks:

- Summary accessible name reads state → family/tool → target → facts without chevron/glyph noise.
- Enter and Space toggle, Tab follows DOM order, and no arrow-key handler/roving tab index exists.
- Focus remains on summary through toggle and polling updates.
- Reduced-motion emulation disables the only row animation.

Manual completion gate required by `EXPERIENCE.md`:

- Test one Windows pairing (for example current Chromium + NVDA) and one macOS pairing (current Safari or Chromium + VoiceOver).
- Record OS/browser/AT versions, closed/open announcement, whether expanded state is spoken, status/family/target/facts order, Enter/Space behavior, and pass/fail.
- A failed or unavailable pairing is not silently waived. Record the issue and keep implementation status blocked until the design owner accepts an alternative pairing or the markup is fixed.

## Implementation order

1. Update only the old visual suite's readiness locator to a visible direct summary and remove its dependence on `HITL_TOOL_OUTPUT` for readiness if no other use remains.
2. Add the uppercase-HITL Story 1.1 visual spec with stable locators and Playwright-output attachments.
3. Implement and assert the `460 ± 2` room-width helper.
4. Add geometry, one-line, keyboard/focus, rest/hover, and reduced-motion assertions on both surfaces; retain the existing 1440/1024/768/390 and 200% paths and assert row layout wherever the room is visible.
5. Capture both product surfaces and canonical mockup row sections at a measured 460 px; apply a test-only width override to the 520 px Console mock and assert it before capture.
6. Create `visual-acceptance.md`; record automated values, scoped human comparison, expected later-story differences, contrast calculations, and both AT pairings.
7. Fix any Story 1.1 mismatch in its owning phase and rerun focused tests.
8. Run package, E2E type, HITL, and repository gates.

## Verification commands

From `e2e`:

```bash
npx playwright test -c playwright.config.ts ui/workflow-run-hitl.spec.ts ui/workflow-run-hitl-room.spec.ts --grep "HITL.*readable tool row"
npx playwright test -c playwright.config.ts ui/workflow-run-hitl-visual.spec.ts --grep "HITL"
npx playwright test -c playwright.config.ts ui/agent-tool-row-visual.spec.ts --grep "HITL"
bun run typecheck
```

From repository root:

```bash
bun --filter @archon/web test
bun --filter @archon/web type-check
bun run --cwd e2e typecheck
bun run validate
```

Also run the exact CI selector once from root because Playwright is outside the Bun workspace:

```bash
bun run --cwd e2e test:ui:hitl
```

## Exit criteria

- [ ] All three behavior cases pass against the same stored call in both surfaces.
- [ ] The old visual readiness locator cannot pass because payload text merely exists hidden in the DOM.
- [ ] Actual room width is measured at `460 ± 2` and both summaries remain one line.
- [ ] The existing four-viewport sweep and 200% zoom keep the row operable and one-line without a transcript breakpoint or page-level horizontal overflow.
- [ ] Geometry, focus offsets/contrast, rest/hover, path/text elision anatomy, and motion match the final design.
- [ ] All five status treatments have production-markup evidence; screenshots do not claim to cover states the fixture lacks.
- [ ] Visual report separates Story 1.1 parity from accepted later-story differences and contains no unexplained owned mismatch.
- [ ] Windows and macOS native-disclosure announcements pass and are recorded.
- [ ] Full Web tests/type-check, E2E type-check, CI HITL selector, and `bun run validate` pass with no unrelated diff.

## Rollback

The issue-specific visual spec and report can be removed without product/data impact. If product code is rolled back, revert the entire feature and its tests together; do not leave forward-facing E2E tests asserting the obsolete visible-JSON design.
