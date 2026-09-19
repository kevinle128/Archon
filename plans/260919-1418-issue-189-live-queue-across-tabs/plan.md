---
title: 'Issue 189 see the same live queue across tabs and operators'
description: 'Implementation-ready plan for a typed queue read route, snapshot reconciliation in both node-room docks, and two-tab E2E convergence evidence.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/189'
branch: archon/thread-8205f1df
tags: [issue-189, agent-node-room, workflows, server, web, e2e, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
mode: deep
---

# Issue 189 see the same live queue across tabs and operators

## Outcome

Every open node room for the same live agent node shows the same server-side
steering queue. Story 2.1 (#207) and Story 2.2 (#210) made the POST/DELETE
responses the only queue evidence a tab ever sees, so two tabs — or two
authenticated operators — diverge the moment either of them queues or
withdraws. This plan adds the read half:

`GET /api/workflows/runs/:runId/nodes/:nodeId/queue`

and makes both docks (Legacy `ComposerDock`, Console `ConsoleComposerDock`)
hydrate from it on mount and re-read it on the same 1-second live cadence the
transcript already uses. After this plan:

- both views converge on the same `queued · n` header and the same ordered
  `message_id` list, taken from the node's registry handle;
- only queued items are shared — each tab's unsent draft and ambiguous retry
  id stay in that tab's `sessionStorage`, untouched by any snapshot;
- an item withdrawn in one view disappears from the other on its next read
  with no second DELETE and no stale count;
- a snapshot that raced a local send or withdraw can never resurrect a removed
  row or drop an accepted one;
- a remote removal never drops keyboard focus to `<body>`;
- a two-tab / two-operator Playwright spec proves convergence, message
  identity, keyboard access, and no cross-node leakage on both shells.

## Scope

Included:

- one typed GET route with the send/withdraw lifecycle ladder, nested error
  family, and route-scoped 401 middleware;
- response schema, contract-doc "Read" section, regenerated web types, and a
  read helper in both API layers (Legacy `lib/api.ts`, Console
  `skills/runs.ts`);
- pure snapshot-reconcile and poll-loop logic in the shared
  `steering-dock.ts`, with a mutation-generation guard against stale
  snapshots and a focus-recovery rule for snapshot-driven removals;
- the poll effect in both dock renderers; docblock corrections in both;
- the Story 2.1 detached scenario update forced by the read route;
- focused registry/server/library/component tests, a two-tab E2E spec on both
  shells with evidence, and the sprint-status closeout.

Excluded:

- per-row operator attribution or display (Story 2.13) — `operator_user_id`
  is not put on the read wire;
- Stop/interrupt/keepalive/`Send now`, finished-iteration read-only band
  (Story 2.10), terminal `NEVER SENT` recovery (Story 2.11);
- SSE or any push transport — the AC's "normal live update path" is the
  existing 1-second poll in `NodeTranscriptPane`/`ConsoleNodeRoom`;
- registry changes (`snapshot()` already exists), persistence, migrations,
  workflow events, executor drain changes, new dependencies;
- correcting the stale `2-1-queue-guidance-for-a-running-agent: backlog`
  tracker line (excluded by the Story 2.2 plan; unchanged here).

## Verified repository evidence

- Story 2.9 AC and refs:
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:669-695`.
  CAP-8 (`SPEC.md:84`) states a queued message "is visible to any tab or
  operator viewing the same running node".
- `steering-api-contract.md` documents only the write half; a read route is
  new public API and the doc must gain a row (precedent: the parked-queue
  clarification added by #210).
- `packages/workflows/src/steering-registry.ts:144-150` — `snapshot()`
  returns `{ phase, queued: [...pending], acceptedCount }` in receipt order.
  No registry change is needed.
- `packages/server/src/routes/api.ts:5244-5324` (send) and `:5327-5424`
  (withdraw) share the lifecycle ladder: 404 unknown run/node → 409
  `node_finished` (terminal run, terminal projected node, closed handle) →
  422 `not_steerable_here` (no handle). Only the DELETE route-scoped 401
  middleware (`:2293-2307`) is registered before the install-wide gate
  (`:2323-2333`); the POST one at `:5225-5242` is registered after it. The
  GET middleware must follow the DELETE placement.
- `packages/web/src/lib/steering-dock.ts:1-9` and both dock docblocks say "no
  polling, no queue read, no rehydration (Story 2.9)"; both must change.
- `packages/web/src/components/workflows/NodeTranscriptPane.tsx:46-57,170-231`
  — `transcriptRefetchInterval` is 1000 ms for `pending|running|paused`; the
  drain loop re-schedules after each response and tears down with an
  `AbortController`. `ConsoleNodeRoom.tsx:563` mirrors it.
- `packages/web/src/experiments/console/console-isolation.test.ts:103-159`
  approves `@/lib/steering-dock` for Console room files; a new lib module
  would need an allowlist edit, so all shared logic stays in
  `steering-dock.ts`.
- `packages/server/src/routes/api.ts:2381-2387` — `X-Archon-User` resolves an
  identity even with web auth off; `e2e/lib/playwright/archon-runtime.ts:77-78`
  already exposes `starterWebUser`/`teammateWebUser`. No E2E spec sets
  `extraHTTPHeaders` today, so browser-side sends carry a null operator.
- `e2e/ui/agent-queue-guidance.spec.ts:515-563` — the detached scenario
  asserts the composer stays visible until a send returns 422 with the
  comment "No queue read exists yet". The read route changes that flow.
- `e2e/fixtures/workflows/e2e-queue-guidance.yaml` holds one node open for
  30 s; `e2e-queue-guidance-loop.yaml` holds `steer-loop` for 25 s per
  iteration. Cross-node leakage needs two live steerable nodes in one run.

## Design decisions

1. **Read route, not embedded state.** The queue is in-process registry
   state, not a DB row, so it must not be folded into the DB-backed
   `/messages` or run projection responses. A dedicated GET keeps the
   steering contract in one route family with one error shape.
2. **Read refusals drive dock mode, self-healing.** A 422
   `not_steerable_here` from the read flips the dock to the detached
   disclosure (CAP-8 / EXPERIENCE state 8) instead of waiting for a send to
   fail — but only after **three consecutive** 422 reads, and the poll keeps
   running in detached mode so a later 200 clears the disclosure and returns
   the composer. Reason: `dag-executor.ts:2018-2021` persists `node_started`
   before the registry handle is registered at `:3001` (28 awaits later), so
   an already-open room can legitimately read 422 for a moment on an
   in-process run. 409/404 on a read stop the poll silently — the dock hides
   when the row leaves `running`/`awaiting`. Network failures keep the last
   snapshot and retry next tick. A send/withdraw 422 still flips immediately
   (unchanged).
3. **Mutation-generation guard.** `SteeringDockState` gains
   `queueGeneration`, bumped when a local send or withdraw *succeeds*. A
   snapshot is applied only if the generation captured when its request
   started still matches. This is what makes "no duplicate request or stale
   count" hold under the send/withdraw-vs-poll race.
4. **Server order is authoritative.** A snapshot replaces `sent` wholesale in
   registry order; the local-receipt append path stays for the window between
   a 200 and the next snapshot.
5. **Focus recovery on remote removal.** If the focused delete button belongs
   to a row the snapshot removed, focus moves next → previous → field using
   the existing `nextFocusAfterRemoval` rule.
6. **Shared logic, duplicated effects.** Pure reconcile + poll-loop helpers
   live in `steering-dock.ts`; each dock wires a short effect (precedent:
   submit/withdraw are already duplicated per shell).

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Typed queue read route, contract, and shared reconcile logic](./phase-01-start.md) | Pending |
| 2 | [Both docks read and reconcile the shared queue](./phase-02-both-docks-read-and-reconcile-the-shared-queue.md) | Pending |
| 3 | [Two-tab E2E evidence and closeout](./phase-03-two-tab-e2e-evidence-and-closeout.md) | Pending |

## Dependency map

- Phase 1 has no dependencies. It ships the route, schemas, regenerated
  types, both API helpers, and every pure `steering-dock.ts` function with
  its unit tests. Phase 2 imports those functions; Phase 3 calls the route.
- Phase 2 depends on Phase 1 (helpers + generated types). It updates the
  Story 2.1 detached E2E scenario because dock behavior changes here.
- Phase 3 depends on Phases 1–2 and is the closeout gate (sprint-status).

## Success criteria

- [ ] `GET …/queue` returns `{ success: true, queued: [{ message_id, message }] }`
      in registry order for a live or parked handle; 401/404/409/422 use the
      nested steering error shape; the route never mutates the queue.
- [ ] `applyQueueSnapshot` drops stale snapshots, replaces rows in server
      order, and preserves `inFlight`, `pendingRetry`, `refusal`,
      `withdrawingMessageId`; draft/retry storage is never touched by a read.
- [ ] Both docks hydrate on mount, re-read every 1000 ms while live, tear down
      on unmount/scope change, stop on 409/404, go detached after three
      consecutive read 422s, and recover the composer on a later 200.
- [ ] A row removed by another view disappears with zero DELETE requests from
      the observing tab and the count matches the server.
- [ ] Two-tab / two-operator E2E passes on Console and Legacy: same
      `data-message-id` order in both views, keyboard access after remote
      removal, and no queue rows from a sibling node.
- [ ] `bun run validate` and `(cd e2e && npm run typecheck)` pass;
      `2-9-…: done` in sprint-status.

## Rollback

Every phase is additive. Reverting the PR removes the route, the helpers,
and the poll effects; the Story 2.1/2.2 behavior returns byte-for-byte. The
only file needing care is `api.generated.d.ts`, which must be regenerated
rather than hand-reverted.

## Validation Log

### Session 1 — 2026-09-19 (planning, advisor-reviewed; no human interview in this automated run)

Verification pass (Standard tier, 3 phases): every `file:line` anchor in
the three phase files was re-read against the tree after authoring; four
anchors that had drifted (registry `snapshot()`, dock state/scope-reset
lines) were corrected. Claims checked: 28. Verified: 28 | Failed: 0 |
Unverified: 0.

Decisions recorded (each would have been an interview question under
`mode=prompt`; the alternative is stated so a reviewer can reverse it):

1. **Read refusal drives dock mode, self-healing (chosen) vs read refusals
   non-mutating vs stop-on-422.** Chosen because CAP-8 / EXPERIENCE state 8
   want the room to disclose "not steerable here" as soon as it is known,
   and a poll that is refused every second while the composer stays up would
   hide that knowledge. Stop-on-422 was rejected after the advisor review:
   `dag-executor.ts:2018-2021` writes `node_started` before the handle is
   registered at `:3001`, so an open room would read 422 during startup and
   be stranded as detached on an in-process run. The three-read confirmation
   streak keeps the transient window from showing the "started detached"
   copy at all in the common case, and continued polling heals the rare
   longer window. Cost: the Story 2.1 detached E2E scenario
   (`agent-queue-guidance.spec.ts:515-563`) must be rewritten (Phase 2).
2. **Dedicated GET route (chosen) vs folding the queue into the
   `/messages` poll response.** The queue is in-process registry state, the
   transcript is DB state; one route family per source keeps the steering
   error contract intact and lets Story 2.10's read-only band reuse the read.
3. **1-second poll on the transcript cadence (chosen) vs SSE.** No push
   transport exists for runs in `@archon/web`; the AC's "normal live update
   path" is the poll. SSE would be a new transport with no other consumer.
4. **`operator_user_id` / `received_at` kept off the wire (chosen).**
   Story 2.13 owns attribution; a field with no consumer is YAGNI.
5. **Mutation-generation guard (chosen) vs timestamp comparison.** The
   generation is what the send/withdraw callbacks already know; timestamps
   would need clock discipline the tests cannot control.
6. **Two-node pair fixture for cross-node leakage (chosen) vs reusing the
   loop fixture.** The loop fixture has one node; leakage needs two live
   handles in one run.

### Whole-Plan Consistency Sweep (Validation Session 1)

Re-read `plan.md` and all three phase files after the red-team edits.
Searched every plan file for `stop on 422`, `then stop`, `scenario 6`,
`scenario 7`, `1–7`, `QueueReadOutcome`, and `mode !== 'detached'` — no
stale occurrences remain. Success criteria, design decision 2, Phase 1
poll-loop rules and tests 12/12b, Phase 2 effect gating / `onRefusal` /
tests 8–8b / detached-scenario rewrite, and Phase 3 scenario numbering all
describe the same self-healing 422 behavior. No unresolved contradictions.

## Red Team Review

Reviewer: advisor (stronger-model review of the full transcript), acting as
the Assumption Destroyer + Failure Mode Analyst lenses; the plan has 3
phases so the Security Adversary lens was covered by the per-phase security
sections and the identity checks below. Findings without `file:line`
evidence were not raised.

| # | Severity | Finding | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| 1 | Critical | Phase 3 scenario 6 depended on scenario 1's run state; each Playwright test gets its own run, so there was nothing to drain. | `e2e/lib/playwright/suite.ts:11-24` (per-worker runtime, per-test runs) | **Accepted** — drain proof folded into scenario 1's tail; scenarios renumbered 1–6. |
| 2 | Critical | "Stop polling on read 422" strands an in-process room as detached: `node_started` is persisted before the steering handle exists, so an open room reads 422 during startup. | `packages/workflows/src/dag-executor.ts:2018-2021` (`node_started` write) vs `:3001` (`register()`), 28 awaits apart | **Accepted (modified)** — 422 keeps polling and self-heals on a later 200; additionally the dock discloses detached only after `DETACHED_READ_CONFIRMATIONS = 3` consecutive 422s so the registration window shows no misleading "started detached" copy. Library tests 2c/9b/9c/12b and dock tests 8/8b added. |
| 3 | High | Evidence section claimed both the DELETE and POST route-scoped 401 middlewares precede the install-wide gate; only the DELETE one does. | `packages/server/src/routes/api.ts:2293-2307` (DELETE, before gate at `:2323-2333`) vs `:5225-5242` (POST, after) | **Accepted** — sentence corrected; Phase 1 placement instruction (beside DELETE) was already right. |
| 4 | High | `## Red Team Review` and the consistency sweeps were missing, so the plan could not be declared ready. | skill `references/red-team-workflow.md` Step 8–9 | **Accepted** — this section and both sweeps added. |
| 5 | Medium | `applyQueueSnapshot` returning a fresh array for an identical snapshot re-renders the band and re-fires the `[dock.sent, …]` focus effect at 1 Hz. | `packages/web/src/components/workflows/ComposerDock.tsx:141-152` | **Accepted** — identity short-circuit added to Phase 1 with test 2b. |
| 6 | Medium | Driving focus with `Tab` in E2E scenario 4 tests room tab order, not the AC. | `e2e/ui/agent-withdraw-guidance.spec.ts` focus assertions pattern | **Accepted** — scenario uses `locator.focus()`. |
| 7 | Low | Snapshot clearing *any* refusal would erase a local send's 409 alert one second later. | `packages/web/src/lib/steering-dock.ts` `resolveGuidanceFailure` / `refusal` channel | **Accepted** (raised during fix 2) — a snapshot clears only a `not_steerable_here` refusal; other refusals persist until the operator's next action. |
| 8 | Low | Detached → composer heal unmounts the focused disclosure, dropping focus to `<body>`. | `ComposerDock.tsx:135-137` (detached focus effect has no reverse path) | **Accepted** (raised during fix 2) — Phase 2 heal-focus rule + test 8b. |

Accepted 8 / rejected 0. Files modified: `plan.md`, `phase-01-start.md`,
`phase-02-both-docks-read-and-reconcile-the-shared-queue.md`,
`phase-03-two-tab-e2e-evidence-and-closeout.md`.

### Whole-Plan Consistency Sweep (Red Team)

Decision delta: (a) 422-on-read is self-healing with a 3-read confirmation;
(b) snapshot clears only `not_steerable_here`; (c) identity short-circuit;
(d) drain proof lives in E2E scenario 1; (e) POST middleware claim
corrected. Every plan file was re-read and each delta reconciled in the
outcome bullets, success criteria, design decisions, Validation Log,
Phase 1 state/reconcile/poll sections and tests, Phase 2 goal/effect/tests/
detached-scenario/risk sections, and Phase 3 scenarios/timing/todo/risks.
Second pass (advisor re-review): Phase 3 scenarios 2–4 still assumed
scenario 1's run, pages, and message ids — the same defect as finding #1.
Each scenario now dispatches its own run, creates its own contexts, and
names its own messages; the timing note says the interaction budget is
per test. Phase 2's dock test count corrected from 7 to 13. No
contradictions remain; the plan is ready for implementation.

<!-- slug: issue-189-live-queue-across-tabs -->
