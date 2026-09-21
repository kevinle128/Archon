---
title: 'Issue 192: fail an abandoned redirect safely after 30 minutes'
description: 'Verified implementation plan for Story 2.12: bound idle-after-interrupt with a fixed inactivity timer, authenticated composing keepalive, explicit node failure, fresh-session retry, and accessible dock states.'
status: pending
priority: P1
effort: '5 phases · ~22h'
issue: 'https://github.com/kevinle128/Archon/issues/192'
branch: archon/thread-f6f11c80
tags: [issue-192, agent-node-room, story-2-12, workflows, server, web, e2e, feature]
blockedBy: []
blocks: []
created: 2026-09-20
mode: deep
tdd: true
verifiedAt: d89ff7b6762d38b25d3df95a7f88191c44955ca5
---

# Issue 192: fail an abandoned redirect safely after 30 minutes

## Goal and user outcome

Story 2.12 closes the unbounded wait introduced by interrupt-and-redirect. When
an interruptible agent has settled in `idle-after-interrupt`, 30 minutes with
no composer activity must fail that node exactly once with
`interrupted by operator, no redirect received`. Keystroke or focus activity
must re-arm the timer through an authenticated, bodyless keepalive request
without sending prose or waking the executor. `Send now`, workflow Cancel, and
expiry remain a first-wins race. Any queued messages are recovered by Story
2.11 as `NEVER SENT`; retrying through the supported node-retry operation starts
a fresh provider session. Legacy and Console disclose the limit before it can
surprise the operator.

This matches GitHub issue #192 and Story 2.12 in
`_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`. The tracker
shows both blockers, Stories 2.3 and 2.11, as `done`; Story 2.12 remains
`backlog` until this implementation and its evidence pass.

## Acceptance criteria

| ID      | Measurable result                                                                                                                                                                                                                                                                                                                                         | Proof                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| AC1     | After 30 minutes of genuine composer inactivity in `idle-after-interrupt`, the prompt/command node, AI loop node, or loop-group body fails once with the exact error. It emits no `node_completed`, never posts `completed via idle timeout`, and does not set `nodeIdleTimedOut`.                                                                        | Registry and executor tests; real-timer E2E                            |
| AC2     | Focus or editing keystrokes while idle cause authenticated keepalive requests. A request re-arms but never resolves idle-await. A burst is bounded to at most one request per 30 seconds, and a final activity inside a window is represented by a trailing request no later than the window boundary. `Send now` causes no additional keepalive request. | Scheduler, component, route, and E2E tests                             |
| AC3     | The first of `send_now`, the idle run-status poll, timer expiry, or handle teardown settles the one waiter; losing paths are cancelled and cannot produce a second terminal outcome. The Cancel poll remains active without a provider stream.                                                                                                            | Deterministic registry and executor tests                              |
| AC4     | If accepted queue rows remain when expiry fails the node, terminal reconciliation restores them in order as `NEVER SENT`, with exactly one alert: `node failed · interrupted with no redirect · none of this was sent`. With no unmatched rows, no empty terminal dock is rendered.                                                                       | Component and E2E tests                                                |
| AC5     | The supported failed-node retry operation deletes persisted node sessions for the target and descendants; the expiry result carries no resumable session; the retried node's first provider call is fresh.                                                                                                                                                | Existing core retry test, executor test, and E2E session-id comparison |
| AC6     | While idle, both docks expose the exact text `no redirect ends this node after 30 min of inactivity · typing keeps it open` after the existing Stop disclosure. The text is present in the accessibility tree and remains complete, readable, and overflow-free in the authoritative Legacy 460px panel and Console desktop panel states.                 | Component tests, AX-tree checks, screenshots, geometry assertions      |
| AC7     | `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive` is bodyless, OpenAPI-registered, uses the existing steering actor grant and nested error shape, writes no row, returns `{ success: true }` for a live handle, and preserves the interrupt route's 401/404/409/422 safety boundaries.                                                          | Route/OpenAPI/client tests                                             |
| AC8     | Restart behavior is documented truthfully: the timer and handle are process-local, a restart does not autonomously fail or resume the running node, and operator recovery is abandon/cancel followed by `archon workflow retry-node` when desired. No persistence or schema work is introduced.                                                           | Authority review and source-backed docs updates                        |
| Tracker | Focused evidence exists and the Story 2.12 tracker entry changes to `done` only after every required gate passes.                                                                                                                                                                                                                                         | Phase 5                                                                |

## Verified repository evidence and decisions

Evidence below was re-checked at `d89ff7b6`; the prior draft's claims and its
older `49abef22` validation log are not accepted as evidence.

1. **The existing idle waiter owns the race.**
   `NodeSteeringHandle.enterIdle()` in
   `packages/workflows/src/steering-registry.ts` creates one waiter;
   `accept(..., 'send_now')` and every `seal()` synchronously take and clear it.
   `raceIdleWake()` in `dag-executor.ts` already races that waiter with the
   run-status poll and clears the poll timer when either side wins. Expiry must
   be one more waiter result, not a parallel lifecycle controller.
2. **Streaming idle timeout is the wrong mechanism.** `withIdleTimeout` sets
   `nodeIdleTimedOut` and completes the node. Story 2.12 and
   `engine-integration.md` require a distinct fail result, so neither that
   wrapper nor its completion message changes.
3. **Prompt failure already has a correct finalizer.** The generic
   `executeNodeInternal` catch closes the steering handle before its first
   awaited terminal write, logs the error, emits/persists one `node_failed`,
   records failed status, clears throttle maps, and returns a failed result
   without a session id. The explicit expiry branch should log context and
   throw the exact error into this path. A new 80-line duplicate finalizer
   would create drift. The loop path is different and must call the existing
   `failLoopIteration(..., nodeError)` helper with the exact outer error.
4. **All relevant execution sites are known.** Prompt/command nodes and
   loop-group bodies enter idle in `executeNodeInternal`; AI loop nodes have a
   separate idle branch in `executeLoopNode`. Both must recognize `expired`.
5. **The supported retry contract is stronger than the draft assumed.**
   `prepareWorkflowNodeRetry()` in
   `packages/core/src/operations/workflow-retry.ts` deletes persisted node
   sessions for every invalidated node before dispatch, and
   `workflow-retry.test.ts` already pins it. `runLayers` also starts each DAG
   execution with an empty sequential-session cursor and only persists a
   completed result. The plan therefore verifies the real supported action;
   it does not simulate a raw `retryContext` while allowing an older
   `persist_session` row to resume.
6. **The keepalive contract is additive.**
   `steering-api-contract.md` already names the bodyless route, success shape,
   steering actor grant, and no-row boundary. The interrupt handler provides
   the guard order and final re-read. Resolved edge semantics are: live idle →
   re-arm and 200; live generating/between-turn or queue-only → 200 no-op;
   parked or missing live handle → 422; terminal run/node or closed handle →
   409; unknown run/node → 404.
7. **A leading-only throttle violates genuine inactivity.** If the final
   keystroke occurs just after a leading request, the server could expire up to
   30 seconds before 30 minutes have elapsed from that activity. Use a
   leading-plus-trailing 30-second coalescer: first activity sends immediately,
   activity during the window schedules one trailing send at the boundary, and
   continued activity remains bounded to one request per window. This may fail
   up to 30 seconds late, never early because a legitimate activity was
   omitted. Pending work is cancelled when the idle attempt ends.
8. **The web can classify the cause from existing raw evidence.** The server's
   `projectWorkflowExecutionHistory()` already projects `error`, timestamps,
   and `retry_epoch` into `NodeExecution`. Cause detection must require all
   selected-node executions to be terminal and evaluate the latest row by
   retry epoch, then effective start/end timestamp, then stable array position.
   This prevents an old expiry from resurfacing after a successful retry.
   `@archon/web` keeps a local exact string because it cannot import
   `@archon/workflows`; the real E2E is the cross-package drift guard.
9. **The authoritative design adds copy, not new anatomy.** `EXPERIENCE.md`
   fixes both exact strings and says a finished node has no dock when nothing
   is undelivered. `DESIGN.md`, `key-steering-dock.html`,
   `key-legacy-node-room.html`, and `key-console-node-room.html` fix the dock
   order, tokens, 33vh queue cap, Legacy 460px panel, and no-overflow behavior.
   The static mockups predate the Story 2.12 sentence; the final UX document is
   authoritative for that delta. Add it to the existing disclosure slot, use
   existing typography/colors, and do not add a countdown, warning, or button.
10. **The E2E helpers need two real changes.** `createArchonRuntime()` currently
    cannot pass server-only env, and `getRunDetail()`'s local node-execution
    type omits `error`, timestamps, and `retry_epoch` even though the generated
    API supplies them. The standalone E2E package also requires
    `bun run build:web` and its own `npm run typecheck`; it has no axe
    dependency, but existing specs use Chromium `Accessibility.queryAXTree`.
11. **Restart recovery in current docs is overstated.** The registry, executor
    continuation, and timer all die with the server. No startup mechanism
    resumes a persisted `running` node, and the project rule forbids an
    autonomous staleness failure across process boundaries. The supported
    recovery is an explicit abandon/cancel to make the run retryable, followed
    by CLI `archon workflow retry-node`; the core retry operation accepts a
    latest `running` node on a retryable run, while the current web Retry action
    intentionally renders only failed/completed nodes. Canonical docs that say
    “resumes normally” must be corrected as part of this story.

## Scope

Included:

- A fixed 30-minute timer, re-arm operation, deterministic timer seam, new
  `expired` wake, and tightly gated E2E duration override in the registry.
- Explicit expiry handling at prompt/command, loop, and loop-group-body paths.
- Authenticated keepalive route, OpenAPI schema, generated web types, and web
  client helper.
- Leading-plus-trailing keepalive coalescing, idle disclosure, strict terminal
  cause classification, and cause-specific `NEVER SENT` copy in both docks.
- Real-executor E2E for activity, expiry, reconciliation, accessibility,
  visual states, and supported fresh-session retry.
- Corrections to current steering authorities and tracker closeout.

Excluded:

- YAML, `.archon/config.yaml`, or user-configurable duration; the product value
  remains fixed at 30 minutes.
- Timer persistence, cross-process steering, restart auto-recovery, or any
  autonomous stale-run mutation.
- Countdown, progress, pre-expiry warning, extend button, toast, or new color.
- Changes to send/interrupt/withdraw/queue semantics, Story 2.13 ordering, or
  post-v1 `delivered`/soft-inject work.
- Database schema or migration changes.

## Implementation design

### 1. Registry-owned inactivity timer

Add `expired` to `SteeringIdleWake`. Each interruptible handle receives the
duration and a scheduler whose production implementation wraps `setTimeout`,
uses the repository's guarded `unref` pattern, and returns a cancellation
function. `enterIdle()` arms after installing the waiter; `keepalive()` re-arms
only while the live waiter is idle; `send_now`, `seal`, park, close, discard,
and test cleanup cancel it. Expiry takes and clears the waiter but leaves the
handle live long enough for ordinary failure teardown and Story 2.11 queue
reconciliation.

Unit tests inject a manual scheduler and drive captured callbacks; executor
tests use a narrow `@internal expireIdleForTests()` handle seam. Do not mutate
singleton duration and do not rely on 5–600ms wall-clock sleeps. The singleton
may read `ARCHON_E2E_STEERING_IDLE_AWAIT_MS` only when
`ARCHON_E2E_FAKE_PROVIDER === '1'`; accept integer values from 1 through the
30-minute production constant and fall back otherwise.

### 2. Cause-aligned executor failure

Export the exact engine error constant. In `executeNodeInternal`, log the
expiry and throw `new Error(IDLE_AWAIT_EXPIRED_ERROR)`; the existing generic
catch remains the sole prompt/command failure finalizer. Do not abort the node
controller or touch `nodeIdleTimedOut`. In `executeLoopNode`, log and return
through `failLoopIteration`, passing the exact error as both the iteration and
outer node error. Preserve `send_now` and Cancel semantics; when the loop's
status poll wins, seal the handle synchronously before its existing awaited
status/message work so the losing inactivity timer is actually torn down.

### 3. Bodyless keepalive API

Register the route through `registerOpenApiRoute(...,
steeringValidationErrorHook)`, using the interrupt route's auth/state ladder
and final run re-read. After that last await, call `handle.keepalive()`
synchronously and return `{ success: true }`. The route writes no durable row
and logs no content. Regenerate `api.generated.d.ts` from a freshly started
server and add a no-body client helper with normalized steering errors.

### 4. Both dock surfaces

A framework-free coalescer in `steering-dock.ts` owns immediate/trailing
scheduling, cancellation, and handled rejection. Both docks trigger it on
focus and non-submit key activity only while idle. Attempt change, leaving
idle, unmount, and `Send now` cancel pending trailing work; `Send now` itself
does not call keepalive. Late completion cannot alter UI state or schedule work
for another attempt.

Thread `idleAwaitExpired` through the same Legacy/Console parents that already
compute `nodeTerminal`. Render the exact 30-minute sentence directly after the
existing Stop disclosure. Use the cause-specific alert only when a terminal
`NEVER SENT` box actually exists; an expired node with no unmatched rows
renders no empty dock and relies on the existing node-failure presentation.

### 5. End-to-end proof and authority sync

Run a dedicated E2E worker with an 8-second server timer under the fake-provider
gate. Prove a real timeout, a server re-arm, no extra keepalive on Send now,
queued-message recovery on both surfaces, AX-tree text, geometry, and a fresh
provider session after the existing Retry action. Update the E2E run-detail
type so assertions compile. Correct the canonical steering docs' restart
claim, record the deterministic timer strategy and route semantics, and move
the tracker only after all gates pass.

## Phases

| #   | Phase                                                                                             | Status  |
| --- | ------------------------------------------------------------------------------------------------- | ------- |
| 1   | [Registry inactivity timer and keepalive](./phase-01-registry-inactivity-timer-and-keepalive.md)  | Pending |
| 2   | [Executor explicit fail branch](./phase-02-executor-explicit-fail-branch.md)                      | Pending |
| 3   | [Keepalive route and client](./phase-03-keepalive-route-and-client.md)                            | Pending |
| 4   | [Dock disclosure, keepalive wiring, fail copy](./phase-04-dock-disclosure-keepalive-fail-copy.md) | Pending |
| 5   | [E2E evidence, authority sync, closeout](./phase-05-e2e-evidence-authority-sync-closeout.md)      | Pending |

## Dependency and delivery order

- Phase 1 establishes the only new engine contract.
- Phase 2 and Phase 3 consume distinct Phase 1 surfaces. They may be developed
  independently, but Phase 1 must never deploy without Phase 2 because an
  unhandled `expired` wake would be misclassified as Cancel.
- Phase 4 requires the route/client and final engine string.
- Phase 5 requires all prior phases.
- Phases 1 and 2 are one atomic rollout and rollback unit. The server route is
  additive; the web and server ship in the same single-tenant artifact.

## Complete affected-file inventory

The phase files own exact edits. Direct and indirect surfaces are:

- `packages/workflows/src/steering-registry.ts` and `.test.ts`
- `packages/workflows/src/dag-executor.ts` and `.test.ts`
- `packages/core/src/operations/workflow-retry.test.ts` (rerun existing fresh-session deletion contract; change only if a missing characterization is found)
- `packages/server/src/routes/api.ts`, `api.workflow-runs.test.ts`, and
  `schemas/workflow.schemas.ts`
- `packages/web/src/lib/api.ts`, new focused API helper test, and regenerated
  `api.generated.d.ts`
- `packages/web/src/lib/steering-dock.ts` / `.test.ts`,
  `execution-room-model.ts` / `.test.ts`
- Both composer docks and their tests; `LegacyGraphLogsPane`,
  `LegacyNodeRoom`, `NodeTranscriptPane`, `ConsoleInspectPane`, and
  `ConsoleNodeRoom` plus the affected pass-through tests
- `e2e/lib/playwright/suite.ts`, `archon-runtime.ts`, `run-detail.ts`, and new
  `e2e/ui/agent-idle-await-expiry.spec.ts`
- Canonical steering spec/companions and the steering architecture walkthrough
  listed in Phase 5, plus `sprint-status.yaml`

## Whole-plan verification gates

Run the narrow phase gates first, then:

```bash
bun run type-check
bun run lint --max-warnings 0
bun run format:check
bun run build:web
(cd e2e && npm run typecheck)
(cd e2e && npx playwright test -c playwright.config.ts ui/agent-idle-await-expiry.spec.ts ui/agent-interrupt-redirect.spec.ts ui/agent-never-sent.spec.ts)
bun run validate
```

Do not run root `bun test`; use package scripts as documented. The E2E runtime
must track and stop its server/CLI children, and type generation must stop the
specific server PID it starts on port 3090.

## Compatibility, operations, and rollback

- No migration, schema upgrade, durable state, or data backfill.
- Old clients ignore the additive route; the matching web/server build uses
  it. A web rollback simply stops issuing keepalives.
- Deploy/revert registry expiry and executor consumption together. Reverting
  only executor handling is unsafe.
- Timers are per live idle handle, unref'd, and O(1); keepalive writes no row.
  Browser traffic is bounded to one request per active idle dock per 30-second
  window plus one leading request. Multiple operators may intentionally keep
  the same node alive under the existing shared steering grant.
- On server restart, no timer survives. Do not infer abandonment by age. The
  operator explicitly abandons/cancels the orphaned run, then uses
  `archon workflow retry-node` if desired; Phase 5 makes the docs say this.
- Rollback cannot recover a session or queued message already lost to a
  process restart. Normal code rollback otherwise needs no data action.

## Final implementation review checklist

Before marking the plan complete, re-review the implementation against:

1. Product: abandoned redirects terminate, active composition does not expire early.
2. Architecture: one registry waiter owns the race; prompt failure uses the existing finalizer.
3. Contracts: exact strings, statuses, generated types, actor grant, retry-session deletion.
4. Reliability/data integrity: first-wins settlement, queue reconciliation, no autonomous restart mutation.
5. Performance: unref'd O(1) timers, bounded client traffic, no durable write per keystroke.
6. Completeness: prompt, loop, loop-group, both docks, empty/non-empty terminal states.
7. Verification: deterministic unit seams plus one real-timer E2E and fresh-session proof.
8. Operations: server PID cleanup, restart limitation, atomic Phase 1/2 rollout and rollback.
9. Maintainability: no duplicate finalizer, no global test duration mutation, no speculative config.

<!-- slug: issue-192-fail-abandoned-redirect-after-30-minutes -->
