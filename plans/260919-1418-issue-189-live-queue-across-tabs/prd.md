# PRD — Issue 189: See the same live queue across tabs and operators

## Overview

**Problem.** For one live steerable node, every open Legacy or Console node
room must render the same ordered, still-pending registry queue after any
operator queues or withdraws guidance. Today each dock only knows about the
POST/DELETE responses it initiated itself: reopening the room, or acting from
another tab/operator, leaves its in-memory receipt list incomplete. This is
the gap left by the merged queue/withdraw work (PRs #207/#210). Story 2.9 and
CAP-8 explicitly require shared queued state with tab-local unsent text.

**Solution.** Add a typed, bodyless, mutation-free
`GET /api/workflows/runs/:runId/nodes/:nodeId/queue` snapshot route; add
generation-guarded reconciliation, remote-removal focus selection, and a
serial abortable 1-second poll loop to the shared framework-free
`steering-dock.ts` module; wire both dock renderers to hydrate immediately and
converge on the poll; prove it with focused tests plus two parameterized
multi-view Playwright journeys; close out Story 2.9 in the sprint tracker.

**Invariants.**

- The queue is shared by `(runId, nodeId)` inside the server process; the
  textarea draft and ambiguous retry id remain private to the browser tab.
- Server receipt order and `message_id` are authoritative.
- A snapshot requested before this tab's successful send/withdraw must not
  undo that local mutation (`queueGeneration` guard).
- A remote withdrawal removes the row without a DELETE from the observing
  tab; focus moves next → previous → composer field, never to `<body>`.
- Queue reads never mutate dock capability/refusal state, never create or
  clear detached state, never touch draft/sessionStorage, and never log
  message contents.

## Goals and success metrics

- Every mounted room hydrates from the registry immediately and converges
  again on a serial one-second poll (only in `composer`/`blocked` modes).
- Hot-path read = auth + one run lookup + one in-memory handle snapshot; no
  workflow-event or pending-interaction queries on the 200 path.
- Same ordered ids visible in simultaneous same-operator tabs and
  second-operator views; observer issues zero DELETEs for remote removals.
- Remote removal of a focused row moves focus to next surviving row →
  previous row → field; never `<body>`.
- Both shells pass visual criteria at 460×900; Console also at 1440×900; no
  copy/layout regression (`this tab only` stays beside the composer draft).
- `bun run validate` green before the Story 2.9 sprint entry flips to `done`.

## Non-goals

- No SSE, WebSocket, BroadcastChannel, cross-process persistence, or
  migrations; queue state stays process-local and dies on restart.
- No queue attribution/display (`operator_user_id`, Story 2.13) or
  `received_at`; array order is sufficient.
- No interrupt, keepalive, `Send now`, finished-iteration read-only UI
  (Story 2.10), terminal `NEVER SENT` recovery (Story 2.11), or operator
  transcript rows.
- No detached-presentation changes from queue-read errors: a transient 422
  (registration window between `node_started` and handle registration) and a
  real detached/parked handle are both just retried; reads do not set or
  clear steering capability/refusal state.
- No copy, layout, styling, or responsive changes; no loading spinner,
  animation, toast, or error copy for hydration/reconciliation.
- Do not fix the unrelated stale `2-1-...: backlog` tracker entry.
- Do not modify the registry, executor, database, migrations, OpenAPI
  validation hook, send/withdraw wire behavior, or dependencies.

## Technical context

### Contract

```text
GET /api/workflows/runs/:runId/nodes/:nodeId/queue
200 { success: true, queued: [{ message_id: string, message: string }] }
Cache-Control: no-store on EVERY outcome
```

`queued` = only the handle's current pending items, in receipt order. No
`operator_user_id`, `received_at`, handle phase, or durable version. Error
family (nested steering shape): 400 `invalid_request`, 401/403
`unauthenticated`/`forbidden`, 404 unknown run/node, 409 `node_finished`
(terminal run, terminal projected node, or closed handle), 422
`not_steerable_here` (known non-terminal node, no in-process handle), 500
`internal_error`. Live or parked handle → 200. Mutation-free; no success
logging.

### Server hot/cold ladder (phase 1)

1. Pre-gate method-guarded middleware on the queue path: sets
   `Cache-Control: no-store` before success or error, returns nested 401 when
   auth is required and no identity resolves, calls `next()` for non-GET so
   DELETE passes through. This IS the read's steering-grant check — the
   handler must not resolve the requester again.
2. `getWorkflowRun(runId)`: missing → 404, terminal run → 409.
3. `getSteeringRegistry().get(runId, nodeId)` synchronously.
4. Handle exists → one `snapshot()` in the same tick: `closed` → 409,
   `live`/`parked` → mapped queue. No event/pending-interaction reads.
5. No handle → list workflow events + `projectApiWorkflowNodeStates(events)`
   (no pending interactions): missing projection → 404, terminal → 409, else
   → 422.
6. No final run re-read. On exception: log
   `api.workflow_node_queue_read_failed` with `{ err, runId, nodeId }` only;
   nested 500.

Key invariant: the executor closes a direct-node handle before the first
awaited terminal write (dag-executor.ts ~3290–3568; loop cleanup ~5669–5674,
~6868–7119), so a live handle snapshot is truthful without re-reading events.
Leave a comment citing it so nobody reintroduces full event-history reads.

### Shared reconciliation (phase 1)

- `SteeringDockState.queueGeneration` starts at `0`; `resolveGuidanceSuccess`
  and matching `resolveWithdrawSuccess` increment it (including idempotent
  receipt replay and withdraw of an already-removed row); begin/failure and
  stale no-ops do not.
- `applyQueueSnapshot(state, snapshot, generationAtRequest)`: mismatch →
  identical object; else replace `sent` wholesale with server-ordered
  `state: 'queued'` receipts, preserve `inFlight`/`pendingRetry`/`refusal`/
  `withdrawingMessageId`/`queueGeneration`, identical ids+text+order →
  identical object; never touches draft storage, never clears a refusal.
- `focusTargetAfterSnapshot(previousIds, nextIds, focusedMessageId)`: null
  when nothing focused or id survived; else nearest surviving next id, then
  previous id, then field; skips siblings removed by the same snapshot.
- `startQueuePolling(options)`: reads immediately, captures generation per
  read, next read scheduled only after settle (never overlaps), one
  AbortController, stop() aborts + clears timer + suppresses late callbacks.
  422/status 0/≥500 → retry silently; other 4xx → stop without `onSnapshot`.
  Errors normalized via `toSteeringSendError()` before status classification.

### Component wiring (phase 2)

- New optional props on both docks: `readQueue?: ReadNodeGuidanceQueue`
  (defaults to the shell helper), `pollIntervalMs?: number` (default 1000,
  test seam only).
- `dockRef.current = dock` updated during render; poller reads
  `queueGeneration` from it; acceptance happens inside functional `setDock`.
- `pollingEnabled` only for `composer`/`blocked` modes; effect keyed by
  `runId`, `nodeId`, `readQueue`, `pollIntervalMs`, `pollingEnabled`; returns
  stop function; do NOT put `dock` in deps.
- `onSnapshot`: capture focused row id from `deleteButtonsRef`, call
  `applyQueueSnapshot` in a functional update; on same-identity return, do
  nothing; on applied removal of the focused id and `pendingFocusRef` null,
  set `focusTargetAfterSnapshot(...)`; existing post-commit focus effect does
  the DOM focus and yields to an active local withdraw.
- Each queue `<li>` gains `data-message-id={receipt.messageId}`; nothing else
  in the markup changes.
- Parent room tests get a strict fetch spy returning
  `{ success: true, queued: [] }` only for GET `.../queue`, rejecting all
  else; restored in `afterEach`.

### E2E (phase 3)

- New fixture `e2e/fixtures/workflows/e2e-queue-guidance-pair.yaml`: two
  independent `e2e-fake` nodes `steer-a`/`steer-b`, no `depends_on`, 45s
  `delayMs` directive, `mutates_checkout: false`; seeded via exports in
  `e2e/lib/playwright/archon-runtime.ts`.
- New spec `e2e/ui/agent-queue-convergence.spec.ts`, parameterized over
  `console`/`legacy`:
  - `[V:steer.converge-${surface}]`: 3 views (starterA+starterB same context,
    teammate context) at 460×900; `viewer_is_starter` proof; per-tab drafts;
    send → all DOM lists + both identity GETs converge to `[starterId]` then
    `[starterId, teammateId]`; remote withdraw → `[teammateId]` then `[]`;
    observer DELETE count = 0; focus next → field; drafts/storage unchanged;
    overflow guard + screenshots (Console also 1440×900).
  - `[V:steer.scope-${surface}]`: two nodes, `A-only`/`B-only` messages never
    leak; navigate A→B→A proves keyed re-hydration.
- Sync rule: never wait on the "next" GET (it may predate the mutation);
  `expect.poll` on the complete DOM/server id arrays; arm POST/DELETE
  response waiters before the triggering action.
- Evidence per test/surface JSON + named screenshots under
  `plans/260919-1418-issue-189-live-queue-across-tabs/reports/evidence/`;
  `reports/acceptance.md` maps each Story 2.9 Given/When/Then to test ids,
  focused tests, artifacts, and commands. Then flip only
  `2-9-see-the-same-live-queue-across-tabs-and-operators` to `done` in
  `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`.

### Authoritative sources

- UX: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`
  (wins over mockups; `this tab only` is composer-only) and `DESIGN.md`
  (33vh list, 460px contract width).
- Contract: `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`
  (must be extended with the GET) and `steering-test-plan.md`.
- Story: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`
  (Story 2.9, ~lines 669–695); `_bmad-output/specs/spec-agent-node-room/SPEC.md`
  CAP-8.
- Plan: `plan.md`, `phase-01-start.md`,
  `phase-02-both-docks-read-and-reconcile-the-shared-queue.md`,
  `phase-03-two-tab-e2e-evidence-and-closeout.md` in this directory.

### Key files

| File                                                                                                                                    | Role                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/workflows/src/steering-registry.ts`                                                                                           | `QueuedOperatorMessage`, `NodeSteeringHandle.snapshot()`, `withdraw()`, `drain()`, `SteeringRegistry.get()` — read only |
| `packages/server/src/routes/api.ts`                                                                                                     | send/withdraw route configs, `steeringError()`, pre-gate DELETE middleware — add GET route + middleware + handler       |
| `packages/server/src/routes/schemas/workflow.schemas.ts`                                                                                | add params/row/response schemas after withdraw schemas                                                                  |
| `packages/server/src/routes/api.workflow-runs.test.ts`                                                                                  | `mockSteerableRun`, `steerEvent`, `queueSteerItem`, auth-gate setup — add GET describe block                            |
| `packages/web/src/lib/api.ts` / `packages/web/src/experiments/console/skills/runs.ts`                                                   | `readNodeGuidanceQueue(runId, nodeId, { signal })` helpers; Console uses `requestJson`, never `@/lib/api`               |
| `packages/web/src/lib/api.generated.d.ts`                                                                                               | regenerate via `openapi-typescript` from live server; never hand-edit                                                   |
| `packages/web/src/lib/steering-dock.ts` + `.test.ts`                                                                                    | generation, `applyQueueSnapshot`, `focusTargetAfterSnapshot`, `startQueuePolling`                                       |
| `packages/web/src/components/workflows/ComposerDock.tsx` + `.test.tsx`                                                                  | Legacy wiring                                                                                                           |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` + `.test.tsx`                                                 | Console mirror                                                                                                          |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`, `.../ConsoleNodeRoom.test.tsx`                                     | strict queue-GET fetch stubs                                                                                            |
| `e2e/fixtures/workflows/e2e-queue-guidance-pair.yaml`, `e2e/lib/playwright/archon-runtime.ts`, `e2e/ui/agent-queue-convergence.spec.ts` | new fixture, seed/exports, spec                                                                                         |

## Story overview

| ID     | Title                                                   | Phase | Depends on     |
| ------ | ------------------------------------------------------- | ----- | -------------- |
| US-001 | Queue snapshot route + shared reconciliation primitives | 1     | —              |
| US-002 | Both docks hydrate and reconcile the shared queue       | 2     | US-001         |
| US-003 | Multi-view E2E evidence and Story 2.9 closeout          | 3     | US-001, US-002 |
