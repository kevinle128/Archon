---
title: 'Plan: issue 192 fail abandoned redirect after 30 minutes'
date: 2026-09-20
summary: Deep/TDD plan for ANR Story 2.12 with red-team adjudication
---

# Plan: issue 192 fail abandoned redirect after 30 minutes

## Context

Planned Story 2.12 (issue #192): fixed 30-minute inactivity timer for idle-after-interrupt nodes, keepalive route, dock disclosure, NEVER SENT cause-naming copy, fresh-session retry. Plan dir: plans/260920-1759-issue-192-fail-abandoned-redirect-after-30-minutes (5 phases, ~20h).

## Design decisions

- Timer lives on NodeSteeringHandle as a third resolver of the existing single-resolve idle waiter (new `expired` wake), so exactly-once is inherited; executor adds an explicit fail finalizer at both idle sites; keepalive route copies the interrupt guard ladder.
- Duration injectable at registry construction; `clearForTests()` also resets the override; E2E-only env override gated on `ARCHON_E2E_FAKE_PROVIDER === '1'` exactly with a positive-safe-integer guard.
- No fake timers anywhere: Bun 1.3.14 `jest.useFakeTimers()` works but `Bun.sleep` hangs under it (verified with a scratch test that stalled), and the executor suite polls with `Bun.sleep(1)`.
- Cause-naming NEVER SENT copy (`EXPERIENCE.md:256`) included because Story 2.11's plan explicitly deferred "idle-expiry timer/copy" to 2.12; evidence comes from `NodeExecution.error` on the selected node row with an explicit ordering (retry_epoch, started_at, index).

## Red team

15 findings (3 reviewers), 10 accepted, 5 rejected/merged. Notable: the `archon` Playwright fixture must destructure the worker option to consume it; loop-group body error is wrapped at the outer node, so assert on the namespaced body row; server restart during idle-await is an accepted, documented limitation (no startup sweep per the No Autonomous Lifecycle Mutation rule).

## Process notes

`ak plan create` stamped 260920-1110; renamed to the hook's 260920-1759 and reindexed (verified again). Validation interview not run (unattended session); recorded in plan.md Validation Log.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
