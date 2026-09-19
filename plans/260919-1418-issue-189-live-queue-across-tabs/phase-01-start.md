---
phase: 1
title: 'Typed queue read route, contract, and shared reconcile logic'
status: pending
priority: P1
effort: '1 session'
dependencies: []
---

# Phase 1: Typed queue read route, contract, and shared reconcile logic

## Goal

Ship the read half of the steering contract — a bodyless, mutation-free
`GET /api/workflows/runs/:runId/nodes/:nodeId/queue` — together with the
pure `steering-dock.ts` functions both docks will use in Phase 2: snapshot
reconciliation guarded by a mutation generation, a framework-free poll loop,
and a focus-recovery rule for rows removed by another view. Everything in this
phase is unit-testable without React or a browser.

## Source anchors

- Story: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:669-695`
  (Story 2.9). CAP-8: `_bmad-output/specs/spec-agent-node-room/SPEC.md:84`.
- Public contract: `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`
  (write routes only today; the "Read" row is added here).
- Registry: `packages/workflows/src/steering-registry.ts:144-150`
  (`snapshot()`), `:41-45` (`SteeringHandleSnapshot`), `:23-28`
  (`QueuedOperatorMessage` — `message`, `messageId`, `operatorUserId`,
  `receivedAt`).
- Route precedent: `withdrawWorkflowNodeRoute` (`api.ts:1613-1637`), its
  pre-gate DELETE-only middleware (`api.ts:2293-2307`), and the handler
  ladder (`api.ts:5327-5424`). `steeringError()` at `api.ts:2218-2225`.
  `TERMINAL_API_NODE_STATUSES` at `api.ts:241`.
- Validation hook: `steeringValidationErrorHook`
  (`packages/server/src/routes/openapi-defaults.ts:51-73`).
- Schemas: `packages/server/src/routes/schemas/workflow.schemas.ts:579-606`
  (withdraw params/response precedent).
- Route tests: the withdraw block in
  `packages/server/src/routes/api.workflow-runs.test.ts:6693-…` with its
  `liveSetup()` / `expectNoSteeringMutation()` helpers and the
  `mockSteerableRun()` / `steerEvent()` fixtures above `:6241`.
- Web library: `packages/web/src/lib/steering-dock.ts` (full file) and
  `steering-dock.test.ts` (`describe('withdraw transitions')` at `:246`).
- API layers: `packages/web/src/lib/api.ts:749-806` (Legacy helpers via
  `fetchJSON`) and `packages/web/src/experiments/console/skills/runs.ts:160-203`
  (Console helpers via `requestJson`; console isolation forbids importing
  `@/lib/api`).

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` | modify | +1 route row, +1 request line, +1 response line, +1 race bullet | none (doc) |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | modify | +~30 lines: `readWorkflowNodeQueueParamsSchema`, `queuedGuidanceMessageSchema`, `readWorkflowNodeQueueResponseSchema` + types | schema parse tests via route tests |
| `packages/server/src/routes/api.ts` | modify | +~25 (route config) +~10 (GET-only pre-gate middleware) +~70 (handler) | new server tests |
| `packages/server/src/routes/api.workflow-runs.test.ts` | modify | +~200 lines: new `describe('GET …/queue')` block | new |
| `packages/server/src/routes/openapi-defaults.ts` | none | doc comment already says "any later steering route" | — |
| `packages/web/src/lib/api.generated.d.ts` | regenerate | additive path + 2 schemas | type-check |
| `packages/web/src/lib/api.ts` | modify | +~25: `readNodeGuidanceQueue` + exported types | Phase 2 dock tests inject it |
| `packages/web/src/experiments/console/skills/runs.ts` | modify | +~20: `readNodeGuidanceQueue` | Phase 2 console dock tests |
| `packages/web/src/lib/steering-dock.ts` | modify | +~140: `queueGeneration`, `readRefusalStreak`, `DETACHED_READ_CONFIRMATIONS`, `applyQueueSnapshot`, `resolveQueueReadRefusal`, `focusTargetAfterSnapshot`, `startQueuePolling`, docblock rewrite | new unit tests |
| `packages/web/src/lib/steering-dock.test.ts` | modify | +~180 lines across 3 new `describe` blocks | new |

Do not edit `steering-registry.ts`, `dag-executor.ts`, the send/withdraw
handlers' behavior, database code, or the validation hook.

## Contract — the read route

Add to `steering-api-contract.md` after the DELETE row:

| Method + path | Purpose |
| --- | --- |
| `GET /api/workflows/runs/:runId/nodes/:nodeId/queue` | **Read** the node's still-pending registry queue in receipt order — the convergence source every open room polls on its normal live cadence. Never mutates. |

Request: none (no body, no query). Response:
`{ success: true, queued: [{ message_id: string, message: string }] }` —
receipt order, pending items only (drained and withdrawn ids are absent;
accepted-id memory is not exposed). Errors reuse the table: 401/403, 404
`not_found`, 409 `node_finished` (terminal run, terminal projected node, or
closed handle), 422 `not_steerable_here` (no handle in this process). A
**parked** handle (node paused at an Ask) reads normally — its retained queue
is exactly what the other tab needs to see. Add one race bullet: "**Read racing
a send or withdraw** — the read reflects whichever mutation landed first; the
client reconciles by `message_id` and discards a snapshot requested before its
own mutation resolved."

`operator_user_id` and `received_at` are deliberately not on the wire: Story
2.13 owns attribution, and adding them now would be a public field with no
consumer.

## Schemas

In `workflow.schemas.ts` after `withdrawWorkflowNodeResponseSchema`:

```ts
export const readWorkflowNodeQueueParamsSchema = z
  .object({ runId: z.string().min(1), nodeId: z.string().min(1) })
  .strict();

export const queuedGuidanceMessageSchema = z
  .object({ message_id: z.string().uuid(), message: z.string() })
  .strict()
  .openapi('QueuedGuidanceMessage');

export const readWorkflowNodeQueueResponseSchema = z
  .object({ success: z.literal(true), queued: z.array(queuedGuidanceMessageSchema) })
  .strict()
  .openapi('ReadWorkflowNodeQueueResponse');

export type ReadWorkflowNodeQueueResponse = z.infer<typeof readWorkflowNodeQueueResponseSchema>;
```

`message` is `z.string()` without a blank refinement — the route echoes what
the send route already accepted verbatim.

## Route

1. Route config `readWorkflowNodeQueueRoute` next to `withdrawWorkflowNodeRoute`
   (`api.ts:1613`): `method: 'get'`, path
   `/api/workflows/runs/{runId}/nodes/{nodeId}/queue`, tag `Workflows`,
   `request.params: readWorkflowNodeQueueParamsSchema`, responses 200
   (`readWorkflowNodeQueueResponseSchema`), 401/403/404/409/422/500 via
   `steeringJsonError(...)`. Description must say it never mutates and that
   parked handles read normally.
2. Pre-gate middleware beside the DELETE one (`api.ts:2298`): the same body,
   guarded by `c.req.method !== 'GET'` and mounted on
   `/api/workflows/runs/:runId/nodes/:nodeId/queue` (no `:messageId`). This is
   required so a gated install returns the nested 401 shape instead of the
   generic `apiError` 401 from the `/api/*` gate at `api.ts:2323-2333`.
3. Handler registered with `registerOpenApiRoute(readWorkflowNodeQueueRoute,
   handler, steeringValidationErrorHook)` directly after the withdraw
   handler. Ladder, in this order, mirroring `api.ts:5340-5388`:
   - resolve requester; 401 when gated and unresolved;
   - `getWorkflowRun` → 404 `not_found`;
   - project node state (`listWorkflowEvents` + `listPendingInteractions` →
     `projectApiWorkflowNodeStates`) and `getSteeringRegistry().get(runId, nodeId)`;
   - both undefined → 404; terminal run → 409; terminal projected node → 409;
     handle phase `closed` → 409; handle undefined → 422;
   - **no final run re-read** — the read mutates nothing, so the
     concurrent-terminal race the write routes guard against has no
     partial-mutation consequence; a snapshot from a handle that closes a tick
     later is simply the last true snapshot;
   - `const snapshot = handle.snapshot()` then
     `c.json({ success: true, queued: snapshot.queued.map(m => ({ message_id: m.messageId, message: m.message })) }, 200)`.
   - `catch` → log `api.workflow_node_queue_read_failed` with `{ err, runId, nodeId }`
     (never message content) → 500 `internal_error`.
   Do not log on success — this route runs once per second per open room.

## Web API helpers

`lib/api.ts` after `withdrawNodeGuidance`:

```ts
export type ReadWorkflowNodeQueueResponse = components['schemas']['ReadWorkflowNodeQueueResponse'];
export type QueuedGuidanceMessage = components['schemas']['QueuedGuidanceMessage'];

export async function readNodeGuidanceQueue(
  runId: string,
  nodeId: string,
  options?: { signal?: AbortSignal }
): Promise<ReadWorkflowNodeQueueResponse> { /* fetchJSON GET …/queue; catch → throw toSteeringSendError(error) */ }
```

`skills/runs.ts`: the same signature over `requestJson`, same
`toSteeringSendError` normalization. Both accept an `AbortSignal` so the
poll loop can cancel an in-flight read on unmount.

## Shared library — `steering-dock.ts`

Rewrite the file docblock: the POST/DELETE responses are no longer the only
queue evidence; the GET snapshot is the convergence source and this module
owns reconciliation.

### State

```ts
export interface SteeringDockState {
  readonly sent: readonly LocalSentReceipt[];
  readonly inFlight: boolean;
  readonly pendingRetry: PendingSubmission | null;
  readonly refusal: SteeringRefusal | null;
  readonly withdrawingMessageId: string | null;
  /**
   * Bumped by every locally observed server mutation (send 200, withdraw
   * 200). A snapshot requested under an older generation is discarded: it
   * was read before this tab's own mutation landed and could resurrect a
   * withdrawn row or drop an accepted one.
   */
  readonly queueGeneration: number;
  /**
   * Consecutive read 422s. The dock discloses "detached" only once this
   * reaches DETACHED_READ_CONFIRMATIONS, because an in-process node emits
   * `node_started` (dag-executor.ts:2018-2021) before its steering handle
   * exists (:3001), so an open room legitimately reads 422 for a moment.
   */
  readonly readRefusalStreak: number;
}

export const DETACHED_READ_CONFIRMATIONS = 3;
```

`createSteeringDockState()` sets `queueGeneration: 0` and
`readRefusalStreak: 0`. `resolveGuidanceSuccess` and
`resolveWithdrawSuccess` return `queueGeneration: state.queueGeneration + 1`
(only on the non-no-op path). Failures never bump.

### Reconcile

```ts
export interface QueueSnapshot { readonly queued: readonly { message_id: string; message: string }[] }

export function applyQueueSnapshot(
  state: SteeringDockState,
  snapshot: QueueSnapshot,
  generationAtRequest: number
): SteeringDockState
```

- `generationAtRequest !== state.queueGeneration` → return `state` unchanged.
- Otherwise `sent` becomes the snapshot rows mapped to `LocalSentReceipt`
  (`state: 'queued'`) in server order — wholesale replacement, including
  rows this tab never sent and rows re-ordered by the server.
- **Identity short-circuit:** when the snapshot's `(message_id, message)`
  sequence equals the current `sent` sequence and nothing else would change,
  return the same `state` object. Without this the band re-renders and the
  `[dock.sent, …]` focus effect re-fires at 1 Hz.
- `readRefusalStreak` resets to 0, and a stored `refusal` whose `code` is
  `not_steerable_here` is cleared (the node is steerable now — this is the
  self-heal). Any other refusal (a 409 alert from a local send, an ambiguous
  transport failure) is preserved: the operator's own action put it there
  and only their next action clears it.
- `inFlight`, `pendingRetry`, `withdrawingMessageId`, and `queueGeneration`
  are carried through untouched. Draft/retry storage is not this function's
  concern and must not be referenced.

### Read refusal

```ts
export function resolveQueueReadRefusal(
  state: SteeringDockState,
  refusal: SteeringRefusal
): SteeringDockState
```

- `code === 'not_steerable_here'` → `readRefusalStreak + 1`; when the new
  streak `>= DETACHED_READ_CONFIRMATIONS`, also set `refusal` (the existing
  `steeringDockMode` then reports `detached`). Below the threshold the state
  changes only by the streak — rows, mode, and any existing refusal stay.
- Any other code → return `state` unchanged (the poll loop never calls this
  for 409/404 — it stops — but the function must be total).
- A withdraw in flight whose id is absent from the snapshot simply loses its
  row; `withdrawingMessageId` stays set until the DELETE settles (existing
  `resolveWithdrawSuccess` filter is then a no-op and clears the id).

### Focus after a remote removal

```ts
export function focusTargetAfterSnapshot(
  previousIds: readonly string[],
  nextIds: readonly string[],
  focusedMessageId: string | null
): RemovalFocusTarget | null
```

Returns `null` when `focusedMessageId` is null or still present in
`nextIds`; otherwise `nextFocusAfterRemoval(previousIds, focusedMessageId)`
evaluated against the previous order, then re-validated: if the chosen
sibling is also absent from `nextIds`, walk forward then backward through
`previousIds` for the nearest survivor, else `{ kind: 'field' }`.

### Poll loop

```ts
export interface QueuePollingOptions {
  readonly read: (signal: AbortSignal) => Promise<QueueSnapshot>;
  readonly currentGeneration: () => number;
  readonly onSnapshot: (snapshot: QueueSnapshot, generationAtRequest: number) => void;
  readonly onRefusal: (refusal: SteeringRefusal, status: number) => void;
  readonly intervalMs: number;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

/** Starts immediately; returns the stop function. */
export function startQueuePolling(options: QueuePollingOptions): () => void
```

Rules, each one a test:

- reads immediately on start, then re-schedules `intervalMs` **after each
  response settles** (never overlapping reads);
- captures `currentGeneration()` *before* each read and passes it to
  `onSnapshot`;
- a `SteeringSendError` with status 409 or 404 → `onRefusal` then **stop**
  (no further reads);
- status 422 → `onRefusal` and **keep polling** at the same cadence (Phase 2
  feeds it to `resolveQueueReadRefusal`; a later snapshot heals it);
- status 0 / other statuses (transport, 500) → no callback, keep polling;
- the stop function aborts the in-flight read via its `AbortSignal`, clears
  the pending timer, and guarantees no callback fires after stop, even if
  the aborted promise settles later.

## Tests before (TDD — write and watch fail first)

### `steering-dock.test.ts`

`describe('queue snapshot reconciliation')`:

1. initial state has `queueGeneration: 0`; send success bumps to 1; withdraw
   success bumps again; send failure, withdraw failure, and the no-op
   withdraw paths do not bump.
2. matching generation replaces `sent` wholesale in server order, including
   a row this tab never sent and a server re-order.
2b. an identical snapshot returns the same state object (`toBe`), so a
   steady queue produces no re-render.
2c. a snapshot clears a stored `not_steerable_here` refusal and resets the
   streak; a stored 409 / transport refusal survives the snapshot.
3. stale generation (request started at 0, state now 1) returns the same
   state object.
4. snapshot preserves `inFlight`, `pendingRetry`, `refusal`,
   `withdrawingMessageId`.
5. withdraw in flight + snapshot lacking that id → row gone, id retained;
   then `resolveWithdrawSuccess` clears the id with no throw and no
   duplicate.
6. send in flight + snapshot already containing that id → later
   `resolveGuidanceSuccess` dedupes (one row, generation bumps once).

`describe('focusTargetAfterSnapshot')`:

7. focused id still present → `null`; no focus → `null`.
8. focused id removed → next sibling from previous order; last row → previous;
   only row → field.
9. chosen sibling also removed → nearest survivor, forward then backward.

`describe('resolveQueueReadRefusal')`:

9b. two `not_steerable_here` refusals leave `refusal` null and mode
   `composer`; the third sets it and `steeringDockMode` reports `detached`;
   a snapshot after that returns to `composer` with streak 0.
9c. a non-422 code returns the same state object.

`describe('startQueuePolling')` (inject `setTimer`/`clearTimer` fakes and a
deferred `read`):

10. reads once on start with the generation captured before the read.
11. re-schedules only after the response settles; interval honored.
12. 409 / 404 → `onRefusal` with status, then no further read or timer.
12b. 422 → `onRefusal` with status **and** the next read is scheduled; a
    following 200 reaches `onSnapshot`.
13. status 0 and 500 → no callback, next read scheduled.
14. stop aborts the in-flight signal, clears the timer, and a late resolve or
    reject invokes no callback.

### `api.workflow-runs.test.ts`

New `describe('GET /api/workflows/runs/:runId/nodes/:nodeId/queue — read queued guidance')`
using the withdraw block's helpers:

15. live handle with two enqueued ids → 200, `queued` in receipt order with
    verbatim text, and `expectNoSteeringMutation` after the read.
16. empty live handle → `{ success: true, queued: [] }`.
17. parked handle (pending Ask, node still `running`) → 200 with retained rows.
18. withdrawn / drained ids are absent; accepted-id memory not exposed.
19. unknown run → 404; unknown node with no handle → 404.
20. terminal run / terminal projected node / closed handle → 409 `node_finished`.
21. no handle on a running node → 422 `not_steerable_here`.
22. gated install without identity → nested 401 shape (pre-gate middleware),
    and the same request with `X-Archon-User` → 200.
23. the route registers `steeringValidationErrorHook` for shape parity, but
    both params are `min(1)` and the router never matches an empty segment,
    so no params-validation test exists — say so in a one-line comment at the
    top of the block instead of faking one.
24. handler throw (mock `listWorkflowEvents` rejecting) → 500
    `internal_error`, nothing logged with message content.

## Refactor (protected code changes)

- `resolveGuidanceSuccess` / `resolveWithdrawSuccess`: add the generation
  bump; existing tests at `steering-dock.test.ts:203-331` remain green.
- Existing dock component tests reference `createSteeringDockState()` shape
  only through the component; adding a field is additive.

## Tests after

- All new unit tests green; `bun test packages/web/src/lib/steering-dock.test.ts`
  and `bun test packages/server/src/routes/api.workflow-runs.test.ts`.
- `api.generated.d.ts` diff shows only the new path and two schemas.

## Type regeneration procedure

1. `lsof -i :3090`; if occupied by another session, do not stop it.
2. Start this worktree's server with an explicit free `PORT`, record the PID.
3. Confirm `/api/openapi.json` on that port lists the GET path and
   `ReadWorkflowNodeQueueResponse`; then run `openapi-typescript
   http://localhost:<port>/api/openapi.json -o src/lib/api.generated.d.ts`
   from `packages/web` (or `bun --filter @archon/web generate:types` when
   3090 is the port).
4. Inspect the diff; stop only the recorded PID; confirm the port released.

## Todo

- [ ] Contract doc "Read" row, request/response lines, race bullet
- [ ] Schemas + types in `workflow.schemas.ts`
- [ ] Route config, GET-only pre-gate middleware, handler
- [ ] Server route tests 15–24 written first, then green
- [ ] `steering-dock.ts`: generation + streak fields, `applyQueueSnapshot`,
      `resolveQueueReadRefusal`, `focusTargetAfterSnapshot`,
      `startQueuePolling`, docblock rewrite
- [ ] Library tests 1–14 (incl. 2b/2c/9b/9c/12b) written first, then green
- [ ] Regenerate `api.generated.d.ts`; add `readNodeGuidanceQueue` to both
      API layers
- [ ] `bun run type-check`, `bun run lint`, `bun --filter @archon/server test`,
      `bun --filter @archon/web test`

## Regression gate

```bash
bun run type-check && bun run lint
bun test packages/web/src/lib/steering-dock.test.ts
bun test packages/server/src/routes/api.workflow-runs.test.ts
bun run test
```

## Risk assessment

- **Stale-snapshot resurrection** is the defining bug of this story; the
  generation guard plus tests 3, 5, 6 are the mitigation. Do not "simplify"
  it to a timestamp comparison — the generation is what the mutation
  callbacks already know.
- **Poll overlap** under slow reads: the loop re-schedules after settle, so
  at most one read is in flight per dock.
- **Per-tick cost**: the ladder does three store reads (`getWorkflowRun`,
  `listWorkflowEvents`, `listPendingInteractions`) per poll — the same
  profile as the transcript poll already running on that page. A detached
  run keeps polling at 1 Hz while its room is open; accepted, because it is
  what makes the startup window self-heal and it costs no more than the
  transcript poll beside it.
- **Log volume**: no info log on read success.
- **Pre-gate middleware path**: mounting on the `:messageId`-less path must
  not intercept DELETE; guard on method.

## Security considerations

- Identity rules match the write routes (any authenticated identity; solo
  installs allowed). The read exposes operator message text already visible
  in the same room via the send response — no new disclosure class — but it
  is now readable by any authenticated operator who can open the run, which
  is exactly CAP-8's stated visibility.
- No message content in logs.
