---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
assessmentTarget: spec-agent-node-room
readinessStatus: NOT_READY
status: complete
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-16
**Project:** Archon

## Document Inventory

### PRD

- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md` — whole document, 9,502 bytes, modified 2026-07-30

### Architecture

- `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` — primary architecture spine, 33,210 bytes, modified 2026-09-15
- `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` — live-agent-steering architecture spine, 43,363 bytes, modified 2026-09-15

### Epics and Stories

- `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` — target-specific document, 48,688 bytes, modified 2026-09-16

### UX Design

- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` — design specification, 60,193 bytes, modified 2026-09-15
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` — experience specification, 169,292 bytes, modified 2026-09-16

### Discovery Notes

- No standard sharded document set with an `index.md` was found.
- Older and feature-specific alternatives were excluded after user confirmation.
- Existing readiness reports were excluded because they are assessment outputs rather than source specifications.

## PRD Analysis

### Functional Requirements

#### FR-7: Register Generic Workflow Provider Bindings

Archon can create, update, inspect, rotate, disable, and diagnose provider-side Workflow Provider Binding records for a project or codebase using generic `provider` and `name` vocabulary.

Consequences:

- Archon persists a reverse binding from project or codebase execution context to controller `provider`, controller `name`, and workflow event route.
- Archon exposes binding status as parseable CLI JSON.
- Archon exposes update through an explicit `binding.update` command surface; `binding.create` is not an update or upsert path.
- Archon can represent missing, valid, stale, disabled, rotated, and conflicting binding states.
- Archon returns machine-readable errors for malformed input or invalid lifecycle transitions.
- Archon does not expose Hermes-specific command names or model fields.

#### FR-8: Expose Provider Workflow Control Through CLI JSON

Archon exposes start, status, approve, reject, resume, retry, and cancel for workflow runs through CLI JSON.
This is the producer side of the provider adapter that a controller such as Hermes consumes.

Consequences:

- Archon returns parseable JSON for every state-changing control result.
- Every result includes schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, machine-readable result payload, and machine-readable error shape when failed.
- Archon returns machine-readable classifications for malformed requests, unexpected states, internally caught timeouts, and every other failure it catches before responding.
- The subprocess consumer classifies empty output or uncatchable process exit as unexpected exit, malformed or schema-invalid output as schema mismatch, and a consumer-enforced timeout as timeout.
- Archon does not expose a state-changing HTTP control path for Workflow Commander v1.

#### FR-9: Produce Signed Typed Workflow Events

Archon emits signed typed workflow events for workflow start, workflow completion, workflow failure, approval requested, delivery failed, and artifact events through a non-blocking outbox.

Consequences:

- Archon writes eligible events to durable outbox state before delivery.
- Archon workflow execution continues even when event delivery fails later.
- Every event body includes schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, and idempotency key.
- Signature metadata travels in HTTP headers.
- Archon uses stable event id and idempotency key values so consumers can classify duplicate-safe delivery.
- Archon produces events that can be validated by shared event-envelope and rejection fixtures.

#### FR-10: Surface Provider Event Delivery And Outbox Health

Archon reports workflow event delivery and outbox health as structured status.

Consequences:

- Archon persists delivery status, retry status, last attempt time when available, last error category, terminal failure state, and affected workflow run reference.
- Archon reports healthy, delayed, retrying, failed, duplicated, terminal failure, and reconciliation-pending states when known.
- Archon exposes delivery status through CLI JSON.
- Archon does not block workflow execution solely because event notification failed.

**Total FRs: 4**

### Non-Functional Requirements

- **NFR-1:** Workflow events accelerate delivery but are not the only source of truth.
- **NFR-5:** Archon events must be signed and schema-versioned so consumers can reject invalid events.
- **NFR-6:** Event secrets and signature metadata must support binding-scoped validation by the consumer.
- **NFR-9:** Archon persists workflow commands, workflow events, and delivery state with enough detail for audit.
- **NFR-14:** Archon error and delivery-health responses expose diagnostic categories and machine-readable detail rather than raw stack traces.
- **NFR-15:** Archon stays within provider ownership boundaries and does not reach into Hermes-owned concerns.
- **NFR-16:** Provider integration surfaces remain generic provider surfaces.
- **NFR-17:** The local handoff is complete enough for isolated Archon implementation agents.

**Total NFRs: 8**

### Additional Requirements

#### Product and ownership boundaries

- Workflow Commander v1 is headless.
- Hermes is the human-facing command surface; Archon remains a provider implementation.
- No Archon Web screens, workflow builder UI, wireframes, mockups, or new in-product UI are required by this handoff.
- Archon owns provider binding, CLI JSON producer contracts, workflow run controls, typed signed event production, non-blocking event delivery, and delivery status.
- Archon must use generic `provider` and `name` identity and must not add Hermes-specific provider fields.
- Project Binding, BMAD mount, Hermes cwd enforcement, materialization, Project Work Items, Phase Tasks, HILT Gates, event ingress, Story Status History, reconciliation, diagnostics, and Hermes interaction remain outside Archon ownership.
- Archon producer stories may name blocked Hermes consumer stories but must not implement the consumer side.
- Route Loop Routing UX artifacts, Archon Web workflow builder mockups, older June 26 UX shards, and UI-only mockup packages are superseded unless a later approved artifact reactivates them.

#### Contract readiness

- The local contract package is `contracts/workflow-commander/`.
- Producer stories may use its contracts only when `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` succeeds against the checked-in package.
- A producer story must not become implementation-ready when the validator fails, a required schema or example is missing, or the story needs a field absent from the validated package.
- Producer code must not invent a missing contract.

#### Cross-project dependencies

- Each cross-project dependency must identify the other subproject or parent story, the required contract, the blocking behavior, and the integration validation method.
- Each dependency must name a concrete contract family or interface.

#### Implementation and validation

- Implementation must run from the active Archon repository root that contains this planning handoff and the root `package.json`.
- A user-local absolute path must not replace the repository root.
- The recommended downstream validation command is `bun run validate`.

#### Non-goals

- Archon does not implement Hermes Project Binding or Hermes Project Work Item storage.
- Archon does not implement Hermes materialization, phase tasks, HILT Gates, Story Status History, reconciliation, diagnostics, or user interaction.
- Archon does not add Hermes-specific provider vocabulary.
- Archon does not add a state-changing HTTP control path for Workflow Commander v1.
- Archon does not mark producer stories ready while required local schemas or fixtures are missing or the canonical validator fails.

### PRD Completeness Assessment

The PRD is explicit and testable for the Archon Workflow Commander provider slice.
It defines four functional requirements, eight non-functional requirements, ownership boundaries, contract gates, dependency-record rules, and non-goals.
The numbering starts at FR-7 and omits other system-level requirements because this document is an Archon-only slice.
The PRD title and scope do not explicitly identify `spec-agent-node-room`; later traceability must determine whether the selected target epics implement this provider slice or a different product increment.

## Epic Coverage Validation

### Epic FR Coverage Extracted

| Epic FR       | Epic requirement summary                   | Claimed implementation path                                                |
| ------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| FR1 / CAP-1   | Scannable single-line tool-call rows       | Story 1.1                                                                  |
| FR2 / CAP-2   | Family-shaped expanded tool bodies         | Story 1.2                                                                  |
| FR3 / CAP-3   | Folded todo state and pinned todo strip    | Story 1.4                                                                  |
| FR4 / CAP-4   | Subagent dispatch cards                    | Story 1.5                                                                  |
| FR5 / CAP-5   | Inline file-edit diff                      | Story 1.3                                                                  |
| FR6 / CAP-6   | Occurrence grouping and iteration selector | Story 1.6                                                                  |
| FR7 / CAP-7   | Raw JSON escape hatch                      | Story 1.1                                                                  |
| FR8 / CAP-8   | Queue-capable steering composer            | Stories 1.8 and 1.9                                                        |
| FR9 / CAP-9   | Interrupt without failing the node         | Stories 1.7a, 1.7b, and 1.10                                               |
| FR10 / CAP-10 | Send-now continuation after interrupt      | Stories 1.7b and 1.10                                                      |
| FR11 / CAP-11 | Operator transcript rows                   | Story 1.11                                                                 |
| FR12 / CAP-12 | Provider soft-inject where supported       | Post-v1 gates G2 and G4                                                    |
| FR13 / CAP-13 | `sent` to `delivered` correlation          | Story 1.11 provides the `sent` floor; post-v1 gate G1 provides `delivered` |

**Total FRs in the epics document: 13**

### Coverage Matrix

| PRD FR | PRD requirement                                                                           | Epic coverage                                                              | Status     |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------- |
| FR-7   | Create, update, inspect, rotate, disable, and diagnose generic Workflow Provider Bindings | **NOT FOUND**; epic FR7 is the unrelated Raw toggle requirement            | ❌ Missing |
| FR-8   | Expose start, status, approve, reject, resume, retry, and cancel through CLI JSON         | **NOT FOUND**; epic FR8 is the unrelated steering-composer requirement     | ❌ Missing |
| FR-9   | Produce signed, typed workflow events through a non-blocking outbox                       | **NOT FOUND**; epic FR9 is the unrelated live-interrupt requirement        | ❌ Missing |
| FR-10  | Report workflow-event delivery and outbox health as structured status                     | **NOT FOUND**; epic FR10 is the unrelated send-after-interrupt requirement | ❌ Missing |

### Scope Reconciliation

The PRD states under `Functional Requirements Owned By Archon`, FR-7: “Archon can create, update, inspect, rotate, disable, and diagnose provider-side Workflow Provider Binding records.”
This is a normative functional requirement for the Workflow Commander provider slice.

The epics document states under `Requirements Inventory`, FR7: “Every card exposes a Raw toggle revealing the original JSON.”
This is a normative functional requirement for the Agent Node Room transcript.

The PRD states under `Functional Requirements Owned By Archon`, FR-8: “Archon exposes start, status, approve, reject, resume, retry, and cancel for workflow runs through CLI JSON.”
This is a normative functional requirement for the Workflow Commander provider slice.

The epics document states under `Requirements Inventory`, FR8: “Composer mounted + enabled while the node runs; send reads `Queue`.”
This is a normative functional requirement for Agent Node Room live steering.

The PRD states under `Functional Requirements Owned By Archon`, FR-9: “Archon emits signed typed workflow events for workflow start, workflow completion, workflow failure, approval requested, delivery failed, and artifact events through a non-blocking outbox.”
This is a normative functional requirement for the Workflow Commander provider slice.

The epics document states under `Requirements Inventory`, FR9: “An interrupt control ends the agent's current turn.”
This is a normative functional requirement for Agent Node Room live steering.

The PRD states under `Functional Requirements Owned By Archon`, FR-10: “Archon reports workflow event delivery and outbox health as structured status.”
This is a normative functional requirement for the Workflow Commander provider slice.

The epics document states under `Requirements Inventory`, FR10: “When `idle-after-interrupt`, send reads `Send now`.”
This is a normative functional requirement for Agent Node Room live steering.

One implementation can satisfy both sets, so the claims are not mutually exclusive and are not a cross-document conflict.
However, the epics document provides no implementation path for the four selected PRD requirements.
Its frontmatter instead identifies `_bmad-output/specs/spec-agent-node-room/SPEC.md` and companion contracts as its requirements sources.
This evidence disproves a traceability reconciliation between the selected PRD and the selected epics.

### Missing Requirements

#### Critical missing FR-7 coverage

**Requirement:** Archon can create, update, inspect, rotate, disable, and diagnose provider-side Workflow Provider Binding records for a project or codebase using generic `provider` and `name` vocabulary.

**Impact:** The selected epics contain no binding lifecycle, storage, CLI status, or lifecycle-error work.

**Recommendation:** Do not add this unrelated requirement to Agent Node Room Epic 1.
Use the Agent Node Room specification as the requirements baseline for this assessment, or select the Workflow Commander epics that implement PRD FR-7.

#### Critical missing FR-8 coverage

**Requirement:** Archon exposes start, status, approve, reject, resume, retry, and cancel for workflow runs through CLI JSON.

**Impact:** The selected epics contain no Workflow Commander CLI JSON command envelope or complete control surface.

**Recommendation:** Use the target-specific Agent Node Room specification as the baseline, or select the Workflow Commander implementation epics.

#### Critical missing FR-9 coverage

**Requirement:** Archon emits signed typed workflow events for workflow start, workflow completion, workflow failure, approval requested, delivery failed, and artifact events through a non-blocking outbox.

**Impact:** The selected epics contain no signed event envelope, durable outbox, signature-header, or delivery-worker implementation path.

**Recommendation:** Keep this requirement out of Agent Node Room Epic 1 and assess it against its owning Workflow Commander epic set.

#### Critical missing FR-10 coverage

**Requirement:** Archon reports workflow event delivery and outbox health as structured status.

**Impact:** The selected epics contain no event-delivery state model or CLI health-reporting work.

**Recommendation:** Keep this requirement in the Workflow Commander plan and use the Agent Node Room specification for this target assessment.

### Epic Requirements Not Present in the Selected PRD

All 13 Agent Node Room epic FRs are absent from the selected Workflow Commander PRD.
FR7 through FR10 reuse identifiers but have different meanings; identifier equality does not establish coverage.
FR1 through FR6 and FR11 through FR13 have no matching identifiers or requirements in the selected PRD.

### Coverage Statistics

- Total selected PRD FRs: 4
- Selected PRD FRs covered in the target epics: 0
- Missing selected PRD FRs: 4
- Coverage percentage: 0%

## UX Alignment Assessment

### UX Document Status

UX documentation exists and is substantial.
The selected UX baseline consists of `DESIGN.md` for the visual contract and `EXPERIENCE.md` for behavioral flows, state patterns, interaction rules, and accessibility.
Both documents explicitly cover the Readable Agent Transcript and Live Agent Steering halves of Agent Node Room on the Legacy and Console web surfaces.

### UX ↔ PRD Alignment

The selected UX and selected PRD describe different product increments.

The PRD states under `Product Boundary`: “Workflow Commander v1 is headless.”
It also states that the lack of Archon Web screens and new in-product UI is “an explicit product boundary for this handoff.”
These are normative scope constraints for the Workflow Commander provider slice.

The UX `Foundation` states: “Web only.”
It further requires a composer dock pinned to the bottom of both existing node-room panels.
These are normative UX requirements for the Agent Node Room increment.

One Archon implementation can satisfy both claims by keeping Workflow Commander headless while implementing Agent Node Room as a separate web increment.
The claims are therefore not mutually exclusive and are not a product conflict.
However, the selected PRD does not define any of the user journeys, interaction states, accessibility requirements, or transcript presentation requirements in the selected UX documents.
The reconciliation attempt fails for readiness traceability because the documents have different scope owners and success criteria.

### UX ↔ Architecture Alignment

The two architecture spines support the selected UX comprehensively:

| UX requirement area                                                   | Architecture support                                                                              | Status  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------- |
| One readable transcript on Legacy and Console                         | Track A AD-1 defines one render-neutral core and two thin JSX shells                              | Aligned |
| Console import isolation                                              | Track A AD-2 binds the shared `packages/web/src/lib/` boundary and lint rule                      | Aligned |
| Historical-run compatibility                                          | Track A scope and AD-9 require no schema, migration, backend, or runtime switch                   | Aligned |
| Safe presentation of malformed historical rows                        | Track A AD-3 requires a total, terminating projection core with generic degradation               | Aligned |
| Bounded inline diffs                                                  | Track A AD-4 and AD-5 define one bounded, memoized diff path                                      | Aligned |
| Todo state, occurrence grouping, pinned strip, and iteration selector | Track A AD-7 and AD-12 define shared data and identical shell behavior                            | Aligned |
| Color-independent status, accessible names, and live announcements    | Track A AD-10 through AD-14 centralize visible and announced strings, glyphs, and badges          | Aligned |
| Node remains running during steering                                  | Steering AD-1, AD-2, and AD-4 separate per-turn interruption from Cancel                          | Aligned |
| Queue, interrupt, Send-now continuation, and race behavior            | Steering AD-3, AD-4, and AD-11 define the live registry, distinct drain rules, and refusal cases  | Aligned |
| In-process-only limitation and detached-run disclosure                | Steering AD-5 defines the same boundary and safe refusal                                          | Aligned |
| Operator transcript record and authorship                             | Steering AD-6, AD-10, and AD-12 define executor-only writes and read-time display-name projection | Aligned |
| `sent` floor and gated `delivered` state                              | Steering AD-8 matches the current SDK pin and post-bump behavior                                  | Aligned |
| Shared dock state on both surfaces                                    | Steering AD-9 projects exactly `generating` and `idle-after-interrupt`                            | Aligned |
| Thirty-minute inactivity protection and composing keepalive           | Steering AD-4 defines the timer, re-arm input, Cancel polling, and exact terminal behavior        | Aligned |

No architecture gap was found for responsiveness, state projection, message ordering, accessibility data, provider continuity, or rollback.

### Alignment Issues

#### UX-1: Tool-row target size has mutually exclusive normative rules

`DESIGN.md`, under `Open Questions` → `Resolved during finalize`, states: “The Raw toggle and the interactive tool row both clear SC 2.5.8 at `min-height: 24px`.”
This is a normative accessibility requirement backed by an owner decision dated 2026-09-15.

`EXPERIENCE.md`, under `Accessibility Floor`, states: “The Raw toggle meets the 24×24 minimum of SC 2.5.8 and the tool row falls 2px short by a recorded decision.”
This is also written as a normative accessibility requirement.

The same interactive row cannot both meet 24 px and remain 2 px short.
No single implementation satisfies both claims.
The dated owner resolution in `DESIGN.md` establishes the intended result: the row must reach 24 px through padding.

**Required correction:** Update the stale `EXPERIENCE.md` target-size sentence before implementation so tests and reviewers enforce the 24 px owner decision consistently.

### Warnings

- The selected PRD is not the requirements source for the selected UX, architecture, or epics.
- The selected UX documents identify target-specific specs under `_bmad-output/specs/spec-agent-node-room/` and the readable-transcript companion spec as their sources.
- Continuing implementation from the current mixed document set would leave all Agent Node Room UX requirements outside PRD traceability even though the target architecture supports them.
- The UX documents otherwise contain resolved flows, accessibility rules, provider limitations, state behavior, and failure treatments with no open product questions.

## Epic Quality Review

### Epic Structure

Epic 1 delivers a coherent user outcome: operators can read and steer an agent from either node-room surface.
The epic is not a technical milestone, and there is no cross-epic dependency because the plan contains one epic.
The read half provides useful standalone value before steering ships.
The steering half reaches its first complete operator-visible outcome in Story 1.10.

### Dependency Map

| Story | Declared or necessary prerequisites                                                  | Dependency result                                                                |
| ----- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 1.1   | Existing transcript data and both shells                                             | Starts independently, except for the operator-metadata ownership ambiguity below |
| 1.2   | 1.1                                                                                  | Valid backward dependency                                                        |
| 1.3   | 1.1                                                                                  | Valid backward dependency                                                        |
| 1.4   | 1.1                                                                                  | Valid backward dependency, but behavior contract is contradictory                |
| 1.5   | 1.1                                                                                  | Valid backward dependency                                                        |
| 1.6   | 1.1 as declared; live registry queue and dock behavior also required by its final AC | **Hidden forward dependency on 1.7a, 1.8, and 1.9**                              |
| 1.7a  | Existing provider and executor seams                                                 | Starts independently as a technical enabler                                      |
| 1.7b  | 1.7a                                                                                 | Valid backward dependency                                                        |
| 1.8   | 1.7a and 1.7b                                                                        | Valid backward dependency                                                        |
| 1.9   | 1.7b and 1.8                                                                         | Valid backward dependency                                                        |
| 1.10  | 1.1, 1.7b, 1.8, and 1.9                                                              | Valid backward dependencies                                                      |
| 1.11  | 1.1, 1.7b, and 1.8                                                                   | Valid backward dependencies                                                      |
| 1.12a | 1.8 and 1.11                                                                         | Valid backward dependencies                                                      |
| 1.12b | 1.7b, 1.8, 1.9, and 1.10                                                             | Valid backward dependencies                                                      |
| 1.12c | 1.8 and 1.11                                                                         | Valid backward dependencies                                                      |

### 🔴 Critical Violations

#### EQ-1: Selected PRD traceability is absent

The epic traces 13 Agent Node Room FRs, but none of the four selected PRD FRs.
The reused identifiers FR7 through FR10 have different normative meanings.
This is a baseline-selection failure rather than an implementation omission inside Agent Node Room.

**Remediation:** Replace the Workflow Commander PRD input with `_bmad-output/specs/spec-agent-node-room/SPEC.md` and its cited companion contracts, then rerun requirement extraction and traceability.

#### EQ-2: Story 1.6 has a hidden forward dependency

Story 1.6 is placed in the read half and declares only Story 1.1 as a dependency.
Its final acceptance criterion requires a finished iteration to display a read-only band that mirrors “the node's registry queue” and offers a `Go to iteration N` control.
The registry is created in Story 1.7a, its queue transport and resolution behavior are created in Story 1.8, and the dock is created in Story 1.9.
Story 1.6 cannot meet this criterion when implemented in sequence.

**Remediation:** Keep occurrence grouping and the iteration selector in Story 1.6, but move the finished-iteration live-queue dock criterion to Story 1.9 or a later steering story.
Alternatively, reorder Story 1.6 after the registry and dock stories, but that would break the stated read-first sequence.

#### EQ-3: Todo rendering has mutually exclusive normative contracts

The epic `Requirements Inventory`, FR3, requires the folded todo state to render “once, anchored at the last todo call” and also in a pinned strip.
`EXPERIENCE.md`, `Component Patterns` → `Checklist`, likewise places the folded state on the “last todo call in the node” and says it is rendered once.
These are normative requirements for an inline final-call checklist plus a pinned mirror.

Story 1.4 instead requires “every todo call” to collapse and says the checklist “lives only in the pinned strip.”
Track A Architecture AD-12 also requires every todo call to collapse and the current checklist to render only in the pinned strip.
These are normative requirements for pinned-only checklist rendering.

Rendering both inline and pinned satisfies FR3 and `EXPERIENCE.md` but violates the Story 1.4 and AD-12 word “only.”
Rendering pinned-only satisfies Story 1.4 and AD-12 but violates FR3 and `EXPERIENCE.md`.
No single implementation satisfies both contracts.

**Remediation:** Choose one behavior and update the requirements inventory, UX behavior, architecture AD-12, and Story 1.4 together before implementation.

### 🟠 Major Issues

#### EQ-4: Three steering stories are technical enablers without independent user value

Stories 1.7a, 1.7b, and 1.8 build the registry, provider interrupt contract, multi-turn executor loop, state projection, and HTTP routes.
The epics document explicitly says these stories are not shippable user outcomes and that the first operator-visible steering outcome arrives in Story 1.10.

**Original decision:** The owner ratified a hybrid structure on 2026-09-15 so these engine and transport units remain separately tracked and independently testable.

**Audit concern:** The structure violates the create-epics-and-stories rule that a story must deliver meaningful value and be independently completable.

**Trade-off:** Separate tracking improves sizing and technical verification, while outcome-oriented stories avoid a sequence of completed work that users cannot use.

**Options:**

1. Keep Story 1.10 as the user story and represent 1.7a, 1.7b, and 1.8 as implementation tasks beneath it.
2. Keep the ratified hybrid as an explicit process exception and do not claim strict story-independence compliance.

#### EQ-5: Stories 1.7a and 1.7b are oversized

Story 1.7a spans the workflow executor, an in-process registry, two executor paths, and interrupt conformance for five providers.
Story 1.7b spans end-cause classification, multi-turn session reuse, idle-await behavior, interrupted-row writing, server state projection, and both executor paths.
Each has several independently risky integration seams and a large rollback surface.

**Remediation:** If the hybrid structure remains, split each into bounded implementation tasks under the single Story 1.10 outcome rather than promoting more technical units to user stories.

#### EQ-6: Story 1.1 and Story 1.11 have unclear ownership of the operator-row contract

Story 1.1 requires the reader to recognize `metadata.origin === 'operator'` before Story 1.11 ships.
Story 1.11 owns the three additive metadata fields, the read-time display-name projection, and generated API types.
The plan does not state how Story 1.1 compiles against and tests a strict metadata shape that Story 1.11 does not add until later.

This is not proven to be an impossible dependency because the reader could validate an unknown metadata record structurally.
It is still an implementation ambiguity that can cause Story 1.1 either to broaden backend contracts early or to use an untyped escape hatch that violates strict TypeScript expectations.

**Remediation:** Assign the additive metadata schema and generated read type to Story 1.1 as the reader prerequisite, or specify the validated structural seam Story 1.1 uses without changing the wire schema.

#### EQ-7: Legacy send-control styling contradicts the final UX decision

The epic `UX-DR8` requires: “Console send control is bordered, Legacy is the filled shadcn `Button`.”
This is a normative surface-delta requirement.

`DESIGN.md`, `Send control`, requires the control to be “bordered on both shells” and records that the filled Legacy option was reversed because its 11.5 px label measured 3.06:1 contrast.
This is a normative, owner-resolved accessibility requirement.

One Legacy control cannot be both filled and bordered.
The dated UX resolution disproves reconciliation and establishes bordered-on-both as the intended behavior.

**Remediation:** Update UX-DR8 and any mock reference in the epic to require the bordered control on both shells.

#### EQ-8: Epic completion and CAP-12/CAP-13 coverage use different boundaries

The epic title and list claim CAP-1 through CAP-13.
The completion gate ends at interrupt + `Queue` + `sent`, while G1 through G4 remain post-v1 work under the same epic.
The coverage map therefore counts FR12 and FR13 even though their complete behavior is outside the epic completion gate.

**Original decision:** The owner selected one epic rather than splitting read and steering work, and kept post-v1 gates beneath it.

**Audit concern:** The epic can be marked complete while named capability work under that same epic remains unfinished.

**Trade-off:** One epic preserves product cohesion, while a strict completion boundary makes status and traceability unambiguous.

**Options:**

1. Keep one epic, but state that v1 covers a defined subset of CAP-12 and CAP-13 and exclude G1 through G4 from v1 coverage statistics.
2. Keep G1 through G4 under Epic 1 and do not mark the epic complete until their external gates clear.

#### EQ-9: Core totality is not locked by story acceptance criteria

Track A Architecture AD-3 requires the presentation core never to throw and always to terminate on malformed historical rows.
Story 1.2 covers an unknown family, and Story 1.3 covers pathological diff inputs, but no story criterion verifies malformed stored payloads across presenter, todo, and task normalization paths.
This omission risks a historical row crashing the full web application despite the architecture's primary safety invariant.

**Remediation:** Add one table-driven acceptance criterion to the owning read-half stories that proves malformed payloads degrade without throwing and bounded algorithms terminate.

### 🟡 Minor Concerns

#### EQ-10: Story 1.12c has minimal acceptance coverage

The concurrent-operator story contains one happy-path criterion for receipt ordering and attribution.
Authorization, duplicate message IDs, and terminal races are covered in Story 1.8, but Story 1.12c does not explicitly verify deterministic attribution when two operators send concurrently.

**Remediation:** Add one integration criterion with two authenticated identities and assert receipt order plus the correct `operator_user_id` on each transcript row.

#### EQ-11: UX target-size text is stale

The mutually exclusive 24 px tool-row statements documented as UX-1 must be reconciled before story tests are written.
The owner-resolved rule is 24 px through padding.

### Acceptance-Criteria Quality

Most stories use specific Given/When/Then criteria, name error outcomes, and identify testable state transitions.
Stories 1.8, 1.10, 1.11, and 1.12b have strong failure and race coverage.
Stories 1.3 and 1.7a define concrete verification gates rather than subjective completion language.
The defects above concern contradictory source contracts, hidden dependencies, technical-story structure, and a small number of missing safety criteria rather than general BDD quality.

### Database and Brownfield Checks

- No new database table or migration is proposed for steering state.
- Operator metadata uses the existing JSON column and is introduced where operator rows first need it.
- The display name is a read-time projection rather than denormalized storage.
- This is a brownfield change with explicit integration points in existing shells, executor paths, providers, routes, generated API types, and tests.
- No starter-template or initial CI setup story is applicable.

### Best-Practices Compliance Summary

| Check                                   | Result                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Epic delivers user value                | Pass                                                                    |
| Epic independence                       | Pass; only one epic                                                     |
| Stories appropriately sized             | Fail for 1.7a and 1.7b                                                  |
| No forward dependencies                 | Fail for Story 1.6                                                      |
| Database changes occur only when needed | Pass, subject to Story 1.1/1.11 ownership clarification                 |
| Clear acceptance criteria               | Mostly pass; gaps in EQ-9 and EQ-10                                     |
| Traceability to selected PRD            | Fail, 0%                                                                |
| Internal requirement consistency        | Fail for todo rendering, send-control styling, and tool-row target size |

## Summary and Recommendations

### Overall Readiness Status

**NOT READY**

Implementation should not start from this artifact set.
The target-specific epics, UX, and architecture are detailed, but the selected PRD belongs to Workflow Commander rather than Agent Node Room.
The story sequence also contains one proven forward dependency and one unresolved, mutually exclusive core behavior.

### Critical Issues Requiring Immediate Action

1. **Wrong requirements baseline:** The selected PRD provides 0% traceability to the Agent Node Room epics.
2. **Forward dependency:** Story 1.6 requires registry, queue, and dock behavior that Stories 1.7a, 1.8, and 1.9 introduce later.
3. **Contradictory todo behavior:** The plan requires both an inline final-call checklist plus a pinned mirror and a pinned-only checklist.

### Major Issues Requiring Resolution

1. Decide whether Stories 1.7a, 1.7b, and 1.8 remain an explicit exception to user-value story standards or become tasks under the Story 1.10 outcome.
2. Reduce the execution scope of Stories 1.7a and 1.7b through bounded tasks and verification gates.
3. Assign the operator metadata and generated-type prerequisite clearly between Stories 1.1 and 1.11.
4. Correct epic UX-DR8 to the owner-resolved bordered send control on both surfaces.
5. Make the Epic 1 completion boundary and CAP-12/CAP-13 coverage use the same v1 scope.
6. Add acceptance coverage for malformed historical payload degradation and bounded termination.

### Recommended Next Steps

1. Replace `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md` with `_bmad-output/specs/spec-agent-node-room/SPEC.md` and its companion contracts as the requirements baseline, then rerun FR and NFR extraction.
2. Choose the todo rendering rule and update FR3, `EXPERIENCE.md`, Track A AD-12, and Story 1.4 in one coordinated edit.
3. Move the finished-iteration live-queue dock criterion out of Story 1.6 and into Story 1.9 or a later steering story.
4. Update epic UX-DR8 and the stale `EXPERIENCE.md` target-size sentence to match the final accessibility decisions.
5. Resolve the hybrid-story and post-v1 completion decisions without undoing the owner's one-epic choice.
6. Clarify Story 1.1/1.11 metadata ownership and add the missing malformed-payload and concurrent-operator integration criteria.
7. Rerun this readiness assessment against the corrected artifact set before implementation begins.

### Issue Summary

- Critical violations: 3
- Major issues: 6
- Minor concerns: 2
- Total unique issues requiring attention: 11
- Categories affected: requirements baseline and traceability; UX and architecture consistency; story sequencing and sizing; acceptance and verification coverage

### Unresolved Questions

1. Should todo state render both inline at the final todo call and in the pinned strip, or only in the pinned strip?
2. Should technical units 1.7a, 1.7b, and 1.8 remain stories as an explicit process exception, or become tasks under the Story 1.10 operator outcome?
3. Does Epic 1 complete at the v1 floor, excluding G1 through G4 from its coverage, or remain open until those gated items finish?
4. Does Story 1.1 own the additive operator metadata read contract, or must it use a validated structural seam until Story 1.11 adds the wire fields?

### Final Note

The assessment identified 11 unique issues across four categories.
The architecture is strong and covers the intended UX, so remediation is primarily document alignment, dependency repair, and scope clarification.
Resolve the three critical issues before implementation.

**Assessment date:** 2026-09-16

**Assessor:** BMAD Implementation Readiness workflow
