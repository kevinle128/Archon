---
phase: 2
title: 'Deterministic route concurrency'
status: pending
priority: P1
effort: '2h'
dependencies: [1]
---

# Phase 2: Deterministic route concurrency

## Goal

Exercise two overlapping identity-bound sends through the real Hono app and
prove that the order chosen at the synchronous registry boundary is reflected
by both registry state and the public queue read, without swapping senders.

## Evidence to re-read

- Send handler in `packages/server/src/routes/api.ts`: identity resolution,
  run/event/pending checks, final run check, then synchronous `handle.accept()`.
- Queue handler in the same file: one handle snapshot mapped to the two-field
  response.
- Existing send tests and helpers in
  `packages/server/src/routes/api.workflow-runs.test.ts`:
  `postNodeSend`, `sendPayload`, `liveSetup`, and the actor/order cases.
- Default `mockFindOrCreateUserByPlatformIdentity` returns the header value as
  the canonical test user id.

## Deterministic interleaving

The test must not use timers, microtask counts, or a call-indexed
`getWorkflowRun` gate: both requests pass the same run id, so that gate cannot
identify the sender.

Install a temporary identity mock keyed by header value:

1. Operator A enters `findOrCreateUserByPlatformIdentity`; resolve a test-owned
   `aEntered` promise and block on `releaseA`.
2. Only after `aEntered` resolves, launch operator B's stream and await its 200
   response. B has necessarily reached synchronous `accept()` while A has not.
3. Release A and await its response.
4. Restore the default identity mock in `finally`, even if an assertion fails.

This controls receipt order without spying on the registry prototype or
adding a runtime import solely for the test.

## Test to add

In the existing queued-guidance describe, add
`overlapping identity streams preserve accept order and request attribution`:

- Register one live handle.
- Use valid, distinct UUID message ids.
- Start A1 and wait until A is held at identity resolution.
- Send B1 and await its success; send and await B2 from the same stream before
  release to prove B1 precedes B2.
- Release A, await A1, then send/await A2 from A's stream.
- Assert every response is the existing 200 receipt shape.
- Assert the handle contains `[B1, B2, A1, A2]` with senders
  `[op-b, op-b, op-a, op-a]`, original text, and no duplicate ids.
- Assert sender-filtered subsequences are `[B1, B2]` and `[A1, A2]`.
- GET the queue and assert its ids/text equal the handle order and its objects
  have exactly `message_id` and `message`—no attribution field.

The actor grant, anonymous case, malformed requests, duplicate ids, terminal
races, and queue node scoping are already covered in this file. Do not add
Story 2.13 copies of those tests.

## Files

- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`
- Conditional, only after a proven failure:
  `packages/server/src/routes/api.ts`

## Validation

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'overlapping identity streams')
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
```

## Acceptance

- A is demonstrably still blocked when B returns 200.
- The asserted global order is fixed by the controlled `accept()` order, not
  request creation or timestamps.
- Each queued message retains the user id from its own request.
- Public queue shape remains unchanged.
- The temporary identity implementation cannot leak into later tests.

## Security boundary

This test verifies binding at the existing trusted identity seam. It does not
claim to test Better Auth cryptography or make a raw header trustworthy on an
unproxied public deployment; existing auth/gate tests own that policy.
