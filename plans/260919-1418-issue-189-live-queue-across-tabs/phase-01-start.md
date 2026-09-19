---
phase: 1
title: 'Typed queue snapshot route and shared reconciliation primitives'
status: pending
priority: P1
effort: '1 session'
dependencies: []
---

# Phase 1: typed queue snapshot route and shared reconciliation primitives

## Goal

Add the mutation-free queue read contract and the framework-free state/polling
primitives both web docks need. Prove the public lifecycle and auth boundary,
the hot-path cost, race rejection, serial retry policy, and focus selection
before touching React.

## Evidence anchors

- Registry shape/order: `packages/workflows/src/steering-registry.ts`, especially
  `QueuedOperatorMessage`, `NodeSteeringHandle.snapshot()`, `withdraw()`,
  `drain()`, and `SteeringRegistry.get()`.
- Close-before-terminal invariant: direct node terminal paths and cleanup around
  `packages/workflows/src/dag-executor.ts:3290-3568`; loop registration/drain/
  cleanup around `:5669-5674` and `:6868-7119`.
- Route/schema/error precedents:
  `packages/server/src/routes/api.ts` (`sendWorkflowNodeRoute`,
  `withdrawWorkflowNodeRoute`, the pre-gate DELETE middleware,
  `steeringError()`, and both handlers),
  `packages/server/src/routes/openapi-defaults.ts`, and
  `packages/server/src/routes/schemas/workflow.schemas.ts`.
- Route tests and fixtures: the POST/DELETE steering blocks in
  `packages/server/src/routes/api.workflow-runs.test.ts`, including
  `mockSteerableRun`, `steerEvent`, `queueSteerItem`, auth-gate setup, and
  mutation assertions.
- Web shared state/API precedents: `packages/web/src/lib/steering-dock.ts`, its
  tests, `packages/web/src/lib/api.ts`, and
  `packages/web/src/experiments/console/skills/runs.ts`.

## Files

| File                                                               | Action                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` | Expand the intro beyond “write half”; document GET request/response/errors/no-store and read-vs-mutation races. |
| `packages/server/src/routes/schemas/workflow.schemas.ts`           | Add read params, queued row, and response schemas/types.                                                        |
| `packages/server/src/routes/api.ts`                                | Add route config, pre-gate auth middleware, and hot/cold-path handler.                                          |
| `packages/server/src/routes/api.workflow-runs.test.ts`             | Add focused GET contract/auth/lifecycle/performance tests.                                                      |
| `packages/web/src/lib/api.generated.d.ts`                          | Regenerate from the live OpenAPI document; never hand-edit.                                                     |
| `packages/web/src/lib/api.ts`                                      | Add typed Legacy read helper with signal and no-store request cache mode.                                       |
| `packages/web/src/experiments/console/skills/runs.ts`              | Add the equivalent Console helper through `requestJson`.                                                        |
| `packages/web/src/lib/steering-dock.ts`                            | Add generation, reconciliation, focus, and serial poll primitives; update stale docblock.                       |
| `packages/web/src/lib/steering-dock.test.ts`                       | Add deterministic tests for every new pure/poll rule.                                                           |

Do not modify the registry, executor, database, migrations, OpenAPI validation
hook, send/withdraw wire behavior, or dependencies.

## Contract and schemas

Add these schemas after the withdraw schemas, following the repository's Zod
and naming rules:

```ts
export const readWorkflowNodeQueueParamsSchema = z
  .object({ runId: z.string().min(1), nodeId: z.string().min(1) })
  .strict();

export const queuedGuidanceMessageSchema = z
  .object({ message_id: z.string().uuid(), message: z.string() })
  .strict()
  .openapi('QueuedGuidanceMessage');

export const readWorkflowNodeQueueResponseSchema = z
  .object({
    success: z.literal(true),
    queued: z.array(queuedGuidanceMessageSchema),
  })
  .strict()
  .openapi('ReadWorkflowNodeQueueResponse');

export type ReadWorkflowNodeQueueResponse = z.infer<typeof readWorkflowNodeQueueResponseSchema>;
```

`message` remains an untransformed `z.string()` because the registry contains
text previously accepted verbatim by the send route. Do not expose an
independently editable type parallel to the schema.

Update the public contract with:

- the GET row and its bodyless/no-query request;
- the exact 200 response and statement that only pending items appear in
  receipt order;
- `Cache-Control: no-store` on all route outcomes;
- the existing steering actor grant and nested error family;
- live and parked handles read normally; missing non-terminal handle is 422;
- reads never mutate or log contents;
- a read racing a send/withdraw reflects the registry at the snapshot tick,
  while the initiating client rejects a response captured before its own
  successful mutation.

## Route implementation

### Route declaration and pre-gate behavior

Define `readWorkflowNodeQueueRoute` beside the send/withdraw configs:

- method `get`;
- path `/api/workflows/runs/{runId}/nodes/{nodeId}/queue`;
- params `readWorkflowNodeQueueParamsSchema`;
- 200 `readWorkflowNodeQueueResponseSchema`;
- 400/401/403/404/409/422/500 through `steeringJsonError()`;
- description states bodyless, mutation-free, pending-only, no-store, and that
  parked handles remain readable.

Before the install-wide `/api/*` gate, add method-guarded middleware on the
message-id-less queue path. It must:

- set `Cache-Control: no-store` before either success or early error;
- return the nested 401 steering shape when auth is required and no identity
  resolves;
- call `next()` for non-GET methods so it cannot intercept the DELETE route.

This middleware is the read route's steering-grant check. The handler does not
need the requester for attribution, so it must not resolve the same identity a
third time after the route-specific and install-wide gates have run.

Register the handler with `registerOpenApiRoute(...,
steeringValidationErrorHook)` after the withdraw handler.

### Handler ladder

Use this order and no additional store reads on the success hot path:

1. `getWorkflowRun(runId)`: missing is 404, terminal run is 409. Authentication
   has already been enforced before OpenAPI validation by the middleware/gate.
2. `getSteeringRegistry().get(runId, nodeId)`.
3. When the handle exists, call `snapshot()` once. `closed` is 409; otherwise
   return the mapped `queued` array. Assert in tests that events and pending
   interactions were not queried.
4. When the handle is absent, load workflow events and call
   `projectApiWorkflowNodeStates(events)` without pending interactions. Missing
   projection is 404; terminal projected status is 409; every other known node
   is 422 `not_steerable_here`.
5. Do not perform a final run read: the route has no mutation and no await
   after a handle snapshot.
6. On exception, log `api.workflow_node_queue_read_failed` with only
   `{ err, runId, nodeId }`; return nested 500. Never log success or message
   contents.

The handler intentionally trusts the close-before-terminal registry invariant
on the hot path. Add an explanatory comment citing that invariant so a later
maintainer does not reintroduce full event-history reads into every poll.

## Web API helpers

In both API layers export generated response/row aliases and:

```ts
export async function readNodeGuidanceQueue(
  runId: string,
  nodeId: string,
  options?: { signal?: AbortSignal }
): Promise<ReadWorkflowNodeQueueResponse>;
```

- URL-encode both path segments.
- Use GET with `cache: 'no-store'` and pass the optional signal.
- Normalize failures through the existing `toSteeringSendError()` typed error
  surface; do not auto-retry in the API helper.
- Console continues to use `requestJson` and must not import `@/lib/api`.

## Shared state and pure reconciliation

Add `readonly queueGeneration: number` to `SteeringDockState` and initialize it
to `0`. Preserve all existing fields and contracts.

- `resolveGuidanceSuccess` increments the generation for every resolved active
  submission, including an idempotent receipt replay; its existing id-based
  row dedupe remains.
- A matching `resolveWithdrawSuccess` increments the generation even if a prior
  authoritative snapshot already removed the row. A stale/mismatched no-op does
  not increment.
- Begin/failure transitions never increment.

Add:

```ts
export interface QueueSnapshot {
  readonly queued: readonly {
    readonly message_id: string;
    readonly message: string;
  }[];
}

export function applyQueueSnapshot(
  state: SteeringDockState,
  snapshot: QueueSnapshot,
  generationAtRequest: number
): SteeringDockState;
```

Rules:

- a generation mismatch returns the identical state object;
- otherwise replace `sent` with mapped queued receipts in server order;
- preserve `inFlight`, `pendingRetry`, `refusal`,
  `withdrawingMessageId`, and `queueGeneration` exactly;
- if ids, text, and order already match, return the identical state object;
- never read/write draft storage and never clear a refusal based on a read.

Add `focusTargetAfterSnapshot(previousIds, nextIds, focusedMessageId)`. It
returns null when nothing focused or the id survived. If removed, choose the
nearest surviving next id in the previous order, then previous id, then the
field. It must skip any sibling also removed by the same snapshot.

## Framework-free poll loop

Add:

```ts
export interface QueuePollingOptions {
  readonly read: (signal: AbortSignal) => Promise<QueueSnapshot>;
  readonly currentGeneration: () => number;
  readonly onSnapshot: (snapshot: QueueSnapshot, generationAtRequest: number) => void;
  readonly intervalMs: number;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

export function startQueuePolling(options: QueuePollingOptions): () => void;
```

Behavior:

- read immediately;
- capture generation before each read;
- schedule the next read only after the current promise settles, so requests
  never overlap;
- normalize synchronous throws and promise rejections with
  `toSteeringSendError()` before classifying their status;
- on 422, status 0, or status >=500, preserve state and schedule the next read;
- on any other 4xx, stop without invoking `onSnapshot`;
- stop aborts the active signal, clears a pending timer, and prevents any late
  resolution/rejection callback;
- an abort caused by stop never schedules a retry.

No read-error callback is needed because Story 2.9 adds no read-specific UI.

## Tests to write before implementation

### Server route tests

Add a GET helper and a dedicated describe block covering:

1. live handle with two UUID messages returns the exact two-field rows in
   receipt order, `Cache-Control: no-store`, leaves handle phase/pending rows/
   accepted count unchanged, and invokes no event, message, or run write mock;
2. empty live handle returns `queued: []`;
3. parked handle returns retained rows without changing phase;
4. withdrawn and drained rows are absent; accepted-id count/metadata never
   appear on the wire;
5. live/parked 200 uses one run lookup and no event/pending-interaction read;
6. unknown run and unknown node return 404;
7. terminal run, terminal projected node with no handle, and closed handle
   return 409;
8. known running node without a handle returns 422;
9. actor matrix: starter, another authenticated member/admin, and auth-disabled
   solo caller receive 200; gated unauthenticated caller receives the nested 401
   before generic API middleware;
10. validation hook is registered; note that empty path segments do not match
    the router rather than fabricating an unreachable params test;
11. run/event-store exception returns nested 500, and serialized logger calls
    do not contain a queued-message sentinel;
12. the reachable 401, 404, 409, 422, and 500 responses above all carry
    `Cache-Control: no-store`, not only the 200 path; 400 remains declared for
    validation consistency, but no empty segment reaches the route.

### Shared-library tests

Cover:

1. generation initialization and increments/no-ops for every send/withdraw
   success/failure path;
2. matching snapshot wholesale replacement and exact server order, including a
   row this tab did not send;
3. identical snapshot preserves object identity;
4. stale generation preserves object identity and every row;
5. pending send/retry/refusal/withdraw fields survive reconciliation;
6. snapshot removal during an active withdraw, followed by withdraw success,
   removes once and clears the active id safely;
7. snapshot already containing an in-flight send id, followed by send success,
   remains deduplicated;
8. focus selection for surviving, next, previous, only-row, multiple-removal,
   and unknown-id cases;
9. poll starts immediately, captures generation, schedules only after settle,
   and never overlaps;
10. 422/0/500 retry with no snapshot callback;
11. 400/401/403/404/409 stop with no timer;
12. cleanup aborts/clears and suppresses late resolve and reject callbacks.

## Generated types procedure

1. Check port 3090 before starting anything. Reuse this worktree's server only
   if it is already the owner; never stop another session's process.
2. Otherwise start this worktree's server on one explicit free port, record its
   PID/port/worktree, and keep it attached to an observable tool session.
3. Confirm `/api/openapi.json` contains the GET path and both new named schemas.
4. Run `openapi-typescript` against that exact URL (the package script is valid
   only when using 3090).
5. Verify the generated diff contains only the additive path/schemas, then stop
   only the recorded process and confirm the port is released.

## Validation

Run narrow gates first:

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/web && bun test src/lib/steering-dock.test.ts)
bun run type-check
bun run lint --max-warnings 0
```

Then the affected package suites:

```bash
bun --filter @archon/server test
bun --filter @archon/web test
```

## Completion checklist

- [ ] Public steering contract updated, including intro and no-store/race text
- [ ] Read schemas/types and OpenAPI route added
- [ ] Pre-gate nested auth behavior and no-store header added
- [ ] Hot/cold handler ladder implemented without mutation or success logging
- [ ] Server tests pass, including hot-path query-count and actor matrix
- [ ] Generated types regenerated and diff inspected
- [ ] Both typed web helpers added with signal + no-store
- [ ] Generation/reconcile/focus/poller primitives and tests pass
- [ ] Affected server and web package suites pass

## Rollback

Remove the additive route/schema/helpers and shared primitives, regenerate the
OpenAPI declaration, and rerun the two package suites. There is no durable state
or migration to reverse.
