---
project: Archon
workflow_target: hermes-workflow
date: 2026-07-12
status: approved-and-applied
mode: batch
trigger_source: implementation-readiness-report-2026-07-12.md
scope_classification: moderate
approved_on: 2026-07-12
approved_via: lavish-review-surface
---

# Sprint Change Proposal: Implementation Readiness Remediation

## 1. Issue Summary

The 2026-07-12 implementation-readiness assessment classified the Archon Workflow Commander handoff as `NEEDS WORK`.
The assessment found no critical issue, complete functional-requirement coverage, valid contracts, aligned headless UX boundaries, and a valid dependency order.
It also found five major planning defects and three minor quality gaps that should be corrected before Phase 4 implementation begins.

The triggering problems are:

1. The Archon Epic 3 slice lacks an explicit epic goal, value proposition, and completion signal.
2. Stories 3.1 and 3.5 contain multiple independently verifiable implementation and rollback units.
3. Stories 3.5 and 3.7 overlap on delivery-status persistence ownership.
4. Story 3.3d does not specify command-specific recovery behavior.
5. Story 3.7 does not specify invalid status-query behavior.
6. Story 3.3a does not explicitly trace the contract-required `error.retryable` field.
7. Most stories use an internal implementation persona rather than the operator or integrator receiving value.
8. `sprint-status.yaml` still marks the shared contract fixtures as missing even though the canonical validator passes.

Evidence:

- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/implementation-readiness-report-2026-07-12.md` records 0 critical, 5 major, and 3 minor findings.
- All 4 PRD functional requirements map to the existing seven stories.
- `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` passes all checked-in schemas, examples, and rejection fixtures.
- The validated workflow command envelope requires a boolean `error.retryable` field.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` still records `workflow-commander-shared-contract-fixtures` with status `missing`.

## 2. Impact Analysis

### Epic Impact

Epic 3 remains viable and does not require replacement, removal, or resequencing.
It needs an explicit Archon-owned goal and completion signal so epic value and independence can be assessed directly.
No new epic is required.

Story identifiers must remain stable because the local Archon handoff intentionally mirrors parent workspace story IDs.
Stories 3.1 and 3.5 should therefore remain umbrella stories while their existing checkpoints are promoted into independently accepted implementation tasks with separate test gates and rollback boundaries.

### Story Impact

- Story 3.1 needs independently gated binding storage, lifecycle, diagnostics, and contract-validation tasks.
- Story 3.3a needs explicit `error.retryable` traceability.
- Story 3.3d needs separate acceptance criteria for resume, whole-run retry, node-targeted retry, cancel, and invalid state transitions.
- Story 3.5 needs independently gated event construction, durable enqueue, routing, delivery-state writing, retry, and idempotency tasks.
- Story 3.7 must become the read-side delivery-health projection and CLI surface, with Story 3.5 as the sole write-side persistence owner.
- Stories using “implementation coordinator” should use the actual controller-integrator, workflow-operator, or workflow-integration-administrator persona.

### Artifact Conflicts

#### PRD

No PRD change is required.
FR-7 through FR-10 and NFR-1, NFR-5, NFR-6, NFR-9, NFR-14, NFR-15, NFR-16, and NFR-17 remain valid and fully covered.

#### Architecture

The command-envelope convention needs to name `retryable` explicitly.
The architecture needs an explicit delivery-state ownership decision separating Story 3.5 write-side persistence from Story 3.7 read-side projection and CLI reporting.

#### UX

No UX change is required.
The UX already requires retryability and remains aligned with the validated contract and headless product boundary.

#### Epics and Stories

`epics.md` is the primary change target.
The changes clarify epic value, implementation task gates, ownership, personas, and acceptance criteria without adding product scope.

#### Sprint Status

The contract-fixture blocker is stale and conflicts with current validation evidence.
It must be removed or converted to resolved evidence after the proposal is approved.

### Technical Impact

This Correct Course action changes planning and sprint-tracking artifacts only.
It does not change application source code, migrations, schemas, runtime configuration, infrastructure, deployment, or CI.
The implementation plan becomes easier to test, sequence, review, and roll back.

## 3. Recommended Approach

### Selected Path: Direct Adjustment

Modify the existing epic, stories, architecture conventions, and sprint status without changing PRD scope, UX scope, contracts, story IDs, or story order.

This approach is recommended because:

- The product and architecture direction remain valid.
- All functional requirements already have implementation coverage.
- The local contract package already passes validation.
- No completed implementation work needs rollback.
- Stable parent-linked story identifiers are preserved.
- Independent task gates address the large-story risk without creating cross-project reference drift.
- Explicit write/read ownership prevents duplicate migrations and conflicting data mutation.

Effort estimate: Medium planning effort.

Risk level: Low to medium.

Timeline impact: No product-scope expansion is introduced, but implementation estimates should be re-baselined against the newly explicit task gates.

MVP impact: None.
Workflow Commander v1 remains the same headless Archon provider slice covering FR-7 through FR-10.

### Alternatives Considered

#### Potential Rollback

Not viable or useful.
No implementation work has been identified that must be reverted to make the correction.

#### PRD or MVP Review

Not required.
The readiness findings concern planning structure, ownership, and acceptance detail rather than product viability or scope.

#### Renumbering Stories Into New Top-Level Stories

Not recommended for this local correction.
The current IDs intentionally match the parent workspace, so unilateral renumbering would create cross-project reference drift.

## 4. Detailed Change Proposals

### 4.1 Epics: Add an Explicit Archon Epic Definition

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

**Location:** After `## Overview` and before story-level boundaries.

**OLD:**

```text
No explicit Archon epic definition is present.
```

**NEW:**

```markdown
## Epic 3: Workflow Provider Control and Event Delivery

**Epic Goal:** External controllers can bind projects or codebases to Archon, control workflow runs through validated CLI JSON, receive signed workflow events without blocking execution, and inspect delivery health.

**User Value:** Workflow operators and controller integrators can automate Archon safely without depending on Archon Web, human-readable CLI parsing, Hermes-specific provider fields, or direct mutation of consumer-owned state.

**Completion Signal:** Stories 3.1, 3.3a, 3.3b, 3.3c, 3.3d, 3.5, and 3.7 satisfy their contract gates; the canonical local validator passes; event delivery failure never blocks workflow execution; and all CLI success and failure results remain machine-consumable.

**Independence:** This Archon producer slice depends only on the validated local contract package and explicitly named parent contract prerequisites.
It does not depend on Hermes event ingress, reconciliation, Project Work Items, Phase Tasks, gates, diagnostics, user interaction, or Archon Web UI.
```

**Rationale:** Makes epic value, independence, scope, and completion directly testable.

### 4.2 Epics: Formalize Independently Accepted Tasks for Umbrella Stories

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

**Location:** `## Story-Level Implementation Boundaries`.

**OLD:**

```text
Story 3.1 and Story 3.5 require an implementation checkpoint list before code changes begin.
```

**NEW:**

```markdown
Story 3.1 and Story 3.5 remain stable umbrella story IDs because cross-project references depend on them.
Their named implementation checkpoints are independently accepted implementation tasks, not an invitation to deliver the entire subsystem as one undifferentiated patch.
Each task must define its own code scope, focused tests, completion evidence, and rollback boundary before implementation begins.
A later task may depend on an accepted earlier task, but failure in a later task must not invalidate or require reverting an already accepted earlier task unless a documented contract incompatibility requires it.
```

**Rationale:** Addresses story-size risk while preserving parent-linked identifiers.

### 4.3 Story 3.1: Replace Broad Checkpoints With Independent Task Gates

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

**Location:** Story 3.1 persona and implementation checkpoints.

**OLD PERSONA:**

```text
As an implementation coordinator,
```

**NEW PERSONA:**

```text
As a workflow integration administrator,
```

**OLD CHECKPOINT MODEL:**

```text
Four checkpoints combine storage, all lifecycle commands, diagnostics, and contract validation.
```

**NEW TASK GATES:**

```markdown
Implementation task gates are:

1. Binding storage and create/status task: add the persisted binding shape, migration location, SQLite and PostgreSQL adapter behavior, create behavior, status behavior, and focused backend tests.
2. Binding update task: add explicit update behavior, prove create never silently upserts, and cover stale or conflicting transitions.
3. Binding rotate/disable task: add rotation and disable behavior without exposing secrets or deleting audit history.
4. Binding diagnostics and contract task: prove malformed-input failures, all required binding states, command envelopes, and checked-in binding examples.

Each task is accepted separately and must have its own focused validation evidence and rollback boundary.
```

**Rationale:** Separates storage and lifecycle failure domains without changing FR-7 or Story 3.1 identity.

### 4.4 Story 3.3a: Trace Retryability Explicitly

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

**Location:** Story 3.3a failure-result acceptance criterion.

**OLD:**

```text
Then the result includes schema version, success flag, correlation id if available, machine-readable error code, diagnostic category, and machine-readable details.
```

**NEW:**

```text
Then the result includes schema version, success flag, correlation id if available, machine-readable error code, diagnostic category, boolean retryability, and machine-readable details.
```

**Rationale:** Matches the validated command-envelope schema and UX requirement.

### 4.5 Stories 3.3a–3.3d and 3.7: Use Outcome Personas

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

| Story | Old Persona                | New Persona           |
| ----- | -------------------------- | --------------------- |
| 3.3a  | implementation coordinator | controller integrator |
| 3.3b  | implementation coordinator | controller integrator |
| 3.3c  | implementation coordinator | workflow operator     |
| 3.3d  | implementation coordinator | workflow operator     |
| 3.7   | implementation coordinator | controller integrator |

**Rationale:** Keeps story framing centered on the person receiving the operational outcome.

### 4.6 Story 3.3d: Add Command-Specific Recovery Criteria

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

**Location:** Story 3.3d Acceptance Criteria.

**OLD:**

```text
One generic success criterion and one generic failure criterion cover resume, retry, and cancel together.
```

**NEW:**

```markdown
**Given** a workflow run is in a resumable state
**When** Archon executes `workflow.resume`
**Then** it returns the shared success envelope with the resumed workflow run reference and resulting run state
**And** a non-resumable state returns an unexpected-state failure envelope without mutating the run.

**Given** a workflow run can be retried from its failed work
**When** Archon executes `workflow.retry` without `--node`
**Then** it returns the shared success envelope for whole-run recovery
**And** completed work is preserved or skipped according to the existing workflow retry contract.

**Given** a failed workflow node is eligible for targeted retry
**When** Archon executes `workflow.retry --node <node-id>`
**Then** it returns the shared success envelope identifying the requested node and workflow run
**And** an unknown or ineligible node returns a machine-readable failure without starting recovery.

**Given** a workflow run is active and cancellable
**When** Archon executes `workflow.cancel`
**Then** it returns the shared success envelope with the resulting run state
**And** it does not report or serialize the operation as legacy `abandon`.

**Given** any recovery command receives malformed input, times out, exits unexpectedly, produces schema-invalid JSON, or targets an invalid run state
**When** Archon returns the failure
**Then** the response uses the shared failure envelope with code, category, retryability, and structured details
**And** no unsupported state transition is applied.
```

**Rationale:** Makes each command and its invalid-state behavior independently testable.

### 4.7 Story 3.5: Define Independent Event-Outbox Task Gates

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

**Location:** Story 3.5 implementation checkpoints.

**OLD:**

```text
Five checkpoints are listed, but the story does not state that they are independently accepted tasks with separate rollback boundaries.
```

**NEW:**

```markdown
Implementation task gates are:

1. Event-envelope task: construct, sign, and validate event payloads against local examples and rejection fixtures without adding delivery behavior.
2. Durable enqueue task: add outbox storage, migrations, SQLite and PostgreSQL behavior, and enqueue-before-delivery tests.
3. Binding-aware routing task: resolve the provider binding and record not-routable state for missing, stale, disabled, or conflicting bindings without blocking workflow execution.
4. Delivery-state writer task: own all delivery-attempt writes, retry state, last-attempt time, last-error category, terminal failure state, and affected references.
5. Retry and idempotency task: implement retry policy and prove stable event ID and idempotency-key behavior across duplicate-safe redelivery.

Each task is accepted separately and must have focused tests, completion evidence, and a rollback boundary.
Story 3.5 is the sole owner of delivery-state writes and related migrations.
```

**Rationale:** Separates failure domains and establishes a single write-side owner.

### 4.8 Story 3.7: Restrict Scope to Read-Side Health and Add Failure Criteria

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`

**Location:** Story 3.7 persona, Implementation Scope, Blocking behavior, and Acceptance Criteria.

**OLD SCOPE:**

```text
Provider `archon` workflow event delivery status persistence, retry status, terminal failure diagnostics, and CLI status output.
```

**NEW SCOPE:**

```text
Provider `archon` read-side delivery-health projection, retry and terminal-failure diagnostics, and CLI status output over delivery state written by Story 3.5.
Story 3.7 does not own delivery-attempt mutations or delivery-state migrations.
```

**OLD BLOCKING BEHAVIOR:**

```text
This story must not move to implementation-ready or be completed unless delivery status is persisted independently of workflow execution success and conforms to the validated delivery status examples.
```

**NEW BLOCKING BEHAVIOR:**

```text
This story must not move to implementation-ready or be completed until Story 3.5 provides validated delivery-state writes and Story 3.7 can project that state into every checked-in delivery-status example without mutating delivery attempts.
```

**NEW FAILURE CRITERION:**

```markdown
**Given** a delivery-health query is malformed, references an unknown workflow run or workflow event, or cannot produce schema-valid status JSON
**When** Archon returns the query result
**Then** it returns a machine-readable failure envelope with code, category, retryability, and structured details
**And** it does not mutate workflow execution or delivery-attempt state.
```

**Rationale:** Removes persistence overlap and covers invalid status queries.

### 4.9 Architecture: Make Retryability Part of the Command Convention

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`

**Location:** Consistency Conventions, `Command envelope` row.

**OLD:**

```text
Command results include schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, result payload, and error shape.
```

**NEW:**

```text
Command results include schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, result payload, and an error shape with stable code, diagnostic category, boolean retryability, and structured details.
```

**Rationale:** Aligns architecture, UX, stories, and the validated schema.

### 4.10 Architecture: Add Delivery-State Ownership Decision

**Artifact:** `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`

**Location:** After AD-10.

**NEW:**

```markdown
### AD-11 - Separate Delivery-State Writes From Health Projection

Story 3.5 owns the workflow event outbox, delivery-attempt mutations, retry-state mutations, terminal-failure recording, and all related migrations.
Story 3.7 reads that persisted state and projects it into validated delivery-health CLI JSON.
Story 3.7 must not create a second delivery-status write path or mutate delivery attempts while serving health queries.
This separation preserves one source of truth, prevents duplicate migration ownership, and keeps workflow execution independent from notification delivery.
```

**Rationale:** Makes write/read ownership explicit and prevents competing persistence implementations.

### 4.11 Sprint Status: Clear the Stale Contract Blocker

**Artifact:** `_bmad-output/implementation-artifacts/sprint-status.yaml`

**OLD:**

```yaml
blocked_dependencies:
  workflow-commander-shared-contract-fixtures:
    status: missing
    # All seven stories are listed as blocked.
```

**NEW:**

```yaml
resolved_dependencies:
  workflow-commander-shared-contract-fixtures:
    status: satisfied
    resolved_on: '2026-07-12'
    validation_command: 'python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py'
    validation_result: passed
    note: 'The local package validates without parent workspace traversal; story-specific contract gates still apply.'
```

The seven story statuses remain `backlog`.

**Rationale:** Removes a false global blocker while retaining auditable readiness evidence and story-specific gates.

### 4.12 Unchanged Artifacts

- `prd.md`: no change.
- `ux.md`: no change.
- Contract schemas and examples: no change.
- Application source code and migrations: no change in this workflow.
- Story IDs and story order: no change.

## 5. Checklist Results

| Checklist Item                 | Status     | Notes                                                                                        |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| 1.1 Triggering story           | N/A        | Triggered by implementation-readiness review, not implementation failure.                    |
| 1.2 Core problem               | Done       | Incomplete planning decomposition, ownership, and acceptance detail.                         |
| 1.3 Supporting evidence        | Done       | Readiness report, story text, contract validator, and stale sprint blocker provide evidence. |
| 2.1 Current epic impact        | Done       | Existing Epic 3 remains viable and now has an explicit definition.                           |
| 2.2 Epic-level changes         | Done       | Goal, value, completion, and independence were added without creating a new epic.            |
| 2.3 Remaining stories          | Done       | Dependencies remain valid; five stories need refinement.                                     |
| 2.4 Future epic invalidation   | N/A        | No epic is invalidated and no new epic is required.                                          |
| 2.5 Epic order                 | Done       | No resequencing is required.                                                                 |
| 3.1 PRD conflicts              | Done       | No PRD conflict or scope change.                                                             |
| 3.2 Architecture conflicts     | Done       | Retryability and delivery-state ownership are now explicit.                                  |
| 3.3 UX conflicts               | Done       | UX remains valid and unchanged.                                                              |
| 3.4 Other artifacts            | Done       | The stale sprint blocker was replaced with passed validation evidence.                       |
| 4.1 Direct Adjustment          | Viable     | Medium planning effort and low-to-medium risk.                                               |
| 4.2 Potential Rollback         | Not viable | No implementation rollback is required.                                                      |
| 4.3 PRD MVP Review             | Not viable | MVP remains achievable and unchanged.                                                        |
| 4.4 Recommended path           | Done       | Direct Adjustment selected.                                                                  |
| 5.1 Issue summary              | Done       | Documented in Section 1.                                                                     |
| 5.2 Impact and adjustments     | Done       | Documented in Sections 2 and 4.                                                              |
| 5.3 Recommended path           | Done       | Documented in Section 3.                                                                     |
| 5.4 MVP impact and action plan | Done       | No MVP change; sequencing is explicit below.                                                 |
| 5.5 Agent handoff              | Done       | Moderate backlog reorganization routed to PO/Developer with architecture review.             |
| 6.1 Checklist completion       | Done       | All applicable analysis items are addressed.                                                 |
| 6.2 Proposal accuracy          | Done       | Proposal is grounded in current artifacts and validation evidence.                           |
| 6.3 User approval              | Done       | Explicit implementation approval received through the Lavish review surface.                 |
| 6.4 Sprint status update       | Done       | Stale blocker cleared; no story IDs or statuses changed.                                     |
| 6.5 Handoff plan               | Done       | Moderate-scope planning handoff is active.                                                   |

## 6. Implementation Handoff

### Scope Classification

**Moderate:** Backlog and story-definition reorganization is required, with a small architecture clarification and sprint-status correction.
No fundamental product or solution replan is required.

### Route To

- Product Owner or planning owner: approve the epic and story restructuring while preserving parent-linked IDs.
- Developer agent: apply the approved `epics.md` and `sprint-status.yaml` edits.
- Solution Architect or architecture owner: review and approve AD-11 and command-envelope retryability wording.

### Implementation Sequence

1. Update `architecture.md` with retryability and AD-11.
2. Update `epics.md` with the epic definition, independent task gates, ownership, personas, and acceptance criteria.
3. Update `sprint-status.yaml` to clear the stale global contract blocker while keeping all stories in backlog.
4. Run the canonical local contract validator.
5. Run Markdown and diff integrity checks.
6. Re-run `bmad-check-implementation-readiness`.
7. Start sprint planning only when readiness returns `READY`.

### Success Criteria

- Epic 3 has an explicit goal, user value, completion signal, and independence statement.
- Stories 3.1 and 3.5 retain stable IDs but have independently accepted implementation tasks with distinct rollback boundaries.
- Story 3.5 is the sole write-side delivery-state owner.
- Story 3.7 is read-only with respect to delivery-attempt state.
- Story 3.3d has command-specific success and failure criteria.
- Story 3.7 has invalid-query criteria.
- Story 3.3a and architecture explicitly trace `error.retryable`.
- The stale contract blocker is removed from sprint status and replaced with passed validation evidence.
- The canonical contract validator passes after edits.
- A repeated implementation-readiness assessment returns `READY` with no major finding.

## 7. Review Decision

Status: Approved and applied in Batch mode.

The user reviewed the complete proposal and explicitly approved it for implementation through the Lavish review surface.

## 8. Applied Artifact Changes

- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`: Added AD-11 and explicit command-envelope retryability.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`: Added the Epic 3 definition, independent task gates, write/read ownership, outcome personas, and expanded acceptance criteria.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: Replaced the stale missing-contract blocker with passed validation evidence while leaving every story in backlog.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md`: Unchanged.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/ux.md`: Unchanged.
- `_bmad-output/planning-artifacts/contracts/workflow-commander/`: Unchanged.

## 9. Validation Evidence

- Sprint status YAML parse: passed.
- Canonical Workflow Commander contract validation: passed.
- Validated 7 schemas, 17 command examples, 13 binding examples, 7 delivery examples, 6 generic event examples, 7 provider event examples, 9 callback rejection examples, and 6 materialization examples.
- Contract package isolation check: passed without parent workspace traversal.
- Targeted Prettier check: passed after applying repository formatting.
- Git diff whitespace check: passed.
