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

Implement the already-specified authenticated, bodyless keepalive route, with
the same trust and lifecycle boundaries as the steering routes, then regenerate
the web wire types and add a no-body client helper.

## Evidence and constraints

- Route/schema owners:
  `packages/server/src/routes/api.ts` and
  `packages/server/src/routes/schemas/workflow.schemas.ts`.
- Test owner: `packages/server/src/routes/api.workflow-runs.test.ts`; its
  interrupt describe already supplies live/idle setups, auth-gate patterns,
  state projection, and nested-error helpers.
- Client owner: `packages/web/src/lib/api.ts`; normalization comes from
  `toSteeringRequestError`.
- `steering-api-contract.md` fixes the bodyless request, `{ success: true }`,
  existing steering actor grant, and no durable row.
- Every API route must use `registerOpenApiRoute(createRoute(...), handler)`.
- Generated types come from a running current server and are never hand-edited.

## Files

| File                                                     | Action                                       |
| -------------------------------------------------------- | -------------------------------------------- |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | Add strict success schema/type               |
| `packages/server/src/routes/api.ts`                      | Add OpenAPI route and guarded handler        |
| `packages/server/src/routes/api.workflow-runs.test.ts`   | Add keepalive route matrix                   |
| `packages/web/src/lib/api.generated.d.ts`                | Regenerate                                   |
| `packages/web/src/lib/api.ts`                            | Add response type and `keepaliveNode`        |
| `packages/web/src/lib/api.keepalive.test.ts`             | Create focused method/body/error helper test |

## Route design

1. Add strict `keepaliveWorkflowNodeResponseSchema` with literal
   `{ success: true }`, derive its type with `z.infer`, and register the OpenAPI
   component name `KeepaliveWorkflowNodeResponse`.
2. Define
   `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`, with path params
   only and no `request.body`. Document that it re-arms only a live idle waiter,
   is a no-op for other live handle states, and writes no row.
3. Reuse the interrupt handler's ordered guard ladder:
   - resolve auth first; gated unauthenticated caller → nested 401;
   - unknown run, or unknown node with no handle → 404;
   - terminal run/node or closed handle → 409 `node_finished`;
   - parked handle or no in-process handle → 422 `not_steerable_here`;
   - final run re-read so a concurrent terminal transition wins;
   - synchronously call `handle.keepalive()` and return 200.

   A live idle handle returns `rearmed`; live generating, between-turn, or
   queue-only handles return `not_idle`. Both are successful no-content
   mutations and return the same public 200 shape. The UI only calls while
   idle; the no-op behavior makes a late activity request harmless.

4. Register with `steeringValidationErrorHook`, include 200/401/403/404/409/
   422/500 in the route definition, and use the nested `steeringError` shape.
   Log only run/node/error metadata under a keepalive-specific event name.
5. In `api.ts` (web), derive the generated response type and add
   `keepaliveNode(runId, nodeId)`. Encode both path segments, use POST with no
   body or synthetic content type, normalize failures through
   `toSteeringRequestError`, and do not auto-retry.

## Tests first

| ID    | Case                     | Required assertions                                                                                                                               |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3.1  | Idle success             | 200 exact body; `handle.keepalive()` called once; handle remains idle and the waiter remains pending. Phase 1 separately proves re-arm mechanics. |
| T3.2  | Live no-op states        | Generating, between-turn, and queue-only handles return 200 without aborting, scheduling, changing queue, or changing sub-state.                  |
| T3.3  | Keepalive never resolves | A later `send_now` still resolves the original waiter and drains normally.                                                                        |
| T3.4  | Steering actor grant     | Authenticated starter/member/admin are allowed; identity-less install behavior matches send/interrupt. No owner-only rule is introduced.          |
| T3.5  | Auth ordering            | Under the auth/API gate, unauthenticated → nested 401 before run/event lookup.                                                                    |
| T3.6  | Not found                | Unknown run and unknown node/no handle → nested 404.                                                                                              |
| T3.7  | Terminal                 | Terminal run, terminal projected node, and closed handle → 409 `node_finished`.                                                                   |
| T3.8  | Not steerable here       | Known non-terminal node without a handle and a parked handle → 422 `not_steerable_here`.                                                          |
| T3.9  | Final re-read            | A run that becomes terminal between reads returns 409 and never calls keepalive.                                                                  |
| T3.10 | Schema/OpenAPI           | Strict success schema rejects extras; `/api/openapi.json` exposes the bodyless POST and named response.                                           |
| T3.11 | No persistence/content   | No event/message/status write occurs and logs contain no operator prose.                                                                          |
| T3.12 | Client helper            | Encoded URL, POST, empty body, absent JSON content type, exact success return, and 422 normalization to `SteeringRequestError`.                   |

## Type generation and process hygiene

After route tests pass:

1. Check port 3090. Reuse only a server proven to be this worktree at the
   current code; never move to another port to hide a stale owner.
2. If starting `bun run dev:server`, record its PID and worktree.
3. Run `bun --filter @archon/web generate:types`.
4. Stop that exact PID cleanly and verify port 3090 is released.
5. Inspect the generated diff: only the new path/schema/type should appear.

## Verification

```bash
bun test packages/server/src/routes/api.workflow-runs.test.ts
bun test packages/web/src/lib/api.keepalive.test.ts
bun --filter @archon/server type-check
bun --filter @archon/web type-check
bun x eslint packages/server/src/routes/api.ts packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.workflow-runs.test.ts packages/web/src/lib/api.ts packages/web/src/lib/api.keepalive.test.ts --max-warnings 0
git diff -- packages/web/src/lib/api.generated.d.ts
```

Existing send, interrupt, withdraw, and queue route suites must remain green.

## Security, compatibility, and rollback

- The route grants exactly the existing steering capability: any authenticated
  operator may keep a shared node alive, and no message content is sent.
- Client coalescing reduces load but is not an authorization boundary. Each
  request is still authenticated and state-checked server-side.
- The route and generated schema are additive. Revert the web helper/callers
  first or together with the route; regenerate the types after a route revert.
