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
lastSaved: '2026-07-13'
mode: 'epic-level'
epic: '3'
story: '3.1'
status: 'draft'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/implementation-readiness-report-2026-07-12.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/README.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-provider-binding.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-*.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/error-malformed-request.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/bindings/status-*.json'
  - 'packages/core/package.json'
  - 'packages/cli/package.json'
  - 'packages/core/src/db/user-provider-key-store.test.ts'
  - 'packages/core/src/db/adapters/sqlite.test.ts'
  - 'packages/core/src/db/adapters/postgres.test.ts'
  - 'packages/cli/src/cli.ts'
  - '.agents/skills/bmad-testarch-test-design/resources/tea-index.csv'
---

# Test Design: Epic 3 - Story 3.1 Archon Workflow Provider Binding Lifecycle

**Date:** 2026-07-13  
**Author:** kevin  
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for Story 3.1, covering Archon's CLI-only provider-binding persistence and lifecycle contract across SQLite and PostgreSQL schema paths.

The plan contains 69 atomic scenarios: 24 P0 and 45 P1.
No P0/P1 edge case is implied; every acceptance criterion, score-6+ risk, and known reviewer concern maps to explicit scenarios or a named waiver.

**Risk summary:**

- 16 genuine risks, all score 6 or 9 because they affect core behavior, security, data integrity, compatibility, or controller-facing machine contracts.
- Five P0 risk themes: contract-family compatibility, pure JSON/fail-closed output, create/update data semantics under races, project/route identity, and zero secret exposure.
- Ten explicit waivers cover only undefined or excluded behavior and include owner, residual risk, and follow-up trigger.

**Effort summary:**

- P0 scenarios and harness: ~28–44 hours.
- P1 scenarios, races, backend upgrades, and fault injection: ~32–52 hours.
- Optional burn-in support: ~4–8 hours.
- Total: ~64–108 hours, approximately 1.5–3 calendar weeks for one implementer depending on harness and concurrency complexity.

## Pre-Implementation Decisions

The following decisions must be ratified before the affected task is accepted:

1. Define the external `--project-ref` form and its mapping to `remote_agent_codebases.id`, including the namespaced-string fixture form.
2. Define empty/whitespace handling and canonicalization for provider, name, and route; no silent normalization may alias identities.
3. Define the exact duplicate-disable result and update/rotate behavior after a binding is disabled.
4. Accept or resolve the timeout/cancellation waiver before this local CLI is exposed as a remotely supervised controller surface.
5. Record the actor and stale-detection contract gaps in completion notes; do not invent fields or reconciliation behavior.

## Not in Scope

| Item                                                                      | Reasoning                                                 | Mitigation                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Workflow run control commands                                             | Owned by Stories 3.3a–3.3d.                               | Existing command tests remain in full regression.               |
| Workflow events, outbox, signing, and delivery                            | Owned by Stories 3.5 and 3.7.                             | Assert no raw secret/signing material is introduced here.       |
| Hermes Project Binding, reconciliation, diagnostics, and user interaction | Explicit consumer-side ownership.                         | Keep controller identity generic and use shared contracts only. |
| Archon HTTP routes and Web UI                                             | PRD requires a headless CLI-only v1 surface.              | Change-scope review and no-remove/unsupported-command tests.    |
| Runtime application schema for `workflow-provider-binding.v1`             | No application caller exists in this story.               | W-002; contract-package validator still validates that family.  |
| Load/performance benchmark                                                | No throughput or latency target exists for the local CLI. | W-010; add only when a remote/concurrent SLO is accepted.       |

## Risk Assessment

Probability and Impact use 1–3; Score = Probability × Impact.
Scores 6–8 require mitigation and score 9 blocks acceptance.
Priority is promoted to P0/P1 whenever failure can break core behavior, security, data integrity, compatibility, or a cross-process contract.

| ID    | Category  | Risk                                                                                               |   P |   I | Score | Pri | Mitigation / verification                                                               | Owner / timeline                                     | Status              | Residual risk                                                              |
| ----- | --------- | -------------------------------------------------------------------------------------------------- | --: | --: | ----: | --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| R-001 | TECH/BUS  | Command and binding contract families, result keys, or project-ref shapes are conflated.           |   3 |   3 |     9 | P0  | Exact command-fixture equality, schema validation, and negative field checks.           | CLI implementer + contract reviewer / Tasks 1 and 4  | Planned             | Consumer breakage if semantic equality is weaker than static-key equality. |
| R-002 | BUS/OPS   | `--json` emits logs, prose, multiple documents, malformed JSON, or unstructured errors.            |   3 |   3 |     9 | P0  | Raw process stdout/stderr/exit capture for every verb and failure class.                | CLI implementer / every task gate                    | Planned             | Unhandled process-level fatal errors could bypass the handler.             |
| R-003 | DATA/BUS  | Create/update become upsert behavior or duplicate races violate unique identity.                   |   3 |   3 |     9 | P0  | SQL-shape, unique-constraint, transition, and deterministic race tests.                 | Core DB implementer / Tasks 1–2                      | Planned             | Backend-specific locking may expose race behavior not reproduced by mocks. |
| R-004 | DATA/BUS  | Project-ref ambiguity resolves the wrong codebase, auto-registers data, or loses the route.        |   3 |   3 |     9 | P0  | Ratified mapping plus reject-before-write, mismatch, and route round-trip tests.        | Architecture owner + CLI implementer / before Task 1 | Blocked on decision | External fixture string and local UUID semantics may diverge.              |
| R-005 | BUS       | Required status states, especially stale, are falsely projected or cannot be represented.          |   2 |   3 |     6 | P1  | Explicit state scenarios plus W-001 for active stale detection.                         | Contract owner + core implementer / Task 4           | Planned             | Stale bindings remain undetected until protocol ownership is defined.      |
| R-006 | DATA      | SQLite update-then-select returns a row changed by a concurrent action.                            |   2 |   3 |     6 | P1  | Race tests, monotonic versions, transaction/CAS if interleaving is observed.            | Core DB implementer / Tasks 2–3                      | Planned             | Cross-process scheduling can expose new interleavings.                     |
| R-007 | TECH/DATA | PostgreSQL, bundled schema, and SQLite schema drift or upgrade incorrectly.                        |   2 |   3 |     6 | P1  | Fresh/upgrade/repeat schema tests, generated check, and full validation.                | Core DB implementer / Task 1 and pre-PR              | Planned             | No live PostgreSQL lane exists by default.                                 |
| R-008 | SEC       | Rotation stores or emits raw secrets/signing material.                                             |   2 |   3 |     6 | P0  | Counter-only tests and recursive DB/output secret scans.                                | Security reviewer + core implementer / Task 3        | Planned             | Future delivery stories may add separate secret references.                |
| R-009 | DATA/OPS  | Disable deletes history, is ambiguous when repeated, or exposes remove behavior.                   |   2 |   3 |     6 | P1  | Retention, duplicate-disable, race, and unsupported-remove tests.                       | Product/architecture + core implementer / Task 3     | Blocked on decision | Post-disabled transition semantics are not defined.                        |
| R-010 | BUS/SEC   | Hermes-specific keys or unsupported top-level actor break closed schemas.                          |   2 |   3 |     6 | P1  | Recursive forbidden-key checks and W-003 actor gap.                                     | Contract owner + CLI implementer / Task 4            | Planned             | Actor attribution remains absent.                                          |
| R-011 | DATA/OPS  | Dependency or follow-up-read failures produce false success or unclear partial mutation.           |   2 |   3 |     6 | P1  | Fault injection at lookup/write/read/serialization boundaries.                          | Core + CLI implementers / each task                  | Planned             | A committed mutation can remain uncertain when the read fails.             |
| R-012 | DATA/BUS  | Boundary values or lossy binding-ID derivation create collisions or invalid identities.            |   2 |   3 |     6 | P1  | Explicit validation/canonicalization decision, boundary, Unicode, and collision tests.  | Contract/architecture owner / before Task 1          | Blocked on decision | Maximum input length remains undefined under W-008.                        |
| R-013 | OPS/DATA  | Partial migration/task delivery cannot roll back independently or leaves one backend unusable.     |   2 |   3 |     6 | P1  | Per-task rollback, additive-upgrade, transaction-failure, and convergence evidence.     | Story owner / every task                             | Planned             | Manual rollback can still require operator coordination.                   |
| R-014 | TECH      | Bun `mock.module()` pollution makes tests order-dependent or falsely green.                        |   3 |   2 |     6 | P1  | Separate test invocation and repeated focused/package runs.                             | Test implementer / when adding tests                 | Planned             | New future mocks can reintroduce collisions.                               |
| R-015 | BUS       | Correlation/timestamp metadata is blank, invalid, inconsistent, or over-normalized in comparisons. |   2 |   3 |     6 | P1  | Fixed-value unit tests, generated-format tests, and path-limited fixture normalization. | CLI implementer / Tasks 1–4                          | Planned             | Clock behavior outside process control is not tested.                      |
| R-016 | OPS/BUS   | Hung/cancelled DB work has no terminal controller contract.                                        |   2 |   3 |     6 | P1  | Injected timeout-envelope test and W-004 for enforcement/cancellation.                  | CLI architecture owner / before remote exposure      | Waived in local v1  | A never-settling dependency can hang the process.                          |

### Risk Category Legend

- **TECH:** architecture, integration, and compatibility implementation risks.
- **SEC:** secret exposure and trust-boundary risks.
- **PERF:** latency, throughput, and resource risks.
- **DATA:** data loss, corruption, collision, and inconsistent state.
- **BUS:** controller-visible behavior and contract outcomes.
- **OPS:** deployment, rollback, timeout, and test-operation risks.

## Reviewer-Evidence Disposition

Every concern in the story's contract-gap, fixture-strategy, project-ref, database, CLI, and test-isolation notes is treated as evidence.

| Concern                                                                   | Disposition                                                     |   P |   I | Score | Scenario or waiver                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- | --: | --: | ----: | ------------------------------------ |
| RC-01 Actor absent from closed schemas                                    | Risk: adding it breaks compatibility; omission needs follow-up. |   2 |   3 |     6 | UNIT-034, CONTRACT-001, W-003        |
| RC-02 Stale has no detection trigger                                      | Risk: false stale/valid classification.                         |   2 |   3 |     6 | UNIT-018, CONTRACT-002, W-001        |
| RC-03 Rotate is version-only                                              | Security risk if treated as secret rotation.                    |   2 |   3 |     6 | UNIT-009/034, INT-008, CI-002        |
| RC-04 Route key absent from fixtures                                      | Risk: dropped or inconsistent route data.                       |   2 |   3 |     6 | UNIT-002/004/008/024/026/029         |
| RC-05 Contract families are not interchangeable                           | Critical compatibility risk.                                    |   3 |   3 |     9 | CLI-001–006, CONTRACT-001/004        |
| RC-06 `bindingVersion`/`activeVersion` and project-ref shapes differ      | Critical compatibility risk despite permissive nested objects.  |   3 |   3 |     9 | CLI-001–006, CONTRACT-001/004        |
| RC-07 Runtime binding-domain schema is out of scope                       | Explicit non-risk: no current application caller.               |   1 |   1 |     1 | CONTRACT-002/003, W-002              |
| RC-08 Project-ref recommendation differs from fixture style               | Critical identity ambiguity.                                    |   3 |   3 |     9 | UNIT-006/007/017, CLI-009            |
| RC-09 Create never upserts; update never creates                          | Critical data-integrity risk.                                   |   3 |   3 |     9 | UNIT-002–005, INT-005–007            |
| RC-10 SQLite requires update then select                                  | Concurrency/stale-observation risk.                             |   2 |   3 |     6 | UNIT-009/037, INT-008/009            |
| RC-11 Disable must be idempotent-safe, retain history, and have no remove | Data/audit risk.                                                |   2 |   3 |     6 | UNIT-011/012/040, INT-009/010, W-009 |
| RC-12 JSON stdout must contain only payload                               | Critical controller-contract risk.                              |   3 |   3 |     9 | CLI-007/008                          |
| RC-13 Local builder allowed until Story 3.3a                              | Explicit non-risk with a regression trigger.                    |   1 |   2 |     2 | CLI-001–006, W-007                   |
| RC-14 Contract package is immutable and validator-gated                   | Risk if contracts are edited to fit runtime.                    |   2 |   3 |     6 | CONTRACT-003/004, CI-004             |
| RC-15 Both DB schemas and bundled schema must change                      | Cross-backend compatibility risk.                               |   2 |   3 |     6 | INT-001–004/011, CI-001/004          |
| RC-16 `mock.module()` requires package isolation                          | Test reliability risk.                                          |   3 |   2 |     6 | CI-003/004                           |
| RC-17 HTTP/UI/Hermes/event behavior excluded                              | Explicit non-risk under accepted boundary.                      |   1 |   2 |     2 | UNIT-040, CI-005, W-006              |
| RC-18 Correlation ID has no existing Archon convention                    | Contract metadata risk.                                         |   2 |   3 |     6 | UNIT-032/033, CONTRACT-004           |
| RC-19 Binding ID may be derived                                           | Collision risk only if derivation is lossy.                     |   2 |   3 |     6 | UNIT-030/031                         |
| RC-20 Global `(provider,name)` uniqueness is proposed                     | Explicit non-risk if controller identity remains global.        |   1 |   3 |     3 | INT-001/005                          |
| RC-21 No application auth requirement                                     | Explicit non-risk under local OS-process trust.                 |   1 |   3 |     3 | W-005                                |
| RC-22 Timeout/cancellation unspecified                                    | Controller availability risk.                                   |   2 |   3 |     6 | UNIT-038, W-004                      |
| RC-23 Each slice needs independent rollback                               | Operational/data risk.                                          |   2 |   3 |     6 | INT-002/003/011, CI-005              |
| RC-24 Dependency/follow-up-read failure                                   | Partial-failure/false-success risk.                             |   2 |   3 |     6 | UNIT-035–039                         |

## NFR Planning

This section plans evidence only; final PASS/CONCERNS/FAIL decisions belong to `nfr-assess` after implementation.

| NFR                     | Requirement / threshold                                                                                                        | Risk                       | Planned validation                    | Evidence needed                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Security                | Zero raw secret/signature material; zero forbidden Hermes keys; closed top-level schema; redacted execution flags on failures. | R-008, R-010               | UNIT-034, CONTRACT-001/003, CI-002    | Bun results, contract-validator output, recursive scan result |
| Reliability             | Preconditions/dependency failures never emit success; duplicate/racing actions preserve legal state; disable retains the row.  | R-003, R-006, R-009, R-011 | UNIT-002–019/035–038, INT-005–010     | Focused test output and deterministic race logs               |
| Data integrity          | One `(provider,name)` row; create insert-only; update update-only; route/codebase preserved; DB schemas converge.              | R-003, R-004, R-007        | UNIT-002–008, INT-001–007/011, CI-001 | DB assertions, generated-schema check                         |
| Compatibility           | Exactly one parseable `workflow-command-envelope.v1`; static fixture fields equal; only documented dynamic paths differ.       | R-001, R-002, R-015        | CLI-001–009, CONTRACT-001–004         | Captured stdout/exit, fixture diff, schema result             |
| Auditability            | Correlation/timestamp always present; disable does not delete. Actor threshold is UNKNOWN because schemas forbid it.           | R-009, R-010, R-015        | UNIT-011/032/033, INT-010, W-003      | Metadata assertions, retained row, waiver                     |
| Maintainability         | Strict TypeScript, zero lint warnings, synchronized generated schema, deterministic package-isolated tests.                    | R-007, R-013, R-014        | CI-001/003/004/005                    | `bun run validate` and package-script evidence                |
| Performance/scalability | UNKNOWN: no CLI latency, throughput, or cancellation threshold is defined.                                                     | R-016                      | UNIT-038, W-004, W-010                | No final assessment until a threshold exists                  |
| Permission/auth         | Current requirement is local OS-process trust; no application role policy exists.                                              | —                          | W-005                                 | Security waiver and re-review trigger                         |
| Compliance              | No regulatory requirement is stated.                                                                                           | —                          | Contract/audit traceability only      | Validator and traceability artifact                           |

## Entry Criteria

- [ ] Project-ref normalization is ratified.
- [ ] Input canonicalization, duplicate-disable result, and disabled-state transitions are decided.
- [ ] The checked-in contract validator passes unchanged.
- [ ] Test files are assigned to package-isolated Bun invocations before mocks are added.
- [ ] Temporary SQLite fixtures and deterministic time/correlation injection are available.
- [ ] The task's production slice, focused tests, evidence, and rollback boundary are identified.

## Exit Criteria

- [ ] P0 and P1 pass rates are 100%; no P0/P1 skip, quarantine, or retry masking exists.
- [ ] Every AC, score-6+ risk, and reviewer concern retains scenario-or-waiver traceability.
- [ ] No open P0/P1 defect or unowned high-risk waiver remains.
- [ ] Exact command fixtures and the canonical contract validator pass without contract edits.
- [ ] SQLite, PostgreSQL combined schema, and bundled schema are synchronized.
- [ ] Security scenarios pass 100%, including secret and forbidden-key scans.
- [ ] Each in-scope NFR has an evidence artifact; final NFR status remains deferred.
- [ ] `bun run validate` passes.

## Test Coverage Plan

P0/P1/P2/P3 indicate risk priority, not execution timing.
All deterministic functional tests run in PRs.

### Test-Level Allocation

- **Unit (Bun):** row schema, SQL/branch logic with mocked `pool.query`, envelope construction, input validation, metadata, and fault injection.
- **DB integration (Bun):** temporary real SQLite databases for DDL, uniqueness, upgrades, repeated initialization, and races; mocked PostgreSQL adapter initialization for schema transaction behavior.
- **CLI integration/E2E (Bun):** command handler plus a narrow subprocess harness for argv dispatch, exit code, stdout/stderr, and log silence.
- **Contract regression:** JSON fixtures, JSON Schema, and `validate_contracts.py`.
- **CI/static:** generated schema, secret/scope checks, package isolation, and the full validation gate.

There is no API, UI component, browser, or Web E2E layer in this story.
Cross-level overlap is reserved for P0 behavior where each layer proves a distinct property.

### P0 Scenarios

| Test ID          | Requirement                                                                        | Level          | Risk                | Notes                        |
| ---------------- | ---------------------------------------------------------------------------------- | -------------- | ------------------- | ---------------------------- |
| 3.1-UNIT-002     | Create persists registered identity and route using insert-only conflict behavior. | Unit           | R-003, R-004        | SQL and parameters           |
| 3.1-UNIT-003     | Create-existing fails without mutation.                                            | Unit           | R-003               | Negative path                |
| 3.1-UNIT-004     | Update-existing changes intended metadata only.                                    | Unit           | R-003, R-004        | Happy path                   |
| 3.1-UNIT-005     | Update-missing never inserts.                                                      | Unit           | R-003               | Out-of-order update          |
| 3.1-UNIT-006     | Ratified project-ref maps to stored codebase and emitted string reference.         | Unit           | R-004               | Identity contract            |
| 3.1-UNIT-007     | Unknown/ambiguous project-ref fails before mutation and never auto-registers.      | Unit           | R-004               | Negative/dependency path     |
| 3.1-UNIT-008     | Event route round-trips across create and update.                                  | Unit           | R-004               | Opaque route                 |
| 3.1-UNIT-020     | Missing provider+name matches malformed fixture field errors.                      | Unit           | R-002               | Malformed input              |
| 3.1-UNIT-034     | Output contains no secret, actor, or Hermes-specific field.                        | Unit           | R-008, R-010        | Security/compatibility       |
| 3.1-INT-001      | Fresh SQLite schema has FK, defaults, and unique identity.                         | DB integration | R-003, R-007        | Real SQLite                  |
| 3.1-INT-005      | Concurrent duplicate creates produce one row and one loser.                        | DB integration | R-003               | Race                         |
| 3.1-INT-006      | Concurrent create/update yields only legal outcomes and no duplicate.              | DB integration | R-003, R-006        | Race                         |
| 3.1-INT-007      | Create→update→create preserves distinct command semantics.                         | DB integration | R-003               | Regression                   |
| 3.1-CLI-001      | Create output exactly matches command fixture.                                     | CLI contract   | R-001, R-002        | Dynamic fields only excluded |
| 3.1-CLI-002      | Update output exactly matches command fixture.                                     | CLI contract   | R-001, R-002        | Static equality              |
| 3.1-CLI-003      | Status output exactly matches command fixture.                                     | CLI contract   | R-001, R-002        | Static equality              |
| 3.1-CLI-004      | Rotate output exactly matches command fixture.                                     | CLI contract   | R-001, R-002, R-008 | Version-only                 |
| 3.1-CLI-005      | Disable output exactly matches command fixture.                                    | CLI contract   | R-001, R-002, R-009 | No delete                    |
| 3.1-CLI-006      | Malformed output exactly matches error fixture and redaction.                      | CLI contract   | R-001, R-002        | Nonzero exit                 |
| 3.1-CLI-007      | Actual argv for all five verbs emits one pure JSON stdout document.                | CLI E2E        | R-002               | Dispatch/log silence         |
| 3.1-CLI-008      | Actual malformed argv emits one failure document and nonzero exit.                 | CLI E2E        | R-002               | Fail closed                  |
| 3.1-CONTRACT-001 | Every live command validates against the command-envelope schema.                  | Contract       | R-001, R-010        | Closed top level             |
| 3.1-CONTRACT-003 | Canonical validator passes and contracts remain unedited.                          | Contract       | R-001, R-007, R-008 | Regression gate              |
| 3.1-CI-002       | No secret/signing material is introduced in code, schema, DB, or output.           | CI/static      | R-008               | Recursive scan               |

**Total P0:** 24 atomic scenarios.

### P1 Scenarios

| Test ID          | Requirement                                                                  | Level           | Risk                | Notes                    |
| ---------------- | ---------------------------------------------------------------------------- | --------------- | ------------------- | ------------------------ |
| 3.1-UNIT-001     | Row schema mirrors the exact snake_case DB row.                              | Unit            | R-007               | Type/shape boundary      |
| 3.1-UNIT-009     | Rotate uses update-then-select and increments one version.                   | Unit            | R-006, R-008        | No UPDATE RETURNING      |
| 3.1-UNIT-010     | Rotate-before-create fails not found.                                        | Unit            | R-009               | Out-of-order action      |
| 3.1-UNIT-011     | Disable retains the row.                                                     | Unit            | R-009               | Auditability             |
| 3.1-UNIT-012     | Disable-before-create fails not found.                                       | Unit            | R-009               | Out-of-order action      |
| 3.1-UNIT-013     | Status missing.                                                              | Unit            | R-005               | Negative state           |
| 3.1-UNIT-014     | Status active/valid.                                                         | Unit            | R-005               | Happy state              |
| 3.1-UNIT-015     | Status disabled/not-ready.                                                   | Unit            | R-005               | Lifecycle state          |
| 3.1-UNIT-016     | Status rotated/ready with active version.                                    | Unit            | R-005               | Lifecycle state          |
| 3.1-UNIT-017     | Status conflicting with path-mismatch detail.                                | Unit            | R-004, R-005        | Mismatch state           |
| 3.1-UNIT-018     | Stale is representable without speculative detection.                        | Unit            | R-005               | W-001                    |
| 3.1-UNIT-019     | Corrupt persisted state fails closed.                                        | Unit            | R-005, R-011        | Stale/corrupt data       |
| 3.1-UNIT-021     | Missing provider alone fails on a non-create verb.                           | Unit            | R-002               | Malformed input          |
| 3.1-UNIT-022     | Missing name alone fails on a non-create verb.                               | Unit            | R-002               | Malformed input          |
| 3.1-UNIT-023     | Create missing project-ref fails before work.                                | Unit            | R-004               | Malformed input          |
| 3.1-UNIT-024     | Create missing route fails before work.                                      | Unit            | R-004               | Malformed input          |
| 3.1-UNIT-025     | Update missing project-ref fails before work.                                | Unit            | R-004               | Malformed input          |
| 3.1-UNIT-026     | Update missing route fails before work.                                      | Unit            | R-004               | Malformed input          |
| 3.1-UNIT-027     | Whitespace provider follows explicit validation and never aliases.           | Unit            | R-012               | Boundary                 |
| 3.1-UNIT-028     | Whitespace name follows explicit validation and never aliases.               | Unit            | R-012               | Boundary                 |
| 3.1-UNIT-029     | Whitespace route fails before mutation.                                      | Unit            | R-004, R-012        | Boundary                 |
| 3.1-UNIT-030     | Unicode/separator values round-trip or fail deterministically.               | Unit            | R-012               | Boundary                 |
| 3.1-UNIT-031     | Normalization-collision candidates cannot share a live binding ID.           | Unit            | R-012               | Collision                |
| 3.1-UNIT-032     | Supplied correlation ID is preserved.                                        | Unit            | R-015               | Metadata                 |
| 3.1-UNIT-033     | Generated correlation ID and timestamps have valid formats.                  | Unit            | R-015               | Metadata                 |
| 3.1-UNIT-035     | Codebase lookup rejection emits failure and writes nothing.                  | Unit            | R-011               | Dependency failure       |
| 3.1-UNIT-036     | Binding write rejection emits failure and no success.                        | Unit            | R-011               | Dependency failure       |
| 3.1-UNIT-037     | Post-mutation SELECT failure reports uncertainty, not stale success.         | Unit            | R-006, R-011        | Partial failure          |
| 3.1-UNIT-038     | Injected timeout error maps to a machine envelope.                           | Unit            | R-016               | W-004 enforcement gap    |
| 3.1-UNIT-039     | Non-serializable error data is sanitized to valid JSON.                      | Unit            | R-002, R-011        | Malformed JSON defense   |
| 3.1-UNIT-040     | Remove/unsupported command fails closed.                                     | Unit            | R-009               | Scope regression         |
| 3.1-INT-002      | Existing SQLite DB adds the table without data loss.                         | DB integration  | R-007, R-013        | Upgrade/rollback         |
| 3.1-INT-003      | Repeated SQLite init is idempotent.                                          | DB integration  | R-007, R-013        | Regression               |
| 3.1-INT-004      | PostgreSQL combined schema has equivalent semantics in schema transaction.   | DB integration  | R-007               | Backend parity           |
| 3.1-INT-008      | Concurrent rotates are monotonic and envelopes match commits.                | DB integration  | R-006               | Race                     |
| 3.1-INT-009      | Rotate racing disable has a serializable final state.                        | DB integration  | R-006, R-009        | Race                     |
| 3.1-INT-010      | Duplicate disable follows ratified idempotent semantics and retains one row. | DB integration  | R-009               | Duplicate action         |
| 3.1-INT-011      | Schema failure rolls back where transactional and restart converges.         | DB integration  | R-007, R-013        | Partial failure/rollback |
| 3.1-CLI-009      | New flags parse before/after commands without becoming positionals.          | CLI integration | R-004               | Parser regression        |
| 3.1-CONTRACT-002 | Binding-domain status fixtures remain validator-valid without app schema.    | Contract        | R-005               | W-002                    |
| 3.1-CONTRACT-004 | Fixture comparison excludes only documented dynamic paths.                   | Contract        | R-001, R-015        | Regression               |
| 3.1-CI-001       | Bundled schema is regenerated and contains table marker.                     | CI/static       | R-007               | Generated artifact       |
| 3.1-CI-003       | Mocked tests pass isolated and in three repeated/package runs.               | CI/static       | R-014               | Flake guard              |
| 3.1-CI-004       | Full `bun run validate` passes.                                              | CI/static       | R-007, R-013, R-014 | Pre-PR gate              |
| 3.1-CI-005       | Change scope contains no excluded surface and each task has rollback notes.  | CI/review       | R-013               | W-006                    |

**Total P1:** 45 atomic scenarios.

### P2/P3 Scenarios

No mandatory P2/P3 scenario is used to carry an acceptance criterion, high-risk item, or reviewer concern.
Optional nightly burn-in repeats existing race scenarios and does not count as duplicate functional coverage.

## Explicit Waivers

| ID    | Reason                                                                                        | Owner                             | Residual risk                                                         | Follow-up trigger                                                                     |
| ----- | --------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| W-001 | No expected-version input or stale-detection protocol exists; reconciliation is Hermes-owned. | Workflow Commander contract owner | A stale binding may remain reported as persisted state.               | Expected-version/version-comparison semantics or explicit Archon ownership is added.  |
| W-002 | No runtime caller reads/emits `workflow-provider-binding.v1`; a second schema is speculative. | Archon architecture owner         | A future caller could diverge from domain fixtures.                   | First accepted runtime caller for that family.                                        |
| W-003 | Closed schemas do not define top-level actor.                                                 | Workflow Commander contract owner | Mutations lack contract-level actor attribution.                      | Contract revision adds actor or an approved nested location.                          |
| W-004 | No binding-command timeout/cancel contract or threshold exists.                               | CLI architecture owner            | Never-settling DB work can hang and leave mutation outcome ambiguous. | Timeout flag/default, abort signal, cancellation contract, or remote SLO is accepted. |
| W-005 | Local CLI inherits OS-process permissions and defines no application role policy.             | Security owner                    | A local process with DB access can mutate bindings.                   | Multi-user, remote execution, service account, or role requirement is introduced.     |
| W-006 | HTTP/UI/Hermes/event-delivery surfaces are explicitly excluded.                               | Product + architecture owners     | Downstream integration is untested here.                              | An approved story activates one of those surfaces.                                    |
| W-007 | Story 3.3a owns the shared envelope builder; local construction is intentionally temporary.   | Story 3.3a owner                  | Temporary duplication can drift.                                      | Story 3.3a begins; rerun exact fixture tests during refactor.                         |
| W-008 | Schemas define minimum but no maximum lengths.                                                | Contract owner                    | Extremely long values may stress storage or CLI behavior.             | `maxLength`, index limit, abuse case, or performance incident is established.         |
| W-009 | Update/rotate behavior after disabled is unspecified.                                         | Product + architecture owners     | Controllers may observe inconsistent disabled transitions.            | Resolve before Task 3 acceptance or when a fixture defines the transition.            |
| W-010 | No load/latency target exists for the local single-developer CLI.                             | Product/operations owner          | Performance regressions have no numeric gate.                         | Remote/concurrent exposure or latency SLO is accepted.                                |

## Traceability

### Acceptance Criteria

| AC  | Scenario or waiver mapping                                                                      |
| --- | ----------------------------------------------------------------------------------------------- |
| AC1 | UNIT-001/002/004/006–008/023/024/029; INT-001/002/004; CLI-001/007                              |
| AC2 | UNIT-002–005/025/026; INT-005–007; CLI-002/007                                                  |
| AC3 | UNIT-013–019; CLI-003; CONTRACT-002; W-001 for active stale detection only                      |
| AC4 | UNIT-009–012/032–034/040; INT-008–010; CLI-004/005/007; CONTRACT-001; W-003/W-009               |
| AC5 | UNIT-019–031/035–039; CLI-006/008; CONTRACT-001/003; W-004 for never-settling cancellation only |

### High-Risk Items

| Risk  | P0/P1 scenarios or waiver                   |
| ----- | ------------------------------------------- |
| R-001 | CLI-001–006; CONTRACT-001–004               |
| R-002 | UNIT-020–022/039; CLI-001–008; CONTRACT-001 |
| R-003 | UNIT-002–005; INT-001/005–007               |
| R-004 | UNIT-002/004/006–008/017/023–031; CLI-009   |
| R-005 | UNIT-013–019; CONTRACT-002; W-001           |
| R-006 | UNIT-009/037; INT-006/008/009               |
| R-007 | UNIT-001; INT-001–004/011; CI-001/004       |
| R-008 | UNIT-009/034; CLI-004; CONTRACT-003; CI-002 |
| R-009 | UNIT-010–012/040; INT-009/010; W-009        |
| R-010 | UNIT-034; CONTRACT-001; W-003               |
| R-011 | UNIT-019/035–039                            |
| R-012 | UNIT-027–031; W-008                         |
| R-013 | INT-002/003/011; CI-004/005                 |
| R-014 | CI-003/004                                  |
| R-015 | UNIT-032/033; CONTRACT-004                  |
| R-016 | UNIT-038; W-004                             |

### Reviewer Concerns

| Concern  | Scenario or waiver                   |
| -------- | ------------------------------------ |
| RC-01    | UNIT-034, CONTRACT-001, W-003        |
| RC-02    | UNIT-018, CONTRACT-002, W-001        |
| RC-03    | UNIT-009/034, INT-008, CI-002        |
| RC-04    | UNIT-002/004/008/024/026/029         |
| RC-05/06 | CLI-001–006, CONTRACT-001/004        |
| RC-07    | CONTRACT-002/003, W-002              |
| RC-08    | UNIT-006/007/017, CLI-009            |
| RC-09    | UNIT-002–005, INT-005–007            |
| RC-10    | UNIT-009/037, INT-008/009            |
| RC-11    | UNIT-011/012/040, INT-009/010, W-009 |
| RC-12    | CLI-007/008                          |
| RC-13    | CLI-001–006, W-007                   |
| RC-14    | CONTRACT-003/004, CI-004             |
| RC-15    | INT-001–004/011, CI-001/004          |
| RC-16    | CI-003/004                           |
| RC-17    | UNIT-040, CI-005, W-006              |
| RC-18    | UNIT-032/033, CONTRACT-004           |
| RC-19    | UNIT-030/031                         |
| RC-20    | INT-001/005                          |
| RC-21    | W-005                                |
| RC-22    | UNIT-038, W-004                      |
| RC-23    | INT-002/003/011, CI-005              |
| RC-24    | UNIT-035–039                         |

### Edge-Class Audit

| Required edge class         | Explicit disposition                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Happy path                  | UNIT-002/004/009/011/014–017; CLI-001–005                                                                        |
| Negative path               | UNIT-003/005/010/012/019/040                                                                                     |
| Boundary                    | UNIT-027–031; W-008 for undefined maximum length                                                                 |
| Malformed input/JSON        | UNIT-020–029/039; CLI-006/008                                                                                    |
| Stale data                  | UNIT-018/019; W-001                                                                                              |
| Duplicate actions           | INT-005/007/010                                                                                                  |
| Out-of-order events/actions | No event stream exists; update/rotate/disable-before-create are UNIT-005/010/012. Disabled follow-ons use W-009. |
| Partial failure             | UNIT-037/039; INT-011                                                                                            |
| Dependency failure          | UNIT-035/036/038                                                                                                 |
| Timeout                     | UNIT-038; enforcement gap W-004                                                                                  |
| Cancellation                | No cancellation surface; W-004                                                                                   |
| Concurrency/race            | INT-005/006/008/009                                                                                              |
| Rollback                    | INT-002/003/011; CI-005                                                                                          |
| Permission/auth             | Local trust boundary W-005                                                                                       |
| Regression                  | CONTRACT-003/004; CI-001/003/004/005                                                                             |

## Execution Strategy

**Philosophy:** Run everything in PRs when the deterministic suite remains below 15 minutes; defer only repeated burn-in or genuinely infrastructure-heavy work.

- **PR:** Relevant focused P0/P1 files after each task, contract validator, generated-schema check, then full `bun run validate` before merge.
- **Nightly:** Repeat INT-005/006/008/009 and CI-003 for 20–50 iterations if a scheduled lane exists; a race failure is a defect, not a quarantined flake.
- **Weekly:** None for this story. Add a live PostgreSQL smoke only when the project establishes a reusable container-backed DB test lane; do not create new runtime infrastructure solely for Story 3.1.

Playwright parallelization is not applicable because this story uses Bun tests and no browser suite.

## Resource Estimates

| Priority  | Scenario count | Effort range        | Notes                                                                |
| --------- | -------------: | ------------------- | -------------------------------------------------------------------- |
| P0        |             24 | ~28–44 hours        | Fixture conformance, CLI harness, core races, security scan          |
| P1        |             45 | ~32–52 hours        | Backend upgrade/races, state matrix, fault injection, CI integration |
| P2        |    0 mandatory | ~4–8 hours optional | Burn-in harness stabilization only                                   |
| P3        |              0 | ~0–4 hours          | Exploratory only if implementation exposes new ambiguity             |
| **Total** |         **69** | **~64–108 hours**   | **~1.5–3 calendar weeks for one implementer**                        |

The range includes fixture setup, temporary SQLite data, deterministic scheduling seams, subprocess capture, and package-script isolation.

## Quality Gate Criteria

### Pass/Fail Thresholds

- P0 pass rate: 100%; no exceptions, skips, quarantines, or retry masking.
- P1 pass rate: 100% for this deterministic controller/data contract, stricter than the general 95% floor.
- High-risk mitigation: implemented and verified, or an accepted waiver with owner/residual/trigger.
- Open defect gate: zero P0/P1 defects and zero unowned score-6+ risks.

### Coverage Targets

- Acceptance criteria: 100% scenario-or-waiver traceability.
- High-risk items: 100% mapped to explicit P0/P1 scenarios; waivers only cover the undefined remainder.
- Reviewer concerns: 100% risk/non-risk disposition and scenario-or-waiver traceability.
- Security scenarios: 100% pass.
- Requirements/risk coverage: 100%.
- If code coverage is reported, changed lifecycle modules should reach at least 80% line coverage; numeric code coverage does not replace scenario traceability.

### Non-Negotiable Gates

- Exact command fixtures and `workflow-command-envelope.schema.json` pass.
- `validate_contracts.py` passes with no contract package edits.
- SQLite, PostgreSQL combined schema, and bundled generated schema remain synchronized.
- No raw secret/signing material, actor, Hermes-specific field, remove command, or state-changing HTTP route is introduced.
- `bun run validate` passes.
- NFR evidence sources are identified; final NFR status is deferred to `nfr-assess`.

## Assumptions and Dependencies

### Assumptions

1. Provider-binding commands execute within the current local OS-user trust boundary.
2. `(provider,name)` remains globally unique for v1.
3. The event route is opaque once a non-empty validation rule is accepted.
4. Binding IDs may be derived only if derivation is deterministic and collision-safe.
5. Existing contract schemas and examples remain immutable for this story.

### Dependencies

1. Parent Story 1.3a contract package and passing validator are required before implementation acceptance.
2. Registered codebase lookup must remain available through existing core DB boundaries.
3. Story 3.3a owns later shared-envelope extraction and must retain Story 3.1 fixture regressions.
4. `bun run validate` and package-isolated test scripts remain the CI source of truth.

### Plan Risks and Contingencies

- If project-ref normalization is not ratified, block Task 1 rather than writing tests around an assumed format.
- If deterministic race orchestration requires production seams, prefer a narrow transaction/CAS design over timing sleeps.
- If PostgreSQL syntax cannot be proven without a live database, use schema-init tests now and schedule a reusable container-backed lane separately.
- If P0/P1 execution exceeds 15 minutes, profile package boundaries before moving deterministic functional tests out of PR.

## Interworking and Regression

| Component                         | Impact                                                          | Regression scope                                                                    |
| --------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@archon/core` schemas and DB     | New row type, table, queries, and dual-backend initialization.  | Core package tests, SQLite adapter, PostgreSQL adapter/schema-init, bundled schema. |
| `@archon/cli` parser and dispatch | New flags, command family, pure JSON output, and exit behavior. | CLI parser, existing workflow/isolation/AI commands, command package tests.         |
| Workflow Commander contracts      | Runtime output depends on existing schemas and examples.        | Canonical validator plus exact binding-command fixture tests.                       |
| Generated artifacts               | PostgreSQL schema embedding changes.                            | `check:bundled-schema` and full validation.                                         |
| Future Story 3.3a                 | May extract local envelope construction.                        | Re-run CLI-001–008 and CONTRACT-001/004 during refactor.                            |
| External Hermes consumer          | Blocked until producer contract exists.                         | Consumer compatibility is not executed here; shared fixture equality is the seam.   |

## Follow-on Workflows

- Run `*atdd` explicitly to generate red-phase P0 scaffolds after pre-implementation decisions are resolved.
- Run `*automate` explicitly for the remaining coverage after implementation exists.
- Run `nfr-assess` after test, scan, validator, and CI evidence is available.

## Approval

- [ ] Product/architecture owner accepts project-ref, input, disable, and disabled-transition decisions.
- [ ] Security owner accepts W-005 and verifies secret handling.
- [ ] Contract owner accepts W-001/W-003/W-008 and the exact fixture strategy.
- [ ] Test owner confirms all 69 scenarios or waivers remain traceable.

## Appendix

### Knowledge References

- `risk-governance.md`
- `probability-impact.md`
- `test-levels-framework.md`
- `test-priorities-matrix.md`
- `nfr-criteria.md`
- `contract-testing.md`
- `playwright-cli.md` and the API-only Playwright Utils profile, loaded for workflow compliance but not selected as project test tooling.

### Related Documents

- Story: `_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md`
- PRD: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md`
- Epic: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`
- Architecture: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`
- Contract package: `_bmad-output/planning-artifacts/contracts/workflow-commander/`

**Generated by:** BMad TEA Master Test Architect  
**Workflow:** `bmad-testarch-test-design`
