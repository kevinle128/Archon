---
title: 'Issue 189 see the same live queue across tabs and operators'
description: 'Implementation-ready plan for a typed queue snapshot route, race-safe reconciliation in both node-room docks, and focused multi-view evidence.'
status: ready
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/189'
branch: archon/thread-8205f1df
tags: [issue-189, agent-node-room, workflows, server, web, e2e, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
revised: 2026-09-19
mode: deep
---

# Issue 189: see the same live queue across tabs and operators

## Goal and user outcome

For one live steerable node, every open Legacy or Console node room must render
the same ordered, still-pending registry queue after any operator queues or
withdraws guidance. The queue is shared by `(runId, nodeId)` inside the server
process; the textarea draft and an ambiguous retry id remain private to the
browser tab.

This is the actual gap left by the merged queue and withdraw work (#207 and
#210): each dock currently knows only about POST/DELETE responses it initiated,
so reopening the room or acting from another tab leaves its in-memory receipt
list incomplete. Story 2.9 and CAP-8 explicitly require shared queued state and
tab-local unsent text.

After implementation:

- every mounted room hydrates from the registry immediately and converges again
  on a serial one-second poll;
- server receipt order and `message_id` are authoritative;
- a snapshot requested before this tab's successful send/withdraw cannot undo
  that local mutation;
- a remote withdrawal removes the row without a DELETE from the observing tab,
  and focus moves to the next row, previous row, or composer field rather than
  `<body>`;
- normal queue rendering, detached disclosure, blocked-Ask behavior, drafts,
  and delivery semantics remain otherwise unchanged.

## Repository and design authority inspected

- Issue #189 and the merged prerequisite PRs #207/#210.
- Story 2.9 in
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` and CAP-8 in
  `_bmad-output/specs/spec-agent-node-room/SPEC.md`.
- The public steering contract and route test contract in
  `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` and
  `steering-test-plan.md`.
- The final UX authorities:
  `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`
  and `DESIGN.md`. `EXPERIENCE.md` explicitly wins over mockups on conflict.
  The old `key-steering-dock.html` drawing places `this tab only` in the queued
  box, but the final spine reserves that copy for the unsent composer draft;
  current production markup and this plan follow the spine.
- Registry and lifecycle implementation in
  `packages/workflows/src/steering-registry.ts` and the direct/loop executor
  paths in `packages/workflows/src/dag-executor.ts`.
- Steering schemas, auth gates, write routes, node-state projection, and route
  tests in `packages/server/src/routes/`.
- Both web API layers, `steering-dock.ts`, both dock components and their tests,
  their keyed mount points, transcript pollers, and Console isolation rules.
- Existing queue/withdraw Playwright specs, identity contexts, runtime fixture
  seeding, fake provider directives, and workflow fixtures under `e2e/`.
- Root/package scripts, generated OpenAPI types, sprint status, and the PR
  template.

## Scope

Included:

- a typed, bodyless, non-mutating
  `GET /api/workflows/runs/:runId/nodes/:nodeId/queue` route;
- exact response/error schemas, `Cache-Control: no-store`, the public steering
  contract update, generated web types, and Legacy/Console read helpers;
- a local mutation generation, pure snapshot reconciliation, remote-removal
  focus selection, and a serial abortable poll loop in the existing shared
  `steering-dock.ts` module;
- immediate hydration and polling in both dock renderers with identical UI and
  accessibility behavior;
- server, shared-library, component, integration-regression, and focused
  multi-view Playwright coverage;
- one two-live-node E2E fixture for the required no-cross-node proof;
- acceptance evidence and the Story 2.9 sprint-status closeout after all gates
  pass.

Excluded:

- SSE, WebSocket, BroadcastChannel, cross-process persistence, migrations, or
  changes to registry/executor drain behavior;
- queue attribution/display (`operator_user_id`, Story 2.13) and
  `received_at`; array order is sufficient for this story;
- interrupt, keepalive, `Send now`, finished-iteration read-only UI (Story
  2.10), terminal `NEVER SENT` recovery (Story 2.11), and operator transcript
  rows;
- changing detached-run presentation from queue-read errors. A transient 422
  is possible between `node_started` and handle registration, and a parked
  handle is readable while new sends are refused. Read outcomes therefore do
  not set or clear steering capability/refusal state;
- changing the existing dock copy, layout, styling, or responsive structure;
- fixing the unrelated stale `2-1-queue-guidance-for-a-running-agent: backlog`
  tracker entry.

## Required design

### 1. Queue snapshot contract

Add this route to the existing steering family:

```text
GET /api/workflows/runs/:runId/nodes/:nodeId/queue
200 { success: true, queued: [{ message_id: string, message: string }] }
```

`queued` contains only the registry handle's current pending items, in receipt
order. Drained and withdrawn ids and accepted-id memory are absent. The route
does not expose `operator_user_id`, `received_at`, handle phase, or a durable
version. Every response is `Cache-Control: no-store` because the data is
process-local and changes between polls.

Authorization matches the write routes: on an authenticated install, any
resolved identity may read; a solo/auth-disabled install remains usable. Error
bodies use the nested steering shape:

- 400 `invalid_request` for route validation;
- 401/403 `unauthenticated` / `forbidden` where the steering grant rejects;
- 404 `not_found` for an unknown run or node;
- 409 `node_finished` for a terminal run, terminal projected node, or closed
  handle;
- 422 `not_steerable_here` for a known non-terminal node with no handle in this
  process;
- 500 `internal_error` for an unexpected read failure.

A live or parked handle returns 200. This is a read of retained queue state,
not permission to enqueue. It is intentionally mutation-free and emits no
success log at poll frequency.

### 2. Server hot and cold paths

Do not copy the write route's three-store-read ladder onto every one-second
poll. The executor closes a direct-node handle before the first awaited
terminal write and loop cleanup follows the same invariant; cancellation also
discards run handles. Use that invariant as follows:

1. Enforce auth in the route-specific/install-wide gates, then read the run
   once. The handler does not resolve the requester again because this read has
   no attribution side effect. Unknown run is 404; terminal run is 409.
2. Read the registry handle synchronously.
3. If a handle exists, take one snapshot in the same tick. Closed is 409;
   `live` or `parked` returns the mapped queue immediately. Do not list events
   or pending interactions on this normal hot path.
4. Only when no handle exists, list workflow events and project node state to
   distinguish unknown node (404), terminal node (409), and known non-terminal
   node without an in-process handle (422). Pending interactions are not needed
   for this classification: a started/awaiting node is non-terminal, and a
   terminal lifecycle event remains authoritative.
5. There is no final run re-read. Nothing mutates, no await occurs between the
   handle snapshot and response, and a close immediately after the snapshot
   merely makes it the last truthful snapshot.

This keeps the common route to auth + one run lookup + an in-memory snapshot,
instead of repeatedly loading an unbounded workflow event history for every
open room.

### 3. Reconciliation and races

`SteeringDockState` gains `queueGeneration`, initially `0`. A matching
send-success or withdraw-success transition increments it; failures and
same-state no-ops do not. Each read captures the current generation before it
starts. `applyQueueSnapshot` applies the response only when that captured value
still equals the current state value.

An accepted snapshot replaces `sent` wholesale with server rows in server
order and maps each row to the existing `state: 'queued'` presentation. It
preserves send/withdraw progress, pending retry, refusal, and the generation.
It must return the same state object when ids/text/order are unchanged. Queue
reads never touch the textarea or sessionStorage.

The generation protects only this tab's completed mutations. Remote mutation
races may show the immediately preceding truthful snapshot for at most one
poll, after which the serial next read converges; no cross-tab clock or
timestamp is introduced.

### 4. Poll lifecycle and failure policy

The framework-free poller starts immediately, never overlaps reads, and waits
one interval after a read settles before starting the next. One
`AbortController` covers its lifetime; cleanup aborts an active read, clears a
pending timer, and prevents late callbacks.

Failure policy is deliberately non-visual:

- 422, transport failures, and 5xx preserve the last snapshot and retry. A 422
  may be the real detached case or the short registration window, and the read
  cannot distinguish them.
- 400/401/403/404/409 stop that poll instance without changing dock state. They
  are contract/auth/target failures for which hot-loop retry is not useful;
  the parent run/room state or a remount owns the next transition.
- No read failure writes `dock.refusal`, hides the field, changes detached copy,
  or clears an existing refusal from a send/withdraw action.

Both docks poll only while their existing mode is `composer` or `blocked`.
Continuing in `blocked` keeps a parked queue shared. `hidden` historical or
terminal rooms do not read, and an existing send-triggered `detached`
disclosure stops reading; a queue read never creates or clears that state.

### 5. Focus and rendering

Before applying a snapshot, identify whether `document.activeElement` is one
of the current row delete buttons. Only when the snapshot actually applies and
removes that id, queue the existing focus transfer: nearest surviving next
row, then previous row, then the textarea. A stale or identical snapshot must
not schedule focus. A local withdraw's already-recorded target wins over a
remote snapshot, and focus waits until that withdraw settles.

Every queue `<li>` gains `data-message-id` as a stable test/debug identity.
No user-visible markup or copy changes otherwise.

## Visual and interaction acceptance

The final `EXPERIENCE.md` and `DESIGN.md` are authoritative. On both shells:

- An empty snapshot shows no queue band. A non-empty snapshot uses the existing
  full-width `surface-elevated` band immediately above the padded composer,
  headed `QUEUED · n`, with one end-elided line, `sent`, and a 24px-minimum
  delete target per item in server order.
- The band never says `this tab only`; that phrase remains beside the unsent
  composer draft. Hydration and later reconciliation add no loading spinner,
  animation, toast, or error copy.
- The list remains internally scrollable past `33vh`, the field remains the
  only inset well, and the queue/control row does not introduce horizontal page
  or room overflow.
- Removing the focused row remotely preserves a visible, logical focus target;
  it never lands on `<body>`. Pointer, keyboard activation, accessible names,
  `role="status"` count wording, and tab order remain unchanged.
- Verify the hydrated-two-row and converged-one-row states at a 460×900
  viewport for both shells (the only contract width), and also capture Console
  at 1440×900 to prove its normal wide composition. The same ids/order must be
  visible in simultaneous views at the capture point.

There is no unresolved design conflict: where the older mock puts `this tab
only` inside the band, the final Experience spine explicitly overrides it.

## Phases

| #   | Phase                                                                                                             | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [Typed queue snapshot route and shared reconciliation primitives](./phase-01-start.md)                            | Pending |
| 2   | [Both docks hydrate and reconcile the shared queue](./phase-02-both-docks-read-and-reconcile-the-shared-queue.md) | Pending |
| 3   | [Focused multi-view E2E evidence and closeout](./phase-03-two-tab-e2e-evidence-and-closeout.md)                   | Pending |

Phase 1 owns the public contract, server route, generated types/API helpers,
and framework-free logic. Phase 2 wires both renderers and proves shell parity.
Phase 3 adds only the minimum real-browser fixtures/scenarios needed for the
story and closes the tracker after full validation.

## Measurable acceptance criteria

- [ ] The GET route returns the exact pending registry ids/text in receipt
      order for live and parked handles, never mutates the handle, never caches,
      and returns the documented nested errors.
- [ ] A successful hot-path read performs no workflow-event or
      pending-interaction query; no success log contains or emits message text.
- [ ] Snapshot reconciliation is authoritative, identity-stable for an
      unchanged queue, and rejects reads captured before a successful local
      mutation.
- [ ] Both docks hydrate immediately, poll serially at 1000ms in `composer`
      and `blocked` modes, abort on unmount/scope change, retry transient/422
      failures, and stop on permanent 4xx without changing dock capability
      state.
- [ ] A remote send/withdraw converges every observing view to the same ordered
      ids/count; the observer issues no duplicate DELETE, and tab-local text and
      retry storage are unchanged.
- [ ] Remote removal of a focused row moves focus next → previous → field and
      never to `<body>`.
- [ ] Console and Legacy pass the visual criteria at 460×900, Console also at
      1440×900, with no copy/layout regression.
- [ ] Real-browser coverage proves same-operator tabs, starter/teammate
      contexts, ordered identity convergence, local drafts, keyboard focus, and
      no cross-node leakage.
- [ ] Focused tests, both affected package suites, E2E typecheck/scenarios, and
      `bun run validate` pass before sprint status changes to `done`.

## Compatibility, rollout, operations, and rollback

- The API change is additive. No database, migration, configuration, feature
  flag, dependency, or durable data conversion is required.
- Queue state remains process-local and dies on server restart, as CAP-8
  already specifies. This work does not make multi-process routing safe and
  does not claim to.
- At most one queue read is in flight per mounted dock. Successes are not
  logged; responses are `no-store`; permanent client/auth/target failures do
  not hot-loop.
- A server/client skew is safe: an older client ignores the new route; a newer
  client against an older server preserves its local receipts and retries the
  404 only until its poller classifies the permanent 4xx and stops. The normal
  deployment still ships server and bundled web together.
- Rollback is one PR revert: remove the GET route/schema/helpers, generated type
  additions, poll/reconcile wiring, tests, fixture, and tracker change. There is
  no stored state to unwind. Regenerate `api.generated.d.ts` from the reverted
  OpenAPI document rather than editing generated declarations by hand.

## Risks and controls

- **Stale local snapshot:** guarded by `queueGeneration` and explicit race
  tests for send and withdraw.
- **Poll amplification:** serial scheduling, no success logging, no-store, stop
  on permanent 4xx, and the handle hot path avoid overlap and repeated full
  event-history reads. Final E2E measurements record GET counts per page.
- **Startup 422:** reads do not infer detached mode; 422 retries without UI
  mutation.
- **Read source disappears:** 422/transport/5xx retain the last truthful list
  instead of inventing an empty snapshot. A send-triggered detached state,
  parent lifecycle update, or remount owns presentation cleanup; terminal
  undelivered-message recovery remains Story 2.11.
- **Focus loss:** focus is scheduled only for an applied removal and uses the
  existing next/previous/field rule.
- **Cross-scope contamination:** route keys, dock keys, generation state, and
  the E2E pair fixture all assert `(runId, nodeId)` isolation.
- **Test resource leaks:** every created browser context/page listener is closed
  or disposed in `finally`; poll tests prove abort/timer cleanup.

## Independent revision record

The prior draft's claims were rechecked from source rather than carried
forward. The revision removes four unsupported or incorrect directions:

1. Queue-read 422s no longer create a three-strike detached state or rewrite
   the existing detached E2E. The threshold had no product authority and could
   misclassify the executor's normal startup registration window as a
   capability change.
2. A successful queue read no longer clears a send/withdraw refusal. A parked
   handle proves that readability and send capability are different contracts.
3. The server read path no longer repeats the write route's full event and
   pending-interaction projection on every successful live poll.
4. E2E work is consolidated into one multi-view convergence journey and one
   cross-node journey per shell. It no longer duplicates the existing
   withdraw-to-provider drain proof or claims the worker-scoped runtime is
   recreated per test.

No blocker or unresolved product/design question remains.
