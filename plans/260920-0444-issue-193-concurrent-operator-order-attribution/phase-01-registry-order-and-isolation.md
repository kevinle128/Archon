---
phase: 1
title: 'Registry characterization'
status: pending
priority: P1
effort: '1.5h'
dependencies: []
---

# Phase 1: Registry characterization

## Goal

Pin the registry's actual concurrency contract with the smallest useful change:
mixed senders retain synchronous `accept()` order and their own attribution
through snapshot, drain, idempotent replay, and idle `send_now`.

## Evidence to re-read

- `packages/workflows/src/steering-registry.ts`:
  `NodeSteeringHandle.accept`, `drain`, and the registry key builder.
- `packages/workflows/src/steering-registry.test.ts`: `msg`, `enqueue`,
  `idempotency`, `drain`, `discardRun`, and `accept + enterIdle`.
- `packages/workflows/src/node-transcript.test.ts` already proves that
  `appendOperatorTranscript` writes its input array in order with per-row
  `operator_user_id` and `message_id`; do not duplicate it here.

## Planned changes

Modify `packages/workflows/src/steering-registry.test.ts` only:

1. Let the existing `msg()` helper accept an optional
   `operatorUserId: string | null`, defaulting to `user-1` so all current tests
   remain unchanged.
2. Add one test named `mixed senders keep order and attribution through drain`:
   - accept `a1, b1, a2, b2` on one handle with alternating `op-a` / `op-b`;
   - assert snapshot ids and senders in that exact call order;
   - assert each sender's filtered subsequence is stable;
   - drain once and assert the same objects/order; assert a second drain is
     empty.
3. Strengthen `duplicate id with different prose keeps the original...` so
   the original is from `op-a`, the replay is from `op-b`, and the stored row
   still contains `op-a` plus the original prose. This proves an id cannot be
   used to reattribute a message.
4. Strengthen the existing idle `send_now` test by assigning queued messages
   to `op-a` and the releasing message to `op-b`; assert the wake batch retains
   both senders in accepted order.

Existing `discardRun` coverage already proves run/node key isolation. Existing
withdraw tests already prove removal by message id. Do not add new variants.

## Production-code rule

No production change is expected. If a focused assertion fails, diagnose the
exact invariant before editing `steering-registry.ts`; keep any fix limited to
the proven cause and rerun all registry tests.

## Validation

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts src/node-transcript.test.ts)
```

## Acceptance

- Mixed A/B values survive snapshot, drain, duplicate replay, and
  `send_now` without reorder or identity substitution.
- No timers, real database, server, or filesystem fixture is added.
- No redundant cross-run, withdraw, anonymous-sender, or same-identity/tab
  matrix is introduced.

## Rollback

Revert the test-only changes. If a production fix was required, keep it in a
separate commit with the red/green evidence recorded for Phase 5.
