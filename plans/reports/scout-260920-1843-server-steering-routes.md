# Scout report: server steering route family (for ANR Story 2.12 keepalive route)

Status: DONE. Read-only — no files modified.

## 1. Steering routes in `packages/server/src/routes/api.ts`

### Route table (OpenAPI `createRoute` definitions)

| Route var | Method | Path | Definition lines |
|---|---|---|---|
| `sendWorkflowNodeRoute` | POST | `/api/workflows/runs/{runId}/nodes/{nodeId}/send` | `api.ts:1607-1641` |
| `interruptWorkflowNodeRoute` | POST | `/api/workflows/runs/{runId}/nodes/{nodeId}/interrupt` | `api.ts:1643-1674` |
| `withdrawWorkflowNodeRoute` | DELETE | `/api/workflows/runs/{runId}/nodes/{nodeId}/queue/{messageId}` | `api.ts:1676-1702` |
| `readWorkflowNodeQueueRoute` | GET | `/api/workflows/runs/{runId}/nodes/{nodeId}/queue` | `api.ts:1704-1735` |

All four share `tags: ['Workflows']` and the `steeringJsonError(description)` helper (`api.ts:691-696`) for every non-2xx response entry, which wires each error status to the shared `steeringErrorSchema` (from `workflow.schemas.ts`).

By convention, a new **keepalive** route would live at:

```
POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive
```

sitting alongside `send`/`interrupt` as a third bodyless-or-near-bodyless POST action scoped to `{runId}/{nodeId}`, following the same `{verb-as-final-segment}` pattern `send` and `interrupt` use (as opposed to `queue`/`queue/{messageId}` which are noun-resource segments for the withdraw/read pair).

### Handler registration (`registerApiRoutes`, `api.ts:2295` onward)

Each handler is registered with `registerOpenApiRoute(route, handlerFn, steeringValidationErrorHook)` — the third argument is a route-scoped Zod validation-error hook (imported at `api.ts:8`) that reshapes a Zod validation failure into the nested `{ success: false, error: { code, message } }` steering error contract instead of Hono's default OpenAPI error body. A keepalive route (bodyless like `interrupt`) would register the same way, passing `steeringValidationErrorHook` even though there is no body to validate, purely for parameter-schema-failure consistency.

### `send` handler — exact code (`api.ts:5337-5462`)

Pre-route middleware (runs before OpenAPI body validation so a gated unauthenticated caller gets 401 even on a malformed body):

```ts
// api.ts:5343-5360
app.use('/api/workflows/runs/:runId/nodes/:nodeId/send', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  if (isWebAuthEnabled() || isApiGateEnabled()) {
    const requester = await resolveAuthContext(c);
    if (!requester) {
      return steeringError(c, 401, 'unauthenticated', 'Authentication required');
    }
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

Handler body (`api.ts:5363-5462`):

```ts
registerOpenApiRoute(
  sendWorkflowNodeRoute,
  async c => {
    const runId = c.req.param('runId') ?? '';
    const nodeId = c.req.param('nodeId') ?? '';
    try {
      const requester = await resolveAuthContext(c);
      if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) {
        return steeringError(c, 401, 'unauthenticated', 'Authentication required');
      }
      const body = getValidatedBody(c, sendWorkflowNodeBodySchema);

      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return steeringError(c, 404, 'not_found', 'Workflow run not found');
      }

      // Project the effective node state and inspect the registry handle to
      // establish the target. The projection is authoritative for lifecycle —
      // a stale live handle can never beat a terminal run/node.
      const events = await workflowEventDb.listWorkflowEvents(runId);
      const pendingInteractions =
        await workflowPendingInteractionDb.listPendingInteractions(runId);
      const nodeState = projectApiWorkflowNodeStates(events, pendingInteractions).find(
        state => state.nodeId === nodeId
      );
      const handle = getSteeringRegistry().get(runId, nodeId);

      if (nodeState === undefined && handle === undefined) {
        return steeringError(c, 404, 'not_found', 'Workflow node not found');
      }
      if (TERMINAL_WORKFLOW_STATUSES.includes(run.status)) {
        return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
      }
      if (nodeState !== undefined && TERMINAL_API_NODE_STATUSES.includes(nodeState.status)) {
        return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
      }
      if (handle?.snapshot().phase === 'closed') {
        return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
      }
      if (handle === undefined) {
        return steeringError(
          c, 422, 'not_steerable_here',
          'No live steering session for this node in this process'
        );
      }

      // Final gate: a concurrent terminal transition wins. enqueue() is
      // synchronous — no await runs between this read and the mutation.
      const latestRun = await workflowDb.getWorkflowRun(runId);
      if (latestRun === null) {
        return steeringError(c, 404, 'not_found', 'Workflow run not found');
      }
      if (TERMINAL_WORKFLOW_STATUSES.includes(latestRun.status)) {
        return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
      }

      const result = handle.accept(
        {
          messageId: body.message_id,
          message: body.message,
          operatorUserId: requester?.userId ?? null,
          receivedAt: new Date().toISOString(),
        },
        body.intent
      );
      if (!result.ok) {
        return result.reason === 'closed'
          ? steeringError(c, 409, 'node_finished', 'Workflow node is finished')
          : steeringError(c, 422, 'not_steerable_here', 'No live steering session for this node in this process');
      }
      return c.json(
        { success: true as const, message_id: result.receipt.messageId, state: result.receipt.state },
        200
      );
    } catch (error) {
      getLog().error({ err: error, runId, nodeId }, 'api.workflow_node_send_failed');
      return steeringError(c, 500, 'internal_error', 'Failed to queue guidance');
    }
  },
  steeringValidationErrorHook
);
```

### `interrupt` handler — exact code (`api.ts:5464-5555`)

No pre-route middleware — the comment at `api.ts:5464-5472` explains why: "No body → no send-route-style middleware needed: param validation cannot fail on a matched route, so the in-handler auth check still runs before any rejection a gated caller could hit." This is directly relevant to keepalive, which is also bodyless.

```ts
registerOpenApiRoute(
  interruptWorkflowNodeRoute,
  async c => {
    const runId = c.req.param('runId') ?? '';
    const nodeId = c.req.param('nodeId') ?? '';
    try {
      const requester = await resolveAuthContext(c);
      if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) {
        return steeringError(c, 401, 'unauthenticated', 'Authentication required');
      }

      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return steeringError(c, 404, 'not_found', 'Workflow run not found');
      }

      const events = await workflowEventDb.listWorkflowEvents(runId);
      const pendingInteractions =
        await workflowPendingInteractionDb.listPendingInteractions(runId);
      const nodeState = projectApiWorkflowNodeStates(events, pendingInteractions).find(
        state => state.nodeId === nodeId
      );
      const handle = getSteeringRegistry().get(runId, nodeId);

      if (nodeState === undefined && handle === undefined) {
        return steeringError(c, 404, 'not_found', 'Workflow node not found');
      }
      if (TERMINAL_WORKFLOW_STATUSES.includes(run.status)) {
        return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
      }
      if (nodeState !== undefined && TERMINAL_API_NODE_STATUSES.includes(nodeState.status)) {
        return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
      }
      if (handle?.snapshot().phase === 'closed') {
        return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
      }
      if (handle === undefined) {
        return steeringError(c, 422, 'not_steerable_here', 'No live steering session for this node in this process');
      }

      // Final async gate: a concurrent terminal transition wins.
      const latestRun = await workflowDb.getWorkflowRun(runId);
      if (latestRun === null) {
        return steeringError(c, 404, 'not_found', 'Workflow run not found');
      }
      if (TERMINAL_WORKFLOW_STATUSES.includes(latestRun.status)) {
        return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
      }

      const settlement = await handle.interrupt();
      switch (settlement) {
        case 'idle-after-interrupt':
          return c.json({ success: true as const, sub_state: 'idle-after-interrupt' as const }, 200);
        case 'generating':
          return c.json({ success: true as const, sub_state: 'generating' as const }, 200);
        case 'node_finished':
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        case 'not_steerable_here':
          return steeringError(c, 422, 'not_steerable_here', 'No live steering session for this node in this process');
      }
    } catch (error) {
      getLog().error({ err: error, runId, nodeId }, 'api.workflow_node_interrupt_failed');
      return steeringError(c, 500, 'internal_error', 'Failed to interrupt node');
    }
  },
  steeringValidationErrorHook
);
```

`withdraw` (`api.ts:5557-5648`, DELETE, params-only body via `withdrawWorkflowNodeParamsSchema`) and `read queue` (`api.ts:5650-` continuing past line 5699, GET, bodyless, no requester resolution because auth was already enforced by pre-route middleware) follow the identical run/node-state/handle precedence ladder. `read queue` is the one route that does NOT call `resolveAuthContext` again inside the handler — see `api.ts:5651-5652` comment: "Authentication was already enforced by the pre-gate middleware above — the read needs no requester (no attribution), so it is not resolved again."

### Pre-route auth middleware for withdraw and queue-read (`api.ts:2390-2425`)

Two additional `app.use(...)` middlewares run auth (and, for the GET, `Cache-Control: no-store`) ahead of OpenAPI parameter validation, for the same "gated 401 must win over a generic validation/gate shape" reason as `send`'s pre-route middleware:

```ts
// api.ts:2395-2404 — DELETE /queue/:messageId
app.use('/api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId', async (c, next) => {
  if (c.req.method !== 'DELETE') return next();
  if (isWebAuthEnabled() || isApiGateEnabled()) {
    const requester = await resolveAuthContext(c);
    if (!requester) {
      return steeringError(c, 401, 'unauthenticated', 'Authentication required');
    }
  }
  return next();
});

// api.ts:2415-2425 — GET /queue
app.use('/api/workflows/runs/:runId/nodes/:nodeId/queue', async (c, next) => {
  if (c.req.method !== 'GET') return next();
  c.header('Cache-Control', 'no-store');
  if (isWebAuthEnabled() || isApiGateEnabled()) {
    const requester = await resolveAuthContext(c);
    if (!requester) {
      return steeringError(c, 401, 'unauthenticated', 'Authentication required');
    }
  }
  return next();
});
```

A keepalive route (bodyless POST, no messageId param, no distinct GET/DELETE method sharing its path prefix with another steering verb) does **not** need one of these extra pre-route `app.use` middlewares — it can follow `interrupt`'s pattern exactly: no pre-route middleware, auth resolved once inside the `registerOpenApiRoute` handler, because (per the `interrupt` comment) param validation on an already-matched route path cannot itself fail in a way that would race a gated 401.

### The shared `steeringError` helper (`api.ts:2310-2322`)

```ts
/**
 * Steering-route error body (issue #181 contract):
 * `{ success: false, error: { code, message } }` — consumers classify by
 * `code`, never prose. Operator message content is never included.
 */
function steeringError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
  code: string,
  message: string
): Response {
  return c.json({ success: false as const, error: { code, message } }, status);
}
```

A keepalive handler would reuse this exact helper verbatim (it is a closure inside `registerApiRoutes`, in scope for any handler registered in the same function body).

## 2. Steering actor grant — how it's implemented

There is **no dedicated "steering actor grant" function** distinct from `resolveAuthContext` (`api.ts:2469-2516`). The grant is simply: **any resolvable identity is allowed to steer** — there is no starter/member/admin ownership check for send/interrupt/withdraw/queue-read. Concretely:

- `resolveAuthContext(c)` returns `{ userId, role } | undefined` — `role` rides along on the canonical user row but the steering handlers never branch on it.
- If web auth or the API gate is enabled (`isWebAuthEnabled() || isApiGateEnabled()`) and `resolveAuthContext` returns `undefined`, the route returns `401 unauthenticated` (`api.ts:5346-5349` for send; `api.ts:5479-5482` for interrupt; same shape for withdraw).
- If a gate is **not** enabled, `requester` may legitimately be `undefined` and the handler proceeds anyway — this is the "identity-less" allow case (`operatorUserId: requester?.userId ?? null` at `api.ts:5430`).
- **Any** authenticated identity — the run starter, another `member`, or an `admin` who does not own the run — is accepted with no ownership comparison against `run.user_id`. This is empirically proven by the test file (see §3) and is architecturally different from the `permission-confirm` route (`api.ts:5313-5314`, using `PermissionForbiddenError` → 403), and from `retry-node` (`api.ts:3317,3325` — "Only the run owner or an admin can retry this node" / "Only admins can retry unowned workflow runs"), both of which DO enforce ownership-based 403s. Steering intentionally does not.
- The `403: steeringJsonError('Forbidden')` entries declared in each route's OpenAPI `responses` map (e.g. `api.ts:1636, 1668, 1696, 1729`) are **declared in the schema but never raised by any of the four steering handlers** — no code path returns a steering 403 today. A keepalive route can declare the same `403: steeringJsonError('Forbidden')` entry for response-shape parity with its siblings, while implementing the identical no-ownership-check behavior.

Because a keepalive route only needs to re-arm a timer (no operator content, no state transition visible to other actors), the same "any identity, or none when ungated" grant is the correct model to copy verbatim: `const requester = await resolveAuthContext(c); if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) return steeringError(c, 401, 'unauthenticated', 'Authentication required');`.

## 3. Response shapes and status codes

### `send` response (200): `sendWorkflowNodeResponseSchema` (`workflow.schemas.ts:564-573`)

```ts
export const sendWorkflowNodeResponseSchema = z
  .object({
    success: z.literal(true),
    message_id: z.string().uuid(),
    state: z.enum(['queued', 'awaiting_send_now']),
  })
  .strict()
  .openapi('SendWorkflowNodeResponse');
```

### `interrupt` response (200): `interruptWorkflowNodeResponseSchema` (`workflow.schemas.ts:582-590`)

```ts
export const interruptWorkflowNodeResponseSchema = z
  .object({
    success: z.literal(true),
    sub_state: z.enum(['idle-after-interrupt', 'generating']),
  })
  .strict()
  .openapi('InterruptWorkflowNodeResponse');
```

`sub_state` is the field the interrupt route puts in its JSON body — it carries the executor's classified `InterruptSettlement` outcome (`idle-after-interrupt` or `generating`; `node_finished`/`not_steerable_here` map to error responses instead of 200 body values). This is the "response schema convention" for steering: **every 200 body is `{ success: true, ...fields }` (`.strict()`, no extra keys), and every non-2xx body is the single shared `steeringErrorSchema` (`{ success: false, error: { code, message } }`).**

A keepalive route's 200 body would follow the same convention, e.g. `{ success: true, ... }` with whatever field reports the timer's new state (analogous to `sub_state`) — no such field exists yet since keepalive doesn't exist; it would need to be defined new, following the `.strict().openapi('KeepaliveWorkflowNodeResponse')` pattern.

### Shared error schema: `steeringErrorSchema` (`workflow.schemas.ts:596-604`)

```ts
export const steeringErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict()
  .openapi('SteeringError');
```

Used by all four steering routes for every non-2xx entry via `steeringJsonError(description)` (`api.ts:691-696`):

```ts
function steeringJsonError(description: string): {
  content: { 'application/json': { schema: typeof steeringErrorSchema } };
  description: string;
} {
  return { content: { 'application/json': { schema: steeringErrorSchema } }, description };
}
```

### Other steering schemas (`workflow.schemas.ts`)

- `sendWorkflowNodeBodySchema` (`workflow.schemas.ts:546-557`): `{ message: string (non-blank refine), message_id: string uuid, intent: 'queue' | 'send_now' }`, `.strict()`.
- `withdrawWorkflowNodeParamsSchema` (`workflow.schemas.ts:614-620`): `{ runId, nodeId, messageId: uuid }`, `.strict()`.
- `withdrawWorkflowNodeResponseSchema` (`workflow.schemas.ts:626-634`): `{ success: true, message_id: uuid }`, `.strict()`.
- `readWorkflowNodeQueueParamsSchema` (`workflow.schemas.ts:644-649`): `{ runId, nodeId }`, `.strict()`.
- `queuedGuidanceMessageSchema` / `readWorkflowNodeQueueResponseSchema` (`workflow.schemas.ts:656-676`): `{ success: true, queued: [{ message_id, message }] }`.

### `registerOpenApiRoute(createRoute({...}), handler)` usage

Every steering route is defined with `createRoute({ method, path, tags, summary, description, request: { params, body? }, responses: {...} })` (e.g. `api.ts:1607-1641` for send) and then wired via `registerOpenApiRoute(routeConst, handlerFn, optionalValidationErrorHook)` inside `registerApiRoutes` (e.g. `api.ts:5363-5462`). This matches the AGENTS.md convention: "All new/modified API routes must use `registerOpenApiRoute(createRoute({...}), handler)`." A keepalive route needs its own `createRoute({...})` object (e.g. `keepaliveWorkflowNodeRoute`) plus its own response schema exported from `workflow.schemas.ts`, then one `registerOpenApiRoute(keepaliveWorkflowNodeRoute, handlerFn, steeringValidationErrorHook)` call placed near the other steering registrations (after `interrupt`, before `withdraw`, at roughly `api.ts:5555-5557`).

## 4. Test patterns in `packages/server/src/routes/api.workflow-runs.test.ts`

### Test app construction (`makeApp`, lines 848-864)

```ts
function makeApp(): { app: OpenAPIHono; mockWebAdapter: WebAdapter } {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const mockWebAdapter = {
    setConversationDbId: mock((_platformId: string, _dbId: string) => {}),
    emitSSE: mock(async () => {}),
    emitLockEvent: mock(async () => {}),
  } as unknown as WebAdapter;
  const mockLockManager = {
    acquireLock: mock(async (_id: string, fn: () => Promise<void>) => {
      await fn();
      return { status: 'started' };
    }),
    getStats: mock(() => ({ active: 0, queued: 0 })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, mockWebAdapter, mockLockManager);
  return { app, mockWebAdapter };
}
```

Module-level mocking is done once via `mockAllWorkflowModules()` (imported from `../test/workflow-mock-factories`, called at `api.workflow-runs.test.ts:233`) which mocks `workflowDb`, `workflowEventDb`, `workflowPendingInteractionDb`, etc. so `mockGetWorkflowRun`, `mockListWorkflowEvents`, `mockListPendingInteractions`, `mockCreateWorkflowEvent`, `mockAddMessage`, `mockUpdateWorkflowRun`, `mockFindOrCreateUserByPlatformIdentity` are the shared spies steering tests assert against. The steering describe blocks import the REAL `getSteeringRegistry` (`api.workflow-runs.test.ts:756`) — the registry is not mocked, only the DB layer is — and call `getSteeringRegistry().register(...)`/`.clearForTests()` directly to set up and tear down live/parked/closed handles.

### Steering-specific test fixtures (lines 6561-6663)

```ts
const STEER_STARTER_ID = 'user-steer-starter';
// ... message-id constants ...

function mockSteerableRun(overrides: Partial<MockWorkflowRun> = {}): MockWorkflowRun {
  return { ...MOCK_RUNNING_RUN, id: STEER_RUN_ID, user_id: STEER_STARTER_ID, ...overrides };
}

function steerEvent(eventType: string, nodeId: string = STEER_NODE_ID): MockWorkflowEvent { ... }

function sendPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { message: 'steer the node', message_id: STEER_MESSAGE_ID, intent: 'queue', ...overrides };
}

function postNodeSend(app, body, headers = {}, runId = STEER_RUN_ID, nodeId = STEER_NODE_ID): Promise<Response> {
  return app.request(`/api/workflows/runs/${runId}/nodes/${nodeId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function expectSteeringError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json() as { success: boolean; error: { code: string; message: string } };
  expect(body.success).toBe(false);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  expect(body.error.message.length).toBeGreaterThan(0);
}
```

For interrupt specifically (lines 7221-7293):

```ts
function postNodeInterrupt(app, headers = {}, runId = STEER_RUN_ID, nodeId = STEER_NODE_ID): Promise<Response> {
  return app.request(`/api/workflows/runs/${runId}/nodes/${nodeId}/interrupt`, { method: 'POST', headers });
}

interface InterruptibleSetup { handle: NodeSteeringHandle; controller: AbortController; token: number; aborts: () => number; }

/** Running run + node_started projection + live INTERRUPTIBLE handle mid-turn. */
function liveInterruptibleSetup(nodeId = STEER_NODE_ID): InterruptibleSetup {
  mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
  mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', nodeId)]);
  const handle = getSteeringRegistry().register(STEER_RUN_ID, nodeId, { interruptible: true });
  const controller = new AbortController();
  let abortCount = 0;
  const originalAbort = controller.abort.bind(controller);
  controller.abort = () => { abortCount++; originalAbort(); };
  const token = handle.beginTurn(controller);
  return { handle, controller, token, aborts: () => abortCount };
}

/** Handle parked in idle-after-interrupt; `idleWait` resolves on the first wake. */
function idleInterruptibleSetup(nodeId = STEER_NODE_ID) {
  const setup = liveInterruptibleSetup(nodeId);
  return { ...setup, idleWait: setup.handle.enterIdle(setup.token) };
}
```

### Representative test block 1 — actor matrix for send (lines 6684-6739)

```ts
// -- Actor matrix ---------------------------------------------------------

test('returns 200 and queues one item for the run starter', async () => {
  const handle = liveSetup();
  const { app } = makeApp();
  const res = await postNodeSend(app, sendPayload(), { 'X-Archon-User': STEER_STARTER_ID });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, message_id: STEER_MESSAGE_ID, state: 'queued' });
  const queued = handle.snapshot().queued;
  expect(queued).toHaveLength(1);
  expect(queued[0]?.operatorUserId).toBe(STEER_STARTER_ID);
});

test('returns 200 for another authenticated member identity', async () => {
  const handle = liveSetup();
  mockFindOrCreateUserByPlatformIdentity.mockImplementationOnce(
    async (_platform: string, platformUserId: string) => ({
      id: platformUserId, display_name: platformUserId, email: null,
      role: 'member' as const, created_at: new Date(), updated_at: new Date(),
    })
  );
  const { app } = makeApp();
  const res = await postNodeSend(app, sendPayload(), { 'X-Archon-User': 'member-other' });

  expect(res.status).toBe(200);
  expect(handle.snapshot().queued[0]?.operatorUserId).toBe('member-other');
});

test('returns 200 for an admin identity that does not own the run', async () => {
  const handle = liveSetup();
  const { app } = makeApp();
  const res = await postNodeSend(app, sendPayload(), { 'X-Archon-User': 'user-admin-9' });

  expect(res.status).toBe(200);
  expect(handle.snapshot().queued[0]?.operatorUserId).toBe('user-admin-9');
});

test('returns 200 with a null operator id on an identity-less install', async () => {
  const handle = liveSetup();
  const { app } = makeApp();
  const res = await postNodeSend(app, sendPayload());

  expect(res.status).toBe(200);
  expect(handle.snapshot().queued[0]?.operatorUserId).toBeNull();
});
```

### Representative test block 2 — the collapsed actor-ladder assertion for interrupt (lines 7378-7393) and the 401 test (7395-7420+)

```ts
// -- Actor ladder ---------------------------------------------------------

test('actor ladder matches send: starter, member, admin, and identity-less allowed', async () => {
  for (const actor of [STEER_STARTER_ID, 'member-other', 'user-admin-9', undefined]) {
    idleInterruptibleSetup();
    const { app } = makeApp();
    const res = await postNodeInterrupt(app, actor ? { 'X-Archon-User': actor } : {});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, sub_state: 'idle-after-interrupt' });
    getSteeringRegistry().clearForTests();
  }
});

test('returns nested 401 for a gated unauthenticated caller', async () => {
  getAuth(); // resolve the auth singleton as "disabled" BEFORE flipping the env gate on
  const savedDb = process.env.DATABASE_URL;
  const savedSecret = process.env.BETTER_AUTH_SECRET;
  const savedRequired = process.env.ARCHON_WEB_AUTH_REQUIRED;
  process.env.DATABASE_URL = 'postgres://127.0.0.1:1/archon-test';
  process.env.BETTER_AUTH_SECRET = 's'.repeat(32);
  process.env.ARCHON_WEB_AUTH_REQUIRED = 'false';
  try {
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'unauthenticated', message: 'Authentication required' },
    });
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  } finally {
    // restore saved env vars
  }
});
```

This "actor ladder matches send" test (interrupt, lines 7380-7393) is the direct precedent for what a keepalive route's own actor-matrix test should assert: iterate `[starter, member, admin, undefined]`, expect 200 for every case when the gate is off, plus a separate 401 test with the DB/secret/required env dance (`getAuth()` cached "disabled" resolution, `DATABASE_URL`/`BETTER_AUTH_SECRET` set, `ARCHON_WEB_AUTH_REQUIRED=false` so the route's own middleware/handler decides rather than the global `/api/*` gate).

### 409/422 patterns (representative, from the send describe, lines 6872+ and mirrored for interrupt/withdraw/queue-read)

```ts
test('returns 409 for a terminal run even with a stale live handle', async () => {
  mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'completed' }));
  mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
  const handle = getSteeringRegistry().register(STEER_RUN_ID, STEER_NODE_ID);
  const before = handle.snapshot();
  const { app } = makeApp();
  const res = await postNodeSend(app, sendPayload());
  // ... await expectSteeringError(res, 409, 'node_finished'); expectNoSteeringMutation(handle, before);
});
```

409 `node_finished` is asserted when `run.status` is terminal (`TERMINAL_WORKFLOW_STATUSES`) or the projected node state is terminal (`TERMINAL_API_NODE_STATUSES`) or the handle itself reports `phase === 'closed'`. 422 `not_steerable_here` is asserted specifically when the run/node is known-non-terminal but `getSteeringRegistry().get(runId, nodeId)` returns `undefined` (no live in-process handle — e.g. a different server process owns the run). Idempotency for `send` is proven via duplicate `message_id` replay tests (not shown above, but present later in the same describe) asserting the SAME receipt (`state`) is returned without a second queue push; idempotency for `withdraw` is proven by asserting the same 200 body for a removed / already-drained / never-seen id.

## Answers to the four explicit questions

1. **Exact URL pattern and keepalive convention.** `send` = `POST /api/workflows/runs/{runId}/nodes/{nodeId}/send` (`api.ts:1609`); `interrupt` = `POST /api/workflows/runs/{runId}/nodes/{nodeId}/interrupt` (`api.ts:1645`). By the same convention, keepalive would be `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`.

2. **Reaching the `NodeSteeringHandle`.** Every steering route does `const handle = getSteeringRegistry().get(runId, nodeId)` (e.g. `api.ts:5389, 5495, 5586`) after independently confirming via `workflowDb.getWorkflowRun` + `workflowEventDb.listWorkflowEvents`/`projectApiWorkflowNodeStates` that the run/node is not terminal — the projection is authoritative over a possibly-stale handle. A keepalive handler would follow the identical ladder (404/409/422 checks in the same order) then call a new handle method. No such method exists yet in `packages/workflows/src/steering-registry.ts` today — there is currently **no idle-after-interrupt timer at all** in the registry (`NodeSteeringHandle` has no timer field; `enterIdle()` at `steering-registry.ts:267-282` only stores an `idleWaiter` resolved by `accept()`'s send_now release or by `seal()` on terminal transitions). The generic 30-minute idle timeout that exists today, `STEP_IDLE_TIMEOUT_MS` (`packages/workflows/src/utils/idle-timeout.ts:22`, `30 * 60 * 1000`), is a *different* mechanism — it bounds a node's overall step/loop-iteration idle time via `withIdleTimeout()` (`dag-executor.ts:2415-2486, 6414-6434, 7002`), not the interrupt-specific idle-after-interrupt sub-state. Story 2.12's 30-minute abandoned-redirect timer over `idle-after-interrupt` is new work; a `recordComposerActivity()`-style method on `NodeSteeringHandle` (to reset that new timer without touching `idleWaiter`/`subState`) does not exist in the current codebase and would need to be added alongside whatever timer mechanism implements the 30-minute fail.

3. **Interrupt's JSON body / `sub_state` field.** `interrupt`'s 200 body is `{ success: true, sub_state: 'idle-after-interrupt' | 'generating' }` (`interruptWorkflowNodeResponseSchema`, `workflow.schemas.ts:582-590`). This is the response-schema convention every steering route follows: `{ success: true, ...fields }` on 200 (`.strict()`, unique per route — `message_id`+`state` for send, `sub_state` for interrupt, `message_id` for withdraw, `queued` array for queue-read), and the single shared `{ success: false, error: { code, message } }` (`steeringErrorSchema`) on every non-2xx.

4. **How the "steering actor grant" is implemented/shared.** It is not a separate function — it is simply `resolveAuthContext(c)` (`api.ts:2469-2516`) called once per handler, gated only by `isWebAuthEnabled() || isApiGateEnabled()`. There is no ownership/role branch: starter, any other member, and any admin all pass identically, and an ungated install allows a fully identity-less caller through with `operatorUserId: null`. This is proven directly by the test suite's repeated "returns 200 for another authenticated member identity" / "returns 200 for an admin identity that does not own the run" / "returns 200 with a null operator id on an identity-less install" tests across send (6704-6739), interrupt (7380-7393, collapsed into one loop), withdraw (7874-7901), and queue-read (8447-8470). A keepalive handler should copy this exact block verbatim:
   ```ts
   const requester = await resolveAuthContext(c);
   if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) {
     return steeringError(c, 401, 'unauthenticated', 'Authentication required');
   }
   ```
   with no further role/ownership check, matching interrupt's placement (`api.ts:5479-5482`) — no separate pre-route `app.use` middleware needed unless keepalive shares a path segment with another HTTP method (it does not, if given its own `/keepalive` leaf).

## Unresolved / for the parent task to decide

- The exact new `NodeSteeringHandle` method name/signature for re-arming the 30-minute timer (e.g. `recordComposerActivity()`) is not yet decided anywhere in the codebase — this scout found no existing partial implementation to model it on beyond the general `enterIdle()`/`seal()` machinery already documented above.
- Whether keepalive's 200 response should echo `sub_state` (to let the caller confirm the node is still `idle-after-interrupt` at call time) or return a minimal `{ success: true }` — no precedent settles this; `interrupt` echoes `sub_state` because it is reporting a settled classification, whereas keepalive doesn't change sub_state, so a minimal ack may fit the codebase's pattern of "response reports only what materially happened" better, but this is a design choice for the parent task, not something scouted from existing code.
