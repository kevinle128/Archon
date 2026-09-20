---
phase: 2
title: 'Route concurrency integration'
status: pending
priority: P1
effort: '4h'
dependencies: [1]
---

# Phase 2: Route concurrency integration

## Goal

Prove through the real Hono app that two distinct authenticated identities
sending overlapping requests to one live node are accepted in server receipt
order, that every queued item carries the identity of the request that sent
it, that the queue read reflects the same order, and that nothing crosses nodes
or identities — with the interleaving controlled deterministically.

## Scout pass (run before editing)

1. `grep -n "describe('POST /api/workflows/runs/:runId/nodes/:nodeId/send" packages/server/src/routes/api.workflow-runs.test.ts`
   — confirm the block at ~6664 and the helpers `postNodeSend` (~6596),
   `sendPayload`, `liveSetup`, `deleteNodeQueue`, `expectSteeringError`,
   `mockSteerableRun`, `steerEvent`, and constants `STEER_RUN_ID`,
   `STEER_NODE_ID`, `STEER_STARTER_ID`, `NOW`.
2. `grep -n "readWorkflowNodeQueueRoute\|/queue'" packages/server/src/routes/api.workflow-runs.test.ts`
   — find the queue-GET test block and its request helper.
3. Confirm the route's five awaited seams in order in `api.ts` (send handler
   ~5362-5460): `resolveAuthContext` (which awaits
   `findOrCreateUserByPlatformIdentity('web', <header>, <header>)`) →
   `getWorkflowRun` → `listWorkflowEvents` → `listPendingInteractions` →
   `getWorkflowRun` (final gate) → synchronous `accept()`. With the API gate
   off (the test default) the pre-route middleware does NOT call
   `resolveAuthContext`, so the identity seam runs exactly once per request,
   inside the handler.
   <!-- Updated: Red Team 2026-09-20 — findings F1/F5/F6 (interleaving control) -->
4. Confirm `mockFindOrCreateUserByPlatformIdentity` default echoes the header
   as the user id (`api.workflow-runs.test.ts:716-725`, verified 2026-09-20).
5. Confirm `NodeSteeringHandle` is currently imported **type-only**
   (`api.workflow-runs.test.ts:756-760`); a value import must be added for
   `spyOn(NodeSteeringHandle.prototype, 'accept')`.
   <!-- Updated: Red Team 2026-09-20 — findings S2/F3 (type-only import) -->

## Context links

- Send route: `packages/server/src/routes/api.ts:5337-5462`
- Queue read route: `api.ts:5650-5716`
- Identity seam: `api.ts:2469-2516`
- Contract: `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` (queue read shape at line 38; duplicate `message_id` at 64)
- Existing actor matrix: `api.workflow-runs.test.ts:6682-6740`

## Key insights

- "Server receipt order" is the order `handle.accept()` runs, not the order
  `app.request()` was invoked. The test must therefore (a) control which
  request reaches `accept` first and (b) assert queue order against the
  recorded accept order. Use `spyOn(NodeSteeringHandle.prototype, 'accept')`
  to record `(messageId, operatorUserId)` per call, and restore it in
  `afterEach`. `spyOn` is the sanctioned tool here; do not `mock.module` the
  registry (it is shared with the executor tests' module cache rules).
- Deterministic interleaving — **identity-keyed gate, not call-order
  counting.** `getWorkflowRun` is called with identical arguments by both
  requests, so an array of resolvers indexed by call order cannot tell A's
  call from B's (the codebase's only deferred-interleaving precedent,
  `dag-executor.test.ts:24974` / `:25567`, keys on argument content for
  exactly this reason). The first awaited seam of the send handler *is*
  content-keyed: `findOrCreateUserByPlatformIdentity('web', header, header)`.
  Install a per-test `mockFindOrCreateUserByPlatformIdentity.mockImplementation`
  that returns the echoed user immediately for every header except the one(s)
  named in a `held: Map<string, Deferred<void>>`; a held header's promise
  resolves only when the test calls `release(header)`. Protocol for test 1:
  hold `OP_A`; fire A1 then B1 without awaiting; `await` B1's response (B has
  fully completed and called `accept`); `release(OP_A)`; `await` A1's response.
  No microtask choreography is needed because the test waits on a *response*,
  never on "the next resolver to appear". After the gated seam, A's remaining
  lookups run against the default immediate mocks.
  <!-- Updated: Red Team 2026-09-20 — findings F1/F5 -->
- The queue read route needs no identity and returns `{message_id, message}`
  only. Attribution is asserted on the handle snapshot (server state), order on
  both the snapshot and the GET body.

## Requirements

- Functional: header identity → `operatorUserId` per item; accept order ==
  queue order == GET order; per-sender subsequences preserved when each
  sender awaits its own previous response; no cross-node items; identity-less
  request stays `null` between identified ones; duplicate id from another
  identity replays without re-attribution.
- Non-functional: deterministic; no real DB (`ARCHON_HOME` temp check). A
  sibling `describe` does not inherit another describe's hooks, so the new
  block gets its own `beforeEach` copied from the send block — explicitly
  including `getSteeringRegistry().clearForTests()` (otherwise accepted-id
  memory leaks between tests and test 5's replay assertion becomes
  order-dependent) and the `mockReset`/`mockClear` calls — plus an `afterEach`
  that restores the identity mock's echo default with `mockImplementation`
  (the existing block only `mockClear`s, which keeps a leaked gate
  implementation alive) and restores the `accept` spy.

## Files to create / modify

- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`
- Modify (only on a red test): `packages/server/src/routes/api.ts`

## Tests before (write first)

New `describe('send/queue — concurrent operators (Story 2.13)', …)` placed
directly after the existing send-route describe. Use `OP_A = 'operator-a'`,
`OP_B = 'operator-b'`, uuid-shaped ids `A1..A3`, `B1..B3`.

1. **overlapping sends from two identities are accepted in server receipt
   order with per-request attribution** — `liveSetup()`; install the
   identity-keyed gate holding `OP_A`; fire `postNodeSend(A1, {X-Archon-User: OP_A})`
   then `postNodeSend(B1, {X-Archon-User: OP_B})` without awaiting; `await`
   B1's response; `release(OP_A)`; `await` A1's response. Assert both 200 with
   `state:'queued'`; the accept spy recorded `[B1/OP_B, A1/OP_A]`;
   `handle.snapshot().queued` ids are `[B1, A1]` with senders `[OP_B, OP_A]`;
   GET `/queue` body order is `[B1, A1]`. During development, invert the hold
   (hold `OP_B`) once and observe `[A1, B1]` to prove the gate controls the
   order; commit the `OP_A`-held variant.
2. **each operator's stream keeps its written order while streams overlap** —
   two async functions: `streamA` sends A1, awaits, A2, awaits, A3; `streamB`
   likewise; run with `Promise.all` and the default (immediate) mocks. Assert
   six items; ids filtered by sender equal `[A1,A2,A3]` and `[B1,B2,B3]`;
   every item's sender matches; global order equals the accept spy order.
3. **queue read returns the registry order for every reader** — after test 2's
   state, GET `/queue` twice (once with `OP_A` header, once with `OP_B`);
   both bodies are identical and equal the snapshot order.
4. **an identity-less request between two identified requests is attributed
   null** — sequential sends A1 (OP_A), N1 (no header), B1 (OP_B); senders are
   `[OP_A, null, OP_B]`.
5. **a second identity replaying an accepted message_id gets the original
   receipt and cannot re-attribute it** — A1 by OP_A, then A1 by OP_B (same
   id, different text). Second response is 200 with the same `state`; one
   queued item; its sender is OP_A and its text is the first text.
6. **concurrent sends to two nodes never cross** — register live handles for
   `STEER_NODE_ID` and a second node id (add `steerEvent('node_started',
   'steer-b')` to the events mock); fire A1→node-a, B1→node-b, A2→node-b,
   B2→node-a concurrently with the default immediate mocks; `await` all four.
   Assert only the deterministic invariants: node-a's id set is exactly
   `{A1, B2}` and node-b's is exactly `{B1, A2}`; every item's sender matches
   its header; no id appears on both handles; each handle's order equals the
   accept-spy order filtered to that handle. Do **not** assert a cross-request
   order here — test 1 owns that with the gate.
   <!-- Updated: Red Team 2026-09-20 — finding F2 (hedged order) -->
7. **withdraw by one identity of another identity's queued item removes only
   that item** — queue A1 (OP_A), B1 (OP_B); `deleteNodeQueue(B1, {OP_A})` →
   200; snapshot is `[A1/OP_A]`. (AD-11 grant: any authenticated member may
   withdraw; this pins that the removal is by id, not by sender.)
8. **rejections leave the mixed queue untouched** — with `[A1/OP_A, B1/OP_B]`
   queued, send a malformed body as OP_B → 400; `expectNoSteeringMutation`
   holds and both senders are unchanged.
9. **a node finishing while one operator's request is in flight refuses that
   request and keeps the other operator's item intact** — hold `OP_A`; fire
   A1 (OP_A); `await` B1 (OP_B) → 200; then `handle.close()` (the executor's
   terminal seal) and switch `mockGetWorkflowRun` to a completed run;
   `release(OP_A)`; A1 → 409 `node_finished`; snapshot still holds exactly
   `[B1/OP_B]`; `expectNoSteeringMutation` relative to the post-B1 snapshot.
   <!-- Updated: Red Team 2026-09-20 — finding A5 (mid-flight termination) -->
10. **two never-seen identities resolving concurrently each keep their own
    row** — hold both `OP_NEW_1` and `OP_NEW_2` (headers not used elsewhere in
    the file); fire N1 (OP_NEW_1) then N2 (OP_NEW_2); `release(OP_NEW_2)`,
    `await` N2; `release(OP_NEW_1)`, `await` N1. Assert the identity mock was
    called once per header, and the queue is `[N2/OP_NEW_2, N1/OP_NEW_1]`. This
    pins that identity is bound to the request that resolved it, in reverse
    completion order. (At the DB layer two distinct identities share no
    UNIQUE key, so there is no insert race to recover from — `users.ts:99-170`
    recovery covers the same identity racing itself; document this in the
    evidence report rather than adding a DB test.)
    <!-- Updated: Red Team 2026-09-20 — finding A3 (first-sight identities) -->

## Refactor (protected code)

None expected. A red test 1/6 would indicate a shared-state bug in
`resolveAuthContext` or the send handler; fix minimally in `api.ts` and record
in `reports/phase-02-evidence.md`.

## Tests after

None beyond the "before" set.

## Regression gate

```bash
cd packages/server && bun test src/routes/api.workflow-runs.test.ts
ARCHON_HOME=$(mktemp -d) bash -c 'cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t "concurrent operators" && ls "$ARCHON_HOME"'
```

The second command must list no `archon.db`.

## Implementation steps

1. Run the scout pass and capture current anchors.
2. Add `import { spyOn } from 'bun:test'` if absent; add a **value** import
   `import { NodeSteeringHandle } from '@archon/workflows/steering-registry'`
   next to the existing `import type { … }` (the class is currently type-only
   and `spyOn(NodeSteeringHandle.prototype, 'accept')` needs the runtime
   binding). Keep the type import for `SteeringHandleSnapshot`/`SteeringIdleWake`.
   <!-- Updated: Red Team 2026-09-20 — findings S2/F3 -->
3. Implement a local `identityGate()` helper returning
   `{ hold(header), release(header), install() }` that wraps
   `mockFindOrCreateUserByPlatformIdentity.mockImplementation` for the test
   and restores the echo default in `afterEach`.
4. Add tests 1–10; restore the `accept` spy and the identity mock in `afterEach`.
5. Run the regression gate; fix production code only on red.
6. Write `reports/phase-02-evidence.md`.

## Todo

- [ ] scout anchors recorded
- [ ] identity-gate helper added
- [ ] tests 1–10 green
- [ ] no-DB check clean
- [ ] evidence report written

## Success criteria

- Test 1 demonstrably flips order when the held identity flips (run it once
  holding `OP_B` during development to see `[A1, B1]`; keep the `OP_A`-held
  variant as the committed assertion).
- No production change, or a ≤20-line fix with a red-then-green test.

## Risk assessment

- Low–medium: the gate keys on the header value passed to the identity
  seam, so adding or removing later awaited lookups does not shift which
  request is held. The gate breaks only if the handler stops resolving
  identity through `findOrCreateUserByPlatformIdentity` before the first
  `getWorkflowRun`; assert in test 1 that the identity mock was called with
  `OP_A` and `OP_B` exactly once each so such a change fails loudly.
  <!-- Updated: Red Team 2026-09-20 — findings F5/F6 -->

## Security considerations

- Pins that identity is per request (no cross-user leakage) and that an
  authenticated member cannot re-attribute another member's message by id
  replay.

## Next steps

Phase 3 carries the accepted mixed batch through the executor into rows and
the read model.
