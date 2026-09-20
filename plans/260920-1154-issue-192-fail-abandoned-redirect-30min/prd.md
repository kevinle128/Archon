# PRD — ANR Story 2.12: Fail an abandoned redirect safely after 30 minutes

Closes issue #192. Branch `archon/thread-cfc1f82b`. Plan source: this directory (`plan.md` + `phase-01..05-*.md`).

## Overview

An interruptible AI node that reaches `idle-after-interrupt` currently waits forever when the
operator leaves without sending a redirect. Story 2.12 bounds that wait with a **fixed,
non-configurable 30-minute inactivity timer** owned by the in-process steering handle. Composer
activity (textarea focus/typing) re-arms the timer through a new authenticated bodyless keepalive
route. `Send now`, workflow Cancel, and expiry settle the same idle wait **exactly once**
(first-wins). On expiry the node fails once with the exact error
`interrupted by operator, no redirect received` and a structured
`failure_reason: 'idle_after_interrupt_timeout'` that suppresses automatic retry — including
YAML `retry.on_error: all` — and lets both web shells render the timeout-specific terminal state
without parsing prose.

This is safe under the repository lifecycle rule ("No Autonomous Lifecycle Mutation Across
Process Boundaries") because the process that owns the live provider session also owns this
timer and can identify the exact `idle-after-interrupt` state. It is **not** a cross-process
stale-run watchdog.

## Problem

- `NodeSteeringHandle.enterIdle()` (`packages/workflows/src/steering-registry.ts:267`) stores one
  idle waiter; `accept(..., 'send_now')` resolves it and `seal()` (`:430`) resolves it as
  `terminated` — but there is no inactivity timer and no composer-activity method.
- `raceIdleWake()` (`packages/workflows/src/dag-executor.ts:521`) races the waiter against a
  10-second run-status poll with no 30-minute bound.
- `runNodeRetryLoop()` (`:1023`) retries non-fatal failures when YAML declares
  `retry.on_error: all`; without a structured guard, an abandoned-redirect failure would start a
  second provider attempt and violate "fails once".
- The keepalive route does not exist. Ratified contract: bodyless
  `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive` returning exactly
  `{ success: true }` (no `sub_state`).
- Both docks render the interrupt disclosure but send no composer keepalive, and the terminal
  reconciliation cannot identify the 30-minute failure cause to render the required
  failure-specific announcement.

## Solution shape

```text
enterIdle ──> one waiter + one 30-minute timer
                 │
                 ├── send_now ──> clear timer, drain, wake send_now
                 ├── Cancel poll ─> clear timer, close, wake terminated
                 └── timer ──────> clear timer, close, wake expired

keepalive while live+idle ───────> clear and re-arm timer only
```

- One handle-owned one-shot timeout, armed in `enterIdle()` at a module-local
  `1_800_000 ms` constant. No option field, YAML key, env var, flag, or durable timer.
- New wake kind `{ kind: 'expired' }` in the `SteeringIdleWake` union
  (`steering-registry.ts:97`); expiry and a new idle-only `terminateIdleAwait()` each close the
  handle and resolve the same waiter in one synchronous mutation — first mutation wins.
- Engine persists one `node_failed` event with `failure_reason: 'idle_after_interrupt_timeout'`
  (additive event-data field; older readers ignore it) and returns an internal
  `failureReason` on `NodeExecutionResult` so `shouldRetryNodeFailure()` (`dag-executor.ts:998`)
  refuses retries before ordinary classification. Never added to the public `NodeOutput` schema.
- Keepalive route reuses the queue-read route's live/cold handle classification
  (`packages/server/src/routes/api.ts`, steering routes ~:5363–5647) so the hot path is O(1)
  with no event-history scan; only the cold path projects persisted events.
- Both docks send a leading-edge, 1-second-throttled, idle-only keepalive from the **textarea's
  own** `onFocus`/`onChange` (never the composer-well `onFocusCapture`, never `Send now`).
- Terminal timeout presentation is driven by the structured `failure_reason` via a new selector
  in `packages/web/src/lib/execution-room-model.ts` (folds ordered events at `:480`, ordering
  rule `compareWorkflowEvents` at `:407`).

## Exact copy (design authority — do not paraphrase)

| Where                                                   | Exact text                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Idle disclosure line 1 (existing, keep)                 | `stopped after the last completed tool call · files already written stay written`     |
| Idle disclosure line 2 (new, directly below)            | `no redirect ends this node after 30 min of inactivity · typing keeps it open`        |
| Timeout visible failure text                            | `interrupted by operator, no redirect received · failed after 30-minute idle timeout` |
| Timeout polite status (replaces generic terminal alert) | `node failed · interrupted with no redirect · none of this was sent`                  |
| Engine error string                                     | `interrupted by operator, no redirect received`                                       |

## Goals and success metrics

- A standard AI node **and** an AI loop node each fail once after exactly 1,800,000 ms of
  idle-after-interrupt inactivity under fake timers.
- Expiry emits one `node_failed` with the exact error + `failure_reason`, never `node_completed`,
  never the stream `nodeIdleTimedOut` completion path (`dag-executor.ts:2414`).
- `retry.on_error: all` does not start another provider attempt after expiry.
- Keepalive re-arms the full fixed interval, resolves nothing, writes nothing (no transcript row,
  event row, queue item, or log of user content).
- Route honors the full steering error family: 401 `unauthenticated`, 404 `not_found`,
  409 `node_finished`, 422 `not_steerable_here`, 500 `internal_error`; parked/detached → 422,
  terminal/closed → 409.
- Both shells show the exact copy, remove all mutation controls on timeout failure, keep the
  read-only `Never sent` list when unmatched items exist, move focus to transcript row/scroller
  (never `<body>`), and pass 460 px + 1440 × 900 visual acceptance.
- `bun run validate` (CI-equivalent gate) passes; both Playwright journeys pass on `console` and
  `legacy` parameterizations.

## Non-goals

- No cross-process stale-run watchdog, orphan cleanup, or reinterpretation of NFR4 restart state.
- No public timeout configuration: no `ExecuteWorkflowOptions` field, YAML key, env var, feature
  flag, durable timer, or generic timer service/emitter.
- No database migration, dependency change, provider change, changelog edit, or new docs page.
- No keepalive from `Send now` (it resolves idle-await; Story 2.12 contract overrides
  EXPERIENCE.md on this point). No keepalive error copy, alert, or background retry.
- No product test endpoint, timeout env var, or production fixture branch for E2E.
- No changes to the Story 2.11 `Never sent` ledger algorithm or `workflow-retry.ts` unless a
  proof exposes a real defect.

## Technical context

### Engine (`@archon/workflows`)

- `packages/workflows/src/steering-registry.ts` — `NodeSteeringHandle` (`:128`),
  `SteeringIdleWake` union (`:97`), `enterIdle()` (`:267`), `seal()` (`:430`),
  `SteeringRegistry.unregister()` (`:505`). Add: `expired` wake kind, one private timeout field,
  `recordComposerActivity()`, `terminateIdleAwait()`, arm/clear/expire helpers; `unregister()`
  must close the handle before deleting so no timer survives registry removal.
- `packages/workflows/src/dag-executor.ts` — `raceIdleWake()` (`:521`, change to receive the
  handle; Cancel poll settles via `terminateIdleAwait()`), `finishCancelled()` (`:3274`, add
  `finishIdleExpired()` beside it; expired-wake branch before terminated at the `raceIdleWake`
  call sites `:3572` and `:7196`), `shouldRetryNodeFailure()` (`:998`), `runNodeRetryLoop()`
  (`:1023`), `executeLoopNode`/`Inner` (`:5656`/`:5733`), `failLoopIteration()` (`:6132`),
  stream `nodeIdleTimedOut` (`:2414` — do not reuse), `upsertWorkflowNodeSession` call (`:10405`
  — must not fire on expiry).
- Loop expiry: `failLoopIteration()` gets the exact error as both iteration error and explicit
  third `nodeError` arg (no `Loop iteration N failed:` prefix), plus `failure_reason` through
  `LoopFailureExtras.data`; internal camel-case `failureReason` returned on the failed result.

### Server (`@archon/server`)

- `packages/server/src/routes/schemas/workflow.schemas.ts` — add
  `keepaliveWorkflowNodeResponseSchema` (strict `{ success: z.literal(true) }`) and
  `z.infer`-derived `KeepaliveWorkflowNodeResponse`; import `z` from `@hono/zod-openapi`.
- `packages/server/src/routes/api.ts` — add `keepaliveWorkflowNodeRoute` beside send/interrupt,
  registered via `registerOpenApiRoute(..., steeringValidationErrorHook)` (pattern at `:4241`,
  steering routes `:5363–5647`). Order: auth (`resolveAuthContext` `:2469`, existing steering
  grant — any resolved identity or ungated identity-less install; no owner/role check) → run 404
  → terminal run 409 → handle classify (hot: closed 409 / parked 422 / live candidate; cold:
  project events → 404 unknown node / 409 terminal node / 422 detached) → final awaited run
  re-read → handle re-read → synchronous `recordComposerActivity()` → `{ success: true }`.
- `packages/web/src/lib/api.generated.d.ts` — regenerate only via `openapi-typescript` against
  **this worktree's** server (`generate:types` is hard-coded to port 3090; use a private port
  such as 3192 if 3090 is owned by another process; temporary `ARCHON_HOME`; stop only the server
  you started). Never hand-edit.

### Web (`@archon/web`)

- `packages/web/src/lib/api.ts` (Legacy) and
  `packages/web/src/experiments/console/skills/runs.ts` (Console) — add
  `keepaliveWorkflowNode(runId, nodeId)` bodyless POST using the generated
  `KeepaliveWorkflowNodeResponse` type; normalize errors through each client's existing steering
  error path.
- `packages/web/src/lib/steering-dock.ts` — add the three new exact-copy constants; extend
  finished-mode decision with an explicit timeout-failure boolean; keep generic
  `node finished · none of this was sent` for other causes. Framework-free, shared by both
  shells.
- `packages/web/src/lib/execution-room-model.ts` — add narrow selector
  `latestNodeFailedByIdleExpiry(events, nodeId): boolean` using `compareWorkflowEvents` ordering;
  clears on later `node_started`/`node_completed`/`node_skipped`/`node_skipped_prior_success`/
  `node_retry_requested` for that node; sibling/loop-iteration events don't affect it.
- `ComposerDock.tsx` (Legacy) / `ConsoleComposerDock.tsx` (Console) — injectable keepalive prop
  defaulted to the shell's API helper; 1-second leading throttle in refs; reset on run/node scope
  or new idle epoch; catch rejection and reopen; ignore stale completions; textarea `onFocus` +
  `onChange` only, gated on derived idle mode; timeout-failure prop removes all mutation controls,
  renders optional `Never sent` band + exact failure text + one polite status; reuse existing
  finished-mode focus handoff. Keep composer-well `onFocusCapture`/`onBlurCapture` unchanged.
- `NodeTranscriptPane.tsx` (Legacy) / `ConsoleNodeRoom.tsx` (Console) — derive the boolean via the
  selector from the already-present event list; pass only the boolean to the dock. Do not import
  `@archon/workflows` into web.

### E2E and closeout

- `e2e/ui/agent-interrupt-redirect.spec.ts` — extend (not duplicate): real keepalive journey on
  both shells (focus → one bodyless POST → `{ success: true }`; burst coalesced; post-window
  resend; `Send now` sends none; generating sends none; redirect resumes same session).
- `e2e/ui/agent-never-sent.spec.ts` — extend with isolated-worker SQLite fixture: reach real
  idle, queue messages + raw draft, end node via real terminal path, then rewrite that test
  event's data to the exact engine shape (`failure_reason: 'idle_after_interrupt_timeout'`) and
  set run `failed`; reopen room to prove presentation. Label as terminal-presentation evidence,
  not engine-timer proof.
- Evidence under `plans/260920-1154-issue-192-fail-abandoned-redirect-30min/reports/evidence/`
  with Story 2.12 names (do not overwrite Story 2.3 evidence). Inspect every screenshot.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` — flip
  `2-12-fail-an-abandoned-redirect-safely-after-30-minutes` to `done` only after all gates pass.

### Test/verification conventions

- Bun fake timers (`jest.useFakeTimers()`), always restored in `finally`/`afterEach` — the large
  executor test file must not leak clock state. Never wait a real 30 minutes.
- Run package-focused tests from their package dirs; **do not run root `bun test`**.
- `bun --filter @archon/core test` runs whole (package-resolution setup); `bun run build:web`;
  `cd e2e && npm run typecheck && ARCHON_E2E_PROOF=1 npx playwright test -c playwright.config.ts
ui/agent-interrupt-redirect.spec.ts ui/agent-never-sent.spec.ts`; root `bun run validate` last.
- TDD: failing tests first, then implementation, then the phase verification commands.

## Story overview

| ID     | Title                                                    | Phase | Depends on |
| ------ | -------------------------------------------------------- | ----- | ---------- |
| US-001 | Handle-owned inactivity timer and standard-node expiry   | 1     | —          |
| US-002 | Loop-node idle-expiry parity and engine invariants       | 2     | US-001     |
| US-003 | Keepalive route, OpenAPI schema, generated types         | 3     | US-001     |
| US-004 | Both docks: keepalive, disclosures, timeout presentation | 4     | US-003     |
| US-005 | E2E evidence, contract proofs, validation, closeout      | 5     | US-001–004 |
