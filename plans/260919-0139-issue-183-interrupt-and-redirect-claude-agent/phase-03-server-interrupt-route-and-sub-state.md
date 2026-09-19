---
phase: 3
title: 'Server: interrupt route, Send now flush, sub-state'
status: pending
priority: P1
effort: '1d'
dependencies: [2]
---

# Phase 3: Server — interrupt route, Send now flush, sub-state

## Goal

`POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt` ends the live turn and answers with the actual end state; `intent: 'send_now'` on the existing send route flushes an idle node's queue; `GET /api/workflows/runs/:runId` carries the projected steering sub-state on each node; `api.generated.d.ts` is regenerated so both shells consume typed wire shapes.

Deep mode: outline; scout pass `reports/scout-260919-0830-server-web-dock.md` §1–2 precedes execution.

## Context links

- Contract: `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` (interrupt response `{ success:true, sub_state }`, 409 `node_finished`, idempotent repeat while idle, races fold into the queue).
- Anchors: send route definition `packages/server/src/routes/api.ts:1576-1606`; `steeringJsonError` `:654-662`; `steeringError` `:2188-2196`; auth/JSON pre-middleware `:5179-5197`; handler `:5199-5290` (projection, `TERMINAL_API_NODE_STATUSES` `:241`, last gate `:5250-5258`); `nodeStates` assembly `:5605-5608`; `projectApiWorkflowNodeStates` `:190-234`; schemas `packages/server/src/routes/schemas/workflow.schemas.ts:160-176` (`workflowNodeStateSchema`) and the Story 2.1 send schemas; `openapi-defaults.ts`.

## Files

| File                                                     | Action | Change                                                                                                 | Test impact       |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ | ----------------- |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | Modify | `interruptWorkflowNodeResponseSchema` (`sub_state` enum), widen send response `state` to include `awaiting_send_now`, `steeringSubState` on `workflowNodeStateSchema`, add `not_interruptible` to the documented error codes | route tests, regen |
| `packages/server/src/routes/api.ts`                      | Modify | Interrupt route (auth pre-middleware for POST without body, handler), `send_now` flush, sub-state join   | route tests       |
| `packages/server/src/routes/openapi-defaults.ts`         | Modify | Register the new route's response defaults like the send route                                         | spec snapshot     |
| `packages/server/src/routes/api.workflow-runs.test.ts`   | Modify | Interrupt/send_now/sub-state tests                                                                     | —                 |
| `packages/web/src/lib/api.generated.d.ts`                | Regen  | `bun --filter @archon/web generate:types` against a server on this worktree's port (record PID; stop only it) | web types |

## Refactor (protected change) — route behavior

1. **Interrupt handler** mirrors the send handler's ladder in order: identity (401 when gated) → run 404 → projection + handle → 409 `node_finished` for terminal run/node or closed handle → 422 `not_steerable_here` when no handle or when the handle is `parked` (the node is at an ask; nothing live to interrupt — mirrors the send route's `not_live` refusal) → 422 `not_interruptible` when the handle was registered with `interruptible: false` → last-gate re-read of run status → `const pending = handle.interrupt()` (synchronous abort of the per-turn signal) → `await pending` → map `idle-after-interrupt` / `generating` to 200 `{ success:true, sub_state }` and `node_finished` to 409. Repeated interrupt while idle returns 200 `idle-after-interrupt` without a second abort. A refusal never mutates run, queue, or transcript.
2. **Send now.** In the send handler after `enqueue()`: when `body.intent === 'send_now'` and `handle.subState() === 'idle-after-interrupt'`, call `handle.sendNow()` (drains synchronously, wakes the executor). Response `state`: `awaiting_send_now` when the message is still waiting on an idle node (`intent:'queue'` while idle), otherwise `queued` (Decision D7). Remove the Story 2.1 placeholder comment at `:5273-5275`.
3. **Sub-state join.** In the GET run handler, after `projectApiWorkflowNodeStates`, map each node: `const handle = getSteeringRegistry().get(runId, nodeId); if (handle && handle.snapshot().phase === 'live') state.steeringSubState = handle.subState();` — only for live runs, never for terminal ones (the settle helper at `:250` already runs first).
4. **OpenAPI.** Register with `registerOpenApiRoute(createRoute({...}), handler, steeringValidationErrorHook)`; the interrupt route has no `request.body`.

## Tests before

- Existing send-route suite (`-t 'queued guidance'`) green; the send response schema still accepts `queued`.
- GET run response for a run with no live handle is byte-identical (no `steeringSubState` key).

## Tests after

| #   | Scenario                                                                                          | Expect                                   |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | interrupt on a live generating handle whose executor settles `idle-after-interrupt`               | 200 `sub_state:'idle-after-interrupt'`   |
| 2   | interrupt racing a natural end with a queued message (executor settles `generating`)              | 200 `sub_state:'generating'`             |
| 3   | interrupt racing a natural end with an empty queue (`node_finished`)                              | 409 `node_finished`                      |
| 4   | repeat interrupt while idle                                                                       | 200 idempotent, no second abort          |
| 5   | actor ladder on interrupt: starter / other member / admin / identity-less run → allowed; unauthenticated → 401 | mirrors send tests            |
| 6   | unknown run/node → 404; terminal run/node → 409; no handle or parked handle → 422 `not_steerable_here`; non-interruptible handle → 422 `not_interruptible` | nothing mutated |
| 7   | `send_now` on idle: enqueue + `sendNow()` called; response `state:'queued'`; `queue` on idle → `awaiting_send_now` | D7                        |
| 8   | send while an interrupt is in flight lands in the queue (no 409)                                  | contract race rule                       |
| 9   | GET run includes `steeringSubState` only for nodes with a live handle in this process             | join                                     |
| 10  | OpenAPI spec snapshot includes the interrupt route and new enums                                  | regen                                    |

## Regression gate

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/server && bun test src/routes/openapi-defaults.test.ts 2>/dev/null || true)
bun run lint && bun run type-check
```

## Todo

- [ ] Scout pass: confirm the route test harness and how the registry is seeded in tests
- [ ] Schemas + error code
- [ ] Interrupt route + middleware
- [ ] `send_now` flush + response state
- [ ] Sub-state join on GET run
- [ ] Regenerate `api.generated.d.ts` (start server on the worktree port, record PID, stop only it)
- [ ] Tests After 1–10 green

## Success criteria

Route tests green; regenerated types compile in `@archon/web`; the send route's existing behavior for `intent:'queue'` on a generating node is unchanged.

## Risk assessment

- The interrupt handler awaits the executor's classification; bound the await with the request lifetime only (no server-side timer) — the executor always settles on every terminal path (Phase 2 test 13).
- Regeneration requires the server; follow the process-management rules (deterministic port, PID tracking).

## Next steps

Phase 4 consumes `interruptNode`, the widened send response, and `steeringSubState`.
