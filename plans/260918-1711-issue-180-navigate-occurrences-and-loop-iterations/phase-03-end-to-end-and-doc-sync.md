---
phase: 3
title: 'Integration, visual evidence, documentation, and gates'
status: pending
priority: P1
effort: 'Evidence matrix, doc verification, gates; reachability fixed by recorded B1'
dependencies: [1, 2]
---

# Phase 3: integration, visual evidence, documentation, and gates

## Goal

Prove the accepted Story 1.7 behavior through the reachable public path, capture visual/accessibility evidence for every required state on both shells, synchronize only the canonical documents affected by the accepted decisions, and run repository gates.

## Integration strategy (B1 recorded: compatibility-only, 2026-09-19)

- Keep all occurrence/attempt network assertions green: choosing an occurrence execution sends exact `occurrenceId`/`attemptId` filters and returns one group with no headings/navigator.
- Use component tests as the primary proof of multi-occurrence behavior.
- A Playwright test may intercept/seed a valid node-scoped multi-occurrence response to prove browser layout and navigation, but its report must call it **renderer integration**, not a real modern-loop reachability test.
- Do not modify the current loop fixture, call the view `All iterations`, or claim Story 2.10 is unblocked — the AD-7 amendment records that Story 2.10 stays blocked on a future reachability decision.

Do not write an E2E test whose fixture cannot reach the asserted state under the accepted runtime.

## Visual acceptance matrix

Capture both Legacy and Console after behavior is final. Use the repository's existing evidence conventions; do not commit screenshots unless the owning plan/report convention requires them.

| State                                          | Required proof                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Zero/unscoped historical metadata              | Flat transcript; no empty heading/control                                                                                     |
| Single occurrence                              | Flat transcript; no occurrence heading/navigator                                                                              |
| Multiple retry occurrences                     | `Run 1 · failed`, `Run 2 · retry` (or the exact adopted combined-suffix rule), one rule per heading, unique navigator targets |
| Multiple loop occurrences                      | `Iteration N` labels from final ancestry and approved navigator behavior                                                      |
| Colliding route/nested base labels             | Distinct B4-approved visible and accessible names; no raw UUIDs                                                               |
| Console filtered to one displayable group      | No headings/navigator; attached Ask remains if present                                                                        |
| Partial/error state with already loaded groups | Existing rows/headings remain; incomplete notice and retry remain reachable                                                   |
| Live append after navigation                   | Manual-hold state: appends do not move the viewport or focus; `Jump to latest` re-pins                                        |
| Target removed on filter/scope change          | Select returns to `N occurrences` placeholder; focus lands on the select or the scroller, never `<body>`                      |

Required viewports/layouts:

1. **Authoritative room width:** both shells with the room at 460px; verify 10.5px mono uppercase headings, `0.08em`, `text-secondary`, `10px 0 5px`, 1px rule to right edge, no horizontal overflow, and unchanged one-line transcript rows.
2. **Host small viewport:** use the route's existing small-viewport breakpoint (record the actual viewport used, with 390×844 as the current regression precedent if still supported); verify the transcript introduces no breakpoint, headings stay contained, and the `Jump to` select remains operable with end-elision.
3. **Keyboard/focus state:** capture the B2-defined focus result on both shells — focus moves to the target `h3` heading after commit; the select carries the shell focus ring (Console's opaque accent-bright token, Legacy's existing treatment).

## Accessibility evidence

- Accessibility tree contains one `h3` heading per rendered occurrence with the exact visible name and no heading for prefix/unkeyed content.
- The navigator exposes the `Jump to` label as its accessible name, the `N occurrences` placeholder at rest, option names identical to the headings, and `aria-controls` naming the current target heading after a commit.
- DOM/accessibility order matches the visual group order.
- Keyboard-only traversal and activation work on both shells with the same outcome.
- Navigation does not cause per-row live-region announcements; existing transition/failure status behavior is unchanged.
- Automated evidence is required. Manual VoiceOver/NVDA checks are useful when hosts are available but are not fabricated or made a false cross-platform completion claim.

## Existing regressions to preserve

- Execution select filters/refetches individual occurrences and persists the selected row.
- Pagination high-watermark, refresh, scope abort, and partial failure behavior.
- Todos remain pinned in their current canonical position.
- Ask cards remain scoped/anchored/actionable as before.
- Live follow, manual hold, restored scroll, and “Jump to latest”.
- Console tool/system toggles and Console import isolation.

## Documentation sync

The canonical documents were amended at the decision gate (2026-09-19): `EXPERIENCE.md` carries the B2 navigator contract and the B4 disambiguation rule, `DESIGN.md` the navigator component (delta 5), and `ARCHITECTURE-SPINE.md` the B1 amendment on AD-7. Remaining work here is verification, not drafting:

1. Re-read each amended section and confirm the built behavior matches it — `Execution` still described as filtering, the `Jump to` navigator as scrolling; remove any wording that drifted from what shipped.
2. AD-7's fetch/selection contract is unchanged (compatibility-only), so no aggregate text may appear; the B1 amendment already records that.
3. If the implementation had to deviate from the delta-5 component spec, reconcile `DESIGN.md`/`EXPERIENCE.md` so one answer remains — do not leave two.
4. Do not edit generated types, schemas, unrelated specs, or sprint status as documentation cleanup.

After verification, check every link and every claimed path against code/tests.

## Validation commands

B1 is compatibility-only, so no real-path Playwright spec exists for a modern aggregate loop. The optional seeded/intercepted spec is `e2e/ui/occurrence-navigation.spec.ts` and is labelled renderer-integration evidence in the report — if it is not written, the e2e gate is `(cd e2e && bun run typecheck)` alone.

```bash
(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts src/lib/occurrence-groups.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run type-check)
bun run lint --max-warnings 0
(cd e2e && bun run typecheck)
# Optional renderer-integration spec if written:
# (cd e2e && bun run test:ui -- occurrence-navigation.spec.ts)
bun run validate
```

Do not run root `bun test`.

## Evidence report

Create `reports/acceptance.md` during implementation. For every acceptance criterion record:

- test name and command;
- whether evidence is pure, component, renderer-integration, or real end-to-end;
- screenshot/AX artifact when applicable;
- actual viewport/room width;
- B1 reachability mode and explicit limitation;
- aggregate page/timing measurements if applicable;
- unavailable manual AT environments as unavailable, not passed.

## PR and workflow handoff

- The PR base is `develop` (B3 recorded 2026-09-19). Refresh from it — after PR #202 resolves — and re-run focused baselines before opening a PR.
- Use `.github/pull_request_template.md` explicitly; keep required sections, remove instructional comments/unused sections, and include `Closes #180` only when all accepted issue criteria are actually met.
- Conventional title: `feat(web): navigate transcript occurrences` — no public contract was added, so no qualifier is needed.
- Run `bun run validate` before PR.
- The owning BMad workflow moves `1-7-navigate-transcript-occurrences-and-loop-iterations` to `done` only after implementation evidence and acceptance are complete.

## Exit criteria

- [ ] Integration evidence matches the recorded compatibility-only reachability; no mocked renderer test is called server E2E.
- [ ] Visual matrix and accessibility checks pass on both shells at required layouts.
- [ ] Existing Execution/filter, pagination, Ask, todo, and scroll contracts remain green.
- [ ] Canonical docs have one non-conflicting answer for filtering versus navigation.
- [ ] Focused suites, relevant Playwright checks, type-check, lint, Console isolation, and `bun run validate` pass.
- [ ] Acceptance report maps every criterion to honest evidence.
- [ ] PR/handoff follows repository workflow; no premature sprint-status mutation.

## Rollback

Revert the focused PR; no database or cleanup action. B1 adopted compatibility-only, so there is no public/API change needing a separate rollback plan.
