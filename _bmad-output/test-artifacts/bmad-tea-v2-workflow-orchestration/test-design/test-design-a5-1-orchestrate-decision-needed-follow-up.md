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
  - '_bmad-output/implementation-artifacts/a5-1-orchestrate-decision-needed-follow-up.md'
  - '_bmad-output/implementation-artifacts/sprint-status.yaml'
  - '_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md'
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/test-design/test-design-a4-2-route-quality-loop-and-error-paths.md'
  - 'packages/workflows/package.json'
  - 'packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/contract-testing.md'
---

# Test Design: a5.1 - Orchestrate Decision Needed Follow-Up

**Date:** 2026-07-09
**Author:** kevin
**Status:** Draft

## Executive Summary

**Scope:** Epic-level test design for inserting `decision-needed-check` between the quality loop PASS exit and PR preparation.

This design treats every known reviewer concern, unresolved story note, and explicit "do not build" instruction as evidence.

Every acceptance criterion, every high-risk item, and every reviewer concern maps to an atomic test scenario, an explicit non-risk, or a waiver with owner, residual risk, and follow-up trigger.

The live Linear create/reuse path and BMAD-METHOD sync path are not buildable in this repository today.

Coverage is therefore split into buildable-now and fail-closed behavior, with formal waivers for the deferred live integration criteria.

**Risk Summary:**

- Total risks identified: 25.
- High-priority risks or promoted core-behavior risks: 22.
- P0 risks: 10.
- P1 risks: 12.
- Critical categories: TECH, DATA, OPS, SEC, BUS.
- Primary risk theme: deferred human-judgment work must never be silently dropped, faked, routed back into `dev-story`, or represented as fixed work.

**Coverage Summary:**

- P0 scenarios: 10.
- P1 scenarios: 14.
- P2 and P3 scenarios: 3.
- Waivers: 7.
- Total effort estimate: about 19 to 32 engineering hours.

## Not In Scope

| Item                                              | Reasoning                                                                                                                              | Mitigation                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Live Linear create/reuse path                     | The story proves there is no per-finding `decision-needed.json`, no BMAD-METHOD sync contract, and no Linear integration in this repo. | Waiver W-001 keeps AC5 traceable and requires reopening when M3.1, M3.2, and an explicit Linear capability marker exist.  |
| Live BMAD-METHOD sync-success and sync-error path | The sync request and response contract is cross-project and absent.                                                                    | Waiver W-002 covers the real sync-returning-ERROR half of AC6; TD-309 covers unavailable capability today.                |
| Browser UI E2E                                    | The story changes backend workflow YAML, bash contract behavior, generated defaults, and workflow tests, not a browser-visible UI.     | Use isolated real DAG executor tests as the closest end-user workflow path.                                               |
| Load and performance testing                      | No service endpoint, user-facing latency path, or scheduler hot path changes.                                                          | TD-319 asserts bounded timeout and local-only bash behavior.                                                              |
| General auth and adapter permission behavior      | No adapter, protected HTTP route, user role, webhook, or provider credential delivery code should change.                              | Waiver W-004 reopens if the diff touches credentials, adapters, server auth, provider key delivery, or permission checks. |
| Executor cancellation lifecycle                   | Pause, cancellation, and lifecycle ownership are not changed by this YAML and bash-node story.                                         | Waiver W-003 reopens if executor lifecycle or cancellation code changes.                                                  |

## Risk Assessment

Risk score equals probability multiplied by impact.

Score 9 is P0.

Score 6 to 8 is P1.

Score 4 to 5 is P2 unless the issue can break core behavior, security, data integrity, compatibility, or cross-process contract behavior.

Score 1 to 3 is P3 unless the issue is promoted by the same core-behavior rule.

### High-Priority Risks

| Risk ID | Category | Description                                                                                                                                                     | Probability | Impact | Score | Priority | Mitigation                                                                                                             | Owner                   | Timeline         |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------- |
| R-001   | OPS      | Cross-project live dependencies are absent, but implementation fabricates Linear or BMAD-METHOD sync behavior anyway.                                           | 3           | 3      | 9     | P0       | TD-300 and TD-314 verify the buildable-now/fail-closed boundary and forbid speculative live integration.               | Workflow implementer    | Before PR        |
| R-002   | TECH     | `decision-needed-check` is not inserted at the quality loop PASS seam, so PASS still goes directly to PR.                                                       | 3           | 3      | 9     | P0       | TD-302 asserts the route-loop positive target and PR dependency rewiring.                                              | Workflow implementer    | Before PR        |
| R-003   | TECH     | `decision-needed-check.depends_on` omits `quality-route-loop`, `quality-gate-summary`, or `resolve-story-input`, allowing stale or unavailable producer output. | 2           | 3      | 6     | P1       | TD-301 asserts exact node dependencies and DAG legality.                                                               | Workflow implementer    | Before PR        |
| R-004   | DATA     | The node parses markdown, `decision-log.md`, `open-findings.md`, or a fake `decision-needed.json` as a route or sync API.                                       | 3           | 3      | 9     | P0       | TD-303 forbids prose reads and requires whole-output JSON parsing from `quality-gate-summary`.                         | Workflow implementer    | Before PR        |
| R-005   | DATA     | Summary identity or envelope validation is missing, allowing wrong-workflow, wrong-node, stale-story, or empty-story data to pass.                              | 3           | 3      | 9     | P0       | TD-306 and TD-307 prove fail-closed behavior before any contract stdout.                                               | Workflow implementer    | Before PR        |
| R-006   | DATA     | `decision_needed_count` accepts malformed, negative, fractional, missing, or misleading values.                                                                 | 3           | 3      | 9     | P0       | TD-308 covers numeric boundary and malformed-input cases.                                                              | Workflow implementer    | Before PR        |
| R-007   | BUS      | `decision_needed_count == 0` does not emit the required no-op PASS contract or does not allow PR preparation.                                                   | 2           | 3      | 6     | P1       | TD-304 and TD-305 assert full no-op contract shape, artifact write, and PR reachability.                               | Workflow implementer    | Before PR        |
| R-008   | BUS      | `decision_needed_count > 0` passes forward when Linear and sync capability are unavailable.                                                                     | 3           | 3      | 9     | P0       | TD-309 proves non-zero fail-closed exit, clear diagnostic, no contract, and no PR.                                     | Workflow implementer    | Before PR        |
| R-009   | TECH     | Decision-needed failure adds a new route branch, second `route_loop`, `when:` bypass, or reroutes to `dev-story`.                                               | 2           | 3      | 6     | P1       | TD-310 asserts structural blocking through node failure and no dev-story reroute.                                      | Workflow implementer    | Before PR        |
| R-010   | DATA     | Error paths emit partial `decision-needed-check.json` to stdout or disk before validation completes.                                                            | 3           | 3      | 9     | P0       | TD-311 asserts no stdout contract and no best-effort artifact on invalid or fail-closed paths.                         | Workflow implementer    | Before PR        |
| R-011   | OPS      | The success artifact path is wrong, missing, or appends duplicate JSON across repeated no-op runs.                                                              | 2           | 3      | 6     | P1       | TD-305 and TD-317 assert `$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/decision-needed.json` content and isolation. | Workflow implementer    | Before PR        |
| R-012   | SEC      | A live Linear client, `fetch`, GraphQL call, MCP config, or env-driven credential path is introduced without an explicit accepted capability gate.              | 3           | 3      | 9     | P0       | TD-314 and W-004 forbid speculative network and credential behavior.                                                   | Security/platform owner | Before PR        |
| R-013   | SEC      | Future live-path availability is inferred from an invented env var and becomes default-on.                                                                      | 2           | 3      | 6     | P1       | W-001 requires an explicit default-off capability marker before live-path work begins.                                 | Workflow maintainer     | Before live path |
| R-014   | OPS      | A real future sync call returns ERROR but coverage only proves today's unavailable-capability path.                                                             | 2           | 3      | 6     | P1       | W-002 records the deferred sync-returning-ERROR path and trigger.                                                      | BMAD-METHOD owner       | When M3.2 lands  |
| R-015   | OPS      | Source workflow, generated bundle, test registration, or v1 baseline drifts.                                                                                    | 2           | 3      | 6     | P1       | TD-312 and TD-313 assert bundle parity, package scripts, and baseline unchanged.                                       | Workflow implementer    | Before PR        |
| R-016   | OPS      | `mock.module()` pollution makes the DAG test order-dependent or false-green.                                                                                    | 2           | 3      | 6     | P1       | TD-313 asserts the DAG test is a standalone Bun invocation.                                                            | Test architect          | Before PR        |
| R-017   | TECH     | Runtime behavior is only implied by structural tests and never proves PR reachability or fail-closed halting.                                                   | 3           | 3      | 9     | P0       | TD-305, TD-309, TD-318, and TD-322 use isolated real executor tests.                                                   | Test architect          | Before PR        |
| R-018   | TECH     | The A4.2 quality route loop baseline is absent or accidentally changed while adding this node.                                                                  | 3           | 3      | 9     | P0       | TD-300 and TD-322 assert the baseline and existing PASS, FAIL, ERROR, and exhaustion route behavior.                   | Workflow implementer    | Before PR        |
| R-019   | BUS      | Fail-closed behavior blocks PR whenever decision-needed items exist until external dependencies land, surprising the proof-run operator.                        | 2           | 3      | 6     | P1       | TD-309 plus W-005 require an explicit operator-facing note and follow-up trigger.                                      | Workflow maintainer     | Before proof run |
| R-020   | DATA     | Duplicate no-op executions, retried actions, or parallel runs overwrite or leak decision artifacts across run directories.                                      | 2           | 3      | 6     | P1       | TD-317 runs two isolated artifact directories and asserts deterministic overwrite within one run only.                 | Workflow implementer    | Before PR        |
| R-021   | DATA     | Out-of-order events or upstream partial failure allow `decision-needed-check` to run when the route loop did not positively select it.                          | 2           | 3      | 6     | P1       | TD-318 covers summary failure, route-loop non-completion, and dependency failure.                                      | Workflow implementer    | Before PR        |
| R-022   | OPS      | The bash node has no bounded timeout or uses unbounded external runtime work.                                                                                   | 2           | 2      | 4     | P1       | TD-319 asserts timeout and local `bun -e` only; priority is promoted because a hang blocks workflow completion.        | Workflow implementer    | Before PR        |

### Medium And Low Risks

| Risk ID | Category | Description                                                                                    | Probability | Impact | Score | Priority | Action                                                                      |
| ------- | -------- | ---------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | -------- | --------------------------------------------------------------------------- |
| R-023   | TECH     | New test files embed forbidden plan, story, epic, or review-finding identifiers.               | 1           | 2      | 2     | P3       | TD-321 covers naming hygiene.                                               |
| R-024   | TECH     | Implementation touches executor, loader, providers, core, server, or unrelated workflow nodes. | 1           | 3      | 3     | P3       | TD-321 and review file-scope gate cover blast radius.                       |
| R-025   | PERF     | No runtime performance threshold exists for this local bash node.                              | 1           | 2      | 2     | P3       | TD-319 covers bounded timeout; W-006 reopens if long-running work is added. |

### Explicit Non-Risks

| ID     | Concern                                                    | Rationale                                                                                                                | Scenario Or Follow-Up                               |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| NR-001 | Live Linear path is not implemented in this story.         | This is not a hidden gap when tracked as W-001 because the story explicitly says AC5 is blocked and not buildable today. | W-001 keeps the residual risk visible.              |
| NR-002 | The success path uses `status: "PASS"` rather than `gate`. | Architecture allows `gate` or `status`, and the story explicitly says this node is not a quality gate.                   | TD-304 asserts no `gate` field.                     |
| NR-003 | Browser exploration is skipped.                            | The product surface is workflow DAG execution, not a browser page.                                                       | W-007 reopens if a web or console surface is added. |

### Reviewer Concern Register

| Concern ID | Known concern treated as evidence                                                                    | Disposition              | Probability | Impact | Score | Priority | Scenario, Non-Risk, Or Waiver |
| ---------- | ---------------------------------------------------------------------------------------------------- | ------------------------ | ----------- | ------ | ----- | -------- | ----------------------------- |
| C-001      | Per-finding `decision-needed.json` is absent.                                                        | Risk R-001               | 3           | 3      | 9     | P0       | TD-300, TD-314, W-001         |
| C-002      | BMAD-METHOD sync request and response contract is absent.                                            | Risk R-001               | 3           | 3      | 9     | P0       | TD-300, W-002                 |
| C-003      | Linear integration is absent.                                                                        | Risk R-012               | 3           | 3      | 9     | P0       | TD-314, W-001, W-004          |
| C-004      | Dev must not traverse out of the Archon repo for M3.1 or M3.2.                                       | Risk R-001               | 2           | 3      | 6     | P1       | TD-300                        |
| C-005      | Build only buildable-now and fail-closed layers today.                                               | Risk R-001               | 3           | 3      | 9     | P0       | TD-300, TD-314                |
| C-006      | `decision-needed-check` must be inserted at the PASS seam.                                           | Risk R-002               | 3           | 3      | 9     | P0       | TD-302                        |
| C-007      | `create-pull-request` must depend on `decision-needed-check`.                                        | Risk R-002               | 3           | 3      | 9     | P0       | TD-302                        |
| C-008      | The single `quality-route-loop` internals must remain unchanged.                                     | Risk R-018               | 3           | 3      | 9     | P0       | TD-300, TD-322                |
| C-009      | The new node must depend on `quality-route-loop`, `quality-gate-summary`, and `resolve-story-input`. | Risk R-003               | 2           | 3      | 6     | P1       | TD-301                        |
| C-010      | The node must read whole summary output and resolved ref unquoted in bash assignment form.           | Risk R-004               | 3           | 3      | 9     | P0       | TD-303                        |
| C-011      | Parsing must use `bun -e` and `JSON.parse`, not `grep`, `case`, or substring matching.               | Risk R-004               | 3           | 3      | 9     | P0       | TD-303                        |
| C-012      | `DNC_SUMMARY` and `DNC_RESOLVED` must actually be exported into the `bun -e` invocation.             | Risk R-005               | 2           | 3      | 6     | P1       | TD-303, TD-306                |
| C-013      | Summary envelope fields must validate before contract emission.                                      | Risk R-005               | 3           | 3      | 9     | P0       | TD-306, TD-311                |
| C-014      | `decision_needed_count` must be integer and non-negative.                                            | Risk R-006               | 3           | 3      | 9     | P0       | TD-308                        |
| C-015      | `decision_needed_count == 0` must emit full PASS no-op contract and exit zero.                       | Risk R-007               | 2           | 3      | 6     | P1       | TD-304, TD-305                |
| C-016      | Success contract must persist best-effort to the flat `decision-needed.json` path.                   | Risk R-011               | 2           | 3      | 6     | P1       | TD-305, TD-317                |
| C-017      | Success contract must use `status`, not `gate`.                                                      | Explicit non-risk NR-002 | 1           | 2      | 2     | P3       | TD-304                        |
| C-018      | `decision_needed_count > 0` with unavailable capability must exit non-zero and block PR.             | Risk R-008               | 3           | 3      | 9     | P0       | TD-309                        |
| C-019      | Decision-needed failure must not route back to `dev-story`.                                          | Risk R-009               | 2           | 3      | 6     | P1       | TD-310                        |
| C-020      | No new route branch, `when:` bypass, second route loop, or error node should be added.               | Risk R-009               | 2           | 3      | 6     | P1       | TD-310                        |
| C-021      | Live path must be explicit and default-off when it later exists.                                     | Risk R-013               | 2           | 3      | 6     | P1       | W-001                         |
| C-022      | Aggregate `decision_needed_count` is not per-finding granularity.                                    | Risk R-001               | 3           | 3      | 9     | P0       | TD-300, W-001                 |
| C-023      | Fail-closed path may block the A6 proof run if decision-needed items are expected.                   | Risk R-019               | 2           | 3      | 6     | P1       | W-005                         |
| C-024      | Source and generated bundle must remain consistent and v1 untouched.                                 | Risk R-015               | 2           | 3      | 6     | P1       | TD-312                        |
| C-025      | DAG test using `mock.module()` must run isolated.                                                    | Risk R-016               | 2           | 3      | 6     | P1       | TD-313                        |
| C-026      | Test files must avoid real story keys and forbidden plan/finding identifiers.                        | Risk R-023               | 1           | 2      | 2     | P3       | TD-321                        |
| C-027      | No engine, core, server, TEA, gate-planner, summary, or PR-command code should change.               | Risk R-024               | 1           | 3      | 3     | P3       | TD-321                        |
| C-028      | Browser UI testing is not applicable.                                                                | Explicit non-risk NR-003 | 1           | 1      | 1     | P3       | W-007                         |
| C-029      | Cancellation behavior is not changed.                                                                | Waiver W-003             | 1           | 2      | 2     | P3       | W-003                         |
| C-030      | Credential and permission behavior is not changed today.                                             | Waiver W-004             | 1           | 3      | 3     | P3       | W-004                         |
| C-031      | Partial upstream failure must not let the decision node run.                                         | Risk R-021               | 2           | 3      | 6     | P1       | TD-318                        |
| C-032      | Duplicate no-op runs must not leak artifacts.                                                        | Risk R-020               | 2           | 3      | 6     | P1       | TD-317                        |
| C-033      | The bash node must not hang.                                                                         | Risk R-022               | 2           | 2      | 4     | P1       | TD-319                        |

## NFR Planning

This is not a final NFR evidence assessment.

Final NFR PASS, CONCERNS, or FAIL belongs to `nfr-assess` after implementation evidence exists.

| NFR Category    | Requirement Or Threshold                                                                                                                                   | Risk Link                                       | Planned Validation                                                                             | Evidence Needed                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Reliability     | No-op success, fail-closed decision-needed, stale data, malformed input, partial failure, duplicate runs, and route-loop regression must be deterministic. | R-005, R-006, R-007, R-008, R-017, R-020, R-021 | Isolated real executor DAG tests.                                                              | `v2-decision-needed-dag.test.ts` output.          |
| Maintainability | Change scope must stay in v2 workflow YAML, generated defaults, two workflow-default tests, and package test registration.                                 | R-015, R-016, R-023, R-024                      | Structural contract tests and review file-scope gate.                                          | Contract test output and diff review.             |
| Compatibility   | Edited v2 must parse under workflow schema and DAG validation, source and bundle must match, and v1 must remain unchanged.                                 | R-002, R-003, R-015, R-018                      | `parseWorkflow`, source-versus-bundle assertion, and v1 baseline guard.                        | Contract test output and `bun run check:bundled`. |
| Data integrity  | Route-facing JSON must accept only the expected envelope, matching `story_ref`, and valid `decision_needed_count`; errors emit no partial contract.        | R-004, R-005, R-006, R-010, R-011               | Bash contract assertions plus invalid-summary DAG fixtures.                                    | Contract and DAG test output.                     |
| Security        | No live Linear network call, MCP path, API key behavior, credential delivery, adapter auth, or permission behavior is implemented today.                   | R-012, R-013, W-004                             | Structural absence checks and waivers for deferred credential behavior.                        | Contract test output and W-004.                   |
| Performance     | No user-facing latency or service throughput threshold exists.                                                                                             | R-022, R-025                                    | Timeout and no-unbounded-external-work checks.                                                 | Contract test output.                             |
| Scalability     | No scaling threshold is specified for this YAML-only change.                                                                                               | W-006                                           | Not applicable unless executor scheduling, shared run metadata, or live network sync is added. | Reopen on scope change.                           |
| Compliance      | Auditability requires explicit evidence that deferred human-judgment work was not dropped.                                                                 | R-008, R-011, R-019                             | Fail-closed diagnostic, no-op JSON artifact, and explicit waivers for deferred live path.      | DAG artifact output and waiver trace.             |

**Unknown thresholds:** performance, scalability, and live Linear service SLOs are UNKNOWN because the story does not introduce a live network integration.

## Entry Criteria

- [ ] A4.2 tail is present: `quality-gate-summary`, `verify-quality-summary`, `quality-route-loop`, `review-loop-error`, and current `create-pull-request` tail.
- [ ] Cross-project live dependencies are confirmed absent or explicitly provided inside this repository.
- [ ] The implementation decision is recorded as buildable-now plus fail-closed, not fake live integration.
- [ ] The team accepts that the proof run cannot pass through decision-needed items until M3.1, M3.2, and Linear capability land.
- [ ] The test author keeps deterministic bash nodes real in DAG tests.

## Exit Criteria

- [ ] All P0 scenarios pass.
- [ ] All P1 scenarios pass or have an owner-approved waiver.
- [ ] Every acceptance criterion traces to atomic scenarios or an explicit waiver.
- [ ] Every high-risk item traces to scenarios or an explicit waiver.
- [ ] Every reviewer concern traces to scenarios, explicit non-risk rationale, or an explicit waiver.
- [ ] No P0 or P1 edge case is counted as covered by implication.
- [ ] `bun test packages/workflows/src/defaults/v2-decision-needed-contract.test.ts` passes.
- [ ] `bun test packages/workflows/src/defaults/v2-decision-needed-dag.test.ts` passes as its own isolated invocation.
- [ ] `bun run check:bundled` passes.
- [ ] `bun run validate` passes before PR handoff.

## Test Coverage Plan

P0, P1, P2, and P3 are priority and risk levels.

They are not execution timing labels.

### P0

**Criteria:** Blocks core workflow behavior, security, data integrity, compatibility, or cross-process contract behavior with no acceptable workaround.

| Test ID | Requirement                                                                                                                                                                                                                                           | Test Level                                    | Risk Link                  | Notes                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------- | -------------------------------------------------------------- |
| TD-300  | A4.2 baseline exists, live cross-project dependencies are absent, and implementation is constrained to buildable-now plus fail-closed behavior.                                                                                                       | Bun structural contract and repository search | R-001, R-018               | Prevents fake Linear or sync behavior and stale-baseline work. |
| TD-302  | `quality-route-loop.routes.positive` is `decision-needed-check`, `create-pull-request.depends_on` is `[decision-needed-check]`, existing negative/exhausted routes remain unchanged, and exactly one `route_loop` still exists.                       | Bun structural contract                       | R-002, R-018               | Core seam wiring.                                              |
| TD-303  | `decision-needed-check` reads `$quality-gate-summary.output` whole-output and `$resolve-story-input.output.story_ref`, uses `DNC_SUMMARY` and `DNC_RESOLVED`, uses `bun -e` plus `JSON.parse`, and does not read markdown/prose or use `grep`/`case`. | Bun structural contract                       | R-004, R-005               | Covers JSON-only route API and env-export regression.          |
| TD-306  | Mismatched or empty summary `contract_version`, `workflow`, `node`, or `story_ref` fails closed before stdout contract emission.                                                                                                                      | Isolated DAG executor                         | R-005, R-010               | Covers stale data and wrong-producer contracts.                |
| TD-307  | Empty summary output and malformed JSON fail closed before stdout contract emission.                                                                                                                                                                  | Isolated DAG executor                         | R-004, R-005, R-010        | Covers malformed input.                                        |
| TD-308  | Missing, negative, fractional, non-numeric, or otherwise invalid `decision_needed_count` fails closed; `0` passes; any positive integer, including boundary `1`, `4`, and oversized values, fails closed when capability is unavailable.              | Isolated DAG executor                         | R-006, R-008               | Covers count boundaries.                                       |
| TD-309  | `decision_needed_count > 0` with no live capability exits non-zero with a clear diagnostic, emits no contract, writes no success artifact, and prevents `create-pull-request`.                                                                        | Isolated DAG executor                         | R-008, R-010, R-017, R-019 | Required fail-closed path.                                     |
| TD-311  | Every validation and fail-closed error path emits no partial `decision-needed-check.json` to stdout or best-effort artifact path.                                                                                                                     | Isolated DAG executor                         | R-010                      | Prevents partial or misleading contracts.                      |
| TD-314  | The implementation introduces no Linear client, GraphQL call, `fetch`, MCP config, invented `LINEAR_API_KEY` gate, or default-on live capability.                                                                                                     | Bun structural contract and file-scope review | R-001, R-012, R-013        | Security and YAGNI guard.                                      |
| TD-322  | Existing A4.2 quality-route-loop behavior still proves PASS, FAIL-then-PASS, ERROR-not-rerouted, and exhaustion paths after the positive target retargeting.                                                                                          | Isolated DAG executor regression              | R-017, R-018               | Regression safety for previous story behavior.                 |

### P1

**Criteria:** Core path or high-risk behavior that must be mitigated before release.

| Test ID | Requirement                                                                                                                                                                                                                                            | Test Level                                        | Risk Link           | Notes                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------- | ------------------------------------------------ |
| TD-301  | `decision-needed-check` exists as a deterministic `bash` node with `timeout: 60000`, `output_type: decision-needed-check`, and exact dependencies `[quality-route-loop, quality-gate-summary, resolve-story-input]`.                                   | Bun structural contract                           | R-003, R-022        | Node shape and timeout guard.                    |
| TD-304  | Success contract includes `contract_version`, `workflow`, `node`, `story_ref`, `status:"PASS"`, echoed `decision_needed_count`, `deferred:false`, zero created/reused/synced/deferred counts, and empty `deferred_items`, and does not include `gate`. | Bun structural contract and isolated DAG executor | R-007               | Full envelope and non-gate status behavior.      |
| TD-305  | `decision_needed_count == 0` emits the success contract to stdout, persists `$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/decision-needed.json`, exits zero, and allows `create-pull-request` to run.                                               | Isolated DAG executor                             | R-007, R-011, R-017 | Primary happy path.                              |
| TD-310  | `decision_needed_count > 0` does not add a route branch, second `route_loop`, `when:` bypass, or `dev-story` reroute.                                                                                                                                  | Bun structural contract and isolated DAG executor | R-009               | Negative path structure.                         |
| TD-312  | Source v2 workflow parses, source and `BUNDLED_WORKFLOWS` match after generation, `bun run check:bundled` passes, and v1 is byte-for-byte unchanged.                                                                                                   | Bun structural contract and command               | R-015               | Rollback and generated-default parity.           |
| TD-313  | `v2-decision-needed-contract.test.ts` is registered in the non-mock workflow-defaults batch, and `v2-decision-needed-dag.test.ts` runs as its own Bun invocation.                                                                                      | Bun structural contract                           | R-016               | Bun mock isolation.                              |
| TD-315  | Deferred AC5 target shape is documented but not implemented: when future live path exists, per-finding items must include finding id, title/source gate, Linear issue id, Linear URL, story reference, sync result, and `deferred:true`.               | Documentation trace and waiver gate               | R-001, R-014        | Prevents loss of future requirements.            |
| TD-316  | Deferred AC6 sync-returning-ERROR path is not counted as covered by today's unavailable-capability path.                                                                                                                                               | Waiver trace review                               | R-014               | Prevents false completeness.                     |
| TD-317  | Two no-op DAG runs with distinct `ARTIFACTS_DIR` values write isolated `decision-needed.json` artifacts; duplicate no-op execution in one directory overwrites deterministic JSON rather than appending.                                               | Isolated DAG executor                             | R-011, R-020        | Duplicate action and concurrency isolation.      |
| TD-318  | Summary failure, route-loop non-completion, or dependency failure prevents `decision-needed-check` execution and prevents PR preparation.                                                                                                              | Isolated DAG executor                             | R-017, R-021        | Partial failure and out-of-order event coverage. |
| TD-319  | `decision-needed-check` declares bounded timeout and performs only local shell plus `bun -e` JSON work in the buildable-now path.                                                                                                                      | Bun structural contract                           | R-022, R-025        | Timeout guard.                                   |
| TD-320  | Permission and credential behavior remains untouched in the current story.                                                                                                                                                                             | Review checklist                                  | R-012, W-004        | Auth and permission scope guard.                 |
| TD-323  | Operator-facing Dev Agent Record or completion notes state that fail-closed-only behavior blocks PR when decision-needed items exist until live dependencies land.                                                                                     | Review checklist                                  | R-019               | Proof-run expectation guard.                     |
| TD-324  | Valid no-op contract `story_ref` exactly equals `$resolve-story-input.output.story_ref` in stdout and persisted artifact.                                                                                                                              | Isolated DAG executor                             | R-005, R-007        | Same-story identity confirmation on success.     |

### P2 And P3

| Test ID | Priority | Requirement                                                                                                                               | Test Level              | Risk Link    | Notes                               |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------ | ----------------------------------- |
| TD-321  | P3       | New test files avoid forbidden plan, story, epic, and review-finding identifiers; runtime ids and `output_type` values remain kebab-case. | Bun structural contract | R-023        | Project convention guard.           |
| TD-325  | P3       | File scope is limited to v2 YAML, generated bundled defaults, two decision-needed tests, and `packages/workflows/package.json`.           | Review checklist        | R-024        | Rollback scope guard.               |
| TD-326  | P2       | Long-running live-path performance and scalability tests remain deferred because no live network path is built.                           | Waiver trace review     | R-025, W-006 | Reopen if live path is implemented. |

## Acceptance Criteria Traceability

| Acceptance Criterion                                                                                    | Scenario Or Waiver                                                                             | Status              |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------- |
| AC1 wiring inserts `decision-needed-check` at the PASS seam and preserves one route loop.               | TD-300, TD-301, TD-302, TD-312, TD-322                                                         | Covered             |
| AC2 no-op pass-forward emits full PASS contract and reaches PR.                                         | TD-304, TD-305, TD-317, TD-324                                                                 | Covered             |
| AC3 contract envelope, story identity, artifact write, and fail-closed summary validation.              | TD-303, TD-304, TD-305, TD-306, TD-307, TD-308, TD-311, TD-324                                 | Covered             |
| AC4 count greater than zero with unavailable capability fails closed and blocks PR without new routing. | TD-309, TD-310, TD-311, TD-318, TD-323                                                         | Covered             |
| AC5 live Linear create/reuse and BMAD-METHOD sync success.                                              | W-001 plus TD-315                                                                              | Waived as deferred  |
| AC6 real sync returns ERROR after capability was expected.                                              | TD-309 covers unavailable capability today; W-002 plus TD-316 covers future real sync failure. | Partial plus waiver |
| AC7 bundle parity and v1 baseline untouched.                                                            | TD-312, TD-313, TD-321, TD-325                                                                 | Covered             |

## High-Risk Trace

| Risk ID | Status                        | Scenario Or Waiver                     |
| ------- | ----------------------------- | -------------------------------------- |
| R-001   | Covered plus waived live path | TD-300, TD-314, W-001, W-002           |
| R-002   | Covered                       | TD-302                                 |
| R-003   | Covered                       | TD-301                                 |
| R-004   | Covered                       | TD-303, TD-307                         |
| R-005   | Covered                       | TD-303, TD-306, TD-324                 |
| R-006   | Covered                       | TD-308                                 |
| R-007   | Covered                       | TD-304, TD-305, TD-324                 |
| R-008   | Covered                       | TD-309, TD-311                         |
| R-009   | Covered                       | TD-310                                 |
| R-010   | Covered                       | TD-306, TD-307, TD-308, TD-309, TD-311 |
| R-011   | Covered                       | TD-305, TD-317                         |
| R-012   | Covered plus waiver           | TD-314, TD-320, W-004                  |
| R-013   | Waived deferred live path     | W-001                                  |
| R-014   | Waived deferred sync path     | W-002, TD-316                          |
| R-015   | Covered                       | TD-312                                 |
| R-016   | Covered                       | TD-313                                 |
| R-017   | Covered                       | TD-305, TD-309, TD-318, TD-322         |
| R-018   | Covered                       | TD-300, TD-302, TD-322                 |
| R-019   | Covered plus waiver           | TD-309, TD-323, W-005                  |
| R-020   | Covered                       | TD-317                                 |
| R-021   | Covered                       | TD-318                                 |
| R-022   | Covered                       | TD-301, TD-319                         |

## Reviewer Concern Trace

| Concern ID | Status                      | Scenario, Non-Risk, Or Waiver |
| ---------- | --------------------------- | ----------------------------- |
| C-001      | Waived deferred live path   | W-001                         |
| C-002      | Waived deferred sync path   | W-002                         |
| C-003      | Waived deferred live path   | W-001, W-004                  |
| C-004      | Covered                     | TD-300                        |
| C-005      | Covered                     | TD-300, TD-314                |
| C-006      | Covered                     | TD-302                        |
| C-007      | Covered                     | TD-302                        |
| C-008      | Covered                     | TD-300, TD-322                |
| C-009      | Covered                     | TD-301                        |
| C-010      | Covered                     | TD-303                        |
| C-011      | Covered                     | TD-303                        |
| C-012      | Covered                     | TD-303, TD-306                |
| C-013      | Covered                     | TD-306, TD-311                |
| C-014      | Covered                     | TD-308                        |
| C-015      | Covered                     | TD-304, TD-305                |
| C-016      | Covered                     | TD-305, TD-317                |
| C-017      | Explicit non-risk           | NR-002 plus TD-304            |
| C-018      | Covered                     | TD-309                        |
| C-019      | Covered                     | TD-310                        |
| C-020      | Covered                     | TD-310                        |
| C-021      | Waived deferred live path   | W-001                         |
| C-022      | Waived deferred live path   | W-001                         |
| C-023      | Waived proof-run dependency | W-005 plus TD-323             |
| C-024      | Covered                     | TD-312                        |
| C-025      | Covered                     | TD-313                        |
| C-026      | Covered                     | TD-321                        |
| C-027      | Covered                     | TD-325                        |
| C-028      | Explicit non-risk           | NR-003 plus W-007             |
| C-029      | Waived                      | W-003                         |
| C-030      | Waived                      | W-004                         |
| C-031      | Covered                     | TD-318                        |
| C-032      | Covered                     | TD-317                        |
| C-033      | Covered                     | TD-319                        |

## Edge-Case Coverage

| Edge Category       | Coverage Or Waiver                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Happy path          | TD-305 and TD-324 cover no-op success and PR reachability.                                             |
| Negative path       | TD-309 and TD-310 cover decision-needed items with unavailable capability.                             |
| Boundary cases      | TD-308 covers zero, positive, malformed, negative, fractional, and oversized count values.             |
| Malformed input     | TD-307 and TD-308 cover malformed JSON and invalid fields.                                             |
| Stale data          | TD-306 and TD-324 cover wrong and correct `story_ref`.                                                 |
| Duplicate actions   | TD-317 covers repeated no-op artifact writes.                                                          |
| Out-of-order events | TD-318 covers route-loop non-completion and producer failure.                                          |
| Partial failure     | TD-318 covers summary and dependency failure.                                                          |
| Dependency failure  | TD-318 covers missing or failed upstream producers.                                                    |
| Timeout             | TD-301 and TD-319 cover bounded timeout.                                                               |
| Cancellation        | W-003 covers unchanged executor lifecycle behavior.                                                    |
| Concurrency or race | TD-317 and TD-313 cover artifact isolation and mock isolation.                                         |
| Rollback            | TD-312 and TD-325 cover v1 baseline, generated bundle, and file scope.                                 |
| Permission or auth  | W-004 and TD-320 cover current no-change scope; W-001 reopens for live Linear credentials.             |
| Regression          | TD-300, TD-302, TD-312, TD-313, TD-321, TD-322, and TD-325 cover prior route-loop and bundle behavior. |

## Waivers

| Waiver ID | Subject                                                  | Reason                                                                                                                         | Owner                                     | Residual Risk                                                                                              | Follow-Up Trigger                                                                                                                                          |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-001     | Live Linear create/reuse success path.                   | AC5 is explicitly blocked because per-finding `decision-needed.json`, Linear capability, and BMAD-METHOD sync are absent.      | Workflow maintainer and BMAD-METHOD owner | Deferred findings cannot be tracked automatically in this repository state; fail-closed blocks PR instead. | Reopen when M3.1 per-finding contract, M3.2 sync contract, and an explicit default-off Linear capability marker exist inside the allowed project boundary. |
| W-002     | Real BMAD-METHOD sync returning ERROR after a live call. | Today's buildable node never performs the real sync call, so only unavailable-capability fail-closed behavior can be executed. | BMAD-METHOD owner                         | A future sync implementation could mishandle provider errors if this waiver is not reopened.               | Reopen when M3.2 defines request and response schemas or when any sync command/skill is added.                                                             |
| W-003     | Cancellation behavior.                                   | Executor cancellation, pause, retry ownership, and lifecycle mutation are unchanged by this YAML and bash-node story.          | Workflow maintainer                       | Cancellation during a decision-needed artifact write is not newly exercised.                               | Reopen if implementation touches executor cancellation, pause, retry, lifecycle ownership, or node state mutation.                                         |
| W-004     | Credential, auth, and permission behavior.               | No auth routes, adapters, provider credential delivery, Linear credential injection, or permission checks are in scope today.  | Security/platform owner                   | A stray implementation change could introduce untested credential exposure or authorization behavior.      | Reopen if the diff touches credentials, adapters, server auth, provider key delivery, MCP credential config, or permission checks.                         |
| W-005     | Proof-run decision-needed items.                         | Fail-closed-only behavior means a proof run with decision-needed items cannot continue to PR until live dependencies land.     | Workflow maintainer                       | A6.1's decision-needed proof leg remains blocked or must use a no-decision-needed fixture.                 | Reopen before A6.1 if the operator expects unresolved decision-needed findings in the proof run.                                                           |
| W-006     | Load and scalability testing.                            | No live network path, service endpoint, scheduler hot path, or throughput threshold is introduced.                             | Workflow maintainer                       | Future live Linear sync might add latency, retry, and rate-limit behavior without performance coverage.    | Reopen if live Linear, MCP, fetch, retry, queue, scheduler, or shared-state behavior is implemented.                                                       |
| W-007     | Browser UI E2E.                                          | This story has no browser target URL and no web UI acceptance path.                                                            | Test architect                            | A future console view could misrepresent decision-needed state without UI tests.                           | Reopen if web or console UI renders decision-needed-check status, artifacts, or follow-up links.                                                           |

## NFR Coverage And Evidence Plan

| NFR             | Scenario Coverage                                      | Evidence Source                                   | Notes                                                                                      |
| --------------- | ------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Reliability     | TD-305, TD-309, TD-317, TD-318, TD-322                 | Isolated DAG test output.                         | Covers success, fail-closed, duplicate runs, partial failure, and route-loop regression.   |
| Maintainability | TD-312, TD-313, TD-321, TD-325                         | Contract test output and review checklist.        | Covers bundle parity, mock isolation, naming, and file scope.                              |
| Compatibility   | TD-300, TD-301, TD-302, TD-312, TD-322                 | Contract test output and `bun run check:bundled`. | Covers workflow schema, DAG shape, v1 rollback, and previous route-loop behavior.          |
| Data integrity  | TD-303, TD-304, TD-306, TD-307, TD-308, TD-311, TD-324 | Contract and DAG test output.                     | Covers JSON-only parsing, envelope, count validity, no partial output, and story identity. |
| Security        | TD-314, TD-320, W-001, W-004                           | Contract test output and waiver trace.            | Ensures no speculative credential or live network path.                                    |
| Performance     | TD-319, W-006                                          | Contract test output.                             | Timeout and local-only work are sufficient for this scope.                                 |
| Compliance      | TD-305, TD-309, TD-323, W-001, W-002, W-005            | DAG artifacts and waiver trace.                   | Makes deferred human-judgment handling auditable.                                          |

## Execution Strategy

Run all buildable functional and contract coverage in PR validation because the planned tests are package-local Bun tests.

PR validation should include:

- `bun test packages/workflows/src/defaults/v2-decision-needed-contract.test.ts`
- `bun test packages/workflows/src/defaults/v2-decision-needed-dag.test.ts`
- `bun test packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts`
- `bun test packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts`
- `bun run check:bundled`
- `bun run validate`

Nightly validation should run the normal package-isolated `bun run test` suite and report any mock-isolation or route-loop regression.

Weekly validation is not required for this story because no load, chaos, browser, or long-running live-network suite is in scope.

## Resource Estimates

| Priority | Scenario Count | Effort Range         | Notes                                                                                                   |
| -------- | -------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| P0       | 10             | About 9 to 15 hours  | Mostly precondition, seam wiring, malformed/stale input, fail-closed, and route-loop regression.        |
| P1       | 14             | About 8 to 13 hours  | Contract shape, package registration, artifact isolation, partial failure, timeout, and operator notes. |
| P2/P3    | 3              | About 2 to 4 hours   | Naming, file scope, and deferred load/scalability trace.                                                |
| Total    | 27             | About 19 to 32 hours | Higher end applies if the A4.2 DAG harness needs adaptation for the new positive target.                |

Timeline estimate: about 3 to 5 focused engineering days.

## Quality Gate Criteria

- P0 pass rate must be 100%.
- P1 pass rate must be at least 95%, and any exception requires an owner-approved waiver.
- Every score 6 or higher risk must have scenario coverage or an approved waiver.
- Every acceptance criterion must trace to atomic scenarios or an explicit waiver before coverage is marked complete.
- Every reviewer concern must trace to scenarios, explicit non-risk rationale, or an approved waiver.
- No P0 or P1 edge case may be counted as covered by implication.
- `bun run check:bundled` must pass after regeneration.
- `bun run validate` must pass before PR handoff.
- Full NFR PASS, CONCERNS, or FAIL assessment is deferred to `nfr-assess` after implementation evidence exists.

## Mitigation Plans

### R-001, R-012, And R-013: Missing Live Dependencies And Speculative Integration

**Mitigation Strategy:** Build only the deterministic no-op and fail-closed layers.

**Owner:** Workflow implementer, workflow maintainer, and security/platform owner.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-300, TD-314, W-001, W-002, and W-004.

### R-002, R-003, And R-018: PASS Seam And Baseline Integrity

**Mitigation Strategy:** Assert the exact new positive target, exact node dependencies, and unchanged route-loop negative and exhausted behavior.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-300, TD-301, TD-302, and TD-322.

### R-004 Through R-010: JSON Contract Integrity And Fail-Closed Behavior

**Mitigation Strategy:** Validate the summary envelope and count before stdout, emit the no-op contract only after validation, and emit no partial contract on every error path.

**Owner:** Workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-303 through TD-311 and TD-324.

### R-015 Through R-017: Bundle Parity And Test Isolation

**Mitigation Strategy:** Add structural and isolated DAG tests, register mock-using tests as standalone, regenerate bundled defaults, and run validation.

**Owner:** Test architect and workflow implementer.

**Timeline:** Before PR.

**Status:** Planned.

**Verification:** TD-312, TD-313, and `bun run validate`.

### R-019 Through R-021: Proof-Run, Duplicate, And Partial-Failure Safety

**Mitigation Strategy:** Make fail-closed limitations explicit, isolate artifact directories, and prove the decision node runs only after a positive route-loop decision.

**Owner:** Workflow maintainer and workflow implementer.

**Timeline:** Before PR and before A6.1 proof run.

**Status:** Planned.

**Verification:** TD-317, TD-318, TD-323, and W-005.

## Assumptions And Dependencies

### Assumptions

1. The story proceeds with the buildable-now plus fail-closed implementation layer.
2. The live Linear and BMAD-METHOD sync behavior is deferred until the missing cross-project contracts exist inside the allowed project boundary.
3. `decision_needed_count` remains an aggregate count from `quality-gate-summary`, not a per-finding list.
4. The existing A4.2 route-loop tests remain the regression template for the new DAG test.
5. Browser, load, credential, and cancellation behavior stay outside the implementation diff.

### Dependencies

1. A4.2 workflow baseline must be present before implementation.
2. Future M3.1 must define the per-finding `decision-needed.json` source contract before AC5 can be implemented.
3. Future M3.2 must define BMAD-METHOD sync request and response contracts before real sync-success or sync-error coverage can be implemented.
4. A future explicit default-off Linear capability marker must be chosen before any live network path is built.

### Risks To Plan

- **Risk:** A6.1 expects decision-needed findings before the live path exists.
  **Impact:** The workflow correctly fails closed and cannot reach PR.
  **Contingency:** Use a no-decision-needed proof fixture or delay that proof leg until W-001 and W-002 are reopened and closed.

## Follow-On Workflows

- Run `bmad-testarch-atdd` if failing test scaffolds are needed for TD-300 through TD-326.
- Run `bmad-testarch-automate` after implementation if broader route-loop regression automation is required.
- Run `nfr-assess` only after implementation evidence exists.

## Validation Checklist Result

- Epic-level prerequisites loaded: pass.
- Risk scoring complete for acceptance criteria, high risks, and reviewer concerns: pass.
- NFR planning included for in-scope reliability, maintainability, compatibility, data integrity, security, performance, scalability, and compliance: pass.
- Every acceptance criterion maps to scenarios or waivers: pass.
- Every high-risk item maps to scenarios or waivers: pass.
- Every reviewer concern maps to scenarios, non-risk rationale, or waivers: pass.
- Edge categories are explicitly covered or waived: pass.
- Output uses the project test levels and existing workflow test patterns: pass.
