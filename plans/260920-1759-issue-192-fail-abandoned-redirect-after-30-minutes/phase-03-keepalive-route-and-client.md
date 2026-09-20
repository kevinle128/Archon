---
phase: 3
title: 'Phase 3: Keepalive route and client'
status: pending
priority: P1
effort: '3h'
dependencies: [1]
---

# Phase 3: Keepalive route and client

## Goal

Add the authenticated, bodyless
`POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive` route from
`steering-api-contract.md` — same guard ladder, actor grant, and error shape as
the interrupt route — that re-arms the idle-await timer through
`handle.keepalive()` and returns `{ success: true }`; regenerate the web types
and add the `keepaliveNode` client helper.

## Context links

- `packages/server/src/routes/api.ts`: `interruptWorkflowNodeRoute` definition
  (~1644) and handler (~5474–5556), `steeringError`, `steeringJsonError`,
  `TERMINAL_WORKFLOW_STATUSES`, `TERMINAL_API_NODE_STATUSES`,
  `projectApiWorkflowNodeStates`, `steeringValidationErrorHook`.
- `packages/server/src/routes/schemas/workflow.schemas.ts`:
  `interruptWorkflowNodeResponseSchema` (~582), `steeringErrorSchema`.
- `packages/server/src/routes/api.workflow-runs.test.ts`: describe
  `POST …/interrupt` (~7295) with `liveInterruptibleSetup`,
  `idleInterruptibleSetup`, `postNodeInterrupt`, `expectSteeringError`,
  `resetSteeringMocks`, the 401 env-flip pattern.
- `packages/web/src/lib/api.ts`: `interruptNode` (~794),
  `toSteeringRequestError`.
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`.
- AGENTS.md — every route through `registerOpenApiRoute`; regenerate
  `api.generated.d.ts` with a running server.

## File inventory

| File                                                          | Action     | Size  | Test impact                                   |
| ------------------------------------------------------------- | ---------- | ----- | --------------------------------------------- |
| `packages/server/src/routes/schemas/workflow.schemas.ts`      | Modify     | ~+15  | Schema shape asserted by route tests          |
| `packages/server/src/routes/api.ts`                           | Modify     | ~+95  | New route + handler                           |
| `packages/server/src/routes/api.workflow-runs.test.ts`        | Modify     | ~+150 | New describe `POST …/keepalive` (T3.x)        |
| `packages/web/src/lib/api.generated.d.ts`                     | Regenerate | auto  | Type-only; never hand-edited                  |
| `packages/web/src/lib/api.ts`                                 | Modify     | ~+25  | `keepaliveNode` helper                        |
| `packages/web/src/lib/api.test.ts` (if present) or new `…keepalive` test | Modify/Create | ~+40 | Helper URL/method/error normalization |

## Tests before

| ID    | Test                                                    | Required assertion                                                                                                                                             |
| ----- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3.1  | 200 rearmed on an idle handle                           | `idleInterruptibleSetup()`; POST → 200 `{ success: true }`; handle still `idle-after-interrupt`; waiter unresolved (spy shows no send_now/terminated).          |
| T3.2  | 200 no-op on a generating handle                        | `liveInterruptibleSetup()` without idle; POST → 200 `{ success: true }`; no abort (`aborts() === 0`); sub-state unchanged.                                       |
| T3.3  | keepalive never resolves idle-await                     | After T3.1's POST, `handle.accept(msg,'send_now')` still resolves the waiter with the batch — the waiter was not consumed by keepalive.                         |
| T3.4  | actor ladder                                            | starter, other member, admin, identity-less → 200 each (mirrors the interrupt ladder test).                                                                     |
| T3.5  | nested 401 for gated unauthenticated caller             | Same env flip as the interrupt 401 test; body `{ success:false, error:{ code:'unauthenticated', … } }`; `mockGetWorkflowRun` not called.                        |
| T3.6  | 404 unknown run / unknown node                          | `not_found` code and message for each.                                                                                                                         |
| T3.7  | 409 on terminal run, terminal node, or closed handle    | Three cases → `node_finished`.                                                                                                                                 |
| T3.8  | 422 with no live handle                                 | Known non-terminal node, registry empty → `not_steerable_here`.                                                                                                |
| T3.9  | final async gate                                        | Run flips terminal between the first read and the latest-run re-read → 409, `keepalive()` not invoked (spy).                                                    |
| T3.10 | response schema is strict and documented                | `keepaliveWorkflowNodeResponseSchema.parse({ success: true })` ok; extra keys rejected; OpenAPI spec (`GET /api/openapi.json`) lists the path with `KeepaliveWorkflowNodeResponse`. |
| T3.11 | client helper                                           | `keepaliveNode('r/1','n 2')` POSTs to the encoded `/keepalive` URL with no body and no JSON content-type; a 422 body maps to `SteeringRequestError` with `code`. |

## Refactor (protected changes)

1. `workflow.schemas.ts`: add
   `keepaliveWorkflowNodeResponseSchema = z.object({ success: z.literal(true) }).strict().openapi('KeepaliveWorkflowNodeResponse')`
   and `KeepaliveWorkflowNodeResponse = z.infer<…>`, under a new
   `POST …/keepalive (steering)` section comment.
2. `api.ts`: `keepaliveWorkflowNodeRoute = createRoute({ method: 'post', path:
   '/api/workflows/runs/{runId}/nodes/{nodeId}/keepalive', tags: ['Workflows'],
   summary: 'Re-arm the idle-await inactivity timer of an interrupted workflow node',
   description: … (no body, writes no row, re-arms the fixed 30-minute
   inactivity timer only while the node is idle-after-interrupt; a generating
   node is a harmless no-op; terminal → 409, detached → 422), request: {
   params }, responses: { 200, 401, 403, 404, 409, 422, 500 } }` using
   `steeringJsonError` for errors.
3. Handler: copy the interrupt handler verbatim up to and including the
   "final async gate" re-read, then `handle.keepalive();` and
   `return c.json({ success: true as const }, 200)`. Log failures as
   `api.workflow_node_keepalive_failed`. Register with
   `registerOpenApiRoute(keepaliveWorkflowNodeRoute, handler, steeringValidationErrorHook)`
   immediately after the interrupt registration.
4. Regenerate types: start the dev server on 3090 (`bun run dev:server`,
   record the PID), run `bun --filter @archon/web generate:types`, stop the
   server by PID, and commit `api.generated.d.ts`.
5. `packages/web/src/lib/api.ts`: `export type KeepaliveWorkflowNodeResponse =
   components['schemas']['KeepaliveWorkflowNodeResponse']` and
   `keepaliveNode(runId, nodeId)` mirroring `interruptNode` (POST, no body,
   `toSteeringRequestError` without a custom message).
6. Update `steering-api-contract.md` only if wording diverges from what was
   built (Phase 5 owns the authority sync; note any divergence for it).

## Tests after

T3.1–T3.11 pass; the existing interrupt/send/withdraw/queue describes pass
unchanged.

## Regression gate

```bash
bun test packages/server/src/routes/api.workflow-runs.test.ts
bun --filter @archon/server type-check
bun --filter @archon/web type-check
bun x eslint packages/server/src/routes/api.ts packages/server/src/routes/schemas/workflow.schemas.ts packages/web/src/lib/api.ts --max-warnings 0
git diff --stat packages/web/src/lib/api.generated.d.ts   # must show the new schema/path only
```

## Test scenario matrix

| Path     | Scenario                                       | Tests            |
| -------- | ---------------------------------------------- | ---------------- |
| Critical | re-arm without resolving idle-await            | T3.1, T3.3       |
| Critical | actor grant and 401                            | T3.4, T3.5       |
| High     | guard ladder parity with interrupt             | T3.6–T3.9        |
| Medium   | no-op on generating                            | T3.2             |
| Medium   | schema/OpenAPI/client                          | T3.10, T3.11     |

## Dependency map

- Requires Phase 1 (`keepalive()`).
- Feeds Phase 4 (client helper + generated type).

## Risk assessment

- Forgetting `steeringValidationErrorHook` yields Hono's default 400 shape on
  malformed params — copy the registration line, and T3.6 covers a
  schema-invalid param indirectly.
- Regenerating types against a stale server build — restart the server after
  the route lands before generating.

## Security considerations

The route hands out nothing, writes nothing, and logs only ids. The steering
actor grant (any authenticated identity; identity-less run allowed) is the
same owner-ratified grant as send/interrupt and is not widened.

## Rollback

Revert the server files and `api.ts`; regenerate types to drop the schema.
