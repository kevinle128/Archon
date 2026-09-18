# Scout Report: `POST /api/workflows/runs/:runId/nodes/:nodeId/send`

Read-only analysis of `packages/server/src/routes/api.ts` (6738 lines) and related
files to support planning a new steering-message route. No source was modified.

## 1. `registerOpenApiRoute` / `apiError` — signatures and a full existing route

`registerOpenApiRoute` (`packages/server/src/routes/api.ts:4004-4013`):

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

It is a thin wrapper over Hono's `app.openapi(route, handler)`. Zod validates
`params`/`query`/`body` at runtime via the app-level `defaultHook`
(`validationErrorHook`, `packages/server/src/routes/openapi-defaults.ts:21-27`,
shape `{ error: string }`, status 400) **unless** a route-scoped third arg
(`hook`) is passed — the only precedent is `workflowEnvValidationErrorHook`
(same file, lines 37-47), used exclusively by the Workflow ENV routes to force
a stable `{ error: 'invalid_env_request', detail }` shape instead of the
generic one. This is the mechanism to reach for if the new route needs its own
validation-error body shape.

`apiError` (`packages/server/src/routes/api.ts:2115-2121`):

```ts
function apiError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
  message: string,
  detail?: string
): Response {
  return c.json({ error: message, ...(detail ? { detail } : {}) }, status);
}
```

Every route in the file returns `{ error: string, detail?: string }` on
failure via this helper — **flat**, not the nested `{ success: false, error: {
code, message } }` shape the task specifies. See Risk #1 below.

Full example — `retryWorkflowNodeRoute`
(`packages/server/src/routes/api.ts:1338-1361`), a `POST` with path params +
JSON body + declared 400/401/403/404/409/500 responses:

```ts
const retryWorkflowNodeRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/retry',
  tags: ['Workflows'],
  summary: 'Retry one DAG node and its descendants for a failed, cancelled, or completed run',
  request: {
    params: retryWorkflowNodeParamsSchema,
    body: {
      content: { 'application/json': { schema: retryWorkflowNodeBodySchema } },
      required: false,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: retryWorkflowNodeResponseSchema } },
      description: 'Retry accepted and dispatched',
    },
    400: jsonError('Bad request'),
    401: jsonError('Authentication required'),
    403: jsonError('Forbidden'),
    404: jsonError('Not found'),
    409: jsonError('Conflict'),
    500: jsonError('Server error'),
  },
});
```

`jsonError` (`api.ts:634-639`) is the per-status OpenAPI response builder:

```ts
function jsonError(description: string): {
  content: { 'application/json': { schema: typeof errorSchema } };
  description: string;
} {
  return { content: { 'application/json': { schema: errorSchema } }, description };
}
```

`errorSchema` lives in `packages/server/src/routes/schemas/common.schemas.ts:8`
(`z.object({ error: z.string() }).openapi('Error')`). Every non-2xx response
in every route in this file reuses this one schema for its OpenAPI doc entry
— response schemas are for spec generation only, never runtime-validated
(doc comment at `api.ts:4008-4011`).

Body/param access inside handlers goes through two typed accessors
(`api.ts:4016-4024`):

```ts
function getValidatedQuery<T>(c: Context, _schema: z.ZodType<T>): T {
  return (c.req as unknown as { valid(k: 'query'): T }).valid('query');
}
function getValidatedBody<T>(c: Context, _schema: z.ZodType<T>): T {
  return (c.req as unknown as { valid(k: 'json'): T }).valid('json');
}
```
(`getOptionalValidatedBody` at `api.ts:4026-4029` is the same for an
`required: false` body.)

## 2. `resolveAuthContext` / `requireWebUser` semantics; steering actor grant

`resolveAuthContext` (`api.ts:2232-2272`) resolution order:
1. Better Auth session (only when web auth is enabled) → canonical user row.
2. Trusted reverse-proxy header (`ARCHON_WEB_AUTH_HEADER`, default
   `X-Archon-User`) → `findOrCreateUserByPlatformIdentity('web', headerVal, headerVal)`.
3. **`undefined`** if neither resolves — "NULL attribution, never elevated"
   (doc comment, `api.ts:2218-2220`).

On a solo install (no Better Auth configured, no proxy sending the header —
i.e. a bare `curl localhost:3090/api/...`), `getAuth()` returns falsy and no
`X-Archon-User` header is sent, so **`resolveAuthContext` returns `undefined`
— there is no identity at all.** This is a normal, supported state; it is not
itself an error (`api.ts:2214`, "3. undefined → NULL attribution, never
elevated").

`requireWebUser` (`api.ts:2293-2325`) is the strict sibling: it also resolves
Better Auth then the header, but distinguishes "no identity" (401) from "auth
backend errored" (503) — used only by connect/disconnect-style endpoints that
categorically require a resolvable web user (GitHub device flow, provider
keys, AI prefs). The global `/api/*` gate
(`api.ts:2205-2213`) itself calls `resolveAuthContext` and 401s when it
returns `undefined`, but **only when `isApiGateEnabled()`** (web auth turned
on); the gate is a no-op otherwise, so on a bare solo install every `/api/*`
route — including today's retry/abandon/ask-answer endpoints — is reachable
with no identity at all and `resolveAuthContext` still returns `undefined`
inside the handler.

The closest precedent to "steering actor grant" logic is
`authorizeWorkflowNodeRetry` (`api.ts:3064-3093`):

```ts
async function authorizeWorkflowNodeRetry(
  c: Context,
  run: WorkflowRun
): Promise<RetryAuthDecision> {
  const requester = await resolveAuthContext(c);

  if (run.user_id) {
    if (!requester) {
      return { error: apiError(c, 401, 'Authentication required to retry this workflow run') };
    }
    if (requester.userId === run.user_id) {
      return { requesterUserId: requester.userId, authorizationBasis: 'owner' };
    }
    if (requester.role === 'admin') {
      return { requesterUserId: requester.userId, authorizationBasis: 'admin' };
    }
    return { error: apiError(c, 403, 'Only the run owner or an admin can retry this node') };
  }

  if (isWebAuthEnabled() || isApiGateEnabled()) {
    if (!requester) {
      return { error: apiError(c, 401, 'Authentication required to retry this workflow run') };
    }
    if (requester.role !== 'admin') {
      return { error: apiError(c, 403, 'Only admins can retry unowned workflow runs') };
    }
    return { requesterUserId: requester.userId, authorizationBasis: 'admin' };
  }

  return {
    requesterUserId: requester?.userId ?? 'unavailable',
    authorizationBasis: requester?.role === 'admin' ? 'admin' : 'solo',
  };
}
```

Semantics: a run with `run.user_id` set requires the owner or an admin (401
if no identity, 403 if wrong identity); a run with `user_id` NULL requires
admin **only if web auth/API gate is turned on**, otherwise it falls through
to a `'solo'` authorization basis with `requesterUserId: 'unavailable'` when
there truly is no identity — i.e. **solo installs are never blocked**, they
just get a synthetic "solo" attribution. This directly answers the task's
question: "any authenticated identity allowed; run with `user_id` NULL
allowed; no identity → 401" is NOT how any existing route behaves when the
API gate is off — 401 is reserved for the case where a specific identity is
provably required (owned run, or gate enabled) and none was presented.
Whichever policy the planner picks for steering, this function is the
pattern to mirror or literally reuse.

The **answerAskHuman** route (`api.ts:4990-5034`) shows a second common
pattern — an explicit `app.use` middleware ahead of OpenAPI validation so the
401 fires before body/param validation, *and* the same check repeated inside
the handler:

```ts
app.use('/api/workflows/runs/:runId/ask/:requestId/answer', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  if (!isWebAuthEnabled() && !isApiGateEnabled()) return next();
  const requester = await resolveAuthContext(c);
  if (!requester) return apiError(c, 401, 'Authentication required');
  return next();
});

registerOpenApiRoute(answerAskHumanRoute, async c => {
  ...
  const requester = await resolveAuthContext(c);
  if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) {
    return apiError(c, 401, 'Authentication required');
  }
  ...
```

Note this route requires auth **only when web auth or the API gate is on** —
on a solo install it is open with `actorUserId: requester?.userId` (possibly
`undefined`) passed straight through to `answerAskHuman`. The
`confirmPermission` route (`api.ts:5039-5045`) instead **always** 401s with
no identity, unconditionally — a stricter variant used for permission
confirmations regardless of gate state. So the codebase has both policies in
active use; there is no single universal rule — the planner must pick one and
should state it explicitly (this task's spec calls unconditionally for `401
unauthenticated`, which matches `confirmPermission`'s stricter pattern, not
`answerAskHuman`'s solo-install carve-out).

`404`/`409` decision precedent from `answerAskHuman`'s catch block
(`api.ts:5022-5033`): known domain errors are mapped to specific statuses via
`instanceof` checks against typed errors thrown by the underlying operation
(`AskHumanRunNotFoundError`, `PendingInteractionNotFoundError` → 404;
`PendingInteractionAlreadyResolvedError`,
`PendingInteractionRunNotPausedError` → 409;
`PendingInteractionValidationError` → 400). This is the idiom to copy: do the
DB/business-logic work in a helper that throws typed errors, then translate
error class → HTTP status in the route's catch block (also used by
`retryWorkflowNodeRoute` via `getRetryErrorStatus`, `api.ts:4577-4586`, which
switches on a `.code` string instead of `instanceof`).

## 3. In-process execution and any existing runtime registry

Web-dispatched workflow execution runs **in-process, awaited synchronously**
inside the request/lock-callback flow — there is no detach/fork. The call
site for a *new* run is `runWorkflowRoute`'s handler
(`api.ts:4121-4351`, dispatch happens via `dispatchToOrchestrator` →
`orchestrator.ts:487` → `executeWorkflow`); the call site for a *retry* is
`dispatchPreparedWebRetry` (`api.ts:3183-3230`):

```ts
async function dispatchPreparedWebRetry(input: {...}): Promise<{...}> {
  const [{ executeWorkflow }, { createWorkflowDeps }] = await Promise.all([
    import('@archon/workflows/executor'),
    import('@archon/core/workflows/store-adapter'),
  ]);
  const deps = createWorkflowDeps();
  const result = await lockManager.acquireLock(input.workerPlatformId, async () => {
    webAdapter.emitLockEvent(input.workerPlatformId, true);
    try {
      const executionResult = await executeWorkflow(
        deps, webAdapter, input.workerPlatformId, input.workingPath,
        input.workflow, input.run.user_message ?? '', input.run.conversation_id,
        { codebaseId: ..., source: ..., baseBranch: ..., preCreatedRun: ..., ... }
      );
      ...
```

`executeWorkflow`'s options type is `ExecuteWorkflowOptions`
(`packages/workflows/src/executor.ts:475` onward) — a large options bag
(`codebaseId`, `baseBranch`, `issueContext`, `isolationContext`, `source`,
`parentConversationId`, `userId`, retry context, etc.), passed by value on
each call; **the executor keeps no cross-call registry of "runs currently
executing in this process."** Grep for `runningRuns` / `activeRuns` /
`inFlight` / a keyed `Map<string, …>` of live runs across
`packages/server/src`, `packages/core/src`, and `packages/workflows/src`
returned nothing matching that concept — the only comparable per-process
singleton is `ConversationLockManager`
(`packages/core/src/utils/conversation-lock.ts:34-49`), which tracks
*conversation-id → in-flight Promise* for serializing chat turns, not
run/node identity, and offers no drain/read API a node could poll.

Likewise there is **no existing mid-run interrupt/steering mechanism**: grep
for `AbortController` in `packages/workflows/src` only finds the executor's
own per-node/per-iteration cancellation controllers
(`dag-executor.ts:2209`, `5585`, `plannotator-gate-executor.ts:291`), created
fresh for each node execution and aborted only by the executor itself (idle
timeout, run cancellation) — nothing external pushes into them. `$LOOP_USER_INPUT`
and `capture_response` (approval-gate feedback) are the closest existing
"human text reaches a node" channels, but both work by **resuming a paused
run** with stored text (`/workflow approve <id> <text>`), not by injecting
into an already-running node's live stream. A steering registry keyed
`(runId, nodeId)` that a running node polls/drains mid-execution would be new
infrastructure, not a variant of anything already wired.

Where the AGENTS.md-documented container write-back port is wired for
inspiration: `ExecuteWorkflowOptions.container` (referenced at
`packages/workflows/src/executor.ts:1378: container: containerCtx,` inside
the executor, options field declared further in the same type) is injected
into `executeWorkflow` per-call as a **structural port**
(`ContainerWriteBackBackend`) precisely so `@archon/workflows` never imports
`@archon/isolation` — this is the sanctioned pattern for "a
process-wide/server-owned capability the executor needs without a package
dependency," and is the shape a steering-drain port should probably copy:
construct the registry singleton once in `packages/server/src/index.ts`
(alongside `lockManager` at line 352, right before
`registerApiRoutes(app, webAdapter, lockManager, activePlatforms)` at line
738), pass it into `registerApiRoutes` as a new parameter for the route
handler to push into, and thread a read/drain handle through
`ExecuteWorkflowOptions` (and therefore through `dispatchPreparedWebRetry`,
`orchestrator.ts:487`, `orchestrator-agent.ts:1218/1254/1316` — every
`executeWorkflow(` call site) so the DAG executor's per-node loop
(`dag-executor.ts` node execution, near where `nodeAbortController` is
created around line 2209) can drain it during a running node's `bash:`/
`script:`/AI streaming loop. Note this crosses package boundaries per
AGENTS.md's Package Split constraints — `@archon/workflows` may only depend
on `@archon/providers/types`, `@archon/git`, `@archon/paths`, so the registry
type itself would need to live in a types-only location `@archon/workflows`
is already allowed to import (mirroring how `ContainerWriteBackBackend` is
structured) rather than a new `@archon/server`-owned class reaching down into
the executor.

## 4. How the web learns node live status today

Two independent channels:

**A. SSE streams** (`hono/streaming` `streamSSE`, `api.ts:7`), keyed by
**conversation id**, not run/node id:
- `GET /api/stream/__dashboard__` (`api.ts:3723-3757`) — multiplexed, all
  workflow events across every conversation; registers into
  `webAdapter`'s `SSETransport` under the fixed key `'__dashboard__'`.
- `GET /api/stream/:conversationId` (`api.ts:3760-3793`) — per-conversation
  stream, same shape.

Both just open a raw Hono SSE stream, `writeSSE({ data: JSON.stringify({type:'heartbeat',...}) })`
every 30s, and register/deregister with `webAdapter.registerStream(id, stream)`
/ `removeStream`. The actual event payloads pushed onto these streams (e.g.
node status changes) are produced elsewhere and delivered via
`webAdapter.emitSSE(...)` — event *names*/payload shapes are not enumerated
in `api.ts` itself; they live in `packages/server/src/adapters/web/*` (e.g.
`workflow-bridge.ts`, `transport.ts`). `SSETransport`
(`packages/server/src/adapters/web/transport.ts:49-58`) buffers up to 500
events per conversation for 60s to survive reconnects, and only knows
conversation id as its key.

**B. Poll-style REST reads** (no push):
- `GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages` — the existing
  "does the web poll for node messages" endpoint. Params/query/response
  schemas (`packages/server/src/routes/schemas/workflow.schemas.ts:203-221`):

```ts
export const workflowNodeMessagesParamsSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
});
export const workflowNodeMessagesQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  occurrenceId: z.string().uuid().optional(),
  attemptId: z.string().uuid().optional(),
}).strict();
export const workflowNodeMessagesResponseSchema = z.object({
  messages: z.array(workflowNodeMessageResponseSchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean().optional(),
  highWatermark: z.number().int().nonnegative().optional(),
}).strict();
```

  Handler at `api.ts:5269-5317`: with no cursor params it returns the full
  transcript from `workflowNodeMessageDb.listNodeMessages(runId, nodeId)`
  (backed by table `remote_agent_workflow_node_messages`); with cursor params
  it does `afterSeq`/`limit`-bounded paging against a `highWatermark`. It
  reads persisted rows only — it does not report "is this node currently
  running," only its recorded transcript. 404 only when the **run** doesn't
  exist (`api.ts:5279`); an unknown `nodeId` for a real run simply returns an
  empty `messages: []` (`listNodeMessages` on a non-existent node id, no
  explicit node-existence check in this handler).
- `GET /api/workflows/runs/{runId}` (`api.ts:5346-5432`) returns
  `nodeStates: ApiWorkflowNodeState[]`, each with a `status` of
  `'pending'|'running'|'completed'|'failed'|'skipped'|'awaiting'`
  (`packages/workflows/src/schemas/workflow-run.ts:105-111`,
  `nodeStateSchema`) — this is the endpoint the console actually uses to
  know whether a node is running.

## 5. Determining node running vs. terminal for a `(runId, nodeId)`

There is **no `dag_state` column and no `node_statuses` table.** Node status
is *derived on read* from the append-only `workflow_events` table (event
types `node_started`/`node_completed`/`node_failed`/`node_skipped`/
`node_skipped_prior_success`, plus `pending_interactions` rows for
`awaiting`), via `projectLatestEffectiveNodeStates`
(`packages/workflows/src/retry-state.ts:92`, imported into `api.ts:97` from
`@archon/workflows/retry-state`) and wrapped by
`projectApiWorkflowNodeStates` (`api.ts:185-221`). The projection also
folds in `node_retry_requested`/`node_retry_reset` events so a
previously-terminal node can show `pending` again after a retry
(`retry-state.ts` handles `RETRY_EVENT_TYPES`).

`projectLatestEffectiveNodeStates(events, pending)` returns a
`Map<string, RetryNodeProjection>` keyed by `node_id`, each with
`{ node_id, state: NodeState, retry_epoch, output, error?, reason? }`. A
node that has never emitted any lifecycle event is simply **absent from the
map** — that is the signal for "node has not started" (relevant to a 404
decision for a not-yet-reached node), separate from "node id doesn't exist
in the workflow definition at all."

Node **existence** (does this `nodeId` belong to this workflow's DAG at all,
independent of whether it has run) is validated against the loaded
`WorkflowDefinition.nodes` array, not the event log — see
`packages/core/src/operations/workflow-retry.ts:189-193`:

```ts
const targetNode = input.workflow.nodes.find(node => node.id === input.nodeId);
if (!targetNode) {
  // throws a typed error carrying code 'node_not_found'
```

`retryWorkflowNodeRoute`'s handler (`api.ts:4587-4685`) composes both checks:
1. `workflowDb.getWorkflowRun(runId)` — 404 `'Workflow run not found'` if
   missing (`api.ts:4597-4599`).
2. `RETRYABLE_WORKFLOW_STATUSES.includes(run.status)` — 400 if the **run**
   itself isn't in a retryable status (`api.ts:4600-4605`).
3. `prepareWorkflowNodeRetry(...)` internally resolves the workflow
   definition and does the `workflow.nodes.find` node-existence check above,
   surfaced back to the route via `getRetryErrorStatus(error)`
   (`api.ts:4577-4586`) mapping `'node_not_found' | 'node_not_retryable' |
   'checkpoint_unavailable' | 'git_reset_failed'` → 400, everything else →
   500 (this route folds "not found" into 400, not 404 — a deviation the
   planner should decide whether to follow or diverge from, since the task
   spec wants unknown node → 404).

For the new route's 404-vs-409 split, the natural composition is:
- `getWorkflowRun(runId)` missing → 404 `not_found`.
- `nodeId` not present in `run`'s loaded `WorkflowDefinition.nodes` → 404
  `not_found` (mirrors `workflow-retry.ts`'s node-existence check, but
  returning 404 instead of that operation's 400, per this task's spec).
- `nodeId` present in the DAG but `projectLatestEffectiveNodeStates(...).get(nodeId)?.state`
  is a terminal state (`completed`/`failed`/`skipped`; arguably `cancelled`
  runs' nodes via `settleApiWorkflowNodeStatesForRunStatus`,
  `api.ts:232-251`, which forces any still-`running` node to `completed`/
  `failed` once the **run** itself reaches a terminal `WorkflowRunStatus`) →
  409 `node_finished`.
- Node absent from the projection map (never started) is a design choice for
  the planner: could be treated as 404 (nothing to steer) or a distinct
  "not yet running" case — this task's error enum only has `not_found`,
  `node_finished`, `invalid_request`, and `not_steerable_here`, so "not yet
  started" most likely also maps to `not_found` unless the planner adds a
  fifth code.

## 6. Test skeleton and package.json split rule

`packages/server/src/routes/api.workflow-runs.test.ts` (6150 lines) is the
existing home for every `/api/workflows/runs/...` route's tests, including
`retry`, `resume`, `abandon`, `ask/.../answer`, and node `messages` — there
is **no separate per-route test file** in this area; a new
`api.workflow-steering.test.ts` would be a *new convention*, not following
today's pattern (retry/resume/abandon/ask-answer/messages all share this one
file). If the planner wants a dedicated file anyway (e.g. because the mocks
needed for a steering registry conflict with something already mocked
in-file), package.json's `test` script
(`packages/server/package.json`, `scripts.test`) is a flat `&&`-chained list
of `bun test <file>` invocations, one per file/dir that needs isolation from
`mock.module` pollution — `api.workflow-runs.test.ts` already gets its own
entry (`... && bun test src/routes/api.workflow-runs.test.ts && ...`). A new
file would need exactly one more `&& bun test src/routes/api.workflow-steering.test.ts`
appended to that chain, per AGENTS.md's Testing section rule: *"When adding a
new test file with `mock.module()`, ensure its package.json test script runs
it in a separate `bun test` invocation from any conflicting files."* If
instead the new tests are added as new `describe()` blocks inside
`api.workflow-runs.test.ts`, no package.json change is needed — this is
lower-risk and matches the file's current scope.

Minimal skeleton consistent with `api.workflow-runs.test.ts`'s pattern
(`api.ts:800-849`), adapted for a new file:

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ConversationLockManager } from '@archon/core';
import type { WebAdapter } from '../adapters/web';
import { validationErrorHook } from './openapi-defaults';
import { registerApiRoutes } from './api';

const mockGetWorkflowRun = mock(async (_id: string) => null as null | MockWorkflowRun);
// ... mock.module('@archon/core/db/workflows', () => ({ getWorkflowRun: mockGetWorkflowRun, ... }))
// ... mock every export the module actually has today — an omitted export
//     keeps its REAL implementation (AGENTS.md Testing note), so a fresh
//     grep of the module's exports before writing the factory is required.

function makeApp(): { app: OpenAPIHono; mockWebAdapter: WebAdapter } {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const mockWebAdapter = { emitSSE: mock(async () => {}), emitLockEvent: mock(async () => {}) } as unknown as WebAdapter;
  const mockLockManager = { acquireLock: mock(async (_id, fn) => { await fn(); return { status: 'started' }; }) } as unknown as ConversationLockManager;
  registerApiRoutes(app, mockWebAdapter, mockLockManager);
  return { app, mockWebAdapter };
}

describe('POST /api/workflows/runs/:runId/nodes/:nodeId/send', () => {
  beforeEach(() => { mockGetWorkflowRun.mockReset(); });
  test('404 when run not found', async () => { /* ... */ });
  test('404 when node not in workflow DAG', async () => { /* ... */ });
  test('409 when node already terminal', async () => { /* ... */ });
  test('422 when run executes in a different process', async () => { /* ... */ });
  test('400 on invalid body (empty message / bad uuid / bad intent)', async () => { /* ... */ });
  test('401 with no identity', async () => { /* ... */ });
  test('200 queued', async () => { /* ... */ });
  test('200 awaiting_send_now', async () => { /* ... */ });
});
```

Auth-header test pattern already established (`api.workflow-runs.test.ts:1970`,
`4622` etc.): pass `headers: { 'X-Archon-User': '<id>' }` on the mocked
request to simulate an authenticated identity; omit it to simulate the solo/
no-identity case.

## 7. Existing 422 usage

**None.** `422` appears exactly once in `packages/server/src/` — in
`apiError`'s status-union type (`api.ts:2117`,
`400 | 401 | 403 | 404 | 409 | 422 | 500 | 503`). No route's `createRoute({responses:{...}})`
declares a `422` entry anywhere in the file (confirmed via full-file grep).
The new route would be the first real consumer, so there is no `jsonError('...')`
precedent to copy for it specifically — only the general `jsonError(description)` pattern used for every other status.

## Proposed route skeleton

Schemas (new, in `workflow.schemas.ts` alongside the other
`/nodes/{nodeId}/...` schemas at lines ~203-337):

```ts
export const sendWorkflowNodeParamsSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
}).openapi('SendWorkflowNodeParams');

export const sendWorkflowNodeBodySchema = z.object({
  message: z.string().min(1),
  message_id: z.string().uuid(),
  intent: z.enum(['queue', 'send_now']),
}).openapi('SendWorkflowNodeBody');

export const sendWorkflowNodeResponseSchema = z.object({
  success: z.literal(true),
  message_id: z.string().uuid(),
  state: z.enum(['queued', 'awaiting_send_now']),
}).openapi('SendWorkflowNodeResponse');

export const sendWorkflowNodeErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
}).openapi('SendWorkflowNodeError');
```

This error shape does **not** match `errorSchema`/`jsonError`, so the route
needs its own error-response builder (parallel to `jsonError`) and cannot
reuse `apiError` — a new `apiErrorV2`-style helper (or a route-local closure)
that emits `{ success: false, error: { code, message } }` at the given
status, plus a route-scoped `hook` (mirroring `workflowEnvValidationErrorHook`)
so Zod validation failures on `message`/`message_id`/`intent` also come back
as `{ success: false, error: { code: 'invalid_request', message } }` at 400
instead of falling through to the app-wide `{ error: string }` shape.

Route registration:

```ts
const sendWorkflowNodeRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/send',
  tags: ['Workflows'],
  summary: 'Send a steering message to a running workflow node',
  request: {
    params: sendWorkflowNodeParamsSchema,
    body: { content: { 'application/json': { schema: sendWorkflowNodeBodySchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: sendWorkflowNodeResponseSchema } }, description: 'Accepted' },
    400: { content: { 'application/json': { schema: sendWorkflowNodeErrorSchema } }, description: 'Invalid request' },
    401: { content: { 'application/json': { schema: sendWorkflowNodeErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: sendWorkflowNodeErrorSchema } }, description: 'Not found' },
    409: { content: { 'application/json': { schema: sendWorkflowNodeErrorSchema } }, description: 'Node finished' },
    422: { content: { 'application/json': { schema: sendWorkflowNodeErrorSchema } }, description: 'Not steerable in this process' },
  },
}, sendValidationErrorHook); // route-scoped hook, per registerOpenApiRoute's `hook` param
```

Handler pseudocode:

```ts
registerOpenApiRoute(sendWorkflowNodeRoute, async c => {
  const runId = c.req.param('runId') ?? '';
  const nodeId = c.req.param('nodeId') ?? '';
  const requester = await resolveAuthContext(c);
  if (!requester) return apiError2(c, 401, 'unauthenticated', 'Authentication required');

  const run = await workflowDb.getWorkflowRun(runId);
  if (!run) return apiError2(c, 404, 'not_found', 'Workflow run not found');

  const lookup = await loadWorkflowForRun(run); // resolves WorkflowDefinition, as workflow-retry.ts does
  const targetNode = lookup.workflow.nodes.find(n => n.id === nodeId);
  if (!targetNode) return apiError2(c, 404, 'not_found', 'Node not found in this run');

  const events = await workflowEventDb.listWorkflowEvents(runId);
  const pending = await workflowPendingInteractionDb.listPendingInteractions(runId);
  const projected = projectLatestEffectiveNodeStates(events, pending);
  const nodeState = projected.get(nodeId)?.state;
  if (nodeState && ['completed', 'failed', 'skipped'].includes(nodeState)) {
    return apiError2(c, 409, 'node_finished', 'Node has already finished');
  }

  if (!steeringRegistry.isOwnedByThisProcess(runId, nodeId)) {
    return apiError2(c, 422, 'not_steerable_here', "This run's executor is not in this process");
  }

  const body = getValidatedBody(c, sendWorkflowNodeBodySchema);
  const state = steeringRegistry.push(runId, nodeId, body); // 'queued' | 'awaiting_send_now'
  return c.json({ success: true, message_id: body.message_id, state });
});
```

## Risks / open questions for the planner

1. **Error-shape mismatch with every other route.** Every existing route
   (including 401/404/409 cases on adjacent run/node endpoints) returns flat
   `{ error, detail? }` via `apiError`/`errorSchema`. The task's required
   `{ success: false, error: { code, message } }` shape is unprecedented in
   this codebase and will need a parallel helper + parallel schema + a
   route-scoped validation hook, all net-new, rather than reuse of
   `apiError`/`jsonError`/`errorSchema`. Confirm this divergence is
   intentional before implementing, since it's a durable public-contract
   choice (AGENTS.md Zod conventions expect one consistent error convention).
2. **No existing in-process registry or steering primitive** — Section 3.
   This is genuinely new infrastructure: a process-wide singleton, a way to
   thread it into `ExecuteWorkflowOptions` across every `executeWorkflow(`
   call site (`api.ts:3208`, `orchestrator.ts:487`,
   `orchestrator-agent.ts:1218/1254/1316`, `executor.ts:994/1185` for
   sub-runs), and a drain point inside the DAG executor's node-execution loop
   (`dag-executor.ts`) that can act on a queued/immediate message while a
   `bash:`/`script:`/AI-streaming node is actually running. None of this
   exists today to build on.
3. **Package-boundary constraint.** Per AGENTS.md's Package Split,
   `@archon/workflows` cannot import from `@archon/server`. A registry class
   owned by the server must be exposed to the executor as a narrow
   types-only port (mirroring `ContainerWriteBackBackend`'s pattern threaded
   through `ExecuteWorkflowOptions.container`), not injected directly.
4. **422 "not in this process" detection** implies the registry (or some
   run-ownership table) must be able to answer "is `runId`'s executor
   running in *this* server process right now" — for a single-process
   deployment this is nearly always true when the run is non-terminal, but
   Archon's docs don't describe multi-process/horizontally-scaled execution
   anywhere reviewed; confirm with the planner whether 422 is meant for a
   near-future multi-instance deployment or is effectively dead code today.
5. **Auth policy choice** (Section 2): the codebase has at least three
   different auth-gating policies in active use on adjacent routes
   (always-401-if-no-identity for `confirmPermission`; 401-only-if-gate-enabled
   for `answerAskHuman`; owner-or-admin-with-solo-fallback for
   `authorizeWorkflowNodeRetry`). The task text says simply "401
   unauthenticated" as one of the possible error codes without specifying
   which policy — needs an explicit decision, not an assumption.
6. **"Node not yet started" (absent from the projection map) has no assigned
   error code** in the task's four-code enum — needs a planner decision
   (folds into `not_found`, most likely).

Status: DONE
Summary: Documented `registerOpenApiRoute`/`apiError`/`jsonError` conventions, `resolveAuthContext`/`requireWebUser`/`authorizeWorkflowNodeRetry` auth semantics, confirmed there is no existing in-process run/node registry or mid-run steering primitive, traced node-status derivation to `projectLatestEffectiveNodeStates` over `workflow_events` (no `dag_state`/`node_statuses` table), enumerated the SSE and node-messages read paths, and produced a route/schema/handler skeleton plus a package-boundary-aware registry wiring proposal.
Concerns/Blockers: The task's `{ success, error: { code, message } }` shape has no precedent (Risk #1) and the steering registry/drain mechanism is entirely new infrastructure (Risk #2/#3) — both are design decisions for the planner, not facts discoverable in the current code.
