---
phase: 3
title: 'Executor transcript chain'
status: pending
priority: P1
effort: '2h'
dependencies: [1, 2]
---

# Phase 3: Executor transcript chain

## Goal

Strengthen the existing executor delivery tests so all production drain paths
that duplicate turn-loop logic demonstrate the same mixed-sender order and
metadata. Reuse current tests instead of building a second executor matrix.

## Verified reusable coverage

- `appendOperatorTranscript` already writes one row per input item in array
  order and passes `operator_user_id` / `message_id` verbatim.
- `executeDagWorkflow -- queued guidance (#181)` already verifies a direct
  mixed `op-a`/`op-b` batch, row placement, ids, and caused attempt.
- `executeDagWorkflow -- interrupt and redirect (#183)` already verifies the
  old-plus-new `send_now` batch and caused attempt, but its helpers hard-code
  one sender.
- The loop guidance test already verifies loop ancestry and caused attempt,
  but uses one sender.
- `api.workflow-runs.test.ts` already has an A/B/A read-model test proving that
  the correct display name is projected per row. Do not add a duplicate.

## Planned test edits

Modify `packages/workflows/src/dag-executor.test.ts`:

1. **Direct natural drain.** Expand the existing
   `drains queued guidance as one follow-up turn...` setup to enqueue
   `a1/op-a, b1/op-b, a2/op-a, b2/op-b` in that receipt order. Assert:
   - resumed prompt order is `a1\n\nb1\n\na2\n\nb2`;
   - operator rows ordered by `seq` carry the four matching ids/senders;
   - each sender's subsequence is stable;
   - all four rows use the caused turn's attempt and precede its assistant row.
2. **Idle `send_now`.** Let `steeringMessage`, `enqueue`, and `sendNow` accept
   an optional operator id while preserving the current default. In the
   existing old-plus-new redirect test, assign the queued messages to `op-a`
   and the releasing message to `op-b`; assert the three transcript senders in
   batch order in addition to the current id/order/attempt assertions.
3. **Loop drain.** Expand the existing loop-guidance delivery test to enqueue
   one `op-a` and one `op-b` message. Assert prompt, ids, senders, `seq`, caused
   attempt, and identical loop ancestry for both.

Do not add concurrent sibling-node tests here. The registry key isolation is
already unit-tested, and the full cross-node behavior is part of Phase 4's
real integration journey.

## Production-code rule

No executor change is expected. If one of these paths fails while the others
pass, fix only the divergent drain/writer wiring and retain all prior turn,
session, retry, and loop-completion semantics.

## Validation

```bash
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
```

## Acceptance

- Direct, idle, and loop paths all keep receipt order and exact sender/id
  metadata.
- Operator rows remain under the caused attempt; loop rows retain ancestry.
- Existing display-name A/B/A coverage remains green.
- No new polling, timers, mock modules, or production abstractions are added.

## Forward compatibility

Prompt concatenation assertions characterize the current queue-and-flush
floor. If later soft injection changes transport, the durable row order and
attribution assertions remain authoritative; only prompt-shape expectations
would be revisited in that later story.
