---
phase: 4
title: 'E2E, visual verification, and closeout'
status: pending
priority: P1
dependencies: [1, 2, 3]
---

# Phase 4: E2E, visual verification, and closeout

## Outcome

Deterministic provider and browser tests prove the complete Story 2.1 path: guidance is accepted while a real web-dispatched turn is still open, appears immediately in both shell docks, and becomes the next prompt on the same provider session at the natural boundary. Separate direct and loop fixtures prevent one scenario's lifecycle from invalidating another. Detached, blocked, terminal, keyboard, visual, and accessibility evidence closes the story without adding later-story contracts.

## Files

| File                                                                                 | Change                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `packages/providers/src/e2e-fake/provider.ts`                                        | Add opt-in prompt echo that reports whether the call resumed.                      |
| `packages/providers/src/e2e-fake/provider.test.ts`                                   | Prove echo stripping/session reuse and unchanged default behavior.                 |
| `e2e/fixtures/workflows/e2e-queue-guidance.yaml`                                     | New one-node direct fixture.                                                       |
| `e2e/fixtures/workflows/e2e-queue-guidance-loop.yaml`                                | New one-node AI-loop fixture.                                                      |
| `e2e/lib/playwright/archon-runtime.ts`                                               | Seed both fixtures; add tracked web/detached start helpers and status waits.       |
| `e2e/ui/agent-queue-guidance.spec.ts`                                                | Both-shell functional, contract-smoke, loop, blocked, detached, and visual checks. |
| `plans/260918-1721-issue-181-queue-guidance-for-running-agent/reports/acceptance.md` | Map Story 2.1 criteria to test/evidence after execution.                           |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`           | Owning workflow moves the story from backlog to done only after all gates pass.    |

No production API/spec documentation changes in this phase.

## Deterministic provider scenario

Extend the strict E2E scenario schema with `echoPrompt?: boolean`. Compute `promptOutsideDirectives` once using the existing stripping functions. When `echoPrompt` is true, emit exactly one assistant chunk before the result:

- no `resumeSessionId`: `[e2e-fake] echo: <promptOutsideDirectives>`;
- with `resumeSessionId`: `[e2e-fake] resumed echo: <promptOutsideDirectives>`.

The existing provider already reuses `resumeSessionId` as its result `sessionId`; the resumed prefix therefore gives browser-visible proof that the executor passed a resume id, while provider and executor unit tests assert the exact id. `doneWhenPromptIncludes` still evaluates the directive-stripped prompt and may emit `E2E_LOOP_DONE` after the echo.

This branch is opt-in only. Calls without `echoPrompt` must emit the same chunks as before, including existing todo, tool, task-dispatch, AskHuman, usage, delay/abort, and HITL loop scenarios. Do not make every resumed fake call echo; that would break existing fixtures.

Provider tests:

- non-resumed echo strips both scenario and usage directives and returns the new session id;
- resumed echo uses the resumed prefix and returns the exact supplied session id with `resumed: true`;
- echo plus `doneWhenPromptIncludes` produces echo, `E2E_LOOP_DONE`, then result in order;
- absent `echoPrompt` output is unchanged;
- an aborted delay still throws `Query aborted`.

## Separate workflow fixtures

### Direct fixture

`e2e-queue-guidance.yaml` contains only `steer-me`, using `e2e-fake`, no checkout mutation, and a first-turn scenario with a bounded delay long enough for browser interaction. Its first turn must not echo or finish before the test queues guidance.

The first queued message carries the opt-in directive followed by ordinary prose; the second is ordinary prose. When the registry joins them, the fake strips the directive and emits:

`[e2e-fake] resumed echo: first correction\n\nsecond correction`

This proves receipt order and resumed delivery without changing production transcript schemas.

### Loop fixture

`e2e-queue-guidance-loop.yaml` contains only one `loop:` node, `steer-loop`, with `until: E2E_LOOP_DONE` and a small bounded `max_iterations`. Its first iteration is delayed. The queued guidance contains `echoPrompt`, `doneWhenPromptIncludes: "finish"`, and prose containing `finish`. The guidance turn must echo as resumed and emit the loop sentinel; the transcript groups it in iteration 1 and the node completes without consuming iteration 2.

Keeping fixtures separate avoids the draft's broken dependency: a direct-node test cannot wait for a whole workflow to complete while an unsteered dependent loop is still destined to exhaust/fail.

## Runtime support

Follow the runtime's existing ownership model:

- add constants/paths for both fixtures and seed both into the isolated `ARCHON_HOME` with the existing fixture-copy block;
- factor the existing web dispatch setup only if the resulting helper has the three real callers (HITL, direct queue, loop queue); otherwise keep the change local and explicit;
- start a named workflow through the web route, return once its run is `running`, and return `{ runId, conversationId, codebaseId }`;
- add a detached-start helper for the direct fixture using the tracked CLI-child pattern; return the PID/command/port/worktree handle and always terminate/await it through runtime cleanup;
- reuse the existing polling helper for terminal status; do not add fixed sleeps or detached background processes outside the runtime's tracked collection.

Each both-shell case starts a fresh direct run. A completed run cannot be reused to demonstrate a live composer in the other shell.

## Browser scenarios

Implement `e2e/ui/agent-queue-guidance.spec.ts` using existing node-room selectors and shell parameterization. Keep assertions semantic; screenshots supplement them.

### 1. Direct queue and same-session drain — both shells

For a fresh web-dispatched direct run per shell:

1. Open the live `steer-me` room; assert no empty band, Queue is enabled, and hint says `this tab only`.
2. With the field focused, press plain Enter and assert a newline and no send request/band; clear it.
3. Queue the directive-bearing `first correction` with the platform shortcut; assert `queued · 1`, `sent`, status announcement, cleared field, and retained focus.
4. Queue `second correction` with the button; assert `queued · 2` and visual order.
5. Wait for completed status and transcript polling. Assert one node occurrence and the exact resumed echo with the two messages separated by one blank line.
6. Assert no additional `node_started`/occurrence was introduced and no operator row/delivered badge was fabricated.

Executor unit tests remain the exact proof that the resume id equals the immediately prior result id; the fake's resumed prefix is the cross-layer proof that the browser path reached that seam.

### 2. Loop delivery

Start the loop fixture through the web. Queue the directive-bearing `finish` message while iteration 1 is delayed. Assert the resumed echo and `E2E_LOOP_DONE` are rendered in iteration 1's group, no iteration 2 group appears, and the run completes. This catches incorrect drain placement after loop completion/max-iteration logic.

### 3. Real route smoke

Use the runtime's authenticated fetch on fresh/live targets for a small integration complement to the exhaustive server unit matrix:

- live valid POST → 200 canonical success;
- malformed body → 400 nested `invalid_request`;
- unknown node → 404 nested `not_found`;
- completed direct node → 409 nested `node_finished` and no new transcript row;
- detached direct run while its delay is active → 422 nested `not_steerable_here`.

Duplicate lifetime, actor permutations, target races, and full rejection immutability remain deterministic server/engine tests; do not make the browser suite slow by duplicating all of them.

### 4. Blocked and detached UI

- Use the existing web HITL fixture parked at its AskHuman node. In each shell assert Queue is focusable with `aria-disabled="true"`, no native `disabled`, the exact described reason resolves, and click/shortcut issue no request.
- Navigate to a tracked detached direct run while it is still running. The initial composer may render because Story 2.1 has no read contract; submit once, assert the 422, then assert the exact adopted disclosure is the only dock content and the draft/retry data remains in `sessionStorage`.
- A post-completion POST is asserted as 409 in route smoke. Do not require Story 2.11's read-only `NEVER SENT` UI in this story.

### 5. Visual and accessibility evidence

For Legacy and Console capture generating-empty, two-receipt, ask-blocked, and post-422 detached states:

- Legacy panel constrained to 460 CSS px in the desktop app;
- Console at a 1440×900 viewport, recording its actual node-panel width, plus a 460px component-width check;
- computed queue/button/secondary text contrast and focus indicator contrast against the final tokens;
- computed band/dock position showing no overlay, no horizontal overflow, 33vh band cap, and a reachable last transcript row;
- labelled textarea/list, accessible Queue name beginning with its visible label, status/alert behavior, valid `aria-describedby`, focus retention, and IME/plain-Enter guards;
- `prefers-reduced-motion: reduce` with unchanged content and no introduced animation.

The E2E package has no axe dependency. Do not add one solely for this story; use the project's existing DOM/computed-style assertions and record any manual screen-reader check honestly rather than claiming an automated axe scan.

Store screenshots/measurements using the existing E2E evidence conventions and summarize them in the acceptance report. If a required state cannot be captured deterministically, mark it as a blocker rather than substituting a mock.

## Full verification

```bash
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
(cd packages/workflows && bun test src/steering-registry.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/core && bun test src/db/workflows.test.ts -t 'steering handle cleanup')
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'queue guidance'
bun run --cwd e2e test:ui:hitl
bun run validate
```

`bun run validate` is the required pre-PR gate. Do not use root `bun test`.

## Acceptance report and closeout

1. Write `reports/acceptance.md` only after tests run. Map every Story 2.1 criterion to exact test names and visual artifacts; include command results, viewport/panel dimensions, and any honest manual-only or blocked item.
2. Confirm the final diff contains no database migration, GET queue route, API-contract edit, Stop/delete, operator row, or later-story reconciliation.
3. Reconcile all processes started for type generation/E2E; stop only tracked PIDs owned by this worktree.
4. Use conventional commits without issue/phase/audit labels in code comments or commit subjects.
5. Open the PR from `.github/pull_request_template.md`, keep the required sections, target `dev`, and include `Closes #181`.
6. Only after all gates pass, use the owning workflow to move `2-1-queue-guidance-for-a-running-agent` to `done`; do not hand-edit it early.

## Exit criteria

- Direct and loop E2E prove natural-boundary delivery in the same resumed session.
- Both shells have semantic and visual evidence for all Story 2.1 states and view widths.
- Detached/runtime processes are tracked and cleaned up.
- The acceptance report is evidence-based, all validation passes, and closeout follows repository branch/PR rules.
