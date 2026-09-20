---
title: "Phase 5: Integration proofs + validation"
status: todo
---

# Phase 5: Integration proofs + validation

## Context links

- Scout: `plans/reports/scout-260920-1843-executor-fail-retry.md` (retry + upsert anchors).
- `steering-test-plan.md` idle-await lifecycle bullets; Story 2.11 flow.

## Overview

Two Story 2.12 acceptance criteria are satisfied by **existing** machinery once expiry emits a
terminal `node_failed`. This phase **proves** them with focused tests (no new production code
expected) and runs the full pre-PR validation gate. It also confirms the whole-story acceptance
criteria and updates the tracker.

## Key insights (why these are proof-only)

- **Queued-at-expiry → NEVER SENT**: the expiry fail path tears the handle down in the node/loop
  `finally` (`unregister`, `:3924`/`:5727`); queued items die unmatched. The client 2.11
  reconciliation runs on terminal node evidence (`hasTerminalNodeEvidence`,
  `execution-room-model.ts:453-463`), which the `node_failed` terminal satisfies — no new wiring.
- **Retry → fresh session**: `upsertWorkflowNodeSession` only fires on `state==='completed'`
  (`dag-executor.ts:10402-10424`), and `prepareWorkflowNodeRetry` deletes any persisted session
  for invalidated nodes (`packages/core/src/operations/workflow-retry.ts:537-545`). A
  `state:'failed'` expiry therefore persists **no** steer session; `workflow retry-node` starts
  fresh. Holds for the default node AND for `persist_session: true` (the interrupted steer session
  is never persisted; a prior *completed* run's session is a separate, intended matter).

## Requirements

- [ ] Prove queued-at-expiry surfaces as `NEVER SENT` end-to-end at the engine/store seam
      (queued message ids unmatched by written operator rows after the `node_failed` terminal).
- [ ] Prove the expiry fail path performs **no** `upsertWorkflowNodeSession` (negative assertion),
      and that `prepareWorkflowNodeRetry` + a subsequent run use a fresh session.
- [ ] Confirm every Story 2.12 acceptance criterion in `epics.md` is satisfied; record the
      characterization evidence.
- [ ] Run `bun run validate`; move the `sprint-status.yaml` entry for
      `2-12-fail-an-abandoned-redirect-safely-after-30-minutes` to `done` (tracker step, on close).

## TDD — Tests Before

1. Engine/store proof (`dag-executor.test.ts` or the store test seam used by 2.11): interrupt →
   idle with N queued messages → expiry → assert `node_failed` terminal and that no operator
   `text` rows were written for the queued ids (so 2.11 marks them unmatched / NEVER SENT).
2. Negative-upsert proof: spy/assert `upsertWorkflowNodeSession` is **not** called on the expiry
   fail path (contrast: it *is* called on a normal completion).
3. Retry proof: after an expiry fail, `prepareWorkflowNodeRetry` finds no persisted session for
   the node and a re-run resolves a fresh session (assert no `attemptResumeId` carried from the
   interrupted turn).

## TDD — Tests After

- Items 1–3 pass; no production code changed in this phase (if any proof fails, the defect is in
  Phase 1/2 — fix there, do not weaken the proof).

## Todo

- [ ] Write proofs (1–3); run.
- [ ] If a proof fails, return to Phase 1/2 (this phase adds no production code).
- [ ] `bun run validate`.
- [ ] Verify each Story 2.12 AC against the passing tests; record evidence in the PR.
- [ ] On close: set `sprint-status.yaml` `2-12-…` → `done`.

## Success criteria

- [ ] Queued-at-expiry NEVER SENT proof green; retry fresh-session proof green.
- [ ] `bun run validate` passes (type-check, lint, format:check, all package tests, bundled/schema
      checks — see the root `package.json` `validate` script for the current list).
- [ ] All Story 2.12 acceptance criteria demonstrably satisfied.

## Regression gate

```
bun run validate
```

## Risk assessment

- If a proof reveals the expiry path *does* persist a session or *does* write phantom operator
  rows, that is a Phase-1/2 correctness bug — fix upstream, never adjust the assertion to pass.
- `bun run validate` is the CI-equivalent gate; do not create the PR until it is green. (The
  Postgres-only `check:schema-upgrades` is unaffected — no schema change in this plan.)

## Security considerations

None new.

## Next steps

Open the PR using `.github/pull_request_template.md` with `Closes #192`; hand off to `/ak:cook`
for execution (Phase 1 first — the atomicity core).
