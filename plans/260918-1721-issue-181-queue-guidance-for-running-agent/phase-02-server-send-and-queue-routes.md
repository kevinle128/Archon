---
phase: 2
title: 'Server: typed send and queue routes'
status: pending
priority: P1
effort: '5h'
dependencies: [1]
---

# Phase 2: Server: typed send and queue routes

## Outcome

Two typed routes exist and are in the OpenAPI spec: `POST /api/workflows/runs/{runId}/nodes/{nodeId}/send` (contract request/response/error shapes, actor grant, 401→400→404→409/422 ordering, idempotent duplicate) and `GET /api/workflows/runs/{runId}/nodes/{nodeId}/queue` (the read path the dock polls). `packages/web/src/lib/api.generated.d.ts` is regenerated and committed. Every rejected request is proven to leave the node, the queue, and the transcript unchanged.

Cook-time scout: re-read `packages/server/src/routes/api.ts` around `retryWorkflowNodeRoute`, `answerAskHumanRoute`, and the `app.use('/api/workflows/runs/:runId/ask/:requestId/answer', …)` middleware; confirm the Phase 1 registry API before writing schemas.

## Context links

- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` (whole file — this phase implements it minus interrupt/keepalive/withdraw).
- `plans/reports/scout-260919-0007-server-send-route.md` (`registerOpenApiRoute` at `api.ts:4004`, `apiError` at `:2115`, `resolveAuthContext` at `:2232`, `authorizeWorkflowNodeRetry` at `:3064`, ask-answer middleware at `:4981`, node-state projection at `:185-251` and `packages/workflows/src/retry-state.ts:92`).
- `packages/server/src/routes/openapi-defaults.ts:21-47` (route-scoped hook precedent).
- `packages/server/src/routes/api.workflow-runs.test.ts` (auth header pattern `X-Archon-User`, run/event mocks).

## Schemas (`packages/server/src/routes/schemas/workflow.schemas.ts`)

```ts
export const steeringNodeParamsSchema = z.object({ runId: z.string().min(1), nodeId: z.string().min(1) }).openapi('SteeringNodeParams');
export const sendWorkflowNodeBodySchema = z.object({
  message: z.string().min(1).max(16_000), // bounded: the registry is process-wide memory
  message_id: z.string().uuid(),
  intent: z.enum(['queue', 'send_now']),
}).strict().openapi('SendWorkflowNodeBody');
export const sendWorkflowNodeResponseSchema = z.object({
  success: z.literal(true),
  message_id: z.string().uuid(),
  state: z.enum(['queued', 'awaiting_send_now']),
}).openapi('SendWorkflowNodeResponse');
export const steeringErrorCodeSchema = z.enum(['unauthenticated', 'forbidden', 'invalid_request', 'not_found', 'node_finished', 'not_steerable_here']);
export const steeringErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: steeringErrorCodeSchema, message: z.string() }),
}).openapi('SteeringError');
export const queuedOperatorMessageSchema = z.object({
  message_id: z.string().uuid(),
  message: z.string(),
  operator_user_id: z.string().nullable(),
  received_at: z.string(),
}).openapi('QueuedOperatorMessage');
export const workflowNodeQueueResponseSchema = z.object({
  steerable: z.boolean(),
  queued: z.array(queuedOperatorMessageSchema),
}).openapi('WorkflowNodeQueueResponse');
```

Types derive with `z.infer`; `TRIGGER`-style constants are derived from `.options`, never duplicated. In 2.1 the response `state` is always `queued` (there is no `idle-after-interrupt` sub-state yet); `send_now` is accepted by the schema and treated as `queue` so the contract enum is stable for Story 2.3, which adds the `awaiting_send_now` branch.

## Helpers (`api.ts`)

- `steeringError(c, status: 400|401|403|404|409|422, code: SteeringErrorCode, message: string)` returning `{ success: false, error: { code, message } }`. Do **not** change `apiError`.
- `steeringValidationErrorHook` in `openapi-defaults.ts`: on Zod failure returns `steeringError`-shaped `400 invalid_request` with `formatSafeZodIssueDetail` as the message (never echo message bodies).
- `authorizeSteering(c): Promise<{ operatorUserId: string | null } | { error: Response }>` implementing D9: identity → allow; none with `isWebAuthEnabled() || isApiGateEnabled()` → `401 unauthenticated`; none otherwise → allow with `null`. Reused by both routes and, later, by interrupt/keepalive/withdraw.
- `resolveSteeringTarget(runId, nodeId)`: registry-first, then DB:
  1. `handle = getSteeringRegistry().get(runId, nodeId)`; if `handle.phase === 'live'` → `{ kind: 'live', handle }`; if `handle.phase === 'closed'` → `{ kind: 'finished' }` **without a DB read** — the handle was sealed at the node's final boundary and `node_completed` may not be written yet, so the event projection would still say `running`; this branch is what makes the contract's "last gate" (D3) reachable at the route layer. <!-- Updated: advisor review -->
  2. `run = workflowDb.getWorkflowRun(runId)`; missing → `{ kind: 'not_found' }`.
  3. `events = workflowEventDb.listWorkflowEvents(runId)`, `pending = listPendingInteractions(runId)`, `state = projectLatestEffectiveNodeStates(events, pending).get(nodeId)?.state`, settled against `run.status` the way `settleApiWorkflowNodeStatesForRunStatus` does.
  4. no state and no handle → `{ kind: 'not_found' }` (unknown node id for this run).
  5. terminal (`completed`/`failed`/`skipped`, or the run itself terminal) → if a parked handle exists, `unregister` it (D7 reconciliation) → `{ kind: 'finished' }`.
  6. otherwise (`pending`/`running`/`awaiting` with no live handle, including a parked handle) → `{ kind: 'not_steerable_here' }`.

## Routes

`POST …/send`:

1. `app.use('/api/workflows/runs/:runId/nodes/:nodeId/send', …)` — POST only — runs `authorizeSteering` and returns its 401 **before** OpenAPI validation (401 precedes 400, D8).
2. `registerOpenApiRoute(sendWorkflowNodeRoute, handler, steeringValidationErrorHook)`; the route declares 200 and 400/401/403/404/409/422 with `steeringErrorSchema` (first real 422 in the file).
3. Handler: `authorizeSteering` again (defence in depth, mirrors ask-answer) → `resolveSteeringTarget` → `not_found` 404 / `finished` 409 `node_finished` / `not_steerable_here` 422 → `handle.enqueue({ message_id, message, operator_user_id, received_at: new Date().toISOString() })`:
   - `{ ok: true }` (new or duplicate) → `200 { success: true, message_id, state: 'queued' }`. A duplicate whose `message` text differs from the queued original is a client bug: still replay the receipt (contract), but log `steering.send_duplicate_mismatch` at `warn`.
   - `{ ok: false, reason: 'closed' }` → `409 node_finished` (last gate).
   - `{ ok: false, reason: 'not_live' }` → `422 not_steerable_here`.
   - `{ ok: false, reason: 'queue_full' }` → `400 invalid_request` with message `queue is full (50 pending messages)`.
4. Log `steering.send_accepted` / `steering.send_refused` with `{ runId, nodeId, code, duplicate }` — never the message text.

`GET …/queue`: <!-- Updated: Red Team Session 1 - same actor grant as send; parked queue is visible -->

- Applies the same `authorizeSteering` grant as `send` (the queued text is an operator's undelivered guidance, not a committed transcript row).
- `resolveSteeringTarget` → `not_found` 404; `live` → `{ steerable: true, queued: handle.snapshot().queued }`; **parked** → `{ steerable: false, queued: handle.snapshot().queued }` (the messages survive the ask and must stay visible); `closed` and anything else → `{ steerable: false, queued: [] }` (200). A finished node is `steerable: false`, not 409 — the dock decides what to render from `steerable` plus the node status it already has.

`GET /api/openapi.json` picks both up automatically.

## Tests before (red first)

Add `describe('steering send route', …)` and `describe('steering queue route', …)` to `packages/server/src/routes/api.workflow-runs.test.ts` (same file as the sibling run/node routes; no `package.json` change). Before writing the `mock.module('@archon/core/db/workflows', …)` factory, `grep -n '^export' packages/core/src/db/workflows.ts` and mirror every export — an omitted export silently un-mocks. Use `createSteeringRegistry()`-style isolation by calling `getSteeringRegistry().clear()` in `beforeEach`, and seed a live handle with `getSteeringRegistry().register(runId, nodeId)`.

Send route cases (assert status, body shape, and that `handle.snapshot()` and the mocked transcript/event writers are untouched on every rejection):

- 401 `unauthenticated` when web auth is enabled and no identity (mock `isWebAuthEnabled` true), returned even for a malformed body (ordering).
- 200 on a solo install with no identity; `operator_user_id` is `null` in the snapshot.
- 200 for a starter identity, another member identity, and an admin identity (three `X-Archon-User` values) on a run whose `user_id` is a fourth user — all allowed.
- 400 `invalid_request` for: empty `message`, non-uuid `message_id`, unknown `intent`, extra key (`.strict()`); body is the steering error shape, not `{ error }`.
- 404 `not_found` for an unknown run; 404 for a node id with no projected state and no handle.
- 409 `node_finished` for a node projected `completed`/`failed`/`skipped`, and for a run whose status is terminal.
- 409 `node_finished` when the handle is `closed` (register, `drainOrClose()` on empty, then send) — with the run mock still reporting the node as `running`, proving the registry branch answers before the projection.
- 422 `not_steerable_here` for a running node with no handle (detached), and for a parked handle.
- 200 `queued` for a live handle; queue length 1; `received_at` ISO.
- duplicate `message_id` → second call 200 with the same body; queue length still 1.
- `intent: 'send_now'` on a live node → 200 `state: 'queued'`.
- receipt order: three sends → `snapshot().queued` ids in call order.

- 400 `invalid_request` when the message exceeds 16 000 characters, and when the handle reports `queue_full` (51st pending message); the queue is unchanged.

Queue route cases: 401 under the same grant rule as send; 404 unknown run; `{ steerable: true, queued: [...] }` for a live handle in receipt order; `{ steerable: false, queued: [m1, m2] }` for a parked handle (messages visible, not sendable); `{ steerable: false, queued: [] }` for detached-running and finished nodes; finished node with a stale parked handle → the handle is unregistered.

## Refactor (protected changes)

- No change to `apiError`, `errorSchema`, `jsonError`, `validationErrorHook`, or any existing route.
- `resolveSteeringTarget` is a plain function in `api.ts` next to `authorizeWorkflowNodeRetry`; no new module unless it exceeds one screen.

## Tests after

- Regenerate types: `PORT=3090 bun run dev:server` in this worktree (record the PID), `bun --filter @archon/web generate:types`, stop the server by that PID; commit `api.generated.d.ts`. Confirm `components['schemas']['SendWorkflowNodeBody' | 'SendWorkflowNodeResponse' | 'SteeringError' | 'WorkflowNodeQueueResponse']` exist.
- `packages/server` type-check and lint clean.

## Regression gate

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/server && bun run type-check && bun run lint)
```

## Test scenario matrix

| Path | Priority | Case |
|------|----------|------|
| Actor grant | Critical | starter / member / admin / solo allowed; gated no-identity 401 |
| Ordering | Critical | 401 before 400; 404 before 409/422 |
| Last gate | Critical | closed handle → 409 |
| Idempotency | High | duplicate replays, no second entry |
| Detached | High | running, no handle → 422 |
| Read path | High | queue snapshot order; steerable flags |
| Validation | Medium | four 400 shapes |

## Todo

- [ ] schemas + hook + helpers
- [ ] send route red → green
- [ ] queue route red → green
- [ ] regenerate and commit `api.generated.d.ts`
- [ ] contract doc: add `GET …/queue` to `steering-api-contract.md` (Routes table + Response schemas)

## Success criteria

Every row of the contract's status table has a passing test; the OpenAPI spec contains both routes; the generated web types compile.

## Risk assessment

- **Mock drift** in the 6k-line test file: keep new describe blocks self-contained with their own `beforeEach` resets.
- **Projection cost** on the miss path: one events query per refused send or per `GET …/queue` miss. The dock (Phase 3) backs its poll off to 3000 ms once `steerable: false` is observed, so a room open on a detached node costs one projection every three seconds rather than every second.

## Security considerations

- Steering broadens the HITL grant for these two routes only (owner-ratified); retry/cancel/approve are untouched.
- Never log or echo `message` text; `operator_user_id` only.
- The route is under `/api/*`, so the global gate applies when web auth is on.

## Next steps

Phase 3 imports the regenerated types and calls both routes.
