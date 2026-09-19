---
title: 'Issue 182 withdraw a queued guidance message'
description: 'Implementation-ready TDD plan for Story 2.2: an idempotent typed withdraw route that removes a still-queued operator message from the live node registry, plus an accessible per-item delete control in both node-room shells.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/182'
branch: archon/thread-1889047a
tags: [issue-182, agent-node-room, workflows, server, web, e2e, tdd]
blockedBy: [project:260918-1721-issue-181-queue-guidance-for-running-agent]
blocks: []
created: 2026-09-19
mode: deep
---

# Issue 182 withdraw a queued guidance message

## Outcome

An operator who queued guidance for a running agent node (Story 2.1, merged as #207) can withdraw it before it drains. Each row in the `queued · n` band gets a delete control. Activating it calls the already-ratified `DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId` route, which removes the message from the process-local registry queue and returns `{ success: true, message_id }`. A withdraw of a message that already drained, or of an id the queue never held, returns the same success shape — there is no message-level 404. Unknown run or node, unauthenticated caller, terminal node, detached run, and malformed request each return the canonical nested steering error without touching the queue, the node, or the transcript.

Both the Legacy `ComposerDock` and the Console `ConsoleComposerDock` render the control with an accessible name that identifies the specific message, and move focus deterministically after removal — never to `<body>`.

## Scope boundary

This plan implements Story 2.2 and nothing else:

- one synchronous `withdraw(messageId)` primitive on `NodeSteeringHandle`;
- the canonical withdraw route, its response schema, its OpenAPI registration, and regenerated web types;
- a per-item delete control in both shells, sharing framework-free state transitions in `@/lib/steering-dock`;
- E2E proof that a withdrawn message never reaches the agent while a sibling still drains, plus the route ladder and accessibility checks;
- moving `2-2-withdraw-a-queued-guidance-message` to `done` in `sprint-status.yaml` as the last closeout step.

Deliberately excluded:

- the per-item **keep** control that `EXPERIENCE.md` and `DESIGN.md` mention beside delete — no story defines its behavior and Story 2.2 asks only for delete;
- Stop / interrupt / `idle-after-interrupt` / `Send now` (2.3), provider soft-injection (2.4–2.7), operator transcript rows and reconciliation (2.8);
- any queue-read route, polling, cross-tab or cross-operator convergence, or rehydration after navigation (2.9 — which depends on this story);
- finished-iteration queue projection (2.10) and terminal `NEVER SENT` restoration (2.11);
- changes to `steering-api-contract.md`, to the send route's behavior, or to the `2-1` sprint-status entry (still `backlog` at HEAD despite #207 — out of scope, noted only).

There is no schema migration, no durable steering state, no new workflow event, and no new package dependency.

## Evidence checked

| Evidence | Verified implication |
| --- | --- |
| Issue #182 and Story 2.2 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:444-470` | Four acceptance groups: live removal returns `{success, message_id}`; drained/unknown id is an idempotent success; contract errors leave state unchanged; delete control has a message-specific accessible name and predictable focus. |
| `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` | Route is `DELETE …/queue/:messageId` with no body; response `{ success: true, message_id }`; error ladder 401/403, 404 (run/node only), 400, 409 `node_finished`, 422 `not_steerable_here`; "every rejected request leaves the node, queue, and transcript unchanged". |
| `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md:54,73` | Withdraw removes a still-queued message; drained or unknown id → success no-op; the `x` in the band fires the withdraw route for that `message_id`. |
| `packages/workflows/src/steering-registry.ts` | `NodeSteeringHandle` keeps `pending` (the queue) separate from `accepted` (idempotency memory). `drain()` is synchronous and atomic. No withdraw primitive exists yet. |
| `packages/workflows/src/dag-executor.ts:3336-3351` and `:6883-6910` | Both natural-boundary drains are fully synchronous between `closeIfEmpty()`/`pendingCount()` and `drain()` — a synchronous withdraw can never land inside the window, so the executor never runs an empty guidance turn. No executor change is needed. |
| `packages/server/src/routes/api.ts:1574-1608, 5173-5290` and `openapi-defaults.ts:59-73` | The send route establishes the pattern: route-scoped `app.use` for auth-before-validation, `steeringError()` helper, `steeringValidationErrorHook`, projection-first target ladder, run re-read before the synchronous mutation. |
| `packages/server/src/routes/api.workflow-runs.test.ts:6162-6660` | Test fixtures (`mockSteerableRun`, `steerEvent`, `liveSetup`, `expectNoSteeringMutation`, `expectSteeringError`) are reusable for the withdraw suite. |
| `packages/web/src/lib/steering-dock.ts` and both dock components | `SteeringDockState.sent` is the only queue evidence; `steeringDockMode` already flips to `detached` on any stored `not_steerable_here` refusal, so a withdraw 422 needs no special case. Both shells duplicate JSX thinly and share logic through `@/lib/steering-dock` (the one approved seam in `console-isolation.test.ts`). |
| `EXPERIENCE.md:135,260-267` and `DESIGN.md:647-655` (ux-Archon-agent-node-room-2026-09-09) | Draft items carry text-button per-item controls at the 24×24 floor grown on padding; list semantics with a count-bearing name; the visible word must start the accessible name (SC 2.5.3); focus never lands on `<body>`. |
| `e2e/ui/agent-queue-guidance.spec.ts` and `e2e/fixtures/workflows/e2e-queue-guidance.yaml` | The fake provider's 30 s delay leaves a wide window to queue then withdraw before the natural boundary; `starterFetch`, `startDetachedWorkflow`, `listNodeMessages`, and the echo scenario already prove what drained. |
| `gh pr view 207` | Feature PRs target `develop`. |

## Design decisions

1. **Withdraw mutates `pending` only, never `accepted`.** A send replay of a withdrawn `message_id` must still return the original `queued` receipt without re-enqueueing — the contract's full-lifetime idempotency stays intact and the dock's ambiguous-retry id reuse cannot resurrect a withdrawn message. This is a named registry test.
2. **The handle primitive is phase-agnostic; the route owns the lifecycle ladder.** `withdraw()` removes from the queue on live, parked, and closed handles alike and returns whether anything was removed. The route refuses closed handles with 409 before calling it, so a finished node's retained items are never altered.
3. **A parked (AskHuman) handle accepts withdraw.** Send refuses new messages while parked (422) because nothing new can be accepted; withdraw is a queue operation on an intact queue. The band is still rendered in the dock's `blocked` mode, so the UI will issue these requests. This is the one deliberate divergence from the send ladder.
4. **`messageId` is validated as a UUID → 400 `invalid_request`.** The send schema only ever accepts UUID ids, so a non-UUID can never be queued and cannot collide with "unknown id → 200". Without this check the route's documented 400 is unreachable and the OpenAPI spec would misdescribe the id.
5. **Same target ladder and mutation order as send.** 401 → 400 → 404 run → 404 node (no projection and no handle) → 409 terminal run / terminal node / closed handle → 422 no handle → run re-read (409) → synchronous `withdraw` → 200. No `await` between the re-read and the mutation.
6. **200 always after the ladder, regardless of `removed`.** The response never distinguishes removed from no-op; the server logs `{ runId, nodeId, messageId, removed }` (ids are not content) so operators can audit races.
7. **A withdraw that loses the drain race still delivers the message.** The UI removes the row on 200 and cannot know the message drained a moment earlier. This is an accepted v1 gap: Story 2.8 (operator rows) and 2.9 (queue read) make it visible. The plan does not invent a read route.
8. **Deterministic focus after removal, identical in both shells:** the next row's delete control → else the previous row's → else the composer textarea. The rule is stated, tested, and never left to the browser.
9. **Accessible name starts with the visible word.** Visible text `delete`; accessible name `delete · <message text>`. The `role="status"` region already announces the new `queued · n` count; no extra live region is added.
10. **Per-row in-flight guard, not a dock-wide one.** Deleting one row must not block queueing or deleting another. The state tracks withdrawing ids; a control in flight is `aria-disabled` (never the native attribute, which would drop focus).
11. **The gate for this plan is the advisor review.** This is an unattended Archon run; the validation interview and red-team subagents are replaced by the advisor pass recorded below, as the #181 plan precedent did.

## Delivery phases

| # | Phase | Depends on |
| --- | --- | --- |
| 1 | [Registry withdraw primitive and typed DELETE route](./phase-01-start.md) | — |
| 2 | [Web delete control in both shells](./phase-02-web-delete-control-in-both-shells.md) | Phase 1 |
| 3 | [E2E evidence and closeout](./phase-03-e2e-evidence-and-closeout.md) | Phases 1–2 |

Deep mode: Phase 1 is fully scouted here. Phases 2 and 3 are outlined with their file inventory and test matrix; each gets a dedicated scout pass at cook time before execution (re-read the two dock components and the E2E spec, which Phase 1 does not touch).

## Dependency map

- Phase 1 → Phase 2: the regenerated `api.generated.d.ts` supplies `WithdrawWorkflowNodeResponse`; both API helpers and the `withdraw` prop type derive from it.
- Phase 1 → Phase 3: the route ladder E2E hits the live server; Phase 2 → Phase 3: the UI drain-proof E2E uses the delete control.
- External: this story feeds Story 2.9 (shared queue reads) — keep the `withdraw` prop injectable so a later authoritative queue projection can replace `sent` without changing the control.

## Contract and compatibility summary

- Public API: implement the ratified withdraw route exactly. Do not add a body, a queue GET, or new error codes.
- Internal API: extend the `./steering-registry` subpath with one method; no package dependency changes.
- Persistence: none — the queue stays process-local by v1 design.
- Existing behavior: send route, executor drains, cancel cleanup, and both docks' Story 2.1 states are byte-for-byte unchanged when no delete control is used.
- Rollback: one PR, no migration, no flag. Reverting restores Story 2.1 behavior.

## Phase-wide validation

Run focused suites first, then the package gates, then repository validation. Never run `bun test` from the repository root.

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'withdraw')
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/console-isolation.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'withdraw'
bun run validate
```

## Acceptance criteria

- [ ] Registry: `withdraw(id)` removes exactly the matching pending item and preserves order, accepted-id memory, and phase; a replayed send of a withdrawn id returns the original receipt with no re-enqueue.
- [ ] Route: the actor matrix, 400 (non-UUID id), 404 (run, node), 409 (terminal run, terminal node, closed handle, terminal race), and 422 (no handle) match the contract and leave the handle snapshot and transcript writers unchanged; a parked handle withdraws successfully.
- [ ] Route: live removal, repeat withdraw, drained id, and never-seen id all return 200 `{ success: true, message_id }`.
- [ ] Web: each queued row renders a `delete` control whose accessible name identifies its message; activation calls the withdraw helper once with that `message_id`; success removes the row and updates `queued · n`; failure keeps the row and shows the refusal; a 422 flips the dock to the detached disclosure.
- [ ] Web: focus after removal follows the stated rule in both shells; the control is keyboard-operable and `aria-disabled` while in flight.
- [ ] E2E: on both shells, queue two messages, delete the first, and prove only the second drains; the route ladder and accessibility checks pass.
- [ ] All focused suites, `bun run validate`, and `e2e` typecheck pass without weakening existing assertions.
- [ ] Closeout: PR uses the template, targets `develop`, includes `Closes #182`, and moves the `2-2` sprint-status entry to `done`.

## Residual risks and operational notes

- The drain race (decision 7) means a 200 can be returned for a message the agent is already reading. The UI cannot show this until 2.8/2.9; the server log line is the only trace today.
- A row deleted in one tab stays visible in another tab until 2.9 — the same non-convergence Story 2.1 accepted.
- Regenerating `api.generated.d.ts` requires a server of THIS worktree on port 3090 (`PORT=3090 bun run dev:server` — a worktree otherwise auto-allocates 3190–4089): check `lsof -i :3090` first, record the PID you start, verify the diff contains the withdraw schema, stop only that PID.
- `sprint-status.yaml` is edited by hand in closeout because the issue AC requires it; the `2-1` entry is left as found.

## Advisor review

Reviewed 2026-09-19 by the advisor gate (replacing the interactive validation interview and red-team subagents — decision 11). Two passes: one before drafting (design decisions 1–5 and the executor drain-window scout were confirmed there) and one on the written plan. Findings from the second pass and their disposition:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | `generate:types` is hardcoded to port 3090 while a worktree server auto-allocates 3190–4089; a bare `dev:server` could regenerate types from the main checkout's server without the withdraw route. | **Applied** — Phase 1 type regeneration now uses `PORT=3090`, verified against `port-allocation.ts`, and asserts the diff contains `WithdrawWorkflowNodeResponse` before the PID is stopped. |
| 2 | Route test 14 did not prove the DELETE-only middleware's reason to exist (401 must beat the param validator's 400). | **Applied** — test 14 now uses a non-UUID id on a gated unauthenticated call; the Refactor step states the middleware must be registered before the route. |
| 3 | E2E 5 (parked-handle withdraw) depends on a pre-ask generating window the fixture may not have. | **Applied** — scout-time check added with an explicit skip fallback (route test 22 + registry test 6 already prove decision 3). |
| 4 | Phase 1 left a fork on extracting a shared target-ladder helper. | **Applied** — duplicate inline, citing the rule of three; the send handler is not touched. |

Whole-plan consistency sweep after the edits: no remaining reference to `resolveSteeringTarget` or a bare `dev:server` step; the send suite is described consistently as untouched across plan.md, phase 1, and its risk table; `ak plan validate` passes.

## Task hydration

No live task-management surface is available in this session; progress is tracked in the phase files' Todo checklists (`ak plan status`).

<!-- slug: issue-182-withdraw-queued-guidance-message -->
