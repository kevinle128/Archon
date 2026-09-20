# PRD — Issue #192 / Story 2.12: Fail an abandoned redirect safely after 30 minutes

Source plan: `plan.md` + `phase-01`…`phase-05` in this directory (verified at `d89ff7b6`).
Issue: https://github.com/kevinle128/Archon/issues/192 · Story 2.12 in
`_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`. Blockers 2.3 and
2.11 are `done`; 2.12 is `backlog` until this work and its evidence pass.

## Problem

Interrupt-and-redirect (Story 2.3) leaves an interruptible agent node parked in
`idle-after-interrupt` with **no upper bound**: if the operator never sends a
redirect, the node — and its run — waits forever. Story 2.12 closes that hole:
30 minutes of genuine composer inactivity must fail the node exactly once with
the exact error `interrupted by operator, no redirect received`. Typing/focus
activity re-arms the timer through an authenticated, bodyless keepalive request
that never sends prose and never wakes the executor. `Send now`, run Cancel, and
expiry remain a first-wins race; the loser can produce no second terminal
outcome.

## Solution (one paragraph)

The steering registry's existing single idle waiter owns the race — expiry
becomes one more `SteeringIdleWake` result (`{ kind: 'expired' }`), not a
parallel lifecycle controller. The executor adds two explicit `expired` branches:
prompt/command/loop-group-body path throws into the existing generic failure
finalizer; the AI-loop path returns through `failLoopIteration` with the exact
error as both iteration and node error. A new bodyless
`POST …/nodes/{nodeId}/keepalive` route (same guard ladder as interrupt) calls
`handle.keepalive()` synchronously. The web drives it through a
leading-plus-trailing 30-second coalescer on focus/keystroke activity only while
idle, discloses the 30-minute bound in both docks, and classifies the expiry
cause from projected `NodeExecution` rows to pick the `NEVER SENT` alert copy.
An env-gated E2E proves a real timeout, re-arm, reconciliation, accessibility,
geometry, and fresh-session retry.

## Goals and success metrics

| ID | Measurable result | Proof |
| --- | --- | --- |
| AC1 | After 30 min of genuine composer inactivity in `idle-after-interrupt`, the prompt/command node, AI loop node, or loop-group body fails once with the exact error. No `node_completed`, never `completed via idle timeout`, `nodeIdleTimedOut` never set. | Registry + executor tests; real-timer E2E |
| AC2 | Focus/editing while idle produces authenticated keepalives that re-arm but never resolve idle-await; ≤1 request per 30s window; trailing request ≤ window boundary represents final activity; `Send now` causes no keepalive. | Scheduler, component, route, E2E tests |
| AC3 | First of `send_now`, idle run-status poll, timer expiry, or handle teardown settles the one waiter; losers are cancelled; Cancel poll stays active with no provider stream. | Deterministic registry/executor tests |
| AC4 | Accepted queue rows remaining at expiry are restored in order as `NEVER SENT` with exactly one alert `node failed · interrupted with no redirect · none of this was sent`; no unmatched rows → no empty terminal dock. | Component + E2E tests |
| AC5 | Supported failed-node retry deletes persisted node sessions for target + descendants; expiry result carries no resumable session; retried node's first provider call is fresh. | `workflow-retry.test.ts`, executor test, E2E session-id comparison |
| AC6 | While idle, both docks show exactly `no redirect ends this node after 30 min of inactivity · typing keeps it open` after the Stop disclosure; present in AX tree; complete/readable/overflow-free in Legacy 460px panel and Console desktop. | Component tests, AX-tree, screenshots, geometry |
| AC7 | `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive` is bodyless, OpenAPI-registered, existing steering actor grant, nested error shape, writes no row, returns `{ success: true }` for a live handle, preserves interrupt's 401/404/409/422 boundaries. | Route/OpenAPI/client tests |
| AC8 | Restart behavior documented truthfully: timer + handle are process-local; restart never autonomously fails/resumes a running node; recovery = abandon/cancel then `archon workflow retry-node`. No persistence/schema work. | Authority review + source-backed doc updates |
| Tracker | Story 2.12 → `done` in `sprint-status.yaml` only after every gate passes. | US-005 |

## Non-goals (explicitly out of scope)

- No YAML field, `.archon/config.yaml` key, or user-configurable duration — 30
  minutes is a fixed product rule.
- No timer persistence, cross-process steering, restart auto-recovery, or any
  autonomous stale-run mutation (project rule: no autonomous lifecycle mutation
  across process boundaries).
- No countdown, progress bar, pre-expiry warning, extend button, toast, or new
  color/motion.
- No changes to send/interrupt/withdraw/queue semantics, Story 2.13 ordering, or
  post-v1 `delivered`/soft-inject work.
- No database schema or migration changes.
- `withIdleTimeout`/`nodeIdleTimedOut`/`STEP_IDLE_TIMEOUT_MS` are the *wrong*
  mechanism (they complete the node) — do not reuse or modify them.

## Technical context

### Engine (packages/workflows)

- `packages/workflows/src/steering-registry.ts` — the only new engine contract.
  `SteeringIdleWake` union at `:97`; `idleWaiter` field at `:136`;
  `enterIdle(token)` installs the one waiter at `:267`; `send_now`/`seal()`
  synchronously take-and-clear it (`:312`, `:437`); all teardown paths
  (park/close/discard/`closeIfEmpty`/`clearForTests` at `:533`) flow through
  `seal()`/`discard()`; `createSteeringRegistry()` at `:563`.
- `packages/workflows/src/dag-executor.ts` — `raceIdleWake()` at `:521` already
  races the waiter against the run-status poll and clears the poll in `finally`;
  prompt/command + loop-group-body idle-await in `executeNodeInternal` (`:2125`,
  wake awaited at `:3572`); AI-loop idle-await in `executeLoopNode`
  (`:5656`/`:5733`, wake at `:7196`, `failLoopIteration` at `:6132`);
  `finishCancelled` at `:3274`; `withIdleTimeout` used at `:2486` and
  `:6434` — untouched.
- `packages/core/src/operations/workflow-retry.ts:333` —
  `prepareWorkflowNodeRetry()` already deletes persisted node sessions for every
  invalidated node (`:539`); pinned by `workflow-retry.test.ts`.

### Server + web client

- `packages/server/src/routes/api.ts` — interrupt route def at `:1643`, handler
  with the guard ladder at `:5464`+ (401 → 404 → 409 `node_finished` → 422
  `not_steerable_here` → final run re-read → synchronous handle call);
  `steeringValidationErrorHook` imported at `:8`; nested `steeringError` shape.
- `packages/server/src/routes/schemas/workflow.schemas.ts` — add strict
  `keepaliveWorkflowNodeResponseSchema` next to
  `interruptWorkflowNodeResponseSchema` (imported at api.ts `:511`).
- `packages/web/src/lib/api.ts` — steering helpers `interruptNode` at `:794`
  etc., errors normalized via `toSteeringRequestError` (imported `:8`). Add
  `keepaliveNode`. Regenerate `api.generated.d.ts` from a running current server
  (`bun --filter @archon/web generate:types`); never hand-edit.
- `packages/web/src/lib/steering-dock.ts` — framework-free dock state; add the
  exact copy constants, `createKeepaliveCoalescer`, key predicate,
  `neverSentDisclosure(idleAwaitExpired)`. Existing `neverSentBandHeader`/`WILL
  SEND`/`NEVER SENT` machinery stays.
- `packages/web/src/lib/execution-room-model.ts:453` — add
  `hasIdleAwaitExpiredEvidence` next to `hasTerminalNodeEvidence` (latest row by
  `retry_epoch` → `started_at ?? ended_at ?? ''` → array position; all rows for
  the node terminal; exact error match; `grp.body` namespacing).
- Thread `idleAwaitExpired` beside `nodeTerminal` through
  `LegacyGraphLogsPane`→`LegacyNodeRoom`→`NodeTranscriptPane`→`ComposerDock` and
  `ConsoleInspectPane`→`ConsoleNodeRoom` (`nodeTerminal` prop at
  `ConsoleNodeRoom.tsx:112`)→`ConsoleComposerDock`. No new global store.

### E2E harness

- `e2e/lib/playwright/suite.ts:14` — worker-scoped `archon` fixture; add an
  `idleAwaitMs` worker option it consumes.
- `e2e/lib/playwright/archon-runtime.ts` — `isolatedEnv(home, port)` at `:293`,
  `createArchonRuntime` `:425`, `startArchonRuntime` `:465`; add a `serverEnv`
  record spread after `isolatedEnv` in the server spawn only (CLI env unchanged);
  keep child tracking/`finally` stop and occupied-port hard error.
- `e2e/lib/playwright/run-detail.ts:134` — local `nodeExecutions` type gains
  `error`, `retry_epoch`, `started_at`, `ended_at`.
- `e2e-queue-guidance` + fake provider: tool call ids `e2e-fake-tool-${sessionId}`
  give direct fresh-session proof after retry. No axe dep — use Chromium
  `Accessibility.queryAXTree` via CDP like existing specs.

### Design/copy authorities (exact strings — verify, don't paraphrase)

- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`
  — fixes both exact strings and "finished node with nothing undelivered has no
  dock". Authoritative for the Story 2.12 delta.
- Same dir: `DESIGN.md`, `mockups/key-steering-dock.html`,
  `mockups/key-legacy-node-room.html`, `mockups/key-console-node-room.html` —
  dock order, tokens, 33vh queue cap, Legacy 460px panel, no-overflow.
- Steering spec authorities to sync in US-005:
  `_bmad-output/specs/spec-agent-node-room/{steering-test-plan.md,
  steering-api-contract.md, SPEC.md, engine-integration.md}` plus absorbed
  copies under `sources/spec-live-agent-steering/{SPEC.md,
  engine-integration.md}`; architecture
  `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/{ARCHITECTURE-SPINE.md,walkthrough.html}`.
- Tracker: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`.

### Resolved edge semantics (already decided — don't re-litigate)

- Keepalive route: live idle → re-arm + 200; live generating/between-turn or
  queue-only → 200 no-op; parked or missing in-process handle → 422; terminal
  run/node or closed handle → 409; unknown run/node → 404; auth first → 401.
- Coalescer is leading-plus-trailing (a leading-only throttle can expire up to
  30s early — forbidden); final activity is represented ≤30s later.
- Expiry leaves the handle live and idle long enough for ordinary failure
  teardown + Story 2.11 queue reconciliation (`awaiting_send_now` still answers
  queue-intent until teardown).
- `ARCHON_E2E_STEERING_IDLE_AWAIT_MS` honored only when
  `ARCHON_E2E_FAKE_PROVIDER === '1'` exactly; integer in `[1, 30*60_000]`, else
  fall back. Never mutate the singleton duration in tests — use injected
  scheduler / `expireIdleForTests()`.
- Phases 1+2 (US-001+US-002) are one atomic rollout/rollback unit: an `expired`
  wake with no executor branch would misclassify as Cancel.

### Whole-plan verification gates (final story runs all)

```bash
bun run type-check
bun run lint --max-warnings 0
bun run format:check
bun run build:web
(cd e2e && npm run typecheck)
(cd e2e && npx playwright test -c playwright.config.ts ui/agent-idle-await-expiry.spec.ts ui/agent-interrupt-redirect.spec.ts ui/agent-never-sent.spec.ts)
bun run validate
```

Never run root `bun test` — use per-package scripts. TDD per phase: write the
phase's failing tests first (test ids T1.x/T2.x/T3.x/T4.x/Ex in phase files),
then implement, then run the phase gate.

## Story overview

| Story | Phase | Title | Depends on |
| --- | --- | --- | --- |
| US-001 | 1 | Registry inactivity timer + keepalive | — |
| US-002 | 2 | Executor explicit `expired` fail branch | US-001 |
| US-003 | 3 | Bodyless keepalive route + web client | US-001 |
| US-004 | 4 | Dock disclosure, keepalive wiring, fail copy (Legacy + Console) | US-002, US-003 |
| US-005 | 5 | Real-timer E2E evidence, authority sync, tracker closeout | US-001–US-004 |

US-002 and US-003 both consume US-001 but different surfaces (executor vs route);
US-004 needs the route/client plus the final engine error string; US-005 proves
the whole contract end-to-end and moves the tracker last.
