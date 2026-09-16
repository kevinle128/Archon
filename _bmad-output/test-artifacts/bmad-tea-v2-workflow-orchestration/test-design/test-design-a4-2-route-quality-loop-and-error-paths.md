---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted:
  - 'step-01-detect-mode'
  - 'step-02-load-context'
  - 'step-03-risk-and-testability'
  - 'step-04-coverage-plan'
  - 'step-05-generate-output'
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-07-08'
inputDocuments:
  - '_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md'
  - '_bmad-output/implementation-artifacts/sprint-status.yaml'
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md'
  - '_bmad-output/project-context.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/test-design/test-design-a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/atdd-checklist-a4-1-aggregate-quality-gate-summary.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/package.json'
  - 'packages/workflows/src/defaults/v2-quality-summary-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-quality-summary-dag.test.ts'
  - 'packages/workflows/src/defaults/v2-tr-join-contract.test.ts'
  - 'packages/workflows/src/schemas/route-loop.ts'
  - 'packages/workflows/src/schemas/dag-node.ts'
  - 'packages/workflows/src/loader.ts'
  - 'packages/workflows/src/route-loop-state.ts'
  - 'packages/workflows/src/dag-executor.ts'
---

# Test Design: a4.2 - Route Quality Loop And Error Paths

**Date:** 2026-07-08
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for the story that replaces the old code-review loop with one bounded quality loop sourced from `quality-gate-summary`.

This design treats every known reviewer concern and every unresolved story note as evidence.

Every acceptance criterion, every P0 or P1 risk, and every reviewer concern maps to atomic scenarios, explicit non-risk rationale, or a waiver with owner and follow-up trigger.

The current checkout still shows the old `code-review-gate` loop and lacks `quality-gate-summary`, `verify-quality-summary`, and `quality-route-loop`.

That checkout state is a P0 prerequisite risk, not an assumption that coverage can ignore.

**Risk Summary:**

- Total risks identified: 21.
- High-priority risks or promoted core-behavior risks: 19.
- P0 risks: 7.
- P1 risks: 12.
- Critical categories: TECH, DATA, COMPAT, OPS, BUS.
- Primary risk theme: preserving cross-process JSON contract safety while the DAG re-enters the dev-to-summary path.

**Coverage Summary:**

- P0 scenarios: 9.
- P1 scenarios: 14.
- P2 and P3 scenarios: 2.
- Waivers: 4.
- Total effort estimate: about 20 to 34 engineering hours.

## Not In Scope

| Item                                        | Reasoning                                                                                                            | Mitigation                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Browser UI E2E                              | The story changes backend workflow YAML, route-loop contracts, bash readers, generated defaults, and workflow tests. | Use the isolated real DAG executor fixture as the closest end-user workflow path.                 |
| Permission and auth behavior                | No auth, credential, adapter, webhook, provider key, or protected route behavior is in scope.                        | Waiver W-002 reopens coverage if the diff touches those files.                                    |
| Load and performance testing                | No service runtime hot path, API endpoint, or user-facing latency threshold changes.                                 | TD-230 asserts bounded bash-node timeouts and no unbounded external work.                         |
| Executor cancellation semantics             | Pause, cancellation, lifecycle ownership, and checkpoint behavior are not changed by this story.                     | Waiver W-001 reopens coverage if implementation touches executor lifecycle code.                  |
| Retargeting PASS to `decision-needed-check` | That node is scheduled for a later story and is not a valid route target here.                                       | TD-234 asserts the current positive route is `create-pull-request` and documents the future seam. |

## Risk Assessment

Risk score equals probability multiplied by impact.

Score 9 is P0.

Score 6 to 8 is P1.

Score 4 to 5 is P2 unless the issue can break core behavior, compatibility, data integrity, or cross-process contracts.

Score 1 to 3 is P3.

### High-Priority Risks

| Risk ID | Category | Description                                                                                                   | Probability | Impact | Score | Priority | Mitigation                                                                              | Owner                | Timeline  |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | --------------------------------------------------------------------------------------- | -------------------- | --------- |
| R-001   | TECH     | The route-loop story starts from a checkout missing the a3.3 and a4.1 prerequisites.                          | 3           | 3      | 9     | P0       | Block with TD-200 until the baseline is merged or deliberately folded in.               | Workflow implementer | Before PR |
| R-002   | TECH     | Two routing authorities remain, with both old CR routing and new summary routing able to affect `dev-story`.  | 3           | 3      | 9     | P0       | Assert exactly one `route_loop` and no `code-review-gate` references.                   | Workflow implementer | Before PR |
| R-003   | COMPAT   | The loop reads a field directly from a bash JSON node instead of using a verified reader node.                | 3           | 3      | 9     | P0       | Add `verify-quality-summary` and assert the route condition references its bare output. | Workflow implementer | Before PR |
| R-004   | DATA     | The reader accepts malformed, stale, wrong-workflow, wrong-node, wrong-story, or invalid-gate summary output. | 3           | 3      | 9     | P0       | Validate envelope and identity with `JSON.parse` before emitting any route value.       | Workflow implementer | Before PR |
| R-005   | DATA     | The reader emits extra text or newline-wrapped content that breaks the route-loop condition.                  | 2           | 3      | 6     | P1       | Assert exact stdout `PASS` or `FAIL` from the real bash reader.                         | Workflow implementer | Before PR |
| R-006   | DATA     | A summary or role `ERROR` is treated as a routable `FAIL` and returns to `dev-story`.                         | 3           | 3      | 9     | P0       | Prove summary failure prevents reader completion and route-loop evaluation.             | Workflow implementer | Before PR |
| R-007   | COMPAT   | `quality-route-loop` violates schema or loader structure rules.                                               | 2           | 3      | 6     | P1       | Assert route-loop shape and `parseWorkflow` success.                                    | Workflow implementer | Before PR |
| R-008   | TECH     | Route-loop condition is malformed or inverted.                                                                | 2           | 3      | 6     | P1       | Prove PASS goes positive and FAIL goes negative.                                        | Workflow implementer | Before PR |
| R-009   | TECH     | The FAIL back-edge does not rerun the whole dev-to-summary path or loses the stable `story_ref`.              | 2           | 3      | 6     | P1       | Assert provider call counts and same identity across rounds.                            | Workflow implementer | Before PR |
| R-010   | TECH     | PASS routes to a nonexistent future node or bypasses the current tail.                                        | 2           | 3      | 6     | P1       | Assert positive target is `create-pull-request` for this story.                         | Workflow implementer | Before PR |
| R-011   | TECH     | Exhaustion is off by one, loops forever, routes negative again, or reaches PR.                                | 3           | 3      | 9     | P0       | Drive max-plus-one FAIL decisions and assert only the exhausted target runs.            | Workflow implementer | Before PR |
| R-012   | BUS      | The 3-versus-20 loop budget ambiguity leads to the wrong quality-loop tolerance.                              | 2           | 2      | 4     | P1       | Preserve and assert 20 unless the maintainer changes the story decision.                | Workflow maintainer  | Before PR |
| R-013   | OPS      | Exhaustion evidence lacks findings pointer, decision-log pointer, or round or iteration count.                | 2           | 3      | 6     | P1       | Assert stdout and best-effort `review-loop-error.json` content.                         | Workflow implementer | Before PR |
| R-014   | TECH     | The exhausted target succeeds or emits a routable contract.                                                   | 2           | 3      | 6     | P1       | Assert non-zero exit and no route-facing `gate` or `status`.                            | Workflow implementer | Before PR |
| R-015   | TECH     | Tail nodes keep stale dependencies and bypass `quality-route-loop`.                                           | 2           | 3      | 6     | P1       | Assert exact dependencies for `create-pull-request` and `review-loop-error`.            | Workflow implementer | Before PR |
| R-016   | OPS      | Source workflow, generated bundle, package test script, or v1 baseline drift.                                 | 2           | 3      | 6     | P1       | Assert source and bundle parity, package script registration, and v1 rollback safety.   | Workflow implementer | Before PR |
| R-017   | TECH     | Required route outcomes are only implied by structural tests.                                                 | 3           | 3      | 9     | P0       | Add isolated DAG scenarios for PASS, FAIL-then-PASS, ERROR, and exhaustion.             | Test architect       | Before PR |
| R-018   | OPS      | `mock.module()` pollution makes workflow tests flaky or false-green.                                          | 2           | 3      | 6     | P1       | Assert the DAG file runs as its own Bun invocation.                                     | Test architect       | Before PR |
| R-021   | DATA     | Route-loop counters, route activations, or artifacts leak across duplicate or concurrent runs.                | 2           | 3      | 6     | P1       | Run two isolated fixtures with distinct metadata and artifact directories.              | Workflow implementer | Before PR |

### Medium And Low Risks

| Risk ID | Category | Description                                                                       | Probability | Impact | Score | Priority | Action                               |
| ------- | -------- | --------------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | ------------------------------------ |
| R-019   | TECH     | Tests violate project naming and identifier hygiene rules.                        | 1           | 2      | 2     | P3       | Cover with TD-212.                   |
| R-020   | TECH     | Implementation touches executor, loader, core, server, or unrelated runtime code. | 1           | 3      | 3     | P3       | Cover with TD-232 file-scope review. |

### Explicit Non-Risks

| ID     | Concern                                             | Rationale                                                                                                                                    | Scenario Or Follow-Up                                          |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| NR-001 | Removing the CR short-circuit may increase AI cost. | The architecture explicitly mandates one summary-sourced loop, so compute cost is an accepted tradeoff rather than a route-correctness risk. | TD-201 asserts one loop and old-loop removal.                  |
| NR-002 | PASS cannot yet route to `decision-needed-check`.   | The future node is not present in this story, and routing to it would make the DAG invalid.                                                  | TD-234 asserts `create-pull-request` as the current tail seam. |

### Risk Category Legend

- **TECH**: Technical or architecture risk.
- **COMPAT**: Schema, loader, generated-default, or rollback compatibility risk.
- **DATA**: Contract integrity, stale data, route identity, or persisted state risk.
- **BUS**: Product workflow or operator decision risk.
- **OPS**: CI, isolation, artifact, or operational evidence risk.

## NFR Planning

This is not a final NFR evidence assessment.

Final NFR PASS, CONCERNS, or FAIL belongs to `nfr-assess` after implementation evidence exists.

| NFR Category    | Requirement Or Threshold                                                                                                                     | Risk Link                         | Planned Validation                                                                | Evidence Needed                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Reliability     | FAIL, PASS, ERROR, exhaustion, partial failure, dependency failure, duplicate run isolation, and fail-closed behavior must be deterministic. | R-006, R-009, R-011, R-017, R-021 | Isolated real executor DAG tests.                                                 | `v2-quality-route-loop-dag.test.ts` output.                       |
| Maintainability | The change must preserve one routing authority, scoped file changes, stable mock isolation, generated bundle parity, and identifier hygiene. | R-002, R-016, R-018, R-019, R-020 | Structural contract tests, package script assertions, and review file-scope gate. | Contract test output, package script diff, and validation output. |
| Compatibility   | The edited v2 workflow must parse under workflow schema and DAG validation, respect route-loop constraints, and leave v1 unchanged.          | R-003, R-007, R-016               | `parseWorkflow`, source-versus-bundle assertion, and v1 baseline guard.           | Contract test output and `bun run check:bundled`.                 |
| Data integrity  | Route-facing JSON must accept only the expected envelope and same `story_ref`; invalid or stale contracts must not route.                    | R-004, R-005, R-006, R-021        | Bash-reader proof plus DAG ERROR and stale-data fixtures.                         | Contract and DAG test output.                                     |
| Security        | No auth, credential, token, webhook, or permission path is in scope.                                                                         | W-002                             | Waived with reopen trigger.                                                       | None unless scope changes.                                        |
| Performance     | No runtime hot path or service latency threshold is specified.                                                                               | R-012, W-004                      | Timeout and budget checks only.                                                   | Contract test output.                                             |
| Scalability     | No scaling threshold is specified for this YAML-only change.                                                                                 | W-004                             | Not applicable unless executor scheduling or shared state changes.                | Reopen on scope change.                                           |
| Compliance      | No compliance threshold is specified.                                                                                                        | R-013                             | Auditability through exhausted-loop artifact evidence.                            | `review-loop-error.json` fixture output.                          |

**Unknown thresholds:** performance and scalability thresholds are unknown because the story does not change a service endpoint, runtime scheduler, or user-facing latency path.

## Entry Criteria

- [ ] The a3.3 and a4.1 prerequisites are present or deliberately folded into this story.
- [ ] The accepted route target for PASS remains `create-pull-request` until the future decision-needed node exists.
- [ ] The accepted loop budget remains 20 unless the workflow maintainer changes the story before implementation.
- [ ] The implementation scope is limited to v2 workflow YAML, regenerated bundled defaults, route-loop tests, and package test registration.
- [ ] The test author keeps deterministic bash nodes real in DAG tests.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] All P1 scenarios pass or have an owner-approved waiver.
- [ ] Every acceptance criterion traces to atomic scenarios.
- [ ] Every P0 and P1 risk traces to scenarios or an explicit waiver.
- [ ] Every reviewer concern traces to scenarios, explicit non-risk rationale, or an explicit waiver.
- [ ] `bun test packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts` passes.
- [ ] `bun test packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts` passes as its own isolated invocation.
- [ ] `bun run check:bundled` passes.
- [ ] `bun run validate` passes before PR handoff.

## Test Coverage Plan

P0, P1, P2, and P3 are priority and risk levels.

They are not execution timing labels.

### P0

**Criteria:** Blocks core workflow behavior, data integrity, compatibility, or cross-process contract behavior with no acceptable workaround.

| Test ID | Requirement                                                                                                                                                                                                                        | Test Level              | Risk Link    | Notes                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------ | ------------------------------------------------------------------------------- |
| TD-200  | Prerequisite baseline exists or is deliberately folded: resolved TR path, `quality-gate-summary`, and a4.1 summary contract are present before route-loop assertions execute.                                                      | Bun structural contract | R-001        | Prevents false failures from the currently stale checkout.                      |
| TD-201  | Exactly one `route_loop` node exists and it is `quality-route-loop`; `code-review-gate` is absent and no node references it.                                                                                                       | Bun structural contract | R-002        | Proves one routing authority.                                                   |
| TD-203  | `verify-quality-summary` exists as a deterministic bash node depending on `quality-gate-summary` and `resolve-story-input`, with bounded timeout and `output_type: quality-summary-verified`.                                      | Bun structural contract | R-003        | Confirms the required reader seam exists.                                       |
| TD-204  | `verify-quality-summary` reads `$quality-gate-summary.output` whole-output, uses `bun -e` plus `JSON.parse`, validates envelope and identity, and does not use field-level `$quality-gate-summary.output.gate`, `grep`, or `case`. | Bun structural contract | R-004        | Covers malformed, stale, and loader-compatibility concerns at the static level. |
| TD-207  | Invalid `contract_version`, `workflow`, `node`, `story_ref`, malformed JSON, empty summary, or invalid gate causes `verify-quality-summary` to fail with no `PASS` or `FAIL` stdout.                                               | Isolated DAG executor   | R-004, R-005 | Covers malformed input, stale data, and exact stdout.                           |
| TD-224  | `quality-gate-summary` hard-fails for an ERROR-source case, so `verify-quality-summary` does not complete, `quality-route-loop` cannot evaluate, `dev-story` is not rerun, and `create-pull-request` is not reached.               | Isolated DAG executor   | R-006, R-017 | The required ERROR-not-FAIL path.                                               |
| TD-222  | Persistent `FAIL` through the configured budget routes to `review-loop-error` on the max-plus-one decision, never reaches `create-pull-request`, and terminates non-zero.                                                          | Isolated DAG executor   | R-011, R-017 | Covers exhaustion and off-by-one behavior.                                      |
| TD-223  | Exhaustion evidence includes open findings pointer, decision-log pointer, round or iteration count, and best-effort `review-loop-error.json`.                                                                                      | Isolated DAG executor   | R-013        | Covers auditability.                                                            |
| TD-235  | `review-loop-error` exits non-zero and emits no route-facing `gate` or `status` contract.                                                                                                                                          | Isolated DAG executor   | R-014        | Confirms terminal error behavior.                                               |

### P1

**Criteria:** Core path or high-risk behavior that must be mitigated before release.

| Test ID | Requirement                                                                                                                                                                                                                    | Test Level                                             | Risk Link           | Notes                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------- | --------------------------------------------------- |
| TD-202  | `gate-planner.depends_on` is exactly the retained identity barrier and not the removed route loop; no stale route target references remain.                                                                                    | Bun structural contract                                | R-002               | Complements one-loop assertion.                     |
| TD-205  | Valid summary JSON produces exact stdout `PASS` or exact stdout `FAIL`, with no extra prose.                                                                                                                                   | Bun structural contract plus real bash technique proof | R-005               | Prevents ambiguous route comparisons.               |
| TD-208  | `quality-route-loop` has `depends_on: [verify-quality-summary]`, `from: verify-quality-summary`, condition `"$verify-quality-summary.output == 'PASS'"`, max budget value, and exact positive, negative, and exhausted routes. | Bun structural contract                                | R-007, R-008, R-012 | Covers route-loop shape and budget.                 |
| TD-209  | `quality-route-loop` has no `when`, `trigger_rule`, or `retry`, and `parseWorkflow` validates the edited DAG.                                                                                                                  | Bun structural contract                                | R-007               | Covers schema and loader compatibility.             |
| TD-210  | Source v2 workflow and `BUNDLED_WORKFLOWS` match after generation, `bun run check:bundled` passes, and v1 is byte-for-byte unchanged.                                                                                          | Bun structural contract and command                    | R-016               | Covers generated bundle and rollback safety.        |
| TD-211  | `v2-quality-route-loop-contract.test.ts` is registered in a non-mock batch, and `v2-quality-route-loop-dag.test.ts` runs as its own Bun invocation.                                                                            | Bun structural contract                                | R-018               | Covers Bun mock isolation.                          |
| TD-218  | `create-pull-request.depends_on` and `review-loop-error.depends_on` are both `[quality-route-loop]`.                                                                                                                           | Bun structural contract                                | R-015               | Covers stale tail dependencies.                     |
| TD-220  | First-round `PASS` produces reader output `PASS`, routes positive to `create-pull-request`, does not rerun `dev-story`, and does not run `review-loop-error`.                                                                  | Isolated DAG executor                                  | R-008, R-010, R-017 | Primary happy path.                                 |
| TD-221  | First-round `FAIL` then second-round `PASS` reruns the full dev-to-summary path, calls `dev-story` twice, keeps the same `story_ref`, and then reaches `create-pull-request`.                                                  | Isolated DAG executor                                  | R-009, R-017        | Core negative-then-recovery path.                   |
| TD-227  | Dependency or partial upstream failure prevents summary or reader completion, prevents route-loop evaluation, and never reroutes to `dev-story`.                                                                               | Isolated DAG executor                                  | R-006, R-017        | Covers partial failure and dependency failure.      |
| TD-229  | Two separate route-loop runs with distinct metadata and artifact dirs do not share loop counters, route activations, or exhausted artifacts.                                                                                   | Isolated DAG executor                                  | R-021               | Covers duplicate actions and concurrency isolation. |
| TD-230  | `verify-quality-summary` and `review-loop-error` declare bounded timeouts and no unbounded external runtime beyond local `bun -e` JSON parsing.                                                                                | Bun structural contract                                | R-013               | Timeout guard.                                      |
| TD-233  | The chosen `max_iterations` value is asserted and documented as 20 unless the owner changes the story decision before implementation.                                                                                          | Bun structural contract                                | R-012               | Covers budget ambiguity.                            |
| TD-234  | The PASS route targets `create-pull-request` in this story and does not target nonexistent `decision-needed-check`; the a5.1 retargeting seam is documented.                                                                   | Bun structural contract                                | R-010               | Prevents invalid future target wiring.              |

### P2 And P3

| Test ID | Priority | Requirement                                                                                                                      | Test Level              | Risk Link | Notes                              |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------- | ---------------------------------- |
| TD-212  | P3       | New runtime ids and output types are kebab-case, and new tests avoid forbidden plan, story, epic, or review-finding identifiers. | Bun structural contract | R-019     | Maintains project convention.      |
| TD-232  | P3       | File scope is limited to v2 YAML, generated bundled defaults, the two route-loop tests, and `packages/workflows/package.json`.   | Review checklist        | R-020     | Prevents unnecessary blast radius. |

## Acceptance Criteria Traceability

| AC                                                                                              | Scenario Coverage                                              | Status  |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- |
| AC1 `FAIL` routes to `dev-story` and keeps the same `story_ref`.                                | TD-204, TD-205, TD-208, TD-209, TD-221, TD-229                 | Covered |
| AC2 `PASS` routes forward to the current tail seam.                                             | TD-205, TD-208, TD-218, TD-220, TD-234                         | Covered |
| AC3 Exhaustion routes to `review-loop-error`, records evidence, and exits non-zero.             | TD-208, TD-222, TD-223, TD-233, TD-235                         | Covered |
| AC4 `ERROR` fails closed and never reaches `dev-story`.                                         | TD-203, TD-204, TD-207, TD-224, TD-227                         | Covered |
| AC5 Edited v2 parses with one loop, old loop removed, `gate-planner` rewired, and v1 unchanged. | TD-200, TD-201, TD-202, TD-208, TD-209, TD-210, TD-218, TD-232 | Covered |
| AC6 Bundle parity and all four route outcomes are proven.                                       | TD-210, TD-211, TD-220, TD-221, TD-222, TD-224                 | Covered |

## High-Risk Trace

| Risk  | Status  | Scenario Or Waiver                     |
| ----- | ------- | -------------------------------------- |
| R-001 | Covered | TD-200                                 |
| R-002 | Covered | TD-201, TD-202                         |
| R-003 | Covered | TD-203, TD-204                         |
| R-004 | Covered | TD-204, TD-207                         |
| R-005 | Covered | TD-205, TD-207                         |
| R-006 | Covered | TD-224, TD-227                         |
| R-007 | Covered | TD-208, TD-209                         |
| R-008 | Covered | TD-208, TD-220, TD-221                 |
| R-009 | Covered | TD-221                                 |
| R-010 | Covered | TD-220, TD-234                         |
| R-011 | Covered | TD-222                                 |
| R-012 | Covered | TD-233                                 |
| R-013 | Covered | TD-223, TD-230                         |
| R-014 | Covered | TD-235                                 |
| R-015 | Covered | TD-218                                 |
| R-016 | Covered | TD-210                                 |
| R-017 | Covered | TD-220, TD-221, TD-222, TD-224, TD-227 |
| R-018 | Covered | TD-211                                 |
| R-021 | Covered | TD-229                                 |

## Reviewer Concern Trace

| Concern ID | Status            | Scenario, Non-Risk, Or Waiver  |
| ---------- | ----------------- | ------------------------------ |
| C-001      | Covered           | TD-200                         |
| C-002      | Covered           | TD-201                         |
| C-003      | Covered           | TD-202                         |
| C-004      | Covered           | TD-203, TD-204                 |
| C-005      | Covered           | TD-204, TD-207                 |
| C-006      | Covered           | TD-204, TD-207                 |
| C-007      | Covered           | TD-205, TD-207                 |
| C-008      | Covered           | TD-224, TD-227                 |
| C-009      | Covered           | TD-208, TD-209                 |
| C-010      | Covered           | TD-209                         |
| C-011      | Covered           | TD-208, TD-220, TD-221         |
| C-012      | Covered           | TD-221                         |
| C-013      | Covered           | TD-220, TD-234                 |
| C-014      | Covered           | TD-222                         |
| C-015      | Covered           | TD-233                         |
| C-016      | Covered           | TD-223                         |
| C-017      | Covered           | TD-235                         |
| C-018      | Covered           | TD-218                         |
| C-019      | Covered           | TD-210                         |
| C-020      | Covered           | TD-220, TD-221, TD-222, TD-224 |
| C-021      | Covered           | TD-211                         |
| C-022      | Covered           | TD-212                         |
| C-023      | Explicit non-risk | NR-001 plus TD-201             |
| C-024      | Explicit non-risk | NR-002 plus TD-234             |
| C-025      | Covered           | TD-232                         |
| C-026      | Waived            | W-001                          |
| C-027      | Waived            | W-002                          |
| C-028      | Covered           | TD-229                         |

## Edge-Case Coverage

| Edge Category       | Coverage Or Waiver                            |
| ------------------- | --------------------------------------------- |
| Happy path          | TD-220                                        |
| Negative path       | TD-221, TD-222, TD-224, TD-227                |
| Boundary cases      | TD-207, TD-222, TD-233                        |
| Malformed input     | TD-207                                        |
| Stale data          | TD-207                                        |
| Duplicate actions   | TD-229                                        |
| Out-of-order events | TD-224, TD-227                                |
| Partial failure     | TD-227                                        |
| Dependency failure  | TD-227                                        |
| Timeout             | TD-230                                        |
| Cancellation        | W-001                                         |
| Concurrency or race | TD-211, TD-229                                |
| Rollback            | TD-210, TD-232                                |
| Permission or auth  | W-002                                         |
| Regression          | TD-200 through TD-212, TD-218, TD-232, TD-234 |

## Waivers

| Waiver ID | Subject                       | Reason                                                                                                           | Owner                      | Residual Risk                                                                        | Follow-Up Trigger                                                                                                                |
| --------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| W-001     | Cancellation behavior.        | Executor cancellation, pause, and lifecycle ownership are unchanged by this YAML and bash-reader story.          | Workflow maintainer        | Cancellation during route-loop rerun or error-artifact write is not newly exercised. | Reopen if implementation touches executor cancellation, node lifecycle mutation, checkpoint reset, or artifact write ownership.  |
| W-002     | Permission and auth behavior. | No auth, credential, adapter, provider credential delivery, webhook, or protected server route code is in scope. | Security or platform owner | A stray implementation change could introduce untested auth behavior.                | Reopen if the diff touches credentials, adapters, server auth routes, provider credential delivery, or permission checks.        |
| W-003     | Browser UI E2E.               | This is a backend workflow DAG change with no browser-visible workflow acceptance path.                          | Test architect             | A future web console visualization of the route loop is not exercised here.          | Reopen if a web or console surface renders route-loop state, review-loop-error artifacts, or quality summary decisions.          |
| W-004     | Load and performance testing. | No service runtime hot path, API endpoint, or user-facing latency threshold changes.                             | Workflow maintainer        | The reader bash could still hang if timeout is omitted.                              | TD-230 must pass, and performance coverage reopens if implementation adds long-running runtime work or shared scheduler changes. |

## NFR Coverage And Evidence Plan

| NFR             | Scenario Coverage                              | Evidence Source                                   | Notes                                                                                        |
| --------------- | ---------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Reliability     | TD-220, TD-221, TD-222, TD-224, TD-227, TD-229 | Isolated DAG test output.                         | Covers successful routing, re-entry, fail-closed ERROR, partial failure, and run isolation.  |
| Maintainability | TD-201, TD-202, TD-210, TD-211, TD-212, TD-232 | Contract test output and review checklist.        | Covers one-loop authority, package test isolation, bundle parity, and scope hygiene.         |
| Compatibility   | TD-203, TD-208, TD-209, TD-210                 | Contract test output and `bun run check:bundled`. | Covers route-loop schema, loader validation, source-bundle parity, and v1 rollback safety.   |
| Data integrity  | TD-204, TD-205, TD-207, TD-221, TD-224, TD-229 | Contract and DAG test output.                     | Covers exact stdout, envelope validation, same story identity, and stale contract rejection. |
| Security        | W-002                                          | None for this story.                              | Reopen if security-sensitive files enter the diff.                                           |
| Performance     | TD-230, W-004                                  | Contract test output.                             | No load test is planned because no runtime hot path changes.                                 |
| Compliance      | TD-223                                         | DAG artifact evidence.                            | Provides exhausted-loop audit trail through machine-readable error artifact.                 |

## Execution Strategy

Run all functional and contract coverage in PR validation because the planned tests are package-local Bun tests.

PR validation should include:

- `bun test packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts`
- `bun test packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts`
- `bun run check:bundled`
- `bun run validate`

Nightly validation should run the normal package-isolated `bun run test` suite and surface any mock-isolation regression.

Weekly validation is not required because there is no load, browser, chaos, or long-running suite for this story.

## Resource Estimates

| Priority | Scenario Count | Effort Range         | Notes                                                                           |
| -------- | -------------- | -------------------- | ------------------------------------------------------------------------------- |
| P0       | 9              | About 10 to 16 hours | Mostly prerequisite checks, fail-closed cases, and exhaustion.                  |
| P1       | 14             | About 8 to 14 hours  | Mostly route-loop shape, PASS/FAIL behavior, package wiring, and run isolation. |
| P2/P3    | 2              | About 2 to 4 hours   | File-scope and naming hygiene.                                                  |
| Total    | 25             | About 20 to 34 hours | Higher end applies if prerequisites must be folded into this worktree.          |

Timeline estimate: about 3 to 5 focused engineering days, depending on prerequisite baseline state.

## Quality Gate Criteria

- P0 pass rate must be 100%.
- P1 pass rate must be at least 95%, and any exception requires an owner-approved waiver.
- All score 6 or higher risks must have scenario coverage or an approved waiver before release.
- Every acceptance criterion must trace to atomic scenarios before coverage is marked complete.
- Every reviewer concern must trace to scenarios, explicit non-risk rationale, or an approved waiver.
- No P0 or P1 edge case may be counted as covered by implication.
- `bun run check:bundled` must pass after regeneration.
- `bun run validate` must pass before PR handoff.
- Full NFR PASS, CONCERNS, or FAIL assessment is deferred to `nfr-assess` after implementation evidence exists.

## Mitigation Plans

### R-001: Missing Prerequisite Baseline

**Mitigation Strategy:** Add TD-200 as the first structural gate and stop implementation if the a3.3 and a4.1 wiring is absent and not deliberately folded into the story.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-200.

### R-002 And R-003: Routing Authority And Reader Compatibility

**Mitigation Strategy:** Remove the old route loop, add the reader node, and assert one-loop topology before runtime DAG tests run.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-201 through TD-204.

### R-004 Through R-006: Contract Integrity And ERROR Separation

**Mitigation Strategy:** Validate reader input with `JSON.parse`, fail closed before stdout, and prove ERROR prevents route-loop evaluation in a real DAG fixture.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-204, TD-207, TD-224, and TD-227.

### R-011 Through R-014: Exhaustion Behavior

**Mitigation Strategy:** Drive max-plus-one FAIL decisions, assert exhausted target selection, assert non-zero terminal behavior, and verify the review-loop error artifact.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-222, TD-223, TD-233, and TD-235.

### R-016 Through R-018: Generated Parity And Test Isolation

**Mitigation Strategy:** Regenerate bundled defaults, assert package test registration, and keep the `mock.module()` DAG file isolated.

**Owner:** Test architect.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-210 and TD-211.

## Assumptions And Dependencies

### Assumptions

1. The owner accepts `max_iterations: 20` for this story unless they explicitly change the loop-budget decision before implementation.
2. The PASS route targets `create-pull-request` in this story because `decision-needed-check` is delivered later.
3. The route-loop executor behavior described in `route-loop-state.ts` and `dag-executor.ts` remains unchanged.
4. The isolated DAG harness can follow the existing `v2-quality-summary-dag.test.ts` pattern.

### Dependencies

1. The a3.3 and a4.1 baseline must be present or intentionally folded into this story before the route-loop tests can be meaningfully green.
2. `bun run generate:bundled` must refresh `packages/workflows/src/defaults/bundled-defaults.generated.ts` after YAML edits.
3. The DAG test must be registered as a separate Bun invocation because it uses `mock.module()`.

### Risks To Plan

- **Risk:** The maintainer changes the loop budget from 20 to 3.
  - **Impact:** TD-208, TD-222, and TD-233 must be updated to reflect the accepted value.
  - **Contingency:** Keep one structural assertion for the chosen value and one DAG exhaustion proof for max-plus-one behavior.

- **Risk:** The team chooses to preserve the CR short-circuit for compute savings.
  - **Impact:** This intentionally diverges from the one-loop architecture and invalidates TD-201, TD-202, and parts of AC5 coverage.
  - **Contingency:** Reopen architecture sign-off before implementing a two-loop design.

## Interworking And Regression

| Service Or Component                                                     | Impact                                        | Regression Scope                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml`     | Primary workflow source changes.              | `parseWorkflow`, structural contract tests, route outcome DAG tests, and bundle parity. |
| `packages/workflows/src/defaults/bundled-defaults.generated.ts`          | Generated mirror must match source.           | `bun run generate:bundled` and `bun run check:bundled`.                                 |
| `packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts` | New structural route-loop coverage.           | Co-located non-mock workflow defaults batch.                                            |
| `packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts`      | New runtime route outcome coverage.           | Standalone Bun invocation because of `mock.module()`.                                   |
| `packages/workflows/package.json`                                        | Test script must preserve Bun mock isolation. | TD-211 and normal package test execution.                                               |
| `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop.yml`        | Must remain unchanged for rollback.           | TD-210 byte-for-byte baseline guard.                                                    |

## Follow-On Workflows

- Run `atdd` to generate failing P0 test scaffolds as a separate workflow.
- Run `automate` for broader automated coverage once implementation exists.
- Run `nfr-assess` only after implementation evidence exists.

## Appendix

### Knowledge Base References

- `risk-governance.md` for risk scoring and mitigation rules.
- `probability-impact.md` for probability, impact, and score thresholds.
- `test-levels-framework.md` for selecting structural contract tests versus isolated DAG tests.
- `test-priorities-matrix.md` for P0 through P3 classification.
- `nfr-criteria.md` for NFR planning boundaries.
- `contract-testing.md` for route-facing contract integrity principles.
- `playwright-cli.md`, `overview.md`, `api-request.md`, `auth-session.md`, and `recurse.md` for API/backend testing context.

### Related Documents

- Story: `_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md`
- Architecture: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`
- Epics: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`
- Project context: `_bmad-output/project-context.md`
- Direct dependency: `_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md`
- Prior test design: `_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/test-design/test-design-a4-1-aggregate-quality-gate-summary.md`

**Generated by:** BMad TEA Agent - Test Architect Module

**Workflow:** `bmad-testarch-test-design`

**Version:** 4.0 (BMad v6)
