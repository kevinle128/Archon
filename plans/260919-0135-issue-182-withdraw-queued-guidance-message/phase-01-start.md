---
phase: 1
title: 'Registry withdraw primitive and typed DELETE route'
status: pending
priority: P1
effort: '1 session'
dependencies: []
---

# Phase 1: Registry withdraw primitive and typed DELETE route

## Goal

Add one synchronous `withdraw(messageId)` primitive to `NodeSteeringHandle` and implement the ratified `DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId` route on top of it, with the same actor grant, nested error shape, and no-mutation-on-refusal guarantee as the send route.

## Context links

- Contract: `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` (routes table, withdraw request/response, error ladder, idempotency).
- Story: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:444-470`.
- Precedent: send route in `packages/server/src/routes/api.ts:1574-1608` (route definition), `:5173-5290` (middleware + handler), `openapi-defaults.ts:59-73` (hook), tests at `api.workflow-runs.test.ts:6162-6660`.
- Registry: `packages/workflows/src/steering-registry.ts`, tests `steering-registry.test.ts`.

## Key insights (scouted)

- `NodeSteeringHandle` has `pending: QueuedOperatorMessage[]` (the queue) and `accepted: Map<id, {receipt, message}>` (idempotency memory). `drain()` swaps `pending` for `[]` and keeps `accepted`. Withdraw must follow the same split: remove from `pending`, keep `accepted`.
- Both executor drain sites (`dag-executor.ts:3336-3351` direct, `:6883-6910` loop) run `closeIfEmpty()`/`pendingCount()` and `drain()` with no `await` in between. A synchronous withdraw therefore either lands before the gate (queue may become empty → `closeIfEmpty()` seals and the node finishes normally) or after `drain()` (no-op). No executor change.
- `closeIfEmpty()` can now return `true` because of a withdraw that emptied the queue — that is the correct outcome (nothing to deliver, node completes) and is already covered by the executor's existing empty-queue path.
- The send route's `app.use` middleware also pre-parses JSON; the withdraw route has no body, so its middleware does auth only. Do not widen the send middleware's path pattern.
- No existing route matches `/nodes/:nodeId/queue/*`; the `messages/{messageId}` routes are sibling paths and do not shadow it.
- `steeringError()` accepts `400 | 401 | 403 | 404 | 409 | 422 | 500` — reuse as is. `steeringValidationErrorHook` maps param validation failures to the nested 400 body.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/workflows/src/steering-registry.ts` | modify | +~20 lines: `withdraw(messageId): boolean` on `NodeSteeringHandle` | `steering-registry.test.ts` +1 describe |
| `packages/workflows/src/steering-registry.test.ts` | modify | +~70 lines | new `describe('withdraw')` |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | modify | +~20 lines: `withdrawWorkflowNodeParamsSchema`, `withdrawWorkflowNodeResponseSchema` + types | schema unit coverage via route tests |
| `packages/server/src/routes/api.ts` | modify | +~90 lines: `withdrawWorkflowNodeRoute`, auth middleware, handler | `api.workflow-runs.test.ts` +1 describe |
| `packages/server/src/routes/api.workflow-runs.test.ts` | modify | +~250 lines | new `describe('DELETE …/queue/:messageId — withdraw queued guidance')` |
| `packages/web/src/lib/api.generated.d.ts` | regenerate | +~60 lines | none (type-only); Phase 2 consumes |

Do not edit `steering-api-contract.md`, the send route, `dag-executor.ts`, or `openapi-defaults.ts`.

## Tests before (write first, watch them fail)

### Registry — `steering-registry.test.ts`, new `describe('withdraw')`

1. `removes the matching pending item and preserves order of the rest` — enqueue ids A, B, C; `withdraw(B)` → `true`; `snapshot().queued` is `[A, C]`; `pendingCount()` is 2.
2. `returns false for an id never accepted` — no mutation to snapshot.
3. `returns false for an id already drained` — enqueue A; `drain()`; `withdraw(A)` → `false`; snapshot unchanged.
4. `returns false on a repeated withdraw of the same id` — second call is `false`, queue unchanged.
5. `keeps accepted-id memory: a replayed enqueue of a withdrawn id returns the original receipt and does not re-queue` — after `withdraw(A)`, `enqueue({messageId: A, …})` → `{ ok: true, duplicate: true }`; `pendingCount()` stays 0; `acceptedCount` unchanged. **This is the decision-1 test.**
6. `removes from a parked handle` — `park()`, `withdraw(A)` → `true`; phase stays `parked`.
7. `removes from a closed handle without changing phase` — `close()`, `withdraw(A)` → `true`; phase stays `closed` (the route guards this; the primitive is phase-agnostic).
8. `does not change phase on a live handle` — after withdraw of the last item the handle remains `live`, not `closed` (only `closeIfEmpty()` seals).
9. `a withdrawn message is absent from a later drain` — enqueue A, B; `withdraw(A)`; `drain()` returns `[B]`.

### Route — `api.workflow-runs.test.ts`, new `describe('DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId — withdraw queued guidance')`

Add a `deleteNodeQueue(app, messageId, headers?, runId?, nodeId?)` helper beside `postNodeSend`, and reuse `liveSetup`, `mockSteerableRun`, `steerEvent`, `expectNoSteeringMutation`, `expectSteeringError` (lift them out of the send `describe` into module scope if they are currently closure-local).

Actor matrix (each with a queued `STEER_MESSAGE_ID` on a live handle):

10. run starter → 200 `{ success: true, message_id }`; queue empty afterwards.
11. another authenticated member → 200.
12. admin not owning the run → 200.
13. identity-less install (no header) → 200.
14. gated web-auth with no identity **and a non-UUID `messageId`** → nested 401, not 400 (same env-flip pattern as the send test at `:6315`). This is the test that justifies the DELETE-only `app.use`: without it the param hook answers 400 before the handler's auth check runs. Queue unchanged.

Validation:

15. non-UUID `messageId` → nested 400 `invalid_request`; queue unchanged.

Target ladder (assert `expectNoSteeringMutation` on every refusal):

16. unknown run → 404 `not_found`.
17. unknown node (no projection, no handle) → 404 `not_found`.
18. terminal run with stale live handle holding the id → 409 `node_finished`; item still present.
19. each terminal node state (`completed`, `failed`, `cancelled`, `skipped` — mirror the send test's list) → 409; item still present.
20. closed handle holding the id → 409 `node_finished`; item still present.
21. running node with no handle → 422 `not_steerable_here`.
22. **parked handle holding the id → 200 and the item is removed** (decision 3; differs from send).
23. run turns terminal between lookup and the final re-read (`mockResolvedValueOnce` running, then terminal) → 409; item still present.

Idempotency:

24. live handle, id queued → 200, `snapshot().queued` no longer contains it, `acceptedCount` unchanged.
25. repeat the same withdraw → 200, identical body.
26. id already drained (`handle.drain()` first) → 200.
27. id never seen → 200 with the requested `message_id` echoed.
28. withdrawing B from `[A, B, C]` leaves `[A, C]` in order.

Response shape:

29. success body is exactly `{ success: true, message_id }` with no extra keys.

## Refactor (protected code changes)

### `steering-registry.ts`

Add to `NodeSteeringHandle`, after `drain()`:

```ts
  /**
   * Synchronously removes one still-pending message by id. Returns true when
   * an item was removed. Accepted-id memory is never touched, so a replayed
   * enqueue of a withdrawn id still returns its original receipt without
   * re-queueing. Phase-agnostic: lifecycle refusals (closed handle → 409)
   * belong to the route, not to this primitive.
   */
  withdraw(messageId: string): boolean {
    const index = this.pending.findIndex(item => item.messageId === messageId);
    if (index === -1) return false;
    this.pending.splice(index, 1);
    return true;
  }
```

Update the module docblock's design bullets with one line naming withdraw as a pending-only, synchronous operation.

### `workflow.schemas.ts`

Beside the send schemas:

```ts
export const withdrawWorkflowNodeParamsSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  messageId: z.string().uuid(),
});
export const withdrawWorkflowNodeResponseSchema = z
  .object({ success: z.literal(true), message_id: z.string().uuid() })
  .strict()
  .openapi('WithdrawWorkflowNodeResponse');
export type WithdrawWorkflowNodeResponse = z.infer<typeof withdrawWorkflowNodeResponseSchema>;
```

Match the exact `z.string().uuid()` form the send body schema uses so both routes agree on the id shape.

### `api.ts`

1. Import the two new schemas beside `sendWorkflowNodeBodySchema`.
2. Define `withdrawWorkflowNodeRoute` after `sendWorkflowNodeRoute`: `method: 'delete'`, `path: '/api/workflows/runs/{runId}/nodes/{nodeId}/queue/{messageId}'`, `request: { params: withdrawWorkflowNodeParamsSchema }`, responses 200 (`withdrawWorkflowNodeResponseSchema`), 400/401/403/404/409/422 via `steeringJsonError(...)`. Description: idempotent, no body, drained/unknown id is a success no-op.
3. Add a second `app.use('/api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId', …)` gated to `DELETE` that does the auth check only (copy the identity branch of the send middleware; no JSON pre-parse). **Register it before `registerOpenApiRoute(withdrawWorkflowNodeRoute, …)`** — Hono runs middleware in registration order, which is why the send middleware at `:5179` precedes its route at `:5198`; the order is what makes 401 win over the param validator's 400.
4. Register with `registerOpenApiRoute(withdrawWorkflowNodeRoute, handler, steeringValidationErrorHook)`. Handler order (a correctness requirement):
   1. `resolveAuthContext` → 401 when gated and unresolved.
   2. Read `runId`, `nodeId`, `messageId` with `c.req.param(...)` as the send handler does — `app.openapi` has already validated `request.params` against `withdrawWorkflowNodeParamsSchema`, and `steeringValidationErrorHook` has returned the nested 400 for a non-UUID id before the handler runs. (There is no `getValidatedParams` helper; do not add one.)
   3. `workflowDb.getWorkflowRun(runId)` → 404 when null.
   4. Project node state from `listWorkflowEvents` + `listPendingInteractions`; look up the handle.
   5. No projection and no handle → 404; terminal run → 409; terminal node → 409; closed handle → 409; no handle → 422. **Duplicate the ladder inline** with the same messages as the send handler — two callers do not meet the rule of three (AGENTS.md, DRY + Rule of Three), and the ladders already differ on parked handles. Do not extract a shared helper or touch the send handler. A parked handle is **not** refused here.
   6. Re-read the run; null → 404, terminal → 409. No `await` after this line.
   7. `const removed = handle.withdraw(messageId);`
   8. `getLog().info({ runId, nodeId, messageId, removed }, 'api.workflow_node_withdraw_completed');`
   9. `return c.json({ success: true as const, message_id: messageId }, 200);`
   10. `catch` → log `api.workflow_node_withdraw_failed` with `err`, return 500 `internal_error`.

### Type regeneration

`generate:types` is hardcoded to `http://localhost:3090`, but this is a worktree: without `PORT`, `resolvePort()` in `packages/core/src/utils/port-allocation.ts` hashes the path into 3190–4089. Starting `dev:server` bare would either leave 3090 empty (the command fails) or — if the main checkout's server happens to be up on 3090 — regenerate the file from a build that lacks the withdraw route, silently. Therefore:

1. `lsof -i :3090` — if a process is bound, it is not yours; stop and report rather than picking another port.
2. `PORT=3090 bun run dev:server` in the background (`PORT` is an explicit override, validated in `port-allocation.ts:31-38`); record its PID and confirm the startup log names port 3090.
3. `bun --filter @archon/web generate:types`.
4. `git diff packages/web/src/lib/api.generated.d.ts` must contain `WithdrawWorkflowNodeResponse` and the `/queue/{messageId}` DELETE path — if it does not, the spec came from the wrong server; do not commit it.
5. Stop only the recorded PID.

## Tests after (new behavior)

All 29 cases above pass. Re-run the full send `describe` unchanged; it must not be touched by this phase.

## Test scenario matrix

| Priority | Scenario | Suite |
| --- | --- | --- |
| Critical | live removal preserves order; accepted memory intact; replayed send does not re-queue | registry 1, 5, 9 |
| Critical | terminal run/node/closed handle → 409 with no mutation; terminal race → 409 | route 18–20, 23 |
| Critical | drained/unknown/repeated id → 200 identical body | route 25–27 |
| High | actor matrix incl. gated 401 | route 10–14 |
| High | parked handle withdraws (divergence from send) | registry 6, route 22 |
| High | non-UUID id → 400; unknown run/node → 404; no handle → 422 | route 15–17, 21 |
| Medium | withdraw does not change phase; closed-handle primitive | registry 7, 8 |
| Medium | exact success shape, log line has ids only | route 29 |

## Regression gate

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'guidance')
bun run type-check
bun run lint
```

All three must be green before Phase 2 starts; the `-t 'guidance'` filter covers both the send and withdraw describes.

## Todo

- [ ] Write registry tests 1–9 (red).
- [ ] Implement `withdraw()`; registry green.
- [ ] Write route tests 10–29 (red); lift shared fixtures to module scope if needed.
- [ ] Add schemas, route definition, DELETE-only auth middleware, handler.
- [ ] Route green; send describe still green unchanged.
- [ ] Regenerate `api.generated.d.ts` with a tracked server PID; stop it.
- [ ] Regression gate green.

## Success criteria

- `NodeSteeringHandle.withdraw` exists, is synchronous, touches only `pending`, and is exported through the existing `./steering-registry` subpath only.
- The DELETE route appears in `/api/openapi.json` with the nested steering error responses and the `WithdrawWorkflowNodeResponse` schema.
- Every refusal path is proven mutation-free by `expectNoSteeringMutation`.
- No change to send behavior, executor, or `openapi-defaults.ts`.

## Risk assessment

- **Fixture lifting breaks the send describe** — mitigate by moving helpers verbatim and running the send filter before adding new tests.
- **Regenerating types from the wrong server** — step 4 of type regeneration is the guard; a diff without the withdraw schema is never committed.
- **`z.string().uuid()` strictness differs from the send schema** — copy the exact expression from `sendWorkflowNodeBodySchema`.

## Security considerations

- Same actor grant as send (any authenticated identity; identity-less install allowed); no new role logic.
- Never log message content; the log line carries ids and the boolean only.
- The route cannot reach a handle in another process — 422 keeps detached runs untouched.

## Next steps

Phase 2 consumes `WithdrawWorkflowNodeResponse` from the regenerated types and the route's URL shape.
