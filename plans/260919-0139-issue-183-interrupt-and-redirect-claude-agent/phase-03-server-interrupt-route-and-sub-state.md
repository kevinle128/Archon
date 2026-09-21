---
phase: 3
title: 'Interrupt route, atomic Send now, and sub-state projection'
status: pending
priority: P1
dependencies: [2]
---

# Phase 3: Interrupt route, atomic Send now, and sub-state projection

## Goal

Expose the live engine state without inventing durable state: add the interrupt route, send `intent` into the registry's atomic accept operation, and project the two interrupt-capable agent sub-states into the existing GET-run node state.

## Files

| File                                                     | Change                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | Add interrupt response schema and optional `steeringSubState`; keep the existing send request/response and shared error schema. |
| `packages/server/src/routes/api.ts`                      | Register the interrupt route, switch send to intent-aware `handle.accept`, and join live sub-state into GET-run projection.     |
| `packages/server/src/routes/api.workflow-runs.test.ts`   | Route, race, authorization, idempotency, projection, and OpenAPI assertions.                                                    |
| `packages/web/src/lib/api.generated.d.ts`                | Regenerate from the server OpenAPI document; never hand-edit.                                                                   |

`openapi-defaults.ts` does not change: interrupt has no request body, and send already uses the steering validation hook for malformed JSON.

## Wire contract

### Interrupt

`POST /api/workflows/runs/{runId}/nodes/{nodeId}/interrupt` has no body.

Success:

```json
{ "success": true, "sub_state": "idle-after-interrupt" }
```

or:

```json
{ "success": true, "sub_state": "generating" }
```

The route uses the existing strict nested steering error shape:

- 401 unauthenticated when the auth/API gate requires identity;
- 403 only where existing auth resolution produces it;
- 404 `not_found` for unknown run/node;
- 409 `node_finished` for a terminal run/node or natural-empty close during the request;
- 422 `not_steerable_here` for detached, parked, absent, or currently non-interrupt-capable live handling;
- 500 `internal_error` for unexpected failures.

Do not add `not_interruptible`: it conflicts with the ratified route error vocabulary and leaks an implementation staging detail. The web never offers Stop when the optional sub-state is absent.

### Send receipt

The body remains strict and non-blank. Pass `body.intent` to the registry in the same synchronous final mutation as receipt acceptance. Return `result.receipt.state` exactly:

- generating/interrupting acceptance: `queued`;
- idle acceptance: `awaiting_send_now`, even when that same `send_now` call releases the batch.

This is an immutable idempotent receipt, not a delivery state. A duplicate `message_id` replays the original response and cannot release idle twice.

### GET-run projection

Add optional:

```ts
steeringSubState?: 'generating' | 'idle-after-interrupt';
```

After projecting and terminal-settling persisted node states, join registry snapshots by the exact `(runId, nodeId)` key. Include the field only when:

- the persisted/projection node is still `running`;
- the handle is live in this server process;
- the handle is interrupt-capable and has a projected sub-state.

Omit it for queue-only non-Claude handles, parked asks, detached runs, terminal nodes, historical executions, and absent handles. Do not persist it and do not synthesize it from transcript rows.

## Handler sequencing

Follow the established send-route actor grant and lifecycle checks:

1. Resolve auth; any authenticated member may steer, an identity-less run remains allowed when the installation gate permits it.
2. Load run, events, pending interactions, projected node state, and registry handle.
3. Apply 404/409/422 checks with persisted lifecycle outranking a stale handle.
4. Re-read run status as the final async database gate.
5. Call `handle.interrupt()` synchronously before any further `await`; this is the no-torn-controller boundary.
6. Await the shared executor settlement and map the actual outcome.

If the caller disconnects after step 5, do not undo the interrupt; the engine transition is already an authorized operation and must finish/clean up independently.

For send, retain the same final gate and ensure there is no `await` between it and `handle.accept(message, intent)`. The registry owns the atomic idle release, so the route never performs “read sub-state, then send now” as two operations.

## Tests first

Add route tests with isolated registry handles:

1. live generating interrupt settles idle → 200 idle;
2. natural-end race with pending guidance → 200 generating;
3. natural-end race with empty queue → 409 `node_finished`;
4. repeated/concurrent interrupts share one abort and each receive the same outcome;
5. interrupt while already idle → idempotent 200 idle;
6. actor ladder matches send: starter, other authenticated member, admin, and identity-less allowed; gated unauthenticated rejected;
7. unknown run/node → 404; terminal run/node/closed handle → 409; absent/parked/non-interrupt-capable handle → 422 `not_steerable_here`;
8. node becomes terminal after the initial read → final gate or settlement returns 409 with no stale success;
9. send Queue while idle returns `awaiting_send_now` and does not wake;
10. send Send now while idle returns `awaiting_send_now` and wakes once with old receipts then the new message;
11. duplicate Send now replays the original receipt without a second drain;
12. send during interrupting returns `queued` and remains pending for explicit Send now if interruption wins;
13. GET run adds the field only to the matching live interrupt-capable running node, including a namespaced loop-group body key;
14. GET run without a qualifying handle is wire-identical to current output;
15. generated OpenAPI contains the new route, response enum, and optional node field.

Retain all existing malformed-body and queue-guidance tests.

## Type generation and process safety

Regeneration requires the server:

1. Check port 3090 and reuse only a server known to belong to this worktree; otherwise start `bun run dev:server` through the observable process harness and record PID/port/worktree.
2. Run `bun --filter @archon/web generate:types`.
3. Stop only the server started for this task.
4. Review the generated diff for the route and schemas above; unrelated churn is a failure.

## Validation

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts -t 'interrupt'
bun test src/routes/api.workflow-runs.test.ts -t 'queued guidance'
bun test src/routes/api.workflow-runs.test.ts
bun run type-check
cd ../web
bun run type-check
```

Then run the complete server route test file because `api.ts` is shared.

## Completion criteria

- The HTTP outcome reflects executor classification rather than request timing.
- Send acceptance/release is atomic and idempotent, with the verified receipt semantics.
- Optional projection cannot expose Stop for non-Claude, detached, parked, historical, or terminal nodes.
- Generated web types compile and contain no hand edits.

## Security, reliability, and rollback

- Message text is still never logged by the registry/route; errors contain stable codes and non-sensitive prose.
- There is no per-tenant logic: the existing single-install, multi-user steering actor grant is preserved.
- An interrupt request intentionally waits for classification, so Phase 2 must prove every close/park/discard/error path settles it. Do not paper over a leaked promise with a route timeout.
- Rollback removes an additive route/field and restores send to queue-only acceptance; no migration or data rollback exists.
