---
title: "Phase 3: Keepalive server route + OpenAPI schema"
status: todo
---

# Phase 3: Keepalive server route + OpenAPI schema

## Context links

- Scout: `plans/reports/scout-260920-1843-server-steering-routes.md` (route ladder, actor grant,
  schemas, test scaffolding).
- `steering-api-contract.md`; `steering-test-plan.md` "Registry and routes".

## Overview

Add an authenticated, bodyless `keepalive` route that re-arms the executor's idle-await timer by
calling `NodeSteeringHandle.recordComposerActivity()` (Phase 1). Modeled exactly on the existing
`interrupt` route.

## Key insights

- Steering routes: `send` (`api.ts:5337-5462`), `interrupt` (`:5464-5555`), withdraw
  (`DELETE …/queue/{messageId}`), queue GET. All registered via
  `registerOpenApiRoute(routeConst, handler, steeringValidationErrorHook)`.
- Shared precedence ladder: 404 unknown run/node → 409 `node_finished` (terminal run/node/closed
  handle) → 422 `not_steerable_here` (no live handle) → re-check latest run status → mutate.
- **Actor grant** = "any resolved identity": `resolveAuthContext(c)` (`api.ts:2469-2516`) must
  resolve *some* identity when `isWebAuthEnabled() || isApiGateEnabled()`; starter, other member,
  non-owning admin all allowed; identity-less run allowed on an ungated install; unauthenticated
  → 401 only when gated. The declared `403` is never raised (do not add one).
- Response convention: 200 `{ success:true, ...fields }`; non-2xx shared `steeringErrorSchema`
  (`workflow.schemas.ts:596-604`). `interrupt` returns `{ success:true, sub_state }`
  (`interruptWorkflowNodeResponseSchema:582-590`).
- Helpers to reuse: `steeringError()` (`api.ts:2310-2322`), `steeringJsonError()` (`:691-696`),
  `getSteeringRegistry().get(runId, nodeId)`.

## Requirements

- [ ] Route `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`, bodyless, registered via
      `registerOpenApiRoute` in `registerApiRoutes` (`api.ts:2295`).
- [ ] Handler follows the ladder verbatim; on a live handle calls `handle.recordComposerActivity()`
      and returns `{ success:true, sub_state }` echoing the current projected sub-state
      (`idle-after-interrupt` on an idle handle; `generating` if it raced back to generating — a
      no-op re-arm).
- [ ] Identity via `resolveAuthContext`, sharing the exact grant path used by send/interrupt (do
      not add ownership/role checks).
- [ ] OpenAPI request/response schemas in `workflow.schemas.ts` modeled on the interrupt schemas
      (`keepaliveWorkflowNodeResponseSchema` = `{ success, sub_state }`; errors via
      `steeringErrorSchema`).
- [ ] Regenerate `packages/web/src/lib/api.generated.d.ts` (`bun --filter @archon/web
      generate:types` — **requires the dev server running**; start it, regen, stop it). No
      hand-edit of the generated file.

## TDD — Tests Before (`api.workflow-runs.test.ts`)

Reuse fixtures (`makeApp`, `liveInterruptibleSetup`/`idleInterruptibleSetup`, `expectSteeringError`).

1. Actor grant matrix on keepalive: starter → 200, other member → 200, non-owning admin → 200,
   identity-less run (ungated) → 200, unauthenticated (gated) → 401. (Mirror the existing
   "actor ladder matches send" test.)
2. Idle handle → 200 `{ success:true, sub_state:'idle-after-interrupt' }` and the handle records
   activity (spy/assert `recordComposerActivity` invoked once).
3. `generating` handle → 200 `{ success:true, sub_state:'generating' }`, a no-op (does not resolve
   idle, does not fail).
4. Terminal node/closed handle → 409 `node_finished`; detached run / no live handle → 422
   `not_steerable_here`.
5. Unknown run/node → 404; idempotent — repeated keepalive is a safe no-op each time.
6. A rejected keepalive leaves node, queue, and transcript unchanged.

## Refactor

- None to existing routes; keepalive is additive. Extract nothing unless the ladder is already a
  shared helper (reuse `steeringError`).

## TDD — Tests After

- Items 1–6 pass; the OpenAPI spec (`GET /api/openapi.json`) includes the keepalive route and the
  regenerated web types expose it.

## Todo

- [ ] Write route tests (1–6); run — fail.
- [ ] Add schemas in `workflow.schemas.ts`.
- [ ] Add the handler + `createRoute` + `registerOpenApiRoute` in `api.ts`.
- [ ] Start dev server → `bun --filter @archon/web generate:types` → stop server.
- [ ] Green route tests + type-check.

## Success criteria

- [ ] `bun test packages/server/src/routes/api.workflow-runs.test.ts` green.
- [ ] `api.generated.d.ts` contains the keepalive route; `bun --filter @archon/server type-check`
      + `bun --filter @archon/web type-check` clean.

## Regression gate

```
bun test packages/server/src/routes/api.workflow-runs.test.ts
bun --filter @archon/server type-check
bun --filter @archon/web type-check
```

## Risk assessment

- Forgetting the types regen (server must be running) → web can't call the route type-safely;
  make it an explicit step, not an assumed side effect.
- Adding a 403/ownership check would contradict the shipped grant model — do not.

## Security considerations

- Keepalive is in the Send/Interrupt route family: authenticated, no message content, no new
  stored data. It only re-arms an in-memory timer; it cannot resolve idle-await or mutate the
  queue.

## Next steps

Phase 4 wires the docks to call this route (debounced) and to disclose the 30-minute limit.
