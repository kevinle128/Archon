---
project: Archon
workflow_target: hermes-workflow
date: 2026-07-12
status: approved-and-applied
mode: automated-batch
trigger_source: implementation-readiness-report-2026-07-12.md
scope_classification: minor
---

# Sprint Change Proposal: Hermes Workflow UX Scope Warning Clearance

## 1. Issue Summary

The latest implementation readiness assessment for `hermes-workflow` returned `READY` with 0 critical, 0 major, and 0 minor issues.
The routing evaluator still returned a negative loop result because the readiness report included 2 warnings about UX scope controls.
Per the automation contract, any warning keeps the loop unclean until Correct Course resolves or explicitly clears it.

Evidence:

- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/implementation-readiness-report-2026-07-12.md` reports readiness status `READY` with 2 warnings.
- Warning 1 says the UX artifact intentionally excludes Archon Web screens, workflow builder UI, wireframes, mockups, and new in-product UI.
- Warning 2 says implementation agents must not import older Route Loop Routing UX artifacts, Archon Web workflow builder mockups, or older June 26 UX shards as active Workflow Commander requirements.
- The report found no UX-to-PRD or UX-to-architecture alignment issue.

## 2. Impact Analysis

Epic Impact:

- No epic is blocked or invalidated.
- No story needs to be added, removed, renumbered, or resequenced.
- The existing seven Archon-owned provider stories remain implementation-ready.
- The epics needed a stronger story-level boundary that UI mockups and older UX shards are not dependencies for this headless provider slice.

Story Impact:

- Story implementation scope is unchanged.
- Developer agents need explicit instruction to ignore UI-only and superseded UX sources unless a future approved planning artifact reactivates them.
- The warning clearance does not create UI work, workflow builder work, Hermes user interaction work, or reconciliation work for Archon.

Artifact Conflicts:

- The PRD, architecture, epics, UX note, and planning README already agreed that Workflow Commander v1 is headless from Archon's side.
- The issue was classification ambiguity: the active UX exclusions could be misread as warnings rather than approved scope decisions.
- The affected artifacts needed explicit language that the absence of UI artifacts is a satisfied product and UX boundary, not a deferred requirement.

Technical Impact:

- No application source code, migrations, schemas, contracts, runtime configuration, or tests are changed by this Correct Course pass.
- No new implementation validation command is required for the Markdown-only planning change.
- Downstream implementation remains scoped to the active Archon repository root and the existing contract-first validation gates.

## 3. Recommended Approach

Recommended path: Direct Adjustment.

Rationale:

- The readiness report is already `READY`; the only unclean loop condition is warning classification.
- The warnings describe intentional scope controls, not missing UX work.
- Directly updating the active planning artifacts is lower risk than broad replanning or adding unnecessary UX deliverables.
- Preserving the headless boundary prevents implementation agents from importing older or unrelated UI artifacts into the Archon provider slice.

Effort estimate: Low.

Risk level: Low.

MVP impact: None.
The Archon-owned MVP remains FR-7 through FR-10 with the same seven stories and no added UI scope.

## 4. Detailed Change Proposals

### PRD

Section: Product Boundary.

Old:

```text
Workflow Commander v1 is headless.
The user controls workflow work through Hermes commands, agent interactions, structured results, durable pending-gate queries, and existing notification transports when available.
Archon remains a provider implementation and does not become the user-facing command center.
```

New:

```text
Workflow Commander v1 is headless.
The user controls workflow work through Hermes commands, agent interactions, structured results, durable pending-gate queries, and existing notification transports when available.
Archon remains a provider implementation and does not become the user-facing command center.
The lack of Archon Web screens, workflow builder UI, wireframes, mockups, and new in-product UI is an explicit product boundary for this handoff, not a missing UX deliverable.
The Archon-side UX requirement is satisfied through machine-consumable provider output quality and clear operational diagnostics in CLI JSON and workflow events.
```

Rationale:
This clears Warning 1 by making the no-UI decision an explicit product boundary rather than an apparent UX omission.

Section: Scope Not Owned By Archon.

Change:

- Added a supersession statement for Route Loop Routing UX artifacts, Archon Web workflow builder mockups, older June 26 UX shards, and UI-only mockup packages.

Rationale:
This clears Warning 2 by making superseded UX sources explicitly inactive for Workflow Commander implementation.

### Architecture

Section: Scope and AD-10.

Change:

- Added that Archon Web screens, workflow builder UI, wireframes, mockups, and new in-product UI are not assigned to this handoff.
- Defined the active Archon UX contract as parseable CLI JSON, signed typed events, provider binding diagnostics, and delivery health.
- Added that older UX artifacts and UI-only prototypes are superseded architectural inputs for Workflow Commander.

Rationale:
This keeps the architecture aligned with the PRD and prevents UI artifacts from becoming accidental implementation dependencies.

### Epics

Section: Story-Level Implementation Boundaries.

Change:

- Added that no story should add or depend on Archon Web screens, workflow builder UI, wireframes, mockups, or new in-product UI.
- Added that implementation agents must ignore older Route Loop Routing UX artifacts, Archon Web workflow builder mockups, June 26 UX shards, and UI-only prototypes unless a later approved Archon planning artifact reactivates them.

Rationale:
This gives Developer agents the warning clearance at the story execution layer where accidental scope import is most likely.

### UX Note

Section: Headless Archon Provider Slice.

Change:

- Split the note into active sections for UX scope decision, superseded UX sources, and Archon UX requirements.
- Added that the absence of Archon Web screens, workflow builder surfaces, wireframes, mockups, and new in-product UI is an approved UX scope decision.
- Added that this absence is not a deferred UX requirement, missing artifact, or implementation-readiness warning.
- Added that readiness review should treat the headless UX scope as satisfied when PRD, architecture, and epics preserve the same provider boundary.
- Added that superseded UX sources are an active scope control, not an open warning.

Rationale:
This directly resolves both readiness warnings in the source artifact that produced them.

### Planning README

Section: Active UX note guidance.

Change:

- Added that the Archon Web and mockup exclusion is an approved scope decision, not a deferred UX task or readiness warning.
- Added that readiness review should treat the UX scope control as satisfied when the active PRD, architecture, epics, and UX note all preserve the headless provider boundary.

Rationale:
This keeps the planning package index consistent with the corrected UX classification.

## 5. Checklist Results

| Checklist Item                  | Status     | Notes                                                                                                       |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| 1.1 Triggering story            | N/A        | The trigger is the latest readiness evaluator decision, not a story implementation failure.                 |
| 1.2 Core problem                | Done       | Readiness warnings describe intentional UX scope controls but the route loop treats any warning as unclean. |
| 1.3 Supporting evidence         | Done       | Evidence is the `READY` readiness report with 2 UX scope warnings and no blocking UX alignment issue.       |
| 2.1 Current epic impact         | Done       | Current epics remain valid; only boundary language was strengthened.                                        |
| 2.2 Epic-level changes          | Done       | No epic addition, removal, redefinition, or resequencing is required.                                       |
| 2.3 Remaining epics             | Done       | FR-7 through FR-10 story coverage remains unchanged.                                                        |
| 2.4 Future epic invalidation    | N/A        | No planned epic is invalidated by clearing warnings.                                                        |
| 2.5 Epic order                  | N/A        | No priority or sequence change is required.                                                                 |
| 3.1 PRD conflicts               | Done       | PRD now marks no-UI as an explicit product boundary and supersedes older UX sources.                        |
| 3.2 Architecture conflicts      | Done       | Architecture now mirrors the headless UX contract and supersession rule.                                    |
| 3.3 UI/UX conflicts             | Done       | UX note now treats the prior warnings as approved scope decisions, not open issues.                         |
| 3.4 Other artifacts             | Done       | Planning README now reflects the same readiness treatment.                                                  |
| 4.1 Direct Adjustment           | Viable     | Low-effort Markdown planning correction with no implementation code impact.                                 |
| 4.2 Potential Rollback          | Not viable | No implemented work needs rollback.                                                                         |
| 4.3 PRD MVP Review              | Not viable | MVP remains achievable and unchanged.                                                                       |
| 4.4 Recommended path            | Done       | Direct Adjustment selected.                                                                                 |
| 5.1 Issue summary               | Done       | Documented above.                                                                                           |
| 5.2 Impact and adjustment needs | Done       | Documented above.                                                                                           |
| 5.3 Recommended path            | Done       | Documented above.                                                                                           |
| 5.4 MVP impact and action plan  | Done       | No MVP reduction; action is to proceed with implementation using corrected scope controls.                  |
| 5.5 Agent handoff               | Done       | Developer agents should continue with the existing Archon stories and ignore superseded UX sources.         |
| 6.1 Checklist completion        | Done       | All applicable checks completed in batch mode.                                                              |
| 6.2 Proposal accuracy           | Done       | Proposal reflects the applied edits.                                                                        |
| 6.3 User approval               | Done       | Batch invocation explicitly approved in-scope planning-artifact corrections.                                |
| 6.4 sprint-status.yaml update   | N/A        | No stories or epics were added, removed, or renumbered.                                                     |
| 6.5 Handoff plan                | Done       | See next section.                                                                                           |

## 6. Implementation Handoff

Scope classification: Minor.

Route to: Developer agent for direct implementation of the existing Archon-owned stories.

Developer responsibilities:

- Treat `ux.md` as the active and complete UX artifact for the headless Archon provider slice.
- Do not create Archon Web screens, workflow builder UI, wireframes, mockups, or new in-product UI for Workflow Commander v1.
- Do not import Route Loop Routing UX artifacts, Archon Web workflow builder mockups, older June 26 UX shards, or UI-only prototypes as active requirements.
- Preserve the existing provider boundary: Archon produces CLI JSON, signed typed workflow events, provider binding diagnostics, workflow run controls, non-blocking event outbox behavior, and delivery health.
- Continue to use the local contract validator for contract-dependent stories.

Success criteria:

- Readiness no longer reports the Archon Web and workflow-builder exclusion as a warning.
- Readiness no longer reports superseded Route Loop Routing UX artifacts, Archon Web workflow builder mockups, or June 26 UX shards as a warning.
- The active handoff remains `READY` with no critical, major, minor, or warning findings.

## 7. Applied Artifact Changes

Applied directly in this Correct Course batch:

- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md`: Clarified that no Archon UI deliverables are part of this handoff and that older UX sources are superseded.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md`: Clarified the headless UX contract and removed older UI artifacts as valid architectural inputs.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md`: Added story execution boundaries preventing UI work and superseded UX-source imports.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/ux.md`: Reframed the two warning conditions as approved active UX scope decisions.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/README.md`: Updated planning-package guidance so readiness treats the UX scope control as satisfied.

Correct Course workflow complete.
