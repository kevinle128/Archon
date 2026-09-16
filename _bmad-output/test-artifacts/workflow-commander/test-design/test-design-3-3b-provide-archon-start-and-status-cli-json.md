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
lastSaved: '2026-07-16'
workflowType: 'testarch-test-design'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/README.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/*.json'
  - '_bmad-output/test-artifacts/workflow-commander/test-design/test-design-3-3a-define-shared-workflow-provider-command-envelope.md'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/commands/workflow.test.ts'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/adapters/cli-adapter.ts'
outputDocument: '_bmad-output/test-artifacts/workflow-commander/test-design/test-design-3-3b-provide-archon-start-and-status-cli-json.md'
---

# Test Design: Story 3.3b - Provide Archon Start And Status CLI JSON

**Date:** 2026-07-16
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for Story 3.3b.
This story converts foreground `archon workflow run <name> [message] --json` and `archon workflow get <run-id> --json` into Workflow Commander command-envelope output for `workflow.start` and `workflow.status`.

**Risk Summary:**

- Total risks identified: 20
- High-priority risks, score >= 6: 20
- P0 blockers: schema conformance, stdout purity, CLI fail-closed dispatch, foreground start error containment, status command conversion, state mapping, raw diagnostic suppression, and forbidden-key leakage.
- Critical categories: BUS, OPS, DATA, TECH, SEC

**Coverage Summary:**

- P0 scenarios: 22, ~18-30 hours
- P1 scenarios: 25, ~20-34 hours
- P2/P3 scenarios: 0 required
- Waiver/process evidence: ~3-6 hours
- Total effort: ~41-70 hours, roughly 5-9 engineering days

## Not in Scope

| Item                                                                        | Reasoning                                                                                                     | Mitigation                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `--detach --json` envelope conversion                                       | The parent emits before a real workflow run row exists, so it cannot satisfy required `workflowRunRef.runId`. | W-3.3B-001; keep existing detach tests unchanged.              |
| True async start semantics                                                  | The existing foreground command blocks until terminal or paused. Changing this is larger architecture work.   | W-3.3B-003; document consumer risk.                            |
| Hermes Project Binding, phase tasks, gates, reconciliation, diagnostics, UI | PRD and architecture explicitly exclude Hermes-owned surfaces from Archon 3.3b.                               | W-3.3B-005 and file-scope review.                              |
| HTTP/Web control path                                                       | Workflow Commander v1 uses CLI JSON for state-changing control.                                               | Scope review that no server/web route is added.                |
| OS-level kill/abort envelope guarantee                                      | No runtime abort/timeout contract exists for a killed process.                                                | W-3.3B-006; cover in-process timeout classification only.      |
| Browser/API route testing                                                   | This story has no browser or HTTP API surface.                                                                | Use Bun unit, contract, adapter, CLI subprocess, and CI gates. |

## Risk Assessment

### High-Priority Risks

| Risk ID    | Category   | Description                                                                                                          |   P |   I | Score | Priority | Mitigation                                                                                                     | Owner / Timeline                                             |
| ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------- | --: | --: | ----: | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 3.3B-R-001 | TECH / BUS | `workflow.start` or `workflow.status` output drifts from the closed command-envelope schema.                         |   3 |   3 |     9 | P0       | Exact envelope tests, fixture/schema regression, validator, forbidden top-level key checks.                    | CLI implementer + contract reviewer / Tasks 1-4              |
| 3.3B-R-002 | BUS / OPS  | Foreground `workflow run --json` writes human/progress/assistant text, multiple JSON documents, or malformed stdout. |   3 |   3 |     9 | P0       | Raw stdout capture, exactly-one-line assertions, adapter silent-mode tests.                                    | CLI implementer / Tasks 1 and 4                              |
| 3.3B-R-003 | BUS / OPS  | CLI dispatch prevalidation emits usage text before JSON-mode malformed requests reach the command handler.           |   3 |   3 |     9 | P0       | Subprocess tests for missing positionals and mutually exclusive flags.                                         | CLI implementer / Tasks 1-2                                  |
| 3.3B-R-004 | BUS / OPS  | Early foreground start failures escape to `cli.ts` plain-text catch.                                                 |   3 |   3 |     9 | P0       | Fail-closed boundary and fault injection for workflow discovery, DB, codebase, worktree, and execution errors. | CLI implementer / Task 1                                     |
| 3.3B-R-005 | BUS / DATA | `workflow get --json` keeps emitting legacy `{ ok:false }` or raw `WorkflowRun` rows and leaks DB error text.        |   3 |   3 |     9 | P0       | Replace every JSON branch with `workflow.status` envelopes and assert exit codes.                              | CLI implementer / Task 2                                     |
| 3.3B-R-006 | BUS / DATA | Contract-facing state mapping is wrong, especially approval gate versus interactive-loop pause.                      |   3 |   3 |     9 | P0       | Direct state-mapping helper tests for all statuses and paused subcases.                                        | CLI implementer + workflow owner / Task 3                    |
| 3.3B-R-007 | DATA / BUS | Success envelopes use stale/inferred run data instead of reloading the persisted run.                                |   2 |   3 |     6 | P1       | Fetch persisted run after successful execution; missing row becomes structured internal error.                 | CLI implementer / Task 1                                     |
| 3.3B-R-008 | BUS / SEC  | Failed execution includes raw `result.error`, stdout/stderr, or prose diagnostics in envelope details.               |   2 |   3 |     6 | P0       | Structured details only, logger-only raw diagnostics, recursive forbidden text-key scan.                       | CLI implementer + security reviewer / Tasks 1 and 4          |
| 3.3B-R-009 | BUS / OPS  | Error code/category/retryable/exit-code classification is unstable.                                                  |   2 |   3 |     6 | P1       | Table-driven classification tests for 64/69/70/78 and canonical categories.                                    | CLI implementer / Tasks 1-2                                  |
| 3.3B-R-010 | BUS        | `--correlation-id` is not threaded or is regenerated inconsistently.                                                 |   2 |   3 |     6 | P1       | Fixed correlation id tests at command and argv dispatch levels.                                                | CLI implementer / Tasks 1-2                                  |
| 3.3B-R-011 | TECH / BUS | Non-JSON workflow behavior or `--detach --json` ack regresses.                                                       |   2 |   3 |     6 | P1       | Existing human/detach tests unchanged; file-scope review.                                                      | CLI implementer + reviewer / every task                      |
| 3.3B-R-012 | DATA / UX  | Silencing `CLIAdapter` also suppresses DB message persistence.                                                       |   2 |   3 |     6 | P1       | Adapter unit test for silent stdout with persistence preserved.                                                | CLI implementer / Task 1                                     |
| 3.3B-R-013 | OPS / DATA | Verbose status events are omitted, misplaced, or returned after dependency failure as false success data.            |   2 |   3 |     6 | P1       | Tests for `result.events`, omitted non-verbose events, and event lookup failure behavior.                      | CLI implementer / Task 2                                     |
| 3.3B-R-014 | BUS / TECH | Fixture deltas for `phase` and `projectBindingRef` are hidden by weak tests or fake values.                          |   2 |   3 |     6 | P1       | Assert story-owned fields and document intentional delta.                                                      | Story owner + contract reviewer / Task 4                     |
| 3.3B-R-015 | BUS / OPS  | Blocking start semantics may not satisfy an async-start consumer expectation.                                        |   2 |   3 |     6 | P1       | Waiver and explicit tests for implemented blocking contract.                                                   | Product + architecture owners / before production dependency |
| 3.3B-R-016 | SEC / BUS  | Forbidden actor/profile/agent/message/stdout/stderr/display text keys appear in emitted envelopes.                   |   2 |   3 |     6 | P0       | Parsed-envelope recursive forbidden-key tests.                                                                 | Security reviewer + CLI implementer / Task 4                 |
| 3.3B-R-017 | TECH / OPS | `mock.module()` pollution or misplaced tests make the suite order-dependent.                                         |   3 |   2 |     6 | P1       | Keep `workflow.test.ts` isolated; isolate new mocking files if needed.                                         | Test implementer / Task 4                                    |
| 3.3B-R-018 | OPS        | Timeout and cancellation behavior for long-running foreground commands remains ambiguous.                            |   2 |   3 |     6 | P1       | Cover timeout-message classification; waive OS-level kill guarantee.                                           | CLI architecture owner / follow-up policy story              |
| 3.3B-R-019 | DATA / OPS | Concurrent or duplicate JSON starts mix worktrees, messages, correlation ids, or run refs.                           |   2 |   3 |     6 | P1       | Regression coverage for explicit branch/conversation behavior and no mixed envelopes.                          | CLI + isolation owners / Task 4                              |
| 3.3B-R-020 | OPS / TECH | Partial landing across dispatcher, command, adapter, and tests leaves inconsistent JSON behavior.                    |   2 |   3 |     6 | P1       | Scoped patch, no contract edits, focused checks before full validation.                                        | Story owner / every task                                     |

### Medium And Low Risks

None are tracked separately.
All identified risks score >=6 because this story is a narrow cross-process contract surface where even edge failures can break strict consumers.

## Reviewer-Evidence Disposition

Every known reviewer concern is treated as evidence, not optional advice.

| Concern                                                                                                      | Disposition                                              |   P |   I | Score | Scenario or waiver                       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | --: | --: | ----: | ---------------------------------------- |
| RC-01: Shared builder from 3.3a exists and should not be modified.                                           | Runtime changes may regress baseline helper behavior.    |   2 |   3 |     6 | 3.3B-CONTRACT-038                        |
| RC-02: Contract package is source of truth and must not be edited.                                           | Fixture/schema rewrites would hide implementation drift. |   2 |   3 |     6 | 3.3B-CONTRACT-039/040                    |
| RC-03: Top-level envelope fields are fixed and schema is closed.                                             | Critical compatibility risk.                             |   3 |   3 |     9 | 3.3B-UNIT-001, 3.3B-CONTRACT-036         |
| RC-04: Failure envelopes omit `workflowRunRef` by default.                                                   | Failure shape must preserve established convention.      |   2 |   3 |     6 | 3.3B-UNIT-009/010                        |
| RC-05: Foreground `workflow run --json` must emit exactly one envelope.                                      | Critical controller parse risk.                          |   3 |   3 |     9 | 3.3B-UNIT-015/016, 3.3B-CLI-035          |
| RC-06: `quiet` is not enough; adapter stdout must be silenced while persistence remains.                     | Data and stdout-purity risk.                             |   2 |   3 |     6 | 3.3B-UNIT-014/027                        |
| RC-07: `--detach --json` ack is out of scope and unchanged.                                                  | Regression risk, explicit non-provider-command surface.  |   2 |   3 |     6 | 3.3B-REG-042; W-3.3B-001                 |
| RC-08: Non-JSON behavior must stay byte-for-byte compatible.                                                 | Regression risk for existing CLI users.                  |   2 |   3 |     6 | 3.3B-REG-041                             |
| RC-09: CLI prevalidation must not short-circuit JSON malformed requests.                                     | Critical fail-closed risk.                               |   3 |   3 |     9 | 3.3B-CLI-031/032                         |
| RC-10: Missing `workflow run` name and `workflow get` run id need JSON envelopes under `--json`.             | Critical fail-closed risk.                               |   3 |   3 |     9 | 3.3B-CLI-031/033                         |
| RC-11: `workflow get --json` must stop emitting raw rows and legacy `{ok:false}`.                            | Critical compatibility risk.                             |   3 |   3 |     9 | 3.3B-UNIT-019-025                        |
| RC-12: DB errors and execution failures must not leak raw diagnostic strings.                                | Security/contract risk.                                  |   2 |   3 |     6 | 3.3B-UNIT-009/010/020, 3.3B-CONTRACT-036 |
| RC-13: `executeWorkflow` failures may omit `workflowRunId`.                                                  | Partial-failure risk.                                    |   2 |   3 |     6 | 3.3B-UNIT-009/010                        |
| RC-14: Persisted run must be fetched after successful execution.                                             | Stale-data risk.                                         |   2 |   3 |     6 | 3.3B-UNIT-008/011                        |
| RC-15: Persisted run fetch failure after accepted execution must return structured internal error.           | Partial-failure risk.                                    |   2 |   3 |     6 | 3.3B-UNIT-011                            |
| RC-16: State mapping must distinguish approval, interactive loop, malformed approval, and terminal statuses. | Critical status compatibility risk.                      |   3 |   3 |     9 | 3.3B-UNIT-002-007, 3.3B-UNIT-022/030     |
| RC-17: `phase` and `projectBindingRef` are out of scope; do not invent fake values.                          | Risk if tests fake unsupported data or ignore the delta. |   2 |   3 |     6 | 3.3B-CONTRACT-037; W-3.3B-002            |
| RC-18: Blocking start behavior may not satisfy async-start expectations.                                     | Product/contract ambiguity.                              |   2 |   3 |     6 | 3.3B-UNIT-013; W-3.3B-003                |
| RC-19: `--correlation-id` is registered but not wired today.                                                 | Metadata traceability risk.                              |   2 |   3 |     6 | 3.3B-UNIT-018/024, 3.3B-CLI-034          |
| RC-20: `projectRef` is optional absent codebase and namespaced when present.                                 | Identity compatibility risk.                             |   2 |   3 |     6 | 3.3B-UNIT-008                            |
| RC-21: `bindingRef`/`projectBindingRef` is not generally applicable to generic workflow runs.                | Explicit non-risk under current scope.                   |   1 |   3 |     3 | W-3.3B-004                               |
| RC-22: Verbose status events move under `result.events` only when verbose.                                   | Regression/shape risk.                                   |   2 |   3 |     6 | 3.3B-UNIT-025/026                        |
| RC-23: Contract tests should inspect parsed emitted envelopes, not raw-regex all of `workflow.ts`.           | Risk of brittle or weak security tests.                  |   2 |   3 |     6 | 3.3B-CONTRACT-036                        |
| RC-24: Test isolation must respect `workflow.test.ts` mock boundary.                                         | Test reliability risk.                                   |   3 |   2 |     6 | 3.3B-CI-044                              |
| RC-25: HTTP/Web UI/events/delivery/Hermes behavior are excluded.                                             | Explicit non-risk if scope stays clean.                  |   1 |   2 |     2 | W-3.3B-005                               |
| RC-26: Runtime timeout/cancellation policy is not fully defined.                                             | Operational risk requiring waiver.                       |   2 |   3 |     6 | 3.3B-UNIT-029/030; W-3.3B-006            |
| RC-27: Canonical validator must pass unchanged.                                                              | Contract drift risk.                                     |   2 |   3 |     6 | 3.3B-CONTRACT-039                        |

## NFR Planning

| NFR Category               | Requirement / Threshold                                                                                                                    | Risk Link                                | Planned Validation                                                                                       | Evidence Needed                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Security                   | No raw stdout/stderr/message diagnostics in details; no forbidden Hermes/actor/profile/agent keys; redacted execution metadata.            | R-008, R-016                             | Parsed-envelope forbidden-key scan; raw diagnostic suppression tests.                                    | Contract test output and focused command test output.      |
| Reliability                | Every JSON path returns one parseable envelope with stable exit code; dependency and partial failures fail closed.                         | R-002, R-003, R-004, R-005, R-009, R-018 | Command unit tests, dependency fault injection, subprocess stdout/stderr checks, timeout classification. | `workflow.test.ts` and CLI subprocess output.              |
| Data integrity             | Status reflects persisted run state; JSON mode does not break message persistence or detach behavior.                                      | R-007, R-012, R-019                      | Persisted-run readback tests, adapter persistence tests, detach regression tests.                        | Command and adapter test output.                           |
| Compatibility              | Envelopes use `workflow-command-envelope.v1`, canonical command ids, stable error categories, correct refs, and documented fixture deltas. | R-001, R-006, R-010, R-014, R-015        | Schema/fixture comparisons, state mapper tests, validator, correlation id tests.                         | Contract test output and validator output.                 |
| Maintainability            | Strict TypeScript, no contract edits, no production planning imports, package test isolation.                                              | R-016, R-017, R-020                      | Type-check, package-script review, import/dependency scans, full validation.                             | `bun --filter @archon/cli type-check`, `bun run validate`. |
| Performance / scalability  | UNKNOWN. No numeric SLO exists; foreground start intentionally blocks.                                                                     | R-015, R-018                             | Waivers W-3.3B-003 and W-3.3B-009.                                                                       | No load test required until a threshold exists.            |
| Permission / authorization | No app-level auth policy; local CLI inherits OS-process trust.                                                                             | W-3.3B-007                               | Scope review only.                                                                                       | Waiver and no-new-remote-surface evidence.                 |
| Compliance                 | No regulatory requirement stated.                                                                                                          | N/A                                      | Contract traceability only.                                                                              | This document plus validator output.                       |

**Unknown thresholds:** foreground command latency, workflow duration, OS-level cancellation guarantees, load/throughput, and remote/multi-user authorization are UNKNOWN and must not be guessed.

## Entry Criteria

- [ ] Story 3.3b requirements and scope boundaries are accepted by story owner and CLI implementer.
- [ ] Story 3.3a shared envelope module and tests are present and passing.
- [ ] Canonical `validate_contracts.py` passes before implementation edits.
- [ ] Test owner agrees whether any new test file uses `mock.module()` and updates `packages/cli/package.json` isolation accordingly.
- [ ] Product/architecture owners accept W-3.3B-002, W-3.3B-003, W-3.3B-004, and W-3.3B-006 before production consumer dependency.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] All P1 scenarios pass or have approved waiver with owner, residual risk, and trigger.
- [ ] No score >=6 risk lacks scenario evidence or waiver.
- [ ] JSON-mode stdout purity passes for start and status failure boundaries.
- [ ] Non-JSON and detach regressions pass unchanged.
- [ ] Canonical contract validator passes unchanged.
- [ ] `bun --filter @archon/cli type-check` passes.
- [ ] `bun run validate` passes before review.

## Test Coverage Plan

P0/P1/P2/P3 are priority/risk levels, not execution timing.
Execution timing is defined separately in the Execution Strategy section.

### P0 Critical

| Test ID           | Requirement                              | Test Level      | Risk Link           | Notes                                       |
| ----------------- | ---------------------------------------- | --------------- | ------------------- | ------------------------------------------- |
| 3.3B-UNIT-001     | Start completed success envelope         | Command unit    | R-001, R-007        | One `workflow.start` success document.      |
| 3.3B-UNIT-002     | Pending state mapping                    | Unit            | R-006               | Table row or standalone case.               |
| 3.3B-UNIT-003     | Running state mapping                    | Unit            | R-006               | No fake terminal.                           |
| 3.3B-UNIT-004     | Paused approval mapping                  | Unit            | R-006               | Includes actionRequired/gateRef.            |
| 3.3B-UNIT-005     | Paused interactive loop mapping          | Unit            | R-006               | No human-decision gate.                     |
| 3.3B-UNIT-006     | Paused absent/malformed approval mapping | Unit            | R-006               | Conservative `paused`.                      |
| 3.3B-UNIT-007     | Terminal state mapping                   | Unit            | R-006, R-014        | completed/failed/cancelled, no `phase`.     |
| 3.3B-UNIT-009     | Start failed execution with run id       | Command unit    | R-008               | Structured details only.                    |
| 3.3B-UNIT-010     | Start failed execution without run id    | Command unit    | R-008               | `requestAccepted:false`.                    |
| 3.3B-UNIT-012     | Early start error fail-closed            | Command unit    | R-004, R-009        | Unknown workflow/load error.                |
| 3.3B-UNIT-015     | Start JSON stdout purity                 | Command unit    | R-002               | Exactly one line, no human strings.         |
| 3.3B-UNIT-016     | Paused approval start JSON               | Command unit    | R-002, R-006        | One envelope with gateRef.                  |
| 3.3B-UNIT-019     | Status not-found envelope                | Command unit    | R-005               | Exit 78.                                    |
| 3.3B-UNIT-020     | Status DB-error envelope                 | Command unit    | R-005, R-008        | No raw DB message in details.               |
| 3.3B-UNIT-021     | Status completed success envelope        | Command unit    | R-001, R-005        | `workflow.status`, terminal true.           |
| 3.3B-UNIT-022     | Status paused approval envelope          | Command unit    | R-005, R-006        | `waiting-for-approval`.                     |
| 3.3B-CLI-031      | Missing workflow name dispatch           | CLI subprocess  | R-003               | `MALFORMED_REQUEST`, exit 64.               |
| 3.3B-CLI-032      | Bad run flag combinations dispatch       | CLI subprocess  | R-003               | No `console.error` shortcut.                |
| 3.3B-CLI-033      | Missing get run id dispatch              | CLI subprocess  | R-003               | `workflow.status`, exit 64.                 |
| 3.3B-CLI-035      | Unknown workflow subprocess              | CLI subprocess  | R-003, R-004, R-009 | One classified JSON envelope.               |
| 3.3B-CONTRACT-036 | Forbidden key/text-key scan              | Contract/static | R-008, R-016        | Parsed envelopes or narrow helper payloads. |
| 3.3B-CONTRACT-039 | Canonical validator                      | Contract/static | R-001               | Contracts unchanged.                        |

**Total P0:** 22 scenarios, ~18-30 hours.

### P1 High

| Test ID           | Requirement                                   | Test Level      | Risk Link    | Notes                                      |
| ----------------- | --------------------------------------------- | --------------- | ------------ | ------------------------------------------ |
| 3.3B-UNIT-008     | workflowRunRef projectRef derivation/omission | Command unit    | R-007        | `project:<codebase_id>` only when present. |
| 3.3B-UNIT-011     | Persisted run reload failure                  | Command unit    | R-007        | Internal error exit 70.                    |
| 3.3B-UNIT-013     | Blocking start semantics locked               | Command unit    | R-015        | No fake async `running`.                   |
| 3.3B-UNIT-014     | CLIAdapter silent mode                        | Adapter unit    | R-002, R-012 | No stdout, persistence preserved.          |
| 3.3B-UNIT-017     | Error classification table                    | Unit            | R-009, R-018 | 64/69/70/78.                               |
| 3.3B-UNIT-018     | Start correlation id                          | Command unit    | R-010        | Success and errors.                        |
| 3.3B-UNIT-023     | Status failed run shape                       | Command unit    | R-005, R-008 | State failed, no raw metadata leak.        |
| 3.3B-UNIT-024     | Status correlation id                         | Command unit    | R-010        | Success, not-found, DB error.              |
| 3.3B-UNIT-025     | Verbose events under result.events            | Command unit    | R-013        | Omitted when non-verbose.                  |
| 3.3B-UNIT-026     | Verbose event order projection                | Command unit    | R-013        | Does not interpret event ordering.         |
| 3.3B-UNIT-027     | Adapter persistence failure handling          | Command unit    | R-012        | No stdout corruption.                      |
| 3.3B-UNIT-028     | Duplicate/concurrent start isolation          | Command unit    | R-019        | Correlation/run refs do not mix.           |
| 3.3B-UNIT-029     | Timeout classification                        | Unit            | R-009, R-018 | `COMMAND_TIMEOUT`.                         |
| 3.3B-UNIT-030     | Cancelled state mapping                       | Unit            | R-006, R-018 | OS kill guarantee waived.                  |
| 3.3B-CLI-034      | Correlation id through argv                   | CLI subprocess  | R-010        | Run and get.                               |
| 3.3B-CONTRACT-037 | Fixture conformance with field delta          | Contract/static | R-014        | No fake phase/projectBindingRef.           |
| 3.3B-CONTRACT-038 | Shared envelope regression                    | Contract/static | R-016        | 3.3a helper unchanged.                     |
| 3.3B-CONTRACT-040 | No contract edits/runtime planning imports    | Contract/static | R-016, R-020 | Scope and package hygiene.                 |
| 3.3B-REG-041      | Non-JSON regression                           | Regression      | R-011        | Existing human behavior.                   |
| 3.3B-REG-042      | Detach ack regression                         | Regression      | R-011        | Existing `{ ok:true, detached:true }`.     |
| 3.3B-REG-043      | Provider-binding regression                   | Regression      | R-016        | Binding commands unaffected.               |
| 3.3B-CI-044       | Package test isolation                        | CI/static       | R-017        | `workflow.test.ts` stays isolated.         |
| 3.3B-CI-045       | Focused validation commands                   | CI              | R-017, R-020 | Tests + type-check.                        |
| 3.3B-CI-046       | Full validation                               | CI              | R-020        | `bun run validate`.                        |
| 3.3B-CI-047       | File-scope review                             | Static/review   | R-020        | No server/web/core DB/event scope creep.   |

**Total P1:** 25 scenarios, ~20-34 hours.

### P2 / P3

No P2/P3 scenarios are required.
Low-risk or excluded behavior is handled by waivers and normal review gates.

## Waivers

| ID         | Reason                                                                                                                    | Owner                         | Residual risk                                             | Follow-up trigger                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| W-3.3B-001 | `--detach --json` is outside this story because the parent lacks a real run id for required `workflowRunRef`.             | CLI owner + product owner     | Detach JSON remains legacy.                               | Future story makes detach/async start envelope-shaped.                       |
| W-3.3B-002 | Strict byte-for-byte parity for `phase` and `projectBindingRef` is out of scope; those are Hermes/BMAD concepts.          | Contract owner                | Runtime omits illustrative fixture fields.                | Contract makes them required or Archon owns phase/project binding semantics. |
| W-3.3B-003 | True non-blocking start is out of scope; foreground run remains blocking.                                                 | Product + architecture owners | Hermes may need an async-start story.                     | Consumer requires immediate start acknowledgement.                           |
| W-3.3B-004 | Top-level `bindingRef`/`projectBindingRef` is not applicable unless a real binding exists.                                | Product + contract owners     | AC wording is satisfied only "when applicable".           | Workflow command becomes binding-aware.                                      |
| W-3.3B-005 | HTTP, Web UI, workflow events, delivery health, Hermes ingestion, reconciliation, and project-work mutation are excluded. | Architecture owner            | No full producer-consumer runtime integration here.       | Accepted story activates one of those surfaces.                              |
| W-3.3B-006 | OS-level kill/abort final-envelope guarantee is undefined.                                                                | CLI architecture owner        | Externally killed process may not emit final JSON.        | Runtime timeout/abort contract is accepted.                                  |
| W-3.3B-007 | No app-level auth policy applies to local CLI under OS-process trust.                                                     | Security owner                | Local users with CLI/DB access can invoke commands.       | Remote, multi-user, service-account, or role policy is introduced.           |
| W-3.3B-008 | Out-of-order workflow event ingestion is not applicable; only stored event projection is in scope.                        | Workflow event owner          | Event ordering/idempotency defects are not detected here. | Story 3.5/3.7 or callback ingress activates event delivery/receipt.          |
| W-3.3B-009 | No performance/load threshold exists.                                                                                     | Product/operations owner      | Slow command paths have no numeric SLO.                   | Latency SLO, remote exposure, or performance incident is accepted.           |

## Mandatory Traceability

| Item             | Scenario or waiver coverage                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AC1 start JSON   | 3.3B-UNIT-001, 008, 011, 013-018, 027-028, 3.3B-CLI-034, 3.3B-CONTRACT-036-037, W-3.3B-002, W-3.3B-003, W-3.3B-004                 |
| AC2 status JSON  | 3.3B-UNIT-002-007, 019-026, 030, 3.3B-CLI-033-034, 3.3B-CONTRACT-036-037, W-3.3B-002                                               |
| AC3 failure JSON | 3.3B-UNIT-009-012, 017, 019-020, 029, 3.3B-CLI-031-035, 3.3B-CONTRACT-036, 039                                                     |
| R-001            | 3.3B-UNIT-001, 019, 021-022, 3.3B-CONTRACT-036, 039                                                                                |
| R-002            | 3.3B-UNIT-014-016, 027, 3.3B-CLI-031-035                                                                                           |
| R-003            | 3.3B-CLI-031-033                                                                                                                   |
| R-004            | 3.3B-UNIT-012, 3.3B-CLI-035                                                                                                        |
| R-005            | 3.3B-UNIT-019-025                                                                                                                  |
| R-006            | 3.3B-UNIT-002-007, 016, 022, 030                                                                                                   |
| R-007            | 3.3B-UNIT-008, 011                                                                                                                 |
| R-008            | 3.3B-UNIT-009-010, 020, 023, 3.3B-CONTRACT-036                                                                                     |
| R-009            | 3.3B-UNIT-017, 029, 3.3B-CLI-032, 035                                                                                              |
| R-010            | 3.3B-UNIT-018, 024, 3.3B-CLI-034                                                                                                   |
| R-011            | 3.3B-REG-041-042                                                                                                                   |
| R-012            | 3.3B-UNIT-014, 027                                                                                                                 |
| R-013            | 3.3B-UNIT-025-026                                                                                                                  |
| R-014            | 3.3B-UNIT-007, 013, 3.3B-CONTRACT-037, W-3.3B-002                                                                                  |
| R-015            | 3.3B-UNIT-013, W-3.3B-003                                                                                                          |
| R-016            | 3.3B-CONTRACT-036, 038, 040, 3.3B-REG-043                                                                                          |
| R-017            | 3.3B-CI-044-046                                                                                                                    |
| R-018            | 3.3B-UNIT-029-030, W-3.3B-006                                                                                                      |
| R-019            | 3.3B-UNIT-028                                                                                                                      |
| R-020            | 3.3B-CONTRACT-040, 3.3B-CI-045-047                                                                                                 |
| RC-01..RC-27     | Each reviewer concern is mapped in the Reviewer-Evidence Disposition table above to a scenario or waiver defined in this document. |

## Execution Strategy

Run everything in PRs if the focused CLI package suite stays under normal CI time.
Defer only expensive or externally dependent work; none is required for this story.

- PR: P0/P1 command, adapter, contract/static, and narrow subprocess tests; contract validator; `bun --filter @archon/cli type-check`.
- Pre-review: `bun run validate`.
- Nightly/weekly: none required for this story.

## Resource Estimates

| Priority       |        Count | Total Hours | Notes                                                           |
| -------------- | -----------: | ----------: | --------------------------------------------------------------- |
| P0             |           22 |      ~18-30 | Contract-critical behavior and fail-closed edges.               |
| P1             |           25 |      ~20-34 | Regression, dependency failure, CI/static, and waiver evidence. |
| P2/P3          |            0 |           0 | Not needed.                                                     |
| Waiver/process |    9 waivers |        ~3-6 | Owner review, completion-note deltas, scope checks.             |
| Total          | 47 scenarios |      ~41-70 | Roughly 5-9 engineering days.                                   |

## Prerequisites

**Test Data**

- Mock `WorkflowRun` fixtures for every status and approval metadata subcase.
- Mock `executeWorkflow` results for success, paused, failed with run id, failed without run id, and thrown errors.
- Mock workflow event rows for verbose status.

**Tooling**

- `bun:test` for unit, adapter, command, and contract/static tests.
- `Bun.spawn` subprocess harness for argv/exit/stdout checks.
- `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py`.

**Environment**

- Run from the Archon repo root.
- Do not use root `bun test`; use focused files or package scripts.

## Quality Gate Criteria

### Pass/Fail Thresholds

- P0 pass rate: 100%.
- P1 pass rate: >=95%, with approved waivers for any remaining failures.
- P2/P3: N/A.
- High-risk mitigations: 100% complete or approved waiver.

### Coverage Targets

- Critical contract paths: >=80% targeted coverage, with all P0 paths explicitly tested.
- Security/forbidden-key scenarios: 100%.
- Failure classification scenarios: 100% for malformed, timeout, internal error, unexpected state/not found, and failed execution.
- Edge cases: all applicable categories from this handoff covered by scenario or waiver.

### Non-Negotiable Requirements

- [ ] All P0 tests pass.
- [ ] No open score >=6 risk lacks evidence or waiver.
- [ ] JSON-mode stdout purity passes for start and status boundaries.
- [ ] Non-JSON and detach regressions pass.
- [ ] Contract validator passes unchanged.
- [ ] Full NFR evidence decision is deferred to `nfr-assess`.

## Mitigation Plans

| Risk              | Mitigation Strategy                                                                     | Verification                              |
| ----------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| R-001/R-005/R-006 | Build local workflow command mapping and envelope tests around real `WorkflowRun` data. | 3.3B-UNIT-001-007, 019-025, CONTRACT-039. |
| R-002/R-003/R-004 | Add fail-closed JSON boundary and argv subprocess coverage.                             | 3.3B-UNIT-012, 015-016, CLI-031-035.      |
| R-008/R-016       | Keep raw diagnostics in logs only; validate parsed envelopes for forbidden keys.        | 3.3B-UNIT-009-010/020/023, CONTRACT-036.  |
| R-011/R-012/R-017 | Preserve existing behavior and package isolation.                                       | REG-041-043, UNIT-014/027, CI-044.        |
| R-014/R-015/R-018 | Use explicit waivers for accepted scope boundaries, not silent test weakening.          | W-3.3B-002/003/006 and completion notes.  |

## Assumptions And Dependencies

### Assumptions

1. Story 3.3b remains limited to foreground `workflow run --json` and `workflow get --json`.
2. `workflow-provider-command-envelope.ts` from Story 3.3a remains the shared helper and is not changed for this story.
3. Hermes can consume the documented blocking-start semantics or will request a separate async-start story.

### Dependencies

1. Story 3.3a shared envelope module and tests.
2. Existing `workflow.test.ts` mock isolation in `packages/cli/package.json`.
3. Workflow Commander contract package and validator.

### Risks To Plan

- If Hermes requires immediate non-blocking start acknowledgement, Story 3.3b must not stretch silently; create a separate async-start story.
- If contract owners decide `phase` or `projectBindingRef` must be required, this story needs a contract change before implementation.
- If OS-level process supervision is needed, define a timeout/abort contract before claiming end-to-end cancellation guarantees.

## Follow-On Workflows

- Run `*atdd` to generate failing P0 tests from this plan.
- Run `*automate` for broader coverage once implementation exists.
- Run `nfr-assess` after implementation evidence exists.
