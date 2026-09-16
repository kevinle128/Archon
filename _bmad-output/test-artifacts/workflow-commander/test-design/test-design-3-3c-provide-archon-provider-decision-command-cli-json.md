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
lastSaved: '2026-07-19'
mode: 'epic-level'
epic: '3'
story: '3.3c'
status: 'draft'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3c-provide-archon-provider-decision-command-cli-json.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/approve-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/reject-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-malformed-request.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-unexpected-state.json'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.ts'
  - 'packages/cli/src/commands/workflow.test.ts'
  - 'packages/cli/src/commands/workflow-json.e2e.test.ts'
  - 'packages/cli/src/commands/workflow-command-contract.test.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.test.ts'
  - 'packages/cli/package.json'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/contract-testing.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/error-handling.md'
---

# Test Design: Epic 3 - Story 3.3c Provide Archon Provider Decision Command CLI JSON

**Date:** 2026-07-19
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for Story 3.3c, covering `archon workflow approve --json` and `archon workflow reject --json` as machine-readable provider command surfaces for external controllers.

This plan contains 50 atomic scenarios: 25 P0, 21 P1, and 5 P2.
Every acceptance criterion, high-risk item, and known reviewer concern maps to a scenario or an explicit waiver with owner, residual risk, and follow-up trigger.

**Risk summary:**

- 17 risks identified.
- 12 high-priority risks with score >= 6.
- Critical categories: BUS/controller contract, DATA decision integrity, TECH classifier and dispatch compatibility, SEC output redaction, OPS process boundaries.

**Effort summary:**

- P0 scenarios and harness changes: ~30-46 hours.
- P1 scenarios and classifier/pre-handler regression: ~24-38 hours.
- P2 documentation and boundary checks: ~5-9 hours.
- Total: ~59-93 hours, approximately 1.5-3 calendar weeks for one implementer depending on fixture reuse.

## Not in Scope

| Item                                                                                 | Reasoning                                                               | Mitigation                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `workflow resume`, `workflow retry-node`, and `workflow abandon` envelope conversion | Deferred to Story 3.3d/recovery-command work.                           | Keep existing tests passing; do not delete shared helpers still used by these commands.     |
| HTTP/Web UI decision APIs                                                            | Workflow Commander v1 is a CLI provider surface.                        | No new route tests; CLI subprocess tests cover the external controller boundary.            |
| Hermes authoritative human decision records                                          | Archon emits command acknowledgements only.                             | Assert `decision.outcome` and `decision.recorded`, and do not fabricate Hermes-only fields. |
| Pact broker publishing                                                               | This is an in-repo JSON schema contract, not a multi-service Pact lane. | Use existing `validate_contracts.py` and `workflow-command-contract.test.ts`.               |
| Performance/load benchmarking                                                        | No accepted SLO for local approve/reject command latency.               | Waiver W-006; add benchmark only if remote controller SLO is accepted.                      |

## Risk Assessment

Probability and Impact use 1-3.
Score = Probability x Impact.
Score >= 6 requires mitigation.
Priority is promoted to P0/P1 whenever failure can break core behavior, security, data integrity, compatibility, or a cross-process contract.

| ID    | Category | Risk                                                                                                                                               |   P |   I | Score | Pri | Mitigation / verification                                                                                                    | Owner / timeline                                          | Residual risk                                                                                             |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R-001 | BUS/TECH | Approve/reject JSON stays on legacy `{ ok: true }` shape or emits schema-invalid envelope.                                                         |   3 |   3 |     9 | P0  | Unit success tests, contract validation, forbidden-key scan.                                                                 | CLI implementer / Slices 1,2,5                            | Schema can still permit semantically weak `result`; scenario assertions close that gap.                   |
| R-002 | BUS/OPS  | JSON mode emits human text, multiple JSON lines, stderr diagnostics, or Pino logs.                                                                 |   3 |   3 |     9 | P0  | Unit stdout spy plus real subprocess tests asserting one stdout JSON line and empty stderr.                                  | CLI implementer / Slices 1-3                              | Process-level fatal crashes can still bypass handler output.                                              |
| R-003 | BUS/TECH | JSON errors escape to plain-text catch instead of fail-closed envelope.                                                                            |   3 |   3 |     9 | P0  | Inject approve/reject throws from all known operation, readback, and resolver paths.                                         | CLI implementer / Slices 1-4                              | Non-Error throws must be classified through `String(err)` fallback.                                       |
| R-004 | BUS/TECH | Pre-handler failures for missing run ID, blank `--correlation-id`, assigned `--json=true`, missing cwd, or non-git cwd bypass envelope generation. |   3 |   3 |     9 | P0  | `workflow-json.e2e.test.ts` real subprocess cases for each guard.                                                            | CLI dispatcher owner / Slice 3                            | ParseArgs positional consumption remains a documented CLI limitation.                                     |
| R-005 | TECH/BUS | `classifyRunError` under-matches decision errors or over-matches unrelated text.                                                                   |   2 |   3 |     6 | P1  | Positive and negative classifier unit tests; order checks before timeout fallback.                                           | CLI implementer / Slice 4                                 | Future operation messages can drift without test additions.                                               |
| R-006 | DATA/BUS | Post-decision readback fails after decision is already persisted, leading to false success or ambiguous controller retry.                          |   2 |   3 |     6 | P1  | Inject `workflowDb.getWorkflowRun` failure after successful approve/reject; assert `INTERNAL_ERROR` and no success envelope. | CLI implementer / Slices 1-2                              | Controller retry will see `UNEXPECTED_STATE`; residual ambiguity is unavoidable after committed mutation. |
| R-007 | DATA/BUS | Duplicate or concurrent approve/reject actions both report success or corrupt gate state.                                                          |   2 |   3 |     6 | P0  | Already-resolved and approve/reject race simulations mapped to `UNEXPECTED_STATE`.                                           | Core/CLI implementer / Slice 4 and regression             | Full cross-process race is approximated with CAS-result simulation in CLI tests.                          |
| R-008 | BUS/TECH | `correlationId` is not threaded to decision commands or is resolved outside the fail-closed try/catch.                                             |   2 |   3 |     6 | P1  | Unit function signature tests and E2E echo tests for approve/reject.                                                         | CLI dispatcher owner / Slices 1-3                         | Generated UUID format is not deterministic except type/shape.                                             |
| R-009 | BUS/DATA | `result` fields misrepresent decision state: wrong operation, outcome, `recorded`, `resumable`, `cancelled`, or `maxAttemptsReached`.              |   2 |   3 |     6 | P0  | Approve approval-gate and interactive-loop tests; reject cancelled/rework/max-attempt/write-back tests.                      | CLI implementer / Slices 1-2                              | State mapping can still be semantically awkward while DB status remains paused.                           |
| R-010 | BUS/OPS  | JSON approve/reject accidentally auto-resumes and streams workflow output.                                                                         |   2 |   3 |     6 | P0  | Assert `workflowRunCommand`/adapter is not called in JSON mode; subprocess output remains single envelope.                   | CLI implementer / Slices 1-2                              | Non-JSON path intentionally still auto-resumes.                                                           |
| R-011 | SEC/BUS  | Envelopes leak raw operation error messages, stack traces, stdout/stderr, actor/profile fields, or secrets.                                        |   2 |   3 |     6 | P0  | Recursive forbidden-key tests and details assertions on all error envelopes.                                                 | Security reviewer + CLI implementer / Slice 5             | Logs may contain redacted internal errors; stdout contract remains the release gate.                      |
| R-012 | BUS/TECH | `Workflow run not found` from short-id/full-id resolution falls to `INTERNAL_ERROR`.                                                               |   2 |   3 |     6 | P1  | Classifier and command tests assert `WORKFLOW_RUN_NOT_FOUND`/78.                                                             | CLI implementer / Slice 4                                 | Multiple-run ambiguity needs separate classification if its message differs.                              |
| R-013 | TECH/BUS | Fixture deltas are "fixed" by adding fake BMAD fields (`decision.gateId`, `nextPhase`) to Archon output.                                           |   2 |   2 |     4 | P1  | Contract tests assert schema validity and story-specific result fields, with waiver W-002 for omitted BMAD fields.           | Contract owner / Slice 5                                  | Future consumer may request richer generic gate refs.                                                     |
| R-014 | TECH/OPS | Shared envelope builder or start/status behavior regresses while adding approve/reject.                                                            |   2 |   3 |     6 | P1  | Run provider-envelope regression, start/status JSON tests, command contract tests.                                           | CLI implementer / Slice 6                                 | Shared classifier additions can affect future recovery commands.                                          |
| R-015 | OPS/TECH | Bun `mock.module()` pollution causes false green/red tests.                                                                                        |   3 |   2 |     6 | P1  | Keep tests inside existing isolated `@archon/cli` package invocations; no root `bun test`.                                   | Test implementer / Slice 5                                | New mock conflicts may require package script split.                                                      |
| R-016 | OPS/BUS  | Timeout or cancellation failure is not represented as a fail-closed envelope.                                                                      |   2 |   3 |     6 | P1  | Inject `ETIMEDOUT`/timeout message and assert `COMMAND_TIMEOUT`; cancellation is waived W-005.                               | CLI implementer / Slice 4                                 | There is no command-level cancellation control in this story.                                             |
| R-017 | SEC/OPS  | Missing permission/auth expectations cause overbuilt auth or accidental credential exposure.                                                       |   1 |   3 |     3 | P2  | Waiver W-004: local CLI inherits OS/process trust; assert no credential fields in envelopes.                                 | Product/security owner / before remote auth scope changes | Remote execution may need auth beyond this CLI surface.                                                   |

## Reviewer-Evidence Disposition

Known reviewer and retro-gate concerns are treated as evidence.
Each concern is a risk or explicit non-risk.

| Concern                                                                                                             | Disposition                                                       |   P |   I | Score | Scenario or waiver                  |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --: | --: | ----: | ----------------------------------- |
| RC-01 RF-09: resolve `correlationId` and `issuedAt` inside try/catch.                                               | Risk R-008; resolution failure must produce envelope.             |   2 |   3 |     6 | 3.3C-UNIT-017, 3.3C-UNIT-018        |
| RC-02 Approve JSON legacy shape must become `workflow.approve` envelope.                                            | Risk R-001.                                                       |   3 |   3 |     9 | 3.3C-UNIT-001, 3.3C-CONTRACT-001    |
| RC-03 Reject JSON legacy shape must become `workflow.reject` envelope.                                              | Risk R-001.                                                       |   3 |   3 |     9 | 3.3C-UNIT-004, 3.3C-CONTRACT-002    |
| RC-04 Exactly one JSON line and no human text in JSON mode.                                                         | Risk R-002.                                                       |   3 |   3 |     9 | 3.3C-UNIT-009, 3.3C-E2E-001         |
| RC-05 JSON mode must not auto-resume.                                                                               | Risk R-010.                                                       |   2 |   3 |     6 | 3.3C-UNIT-010, 3.3C-UNIT-011        |
| RC-06 Missing run ID currently prints usage text.                                                                   | Risk R-004.                                                       |   3 |   3 |     9 | 3.3C-E2E-002, 3.3C-E2E-003          |
| RC-07 Blank `--correlation-id` and bare value issues.                                                               | Risk R-004/R-008.                                                 |   3 |   3 |     9 | 3.3C-E2E-004, W-001                 |
| RC-08 `--json=true` must be malformed request.                                                                      | Risk R-004.                                                       |   3 |   3 |     9 | 3.3C-E2E-005                        |
| RC-09 Directory-not-found and not-a-git-repo pre-dispatch guards must cover approve/reject.                         | Risk R-004.                                                       |   3 |   3 |     9 | 3.3C-E2E-006, 3.3C-E2E-007          |
| RC-10 Pino/log output can corrupt stdout.                                                                           | Risk R-002.                                                       |   3 |   3 |     9 | 3.3C-E2E-001, 3.3C-E2E-008          |
| RC-11 Post-operation run fetch can fail after mutation commits.                                                     | Risk R-006.                                                       |   2 |   3 |     6 | 3.3C-UNIT-019, 3.3C-UNIT-020        |
| RC-12 Short-id run not found currently falls to internal error.                                                     | Risk R-012.                                                       |   2 |   3 |     6 | 3.3C-UNIT-021, 3.3C-UNIT-022        |
| RC-13 Concurrent approve/approve or approve/reject race.                                                            | Risk R-007.                                                       |   2 |   3 |     6 | 3.3C-UNIT-023, 3.3C-UNIT-024        |
| RC-14 Already-resolved, already-approved/rejected, awaiting-resume patterns must classify narrowly.                 | Risk R-005/R-007.                                                 |   2 |   3 |     6 | 3.3C-UNIT-025, 3.3C-UNIT-026        |
| RC-15 Wrong-status and missing-approval-context errors must classify as unexpected state.                           | Risk R-005.                                                       |   2 |   3 |     6 | 3.3C-UNIT-027, 3.3C-UNIT-028        |
| RC-16 Negative classifier tests must prove no broad "resolved" or generic "Workflow not found" match.               | Risk R-005.                                                       |   2 |   3 |     6 | 3.3C-UNIT-029, 3.3C-UNIT-030        |
| RC-17 Raw error messages must not leak to output details.                                                           | Risk R-011.                                                       |   2 |   3 |     6 | 3.3C-UNIT-031, 3.3C-CONTRACT-003    |
| RC-18 Forbidden keys must not appear.                                                                               | Risk R-011.                                                       |   2 |   3 |     6 | 3.3C-CONTRACT-003                   |
| RC-19 Approve success must include persisted run ref and mapped state.                                              | Risk R-001/R-009.                                                 |   3 |   3 |     9 | 3.3C-UNIT-001, 3.3C-UNIT-003        |
| RC-20 Reject success must represent cancelled/rework/max attempts/write-back correctly.                             | Risk R-009.                                                       |   2 |   3 |     6 | 3.3C-UNIT-004 through 3.3C-UNIT-008 |
| RC-21 BMAD fixture fields `decision.gateId` and `nextPhase` are intentionally omitted.                              | Explicit non-risk with compatibility documentation.               |   1 |   2 |     2 | W-002, 3.3C-CONTRACT-004            |
| RC-22 `printJsonWriteError` deletion must not break remaining callers.                                              | Risk R-014.                                                       |   2 |   3 |     6 | 3.3C-UNIT-032                       |
| RC-23 Start/status JSON and shared builder must not regress.                                                        | Risk R-014.                                                       |   2 |   3 |     6 | 3.3C-CI-002, 3.3C-CI-003            |
| RC-24 Test package isolation must be preserved.                                                                     | Risk R-015.                                                       |   3 |   2 |     6 | 3.3C-CI-004                         |
| RC-25 Timeout is listed in AC2 fail-closed conditions.                                                              | Risk R-016.                                                       |   2 |   3 |     6 | 3.3C-UNIT-033                       |
| RC-26 Cancellation and permission/auth are not new behavior in this story.                                          | Explicit non-risk under current local CLI boundary.               |   1 |   3 |     3 | W-004, W-005                        |
| RC-27 Out-of-order workflow events are not consumed by these commands, but duplicate/out-of-order decisions matter. | Risk only for duplicate decision ordering, not event consumption. |   2 |   3 |     6 | 3.3C-UNIT-023, 3.3C-UNIT-024        |
| RC-28 Rollback of partial implementation must be easy.                                                              | Risk R-014.                                                       |   2 |   2 |     4 | 3.3C-CI-005                         |

## NFR Planning

This section plans evidence only.
Final PASS/CONCERNS/FAIL decisions belong to `nfr-assess` after implementation evidence exists.

| NFR Category    | Requirement / threshold                                                                                                                      | Risk Link                         | Planned validation                                                           | Evidence needed                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Security        | No raw errors, stack traces, stdout/stderr, forbidden keys, secrets, profile/actor fields, or provider internals in envelopes.               | R-011, R-017                      | 3.3C-UNIT-031, 3.3C-CONTRACT-003, 3.3C-CI-001                                | Bun test output, recursive key scan, contract validation output.                      |
| Reliability     | Every known error, timeout, malformed input, unexpected state, dependency failure, and duplicate action emits one parseable envelope.        | R-002 through R-007, R-012, R-016 | Unit fault injection plus E2E subprocess tests.                              | `workflow.test.ts` and `workflow-json.e2e.test.ts` results.                           |
| Data integrity  | Approve/reject decisions are recorded once, never auto-resume in JSON mode, and retry after partial failure observes already-resolved state. | R-006, R-007, R-009, R-010        | CAS-result simulations, post-fetch-failure tests, no-auto-resume assertions. | Focused unit output and operation-layer regression output.                            |
| Compatibility   | Output validates against `workflow-command-envelope.v1` and preserves existing start/status and non-JSON approve/reject behavior.            | R-001, R-013, R-014               | Contract tests, shared builder regression, existing non-JSON tests.          | `validate_contracts.py`, `workflow-provider-command-envelope.test.ts`, package tests. |
| Performance     | UNKNOWN: no accepted latency or throughput threshold for local CLI decision commands.                                                        | W-006                             | No benchmark in this story.                                                  | Follow-up only if a remote controller SLO is accepted.                                |
| Maintainability | New tests stay in isolated package invocations and do not add speculative abstractions.                                                      | R-015                             | `packages/cli/package.json` test script verification and `bun run validate`. | CI logs and package script diff.                                                      |

## Entry Criteria

- Story 3.3c implementation artifact remains the source of truth for accepted scope and fixture deltas.
- Existing 3.3a shared envelope tests and 3.3b start/status JSON tests are green before changes.
- Contract schema and example fixtures under `_bmad-output/planning-artifacts/contracts/workflow-commander/` are not edited to fit runtime behavior.
- Test authors use package-isolated Bun commands, not root `bun test`.

## Exit Criteria

- 100% P0 scenario pass rate.
- P1 pass rate >= 95%; any remaining P1 failure requires a waiver with owner and expiry.
- No open high-priority risk without mitigation evidence or an approved waiver.
- Contract validator and focused CLI package checks pass.
- `bun run validate` passes before review.

## Test Coverage Plan

P0/P1/P2/P3 below are priority/risk classifications, not execution timing.
Avoid duplicate coverage unless the scenario validates a different boundary.

### P0 Scenarios

| Test ID           | Requirement / risk | Level          | Scenario                                                                                                                                                                                                                                                                    | Owner        | Notes                                                                                                    |
| ----------------- | ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| 3.3C-UNIT-001     | AC1, R-001, R-009  | Unit           | `workflowApproveCommand(..., json=true)` approval-gate success emits one `workflow.approve` success envelope with schemaVersion, command, success, workflowRunRef, `result.operation='approve'`, `decision.outcome='approved'`, `decision.recorded=true`, `resumable=true`. | Dev          | Use existing console spy pattern in `workflow.test.ts`; exclude dynamic `correlationId`/`issuedAt` only. |
| 3.3C-UNIT-002     | AC1, R-001, R-009  | Unit           | Approve interactive-loop success emits the same envelope contract and does not report gate-only semantics incorrectly.                                                                                                                                                      | Dev          | Covers story-required loop gate path.                                                                    |
| 3.3C-UNIT-003     | AC1, R-001, R-009  | Unit           | Approve success re-fetches persisted run and includes `workflowRunRef` built from the row, including projectRef when `codebase_id` exists.                                                                                                                                  | Dev          | Prevents using stale operation return data as contract authority.                                        |
| 3.3C-UNIT-004     | AC1, R-001, R-009  | Unit           | Reject cancelled success emits `workflow.reject`, `decision.outcome='rejected'`, `recorded=true`, `cancelled=true`, `resumable=false`.                                                                                                                                      | Dev          | Terminal reject with no `on_reject`.                                                                     |
| 3.3C-UNIT-005     | AC1, R-009         | Unit           | Reject rework success emits `cancelled=false`, `resumable=true`.                                                                                                                                                                                                            | Dev          | Covers `on_reject` rework.                                                                               |
| 3.3C-UNIT-006     | AC1, R-009         | Unit           | Reject max-attempts success emits `maxAttemptsReached=true`, `cancelled=true`, `resumable=false`.                                                                                                                                                                           | Dev          | Prevents false resumable state.                                                                          |
| 3.3C-UNIT-007     | AC1, R-009         | Unit           | Reject container write-back rejection emits `cancelled=false` and remains resumable where operation result says so.                                                                                                                                                         | Dev          | Uses existing write-back fixture if available; otherwise operation mock.                                 |
| 3.3C-UNIT-009     | AC1, R-002         | Unit           | Approve/reject JSON branches each call `console.log` exactly once with parseable JSON and never call `console.error`.                                                                                                                                                       | Dev          | Assert per command.                                                                                      |
| 3.3C-UNIT-010     | AC1, R-010         | Unit           | Approve JSON records decision and does not call `workflowRunCommand`, `CLIAdapter`, or resume path.                                                                                                                                                                         | Dev          | Existing legacy test should be upgraded to envelope shape.                                               |
| 3.3C-UNIT-011     | AC1, R-010         | Unit           | Reject JSON records decision and does not auto-resume even when `on_reject` rework exists.                                                                                                                                                                                  | Dev          | Prevent stdout stream corruption.                                                                        |
| 3.3C-UNIT-019     | AC2, R-006         | Unit           | Approve succeeds but post-approval `workflowDb.getWorkflowRun` throws; output is `INTERNAL_ERROR`/`implementation_defect`/70, not success.                                                                                                                                  | Dev          | Partial failure case.                                                                                    |
| 3.3C-UNIT-020     | AC2, R-006         | Unit           | Reject succeeds but post-rejection run fetch throws; output is `INTERNAL_ERROR`/`implementation_defect`/70, not success.                                                                                                                                                    | Dev          | Partial failure case.                                                                                    |
| 3.3C-UNIT-023     | AC2, R-007         | Unit           | Duplicate approve/already-resolved operation throw emits `UNEXPECTED_STATE`/`unexpected_state`/78.                                                                                                                                                                          | Dev          | Duplicate action.                                                                                        |
| 3.3C-UNIT-024     | AC2, R-007         | Unit           | Approve/reject race loser represented by `already rejected` or `already resolved` emits `UNEXPECTED_STATE`/78.                                                                                                                                                              | Dev          | Out-of-order duplicate decision case.                                                                    |
| 3.3C-UNIT-031     | AC2, R-011         | Unit           | Every approve/reject error envelope omits raw operation message and stack from `error.details`; details include only safe identifiers.                                                                                                                                      | Dev/Security | Security and contract surface.                                                                           |
| 3.3C-CONTRACT-001 | AC1, R-001         | Contract       | Emitted approve success envelope validates against `workflow-command-envelope.schema.json`.                                                                                                                                                                                 | Dev          | Existing contract helper or validator pattern.                                                           |
| 3.3C-CONTRACT-002 | AC1, R-001         | Contract       | Emitted reject success envelope validates against `workflow-command-envelope.schema.json`.                                                                                                                                                                                  | Dev          | Contract schema compliance.                                                                              |
| 3.3C-CONTRACT-003 | AC2, R-011         | Contract       | Recursive scan proves approve/reject envelopes contain no forbidden keys: `actor`, `profile`, `agent_name`, `agent`, `agent_provider`, `message`, `stdout`, `stderr`, `displayText`, `secret`.                                                                              | Dev/Security | Applies to success and error envelopes.                                                                  |
| 3.3C-E2E-001      | AC1/2, R-002       | E2E subprocess | Approve/reject `--json` failures emit exactly one parseable stdout line, empty stderr, and expected exit code.                                                                                                                                                              | Dev          | Real controller boundary.                                                                                |
| 3.3C-E2E-002      | AC2, R-004         | E2E subprocess | `archon workflow approve --json` without run ID emits `workflow.approve` `MALFORMED_REQUEST`/64, no usage text.                                                                                                                                                             | Dev          | Missing input.                                                                                           |
| 3.3C-E2E-003      | AC2, R-004         | E2E subprocess | `archon workflow reject --json` without run ID emits `workflow.reject` `MALFORMED_REQUEST`/64, no usage text.                                                                                                                                                               | Dev          | Missing input.                                                                                           |
| 3.3C-E2E-004      | AC2, R-004/R-008   | E2E subprocess | Approve/reject `--json --correlation-id=` emits `MALFORMED_REQUEST` with `/correlationId` field error.                                                                                                                                                                      | Dev          | Malformed input.                                                                                         |
| 3.3C-E2E-005      | AC2, R-004         | E2E subprocess | Approve/reject `--json=true` emits `MALFORMED_REQUEST` with `/json` field error.                                                                                                                                                                                            | Dev          | Malformed input.                                                                                         |
| 3.3C-E2E-008      | AC1/2, R-002       | E2E subprocess | Approve/reject JSON-mode failures stay silent under log-producing paths: no Pino lines, no usage prose, no extra stderr, exactly one stdout envelope.                                                                                                                       | Dev          | Log contamination regression.                                                                            |
| 3.3C-CI-001       | AC1/2, R-001/R-011 | CI/contract    | `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` passes without editing fixtures/schema.                                                                                                                                        | Dev          | Contract regression gate.                                                                                |

### P1 Scenarios

| Test ID       | Requirement / risk | Level          | Scenario                                                                                                                                            | Owner | Notes                             |
| ------------- | ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------- |
| 3.3C-UNIT-008 | AC1, R-009         | Unit           | Reject success maps current persisted `status`/`metadata` through `mapWorkflowRunToContractState` without contradicting result `decision.recorded`. | Dev   | Stale/current state boundary.     |
| 3.3C-UNIT-012 | AC2, R-003/R-005   | Unit           | Approve run not paused throws `Cannot approve run with status...` and emits `UNEXPECTED_STATE`/78.                                                  | Dev   | Negative path.                    |
| 3.3C-UNIT-013 | AC2, R-003/R-005   | Unit           | Reject run not paused throws `Cannot reject run with status...` and emits `UNEXPECTED_STATE`/78.                                                    | Dev   | Negative path.                    |
| 3.3C-UNIT-014 | AC2, R-003/R-005   | Unit           | Approve paused run missing approval context emits `UNEXPECTED_STATE`/78.                                                                            | Dev   | Malformed/stale DB state.         |
| 3.3C-UNIT-015 | AC2, R-003/R-005   | Unit           | Reject paused run missing approval context emits `UNEXPECTED_STATE`/78.                                                                             | Dev   | Malformed/stale DB state.         |
| 3.3C-UNIT-016 | AC2, R-003         | Unit           | Non-Error throw in JSON branch still emits a valid error envelope.                                                                                  | Dev   | Fail-closed catch boundary.       |
| 3.3C-UNIT-017 | AC2, R-008         | Unit           | Supplied `correlationId` is echoed by approve and reject envelopes.                                                                                 | Dev   | Direct command call.              |
| 3.3C-UNIT-018 | AC2, R-008         | Unit           | `resolveCorrelationId` or `resolveIssuedAt` failure inside JSON path is caught and converted to error envelope.                                     | Dev   | RF-09 regression.                 |
| 3.3C-UNIT-021 | AC2, R-012         | Unit           | Approve run not found from `resolveRunIdArg` emits `WORKFLOW_RUN_NOT_FOUND`/`unexpected_state`/78.                                                  | Dev   | Boundary id resolution.           |
| 3.3C-UNIT-022 | AC2, R-012         | Unit           | Reject run not found from `resolveRunIdArg` emits `WORKFLOW_RUN_NOT_FOUND`/`unexpected_state`/78.                                                   | Dev   | Boundary id resolution.           |
| 3.3C-UNIT-025 | AC2, R-005/R-007   | Unit           | Classifier maps `already resolved`, `already approved`, `already rejected`, and `awaiting resume` to `UNEXPECTED_STATE`/78.                         | Dev   | Positive classifier matrix.       |
| 3.3C-UNIT-026 | AC2, R-005         | Unit           | Classifier does not match generic prose containing `resolved` alone.                                                                                | Dev   | Overmatch guard.                  |
| 3.3C-UNIT-027 | AC2, R-005         | Unit           | Classifier maps `Cannot approve run with status` and `Cannot reject run with status` to `UNEXPECTED_STATE`/78.                                      | Dev   | Positive classifier matrix.       |
| 3.3C-UNIT-028 | AC2, R-005         | Unit           | Classifier maps `missing approval context` to `UNEXPECTED_STATE`/78.                                                                                | Dev   | Positive classifier matrix.       |
| 3.3C-UNIT-029 | AC2, R-005         | Unit           | Classifier does not map `Cannot resume run with status` to decision-command unexpected state.                                                       | Dev   | Recovery-command overmatch guard. |
| 3.3C-UNIT-030 | AC2, R-005/R-012   | Unit           | Classifier maps `Workflow run not found` but does not treat generic `Workflow not found` as run-not-found.                                          | Dev   | Specificity guard.                |
| 3.3C-UNIT-032 | R-014              | Unit           | `printJsonWriteError` is deleted only if no callers remain; otherwise compile/test proves remaining callers still work.                             | Dev   | Rollback/cleanup guard.           |
| 3.3C-UNIT-033 | AC2, R-016         | Unit           | Timeout-like error (`ETIMEDOUT`, `statement timeout`, or `timeout`) emits `COMMAND_TIMEOUT`/`timeout`/retryable true/124.                           | Dev   | Timeout case.                     |
| 3.3C-E2E-006  | AC2, R-004         | E2E subprocess | Approve/reject `--json --cwd /missing` emits `MALFORMED_REQUEST` `/cwd=directory_not_found`.                                                        | Dev   | Dependency/pre-handler failure.   |
| 3.3C-E2E-007  | AC2, R-004         | E2E subprocess | Approve/reject `--json --cwd <non-git>` emits `MALFORMED_REQUEST` `/cwd=not_a_git_repository`.                                                      | Dev   | Permission/environment guard.     |

### P2 Scenarios

| Test ID           | Requirement / risk | Level       | Scenario                                                                                                                                                                              | Owner          | Notes                        |
| ----------------- | ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------- |
| 3.3C-CONTRACT-004 | R-013              | Contract    | Document fixture delta: Archon intentionally omits BMAD-only `decision.gateId` and `nextPhase`; emitted output remains schema-valid.                                                  | Contract owner | Compatibility documentation. |
| 3.3C-CI-002       | R-014              | CI          | `bun test packages/cli/src/commands/workflow-provider-command-envelope.test.ts` passes unchanged.                                                                                     | Dev            | Shared builder regression.   |
| 3.3C-CI-003       | R-014              | CI          | Existing 3.3b start/status JSON tests in `workflow.test.ts` and `workflow-json.e2e.test.ts` pass after classifier changes.                                                            | Dev            | Regression.                  |
| 3.3C-CI-004       | R-015              | CI          | `packages/cli/package.json` keeps `workflow.test.ts`, `workflow-json.e2e.test.ts`, and `workflow-command-contract.test.ts` in isolated Bun invocations.                               | Dev/Test       | Mock pollution guard.        |
| 3.3C-CI-005       | R-014              | CI/rollback | Slice-level rollback remains possible: `bun --filter @archon/cli type-check`, focused CLI tests, and `bun run validate` pass without touching unrelated contracts or generated files. | Dev            | Rollback and release gate.   |

## Waiver Register

| Waiver | Requirement / concern                                              | Reason                                                                                                                                            | Owner                  | Residual risk                                                                    | Follow-up trigger                                                                    |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| W-001  | `--correlation-id <run-id>` positional consumption by `parseArgs`. | Existing `parseArgs` limitation; story instructs not to fix it. Missing run ID handler covers resulting state.                                    | CLI owner              | User can accidentally turn run ID into correlation ID and get malformed request. | Revisit if CLI parser is replaced or remote controller can generate this argv shape. |
| W-002  | Omit `decision.gateId` and `nextPhase` fixture fields.             | These are BMAD/Hermes concepts, not generic Archon provider command fields; schema allows additional result properties but does not require them. | Contract owner         | Future consumer may ask for richer gate reference.                               | Add generic gate contract if Hermes requires Archon-owned gate identity.             |
| W-003  | Out-of-order workflow event stream validation.                     | Approve/reject commands do not consume event streams; relevant ordering risk is duplicate decision action, covered by 3.3C-UNIT-023/024.          | Workflow owner         | Event delivery story could introduce separate ordering risks.                    | Story 3.5/event outbox implementation starts.                                        |
| W-004  | Permission/auth enforcement for local CLI invocation.              | This story is a local CLI provider surface; OS/process access is the trust boundary.                                                              | Product/security owner | A remote executor may need stronger auth around invoking this CLI.               | Remote multi-user command execution scope is accepted.                               |
| W-005  | Command cancellation behavior.                                     | No cancellation control is introduced for approve/reject JSON in this story; timeout classification is tested separately.                         | CLI architecture owner | A hung process may need external supervisor kill/timeout.                        | Workflow Commander accepts cancellation SLO or supervisor contract.                  |
| W-006  | Performance/load threshold.                                        | No latency/throughput requirement exists for local approve/reject commands.                                                                       | Product owner          | Slow commands could hurt remote controller UX if used at scale.                  | Accepted SLO or production telemetry shows decision command latency concerns.        |
| W-007  | Full cross-process race test with two real CLI processes.          | Unit-level CAS-result simulation covers the contract without making tests flaky or DB-heavy.                                                      | Test architect         | Real DB scheduling could expose timing not covered by mocks.                     | A production incident or flaky race is observed around decision gates.               |
| W-008  | Recovery-command envelope conversion.                              | Explicitly deferred outside Story 3.3c.                                                                                                           | Story owner            | Shared helper cleanup may be constrained by remaining legacy callers.            | Story 3.3d begins.                                                                   |

## Mandatory Traceability

### Acceptance Criteria

| AC                                                                                                                                                                       | Coverage or waiver                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1: Approve/reject accepted action returns parseable JSON consumable without human-readable output.                                                                     | 3.3C-UNIT-001 through 011, 3.3C-CONTRACT-001/002/003, 3.3C-E2E-001.                                                                                                                                                                                                      |
| AC2: Failures use shared workflow command envelope and consumers can fail closed on malformed JSON, schema mismatch, timeout, unexpected state, or unexpected exit code. | Malformed input: 3.3C-E2E-002 through 007. Schema mismatch/contract: 3.3C-CONTRACT-001 through 004, 3.3C-CI-001. Timeout: 3.3C-UNIT-033. Unexpected state: 3.3C-UNIT-012 through 015, 023 through 030. Unexpected exit code and stderr/stdout: 3.3C-E2E-001 through 007. |

### High-Risk Items

| Risk  | Coverage or waiver                                        |
| ----- | --------------------------------------------------------- |
| R-001 | 3.3C-UNIT-001/003/004, 3.3C-CONTRACT-001/002, 3.3C-CI-001 |
| R-002 | 3.3C-UNIT-009, 3.3C-E2E-001/008                           |
| R-003 | 3.3C-UNIT-012 through 016, 3.3C-UNIT-019/020              |
| R-004 | 3.3C-E2E-002 through 007, W-001                           |
| R-005 | 3.3C-UNIT-025 through 030                                 |
| R-006 | 3.3C-UNIT-019/020                                         |
| R-007 | 3.3C-UNIT-023/024, W-007                                  |
| R-008 | 3.3C-UNIT-017/018, 3.3C-E2E-004                           |
| R-009 | 3.3C-UNIT-001 through 008                                 |
| R-010 | 3.3C-UNIT-010/011                                         |
| R-011 | 3.3C-UNIT-031, 3.3C-CONTRACT-003                          |
| R-012 | 3.3C-UNIT-021/022/030                                     |
| R-013 | 3.3C-CONTRACT-004, W-002                                  |
| R-014 | 3.3C-UNIT-032, 3.3C-CI-002/003/005, W-008                 |
| R-015 | 3.3C-CI-004                                               |
| R-016 | 3.3C-UNIT-033, W-005                                      |
| R-017 | 3.3C-CONTRACT-003, W-004                                  |

### Scenario-Type Checklist

| Required type       | Scenario or waiver                                     |
| ------------------- | ------------------------------------------------------ |
| Happy path          | 3.3C-UNIT-001 through 008                              |
| Negative path       | 3.3C-UNIT-012 through 016, 021 through 030             |
| Boundary cases      | 3.3C-UNIT-021/022/030, 3.3C-E2E-002/003                |
| Malformed input     | 3.3C-E2E-002 through 007                               |
| Stale data          | 3.3C-UNIT-008, 014, 015, 023, 024                      |
| Duplicate actions   | 3.3C-UNIT-023/024                                      |
| Out-of-order events | W-003; out-of-order decisions covered by 3.3C-UNIT-024 |
| Partial failure     | 3.3C-UNIT-019/020                                      |
| Dependency failure  | 3.3C-E2E-006/007, 3.3C-UNIT-019/020                    |
| Timeout             | 3.3C-UNIT-033                                          |
| Cancellation        | W-005                                                  |
| Concurrency/race    | 3.3C-UNIT-023/024, W-007                               |
| Rollback            | 3.3C-UNIT-032, 3.3C-CI-005                             |
| Permission/auth     | W-004; output secrecy covered by 3.3C-CONTRACT-003     |
| Regression          | 3.3C-CI-002/003/004/005                                |

## Execution Strategy

Run everything in PRs unless it becomes expensive or flaky.
These CLI and contract tests should fit the existing `@archon/cli` package isolation model.

| Lane             | Contents                                                                                                                                                                                               | Expected timing                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| PR               | Focused `workflow.test.ts`, `workflow-json.e2e.test.ts`, `workflow-command-contract.test.ts`, `workflow-provider-command-envelope.test.ts`, `bun --filter @archon/cli type-check`, contract validator. | Target under 15 minutes with current isolated package scripts. |
| Nightly          | Full `bun run validate` if not run on every PR branch, plus repeated focused CLI tests if race flakiness appears.                                                                                      | Standard repo gate.                                            |
| Weekly/on demand | Burn-in/repeated subprocess tests for decision-command races if a real cross-process race test is later added.                                                                                         | Only if W-007 is reopened.                                     |

## Resource Estimates

| Priority | Count | Effort range | Notes                                                                                       |
| -------- | ----: | ------------ | ------------------------------------------------------------------------------------------- |
| P0       |    25 | ~30-46 hours | Contract conversion, subprocess harness, partial failure, no-auto-resume, forbidden output. |
| P1       |    21 | ~24-38 hours | Classifier matrix, pre-handler dependency failures, timeout, regression.                    |
| P2       |     5 | ~5-9 hours   | Fixture-delta documentation and CI/package-script checks.                                   |
| Total    |    50 | ~59-93 hours | Wider range reflects fault-injection and test isolation uncertainty.                        |

## Quality Gate Criteria

- P0 pass rate: 100%.
- P1 pass rate: >= 95%; any failure needs explicit waiver before review.
- All high-risk mitigations either complete or waived with owner and follow-up trigger.
- Contract validator passes without changing schema/examples to match implementation.
- No raw prose, stack traces, stderr diagnostics, Pino logs, or forbidden keys in JSON-mode controller output.
- `bun run validate` passes before review.

## Mitigation Plans

### R-001/R-002/R-003: Controller Contract Integrity

**Strategy:**

1. Convert approve/reject JSON branches to shared success/error envelope builders.
2. Resolve dynamic metadata inside the try/catch.
3. Assert exactly one stdout JSON line for unit and subprocess boundaries.
4. Validate emitted envelopes against schema and forbidden-key scans.

**Owner:** CLI implementer
**Timeline:** Slices 1, 2, 3, and 5
**Status:** Planned
**Verification:** 3.3C-UNIT-001 through 016, 3.3C-CONTRACT-001 through 003, 3.3C-E2E-001 through 005.

### R-004/R-005/R-012/R-016: Failure Classification and Pre-Handler Boundaries

**Strategy:**

1. Expand `getWorkflowCommandEnvelopeCommand` for approve/reject.
2. Add missing run ID JSON-mode envelope handling.
3. Add narrow classifier patterns and negative overmatch tests.
4. Exercise timeout and cwd/git guard behavior.

**Owner:** CLI dispatcher owner
**Timeline:** Slices 3 and 4
**Status:** Planned
**Verification:** 3.3C-UNIT-021 through 033 and 3.3C-E2E-002 through 007.

### R-006/R-007/R-009/R-010: Decision Integrity

**Strategy:**

1. Fetch persisted run after successful operation for contract state.
2. Fail closed on readback failure.
3. Assert duplicate/race losers map to `UNEXPECTED_STATE`.
4. Keep JSON mode from auto-resuming.

**Owner:** Core/CLI implementer
**Timeline:** Slices 1, 2, and 4
**Status:** Planned
**Verification:** 3.3C-UNIT-003 through 011, 019, 020, 023, 024.

## Assumptions and Dependencies

### Assumptions

1. The shared envelope schema remains authoritative and is not edited for this story.
2. The only intended external consumer is a controller that parses stdout and exit code.
3. JSON approve/reject do not auto-resume by design; controller drives resume separately.
4. Existing operation-layer CAS behavior for approval gates remains the data-integrity authority.

### Dependencies

1. Existing test doubles in `workflow.test.ts` can mock `approveWorkflow`, `rejectWorkflow`, `workflowDb.getWorkflowRun`, and `resolveRunIdArg`-reachable behavior.
2. `workflow-json.e2e.test.ts` real subprocess harness remains available for CLI pre-dispatch checks.
3. `packages/cli/package.json` continues to isolate test files to avoid Bun mock pollution.

## Interworking and Regression

| Service/Component                       | Impact                                                          | Regression Scope                                                             |
| --------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/cli/src/commands/workflow.ts` | JSON approve/reject output changes; non-JSON must be unchanged. | Focused workflow tests, no-auto-resume tests, non-JSON approve/reject tests. |
| `packages/cli/src/cli.ts`               | Pre-dispatch JSON envelope guards expand to approve/reject.     | Real subprocess malformed-input/cwd/git tests.                               |
| `workflow-provider-command-envelope.ts` | Shared builder consumed by approve/reject.                      | Provider-envelope regression and schema enum checks.                         |
| Workflow operation layer                | Approve/reject state and CAS errors are formatted by CLI.       | Existing `workflow-operations.test.ts` plus CLI error mapping tests.         |
| External controller/Hermes              | Consumes parseable stdout envelope instead of legacy shape.     | Contract validation and forbidden-output checks.                             |

## Follow-on Workflows

- Run `bmad-testarch-atdd` for P0 red-phase scaffolds if implementation has not started.
- Run `bmad-testarch-automate` if the team wants these scenarios generated directly into repo tests.
- Run `nfr-assess` after implementation evidence exists.

## Appendix: Knowledge Base References

- `risk-governance.md`
- `probability-impact.md`
- `test-levels-framework.md`
- `test-priorities-matrix.md`
- `nfr-criteria.md`
- `contract-testing.md`
- `error-handling.md`

**Generated by:** BMad TEA Agent - Test Architect Module
**Workflow:** `bmad-testarch-test-design`
