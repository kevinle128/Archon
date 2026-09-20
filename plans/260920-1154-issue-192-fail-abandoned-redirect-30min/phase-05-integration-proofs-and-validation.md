---
title: 'Phase 5: End-to-end evidence, compatibility, and closeout'
status: completed
---

# Phase 5: End-to-end evidence, compatibility, and closeout

## Outcome

Prove the complete Story 2.12 user outcome on both shells, verify existing retry and reconciliation contracts, run the full gates, and update the tracker only after every check passes.

## End-to-end strategy

Do not make a browser test wait 30 minutes and do not add a production timeout override.
Use two complementary proofs:

1. Fake-timer registry and executor tests prove the real 1,800,000-millisecond lifecycle, re-arm behavior, and first-wins settlement.
2. Playwright uses the real server route for composer activity and a persisted structured terminal-event fixture for the timeout-specific visual state.

The persisted terminal fixture is presentation evidence only.
It must not be reported as the engine timer proof.

## Real keepalive journey

Extend `e2e/ui/agent-interrupt-redirect.spec.ts` instead of creating a duplicate node-room journey.
Use the existing fake provider, real web dispatch, real interrupt route, and both `console` and `legacy` parameterizations.

Add a keepalive-path tracker and prove:

1. The node reaches real `idle-after-interrupt` and still has status `running`.
2. The exact stop disclosure and exact inactivity disclosure are visible in order.
3. Focusing the textarea sends one bodyless keepalive POST and receives exactly `{ success: true }`.
4. A burst of input inside the one-second window is coalesced.
5. Activity after the window sends another keepalive.
6. Focusing and activating `Send now` does not add a keepalive request.
7. After `Send now` returns the node to generating, field focus or change does not send keepalive.
8. The redirect still resumes the same provider session and the run completes.
9. No request contains the draft text or other message content.

Use new Story 2.12 evidence names under:

`plans/260920-1154-issue-192-fail-abandoned-redirect-30min/reports/evidence/`

Do not overwrite evidence owned by Story 2.3.

## Timeout terminal presentation journey

Extend `e2e/ui/agent-never-sent.spec.ts` so it can reuse the shipped terminal-reconciliation journey and both-shell helpers.

Use an isolated worker database and the repository's existing SQLite fixture pattern:

1. Start a real steerable run.
2. Reach idle-after-interrupt and create observed queued messages plus a raw draft.
3. End the node through the existing real terminal path and wait for its persisted `node_failed` execution.
4. In the worker's isolated database, set the run status to `failed` and update that test event's data to the exact engine shape with the exact error and `failure_reason: 'idle_after_interrupt_timeout'`.
5. Reopen the room so the normal API, event fold, terminal reconciliation, and render path consume that persisted shape.

Do not add a product test endpoint, timeout environment variable, or production fixture branch.
Keep the database helper local to the E2E test and label the case as terminal-presentation evidence.

Prove on Legacy and Console:

- The ordered `Never sent` list includes queued messages and the raw draft.
- The exact visible timeout failure text appears.
- One polite status has `node failed · interrupted with no redirect · none of this was sent`.
- The generic timeout alert is absent.
- No textarea, Stop, Queue, Send now, or delete control remains.
- Focus is on the transcript row or scroller and never `<body>`.
- The same cause with no unmatched items still shows the failure disclosure without an empty list shell.

## Visual evidence

Capture idle and timeout-failed states on both shells at:

- 460 × 900.
- 1440 × 900, recording the actual room width and the Console panel width.

For every capture, assert before writing evidence:

- The room causes no horizontal overflow.
- Both idle disclosure lines or the terminal failure disclosure, as applicable, are visible and not clipped.
- Existing control target sizes and focus-ring contrast remain within the ratified values.
- The queue or `Never sent` band remains full width and its scroll container keeps the 33vh cap.
- The transcript's final row is not covered by the sibling dock.
- The timeout-failed state has no interactive dock control.

Read the saved screenshots before accepting them.
Treat overlap, clipping, wrong copy, weak focus, or shell drift as a failure even if locators pass.

## Existing contract proofs

### `Never sent`

The engine tests must show that expiry writes no operator row for pending message ids.
The browser test must show that the existing observed-ledger reconciliation restores those unmatched ids and the raw draft.
Do not change the Story 2.11 ledger algorithm unless this proof exposes a real defect.

### Fresh manual retry

`packages/core/src/operations/workflow-retry.ts` already deletes persisted sessions for every invalidated node.
`packages/core/src/operations/workflow-retry.test.ts` already has a direct deletion test.

Verify that test and add only the smallest missing assertion if needed:

- The target node is among the invalidated ids.
- Deletion happens before retry dispatch.
- All providers for that workflow, scope, and node are removed.

Combine that proof with the executor's negative `upsertWorkflowNodeSession` assertion and the fresh `lastSequentialSession` created by a new execution call.
Do not add a second session-clearing path specific to timeout failures.

## Focused verification order

Run the narrowest gates first and broaden only after they pass.
Do not run root `bun test`.

```bash
cd packages/workflows
bun test src/steering-registry.test.ts
bun test src/dag-executor.test.ts
bun run type-check

cd ../server
bun test src/routes/api.workflow-runs.test.ts
bun run type-check

cd ../web
NODE_ENV=development bun test src/lib/steering-dock.test.ts src/lib/execution-room-model.test.ts
NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx
bun run type-check

cd ../..
bun --filter @archon/core test
bun run build:web

cd e2e
npm run typecheck
ARCHON_E2E_PROOF=1 npx playwright test -c playwright.config.ts ui/agent-interrupt-redirect.spec.ts ui/agent-never-sent.spec.ts

cd ..
bun run validate
```

The full Core package test command is intentional because direct isolated execution of `workflow-retry.test.ts` does not establish this workspace's package-resolution setup.
The root `bun run validate` command is the CI-equivalent repository gate.
Playwright is outside the Bun workspace and is not included in that gate.

No PostgreSQL schema changed, so `bun run check:schema-upgrades` is not required.

## Final review

Review the final implementation from all nine required perspectives:

1. Confirm the product outcome is a bounded and recoverable abandoned redirect, not a general run watchdog.
2. Confirm the handle owns one timer and one waiter without a public timeout seam.
3. Confirm the OpenAPI response, event discriminator, generated types, and existing steering errors are exact.
4. Confirm auth, first-wins settlement, no-auto-retry, timer cleanup, session cleanup, and transcript integrity.
5. Confirm one timer per idle handle, a throttled client request rate, and no hot-path event-history scan.
6. Confirm standard nodes, loop nodes, both clients, both docks, terminal presentation, retry, and reconciliation are covered.
7. Confirm fake-timer, route, component, integration, and browser tests prove their claimed layer.
8. Confirm no migration, config rollout, orphan process, or incompatible event reader remains.
9. Confirm the implementation has no generic timer framework, duplicate API contract, or prose-based cause parser.

Use the repository's code-review and PR-review workflows after the implementation is green.
Do not weaken tests to obtain a green result.

## Closeout

Only after focused tests, browser evidence, and `bun run validate` pass:

- Update `2-12-fail-an-abandoned-redirect-safely-after-30-minutes` to `done` in `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`.
- Update the plan and phase statuses to complete.
- Verify the final Markdown and YAML diff with `bun run format:check` or the repository formatter check.
- Use `.github/pull_request_template.md` and remove every unused conditional section and instructional comment.
- Include `Closes #192` in the PR body.
- Record focused test results, Playwright result counts, evidence paths, and `bun run validate` in Validation.
- Do not edit `CHANGELOG.md`.

## Exit criteria

- [x] Real browser activity reaches the real keepalive route on both shells.
- [x] Fake-timer tests prove the fixed production duration and re-arm behavior.
- [x] Persisted-event browser coverage proves the exact failed state on both shells.
- [x] `Never sent` and fresh retry are proved through their existing owners.
- [x] All narrow, package, build, browser, and repository gates pass.
- [x] All screenshots were inspected at both required viewports.
- [x] Tracker and plan status change only after the final green diff.

## Rollback

Revert the focused code and generated-type changes together.
No database rollback is required.
Already persisted timeout failure events remain valid audit history, and the supported node retry remains available.
