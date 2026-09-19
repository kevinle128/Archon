---
phase: 1
title: 'Registry primitive, contract clarification, and typed DELETE route'
status: pending
priority: P1
effort: '1 session'
dependencies: []
---

# Phase 1: Registry primitive, contract clarification, and typed DELETE route

## Goal

Implement the idempotent bodyless withdraw route on top of one synchronous
registry primitive. Preserve accepted-id memory, allow removal from live and
parked retained queues, prevent mutation of closed handles, and close both
terminal races before regenerating the web OpenAPI types.

## Source anchors

- Public contract:
  `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`.
- Story:
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`, Story 2.2.
- Registry:
  `packages/workflows/src/steering-registry.ts` and
  `steering-registry.test.ts`.
- Route precedent:
  `sendWorkflowNodeRoute`, its route-scoped middleware and handler in
  `packages/server/src/routes/api.ts`;
  `steeringValidationErrorHook` in `openapi-defaults.ts`.
- Route tests:
  the Story 2.1 queued-guidance block in
  `packages/server/src/routes/api.workflow-runs.test.ts`, especially
  `returns 409 when the handle closes between inspection and enqueue`.
- Drain/lifecycle proof:
  direct-node and loop-node steering boundary blocks plus parked cleanup in
  `packages/workflows/src/dag-executor.ts`.

## Files

| File                                                               | Change                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/workflows/src/steering-registry.ts`                      | Add closed-safe `withdraw(messageId): boolean` and document the pending-only invariant.                         |
| `packages/workflows/src/steering-registry.test.ts`                 | Add ordering, phase, idempotency-memory, closed-safety, and drain-exclusion tests.                              |
| `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` | Clarify that a parked retained queue is withdrawable, while send remains refused and closed handles remain 409. |
| `packages/server/src/routes/schemas/workflow.schemas.ts`           | Add withdraw params/response schemas and the derived response type.                                             |
| `packages/server/src/routes/openapi-defaults.ts`                   | Broaden the validation-hook doc comment to all steering routes; no behavior change.                             |
| `packages/server/src/routes/api.ts`                                | Add route config, DELETE-only auth middleware, lifecycle ladder, final phase recheck, and handler.              |
| `packages/server/src/routes/api.workflow-runs.test.ts`             | Add the complete route suite; share existing steering fixtures where that reduces duplication.                  |
| `packages/web/src/lib/api.generated.d.ts`                          | Regenerate from this worktree's OpenAPI server.                                                                 |

Do not edit `dag-executor.ts`, the send route's behavior, database code, or
the validation hook's behavior.

## Registry contract

Add the method after `drain()`:

```ts
/**
 * Removes one still-pending message from a live or parked queue. Accepted-id
 * memory and handle phase are preserved. Closed handles are immutable.
 */
withdraw(messageId: string): boolean {
  if (this.phase === 'closed') return false;
  const index = this.pending.findIndex(item => item.messageId === messageId);
  if (index === -1) return false;
  this.pending.splice(index, 1);
  return true;
}
```

This method is synchronous for the same reason as `enqueue`, `closeIfEmpty`,
and `drain`: route and executor operations must have a total event-loop order.
It does not delete from `accepted`, close an emptied handle, resume a parked
handle, log content, or distinguish drained from never-seen ids.

### Registry tests

Write these tests before the method:

1. Removing B from pending A/B/C returns `true`, leaves A/C in order, keeps the
   phase live, and decrements only `pendingCount`.
2. Never-seen and already-drained ids return `false` without changing the
   snapshot.
3. Repeating a successful withdraw returns `false` and is mutation-free.
4. Accepted memory survives: replaying `enqueue(A)` after withdrawing A returns
   the original duplicate receipt, does not requeue A, and leaves
   `acceptedCount` unchanged.
5. A parked handle can remove A while remaining parked; resume later drains only
   the retained siblings.
6. A closed handle containing A returns `false` and keeps the full snapshot
   unchanged.
7. Removing the last live item does not close the handle; only
   `closeIfEmpty()` owns the terminal seal.
8. A later `drain()` cannot return a previously withdrawn item.

## Wire schemas and documentation

Place the schemas beside the existing send steering schemas and derive types
with `z.infer`:

```ts
export const withdrawWorkflowNodeParamsSchema = z
  .object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
    messageId: z.string().uuid(),
  })
  .strict();

export const withdrawWorkflowNodeResponseSchema = z
  .object({
    success: z.literal(true),
    message_id: z.string().uuid(),
  })
  .strict()
  .openapi('WithdrawWorkflowNodeResponse');

export type WithdrawWorkflowNodeResponse = z.infer<typeof withdrawWorkflowNodeResponseSchema>;
```

The path id uses the same UUID validator as send's `message_id`. Add one short
contract sentence under idempotency/boundary notes: DELETE may remove an
already-accepted item from a parked retained queue because it manages the queue,
not the live provider session; new sends remain refused while parked, and a
closed handle still returns `node_finished`.

Update the existing `steeringValidationErrorHook` comment to describe the
shared steering-route error contract rather than naming only send/interrupt.
The function and response shape stay unchanged.

## Route definition and ordering

Define `withdrawWorkflowNodeRoute` next to `sendWorkflowNodeRoute`:

- method `delete`;
- path
  `/api/workflows/runs/{runId}/nodes/{nodeId}/queue/{messageId}`;
- params `withdrawWorkflowNodeParamsSchema`;
- 200 `withdrawWorkflowNodeResponseSchema`;
- 400, 401, 403, 404, 409, 422, and 500 through
  `steeringJsonError(...)`;
- description states bodyless, idempotent for drained/unknown ids, and
  mutation-free on rejection.

Before registering the route, add DELETE-only middleware at the colon-param
path. It performs only the gated identity check and returns nested 401. It must
be registered before the OpenAPI route so auth wins over UUID parameter
validation. Do not widen or reuse the POST middleware, and do not parse a body.

Register with
`registerOpenApiRoute(withdrawWorkflowNodeRoute, handler, steeringValidationErrorHook)`.
The handler order is part of the correctness contract:

1. Resolve auth and return nested 401 when a configured gate has no identity.
2. Read the already-validated `runId`, `nodeId`, and `messageId`.
3. Load the run; null is 404.
4. Load workflow events and pending interactions, project the node state, and
   fetch the registry handle.
5. Apply the same initial precedence as send:
   no projection plus no handle → 404; terminal run → 409; projected
   `completed`/`failed`/`skipped` node → 409; closed handle → 409; no
   handle → 422. A parked handle is intentionally allowed.
6. Re-read the run. Null → 404; terminal → 409.
7. **After that await**, re-read `handle.snapshot().phase`. Closed → 409.
8. With no await after step 7, call `handle.withdraw(messageId)`.
9. Log only `{ runId, nodeId, messageId, operatorUserId, removed }` under
   `api.workflow_node_withdraw_completed`, and return exact
   `{ success: true, message_id: messageId }`.
10. Unexpected exceptions log `err` and ids under
    `api.workflow_node_withdraw_failed`, then return nested 500
    `internal_error`.

Do not extract the target ladder yet. Send and withdraw are only two callers and
already differ for parked handles. The final phase check must not be omitted:
the send test proves a handle can close while the last run read is pending, and
`withdraw` otherwise cannot provide the required 409 response by boolean
alone.

## Route tests

Add `deleteNodeQueue(app, messageId, headers?, runId?, nodeId?)` beside
`postNodeSend`. Lift only the steering setup/assertion helpers that both
route blocks need, preserving the existing reset behavior. Name the block
`DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId — withdraw queued guidance`
so the documented focused command selects it.

### Authorization and validation

1. Run starter, another authenticated member, an admin, and identity-less mode
   each receive exact 200 and remove the queued id.
2. With web auth gated, no identity plus a non-UUID path id returns nested 401
   before 400; no database/queue/transcript mutation occurs.
3. An authenticated non-UUID path id returns nested 400 `invalid_request`
   before any run lookup or mutation.

### Target/refusal ladder

For every case with a handle, snapshot it before the request and use the
existing mutation assertion to prove phase, pending items, accepted count, and
transcript/run writers did not change:

4. Unknown run → 404; unknown node with no projection/handle → 404.
5. Terminal run with a deliberately stale queued handle → 409.
6. Projected `node_completed`, `node_failed`, and `node_skipped` with stale
   queued handles → 409. Do not add a nonexistent cancelled node state.
7. Closed queued handle → 409.
8. Running projected node with no handle → 422.
9. Live handle with no projected node yet → 200 and removes the item; a handle
   proves the node exists during the event-projection race.
10. Parked AskHuman handle with a retained queued id → 200 and only that item is
    removed; phase remains parked.
11. The run disappears on the final re-read → 404 with no mutation.
12. Run changes from running to cancelled on the final re-read → 409.
13. Final run read still returns running but closes the handle during its await
    → 409 and the item remains queued. This is the critical missed race.
14. An injected event-store exception → nested 500 `internal_error` and no
    mutation.

### Idempotency and response

15. Live queued id → 200, row absent, sibling order preserved, accepted count
    unchanged.
16. Repeat the same DELETE → identical 200 response.
17. Already-drained id and never-seen valid UUID → identical 200 response.
18. Response has exactly `success` and `message_id`; no `removed` or extra
    field leaks onto the wire.
19. Replaying send after withdraw returns the original receipt and does not
    requeue, either here or in the registry test (one strong assertion is
    sufficient; do not duplicate a large setup).

## Generated type procedure

The checked-in generator script always reads port 3090, while this worktree's
server normally hashes to another port. Generate only from a server whose PID
and worktree are known:

1. Check the intended TCP port with `lsof`. If another session owns 3090, do
   not stop it and do not consume its OpenAPI document.
2. Choose a checked free port, start this worktree's server with explicit
   `PORT`, and record its PID/startup log. If 3090 is free, the existing
   `bun --filter @archon/web generate:types` command may be used. Otherwise run
   the installed `openapi-typescript` CLI in `packages/web` against the
   explicit alternate URL and the same output path.
3. Before and after generation, verify this server's
   `/api/openapi.json` contains the DELETE path and
   `WithdrawWorkflowNodeResponse`.
4. Inspect the generated diff for only the expected additive path/schema.
5. Stop only the recorded server PID and confirm the port is released.

## Validation

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'withdraw queued guidance')
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'queued guidance')
bun run type-check
bun run lint
```

The second server filter reruns the unchanged send block and proves the new
middleware/fixtures did not regress Story 2.1.

## Phase completion criteria

- Registry tests prove pending-only removal, parked behavior, closed
  immutability, accepted-memory replay, and drain exclusion.
- The OpenAPI document and generated web declaration contain the exact DELETE
  path and response schema, including declared 500.
- Both terminal races return 409 without mutation.
- All refusal paths use the nested error body and write no transcript/event/run
  state.
- The contract clarification, code, and tests agree on parked versus closed
  behavior.
- No executor, database, send behavior, or package export was changed.

## Risks and rollback

- **Wrong-server type generation:** guarded by explicit port ownership and
  checking the served OpenAPI path before accepting the generated diff.
- **Fixture movement regresses send tests:** lift helpers verbatim and rerun the
  full queued-guidance route block.
- **Terminal mutation race:** guarded at both primitive (closed is immutable)
  and route (post-await phase recheck) layers.
- Rollback is deletion of the additive method/route/schemas/docs and
  regeneration of the prior OpenAPI declaration; no data rollback exists.
