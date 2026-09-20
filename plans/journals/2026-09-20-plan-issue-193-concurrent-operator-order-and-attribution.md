---
title: 'Plan issue 193: concurrent operator order and attribution'
date: 2026-09-20
summary: 'Deep TDD plan for ANR Story 2.13; proof-and-harden, red-teamed with 14 accepted findings'
---

# Plan issue 193: concurrent operator order and attribution

## What happened

Planned ANR Story 2.13 (issue #193) with `/ak-plan --deep --tdd`. Scouting showed the ordering and attribution mechanism already exists: `NodeSteeringHandle.accept()` is synchronous FIFO, `resolveAuthContext` is per request, `appendOperatorTranscript` writes rows in drained order with `operator_user_id` + `message_id`, and the read model batches display names per node. AD-11 forbids a per-node lock, so the story became a proof-and-harden plan: five phases of tests (registry, route, executor + read model, E2E on both shells, closeout) at `plans/260920-0444-issue-193-concurrent-operator-order-attribution/`.

## Red team

Three reviewers (security, failure-mode, assumptions) returned 17 findings; 14 accepted, 1 rejected on merit, 2 deduplicated. The material corrections: the route-level interleaving control was redesigned from call-order-indexed deferred `getWorkflowRun` promises (indistinguishable arguments) to an identity-keyed gate on `findOrCreateUserByPlatformIdentity`, waiting on responses rather than resolver slots; `NodeSteeringHandle` is a type-only import in `api.workflow-runs.test.ts`, so `spyOn(prototype)` needs a value import; Phase 3's send-now test awaits the `interrupt()` settlement promise instead of the polling `awaitIdle()`; "per-operator order" was narrowed to per-dock-instance (`sendInFlight` is local composer state); the `X-Archon-User` trust boundary on ungated installs and the unaudited cross-operator withdraw were recorded as non-goals/open questions rather than silently accepted.

## Decision

No product change is planned unless a test goes red. Queue-read attribution, interrupt attribution, and a durable withdraw trace are out of scope; the last two are surfaced to the owner as open questions with defaults.

## Next steps

`/ak:cook plans/260920-0444-issue-193-concurrent-operator-order-attribution/plan.md`, then PR into `develop` with `Closes #193`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
