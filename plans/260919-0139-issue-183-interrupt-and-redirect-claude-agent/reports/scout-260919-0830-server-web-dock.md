# Scout report — Issue #183, Story 2.3 "Interrupt and redirect a running Claude agent"

> **Historical navigation only.** This pre-review scout is not implementation
> authority. Its assumptions, recommendations, validation questions, and line
> anchors were independently rechecked and are superseded by the revised
> `../plan.md` and phase files. Use this report only to locate source areas.

Read-only scout of the server and web layers to prepare an implementation plan. All anchors
are relative to the worktree root
`/Volumes/WD_BLACK/archon/workspaces/anhle128/Archon/worktrees/archon/thread-dffdf57a`.

Confirmed up front: no interrupt route, no `sub_state` field, and no registry-derived join into
`GET /api/workflows/runs/:runId` exist anywhere in the tree today. `grep` for
`idle-after-interrupt` and `nodes/:nodeId/interrupt` only turns up forward-looking prose
(`packages/server/src/routes/api.ts:1583`, `:5275`; `packages/server/src/routes/schemas/workflow.schemas.ts:532,551`)
and the generated OpenAPI description string
(`packages/web/src/lib/api.generated.d.ts:2555`). The spec at
`_bmad-output/specs/spec-agent-node-room/steering-api-contract.md:15,23,33-34,60-62` gives the
exact interrupt contract this plan must implement: `POST .../interrupt` takes `{}` (no body) and
returns `{ success: true, sub_state: 'idle-after-interrupt' | 'generating' }`, or `409
node_finished` when the turn ended naturally with an empty queue; a repeat interrupt while
already `idle-after-interrupt` is an idempotent no-op returning the current `sub_state`. The same
file also names two further routes (`.../keepalive`, `DELETE .../queue/:messageId`) that are
outside this story's stated scope but live in the same contract doc — flagging them so the plan
doesn't have to rediscover them later.

---

## 1. Server: send route flow, test harness, GET run, SSE

### 1.1 `sendWorkflowNodeRoute` — OpenAPI config

`packages/server/src/routes/api.ts:1575-1607` (`createRoute` config, module scope, before
`registerApiRoutes`):

```ts
const sendWorkflowNodeRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/send',
  ...
  responses: {
    200: { content: { 'application/json': { schema: sendWorkflowNodeResponseSchema } }, ... },
    400: steeringJsonError('Malformed or schema-invalid payload'),
    401: steeringJsonError('Authentication required'),
    403: steeringJsonError('Forbidden'),
    404: steeringJsonError('Unknown run or node'),
    409: steeringJsonError('Node no longer running'),
    422: steeringJsonError('No live steering session in this process'),
  },
});
```

An `interrupt` route mirrors this shape exactly: same `steeringJsonError(...)` entries for
400/401/403/404/409/422 (409 becomes the `node_finished` "turn ended naturally with empty queue"
case per the contract doc), a 200 with a new `interruptWorkflowNodeResponseSchema` (`{ success:
true, sub_state: 'idle-after-interrupt' | 'generating' }`), and `request.body` **omitted**
entirely (no-body POST) rather than `required: true`.

`steeringJsonError` helper — `packages/server/src/routes/api.ts:653-663`:

```ts
function steeringJsonError(description: string): {
  content: { 'application/json': { schema: typeof steeringErrorSchema } };
  description: string;
} {
  return { content: { 'application/json': { schema: steeringErrorSchema } }, description };
}
```

### 1.2 `steeringError` runtime helper (inside `registerApiRoutes`)

`packages/server/src/routes/api.ts:2183-2192`:

```ts
function steeringError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
  code: string,
  message: string
): Response {
  return c.json({ success: false as const, error: { code, message } }, status);
}
```

Reused verbatim by an interrupt handler for every refusal.

### 1.3 `steeringValidationErrorHook` (openapi-defaults.ts)

`packages/server/src/routes/openapi-defaults.ts:59-75`: formats Zod validation failures into the
nested `{ success: false, error: { code: 'invalid_request', message } }` shape. Since interrupt
has no request body, this hook is still worth passing to `registerOpenApiRoute` for parity/params
validation failures (e.g. a malformed `runId`/`nodeId` path segment), matching how `send` wires it
at `packages/server/src/routes/api.ts:5289` (see 1.5 below).

### 1.4 `registerOpenApiRoute` helper

`packages/server/src/routes/api.ts:4077-4090` (defined inside `registerApiRoutes`, used for every
route including `send`):

```ts
function registerOpenApiRoute(
  route: ReturnType<typeof createRoute>,
  handler: (c: Context) => Response | Promise<Response>,
  hook?: typeof workflowEnvValidationErrorHook
): void {
  if (hook) {
    app.openapi(route, handler as never, hook);
    return;
  }
  app.openapi(route, handler as never);
}
```

### 1.5 Full `send` handler flow (mirror target for `interrupt`)

`packages/server/src/routes/api.ts:5173-5289`. Key structure, in order:

1. **Pre-route `app.use` middleware** (`:5179-5194`) runs auth resolution _before_ Hono's own
   body validator, so an unauthenticated gated caller gets 401 even on a malformed body:

   ```ts
   app.use('/api/workflows/runs/:runId/nodes/:nodeId/send', async (c, next) => {
     if (c.req.method !== 'POST') return next();
     if (isWebAuthEnabled() || isApiGateEnabled()) {
       const requester = await resolveAuthContext(c);
       if (!requester) return steeringError(c, 401, 'unauthenticated', 'Authentication required');
     }
     const contentType = c.req.header('Content-Type');
     if (contentType !== undefined && /^application\/([a-z-.]+\+)?json/i.test(contentType)) {
       try {
         await c.req.json();
       } catch {
         return steeringError(c, 400, 'invalid_request', 'Malformed request body');
       }
     }
     return next();
   });
   ```

   An interrupt route with no body can drop the JSON pre-parse block but must keep the identical
   auth-before-validation ordering if it registers its own `app.use` guard, OR it can skip the
   guard entirely and rely on `resolveAuthContext` inside the handler (see next) — there is no
   body to malform, so the only reason `send` needs the pre-route middleware is the malformed-JSON
   race; interrupt likely does not need one.

2. **Handler body** (`:5199-5287`), registered via
   `registerOpenApiRoute(sendWorkflowNodeRoute, async c => {...}, steeringValidationErrorHook)`:
   - Re-resolves `resolveAuthContext(c)` and re-checks the gate (`:5203-5206`) — belt-and-braces
     against the middleware.
   - `getValidatedBody(c, sendWorkflowNodeBodySchema)` (`:5207`) — N/A for interrupt (no body).
   - `workflowDb.getWorkflowRun(runId)` → 404 `not_found` if absent (`:5209-5212`).
   - Builds the **effective node-state projection**: `workflowEventDb.listWorkflowEvents(runId)` - `workflowPendingInteractionDb.listPendingInteractions(runId)` →
     `projectApiWorkflowNodeStates(events, pendingInteractions).find(state => state.nodeId ===
nodeId)` (`:5214-5221`).
   - `const handle = getSteeringRegistry().get(runId, nodeId)` (`:5222`) — the process-local
     handle is the interrupt target too.
   - Lifecycle gates in order (`:5224-5241`): 404 if neither projection nor handle exist; 409
     `node_finished` if the run is in `TERMINAL_WORKFLOW_STATUSES`; 409 `node_finished` if the
     node's projected status is in `TERMINAL_API_NODE_STATUSES`; 409 `node_finished` if
     `handle?.snapshot().phase === 'closed'`; 422 `not_steerable_here` if `handle === undefined`
     (live projection but no in-process handle — detached/other-process run).
   - **Final race gate** (`:5243-5251`): re-reads `workflowDb.getWorkflowRun(runId)` right before
     the synchronous mutation and re-checks terminal status — "a concurrent terminal transition
     wins" because `enqueue()` (the mutation) is synchronous with no intervening `await`.
   - Mutation: `handle.enqueue({...})` (`:5253-5259`), maps `EnqueueResult.ok === false` to 409 or
     422 (`:5260-5266`), else 200 with `{ success: true, message_id, state: 'queued' }`
     (`:5267-5275`, comment notes `send_now` synthesizes `awaiting_send_now` only once
     idle-after-interrupt exists — not yet implemented).
   - `catch` wraps everything → `getLog().error(...)` + 500 `internal_error` (`:5285-5287`).

An `interrupt` handler follows the same skeleton through the 404/409/422 gates, then instead of
`enqueue()` calls a new registry method (not present today — see 1.6) that ends the live turn and
reports the resulting `sub_state`.

### 1.6 Steering registry — no interrupt/abort primitive exists yet

`packages/workflows/src/steering-registry.ts` (250 lines) currently exposes only `enqueue`,
`pendingCount`, `closeIfEmpty`, `drain`, `park`, `resume`, `close`, `snapshot`, `discard` on
`NodeSteeringHandle`, and `register`/`get`/`unregister`/`discardRun`/`clearForTests` on
`SteeringRegistry` (singleton via `getSteeringRegistry()` at `:236-241`, isolated instances via
`createSteeringRegistry()` at `:245-247`). There is **no** `interrupt()`/`abort()` method and no
`AbortController`/`AbortSignal` plumbing anywhere in this file. The DAG executor
(`packages/workflows/src/dag-executor.ts`) only calls `register` (`:3002`, `:5673`),
`closeIfEmpty`/`drain` at natural turn boundaries (`:3337-3352`, `:6883-6907`), `park`
(`:3446`, `:6464`, `:7041`), and `unregister` (`:3567`, `:5370`) — the natural-boundary gate at
`:3330-3353` is fully synchronous by design ("no route-side enqueue can land between the empty
check, the session-id decision, and the drain"); an idle timeout explicitly does _not_ go through
this path ("An idle timeout is NOT a natural boundary"). This confirms the interrupt mechanism —
whatever actually stops a live provider turn — is genuinely new work, not a route wired to
existing plumbing; it is provider/executor scope (see the `scout-provider`/`scout-executor`
threads in this session) and out of this report's server/web focus, but the server route's only
job is to call into it and translate the result to `sub_state`.

### 1.7 Test harness — `api.workflow-runs.test.ts`

`packages/server/src/routes/api.workflow-runs.test.ts` (6659 lines).

- **App construction** — `makeApp()` at `:842-857`:

  ```ts
  function makeApp(): { app: OpenAPIHono; mockWebAdapter: WebAdapter } {
    const app = new OpenAPIHono({ defaultHook: validationErrorHook });
    const mockWebAdapter = { setConversationDbId: mock(...), emitSSE: mock(...), emitLockEvent: mock(...) } as unknown as WebAdapter;
    const mockLockManager = { acquireLock: mock(...), getStats: mock(...) } as unknown as ConversationLockManager;
    registerApiRoutes(app, mockWebAdapter, mockLockManager);
    return { app, mockWebAdapter };
  }
  ```

  Every describe block calls `makeApp()` fresh per test (not shared across tests).

- **Registry seeding** — the real singleton is used, not mocked. `getSteeringRegistry` is
  imported directly at `:750` (`import { getSteeringRegistry } from
'@archon/workflows/steering-registry';`) and `:752-754` imports `NodeSteeringHandle`,
  `SteeringHandleSnapshot` types. `@archon/workflows/steering-registry` does **not** appear in any
  `mock.module(...)` call in this file — confirmed by grep. `beforeEach` in the send describe
  block calls `getSteeringRegistry().clearForTests()` (`:6215`) to reset registry state between
  tests, and individual tests call `getSteeringRegistry().register(runId, nodeId)` directly to
  seed a live handle (`liveSetup()` helper, `:6226-6230`).

- **`mock.module` factories touching adjacent modules** (none touch steering-registry itself):
  `@archon/core/db/workflows` at `:329-341` mocks `getWorkflowRun`, `updateWorkflowRun`, etc.
  (used by the send/interrupt handler's `workflowDb.getWorkflowRun` calls); `@archon/core/db/workflow-events`
  at `:347-351` mocks `listWorkflowEvents`/`createWorkflowEvent`; the pending-interactions mock
  (`mockListPendingInteractions`) backs `workflowPendingInteractionDb.listPendingInteractions`.
  `@archon/workflows/executor` is mocked at `:413-416` (unrelated to steering — the dispatch path).

- **Send describe block** — `describe('POST /api/workflows/runs/:runId/nodes/:nodeId/send —
queued guidance', ...)` at `:6213-6659`. Helpers: `STEER_RUN_ID`/`STEER_NODE_ID`/
  `STEER_STARTER_ID`/`STEER_MESSAGE_ID*` constants (`:6162-6167`), `mockSteerableRun(overrides)`
  (`:6169-6176`, a running run with `user_id: STEER_STARTER_ID`), `steerEvent(eventType, nodeId)`
  (`:6178-6187`, builds a `node_started`/`node_completed`/etc mock event), `sendPayload(overrides)`
  (`:6190-6197`), `postNodeSend(app, body, headers, runId, nodeId)` (`:6199-6210`, raw
  `app.request(...)` fetch), `liveSetup(nodeId)` (`:6226-6230`, seeds a running run + `node_started`
  projection + registers a live handle), `expectNoSteeringMutation(handle, before)`
  (`:6233-6242`, asserts snapshot unchanged and no DB writes happened), `expectSteeringError(res,
status, code)` (`:6244-6252`).

- **Actor-ladder tests** ("Actor matrix" section, `:6259-6338`): run starter (`X-Archon-User:
STEER_STARTER_ID`) → 200, operator id recorded; another authenticated member identity
  (mocked via `mockFindOrCreateUserByPlatformIdentity.mockImplementationOnce`) → 200; an admin
  identity that does **not** own the run → 200 (steering's actor grant is broader than
  ownership — "any authenticated identity may call these routes", confirmed by the contract doc
  at `steering-api-contract.md:8`); no identity on an identity-less install → 200 with
  `operatorUserId: null`; a gated unauthenticated caller with malformed JSON → nested 401 (proves
  401 wins over 400, using `getAuth()` + temporarily setting `DATABASE_URL`/`BETTER_AUTH_SECRET`/
  `ARCHON_WEB_AUTH_REQUIRED=false` so the route-scoped middleware, not the global gate, decides —
  `:6321-6338`). An interrupt test suite should reuse this exact actor matrix (same grant, same
  identity resolution) since the contract doc states interrupt shares AD-11's broadened actor
  grant.

- **Lifecycle/target-matrix tests** (`:6423-6499`): 404 unknown run/node (handle never created),
  409 terminal run "even with a stale live handle", 409 for each terminal node state
  (`node_completed`/`node_failed`/`node_skipped`) "even with a stale live handle", 409 closed
  handle, 422 running node with no handle ("detached"), 422 parked AskHuman handle. These map
  1:1 onto interrupt's own gate ladder — a `park()`ed handle (AskHuman) is a case worth deciding
  explicitly for interrupt (contract doc doesn't mention park explicitly; the existing send tests
  treat a parked handle as 422 `not_steerable_here`, and interrupt likely inherits the same rule
  since there's no live turn to end).

- **Idempotency/race tests** (`:6540-6659`): duplicate `message_id` replay before/after drain,
  changed-prose duplicate keeps original text, duplicate while parked, run turning terminal
  between lookup and final re-read (409, `mockGetWorkflowRun.mockResolvedValueOnce(...).mockResolvedValueOnce(...)`),
  handle closing between inspection and enqueue (409). The contract doc's "repeated interrupt
  while already idle-after-interrupt → idempotent no-op" needs an equivalent test using a fresh
  `handle.<interrupt method>()` idempotency check, not `enqueue`'s `messageId`-keyed map (interrupt
  has no caller-supplied id to key on — idempotency has to be state-based: calling interrupt twice
  in a row on the same handle just re-reports the current `sub_state`).

### 1.8 `GET /api/workflows/runs/:runId` — how `nodeStates` is built today

`getWorkflowRunRoute` config: `packages/server/src/routes/api.ts:1668-1682`. Handler:
`packages/server/src/routes/api.ts:5538-5619`, registered via
`registerOpenApiRoute(getWorkflowRunRoute, async c => {...})` (no route-scoped hook — uses the
global `validationErrorHook`/`errorSchema`, not the steering nested shape). The response-building
line:

```ts
nodeStates: settleApiWorkflowNodeStatesForRunStatus(
  run.status,
  projectApiWorkflowNodeStates(events, pendingInteractions)
),
```

(`packages/server/src/routes/api.ts:5603-5606`)

`projectApiWorkflowNodeStates` (`packages/server/src/routes/api.ts:190-229`) builds
`ApiWorkflowNodeState[]` (interface at `:152-166`: `nodeId, name, status, retryEpoch, duration?,
error?, reason?, provider?, model?, tier?, modelReasoningEffort?, effort?, thinking?`) **purely
from persisted DB rows** — `events` (`WorkflowEventRow[]` from `workflowEventDb.listWorkflowEvents`)
and `pendingInteractions`. There is **no** call into `getSteeringRegistry()` anywhere in this
handler or in `projectApiWorkflowNodeStates`/`settleApiWorkflowNodeStatesForRunStatus`
(`:243-264`) — confirmed by grep across `api.ts`. This is the exact join point a `steering: {
sub_state }` field needs: per node, call `getSteeringRegistry().get(run.id, nodeId)?.snapshot()`
(or a new accessor) inside (or right after) `projectApiWorkflowNodeStates`, keyed the same way the
send/interrupt routes key their lookup (`(runId, nodeId)`, where `nodeId` is the namespaced
step-name used by transcript routes and loop-group bodies per the steering-registry docblock at
`steering-registry.ts:6`). `ApiWorkflowNodeState` and `workflowNodeStateSchema` (below) both need
a new optional `steering` field for this to reach the wire.

`TERMINAL_API_NODE_STATUSES` (`packages/server/src/routes/api.ts:242`, `['completed', 'failed',
'skipped']`) and `TERMINAL_WORKFLOW_STATUSES` (imported at `:128` from
`packages/workflows/src/schemas/workflow-run.ts:66`, values not re-read here but used at
`api.ts:253`, `:5230`, `:5254`) are the two terminal-status constants both send and interrupt
gate on.

`workflowNodeStateSchema` (wire schema) — `packages/server/src/routes/schemas/workflow.schemas.ts:160-174`
— has no `steering` field today; adding one is a schema change that flows through to
`WorkflowNodeStateResponse` (`packages/web/src/lib/api.ts:700`,
`components['schemas']['WorkflowNodeState']`) once `api.generated.d.ts` regenerates.

### 1.9 SSE — how live node-state changes reach the web today

There is **no dedicated SSE event for steering/sub-state**. The dashboard/run SSE stream is built
from `WorkflowEventEmitter` events mapped in
`packages/server/src/adapters/web/workflow-bridge.ts`. The relevant case, `:90-125`, maps
`node_started`/`node_completed`/`node_failed`/`node_skipped`/`node_routed` → a single `dag_node`
JSON payload (`{ type: 'dag_node', runId, nodeId, name, status: 'running'|'completed'|'failed'|'skipped', ... }`).
`grep` for `steering`/`node_send`/`interrupt` inside `workflow-bridge.ts` returns nothing — these
DB-lifecycle events are the only source of `dag_node` SSE pushes, and enqueueing/interrupting a
turn today does **not** persist a `workflow_events` row (the registry is purely in-memory), so no
SSE currently fires when guidance is queued or (once built) when a turn is interrupted. This means
either (a) the web relies entirely on GET-run polling to learn `sub_state` changes (see §3), or
(b) the interrupt/send-now path needs to start persisting/emitting a lifecycle-adjacent event (or
a new SSE case) so `dag_node`-driven cache invalidation in the Console shell (§3) picks it up
promptly instead of waiting for its 30s heartbeat.

---

## 2. Web type regeneration and API helper mirroring

### 2.1 `generate:types` procedure and the worktree port trap

`packages/web/package.json:12`:

```
"generate:types": "openapi-typescript http://localhost:3090/api/openapi.json -o src/lib/api.generated.d.ts"
```

This URL is **hardcoded to port 3090**. Per AGENTS.md, a worktree checkout auto-allocates a
different, deterministic port in the 3190-4089 range — confirmed in
`packages/core/src/utils/port-allocation.ts:36-61` (`getPort()`): if `PORT` env var is unset and
`isWorktreePath(cwd)` is true, the port is `3090 + calculatePortOffset(cwd)`
(`calculatePortOffset`, `:16-26`, md5-hashes the path into a 100-999 offset). Only an explicit
`PORT` env var or running outside a worktree yields 3090. **Procedure in this worktree**:

1. Start the server bound to 3090 explicitly: `PORT=3090 bun run dev:server` (root script at
   `package.json:12`, `"dev:server": "bun --filter @archon/server dev"`) — run this
   `run_in_background: true` / via a tracked background process per the process-management rule,
   NOT the default `bun dev`/`bun run dev` (which would auto-hash a different port and mismatch
   the hardcoded generator URL).
2. Once the server is up, run `bun --filter @archon/web generate:types` from the repo root (or
   `bun run generate:types` from `packages/web/`).
3. Stop the PORT=3090 server process by its recorded PID (process-management rule) — do not leave
   it running as an orphan.

There is no wrapper script that starts/stops the server around `generate:types` — it is a fully
manual two-step (start server, run generator) documented only implicitly via the hardcoded port.

### 2.2 `sendNodeGuidance` in `packages/web/src/lib/api.ts` (Legacy)

`packages/web/src/lib/api.ts:748-780`:

```ts
export type SendWorkflowNodeBody = components['schemas']['SendWorkflowNodeBody'];
export type SendWorkflowNodeResponse = components['schemas']['SendWorkflowNodeResponse'];

export async function sendNodeGuidance(
  runId: string,
  nodeId: string,
  body: SendWorkflowNodeBody
): Promise<SendWorkflowNodeResponse> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/send';
  try {
    return await fetchJSON<SendWorkflowNodeResponse>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw toSteeringSendError(error);
  }
}
```

An `interruptNode(runId, nodeId)` helper mirrors this: no `body` param, no `body:
JSON.stringify(...)` in the `fetchJSON` call (or `body: '{}'` if the transport requires a body on
POST — check `fetchJSON`'s handling of an omitted body for a `Content-Type: application/json`
POST), same `toSteeringSendError(error)` catch-and-rethrow, new
`components['schemas']['InterruptWorkflowNodeResponse']` type alias once the schema/route exists
and types regenerate.

### 2.3 `sendNodeGuidance` in `packages/web/src/experiments/console/skills/runs.ts` (Console)

`packages/web/src/experiments/console/skills/runs.ts:158-180`:

```ts
export type SendWorkflowNodeBody = components['schemas']['SendWorkflowNodeBody'];
export type SendWorkflowNodeResponse = components['schemas']['SendWorkflowNodeResponse'];

export async function sendNodeGuidance(
  runId: string,
  nodeId: string,
  body: SendWorkflowNodeBody
): Promise<SendWorkflowNodeResponse> {
  try {
    return await requestJson<SendWorkflowNodeResponse>(
      `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`,
      { method: 'POST', body: JSON.stringify(body) }
    );
  } catch (error) {
    throw toSteeringSendError(error);
  }
}
```

Uses `requestJson` (console's own HTTP wrapper) instead of `fetchJSON`, but otherwise identical
shape — an `interruptNode` mirror here follows the same pattern as 2.2, using `requestJson` and
dropping the body.

Both files import `toSteeringSendError` from `@/lib/steering-dock` (`api.ts:8`;
`runs.ts:5`) — the shared error-normalization helper (see §4.6) already handles any nested
`{success:false,error:{code,message}}` body regardless of which route produced it, so no new
error-handling code is needed for interrupt, only the new call-site.

---

## 3. Web data flow: how node state and transcript reach the dock

### 3.1 Legacy shell — `NodeTranscriptPane.tsx`

`packages/web/src/components/workflows/NodeTranscriptPane.tsx` is a "query boundary" component
(docblock `:1-3`) that receives `runStatus: WorkflowRunStatus` as a prop (`:81`, `:112`) and
derives `rowStatus` from a `row` prop (`:157`, `row?.status ?? 'completed'`) and `live =
isLiveRunStatus(runStatus)` (`:177`). It does **not** call `getWorkflowRun` itself — `row` and
`runStatus` are passed down from a parent. It does own its own polling for **node-message pages**
(transcript content) via `transcriptRefetchInterval(status)` (`:45-56`): returns `1000` (ms) for
`pending`/`running`/`paused`, `false` (no poll) for terminal statuses. This 1s poll is for
`getWorkflowNodeMessage`-backed transcript pages, not for `nodeStates`/run status itself. It
renders `<ComposerDock runId nodeId nodeLabel rowStatus live={isLiveRunStatus(runStatus)}
hasPendingAsk={...} />` at `:523-531`.

The `row`/`runStatus` props trace up to **`WorkflowExecution.tsx`**, which owns the actual
`GET /api/workflows/runs/:runId` fetch via React Query:
`packages/web/src/components/workflows/WorkflowExecution.tsx:433-445`:

```ts
const { data: queryData, error: queryError } = useQuery({
  queryKey: ['workflowRun', runId],
  queryFn: async (): Promise<WorkflowRunQueryData> => {
    const data = await getWorkflowRun(runId);
    return mapWorkflowRunDetail(data);
  },
  refetchInterval: (query): number | false => {
    const status = query.state.data?.workflowState.status;
    if (status && isTerminal(status)) return false;
    return 3000;
  },
  staleTime: 0,
});
```

**Legacy polls the full run detail (including `nodeStates`) every 3000ms while non-terminal.**
There is no `useWorkflowRun` custom hook — it's an inline `useQuery` in this component. Any
registry-derived `steering.sub_state` field added to `nodeStates` (§1.8) reaches the Legacy dock
on this 3s cadence, or immediately on the local tab that just called `send`/`interrupt` (which can
optimistically update local state without waiting for the next poll, as `ComposerDock` already
does with `dock.sent`).

### 3.2 Console shell — `ConsoleNodeRoom.tsx` / `RunDetailPage.tsx`

`ConsoleNodeRoom.tsx` itself is a presentational component (receives data as props like
`LegacyNodeRoom`). The fetch lives in **`RunDetailPage.tsx`**:
`packages/web/src/experiments/console/routes/RunDetailPage.tsx:198-201`:

```ts
const { data: detail, error: detailError } = useEntity<ConsoleRunDetail | null>(
  runId !== undefined ? K.run(runId) : 'noop:no-run-id',
  () => (runId !== undefined ? skill.getRun(runId) : Promise.resolve(null))
);
```

`skill.getRun` is `packages/web/src/experiments/console/skills/runs.ts:91-111` — a single
`requestJson` call to the same `GET /api/workflows/runs/:runId`, mapping `res.nodeStates` straight
through (`:99`, `nodeStates: res.nodeStates`).

**Console is primarily SSE-driven, not polled.** `useRunStreamSSE(conversationPlatformId, runId ??
null)` (`RunDetailPage.tsx:229`) subscribes to the conversation's SSE stream
(`packages/web/src/experiments/console/lib/sse.ts:91-139`); its `case 'dag_node':` branch (`:136`,
alongside `workflow_tool_activity`/`workflow_step`/`workflow_artifact`/`workflow_dispatch`)
triggers `invalidate(K.run(runId))` (`:115`), which makes `useEntity` refetch `getRun` immediately.
Separately there's a **30-second heartbeat safety net**, explicitly _not_ meant as the primary
update path (`RunDetailPage.tsx:234-249`):

```ts
// SSE-drop safety net: if the stream silently dies ... A 30s heartbeat refetch
// while status is non-terminal catches that without being polling proper —
useEffect(() => {
  if (runId === undefined) return;
  if (status !== 'running' && status !== 'paused') return;
  const id = setInterval(() => {
    invalidate(K.run(runId));
    ...
  }, 30000);
  return () => clearInterval(id);
}, [runId, status, conversationPlatformId]);
```

**This is the key asymmetry for Story 2.3**: since no SSE event fires for steering state today
(§1.9), Console will only learn about an interrupt's `idle-after-interrupt` sub*state (from a
reload or another tab) via the 30s heartbeat unless the interrupt path is made to emit a `dag_node`
(or new) SSE event that the invalidation switch already listens for. The tab that \_made* the
interrupt call gets its `sub_state` from the POST response directly and can update local state
optimistically (same pattern `ComposerDock`/`ConsoleComposerDock` already use for `dock.sent`), so
same-tab UX is unaffected — only reload/other-tab convergence depends on this gap.

`packages/web/src/experiments/console/console-isolation.test.ts:75-77` documents the dashboard SSE
event comment inline too (`workflow_tool_activity / dag_node — workflow_events table grew`).

---

## 4. Dock anatomy: `ComposerDock.tsx` / `ConsoleComposerDock.tsx`

Both files are near-identical Story 2.1 implementations (251 and 256 lines respectively); the
Console version differs only in importing from `../skills/runs` instead of `@/lib/api` and using
`!` Tailwind important-modifiers for the focus ring (docblock,
`ConsoleComposerDock.tsx:9-12`, explaining why: the console-wide focus ring composites to ~2:1
contrast on dock surfaces, under the 3:1 floor, so the dock overrides with an explicit
accent-bright ring).

### 4.1 Props (`ComposerDockProps` / `ConsoleComposerDockProps`)

`ComposerDock.tsx:46-59`:

```ts
export interface ComposerDockProps {
  runId: string;
  nodeId: string; // namespaced node id — send route segment + draft scope key
  nodeLabel: string; // display label for the field's accessible name
  rowStatus: WorkflowNodeStateResponse['status'];
  live: boolean; // historical runs never steer
  hasPendingAsk: boolean; // this node's pending ask blocks send
  send?: SendNodeGuidance; // injectable for tests, defaults to sendNodeGuidance
  storage?: Storage; // injectable for tests
}
```

`ConsoleComposerDock.tsx:51-64` is byte-identical except `rowStatus: WorkflowNodeState['status']`
(console's own type from `../skills/runs`). A new `interrupt`/`onInterrupt` prop (and a `subState`
prop carrying the projected `generating`/`idle-after-interrupt` value from the parent's
`nodeStates` join) would land here in both files.

### 4.2 Current button/control inventory (Story 2.1 baseline — no Stop yet)

Both files currently render exactly **one** button, `Queue` (`ComposerDock.tsx:227-243`):

```tsx
<button
  type="button"
  aria-label={queueButtonAccessibleName(dock.sent.length)}
  aria-keyshortcuts="Meta+Enter Control+Enter"
  aria-disabled={blocked ? true : undefined}
  aria-describedby={blocked ? reasonId : undefined}
  onClick={submit}
  className={cn(... blocked ? 'text-text-secondary' : 'text-text-primary hover:bg-surface-inset' ...)}
>
  Queue
</button>
```

Note the **`aria-disabled` pattern** (never native `disabled`) already exists here — the exact
pattern the task brief says the new `Stop` button and UI-local `interrupting` state must follow.
This is the precedent to copy: `aria-disabled={blocked ? true : undefined}` plus
`aria-describedby` pointing at a visible reason paragraph, with the click handler itself guarding
via `canSubmitGuidance` before doing anything (`submit()` at `:112-113` no-ops if the guard fails,
rather than relying on the DOM attribute to block the click) — the equivalent for Stop would guard
in the handler against double-invocation instead of trusting `aria-disabled` to be enforced by the
browser.

### 4.3 Queue-band header ("WILL SEND" precedent shape)

`ComposerDock.tsx:157-184`: a `<section aria-labelledby={bandHeaderId}>` with an `<h3>` header
whose text is `queueBandHeader(dock.sent.length)` = `` `queued · ${count}` `` (lowercase DOM text,
CSS applies `uppercase` via `tracking-[0.07em] ... uppercase` class on the `<h3>`, per
`queueBandHeader`'s doc comment in `steering-dock.ts:105-107`: "Lowercase DOM text; the renderer
applies CSS uppercase + phase tracking."). The task's `WILL SEND · n` header for
`idle-after-interrupt` mode is a new sibling string/section following this exact
lowercase-DOM/CSS-uppercase convention — likely a new `steering-dock.ts` helper analogous to
`queueBandHeader`.

### 4.4 Refusal / blocked-reason lines and live regions

- **Refusal** (`role="alert"`): `ComposerDock.tsx:213-217`:
  ```tsx
  {
    dock.refusal === null ? null : (
      <p role="alert" className={REFUSAL_CLASSES}>
        {dock.refusal.message}
      </p>
    );
  }
  ```
- **Detached disclosure** (`role="alert"`, separate early-return branch):
  `ComposerDock.tsx:137-145`.
- **Blocked reason** (plain `<p id={reasonId}>`, no `role`, only referenced via
  `aria-describedby`): `:218-222`.
- **Status live region** (`role="status"`, visually hidden via `sr-only`):
  `ComposerDock.tsx:245-247`:
  ```tsx
  <div role="status" className="sr-only">
    {statusText}
  </div>
  ```
  `statusText` (`:148-153`) is either the blocked reason or `queuedCountPhrase(dock.sent.length)`
  (e.g. "2 messages queued", `steering-dock.ts:101-103`). This is the **only** `aria-live`-style
  region in the current dock (`role="status"` implies `aria-live="polite"` implicitly; there is no
  explicit `aria-live` attribute anywhere in either file — grep confirms). The task's requirement
  for "serialized live-region announcements" across generating → interrupting → idle-after-interrupt
  → generating implies extending this single `role="status"` div's content (or adding a queue of
  pending announcements) rather than adding multiple regions, to avoid overlapping/racing
  announcements — worth flagging as a design decision for the plan phase.

### 4.5 Focus handling (current)

Only one focus call exists today: `fieldRef.current?.focus()` after a successful send
(`ComposerDock.tsx:127`, `ConsoleComposerDock.tsx:132`), returning focus to the textarea. There is
**no** focus-to-last-transcript-row logic in either dock file — that's new work needed for the
"focus moving to the last transcript row (never `<body>`) when the dock changes or is removed"
requirement (see §5.3 for why no row is currently focusable at all).

### 4.6 Tests — `ComposerDock.test.tsx` / `ConsoleComposerDock.test.tsx`

Both begin with `process.env.NODE_ENV = 'development';` as the literal first line
(`ComposerDock.test.tsx:1`) — required because `happy-dom` / React dev-mode act() warnings behave
differently, and the harness explicitly opts into dev mode before any import. Render harness
pattern (`ComposerDock.test.tsx:1-35`): dynamically imports `react`/`react-dom/client`
(`const react = await import('react'); const reactDomClient = await import('react-dom/client');`),
uses `act`/`createElement`/`createRoot` from those dynamic imports, and lazily loads the component
module itself via `loadComposerModule()` (`:20-35`) which conditionally installs a temporary
`happy-dom` window (`installHappyDom()`/`restoreHappyDom()` from
`@/experiments/console/test/install-happy-dom`) only if `globalThis.document` is undefined at
import time — because `@/lib/api` reads `window` at import time, so the module needs _some_ DOM
present for its first import even though the actual test render also needs a fresh DOM per test.
`send` is injected via the `send` prop (type `SendNodeGuidance`, imported from `./ComposerDock`
itself, `ComposerDock.test.tsx:9`) — tests never mock the real `sendNodeGuidance` module, they pass
a local mock/deferred function directly as a prop, exactly mirroring how the component defaults
`send = sendNodeGuidance` but allows override (`ComposerDock.tsx:78`). A `deferred<T>()` helper
(`:44-56`) builds a controllable `{promise, resolve, reject}` triple for testing in-flight states.
`okReceipt(messageId)` (`:60+`) builds a `SendWorkflowNodeResponse` fixture. `SteeringSendError` is
imported directly from `@/lib/steering-dock` (`:8`) to construct/assert refusal shapes in tests.
An `interrupt`-aware test suite for both dock files should follow this exact harness (NODE_ENV
line, dynamic react imports, `loadComposerModule`-style lazy import, `deferred()`, an injected
`interrupt`/`send` prop pair) rather than inventing a new render setup.

### 4.7 `console-isolation.test.ts` positive-list rule for Console components

`packages/web/src/experiments/console/console-isolation.test.ts:102-155`,
test `'run-room files import approved shared lib modules and no Legacy components'`. It enumerates
a fixed `roomFiles` array (including `components/ConsoleComposerDock.tsx`,
`components/ConsoleNodeRoom.tsx`, `routes/RunDetailPage.tsx`, etc., `:104-113`) and an `approved`
`Set` of `@/lib/*` import specifiers those files may use (`:114-131`), which **already includes
`'@/lib/steering-dock'`** (`:130`) and `'@/lib/api.generated'` (`:129`, type-only enforced
separately by the first test at `:82-100`). Any interrupt-related helper added to
`packages/web/src/lib/steering-dock.ts` is automatically usable by `ConsoleComposerDock.tsx`
without touching this allowlist. A **new** shared lib file (e.g. a hypothetical
`interrupt-dock.ts` split out from `steering-dock.ts`) would need a new entry added to this `Set`
at `:114-131`, or this test fails for the Console file that imports it. The simplest path — reuse
`steering-dock.ts` for the new interrupt helpers — avoids touching this allowlist at all. The same
file's first test (`:82-100`) separately forbids any Console production file from importing
`@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, `@tanstack/react-query`, or
runtime-importing `@/lib/api`/`@/lib/api.generated` (type-only is fine) — `FORBIDDEN_SPEC_PREFIXES`
at `:7-14`.

### 4.8 `steering-dock.ts` structure and its own tests

`packages/web/src/lib/steering-dock.ts` (full contents inspected) is explicitly framework-free —
docblock `:1-8` states it's "shared by the Legacy and Console composer renderers" and that "there
is no queue read, polling, rehydration, or cross-tab convergence in this story (Story 2.9+)" —
i.e. Story 2.1 was deliberately scoped to exclude the cross-tab/reload convergence this Story 2.3
report's §3 gap analysis is about; **Story 2.9 is explicitly named as the story meant to close
it**, which the plan should account for (interrupt's `sub_state` reload/cross-tab convergence may
be intentionally deferred past 2.3, matching the existing precedent). Exported surface used by
both docks: `steeringDockMode` (visibility/blocked/detached/composer state machine,
`:53-61`), `steeringBlockedReason` (`:66-71`), `canSubmitGuidance` (`:76-83`), `isQueueShortcut`
(Cmd/Ctrl+Enter guard, `:92-99`), `steeringDraftStorageKey`, `queuedCountPhrase`,
`queueBandHeader`, `queueListLabel`, `queueButtonAccessibleName` (string-building helpers,
`:104-124`), `createSteeringDockState`/`beginGuidanceSubmission`/`resolveGuidanceSuccess`/
`resolveGuidanceFailure` (state-transition reducers, `:126-179`), `loadSteeringDraft`/
`saveSteeringDraft` (sessionStorage persistence, `:184-232`), and the error-normalization trio
`SteeringSendError` (class, `:239-248`), `toSteeringSendError` (`:264-283`), `toSteeringRefusal`
(`:285-288`). No dedicated `steering-dock.test.ts` file was found in this scout pass — tests for
this module's pure functions likely live inline in `ComposerDock.test.tsx`/
`ConsoleComposerDock.test.tsx` rather than a standalone unit-test file (neither `find` nor `ls`
turned up a `steering-dock.test.ts`; worth a direct check before assuming where new
interrupt-mode-transition unit tests belong — they may need a new file).

---

## 5. Transcript rows: status rows, the `interrupted` glyph, and "last row" focus target

### 5.1 Existing `state: 'interrupted'` wire mechanism (pre-dates this story)

`packages/web/src/lib/agent-history.ts` already recognizes a raw wire `status` message
(`NodeMessageRow.kind === 'status'`) whose `payload.state === 'interrupted'`, and treats it
specially when it **immediately follows a tool-card** in the projected stream
(`buildAgentHistory`, `:260-303`):

```ts
if (item.kind === 'tool-card') {
  const next = projected[index + 1];
  const interrupted =
    next?.kind === 'message' &&
    next.message.kind === 'status' &&
    next.message.payload.state === 'interrupted';
  items.push(
    toToolItem(
      item,
      input.events,
      input.nodeId,
      input.nowMs,
      interrupted ? 'interrupted' : undefined
    )
  );
  if (interrupted) index++; // the status row is absorbed, not rendered separately
  continue;
}
```

This folds the following status row **into** the preceding tool's `outcome: 'interrupted'` rather
than rendering the status row on its own — the status row is consumed (`index++`) and never
reaches the generic `kind === 'status'` branch at `:293-303` in that case. The `'interrupted'`
`ToolOutcome` already renders the **⚠ glyph**:
`packages/web/src/lib/tool-presentation.ts:193-199` (`OUTCOME_GLYPH` map,
`interrupted: '⚠'`) and a warning-tone badge (`toolRowPresentation`, `:757-760`:
`badges.push({ kind: 'state', text: 'interrupted', tone: 'warning' })`); the glyph's color comes
from `GLYPH_TONE.interrupted = 'text-warning'`
(`packages/web/src/components/workflows/NodeRoom.tsx:315-320`).

This existing plumbing was **not** built for this story — `toolOutcome: 'interrupted'` is a
general SDK-stream concept referenced in `packages/workflows/src/event-emitter.ts:161` and
`packages/workflows/src/schemas/node-execution.ts:40` (`z.enum(['success', 'error', 'interrupted',
'unknown'])`), used when a tool call itself gets cut off (e.g. background task teardown). It is
**reusable but not automatically correct** for Story 2.3's dock-level Stop: an operator-initiated
interrupt during active tool execution could legitimately reuse this exact wire shape (a status row
with `payload.state === 'interrupted'` right after the tool-card, producing the ⚠ glyph
automatically with **no web code change**), but an interrupt landing during a _text-generation_
phase (no open tool call) has nothing to fold into — it needs the **generic lifecycle path**
instead (see 5.2).

### 5.2 Generic `kind: 'lifecycle'` status rows — zero-code rendering for a new `state` value

For a status row that does **not** immediately follow a tool-card, `buildAgentHistory`
(`:293-301`) produces a generic `AgentHistoryItem` of `kind: 'lifecycle'`:

```ts
if (message.kind === 'status') {
  items.push({
    kind: 'lifecycle',
    id: message.id,
    seq: message.seq,
    state: message.payload.state,
    detail: message.payload.detail ?? null,
    execution: message.metadata?.execution ?? null,
  });
}
```

This is rendered by `LifecycleHistory` in `packages/web/src/components/workflows/NodeRoom.tsx:264-275`:

```tsx
function LifecycleHistory({
  item,
}: {
  item: Extract<AgentHistoryItem, { kind: 'lifecycle' }>;
}): React.ReactElement {
  return (
    <p className="text-xs text-text-secondary">
      {item.state}
      {item.detail !== null && item.detail.length > 0 ? ` ${item.detail}` : ''}
    </p>
  );
}
```

**This renders `item.state` verbatim as plain text with no per-value styling or icon lookup** — a
new server-written status row with `state: 'interrupted'` (or whatever exact string the plan
picks — `started`/`completed`/`failed` are the values named in the task brief as the existing
set) would render correctly with **zero web code changes**, as long as the server writes the row
via the same `workflow_node_messages` status-kind path the existing lifecycle rows use. The same
`LifecycleHistory`-equivalent exists in the Console shell at
`packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` (grep
confirms `kind === 'lifecycle'` there too — same treatment, not separately re-read in this pass
since the pattern is presentational parity with NodeRoom.tsx).

**Conclusion for the plan**: whether a new `state: 'interrupted'` lifecycle row needs any web
change depends entirely on _whether the interrupt lands mid-tool-call or mid-text-generation_ —
mid-tool-call reuses the existing tool-outcome fold (§5.1, zero web change, ⚠ glyph); anywhere else
falls through to the generic lifecycle renderer (§5.2, zero web change, plain text). The only
scenario needing a **web** change is if the plan wants interrupt-specific styling/iconography
beyond plain text for the non-tool-call case — not required by the current renderers.

### 5.3 "Last transcript row" — no existing focusable element; new plumbing needed

Each row in `NodeRoom.tsx`'s `renderItem` (`:956-975`) is a plain `<div key={item.id}>` wrapper
(assistant/tool/lifecycle variants, `:958-974`) with **no `id`, `ref`, or `tabIndex`** — the only
`tabIndex={-1}` elements in this file are **occurrence-group headings**
(`packages/web/src/components/workflows/NodeRoom.tsx:1010-1013`, part of the transcript
occurrence-navigation feature from commit `81ba296f` / issue #206 in the recent git log), not
individual transcript rows. Same absence confirmed in
`packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:934`
(`tabIndex={-1}` also on a heading-equivalent element there, not a row). **No row is currently
focusable in either shell.** Implementing "focus moving to the last transcript row ... when the
dock changes or is removed" is new work: the last item in `items.map(renderItem)`
(`NodeRoom.tsx:996` when `grouping === null`, or the last `group.items` entry when grouped,
`:1016-1023`) needs a `ref`/`id`/`tabIndex={-1}` added so it becomes a valid `.focus()` target, in
both `NodeRoom.tsx` and its Console counterpart. The existing E2E queue-guidance spec already
has a step named `'transcript last row stays reachable and the run completes'`
(`e2e/ui/agent-queue-guidance.spec.ts:663`) — worth reading that step's actual assertions before
assuming it already validates keyboard-focus reachability rather than just scroll-visibility (it
was written for Story 2.1, pre-dating any focus-transfer requirement).

---

## 6. E2E: `agent-queue-guidance.spec.ts` structure

`e2e/ui/agent-queue-guidance.spec.ts` (777 lines) and its fixture support:
`e2e/lib/playwright/archon-runtime.ts` (813 lines, the `archon` fixture + constants),
`e2e/lib/playwright/run-detail.ts` (`getRunDetail`, `listNodeMessages`, `openLegacyRunDetail`,
`openRunDetail` helpers, imported at spec `:17-21`), `e2e/fixtures/workflows/e2e-queue-guidance.yaml`
and `e2e-queue-guidance-loop.yaml`.

### 6.1 Fixtures

`e2e-queue-guidance.yaml` (full contents):

```yaml
name: e2e-queue-guidance
description: 'E2E — one delayed direct node on the fake provider for queued-guidance drain.'
mutates_checkout: false
nodes:
  - id: steer-me
    provider: e2e-fake
    model: e2e-fake-model
    prompt: |
      <<E2E_SCENARIO>>{"delayMs":30000}<</E2E_SCENARIO>>
      $ARGUMENTS
```

The `<<E2E_SCENARIO>>{"delayMs":30000}<</E2E_SCENARIO>>` directive tells the fake provider
(`e2e-fake`) to hold the turn open for 30 seconds — long enough for the test to interact with the
composer dock before the node completes naturally. A `steer-loop` variant does the same inside one
loop iteration (`e2e-queue-guidance-loop.yaml`, referenced via
`E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME`/`QUEUE_GUIDANCE_LOOP_NODE`). An interrupt spec would
plausibly reuse this exact `delayMs` pattern (same or a new fixture) to keep a node "generating"
long enough to click Stop mid-turn and assert the turn actually ends before the natural 30s delay
elapses — proof the interrupt did something, not just that the button exists.

Relevant constants — `e2e/lib/playwright/archon-runtime.ts:90-93`:

```ts
export const E2E_QUEUE_GUIDANCE_WORKFLOW_NAME = 'e2e-queue-guidance';
export const E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME = 'e2e-queue-guidance-loop';
export const QUEUE_GUIDANCE_NODE = 'steer-me';
export const QUEUE_GUIDANCE_LOOP_NODE = 'steer-loop';
```

The `archon` fixture exposes `startWorkflowViaWeb(workflowName, message): Promise<HitlWebRun>`
(interface at `:188`, implementation `:781-807`) — dispatches a run through the actual web UI and
returns `{ runId, ... }`.

### 6.2 Test structure — both shells via a `surface` loop

`e2e/ui/agent-queue-guidance.spec.ts:296-298`:

```ts
for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:steer.direct-${surface}] queue guidance drains at the natural boundary on ${surface}`, async ({ page, archon }, testInfo: TestInfo) => {
    ...
  });
  ...
}
```

Every `test(...)` name is tagged `[P1] [V:<evidence-id>-${surface}]` — the `[P1]` priority tag
feeds the `test:ui:p1` script (`e2e/package.json:11`), and `[V:...]` names the visual-evidence
artifact for that test. Tests present (`:300-777`): `queue-guidance drains at natural boundary`
(`:300`), `... drains inside the loop iteration` (`:402`), `a pending Ask blocks queue guidance`
(`:472`), `... discloses a detached run after a 422` (`:515`), `... dock geometry, contrast, and
reduced-motion evidence` (`:565`), and one **non-looped, single** route-ladder smoke test outside
the surface loop (`:691`, `'queue guidance send route ladder: 200 live, 400 malformed, 404
unknown, 409 finished, 422 detached'` — hits the raw API directly via `page.request`/`fetch`
rather than driving the UI, so it doesn't need a `surface` variant).

Helpers used across tests: `roomRegion(page, nodeId)` (`:90-92`, `page.getByRole('region', {
name: `${nodeId} room` })`), `trackSendRequests(page, runId, nodeId)` (`:70-83`, counts POSTs to
the send route to prove no-send guards — an interrupt spec's equivalent would track POSTs to the
interrupt route), `waitForNodeStarted(page, runId, nodeId)` (`:274-287`, polls run-detail API
until a `node_started` event exists — reusable as-is), `transcriptTexts(page, runId, nodeId)`
(`:290-294`, filters node messages for `kind === 'text'`), `captureEvidence(target, name,
testInfo)` (`:130`, screenshots into `EVIDENCE_DIR`).

### 6.3 Visual evidence capture and reduced-motion

`EVIDENCE_DIR` (`:42-49`) = `plans/260918-1721-issue-181-queue-guidance-for-running-agent/reports/evidence/`
— **a plan-specific directory tied to the #181/Story-2.1 plan folder**, not a generic e2e evidence
location; a Story 2.3 spec should point its own `EVIDENCE_DIR` at this task's plan folder
(`plans/260919-0139-issue-183-interrupt-and-redirect-claude-agent/reports/evidence/`) rather than
writing into the 2.1 plan's directory. `MEASUREMENTS_FILE` (`:50`) is a JSON file
(`us-005-measurements.json`) the geometry/contrast test step writes into — same naming convention
(`us-XXX-...`) to follow for a new US id.

Reduced-motion handling — `:655-661` inside the `'queue guidance dock geometry, contrast, and
reduced-motion evidence'` test:

```ts
await test.step('reduced-motion parity', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  ...
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});
```

Uses Playwright's native `page.emulateMedia({ reducedMotion })` — no custom CSS-injection
workaround. The dock components themselves already guard transitions with
`motion-reduce:transition-none` (`ComposerDock.tsx:238`,
`ConsoleComposerDock.tsx:243`) — the same Tailwind convention a new `Stop`/`interrupting` button
transition should follow.

Contrast-check pattern: `:587-636` measures computed styles (background/foreground color pairs)
against WCAG thresholds — likely via an injected `page.evaluate` helper reading
`getComputedStyle`; not fully re-read in this pass but the section header
`'contrast: receipts, sent badges, hint, and field focus ring'` names exactly the elements it
checks, giving a template for a Stop-button/WILL-SEND-header contrast check.

Layout/overflow check: `:230-270` (`assertRoomFitsViewport`-equivalent, checks
`roomInsideViewport`, `roomScroll`, `pageOverflow`, and enumerates any overflowing elements) is
invoked at `:637-654` for `460px` (mobile) and Console `1440x900` captures.

### 6.4 `e2e/package.json` scripts

`e2e/package.json:7-14`:

```json
"scripts": {
  "test:ui": "playwright test -c playwright.config.ts ui",
  "test:ui:hitl": "playwright test -c playwright.config.ts ui --grep 'HITL'",
  "test:ui:p0": "playwright test -c playwright.config.ts ui --grep '\\[P0\\]'",
  "test:ui:p1": "playwright test -c playwright.config.ts ui --grep '\\[P1\\]'",
  "test:ui:p2": "playwright test -c playwright.config.ts ui --grep '\\[P2\\]'",
  "typecheck": "tsc -p tsconfig.json --noEmit"
}
```

`@archon/e2e` is deliberately **not** a bun workspace member (docblock `description` field,
`e2e/package.json:6`) so root `bun --filter '*'` scripts never pull in Playwright. A new
`agent-interrupt-redirect.spec.ts` would live at `e2e/ui/agent-interrupt-redirect.spec.ts`, tagged
`[P1]` to run under the existing `test:ui:p1` script without any script changes, and would import
the same `test`/`expect` from `../lib/playwright/suite` and the same `getRunDetail`/
`listNodeMessages`/`openLegacyRunDetail`/`openRunDetail` helpers from `../lib/playwright/run-detail`.

---

Status: DONE
Summary: Full server route/test-harness/GET-run/SSE trace done for send and the (nonexistent) interrupt route, with exact anchors for where an interrupt handler, schema, registry method, and nodeStates/SSE join point must land; web type-regen procedure and worktree port trap documented; Legacy vs Console data-flow traced to their actual pollers (3s React Query vs SSE + 30s heartbeat); both ComposerDock files, their tests, and the Console isolation allowlist fully read; transcript status-row rendering shown to need zero web changes for a new lifecycle state string (and to already have a reusable tool-outcome 'interrupted' path), while "last row" focus is confirmed net-new; the E2E spec's structure, fixtures, evidence conventions, and package scripts are mapped for a mirrored interrupt spec.
Concerns/Blockers: The actual interrupt mechanism (what stops a live provider turn) has no existing primitive in steering-registry.ts or dag-executor.ts — that is executor/provider-package scope, not server/web, and this report deliberately did not chase it further to respect the parallel scout-executor/scout-provider agents' territory; the plan needs their findings to know what registry method the server route will call. Whether an SSE event should be added for steering sub-state (so Console's `dag_node` invalidation switch picks up interrupts promptly instead of waiting 30s) is a design decision this report surfaces but does not resolve.
