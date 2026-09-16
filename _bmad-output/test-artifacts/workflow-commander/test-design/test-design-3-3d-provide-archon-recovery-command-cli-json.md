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
lastSaved: '2026-07-20'
mode: 'epic-level'
epic: '3'
story: '3.3d'
status: 'draft'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3d-provide-archon-recovery-command-cli-json.md'
  - '_bmad-output/implementation-artifacts/epic-3-partial-retro-2026-07-16.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/story-decisions/3-3d-provide-archon-recovery-command-cli-json/technical-decisions.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/specs/spec-route-loop-routing/runtime-contract.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/README.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/resume-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/retry-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/retry-node-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/cancel-success.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-malformed-request.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-unexpected-state.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-timeout.json'
  - '_bmad-output/test-artifacts/workflow-commander/test-design/test-design-3-3c-provide-archon-provider-decision-command-cli-json.md'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.ts'
  - 'packages/cli/src/commands/workflow.test.ts'
  - 'packages/cli/src/commands/workflow-json.e2e.test.ts'
  - 'packages/cli/src/commands/workflow-command-contract.test.ts'
  - 'packages/cli/src/commands/workflow-provider-command-envelope.test.ts'
  - 'packages/cli/package.json'
  - 'packages/core/src/operations/workflow-operations.ts'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
---

# Test Design: Epic 3 - Story 3.3d Provide Archon Recovery Command CLI JSON

**Date:** 2026-07-20
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for Story 3.3d, covering `archon workflow resume --json`, `archon workflow retry [--node] --json`, and `archon workflow cancel --json` as parseable recovery-command producer surfaces for external controllers.

This plan contains 84 atomic scenarios: 49 P0, 28 P1, 7 P2/P3.
Every acceptance criterion, high-risk item, and known reviewer or retro concern maps to a scenario or an explicit waiver with owner, residual risk, and follow-up trigger.

**Risk summary:**

- 20 risks identified.
- 18 high-priority risks with score >= 6.
- Critical categories: BUS/controller compatibility, DATA lifecycle integrity, TECH command dispatch and classifier correctness, SEC output redaction, OPS cross-process and subprocess boundaries.

**Effort summary:**

- P0 scenarios and harness work: ~56-92 hours.
- P1 scenarios and regression coverage: ~30-50 hours.
- P2/P3 scans, documentation, and waivers: ~6-12 hours.
- Total: ~92-154 hours, approximately 2.5-5 calendar weeks for one implementer depending on subprocess fixture reuse and detached-worker flakiness.

## Not in Scope

| Item                                                                                                     | Reasoning                                                                                  | Mitigation                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Hermes consumer implementation for empty output, schema mismatch, external timeout, and uncatchable exit | Story 3.3d is the Archon producer surface; Hermes Story 3.4c owns consumer classification. | Add Archon absence/regression checks and waiver W-001 with downstream trigger.                        |
| Non-JSON human aliases for `workflow retry` and `workflow cancel`                                        | TD-009 limits the new spellings to JSON provider use.                                      | Test usage guidance and preserve `retry-node` and `abandon`.                                          |
| New HTTP or Web UI recovery route                                                                        | PRD FR-8 and TD-N03 define CLI-only Workflow Commander v1 control.                         | No server/web tests; retry worker reuses existing core/UI retry semantics from persisted run context. |
| Performance/load benchmarking for local commands                                                         | No accepted latency or throughput SLO exists for local CLI recovery commands.              | Waiver W-003; add SLO tests if a controller latency budget is accepted.                               |
| PostgreSQL-specific cancellation SQL validation                                                          | Story 3.3d does not change DB schema or SQL; it calls existing `cancelWorkflowRun`.        | SQLite subprocess proof plus existing DB CAS tests are sufficient unless `cancelWorkflowRun` changes. |

## Risk Assessment

Probability and Impact use 1-3.
Score = Probability x Impact.
Score >= 6 requires mitigation.
Priority is promoted to P0/P1 whenever failure can break core behavior, security, data integrity, compatibility, or a cross-process contract.

| ID    | Category  | Risk                                                                                                                                                                      |   P |   I | Score | Pri | Mitigation / verification                                                                                                           | Owner / timeline                                | Residual risk                                                                             |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R-001 | BUS/TECH  | Recovery subcommands are not wired into the shared pre-handler envelope dispatcher, so missing args or parse failures emit usage text or unknown-subcommand output.       |   3 |   3 |     9 | P0  | Extend command map for resume/retry/cancel and add real subprocess malformed-input tests.                                           | CLI dispatcher owner / Slice 1                  | Future subcommands can repeat the gap if not added to the dispatcher map.                 |
| R-002 | BUS/TECH  | `resume --json` keeps the legacy `{ ok }` shape instead of the shared `workflow.resume` envelope.                                                                         |   3 |   3 |     9 | P0  | Unit, contract, and E2E schema checks against `resume-success.json`.                                                                | CLI implementer / Slice 2                       | Result object is schema-open, so field-specific assertions remain necessary.              |
| R-003 | DATA/BUS  | Resume JSON mutates run state, timestamps, retry state, workflow events, checkout, or dispatches inline execution.                                                        |   2 |   3 |     6 | P0  | Validate-only unit and subprocess no-side-effect tests.                                                                             | CLI implementer / Slice 2                       | Full checkout mutation is easiest to prove through fixture state snapshots.               |
| R-004 | BUS/OPS   | Whole-run retry reports worker-derived running/resumed/attempt state or waits for execution instead of dispatching a detached exact-run worker.                           |   2 |   3 |     6 | P0  | Spawn-mocked unit tests plus E2E immediate ack and later status poll.                                                               | CLI implementer / Slice 3                       | Post-spawn worker outcomes remain asynchronous by design.                                 |
| R-005 | DATA/TECH | Whole-run retry child argv recursively invokes `workflow retry` or uses the parent argv instead of explicit `workflow resume <run-id>`.                                   |   2 |   3 |     6 | P0  | Pure argv-builder tests for dev and binary forms; subprocess log/status confirmation.                                               | CLI implementer / Slice 3                       | Binary branch is only partially reachable without build artifact tests.                   |
| R-006 | DATA/TECH | Targeted retry parent performs node validation/preparation or emits retry epoch, safety refs, invalidated nodes, or execution state before the worker owns them.          |   2 |   3 |     6 | P0  | Unit checks for dispatch-only result and worker-only validation/preparation calls.                                                  | CLI/core retry owner / Slice 4                  | Worker logs/status are required to diagnose later failures.                               |
| R-007 | DATA/TECH | Targeted retry child argv does not preserve exact run and requested node or invokes `retry-node --json`, corrupting the worker contract.                                  |   2 |   3 |     6 | P0  | Pure argv-builder tests and E2E targeted payload assertion.                                                                         | CLI implementer / Slice 4                       | Node validation can still fail later, by design.                                          |
| R-008 | DATA/OPS  | Retry worker uses caller cwd as an authorization/path boundary instead of persisted run codebase and working path.                                                        |   2 |   3 |     6 | P0  | Different-cwd E2E dispatch followed by worker outcome proving persisted path use.                                                   | CLI implementer / Slice 3-4                     | Local CLI still inherits OS/process authority.                                            |
| R-009 | DATA/OPS  | Concurrent retry dispatches result in duplicate execution rather than one worker winning claim and others surfacing later outcome only.                                   |   2 |   3 |     6 | P0  | Race test with two parent retry commands and deterministic worker status/event proof.                                               | Workflow retry owner / Slice 3-4                | Real process races can be timing-sensitive; use deterministic slow node.                  |
| R-010 | DATA/OPS  | Cancel uses `abandonWorkflow`, reports stale `previousState`, reports legacy `abandon`, waits for cleanup, or succeeds after a lost CAS race.                             |   2 |   3 |     6 | P0  | Direct `cancelWorkflowRun` mock tests, CAS-loser test, E2E status verification.                                                     | CLI/workflow store owner / Slice 5              | Container cleanup remains eventual.                                                       |
| R-011 | BUS/SEC   | JSON mode emits human text, multiple stdout lines, Pino output, stack traces, raw stderr, or forbidden fields.                                                            |   3 |   3 |     9 | P0  | Parse sole stdout line, require empty stderr, scan forbidden keys recursively.                                                      | CLI implementer + security reviewer / Slice 1-6 | Uncatchable process crashes remain consumer-owned.                                        |
| R-012 | BUS/TECH  | Recovery typed-cause mapping under-covers state, run-not-found, CAS loss, retryability, timeout, database, and spawn failures.                                            |   2 |   3 |     6 | P1  | Positive and negative typed-cause matrix with exit-code assertions plus prose non-classification tests.                             | CLI implementer / Slice 2-5                     | Recovery categories must never depend on English error text.                              |
| R-013 | BUS/TECH  | Malformed argv surfaces bypass envelopes: missing run id, missing node id, blank/bare correlation id, assigned `--json=value`, flags after `--`, bad cwd, or non-git cwd. |   3 |   3 |     9 | P0  | Real subprocess tests for each recovery command and guard.                                                                          | CLI dispatcher owner / Slice 1                  | `parseArgs` positional behavior remains a known parser limitation.                        |
| R-014 | BUS/TECH  | Contract fixtures or validator drift from runtime output, especially because `result` is schema-open.                                                                     |   2 |   3 |     6 | P0  | Canonical fixture validator, runtime envelope helper, and semantic field assertions.                                                | Contract owner / Slice 6                        | Schema-open result objects require story-specific tests forever.                          |
| R-015 | SEC/BUS   | Error details leak secrets, raw paths, stdout/stderr, actor/profile/agent fields, or unredacted internal messages.                                                        |   2 |   3 |     6 | P0  | Forbidden-key scan plus details assertions on every failure class.                                                                  | Security reviewer / Slice 6                     | Internal logs may contain redacted diagnostics; stdout is the contract boundary.          |
| R-016 | DATA/BUS  | Partial failure after spawn, DB lookup, cancellation, or worker preparation is misrepresented as parent success or parent failure at the wrong boundary.                  |   2 |   3 |     6 | P0  | Spawn-fail parent failure, post-spawn worker failure observation, cancel CAS false tests.                                           | CLI/core retry owner / Slice 3-5                | Parent cannot retroactively report child outcomes after success.                          |
| R-017 | OPS/BUS   | Internal timeout and cancellation boundaries are conflated with Hermes consumer timeouts or process kills.                                                                |   2 |   3 |     6 | P1  | Caught timeout unit tests expect `COMMAND_TIMEOUT` and exit 69; consumer timeout waived to Hermes.                                  | CLI owner / Slice 5-6                           | Generic timeout fixture has nullable exit code, so Archon-specific assertion is required. |
| R-018 | BUS/TECH  | Legacy non-JSON `resume`, `retry-node`, and `abandon` behavior regresses while adding provider JSON spellings.                                                            |   2 |   3 |     6 | P1  | Regression tests preserve existing human output and `retry-node` streaming behavior.                                                | CLI maintainer / Slice 6                        | Future deprecation would need a separate accepted story.                                  |
| R-019 | TECH/OPS  | Bun `mock.module()` pollution or vacuous mocks hide runtime subprocess failures.                                                                                          |   3 |   2 |     6 | P1  | Keep tests in package-isolated invocations; real subprocess E2E uses isolated `ARCHON_HOME`, SQLite, temp git repo, and no network. | Test implementer / Slice 6                      | New conflicting mocks may require an additional package script batch.                     |
| R-020 | DATA/TECH | Resume or targeted retry breaks route-loop counters, activation state, or rerun path restrictions.                                                                        |   2 |   3 |     6 | P0  | Route-loop fixture tests assert resume preserves counters and targeted retry uses source-path semantics, not controller retry.      | Workflow engine owner / Slice 4-6               | Deep route-loop failures may be easier to catch in workflow engine tests than CLI tests.  |

## Reviewer-Evidence Disposition

Known reviewer, decision-gate, and retro concerns are treated as evidence.
Each concern is converted into a risk or an explicit non-risk with rationale.

| Concern                                                                                                                                                                                 | Disposition                                                                                   |   P |   I | Score | Scenario or waiver                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --: | --: | ----: | ------------------------------------------- |
| RC-01: Pre-handler envelope coverage from 3.3b R-F1 through R-F10 is critical for parseArgs, missing args, blank correlation id, bad cwd, and git guards.                               | Risk R-001/R-013.                                                                             |   3 |   3 |     9 | 3.3D-E2E-001 through 018                    |
| RC-02: JSON mode must not auto-resume or auto-execute because streaming output corrupts stdout.                                                                                         | Risk R-003/R-004/R-006/R-011.                                                                 |   2 |   3 |     6 | 3.3D-UNIT-006, 3.3D-UNIT-019, 3.3D-UNIT-028 |
| RC-03: Recovery errors need stable categories without extending shared English-message matching.                                                                                        | Risk R-012.                                                                                   |   2 |   3 |     6 | 3.3D-UNIT-046 through 052                   |
| RC-04: `printJsonWriteError` is legacy and must be deleted or intentionally left only for legacy callers.                                                                               | Risk R-002/R-016/R-018.                                                                       |   2 |   3 |     6 | 3.3D-UNIT-053, 3.3D-REG-003                 |
| RC-05: Correlation-id edge cases must not bypass the envelope path.                                                                                                                     | Risk R-013.                                                                                   |   3 |   3 |     9 | 3.3D-E2E-010 through 015                    |
| RC-06: Runtime schema validation must validate emitted envelopes, not just static examples.                                                                                             | Risk R-014/R-019.                                                                             |   2 |   3 |     6 | 3.3D-CONTRACT-005 through 008               |
| RC-07: `mapWorkflowRunToContractState` uses `isGateResolved`; resume must distinguish paused, waiting-for-approval, and failed state semantics.                                         | Risk R-003.                                                                                   |   2 |   3 |     6 | 3.3D-UNIT-007                               |
| RC-08: Retro gate required contract fixtures, parser boundaries, stdout/stderr rules, DB edge cases, classifiers, raw flag parsing, negative tests, and policy decisions before coding. | Risks R-001 through R-020.                                                                    |   3 |   3 |     9 | Full matrix plus traceability tables        |
| RC-09: Canonical command names win over legacy `abandon` and `retry-node` shapes.                                                                                                       | Risk R-010/R-018.                                                                             |   2 |   3 |     6 | 3.3D-CONTRACT-009, 3.3D-REG-001 through 003 |
| RC-10: Current runtime has no `workflow retry` or `workflow cancel`, and `resume --json` missing id emits usage text.                                                                   | Risk R-001/R-002.                                                                             |   3 |   3 |     9 | 3.3D-E2E-001 through 003, 3.3D-UNIT-001     |
| RC-11: Whole-run retry result must be dispatch-only and omit running state, resumed state, and attempt fields.                                                                          | Risk R-004.                                                                                   |   2 |   3 |     6 | 3.3D-UNIT-017 through 020, 3.3D-E2E-019     |
| RC-12: Targeted retry result must be dispatch-only and omit worker-derived validation, epoch, reset, safety, and execution fields.                                                      | Risk R-006/R-007.                                                                             |   2 |   3 |     6 | 3.3D-UNIT-026 through 030, 3.3D-E2E-020     |
| RC-13: Retry worker must derive persisted run codebase and working path; caller cwd matching is an explicit non-requirement.                                                            | Risk R-008.                                                                                   |   2 |   3 |     6 | 3.3D-E2E-022, W-002                         |
| RC-14: Retry duplicate dispatches can both ack parent success, but only one worker may claim and execute.                                                                               | Risk R-009.                                                                                   |   2 |   3 |     6 | 3.3D-E2E-023, 3.3D-UNIT-031                 |
| RC-15: Cancel success is the durable CAS transition only and must omit previous state and cleanup/quiescence requirements.                                                              | Risk R-010/R-016.                                                                             |   2 |   3 |     6 | 3.3D-UNIT-035 through 041, 3.3D-E2E-024     |
| RC-16: Cancel CAS loser or ineligible state returns `UNEXPECTED_STATE`.                                                                                                                 | Risk R-010/R-012.                                                                             |   2 |   3 |     6 | 3.3D-UNIT-038 through 040                   |
| RC-17: Archon owns caught producer failures; Hermes owns empty output, malformed or schema-invalid output, external timeout, and uncatchable exit.                                      | Risk R-017.                                                                                   |   2 |   3 |     6 | 3.3D-SCAN-001, W-001                        |
| RC-18: Parent mapping must cover malformed request, unexpected state, caught timeout, internal error, and non-retryability.                                                             | Risk R-012/R-017.                                                                             |   2 |   3 |     6 | 3.3D-UNIT-046 through 052                   |
| RC-19: `stdoutRedacted: true` and `stderrRedacted: true` must appear in error execution blocks and details must stay structured.                                                        | Risk R-011/R-015.                                                                             |   2 |   3 |     6 | 3.3D-CONTRACT-010, 3.3D-UNIT-054            |
| RC-20: New retry/cancel spellings are JSON-only; non-JSON guidance points to `retry-node` or `abandon`.                                                                                 | Risk R-018.                                                                                   |   2 |   3 |     6 | 3.3D-REG-001, 3.3D-REG-002                  |
| RC-21: Route-loop runtime contract says resume and retry preserve counters and activation state; targeted retry should retry the source path, not the controller.                       | Risk R-020.                                                                                   |   2 |   3 |     6 | 3.3D-WF-001, 3.3D-WF-002                    |
| RC-22: The story has no implementation review yet, so review findings recorded without ownership triage is an explicit non-risk at planning time.                                       | Non-risk. No findings exist yet; mandatory concern mapping remains enforced in this document. |   1 |   1 |     1 | W-006                                       |

## NFR Planning

This story has NFR implications for security, reliability, maintainability, and compatibility.
No final NFR PASS/CONCERNS/FAIL decision is made here; that belongs to a later evidence assessment.

| NFR Category    | Requirement / Threshold                                                                                                                | Risk Link                         | Planned Validation                                                                                                                    | Evidence Needed                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Security        | No secrets, raw stdout/stderr, actor/profile/agent fields, stack traces, or unredacted internal messages appear in JSON envelopes.     | R-011, R-015                      | Forbidden-key recursive scan and failure-envelope detail assertions.                                                                  | `workflow-command-contract.test.ts` and `workflow.test.ts` reports.               |
| Reliability     | Every caught JSON-mode recovery result emits exactly one stdout JSON line, stable success/error shape, and matching process exit code. | R-001, R-011, R-012, R-017        | Real subprocess E2E with isolated `ARCHON_HOME`, SQLite, temp git repo, separate stdout/stderr capture.                               | `workflow-json.e2e.test.ts` output and parsed envelopes.                          |
| Data integrity  | Resume is read-only; retry parent is dispatch-only; cancel mutates only after CAS winner.                                              | R-003, R-009, R-010, R-016, R-020 | No-side-effect snapshots, CAS false tests, worker claim/race tests, route-loop preservation tests.                                    | Unit mocks, SQLite status checks, workflow events/status poll.                    |
| Compatibility   | Runtime output matches shared Workflow Commander envelope fixtures and canonical command names.                                        | R-002, R-004, R-006, R-014, R-018 | Static validator plus emitted-runtime validator and semantic field assertions.                                                        | `validate_contracts.py`, `validate_runtime_envelope.py`, contract tests.          |
| Maintainability | Test isolation prevents Bun mock pollution and avoids root `bun test`.                                                                 | R-019                             | Keep `workflow.test.ts`, `workflow-json.e2e.test.ts`, and `workflow-command-contract.test.ts` in isolated package script invocations. | `packages/cli/package.json`, `bun --filter @archon/cli test`, `bun run validate`. |
| Performance     | UNKNOWN. No accepted local CLI recovery-command latency SLO.                                                                           | W-003                             | Not planned for this story.                                                                                                           | Add only when a controller latency SLO is accepted.                               |

**Unknown thresholds:** Recovery-command latency and detached-worker claim latency have no accepted threshold.
They are not guessed.

## Entry Criteria

- [ ] Story 3.3d implementation artifact and technical decisions remain the source of truth.
- [ ] Canonical recovery fixtures exist and pass `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`.
- [ ] Test harness can run focused CLI unit tests and real subprocess E2E with isolated `ARCHON_HOME`, SQLite, temp git repo, and no network.
- [ ] Existing non-JSON recovery command behavior is documented before implementation changes.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] P1 pass rate is >= 95%; every failing P1 has a documented waiver.
- [ ] No unmitigated score >= 6 risk remains.
- [ ] All recovery success and error envelopes validate against the shared schema and story-specific semantic assertions.
- [ ] `bun run validate` passes before review.

## Test Coverage Plan

P0/P1/P2/P3 are priority and risk, not execution timing.
Execution timing is defined separately in the Execution Strategy.

### P0 Scenarios

| Test ID           | Requirement / risk    | Level                | Scenario                                                                                                                                                                                                                                     | Owner             | Notes                                           |
| ----------------- | --------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------- |
| 3.3D-UNIT-001     | AC1, R-002            | Unit                 | `workflowResumeCommand(<paused>, true)` emits `workflow.resume` success envelope with `operation: resume`, unchanged `state: paused`, `validated: true`, `resumable: true`, `executed: false`, and `workflowRunRef`.                         | Dev               | Replaces legacy `{ ok }`.                       |
| 3.3D-UNIT-002     | AC1, R-002            | Unit                 | `workflowResumeCommand(<failed>, true)` emits the same validate-only success envelope with `state: failed` and `executed: false`.                                                                                                            | Dev               | Failed is resumable by core operation.          |
| 3.3D-UNIT-003     | AC1, R-003/R-012      | Unit                 | Completed run on resume JSON returns `UNEXPECTED_STATE`, exit 78, retryable false, and no mutation.                                                                                                                                          | Dev               | Negative state.                                 |
| 3.3D-UNIT-004     | AC1, R-003/R-012      | Unit                 | Cancelled run on resume JSON returns `UNEXPECTED_STATE`, exit 78, retryable false, and no mutation.                                                                                                                                          | Dev               | Negative state.                                 |
| 3.3D-UNIT-005     | AC1, R-003/R-012      | Unit                 | Running run on resume JSON returns `UNEXPECTED_STATE`, exit 78, retryable false, and no mutation.                                                                                                                                            | Dev               | Negative state.                                 |
| 3.3D-UNIT-006     | AC1, R-003/R-011      | Unit                 | Resume JSON does not call `workflowRunCommand`, `executeWorkflow`, detached spawn, checkpoint reset, event creation, or status update.                                                                                                       | Dev               | Prevents inline execution and stdout streaming. |
| 3.3D-UNIT-007     | AC1, RC-07, R-003     | Unit                 | Resume JSON state mapping covers paused approval contexts: unresolved standard approval maps to `waiting-for-approval`, resolved or interactive-loop pause maps to `paused`.                                                                 | Dev               | Locks `isGateResolved` behavior.                |
| 3.3D-UNIT-008     | AC1, R-003            | Unit                 | Resume JSON snapshots run status, timestamps, metadata retry fields, workflow events, and checkout hash before/after and proves no change.                                                                                                   | Dev/Test          | Data integrity proof.                           |
| 3.3D-E2E-001      | AC1/AC5, R-001/R-013  | E2E subprocess       | `archon workflow resume --json` with no run id emits one `workflow.resume` `MALFORMED_REQUEST` envelope, missingArgument `run-id`, exit 64, empty stderr.                                                                                    | Dev               | Current runtime is plain usage text.            |
| 3.3D-E2E-002      | AC2/AC5, R-001/R-013  | E2E subprocess       | `archon workflow retry --json` with no run id emits one `workflow.retry` `MALFORMED_REQUEST` envelope, missingArgument `run-id`, exit 64, empty stderr.                                                                                      | Dev               | Current runtime unknown subcommand.             |
| 3.3D-E2E-003      | AC4/AC5, R-001/R-013  | E2E subprocess       | `archon workflow cancel --json` with no run id emits one `workflow.cancel` `MALFORMED_REQUEST` envelope, missingArgument `run-id`, exit 64, empty stderr.                                                                                    | Dev               | Current runtime unknown subcommand.             |
| 3.3D-UNIT-017     | AC2, R-004            | Unit                 | Whole-run retry of failed run emits `workflow.retry` success envelope with `operation: retry`, `scope: run`, `dispatched: true`, `detached: true`, and no `state`, `resumed`, `attempt`, `retryEpoch`, `safetyRef`, or `invalidatedNodeIds`. | Dev               | Dispatch-only parent contract.                  |
| 3.3D-UNIT-018     | AC2, R-004/R-012      | Unit                 | Whole-run retry of a cancelled run returns a successful dispatch acknowledgement; the exact `resume` worker records lifecycle ineligibility later.                                                                                           | Dev               | Parent does not duplicate worker eligibility.   |
| 3.3D-UNIT-019     | AC2, R-004/R-016      | Unit                 | Whole-run retry returns immediately after `spawn()` reports a pid and does not wait for worker claim, resume, execution, status change, or event emission.                                                                                   | Dev               | Cross-process boundary.                         |
| 3.3D-UNIT-020     | AC2, R-005            | Unit                 | Whole-run retry detached child argv is explicit `archon workflow resume <run-id>` in dev and binary modes, drops `--json`, and cannot recursively call `workflow retry`.                                                                     | Dev               | Pure argv-builder test.                         |
| 3.3D-UNIT-021     | AC2/AC5, R-012/R-016  | Unit                 | Whole-run retry of a completed run returns a successful parent dispatch acknowledgement and invokes the exact `resume` worker.                                                                                                               | Dev               | Worker owns the negative lifecycle outcome.     |
| 3.3D-UNIT-022     | AC2/AC5, R-012/R-016  | Unit                 | Whole-run retry of a running run returns a successful parent dispatch acknowledgement and invokes the exact `resume` worker.                                                                                                                 | Dev               | No parent lifecycle pre-check.                  |
| 3.3D-UNIT-023     | AC2/AC5, R-016        | Unit                 | Whole-run retry spawn failure returns `INTERNAL_ERROR`, exit 70, retryable false, and no success envelope.                                                                                                                                   | Dev               | Dependency failure.                             |
| 3.3D-E2E-019      | AC2, R-004/R-014      | E2E subprocess       | Seed a failed run, invoke `workflow retry <id> --json`, parse exactly one success envelope matching `retry-success.json`, then poll status/events for worker claim.                                                                          | Dev/Test          | Parent and worker boundary.                     |
| 3.3D-UNIT-026     | AC3, R-006/R-007      | Unit                 | Targeted retry success emits `workflow.retry` envelope with `scope: node`, requested `nodeId`, `dispatched: true`, `detached: true`, and no worker-derived fields.                                                                           | Dev               | Dispatch-only targeted parent.                  |
| 3.3D-UNIT-027     | AC3, R-007            | Unit                 | Targeted retry detached child argv is explicit `archon workflow retry-node <run-id> <node-id>` in dev and binary modes and drops `--json`.                                                                                                   | Dev               | Prevents recursion and streaming corruption.    |
| 3.3D-UNIT-028     | AC3, R-006/R-016      | Unit                 | Targeted retry parent validates run existence and exact-worker spawn context, but not lifecycle or node eligibility, checkpoint, safety ref, reset, invalidation, or execution.                                                              | Dev               | Worker owns all later outcomes.                 |
| 3.3D-UNIT-029     | AC3/AC5, R-006/R-016  | Unit                 | Targeted retry unknown run returns `UNEXPECTED_STATE`, exit 78, and does not spawn.                                                                                                                                                          | Dev               | Parent lookup failure.                          |
| 3.3D-UNIT-030     | AC3/AC5, R-016        | Unit                 | Targeted retry spawn failure returns `INTERNAL_ERROR`, exit 70, retryable false, and no success envelope.                                                                                                                                    | Dev               | Dependency failure.                             |
| 3.3D-UNIT-031     | AC2/AC3, R-009        | Unit                 | Simulate two retry workers racing claim; only one claim succeeds, the other logs later outcome, and neither parent response is retroactively changed.                                                                                        | Dev/Test          | Duplicate action/race.                          |
| 3.3D-E2E-020      | AC3, R-006/R-014      | E2E subprocess       | Seed failed DAG with failed target, invoke `workflow retry <id> --node <node> --json`, parse success envelope matching `retry-node-success.json`, then poll for worker outcome.                                                              | Dev/Test          | Targeted happy path.                            |
| 3.3D-E2E-021      | AC3, R-016            | E2E subprocess       | Inject worker-side node validation failure after successful targeted dispatch and assert parent success remains unchanged while status/events/logs expose worker failure.                                                                    | Dev/Test          | Partial failure after ack.                      |
| 3.3D-E2E-022      | AC2/AC3, RC-13, R-008 | E2E subprocess       | Invoke whole-run and targeted retry from a different valid git cwd and prove worker uses persisted run codebase/working path, not caller cwd.                                                                                                | Dev/Test          | Explicitly rejects cwd matching.                |
| 3.3D-E2E-023      | AC2/AC3, R-009        | E2E subprocess       | Launch two whole-run retry parents against the same failed run; both may return dispatch ack, but status/events prove one execution owner and one node execution.                                                                            | Dev/Test          | Race and duplicate action.                      |
| 3.3D-UNIT-035     | AC4, R-010            | Unit                 | Cancel paused run calls `cancelWorkflowRun` directly and emits `workflow.cancel` success with `operation: cancel`, `state: cancelled`, `terminal: true`.                                                                                     | Dev               | Durable transition.                             |
| 3.3D-UNIT-036     | AC4, R-010            | Unit                 | Cancel running run emits the same minimal success result and does not wait for worker quiescence or cleanup.                                                                                                                                 | Dev               | Cancellation boundary.                          |
| 3.3D-UNIT-037     | AC4, R-010            | Unit                 | Cancel failed run emits the same minimal success result.                                                                                                                                                                                     | Dev               | Failed remains cancellable.                     |
| 3.3D-UNIT-038     | AC4/AC5, R-010/R-012  | Unit                 | Cancel completed run returns `UNEXPECTED_STATE`, exit 78, and does not call cleanup.                                                                                                                                                         | Dev               | Ineligible terminal state.                      |
| 3.3D-UNIT-039     | AC4/AC5, R-010/R-012  | Unit                 | Cancel already-cancelled run returns `UNEXPECTED_STATE`, exit 78, and does not call cleanup.                                                                                                                                                 | Dev               | Ineligible terminal state.                      |
| 3.3D-UNIT-040     | AC4/AC5, R-010/R-016  | Unit                 | Cancel CAS loser where `cancelWorkflowRun` returns `{ cancelled: false }` returns `UNEXPECTED_STATE`, exit 78, and reports no success.                                                                                                       | Dev               | Race loser.                                     |
| 3.3D-UNIT-041     | AC4, R-010/R-015      | Unit                 | Cancel success result omits `previousState`, `abandon`, cleanup status, worker-stop status, raw path, and container details.                                                                                                                 | Dev/Security      | Stale-state and redaction proof.                |
| 3.3D-E2E-024      | AC4, R-010/R-016      | E2E subprocess       | Seed running or paused run, invoke `workflow cancel <id> --json`, parse one `cancel-success`-compatible envelope, then query run status as cancelled.                                                                                        | Dev/Test          | Durable transition proof.                       |
| 3.3D-E2E-025      | AC4, R-010/R-016      | E2E subprocess       | Cancel during deterministic long-running node returns immediately after CAS; no later DAG node starts, and cleanup latency does not alter envelope.                                                                                          | Dev/Test          | Cancellation and out-of-order events.           |
| 3.3D-CONTRACT-001 | AC1, R-014            | Contract             | Static `resume-success.json` validates and contains no legacy `ok`, `action`, `workingPath`, or mutable execution fields.                                                                                                                    | Contract owner    | Fixture conformance.                            |
| 3.3D-CONTRACT-002 | AC2, R-014            | Contract             | Static `retry-success.json` validates and contains only dispatch-only whole-run result fields.                                                                                                                                               | Contract owner    | Fixture conformance.                            |
| 3.3D-CONTRACT-003 | AC3, R-014            | Contract             | Static `retry-node-success.json` validates and contains requested `nodeId` plus dispatch-only fields.                                                                                                                                        | Contract owner    | Fixture conformance.                            |
| 3.3D-CONTRACT-004 | AC4, R-014            | Contract             | Static `cancel-success.json` validates and omits `previousState`, cleanup, and `abandon` vocabulary.                                                                                                                                         | Contract owner    | Fixture conformance.                            |
| 3.3D-CONTRACT-005 | AC1, R-014/R-019      | Contract             | Runtime emitted resume success validates through `validate_runtime_envelope.py` and matches semantic result assertions.                                                                                                                      | Dev/Test          | Not a vacuous fixture-only pass.                |
| 3.3D-CONTRACT-006 | AC2, R-014/R-019      | Contract             | Runtime emitted whole-run retry success validates through `validate_runtime_envelope.py` and matches semantic result assertions.                                                                                                             | Dev/Test          | Runtime compatibility.                          |
| 3.3D-CONTRACT-007 | AC3, R-014/R-019      | Contract             | Runtime emitted targeted retry success validates through `validate_runtime_envelope.py` and matches semantic result assertions.                                                                                                              | Dev/Test          | Runtime compatibility.                          |
| 3.3D-CONTRACT-008 | AC4, R-014/R-019      | Contract             | Runtime emitted cancel success validates through `validate_runtime_envelope.py` and matches semantic result assertions.                                                                                                                      | Dev/Test          | Runtime compatibility.                          |
| 3.3D-CONTRACT-010 | AC5, R-011/R-015      | Contract             | Every recovery failure envelope has `stdoutRedacted: true`, `stderrRedacted: true`, no forbidden keys, no raw stdout/stderr/message/displayText, and structured non-secret details.                                                          | Security reviewer | Redaction and schema.                           |
| 3.3D-WF-001       | AC1/AC2, RC-21, R-020 | Workflow engine/unit | Resume and retry preserve route-loop counters, activation state, and attempt counters for a route-loop fixture.                                                                                                                              | Workflow owner    | Regression against route-loop runtime contract. |
| 3.3D-WF-002       | AC3, RC-21, R-020     | Workflow engine/unit | Targeted retry rejects or avoids retrying the `route_loop` controller directly and reruns the selected source path instead.                                                                                                                  | Workflow owner    | Prevents duplicate route side effects.          |

### P1 Scenarios

| Test ID           | Requirement / risk | Level          | Scenario                                                                                                                                                                           | Owner             | Notes                                    |
| ----------------- | ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------- |
| 3.3D-E2E-004      | AC3/AC5, R-013     | E2E subprocess | `workflow retry <id> --node --json` emits `MALFORMED_REQUEST` for missing node id, exit 64, empty stderr.                                                                          | Dev               | Malformed input.                         |
| 3.3D-E2E-005      | AC3/AC5, R-013     | E2E subprocess | `workflow retry <id> --node= --json` emits `MALFORMED_REQUEST` for blank node id, exit 64, empty stderr.                                                                           | Dev               | Boundary input.                          |
| 3.3D-E2E-006      | AC1/AC5, R-013     | E2E subprocess | `workflow resume <id> --json=true` emits `MALFORMED_REQUEST` with `/json` field error and exit 64.                                                                                 | Dev               | Raw flag parsing.                        |
| 3.3D-E2E-007      | AC2/AC5, R-013     | E2E subprocess | `workflow retry <id> --json=true` emits `MALFORMED_REQUEST` with `/json` field error and exit 64.                                                                                  | Dev               | Raw flag parsing.                        |
| 3.3D-E2E-008      | AC4/AC5, R-013     | E2E subprocess | `workflow cancel <id> --json=true` emits `MALFORMED_REQUEST` with `/json` field error and exit 64.                                                                                 | Dev               | Raw flag parsing.                        |
| 3.3D-E2E-009      | AC1/AC5, R-013     | E2E subprocess | `workflow resume <id> --json --correlation-id` emits `MALFORMED_REQUEST` for missing correlation id value.                                                                         | Dev               | Bare flag cannot consume `--json`.       |
| 3.3D-E2E-010      | AC2/AC5, R-013     | E2E subprocess | `workflow retry <id> --json --correlation-id` emits `MALFORMED_REQUEST` for missing correlation id value.                                                                          | Dev               | Bare flag cannot consume `--json`.       |
| 3.3D-E2E-011      | AC4/AC5, R-013     | E2E subprocess | `workflow cancel <id> --json --correlation-id` emits `MALFORMED_REQUEST` for missing correlation id value.                                                                         | Dev               | Bare flag cannot consume `--json`.       |
| 3.3D-E2E-012      | AC1/AC5, R-013     | E2E subprocess | `workflow resume <id> --json --correlation-id=` emits `MALFORMED_REQUEST` for blank correlation id.                                                                                | Dev               | Matches current pre-handler convention.  |
| 3.3D-E2E-013      | AC2/AC5, R-013     | E2E subprocess | `workflow retry <id> --json --correlation-id=` emits `MALFORMED_REQUEST` for blank correlation id.                                                                                 | Dev               | Matches current pre-handler convention.  |
| 3.3D-E2E-014      | AC4/AC5, R-013     | E2E subprocess | `workflow cancel <id> --json --correlation-id=` emits `MALFORMED_REQUEST` for blank correlation id.                                                                                | Dev               | Matches current pre-handler convention.  |
| 3.3D-E2E-015      | AC1/AC5, R-013     | E2E subprocess | `workflow resume <id> --json --cwd /missing` emits `MALFORMED_REQUEST` `/cwd=directory_not_found`.                                                                                 | Dev               | Dependency/preflight failure.            |
| 3.3D-E2E-016      | AC2/AC5, R-013     | E2E subprocess | `workflow retry <id> --json` from a non-git cwd emits `MALFORMED_REQUEST` `/cwd=not_a_git_repository`.                                                                             | Dev               | Permission/environment guard.            |
| 3.3D-E2E-017      | AC4/AC5, R-013     | E2E subprocess | `workflow cancel <id> --json` from a non-git cwd emits `MALFORMED_REQUEST` `/cwd=not_a_git_repository`.                                                                            | Dev               | Permission/environment guard.            |
| 3.3D-E2E-018      | AC1/AC5, R-013     | E2E subprocess | `--json=true` after `--` remains positional and does not trigger a provider envelope shortcut.                                                                                     | Dev               | Raw parser boundary inherited from 3.3b. |
| 3.3D-UNIT-046     | AC5, R-012         | Unit           | Resume maps a typed `unexpected_state` parent cause to `UNEXPECTED_STATE`, exit 78, while identical untyped English prose falls through to `INTERNAL_ERROR`.                       | Dev               | Typed positive plus prose-negative case. |
| 3.3D-UNIT-047     | AC5, R-012         | Unit           | Retry maps typed parent causes to stable categories; `Cannot retry workflow run` text alone does not select `UNEXPECTED_STATE`.                                                    | Dev               | No English-message discriminator.        |
| 3.3D-UNIT-048     | AC4/AC5, R-012     | Unit           | Cancel CAS loss is raised as a typed `unexpected_state` cause and maps to `UNEXPECTED_STATE`, exit 78, retryable false.                                                            | Dev               | Typed CAS-loss case.                     |
| 3.3D-UNIT-049     | AC5, R-012         | Unit           | Classifier maps `Workflow run not found` and ambiguous run prefix to expected error categories without treating generic `Workflow not found` as run-not-found.                     | Dev               | Specificity guard.                       |
| 3.3D-UNIT-050     | AC5, R-017         | Unit           | Timeout-like caught error maps to `COMMAND_TIMEOUT`, category `timeout`, retryable true, and Archon parent exit 69.                                                                | Dev               | Distinct from Hermes consumer timeout.   |
| 3.3D-UNIT-051     | AC5, R-012/R-016   | Unit           | Database failure maps to `INTERNAL_ERROR`, exit 70, retryable false, and applies no unsupported transition.                                                                        | Dev               | Dependency failure.                      |
| 3.3D-UNIT-052     | AC5, R-012/R-016   | Unit           | Non-Error throw in each recovery JSON branch still emits a valid `INTERNAL_ERROR` envelope.                                                                                        | Dev               | Fail-closed catch boundary.              |
| 3.3D-UNIT-053     | RC-04, R-018       | Unit/scan      | `printJsonWriteError` is deleted after resume conversion, or if legacy `abandon --json` still uses it the remaining caller is documented and covered.                              | Dev               | Cleanup/rollback guard.                  |
| 3.3D-UNIT-054     | AC5, R-015         | Unit           | Recovery failure envelope details include structured `mutationApplied: false` or equivalent and never include raw exception `message`, `stdout`, `stderr`, path, or secret fields. | Security reviewer | Output secrecy.                          |
| 3.3D-CONTRACT-009 | RC-09, R-018       | Contract       | Provider syntax baseline still maps `workflow.retry` to `archon workflow retry <run-id> [--node <node-id>] --json` and `workflow.cancel` to `cancel`, not legacy command names.    | Contract owner    | Canonical naming.                        |
| 3.3D-REG-001      | RC-20, R-018       | E2E subprocess | `workflow retry <id>` without `--json` returns clear usage guidance pointing to `workflow retry-node <run-id> <node-id>` and does not dispatch.                                    | Dev               | JSON-only spelling.                      |
| 3.3D-REG-002      | RC-20, R-018       | E2E subprocess | `workflow cancel <id>` without `--json` returns clear usage guidance pointing to `workflow abandon <run-id>` and does not mutate.                                                  | Dev               | JSON-only spelling.                      |
| 3.3D-REG-003      | R-018              | Unit/E2E       | Existing non-JSON `workflow resume`, `workflow retry-node`, and `workflow abandon` behavior remains unchanged.                                                                     | Dev/Test          | Compatibility regression.                |

### P2/P3 Scenarios

| Test ID       | Requirement / risk | Level       | Scenario                                                                                                                                                                 | Owner          | Notes                       |
| ------------- | ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | --------------------------- |
| 3.3D-SCAN-001 | AC6, R-017         | Static scan | Archon recovery code does not introduce `UNEXPECTED_EXIT`, `SCHEMA_MISMATCH`, consumer-owned `TIMEOUT`, or supervisor logic for its own uncatchable subprocess failures. | Test architect | Producer/consumer boundary. |
| 3.3D-CI-001   | R-014/R-019        | CI          | `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` passes before review.                                                       | Dev/Test       | Canonical validator.        |
| 3.3D-CI-002   | R-019              | CI          | `bun test packages/cli/src/commands/workflow.test.ts` passes in its isolated package invocation.                                                                         | Dev/Test       | Mock pollution guard.       |
| 3.3D-CI-003   | R-019              | CI          | `bun test packages/cli/src/commands/workflow-json.e2e.test.ts` passes with isolated subprocess fixtures.                                                                 | Dev/Test       | Real CLI boundary.          |
| 3.3D-CI-004   | R-019              | CI          | `bun test packages/cli/src/commands/workflow-command-contract.test.ts` passes in its isolated package invocation.                                                        | Dev/Test       | Runtime contract checks.    |
| 3.3D-CI-005   | R-019              | CI          | `packages/cli/package.json` keeps conflicting `mock.module()` files in separate `bun test` invocations or adds a new batch if needed.                                    | Dev/Test       | Avoid root `bun test`.      |
| 3.3D-CI-006   | All high risks     | CI/rollback | `bun run validate` passes after focused recovery tests and no unrelated generated files are hand-edited.                                                                 | Dev            | Final release gate.         |

## Waiver Register

| Waiver | Requirement / concern                                                                                                            | Reason                                                                                                                                 | Owner                  | Residual risk                                                                         | Follow-up trigger                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| W-001  | Hermes consumer classification of empty output, malformed/schema-invalid output, external timeout, and uncatchable process exit. | Explicitly downstream in Story 3.4c; Archon cannot envelope its own uncatchable crash without adding a supervisor rejected by TD-005.  | Hermes consumer owner  | A consumer bug could misclassify Archon producer failures after this story ships.     | Hermes Story 3.4c starts or a controller consumes these commands before Hermes compatibility proof exists. |
| W-002  | Permission/auth enforcement for local CLI invocation and caller-cwd matching.                                                    | Story 3.3d is a local CLI producer surface; OS/process access is the trust boundary, and TD-N06 rejects caller-cwd as retry ownership. | Product/security owner | Remote execution surfaces may need stronger auth around invoking the CLI.             | Multi-user remote command execution or new server-side provider command surface is accepted.               |
| W-003  | Performance/load threshold for local recovery commands and detached-worker claim latency.                                        | No accepted SLO exists; guessing a threshold would create false precision.                                                             | Product owner          | Slow local command or worker claim latency could degrade controller UX.               | A controller latency SLO, telemetry concern, or production incident is accepted.                           |
| W-004  | PostgreSQL-specific cancel CAS integration in this story.                                                                        | No SQL or schema change is planned; the CLI calls existing `cancelWorkflowRun`, whose DB behavior is already covered elsewhere.        | Workflow store owner   | A future adapter change could alter CAS semantics.                                    | `cancelWorkflowRun` SQL changes or a Postgres-only cancellation defect appears.                            |
| W-005  | Full real-process retry race for every retry variant in PR lane.                                                                 | One deterministic whole-run race plus targeted unit worker-boundary proof covers the contract without multiplying flaky process tests. | Test architect         | A targeted-only race defect could escape if it differs from whole-run claim behavior. | Targeted retry race bug, flake, or claim-path code fork is observed.                                       |
| W-006  | Reviewer findings recorded without ownership triage.                                                                             | There is no implementation review yet; this document triages all known pre-implementation reviewer and retro evidence.                 | Story owner            | New implementation review findings can add risks later.                               | Code review produces a new finding.                                                                        |

## Mandatory Traceability

### Acceptance Criteria

| AC                                                                                      | Coverage or waiver                                                                                                                          |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 Resume validates resumability and is validate-only with no mutation.                | 3.3D-UNIT-001 through 008, 3.3D-E2E-001, 3.3D-CONTRACT-001, 3.3D-CONTRACT-005, 3.3D-WF-001.                                                 |
| AC2 Whole-run retry dispatches detached worker and parent returns dispatch-only result. | 3.3D-UNIT-017 through 023, 3.3D-E2E-002, 3.3D-E2E-019, 3.3D-E2E-022, 3.3D-E2E-023, 3.3D-CONTRACT-002, 3.3D-CONTRACT-006.                    |
| AC3 Targeted retry dispatches detached exact-run/exact-node worker.                     | 3.3D-E2E-004/005, 3.3D-UNIT-026 through 031, 3.3D-E2E-020 through 022, 3.3D-CONTRACT-003, 3.3D-CONTRACT-007, 3.3D-WF-002.                   |
| AC4 Cancel acknowledges durable transition only.                                        | 3.3D-UNIT-035 through 041, 3.3D-E2E-003, 3.3D-E2E-024, 3.3D-E2E-025, 3.3D-CONTRACT-004, 3.3D-CONTRACT-008.                                  |
| AC5 Caught failures use shared failure envelope and apply no unsupported transition.    | 3.3D-E2E-001 through 018, 3.3D-UNIT-003 through 005, 021 through 023, 029 through 030, 038 through 040, 046 through 054, 3.3D-CONTRACT-010. |
| AC6 Consumer-classified failures are not Archon's responsibility.                       | 3.3D-SCAN-001 and W-001.                                                                                                                    |

### High-Risk Items

| Risk  | Coverage or waiver                                                        |
| ----- | ------------------------------------------------------------------------- |
| R-001 | 3.3D-E2E-001 through 003                                                  |
| R-002 | 3.3D-UNIT-001/002, 3.3D-CONTRACT-001/005                                  |
| R-003 | 3.3D-UNIT-003 through 008, 3.3D-WF-001                                    |
| R-004 | 3.3D-UNIT-017 through 019, 3.3D-E2E-019, 3.3D-CONTRACT-002/006            |
| R-005 | 3.3D-UNIT-020                                                             |
| R-006 | 3.3D-UNIT-026/028, 3.3D-E2E-020/021, 3.3D-CONTRACT-003/007                |
| R-007 | 3.3D-UNIT-027, 3.3D-E2E-020                                               |
| R-008 | 3.3D-E2E-022, W-002                                                       |
| R-009 | 3.3D-UNIT-031, 3.3D-E2E-023, W-005                                        |
| R-010 | 3.3D-UNIT-035 through 041, 3.3D-E2E-024/025, 3.3D-CONTRACT-004/008        |
| R-011 | 3.3D-E2E-001 through 018, 3.3D-CONTRACT-010                               |
| R-012 | 3.3D-UNIT-003 through 005, 021/022, 029, 038 through 040, 046 through 052 |
| R-013 | 3.3D-E2E-001 through 018                                                  |
| R-014 | 3.3D-CONTRACT-001 through 009, 3.3D-CI-001                                |
| R-015 | 3.3D-CONTRACT-010, 3.3D-UNIT-041/054                                      |
| R-016 | 3.3D-UNIT-019/023/030/040, 3.3D-E2E-021/025                               |
| R-017 | 3.3D-UNIT-050, 3.3D-SCAN-001, W-001                                       |
| R-018 | 3.3D-CONTRACT-009, 3.3D-REG-001 through 003                               |
| R-019 | 3.3D-CI-002 through 006                                                   |
| R-020 | 3.3D-WF-001/002                                                           |

### Reviewer Concerns

| Concern | Coverage or waiver                                          |
| ------- | ----------------------------------------------------------- |
| RC-01   | 3.3D-E2E-001 through 018                                    |
| RC-02   | 3.3D-UNIT-006, 019, 028; 3.3D-E2E-019/020                   |
| RC-03   | 3.3D-UNIT-046 through 052                                   |
| RC-04   | 3.3D-UNIT-053, 3.3D-REG-003                                 |
| RC-05   | 3.3D-E2E-009 through 014                                    |
| RC-06   | 3.3D-CONTRACT-005 through 008                               |
| RC-07   | 3.3D-UNIT-007                                               |
| RC-08   | Full coverage matrix plus `bun run validate` in 3.3D-CI-006 |
| RC-09   | 3.3D-CONTRACT-009, 3.3D-REG-001 through 003                 |
| RC-10   | 3.3D-E2E-001 through 003, 3.3D-UNIT-001                     |
| RC-11   | 3.3D-UNIT-017 through 020, 3.3D-E2E-019                     |
| RC-12   | 3.3D-UNIT-026 through 030, 3.3D-E2E-020                     |
| RC-13   | 3.3D-E2E-022, W-002                                         |
| RC-14   | 3.3D-UNIT-031, 3.3D-E2E-023, W-005                          |
| RC-15   | 3.3D-UNIT-035 through 041, 3.3D-E2E-024/025                 |
| RC-16   | 3.3D-UNIT-038 through 040, 3.3D-UNIT-048                    |
| RC-17   | 3.3D-SCAN-001, W-001                                        |
| RC-18   | 3.3D-UNIT-046 through 052                                   |
| RC-19   | 3.3D-CONTRACT-010, 3.3D-UNIT-054                            |
| RC-20   | 3.3D-REG-001/002                                            |
| RC-21   | 3.3D-WF-001/002                                             |
| RC-22   | W-006                                                       |

### Scenario-Type Checklist

| Required type       | Scenario or waiver                                                                    |
| ------------------- | ------------------------------------------------------------------------------------- |
| Happy path          | 3.3D-UNIT-001/002/017/018/026/035/036/037, 3.3D-E2E-019/020/024                       |
| Negative path       | 3.3D-UNIT-003 through 005, 021 through 023, 029/030, 038 through 040, 046 through 052 |
| Boundary cases      | 3.3D-UNIT-007/008/020/027/041, 3.3D-E2E-004/005/018                                   |
| Malformed input     | 3.3D-E2E-001 through 018                                                              |
| Stale data          | 3.3D-UNIT-007/008/040/041, 3.3D-E2E-025                                               |
| Duplicate actions   | 3.3D-UNIT-031, 3.3D-E2E-023, W-005                                                    |
| Out-of-order events | 3.3D-E2E-021/025 and 3.3D-WF-001/002                                                  |
| Partial failure     | 3.3D-UNIT-019/023/030/040, 3.3D-E2E-021                                               |
| Dependency failure  | 3.3D-E2E-015 through 017, 3.3D-UNIT-023/030/051                                       |
| Timeout             | 3.3D-UNIT-050 and W-001                                                               |
| Cancellation        | 3.3D-UNIT-035 through 041, 3.3D-E2E-024/025                                           |
| Concurrency/race    | 3.3D-UNIT-031, 3.3D-E2E-023, 3.3D-UNIT-040, W-005                                     |
| Rollback            | 3.3D-UNIT-053, 3.3D-REG-003, 3.3D-CI-006                                              |
| Permission/auth     | 3.3D-E2E-016/017 and W-002                                                            |
| Regression          | 3.3D-CONTRACT-009, 3.3D-REG-001 through 003, 3.3D-CI-002 through 006                  |

## Execution Strategy

Run everything in PRs unless it becomes expensive or flaky.
The recovery-command surface is local CLI and in-repo contracts, so focused tests should fit the existing `@archon/cli` package isolation model.

| Lane             | Contents                                                                                                                                                                                               | Expected timing                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| PR               | Focused `workflow.test.ts`, `workflow-json.e2e.test.ts`, `workflow-command-contract.test.ts`, `workflow-provider-command-envelope.test.ts`, contract validator, `bun --filter @archon/cli type-check`. | Target under 15 minutes after fixture reuse.                                       |
| Nightly          | Full `bun run validate`, plus repeated detached retry E2E if race flakiness appears.                                                                                                                   | Standard repo gate.                                                                |
| Weekly/on demand | Burn-in of cross-process retry/cancel race scenarios and route-loop retry/resume fixtures.                                                                                                             | Only if process race flake, route-loop regression, or controller incident appears. |

## Resource Estimates

| Priority | Count | Effort range  | Notes                                                                                                                       |
| -------- | ----: | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| P0       |    49 | ~56-92 hours  | Envelope conversion, no-mutation proof, retry dispatch, cancel CAS, subprocess parsing, redaction, route-loop preservation. |
| P1       |    28 | ~30-50 hours  | Malformed argv matrix, classifier specificity, JSON-only human guidance, legacy regression.                                 |
| P2/P3    |     7 | ~6-12 hours   | Static scan, CI/package isolation, final validate gate.                                                                     |
| Total    |    84 | ~92-154 hours | Range reflects detached-process fixture setup and race-test stabilization.                                                  |

## Quality Gate Criteria

- P0 pass rate: 100%.
- P1 pass rate: >= 95%; any failure needs explicit waiver before review.
- All score >= 6 risks are mitigated or waived with owner and follow-up trigger.
- All caught recovery failures emit exactly one shared failure envelope with matching process exit code.
- Recovery success envelopes validate against canonical fixtures and story-specific semantic assertions.
- No raw prose, stack traces, stderr diagnostics, Pino logs, secrets, raw paths, or forbidden keys in JSON-mode controller output.
- `bun run validate` passes before review.

## Mitigation Plans

### R-001/R-002/R-011/R-014: Producer Contract Integrity

**Strategy:**

1. Wire resume, retry, and cancel into `WorkflowCommandEnvelopeCommand` and `getWorkflowCommandEnvelopeCommand`.
2. Convert recovery JSON branches to `buildSuccessEnvelope` and `buildErrorEnvelope`.
3. Validate static fixtures and runtime emitted envelopes.
4. Assert exactly one stdout JSON line, empty stderr, and no forbidden output.

**Owner:** CLI implementer and contract owner
**Timeline:** Slices 1, 2, 3, 4, 5, and 6
**Status:** Planned
**Verification:** 3.3D-E2E-001 through 018, 3.3D-CONTRACT-001 through 010.

### R-003/R-004/R-006/R-016/R-020: Lifecycle Boundary Integrity

**Strategy:**

1. Prove resume JSON is read-only and validate-only.
2. Prove retry parent is dispatch-only and worker outcomes remain later workflow observations.
3. Prove cancel success is only the durable CAS result.
4. Prove route-loop counters, activation state, and source-path retry semantics are preserved.

**Owner:** CLI implementer and workflow retry owner
**Timeline:** Slices 2, 3, 4, and 5
**Status:** Planned
**Verification:** 3.3D-UNIT-001 through 008, 017 through 031, 035 through 041, 3.3D-E2E-019 through 025, 3.3D-WF-001/002.

### R-012/R-013/R-017: Fail-Closed Error Classification

**Strategy:**

1. Map recovery-specific typed causes at the command boundary; do not add English-message classifier cases.
2. Cover malformed argv, cwd/git preflight, run-not-found, ineligible state, CAS loss, spawn failure, DB failure, timeout, and non-Error throw.
3. Distinguish Archon caught timeout exit 69 from Hermes-owned consumer timeout.

**Owner:** CLI dispatcher owner
**Timeline:** Slices 1 through 5
**Status:** Planned
**Verification:** 3.3D-E2E-001 through 018 and 3.3D-UNIT-046 through 054.

### R-018/R-019: Regression and Test Isolation

**Strategy:**

1. Preserve non-JSON resume, retry-node, and abandon behavior.
2. Keep conflicting Bun mocks in isolated test invocations.
3. Run focused CLI tests before the full repository validation gate.

**Owner:** CLI maintainer and test implementer
**Timeline:** Slice 6
**Status:** Planned
**Verification:** 3.3D-REG-001 through 003 and 3.3D-CI-002 through 006.

## Assumptions and Dependencies

### Assumptions

1. The current acceptance criteria and approved technical decisions are normative for Story 3.3d.
2. `cancelWorkflowRun` remains the authoritative CAS operation and is not modified by this story.
3. The detached retry worker can be observed through run status, workflow events, and detached logs.
4. The local CLI trust boundary remains OS/process access; no new auth layer is added.

### Dependencies

1. Canonical Workflow Commander contract files remain available under `_bmad-output/planning-artifacts/contracts/workflow-commander`.
2. Focused CLI tests can create isolated temporary git repos and isolated Archon homes.
3. Existing test helper `validate_runtime_envelope.py` remains usable from the CLI package.
4. No network access is required for recovery-command tests.

### Risks to Plan

- **Risk:** Detached-worker E2E races are flaky.
  **Impact:** False failures or under-tested duplicate execution.
  **Contingency:** Keep one deterministic process-level race and use unit-level CAS simulations for the rest until a stable harness exists.
- **Risk:** Existing legacy `abandon --json` still needs `printJsonWriteError`.
  **Impact:** Cleanup task may be blocked by preserved legacy compatibility.
  **Contingency:** Document the remaining caller and add regression coverage instead of deleting the helper prematurely.

## Appendix

### Knowledge Base References

- `risk-governance.md`: risk scoring and mitigation threshold.
- `probability-impact.md`: probability and impact scale.
- `test-levels-framework.md`: unit, integration, E2E, and contract test level selection.
- `test-priorities-matrix.md`: P0-P3 prioritization.
- `nfr-criteria.md`: NFR planning categories and evidence expectations.

### Related Documents

- Story: `_bmad-output/implementation-artifacts/3-3d-provide-archon-recovery-command-cli-json.md`
- Decisions: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/story-decisions/3-3d-provide-archon-recovery-command-cli-json/technical-decisions.md`
- PRD: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md`
- Architecture: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`
- Epics: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`
- Runtime route-loop contract: `_bmad-output/specs/spec-route-loop-routing/runtime-contract.md`
- Prior test design: `_bmad-output/test-artifacts/workflow-commander/test-design/test-design-3-3c-provide-archon-provider-decision-command-cli-json.md`
