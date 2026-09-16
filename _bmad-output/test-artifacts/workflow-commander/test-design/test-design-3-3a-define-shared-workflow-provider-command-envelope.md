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
lastSaved: '2026-07-14'
workflowType: 'testarch-test-design'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3a-define-shared-workflow-provider-command-envelope.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/implementation-readiness-report-2026-07-12.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/sprint-change-proposal-2026-07-12-implementation-readiness-remediation.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/README.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/*.json'
  - '_bmad-output/test-artifacts/workflow-commander/test-design-epic-3.md'
  - '_bmad-output/test-artifacts/workflow-commander/atdd-checklist-3-1-implement-archon-workflow-provider-binding-lifecycle.md'
  - 'packages/cli/package.json'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/commands/provider-binding.ts'
  - 'packages/cli/src/commands/provider-binding.test.ts'
  - 'packages/cli/src/commands/provider-binding-contract.test.ts'
  - 'packages/cli/src/commands/provider-binding.e2e.test.ts'
  - 'packages/cli/src/commands/workflow.ts'
---

# Test Design: Story 3.3a - Define Shared Workflow Provider Command Envelope

**Date:** 2026-07-14
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for Story 3.3a.
This story defines a shared CLI command-envelope helper for Workflow Commander provider output and refactors existing provider-binding commands to consume it without changing externally observed JSON.

**Risk Summary:**

- Total risks identified: 17
- High-priority risks, score >= 6: 16
- P0 acceptance blockers: enum/schema drift, invalid envelope shape, missing retryability, provider-binding fixture regression, fail-closed failure semantics, syntax drift, JSON purity, forbidden-field leakage, and incomplete helper coverage for future command families.
- Critical categories: TECH, BUS, OPS, SEC

**Coverage Summary:**

- P0 scenarios: 31
- P1 scenarios: 26
- P2/P3 scenarios: 0 required; low-risk gaps are handled by waivers and normal review gates.
- Explicit waivers: 6
- Total effort estimate: ~37-71 hours, roughly 5-9 engineering days for one implementer/reviewer loop.

## Not in Scope

| Item                                                             | Reasoning                                                                                                            | Mitigation                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Workflow command runtime conversion                              | Stories 3.3b, 3.3c, and 3.3d own `workflow.start/status/approve/reject/resume/retry/cancel` runtime JSON conversion. | Baseline and helper coverage are required now; runtime conversion is waived as W-3.3A-001. |
| Browser, HTTP API, server routes, web UI                         | The approved surface is headless CLI JSON.                                                                           | Static scope review and W-3.3A-002.                                                        |
| Workflow event outbox, delivery health, Hermes consumer behavior | These are separate producer/consumer stories.                                                                        | Contract fixtures and validator remain the compatibility seam.                             |
| DB migrations and core DB persistence changes                    | Story 3.3a extracts helper logic and preserves Story 3.1 behavior; it should not change persistence.                 | Provider-binding regression tests plus scope review.                                       |
| Runtime timeout/cancellation policy                              | The helper can represent timeout/cancel envelopes but does not define process abort behavior.                        | W-3.3A-003; future runtime command stories must define policy.                             |
| Application-level auth/permission policy                         | Current CLI runs under local OS-process trust.                                                                       | W-3.3A-004; re-review if remote or multi-user control is introduced.                       |

## Risk Assessment

### High-Priority Risks

| Risk ID    | Category    | Description                                                                                                     |   P |   I | Score | Priority | Mitigation                                                                       | Owner / Timeline                                    |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | -------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| 3.3A-R-001 | TECH / BUS  | Helper command union drifts from `workflow-command-envelope.schema.json`.                                       |   3 |   3 |     9 | P0       | Exact schema enum test, full baseline table coverage, validator.                 | CLI implementer + contract reviewer / Task 3        |
| 3.3A-R-002 | TECH / BUS  | Builders violate closed schema, result/error exclusivity, or reference requirements.                            |   3 |   3 |     9 | P0       | Builder shape tests and representative success/failure fixtures.                 | CLI implementer / Tasks 1 and 3                     |
| 3.3A-R-003 | BUS / OPS   | Failure envelopes omit `error.retryable` or use open diagnostic vocabulary.                                     |   3 |   3 |     9 | P0       | Mandatory boolean input and all failure examples covered.                        | CLI implementer + contract owner / Task 1           |
| 3.3A-R-004 | BUS / DATA  | Provider-binding refactor changes Story 3.1 output or exit behavior.                                            |   3 |   3 |     9 | P0       | Exact fixture comparisons and subprocess malformed/unsupported regressions.      | Story 3.3a owner / Task 2                           |
| 3.3A-R-005 | OPS / BUS   | Fail-closed outcomes are not buildable or fixture-aligned.                                                      |   2 |   3 |     6 | P0       | Failure-builder tests for malformed, schema mismatch, timeout, exit, and state.  | CLI implementer / Tasks 1 and 3                     |
| 3.3A-R-006 | BUS / TECH  | Syntax baseline drifts, especially `workflow.cancel` versus `abandon` and `workflow.retry` versus `retry-node`. |   3 |   3 |     9 | P0       | Baseline tests and explicit negative assertions.                                 | CLI implementer + architecture reviewer / Task 3    |
| 3.3A-R-007 | TECH        | Generic helper absorbs command-specific lifecycle classification.                                               |   2 |   3 |     6 | P1       | Keep classification local and test provider-binding behavior unchanged.          | CLI implementer / Tasks 1 and 2                     |
| 3.3A-R-008 | TECH / OPS  | Production CLI imports planning artifacts or adds JSON Schema runtime dependency.                               |   2 |   3 |     6 | P1       | Import/dependency scan; constants in source tested against schema only in tests. | CLI implementer + reviewer / Task 1                 |
| 3.3A-R-009 | BUS / OPS   | `--json` emits logs/prose/multiple lines or invalid JSON.                                                       |   3 |   3 |     9 | P0       | Raw subprocess captures and safeStringify tests.                                 | CLI implementer / Tasks 1-4                         |
| 3.3A-R-010 | TECH / OPS  | `mock.module()` pollution creates order-dependent tests.                                                        |   3 |   2 |     6 | P1       | Keep mocked tests isolated in package scripts.                                   | Test implementer / Task 3                           |
| 3.3A-R-011 | TECH / OPS  | Scope creep touches workflow runtime conversion, core DB, server, web, workflow engine, or contracts.           |   2 |   3 |     6 | P1       | File-scope review and no contract-package edits.                                 | Story owner + reviewer / every task gate            |
| 3.3A-R-012 | SEC / BUS   | Helper emits forbidden actor/profile/agent keys or raw secret/signing material.                                 |   2 |   3 |     6 | P0       | Recursive forbidden-key and source secret scans.                                 | Security reviewer + CLI implementer / Tasks 1 and 3 |
| 3.3A-R-013 | BUS / OPS   | Correlation id or issued-at timestamp behavior changes.                                                         |   2 |   3 |     6 | P1       | Fixed and generated metadata tests.                                              | CLI implementer / Task 1                            |
| 3.3A-R-014 | TECH / BUS  | Future command stories cannot use the helper because coverage is incomplete.                                    |   3 |   3 |     9 | P0       | Representative success builders for all command families.                        | CLI implementer + future story owners / Task 3      |
| 3.3A-R-015 | TECH / BUS  | Dynamic-field exclusions widen and hide static fixture drift.                                                   |   2 |   3 |     6 | P1       | Contract test locks documented dynamic paths.                                    | Test implementer / Task 4                           |
| 3.3A-R-016 | TECH / DATA | Builder inputs allow blank values that violate schema `minLength`.                                              |   2 |   3 |     6 | P1       | Runtime guards and typed non-empty tests.                                        | CLI implementer / Task 1                            |

### Low-Priority Risks

| Risk ID    | Category   | Description                                                                      |   P |   I | Score | Action                                                          |
| ---------- | ---------- | -------------------------------------------------------------------------------- | --: | --: | ----: | --------------------------------------------------------------- |
| 3.3A-R-017 | PERF / OPS | No latency, cancellation, or runtime timeout SLO exists for helper construction. |   1 |   2 |     2 | Waive runtime guarantee; cover timeout envelope representation. |

### Reviewer-Evidence Disposition

Every known concern is treated as evidence.
No reviewer concern is optional advice.

| Concern                                                    | Disposition                                                              |   P |   I | Score | Scenario or waiver                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | --: | --: | ----: | -------------------------------------------------- |
| RC-01 Missing `error.retryable` traceability               | Risk: controller retry semantics break if omitted or optional.           |   3 |   3 |     9 | 3.3A-UNIT-007/014/025; 3.3A-CONTRACT-038-042       |
| RC-02 Schema enum is source of truth                       | Critical compatibility risk if constants drift.                          |   3 |   3 |     9 | 3.3A-UNIT-001                                      |
| RC-03 Closed top-level schema                              | Critical compatibility/security risk if extra fields are emitted.        |   3 |   3 |     9 | 3.3A-UNIT-003/004/008/016                          |
| RC-04 Result/error exclusivity and conditional refs        | Critical compatibility risk.                                             |   3 |   3 |     9 | 3.3A-UNIT-003-009                                  |
| RC-05 Baseline must cover all 12 commands                  | Critical drift risk.                                                     |   3 |   3 |     9 | 3.3A-CONTRACT-033/037                              |
| RC-06 `workflow.cancel` is not `abandon`                   | Critical command-contract risk.                                          |   3 |   3 |     9 | 3.3A-CONTRACT-034                                  |
| RC-07 `workflow.retry` is not `retry-node`                 | Critical command-contract risk.                                          |   3 |   3 |     9 | 3.3A-CONTRACT-035                                  |
| RC-08 Story 3.1 W-007 now activates                        | Required regression obligation.                                          |   3 |   3 |     9 | 3.3A-UNIT-020-032                                  |
| RC-09 Provider-binding fixtures must keep passing          | Critical regression risk.                                                |   3 |   3 |     9 | 3.3A-UNIT-020-025/030                              |
| RC-10 Metadata and stringify helpers move                  | Risk if behavior changes during extraction.                              |   2 |   3 |     6 | 3.3A-UNIT-010-012/029/031                          |
| RC-11 Classification remains command-specific              | Risk of fat helper and coupled policy.                                   |   2 |   3 |     6 | 3.3A-UNIT-027/032                                  |
| RC-12 Scope excludes DB/server/web/workflows/Hermes        | Explicit non-risk only if file scope stays clean.                        |   2 |   3 |     6 | 3.3A-CI-053/057; W-3.3A-002                        |
| RC-13 Contract package immutable and validator-gated       | Risk if contracts are edited to fit runtime.                             |   2 |   3 |     6 | 3.3A-CONTRACT-047/048                              |
| RC-14 No JSON Schema runtime dependency                    | Maintainability/package-boundary risk.                                   |   2 |   3 |     6 | 3.3A-UNIT-018                                      |
| RC-15 `mock.module()` requires test isolation              | Test reliability risk.                                                   |   3 |   2 |     6 | 3.3A-UNIT-019; 3.3A-CI-050                         |
| RC-16 Forbidden secrets and Hermes-specific fields         | Security and compatibility risk.                                         |   2 |   3 |     6 | 3.3A-UNIT-016; 3.3A-CI-049                         |
| RC-17 Execution metadata redaction                         | Fail-closed compatibility risk.                                          |   2 |   3 |     6 | 3.3A-UNIT-015; 3.3A-CONTRACT-040/041; 3.3A-CLI-046 |
| RC-18 Dynamic exclusions must stay narrow                  | Regression-mask risk.                                                    |   2 |   3 |     6 | 3.3A-UNIT-030                                      |
| RC-19 Workflow runtime conversion belongs to later stories | Explicit non-risk for this story; converting now is scope creep.         |   1 |   3 |     3 | 3.3A-CONTRACT-036; W-3.3A-001                      |
| RC-20 Later stories must use this helper                   | Risk if helper lacks representative workflow coverage.                   |   3 |   3 |     9 | 3.3A-CONTRACT-033/037                              |
| RC-21 Browser/HTTP/web/events/Hermes excluded              | Explicit non-risk under headless CLI boundary.                           |   1 |   2 |     2 | W-3.3A-002                                         |
| RC-22 Timeout/cancellation runtime behavior not owned here | Explicit waiver for runtime guarantees; envelope representation covered. |   1 |   2 |     2 | 3.3A-CONTRACT-040; W-3.3A-003                      |
| RC-23 No application auth/permission policy exists         | Explicit non-risk under local OS trust.                                  |   1 |   3 |     3 | W-3.3A-004                                         |

## NFR Planning

This section plans evidence only.
Final PASS, CONCERNS, or FAIL decisions belong to `nfr-assess` after implementation evidence exists.

| NFR Category               | Requirement / Threshold                                                                                                                                    | Risk Link                                      | Planned Validation                                                                          | Evidence Needed                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Security                   | Zero raw secret/signature material; zero forbidden `actor`, `profile`, `agent`, `agent_name`, `agent_provider`; redacted execution output.                 | 3.3A-R-012                                     | Recursive envelope scan and source secret scan.                                             | Bun test output and scan results.           |
| Reliability                | Builders never emit invalid success/failure combinations; non-serializable values still produce one JSON document; fail-closed examples are representable. | 3.3A-R-002, 3.3A-R-005, 3.3A-R-009             | Builder unit tests, safeStringify tests, failure examples, subprocess stdout/stderr checks. | Focused CLI test output.                    |
| Compatibility              | Every envelope is `workflow-command-envelope.v1`, uses canonical command ids, obeys refs, and preserves provider-binding fixtures.                         | 3.3A-R-001, 3.3A-R-004, 3.3A-R-006, 3.3A-R-014 | Schema enum tests, baseline tests, fixture equality, validator.                             | Fixture diffs and validator output.         |
| Data integrity regression  | Provider-binding refactor must not alter binding refs or lifecycle result payloads.                                                                        | 3.3A-R-004                                     | Provider-binding unit/E2E/contract regressions.                                             | Story 3.1 regression test output.           |
| Maintainability            | Strict TypeScript, no production planning-artifact imports, no new JSON Schema runtime dependency, isolated test batches.                                  | 3.3A-R-008, 3.3A-R-010, 3.3A-R-011             | Type-check, dependency/import scan, package-script review.                                  | Type-check and `bun run validate`.          |
| Performance / scalability  | UNKNOWN. No latency or load threshold exists for local helper construction.                                                                                | 3.3A-R-017                                     | Waiver W-3.3A-006.                                                                          | No final assessment until threshold exists. |
| Permission / authorization | Current boundary is local OS-process trust; no app-level role policy.                                                                                      | W-3.3A-004                                     | Static scope review that no remote surface is added.                                        | Security waiver and re-review trigger.      |
| Compliance                 | No regulatory requirement stated.                                                                                                                          | N/A                                            | Contract traceability only.                                                                 | Validator and traceability artifact.        |

**Unknown thresholds:** runtime timeout/cancellation SLO, local CLI latency, and load/throughput targets are unknown and must not be invented.

## Entry Criteria

- [ ] Story 3.3a source file and contract package are present.
- [ ] `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` passes before implementation edits.
- [ ] Provider-binding Story 3.1 tests are passing or failures are understood as pre-existing.
- [ ] The implementation owner accepts that runtime workflow command conversion is out of scope.
- [ ] Test batching decision is made before adding any new `mock.module()` use.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] All P1 scenarios pass or have approved waiver with owner and follow-up trigger.
- [ ] No open score >= 6 risk lacks mitigation evidence.
- [ ] Provider-binding exact fixtures still pass with narrow dynamic exclusions.
- [ ] The canonical contract validator passes unchanged.
- [ ] No forbidden field, raw secret, or signing material appears in helper output or source.
- [ ] `bun --filter @archon/cli type-check` passes.
- [ ] `bun run validate` passes.

## Test Coverage Plan

P0/P1/P2/P3 are priority and risk levels, not execution timing.
Execution timing is defined separately in the Execution Strategy section.

### P0 Critical

**Criteria:** Blocks core behavior or cross-process contract behavior, high risk, no practical workaround.

| Test ID           | Requirement                              | Test Level      | Risk Link           | Notes                                      |
| ----------------- | ---------------------------------------- | --------------- | ------------------- | ------------------------------------------ |
| 3.3A-UNIT-001     | Command enum exactness                   | Unit/contract   | R-001               | Schema enum equals exported command list.  |
| 3.3A-UNIT-002     | Diagnostic category exactness            | Unit/contract   | R-003               | Closed category vocabulary.                |
| 3.3A-UNIT-003     | Workflow success envelope                | Unit            | R-002               | Has workflow ref and result, no error.     |
| 3.3A-UNIT-004     | Binding success envelope                 | Unit            | R-002               | Has binding ref and result, no error.      |
| 3.3A-UNIT-005     | Missing workflow ref rejected            | Unit            | R-002, R-016        | Boundary failure before serialization.     |
| 3.3A-UNIT-006     | Missing binding ref rejected             | Unit            | R-002, R-016        | Boundary failure before serialization.     |
| 3.3A-UNIT-007     | Failure requires retryable               | Unit            | R-003               | Boolean required and serialized.           |
| 3.3A-UNIT-008     | Failure shape and execution              | Unit            | R-002, R-005        | No result, refs omitted by default.        |
| 3.3A-UNIT-009     | Result/error exclusivity                 | Unit            | R-002               | Both/neither rejected.                     |
| 3.3A-UNIT-010     | Safe serialization                       | Unit            | R-009               | Bigint/function/circular values.           |
| 3.3A-UNIT-014     | Failure helper class coverage            | Unit            | R-003, R-005        | All five canonical failure classes.        |
| 3.3A-UNIT-016     | Forbidden fields and secrets             | Unit/static     | R-012               | Recursive scan.                            |
| 3.3A-UNIT-020     | Binding create fixture                   | Unit regression | R-004               | Exact Story 3.1 output.                    |
| 3.3A-UNIT-021     | Binding update fixture                   | Unit regression | R-004               | Exact Story 3.1 output.                    |
| 3.3A-UNIT-022     | Binding status fixture                   | Unit regression | R-004               | Exact Story 3.1 output.                    |
| 3.3A-UNIT-023     | Binding rotate fixture                   | Unit regression | R-004               | Exact Story 3.1 output.                    |
| 3.3A-UNIT-024     | Binding disable fixture                  | Unit regression | R-004               | Exact Story 3.1 output.                    |
| 3.3A-UNIT-025     | Binding malformed fixture                | Unit regression | R-003, R-004        | Exact failure output with retryable false. |
| 3.3A-CONTRACT-033 | Syntax baseline covers all commands      | Contract        | R-006, R-014        | All 12 schema command ids.                 |
| 3.3A-CONTRACT-034 | Cancel is not abandon                    | Contract        | R-006               | `workflow.cancel` syntax protection.       |
| 3.3A-CONTRACT-035 | Retry is not retry-node                  | Contract        | R-006               | `workflow.retry` syntax protection.        |
| 3.3A-CONTRACT-037 | Representative success by command family | Contract/unit   | R-014               | Future story readiness.                    |
| 3.3A-CONTRACT-038 | Malformed request failure                | Contract/unit   | R-005               | Canonical failure example.                 |
| 3.3A-CONTRACT-039 | Schema mismatch failure                  | Contract/unit   | R-005               | Canonical failure example.                 |
| 3.3A-CONTRACT-040 | Timeout failure                          | Contract/unit   | R-005, R-017        | Timeout envelope representation.           |
| 3.3A-CONTRACT-041 | Unexpected exit failure                  | Contract/unit   | R-005               | Redacted execution metadata.               |
| 3.3A-CONTRACT-042 | Unexpected state failure                 | Contract/unit   | R-005               | Mutation not applied.                      |
| 3.3A-CLI-043      | Malformed subprocess JSON                | CLI E2E         | R-004, R-009        | One stdout JSON, no stderr, exit 64.       |
| 3.3A-CLI-046      | `--json` purity                          | CLI E2E         | R-009               | No log/prose leakage.                      |
| 3.3A-CONTRACT-047 | Canonical validator passes               | Contract        | R-001, R-004, R-008 | Contract package unchanged.                |
| 3.3A-CI-049       | Source/envelope secret scan              | CI/static       | R-012               | Includes new helper.                       |

**Total P0:** 31 scenarios.

### P1 High

**Criteria:** High or medium risk for important contract, maintainability, regression, or edge behavior.

| Test ID           | Requirement                               | Test Level          | Risk Link           | Notes                               |
| ----------------- | ----------------------------------------- | ------------------- | ------------------- | ----------------------------------- |
| 3.3A-UNIT-011     | Correlation id behavior                   | Unit                | R-013               | Supplied and generated cases.       |
| 3.3A-UNIT-012     | Issued-at behavior                        | Unit                | R-013               | ISO and stable per envelope.        |
| 3.3A-UNIT-013     | Invalid command/category guard            | Unit                | R-001, R-016        | Forced invalid casts fail.          |
| 3.3A-UNIT-015     | Execution metadata details                | Unit                | R-005, R-009        | Exit, timeout, duration, redaction. |
| 3.3A-UNIT-017     | No production planning imports            | Static              | R-008               | No `_bmad-output` runtime import.   |
| 3.3A-UNIT-018     | No runtime JSON Schema dependency         | Static              | R-008               | Package diff.                       |
| 3.3A-UNIT-019     | Test batch isolation decision             | CI/static           | R-010               | Handles `mock.module()`.            |
| 3.3A-UNIT-026     | Unsupported provider-binding subcommand   | Unit regression     | R-004, R-009        | Fail closed.                        |
| 3.3A-UNIT-027     | Binding classification stays local        | Unit regression     | R-007               | Disabled/concurrent cases.          |
| 3.3A-UNIT-028     | DB timeout classification preserved       | Unit regression     | R-005               | Timeout edge.                       |
| 3.3A-UNIT-029     | Non-serializable provider-binding error   | Unit regression     | R-009               | One parseable failure.              |
| 3.3A-UNIT-030     | Dynamic exclusions stay narrow            | Contract regression | R-015               | No masking static drift.            |
| 3.3A-UNIT-031     | Duplicate local helpers removed           | Static/refactor     | R-004               | Shared helper actually used.        |
| 3.3A-UNIT-032     | Binding-specific logic remains local      | Static/refactor     | R-007, R-011        | Avoid fat helper.                   |
| 3.3A-CONTRACT-036 | Workflow runtime conversion not done here | Static              | R-011               | Scope guard.                        |
| 3.3A-CLI-044      | Missing string flag before `--json`       | CLI E2E             | R-009               | Parser boundary.                    |
| 3.3A-CLI-045      | Unsupported subcommand subprocess         | CLI E2E             | R-004, R-009        | No prose stdout.                    |
| 3.3A-CONTRACT-048 | Contract package not edited               | Static              | R-008, R-011        | Guard against fixture rewrites.     |
| 3.3A-CI-050       | Package script test isolation             | CI/static           | R-010               | Provider-binding remains isolated.  |
| 3.3A-CI-051       | CLI type-check                            | CI/static           | R-008, R-016        | Strict TypeScript.                  |
| 3.3A-CI-052       | Full validation                           | CI/static           | R-010, R-011, R-015 | Pre-review gate.                    |
| 3.3A-CI-053       | File-scope review                         | Review/static       | R-011               | Expected files only.                |
| 3.3A-UNIT-054     | Stale status representability preserved   | Unit regression     | R-004               | Stale-data edge.                    |
| 3.3A-UNIT-055     | Duplicate create non-upsert preserved     | Unit regression     | R-004               | Duplicate-action edge.              |
| 3.3A-UNIT-056     | Parallel helper calls independent         | Unit                | R-013               | Concurrency/race edge.              |
| 3.3A-CI-057       | Rollback review                           | Review/static       | R-011               | No DB/schema/contract rollback.     |

**Total P1:** 26 scenarios.

### P2 / P3

No mandatory P2/P3 scenario carries an acceptance criterion, high-risk item, or reviewer concern.
Low-risk runtime performance and out-of-scope surfaces are handled through waivers with triggers.

## Required Edge-Class Disposition

| Edge class          | Scenario or waiver                                                         |
| ------------------- | -------------------------------------------------------------------------- |
| Happy path          | 3.3A-UNIT-003/004/020-024/037                                              |
| Negative path       | 3.3A-UNIT-007-009/025-029; 3.3A-CONTRACT-038-042                           |
| Boundary cases      | 3.3A-UNIT-005/006/011-013/016; 3.3A-CLI-044                                |
| Malformed input     | 3.3A-UNIT-025; 3.3A-CONTRACT-038; 3.3A-CLI-043/044                         |
| Stale data          | 3.3A-UNIT-054 preserves Story 3.1 stale representability.                  |
| Duplicate actions   | 3.3A-UNIT-055 preserves duplicate create/non-upsert behavior.              |
| Out-of-order events | W-3.3A-005.                                                                |
| Partial failure     | 3.3A-UNIT-028/029; 3.3A-CONTRACT-041/042                                   |
| Dependency failure  | 3.3A-UNIT-028/029                                                          |
| Timeout             | 3.3A-CONTRACT-040 and 3.3A-UNIT-015; runtime policy waived by W-3.3A-003.  |
| Cancellation        | W-3.3A-003 for runtime behavior; 3.3A-CONTRACT-034 protects future syntax. |
| Concurrency/race    | 3.3A-UNIT-056; DB concurrency is not changed by this story.                |
| Rollback            | 3.3A-CI-057 and 3.3A-CONTRACT-048.                                         |
| Permission/auth     | W-3.3A-004.                                                                |
| Regression          | 3.3A-UNIT-020-032; 3.3A-CLI-043-046; 3.3A-CONTRACT-047/048.                |

## Acceptance Criteria Traceability

| AC                                                                                                                                 | Scenarios / waivers                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AC1 success envelope includes schema version, success flag, correlation id, refs when applicable, and result payload               | 3.3A-UNIT-003-006/011/012/020-024/037                                                                                             |
| AC2 failure envelope includes schema version, success flag, correlation id if available, code, category, retryability, and details | 3.3A-UNIT-002/007-009/011/012/014/015/025; 3.3A-CONTRACT-038-042                                                                  |
| AC3 implemented provider command syntax with `--json` returns canonical command and tests fail on syntax/id drift                  | 3.3A-UNIT-001; 3.3A-CONTRACT-033-037; W-3.3A-001 for later runtime conversions                                                    |
| AC4 malformed JSON, schema mismatch, timeout, unexpected exit, and unexpected state allow fail-closed controller behavior          | 3.3A-UNIT-010/014-016/026-029; 3.3A-CONTRACT-038-042; 3.3A-CLI-043-046; W-3.3A-003 for actual runtime cancellation/timeout policy |

## High-Risk Traceability

| Risk       | Scenarios / waivers                                |
| ---------- | -------------------------------------------------- |
| 3.3A-R-001 | 3.3A-UNIT-001; 3.3A-CONTRACT-047                   |
| 3.3A-R-002 | 3.3A-UNIT-003-009                                  |
| 3.3A-R-003 | 3.3A-UNIT-002/007/014/025; 3.3A-CONTRACT-038-042   |
| 3.3A-R-004 | 3.3A-UNIT-020-032/054/055; 3.3A-CLI-043-045        |
| 3.3A-R-005 | 3.3A-UNIT-014/015; 3.3A-CONTRACT-038-042           |
| 3.3A-R-006 | 3.3A-CONTRACT-033-035                              |
| 3.3A-R-007 | 3.3A-UNIT-027/032                                  |
| 3.3A-R-008 | 3.3A-UNIT-017/018; 3.3A-CONTRACT-048               |
| 3.3A-R-009 | 3.3A-UNIT-010/029; 3.3A-CLI-043-046                |
| 3.3A-R-010 | 3.3A-UNIT-019; 3.3A-CI-050/052                     |
| 3.3A-R-011 | 3.3A-CONTRACT-036/048; 3.3A-CI-053/057; W-3.3A-002 |
| 3.3A-R-012 | 3.3A-UNIT-016; 3.3A-CI-049                         |
| 3.3A-R-013 | 3.3A-UNIT-011/012/056                              |
| 3.3A-R-014 | 3.3A-CONTRACT-033/037                              |
| 3.3A-R-015 | 3.3A-UNIT-030                                      |
| 3.3A-R-016 | 3.3A-UNIT-005/006/013                              |
| 3.3A-R-017 | 3.3A-CONTRACT-040; W-3.3A-003                      |

## Explicit Waivers

| ID         | Reason                                                                                                                                 | Owner                             | Residual risk                                                                                  | Follow-up trigger                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| W-3.3A-001 | Story 3.3a defines the shared helper and baseline only; runtime conversion of workflow command families belongs to Stories 3.3b-3.3d.  | Product + Archon CLI owner        | Future workflow commands may remain legacy JSON until their producer stories land.             | Story 3.3b, 3.3c, or 3.3d starts implementation.                              |
| W-3.3A-002 | Browser, HTTP API, server routes, web UI, event outbox, delivery health, and Hermes behavior are outside this CLI story.               | Product + architecture owners     | End-to-end consumer integration is not proven here.                                            | Approved story activates one of those surfaces.                               |
| W-3.3A-003 | The helper can represent timeout/cancel envelopes but does not define runtime timeout, abort-signal, or cancellation policy.           | CLI architecture owner            | A future runtime command may hang or cancel inconsistently until command policy is defined.    | Timeout SLO, abort-signal contract, or runtime command story is accepted.     |
| W-3.3A-004 | Current CLI helper runs under local OS-process trust and has no application-level auth/permission requirement.                         | Security owner                    | Local users with command access can invoke helper-backed commands according to existing trust. | Remote, multi-user, service-account, or role policy is introduced.            |
| W-3.3A-005 | Out-of-order event handling is not applicable because Story 3.3a has no event ingestion, ledger, outbox, or callback mutation surface. | Workflow event architecture owner | Event-order defects are not detected here.                                                     | Story 3.5, 3.7, or Hermes callback ingress activates event ordering behavior. |
| W-3.3A-006 | No performance/load threshold exists for local envelope construction.                                                                  | Product/operations owner          | Slow helper code has no numeric SLO gate beyond normal test/runtime feedback.                  | Latency SLO, remote exposure, or performance incident is accepted.            |

## Execution Strategy

- **PR:** Run all deterministic functional and contract tests: new helper tests, provider-binding unit/E2E/contract tests, `validate_contracts.py`, `bun --filter @archon/cli type-check`, and `bun run validate` before review.
- **Nightly:** If CI time becomes a concern, repeat subprocess JSON-purity and provider-binding regression tests for 20-50 iterations as burn-in.
- **Weekly:** No performance, browser, chaos, or live-service suite is required for this story.

Philosophy: run everything deterministic in PR; defer only expensive, long-running, or infrastructure-dependent checks.

## Resource Estimates

| Priority      |                    Count | Effort Range | Notes                                                                                         |
| ------------- | -----------------------: | ------------ | --------------------------------------------------------------------------------------------- |
| P0            |                       31 | ~18-30 hours | Helper invariants, fixture regressions, fail-closed contract examples, JSON purity.           |
| P1            |                       26 | ~18-34 hours | Static scope/dependency checks, parser boundaries, metadata, test isolation, rollback review. |
| P2/P3         |                        0 | ~0-4 hours   | No required lower-priority scenarios; waiver review only.                                     |
| Waiver review |                        6 | ~1-3 hours   | Owner/residual-risk confirmation.                                                             |
| Total         | 57 scenarios + 6 waivers | ~37-71 hours | Roughly 5-9 engineering days.                                                                 |

## Quality Gate Criteria

- P0 pass rate: 100%, with no skips or quarantine on P0 scenarios.
- P1 pass rate: 100% for deterministic helper, contract, and CLI regressions.
- Acceptance-criterion, high-risk, and reviewer-concern disposition coverage: 100% scenario-or-waiver traceability.
- Canonical contract validator passes unchanged.
- Provider-binding exact fixture comparisons pass with only documented dynamic exclusions.
- No forbidden fields, raw secrets, raw signing material, stdout/stderr body leakage, or Hermes-specific keys in helper output.
- No production import of `_bmad-output`, fixtures, schemas, or validator scripts.
- No new JSON Schema runtime dependency in `@archon/cli`.
- Test batching respects `mock.module()` isolation.
- File scope stays inside Story 3.3a boundaries.
- `bun --filter @archon/cli type-check` and `bun run validate` pass.
- NFR evidence source is identified for every in-scope NFR; final NFR status is deferred to `nfr-assess`.

## Mitigation Plans

| Risk       | Strategy                                                                       | Owner                                 | Verification                             |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------- |
| 3.3A-R-001 | Compare exported command constants to schema enum and run validator.           | CLI implementer + contract reviewer   | 3.3A-UNIT-001, 3.3A-CONTRACT-047         |
| 3.3A-R-002 | Test builder success/failure branches and reference requirements.              | CLI implementer                       | 3.3A-UNIT-003-009                        |
| 3.3A-R-003 | Make `retryable` required and cover every failure fixture.                     | CLI implementer + contract owner      | 3.3A-UNIT-007/014, 3.3A-CONTRACT-038-042 |
| 3.3A-R-004 | Preserve Story 3.1 fixture and subprocess behavior during refactor.            | Story 3.3a owner                      | 3.3A-UNIT-020-032, 3.3A-CLI-043-045      |
| 3.3A-R-006 | Lock provider syntax baseline and forbid legacy substitutions.                 | Architecture reviewer                 | 3.3A-CONTRACT-033-035                    |
| 3.3A-R-009 | Assert one JSON document and no log/prose leakage.                             | CLI implementer                       | 3.3A-UNIT-010/029, 3.3A-CLI-043-046      |
| 3.3A-R-012 | Scan output/source for forbidden keys and secrets.                             | Security reviewer                     | 3.3A-UNIT-016, 3.3A-CI-049               |
| 3.3A-R-014 | Build representative successes for all command families before future stories. | CLI implementer + future story owners | 3.3A-CONTRACT-033/037                    |

## Assumptions and Dependencies

### Assumptions

1. The checked-in Workflow Commander contract package remains the source of truth.
2. Provider-binding Story 3.1 behavior is accepted and must be preserved during helper extraction.
3. Future workflow runtime conversions will use the helper but are not implemented in Story 3.3a.
4. Local CLI trust remains OS-process based for this story.
5. Bun package-isolated test execution remains the CI source of truth.

### Dependencies

1. Parent Story 1.3a contract package and passing validator.
2. Accepted Story 3.1 provider-binding command implementation and tests.
3. Architecture and epics provider syntax baseline.
4. `packages/cli/package.json` test-script isolation model.

### Risks to Plan

- If schema enum and architecture syntax disagree, block implementation until the contract and planning artifacts are reconciled.
- If helper design requires a field absent from `workflow-command-envelope.schema.json`, raise a contract change instead of inventing runtime-only output.
- If provider-binding fixture equality fails after refactor, fix the helper/refactor before touching fixtures.
- If P0/P1 tests exceed PR runtime expectations, profile batching before moving deterministic tests out of PR.

## Interworking and Regression

| Service/Component                            | Impact                                                                  | Regression Scope                                           | Validation Steps                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `@archon/cli` provider-binding commands      | Local envelope helpers are extracted to shared module.                  | Provider-binding unit, contract, and subprocess E2E tests. | Run focused provider-binding tests and exact fixture comparisons. |
| `@archon/cli` workflow command docs/baseline | No runtime conversion yet, but syntax baseline is locked.               | Static baseline tests and scope review.                    | Run new helper/baseline test file.                                |
| Workflow Commander contract package          | Runtime output must conform; package must not be edited to fit runtime. | Canonical validator and contract package diff.             | Run `validate_contracts.py` and review diff.                      |
| CLI test scripts                             | New tests must respect Bun `mock.module()` process isolation.           | `packages/cli/package.json` script review.                 | Run package test script and focused helper test.                  |
| Future Stories 3.3b-3.3d                     | They depend on the helper and command baseline.                         | Representative workflow command helper tests.              | Run 3.3A-CONTRACT-033/037 before future stories start.            |

## Follow-on Workflows

- Run `*atdd` explicitly to generate failing P0 tests for the shared helper and provider-binding refactor.
- Run `*automate` explicitly after implementation exists for broader P1 automation.
- Run `nfr-assess` only after implementation evidence exists.

## Appendix

### Knowledge Base References

- `risk-governance.md`
- `probability-impact.md`
- `test-levels-framework.md`
- `test-priorities-matrix.md`
- `nfr-criteria.md`
- `contract-testing.md`
- `playwright-cli.md`
- `overview.md`
- `api-request.md`
- `auth-session.md`
- `recurse.md`

### Related Documents

- Story: `_bmad-output/implementation-artifacts/3-3a-define-shared-workflow-provider-command-envelope.md`
- PRD: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md`
- Architecture: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`
- Epics: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`
- Contract README: `_bmad-output/planning-artifacts/contracts/workflow-commander/README.md`
- Command schema: `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json`

**Generated by:** BMad TEA Agent - Master Test Architect
**Workflow:** `bmad-testarch-test-design`
