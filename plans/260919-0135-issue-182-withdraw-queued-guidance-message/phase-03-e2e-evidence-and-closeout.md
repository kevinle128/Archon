---
phase: 3
title: 'End-to-end evidence and closeout'
status: pending
priority: P1
effort: '1 session'
dependencies: [1, 2]
---

# Phase 3: End-to-end evidence and closeout

## Goal

Prove through the real server and both UI shells that DELETE removes a pending
item from delivery, that an already-drained/unknown id remains idempotent, and
that the delete control meets the story's keyboard, focus, geometry, and
responsive requirements. Record only evidence actually produced, run final
validation, include the sprint-status change in the same branch, and open the
`develop` PR.

## Source anchors

- `e2e/ui/agent-queue-guidance.spec.ts` for workflow dispatch, room opening,
  response waits, route smoke, screenshots, and both-surface loops.
- `e2e/fixtures/workflows/e2e-queue-guidance.yaml` for the bounded 30-second
  first-turn delay.
- `packages/providers/src/e2e-fake/provider.ts` for the opt-in
  `echoPrompt` resumed-turn proof.
- `e2e/lib/playwright/archon-runtime.ts` and
  `e2e/lib/playwright/run-detail.ts` for tracked web/detached runs, authenticated
  fetch, run-state waits, and node messages.
- `.github/pull_request_template.md` and
  `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
  for closeout.

## Files

| File                                                                                 | Change                                                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `e2e/ui/agent-withdraw-guidance.spec.ts`                                             | New focused Playwright spec: two both-surface delivery/focus tests and one live-server route-ladder test. |
| `plans/260919-0135-issue-182-withdraw-queued-guidance-message/reports/evidence/`     | Generated screenshots and compact measurements JSON.                                                      |
| `plans/260919-0135-issue-182-withdraw-queued-guidance-message/reports/acceptance.md` | Criterion-to-test/result report with exact commands and limitations.                                      |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`           | Change only `2-2-withdraw-a-queued-guidance-message` from backlog to done after all gates pass.           |

Do not refactor `agent-queue-guidance.spec.ts` merely to share two callers'
small locators. Under the repository rule of three, keep the new spec
self-contained with local versions of the few required helpers
(`openGuidanceRoom`, field/list locators, route path, node-start poll, and
transcript text projection). Do not copy its large general-purpose contrast
suite; this story needs only action-specific geometry/focus/overflow evidence.

No new fixture, fake-provider option, Playwright dependency, or runtime helper
is expected.

## Test design

Use `[P1]` and stable `[V:withdraw.*]` ids. Every workflow is started through
the tracked runtime fixture and every state transition waits on an event,
response, DOM assertion, or run status—not a fixed sleep.

### 1. Two-message delivery exclusion, both surfaces

`[V:withdraw.drain-console]` and `[V:withdraw.drain-legacy]`:

1. Start a fresh web-dispatched `e2e-queue-guidance` run and wait for
   `node_started`.
2. Queue a deliberately long obsolete first instruction and capture its POST
   200 `message_id`.
3. Queue a second instruction carrying the fake provider's `echoPrompt: true`
   directive and capture its different id.
4. Assert `queued · 2`, ordered list rows, full message-specific accessible
   names, native button types, and no horizontal overflow.
5. At Legacy's 460px viewport and Console's normal 1440×900 run-detail layout
   (plus the existing 460px overflow guard), assert the first message visibly
   elides rather than wrapping and the delete target measures at least 24×24.
   Focus it and verify a nonzero computed outline; capture the two-row evidence.
6. Activate the first row from the keyboard (use Enter on one surface and Space
   on the other so both native activation paths are exercised). Await the
   matching DELETE response, assert no request body, exact path id, and exact
   200 `{ success: true, message_id: firstId }`.
7. Assert `queued · 1`, only the second row remains, and focus is on that row's
   delete control. Capture the post-delete evidence.
8. Wait for completion. Node messages contain exactly one resumed echo of the
   second stripped prompt and contain neither the first text nor an echo that
   includes it. The node still has one execution and one `node_started` event.

This is the primary product proof: UI removal alone is insufficient.

### 2. Last-row removal, both surfaces

`[V:withdraw.last-console]` and `[V:withdraw.last-legacy]`:

1. Start a fresh delayed run and queue one uniquely marked message with
   `echoPrompt: true`. The directive is required—without it, absence of an
   echo would not prove non-delivery.
2. Focus and keyboard-activate its delete control; assert the exact DELETE 200.
3. Assert the band/list disappear, focus lands on the labelled textarea, and
   `document.activeElement` is not `body`.
4. Emulate reduced motion and confirm the same final DOM/focus state. No new
   animation should exist; record this as parity, not as an animation test.
5. Wait for completion and assert no resumed echo contains the unique marker.

### 3. Live-server route ladder

`[V:withdraw.route-ladder]`, once via `archon.starterFetch`:

1. On a live delayed node, POST one message and retain its id.
2. DELETE it → exact 200. Repeat the same DELETE → identical 200.
3. DELETE a random never-queued UUID → exact 200 echoing that id.
4. DELETE `not-a-uuid` → nested 400 `invalid_request`.
5. Valid id against an unknown node → nested 404 `not_found`; valid id against
   an unknown run → nested 404.
6. Start a tracked detached run, wait for `running` and `node_started`, then
   DELETE a valid id → nested 422 `not_steerable_here`.
7. After the web run completes, DELETE a valid id → nested 409
   `node_finished`.
8. Compare node-message counts before and after refusal requests on real runs
   where a node exists. Unit route tests remain the proof of queue and mocked
   writer immutability; do not claim E2E can inspect the process-local queue.

The actor matrix, parked handle, internal 500, and handle-close race remain
focused server/registry tests; repeating them through Playwright adds cost
without stronger evidence.

## Action-specific visual and accessibility evidence

Record per surface:

- two-row state before deletion and one-row state after deletion;
- accessible names and DOM button type;
- target width/height;
- computed overflow/wrapping facts for the long message;
- active element before and after removal;
- visible outline width/color when focused;
- viewport and room width;
- reduced-motion final-state parity.

Required viewports/states:

| Surface | Viewport/state                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy  | 460px-wide node room, two rows with long first message; focused delete; one row after success; empty band after last-row success.       |
| Console | Normal 1440×900 run-detail panel plus the same 460px overflow guard; the same interaction states and Console focus ring.                |
| Both    | Pending semantics are covered in component tests; refusal and blocked-with-row states are structural tests, not fabricated screenshots. |

The current E2E package has no axe dependency. Do not add one for this story and
do not say an axe or live screen-reader audit passed. The acceptance report may
state that native semantics, accessible-name computation, keyboard activation,
focus transfer, geometry, and computed styles were automated.

## Validation order

1. Run the new spec alone while developing:

   ```bash
   (cd e2e && npm run typecheck)
   bun run --cwd e2e test:ui -- --grep 'withdraw'
   ```

2. Rerun Story 2.1's E2E and all focused package suites from the main plan:

   ```bash
   bun run --cwd e2e test:ui -- --grep 'withdraw|queue guidance'
   ```

3. Run `bun run validate` against the completed production/test changes.
4. Write `reports/acceptance.md` from the observed command results, test ids,
   screenshots, measurements, and explicit unrun checks. Only now—after every
   behavioral gate is green—change the `2-2` sprint-status line to `done`.
   Leave `2-1` untouched.
5. Run `bun run format:check` and `git diff --check` against the final
   report/status diff. If either edit touches anything outside markdown/YAML,
   rerun `bun run validate`.
6. Inspect `git status --short` and process ownership.
   Stop only servers/browser processes started by this worktree.

## Acceptance report contents

The report maps each Story 2.2 criterion to:

- registry/server/component/E2E test names;
- exact result counts and commands;
- evidence filenames and measured values;
- the delivery-exclusion assertion;
- the route race/refusal assertions;
- known v1 limitations (drain race ambiguity, local-only UI, process-local
  queue);
- checks not run (axe/live screen reader, if still not run).

Do not pre-create passing claims. The report is written from observed results.

## Commit and PR closeout

After all validation and the final status edit:

1. Commit focused conventional changes without issue/phase/audit labels or AI
   references.
2. Build the PR body from `.github/pull_request_template.md`: keep Problem and
   outcome, Review guidance, Solution, and Validation; remove instructional
   comments and conditional sections that add no information.
3. Include `Closes #182`, target `develop`, and call out the final phase-check
   race and delivery-exclusion test for reviewers.
4. Create the PR with `gh pr create --base develop` and the explicit prepared
   body.

The sprint-status edit must be committed before the PR is opened; the original
draft's order would have left the required closeout change outside the PR.

## Phase completion criteria

- Both shells prove the withdrawn item does not reach the provider while a
  sibling does.
- Both shells prove last-row focus restoration and no resumed echo.
- Live server proves 200/400/404/409/422 wire behavior; unit tests prove
  actor/parked/500/race details and mutation safety.
- Required viewports and interaction states have honest screenshots and
  measurements.
- E2E typecheck, focused E2E, Story 2.1 regression E2E, `bun run validate`,
  and final formatting all pass.
- Acceptance report and `2-2: done` are in the committed PR diff.
- No process started for the work remains orphaned.

## Risks and rollback

- **30-second window:** attach response promises before each action and use
  event/status waits. If this is empirically insufficient, add a separate
  longer-delay withdraw fixture; do not modify Story 2.1's fixture or hide the
  problem with arbitrary sleeps.
- **False delivery proof:** every absence assertion uses an echo-enabled unique
  marker. A plain prompt with no echo directive is not evidence.
- **Detached child cleanup:** use the tracked
  `startDetachedWorkflow` helper so runtime teardown owns the child.
- E2E/evidence/status changes are additive and revert with the feature PR; no
  external data or deployment rollback is required.
