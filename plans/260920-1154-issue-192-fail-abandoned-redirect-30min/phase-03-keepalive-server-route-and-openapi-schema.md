---
title: 'Phase 3: Keepalive route and generated contract'
status: todo
---

# Phase 3: Keepalive route and generated contract

## Outcome

Add the ratified authenticated keepalive endpoint and regenerate the web OpenAPI types from this worktree's server.
The endpoint only re-arms a live idle handle and never writes a row or delivers a message.

## Contract

- Method and path: `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`.
- Request body: none.
- Success response: exactly `{ success: true }`.
- Authentication: `resolveAuthContext` under the existing steering actor grant.
- Errors: the shared `{ success: false, error: { code, message } }` schema.
- Statuses: 401, declared 403 parity, 404, 409, 422, and 500.
- No owner check, role check, message body, timestamp, `sub_state`, transcript row, event row, or log content.

## Tests first

Add tests to `packages/server/src/routes/api.workflow-runs.test.ts` with the existing steering fixtures and error helpers.

1. The actor matrix allows the starter, another authenticated member, a non-owning admin, and an identity-less caller on an ungated install.
2. A gated unauthenticated caller receives the nested 401 `unauthenticated` response.
3. A live idle handle returns exactly `{ success: true }` and calls `recordComposerActivity()` once.
4. A live generating handle returns exactly `{ success: true }`, while the handle method remains a lifecycle no-op.
5. Repeated keepalive calls are safe and create no queue or transcript mutation.
6. A parked handle and a known non-terminal node without a local handle return 422 `not_steerable_here`.
7. A closed handle, terminal node, or terminal run returns 409 `node_finished`.
8. An unknown run or node returns 404 `not_found`.
9. A handle that closes during the final awaited run lookup returns 409 and receives no activity call.
10. A handle that parks during that await returns 422 and receives no activity call.
11. An internal failure returns the nested 500 `internal_error` response without logging user content.
12. The OpenAPI document contains a bodyless request and the strict minimal success schema.
13. Every rejected request leaves handle state, queue contents, and transcript rows unchanged.

## Schema changes

In `packages/server/src/routes/schemas/workflow.schemas.ts`, add:

- `keepaliveWorkflowNodeResponseSchema` as a strict object with only `success: z.literal(true)`.
- `KeepaliveWorkflowNodeResponse` through `z.infer<typeof keepaliveWorkflowNodeResponseSchema>`.

Use the existing import from `@hono/zod-openapi`.
Do not create a parallel interface.

## Route implementation

Add `keepaliveWorkflowNodeRoute` beside send and interrupt in `packages/server/src/routes/api.ts`.
Register it with `registerOpenApiRoute(..., steeringValidationErrorHook)`.

Use this order:

1. Resolve authentication and enforce only the existing steering grant.
2. Read the run and return 404 if it does not exist.
3. Return 409 if the run is terminal.
4. Read the in-process handle.
5. On the hot path, classify `closed` as 409, `parked` as 422, and `live` as a candidate success without reading the event history.
6. On the cold path with no handle, project persisted events to return 404 for an unknown node, 409 for a terminal node, or 422 for a known non-terminal detached node.
7. Re-read the run as the final awaited gate.
8. Return 404 or 409 if the run disappeared or became terminal.
9. Re-read the handle snapshot after that await.
10. Return 409 for closed, 422 for parked or missing, and otherwise call `recordComposerActivity()` synchronously.
11. Return `{ success: true }`.

The hot path follows the proven queue-read invariant that the executor seals the handle before its first awaited terminal write.
This avoids an event-history scan for each typing request.

## Generated types

Regenerate `packages/web/src/lib/api.generated.d.ts` from this worktree's OpenAPI document.
Never edit it by hand.

The normal generator is hard-coded to port 3090.
Before starting a server, inspect that port and do not stop or reuse a process owned by another worktree or user.
If this worktree does not already own port 3090, use a checked, deterministic private port such as 3192 and run `openapi-typescript` against that URL directly.

Use a temporary `ARCHON_HOME`, track the exact server PID or tool session, wait for `/api/health`, generate the file, stop only that server, and remove only that temporary directory.

Example shape when port 3192 is free:

```bash
lsof -i :3090
lsof -i :3192
task_archon_home="$(mktemp -d)"
ARCHON_HOME="$task_archon_home" PORT=3192 bun --filter @archon/server dev
bun x openapi-typescript http://127.0.0.1:3192/api/openapi.json -o packages/web/src/lib/api.generated.d.ts
```

Run the generator from a second terminal or tracked command session after the server is ready.
Run the server as a tracked process in the implementation environment.
Do not copy the example as an untracked detached shell process.

## Files

| File                                                     | Action                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | Add the strict success schema and inferred type.              |
| `packages/server/src/routes/api.ts`                      | Add the OpenAPI route and handler.                            |
| `packages/server/src/routes/api.workflow-runs.test.ts`   | Add route, race, actor, mutation-negative, and OpenAPI tests. |
| `packages/web/src/lib/api.generated.d.ts`                | Regenerate from the worktree server.                          |

## Verification

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
bun run type-check

cd ../web
bun run type-check
```

Also compare the generated diff and confirm that it adds the keepalive path and schema without removing unrelated paths.

## Exit criteria

- [ ] The route matches the ratified request, response, error, and actor contracts.
- [ ] A terminal transition during the request wins before the activity mutation.
- [ ] The live path does not scan workflow event history.
- [ ] No route outcome writes a message, transcript row, workflow event, or queue item.
- [ ] The generated file came from this worktree and contains no unrelated loss.
- [ ] No server process or temporary Archon home remains after generation.

## Risks and rollback

- Returning `sub_state` would violate the ratified public response.
- Treating a parked handle as success would keep a node alive where no provider session can accept a redirect.
- Generating against a foreign server can erase unrelated generated routes.
- Rollback removes an additive route and generated type and needs no data migration.

## Next phase

Wire the generated type into both web API clients and implement the two-shell interaction and failure presentation.
