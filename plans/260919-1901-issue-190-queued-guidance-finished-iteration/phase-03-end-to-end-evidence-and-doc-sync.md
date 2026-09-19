---
title: 'Phase 3: End-to-end evidence and doc sync'
status: todo
priority: P1
effort: '4h'
dependencies: [2]
---

# Phase 3: End-to-end evidence and doc sync

## Goal

Prove Story 2.10 on the real executor path (a live `loop:` node on the fake
provider) for both shells, record the evidence the issue requires, sync the
canonical docs, and move the sprint entry to the closure status chosen in validation
question 5 in the closing PR.

## Context links

- [plan.md](./plan.md) success criteria; [Phase 2](./phase-02-both-shells-render-the-finished-iteration-dock.md).
- Fixture precedent: `e2e/fixtures/workflows/e2e-queue-guidance-loop.yaml` —
  `steer-loop`, `delayMs: 25000` per iteration, `until: E2E_LOOP_DONE`,
  `max_iterations: 3`; wired by `e2e/lib/playwright/archon-runtime.ts:68-122,512`.
  This story gets its **own** fixture `e2e-finished-iteration-loop.yaml` (node
  `finished-loop`, `delayMs: 60000`, `max_iterations: 3`) wired the same way, so
  the screenshot + network-capture journey has a 60 s window instead of 25 s.
  <!-- Red team 2026-09-20: Finding 8 -->
- Journey precedents: `e2e/ui/agent-queue-convergence.spec.ts` (network assertions,
  evidence dir, `[P1] [V:…]` naming, 460/1440 viewports) and
  `e2e/ui/agent-queue-guidance.spec.ts:402-470` (loop run, `echoPrompt` /
  `doneWhenPromptIncludes` finish scenario, iteration event checks).
- Execution-select helpers: `e2e/ui/occurrence-navigation.spec.ts:329-347`
  (`executionSelect`, `executionRowId`, `selectExecution`) — lift into
  `e2e/lib/playwright/run-detail.ts` if a third spec needs them (this is the second).
- Issue #190 acceptance: focused tests / characterization evidence recorded;
  `sprint-status.yaml` entry moved to `done`.

## Scout pass before execution (deep mode)

1. Confirm the fake provider still honours `delayMs` and the finish scenario
   (`packages/providers/src/e2e-fake/provider.ts:165-216,446-457,599-610`), and
   register the new fixture in `archon-runtime.ts` beside the existing loop fixture.
2. Confirm `archon.waitForRunStatus` and `getRunDetail` expose events so the spec
   can wait for `loop_iteration_completed` (iteration 1) and
   `loop_iteration_started` (iteration 2) on `finished-loop` (export
   `E2E_FINISHED_ITERATION_LOOP_WORKFLOW_NAME` / `FINISHED_ITERATION_LOOP_NODE` from
   `archon-runtime.ts` beside the existing loop constants).
3. Confirm the header `Execution` select labels for iteration rows
   (`execution-room-model.ts:82-102` → `Iteration 1`, `Iteration 2`).

## Requirements

- [ ] New spec `e2e/ui/agent-finished-iteration.spec.ts`, parameterised over
      `console` and `legacy`, one run per journey.
- [ ] Journey A `[P1] [V:steer.finished-iteration-${surface}]`:
      1. start `e2e-finished-iteration-loop`; open the `finished-loop` room (live ×1).
      2. wait until events show iteration 1 completed and iteration 2 started.
      3. queue one unique message on the live iteration; assert `queued · 1`.
      4. select `Iteration 1` via the `Execution` select; assert the disclosure
         `reading a finished iteration · the agent is working in iteration 2`, the
         `Go to iteration 2` button, the read-only band with the message and `sent`,
         and **no** textarea / `Queue` / `delete` inside the room region.
      5. record every request while on the finished iteration: zero `POST …/send`,
         zero `DELETE …/queue/*`, zero `POST …/interrupt`; at least one
         `GET …/queue` with `200`.
      6. press `Go to iteration 2`; assert the composer field is focused, `queued · 1`
         with the same message, and the `Execution` select value is the live row.
      7. finish the run by queueing the `doneWhenPromptIncludes:"finish"` scenario
         text (as the 2.1 loop journey does) and wait for `completed`.
      8. reopen `Iteration 1` on the completed run: no dock at all (non-live run
         regression; not AC 5).
      9. log elapsed ms from the `loop_iteration_started` (iteration 2) event to each
         assertion in steps 3–6 (`testInfo.annotations`) so a future flake has a
         baseline against the 60 s budget; screenshots at 460×900 and 1440×900 of step 4 into
         `plans/260919-1901-issue-190-queued-guidance-finished-iteration/reports/evidence/`.
      10. AC 5 proper: start a second run of the same workflow while the first is
          completed (or use `workflow retry-node` on a failed fixture if available),
          open the first run's `finished-loop` room while the second is live: the dock
          is absent; then in the live run select the outer `Attempt 1` execution row
          if present: no finished-iteration dock. <!-- Red team 2026-09-20: Finding 12 -->
- [ ] Journey B `[P2] [V:steer.finished-iteration-keyboard-${surface}]`: from the
      transcript, `Tab` reaches the `Go to iteration 2` button before anything else in
      the dock; `Enter` activates it; focus never lands on `<body>`.
- [ ] Doc sync (only where behaviour is user-visible):
      - `control-states.md:50-58` already updated in Phase 1; re-verify against shipped copy.
      - `EXPERIENCE.md:183` — add the `Go to iteration N` focus rule sentence if the
        table cell does not already state it.
      - `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` — add the
        Story 2.10 journey ids (`steer.finished-iteration-*`).
- [ ] `sprint-status.yaml`: change only
      `2-10-see-queued-guidance-while-viewing-a-finished-iteration` from `backlog` to
      the status the owner chose in validation question 5 (`done` with a tracked
      follow-up issue for AC-4's inline half, or an intermediate status), after all
      gates pass. Leave the stale `1-7`/`2-1`/`2-8` entries untouched (workflow-owned)
      but **name them in the PR description** so the reviewer knows the tracker lags
      the merged PRs #206/#207. <!-- Red team 2026-09-20: Findings 3, 6 -->
- [ ] If the owner chose `done`, open the follow-up issue for AC-4's inline
      operator-row half (blocked by Story 2.8) before merging and link it from
      `acceptance.md` and the PR body.
- [ ] `plans/…/reports/acceptance.md` mapping each Story 2.10 AC to unit, renderer,
      and E2E evidence, and stating the AC-4 inline half as deferred to Story 2.8.

## Tests before (TDD)

Write Journey A with the assertions above and run it against the Phase 1 build
(before Phase 2 lands) to confirm it fails at step 4 (`hidden` dock). Keep the
network recorder as a reusable helper in the spec (`recordSteeringRequests(page)`),
mirroring `agent-queue-convergence.spec.ts`'s request interception.

## Refactor (protected changes)

None to production code in this phase. If the Execution-select helpers are lifted
into `run-detail.ts`, update `occurrence-navigation.spec.ts` imports in the same
commit and re-run that spec.

## Tests after

- Both journeys green on both shells locally (`cd e2e && npx playwright test ui/agent-finished-iteration.spec.ts`).
- Existing steering specs (`agent-queue-guidance`, `agent-withdraw-guidance`,
  `agent-queue-convergence`, `occurrence-navigation`) unchanged and green.

## Todo

- [ ] Scout pass confirmed.
- [ ] Journey A and B written and failing before Phase 2 markup.
- [ ] Journeys green after Phase 2; evidence screenshots captured.
- [ ] Docs synced; `acceptance.md` written.
- [ ] `bun run validate` green.
- [ ] PR from the template with `Closes #190`; `sprint-status.yaml` moved to the
      status chosen in validation question 5 (plus the follow-up issue if `done`).

## Success criteria

- Every Story 2.10 AC has cited evidence; AC-4's inline half is explicitly deferred.
- `bun run validate` and the affected E2E specs pass.

## Regression gate

```bash
bun run validate
cd e2e && npx playwright test ui/agent-finished-iteration.spec.ts ui/agent-queue-guidance.spec.ts ui/agent-queue-convergence.spec.ts ui/occurrence-navigation.spec.ts
```

## Risk assessment

- Timing: iteration 1 takes ~60 s and iteration 2 gives a 60 s window; use event
  polling with `T.xlong` rather than fixed sleeps, queue the message immediately after
  iteration 2 starts, and keep steps 3–6 free of fixed waits. The drained guidance
  turn resolves near-instantly (no scenario directive), so the window is the provider
  delay alone.
- Flake if the queued message drains at the iteration-2 → 3 boundary before step 6;
  assert `queued · 1` right after step 4 rather than after long waits, and finish the
  run only after step 6.
- Windows CI: this spec spawns no subprocess beyond the shared runtime; no new
  per-test process cost.

## Security considerations

Evidence screenshots contain fixture text only; no tokens or user data.

## Next steps

Open the PR (`develop` base) with the template; `/release` is out of scope.
