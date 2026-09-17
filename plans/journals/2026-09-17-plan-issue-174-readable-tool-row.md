---
title: Plan issue 174 readable tool row
date: 2026-09-17
summary: Deep TDD plan for the Agent Node Room tool-call row
---

# Plan issue 174 readable tool row

## What happened

Planned GitHub issue #174 after reading the final Agent Node Room mockups, design, experience, specification, presentation contract, current transcript pipeline, renderer tests, and HITL E2E coverage.
The existing data path already carries every Story 1.1 field, but `agent-history.ts` drops exit code and does not fold an adjacent interrupted status row.
The current Legacy and Console renderers both show always-open serialized Input and Output blocks.

## Decision

Use one bounded React-free row presenter in `packages/web/src/lib`, integrate it in `buildAgentHistory()`, and keep separate Legacy and Console markup shells.
Start outside-in with the two stale HITL visible-output assertions as red tests.
Keep Raw, family bodies, diffs, todo, task, occurrence navigation, steering, API, and schema work out of scope.
Preserve current diagnostics behind closed nested disclosures and add only a minimal open-row facts line for badges hidden under width pressure.

## Review result

Three red-team reviews found an E2E contract blocker plus concrete provider-shape, payload-boundary, count-bound, interaction-test, rollback, and 460 px verification gaps.
The accepted findings are applied, and two independent final verifiers found no remaining issue.
`ak plan validate` passes.

## Next steps

Before implementation, resolve the active matching plan `Archon/260917-0323` in `/Users/dale/orca/workspaces/Archon/develop` and the GitHub `status:processing` run to avoid duplicate work.
Then execute `plans/260917-1011-issue-174-readable-tool-call-row/plan.md` phase by phase with the recorded TDD gates.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
