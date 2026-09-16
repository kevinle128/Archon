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
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/project-context.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md'
  - '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/test-design/test-design-a3-3-join-tr-as-final-gate.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/package.json'
  - 'packages/workflows/src/defaults/v2-gate-planner-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-gate-planner-dag.test.ts'
  - 'packages/workflows/src/defaults/v2-tr-join-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-tr-join-dag.test.ts'
  - 'packages/workflows/src/schemas/dag-node.ts'
  - 'packages/workflows/src/dag-executor.ts'
---

# Test Design: a4-1 - Aggregate Quality Gate Summary

**Date:** 2026-07-08
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for the story that evolves `quality-gate-summary` into the single route-facing aggregator for CR, RV, NR, and TR gate contracts.

This plan treats every known reviewer concern as evidence.

Every acceptance criterion, P0 or P1 risk, and reviewer concern maps to one or more atomic scenarios or to an explicit waiver.

The current worktree is still at the a3.2 YAML state for the TR path, so prerequisite coverage for the missing a3.3 baseline is included as a P0 gate.

**Risk Summary:**

- Total risks identified: 22.
- High-priority risks with score 6 or higher: 18.
- P0 risks: 9.
- P1 risks: 9.
- Critical categories: TECH, DATA, OPS, BUS.
- Primary risk theme: route-facing JSON contract integrity and fail-closed DAG behavior.

**Coverage Summary:**

- P0 scenarios: 14.
- P1 scenarios: 20.
- P2 scenarios: 3.
- P3 scenarios: 2.
- Total effort estimate: about 23 to 38 engineering hours.

## Not In Scope

| Item                              | Reasoning                                                                                                                  | Mitigation                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Browser E2E exploration           | The story changes workflow YAML, bash contract behavior, generated defaults, and workflow tests, not a browser-visible UI. | Use isolated DAG executor tests as the closest end-to-end product path for this workflow behavior.                                |
| Permission and auth behavior      | No adapter authorization, credential, token, or protected route changes are in scope.                                      | Waiver W-003 requires reopening coverage if implementation touches auth, credentials, adapters, providers, or server auth routes. |
| Load or performance testing       | No runtime hot path, service endpoint, or user-facing latency path changes are in scope.                                   | TD-155 asserts the bounded node timeout, and W-004 reopens performance coverage if long-running runtime work is added.            |
| Executor cancellation behavior    | The story does not change cancellation, pause, or lifecycle ownership semantics.                                           | W-002 requires new cancellation coverage if executor lifecycle behavior changes.                                                  |
| Quality route loop implementation | Story a4.1 only emits `quality-gate-summary.json` and does not route `FAIL`, `PASS`, or exhaustion.                        | TD-161 asserts no `quality-route-loop` is added in this story.                                                                    |

## Risk Assessment

Risk score equals probability multiplied by impact.

Score 9 is P0.

Score 6 to 8 is P1.

Score 4 to 5 is P2.

Score 1 to 3 is P3.

### High-Priority Risks

| Risk ID | Category | Description                                                                                                     | Probability | Impact | Score | Priority | Mitigation                                                                               | Owner                | Timeline  |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | ---------------------------------------------------------------------------------------- | -------------------- | --------- |
| R-001   | TECH     | The story proceeds from an a3.2 YAML baseline and never creates the required TR resolved contract path.         | 3           | 3      | 9     | P0       | TD-100 and TD-163 verify the a3.3 baseline or folded prerequisite wiring.                | Workflow implementer | Before PR |
| R-002   | DATA     | The summary reads markdown or prose instead of route-facing JSON contracts.                                     | 3           | 3      | 9     | P0       | TD-100 and TD-101 forbid prose reads and require node output contracts.                  | Workflow implementer | Before PR |
| R-003   | TECH     | Field-level output reads on skipped optional branches throw `producer-not-run`.                                 | 3           | 3      | 9     | P0       | TD-101 requires whole-output reads and forbids `$tea-*.output.gate`.                     | Workflow implementer | Before PR |
| R-004   | DATA     | Substring matching accepts malformed JSON or false-positive text as a gate decision.                            | 3           | 3      | 9     | P0       | TD-102, TD-147, and TD-151 require deterministic JSON parsing.                           | Workflow implementer | Before PR |
| R-006   | TECH     | Blocking role gates are not reflected as summary `FAIL`.                                                        | 2           | 3      | 6     | P1       | TD-110 through TD-114 prove single-role and multi-role blocking aggregation.             | Workflow implementer | Before PR |
| R-007   | BUS      | Decision-needed-only results are incorrectly treated as blocking failures.                                      | 2           | 3      | 6     | P1       | TD-120 and TD-121 prove `CONCERNS` maps to `PASS` plus count preservation.               | Workflow maintainer  | Before PR |
| R-008   | DATA     | `decision_needed_count` is wrong for all-pass or skipped-only paths.                                            | 2           | 3      | 6     | P1       | TD-121, TD-130, TD-131, and TD-150 cover zero and non-zero boundaries.                   | Workflow implementer | Before PR |
| R-009   | DATA     | Missing, empty, invalid, mismatched, or role `ERROR` contracts emit a route decision instead of failing closed. | 3           | 3      | 9     | P0       | TD-140 through TD-149 prove no summary is emitted on invalid source contracts.           | Workflow implementer | Before PR |
| R-010   | DATA     | Stale or wrong-story contracts are accepted.                                                                    | 3           | 3      | 9     | P0       | TD-142 through TD-145 validate identity and envelope fields for every source role.       | Workflow implementer | Before PR |
| R-011   | TECH     | Role `ERROR` is routed as fixable quality `FAIL`.                                                               | 2           | 3      | 6     | P1       | TD-146 proves hard node failure with no `PASS` or `FAIL` route decision.                 | Workflow implementer | Before PR |
| R-012   | DATA     | Partial summary JSON is emitted before validation completes.                                                    | 2           | 3      | 6     | P1       | TD-140 through TD-149 assert no stdout or persisted contract on failure.                 | Workflow implementer | Before PR |
| R-013   | DATA     | The summary contract omits fields future routing needs.                                                         | 2           | 3      | 6     | P1       | TD-104 and TD-150 assert envelope fields, counts, and per-role gate echoes.              | Workflow implementer | Before PR |
| R-015   | TECH     | Join dependencies or trigger rules allow omitted evidence or masked upstream failure.                           | 3           | 3      | 9     | P0       | TD-100, TD-153, TD-154, and TD-163 cover dependency and trigger-rule safety.             | Workflow implementer | Before PR |
| R-016   | TECH     | Tail wiring bypasses summary or adds the route loop early.                                                      | 2           | 3      | 6     | P1       | TD-161 asserts `create-pull-request` depends only on summary and no route loop is added. | Workflow implementer | Before PR |
| R-017   | OPS      | Source workflow, generated bundle, or v1 baseline drift.                                                        | 2           | 3      | 6     | P1       | TD-160 and `bun run check:bundled` prove source, bundle, and baseline compatibility.     | Workflow implementer | Before PR |
| R-018   | TECH     | Contract tests do not protect the route-facing contract.                                                        | 3           | 3      | 9     | P0       | TD-100 through TD-105 plus TD-160 through TD-164 define required structural coverage.    | Test architect       | Before PR |
| R-019   | TECH     | DAG tests omit high-risk negative and edge paths.                                                               | 3           | 3      | 9     | P0       | TD-110 through TD-156 define the required isolated executor scenarios.                   | Test architect       | Before PR |
| R-020   | OPS      | `mock.module()` pollution causes order-dependent workflow tests.                                                | 2           | 3      | 6     | P1       | TD-162 requires the DAG test to run as its own Bun invocation.                           | Test architect       | Before PR |

### Medium And Low Risks

| Risk ID | Category | Description                                                                 | Probability | Impact | Score | Priority | Action                                         |
| ------- | -------- | --------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | ---------------------------------------------- |
| R-005   | DATA     | Incorrect shell quoting corrupts substituted JSON values.                   | 2           | 2      | 4     | P2       | Cover with TD-105 and TD-151.                  |
| R-014   | OPS      | `quality-gate-summary.json` is not persisted for audit and later consumers. | 2           | 2      | 4     | P2       | Cover with TD-103, TD-152, TD-155, and TD-156. |
| R-021   | TECH     | Implementation touches out-of-scope runtime packages.                       | 1           | 3      | 3     | P3       | Cover with TD-165 and review file scope.       |
| R-022   | TECH     | Runtime ids or test artifacts violate project naming rules.                 | 1           | 2      | 2     | P3       | Cover with TD-164.                             |

### Risk Category Legend

- **TECH**: Technical or architecture risk.
- **SEC**: Security, access-control, auth, or data exposure risk.
- **PERF**: Performance, scalability, or resource-limit risk.
- **DATA**: Data integrity, contract integrity, stale data, or corruption risk.
- **BUS**: Business workflow, user-impact, or decision-flow risk.
- **OPS**: Operational, CI, generated artifact, or test isolation risk.

## NFR Planning

**Purpose:** Capture epic-specific NFR planning and expected evidence for later `nfr-assess`.

This is not a final evidence audit.

| NFR Category    | Requirement Or Threshold                                                                                           | Risk Link                                       | Planned Validation                 | Evidence Needed                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Reliability     | Summary must fail closed on invalid, missing, stale, malformed, dependency-failed, or `ERROR` source contracts.    | R-003, R-009, R-010, R-011, R-012, R-015        | TD-140 through TD-154.             | Isolated DAG test output for `v2-quality-summary-dag.test.ts`.                                          |
| Maintainability | Implementation stays within workflow YAML, generated defaults, tests, and package script wiring.                   | R-017, R-018, R-020, R-021, R-022               | TD-160 through TD-165.             | Bun contract test output, package script assertion, and validation output.                              |
| Compatibility   | V2 source and bundle stay aligned, and v1 remains untouched for rollback.                                          | R-017                                           | TD-160.                            | Contract test output and `bun run check:bundled`.                                                       |
| Data integrity  | Summary uses parsed JSON contracts with matching `story_ref`, `contract_version`, `workflow`, and producer `node`. | R-002, R-004, R-006, R-008, R-009, R-010, R-013 | TD-101 through TD-151.             | Contract and DAG test outputs.                                                                          |
| Security        | No auth, credential, permission, token, webhook, or protected route path changes are in scope.                     | W-003                                           | Waived for this story.             | Reopen only if implementation touches security-sensitive files.                                         |
| Performance     | No runtime hot path or user-facing latency path changes are in scope.                                              | W-004                                           | TD-155 checks the bounded timeout. | Contract test output for the timeout.                                                                   |
| Scalability     | No scaling threshold is present in the loaded story or architecture.                                               | N/A                                             | Not applicable.                    | Reopen if the implementation changes executor scheduling or shared runtime resources.                   |
| Compliance      | No compliance threshold is present in the loaded story or architecture.                                            | N/A                                             | Not applicable.                    | Reopen if downstream audit requirements demand retained gate-summary evidence beyond the JSON artifact. |

**Unknown thresholds:** Security, performance, scalability, and compliance thresholds are not specified because this story is not a user-facing or service-runtime change.

## Entry Criteria

- [ ] The team chooses either to merge the a3.3 baseline first or to explicitly fold the a3.3 TR join wiring into this story.
- [ ] The story acceptance criteria and dev notes remain the source of truth.
- [ ] The implementation scope is limited to v2 workflow YAML, regenerated bundled defaults, workflow default tests, and package test script registration.
- [ ] The test author keeps bash contract nodes real in DAG tests.
- [ ] The generated bundle is regenerated from source and not hand-edited.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] All P1 scenarios pass or have an owner-approved waiver.
- [ ] Every acceptance criterion traces to atomic scenarios.
- [ ] Every P0 and P1 risk traces to scenarios or an explicit waiver.
- [ ] Every reviewer concern traces to scenarios or an explicit waiver.
- [ ] `bun test packages/workflows/src/defaults/v2-quality-summary-contract.test.ts` passes.
- [ ] `bun test packages/workflows/src/defaults/v2-quality-summary-dag.test.ts` passes as its own isolated invocation.
- [ ] `bun run check:bundled` passes.
- [ ] `bun run validate` passes before PR handoff.

## Test Coverage Plan

P0, P1, P2, and P3 are priority and risk levels, not execution timing.

### P0

**Criteria:** Blocks core workflow behavior, data integrity, compatibility, or cross-process contract behavior with no acceptable workaround.

| Test ID | Requirement                                                                                                                                                            | Test Level              | Risk Link           | Notes                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| TD-100  | `quality-gate-summary` exists as a deterministic bash node with full dependencies, fail-closed trigger rule, bounded timeout, and `output_type: quality-gate-summary`. | Bun structural contract | R-001, R-015, R-018 | Also proves the summary is not an AI prompt node.                                      |
| TD-101  | Summary uses whole-output reads for optional roles and forbids field-level gate reads on skipped-capable branches.                                                     | Bun structural contract | R-002, R-003        | Directly covers the predecessor `producer-not-run` concern.                            |
| TD-102  | Summary uses `bun -e` plus `JSON.parse()` and forbids `grep`, `case`, or substring gate matching.                                                                      | Bun structural contract | R-004, R-018        | Directly covers the predecessor substring-parsing concern.                             |
| TD-130  | All four roles `PASS` yields summary `PASS`, zero blocking, zero decision-needed count, and correct findings total.                                                    | Isolated DAG executor   | R-008, R-019        | Primary happy path.                                                                    |
| TD-140  | Missing or empty CR output fails the summary node with no stdout summary and no persisted summary file.                                                                | Isolated DAG executor   | R-009, R-012, R-019 | Required role missing path.                                                            |
| TD-141  | Optional role with both real and skipped outputs empty fails the summary node with no route decision.                                                                  | Isolated DAG executor   | R-003, R-009, R-012 | Resolved-optional missing path.                                                        |
| TD-142  | Any source contract with mismatched `story_ref` fails closed before summary emission.                                                                                  | Isolated DAG executor   | R-009, R-010, R-012 | Stale or wrong-story data path.                                                        |
| TD-143  | Any source contract with mismatched `contract_version` fails closed before summary emission.                                                                           | Isolated DAG executor   | R-009, R-010, R-012 | Stale contract-version path.                                                           |
| TD-144  | Any source contract with mismatched `workflow` fails closed before summary emission.                                                                                   | Isolated DAG executor   | R-009, R-010, R-012 | Wrong workflow path.                                                                   |
| TD-145  | Any source contract with mismatched producer `node` fails closed before summary emission.                                                                              | Isolated DAG executor   | R-009, R-010, R-012 | Wrong producer path.                                                                   |
| TD-146  | Any resolved role contract with `gate:"ERROR"` hard-fails the node and emits no `PASS` or `FAIL` route decision.                                                       | Isolated DAG executor   | R-009, R-011, R-012 | Keeps tooling errors separate from fixable failures.                                   |
| TD-147  | Malformed selected JSON fails closed and emits no summary contract.                                                                                                    | Isolated DAG executor   | R-004, R-009, R-012 | Malformed input path.                                                                  |
| TD-154  | Failed real RV, NR, or TR branch prevents summary and PR handoff even if a skip sibling exists.                                                                        | Isolated DAG executor   | R-015, R-019        | Partial failure and dependency failure path.                                           |
| TD-163  | The a3.3 baseline or folded prerequisite wiring is present before summary assertions.                                                                                  | Bun structural contract | R-001, R-015, R-018 | Checks `tea-tr` guard, TR output format, `tea-tr-skipped`, and predecessor assertions. |

### P1

**Criteria:** Important release-gate, data-integrity, or regression coverage with material workflow risk.

| Test ID | Requirement                                                                                                                     | Test Level                                | Risk Link                  | Notes                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| TD-103  | Summary emits exact JSON to stdout and best-effort persists `quality-gate-summary.json`.                                        | Bun structural contract plus isolated DAG | R-013, R-014               | Covers primary output and artifact path.                          |
| TD-104  | Summary envelope includes all required fields and per-role gate echoes.                                                         | Bun structural contract                   | R-013                      | Prevents downstream re-reading of source gates.                   |
| TD-105  | Special characters in selected JSON string fields survive parse and re-encode.                                                  | Bun unit proof                            | R-004, R-005               | Covers quotes, backslashes, newlines, tabs, and report path text. |
| TD-110  | CR `FAIL` produces summary `FAIL`, `blocking_count >= 1`, and `cr_gate:"FAIL"`.                                                 | Isolated DAG executor                     | R-006                      | Blocking CR path.                                                 |
| TD-111  | RV `FAIL` produces summary `FAIL` and preserves the RV block.                                                                   | Isolated DAG executor                     | R-006                      | Blocking RV path.                                                 |
| TD-112  | NR `FAIL` produces summary `FAIL` and preserves the NR block.                                                                   | Isolated DAG executor                     | R-006                      | Blocking NR path.                                                 |
| TD-113  | TR `FAIL` produces summary `FAIL` and preserves the TR block.                                                                   | Isolated DAG executor                     | R-006                      | Blocking TR path.                                                 |
| TD-114  | Multiple role `FAIL` values produce the expected `blocking_count` and gate echoes.                                              | Isolated DAG executor                     | R-006, R-013               | Multi-blocker boundary.                                           |
| TD-120  | One role `CONCERNS` and no `FAIL` or `ERROR` produces summary `PASS` and `decision_needed_count == 1`.                          | Isolated DAG executor                     | R-007                      | Decision-needed-only path.                                        |
| TD-121  | Multiple role `CONCERNS` values and no `FAIL` or `ERROR` produce summary `PASS` and count all concerned roles.                  | Isolated DAG executor                     | R-007, R-008               | Decision-needed boundary.                                         |
| TD-131  | Optional skipped contracts are selected and echoed as `SKIPPED` without increasing decision-needed count.                       | Isolated DAG executor                     | R-003, R-008               | Skip-path boundary.                                               |
| TD-148  | Invalid numeric fields such as negative or non-numeric `findings_count` or missing CR `round` fail closed.                      | Isolated DAG executor                     | R-009, R-013               | Numeric boundary and malformed contract path.                     |
| TD-149  | Failure paths leave stdout and `quality-gate-summary.json` empty or absent.                                                     | Isolated DAG executor                     | R-012                      | No partial route decision.                                        |
| TD-150  | Boundary counts are correct for zero findings, mixed findings, four concern roles, and multiple blocking roles.                 | Bun unit proof plus isolated DAG          | R-006, R-007, R-008, R-013 | Count boundary path.                                              |
| TD-151  | Formatted JSON and substring false positives cannot influence aggregation outside parsed fields.                                | Bun technique proof                       | R-004, R-005               | Regression for substring matching.                                |
| TD-153  | Trigger-rule matrix proves summary runs only when no dependency failed and at least one dependency completed.                   | Bun unit proof                            | R-015                      | Out-of-order and missing-upstream safety.                         |
| TD-156  | Two DAG runs with distinct `ARTIFACTS_DIR` values do not share or overwrite summary artifacts.                                  | Isolated DAG executor                     | R-014, R-020               | Concurrency and race path.                                        |
| TD-160  | Edited v2 YAML passes `parseWorkflow`, source and bundle match, `check:bundled` passes, and v1 remains byte-for-byte unchanged. | Bun structural contract plus command      | R-017                      | Rollback and bundle parity.                                       |
| TD-161  | `create-pull-request` depends only on `quality-gate-summary`, and no route-loop nodes are added by this story.                  | Bun structural contract                   | R-016                      | Story boundary and tail wiring.                                   |
| TD-162  | Contract test is registered in the non-mock batch and DAG test is registered as its own Bun invocation.                         | Bun structural contract                   | R-018, R-020               | Mock isolation and CI registration.                               |

### P2

**Criteria:** Secondary operational and hygiene coverage.

| Test ID | Requirement                                                                                                                                 | Test Level              | Risk Link | Notes                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------- | ------------------------- |
| TD-152  | Re-running the summary encoder with identical inputs is deterministic and overwrites artifact content rather than appending duplicate JSON. | Bun unit proof          | R-014     | Duplicate-action path.    |
| TD-155  | `quality-gate-summary` declares `timeout: 60000` and no unbounded external command.                                                         | Bun structural contract | R-014     | Timeout guard.            |
| TD-165  | File scope is limited to v2 YAML, generated bundled defaults, workflow default tests, and package test script.                              | Review checklist        | R-021     | Scope and rollback guard. |

### P3

**Criteria:** Convention and hygiene checks.

| Test ID | Requirement                                                                                                                         | Test Level              | Risk Link | Notes                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------- | ------------------------- |
| TD-164  | New runtime ids and output types remain kebab-case and generated test artifacts avoid forbidden plan or review-finding identifiers. | Bun structural contract | R-022     | Project convention guard. |

## Acceptance Criteria Trace

| Acceptance Criterion | Status  | Scenarios Or Waiver                                                                                                    |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| AC1                  | Covered | TD-100, TD-101, TD-102, TD-103, TD-104, TD-105, TD-130, TD-131, TD-151, TD-155                                         |
| AC2                  | Covered | TD-110, TD-111, TD-112, TD-113, TD-114, TD-150                                                                         |
| AC3                  | Covered | TD-104, TD-120, TD-121, TD-150, W-001                                                                                  |
| AC4                  | Covered | TD-130, TD-131, TD-150                                                                                                 |
| AC5                  | Covered | TD-101, TD-102, TD-140, TD-141, TD-142, TD-143, TD-144, TD-145, TD-146, TD-147, TD-148, TD-149, TD-151, TD-153, TD-154 |
| AC6                  | Covered | TD-100, TD-160, TD-161, TD-162, TD-163, TD-164, TD-165                                                                 |

## P0 And P1 Risk Trace

| Risk ID | Status  | Scenarios Or Waiver                                                                                                                                                            |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-001   | Covered | TD-100, TD-163                                                                                                                                                                 |
| R-002   | Covered | TD-100, TD-101                                                                                                                                                                 |
| R-003   | Covered | TD-101, TD-131, TD-141                                                                                                                                                         |
| R-004   | Covered | TD-102, TD-147, TD-151                                                                                                                                                         |
| R-006   | Covered | TD-110, TD-111, TD-112, TD-113, TD-114, TD-150                                                                                                                                 |
| R-007   | Covered | TD-120, TD-121, W-001                                                                                                                                                          |
| R-008   | Covered | TD-121, TD-130, TD-131, TD-150                                                                                                                                                 |
| R-009   | Covered | TD-140, TD-141, TD-142, TD-143, TD-144, TD-145, TD-146, TD-147, TD-148                                                                                                         |
| R-010   | Covered | TD-142, TD-143, TD-144, TD-145                                                                                                                                                 |
| R-011   | Covered | TD-146                                                                                                                                                                         |
| R-012   | Covered | TD-140, TD-141, TD-142, TD-143, TD-144, TD-145, TD-146, TD-147, TD-149                                                                                                         |
| R-013   | Covered | TD-104, TD-114, TD-148, TD-150                                                                                                                                                 |
| R-015   | Covered | TD-100, TD-153, TD-154, TD-163                                                                                                                                                 |
| R-016   | Covered | TD-161                                                                                                                                                                         |
| R-017   | Covered | TD-160                                                                                                                                                                         |
| R-018   | Covered | TD-100, TD-101, TD-102, TD-103, TD-104, TD-105, TD-160, TD-162, TD-163, TD-164                                                                                                 |
| R-019   | Covered | TD-110, TD-111, TD-112, TD-113, TD-114, TD-120, TD-121, TD-130, TD-131, TD-140, TD-141, TD-142, TD-143, TD-144, TD-145, TD-146, TD-147, TD-148, TD-149, TD-150, TD-154, TD-156 |
| R-020   | Covered | TD-156, TD-162                                                                                                                                                                 |

## Reviewer Concern Trace

| Concern ID | Status                      | Scenarios Or Waiver                                                                                                                                                            |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-001      | Covered                     | TD-100, TD-163                                                                                                                                                                 |
| C-002      | Covered                     | TD-100, TD-101                                                                                                                                                                 |
| C-003      | Covered                     | TD-101, TD-131, TD-141                                                                                                                                                         |
| C-004      | Covered                     | TD-102, TD-147, TD-151                                                                                                                                                         |
| C-005      | Covered                     | TD-105, TD-151                                                                                                                                                                 |
| C-006      | Covered                     | TD-110, TD-111, TD-112, TD-113, TD-114                                                                                                                                         |
| C-007      | Covered                     | TD-120, TD-121, W-001                                                                                                                                                          |
| C-008      | Covered                     | TD-130, TD-131, TD-150                                                                                                                                                         |
| C-009      | Covered                     | TD-140, TD-141, TD-146, TD-149                                                                                                                                                 |
| C-010      | Covered                     | TD-142, TD-143, TD-144, TD-145                                                                                                                                                 |
| C-011      | Covered                     | TD-146                                                                                                                                                                         |
| C-012      | Covered                     | TD-149                                                                                                                                                                         |
| C-013      | Covered                     | TD-104, TD-150                                                                                                                                                                 |
| C-014      | Covered                     | TD-103, TD-152, TD-156                                                                                                                                                         |
| C-015      | Covered                     | TD-100, TD-153, TD-154, TD-163                                                                                                                                                 |
| C-016      | Covered                     | TD-161                                                                                                                                                                         |
| C-017      | Covered                     | TD-160                                                                                                                                                                         |
| C-018      | Covered                     | TD-100, TD-101, TD-102, TD-103, TD-104, TD-105, TD-160, TD-162, TD-163, TD-164                                                                                                 |
| C-019      | Covered                     | TD-110, TD-111, TD-112, TD-113, TD-114, TD-120, TD-121, TD-130, TD-131, TD-140, TD-141, TD-142, TD-143, TD-144, TD-145, TD-146, TD-147, TD-148, TD-149, TD-150, TD-154, TD-156 |
| C-020      | Covered                     | TD-162                                                                                                                                                                         |
| C-021      | Covered                     | TD-110, TD-113, TD-146                                                                                                                                                         |
| C-022      | Covered                     | TD-153, TD-154, TD-163                                                                                                                                                         |
| C-023      | Waived with scope rationale | W-001                                                                                                                                                                          |
| C-024      | Covered                     | TD-165                                                                                                                                                                         |
| C-025      | Covered                     | TD-164                                                                                                                                                                         |

## Edge-Case Coverage

| Edge Category       | Coverage Or Waiver                               |
| ------------------- | ------------------------------------------------ |
| Happy path          | TD-130 and TD-131.                               |
| Negative path       | TD-110 through TD-114 and TD-140 through TD-149. |
| Boundary cases      | TD-121, TD-130, TD-131, TD-148, and TD-150.      |
| Malformed input     | TD-105, TD-147, TD-148, and TD-151.              |
| Stale data          | TD-142, TD-143, TD-144, and TD-145.              |
| Duplicate actions   | TD-152.                                          |
| Out-of-order events | TD-153.                                          |
| Partial failure     | TD-153 and TD-154.                               |
| Dependency failure  | TD-153 and TD-154.                               |
| Timeout             | TD-155.                                          |
| Cancellation        | W-002.                                           |
| Concurrency or race | TD-156 and TD-162.                               |
| Rollback            | TD-160, TD-161, TD-163, and TD-165.              |
| Permission or auth  | W-003.                                           |
| Regression          | TD-100 through TD-105 and TD-160 through TD-165. |

## Waivers

| Waiver ID | Subject                                          | Reason                                                                                                                                                       | Owner                   | Residual Risk                                                          | Follow-Up Trigger                                                                                                         |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| W-001     | `decision_needed_count` per-finding granularity. | The story explicitly derives the count from resolved roles with `gate:"CONCERNS"` because source contracts do not expose per-finding decision-needed counts. | Workflow maintainer     | A later route-loop or Linear sync story may need finer-grained counts. | Reopen if downstream consumers require per-finding decision-needed totals.                                                |
| W-002     | Cancellation coverage.                           | Executor cancellation and lifecycle ownership are unchanged by this YAML and bash-contract story.                                                            | Workflow maintainer     | Cancellation during a summary write is not newly exercised.            | Add coverage if implementation changes executor cancellation, node lifecycle mutation, or artifact write ownership.       |
| W-003     | Permission and auth coverage.                    | No auth, credential, adapter, or protected route code is in scope.                                                                                           | Security/platform owner | A stray implementation change could introduce untested auth behavior.  | Reopen if the diff touches credentials, adapters, server auth routes, provider credential delivery, or permission checks. |
| W-004     | Load and performance testing.                    | No runtime hot path, API endpoint, or user-facing latency path changes are in scope.                                                                         | Workflow maintainer     | The summary bash could still hang if timeout is omitted.               | TD-155 must pass, and performance testing reopens if implementation adds long-running runtime work.                       |

## Execution Strategy

Run all focused functional and contract coverage in PR validation because these are package-local Bun tests and should stay below the 15 minute threshold.

PR validation should include:

- `bun test packages/workflows/src/defaults/v2-quality-summary-contract.test.ts`
- `bun test packages/workflows/src/defaults/v2-quality-summary-dag.test.ts`
- `bun run check:bundled`
- `bun run validate`

Nightly validation should run the normal package-isolated `bun run test` suite and report any order-dependent or mock-pollution regression.

Weekly validation is not required for this story because there is no long-running performance, chaos, or browser suite.

## Resource Estimates

| Priority | Scenario Count | Effort Range         | Notes                                                                           |
| -------- | -------------- | -------------------- | ------------------------------------------------------------------------------- |
| P0       | 14             | About 11 to 17 hours | Mostly isolated DAG failure paths and prerequisite structural checks.           |
| P1       | 20             | About 9 to 15 hours  | Aggregation variants, count boundaries, artifact behavior, and CI registration. |
| P2       | 3              | About 2 to 4 hours   | Timeout, deterministic duplicate-action behavior, and file-scope review.        |
| P3       | 2              | About 1 to 2 hours   | Naming and hygiene checks.                                                      |
| Total    | 39             | About 23 to 38 hours | Includes test harness adaptation and validation runs.                           |

Timeline estimate: about 3 to 6 focused engineering days depending on whether the a3.3 baseline is merged first or folded into this story.

## Quality Gate Criteria

- P0 pass rate must be 100%.
- P1 pass rate must be at least 95%.
- All score 6 or higher risks must be mitigated by scenarios or approved waivers.
- All acceptance criteria must trace to atomic scenarios before coverage is marked complete.
- No P0 or P1 edge case may be counted as covered by implication.
- `bun run check:bundled` must pass after regenerating bundled defaults.
- `bun run validate` must pass before PR handoff.
- Full NFR PASS, CONCERNS, or FAIL assessment is deferred to `nfr-assess` after implementation evidence exists.

## Mitigation Plans

### R-001: Missing a3.3 Baseline

**Mitigation Strategy:** Add or verify prerequisite TR join wiring before summary assertions.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-100 and TD-163.

### R-003 And R-004: Known Optional-Branch And JSON Parsing Defects

**Mitigation Strategy:** Require whole-output branch selection and parsed JSON contract validation.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-101, TD-102, TD-147, and TD-151.

### R-009 And R-010: Fail-Closed Identity And Contract Validation

**Mitigation Strategy:** Validate every source contract before aggregation and emit no summary on error.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-140 through TD-149.

### R-018 Through R-020: Test Completeness And Isolation

**Mitigation Strategy:** Add both the structural contract test and isolated DAG test, and register the DAG test as its own Bun invocation.

**Owner:** Test architect.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-100 through TD-165 and `packages/workflows/package.json` assertions.

## Assumptions And Dependencies

### Assumptions

1. The role-count definition for `decision_needed_count` remains accepted for this story.
2. The summary can use existing workflow executor substitution behavior and does not require engine changes.
3. The isolated DAG harness can follow the existing `v2-tr-join-dag.test.ts` pattern.

### Dependencies

1. The a3.3 TR join wiring must be present or deliberately folded into this story before a4.1 can pass.
2. Bundled defaults must be regenerated with `bun run generate:bundled` after YAML edits.
3. The DAG test must run in a separate Bun process because it uses `mock.module()`.

### Risks To Plan

- **Risk:** The team decides per-finding `decision_needed_count` is required.
  - **Impact:** Source CR, RV, NR, and TR contracts need a cross-cutting schema change before summary can count per finding.
  - **Contingency:** Keep W-001 active and open a follow-up contract-change story.

- **Risk:** The a3.3 branch is not available to merge.
  - **Impact:** This story must include the prerequisite TR join work and its tests.
  - **Contingency:** Treat TD-163 as a hard P0 acceptance gate.

## Follow-On Workflows

- Run `*atdd` to generate failing P0 tests as a separate workflow.
- Run `*automate` for broader automated coverage once implementation exists.
- Run `nfr-assess` only after implementation evidence exists.

## Interworking And Regression

| Service Or Component                                                 | Impact                                        | Regression Scope                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` | Primary workflow source changes.              | ParseWorkflow validation, structural contract tests, DAG executor tests, and bundle parity. |
| `packages/workflows/src/defaults/bundled-defaults.generated.ts`      | Generated mirror must match source.           | `bun run generate:bundled` and `bun run check:bundled`.                                     |
| `packages/workflows/src/defaults/*quality-summary*.test.ts`          | New tests prove summary behavior.             | Co-located contract test and isolated DAG test registration.                                |
| `packages/workflows/package.json`                                    | Test script must preserve Bun mock isolation. | TD-162 and normal package test execution.                                                   |
| `bmad-dev-story-with-tea-fix-loop.yml`                               | Must remain unchanged for rollback.           | TD-160 byte-for-byte or structural baseline guard.                                          |

## Appendix

### Knowledge Base References

- `risk-governance.md` for risk scoring and gate rules.
- `probability-impact.md` for probability, impact, and priority thresholds.
- `test-levels-framework.md` for selecting structural, unit, integration, and end-to-end levels.
- `test-priorities-matrix.md` for P0 through P3 classification.
- `nfr-criteria.md` for NFR planning boundaries.
- `contract-testing.md` for contract integrity principles.
- `playwright-cli.md`, `overview.md`, `api-request.md`, `auth-session.md`, and `recurse.md` for API/backend testing context.

### Related Documents

- Story: `_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md`
- Architecture: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`
- Epics: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`
- Project context: `_bmad-output/project-context.md`
- Predecessor story: `_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md`
