---
phase: 4
title: 'E2E evidence, gates, and closeout'
status: pending
priority: P1
effort: '4h'
dependencies: [1, 2, 3]
---

# Phase 4: E2E evidence, gates, and closeout

## Outcome

A real web-dispatched run proves, on both shells, that a message queued while the `e2e-fake` agent is mid-turn arrives as the prompt of turn N+1 on the same session and that the dock states, keyboard paths, and accessibility rules hold. Repository gates pass, the contract doc names the new read route, the PR is opened from the template with `Closes #181`, and the owning workflow moves the story to `done`.

Cook-time scout: re-read `e2e/lib/playwright/archon-runtime.ts` (`runHitlWorkflowViaWeb`, `waitForRunStatus`, `starterFetch`), `e2e/ui/agent-todo-strip.spec.ts` for the both-shell pattern, and `packages/providers/src/e2e-fake/provider.ts` around the `resumeInteractions` early return.

## Context links

- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` ("Registry and routes", "Steering UI — end-to-end, both shells", "Boundary checks").
- `plans/reports/scout-260919-0007-web-dock-and-e2e.md` §5 (fake provider gaps; `delayMs` precedes the first yield; `sessionResume: true`), §1 (pollers).
- `plans/260918-0826-issue-178-pinned-todo-strip/phase-03-end-to-end-and-visual-verification.md` (evidence conventions: `reports/visual-acceptance.md`, `reports/evidence/*`).

## Provider fixture (`packages/providers/src/e2e-fake/provider.ts`)

Add one **scenario key**, `echoPrompt: boolean`, to `scenarioSchema`: when the directive in the prompt sets it, the provider yields one assistant chunk `"[e2e-fake] echo: " + promptOutsideDirectives` before its normal `result` chunk (which already carries `sessionId` and `resumed: true` when `resumeSessionId` was given). The directive travels **inside the queued operator message** (`<<E2E_SCENARIO>>{"echoPrompt":true}<</E2E_SCENARIO>> first correction`), which is exactly what proves delivery is verbatim: the stripped remainder is what the agent echoes. Do **not** add a blanket "echo on any resumed turn" behaviour — `e2e-hitl-run.yaml`'s `inspect-twice` loop resumes its session on iteration 2 without `resumeInteractions` and its spec asserts a tool row per iteration, so a blanket branch would break `workflow-run-hitl.spec.ts`. The first turn uses `{"delayMs": 8000, "emitTool": true}` to stay open long enough for Playwright to act while staying far below the default idle timeout. <!-- Updated: Red Team Session 1 - echo scoped to a directive -->

Test before (in `provider.test.ts`): `echoPrompt` yields the directive-stripped prompt then a `result` reusing the given session id with `resumed: true`; a call without the key is byte-for-byte unchanged; an aborted delay still throws `Query aborted`.

## Fixture and runtime

- `e2e/fixtures/workflows/e2e-queue-guidance.yaml`: one node `steer-me`, `provider: e2e-fake`, `model: e2e-fake-model`, `mutates_checkout: false`, prompt with the delay directive above followed by `$ARGUMENTS`.
- `archon-runtime.ts`: add `startQueueGuidanceWorkflowViaWeb()` following `runHitlWorkflowViaWeb` (register codebase, create conversation, `POST /api/workflows/e2e-queue-guidance/run`, `waitForRunId`) but returning after `waitForRunStatus(runId, 'running')`, plus a `waitForRunStatus(runId, 'completed')` awaiter. The runtime already sets `ARCHON_E2E_FAKE_PROVIDER=1` on the server, so the in-process executor uses the fake. A CLI-spawned run must not be used — it is `422` by design (D1).

## E2E spec (`e2e/ui/agent-queue-guidance.spec.ts`)

Both shells (Legacy route and Console route), tagged `[P0]`/`[P1]` like the sibling specs:

1. **Queue and drain**: open the running node room; dock visible, button `Queue`, hint contains `this tab only`; type `<<E2E_SCENARIO>>{"echoPrompt":true}<</E2E_SCENARIO>> first correction`, press `Meta+Enter` (or `Control+Enter` on non-mac); band shows `QUEUED · 1` and `sent`; type `second correction`, click `Queue`; `QUEUED · 2` in order. Wait for the run to complete; the transcript contains `[e2e-fake] echo: first correction\n\nsecond correction` (verbatim remainder, in order — proving one turn N+1 carried both messages); the band is gone; the node is `completed`; `GET /api/workflows/runs/:id` shows one occurrence for the node.
2. **Plain Enter never sends**: focus the field, press `Enter`, assert a newline in the value and no `QUEUED` band; `GET …/queue` returns `queued: []`.
3. **Route contract via `starterFetch`** on the live node: duplicate `message_id` replays the receipt and the queue length stays 1; empty message → 400 `invalid_request`; unknown node → 404 `not_found`; after completion → 409 `node_finished` with the draft still in the field; a CLI-detached run (`startHitlWorkflow` shape on the same fixture) → 422 `not_steerable_here` and the dock shows only the disclosure line.
4. **Ask block**: using the existing HITL fixture parked at an ask, the dock renders Send with `aria-disabled="true"`, no `disabled` attribute, `aria-describedby` resolving to `answer the agent's question first`; `Meta+Enter` makes no request (assert via `GET …/queue`).
5. **Accessibility**: `role="status"` announces `1 message pending delivery` after the first queue; `document.activeElement` remains the textarea; axe scan of the dock has no violations; header text is lowercase in the DOM with `text-transform: uppercase` computed; `prefers-reduced-motion: reduce` emulation renders identically.
6. **Visual**: screenshots at 460 px (Legacy) and the Console panel width for `generating`, `QUEUED · 2`, blocked, and disclosure states; the scroller scrolls behind the dock; contrast measurements of the send label, hint, and band text recorded in `reports/evidence/queue-dock-contrast.json` (≥ 4.5:1).

## Tests before (red first)

Write the spec and provider test first; they fail on the missing echo/dock until Phases 1-3 land in the same branch, then pass without edits to the assertions.

## Refactor (protected changes)

- The existing HITL suite (`bun run --cwd e2e test:ui:hitl`) stays green — the fake's first-turn path and the `resumeInteractions` branch are unchanged.

## Tests after / gates

```bash
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'queue guidance'
bun run --cwd e2e test:ui:hitl
bun run validate
```

`bun run validate` covers `check:bundled` (the fixture is not a default, so no bundle regen), `check:capability-matrix` (no capability change), type-check, lint, and every package's tests.

## Closeout

1. Update `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`: add `GET /api/workflows/runs/:runId/nodes/:nodeId/queue` to the Routes table and its response shape to Response schemas; note that 2.1 always returns `state: 'queued'` and that `awaiting_send_now` arrives with Story 2.3.
2. Write `plans/260918-1721-issue-181-queue-guidance-for-running-agent/reports/acceptance.md` mapping each Story 2.1 acceptance criterion to its test name and evidence file; record any manual-AT blocker honestly.
3. Open the PR from `.github/pull_request_template.md` (Problem and outcome, Review guidance, Solution, Validation), target `develop`, `Closes #181`; conventional commit messages, no plan/phase/finding codes in code or commits.
4. The owning BMad workflow moves `2-1-queue-guidance-for-a-running-agent` to `done` after the gates; do not hand-edit early.

## Test scenario matrix

| Path | Priority | Case |
|------|----------|------|
| Real drain on same session | Critical | echo of both messages in order in turn N+1 |
| Detached refusal | Critical | CLI run → 422 + disclosure |
| Keyboard | High | shortcut sends; Enter newline |
| Ask block | High | `aria-disabled` + reason; shortcut no-op |
| Contract statuses | High | 400/404/409 through the real server |
| A11y/visual | Medium | axe, focus, uppercase-by-CSS, reduced motion, contrast |

## Todo

- [ ] fake provider echo + test
- [ ] fixture + runtime helper
- [ ] spec on both shells green
- [ ] HITL suite and `bun run validate` green
- [ ] contract doc, acceptance report, PR, sprint status

## Success criteria

The acceptance report shows every Story 2.1 criterion backed by an automated test or a recorded manual blocker, and the PR is open against `develop`.

## Risk assessment

- **Timing**: `delayMs` must exceed the slowest Playwright interaction path with margin (8 s) and stay under the executor idle timeout.
- **Windows CI**: the spec spawns no extra subprocesses beyond the runtime's server; keep it that way (#2306 guidance).
- **Detached case** needs the CLI path from the same runtime; reuse `startHitlWorkflow`'s `spawnCli` shape.

## Security considerations

None new; E2E runs against an isolated `ARCHON_HOME` with the fake provider.

## Next steps

Story 2.2 (withdraw) and 2.3 (interrupt) build on this branch's registry, route family, and dock.
