# Sprint Change Proposal - Exit Story 3.3d Review Loop

Status: approved — implemented; exit gates G0-G7 complete

Date: 2026-07-20

Project: Archon

Change scope: Moderate story and review-process correction within Epic 3

Approval: kevin approved the proposal in the project conversation on 2026-07-20 and requested the next correction step.

## 1. Issue Summary

Story `3-3d-provide-archon-recovery-command-cli-json` entered a non-convergent review loop after its initial implementation.
It accumulated 49 patch findings across nine review-gate commits, with later findings repeatedly reopening the same parser, retry ownership, recovery-context, cancellation, and proof invariants.

The trigger is not a new product requirement.
It is a failed implementation and review approach caused by four systemic gaps:

1. Technical decisions were not mapped one-to-one into story tasks and executable proofs.
2. Findings were closed as individual examples instead of invariant clusters.
3. Review candidates were not assigned Patch, Defer, or Dismiss ownership before implementation.
4. Broad validation masked non-hermetic focused tests and incomplete runtime observables.

### Evidence

- The story records 49 findings grouped into six recurring invariant families.
- TD-007 rejects English-message sniffing, while the current story plan and `classifyRunError()` use string-pattern classification for known recovery failures.
- TD-N03 defines a CLI-only provider control surface, while the current patch expanded into legacy core operations, server routes, OpenAPI responses, and generated web types.
- TD-002 and TD-003 assign later retry validation, claim, preparation, and execution to the detached worker, while the story plan also assigned eligibility checks to the parent command.
- `workflow-json.e2e.test.ts` passes 74/74 as a full file, while selecting 3.3D-CLI-039, 042, 043, and 044 fails 0/4 because database-schema initialization depends on earlier tests.
- The committed story diff spans 15 files with 3,958 insertions and 242 deletions, increasing the rollback surface beyond the original CLI story.

## 2. Change Navigation Checklist

| Checklist item              | Status                  | Finding or action                                                                                                             |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Triggering story        | [x]                     | Story 3.3d, recovery command CLI JSON.                                                                                        |
| 1.2 Core problem            | [x]                     | Failed approach: patch-by-patch review cannot converge while decisions, scope, and proof gates remain inconsistent.           |
| 1.3 Supporting evidence     | [x]                     | 49 findings, nine review gates, decision conflicts, scope expansion, and focused-test failure are documented.                 |
| 2.1 Current epic viability  | [!]                     | Epic 3 remains viable, but Story 3.3d must complete correction gates before dependent work continues.                         |
| 2.2 Epic-level change       | [x]                     | No Epic 3 product-scope change is required. Add a story-level convergence gate.                                               |
| 2.3 Remaining planned work  | [!]                     | Stories 3.5 and 3.7 must inherit decision coverage, scope ownership, hermetic proof, and finding-triage guardrails.           |
| 2.4 New or obsolete epics   | [N/A]                   | No new epic is needed and no planned epic becomes obsolete.                                                                   |
| 2.5 Order or priority       | [x]                     | Stabilize Story 3.3d before using its producer surface as a downstream dependency.                                            |
| 3.1 PRD conflict            | [x]                     | No PRD change is needed. FR-8 and the CLI-only boundary remain authoritative.                                                 |
| 3.2 Architecture conflict   | [x]                     | No architecture change is needed. Restore implementation alignment with the existing provider and ownership boundaries.       |
| 3.3 UX conflict             | [N/A]                   | The approved UX is headless and explicitly excludes new Archon Web controls.                                                  |
| 3.4 Secondary artifacts     | [!]                     | Story 3.3d, its TEA design, sprint status, core compatibility patches, server routes, and generated web types require triage. |
| 4.1 Direct adjustment       | Viable                  | Medium effort and medium risk. Correct the story plan, typed errors, retry ownership, test harness, and invariant proofs.     |
| 4.2 Potential rollback      | Viable in part          | Restore legacy cancel and abandon behavior and remove or defer server/web changes that were pulled into the CLI story.        |
| 4.3 PRD MVP review          | Not viable or necessary | Product goals and MVP boundaries remain achievable without reduction.                                                         |
| 4.4 Recommended path        | [x]                     | Hybrid direct adjustment plus partial rollback or defer of out-of-scope changes.                                              |
| 5.1–5.5 Proposal components | [x]                     | Issue, impact, approach, detailed edits, handoff, and success criteria are included below.                                    |
| 6.1–6.2 Final review        | [x]                     | Proposal is evidence-backed and internally consistent.                                                                        |
| 6.3 User approval           | [!]                     | Explicit approval is required before applying story, sprint-status, test, or code corrections.                                |
| 6.4 Sprint status update    | [!]                     | After approval, change Story 3.3d from `review` to `in-progress`; do not close Epic 3 retrospective.                          |
| 6.5 Handoff                 | [!]                     | Route decision alignment to Architect, implementation to Developer, and proof closure to Test Architect after approval.       |

## 3. Impact Analysis

### Epic Impact

Epic 3 remains achievable as planned.
No epic acceptance criteria, business goals, or ordering need to be redefined.
Story 3.3d must be stabilized before it can be considered a reliable producer dependency.
Stories 3.5 and 3.7 should not enter implementation without the reusable proof guardrails created by the retrospective.

### Story Impact

Story 3.3d requires the following changes:

- Return from `review` to `in-progress` while review is frozen.
- Add a decision-to-task-to-proof matrix.
- Replace individual finding closure with six invariant-cluster gates.
- Restore typed recovery error ownership required by TD-007.
- Remove parent-side retry eligibility work that belongs to the detached worker.
- Isolate the provider cancel CAS from legacy abandon and HTTP behavior.
- Make E2E setup hermetic and strengthen worker-outcome and no-mutation proof.
- Treat F1–F49 as historical audit records, not sufficient completion evidence.

### PRD, Architecture, and UX Impact

No PRD modification is recommended.
No architecture modification is recommended.
No UX modification is recommended.

The correction restores the implementation to the already-approved boundaries:

- State-changing Workflow Commander control remains CLI JSON.
- Hermes remains the downstream subprocess consumer.
- Archon Web receives no new recovery control requirement.
- Legacy human commands remain compatible.

### Technical Impact

The correction affects these areas:

- `packages/cli/src/cli.ts` for fail-closed parser and preflight boundaries.
- `packages/cli/src/commands/workflow.ts` for typed recovery errors, parent/worker ownership, persisted context, and command envelopes.
- CLI unit, contract, and subprocess E2E tests.
- A narrow core database CAS primitive if the provider cancel command cannot express TD-004 through an existing operation without changing legacy semantics.
- Current core operation, server route, and generated web changes must be reverted or deferred unless a separate approved scope amendment owns them.

## 4. Recommended Approach

Use a hybrid correction.

### Direct Adjustment

Correct the Story 3.3d plan and implementation at the six invariant boundaries.
Introduce typed recovery causes, assign retry lifecycle validation to the worker, make tests hermetic, and prove actual runtime observables.

### Partial Rollback or Defer

Preserve the existing provider CLI requirement but remove Story 3.3d ownership of legacy HTTP and Web behavior.

Recommended cancellation shape:

1. Restore the pre-story behavior of the existing shared `cancelWorkflowRun()` and legacy `abandonWorkflow()` surfaces.
2. If TD-004 requires a narrower CAS than the existing function provides, add a dedicated narrowly named recovery-command CAS primitive in core DB code.
3. Call that narrow primitive only from the provider CLI command.
4. Do not modify server cancel or abandon route behavior, OpenAPI responses, or generated web types in Story 3.3d.
5. Record any legitimate HTTP CAS-loss improvement as a Deferred finding owned by a separate API compatibility story.

### Alternatives Rejected

- Continue generating new F-numbers and patching each example independently.
- Rewrite the technical decisions to match the current implementation after the fact.
- Keep server and web changes merely because they already exist in the patch.
- Treat a full-file or full-validation pass as a substitute for standalone focused proof.
- Reduce the PRD or Epic 3 product scope.

## 5. Decision-to-Task-to-Proof Matrix

| Decision | Corrected implementation responsibility                                                                                                           | Required proof                                                                                     | Scope owner                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| TD-N01   | Preserve `workflow.resume`, `workflow.retry`, and `workflow.cancel` command identifiers and CLI spellings.                                        | Contract and dispatch tests assert canonical command values.                                       | CLI                                                                                   |
| TD-N02   | Every caught JSON-mode result emits exactly one envelope and matching exit code with no stray output.                                             | Real subprocess parser, preflight, stdout, stderr, and exit-code cases.                            | CLI                                                                                   |
| TD-N03   | Keep the provider recovery control surface CLI-only. Do not add HTTP or Web recovery behavior.                                                    | Changed-file and API-surface audit; no Story 3.3d server or generated-web diff.                    | CLI, with a narrow existing or dedicated core DB primitive only if required by TD-004 |
| TD-N04   | Preserve provider-neutral workflow identity and redact raw diagnostics.                                                                           | Envelope fixture and forbidden-field tests.                                                        | CLI and contract adapter                                                              |
| TD-N05   | Preserve non-JSON resume, retry-node, and abandon behavior.                                                                                       | Focused legacy compatibility tests against the pre-story behavior.                                 | CLI and existing core operation owner                                                 |
| TD-N06   | Resolve retry execution context only from persisted run and codebase state.                                                                       | Different-caller-cwd subprocess case and invalid persisted-context cases.                          | CLI context resolver and worker                                                       |
| TD-N07   | Complete Archon producer proof without implementing Hermes consumer behavior.                                                                     | Negative source audit for consumer-only classifications and no supervisor.                         | Archon producer                                                                       |
| TD-002   | Parent acknowledges exact-run worker process creation; worker owns later claim, eligibility, and execution outcome.                               | Parent envelope plus exact-run worker claim, one-winner execution, and later status/event/outcome. | CLI parent and detached worker                                                        |
| TD-003   | Parent validates syntax and spawn prerequisites only; worker owns node validation, claim, checkpoint, reset, invalidation, and execution.         | Exact-node worker proof including invalid node as a later worker outcome.                          | CLI parent and targeted retry worker                                                  |
| TD-004   | Provider cancel uses an eligible-state CAS and acknowledges only a winning durable transition.                                                    | SQLite CAS winner/loser and CLI minimal-envelope proof without changing legacy HTTP/Web behavior.  | CLI and narrow DB CAS owner                                                           |
| TD-005   | Parent envelopes caught pre-response failures; post-spawn worker failures remain later outcomes; Hermes owns uncatchable subprocess observations. | Spawn failure, database failure, internal timeout, later worker failure, and no-supervisor tests.  | CLI parent, worker, downstream Hermes boundary                                        |
| TD-007   | Known recovery failures use typed causes and structured safe details, not English-message matching.                                               | Unit and subprocess tests that classify typed causes and reject raw-message leakage.               | Recovery operation boundary and CLI adapter                                           |
| TD-009   | New retry and cancel spellings remain JSON-only; legacy human spellings remain unchanged.                                                         | Non-JSON usage guidance and legacy command compatibility tests.                                    | CLI                                                                                   |

## 6. Detailed Artifact Change Proposals

### Proposal A — Freeze broad review

Artifact: Story 3.3d and `sprint-status.yaml`

OLD:

```text
Status: review
3-3d-provide-archon-recovery-command-cli-json: review
```

NEW after approval:

```text
Status: in-progress
3-3d-provide-archon-recovery-command-cli-json: in-progress
```

Rationale: A story with unresolved decision, scope, and proof gates is not ready for another broad review.

### Proposal B — Add a course-correction gate to the story

Artifact: Story 3.3d, before implementation tasks

OLD:

```text
Implementation tasks begin immediately after the acceptance criteria.
```

NEW after approval:

```markdown
## Course-Correction Gate

- [ ] Decision-to-task-to-proof matrix is consistent and approved.
- [ ] Allowed package surface is frozen; server and web changes are deferred.
- [ ] Six invariant clusters have explicit closure criteria.
- [ ] Recovery E2E fixtures pass focused selection independently.
- [ ] Typed recovery causes replace known English-message classification.
- [ ] Resume and retry proofs observe the owning runtime and persistence boundaries.
- [ ] Only after these checks pass may Story 3.3d return to review.
```

Rationale: This converts the retrospective lessons into an enforceable story gate.

### Proposal C — Correct the typed error task

Artifact: Story 3.3d, Slice 2 and error-mapping tasks

OLD:

```text
Add recovery-specific classifier patterns such as `Cannot resume run with status`.
```

NEW after approval:

```text
Introduce typed recovery parent causes for malformed input, unexpected state, internal timeout, spawn failure, database failure, and cancel CAS loss.
Map the typed cause to the shared envelope at the CLI adapter boundary.
Do not classify known recovery failures by matching English error text.
```

Rationale: Restores TD-007 and prevents error-wording changes from altering the machine contract.

### Proposal D — Correct retry ownership

Artifact: Story 3.3d, Slices 3 and 4

OLD:

```text
The parent validates retryability or node eligibility before dispatch.
```

NEW after approval:

```text
The parent validates command syntax and the minimum persisted context required to create an exact-run worker process.
The parent does not claim the run or validate lifecycle or node eligibility that TD-002 and TD-003 assign to the worker.
Every post-spawn validation or execution result is exposed as a later worker outcome and never retroactively changes the parent acknowledgement.
```

Rationale: Removes the parent/worker responsibility conflict that repeatedly reopened exact-run findings.

### Proposal E — Isolate provider cancel from legacy surfaces

Artifact: Story 3.3d, Slice 5

OLD:

```text
Modify shared cancel and abandon behavior, then patch server routes and generated Web types to follow the changed shared behavior.
```

NEW after approval:

```text
Preserve legacy cancel and abandon behavior.
Use an existing narrow CAS or add a dedicated provider recovery-command CAS for running, paused, and failed states.
Do not change HTTP cancel or abandon routes, OpenAPI responses, or generated Web types in Story 3.3d.
Defer legitimate API CAS-loss handling to an explicitly owned API compatibility story.
```

Rationale: Satisfies TD-004 without violating TD-N03 or TD-N05.

### Proposal F — Replace finding checkboxes with invariant closure

Artifact: Story 3.3d, Review Findings section

OLD:

```text
F1 through F49 checked individually as resolved.
```

NEW after approval:

```text
Retain F1 through F49 as historical audit records.
Add six invariant clusters: parser/preflight, exact-run retry, recovery context, cancel CAS compatibility, executable proof, and TEA/spec alignment.
Each cluster requires implementation rule, allowed scope, positive proof, negative proof, boundary proof, and evidence command before closure.
```

Rationale: Prevents another patch-of-patch sequence.

### Proposal G — Make proof hermetic and observable

Artifacts: `workflow-json.e2e.test.ts` and Story 3.3d proof section

OLD:

```text
Seed helpers call a CLI command that assumes another test already initialized the database schema.
Worker log existence or non-empty content is treated as worker execution proof.
```

NEW after approval:

```text
Initialize the isolated SQLite schema explicitly in the E2E setup or seed helper.
Require selected recovery cases to pass independently.
For retry, observe exact run or node claim, one-winner state, and later status, event, or terminal outcome.
For resume, observe every declared no-mutation field and the absence of checkout and executor ownership.
```

Rationale: A proof must observe the acceptance invariant and must not depend on test ordering.

### Proposal H — Apply the correction to later Epic 3 stories

Artifacts: Stories 3.5 and 3.7 when prepared for implementation

OLD:

```text
No mandatory Story Proof Guardrail gate.
```

NEW after Story 3.3d stabilization:

```text
Apply `brain/StoryProofGuardrails.md` before implementation readiness.
Require decision coverage, package-scope ownership, invariant clusters, standalone focused proof, generated-artifact provenance, and Patch/Defer/Dismiss triage.
```

Rationale: Prevents the same review-loop mechanics from moving into outbox and delivery-health work.

## 7. Exit Gates for Story 3.3d

The story exits the loop only in this order:

1. `G0 — Approval and freeze`: Approve this proposal and return Story 3.3d to `in-progress`.
2. `G1 — Decision alignment`: Complete the decision-to-task-to-proof matrix with no unresolved conflict.
3. `G2 — Scope closure`: Remove or defer server and web changes; preserve legacy behavior; approve any narrow core CAS primitive.
4. `G3 — Implementation closure`: Implement typed errors, corrected retry ownership, persisted context, and provider cancel semantics.
5. `G4 — Hermetic focused proof`: Run recovery cases independently from a clean isolated home and database.
6. `G5 — Invariant closure`: Close all six clusters with positive, negative, boundary, and owning-runtime evidence.
7. `G6 — Full validation`: Run contract validation, focused package tests, and `bun run validate`.
8. `G7 — One bounded final review`: Review only the decisions, six invariants, approved changed-file surface, and validation evidence.

If the final review finds another variant of a previously reopened invariant, the story returns to `G1` or `G5` instead of creating another standalone patch chain.

## 8. Implementation Handoff

### Scope Classification

Moderate.
The PRD and architecture remain stable, but the active story, sprint state, test design, cross-package patch ownership, and review process require coordinated correction.

### Owners

- Winston (System Architect): approve decision interpretation, scope boundary, and narrow cancel CAS ownership.
- Amelia (Developer): update the story plan, implement typed recovery boundaries, remove or defer out-of-scope patches, and close invariant clusters.
- Murat (Test Architect): make the E2E harness hermetic and verify owning-runtime observables.
- kevin (Project Lead): approve this proposal and any decision amendment that materially expands Story 3.3d.

### Success Criteria

- Story 3.3d is not returned to review until G0 through G6 pass.
- No known recovery error is classified through English-message sniffing.
- Retry parent and worker responsibilities match TD-002 and TD-003.
- Provider cancel satisfies TD-004 without changing Story 3.3d HTTP or Web behavior.
- Focused recovery tests pass independently and in the full file.
- Retry proof observes exact worker ownership and outcome; resume proof observes its complete no-mutation contract.
- Every final-review candidate has a Patch, Defer, or Dismiss outcome.
- `bun run validate` passes after focused proof, not instead of focused proof.

## 9. Approval Required

No story, sprint-status, test, or code correction described above should be applied until the Project Lead explicitly approves this proposal.

Decision recorded: approved and implemented; G0–G7 are complete.
