---
phase: 1
title: 'Registry order and isolation'
status: pending
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: Registry order and isolation

## Goal

Pin, with deterministic unit tests, that `NodeSteeringHandle`/`SteeringRegistry`
preserve receipt order and per-sender attribution across interleaved operators,
that a handle never leaks items or identities across nodes or runs, and that the
transcript writer preserves per-row attribution for a mixed-sender batch.

## Context links

- Story 2.13: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:800-824`
- AD-11 receipt-order rule: `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md:178`
- Test plan bullet: `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` → "Concurrent operators"
- Registry: `packages/workflows/src/steering-registry.ts` (`accept` :290, `closeIfEmpty` :347, `drain` :359, `withdraw` :369, `register` :473 — re-grep before editing, see step 1)
- Writer: `packages/workflows/src/node-transcript.ts:70-91`
- Existing tests: `packages/workflows/src/steering-registry.test.ts` (helper `msg()` at line 14 hard-codes `operatorUserId: 'user-1'`), `packages/workflows/src/node-transcript.test.ts:107` ("appends one operator text row per drained message in order")

## Key insights

- `accept()` is synchronous and appends in call order; the registry has no
  notion of "operator" beyond the `operatorUserId` field it stores verbatim.
  Order and attribution are therefore properties of *call order* and *value
  passthrough*. The tests below make both explicit so a later refactor (for
  example a per-operator lane or a priority) fails loudly.
- Idempotency is keyed by `message_id` alone. A second operator replaying an id
  gets the *original* receipt and the stored message keeps the original
  sender. That is the correct cross-user leakage guarantee at this layer: an
  id can never be re-attributed. It is currently untested for mixed senders.
- The registry key is `(runId, stepName)`. Cross-node isolation is a map
  lookup; the test proves it for two nodes in one run and the same node id in
  two runs.
- Per-*dock-instance* stream order is enforced by the dock (`sendInFlight` is
  local state of one mounted composer, `steering-dock.ts:32-37`), not the
  registry, and not per authenticated identity: the same operator in two tabs
  has two independent gates and the registry records whichever request
  arrives first. Document this in the test file header comment; do not add
  registry-side sequencing.
  <!-- Updated: Red Team 2026-09-20 — finding A1 (per-tab, not per-operator) -->

## Requirements

- Functional: order = accept order; per-sender subsequence stable; drain and
  `send_now` batch preserve order; attribution passes through unchanged; ids
  cannot be re-attributed; no cross-node/cross-run visibility.
- Non-functional: tests are synchronous or use only promise resolution (no
  timers); message text never logged; no production change unless a test
  fails.

## Files to create / modify

- Modify: `packages/workflows/src/steering-registry.test.ts`
- Modify: `packages/workflows/src/node-transcript.test.ts`
- Modify (only on a red test): `packages/workflows/src/steering-registry.ts`

## Tests before (write first, expect green on current code)

Add a helper beside `msg()`:

```ts
function from(operatorUserId: string | null, id: string, text: string): QueuedOperatorMessage {
  return { messageId: id, message: text, operatorUserId, receivedAt: '2026-09-20T00:00:00.000Z' };
}
```

Add `describe('concurrent operators (Story 2.13)', …)` after the
`describe('accept + enterIdle', …)` block with these tests:

1. **interleaved accepts keep global receipt order and per-sender order** —
   accept `a1, b1, a2, b2, b3, a3` on one live handle (alternate operators
   `'op-a'`/`'op-b'`). Assert `snapshot().queued.map(m => m.messageId)` equals
   the accept sequence; filtering by `operatorUserId` yields `[a1,a2,a3]` and
   `[b1,b2,b3]`; every item's `operatorUserId` equals the sender passed in.
2. **drain returns the identical mixed batch** — same setup; `drain()` returns
   the same ids/senders in the same order; a second `drain()` is empty; the
   duplicate replay of `b2` afterwards returns `duplicate: true`.
3. **send_now on an idle handle drains both operators' pending items in receipt
   order** — interruptible handle, `beginTurn`, `enterIdle(token)`; accept
   `a1` (queue), `b1` (queue) → both receipts `awaiting_send_now`; then
   `accept(from('op-b','b2','go'), 'send_now')` resolves the idle waiter with
   `messages` = `[a1, b1, b2]` with senders `[op-a, op-b, op-b]`.
4. **a replayed message_id keeps its original sender** — accept
   `from('op-a','shared','first')`, then `from('op-b','shared','second')`.
   Assert the second result is `{ ok: true, duplicate: true }` with the *same*
   receipt object contents, `pendingCount()` is 1, and the queued item's
   `operatorUserId` is `'op-a'` and `message` is `'first'`.
5. **withdraw by id removes only that sender's item** — queue `a1, b1, a2`;
   `withdraw('b1')` leaves `[a1, a2]` both `op-a`; withdraw of `b1` again is
   `false`.
6. **cross-node and cross-run isolation** — one `createSteeringRegistry()`;
   register `(run-1, node-a)`, `(run-1, node-b)`, `(run-2, node-a)`. Accept
   `op-a` items on the first, `op-b` items on the second and third. Assert each
   handle's snapshot contains only its own ids; `pendingCount()` per handle;
   `discardRun('run-1')` empties two handles and leaves `(run-2, node-a)`
   intact with its `op-b` item; the surviving handle still replays its own
   ids as duplicates and rejects nothing.
7. **identity-less sender is stored as null, not inherited** — accept
   `from('op-a','a1',…)`, `from(null,'n1',…)`, `from('op-b','b1',…)`; assert the
   middle item's `operatorUserId` is `null`.
8. **same operator from two streams is ordered by receipt, not by stream** —
   characterization: accept `from('op-a','tab1-m1',…)`, then
   `from('op-a','tab2-m1',…)`, then `from('op-a','tab1-m2',…)`; assert the queue
   is exactly that accept order. This pins that the registry has no
   per-operator lane (AD-11) and that multi-tab ordering for one identity is a
   client concern, not a server guarantee.
   <!-- Updated: Red Team 2026-09-20 — finding A1 -->

`node-transcript.test.ts`: after the test at line 107, add
**"preserves per-row sender and message id for a mixed-operator batch"** —
three messages with senders `op-a`, `op-b`, `null`; assert
`appendNodeMessage` was called three times in order and each call's
`metadata.operator_user_id` / `metadata.message_id` match the input row, with
`origin: 'operator'` on all three.

## Refactor (protected code)

None expected. If test 4 or 6 fails, fix `accept()`/`discardRun()` in
`steering-registry.ts` minimally and note the defect in
`reports/phase-01-evidence.md`. Do not touch the interrupt/turn machinery.

## Tests after

None beyond the "before" set — this phase adds no behavior.

## Regression gate

```bash
cd packages/workflows && bun test src/steering-registry.test.ts src/node-transcript.test.ts
cd packages/workflows && bun run type-check 2>/dev/null || (cd ../.. && bun run type-check)
```

Both commands must pass before Phase 2 starts.

## Implementation steps

1. Scout: `grep -n "  accept(\|  drain()\|  withdraw(\|  register(\|closeIfEmpty()" packages/workflows/src/steering-registry.ts`
   to refresh the anchors above, then read `steering-registry.test.ts:1-30`
   and `:811-956` to match helper and describe conventions.
   <!-- Updated: Red Team 2026-09-20 — finding S5 (stale anchors) -->
2. Add the `from()` helper and the new `describe` block with tests 1–7.
3. Add the mixed-batch test to `node-transcript.test.ts`.
4. Run the regression gate; if red, fix the registry minimally and re-run.
5. Update the header comment of `steering-registry.test.ts` (or the new
   describe's leading comment) with one sentence: per-dock written order is
   the dock's `sendInFlight` gate; the registry guarantees accept order only,
   for every sender including one identity across several tabs.
6. Write `reports/phase-01-evidence.md` with the test names and the `bun test`
   summary line.

## Todo

- [ ] `from()` helper added
- [ ] tests 1–8 added and green
- [ ] node-transcript mixed-batch test added and green
- [ ] regression gate green
- [ ] evidence report written

## Success criteria

- All new tests pass without any production change, or the production change
  is ≤20 lines with a red-then-green test proving it.
- No test uses `setTimeout`, `Date.now()` ordering, or real I/O
  (`ARCHON_HOME=$(mktemp -d)` run creates no `archon.db`).

## Risk assessment

- Low. The registry is pure in-memory code with existing thorough coverage;
  this phase widens it to mixed senders and isolation.

## Security considerations

- Confirms an operator cannot re-attribute another operator's message by
  replaying its id, and cannot observe another node's queue through the
  registry API.

## Next steps

Phase 2 drives the same invariants through the HTTP route with two identities.
