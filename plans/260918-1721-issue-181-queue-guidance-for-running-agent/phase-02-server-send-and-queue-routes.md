---
phase: 2
title: 'Server: typed send route'
status: pending
priority: P1
dependencies: [1]
---

# Phase 2: Server typed send route

## Outcome

The API implements the already-ratified `POST /api/workflows/runs/:runId/nodes/:nodeId/send` contract. It authorizes the steering actor, validates without altering operator prose, resolves the actual run/node state, and synchronously enqueues on the Phase 1 live handle. Every rejection uses the contract's nested error shape and leaves run, queue, and transcript state unchanged.

There is no queue GET endpoint in this phase. The canonical route table has none, and shared queue projection is Story 2.9.

## Files

| File                                                     | Change                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | Add send body, success, and steering error schemas/types.                |
| `packages/server/src/routes/openapi-defaults.ts`         | Add a route-scoped validation hook for the nested steering error body.   |
| `packages/server/src/routes/api.ts`                      | Add steering authorization/target helpers and one OpenAPI route.         |
| `packages/server/src/routes/api.workflow-runs.test.ts`   | Add actor, validation, target, race, idempotency, and no-mutation cases. |
| `packages/web/src/lib/api.generated.d.ts`                | Regenerate after the route is complete.                                  |

Do not edit `steering-api-contract.md`; implementation must conform to it.

## Schemas and OpenAPI

Import `z` from `@hono/zod-openapi` and derive TypeScript types with `z.infer`.

- `sendWorkflowNodeBodySchema`: strict object with:
  - `message`: string refined so `message.trim().length > 0`, but **not transformed**; the original leading/trailing characters are delivered verbatim;
  - `message_id`: UUID string;
  - `intent`: enum `queue | send_now`.
- `sendWorkflowNodeResponseSchema`: strict `{ success: literal(true), message_id: string UUID, state: enum('queued', 'awaiting_send_now') }`.
- `steeringErrorSchema`: strict `{ success: literal(false), error: { code: string, message: string } }`.

Register with `registerOpenApiRoute(createRoute({...}), handler, steeringValidationErrorHook)`. Document JSON responses for 200, 400, 401, 403, 404, 409, and 422 using the exact schema. The route-scoped hook maps malformed JSON, missing fields, unknown strict keys, blank-only text, invalid UUID, and invalid intent to:

```json
{ "success": false, "error": { "code": "invalid_request", "message": "..." } }
```

Do not change the global flat `apiError`, `errorSchema`, or validation hook used by existing routes.

## Authorization

Put the steering auth middleware before OpenAPI body validation so an unauthenticated gated caller receives 401 even with a malformed body.

Implement the actor grant exactly as the canonical contract and Story 2.1 specify:

- any resolved identity is allowed, regardless of member/admin role or run ownership;
- no resolved identity is rejected when web auth or the API gate requires identity;
- the supported solo/identity-less case is allowed with `operatorUserId: null` only for the identity-less installation/run shape already used by adjacent workflow interaction routes;
- do not change retry, cancel, approve, reject, or AskHuman authorization.

Use `resolveAuthContext` and existing auth predicates/helpers. Do not introduce a new role system or infer identity from request prose.

## Target resolution and mutation order

The handler order is a correctness requirement:

1. Auth middleware/actor resolution (401/403).
2. OpenAPI validation (400).
3. Load the workflow run (unknown run → 404).
4. Project effective node state from workflow events and inspect the registry handle to establish the target:
   - no projected node and no handle → 404;
   - terminal run or terminal effective node → 409 `node_finished`, even if a stale live handle exists;
   - closed handle → 409 `node_finished`;
   - projected non-terminal node with no handle → 422 `not_steerable_here` (detached process or unsupported provider);
   - parked handle/new message → 422 `not_steerable_here`;
   - live handle → eligible for enqueue.
5. Re-read the run status immediately before mutation. A concurrent Cancel/abandon/terminal transition wins and returns 409. After this final read, perform no `await` before handle selection and enqueue.
6. Construct one internal message with the original request text, caller id, resolved operator id or null, and server receipt time.
7. Call `enqueue` synchronously and translate the result.

After run/node terminal checks, a duplicate accepted id may replay its original 200 receipt through the handle even if the handle has since parked; it causes no mutation. A terminal run/node still returns 409. A duplicate with different text never overwrites the first message; emit at most a content-free warning containing run/node/message ids.

For Story 2.1, a live generating handle returns `state: 'queued'` for `intent: 'queue'`. The schema retains `send_now` because it is already public; before Story 2.3 introduces idle-after-interrupt, `send_now` on a generating live handle is also enqueued and returns `queued`. Do not synthesize `awaiting_send_now` without that engine state.

Use the handle phase/result to close the final race. Do not “repair” or unregister a stale handle in a rejected request: the contract requires rejected requests to leave the queue unchanged, and executor lifecycle cleanup owns the registry.

## Error mapping

Use stable codes from the contract and concise messages. Never classify by matching the message text.

| Status | Code                 | Trigger                                                                                       |
| ------ | -------------------- | --------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`    | JSON/schema failure only.                                                                     |
| 401    | `unauthenticated`    | Identity required but absent.                                                                 |
| 403    | `forbidden`          | Only if the existing auth layer produces a genuine forbidden outcome.                         |
| 404    | `not_found`          | Unknown run or node.                                                                          |
| 409    | `node_finished`      | Terminal run/node or synchronously closed handle.                                             |
| 422    | `not_steerable_here` | Known non-terminal target with no reachable live handle or a parked handle for a new message. |

Never echo or log operator message content in an error. No server branch writes a transcript row or workflow event in Story 2.1.

## Tests first

Add self-contained cases using the existing route-test setup and registry reset. Avoid new `mock.module` pollution.

### Actor and validation matrix

- run starter, another authenticated member, and admin all receive 200 on a live handle;
- identity-less install/run receives 200 and the queued item's actor is null;
- gated unauthenticated caller receives 401 before malformed-body 400;
- blank-only message, missing/extra keys, malformed JSON, invalid UUID, and invalid intent receive 400 nested steering errors;
- validation preserves non-blank original whitespace in the queued message.

### Target/status matrix

- unknown run and unknown node → 404;
- terminal run, completed/failed/skipped node, and closed handle → 409;
- known running node with no handle (detached) → 422;
- parked AskHuman handle/new id → 422;
- live handle → 200 with the canonical body and one queued internal item;
- `send_now` on a live generating handle → 200 `queued` without inventing idle state.

### Idempotency and races

- three distinct sends are stored in handler receipt order;
- same id twice before drain and after drain replays exactly the first body and adds no item;
- same id with different prose leaves the original queued text untouched and returns the original receipt;
- a duplicate accepted id can replay while the non-terminal handle is parked;
- terminal projection wins over a stale handle and returns 409;
- a run that becomes terminal between the initial lookup and final status re-read returns 409 without enqueue;
- a handle closed before synchronous enqueue maps to 409 rather than a successful lost receipt.

### No-mutation assertions

For every 400/401/403/404/409/422 case, snapshot the handle before/after and assert equality; assert no transcript/event writer was called and run/node status did not change. This proves the story's negative acceptance criterion rather than merely checking HTTP codes.

## Generated client types

After server tests and type checking pass:

1. Check whether port 3090 already has an owner. Do not start a duplicate or choose a random port.
2. If this worktree needs a server, start the documented server command in a tracked session and record its PID/port/worktree.
3. Run `bun --filter @archon/web generate:types`.
4. Stop exactly the server process started for this task.
5. Verify generated components include the send body, response, and steering error schemas and **do not** contain a newly invented queue-read response.

## Verification

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'queued guidance')
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/server && bun run type-check)
bun x eslint packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/openapi-defaults.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts --max-warnings 0
(cd packages/web && bun run type-check)
```

## Exit criteria

- The OpenAPI document, runtime validation, generated types, and route tests agree on one POST contract.
- Every canonical actor/status/idempotency case is proven, including state immutability on rejection.
- No GET queue route, undocumented cap, transcript write, workflow event, or unrelated authorization change appears in the diff.
