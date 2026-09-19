# PRD — Issue 182: Withdraw a queued guidance message

## Overview

GitHub issue [#182](https://github.com/kevinle128/Archon/issues/182), Story 2.2 of
the agent node room epic. An operator must be able to delete guidance that is
still waiting in a live or parked process-local node queue. Each locally known
queued row in the Legacy and Console node rooms gets a message-specific
`delete` control backed by:

```
DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId
```

Story 2.1 (queued guidance send) is already implemented and PR #207 is merged;
#182 has no remaining blocker.

## Problem

Queued steering items are immutable once sent. There is no way to withdraw a
message that has been accepted into a node's pending queue but not yet drained
into a provider turn. Operators need a message-specific, idempotent withdraw
that works from both web shells, never mutates on refusal, and moves keyboard
focus predictably when a row disappears.

## Solution

Three increments, in dependency order:

1. **Registry primitive + typed DELETE route.** Add a synchronous, closed-safe
   `NodeSteeringHandle.withdraw(messageId)` that removes only `pending` items
   (never accepted-id memory). Register a bodyless DELETE route that mirrors
   the send route's target ladder, re-reads the run, and — critically —
   re-checks `handle.snapshot().phase` *after* the final await so a handle
   closing during that await returns 409 instead of mutating. Regenerate web
   OpenAPI types from a server owned by this worktree.
2. **Delete control in both web shells.** Extend shared
   `@/lib/steering-dock` state with a single `withdrawingMessageId`, accessible
   naming, and deterministic next→previous→field focus rules. Add the per-row
   `delete` button and request helper to both `ComposerDock` (Legacy) and
   `ConsoleComposerDock` (Console), each through its own request layer.
3. **E2E evidence + closeout.** New Playwright spec proving on both surfaces
   that a withdrawn item never reaches the provider while a sibling does
   (fake-provider `echoPrompt`), plus a live-server route ladder. Write
   `reports/acceptance.md` from observed results, flip
   `2-2-withdraw-a-queued-guidance-message` to `done` in sprint-status, commit,
   and open a `develop` PR with `Closes #182`.

## Goals and success metrics

- `DELETE` returns exact `200 { success: true, message_id }` for removed,
  repeated, already-drained, and never-seen valid ids — the wire response never
  reveals the drain-race winner.
- Auth middleware precedes UUID path validation (401 before 400); nested
  400/401/403/404/409/422/500 errors match the steering contract and mutate no
  queue snapshot, transcript, or run writer.
- Both terminal races return 409 without removing the item: terminal final run
  re-read, and handle closing during that await.
- Both shells issue one bodyless DELETE per click, one withdraw at a time per
  dock, remove only the selected row on 200, retain it on ordinary failure, and
  preserve concurrent send.
- Every row has a native `button[type=button]` named `delete · <trimmed
  message>` with a ≥24×24 target, shell-correct focus ring, honest
  `aria-disabled` pending state, and no overflow at required viewports.
- Focus follows next → previous → field after success, stays on the row after
  ordinary failure, and moves to the detached `role=alert` after 422. No path
  returns focus to `<body>`.
- E2E on both surfaces proves delivery exclusion; `bun run validate` passes.

## Non-goals (explicit exclusions from the plan)

- The UX spine's undefined `keep` action — the issue/API contract defines only
  delete/withdraw; no no-op behavior is invented.
- Stop/interrupt/keepalive/`Send now`, operator transcript rows, queue reads,
  cross-tab convergence, finished-iteration projection, terminal `NEVER SENT`
  restoration (Stories 2.3–2.11).
- Persistence, migrations, workflow events, executor drain changes, automatic
  retries, new dependencies.
- Editing `dag-executor.ts`, send-route behavior, database code, or the
  validation hook's behavior; no shared target-ladder abstraction (two callers
  don't justify it).
- Correcting the stale `2-1` tracker entry; renaming the send-specific error
  class; adding an axe dependency or claiming axe/live-screen-reader passes.
- No staleness timer or autonomous lifecycle mutation on parked queues.

## Technical context

### Key files (Phase 1)

- `packages/workflows/src/steering-registry.ts` — add `withdraw(messageId):
  boolean` after `drain()`: return false when `phase === 'closed'` or id not in
  `pending`; `splice` and return true otherwise. Synchronous (same event-loop
  ordering requirement as `enqueue`/`closeIfEmpty`/`drain`). Never deletes from
  `accepted`, never closes an emptied handle, never resumes parked, never logs
  content.
- `packages/workflows/src/steering-registry.test.ts` — 8 tests covering order
  preservation, never-seen/drained no-ops, repeat no-op, accepted-memory replay
  (`enqueue(A)` after withdraw returns original duplicate receipt), parked
  removal, closed immutability, no auto-close on last removal, drain exclusion.
- `packages/server/src/routes/schemas/workflow.schemas.ts` —
  `withdrawWorkflowNodeParamsSchema` (`runId`/`nodeId` min(1), `messageId`
  uuid, `.strict()`) and `withdrawWorkflowNodeResponseSchema`
  (`success: z.literal(true)`, `message_id` uuid, `.strict().openapi(
  'WithdrawWorkflowNodeResponse')`); derive
  `WithdrawWorkflowNodeResponse` via `z.infer`. `z` comes from
  `@hono/zod-openapi`.
- `packages/server/src/routes/api.ts` — `withdrawWorkflowNodeRoute` next to
  `sendWorkflowNodeRoute`: method `delete`, path
  `/api/workflows/runs/{runId}/nodes/{nodeId}/queue/{messageId}`, all errors via
  `steeringJsonError(...)` including declared 500. DELETE-only auth middleware
  at the colon-param path registered *before* the OpenAPI route (gated
  identity → nested 401 wins over UUID validation; do NOT widen the POST
  middleware, do NOT parse a body). Handler order is the correctness contract:
  auth → validated params → run load (null=404) → events/pending/projection +
  registry handle → send-ladder precedence (no projection+no handle=404;
  terminal run=409; projected completed/failed/skipped=409; closed handle=409;
  no handle=422; parked allowed) → re-read run (null=404, terminal=409) →
  **post-await** `handle.snapshot().phase` recheck (closed=409) → synchronous
  `handle.withdraw(messageId)` with no intervening await → log
  `api.workflow_node_withdraw_completed` with `{ runId, nodeId, messageId,
  operatorUserId, removed }` only → return exact `{ success: true, message_id
  }`. Exceptions log `api.workflow_node_withdraw_failed` and return nested 500
  `internal_error`.
- `packages/server/src/routes/openapi-defaults.ts` — broaden the
  `steeringValidationErrorHook` comment to all steering routes; no behavior
  change.
- `packages/server/src/routes/api.workflow-runs.test.ts` — new block
  `DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId — withdraw
  queued guidance`; add `deleteNodeQueue` helper beside `postNodeSend`; lift
  shared steering fixtures verbatim; 19 test cases across
  auth/validation/target ladder/idempotency, including the critical
  handle-closes-during-final-await race → 409 with item still queued.
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` — one
  sentence: DELETE may remove an already-accepted item from a parked retained
  queue (it manages the queue, not the live provider session); sends remain
  refused while parked; closed handle still returns `node_finished`.
- `packages/web/src/lib/api.generated.d.ts` — regenerate ONLY from a server
  whose PID/worktree is verified (`lsof` the port, check `/api/openapi.json`
  contains the DELETE path and `WithdrawWorkflowNodeResponse` before and
  after). If 3090 is owned by another session, run `openapi-typescript` in
  `packages/web` against an explicit alternate `PORT`; never stop another
  session's server.

### Key files (Phase 2)

- `packages/web/src/lib/steering-dock.ts` — extend `SteeringDockState` with
  `readonly withdrawingMessageId: string | null` (update ALL constructors/
  transitions; `resolveGuidanceSuccess` returns an explicit object and must be
  changed deliberately). Add `beginWithdraw`, `resolveWithdrawSuccess`,
  `resolveWithdrawFailure`, `STEERING_DELETE_LABEL = 'delete'`,
  `deleteButtonAccessibleName(message)` → `delete · ${message.trim()}`,
  `RemovalFocusTarget` type, and `nextFocusAfterRemoval(orderedIds, removedId)`
  (next → previous → field; unknown id → field). Single active id is
  intentional (one refusal channel, one focus transfer).
- `packages/web/src/lib/api.ts` and
  `packages/web/src/experiments/console/skills/runs.ts` — export generated
  `WithdrawWorkflowNodeResponse` type and `withdrawNodeGuidance(runId, nodeId,
  messageId)`: DELETE with encoded path params, no body/no synthetic content
  type, no retry, failures normalized through existing `toSteeringSendError`.
- `packages/web/src/components/workflows/ComposerDock.tsx` and
  `.../console/components/ConsoleComposerDock.tsx` — optional `withdraw?:`
  prop defaulting to the shell helper; exported `WithdrawNodeGuidance` type;
  `Map<string, HTMLButtonElement>` ref (delete key on null callback);
  `pendingFocusRef`; `tabIndex={-1}` ref for detached `role=alert`. Button
  renders after `sent` text: `aria-label` from `deleteButtonAccessibleName`,
  `aria-disabled` (never native `disabled`), `min-h-[24px] min-w-[24px]` +
  padding, flex-none right edge; message span stays `min-w-0 flex-1
  overflow-hidden text-ellipsis whitespace-nowrap`. Focus rings: Legacy
  `focus-visible:outline-2 focus-visible:outline-accent-bright
  focus-visible:-outline-offset-2`; Console `...outline-accent-bright!
  focus-visible:outline-offset-2`. Available in `composer` and `blocked` modes;
  `hidden` unchanged. Effect keyed to `dock.sent` consumes pending focus →
  mapped button else textarea. 422 follows existing detached disclosure and
  focuses its alert (same rule for send-triggered 422).
- Console isolation: no Console file imports `@/lib/api` or Legacy components
  (`experiments/console/console-isolation.test.ts` must stay green).
- `NodeTranscriptPane.tsx` / `ConsoleNodeRoom.tsx` — no production change
  (prop is optional); still run their tests.

### Key files (Phase 3)

- `e2e/ui/agent-withdraw-guidance.spec.ts` — NEW self-contained spec
  (`[P1]`, `[V:withdraw.*]` ids): `drain-console`/`drain-legacy` (two-message
  delivery exclusion; Enter on one surface, Space on the other; assert bodyless
  DELETE, exact 200, `queued · 1`, focus transfer, provider sees only the
  sibling echo), `last-console`/`last-legacy` (only-row removal → band gone,
  focus to labelled textarea, reduced-motion parity, no resumed echo),
  `route-ladder` (200 repeat, unknown UUID 200, `not-a-uuid` → 400, unknown
  node/run → 404, detached run → 422 `not_steerable_here`, completed run → 409
  `node_finished`). Local copies of the few needed helpers — do NOT refactor
  `agent-queue-guidance.spec.ts`. Waits on events/DOM/status, never fixed
  sleeps; echo-enabled unique markers for every absence assertion; tracked
  `startDetachedWorkflow` for cleanup.
- `plans/.../reports/evidence/` — screenshots + measurements JSON (two-row and
  one-row states, accessible names, target geometry ≥24×24, elision/overflow,
  focus outline, viewport/room width, reduced-motion parity). Legacy at 460px;
  Console at 1440×900 run-detail + 460px overflow guard.
- `plans/.../reports/acceptance.md` — criterion → test/command/result mapping,
  written ONLY from observed results; records drain-race ambiguity, local-only
  UI, process-local queue limits, and any unrun checks.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` —
  flip ONLY `2-2-withdraw-a-queued-guidance-message` to `done`, committed
  BEFORE the PR is opened.
- PR: `gh pr create --base develop`, body built from
  `.github/pull_request_template.md` (keep Problem and outcome, Review
  guidance, Solution, Validation; delete instructional comments and empty
  conditional sections), includes `Closes #182`, calls out the final
  phase-check race and delivery-exclusion test for reviewers.

### Guardrails

- Never run bare `bun test` at the repository root.
- Type generation must use a server owned by this worktree on a checked free
  port; never stop or consume another session's server.
- No `any`, strict TypeScript, complete annotations; no new dependencies.
- Validation sequence per phase (see plan files), then:
  `(cd e2e && npm run typecheck)`,
  `bun run --cwd e2e test:ui -- --grep 'withdraw|queue guidance'`,
  `bun run validate`, `bun run format:check`, `git diff --check`.

## Story overview

| ID     | Title                                              | Depends on | Phase |
| ------ | -------------------------------------------------- | ---------- | ----- |
| US-001 | Registry withdraw primitive + typed DELETE route   | —          | 1     |
| US-002 | Delete control in Legacy + Console docks           | US-001     | 2     |
| US-003 | E2E evidence, acceptance report, sprint closeout   | US-001, 002| 3     |
