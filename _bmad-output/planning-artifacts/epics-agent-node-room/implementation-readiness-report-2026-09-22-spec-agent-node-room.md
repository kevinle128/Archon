---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
inputDocuments:
  - ../../specs/spec-agent-node-room/SPEC.md
  - ../../specs/spec-agent-node-room/tool-presentation-contract.md
  - ../../specs/spec-agent-node-room/todo-fold-contract.md
  - ../../specs/spec-agent-node-room/test-plan.md
  - ../../specs/spec-agent-node-room/engine-integration.md
  - ../../specs/spec-agent-node-room/provider-steering-matrix.md
  - ../../specs/spec-agent-node-room/control-states.md
  - ../../specs/spec-agent-node-room/steering-api-contract.md
  - ../../specs/spec-agent-node-room/steering-test-plan.md
  - ../ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - ../ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - ../architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - ../architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - epics.md
  - ../mockup-manifests/agent-node-room.json
target: agent-node-room
manifestFingerprint: 0dd094cda1c3ef6ad52bc6b53531f2cfb5512b4804813bf1a85e516e73623101
overallStatus: READY
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-22
**Project:** Archon
**Target:** `agent-node-room`

## Document Discovery

The selected source set follows the `spec-agent-node-room` lineage declared by the target Epic frontmatter.
No whole-versus-sharded duplicate exists inside that lineage.
The two UX documents are complementary experience and design authorities.
The two Architecture spines are complementary readable-transcript and live-steering authorities.
The existing dated readiness report was replaced from the template and was not used as assessment evidence.
Epics 1–9 are completed comparison history.
Epic 10 and Stories 10.1–10.4 own the current implementation scope.

### Authoritative Inputs

| Type                     | Selected source                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRD package              | `../../specs/spec-agent-node-room/SPEC.md` plus its eight declared contract and test-plan supplements                                                                                        |
| UX                       | `../ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md`; `../ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`                                                           |
| Architecture             | `../architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`; `../architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` |
| Epics and Stories        | `epics.md`, with Epic 10 as current scope and Epics 1–9 as completed history                                                                                                                 |
| Approved mockup baseline | `../mockup-manifests/agent-node-room.json` with source fingerprint `0dd094cda1c3ef6ad52bc6b53531f2cfb5512b4804813bf1a85e516e73623101`                                                        |

### Discovery Result

All required document classes are present.
No source-selection blocker remains.

## PRD Analysis

The canonical PRD is `SPEC.md` with its eight declared contract and test-plan supplements.
The PRD states that all approved steering behavior is current product scope.
It records no unresolved product-scope question.

### Functional Requirements

**FR1 / CAP-1 — Scannable tool rows.**
Render each tool call as one single-line row with a family chip, status glyph, salient headline, and right-aligned badges.
Collapse successful calls, expand failed calls, and exclude serialized-data punctuation from collapsed rows.

**FR2 / CAP-2 — Family-specific expanded bodies.**
Render every supported tool family through its declared body arm.
Limit generic fallback to three scalar fields, never show a JSON dump by default, and keep generic fallback below 2% of logical production tool cards.

**FR3 / CAP-3 — Folded todo state.**
Normalize provider todo payloads to `TodoPhase[]`.
Keep earlier mutations as compact rows, let the latest applicable row show the folded checklist, place the collapsible strip below the transcript scroller, remove empty phases, and omit the strip when no todo state exists.

**FR4 / CAP-4 — Subagent dispatch presentation.**
Normalize provider task payloads to `TaskSubtask[]` and render batch context plus one collapsible card for each subtask.

**FR5 / CAP-5 — Inline file changes.**
Render a bounded line diff only when both before and after strings exist.
Otherwise render path plus preview, persist successful Codex file changes before presentation, and never fabricate a diff from one side.

**FR6 / CAP-6 — Occurrence and execution navigation.**
Group multi-occurrence rows by `occurrence_id`, never by `attempt_id`.
For loop nodes, select the live execution by default, expose no more than eight executions, project a selected execution immediately, and keep stale executions read-only.

**FR7 / CAP-7 — Raw payload access.**
Give every tool card an independent Raw toggle that is closed by default and reveals the original JSON.
Raw is the only place where serialized tool JSON appears.

**FR8 / CAP-8 — Durable composition and queueing.**
Keep the composer active while a node runs and make `Queue` persist guidance without interrupting the active turn.
Persist author drafts and the node queue on the server, share queued guidance with authorized viewers, preserve it across restart, reconcile every unmatched durable message to read-only `Never sent` at terminal state, and omit a clean terminal dock.

**FR9 / CAP-9 — Stop the current turn only.**
Use the per-turn `interruptSignal` to end the active provider turn while the node, run, completed side effects, and reusable provider session remain active.
Enter idle-after-interrupt, apply the 30-minute live-process inactivity rule, preserve durable queue content on expiry, and never render the interrupted warning glyph for a Codex tool row.

**FR10 / CAP-10 — Redirect on the same live session.**
In idle-after-interrupt, make `Send now` persist the new message and claim eligible durable queue entries in server FIFO order for the next turn on the same provider session.
Do not enter workflow pause or resume state.

**FR11 / CAP-11 — Ordered operator records.**
Render operator messages and supported interrupted tool outcomes as ordinary, distinct transcript rows in happened order with sender attribution.

**FR12 / CAP-12 — Verified per-item soft injection.**
Keep queue-at-boundary behavior for every provider.
For a provider with verified active-turn injection, expose per-item `Send now`, atomically target exactly one selected queued message and the current turn, keep the turn running without Stop or a steering-owned turn-start event, and leave every non-selected item unchanged.

**FR13 / CAP-13 — Truthful delivery status.**
Keep a message at `sent` or `delivery unknown` until verified provider acknowledgement for its stamped identity proves `delivered`.
Do not infer delivery from content, time, or transcript proximity.

**FR14 / CAP-14 — Restart recovery.**
Restore saved drafts, queue order, delivery state, and auto-send state after server restart without claiming that the old provider process survived or resuming automatically.
Require the existing Resume action.

**FR15 / CAP-15 — Durable auto-send.**
After each natural reply, auto-send at most one eligible FIFO item when the durable setting is enabled.
Never auto-send after an interrupted turn, return a failed delivery to the queue with an accessible error, and keep the queue unchanged when disabled.
When the effective projected state is on, show one read-only `Auto-send on` indicator that has no control, dispatch, or setting mutation.

**FR16 / CAP-16 — Cross-surface readable-tool parity.**
Use the same tool family, headline, outcome, badges, body, fallback, and Raw semantics in Node Room, RunStream, Chat, and backend-generated cards while preserving package boundaries.

**FR17 / CAP-17 — Source-control impact.**
Show run-level changed files and node-execution attribution from repository evidence.
Label unknown attribution and never infer it from agent prose.

**FR18 / CAP-18 — Approved provider coverage.**
Support truthful queue, Stop, redirect, and continuation behavior across Claude, Codex, Grok, DeepSeek, OMP, Qoder CLI, Pi, GitHub Copilot, and OpenCode.
Advertise optional injection or acknowledgement only after executable conformance proves it.

**FR19 / CAP-19 — Safe thinking presentation.**
Persist and present only explicitly displayable provider thinking with typed normalization, ordering, privacy, truncation, and Raw behavior.

**FR20 / CAP-20 — Triggering prompt provenance.**
Persist and present the prompt that triggered the selected node occurrence with source and actor attribution under the approved sensitive-data rules.

**FR21 / CAP-21 — Advisor notifications.**
Persist and present advisor notifications with an explicit type, deterministic order, advisor identity, and accessible treatment among tool, assistant, and operator rows.

**Total functional requirements: 21.**

### Non-Functional Requirements

**NFR1 — Type and lint quality.**
Use strict TypeScript, no unjustified `any`, zero ESLint warnings, and `bun run validate` as the pre-PR gate.

**NFR2 — Package boundaries.**
Web must not import from Workflows, Console must not import production component modules, wire types must come through generated API types, and shared logic must stay render-neutral.

**NFR3 — Two-shell parity.**
Legacy and Console must ship together and implement the same behavior with thin shell-specific JSX.

**NFR4 — Accessibility.**
Status must be understandable without color.
Controls, focus, live regions, errors, reduced motion, keyboard access, and timing disclosure must meet the approved WCAG 2.2 AA behavior on both shells.

**NFR5 — Deterministic bounded presentation.**
Expanded content, lists, fields, paths, diff inputs, diff lines, and caches must honor the declared deterministic limits and show every truncation.

**NFR6 — Data integrity.**
Queue acknowledgement follows database commit, ordering is assigned by the server, withdrawal and duplicate identities are idempotent, and every rejected request leaves queue, transcript, and execution state unchanged.

**NFR7 — Recovery safety.**
Process loss must not cause automatic resend, lifecycle mutation, timeout recreation, or unsupported session claims.

**NFR8 — Authentication and attribution.**
All steering routes must resolve identity, use the ratified steering actor grant, attribute mutations, and return typed authorization errors.

**NFR9 — Privacy and logging.**
Reads must not mutate state or log message content, hidden provider reasoning must remain hidden, and sensitive transcript sources must follow explicit privacy rules.

**NFR10 — Typed API consistency.**
Every steering route must use registered OpenAPI routes, schema-derived types, the shared structured error shape, and regenerated Web API types.

**NFR11 — Database portability and upgrades.**
Durable steering storage must pass fresh-install, additive upgrade, reapply, parity, SQLite, and PostgreSQL checks.

**NFR12 — Deterministic tests.**
Provider and timer tests must use deterministic fixtures and injected schedulers, and the normal suite must not depend on live network access or production waits.

**NFR13 — Restart E2E hygiene.**
Restart tests must preserve the database across a real server restart and stop every process they start.

**NFR14 — Honest capability projection.**
The UI must derive controls from typed projected state and proven capability data, never from provider names or a flickering stream signal.

**NFR15 — Transcript ordering.**
The executor is the only writer of delivered operator rows and must preserve deterministic server order without phantom turn-start events.

**NFR16 — Historical compatibility.**
Existing persisted rows must gain readable presentation without migration, while new source data uses additive typed storage.

**NFR17 — Performance.**
The summary path must not normalize full output, the expanded path must be lazy, diff work must be bounded and memoized, and hostile values must not force unbounded work.

**Total non-functional requirements: 17.**

### Additional Requirements and Constraints

- Epics 1–9 are completed history and baseline comparison evidence.
- Epic 10 is the only current implementation Epic.
- Every visible approved mockup behavior is current product scope.
- The current change boundary consists of M001, M002, M005, M007, M008, M009, M010, and M013.
- The other 24 manifest groups are current unchanged context and must not be restated as new Epic 10 work.
- The `Auto-send on` wording is a read-only projected-state indicator and is not a control.
- Underlying durable auto-send behavior remains unchanged.
- Stop does not change the historical Cancel feature, cancel one tool, or add CLI-detach behavior.
- Provider verification, SDK updates, schema work, API regeneration, and conformance evidence are implementation work, not scope gates.

### PRD Completeness Assessment

The PRD package is complete enough for traceability analysis.
It defines all eight current change features, all relevant baseline behavior, provider boundaries, persistence rules, API contracts, error states, races, tests, and explicit exclusions.
No PRD-level scope blocker remains.

## Epic Coverage Validation

The complete Epic file was read.
The early 13-item coverage map is a completed-history snapshot and is not the current coverage authority.
The approved course corrections and the direct capability references in Epics 3–10 provide the current traceability.

### Functional-Requirement Coverage Matrix

| FR / CAP      | Requirement                                          | Epic and Story coverage                       | Status  |
| ------------- | ---------------------------------------------------- | --------------------------------------------- | ------- |
| FR1 / CAP-1   | Scannable tool rows                                  | Stories 1.1, 3.3, 4.2–4.4                     | COVERED |
| FR2 / CAP-2   | Family-specific expanded bodies                      | Stories 1.3, 4.2–4.4                          | COVERED |
| FR3 / CAP-3   | Folded todo state                                    | Stories 1.5 and 3.2                           | COVERED |
| FR4 / CAP-4   | Subagent dispatch presentation                       | Stories 1.6 and 3.3                           | COVERED |
| FR5 / CAP-5   | Inline file changes and Codex persistence            | Stories 1.4 and 4.1                           | COVERED |
| FR6 / CAP-6   | Occurrence and bounded execution navigation          | Stories 1.7 and 10.1                          | COVERED |
| FR7 / CAP-7   | Raw payload access                                   | Stories 1.2 and 3.3                           | COVERED |
| FR8 / CAP-8   | Durable composer, queue, and terminal reconciliation | Stories 2.1, 2.2, 2.9–2.11, 7.1–7.4, and 10.3 | COVERED |
| FR9 / CAP-9   | Stop the current turn only                           | Stories 2.3–2.7, 8.1–8.7, 10.3, and 10.4      | COVERED |
| FR10 / CAP-10 | Same-session redirect                                | Stories 2.3–2.7 and 8.1–8.7                   | COVERED |
| FR11 / CAP-11 | Ordered operator records                             | Stories 2.8, 2.11, and 2.13                   | COVERED |
| FR12 / CAP-12 | Verified per-item soft injection                     | Stories 8.3, 8.5, 8.7, 8.8, and 10.2          | COVERED |
| FR13 / CAP-13 | Truthful delivery status                             | Stories 8.3 and 8.8                           | COVERED |
| FR14 / CAP-14 | Restart recovery                                     | Story 7.4                                     | COVERED |
| FR15 / CAP-15 | Durable auto-send and projected indicator            | Stories 7.5 and 10.2                          | COVERED |
| FR16 / CAP-16 | Cross-surface readable-tool parity                   | Stories 4.1–4.4                               | COVERED |
| FR17 / CAP-17 | Source-control impact                                | Stories 5.1 and 5.2                           | COVERED |
| FR18 / CAP-18 | Approved provider coverage                           | Stories 8.1–8.8, 9.1–9.4, and 10.4            | COVERED |
| FR19 / CAP-19 | Safe thinking presentation                           | Story 6.1                                     | COVERED |
| FR20 / CAP-20 | Triggering prompt provenance                         | Story 6.2                                     | COVERED |
| FR21 / CAP-21 | Advisor notifications                                | Story 6.3                                     | COVERED |

### Current Change-Feature Ownership

| Manifest feature                                                  | Current owner | Coverage result |
| ----------------------------------------------------------------- | ------------- | --------------- |
| M001 — Console fixed 520-pixel room                               | Story 10.1    | COVERED         |
| M002 — Legacy fixed 460-pixel room                                | Story 10.1    | COVERED         |
| M005 — Live-default execution selector with at most eight entries | Story 10.1    | COVERED         |
| M007 — Read-only projected `Auto-send on` indicator               | Story 10.2    | COVERED         |
| M008 — Per-item active-turn `Send now` without Stop               | Story 10.2    | COVERED         |
| M009 — Durable terminal `Never sent` reconciliation               | Story 10.3    | COVERED         |
| M010 — Idle-timeout failure that preserves durable queue content  | Story 10.3    | COVERED         |
| M013 — Codex-supported tool status presentation                   | Story 10.4    | COVERED         |

### Missing Requirements

No functional requirement is missing from the Epic and Story set.
No current manifest change feature is assigned to Epics 1–9 as current work.

### Coverage Statistics

- Total PRD functional requirements: 21.
- Functional requirements covered: 21.
- Functional requirement coverage: 100%.
- Current manifest change features: 8.
- Current change features owned by Epic 10: 8.
- Current change-feature ownership: 100%.

## UX Alignment Assessment

### UX Document Status

`DESIGN.md` and `EXPERIENCE.md` exist, are final, and were updated on 2026-09-22.
The UX set has no unresolved question.
Both UX documents cover Legacy and Console, the readable transcript, live steering, accessibility, restart recovery, durable queue behavior, and the current mockup deltas.

### Current Change Alignment

| Feature                                                    | PRD alignment                                                                                                                                         | UX alignment                                                                                                            | Architecture alignment                                                                                     | Result  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| M001 — fixed 520-pixel Console room                        | CAP-6 and the fixed-room constraint require the approved Console geometry                                                                             | `DESIGN.md` Layout and Components specify 520 pixels and a sibling dock below the scroller                              | Live-steering AD-12 fixes Console at 520 pixels and preserves vertical siblings                            | MATCHED |
| M002 — fixed 460-pixel Legacy room                         | CAP-6 and the fixed-room constraint require the approved Legacy geometry                                                                              | `DESIGN.md` and `EXPERIENCE.md` use 460 pixels as the Legacy acceptance width                                           | Live-steering AD-12 fixes Legacy at 460 pixels and preserves vertical siblings                             | MATCHED |
| M005 — live-default selector with at most eight executions | CAP-6 defines the precondition, live default, eight-entry limit, immediate projection, and stale read-only state                                      | `EXPERIENCE.md` separates `Execution` filtering from `Jump to` scrolling and keeps stale projections read-only          | Readable-transcript AD-12 and live-steering AD-12 define the same limit and state behavior                 | MATCHED |
| M007 — projected `Auto-send on` indicator                  | CAP-15 defines a read-only projected-state indicator with no dispatch or setting mutation                                                             | `EXPERIENCE.md` Component Patterns and `DESIGN.md` Components use the exact read-only indicator meaning                 | Live-steering AD-9 uses the exact read-only projected-state contract                                       | MATCHED |
| M008 — selected-message active-turn injection              | CAP-12 defines one selected message, immediate active-turn delivery, no Stop, unchanged active tool outcome, and unchanged non-selected queue entries | `EXPERIENCE.md` and `DESIGN.md` expose per-item `Send now` only for verified soft injection                             | Live-steering AD-4, AD-8, and AD-12 define the atomic selected-item claim and capability gate              | MATCHED |
| M009 — durable terminal `Never sent` records               | CAP-8 requires every unmatched durable message to remain readable and terminal controls to be absent                                                  | `EXPERIENCE.md` State Patterns define the read-only terminal box, exact status, focus behavior, and clean omission      | Live-steering AD-5 requires durable reconciliation and a read-only terminal room                           | MATCHED |
| M010 — idle-timeout failure with preserved content         | CAP-9 defines the live-process timer, re-arm behavior, failure, preserved content, and restart exception                                              | `EXPERIENCE.md` and its accessibility floor define the 30-minute status, error copy, re-arm, and read-only result       | Live-steering AD-6 defines the same timer, failure, preservation, and recovery boundary                    | MATCHED |
| M013 — Codex-supported tool status                         | CAP-9 requires turn-level interruption but forbids the unsupported Codex warning glyph                                                                | `EXPERIENCE.md` State Patterns states that Codex never renders `⚠`; `DESIGN.md` records the supported Codex outcome set | Readable-transcript AD-13 and live-steering AD-1 separate turn classification from tool-row glyph evidence | MATCHED |

### UX and Architecture Support

- The shared semantic core and two markup shells support equal behavior without violating Console isolation.
- Sibling transcript, todo, queue, and composer regions prevent the dock from covering the last row.
- Durable and volatile planes support restart recovery without unsafe lifecycle mutation.
- Typed projected state and provider capability data support the exact control visibility and action identities.
- The accessibility contract supports focus, keyboard input, target size, contrast, status announcement, reduced motion, and color-independent meaning.
- Deterministic bounds and lazy presentation support the approved transcript density and performance requirements.

### Reconciliation Notes

The `EXPERIENCE.md` responsive table describes the Console 520-pixel value as the approved mockup value, while `DESIGN.md`, the PRD, and Architecture bind it as the acceptance width.
These claims are compatible because one states provenance and the others state the normative target.

`DESIGN.md` notes the currently observed provider path that can produce an interrupted tool outcome.
This is implementation evidence, not a restriction on the provider-neutral contract, which allows the glyph for any provider whose normalized status proves it and explicitly excludes Codex.

### Alignment Issues and Warnings

No normative PRD–UX–Architecture conflict remains.
No UX or architecture blocker remains.

## Epic Quality Review

### Assessment Boundary

Epics 1–9 and their Stories are completed history.
They are dependency and classification evidence, not current implementation work.
Epic 10 is the sole current Epic and owns all eight manifest change features.

### Epic 10 Structure

| Check                        | Evidence                                                                                             | Result |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| User value                   | The Epic outcome is the complete approved Node Room behavior for operators                           | PASS   |
| Independent current delivery | Epic 10 depends only on completed Epics 3, 7, and 8                                                  | PASS   |
| No forward dependencies      | No Story 10.x depends on a later Story or future Epic                                                | PASS   |
| Brownfield integration       | Every Story names existing shells, projections, provider contracts, or durable state that it changes | PASS   |
| Data timing                  | No speculative table or broad setup Story exists; Stories reuse the completed durable store          | PASS   |
| Traceability                 | Every Story cites exact capabilities, Architecture decisions, and manifest IDs                       | PASS   |

### Current Story Quality

| Story                                                          | User value and size                                                     | Acceptance-criteria quality                                                                                                                                                                 | Dependencies                 | Result |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------ |
| 10.1 — Fix room geometry and execution selection               | Delivers one coherent room-projection outcome across both shells        | Covers both widths, vertical order, live default, eight-entry cap, immediate selection, stale read-only state, and single-execution omission                                                | Completed Epic 3 only        | PASS   |
| 10.2 — Deliver one selected queued message without Stop        | Delivers truthful queue state and safe single-item active-turn delivery | Covers the read-only indicator, capability gate, selected identity, cardinality, no-Stop timing, continued generation, message state, unchanged non-selected items, and queue-only omission | Completed Epics 7 and 8 only | PASS   |
| 10.3 — Preserve every unmatched message at terminal boundaries | Delivers one coherent no-loss terminal and timeout outcome              | Covers terminal reconciliation, clean omission, read-only state, 30-minute expiry, timer re-arm, failure copy, preserved content, and restart behavior                                      | Completed Epic 7 only        | PASS   |
| 10.4 — Use a Codex-supported tool status presentation          | Delivers truthful Codex Stop and status meaning                         | Separates turn-level interruption from tool-row glyph evidence and preserves provider-neutral behavior for other providers                                                                  | Completed Story 8.4 only     | PASS   |

### Dependency Analysis

The dependency graph is acyclic.
Every current dependency points backward to completed history.
No current Story waits for a later current Story.
Stories 10.1–10.4 can be implemented and accepted independently because each owns disjoint manifest features and acceptance evidence.

### Quality Findings

There are no critical, major, or minor current-Epic quality violations.
No remediation is required before implementation.

## Immutable Mockup Change Boundary Audit

The manifest contains 122 unique visible inventory items.
The eight `CHANGE_FEATURE` records map 16 inventory items.
The 24 `UNCHANGED_CONTEXT` groups map the other 106 inventory items.
All 122 inventory items are mapped exactly once.
There is no unmapped item, unknown mapped item, or duplicate mapping.
All eight change features have `PROVEN` status, complete field-level evidence, and no open question.
The manifest declares no action-identity group, so the shared-label audit below derives groups without changing manifest behavior.

## Mockup Behavior Evidence Ledger

Every value in this ledger is copied from the validated manifest before planning-document comparison.

### M001 — Fixed 520-pixel Console Room

- Visible presentation: a 520-pixel Console node room with the steering dock below the transcript — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Precondition: a Console workflow node room is open — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Action or trigger: the Console node room renders — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Target identity: the open Console node room — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Target cardinality: one node room — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Timing: with the initial node-room layout — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Effect on active work: none; layout does not change the running node — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Collection mutation: none — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Expected result: the transcript scrolls above a fixed sibling dock and its last row remains visible — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Remaining or next state: the room remains 520 pixels wide until close — `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`.
- Change classification evidence: current implementation uses `packages/web/src/lib/room-split-layout.ts#DEFAULT_RIGHT_PERCENT`; completed HITL history defines the responsive percentage baseline at `epics-workflow-run-view-hitl/epics.md#completed-responsive-split-layout`.

### M002 — Fixed 460-pixel Legacy Room

- Visible presentation: a two-panel Legacy run view with a 460-pixel node room — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Precondition: a Legacy workflow node room is open — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Action or trigger: the Legacy node room renders — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Target identity: the open Legacy node room — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Target cardinality: one node room — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Timing: with the initial node-room layout — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Effect on active work: none; layout does not change the running node — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Collection mutation: none — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Expected result: the right node-room panel is 460 pixels wide — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Remaining or next state: the room remains 460 pixels wide until close — `Legacy Node Room.dc.html#layout=node-room-width-460`.
- Change classification evidence: current implementation uses `packages/web/src/lib/room-split-layout.ts#DEFAULT_RIGHT_PERCENT`; completed HITL history defines the responsive percentage baseline at `epics-workflow-run-view-hitl/epics.md#completed-responsive-split-layout`.

### M005 — Bounded Execution Selector

- Visible presentation: an execution selector with no more than eight entries and the live iteration selected by default — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Precondition: the loop node has more than one execution — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Action or trigger: the user opens the selector and chooses an execution — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Target identity: the selected execution of the current loop node — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Target cardinality: one of at most eight exposed executions — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Timing: immediate room projection after selection — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Effect on active work: none; stale selections are read-only and do not steer the live execution — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Collection mutation: none — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Expected result: the transcript shows the chosen execution and the live iteration is the initial selection — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Remaining or next state: the room displays the selected live or stale execution — `Console Node Room.dc.html#control=iteration-selector-max-8`.
- Change classification evidence: both current selectors expose an unbounded matching list at `WorkflowExecution.tsx#node-execution-options` and `ConsoleNodeRoom.tsx#computed-options`; completed Story 1.7 has navigation but no eight-entry limit.

### M007 — Read-only `Auto-send on` Indicator

- Visible presentation: an `Auto-send on` status label in the queued-draft panel — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Precondition: the queue panel is visible and effective projected auto-send state is on — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Action or trigger: the queue panel renders its current projected state — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Target identity: the queue-panel auto-send status label — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Target cardinality: one indicator — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Timing: with the current queue-panel render — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Effect on active work: none; the indicator performs no dispatch — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Collection mutation: none — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Expected result: the panel communicates that auto-send is on — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Remaining or next state: the indicator continues to reflect projected state and the mockup exposes no auto-send control — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`.
- Change classification evidence: `ComposerDock.tsx#queued-draft-header` lacks the indicator; completed Story 7.5 already owns the unchanged durable auto-send behavior.

### M008 — Per-item `Send now` Without Stop

- Visible presentation: each queued item shows `Send now` only when active-turn injection is verified — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Precondition: the agent is generating, one item is queued, and provider injection is verified — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Action or trigger: the user selects `Send now` on that queued item — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Target identity: the selected queued message and the current active provider turn — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Target cardinality: one queued message — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Timing: immediate active-turn injection — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Effect on active work: the active turn continues and Stop is not invoked — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Collection mutation: the selected message leaves the queue and receives a stamped message identity — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Expected result: the selected message enters the active turn without stopping it — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Remaining or next state: generation continues and the item is `sent` pending provider acknowledgement — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`.
- Change classification evidence: `ComposerDock.test.tsx#queue-only-controls` does not prove the per-item path; completed Stories 8.3 and 8.8 supply the provider-capability baseline.

### M009 — Durable Terminal `Never sent` Records

- Visible presentation: a read-only terminal dock labels each unmatched durable message `Never sent` — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Precondition: the node reaches a terminal state with durable queued or unacknowledged content — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Action or trigger: terminal reconciliation runs — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Target identity: durable steering messages without matching provider acknowledgement — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Target cardinality: every unmatched durable message — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Timing: on terminal completion or failure — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Effect on active work: none; the node is already terminal — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Collection mutation: unmatched sent identities return to the terminal `Never sent` collection — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Expected result: all undelivered content is readable and cannot be edited or sent — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Remaining or next state: the terminal room stays read-only with `Never sent` records — `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`.
- Change classification evidence: `steering-dock.ts#terminal-reconciliation` reconciles process-local state only; completed Stories 2.11 and 7.3 provide terminal and durable baselines separately.

### M010 — Thirty-minute Idle Failure Preserves Content

- Visible presentation: a failed node explains the timeout and shows preserved `Never sent` content — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Precondition: the current turn was interrupted and the node remains idle with durable queued content — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Action or trigger: 30 minutes pass without activity and typing re-arms the timer before expiry — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Target identity: the interrupted node execution — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Target cardinality: one node execution — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Timing: after 30 minutes of re-armable inactivity — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Effect on active work: the node execution fails — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Collection mutation: durable queued content remains and projects as `Never sent` — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Expected result: the node shows failed status and preserved content remains readable — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Remaining or next state: a failed terminal room with read-only `Never sent` records — `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`.
- Change classification evidence: `steering-registry.ts#STEERING_IDLE_AWAIT_INACTIVITY_MS` has the timer but only process-local queue state; completed Stories 2.12 and 7.3 provide the separate timeout and durable baselines.

### M013 — Codex-supported Tool Status

- Visible presentation: Codex tool rows never use the interrupted warning glyph — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Precondition: a Codex tool row is being presented — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Action or trigger: the presenter resolves the status glyph — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Target identity: the current Codex tool-row status glyph — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Target cardinality: one tool row — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Timing: during transcript rendering — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Effect on active work: none — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Collection mutation: none — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Expected result: the interrupted warning glyph is unavailable for Codex rows — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Remaining or next state: the row uses only a Codex-supported status presentation — `Transcript States.dc.html#provider=codex status=interrupted-unavailable`.
- Change classification evidence: `tool-presentation.ts#statusGlyph` currently permits the warning state for all providers; completed Story 8.4 requires Codex turn interruption but does not enforce this presentation exception.

## Mockup Feature Behavior Matrix

| ID   | Exact mockup and visible control or state                                                                        | Precondition                                                | User action or trigger                              | Target and cardinality                                         | Timing                                    | Effect or result                                                                                                                                            | Remaining or next state                                                                      | Exact PRD package requirement                                | Exact Architecture decision                                                  | Exact Epic 10 acceptance criterion | Status  |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------- | ------- |
| M001 | `Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock`; fixed Console room and non-overlay dock | Console room open                                           | Room renders                                        | Open Console room; one room                                    | Initial layout                            | 520-pixel room; transcript scrolls above sibling dock; no active-work or collection change                                                                  | Remains 520 pixels until close                                                               | `test-plan.md:136` requires Console validation at 520 pixels | Live-steering AD-12, lines 268–270                                           | Story 10.1, lines 1680–1685        | MATCHED |
| M002 | `Legacy Node Room.dc.html#layout=node-room-width-460`; fixed Legacy room                                         | Legacy room open                                            | Room renders                                        | Open Legacy room; one room                                     | Initial layout                            | 460-pixel room; approved vertical order; no active-work or collection change                                                                                | Remains 460 pixels until close                                                               | `test-plan.md:136` requires Legacy validation at 460 pixels  | Live-steering AD-12, lines 268–270                                           | Story 10.1, lines 1686–1690        | MATCHED |
| M005 | `Console Node Room.dc.html#control=iteration-selector-max-8`; bounded `Execution` selector                       | Loop node has more than one execution                       | User selects one execution                          | Selected execution; one of at most eight exposed entries       | Immediate projection                      | Shows chosen execution; stale selection is read-only; no collection change                                                                                  | Room displays selected live or stale execution                                               | `SPEC.md:82–90`, CAP-6                                       | Readable-transcript AD-12, lines 169–177; live-steering AD-12, lines 272–274 | Story 10.1, lines 1691–1704        | MATCHED |
| M007 | `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`; projected `Auto-send on` label       | Queue panel visible and effective projected state on        | Queue panel renders                                 | Status label; one indicator                                    | Current panel render                      | Communicates state only; no dispatch, active-work effect, or collection mutation                                                                            | Continues to reflect projected state; no control is exposed                                  | `SPEC.md:156–163`, CAP-15                                    | Live-steering AD-9, lines 210–226                                            | Story 10.2, lines 1715–1719        | MATCHED |
| M008 | `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`; per-item `Send now`                          | Agent generating, item queued, provider injection verified  | User selects `Send now` on the item                 | Selected message and active provider turn; exactly one message | Immediate active-turn injection           | Selected item leaves queue, gains stamped identity, enters active turn; generation and active tool continue; Stop is not invoked; other items are unchanged | Selected item is `sent` pending acknowledgement                                              | `SPEC.md:132–143`, CAP-12; `steering-api-contract.md:83–85`  | Live-steering AD-4, lines 128–136; AD-8, lines 198–208                       | Story 10.2, lines 1720–1745        | MATCHED |
| M009 | `Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation`; terminal `Never sent` records        | Node terminal with durable queued or unacknowledged content | Terminal reconciliation runs                        | Every unmatched durable message                                | Terminal completion or failure            | Restores unmatched identities to a read-only collection; all content stays readable; no active-work effect                                                  | Terminal room remains read-only with `Never sent` records                                    | `SPEC.md:99–107`, CAP-8                                      | Live-steering AD-5, lines 150–158                                            | Story 10.3, lines 1753–1768        | MATCHED |
| M010 | `Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue`; failed interrupted-idle state         | Interrupted node idle with durable queue content            | 30 minutes pass without activity; typing can re-arm | Interrupted execution; one node execution                      | After 30 minutes of re-armable inactivity | Node fails and durable queue remains as readable `Never sent` content                                                                                       | Failed terminal room with read-only records; restart uses recovery instead of the lost timer | `SPEC.md:115–123` and `SPEC.md:224`, CAP-9                   | Live-steering AD-6, lines 174–182                                            | Story 10.3, lines 1769–1786        | MATCHED |
| M013 | `Transcript States.dc.html#provider=codex status=interrupted-unavailable`; Codex status exception                | Codex tool row is presented                                 | Presenter resolves its glyph                        | Current Codex tool-row glyph; one row                          | Transcript rendering                      | No active-work or collection change; warning glyph is unavailable                                                                                           | Row uses only a Codex-supported presentation                                                 | `SPEC.md:113–123` and `SPEC.md:230–233`, CAP-9               | Readable-transcript AD-13, lines 182–192; live-steering AD-1, lines 70–84    | Story 10.4, lines 1792–1816        | MATCHED |

### Matrix Coverage

- Atomic change rows: 8.
- MATCHED: 8.
- PARTIAL: 0.
- MISSING: 0.
- CONFLICT: 0.
- UNCLEAR: 0.
- Mockup change coverage: 100%.

## Context Inventory

These groups are approved current behavior shown for context.
They are not new Epic 10 requirements.

| ID   | Unchanged current behavior and inventory IDs                                                                           | Current implementation or test evidence                                              | Completed-Epic evidence                                       | Result           |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------- |
| C001 | Console run shell, metadata, filters, node list, and room header; I001–I006                                            | `RunDetailPage.tsx#run-detail-shell`                                                 | `epics-workflow-run-view-hitl/epics.md#completed-run-room`    | PROVEN UNCHANGED |
| C002 | Chronological transcript, disclosure, and Raw controls; I007, I008, I041, I042                                         | `NodeTranscriptPane.tsx#transcript-events`                                           | `epics-agent-node-room/epics.md#Epic-1`                       | PROVEN UNCHANGED |
| C003 | Composer, Queue, Stop, Delete, and sibling dock behavior; I011–I014, I045–I048, I070, I071, I084                       | `ComposerDock.tsx#active-steering-controls`                                          | `epics-agent-node-room/epics.md#Epic-2`                       | PROVEN UNCHANGED |
| C004 | Brief `Stopping…` state and supported interrupted outcome; I017–I019, I051–I053, I072                                  | `steering-dock.ts#deriveSteeringDockState`                                           | `epics-agent-node-room/epics.md#Story-2.3`                    | PROVEN UNCHANGED |
| C005 | Main idle `Send now`, operator rows, projected controls, and `sent` state; I020–I024, I054–I058, I073–I075, I080, I081 | `NodeTranscriptPane.tsx#operator-rows` plus existing dock projection                 | `epics-agent-node-room/epics.md#Stories-2.3-2.8-2.9-and-2.10` | PROVEN UNCHANGED |
| C006 | Clean terminal omission, lifecycle actions, and read-only affordance; I026, I027, I060, I062, I077, I083, I089         | `steering-dock.ts#terminal-state`                                                    | `epics-agent-node-room/epics.md#Stories-2.11-and-2.12`        | PROVEN UNCHANGED |
| C007 | Per-iteration rows, stale read-only state, and `Go to live iteration`; I031, I033, I034, I065, I067, I068              | `execution-room-model.ts#execution-selection`                                        | `epics-agent-node-room/epics.md#Story-1.7`                    | PROVEN UNCHANGED |
| C008 | Legacy metadata, tabs, node list, selector, and Close; I037–I040                                                       | `WorkflowExecution.tsx#workflow-run-shell`                                           | `epics-workflow-run-view-hitl/epics.md#completed-run-room`    | PROVEN UNCHANGED |
| C009 | Sibling dock below the transcript; I069                                                                                | `NodeTranscriptPane.tsx#room-column`                                                 | `epics-agent-node-room/epics.md#Story-2.1`                    | PROVEN UNCHANGED |
| C010 | Enter does not submit and empty drafts are omitted; I087, I088                                                         | `ComposerDock.test.tsx#composer-input-guards`                                        | `epics-agent-node-room/epics.md#Stories-2.1-and-2.2`          | PROVEN UNCHANGED |
| C011 | Semantic color tokens for tool families; I090–I094                                                                     | `tool-presentation.ts#tool-family-presentation`                                      | `epics-agent-node-room/epics.md#Story-1.1`                    | PROVEN UNCHANGED |
| C012 | General succeeded, failed, running, interrupted, and unknown glyphs; I095–I099                                         | `tool-presentation.ts#statusGlyph`                                                   | `epics-agent-node-room/epics.md#Story-1.1`                    | PROVEN UNCHANGED |
| C013 | Collapsed anatomy and provider-name retention; I101, I102                                                              | `tool-presentation.ts#collapsed-tool-presentation`                                   | `epics-agent-node-room/epics.md#Story-1.1`                    | PROVEN UNCHANGED |
| C014 | Long-path, Codex script, MCP, and unknown-tool fallbacks; I103–I107                                                    | `tool-presentation.test.ts#hard-cases`                                               | `epics-agent-node-room/epics.md#Stories-1.1-and-1.3`          | PROVEN UNCHANGED |
| C015 | Shell, file, web, search, glob, and code bodies; I108–I113                                                             | `ConsoleAgentHistoryList.tsx#tool-detail-renderers`                                  | `epics-agent-node-room/epics.md#Stories-1.3-and-1.4`          | PROVEN UNCHANGED |
| C016 | OMP task batch and Claude Agent dispatch bodies; I117, I118                                                            | `tool-presentation.ts#task-presentations`                                            | `epics-agent-node-room/epics.md#Story-1.6`                    | PROVEN UNCHANGED |
| C017 | `occurrence_id` grouping and approved headers; I119, I120                                                              | `occurrence-groups.ts#groupOccurrenceEvents`                                         | `epics-agent-node-room/epics.md#Story-1.7`                    | PROVEN UNCHANGED |
| C018 | Closed-by-default complete JSON disclosure; I121                                                                       | `NodeTranscriptPane.tsx#raw-payload`                                                 | `epics-agent-node-room/epics.md#Story-1.2`                    | PROVEN UNCHANGED |
| C019 | Independent open state for each tool row; I122                                                                         | `NodeTranscriptPane.tsx#tool-disclosure-state`                                       | `epics-agent-node-room/epics.md#Stories-1.1-and-1.2`          | PROVEN UNCHANGED |
| C020 | Todo strip below the transcript scroller; I009, I043                                                                   | `NodeTranscriptPane.tsx#TodoStrip`                                                   | `epics-agent-node-room/epics.md#Story-3.2`                    | PROVEN UNCHANGED |
| C021 | Latest todo uses the checklist and earlier calls use compact updates; I114–I116                                        | `tool-presentation.ts#todo-family`                                                   | `epics-agent-node-room/epics.md#Story-3.2`                    | PROVEN UNCHANGED |
| C022 | Durable server-owned drafts and shared queue; I010                                                                     | `steering-registry.ts#SteeringRegistry` at the live-turn seam                        | `epics-agent-node-room/epics.md#Stories-7.1-through-7.3`      | PROVEN UNCHANGED |
| C023 | Read-only durable recovery with explicit Resume; I029, I030, I063, I064, I079                                          | `steering-registry.ts#process-local-live-turn-registry` proves the volatile boundary | `epics-agent-node-room/epics.md#Story-7.4`                    | PROVEN UNCHANGED |
| C024 | `delivered` requires matching provider acknowledgement; I082, I086                                                     | `steering-dock.ts#message-id-reconciliation`                                         | `epics-agent-node-room/epics.md#Story-8.3`                    | PROVEN UNCHANGED |

### Context Coverage

- Unchanged-context groups: 24.
- Groups with current implementation or test evidence: 24.
- Groups with completed-Epic evidence: 24.
- Groups incorrectly assigned as new Epic 10 scope: 0.

## Scope Decision Audit

| Label or decision found                                                                                                                         | Applicable manifest behavior       | Reconciliation                                                                                                                                                                                                                                                                             | Audit result              |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Early Epic text calls soft injection `post-v1` or gated at lines 100, 183, 580, 609, and 828                                                    | M008                               | The 2026-09-21 course correction at lines 871–876 makes those entries completed historical provenance and assigns the current outcomes to Stories 8.3, 8.5, and 8.7; `SPEC.md:210` states that verified soft injection is current scope; Epic 10 Story 10.2 owns the remaining visible gap | NO CURRENT-SCOPE CONFLICT |
| Early Epic text calls `delivered` `post-v1` or SDK-gated at lines 103, 185, and 828                                                             | C024                               | The same course correction makes the old gate historical; `SPEC.md:147` puts the SDK and message-id work in current scope; completed Story 8.3 owns the current acknowledgement boundary                                                                                                   | NO CURRENT-SCOPE CONFLICT |
| Legacy is described as scheduled for deletion elsewhere                                                                                         | M002 and all Legacy context groups | The selected PRD, UX, Architecture, and Stories explicitly require Legacy and Console to ship together now; later removal is not a deferral of current visible behavior                                                                                                                    | NO CURRENT-SCOPE CONFLICT |
| Historical Cancel changes are excluded                                                                                                          | None                               | Cancel is not a visible element in the approved manifest and is outside the target behavior boundary                                                                                                                                                                                       | VALID EXCLUSION           |
| Individual-tool cancellation is excluded                                                                                                        | None                               | Approved Stop ends the whole current turn; the manifest contains no individual-tool cancel control                                                                                                                                                                                         | VALID EXCLUSION           |
| CLI `--detach` changes are excluded                                                                                                             | None                               | CLI detach has no visible Node Room item in the approved manifest                                                                                                                                                                                                                          | VALID EXCLUSION           |
| Legacy AskCard contrast is recorded as outside this UX spine                                                                                    | None                               | The AskCard control is outside `agent-node-room`, is absent from the approved manifest, and does not remove a target feature                                                                                                                                                               | VALID TARGET BOUNDARY     |
| Incidental words such as `later layers`, `future tool`, `optional` schema fields, `removed` collection entries, or `superseded` contrast values | None                               | These words describe runtime order, type syntax, collection mutation, or corrected measurements; they do not label a product feature as deferred or out of scope                                                                                                                           | NOT A SCOPE LABEL         |

All eight visible change features remain current scope.
All 24 unchanged-context groups remain current product behavior.
No visible manifest behavior is labeled future, deferred, optional, removed, superseded, gated, or out of scope by the effective current contract.

## Action Identity Audit

| Group | Grouped IDs      | Shared label or intent         | Distinct behavior signatures and direct evidence                                                                                                                                                                                                                                                                                                                                                                         | Planning alignment                                                                                                                                                                                           | Audit result                                                  |
| ----- | ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| AIA-1 | M005, C007, C008 | `Execution` selection          | M005 selects one of at most eight entries, defaults to live, projects immediately, and makes stale selection read-only — `Console Node Room.dc.html#control=iteration-selector-max-8`. C007 retains stale history and `Go to live iteration`; C008 retains the existing Legacy selector shell                                                                                                                            | CAP-6, both AD-12 decisions, and Story 10.1 add the bounded current behavior without changing the selector identity                                                                                          | MATCHED — one action identity with additive bounded behavior  |
| AIA-2 | M008, C005       | `Send now`                     | M008 is a per-item control while generating, targets exactly one selected queued message, injects immediately, and does not Stop — `Console Node Room.dc.html#behavior=verified-soft-inject-send-now`, I015, I016, I049, I050, I085. C005 is the main dock action while idle-after-interrupt, acts on the durable waiting batch as the next turn, and returns the room to generating — I020, I021, I054, I055, I073–I075 | CAP-10 owns the main idle batch action; CAP-12 and Story 10.2 own the selected active-turn action; UX and Architecture preserve their different locations, preconditions, targets, cardinalities, and timing | MATCHED — two directly proven, intentionally distinct actions |
| AIA-3 | M007, C022, C023 | Auto-send state and durability | M007 is one read-only projected-state label and has no trigger, dispatch, or collection mutation — `Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator`. C022 and C023 prove the durable setting and recovery behavior without adding a mockup control                                                                                                                                             | CAP-15, live-steering AD-9, UX line 144, and Story 10.2 all state that the visible indicator is read-only while underlying durable auto-send behavior remains unchanged                                      | MATCHED — indicator is not an action identity                 |

No action group is UNCLEAR.
No shared label hides an incompatible target, cardinality, timing, active-work effect, collection mutation, result, or next state.

## Summary and Recommendations

### Overall Readiness Status

**READY**

Epic 10 is ready for implementation against the current validated mockup manifest and corrected PRD, UX, Architecture, and Story set.

### Critical Issues Requiring Immediate Action

None.

### Remaining Blockers

None.

### Assessment Totals

- Required document classes present: 4 of 4.
- PRD functional requirements covered: 21 of 21.
- Current manifest change features matched: 8 of 8.
- Unchanged-context groups verified: 24 of 24.
- Visible inventory items classified exactly once: 122 of 122.
- Scope conflicts: 0.
- Unclear behavior fields: 0.
- Action-identity conflicts or unclear groups: 0.
- Current Epic quality violations: 0.
- Readiness blockers: 0.

### Recommended Next Steps

1. Implement Stories 10.1–10.4 as the only current Epic 10 work.
2. Preserve all 24 unchanged-context groups while changing only the eight manifest features.
3. Run the focused Story tests, both-shell visual and accessibility checks, provider conformance checks, and the repository validation gates named by the PRD package.

### Final Note

This assessment found no issue that requires artifact correction before implementation.
The early `post-v1` and gated wording is historical provenance and does not alter current scope.
The effective contract puts every approved visible behavior in current scope and assigns all remaining implementation work to Epic 10.

**Assessor:** Codex implementation-readiness workflow.
**Assessment date:** 2026-09-22.
