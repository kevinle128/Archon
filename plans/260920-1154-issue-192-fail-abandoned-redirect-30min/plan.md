---
title: 'ANR Story 2.12 — Fail an abandoned redirect safely after 30 minutes'
description: 'Bound idle-after-interrupt with a fixed 30-minute inactivity timer, re-arm it from authenticated composer activity, and fail the node once when no redirect arrives.'
status: pending
issue: 192
branch: archon/thread-cfc1f82b
tags: [anr, epic-2, steering, workflow-engine, accessibility, tdd]
blockedBy: []
blocks: []
created: 2026-09-20
---

# ANR Story 2.12 — Fail an abandoned redirect safely after 30 minutes

## Goal

Finish Story 2.12 and close issue #192.
An interruptible AI node that reaches `idle-after-interrupt` must not wait forever when the operator leaves without a redirect.
After 30 minutes without composer activity, the engine must fail the node once with `interrupted by operator, no redirect received`.
Keystroke or composer-focus activity must re-arm the fixed timer through the authenticated keepalive route without delivering a message.
`Send now`, workflow Cancel, and expiry must settle the same idle wait exactly once.

This goal matches the project need in Story 2.12, NFR6, and the open issue.
It is safe under the repository lifecycle rule because the process that owns the live provider session also owns this timer and can identify the exact `idle-after-interrupt` state.
This plan does not add a cross-process stale-run watchdog.

## Verified authority and evidence

Use these sources in this order when implementation details conflict:

1. `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`, Story 2.12, NFR6, and NFR8 define the product outcome and acceptance criteria.
2. `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` defines the keepalive request and the exact `{ success: true }` response.
3. `_bmad-output/specs/spec-agent-node-room/engine-integration.md` and `control-states.md` define the in-process idle wait and composer-activity behavior.
4. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` and `EXPERIENCE.md` are the design authority.
5. `claude-design/design_handoff_node_room_transcript_steering/README.md` and the co-located Legacy, Console, and steering-state HTML files provide the required visual states.
6. `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` requires fake-timer lifecycle tests and end-to-end checks on both shells.
7. The current source and tests listed below define the shipped architecture and regression contracts.

The three `plans/reports/scout-260920-1843-*.md` files were inspected as background only.
Their claims are not authority.
Current source, the ratified API contract, the design files, and the current Bun test capability take precedence.

## Verified current behavior

- `NodeSteeringHandle.enterIdle()` in `packages/workflows/src/steering-registry.ts` stores one idle waiter.
- `accept(..., 'send_now')` resolves that waiter and drains the pending queue synchronously.
- `seal()` resolves the waiter as `terminated`, but there is no inactivity timer or composer-activity method.
- `raceIdleWake()` in `packages/workflows/src/dag-executor.ts` races the waiter against a 10-second run-status poll and has no 30-minute bound.
- Standard AI nodes and `executeLoopNode` have separate terminal finalizers, so both paths require explicit expiry handling.
- `runNodeRetryLoop()` retries non-fatal failures when YAML declares `retry.on_error: all`.
- Without a specific guard, the abandoned-redirect failure would start a second provider attempt automatically and violate “fails once.”
- `prepareWorkflowNodeRetry()` already deletes persisted sessions for every invalidated node before the supported manual retry.
- Session persistence already writes only after `state === 'completed'`.
- Steering routes and schemas are in `packages/server/src/routes/api.ts` and `packages/server/src/routes/schemas/workflow.schemas.ts`.
- The keepalive route does not exist.
- The ratified keepalive response is exactly `{ success: true }`; it does not contain `sub_state`.
- Legacy uses `packages/web/src/lib/api.ts`, while Console uses `packages/web/src/experiments/console/skills/runs.ts`.
- Both API clients therefore need the new generated response type and client function.
- Both docks render the existing interrupt disclosure, but neither sends composer keepalive activity.
- The current terminal reconciliation restores unmatched messages, but it cannot identify the 30-minute failure cause or render the required failure-specific announcement.
- `packages/web/src/lib/execution-room-model.ts` already folds ordered lifecycle events and is the correct place to derive the latest-attempt failure cause.
- `e2e/ui/agent-interrupt-redirect.spec.ts` owns the real interrupt and redirect journey on both shells.
- `e2e/ui/agent-never-sent.spec.ts` owns terminal reconciliation, focus, and read-only `Never sent` presentation.

## Corrected technical design

### One handle-owned inactivity timer

The steering handle owns one fixed one-shot timeout while it owns the idle waiter.
`enterIdle()` arms the timer for 1,800,000 milliseconds.
`recordComposerActivity()` clears and re-arms that timer only when the handle is live and idle.
`send_now`, terminal sealing, discard, Cancel settlement, and expiry clear the timer.

The timer duration stays a module-local production constant.
Do not add an `ExecuteWorkflowOptions` field, YAML key, environment variable, feature flag, or other configuration surface.
Use Bun fake timers in tests, as required by `steering-test-plan.md` and supported by the repository's current test stack.

### One first-wins idle waiter

Add an `expired` wake to the existing idle-wake union.
Expiry closes the handle and resolves the one waiter with `expired` in one synchronous mutation.
The run-status poll calls a new idle-only termination method that closes the handle and resolves the same waiter with `terminated`.
`send_now` continues to resolve that waiter with the drained batch.

The first synchronous handle mutation wins.
Later expiry, Cancel settlement, keepalive, or new-message operations become no-ops or receive the existing closed-handle refusal.
This prevents a successful `send_now` receipt after expiry has won.

```text
enterIdle ──> one waiter + one 30-minute timer
                 │
                 ├── send_now ──> clear timer, drain, wake send_now
                 ├── Cancel poll ─> clear timer, close, wake terminated
                 └── timer ──────> clear timer, close, wake expired

keepalive while live+idle ───────> clear and re-arm timer only
```

### Explicit non-retryable failure

The user-visible error remains exactly `interrupted by operator, no redirect received`.
The persisted `node_failed` data also gets `failure_reason: 'idle_after_interrupt_timeout'`.
The returned internal node result carries the same structured reason so `runNodeRetryLoop()` can suppress automatic retries, including `retry.on_error: all`, without parsing prose.
Do not add this internal retry marker to the public `NodeOutput` schema or the workflow language.

The structured event field also lets the web identify the cause without using natural language as a wire format.
Older readers ignore the additive event-data field.

### Typed keepalive route

Add bodyless `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`.
The strict success response is `{ success: true }`.
The route uses `resolveAuthContext` and the existing steering grant: any resolved identity is allowed, and an ungated identity-less install is allowed.
Do not add owner or role checks.

The live-handle path must stay O(1) after the run lookup and final run-status check.
Use the queue-read route's live-handle and cold-handle classification pattern instead of scanning the full event history on every keystroke.
Only the cold path needs event projection to distinguish unknown, finished, and detached nodes.
After the last awaited run lookup, re-read the handle phase before the synchronous keepalive mutation.

### Both web shells and the terminal failure state

The static design and mockups preserve this exact stop disclosure:

`stopped after the last completed tool call · files already written stay written`

The later interaction and accessibility decision in `EXPERIENCE.md` requires this separate inactivity disclosure:

`no redirect ends this node after 30 min of inactivity · typing keeps it open`

Render both lines in the existing disclosure block, in that order.
Do not replace the stop meaning with an invented combined sentence.
This resolves the artifact mismatch by preserving the static design's exact content and adding the later ratified Story 2.12 requirement.

`EXPERIENCE.md` describes `Send now` as composer activity, but Story 2.12 and the steering test plan explicitly exclude it because it resolves idle-await.
Follow the Story 2.12 contract: `Send now` clears the timer through first-wins settlement and does not issue keepalive.

Both docks send a leading-edge, idle-only keepalive from the textarea's own focus and change events.
Do not use the composer-well `onFocusCapture` for this request because focus on `Send now` would then send a keepalive.
Keep that existing handler only for focus-restoration bookkeeping.

Use a one-second leading throttle.
The first activity sends immediately, repeated activity inside the window is coalesced, and later activity sends again.
A rejected request must be caught, must not cause an unhandled rejection, and must allow the next activity to retry.
The contract does not define new keepalive-error copy, so do not add an alert or automatic background retry.

When the latest terminal event carries `failure_reason: 'idle_after_interrupt_timeout'`, the dock must show the mockup's visible failure text:

`interrupted by operator, no redirect received · failed after 30-minute idle timeout`

It must also expose the design's one polite status message:

`node failed · interrupted with no redirect · none of this was sent`

The timeout-specific status replaces the generic terminal alert for this cause so two live regions do not compete.
The read-only `Never sent` list remains when unmatched queued messages or a raw draft exist.
The failure disclosure remains visible even when there are no unmatched messages.

## Scope

| Area                        | Files that own the change                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registry lifecycle          | `packages/workflows/src/steering-registry.ts`, `packages/workflows/src/steering-registry.test.ts`                                                                                          |
| Standard and loop executors | `packages/workflows/src/dag-executor.ts`, `packages/workflows/src/dag-executor.test.ts`                                                                                                    |
| OpenAPI and server route    | `packages/server/src/routes/schemas/workflow.schemas.ts`, `packages/server/src/routes/api.ts`, `packages/server/src/routes/api.workflow-runs.test.ts`                                      |
| Generated web contract      | `packages/web/src/lib/api.generated.d.ts` through its generator only                                                                                                                       |
| Web API clients             | `packages/web/src/lib/api.ts`, `packages/web/src/experiments/console/skills/runs.ts`                                                                                                       |
| Shared UI model             | `packages/web/src/lib/steering-dock.ts`, `packages/web/src/lib/steering-dock.test.ts`, `packages/web/src/lib/execution-room-model.ts`, `packages/web/src/lib/execution-room-model.test.ts` |
| Legacy UI                   | `packages/web/src/components/workflows/ComposerDock.tsx`, `ComposerDock.test.tsx`, `NodeTranscriptPane.tsx`, `NodeTranscriptPane.test.tsx`                                                 |
| Console UI                  | `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`, `ConsoleComposerDock.test.tsx`, `ConsoleNodeRoom.tsx`, `ConsoleNodeRoom.test.tsx`                               |
| Browser verification        | `e2e/ui/agent-interrupt-redirect.spec.ts`, `e2e/ui/agent-never-sent.spec.ts`                                                                                                               |
| Existing manual-retry proof | `packages/core/src/operations/workflow-retry.ts`, `workflow-retry.test.ts` are verification targets and should not change unless the proof exposes a real gap                              |
| Closeout                    | `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` after all gates pass                                                                                            |

No database migration, dependency, YAML-language change, provider change, environment option, or durable timer is in scope.
No changelog edit is in scope.
No new public documentation page currently owns live node steering; the OpenAPI description, generated types, visible disclosure, and existing ratified spec are the owning surfaces.

## Phases

| Phase | Work                                                                                                    | Status  |
| ----- | ------------------------------------------------------------------------------------------------------- | ------- |
| 1     | [Handle-owned timer and standard-node expiry](./phase-01-start.md)                                      | Pending |
| 2     | [Loop parity and failure invariants](./phase-02-loop-node-idle-await-parity.md)                         | Pending |
| 3     | [Keepalive route and generated contract](./phase-03-keepalive-server-route-and-openapi-schema.md)       | Pending |
| 4     | [Both docks, accessibility, and failure presentation](./phase-04-web-docks-disclosure-and-keepalive.md) | Pending |
| 5     | [End-to-end evidence, compatibility, and closeout](./phase-05-integration-proofs-and-validation.md)     | Pending |

## Acceptance criteria

- [ ] A standard AI node and an AI loop node each fail once after exactly 1,800,000 milliseconds of idle-after-interrupt inactivity under fake timers.
- [ ] The terminal error is exactly `interrupted by operator, no redirect received`.
- [ ] Expiry emits one terminal `node_failed` event with `failure_reason: 'idle_after_interrupt_timeout'` and never emits `node_completed` for that attempt.
- [ ] Expiry does not use or set the existing stream `nodeIdleTimedOut` completion path.
- [ ] YAML `retry.on_error: all` does not start another provider attempt after this failure.
- [ ] Composer keepalive activity re-arms the full fixed interval and does not resolve idle-await.
- [ ] `send_now`, workflow Cancel, and expiry are first-wins and leave no timer, waiter, or late mutation.
- [ ] The existing Cancel poll still ends an idle node when no provider stream is active.
- [ ] The keepalive route has no request body and returns exactly `{ success: true }` on live generating and live idle handles.
- [ ] The keepalive route returns the established nested steering errors for 401, 404, 409, 422, and 500 outcomes.
- [ ] Parked and detached handles return 422, while terminal or closed handles return 409.
- [ ] Both API clients use the generated `KeepaliveWorkflowNodeResponse` type.
- [ ] Both docks send keepalive only for textarea focus or changes while idle.
- [ ] `Send now`, `Queue`, generating state, terminal state, and finished-iteration state send no keepalive.
- [ ] Both docks show the exact stop disclosure, exact inactivity disclosure, exact visible timeout failure text, and exact polite failure announcement.
- [ ] Timeout failure removes all mutation controls, preserves transcript focus, and renders unmatched items as the read-only `Never sent` list.
- [ ] The idle and failed layouts match the design at a 460 px viewport and at a 1440 × 900 page viewport with the Console panel at its actual constrained width.
- [ ] There is no room-driven horizontal overflow, clipped copy, covered focus, or undersized existing control.
- [ ] A supported failed-node retry starts with no interrupted provider session.
- [ ] Focused tests, both browser journeys, `bun run build:web`, and `bun run validate` pass.

## Compatibility, rollout, and rollback

- The route and event-data discriminator are additive.
- Existing clients do not call the new route and continue to work.
- Existing event readers ignore the new free-form data field.
- There is no stored deadline and no schema migration.
- A process restart still drops steering state under NFR4; this plan does not reinterpret that state or mutate an ambiguous run.
- Deploy the server and web build from the same revision so the new UI and generated API contract stay aligned.
- Rollback is a code revert.
- A rollback removes future timers and keepalive calls, while already persisted failure events remain valid audit records and can still be retried.

## Remaining risks and assumptions

- The client keepalive is best-effort per focus or change event.
- A network failure is caught and the next activity retries, but the UI does not promise that an activity the server never received extended the deadline.
- The full 30-minute server expiry cannot be practical browser-clock E2E coverage.
- Fake-timer engine tests prove the time behavior, while a persisted-event browser fixture proves the exact terminal presentation.
- There are no unresolved design conflicts or implementation blockers in the inspected repository.

<!-- slug: issue-192-fail-abandoned-redirect-30min -->
