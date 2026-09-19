---
title: Plan issue 182 withdraw queued guidance
date: 2026-09-19
summary: "Deep+TDD plan for Story 2.2: registry withdraw primitive, typed DELETE route, delete control in both shells"
---

# Plan issue 182 withdraw queued guidance

## What was planned

Issue #182 (ANR Story 2.2, withdraw a queued guidance message) was planned in `--deep --tdd` mode at `plans/260919-0135-issue-182-withdraw-queued-guidance-message/` on top of the merged Story 2.1 (#207). Three phases: (1) `NodeSteeringHandle.withdraw()` plus the ratified `DELETE …/queue/:messageId` route, (2) a per-row `delete` control in the Legacy and Console composer docks sharing `@/lib/steering-dock` transitions, (3) E2E drain-exclusion proof, route ladder, accessibility evidence, and closeout.

## Decisions worth remembering

- Withdraw removes from `pending` only; accepted-id memory stays so a replayed send never re-queues a withdrawn message.
- The route ladder mirrors send except that a parked (AskHuman) handle accepts withdraw — the queue is intact while parked and the band still renders in the blocked dock.
- `messageId` is UUID-validated (400) because the send schema only ever accepts UUIDs; a non-UUID can never be "unknown-but-queued".
- The target-resolution ladder is duplicated inline in the withdraw handler (two callers, rule of three not met); the send handler is untouched.
- Focus after removal: next row's delete → previous row's → the textarea; never `<body>`.

## Pitfall caught by the advisor review

`bun --filter @archon/web generate:types` is hardcoded to `localhost:3090`, but a worktree server auto-allocates a port in 3190–4089 (`packages/core/src/utils/port-allocation.ts`). A bare `dev:server` in a worktree either fails the regeneration or, if the main checkout's server is on 3090, silently regenerates `api.generated.d.ts` without the new route. The plan now requires `PORT=3090 bun run dev:server`, a diff assertion for `WithdrawWorkflowNodeResponse`, and stopping only the recorded PID.

## Verification

Both executor drain sites (`dag-executor.ts:3336-3351`, `:6883-6910`) were read to confirm no `await` sits between `closeIfEmpty()`/`pendingCount()` and `drain()`, so a synchronous withdraw cannot cause an empty guidance turn. `ak plan validate` passes. No live task surface was available; the advisor gate replaced the interactive validation interview for this unattended run.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
