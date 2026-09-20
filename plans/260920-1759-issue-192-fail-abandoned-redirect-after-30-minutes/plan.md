---
title: 'Issue 192: fail an abandoned redirect safely after 30 minutes'
description: 'Implementation-ready plan for Story 2.12: a fixed 30-minute inactivity timer on idle-after-interrupt that fails the node on an explicit branch, re-armed by an authenticated keepalive route driven from composer activity, disclosed in both docks, and reconciled as NEVER SENT with cause-naming copy.'
status: pending
priority: P1
effort: '5 phases · ~20h'
issue: 'https://github.com/kevinle128/Archon/issues/192'
branch: archon/thread-f6f11c80
tags: [issue-192, agent-node-room, story-2-12, workflows, server, web, e2e, feature]
blockedBy: []
blocks: []
created: 2026-09-20
mode: deep
tdd: true
---

# Issue 192: fail an abandoned redirect safely after 30 minutes

## Outcome

An interrupt-capable agent node that the operator stopped and then abandoned
no longer hangs forever. While the node sits in `idle-after-interrupt`, a fresh
fixed 30-minute **inactivity** timer runs on the node's live steering handle.
Composer activity (keystroke or focus, never `Send now`) reaches an
authenticated `POST …/nodes/:nodeId/keepalive` route that re-arms the timer
without resolving idle-await. When the timer expires first, the executor fails
the node exactly once with the error `interrupted by operator, no redirect
received` on an explicit fail branch — never the streaming idle timeout, which
*completes* a node. Idle-await still resolves exactly once among `Send now`,
the idle cancel poll, and timer expiry, and the cancel poll stays reachable
with no provider stream active. Queued messages left on the handle at expiry
are recovered by Story 2.11's terminal reconciliation as `NEVER SENT`, with the
cause-naming announcement the UX authority specifies. Retrying the failed node
through `workflow retry-node` starts a fresh provider session. Both docks
disclose the limit up front in accessible text.

This is Story 2.12 from
`_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`. Its
dependencies, Story 2.3 (interrupt/idle-await, #183) and Story 2.11 (never-sent
reconciliation, #191), are `done` in the sprint tracker.

## Acceptance criteria

| ID      | Measurable result                                                                                                                                                                                                                                                                                                    | Evidence                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| AC1     | From `idle-after-interrupt`, 30 minutes of composer inactivity fails the node once with `interrupted by operator, no redirect received`; no `node_completed`, no `completed via idle timeout` message, `nodeIdleTimedOut` untouched. Holds for prompt/command nodes, loop nodes, and loop-group bodies.               | Phase 1 registry tests, Phase 2 executor tests, Phase 5 E2E |
| AC2     | Keystroke or focus activity while idle reaches the authenticated keepalive route, which re-arms the fixed timer without resolving idle-await; `Send now` never issues a keepalive because it resolves idle-await.                                                                                                     | Phase 1, Phase 3 route tests, Phase 4 component tests       |
| AC3     | Idle-await resolves exactly once: the first of workflow Cancel (idle status poll), `Send now`, or timer expiry wins; the others are torn down; the cancel poll remains reachable with no provider stream.                                                                                                             | Phase 1 and Phase 2 tests                                   |
| AC4     | Queued messages present at expiry are restored as `NEVER SENT` by Story 2.11's reconciliation after the node's terminal event, with the cause-naming alert `node failed · interrupted with no redirect · none of this was sent`.                                                                                       | Phase 2 (queue count), Phase 4 tests, Phase 5 E2E           |
| AC5     | Retrying the 30-minute failure through the supported failed-node action runs the node with a fresh provider session (resume id `undefined`); the interrupted session id is never persisted or threaded.                                                                                                              | Phase 2 characterization tests                              |
| AC6     | In `idle-after-interrupt`, both docks render the disclosure `no redirect ends this node after 30 min of inactivity · typing keeps it open` as accessible text, matching anatomy on Legacy and Console.                                                                                                                | Phase 4 tests, Phase 5 visual/a11y E2E                      |
| Tracker | Focused evidence is recorded, spec/test-plan authorities are synced, and the Story 2.12 tracker entry moves to `done` only after all gates pass.                                                                                                                                                                      | Phase 5                                                     |

## Repository evidence and resolved decisions

Evidence was checked at worktree `49abef22` (branch `archon/thread-f6f11c80`).

1. **The idle-await seam already exists and resolves once.**
   `NodeSteeringHandle.enterIdle(token)` (`packages/workflows/src/steering-registry.ts`)
   returns ONE `idleWaiter` promise; `accept(message,'send_now')` resolves it
   with the drained batch, and every `seal()` (close / park / discard)
   resolves it `terminated`. The executor parks on it in `raceIdleWake()`
   (`packages/workflows/src/dag-executor.ts` ~line 520), which races the
   waiter against a `getWorkflowRunStatus` poll on `CANCEL_CHECK_INTERVAL_MS`
   and tears the loser down synchronously. The timer therefore belongs on the
   handle: it becomes a third resolver of the same single-resolve waiter, so
   exactly-once is inherited rather than re-implemented, and the route can
   reach it via `getSteeringRegistry().get(runId, nodeId)` exactly as the
   interrupt route does.
2. **The existing idle timeout completes; this timer must fail.**
   `withIdleTimeout` / `nodeIdleTimedOut` (`utils/idle-timeout.ts`,
   `dag-executor.ts` ~3524) post `completed via idle timeout` and take the
   completion path. `engine-integration.md` §"idle-await bound" forbids
   reusing it. The expiry wake takes a dedicated fail finalizer modelled on
   `finishCancelled()` (~3274) with the exact error string, and the loop
   site goes through `failLoopIteration` (~6132).
3. **Both idle sites must change.** `executeNodeInternal` (~3571) and
   `executeLoopNode` (~7195) each call `enterIdle` + `raceIdleWake` and branch
   on `wake.kind`. Loop-group bodies run through `executeNodeInternal`, so the
   first site covers them.
4. **No fake timers anywhere.** Verified on Bun 1.3.14:
   `jest.useFakeTimers()` fires `setTimeout`, but `Bun.sleep` hangs under it,
   `dag-executor.test.ts` polls with `Bun.sleep(1)` (`awaitIdle`), and a test
   that throws before `useRealTimers()` would stall every later describe on
   Bun's 5000 ms timeout. Decision: the inactivity duration is **injectable at
   registry construction** (`createSteeringRegistry({ idleAwaitInactivityMs })`)
   plus a `setIdleAwaitInactivityMsForTests()` hook on the singleton;
   `clearForTests()` restores the default so the executor suite's existing
   shared `afterEach` structurally undoes any override. All tests use real
   short durations; the 30-minute default is proven by spying on
   `globalThis.setTimeout`'s delay argument.
   <!-- Updated: Red Team 2026-09-20 — Assumption Destroyer F1, F5 -->
5. **E2E needs a shortened timer.** The only env-gated test seam precedent is
   `ARCHON_E2E_FAKE_PROVIDER` (`packages/providers/src/e2e-fake/registration.ts`,
   set by `e2e/lib/playwright/archon-runtime.ts`). Decision: the singleton
   honours `ARCHON_E2E_STEERING_IDLE_AWAIT_MS` **only** when
   `ARCHON_E2E_FAKE_PROVIDER === '1'` **exactly** (the fake-provider gate's
   own truthiness check would accept `'false'`), and only when the value is a
   positive safe integer — so a stray variable can never shorten the ratified
   30 minutes on a real install. No YAML field, no config key: NFR6 says the
   timer is fixed.
   <!-- Updated: Red Team 2026-09-20 — Security F1, F5 -->
6. **Keepalive on a non-idle handle is a harmless no-op.** The contract
   (`steering-api-contract.md`) defines only the success shape
   `{ success: true }`. Decision: a live handle that is not idle (generating,
   between turns) returns 200 with no timer change; terminal run/node or
   closed handle → 409 `node_finished`; no handle → 422 `not_steerable_here`;
   the guard ladder and actor grant are copied from the interrupt route. The
   route writes no row and never logs message content (there is none).
7. **Fresh session on retry is true by construction; prove it.**
   `runLayers` starts with `lastSequentialSession: undefined` on every
   `executeDagWorkflow` call; the cursor is set only for `state === 'completed'`
   (~10562); `upsertWorkflowNodeSession` runs only when `output.state ===
   'completed'` (~10403). The fail finalizer returns `state: 'failed'` without
   a `sessionId`. Phase 2 adds a characterization test asserting the retried
   `sendQuery` receives `resumeSessionId === undefined`. A `persist_session`
   node may still resume an OLDER persisted scope session from a prior run —
   that is existing persist semantics, not the interrupted context.
8. **UX copy is authoritative and specific.**
   `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`
   line 178 fixes the idle disclosure
   `no redirect ends this node after 30 min of inactivity · typing keeps it open`,
   and line 256 (SC 4.1.3-B) requires the fail path's never-sent announcement
   to name its cause: `node failed · interrupted with no redirect · none of
   this was sent`. Story 2.11's plan explicitly excluded "Story 2.12's
   idle-expiry timer/copy", so the cause-naming copy is this story's. The dock
   learns the cause from the raw `NodeExecution.error` of the selected node
   (the server already projects `error` from `node_failed.data.error` in
   `workflow-execution-history.ts`); the web keeps a local copy of the engine
   constant because `@archon/web` cannot import `@archon/workflows`
   (precedent: `TRIGGER_RULES`). Matching our own fixed engine constant is not
   prose parsing.
9. **Both docks are byte-identical in the affected region.**
   `packages/web/src/components/workflows/ComposerDock.tsx` and
   `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`
   share the idle disclosure block, textarea handlers, and submit logic
   (verified by diff at lines ~800–860 / ~806–866). UX-DR8 requires identical
   anatomy, so Phase 4 mirrors every edit and keeps shared logic in
   `packages/web/src/lib/steering-dock.ts`.
10. **Keepalive throttling is client-side and leading-edge.** The spec says
    "debounced". With a 30-minute window, a leading-edge throttle of 30 s per
    mounted dock is sufficient and never delays the first re-arm: the worst
    case is a re-arm 30 s earlier than the last keystroke. The throttle is a
    pure helper in `steering-dock.ts` so it is unit-tested without React.
    Keepalive failures are intentionally swallowed at the call site with a
    comment — the queue poll and run detail are the authority on state, and
    a 409/422 there means the dock is already leaving idle.
11. **Late responses stay inert.** Story 2.11 introduced per-dock
    `attemptGenerationRef`; keepalive must be gated on `agentMode === 'idle'`
    at call time and must not touch dock state on success, so no generation
    check is needed beyond the existing pattern for errors (none surface).
12. **New route ⇒ regenerated web types.** `api.generated.d.ts` is generated
    from the running server (`bun --filter @archon/web generate:types`, server
    on 3090). Phase 3 sequences this explicitly and never hand-edits the file.

## Scope

Included:

- Registry: inactivity timer on `NodeSteeringHandle`, `keepalive()`, a new
  `expired` idle wake, injectable duration, E2E-gated env override.
- Executor: explicit fail branch at both idle sites, exact error string, no
  session cursor, unconsumed-queue warning, characterization of cancel-poll
  reachability, exactly-once, and fresh-session retry.
- Server: keepalive route + schema + OpenAPI + regenerated web types + client
  helper.
- Web: idle disclosure, keepalive throttle helper and wiring in both docks,
  cause-naming never-sent alert threaded from raw execution evidence in both
  surfaces.
- E2E on the real executor with the fake provider and a shortened timer,
  evidence, authority sync (`steering-test-plan.md`, `steering-api-contract.md`
  wording check, architecture walkthrough if it names the timer), tracker
  closeout.

Excluded:

- Any configurable/YAML/`.archon/config.yaml` timer value (NFR6: fixed).
- Countdown, warning toast, or extend button in the dock (EXPERIENCE.md: "No
  progress bar and no countdown").
- Changes to the interrupt/send/withdraw/queue routes' contracts.
- Story 2.13 ordering/attribution work.
- Post-v1 `delivered` state or soft-inject (G1–G4).

## Design

### 1. Registry timer (Phase 1)

```ts
export const STEERING_IDLE_AWAIT_INACTIVITY_MS = 30 * 60_000;

export type SteeringIdleWake =
  | { readonly kind: 'send_now'; readonly messages: readonly QueuedOperatorMessage[] }
  | { readonly kind: 'terminated' }
  | { readonly kind: 'expired' };
```

`NodeSteeringHandle` gains a private `idleTimer` and the constructor option
`idleAwaitInactivityMs` (supplied by the registry). `enterIdle(token)` arms the
timer after installing the waiter; expiry resolves the waiter `{ kind:
'expired' }` and clears `idleWaiter` only. The handle stays `live` and keeps
projecting `idle-after-interrupt` until the executor's fail finalizer seals it
synchronously — the same microtask-sized window the Cancel path already has,
and a send accepted inside it lands as `awaiting_send_now`, is never drained,
and is recovered by Story 2.11. `keepalive(): 'rearmed' | 'not_idle'` re-arms
only when `phase === 'live'`,
`subState === 'idle-after-interrupt'`, and a waiter exists. `accept(...,
'send_now')`'s first-wins release and `seal()` both clear the timer. Nothing
else changes; `drain`, `withdraw`, `snapshot` are untouched.

### 2. Executor fail branch (Phase 2)

At both idle sites, after the `send_now` branch:

```ts
if (wake.kind === 'expired') {
  return await finishIdleAwaitExpired(); // prompt/command site
}
```

`finishIdleAwaitExpired` is a sibling of `finishCancelled`: seal the handle,
log `dag.node_idle_await_expired`, write `node_failed` with
`error: IDLE_AWAIT_EXPIRED_ERROR`, emit `node_failed`, `recordFailedStatus`,
clear throttle maps, return `{ state: 'failed', output: nodeOutputText, error }`
(no `sessionId`). The loop site calls `failLoopIteration(IDLE_AWAIT_EXPIRED_ERROR, …)`
after a `safeSendMessage` naming the iteration. `terminated` keeps landing on
the existing Cancel path unchanged.

### 3. Keepalive route (Phase 3)

`POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`, bodyless,
`keepaliveWorkflowNodeResponseSchema = { success: true }`, registered through
`registerOpenApiRoute` with `steeringValidationErrorHook`; guard ladder copied
from the interrupt handler; then `handle.keepalive()` and 200 regardless of
`'rearmed' | 'not_idle'`. Client: `keepaliveNode(runId, nodeId)` in
`packages/web/src/lib/api.ts` beside `interruptNode`.

### 4. Dock (Phase 4)

`steering-dock.ts` adds `STEERING_IDLE_AWAIT_DISCLOSURE`,
`STEERING_NEVER_SENT_IDLE_EXPIRED_DISCLOSURE`, `IDLE_AWAIT_EXPIRED_ERROR`,
`neverSentDisclosure(idleAwaitExpired)`, and a pure
`createKeepaliveThrottle(nowFn, windowMs)` returning `shouldSend(): boolean`.
Both docks: render the new disclosure line under the existing interrupt
disclosure when `idle`; call the throttled keepalive from the textarea
`onKeyDown` (skipping the queue/send shortcut) and `onFocus` while
`agentMode === 'idle'`; accept an optional `idleAwaitExpired` prop and pass it
to `neverSentDisclosure`. `execution-room-model.ts` adds
`hasIdleAwaitExpiredEvidence(executions, nodeId)`; the two parents that already
compute `nodeTerminal` compute it and thread it through the same five
components.

### 5. E2E and closeout (Phase 5)

`e2e/ui/agent-idle-await-expiry.spec.ts` runs the real `e2e-queue-guidance`
interruptible scenario with `ARCHON_E2E_STEERING_IDLE_AWAIT_MS` set by the
runtime, proves disclosure text, keepalive request interception on keystroke,
no keepalive on `Send now`, expiry → `node_failed` with the exact error, and the
cause-naming `NEVER SENT` box on both surfaces. Evidence lands under
`reports/evidence/`; authorities and the tracker are updated last.

## Phases

| #   | Phase                                                                                              | Status  |
| --- | -------------------------------------------------------------------------------------------------- | ------- |
| 1   | [Registry inactivity timer and keepalive](./phase-01-registry-inactivity-timer-and-keepalive.md)   | Pending |
| 2   | [Executor explicit fail branch](./phase-02-executor-explicit-fail-branch.md)                       | Pending |
| 3   | [Keepalive route and client](./phase-03-keepalive-route-and-client.md)                             | Pending |
| 4   | [Dock disclosure, keepalive wiring, fail copy](./phase-04-dock-disclosure-keepalive-fail-copy.md)  | Pending |
| 5   | [E2E evidence, authority sync, closeout](./phase-05-e2e-evidence-authority-sync-closeout.md)       | Pending |

## Dependency map

- Phase 1 has no dependencies and is fully specified (deep mode).
- Phase 2 depends on Phase 1 (`expired` wake, injectable duration). **Phases
  1 and 2 ship in the same PR**: until Phase 2 lands, an `expired` wake falls
  through both idle sites' else-branch into the Cancel wording.
- Phase 3 depends on Phase 1 (`keepalive()`); independent of Phase 2.
- Phase 4 depends on Phase 3 (client helper, generated types) and on Phase 2
  only for the engine error constant's final spelling.
- Phase 5 depends on Phases 1–4; it also owns the env-gated E2E runtime wiring
  that Phase 1 makes possible.

Phases 2 and 3 may run in parallel after Phase 1 (disjoint files:
`dag-executor.ts`/`.test.ts` vs `api.ts`/`workflow.schemas.ts`/
`api.workflow-runs.test.ts`/`api.ts` (web)).

## Cross-plan dependencies

| Relationship | Plan                                                           | Status |
| ------------ | -------------------------------------------------------------- | ------ |
| Builds on    | `260919-0139-issue-183-interrupt-and-redirect-claude-agent`    | done   |
| Builds on    | `260920-1136-issue-191-recover-never-sent-messages`            | done   |

## Verification gates (whole plan)

```bash
bun run type-check
bun run lint
bun --filter @archon/workflows test
bun --filter @archon/server test
bun --filter @archon/web test
bun run validate
```

`bun run validate` must pass before the PR. The E2E suite in Phase 5 runs
through `e2e/` per its README.

## Risks

- **Timer fires during the synchronous `send_now` release.** Both run on the
  JS event loop; `accept()` is synchronous and clears the timer before
  resolving the waiter, and an expiry callback checks `idleWaiter !== undefined`
  before resolving. Covered by Phase 1 T1.9.
- **Handle sealed by Cancel while the timer is pending.** `seal()` clears the
  timer; the poll's `terminated` wake wins. Phase 1 T1.7, Phase 2 T2.5.
- **Keepalive storm from a held key.** Leading-edge 30 s throttle per dock;
  the route is O(1) and writes nothing.
- **Generated types drift.** Phase 3 regenerates and commits
  `api.generated.d.ts`; `bun run validate` fails on stale generated files.
- **E2E timing.** The shortened timer must comfortably exceed the fake
  provider's interrupt settle time; Phase 5 chooses 8 s and waits with
  Playwright polling, never fixed sleeps.

- **Server restart during idle-await (accepted limitation).** The registry,
  timer, and the executor's parked continuation are process-local by the
  Story 2.3 design; a restart at minute 10 leaves the run `running` with an
  `interrupted` status row and no timer, exactly as it leaves any mid-stream
  node. AGENTS.md's *No Autonomous Lifecycle Mutation Across Process
  Boundaries* rule forbids a startup sweep that fails such rows on a staleness
  guess; the existing operator surfaces (`workflow abandon`, retry-node) are
  the recovery path. Phase 5 records this in the test-plan authority; no code
  in this story addresses it. <!-- Updated: Red Team 2026-09-20 — Failure Mode F1 -->

## Rollback

Each phase is independently revertible (Phases 1 and 2 revert together). The only cross-package contract is the
new route (additive) and the `expired` union member (additive). No schema,
migration, or data change.

## Red Team Review

### Session — 2026-09-20
**Findings:** 15 (10 accepted, 5 rejected; 2 duplicates merged)
**Severity breakdown:** 3 Critical, 4 High, 8 Medium
**Reviewers:** Security Adversary (Fact Checker — 27 claims sampled, 27 verified, 0 failed), Failure Mode Analyst (Flow Tracer — 5 paths traced, all consistent), Assumption Destroyer (Scope Auditor).

| #  | Finding                                                                 | Severity | Disposition        | Applied To          |
| -- | ----------------------------------------------------------------------- | -------- | ------------------ | ------------------- |
| 1  | Env gate copies a truthiness check (`'false'` enables it)                | Critical | Accept             | Phase 1 §12, plan §5 |
| 2  | Keepalive route has no server-side cap; any authenticated caller extends | High     | Reject             | —                   |
| 3  | Duplicated error-string constant has no compile-time sync                | Medium   | Accept (merged w/ 14) | Phase 4 T4.3, Phase 5 E5 |
| 4  | Handle sealed before the terminal DB write                               | Medium   | Reject             | —                   |
| 5  | E2E ms override not bounds-checked                                        | Medium   | Accept             | Phase 1 §12, T1.11  |
| 6  | Singleton duration override can leak across describes                    | Critical | Accept             | Phase 1 §10, T1.10; Phase 2 |
| 7  | Playwright option declared but not consumed by the `archon` fixture      | High     | Accept             | Phase 5 step 2      |
| 8  | No "latest execution" ordering exists to reuse                           | High     | Accept             | Phase 4 §2, T4.7    |
| 9  | Loop-site `safeSendMessage` arity wrong in snippet                       | Medium   | Accept             | Phase 2 §4          |
| 10 | Fake-timer isolation relies on a bare `afterEach`                        | Medium   | Accept             | Phase 1, plan §4    |
| 11 | Server restart during idle-await orphans the run                         | Critical | Accept (document)  | plan Risks          |
| 12 | Loop-group body error is wrapped at the outer node                       | High     | Accept             | Phase 2 T2.8, Phase 4 §2 |
| 13 | Loop-site terminated path tears the timer down late                      | Medium   | Accept (test only) | Phase 2 T2.5b       |
| 14 | Expiry-vs-send_now race untested at executor level                       | Medium   | Reject             | —                   |
| 15 | Duplicate of #3                                                           | Medium   | Merged             | —                   |

Rejection rationale:

- **#2** — The inactivity semantics are owner-ratified (SC 2.2.1,
  `SPEC.md:144`) and the steering actor grant deliberately lets any
  authenticated identity steer (`steering-test-plan.md:49`); a keepalive is
  the same capability as typing, and a server-side cap would contradict the
  ratified "adjustable by activity" design. This is a product decision the
  plan must not reverse; it is surfaced here for the owner.
- **#4** — Seal-before-terminal-write is the existing `finishCancelled`
  ordering (`dag-executor.ts:3274-3276`); the plan already documents the
  window, and changing it is outside this story.
- **#14** — A test that schedules `send_now` to land "as close as possible"
  to a real timer is nondeterministic (AGENTS.md: no flaky timing). The
  first-wins invariant lives in one synchronous mutation in `accept()` and is
  pinned deterministically by Phase 1 T1.9 with real short timers.

### Whole-Plan Consistency Sweep

Decision delta: no fake timers anywhere (plan §4, Phase 1 insights/tests);
`clearForTests()` resets the duration override (Phase 1 §10, Phase 2 tests
preamble); exact `=== '1'` env gate with bounds check (plan §5, Phase 1 §12,
T1.11); explicit `NodeExecution` ordering and selected-node-id evaluation
(Phase 4 §2, T4.7); loop-group exact assertion on the body row (Phase 2 T2.8);
loop-site cancel teardown test (T2.5b); `archon` fixture consumes
`idleAwaitMs` (Phase 5 §2); Phases 1+2 same PR (dependency map, rollback);
restart limitation recorded (Risks). Swept all six files for "fake timer",
"advanceTimersByTime", "mirrors `registerE2eFakeProvider`", and "same ordering
the module already uses" — every remaining mention is the negation or the
corrected form. No unresolved contradictions.

## Validation Log

### Verification Results — 2026-09-20
- Claims checked: 27 (Fact Checker) + 5 traced flows (Flow Tracer) + 8 state lifetimes (Scope Auditor)
- Verified: 27 | Failed: 0 | Unverified: 0
- Tier: Full (5 phases)
- Failures: none — every cited path, symbol, route, env key, spec line, and UX
  copy string matched the worktree at `49abef22`.

### Interview
Not run: this plan was produced in an unattended `ak-feature` session that
returns the plan path as structured output. The decision points a reviewer
should confirm before cooking are recorded as Red Team #2 (server-side
keepalive cap — rejected as contradicting the owner-ratified inactivity
semantics) and plan decision 8 (cause-naming NEVER SENT copy included from
`EXPERIENCE.md:256`, which Story 2.11 explicitly deferred to 2.12).

<!-- slug: issue-192-fail-abandoned-redirect-after-30-minutes -->
