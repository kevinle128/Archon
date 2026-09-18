---
phase: 3
title: 'Integration, visual evidence, documentation, and gates'
status: blocked
priority: P1
effort: 'Estimate after B1/B2/B4'
dependencies: [1, 2]
---

# Phase 3: integration, visual evidence, documentation, and gates

## Goal

Prove the accepted Story 1.7 behavior through the reachable public path, capture visual/accessibility evidence for every required state on both shells, synchronize only the canonical documents affected by the accepted decisions, and run repository gates.

## Integration strategy depends on B1

### If B1 is compatibility-only

- Keep all occurrence/attempt network assertions green: choosing an occurrence execution sends exact filters and returns one group with no headings/navigator.
- Use component tests as the primary proof of multi-occurrence behavior.
- A Playwright test may intercept/seed a valid node-scoped multi-occurrence response to prove browser layout and navigation, but its report must call it **renderer integration**, not a real modern-loop reachability test.
- Do not modify the current loop fixture, call the view `All iterations`, or claim Story 2.10 is unblocked.

### If B1 adds a first-class aggregate loop view

- Add a real workflow/run path that selects the aggregate view through its approved UI entry and observes an unambiguous aggregate request/selection identity.
- Prove exact isolation for retry epochs, nested loops, route activations, and Ask ownership per the accepted contract.
- Prove the aggregate request cannot cross the selected run/node or broaden the installation's existing authorization policy, and that error logging contains identifiers rather than transcript/Ask bodies.
- Record page count, time to first rendered group, completed render time, and interaction responsiveness for the verified 3,465-row / seven-occurrence local sample. Compare against the owner-approved budget from Phase 1.
- Preserve regression coverage for selecting two individual iterations and seeing two distinct occurrence-filtered requests.

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
| Live append after navigation                   | B2-approved scroll/focus/follow outcome; no unexpected snap                                                                   |
| Target removed on filter/scope change          | B2-approved reset/reconciliation; no stale value or dead target                                                               |

Required viewports/layouts:

1. **Authoritative room width:** both shells with the room at 460px; verify 10.5px mono uppercase headings, `0.08em`, `text-secondary`, `10px 0 5px`, 1px rule to right edge, no horizontal overflow, and unchanged one-line transcript rows.
2. **Host small viewport:** use the route's existing small-viewport breakpoint (record the actual viewport used, with 390×844 as the current regression precedent if still supported); verify the transcript introduces no breakpoint, headings stay contained, and the approved control remains operable.
3. **Keyboard/focus state:** capture the B2-defined focus-visible result on both shells; Console uses its opaque accent-bright focus token and Legacy its existing focus treatment.

## Accessibility evidence

- Accessibility tree contains one heading at the B2-approved level per rendered occurrence with the exact visible name and no heading for prefix/unkeyed content.
- Approved navigator has the exact accessible name, current/default state, and relationship specified by B2.
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

Read each document immediately before editing and update only accepted behavior:

1. **Always after B2:** correct `EXPERIENCE.md` so the existing `Execution` control is still described as filtering while the approved Story 1.7 navigator has its distinct navigation/focus behavior. Update component, accessibility, and responsive text required by the adopted artifact.
2. **Only if B1 changes fetch/selection:** amend AD-7 and the Information Architecture section with the first-class aggregate contract, including nesting/retry/route/paging/Ask boundaries. Do not append the rejected `loopParent` workaround.
3. **If visual authority was added in Phase 1:** ensure `DESIGN.md` and any adopted mock/handoff agree; remove superseded contradictory wording rather than leaving two answers.
4. Do not edit generated types, schemas, unrelated specs, or sprint status as documentation cleanup.

After updates, verify every link and every claimed path against code/tests.

## Validation commands

Finalize exact Playwright filenames/grep after B1 fixes the integration path.

```bash
(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts src/lib/occurrence-groups.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run type-check)
bun run lint --max-warnings 0
(cd e2e && bun run typecheck)
# B1-specific Playwright command(s), recorded here after the gate.
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

- Use the branch target confirmed by B3; do not guess between `dev` and `develop`. Refresh from it and re-run focused baselines before opening a PR.
- Use `.github/pull_request_template.md` explicitly; keep required sections, remove instructional comments/unused sections, and include `Closes #180` only when all accepted issue criteria are actually met.
- Conventional title: `feat(web): navigate transcript occurrences` (adjust if B1 adds a separately reviewed public contract).
- Run `bun run validate` before PR.
- The owning BMad workflow moves `1-7-navigate-transcript-occurrences-and-loop-iterations` to `done` only after implementation evidence and acceptance are complete.

## Exit criteria

- [ ] Integration evidence accurately matches B1 reachability; no mocked renderer test is called server E2E.
- [ ] Visual matrix and accessibility checks pass on both shells at required layouts.
- [ ] Existing Execution/filter, pagination, Ask, todo, and scroll contracts remain green.
- [ ] Canonical docs have one non-conflicting answer for filtering versus navigation.
- [ ] Focused suites, relevant Playwright checks, type-check, lint, Console isolation, and `bun run validate` pass.
- [ ] Acceptance report maps every criterion to honest evidence.
- [ ] PR/handoff follows repository workflow; no premature sprint-status mutation.

## Rollback

For the common Web-only path, revert the focused PR; no database or cleanup action. If B1 authorized a public/API change, execute the separately documented compatibility/rollback steps added at the decision gate.
