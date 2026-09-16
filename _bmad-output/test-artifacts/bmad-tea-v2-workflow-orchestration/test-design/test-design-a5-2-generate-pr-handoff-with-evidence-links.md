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
lastSaved: '2026-07-09'
inputDocuments:
  - '_bmad-output/implementation-artifacts/a5-2-generate-pr-handoff-with-evidence-links.md'
  - '_bmad-output/implementation-artifacts/a5-1-orchestrate-decision-needed-follow-up.md'
  - '_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md'
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/implementation-artifacts/sprint-status.yaml'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/package.json'
  - 'packages/workflows/src/defaults/v2-decision-needed-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-decision-needed-dag.test.ts'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/api-testing-patterns.md'
---

# Test Design: a5.2 - Generate PR Handoff With Evidence Links

**Date:** 2026-07-09
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for Story a5.2, which adds a deterministic `pr-handoff` collector between `decision-needed-check` and `create-pull-request`.

This design treats every known reviewer concern in the story handoff as evidence.

Every acceptance criterion, every high-risk item, and every reviewer concern maps to an atomic test scenario, an explicit non-risk, or a waiver with owner, residual risk, and follow-up trigger.

The current checkout is known to have removed the a5-1 end-state.
Therefore the test design makes restoration of `decision-needed-check` and the A4.2 route-loop tail a P0 precondition before any a5.2 coverage can be considered valid.

The live deferred-items population path remains blocked by the same BMAD-METHOD M3.1/M3.2 and Linear dependencies as a5-1.
This plan fixture-tests rendering of populated `deferred_items` with synthetic contracts and waives only the live external population proof.

**Risk Summary:**

- Total risks identified: 28.
- High-priority risks or promoted core-contract risks: 25.
- P0 risks: 10.
- P1 risks: 15.
- Critical categories: TECH, DATA, OPS, SEC, BUS.
- Primary risk theme: the PR handoff must expose correct evidence without creating a compatibility break, stale-story leak, fake live Linear behavior, or misleading "fixed" language for deferred human judgment.

**Coverage Summary:**

- P0 scenarios: 10.
- P1 scenarios: 16.
- P2/P3 scenarios: 4.
- Waivers: 7.
- Total effort estimate: about 24 to 42 engineering hours.

## Not In Scope

| Item                                                                 | Reasoning                                                                                                                                                                     | Mitigation                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Linear population of `deferred_items`                           | The story documents that BMAD-METHOD M3.1/M3.2 and Linear integration are unavailable, and a5-1 currently fails closed before PR generation when `decision_needed_count > 0`. | W-001 keeps the live path explicitly waived until those dependencies exist. TD-410 fixture-tests the rendering contract with synthetic populated data.              |
| Browser UI E2E                                                       | This story changes workflow YAML, deterministic bash behavior, generated defaults, and workflow tests, not a browser-visible UI.                                              | Use static workflow contract tests and isolated real DAG executor tests as the first-party workflow surface. W-007 reopens if Web UI or console rendering is added. |
| General adapter authorization and credential delivery                | No Slack, Telegram, GitHub, Discord, Better Auth, user-token, provider-key, or credential-delivery code should change.                                                        | TD-427 and W-004 guard file scope and reopen if auth, adapter, provider credential, Linear API, MCP, or network code is touched.                                    |
| Executor cancellation lifecycle                                      | The requested implementation adds a bounded bash node and YAML wiring, not executor cancellation semantics.                                                                   | W-003 records the residual partial-file risk and reopen trigger.                                                                                                    |
| Load testing                                                         | The node is local JSON parsing and artifact rendering with a 60 second timeout. No service endpoint or high-throughput runtime path is added.                                 | TD-420 covers bounded local execution; W-006 reopens if live network or large evidence aggregation is added.                                                        |
| Full revalidation of upstream contract envelopes inside `pr-handoff` | The story explicitly says upstream nodes already validate their envelopes and the collector should check only presence and `story_ref` match.                                 | NR-001 treats this as an explicit non-risk, with W-002 as the compatibility guard if upstream validators change.                                                    |

## Risk Assessment

Risk score equals probability multiplied by impact.

Score 9 is P0.

Score 6 to 8 is P1.

Score 4 to 5 is P2 unless the issue can break core behavior, security, data integrity, compatibility, or cross-process contract behavior.
Those promoted items are marked P1.

Score 1 to 3 is P3 unless promoted by the same rule.

### High-Priority Risks

| Risk ID | Category | Description                                                                                                                                                 | Probability | Impact | Score | Priority | Mitigation                                                                                                            | Owner                   | Timeline              |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------- |
| R-001   | TECH     | The a5-1 `decision-needed-check` end-state remains absent, so a5.2 is built on a missing dependency.                                                        | 3           | 3      | 9     | P0       | TD-400 requires exact a5-1 restoration before a5.2 wiring is accepted.                                                | Workflow implementer    | Before PR             |
| R-002   | TECH     | The inherited A4.2 route-loop tail is damaged while restoring a5-1 or adding `pr-handoff`.                                                                  | 3           | 3      | 9     | P0       | TD-400 and TD-426 assert the A4.2 baseline and route-loop regressions.                                                | Workflow implementer    | Before PR             |
| R-003   | TECH     | `create-pull-request` can still run directly from the route loop or decision node, bypassing `pr-handoff`.                                                  | 3           | 3      | 9     | P0       | TD-402 and TD-422 assert the required chain: `decision-needed-check -> pr-handoff -> create-pull-request`.            | Workflow implementer    | Before PR             |
| R-004   | TECH     | `pr-handoff` dependencies or `none_failed_min_one_success` are wrong, causing skipped TEA branches to block or missing producers to be ignored.             | 2           | 3      | 6     | P1       | TD-401 asserts exact dependencies and trigger rule.                                                                   | Workflow implementer    | Before PR             |
| R-005   | DATA     | The collector parses markdown, field-level substitutions, `grep`, or `case` instead of whole-output JSON contracts.                                         | 3           | 3      | 9     | P0       | TD-404 requires whole-output substitutions, `bun -e`, `JSON.parse`, and no prose parsing.                             | Workflow implementer    | Before PR             |
| R-006   | DATA     | Missing or mismatched `story_ref` on any consumed contract is accepted, linking stale or wrong-story evidence.                                              | 3           | 3      | 9     | P0       | TD-412 proves fail-closed behavior for each producer.                                                                 | Workflow implementer    | Before PR             |
| R-007   | DATA     | Empty or malformed upstream JSON emits a partial handoff or lets PR continue.                                                                               | 3           | 3      | 9     | P0       | TD-413 and TD-417 require non-zero failure, no contract stdout, no handoff artifacts, and no PR.                      | Workflow implementer    | Before PR             |
| R-008   | DATA     | Real-vs-skipped branch resolution chooses the wrong source, losing actual RV/NR/TR evidence or showing skipped evidence as real.                            | 2           | 3      | 6     | P1       | TD-405 and TD-415 assert source selection from output presence.                                                       | Workflow implementer    | Before PR             |
| R-009   | BUS      | Artifact links are missing or point to the wrong run-dir or node sidecar path, forcing reviewers back into logs.                                            | 2           | 3      | 6     | P1       | TD-406 and TD-408 assert concrete path mapping and Markdown links.                                                    | Workflow implementer    | Before PR             |
| R-010   | BUS      | Deferred human-judgment work is omitted or implied fixed in the PR handoff.                                                                                 | 3           | 3      | 9     | P0       | TD-410 and TD-411 assert populated rendering, exact warning language, and negative wording guards.                    | Workflow implementer    | Before PR             |
| R-011   | BUS      | No-deferred state is ambiguous or lacks the required explicit statement.                                                                                    | 2           | 3      | 6     | P1       | TD-409 asserts "No decision-needed items were deferred." and no misleading resolved/fixed language.                   | Workflow implementer    | Before PR             |
| R-012   | DATA     | `pr-handoff.json` misses required envelope/evidence fields or uses `gate` instead of collector `status`.                                                    | 2           | 3      | 6     | P1       | TD-407 and TD-408 assert the full contract.                                                                           | Workflow implementer    | Before PR             |
| R-013   | OPS      | The v2-specific evidence include is hard-coded into shared `archon-create-pr.md`, breaking non-BMAD workflows.                                              | 2           | 3      | 6     | P1       | TD-403, TD-421, and TD-429 require either untouched shared command or a guarded include.                              | Workflow implementer    | Before PR             |
| R-014   | OPS      | `prompt_suffix` lacks graceful degradation, so missing `pr-handoff.md` fails PR creation or produces noisy non-BMAD behavior.                               | 2           | 3      | 6     | P1       | TD-421 asserts file-existence language, skip behavior, and no-fail instruction.                                       | Workflow implementer    | Before PR             |
| R-015   | OPS      | Best-effort artifact writes fail silently in normal runs, leaving PR handoff evidence unavailable to the PR node.                                           | 2           | 3      | 6     | P1       | TD-408 asserts normal artifact writes; TD-428 covers unset artifacts-dir degradation separately.                      | Workflow implementer    | Before PR             |
| R-016   | OPS      | Source workflow, generated bundle, v1 baseline, or package test registration drifts.                                                                        | 2           | 3      | 6     | P1       | TD-403, TD-423, TD-425, and TD-429 assert bundle parity, v1 unchanged, and package scripts.                           | Workflow implementer    | Before PR             |
| R-017   | OPS      | `mock.module()` pollution makes DAG tests order-dependent or false green.                                                                                   | 2           | 3      | 6     | P1       | TD-423 requires the DAG test as its own `bun test` invocation.                                                        | Test architect          | Before PR             |
| R-018   | TECH     | New tests embed real plan/story/finding identifiers, weakening naming hygiene and fixture portability.                                                      | 1           | 2      | 2     | P3       | TD-424 covers forbidden identifier scanning.                                                                          | Test architect          | Before PR             |
| R-019   | DATA     | Previous a5-1 reviewer findings regress: env vars are not exported into `bun -e`, synthetic keys are not neutral, or numeric fields are coerced unsafely.   | 2           | 3      | 6     | P1       | TD-404, TD-410, TD-412, and TD-424 carry forward those constraints.                                                   | Workflow implementer    | Before PR             |
| R-020   | DATA     | Duplicate actions or concurrent runs overwrite or leak `pr-handoff` artifacts across run directories.                                                       | 2           | 3      | 6     | P1       | TD-418 uses repeated same-dir and distinct-dir executor runs.                                                         | Workflow implementer    | Before PR             |
| R-021   | TECH     | Out-of-order events, route-loop non-completion, or dependency failure still allow `pr-handoff` or PR creation.                                              | 3           | 3      | 9     | P0       | TD-419 proves skipped/failed upstream producers prevent handoff and PR.                                               | Workflow implementer    | Before PR             |
| R-022   | OPS      | The bash node hangs or introduces unbounded external work.                                                                                                  | 2           | 2      | 4     | P1       | TD-420 asserts `timeout: 60000` and local `bun -e` only; priority promoted because a hang blocks workflow completion. | Workflow implementer    | Before PR             |
| R-023   | SEC      | Implementation introduces Linear credentials, network calls, MCP config, auth changes, or provider credential delivery without an accepted capability gate. | 3           | 3      | 9     | P0       | TD-427 and W-004 block hidden security scope.                                                                         | Security/platform owner | Before PR             |
| R-024   | TECH     | The collector reruns the full envelope gauntlet and becomes incompatible with upstream contract evolution or skipped-node shape.                            | 2           | 2      | 4     | P1       | NR-001, TD-404, and W-002 keep validation scoped to presence plus `story_ref`.                                        | Workflow architect      | Before PR             |
| R-025   | DATA     | Deferred item titles or URLs containing pipes, newlines, brackets, or control characters corrupt the Markdown table or hide evidence.                       | 2           | 3      | 6     | P1       | TD-411 requires escaping or a non-table rendering that preserves every field safely.                                  | Workflow implementer    | Before PR             |
| R-026   | BUS      | The AI-driven `create-pull-request` node ignores or omits the evidence section even though the handoff artifact exists.                                     | 2           | 3      | 6     | P1       | TD-421 asserts deterministic prompt instructions; W-005 assigns live PR-body proof to the vertical slice.             | Workflow maintainer     | Before A6.1 proof run |
| R-027   | TECH     | The target node shape in the story is copied without validating edge cases, leaving malformed, stale, duplicate, or mixed-branch behavior only implied.     | 3           | 3      | 9     | P0       | TD-408 through TD-419 cover the edge paths explicitly.                                                                | Test architect          | Before PR             |
| R-028   | PERF     | No performance threshold is defined for the collector beyond timeout.                                                                                       | 1           | 2      | 2     | P3       | TD-420 and W-006 keep this bounded to local execution.                                                                | Workflow maintainer     | Before PR             |

### Explicit Non-Risks

| ID     | Concern                                                                              | Rationale                                                                                                                                                                                 | Scenario Or Follow-Up                                                               |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| NR-001 | `pr-handoff` should not rerun the full envelope gauntlet on every consumed contract. | The story explicitly says upstream nodes already validated envelopes and this collector should check presence and `story_ref` only. Revalidating all fields would add compatibility risk. | TD-404 checks scoped validation; W-002 reopens if upstream validators are weakened. |
| NR-002 | `pr-handoff` uses `status: "PASS"` rather than `gate`.                               | The collector is not a quality gate, and the story explicitly requires `status` rather than `gate`.                                                                                       | TD-407 asserts `status` exists and `gate` is absent at the top level.               |
| NR-003 | Browser exploration is skipped.                                                      | The product surface under test is workflow DAG execution and artifact generation, not a browser page.                                                                                     | W-007 reopens if Web UI or console handoff rendering is added.                      |

## NFR Planning

| NFR Category    | Requirement / Threshold                                                                                                                                                   | Risk Link                                | Planned Validation                                                                        | Evidence Needed                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| Security        | No new credential, auth, adapter, provider-key, MCP, Linear API, or network path without accepted scope. Threshold: zero unauthorized scope changes.                      | R-023                                    | Static file-scope review and string scans for network/credential surfaces.                | TD-427 result plus review diff.         |
| Reliability     | Missing, stale, malformed, skipped, failed, or partial producer states must fail closed without PR. Threshold: 100% P0 reliability scenarios pass.                        | R-006, R-007, R-021                      | Isolated real DAG executor tests with table-driven upstream states.                       | TD-412, TD-413, TD-417, TD-419 reports. |
| Data Integrity  | Handoff must preserve exact `story_ref`, source node, artifact path, report path, and deferred item fields. Threshold: no stale-story or field-loss cases accepted.       | R-006, R-008, R-009, R-010, R-012, R-025 | Static contract tests plus executor fixture assertions on JSON and Markdown artifacts.    | TD-405 through TD-411 outputs.          |
| Compatibility   | Non-BMAD workflows using `archon-create-pr` must remain usable. Threshold: shared command unchanged or guarded with file-existence check.                                 | R-013, R-014                             | Static test/diff guard for `archon-create-pr.md` and `create-pull-request.prompt_suffix`. | TD-403, TD-421, TD-429 reports.         |
| Maintainability | Generated bundle, package test segmentation, and v1 baseline remain consistent. Threshold: `bun run check:bundled`, focused tests, and `bun run validate` pass before PR. | R-016, R-017, R-018                      | Project commands and static package-script assertions.                                    | TD-423, TD-424, TD-425, TD-429 reports. |
| Performance     | Collector remains local and bounded. Threshold: `timeout: 60000`; no network or long-running external calls.                                                              | R-022, R-028                             | Static node-body assertion.                                                               | TD-420 report.                          |

**Unknown thresholds:** No runtime latency SLO exists for this local bash collector.
Do not invent one.
Use the declared timeout plus local-only execution as the planned evidence.

## Entry Criteria

- [ ] a5-1 `decision-needed-check` has been restored in the working checkout or the implementation is explicitly blocked.
- [ ] A4.2 route-loop tail is intact before adding `pr-handoff`.
- [ ] The target story, PRD, architecture, project context, and prior a5-1 test patterns have been read.
- [ ] The implementation scope is limited to v2 workflow YAML, generated bundled defaults, two new test files, and workflow package script registration unless a documented exception exists.
- [ ] The live Linear/BMAD-METHOD path remains explicitly out of scope unless M3.1/M3.2 and Linear capability markers are present.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] P1 pass rate is 100% or each failure has an approved waiver with owner, residual risk, and follow-up trigger.
- [ ] Every acceptance criterion maps to a scenario or waiver.
- [ ] Every high-risk item maps to a scenario or waiver.
- [ ] Every reviewer concern maps to a scenario, explicit non-risk, or waiver.
- [ ] `bun run check:bundled`, both new focused tests, and `bun run validate` pass before PR.
- [ ] No hidden changes to v1 baseline, shared PR command behavior, auth/credential surfaces, or executor code.

## Test Coverage Plan

P0/P1/P2/P3 are priority and risk classifications only.
Execution timing is defined separately in the Execution Strategy section.

### P0

**Criteria:** Can break core workflow behavior, data integrity, security, compatibility, or cross-process contract behavior with no acceptable workaround.

| Test ID | Requirement                                                                                                                                                                                                                                              | Test Level                       | Risk Link                  | Owner        | Notes                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------- | ------------ | -------------------------------------------------------------------- |
| TD-400  | Precondition: restore a5-1 `decision-needed-check` exact end-state, confirm A4.2 route-loop tail, confirm `create-pull-request` shape, and confirm live Linear/BMAD-METHOD dependencies are absent.                                                      | Bun structural contract          | R-001, R-002               | Dev/Test     | Hard gate; do not mark a5.2 coverage valid if this fails.            |
| TD-402  | Required chain is `quality-route-loop -> decision-needed-check -> pr-handoff -> create-pull-request`; PR cannot bypass handoff.                                                                                                                          | Bun structural contract          | R-003                      | Dev/Test     | Covers route wiring and core behavior.                               |
| TD-404  | `pr-handoff` body uses whole-output substitutions for summary, DNC, CR, GP, RV, NR, TR; exports env vars into `bun -e`; uses `JSON.parse`; does not use `grep`, `case`, markdown, logs, or field-level output parsing.                                   | Bun structural contract          | R-005, R-019, R-024        | Dev/Test     | Carries forward JSON-only and env-export findings.                   |
| TD-408  | Happy path: all gates real and PASS, `deferred:false`, `deferred_items:[]` emits valid `pr-handoff.json`, writes `pr-handoff.md`, links every evidence artifact, and reaches `create-pull-request`.                                                      | Isolated DAG executor            | R-009, R-012, R-015, R-027 | Dev/Test     | Primary happy path.                                                  |
| TD-410  | Synthetic populated deferred items render every item with finding id, title, source gate, Linear issue id, Linear URL, and status; Markdown says deferred to Linear and NOT fixed in this PR.                                                            | Isolated DAG executor            | R-010, R-019, R-027        | Dev/Test     | Required because live population is blocked.                         |
| TD-412  | Stale data: one table-driven case per consumed contract (`quality-gate-summary`, `decision-needed-check`, `code-review-auto`, `gate-planner`, RV, NR, TR) with mismatched or empty `story_ref` fails closed, emits no handoff artifact, and prevents PR. | Isolated DAG executor            | R-006, R-027               | Dev/Test     | Explicit stale-story coverage.                                       |
| TD-413  | Malformed input: one table-driven case per consumed contract with empty output or invalid JSON fails closed, emits no handoff artifact, and prevents PR.                                                                                                 | Isolated DAG executor            | R-007, R-027               | Dev/Test     | Explicit malformed-input coverage.                                   |
| TD-417  | Partial failure: validation and fail-closed paths emit no partial `pr-handoff.json`, no partial `pr-handoff.md`, and do not call `create-pull-request`.                                                                                                  | Isolated DAG executor            | R-007, R-027               | Dev/Test     | Guards misleading evidence.                                          |
| TD-419  | Out-of-order/dependency failure: failed or skipped `decision-needed-check`, failed `quality-gate-summary`, route-loop non-completion, or missing mutually-exclusive branch outputs prevent `pr-handoff` and PR.                                          | Isolated DAG executor            | R-021, R-027               | Dev/Test     | Covers out-of-order events, dependency failure, and partial failure. |
| TD-427  | Security and permission scope: diff introduces no auth, adapter, provider credential, token store, Linear API, MCP, `fetch`, GraphQL, or network behavior.                                                                                               | Review checklist and static scan | R-023                      | Security/Dev | P0 because hidden credential scope is security-sensitive.            |

### P1

**Criteria:** High risk or promoted risk that must be mitigated before release.

| Test ID | Requirement                                                                                                                                                                                                                 | Test Level                                    | Risk Link    | Owner          | Notes                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------ | -------------- | ------------------------------------------------ |
| TD-401  | `pr-handoff` exists as a deterministic `bash` node with `timeout: 60000`, `output_type: pr-handoff`, exact evidence producer dependencies, and `trigger_rule: none_failed_min_one_success`.                                 | Bun structural contract                       | R-004, R-022 | Dev/Test       | Node shape and skipped-branch compatibility.     |
| TD-403  | Source v2 workflow parses; generated `BUNDLED_WORKFLOWS` matches source; v1 baseline is byte-for-byte unchanged; shared `archon-create-pr.md` is untouched unless guarded.                                                  | Bun structural contract and command           | R-013, R-016 | Dev/Test       | Rollback and compatibility guard.                |
| TD-405  | Real-vs-skipped selection chooses source by non-empty output for RV, NR, and TR and records the selected source node id in `gates.*.source`.                                                                                | Bun structural contract and DAG               | R-008        | Dev/Test       | Prevents stale skipped evidence.                 |
| TD-406  | Artifact path map is exact: run-dir JSON for summary, gate planner, decision-needed, skipped gates; node sidecar Markdown for CR/RV/NR/TR real gates; report_file is included when present.                                 | Bun structural contract                       | R-009        | Dev/Test       | Evidence link correctness.                       |
| TD-407  | `pr-handoff.json` top-level contract includes `contract_version`, workflow, `node:"pr-handoff"`, `story_ref`, `status:"PASS"`, quality summary, gates, gate plan, and decision-needed sections; top-level `gate` is absent. | Bun structural contract and DAG               | R-012        | Dev/Test       | Collector envelope.                              |
| TD-409  | No-deferred path explicitly renders "No decision-needed items were deferred." and does not use resolved/fixed wording for human-judgment work.                                                                              | Isolated DAG executor                         | R-011        | Dev/Test       | Required AC3 coverage.                           |
| TD-411  | Boundary rendering: deferred item fields containing pipes, newlines, brackets, empty optional values, or long titles are escaped or rendered without breaking the Markdown evidence section.                                | Isolated DAG executor                         | R-010, R-025 | Dev/Test       | Prevents field loss and table corruption.        |
| TD-414  | Missing branch boundary: RV, NR, or TR with both real and skipped outputs empty fails closed and prevents PR.                                                                                                               | Isolated DAG executor                         | R-004, R-008 | Dev/Test       | Explicit branch-boundary coverage.               |
| TD-415  | Mixed branch path: RV skipped, NR real, TR skipped produces correct outcomes, source node ids, artifact links, and no PR-blocking false failure.                                                                            | Isolated DAG executor                         | R-008, R-009 | Dev/Test       | Required skipped/real branch mix.                |
| TD-416  | Gate outcome rendering covers PASS, CONCERNS, FAIL-like fixture values where reachable, and SKIPPED without changing routing semantics inside `pr-handoff`.                                                                 | Bun structural contract and fixture rendering | R-009, R-012 | Dev/Test       | Rendering only; route semantics remain upstream. |
| TD-418  | Duplicate/concurrency behavior: two runs with distinct `ARTIFACTS_DIR` values stay isolated; duplicate same-dir execution overwrites deterministic `pr-handoff.json` and `.md` rather than appending.                       | Isolated DAG executor                         | R-020        | Dev/Test       | Duplicate action and race isolation.             |
| TD-420  | Timeout and external-work guard: node declares `timeout: 60000`, uses local shell plus `bun -e`, and introduces no network call, file crawl, or long-running process.                                                       | Bun structural contract                       | R-022, R-028 | Dev/Test       | Runtime bound.                                   |
| TD-421  | `create-pull-request.prompt_suffix` instructs the agent to read `pr-handoff.md` if it exists, include it as "Quality Evidence", skip without failure if absent, and never imply deferred items were fixed.                  | Bun structural contract                       | R-014, R-026 | Dev/Test       | Deterministic guard for AI PR behavior.          |
| TD-422  | `create-pull-request` preserves `command: archon-create-pr`, `provider: claude`, `model: sonnet`, `context: fresh`, depends only on `pr-handoff`, and is reached only after handoff success.                                | Bun structural contract and DAG               | R-003        | Dev/Test       | Compatibility plus core route.                   |
| TD-423  | `v2-pr-handoff-contract.test.ts` is registered in the non-mock workflow-defaults batch; `v2-pr-handoff-dag.test.ts` is registered as its own isolated `bun test` segment.                                                   | Bun structural contract                       | R-016, R-017 | Test architect | Bun mock isolation.                              |
| TD-426  | Existing A4.2/A5.1 route-loop regression remains valid after adding handoff: FAIL loops to `dev-story`, PASS goes forward, ERROR is not rerouted as FAIL, exhaustion reaches error, and no second route loop appears.       | Isolated DAG executor regression              | R-002, R-021 | Dev/Test       | Regression guard.                                |

### P2 And P3

| Test ID | Priority | Requirement                                                                                                                                          | Test Level                                   | Risk Link    | Notes                                                       |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------ | ----------------------------------------------------------- |
| TD-424  | P3       | New test files contain no real plan/story/finding identifiers (`a[0-9][-.][0-9]`, `R[0-9]-F[0-9]`, `A-FR-[0-9]`); synthetic story keys stay neutral. | Bun structural contract                      | R-018, R-019 | Naming hygiene.                                             |
| TD-425  | P2       | Required validation commands are documented and run: focused contract test, isolated DAG test, `bun run check:bundled`, and `bun run validate`.      | Command validation                           | R-016        | Pre-PR quality gate.                                        |
| TD-428  | P2       | Unset `ARTIFACTS_DIR` still emits stdout contract successfully but skips best-effort file writes without failing.                                    | Isolated bash technique proof                | R-015        | Degradation path; normal executor should set artifacts dir. |
| TD-429  | P2       | Shared `archon-create-pr.md` remains untouched; if it changes, a guarded file-existence include is required and `bun run generate:bundled` is rerun. | Bun structural contract and review checklist | R-013, R-016 | Shared command compatibility.                               |

## Acceptance Criteria Traceability

| Acceptance Criterion                                                                                                                                                                     | Scenario Or Waiver                                                             | Status                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| AC1 evidence links for CR, RV, NR, TR, quality summary, decision-needed-check, correct branch locations, and matching `story_ref`.                                                       | TD-400, TD-401, TD-402, TD-405, TD-406, TD-408, TD-412, TD-415, TD-421, TD-422 | Covered                                 |
| AC2 deferred items listing with finding id, title, source gate, Linear issue id, Linear URL, and status, fixture-tested against synthetic populated contracts; live population deferred. | TD-410, TD-411, W-001                                                          | Covered for rendering; live path waived |
| AC3 no deferred items explicit statement and no implication that deferred work was fixed.                                                                                                | TD-409, TD-410, TD-421                                                         | Covered                                 |
| AC4 full route-facing envelope and story identity; mismatched or empty `story_ref` fails closed with no artifact.                                                                        | TD-407, TD-408, TD-412, TD-413, TD-417                                         | Covered                                 |
| AC5 bundle parity, v1 baseline untouched, and shared `archon-create-pr` remains compatible via v2 `prompt_suffix` or guarded include.                                                    | TD-403, TD-421, TD-423, TD-425, TD-429                                         | Covered                                 |

## High-Risk Trace

| Risk ID | Status                        | Scenario Or Waiver                                                                     |
| ------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| R-001   | Covered                       | TD-400                                                                                 |
| R-002   | Covered                       | TD-400, TD-426                                                                         |
| R-003   | Covered                       | TD-402, TD-422                                                                         |
| R-004   | Covered                       | TD-401, TD-414                                                                         |
| R-005   | Covered                       | TD-404                                                                                 |
| R-006   | Covered                       | TD-412                                                                                 |
| R-007   | Covered                       | TD-413, TD-417                                                                         |
| R-008   | Covered                       | TD-405, TD-414, TD-415                                                                 |
| R-009   | Covered                       | TD-406, TD-408, TD-416                                                                 |
| R-010   | Covered plus live waiver      | TD-410, TD-411, W-001                                                                  |
| R-011   | Covered                       | TD-409                                                                                 |
| R-012   | Covered                       | TD-407, TD-408                                                                         |
| R-013   | Covered                       | TD-403, TD-429                                                                         |
| R-014   | Covered                       | TD-421                                                                                 |
| R-015   | Covered plus degradation case | TD-408, TD-428                                                                         |
| R-016   | Covered                       | TD-403, TD-423, TD-425, TD-429                                                         |
| R-017   | Covered                       | TD-423                                                                                 |
| R-019   | Covered                       | TD-404, TD-410, TD-412, TD-424                                                         |
| R-020   | Covered                       | TD-418                                                                                 |
| R-021   | Covered                       | TD-419, TD-426                                                                         |
| R-022   | Covered                       | TD-401, TD-420                                                                         |
| R-023   | Covered plus waiver           | TD-427, W-004                                                                          |
| R-024   | Explicit non-risk plus waiver | NR-001, TD-404, W-002                                                                  |
| R-025   | Covered                       | TD-411                                                                                 |
| R-026   | Covered plus live waiver      | TD-421, W-005                                                                          |
| R-027   | Covered                       | TD-408, TD-409, TD-410, TD-411, TD-412, TD-413, TD-414, TD-415, TD-417, TD-418, TD-419 |

## Reviewer Concern Register

| Concern ID | Known concern treated as evidence                                                                                   | Disposition       | Probability | Impact | Score | Priority | Scenario, Non-Risk, Or Waiver |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------- | ------ | ----- | -------- | ----------------------------- |
| C-001      | a5-1 `decision-needed-check` is absent in the current checkout and must be restored.                                | Risk R-001        | 3           | 3      | 9     | P0       | TD-400                        |
| C-002      | A4.2 tail must remain intact: summary verifier, single route loop, negative route, exhausted route, and error node. | Risk R-002        | 3           | 3      | 9     | P0       | TD-400, TD-426                |
| C-003      | `create-pull-request` must preserve command/provider/model/context shape.                                           | Risk R-003        | 2           | 3      | 6     | P1       | TD-422                        |
| C-004      | BMAD-METHOD M3.1/M3.2 and Linear are unavailable; live population remains deferred.                                 | Risk R-010        | 3           | 3      | 9     | P0       | TD-410, W-001                 |
| C-005      | Build evidence links and deferred rendering now; do not fake live Linear population.                                | Risk R-010, R-023 | 3           | 3      | 9     | P0       | TD-410, TD-427, W-001         |
| C-006      | Add deterministic `pr-handoff` bash collector between decision check and PR.                                        | Risk R-003        | 3           | 3      | 9     | P0       | TD-401, TD-402                |
| C-007      | `pr-handoff.depends_on` must include all evidence producers and `trigger_rule: none_failed_min_one_success`.        | Risk R-004        | 2           | 3      | 6     | P1       | TD-401                        |
| C-008      | Read contracts from `$node.output`, not filesystem scans or Markdown reports.                                       | Risk R-005        | 3           | 3      | 9     | P0       | TD-404                        |
| C-009      | Use whole-output substitution, not field-level output references, for contracts.                                    | Risk R-005        | 3           | 3      | 9     | P0       | TD-404                        |
| C-010      | Use `bun -e` plus `JSON.parse`, not grep/case on raw JSON.                                                          | Risk R-005        | 3           | 3      | 9     | P0       | TD-404                        |
| C-011      | Resolve RV/NR/TR as real-or-skipped branches based on non-empty output.                                             | Risk R-008        | 2           | 3      | 6     | P1       | TD-405, TD-415                |
| C-012      | Validate `story_ref` matches on every consumed contract.                                                            | Risk R-006        | 3           | 3      | 9     | P0       | TD-412                        |
| C-013      | Fail closed on mismatch or missing output and emit no artifact.                                                     | Risk R-006, R-007 | 3           | 3      | 9     | P0       | TD-412, TD-413, TD-417        |
| C-014      | Do not rerun the full envelope gauntlet in `pr-handoff`.                                                            | Explicit non-risk | 2           | 2      | 4     | P1       | NR-001, TD-404, W-002         |
| C-015      | `pr-handoff.json` must carry full collector envelope and evidence fields.                                           | Risk R-012        | 2           | 3      | 6     | P1       | TD-407, TD-408                |
| C-016      | Use `status`, not `gate`, for the collector contract.                                                               | Explicit non-risk | 1           | 3      | 3     | P1       | NR-002, TD-407                |
| C-017      | Artifact paths are not uniform and must map to run-dir JSON or node sidecars correctly.                             | Risk R-009        | 2           | 3      | 6     | P1       | TD-406, TD-408                |
| C-018      | Markdown must list each gate with outcome, source, findings, artifact, and report when available.                   | Risk R-009        | 2           | 3      | 6     | P1       | TD-408, TD-416                |
| C-019      | No-deferred state must explicitly state no decision-needed items were deferred.                                     | Risk R-011        | 2           | 3      | 6     | P1       | TD-409                        |
| C-020      | Deferred populated state must list finding id, title, source gate, Linear issue id, Linear URL, and status.         | Risk R-010        | 3           | 3      | 9     | P0       | TD-410, TD-411                |
| C-021      | Deferred populated state must say items were deferred to Linear and NOT fixed in this PR.                           | Risk R-010        | 3           | 3      | 9     | P0       | TD-410                        |
| C-022      | Never imply deferred human-judgment work was fixed.                                                                 | Risk R-010        | 3           | 3      | 9     | P0       | TD-409, TD-410, TD-421        |
| C-023      | Best-effort writes should use guarded `ARTIFACTS_DIR` handling.                                                     | Risk R-015        | 2           | 3      | 6     | P1       | TD-408, TD-428                |
| C-024      | Retarget `create-pull-request.depends_on` from decision-needed to `pr-handoff`.                                     | Risk R-003        | 3           | 3      | 9     | P0       | TD-402, TD-422                |
| C-025      | Prefer `prompt_suffix` over modifying shared `archon-create-pr.md`.                                                 | Risk R-013        | 2           | 3      | 6     | P1       | TD-421, TD-429                |
| C-026      | If handoff file is absent, PR creation should skip evidence inclusion and not fail.                                 | Risk R-014        | 2           | 3      | 6     | P1       | TD-421                        |
| C-027      | Do not hard-code BMAD evidence logic into the shared command unguarded.                                             | Risk R-013        | 2           | 3      | 6     | P1       | TD-429                        |
| C-028      | Do not modify upstream nodes, engine code, or v1 baseline.                                                          | Risk R-002, R-016 | 2           | 3      | 6     | P1       | TD-403, TD-426                |
| C-029      | Do not add a route loop, when branch, or separate error node for handoff.                                           | Risk R-002, R-021 | 2           | 3      | 6     | P1       | TD-426                        |
| C-030      | New contract test must be non-mock and co-located in the existing non-mock batch.                                   | Risk R-016, R-017 | 2           | 3      | 6     | P1       | TD-423                        |
| C-031      | New DAG test must be isolated because it uses `mock.module`.                                                        | Risk R-017        | 2           | 3      | 6     | P1       | TD-423                        |
| C-032      | DAG test must prove all gates PASS with no deferred items.                                                          | Risk R-027        | 3           | 3      | 9     | P0       | TD-408, TD-409                |
| C-033      | DAG test must prove synthetic populated deferred items render correctly.                                            | Risk R-010        | 3           | 3      | 9     | P0       | TD-410, TD-411                |
| C-034      | DAG test must prove story_ref mismatch fails closed and PR is not reached.                                          | Risk R-006        | 3           | 3      | 9     | P0       | TD-412                        |
| C-035      | DAG test must prove RV skipped, NR real, TR skipped branch mix.                                                     | Risk R-008        | 2           | 3      | 6     | P1       | TD-415                        |
| C-036      | DAG test must prove emitted JSON carries full envelope and resolved story_ref.                                      | Risk R-012        | 2           | 3      | 6     | P1       | TD-407, TD-408                |
| C-037      | Test files must avoid real plan/story/finding identifiers and use neutral synthetic keys.                           | Risk R-018, R-019 | 1           | 2      | 2     | P3       | TD-424                        |
| C-038      | Run `generate:bundled`, `check:bundled`, focused tests, and `bun run validate`.                                     | Risk R-016        | 2           | 3      | 6     | P1       | TD-425                        |
| C-039      | Export shell values into `bun -e` using the prefix-env pattern.                                                     | Risk R-019        | 2           | 3      | 6     | P1       | TD-404                        |
| C-040      | Avoid unsafe numeric coercion inherited from a5-1 reviewer findings.                                                | Risk R-019        | 2           | 3      | 6     | P1       | TD-404, TD-410                |
| C-041      | Duplicate actions and concurrent runs should not leak artifacts across run dirs.                                    | Risk R-020        | 2           | 3      | 6     | P1       | TD-418                        |
| C-042      | Timeout, cancellation, and partial failure must be addressed where applicable.                                      | Risk R-021, R-022 | 2           | 3      | 6     | P1       | TD-417, TD-419, TD-420, W-003 |
| C-043      | Permission/auth and regression cases must be covered or waived.                                                     | Risk R-023        | 3           | 3      | 9     | P0       | TD-427, W-004                 |
| C-044      | Live AI inclusion in PR body is not fully deterministic in unit tests.                                              | Risk R-026        | 2           | 3      | 6     | P1       | TD-421, W-005                 |

## Edge-Case Coverage

| Edge Category       | Coverage Or Waiver                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path          | TD-408 covers all real gates PASS, successful artifact writes, and PR reachability.                                                    |
| Negative path       | TD-412, TD-413, TD-414, TD-417, and TD-419 cover stale, malformed, missing, partial, and dependency-failure paths.                     |
| Boundary cases      | TD-411 covers special characters and long deferred fields; TD-414 covers empty branch boundaries; TD-428 covers unset `ARTIFACTS_DIR`. |
| Malformed input     | TD-413 covers invalid JSON for every consumed producer.                                                                                |
| Stale data          | TD-412 covers empty or mismatched `story_ref` for every consumed producer.                                                             |
| Duplicate actions   | TD-418 covers repeated same-dir execution and deterministic overwrite behavior.                                                        |
| Out-of-order events | TD-419 covers route-loop non-completion, failed dependencies, and missing producer outputs.                                            |
| Partial failure     | TD-417 covers no partial stdout or artifact emission on validation failure.                                                            |
| Dependency failure  | TD-419 covers failed or skipped prerequisite producers preventing handoff and PR.                                                      |
| Timeout             | TD-401 and TD-420 cover `timeout: 60000` and local-only work.                                                                          |
| Cancellation        | W-003 covers unchanged executor cancellation semantics.                                                                                |
| Concurrency or race | TD-418 covers run-directory isolation; TD-423 covers Bun mock isolation.                                                               |
| Rollback            | TD-403 and TD-429 cover v1 baseline and shared command compatibility.                                                                  |
| Permission/auth     | TD-427 and W-004 cover no auth/credential/network surface changes.                                                                     |
| Regression          | TD-426 covers A4.2/A5.1 route-loop behavior after adding handoff.                                                                      |

## Waivers

| Waiver ID | Scope                                                                                               | Reason                                                                                                                                    | Owner                                            | Residual Risk                                                                                                           | Follow-Up Trigger                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-001     | Live population of `decision-needed-check.deferred_items` from Linear and BMAD-METHOD sync.         | BMAD-METHOD M3.1/M3.2 and Linear integration are unavailable, and a5-1 currently fails closed before PR when `decision_needed_count > 0`. | BMAD-METHOD owner and Archon workflow maintainer | Fixture rendering can pass while real Linear population remains unproven.                                               | Reopen when M3.1/M3.2, Linear capability, and a5-1 live AC5/AC6 implementation are present.                                                              |
| W-002     | Full envelope gauntlet inside `pr-handoff`.                                                         | The story explicitly scopes collector validation to presence and `story_ref` because upstream nodes already validate envelopes.           | Workflow architect                               | If upstream validators are removed or weakened, `pr-handoff` may trust insufficient contracts.                          | Reopen if upstream validation code changes, skipped-node contract shape changes, or route-facing contract version changes.                               |
| W-003     | Executor cancellation lifecycle.                                                                    | The story does not change executor lifecycle ownership or cancellation handling.                                                          | Workflow engine owner                            | A cancellation during best-effort file writes could leave partial filesystem artifacts even though the run is terminal. | Reopen if executor cancellation behavior, bash node lifecycle, or long-running external work changes.                                                    |
| W-004     | Auth, adapter permission, and credential delivery runtime tests.                                    | No auth, adapter, provider-credential, user-token, Linear API, MCP, or network code should change.                                        | Security/platform owner                          | Hidden scope creep would be serious if the implementation touches those surfaces.                                       | Reopen immediately if the diff touches adapters, server auth, user credential stores, provider env injection, `fetch`, GraphQL, MCP, or Linear API code. |
| W-005     | Deterministic proof that the AI PR writer includes the handoff section in the final GitHub PR body. | The static workflow can require `prompt_suffix`, but the AI command's final prose inclusion is not deterministic in unit tests.           | Workflow maintainer                              | PR body may omit evidence even when artifacts exist.                                                                    | Reopen during A6.1 vertical-slice validation or if `archon-create-pr` gains deterministic PR body assembly.                                              |
| W-006     | Load/performance benchmarking.                                                                      | The collector is bounded local JSON parsing and Markdown rendering; no service endpoint or high-volume runtime path is introduced.        | Workflow maintainer                              | Very large future evidence payloads could exceed expectations.                                                          | Reopen if the collector reads external files, network resources, or large unbounded evidence sets.                                                       |
| W-007     | Browser UI or console E2E.                                                                          | There is no browser-visible surface for this story.                                                                                       | Web/console owner                                | UI consumers may later render handoff artifacts incorrectly.                                                            | Reopen if Web UI, console, or artifact viewer surfaces display `pr-handoff` evidence.                                                                    |

## Execution Strategy

Run everything in PRs if the focused workflow suite remains under the existing package budget.
Defer only long-running, live-network, or manual proof runs.

| Cadence         | Scope                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR              | `bun test packages/workflows/src/defaults/v2-pr-handoff-contract.test.ts`; isolated `bun test packages/workflows/src/defaults/v2-pr-handoff-dag.test.ts`; `bun run check:bundled`; `bun run validate` before PR. |
| Nightly         | Full `bun run test` package-isolated suite if PR validation time grows; otherwise no separate nightly requirement for this story.                                                                                |
| Weekly / Manual | A6.1 vertical-slice proof that the final PR body includes the generated handoff evidence. Live Linear/BMAD-METHOD population only after W-001 trigger.                                                           |

## Resource Estimates

| Priority          | Scenario Count                  | Effort Range             | Notes                                                                                        |
| ----------------- | ------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| P0                | 10                              | About 12 to 20 hours     | Real DAG setup, fail-closed proofs, deferred rendering, security scope review.               |
| P1                | 16                              | About 10 to 18 hours     | Static contract assertions, branch mixes, package script registration, compatibility guards. |
| P2/P3             | 4                               | About 2 to 4 hours       | Naming hygiene, command validation, degradation path.                                        |
| Waiver management | 7                               | About 1 to 2 hours       | Record and review owners/triggers.                                                           |
| **Total**         | **30 scenarios plus 7 waivers** | **About 24 to 42 hours** | Includes implementation test setup and expected iteration.                                   |

## Quality Gate Criteria

- P0 pass rate: 100%.
- P1 pass rate: 100% or approved waiver with owner, residual risk, and follow-up trigger.
- All high-risk items have explicit scenario or waiver trace.
- All reviewer concerns have explicit scenario, non-risk, or waiver trace.
- `bun run check:bundled` passes.
- Focused handoff contract and DAG tests pass.
- `bun run validate` passes before PR.
- No hidden changes to v1 baseline, shared command behavior, auth/credential surfaces, executor lifecycle, or upstream quality nodes.
- Full NFR PASS/CONCERNS/FAIL status remains deferred to `nfr-assess` when implementation evidence exists.

## Mitigation Plans

### R-001/R-002/R-003: Baseline and Route Chain Breakage

**Mitigation Strategy:**

1. Restore a5-1 `decision-needed-check` end-state first.
2. Assert A4.2 route loop remains single and intact.
3. Insert `pr-handoff` only after those baselines pass.
4. Retarget PR dependency only to `pr-handoff`.

**Owner:** Workflow implementer.
**Timeline:** Before PR.
**Verification:** TD-400, TD-402, TD-422, TD-426.

### R-005/R-006/R-007: Route Contract Data Integrity

**Mitigation Strategy:**

1. Consume whole-output JSON contracts only.
2. Export values into `bun -e` using prefixed env vars.
3. Use `JSON.parse` and fail before stdout or artifacts on malformed or stale inputs.
4. Table-drive stale and malformed producer cases.

**Owner:** Workflow implementer.
**Timeline:** Before PR.
**Verification:** TD-404, TD-412, TD-413, TD-417.

### R-010/R-011/R-025: Deferred Work Must Not Be Misrepresented

**Mitigation Strategy:**

1. Render no-deferred and populated-deferred states separately.
2. Include explicit "deferred to Linear" and "NOT fixed in this PR" language when populated.
3. Guard against misleading fixed/resolved wording.
4. Escape or safely render deferred item fields.

**Owner:** Workflow implementer.
**Timeline:** Before PR.
**Verification:** TD-409, TD-410, TD-411, TD-421.

### R-013/R-014/R-016/R-017: Compatibility, Bundle, And Test Isolation

**Mitigation Strategy:**

1. Prefer v2 node `prompt_suffix` over modifying shared command.
2. Keep shared command untouched or guarded.
3. Regenerate bundled defaults.
4. Register non-mock and mock tests in separate Bun invocations.

**Owner:** Workflow implementer and test architect.
**Timeline:** Before PR.
**Verification:** TD-403, TD-421, TD-423, TD-425, TD-429.

### R-023: Hidden Security Scope

**Mitigation Strategy:**

1. Keep implementation local to workflow YAML and tests.
2. Block hidden Linear, network, MCP, token, auth, adapter, or provider credential changes.
3. Reopen security testing if any such file scope appears.

**Owner:** Security/platform owner.
**Timeline:** Before PR.
**Verification:** TD-427 and W-004.

## Assumptions and Dependencies

### Assumptions

1. The implementation will use the preferred v2 `prompt_suffix` approach and will not modify `archon-create-pr.md`.
2. The executor sets `ARTIFACTS_DIR` in normal workflow runs.
3. The handoff Markdown is a human evidence surface; routing remains based only on JSON contracts.
4. The final live PR body proof belongs to the A6.1 vertical-slice validation because `create-pull-request` is AI-driven.

### Dependencies

1. a5-1 restoration is required before a5.2 can be completed.
2. Existing a5-1 contract and DAG tests are the closest templates.
3. `bun run generate:bundled` must be run after workflow/default command source changes.
4. Live Linear population depends on BMAD-METHOD M3.1/M3.2 and an accepted Linear integration.

### Risks To Plan

- **Risk:** The implementation copies the target node body exactly and misses escaping or edge failure cases.
  - **Impact:** Reviewers receive malformed or misleading evidence.
  - **Contingency:** TD-411, TD-412, TD-413, and TD-417 must fail red until edge behavior is explicit.

- **Risk:** a5-1 restoration becomes larger than expected.
  - **Impact:** a5.2 becomes a mixed restoration plus new-feature patch.
  - **Contingency:** Keep TD-400 as a separate hard gate and document restoration in the Dev Agent Record.

## Interworking & Regression

| Service/Component                                                    | Impact                                                                 | Regression Scope                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` | Adds `pr-handoff`, restores a5-1 if needed, and rewires PR dependency. | TD-400 through TD-426 plus `parseWorkflow`.                          |
| `packages/workflows/src/defaults/bundled-defaults.generated.ts`      | Generated mirror must match workflow source.                           | `bun run generate:bundled`, `bun run check:bundled`, TD-403, TD-429. |
| `packages/workflows/package.json`                                    | Must isolate mock-based DAG test.                                      | TD-423 plus package test script review.                              |
| `archon-create-pr` shared command                                    | Should remain untouched or guarded to preserve non-BMAD workflows.     | TD-421, TD-429, W-005.                                               |
| A4.2/A5.1 quality route loop                                         | Must keep FAIL/PASS/ERROR/exhaustion behavior stable.                  | TD-400, TD-426.                                                      |

## Appendix

### Knowledge Base References

- `risk-governance.md` - Risk scoring and mitigation ownership.
- `probability-impact.md` - Probability and impact definitions.
- `test-levels-framework.md` - Test-level selection and duplicate coverage guard.
- `test-priorities-matrix.md` - P0/P1/P2/P3 priority rules.
- `nfr-criteria.md` - NFR planning and evidence expectations.
- `api-testing-patterns.md` - API/backend test preference over browser E2E for non-UI behavior.

### Related Documents

- Story: `_bmad-output/implementation-artifacts/a5-2-generate-pr-handoff-with-evidence-links.md`
- Prior story: `_bmad-output/implementation-artifacts/a5-1-orchestrate-decision-needed-follow-up.md`
- PRD: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md`
- Architecture: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`
- Epics: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

**Generated by:** BMad TEA Agent - Test Architect Module
**Workflow:** `bmad-testarch-test-design`
**Version:** 5.0 Step-File Architecture
