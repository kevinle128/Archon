---
title: 'Plan issue 189: live queue across tabs and operators'
date: 2026-09-19
summary: 'Deep/TDD plan for the steering queue read route, snapshot reconciliation in both docks, and two-tab E2E; advisor review changed 422 handling to self-healing.'
---

# Plan issue 189: live queue across tabs and operators

## What happened

Planned Story 2.9 (issue #189) as `plans/260919-1418-issue-189-live-queue-across-tabs/` with three phases: (1) `GET /api/workflows/runs/:runId/nodes/:nodeId/queue` plus pure reconcile/poll helpers in `packages/web/src/lib/steering-dock.ts`; (2) both dock renderers polling on the existing 1 s transcript cadence; (3) a two-tab / two-operator Playwright spec on both shells and sprint-status closeout.

Scouting confirmed there is no queue read at all today (`steering-dock.ts:1-9` and both dock docblocks say so), the registry already exposes `snapshot()` (`steering-registry.ts:144`), and the E2E runtime already carries starter/teammate identities via `X-Archon-User`.

## Decision

- Dedicated read route, not embedding the in-process queue in the DB-backed `/messages` poll.
- A `queueGeneration` counter bumped on local send/withdraw success guards against a stale poll response resurrecting a withdrawn row.
- Advisor review caught that `dag-executor.ts` persists `node_started` (`:2018`) roughly 28 awaits before the steering handle registers (`:3001`), so "stop polling on read 422" would strand an open room as detached on an in-process run. The plan now keeps polling on 422, discloses detached only after three consecutive 422 reads, and heals on a later 200 (a snapshot clears only a `not_steerable_here` refusal so a local 409 alert survives).
- The Story 2.1 detached E2E scenario must be rewritten because the disclosure now comes from the read.

## Next steps

`/ak:cook /Volumes/WD_BLACK/archon/workspaces/anhle128/Archon/worktrees/archon/thread-8205f1df/plans/260919-1418-issue-189-live-queue-across-tabs/plan.md`. Re-scout Phases 2–3 anchors before each (deep mode). Task hydration was skipped: no live task surface in this session.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
