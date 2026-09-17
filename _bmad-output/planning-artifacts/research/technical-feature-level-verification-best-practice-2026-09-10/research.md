---
title: 'Technical research: Feature-level verification best practices'
type: 'technical'
topic: 'Feature-level verification best practices for real user journeys and fail-closed quality gates'
decision: 'How should Archon design feature-level verification and its pre-merge gate so tests prove real behavior rather than shallow rendering or smoke paths?'
source: 'native web research'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-09-10'
updated: '2026-09-10'
verified_claims: 11
unverified_claims: 0
---

# Technical research: Feature-level verification best practices

**Decision this research serves:** How should Archon design feature-level verification and its pre-merge gate so tests prove real behavior rather than shallow rendering or smoke paths?

## Executive summary

Archon should adopt a risk-based, behavior-traceable verification model rather than equating a coarse feature ID, rendered surface, test count, or code-coverage percentage with feature correctness. Industry guidance converges on a layered portfolio: focused unit and integration tests cover rules, boundaries, persistence, authorization, and state combinations; a small number of complete Critical User Journeys prove that the shipped interface, backend, persistence, and final user-visible outcome compose correctly [1][3][4].

The recommended gate has three load-bearing properties. First, Archon should adapt requirement-traceability guidance [8][9][13] by linking every changed observable behavior bidirectionally to its required executable scenario IDs. This makes missing scenario coverage visible. Second, selection fails closed: unknown change impact, a missing mapping, an empty selection, a stale result, or a flaky result from a required scenario prevents the gate from reporting an acceptable merge status [14][15][21]. Third, browser mutation tests drive real user actions through real first-party APIs and persistence, then verify an authoritative server postcondition and the committed UI state; only uncontrolled third parties are mocked [16][17][18].

For Archon, `select-verify-archon-targets` should identify affected behaviors, select required scenarios, and report coverage gaps. `verify-archon` should run the same durable Playwright, API, and CLI scenarios as CI instead of maintaining weaker duplicate drivers. Human-in-the-loop (HITL) verification should be the first reference implementation, but the contract applies to every future feature. Confidence is high for the testing principles and medium-high for this Archon-specific architecture, which is a synthesis rather than a standard prescribed by any single source.

## Findings

### 1. “Enough testing” is risk-based, not established by a universal count or blanket percentage

Google, Microsoft, and ISTQB converge on the same principle: test depth should follow product risk, user value, complexity, and the consequences of failure rather than a universal test count or percentage [1][4][5]. Code coverage remains useful as gap telemetry, but Microsoft and FDA explicitly distinguish executing code from proving correct or complete behavior [10][12].

The practical unit of sufficiency is therefore a material product risk linked to observable evidence. A feature is adequately covered when every identified material risk has a passing proof at a layer capable of observing it, and any residual risk is explicit. A rendered component or executed line cannot satisfy a persistence, authorization, state-transition, or cross-surface risk.

### 2. Use a small number of complete critical-user journeys above focused lower-layer tests

Google calls the highest-value workflows Critical User Journeys and recommends end-to-end coverage for them, while retaining many smaller tests for rules and integrations [1]. Microsoft similarly defines end-to-end tests as validating correctness from user action through backend services, but recommends them selectively for business-critical workflows because they are costly and fragile [4]. Google’s test-pyramid guidance and later SMURF model agree that broad-stack fidelity has to be balanced against speed, maintainability, utilization, and reliability [2][3].

This resolves the apparent tension between “test the real feature” and “avoid too many E2E tests”:

- Unit/component tests should cover deterministic rules, input partitions, boundaries, and pure state transitions.
- Integration/API tests should cover persistence, transactions, authorization, serialization, service boundaries, failure mapping, and most data/role/state combinations.
- Browser/CLI end-to-end tests should prove a small set of critical workflows whose main risk is failure to compose across the shipped interface, backend, persistence, and final user-visible result.

The goal is not more browser tests. It is fewer but load-bearing browser tests, with each one proving an entire critical journey.

### 3. Define behavioral partitions before selecting scenarios

ISTQB’s equivalence partitions, boundary-value analysis, decision tables, and state-transition coverage provide a disciplined way to avoid an exhaustive Cartesian product [5]. Distinct actor classes also matter where identity changes the result: OWASP separately tests unauthenticated access, cross-role access, and cross-identity access between users with the same role [7].

For a stateful feature, transition coverage is more informative than a snapshot of visible state. Applying the cited test-design techniques to Archon, relevant partitions may include:

- entry point or origin;
- actor, role, ownership, and authentication state;
- initial state and valid or invalid transition;
- action branch;
- durable side effect;
- failure and recovery branch;
- separate shipped UI or protocol implementation;
- concurrency or idempotency condition.

After infeasible combinations are removed, one scenario may cover several partitions. NIST supports pairwise or higher-order covering arrays as an economical sampling technique, but warns that pairwise is not universal assurance and can miss faults caused by higher-order interactions [6]. Explicit high-risk cases must never be sampled away.

### 4. Trace changed behavior to exact executable scenarios

NASA requires bidirectional traceability between software requirements and their verification evidence; its implementation guidance emphasizes that the reverse link exposes both requirements with no tests and tests with no requirement [8][9]. Azure DevOps implements the same pattern operationally by linking automated test results to requirement work items and surfacing uncovered requirements [13].

Cucumber’s executable-specification model supplies the useful scenario shape: known context, action, and observable outcome. Scenarios describe intended behavior rather than implementation structure [11]. In this report, **behavior** is the canonical term for an observable requirement or rule. A **scenario** is an executable case linked to that behavior, and its execution result is the evidence consumed by the gate. Applying the cited requirement-traceability pattern to behavior-level IDs is an Archon-specific architectural synthesis. The important mechanism is not Gherkin syntax but stable identifiers and machine-computable links:

```text
behavior → required scenarios → execution results
scenario → behavior
```

A changed file is evidence of possible impact, not the verification obligation itself. The obligation comes from the changed behavior, its risk, and the user-visible or externally observable contract.

### 5. A fail-closed gate must distinguish “not required” from “no evidence”

GitHub protected branches can require status checks before merge [14], but GitHub treats successful, skipped, and neutral check conclusions as acceptable in required-check evaluation; conditionally skipped jobs can therefore produce unintuitive fail-open behavior [15]. A trustworthy gate should always run one required aggregate check. That check should fail for:

- undeclared behavioral impact;
- unknown or ambiguous behavior or scenario IDs;
- a changed behavior with no mapped runnable scenario;
- zero selected scenarios without an independently validated no-behavior-change declaration;
- missing, stale, wrong-commit, skipped, neutral, flaky, or failed required evidence.

Test-impact analysis is an optimization, not an assurance model. Microsoft’s Test Impact Analysis falls back to the full test set when it cannot understand a change [22]. The safe analogue is: uncertainty broadens verification; it never reduces it to an empty pass.

### 6. Browser E2E must drive user behavior and keep the claimed first-party path real

Playwright recommends user-visible locators such as roles and labels, real browser actions, automatic actionability checks, and web-first assertions [16]. Playwright directly demonstrates a UI mutation followed by an API postcondition check [17]. Building on that example, this report recommends the stronger proof chain:

```text
real user action
→ real first-party request
→ real backend and persistence
→ authoritative read-back
→ final user-visible state
```

Playwright documents that fulfilling a mocked route prevents the API request from being made [18], and recommends mocking third-party servers the test does not control [16]. From those facts, this report infers that mocking the application’s own mutation endpoint narrows the proof to a frontend/client contract and cannot satisfy the end-to-end mutation obligation defined here; it therefore recommends keeping claim-relevant first-party layers real and mocking uncontrolled third parties at their production boundary.

API setup is valid for unrelated preconditions, and Playwright documents it directly [17]. The boundary is simple: setup may be seeded when it is not the behavior under test; the changed write/transition path must execute for real.

### 7. Reliability controls must not weaken correctness

Playwright documents BrowserContext isolation for browser-held state such as cookies, local storage, and session storage [19]. By implication, BrowserContext isolation alone does not establish isolation of application databases, queues, or server-side shared accounts. A serious E2E harness needs isolated first-party state or unique per-test data in addition to browser isolation.

Synchronize on observable events rather than sleeps. When a response is material evidence, arm `waitForResponse` before the click, then assert the response and the final state [20]. Web-first assertions should observe the committed UI condition rather than read a transient boolean once [16].

Traces, screenshots, and videos are diagnostics, not correctness evidence. Under this report’s gate policy, a retry-only pass remains gate-failing. Playwright’s `failOnFlakyTests` causes an error exit when any test is marked flaky and is useful on CI [21].

## Cross-dimension insights

Risk determines the evidence obligation; bidirectional traceability makes that obligation computable. A complete user journey proves cross-layer composition, while focused lower-layer tests cover most branches. Selection must fail or broaden when impact is unknown. Evidence remains claim-specific: screenshots prove appearance, responses prove a boundary result, read-backs prove durability, and final UI assertions prove the committed result reaches the user.

## Contrary evidence and limits

No universal threshold defines “enough.” Keep browser journeys selective because E2E-heavy suites are slow and brittle [3][4]. Pairwise sampling cannot replace explicit high-risk cases [6]. Required checks enforce reported status, not proof quality [14][15], and executable-scenario syntax alone does not prove a real end-to-end path.

## Recommendations for Archon

### A. Introduce a machine-readable feature verification contract

Each feature should define:

- stable behavior IDs;
- critical user goals;
- risk tier;
- relevant partitions and explicit must-test cases;
- required evidence layer for each behavior;
- stable executable scenario IDs;
- bidirectional `behavior ↔ scenario` links.

The contract should remain small. It coordinates verification; it should not duplicate test implementation.

### B. Make target selection scenario-aware and fail closed

The selection step should return:

```json
{
  "affected_behaviors": ["feature.behavior"],
  "required_scenarios": ["feature/journey"],
  "coverage_gaps": [],
  "selection_confidence": "high"
}
```

The step must fail when a changed behavior has no runnable scenario, when the mapping is ambiguous, or when selection is empty without a reviewed no-behavior-change reason. Low confidence should expand to the broader feature suite.

### C. Use one durable executable truth

Manual verification and CI should run the same durable Playwright/API/CLI scenarios. A second, simpler browser driver will drift toward proving layout or availability while the durable suite proves different behavior. `verify-archon` should orchestrate isolated setup, execute scenario-tagged durable tests, collect evidence, and clean up; it should not maintain a weaker duplicate test.

### D. Define a minimum proof chain by change type

| Change risk               | Required proof                                                          |
| ------------------------- | ----------------------------------------------------------------------- |
| Pure presentation         | Real render + user-visible assertion; screenshot as supporting evidence |
| Interactive UI            | Real browser action + committed visible outcome                         |
| First-party mutation      | Browser/CLI action + real backend/persistence + authoritative read-back |
| Stateful workflow         | Required state and transition coverage                                  |
| Authorization/ownership   | Actor/role/ownership partitions, including negative cases               |
| Concurrency/idempotency   | Explicit race, duplicate, and first-write/last-pending invariants       |
| Separate shipped surfaces | At least one critical journey per independent implementation            |

### E. Keep browser coverage small but complete

For each critical feature:

1. Run at least one complete happy-path journey through the shipped interface.
2. Add browser variants only when the browser, routing, identity, or separate surface changes the outcome.
3. Put most validation, data, authorization, state, and error partitions in integration/API tests.
4. Use equivalence partitions and decision/state tables first; use pairwise for remaining nominal factor combinations; preserve explicit high-risk cases.

### F. Publish one always-running required aggregate check

The aggregate should be bound to the pull-request commit and report:

- selected behavior and scenario IDs;
- execution surface and isolated environment identity;
- per-scenario pass/fail/flaky status;
- missing or stale evidence;
- UI, request, persistence, and final-state obligations where applicable.

It should fail on flaky required tests even when diagnostic retries pass, and it should run on pull requests and merge-queue events.

### G. Apply HITL as the first reference implementation

Use HITL to validate the framework, not to special-case it. Its critical proof should create a real pending interaction through a real workflow, pause, render the actionable Ask, accept a real browser answer/decline, persist the result, resume correctly, and display the final state. Ownership, unowned solo runs, different operators, multiple pending interactions, duplicate answers, failure-after-answer, and independent Console/Legacy surfaces are behavioral partitions to allocate across browser and integration layers.

## Open questions

1. What local risk tiers should Archon use, and which evidence layers should each tier require?
2. Which artifact format should carry links among behaviors, scenarios, and execution results without duplicating Playwright metadata?
3. How should a no-behavior-change declaration be authorized and audited?
4. Which changes should force a full feature suite rather than selected scenarios?

## Source appendix

| Ref  | Finding supported                                                         | Publisher                                                                                                                                                                                      | Publication/update date                     | Accessed   | Confidence  |
| ---- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------- | ----------- |
| [1]  | Risk-based sufficiency and Critical User Journeys                         | [Google Testing Blog](https://testing.googleblog.com/2021/06/how-much-testing-is-enough.html)                                                                                                  | 2021-06-15                                  | 2026-09-10 | High        |
| [2]  | SMURF: balance speed, maintainability, utilization, reliability, fidelity | [Google Testing Blog](https://testing.googleblog.com/2024/10/smurf-beyond-test-pyramid.html)                                                                                                   | 2024-10-15                                  | 2026-09-10 | High        |
| [3]  | E2E-heavy suite costs and pyramid as a starting heuristic                 | [Google Testing Blog](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)                                                                                        | 2015-04-22                                  | 2026-09-10 | High        |
| [4]  | Risk/value scaling, layer responsibilities, selective E2E                 | [Microsoft Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/testing)                                                          | 2026-08-04 update                           | 2026-09-10 | High        |
| [5]  | Risk testing, equivalence, decision tables, state transitions             | [ISTQB CTFL v4.0.1](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)                                                                                               | 2024-09-15                                  | 2026-09-10 | High        |
| [6]  | Pairwise/t-way effectiveness and limits                                   | [NIST SP 800-142](https://csrc.nist.gov/pubs/sp/800/142/final)                                                                                                                                 | 2010-10-07                                  | 2026-09-10 | High        |
| [7]  | Authentication, role, and cross-identity authorization partitions         | [OWASP WSTG v4.2](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/05-Authorization_Testing/02-Testing_for_Bypassing_Authorization_Schema.html) | 2020-12-03 release                          | 2026-09-10 | High        |
| [8]  | Bidirectional requirement-to-verification traceability                    | [NASA NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_7150_002D_&page_name=Chapter3)                                                                                 | Effective 2022-03-08                        | 2026-09-10 | High        |
| [9]  | Trace matrices expose missing and orphan tests                            | [NASA Software Engineering Handbook](https://swehb.nasa.gov/spaces/7150/pages/16449898/SWE-072+-+Bidirectional+Traceability+Between+Software+Test+Procedures+and+Software+Requirements)        | 2017-10-16 update                           | 2026-09-10 | High        |
| [10] | Structural/code coverage does not prove functional correctness            | [U.S. FDA](https://www.fda.gov/media/73141/download)                                                                                                                                           | 2002-01-11; partial supersession 2025-09-24 | 2026-09-10 | High        |
| [11] | Concrete executable scenarios and observable outcomes                     | [Cucumber Gherkin Reference](https://cucumber.io/docs/gherkin/reference/)                                                                                                                      | Undated living documentation                | 2026-09-10 | High        |
| [12] | Code coverage cannot determine test quality                               | [Microsoft .NET documentation](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices)                                                                              | 2026-04-09 update                           | 2026-09-10 | High        |
| [13] | Requirement-linked automated test results and uncovered requirements      | [Microsoft Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/requirements-traceability?view=azure-devops)                                                            | 2026-05-07 update                           | 2026-09-10 | High        |
| [14] | Required branch status checks                                             | [GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)                                 | Undated living documentation                | 2026-09-10 | High        |
| [15] | Skipped/neutral and dependent-job status-check behavior                   | [GitHub Docs](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)                                                           | Undated living documentation                | 2026-09-10 | High        |
| [16] | User-visible locators, web-first assertions, third-party boundary         | [Playwright Best Practices](https://playwright.dev/docs/best-practices)                                                                                                                        | v1.63.0 snapshot, 2026-09-04                | 2026-09-10 | High        |
| [17] | API setup and server-side postcondition validation                        | [Playwright API Testing](https://playwright.dev/docs/api-testing)                                                                                                                              | v1.63.0 snapshot, 2026-09-04                | 2026-09-10 | High        |
| [18] | Mocked routes prevent real API requests                                   | [Playwright Mock APIs](https://playwright.dev/docs/mock)                                                                                                                                       | v1.63.0 snapshot, 2026-09-04                | 2026-09-10 | High        |
| [19] | BrowserContext isolation scope                                            | [Playwright Test Isolation](https://playwright.dev/docs/browser-contexts)                                                                                                                      | v1.63.0 snapshot, 2026-09-04                | 2026-09-10 | High        |
| [20] | Arm response waits before the browser action                              | [Playwright Network](https://playwright.dev/docs/network)                                                                                                                                      | v1.63.0 snapshot, 2026-09-04                | 2026-09-10 | High        |
| [21] | Fail CI when retries classify a test as flaky                             | [Playwright `failOnFlakyTests`](https://playwright.dev/docs/api/class-testconfig#test-config-fail-on-flaky-tests)                                                                              | v1.63.0 snapshot, 2026-09-04                | 2026-09-10 | High        |
| [22] | Test-impact selection falls back to all tests when impact is unknown      | [Microsoft Azure Pipelines](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis?view=azure-devops)                                                              | Living documentation                        | 2026-09-10 | Medium-High |

## Staleness map

The technical-pack freshness policy uses 24 months for testing patterns and one month for version-sensitive platform/tool behavior.

| Claim class                                            | Re-check status                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Current Microsoft risk/layering guidance               | Re-check by 2028-08-01                                                                                            |
| Requirement traceability and code-coverage limitations | Re-check by 2028-04 to 2028-05                                                                                    |
| GitHub required-check semantics                        | Re-check by 2026-10-01                                                                                            |
| Playwright v1.63.0 behavior and APIs                   | Re-check by 2026-10-01                                                                                            |
| ISTQB equivalence/transition material                  | Publication-age window reached 2026-09-01; re-read against the current syllabus on 2026-09-10                     |
| NIST pairwise quantitative findings                    | Publication-age window elapsed; retain as historical evidence with the source’s explicit non-universality warning |

The computed map flags two old pattern sources. Neither supplies the core recommendation alone: current Google/Microsoft guidance independently supports risk-based layering, while pairwise remains an optional reduction technique rather than a gate guarantee. The earliest current-source re-check is 2026-10-01 for GitHub and Playwright semantics.
