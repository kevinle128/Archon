---
title: 'Phase 3: Prove the real flow and close after Story 2.8'
status: pending
priority: P1
effort: '4h plus real-loop runtime'
dependencies: [2, 'Issue #188 for closure evidence']
gate: 'Phase 2 complete; issue #188 merged before AC 4 and closure steps'
---

# Phase 3: Prove the real flow and close after Story 2.8

## Goal

Prove the finished-iteration state through the real workflow executor and browser
on both shells, including the Story 2.8 operator-row contract, capture measurable
visual/network evidence, run the regression gates, and update project status only
when every Story 2.10 criterion passes.

## Verified harness choices

- Reuse `e2e/fixtures/workflows/e2e-queue-guidance-loop.yaml`. It is already copied
  into the test home and exported through `archon-runtime.ts` as
  `E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME` / `QUEUE_GUIDANCE_LOOP_NODE`.
- Its 25-second delayed iterations provide a bounded observation window. Do not add
  a duplicate 60-second fixture, runtime constant, or registration path.
- Use event polling for `loop_iteration_completed` and
  `loop_iteration_started`; do not use fixed sleeps.
- Reuse/lift the execution-select helpers from `occurrence-navigation.spec.ts` only
  if this becomes their third stable caller; otherwise keep local helpers.
- Existing queue-guidance and convergence specs provide request recording, room
  opening, 460px/wide viewport, and fake-provider scenario precedents.

## E2E implementation

Create `e2e/ui/agent-finished-iteration.spec.ts`, parameterized over `legacy` and
`console`, with one event-driven journey per surface. Set a budget proportional to
three 25-second iterations (at least `T.xlong * 2` locally; increase only if the
measured healthy baseline requires it).

Use stable verification ids `steer.finished-iteration-legacy` and
`steer.finished-iteration-console` in the test names and evidence mapping.

### Journey per shell

1. Start `e2e-queue-guidance-loop`, open `steer-loop`, and wait for iteration 1 to
   complete and iteration 2 to start.
2. Queue a unique first message on live iteration 2 that the fake provider echoes
   but that does not emit `E2E_LOOP_DONE`. Assert `queued · 1`.
3. Start request recording at or before selecting iteration 1 via the existing
   `Execution` control. While iteration 1 is selected, assert:
   - exact finished disclosure naming iteration 2;
   - native `Go to iteration 2` control;
   - ordered read-only band containing the unique message and `sent`;
   - no textarea, send hint, Queue/Send control, or delete button;
   - at least one successful node-scoped queue GET;
   - zero send, queue-delete, or interrupt mutations.
4. At 460×900 and 1440×900, measure no horizontal overflow, full button
   visibility/minimum height, approved disclosure treatment, queue-band width, and
   33vh cap. Capture screenshots for both shells. Use DOM measurements as pass/fail;
   screenshots are review evidence, not the only proof.
5. Activate Go by keyboard. Assert the `Execution` value is iteration 2, the
   textarea owns focus, and the same message/order and stored draft are present.
6. Wait for the first guidance to drain, iteration 2 to complete, and iteration 3
   to start. This step is gated on #188. Select iteration 2 and assert:
   - the delivered guidance appears exactly once as an operator transcript row in
     iteration 2's occurrence;
   - the pending band does not contain that delivered message;
   - disclosure/Go now name iteration 3.
7. Return to iteration 3, queue the existing fake-provider
   `doneWhenPromptIncludes` directive, and wait for the run to complete. Re-select a
   completed iteration and assert the dock is absent for a non-live run.

Record event-to-assertion elapsed times as test annotations so timing regressions
have a healthy baseline. Keep each surface in its own run to avoid selection and
queue state leaking between assertions.

Identity-negative coverage for retry epochs, routes, nested ancestry, old fallback
rows, and different runs remains in pure/renderer tests; do not create extra real
runs that cannot add evidence beyond those deterministic cases.

## Documentation and evidence

- Update `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` with stable
  Story 2.10 verification ids for the two journeys and their unit/renderer support.
- Re-read `epics.md`, `SPEC.md`, `control-states.md`, `EXPERIENCE.md`, `DESIGN.md`,
  and the new architecture decision against the shipped behavior. Correct drift;
  do not duplicate implementation detail into evergreen docs.
- Write
  `plans/reports/acceptance-<date>-issue-190-finished-iteration.md`, mapping every
  issue/Story 2.10 criterion to a named test or captured observation.
- Store screenshots and concise network/measurement artifacts under
  `plans/reports/evidence/issue-190/`; include fixture-only text and no credentials,
  tokens, personal data, or full CI logs.

## Closure dependency and rollout

Issue #188 / Story 2.8 must be merged before step 6 can pass. It is the existing
owner for operator transcript rows; do not reimplement that schema/executor/UI work
here and do not open a replacement issue to waive AC 4.

Preferred rollout: complete #188 first, then merge one #190 PR with `Closes #190`.
If product scheduling requires the Phase 1/2 UI to merge earlier, that PR must use
`Refs #190`, leave the sprint item open, and explicitly state that this same plan's
Phase 3 closure evidence remains. A later #190 completion PR may use `Closes #190`
after #188; this is sequencing, not acceptance-criteria deferral.

Only after all criteria pass:

- change only
  `2-10-see-queued-guidance-while-viewing-a-finished-iteration` in
  `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` to
  `done`;
- use the repository PR template, target `develop`, link the evidence report, and
  use `Closes #190`;
- do not “fix” unrelated stale sprint entries as part of this issue.

## Regression and validation sequence

1. Run the new spec alone until both surface projects pass.
2. Run affected steering and occurrence specs:
   - `agent-queue-guidance.spec.ts`
   - `agent-withdraw-guidance.spec.ts`
   - `agent-queue-convergence.spec.ts`
   - `occurrence-navigation.spec.ts`
3. Run the repository's `bun run validate`; never replace a failure with a skip,
   timeout increase, or weakened assertion.
4. Re-run the new spec at the normal CI worker/retry configuration and compare
   duration with the recorded baseline.
5. Run `git diff --check` and verify every report/document link and claim.

Exact Playwright invocation must follow the current `e2e/package.json` scripts and
project configuration. Do not assume `npx` when the repository uses Bun-managed
dependencies.

## Acceptance mapping

- AC 1: finished occurrence selected through ratified Execution entry point; exact
  disclosure and Go control on both shells.
- AC 2: live node queue mirrors read-only in server order.
- AC 3: no mutation control or mutation request while finished is selected.
- AC 4: #188-backed operator row appears inline once and is absent from pending
  queue on the next live iteration.
- AC 5: live return restores composer, focus, draft, and order; unrelated execution
  identities/non-live runs remain hidden through unit, renderer, and terminal E2E
  evidence.

## Exit criteria

- Every Story 2.10 criterion maps to passing evidence; none is marked deferred.
- Both shell journeys pass at required widths and prove GET-only network behavior.
- Affected E2Es and `bun run validate` pass.
- Canonical docs match the implementation, the acceptance report is complete, and
  no sensitive data is captured.
- #188 is merged before sprint status or issue closure.

## Performance, reliability, and rollback

- The test adds no fixture registration or subprocess. Event-driven waits and the
  existing 25-second delay keep the cost observable and deterministic.
- Production polling remains one serialized GET per mounted room per second; the
  E2E request count should corroborate no overlap or mutation, not assert a brittle
  exact poll count.
- There is no data migration or deployment flag. Rollback is the focused web/doc
  revert described in the plan index; removing the browser state returns completed
  rows to a hidden dock.
