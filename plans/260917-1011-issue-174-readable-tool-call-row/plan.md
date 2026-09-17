---
title: 'Issue 174 readable tool call row'
description: 'Deep TDD implementation plan for one readable tool-call row in Legacy and Console node rooms.'
status: pending
priority: P1
effort: '3 phases'
tags: [issue-174, agent-node-room, web, tdd]
created: 2026-09-17
issue: 'https://github.com/kevinle128/Archon/issues/174'
---

# Issue 174 readable tool call row

## Outcome

Replace each current tool card in the Legacy and Console node rooms with one compact, readable disclosure row.
The row must show a chevron, status glyph, family chip, salient headline, and right-aligned badges without exposing serialized data while collapsed.
The implementation must use one React-free presentation policy and two thin surface renderers.

## Scope decision

**Decision: HOLD SCOPE.**
The repository already has call/result pairing, outcome derivation, duration lookup, paging, full-output identity, native disclosure elements, and both renderer seams.
The smallest complete change is one shared tool-row presenter, a small update to `buildAgentHistory()`, and markup changes in the two existing renderers.

### In scope

- Story 1.1 acceptance criteria from issue #174 and `epics.md`.
- Exact family resolution needed to build the row chip and headline.
- Table-driven initial disclosure state for all five outcomes.
- Immediate adjacent interruption folding.
- Exit-code propagation into the row badges.
- Unusual valid-JSON payload safety and explicit scan, string, and badge-extraction bounds.
- Pixel-accurate Legacy and Console rows at the 460 px panel contract.
- Keyboard, focus, accessible-name, and reduced-motion checks.

### Out of scope

- Story 1.2 Raw control and raw-panel redesign.
- Story 1.3 family-specific expanded bodies and production-corpus release audit.
- Story 1.4 inline diff presentation.
- Story 1.5 todo folding and pinned checklist state.
- Story 1.6 task and subtask cards.
- Story 1.7 occurrence and loop navigation.
- Operator transcript rows, live steering, Chat tool cards, and Console `ToolCallItem`.
- Provider, workflow, core, server, API, schema, migration, or generated-type changes.
- New dependencies, new theme tokens, or a shared React component.

## Authorities reviewed

Use the sources in this order when they differ.

1. `_bmad-output/specs/spec-agent-node-room/SPEC.md` and its contract files define behavior.
2. `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` defines the shared presentation rules.
3. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` defines visual values.
4. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` defines interaction, responsive, and accessibility behavior.
5. The final HTML mockups are visual references where they do not conflict with the documents above.

The reviewed mockups are `key-transcript-states.html`, `key-console-node-room.html`, `key-legacy-node-room.html`, and `full-transcript-review.html`.
The direct local browser preview was blocked by browser file-URL security, so the plan uses the complete HTML source plus the canonical design and experience documents.

## Goals

| #   | Goal                                                                                                | Priority |
| --- | --------------------------------------------------------------------------------------------------- | -------- |
| 1   | Derive one safe and deterministic tool-row presentation from stored tool data.                      | P1       |
| 2   | Render the same row contract in Legacy and Console without crossing the Console isolation boundary. | P1       |
| 3   | Prove the behavior with unit, component, E2E, responsive, visual, and accessibility evidence.       | P1       |

## Acceptance criteria

- [ ] Every stored tool call produces exactly one row in both target node rooms.
- [ ] The row order is chevron, status glyph, family chip, headline, and right-aligned badges.
- [ ] The outcome table is `succeeded → collapsed`, `failed → expanded`, `running → collapsed`, `interrupted → collapsed`, and `unknown → collapsed`.
- [ ] A running row that becomes failed opens if the operator has not toggled it, while an operator choice is preserved across polling updates.
- [ ] The five states use `✓`, `✕`, `◐`, `⚠`, and `–`, with non-color accessible labels.
- [ ] A one-token sent tool name of at most 24 characters is the chip text; every other name uses the resolved family.
- [ ] The collapsed row contains no raw serialized JSON dump, quoted JSON keys, or visible Input or Output payload label.
- [ ] `{…}` and `[n]` appear only as bounded generic summary markers and never as an expanded serialized value.
- [ ] Unusual valid-JSON values, missing fields, deep objects, wide objects, and long strings produce a safe generic row and cannot throw.
- [ ] Corrupt persisted rows continue to use the existing API error path and do not enter the presenter.
- [ ] Bounded scans, source slices, output lengths, and count-badge extraction have named limits and deterministic tests.
- [ ] An `interrupted` status row immediately after a tool call changes that tool row to `⚠ interrupted` and does not render a separate lifecycle row.
- [ ] Exit code, output state, count facts, and duration use the shared badge policy, and duration is the first badge hidden under width pressure.
- [ ] Any fact hidden from the row under width pressure remains visible in the minimal open-row facts line.
- [ ] Rows do not wrap at the 460 px panel width, paths retain the filename tail, and text headlines elide at the end.
- [ ] The summary target is at least 24 px high and uses a visible 2 px `--accent-bright` focus outline.
- [ ] The chevron rotation uses 120 ms and is disabled by reduced-motion preference.
- [ ] Existing full-output loading, `data-tool-id`, tool-use identity, extension slots, ordering, paging, and empty/error states remain intact.

## Dependency map

```text
Stored transcript rows and workflow events
                 |
                 v
Phase 1: pure row presentation + shared history projection
                 |
                 v
Phase 2: Legacy shell + Console shell
                 |
                 v
Phase 3: E2E, visual, accessibility, and repository gates
```

No other active local plan owns these target files.
The prior `plans/260909-2130-live-interactive-agent-view/design.md` is an accepted design record, not an implementation dependency.

## Phases

| #   | Phase                                                                          | Status  | Depends on     |
| --- | ------------------------------------------------------------------------------ | ------- | -------------- |
| 1   | [Shared tool-row presentation](./phase-01-start.md)                            | Pending | None           |
| 2   | [Two surface renderers](./phase-02-two-surface-renderers.md)                   | Pending | Phase 1        |
| 3   | [End-to-end visual verification](./phase-03-end-to-end-visual-verification.md) | Pending | Phases 1 and 2 |

## Global file inventory

| Path                                                                                  | Action                  | Owner                                      |
| ------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------ |
| `packages/web/src/lib/tool-presentation.ts`                                           | Create                  | Phase 1                                    |
| `packages/web/src/lib/tool-presentation.test.ts`                                      | Create                  | Phase 1                                    |
| `packages/web/src/lib/agent-history.ts`                                               | Modify                  | Phases 1 and 2                             |
| `packages/web/src/lib/agent-history.test.ts`                                          | Modify                  | Phases 1 and 2                             |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                  | Modify                  | Phase 2                                    |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                             | Modify                  | Phase 2                                    |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                       | Modify                  | Phase 2                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Modify                  | Phase 2                                    |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`            | Modify                  | Phase 2                                    |
| `e2e/ui/workflow-run-hitl.spec.ts`                                                    | Modify                  | Phase 1 red acceptance test, Phase 2 green |
| `e2e/ui/workflow-run-hitl-room.spec.ts`                                               | Modify                  | Phase 1 red acceptance test, Phase 2 green |
| `e2e/ui/workflow-run-hitl-visual.spec.ts`                                             | Modify                  | Phase 3                                    |
| `e2e/ui/agent-tool-row-visual.spec.ts`                                                | Create                  | Phase 3                                    |
| `plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md`     | Create during execution | Phase 3                                    |

`packages/web/src/experiments/console/console-isolation.test.ts` changes only if a new import crosses an existing rule.
No CSS file is planned because the current token-backed utility classes can express the design.
Do not add a CSS file only to avoid readable local classes.

## Implementation preflight

Issue #174 currently has `status:processing`, and its latest comment reports an Archon Loop run in progress.
No matching pull request was found, while local sprint status still says backlog.
The plan registry also reports active plan `Archon/260917-0323`, titled `174 scan tool call readable row`, in `/Users/dale/orca/workspaces/Archon/develop`.
Treat that matching alternate-worktree plan as an execution gate, not as a cross-plan dependency.
Before implementation, recheck the issue, pull requests, reported run, and matching plan so that this work does not duplicate an active implementation.
Stop and coordinate if that run or plan still owns the same files.

## Verification strategy

Run the narrowest red test before each production change.
Run package commands from the package directory or through `bun --filter` so Bun uses the correct configuration.
Never run `bun test` from the repository root.
After focused tests pass, run the complete Web package tests, Web type check, the relevant Playwright specs, and `bun run validate`.

## Risks and rollback

| Risk                                                      | Control                                                                                        | Rollback                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A partial presenter implements later stories by accident. | Keep the model to row fields and current diagnostic preservation only.                         | Revert the row-only presenter and renderer commits without changing stored data.                      |
| A polling update overrides an operator disclosure choice. | Track untouched versus operator-toggled state in each shell and test the transition.           | Fall back to initial-only native disclosure behavior if the state logic cannot be made deterministic. |
| Unusual JSON payloads cause slow scans or exceptions.     | Use a public fallback boundary plus named caps for fields, source text, and badge extraction.  | Disable family resolution and return the generic row for the affected input.                          |
| Console imports Legacy code.                              | Keep shared logic in `packages/web/src/lib` and keep two markup shells.                        | Revert the offending import and duplicate only the small markup shell.                                |
| Visual evidence is tied to a plan ID in test code.        | Write captures through Playwright `testInfo` and record the human verdict in this plan report. | Remove the new visual spec without touching product behavior.                                         |

## Definition of done

- [ ] Every phase success criterion is checked with evidence.
- [ ] All issue acceptance criteria map to a passing test or a recorded visual review.
- [ ] The mockup comparison has no unexplained geometry, typography, color, focus, or elision difference.
- [ ] Focused tests, full Web tests, Web type check, relevant E2E tests, and `bun run validate` pass.
- [ ] The implementation preflight confirms that no other active run, plan, or pull request owns this issue.
- [ ] Sprint status moves to done through its owning BMad workflow, not by a manual YAML edit.
- [ ] No generated file, changelog, API surface, database schema, or unrelated plan changes.

<!-- slug: issue-174-readable-tool-call-row -->
