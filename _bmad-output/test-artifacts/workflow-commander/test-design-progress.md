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
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/cli.ts'
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
outputDocument: '_bmad-output/test-artifacts/workflow-commander/test-design/test-design-3-3d-provide-archon-recovery-command-cli-json.md'
---

# Test Design Progress: 3.3d Provide Archon Recovery Command CLI JSON

## Step 1: Detect Mode

Mode selected: Epic-Level.

Reason: the supplied implementation artifact is a focused story handoff with explicit acceptance criteria, implementation slices, contract references, and reviewer/retro concerns for one CLI JSON recovery-command story.

Prerequisite result: PASS - `_bmad-output/implementation-artifacts/3-3d-provide-archon-recovery-command-cli-json.md` exists and provides acceptance criteria plus detailed risk evidence.

## Step 2: Load Context

Configuration loaded: Playwright utils enabled; Pact.js utils disabled; Pact MCP disabled; browser automation `auto`; test stack `auto`; risk threshold `p1`; test artifacts rooted at `_bmad-output/test-artifacts`.

Detected project stack: fullstack Bun + strict TypeScript monorepo, with this story's executable surface concentrated in headless CLI JSON, command dispatch, detached subprocess behavior, workflow operation formatting, SQLite-backed E2E fixtures, and in-repo JSON schema contracts.

Loaded project evidence: story 3.3d, approved technical decisions, partial retro, project context, PRD/architecture/epics context, route-loop runtime contract, workflow command envelope schema and recovery fixtures, `workflow.ts`, `cli.ts`, shared envelope builder, existing CLI test files, package-isolated test script, and TEA risk/priority/level/NFR knowledge fragments.

Existing test patterns: `workflow.test.ts` for command unit behavior and mocks, `workflow-json.e2e.test.ts` for real subprocess JSON purity and argv guard behavior, `workflow-command-contract.test.ts` for emitted-envelope contract checks, and `workflow-provider-command-envelope.test.ts` for shared builder/schema regression.

## Step 3: Risk and Testability

Risk assessment completed with 20 risks.
High-risk concerns focus on recovery dispatcher gaps, legacy resume JSON shape, validate-only resume side effects, detached retry boundaries, exact worker argv, cancel CAS integrity, fail-closed JSON error paths, stdout/stderr contamination, classifier specificity, route-loop preservation, forbidden output fields, timeout handling, and test isolation.

Every known reviewer concern was dispositioned as a risk or explicit non-risk with probability, impact, score, and scenario/waiver mapping.

## Step 4: Coverage Plan

Coverage plan completed with 84 atomic scenarios: 49 P0, 28 P1, and 7 P2/P3.

The matrix includes happy path, negative path, boundary cases, malformed input, stale data, duplicate actions, out-of-order events, partial failure, dependency failure, timeout, cancellation, concurrency/race, rollback, permission/auth waiver, and regression cases.

## Step 5: Generate Output

Output written to `_bmad-output/test-artifacts/workflow-commander/test-design/test-design-3-3d-provide-archon-recovery-command-cli-json.md`.

Checklist validation summary: PASS with waivers W-001 through W-006 recorded for Hermes-owned consumer classification, local CLI permission/auth and cwd boundary, missing performance thresholds, Postgres-specific CAS duplication, full targeted retry race breadth, and absence of implementation review findings.
