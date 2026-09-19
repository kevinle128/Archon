---
title: 'Plan: issue 180 navigate transcript occurrences and loop iterations'
date: 2026-09-18
summary: 'Deep/TDD plan for Story 1.7 (CAP-6): occurrence grouping, loop-iteration selector, AD-7 amendment for loop-parent fetch scope; three red-team lenses adjudicated'
---

# Plan: issue 180 navigate transcript occurrences and loop iterations

## What happened

Planned GitHub issue #180 (ANR Story 1.7) at `plans/260918-1711-issue-180-navigate-occurrences-and-loop-iterations/`. Scouted both node rooms, `agent-history.ts`, the four duplicated selection helpers, and the read-only local SQLite database, which showed that a `loop:` node mints one outer occurrence (two non-contiguous lifecycle rows) plus one occurrence per iteration, so the multi-occurrence transcript that CAP-6 targets was unreachable on current data.

## Decision

Widen the fetch scope for exactly one row type — a top-level loop node's outer execution (`node_type === 'loop'`, empty `loop_ancestry`) — to node-scoped, sliced client-side by `retry_epoch`; recorded as an AD-7 amendment. Grouping keys on `occurrence_id`, ordered by first `seq`. The selector is a native `<select>` named `Occurrence`; arrow changes browse, pointer/Enter changes focus the heading; a ref suppresses the programmatic scroll event so pin-to-bottom cannot re-arm.

Red team: 16 findings (15 accepted, 1 rejected). The planner's own verification found and fixed the execution-ordering claim (`workflow-execution-history.ts:285` sorts by `started_at`, so the outer row is first and the E2E `[V:hitl.execution-scope]` case must select iteration options by label). Validation interview not run (non-interactive finish); decisions recorded with defaults.

## Next steps

`/ak:cook plans/260918-1711-issue-180-navigate-occurrences-and-loop-iterations/plan.md` — Phase 1 core first; Phases 2–3 each start with their scout pass.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
