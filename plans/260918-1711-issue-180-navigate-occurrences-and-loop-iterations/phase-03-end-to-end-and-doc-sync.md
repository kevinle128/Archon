---
phase: 3
title: 'End-to-end and doc sync'
status: pending
priority: P1
effort: '3h'
dependencies: [1, 2]
---

# Phase 3: End-to-end and doc sync

## Goal

Prove the feature on a real run through both routes, gather the visual and accessibility evidence the acceptance criteria demand, correct the two stale narrative passages and record the AD-7 amendment, run every repository gate, and open the PR.

Deep mode: outlined. Run the scout pass before editing.

## Context links

- Plan acceptance criteria "End to end, visual, accessible" and "Safety, compatibility, operations" in [plan.md](./plan.md).
- Red spec from Phase 1: `e2e/ui/agent-occurrence-navigation.spec.ts`.
- Precedent evidence report: `plans/260918-0826-issue-178-pinned-todo-strip/reports/visual-acceptance.md`.
- Docs to correct: `EXPERIENCE.md` lines 59 and 391; AD-7's last paragraph in `ARCHITECTURE-SPINE.md`.

## Scout pass (mandatory before editing)

1. Re-run `bun run --cwd e2e test:ui:hitl` on the Phase 2 tree to establish the green baseline before adding a spec that shares the fixture.
2. Re-read `e2e/lib/playwright/run-detail.ts` (`openRunDetail`, `openLegacyRunDetail`, `observeNodeMessagePages`) and the private `openConsoleLogRow` / `openLegacyLogRow` / `waitForRoom` helpers in `workflow-run-hitl-room.spec.ts`; if the new spec needs them, move them into `run-detail.ts` and re-export rather than copying.
3. Re-read the current text at `EXPERIENCE.md` lines 59 and 391 and AD-7's closing paragraph; line numbers will have drifted, so anchor on the phrases "Nothing anywhere scrolls to a selection" and "CAP-6 exists for the node-entry path".

## Tests before

- The existing `[V:hitl.execution-scope]` and `[V:hitl.room-reopen]` cases in `workflow-run-hitl-room.spec.ts` are the regression coverage for the `Execution` select contract; run them first and record the pass.
- `[V:hitl.execution-scope]` selects `option` 0 and 1 and polls for ≥2 distinct `occurrenceId` requests. Executions are ordered by `started_at`, so option 0 is the loop node's outer execution, which this plan turns into the unfiltered `All iterations` view. Before turning Phase 1's spec green, change that case to select the two options whose label starts with `Iteration` (locate by label, not index); its intent — two chips, two scoped requests — is preserved. Log row index 0 (`openConsoleLogRow(page, HITL_LOOP_NODE, 0)`) is likewise the outer row and now opens the grouped view; `[V:hitl.room-reopen]` keeps passing because it only asserts option value persistence and `Iteration 1` text (which the option list already contains).

Regression gate: `bun run --cwd e2e test:ui:hitl` green.

## Refactor

None to production code. Any helper moved into `e2e/lib/playwright/run-detail.ts` keeps its signature.

## Tests after

Make `agent-occurrence-navigation.spec.ts` green on both routes, then extend it with:

- **geometry**: after selecting `Iteration 2`, the heading's `boundingBox()` lies within the scroller's box; the `Occurrence` select's box height is at least 24 px and its top is above the scroller's top; at a 460 px room width the heading's computed font-size is `10.5px`, `text-transform` is `uppercase`, and the rule element spans to the heading's right edge (assert `rule.right ≈ heading.right` within 1 px)
- **accessibility tree** (`page.accessibility.snapshot()` or the CDP `Accessibility.getFullAXTree` helper already used by the todo-strip spec): one combobox named `Occurrence`, headings named `Iteration 1` and `Iteration 2`, and focus on the `Iteration 2` heading after navigation
- **live hold**: on the Legacy route, while the loop node is still running, navigate to `Iteration 1` (pointer), wait for one poll, and assert `scrollTop` did not jump to the bottom (use `observeNodeMessagePages` to know a page arrived). This case is never skipped: the `e2e-fake` scenario schema already accepts `delayMs` (`packages/providers/src/e2e-fake/provider.ts:133`, honoured by `waitUnlessAborted`), so add `e2e/fixtures/workflows/e2e-occurrence-live-loop.yaml` — a copy of `inspect-twice` whose iteration prompt carries `"delayMs": 8000` — and a matching runtime helper beside `runHitlWorkflow`; no provider change
- **keyboard multi-hop**: focus the `Occurrence` select, press ArrowDown twice, assert focus stays on the select and the scroller moved twice; press Enter and assert focus is on the `Iteration 2` heading
- **filter parity**: choosing the `Iteration 1` chip after navigation removes headings and the select, and `observeNodeMessagePages` records an `occurrenceId`-scoped request (the existing scope contract, re-asserted here so the two controls are proven independent)
- **default view unchanged**: on the completed run, opening the loop node from the Graph tab lands on the latest iteration (`chooseExecutionForNode` / `resolveGraphRoomRow` latest-order rule) with no headings and no `Occurrence` select; `All iterations` is the first `Execution` option and is opt-in

Screenshots at 460 px room width for both surfaces, collapsed and after navigation, saved under `reports/evidence/`.

## Doc sync

1. `EXPERIENCE.md` — Information Architecture bullet (line 59 today): after "the transcript can span several `occurrence_id`s — which is the only state in which the occurrence header renders", add that a `loop:` node's own execution opens node-scoped by design so its iterations render as groups. Rationale table row "Do the chips filter or scroll?" (line 391 today): replace "Nothing anywhere scrolls to a selection" with "The chips never scroll; the occurrence selector (CAP-6) scrolls to and focuses a group heading inside the loaded transcript."
2. `ARCHITECTURE-SPINE.md` AD-7 — append a dated amendment paragraph: the loop node's outer execution (`node_type === 'loop'`, no self-named `loop_ancestry`) fetches node-scoped so the node-entry path exists on current data; cite the live-DB shape (outer occurrence with two lifecycle rows, one occurrence per iteration) and note groups are keyed and ordered by first `seq` because the outer occurrence is non-contiguous.
3. Do not edit `SPEC.md` CAP-6, `test-plan.md`, or `sprint-status.yaml`.

## Gates

```bash
bun run --cwd e2e test:ui -- --grep 'occurrence'
bun run --cwd e2e test:ui:hitl
(cd packages/web && bun run type-check && bun run lint)
bun run validate
```

## Report

`reports/acceptance.md` records, per acceptance criterion: the test name that proves it, or the screenshot/AX file, or the manual-AT attempt (VoiceOver on macOS; NVDA on Windows if a Windows host is available, otherwise `blocked: no Windows host`). It also records the Phase 1 red run of the E2E spec and the Phase 2 scout notes.

## PR

- Branch off `develop`; conventional title `feat(web): navigate transcript occurrences and loop iterations`.
- Body from `.github/pull_request_template.md`: Problem and outcome, Review guidance (point reviewers at decision 1 and the `All iterations` default), Solution, Validation; drop unused sections and every instructional comment; `Closes #180`.

## Todo

- [ ] Scout pass recorded
- [ ] HITL regression baseline green
- [ ] Occurrence spec green on Console and Legacy, extended cases included
- [ ] Evidence screenshots and AX snapshots saved
- [ ] `EXPERIENCE.md` and AD-7 amended
- [ ] All gates green, `bun run validate` included
- [ ] `reports/acceptance.md` complete
- [ ] PR opened with template and `Closes #180`

## Success criteria

Every plan acceptance criterion maps to evidence in the report; both E2E suites and `bun run validate` are green; the docs no longer claim nothing scrolls to a selection; the PR is open against `develop`.

## Risk assessment

- **Fixture timing**: the live-hold case depends on a deterministic delay in the fake provider, not on racing `inspect-twice`; a conditional `test.skip` is not acceptable for this case because it is the only browser-accurate guard for the scroll-event re-arm finding.
- **Windows host absence** is a recorded blocker, not a failure.
- **Rollback**: focused revert; no data or infrastructure step.

## Dependency map

Depends on Phases 1 and 2. Unblocks Story 2.10, which reads the navigated key this phase proves.
