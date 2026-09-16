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
  - '_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md'
  - '_bmad-output/project-context.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/src/defaults/v2-tea-branches-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-tea-branches-dag.test.ts'
---

# Test Design: Join TR As Final Gate

**Date:** 2026-07-08
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for the story that wires `tea-tr` as the final release gate after resolved RV and NR branch outputs.

This plan treats reviewer concerns as evidence.

Every acceptance criterion, P0 or P1 risk, and reviewer concern maps to at least one scenario or an explicit waiver.

**Risk Summary:**

- Total risks identified: 19.
- P0 risks: 6.
- P1 risks: 10.
- Critical categories: TECH, DATA, OPS.
- Primary risk theme: route-facing JSON contract integrity and fail-closed DAG behavior.

**Coverage Summary:**

- P0 scenarios: 8.
- P1 scenarios: 12.
- P2 scenarios: 1.
- P3 scenarios: 1.
- Total effort: about 12 to 21 engineering hours.

## Not in Scope

| Item                           | Reasoning                                                                                       | Mitigation                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Browser E2E exploration        | The story changes workflow YAML and workflow package tests, not a browser-visible UI.           | Use isolated DAG executor tests as the closest end-to-end product path for this workflow behavior.                       |
| Auth and permission testing    | No adapter authorization, provider credential, token, or protected route changes are in scope.  | TD-040 flags out-of-scope file changes and the waiver is revisited if implementation touches permissions or credentials. |
| Load or performance testing    | No runtime hot path, service endpoint, or user-facing latency requirement changes are in scope. | `bun run validate` remains the relevant CI evidence.                                                                     |
| Executor cancellation behavior | The story does not change cancellation, pause, or lifecycle mutation semantics.                 | Add cancellation coverage if implementation changes executor cancellation or node lifecycle ownership.                   |

## Risk Assessment

### P0 Risks

| Risk ID | Category | Description                                                                         | Probability | Impact | Score | Mitigation                          | Owner                | Timeline  |
| ------- | -------- | ----------------------------------------------------------------------------------- | ----------- | ------ | ----- | ----------------------------------- | -------------------- | --------- |
| R-001   | TECH     | `tea-tr` runs without the `run_tr` guard.                                           | 3           | 3      | 9     | TD-020 and TD-030.                  | Workflow implementer | Before PR |
| R-002   | TECH     | `run_tr=false` has no resolved TR-role sibling.                                     | 3           | 3      | 9     | TD-023, TD-024, and TD-029.         | Workflow implementer | Before PR |
| R-004   | TECH     | False-path coverage is absent because real `gate-planner` only emits `run_tr=true`. | 3           | 3      | 9     | TD-029.                             | Test architect       | Before PR |
| R-006   | DATA     | Real `tea-tr` emits or accepts malformed gate contracts.                            | 3           | 3      | 9     | TD-021 and TD-033.                  | Workflow implementer | Before PR |
| R-010   | TECH     | PR tail is unreachable or reaches after the wrong TR branch.                        | 3           | 3      | 9     | TD-027, TD-030, TD-033, and TD-034. | Workflow implementer | Before PR |
| R-012   | TECH     | Real RV or NR branch failure is masked and the tail runs.                           | 3           | 3      | 9     | TD-031, TD-032, and TD-034.         | Test architect       | Before PR |

### P1 Risks

| Risk ID | Category | Description                                                                         | Probability | Impact | Score | Mitigation                          | Owner                | Timeline  |
| ------- | -------- | ----------------------------------------------------------------------------------- | ----------- | ------ | ----- | ----------------------------------- | -------------------- | --------- |
| R-003   | TECH     | `tea-tr-skipped` is wired behind RV or NR and can be blocked by unrelated branches. | 2           | 3      | 6     | TD-023.                             | Workflow implementer | Before PR |
| R-005   | TECH     | Tests mutate or mock `gate-planner` to force false behavior.                        | 2           | 3      | 6     | TD-029 and TD-030.                  | Test architect       | Before PR |
| R-007   | DATA     | TR evidence can be attributed to the wrong story.                                   | 2           | 3      | 6     | TD-022 and TD-024.                  | Workflow implementer | Before PR |
| R-008   | DATA     | Skip contract JSON is invalid for malformed dynamic reason text.                    | 2           | 3      | 6     | TD-025.                             | Workflow implementer | Before PR |
| R-009   | OPS      | Skip output is hard to locate or hangs longer than expected.                        | 2           | 2      | 4     | TD-026.                             | Workflow implementer | Before PR |
| R-011   | TECH     | TR join drops one RV or NR branch or uses unsafe `all_done`.                        | 2           | 3      | 6     | TD-028 and TD-035.                  | Workflow implementer | Before PR |
| R-013   | TECH     | Tests still encode predecessor behavior or lose targeted regression checks.         | 3           | 2      | 6     | TD-038.                             | Test architect       | Before PR |
| R-015   | TECH     | V1 baseline changes and rollback compatibility is lost.                             | 2           | 3      | 6     | TD-037.                             | Workflow implementer | Before PR |
| R-016   | OPS      | Generated bundled defaults drift from YAML source.                                  | 2           | 3      | 6     | TD-036 and `bun run check:bundled`. | Workflow implementer | Before PR |
| R-017   | OPS      | Bun `mock.module()` pollution causes flaky or misleading workflow tests.            | 2           | 3      | 6     | TD-039.                             | Test architect       | Before PR |

### Medium and Low Risks

| Risk ID | Category | Description                                                      | Probability | Impact | Score | Action                                   |
| ------- | -------- | ---------------------------------------------------------------- | ----------- | ------ | ----- | ---------------------------------------- |
| R-014   | OPS      | Additive scope guard undercounts new nodes.                      | 2           | 2      | 4     | Cover with TD-037.                       |
| R-018   | TECH     | Implementation changes out-of-scope runtime or planner behavior. | 2           | 2      | 4     | Cover with TD-040 and review file scope. |
| R-019   | TECH     | Naming or forbidden identifier conventions regress.              | 1           | 2      | 2     | Cover with TD-041.                       |

## NFR Planning

| NFR Category    | Requirement or Threshold                                                            | Risk Link           | Planned Validation                                                                     | Evidence Needed                                                                              |
| --------------- | ----------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Reliability     | Fail closed when real RV, NR, or TR branch output is invalid.                       | R-010, R-012        | Isolated DAG executor scenarios TD-031, TD-032, TD-033, and trigger-rule proof TD-034. | Bun test output for `v2-tea-branches-dag.test.ts` and `v2-tea-branches-contract.test.ts`.    |
| Maintainability | Preserve existing workflow package isolation and predecessor regression assertions. | R-013, R-017        | TD-038 and TD-039.                                                                     | Bun contract test output and package script assertion.                                       |
| Compatibility   | Keep v1 baseline untouched and regenerated bundle consistent with source.           | R-015, R-016        | TD-036, TD-037, and `bun run check:bundled`.                                           | Contract test output plus bundled check output.                                              |
| Data Integrity  | Preserve story_ref and valid JSON gate envelopes across branch outputs.             | R-006, R-007, R-008 | TD-021, TD-022, TD-024, TD-025, and TD-033.                                            | Contract test output and malformed-character encoder proof.                                  |
| Security        | No threshold applies because no auth, secret, or permission path changes.           | N/A                 | Waived for this story.                                                                 | Revisit if implementation touches credentials, permissions, adapters, or protected routes.   |
| Performance     | No threshold applies because no runtime hot path changes.                           | N/A                 | Waived for this story.                                                                 | Revisit if implementation changes executor scheduling or adds long-running runtime behavior. |

**Unknown thresholds:** No performance, security, or scalability thresholds are required for the current story scope.

## Entry Criteria

- [ ] The story acceptance criteria and dev notes remain the source of truth.
- [ ] The implementation only touches the v2 workflow YAML, regenerated bundled defaults, workflow default tests, and package test script if a new isolated DAG file is added.
- [ ] The test author keeps `gate-planner` real in DAG behavior tests.
- [ ] The generated bundle is regenerated from source, not hand-edited.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] All P1 scenarios pass or have an owner-approved waiver.
- [ ] `bun test packages/workflows/src/defaults/v2-tea-branches-contract.test.ts` passes.
- [ ] `bun test packages/workflows/src/defaults/v2-tea-branches-dag.test.ts` passes.
- [ ] `bun run check:bundled` passes.
- [ ] `bun run validate` passes before PR handoff.

## Test Coverage Plan

P0, P1, P2, and P3 are priority and risk levels, not execution timing.

### P0

**Criteria:** Breaks core workflow behavior, data integrity, compatibility, or cross-process contract behavior with no acceptable workaround.

| Test ID | Requirement                                                                              | Test Level              | Risk Link    | Notes                                   |
| ------- | ---------------------------------------------------------------------------------------- | ----------------------- | ------------ | --------------------------------------- |
| TD-020  | `tea-tr` is gated by `run_tr == true`.                                                   | Bun structural contract | R-001        | Exact string assertion.                 |
| TD-021  | `tea-tr.output_format` requires the full gate envelope and excludes `SKIPPED`.           | Bun structural contract | R-006        | Prevents invalid real TR contracts.     |
| TD-023  | `tea-tr-skipped` exists as direct `gate-planner` bash sibling with inverse condition.    | Bun structural contract | R-002, R-003 | Covers false-path node shape.           |
| TD-027  | PR tail depends on both TR role branches with `none_failed_min_one_success`.             | Bun structural contract | R-010        | Covers downstream successor resolution. |
| TD-029  | `run_tr` boolean drives exactly one TR branch per flag value.                            | Bun unit proof          | R-004, R-005 | No fake gate-planner behavior.          |
| TD-030  | Real gate-planner happy path completes `tea-tr`, skips `tea-tr-skipped`, and reaches PR. | Isolated DAG executor   | R-001, R-010 | Closest end-to-end workflow path.       |
| TD-031  | Real RV failure blocks `tea-tr` and PR.                                                  | Isolated DAG executor   | R-012        | Fail-closed negative path.              |
| TD-032  | Real NR failure blocks `tea-tr` and PR.                                                  | Isolated DAG executor   | R-012        | Fail-closed negative path.              |

### P1

**Criteria:** Important release-gate or regression coverage with material workflow or compatibility risk.

| Test ID | Requirement                                                                                              | Test Level                          | Risk Link    | Notes                                              |
| ------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------ | -------------------------------------------------- |
| TD-022  | `tea-tr.prompt_suffix` pins `story_ref`.                                                                 | Bun structural contract             | R-007        | Prevents story identity drift.                     |
| TD-024  | `tea-tr-skipped` emits the SKIPPED gate envelope.                                                        | Bun structural contract             | R-002, R-007 | Covers explicit skipped branch contract.           |
| TD-025  | Skip encoder survives backslash, quote, newline, carriage return, and tab.                               | Bun unit proof                      | R-008        | Malformed input coverage.                          |
| TD-026  | `tea-tr-skipped` has timeout, typed output, and artifact write.                                          | Bun structural contract             | R-009        | Observability and timeout coverage.                |
| TD-028  | Edited v2 YAML passes `parseWorkflow` schema and DAG validation.                                         | Bun structural contract             | R-011        | Covers schema-valid `when` and trigger_rule usage. |
| TD-033  | Invalid real TR output blocks PR.                                                                        | Isolated DAG executor               | R-006, R-010 | Negative path for final gate output.               |
| TD-034  | PR trigger-rule proof covers one completed TR sibling, both skipped siblings, and failed sibling states. | Bun unit proof                      | R-010, R-012 | Partial failure and impossible-state guard.        |
| TD-035  | Existing four-way RV/NR `tea-tr` join remains intact.                                                    | Bun structural contract             | R-011        | Regression guard for AC1 and AC4.                  |
| TD-036  | Bundled v2 content contains TR skip and matches source YAML.                                             | Bun structural contract plus script | R-016        | Pair with `bun run check:bundled`.                 |
| TD-037  | V1 baseline is untouched and v2 additive scope includes the third skip node.                             | Bun structural contract             | R-015        | Rollback compatibility.                            |
| TD-038  | Predecessor TD-010 assertions are inverted, not deleted.                                                 | Bun structural contract             | R-013        | Regression preservation.                           |
| TD-039  | Any `mock.module()` DAG file runs as its own Bun invocation.                                             | Bun structural contract             | R-017        | Concurrency and flake prevention.                  |

### P2

**Criteria:** Secondary regression and scope-control coverage.

| Test ID | Requirement                                                                               | Test Level                          | Risk Link | Notes                              |
| ------- | ----------------------------------------------------------------------------------------- | ----------------------------------- | --------- | ---------------------------------- |
| TD-040  | `route_loop`, `gate-planner`, v1 workflow, core, and server behavior remain out of scope. | Bun structural contract plus review | R-018     | Prevents unnecessary blast radius. |

### P3

**Criteria:** Convention and hygiene checks.

| Test ID | Requirement                                                                                                  | Test Level              | Risk Link | Notes                             |
| ------- | ------------------------------------------------------------------------------------------------------------ | ----------------------- | --------- | --------------------------------- |
| TD-041  | New node ids and output types are kebab-case and forbidden plan identifiers are absent from generated tests. | Bun structural contract | R-019     | Keeps project conventions intact. |

## Acceptance Criteria Trace

| Acceptance Criterion | Status  | Scenarios                                              |
| -------------------- | ------- | ------------------------------------------------------ |
| AC1                  | Covered | TD-020, TD-021, TD-022, TD-029, TD-030, TD-035         |
| AC2                  | Covered | TD-023, TD-024, TD-025, TD-026, TD-027, TD-029, TD-034 |
| AC3                  | Covered | TD-020, TD-021, TD-023, TD-027, TD-028                 |
| AC4                  | Covered | TD-027, TD-031, TD-032, TD-033, TD-034, TD-035         |
| AC5                  | Covered | TD-036, TD-037, TD-038, TD-039, TD-040, TD-041         |

## P0 and P1 Risk Trace

| Risk ID | Status  | Scenarios                      |
| ------- | ------- | ------------------------------ |
| R-001   | Covered | TD-020, TD-030                 |
| R-002   | Covered | TD-023, TD-024, TD-029         |
| R-003   | Covered | TD-023                         |
| R-004   | Covered | TD-029                         |
| R-005   | Covered | TD-029, TD-030                 |
| R-006   | Covered | TD-021, TD-033                 |
| R-007   | Covered | TD-022, TD-024                 |
| R-008   | Covered | TD-025                         |
| R-009   | Covered | TD-026                         |
| R-010   | Covered | TD-027, TD-030, TD-033, TD-034 |
| R-011   | Covered | TD-028, TD-035                 |
| R-012   | Covered | TD-031, TD-032, TD-034         |
| R-013   | Covered | TD-038                         |
| R-015   | Covered | TD-037                         |
| R-016   | Covered | TD-036                         |
| R-017   | Covered | TD-039                         |

## Reviewer Concern Trace

| Concern ID | Status                       | Scenarios or waiver    |
| ---------- | ---------------------------- | ---------------------- |
| C-001      | Covered                      | TD-020, TD-030         |
| C-002      | Covered                      | TD-023, TD-024, TD-029 |
| C-003      | Covered                      | TD-023                 |
| C-004      | Covered                      | TD-029                 |
| C-005      | Covered                      | TD-029, TD-030         |
| C-006      | Covered                      | TD-021, TD-033         |
| C-007      | Covered                      | TD-022, TD-024         |
| C-008      | Covered                      | TD-025                 |
| C-009      | Covered                      | TD-026                 |
| C-010      | Covered                      | TD-027, TD-030, TD-034 |
| C-011      | Covered                      | TD-028, TD-035         |
| C-012      | Covered                      | TD-031, TD-032, TD-034 |
| C-013      | Covered                      | TD-038                 |
| C-014      | Covered                      | TD-037                 |
| C-015      | Covered                      | TD-037                 |
| C-016      | Covered                      | TD-036                 |
| C-017      | Covered                      | TD-039                 |
| C-018      | Covered                      | TD-040                 |
| C-019      | Covered as explicit non-risk | TD-028                 |
| C-020      | Covered                      | TD-041                 |

## Edge-Case Coverage

| Edge Category       | Coverage or Waiver                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Happy path          | TD-030.                                                                                            |
| Negative path       | TD-031, TD-032, TD-033, TD-034.                                                                    |
| Boundary cases      | TD-029 plus existing mixed RV/NR branch tests.                                                     |
| Malformed input     | TD-025 and TD-033.                                                                                 |
| Stale data          | TD-022, TD-024, TD-026.                                                                            |
| Duplicate actions   | TD-029 proves exactly one TR branch condition can pass per flag value.                             |
| Out-of-order events | TD-023 and TD-027 prove skip resolves from `gate-planner` while PR waits on both TR-role siblings. |
| Partial failure     | TD-031, TD-032, TD-033, TD-034.                                                                    |
| Dependency failure  | TD-031 and TD-032.                                                                                 |
| Timeout             | TD-026.                                                                                            |
| Cancellation        | Waived because executor cancellation is unchanged.                                                 |
| Concurrency or race | TD-039 covers Bun mock isolation.                                                                  |
| Rollback            | TD-037 and TD-040.                                                                                 |
| Permission or auth  | Waived because no permission or credential path changes.                                           |
| Regression          | TD-036, TD-037, TD-038, TD-039, TD-040, TD-041.                                                    |

### Waiver Details

Cancellation waiver owner: workflow maintainer.

Cancellation residual risk: a pre-existing cancellation bug would not be detected by this story-specific suite.

Cancellation follow-up trigger: add cancellation coverage when this story changes executor cancellation, run cancellation, or node lifecycle mutation behavior.

Permission and auth waiver owner: workflow maintainer.

Permission and auth residual risk: unexpected permission expansion would only arise from out-of-scope changes.

Permission and auth follow-up trigger: add auth coverage if implementation touches provider permissions, credentials, adapters, or protected API routes.

## Execution Strategy

Run everything story-specific in PR because the contract and isolated DAG tests are focused and should stay under the normal workflow package budget.

PR commands:

- `bun test packages/workflows/src/defaults/v2-tea-branches-contract.test.ts`
- `bun test packages/workflows/src/defaults/v2-tea-branches-dag.test.ts`
- `bun run check:bundled`

Final pre-PR command:

- `bun run validate`

Nightly and weekly execution: no new long-running scenarios are introduced.

## Resource Estimates

| Priority | Count        | Estimate             | Notes                                                                             |
| -------- | ------------ | -------------------- | --------------------------------------------------------------------------------- |
| P0       | 8 scenarios  | About 6 to 10 hours  | Includes structural assertions, unit proof, and DAG negative paths.               |
| P1       | 12 scenarios | About 5 to 8 hours   | Includes encoder proof, bundle parity, test isolation, and regression assertions. |
| P2       | 1 scenario   | About 1 to 2 hours   | Scope guard and review evidence.                                                  |
| P3       | 1 scenario   | Less than 1 hour     | Naming and forbidden identifier guard.                                            |
| Total    | 22 scenarios | About 12 to 21 hours | Includes local validation and cleanup.                                            |

## Prerequisites

Test data is file-based and already exists in the workflow fixture harness.

No external service account, browser session, database, or network dependency is required for the story-specific tests.

Required tooling is Bun and the existing workflow package test harness.

## Quality Gate Criteria

P0 pass rate must be 100 percent.

P1 pass rate must be at least 95 percent, with no open P1 failure accepted without owner-approved waiver.

All P0 and P1 reviewer-concern mappings must stay explicit in test names, assertions, or trace tables.

`bun run check:bundled` must pass after bundle generation.

`bun run validate` must pass before PR handoff.

## Mitigation Plans

### R-001, R-002, R-004, R-006, R-010, R-012

**Mitigation Strategy:** Implement the P0 scenario set TD-020, TD-021, TD-023, TD-027, TD-029, TD-030, TD-031, TD-032, TD-033, and TD-034.

**Owner:** Workflow implementer and test architect.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** Focused Bun contract test, focused isolated DAG test, and full validation.

### R-003, R-005, R-007, R-008, R-009, R-011, R-013, R-015, R-016, R-017

**Mitigation Strategy:** Implement P1 scenario coverage TD-022, TD-024, TD-025, TD-026, TD-028, TD-035, TD-036, TD-037, TD-038, and TD-039.

**Owner:** Workflow implementer and test architect.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** Focused Bun contract test, generated bundle check, and package test script inspection.

## Assumptions and Dependencies

### Assumptions

1. The real `gate-planner` continues to emit `run_tr=true`.
2. The false path remains required by architecture even though it is currently structurally proven.
3. The existing `v2-tea-branches-dag.test.ts` remains the correct isolated behavioral test file.

### Dependencies

1. `bun run generate:bundled` must be run after YAML changes.
2. `bun run check:bundled` must confirm no source or bundled-default drift.
3. `bun run validate` remains the final pre-PR quality gate.

### Risks to Plan

- **Risk:** Implementation changes `gate-planner` to force `run_tr=false` in tests.
  **Impact:** Misleading behavioral test and contract drift.
  **Contingency:** Reject the implementation and keep false-path proof in condition-evaluator coverage.

- **Risk:** New DAG tests are added without package-script isolation.
  **Impact:** Bun module mock pollution and flaky package tests.
  **Contingency:** Register the new file as a standalone `bun test` segment or reuse the existing isolated DAG file.

## Interworking and Regression

| Service or Component                                                 | Impact                                                                 | Regression Scope                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` | Primary DAG wiring and contract source changes.                        | Structural contract tests and isolated DAG tests.     |
| `packages/workflows/src/defaults/bundled-defaults.generated.ts`      | Generated mirror of default workflow source.                           | `bun run check:bundled` and bundled parity assertion. |
| `packages/workflows/src/defaults/v2-tea-branches-contract.test.ts`   | Static contract, schema, condition, and regression checks.             | Focused Bun contract test.                            |
| `packages/workflows/src/defaults/v2-tea-branches-dag.test.ts`        | Behavioral DAG executor checks using real bash nodes.                  | Focused isolated Bun DAG test.                        |
| `packages/workflows/package.json`                                    | Test isolation script only if a new mock-based DAG file is introduced. | TD-039 package-script assertion.                      |

## Appendix

### Knowledge Base References

- `risk-governance.md`
- `probability-impact.md`
- `test-levels-framework.md`
- `test-priorities-matrix.md`
- `nfr-criteria.md`
- `contract-testing.md`

### Related Documents

- Story: `_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md`
- Architecture: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`
- Epics: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`
- Project context: `_bmad-output/project-context.md`

**Generated by:** BMad TEA Agent - Test Architect Module

**Workflow:** `bmad-testarch-test-design`

**Version:** 4.0 (BMad v6)
