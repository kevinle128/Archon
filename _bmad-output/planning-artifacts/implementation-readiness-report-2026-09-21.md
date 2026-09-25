---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
inputDocuments:
  - ../specs/spec-agent-node-room/SPEC.md
  - ../specs/spec-agent-node-room/tool-presentation-contract.md
  - ../specs/spec-agent-node-room/todo-fold-contract.md
  - ../specs/spec-agent-node-room/test-plan.md
  - ../specs/spec-agent-node-room/engine-integration.md
  - ../specs/spec-agent-node-room/provider-steering-matrix.md
  - ../specs/spec-agent-node-room/control-states.md
  - ../specs/spec-agent-node-room/steering-api-contract.md
  - ../specs/spec-agent-node-room/steering-test-plan.md
  - ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - epics-agent-node-room/epics.md
  - ../../claude-design/design_handoff_node_room_transcript_steering/README.md
  - ../../claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html
  - ../../claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html
  - ../../claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html
  - ../../claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html
targetSlug: agent-node-room
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-21
**Project:** Archon

## Document Discovery

The authoritative assessment boundary is `_bmad-output/specs/spec-agent-node-room/`.
`SPEC.md` is the canonical PRD-equivalent for this assessment.
The target Epic frontmatter selects the consolidated specification, its eight companion contracts and test plans, two UX documents, two complementary architecture spines, and the approved mockup handoff.

### Requirements and Contracts

- `SPEC.md` — 33,459 bytes
- `tool-presentation-contract.md` — 25,185 bytes
- `todo-fold-contract.md` — 5,974 bytes
- `test-plan.md` — 13,693 bytes
- `engine-integration.md` — 18,683 bytes
- `provider-steering-matrix.md` — 10,762 bytes
- `control-states.md` — 12,592 bytes
- `steering-api-contract.md` — 11,898 bytes
- `steering-test-plan.md` — 13,603 bytes

### Architecture

- Readable Agent Transcript `ARCHITECTURE-SPINE.md` — 36,188 bytes
- Live Agent Steering `ARCHITECTURE-SPINE.md` — 46,457 bytes

The two architecture spines cover complementary parts of the selected target and are not duplicates.

### Epics and Stories

- `epics-agent-node-room/epics.md` — 40,589 bytes

### UX and Approved Mockups

- `DESIGN.md` — 63,403 bytes
- `EXPERIENCE.md` — 189,839 bytes
- Handoff `README.md` — 31,964 bytes
- `Console Node Room.dc.html` — 67,725 bytes
- `Legacy Node Room.dc.html` — 65,371 bytes
- `Transcript States.dc.html` — 67,304 bytes
- `Steering Dock States.dc.html` — 44,333 bytes

All selected files were modified on 2026-09-21 at 10:34:29 +0700.
No whole-versus-sharded duplicates exist in the selected lineage.
No required target artifact is missing.
Planning artifacts for other product targets are excluded because they do not share the selected lineage.

## PRD Analysis

The canonical PRD-equivalent is `SPEC.md` together with its eight specification companions.
The explicit product-scope decisions recorded by the user on 2026-09-21 are normative requirements for this assessment.

### Functional Requirements

FR1: A reader must be able to scan each tool call as one line and determine what ran, its salient target, and its outcome without expanding the row.
Each row must include a family chip, a colour-independent status glyph, a headline, and right-aligned badges.
Successful calls must start collapsed, failed calls must start expanded, and collapsed rows must not contain serialized-data punctuation.

FR2: A reader must be able to expand every tool call into a body designed for that tool family.
Unknown tools must show at most three scalar `key: value` pairs, collapse objects and arrays to `{…}` and `[n]`, and never show a JSON dump outside Raw.
The generic fallback must remain below 2% of logical tool cards in the measured production corpus.

FR3: The system must fold OMP todo mutations and Claude `TodoWrite` snapshots into one `TodoPhase[]` current-state model.
Every todo call must remain a one-line transcript row.
The current checklist must appear only in a pinned, collapsible strip at the top of the transcript panel, remain visible while the transcript scrolls, omit empty phases, and be absent when no todos exist.

FR4: The system must normalize provider task-dispatch shapes into `TaskSubtask[]`.
Expanded task rows must show batch context when present and one collapsible card per subtask with its name and agent.

FR5: Persisted file-edit rows with valid before-and-after strings must show deterministic inline line diffs.
Rows without both sides must show a path and preview and must never fabricate a diff.
Failed edits must retain the attempted diff and normalized failure output.

FR6: Transcript rows must group by `occurrence_id`, never by `attempt_id`, when more than one occurrence exists.
Retry-driven groups must use `Run N`, with `· retry` or `· failed` only when the reason is known.
Loop-driven groups must use `Iteration N` without a suffix.
`Pass`, reason-only labels, and `Attempt` are forbidden.
A loop-iteration navigator must scroll to occurrence headers and must be absent for one occurrence.
Selecting a finished iteration through an Execution control must show a read-only dock, a `Go to iteration N` control, and the live node's shared pending queue without any steering mutation.

FR7: Every tool card must provide a Raw toggle that reveals the original JSON and is closed by default.
Raw must be the only tool-payload JSON presentation and must preserve the existing full-output loading flow.

FR8: A composer must be mounted and enabled while an agent node runs.
`Queue` must dispatch the message immediately to the node-scoped server-process queue without interrupting the current turn.
Queued messages must be shared across tabs and operators, while only unsent text remains tab-local under the original contract.

FR9: `Stop` must interrupt the active provider turn without stopping or failing the workflow node.
The provider session must stay alive, the node must remain `running`, the agent must enter `idle-after-interrupt`, and the interrupted tool must show `⚠ interrupted`.
The interface must distinguish this action from whole-node Cancel and must state that written work is not undone.

FR10: In `idle-after-interrupt`, `Send now` must flush queued messages followed by newly typed guidance in server receipt order as the next turn on the same provider session.
The node must continue without entering a workflow pause or resume state.

FR11: Delivered operator guidance and interrupted tool calls must appear as ordinary transcript rows in event order.
Operator rows must show the sender, remain distinct from assistant text without relying on colour, and carry stable `message_id` correlation.

FR12: Every provider must accept ordinary prompt delivery at a natural turn boundary, support interrupt-then-continue, and implement every current provider-specific mid-turn path.
Claude must support streaming-input soft injection.
OMP must support RPC-mode soft injection with protocol version 2 and ordered all-message delivery.
Grok must support hook-based soft injection.
Queue-only providers must still deliver on the next turn.

FR13: The interface must distinguish `sent` from `delivered` by caller-stamped message ID.
Claude delivery confirmation and the required SDK upgrade to at least 0.3.246 are current scope.
No implementation may infer delivery from text or timestamps.

FR14: Successful Codex `file_change` events must become persisted transcript rows and must use the same readable file presentation and Raw behavior as other file rows.

FR15: While a provider supports soft injection and is generating, each queued item must provide its own accessible `Send now` control.
Queue-only providers must omit that control instead of disabling it.

FR16: Steering must reach detached runs whose executor lives in another process.

FR17: Steering state, pending guidance, active continuation state, and required recovery behavior must survive server restarts.

FR18: Draft and queued guidance must have durable storage and recovery semantics.

FR19: The composer must support an auto-send queue mode with defined activation, ordering, failure, cancellation, and audit behavior.

FR20: RunStream tool-call presentation must use the readable transcript contract.

FR21: Chat tool-call presentation must use the readable transcript contract.

FR22: Backend tool-card formatting must align with the readable transcript contract.

FR23: The product must provide a run-level Files Changed panel.

FR24: The product must provide broader node-level Git attribution beyond per-tool-call diffs.

FR25: Steering must support `qodercli`.

FR26: Steering must support `pi`.

FR27: Steering must support GitHub Copilot.

FR28: Steering must support OpenCode.

FR29: The transcript must expose agent thinking with a defined privacy, persistence, presentation, and provider-normalization contract.

FR30: The transcript must expose the triggering prompt with a defined privacy, persistence, presentation, and attribution contract.

FR31: The transcript must expose advisor notifications with defined persistence, ordering, and presentation behavior.

FR32: Whole-node Cancel behavior and its interaction with steering, queues, persistence, restart recovery, and transcript reconciliation are current implementation scope.

FR33: Individual-tool cancellation is current implementation scope and needs a provider capability contract, engine behavior, UI states, audit behavior, and failure semantics.

Total functional requirements: 33.

### Non-Functional Requirements

NFR1: Existing historical runs must gain readable presentation without a rerun or data migration where their required data already exists.

NFR2: Status, state, action, and delivery meaning must remain understandable without colour.
Both surfaces must meet the WCAG 2.2 AA accessibility requirements recorded in `DESIGN.md` and `EXPERIENCE.md`.

NFR3: All TypeScript must remain strict, must contain no unjustified `any`, and must pass lint with zero warnings.
`bun run validate` is the pre-PR gate.

NFR4: Tool resolution and body normalization must be total over malformed, hostile, absent, and provider-specific payloads and must never throw in the renderer.

NFR5: Normalization and diff work must have deterministic input-based bounds.
Text bodies must cap at 65,536 code units, lists at 500 emitted items from at most 2,000 inspected items, paths and match values at 1,024 code units, and generic enumeration at 32 entries.

NFR6: Inline diff generation must be deterministic across machines, apply the declared byte, line, edit-length, and cache bounds, preserve valid line numbers, and sanitize hostile display controls without changing Raw.

NFR7: Queue, interrupt, withdraw, and send behavior must be idempotent and race-safe.
Rejected requests must leave node, queue, and transcript state unchanged.

NFR8: Global multi-operator order must be the live handle's server acceptance order.
Sender attribution must remain bound to the originating request, and node queues must not leak across nodes.

NFR9: The 30-minute idle-after-interrupt bound must be an inactivity timer.
Keepalive activity must re-arm it, and Send now, Cancel, or expiry must resolve the wait exactly once.

NFR10: Accepted but undelivered operator guidance must never disappear silently.
Terminal reconciliation must restore unmatched messages as `NEVER SENT` only after node-terminal evidence.

NFR11: Every steering API must use typed OpenAPI registration, Zod validation, one structured error contract, generated web types, and `Cache-Control: no-store` for queue reads.

NFR12: Steering APIs must authenticate through `resolveAuthContext` and apply the steering actor grant consistently.
Queue reads and logs must not expose sender identity, timestamps, message contents, or internal handle state beyond the declared contract.

NFR13: The registry and route hot paths must remain bounded and must not scan durable history to operate on a live node.

NFR14: Provider abort markers and exceptions must remain visible for executor classification and must not be silently swallowed by adapters.

NFR15: Cancel must dominate a simultaneous operator interrupt, and a steering interrupt must never trip the node-level Cancel controller.

NFR16: Legacy and Console must ship together with equivalent anatomy, wording, keyboard behavior, state transitions, and acceptance coverage while using their own token roots.

NFR17: `@archon/web` must not import from backend or workflow packages, and Console must not import from `@/components/` or banned API runtime exports.

NFR18: Every applicable provider table must include Claude and at least one non-Claude fixture, and every material UI flow must have Legacy and Console coverage.

Total non-functional requirements: 18.

### Additional Requirements

- `packages/web/src/lib/tool-presentation.ts` must remain pure, React-free, render-neutral, and provider-agnostic.
- Tool-family resolution must use the four declared tiers, exact normalized tokens, edge normalizers, and the measured alias set.
- The generic-fallback release audit must measure logical UI tool cards with exact integer threshold comparison and must fail release at 2% or more.
- `projectTodoState()` must apply all nine OMP operations, atomic batch behavior, last-call-wins Claude snapshots, and auto-promotion after successful mutations.
- A fresh per-turn signal must combine with the persistent node Cancel signal so one operator interrupt cannot poison later turns.
- End-cause classification must distinguish natural results, abort-marked results, operator-marked abort throws, genuine failures, and Cancel.
- Natural turn end must auto-drain queued guidance, while interrupted turn end must wait for `Send now`.
- Direct nodes, AI loop nodes, and provider-calling nodes inside loop groups must use the same steering contract.
- The executor must be the sole writer of operator transcript rows and interrupted status rows.
- Operator rows must use additive strict metadata for `origin`, `operator_user_id`, and `message_id`, with `operator_display_name` derived only in the read model.
- Send, interrupt, keepalive, withdraw, and queue-read routes must implement the exact request, response, status, error, and idempotency contracts in `steering-api-contract.md`.
- The queue-read client must discard snapshots captured before its own successful local mutation generation.
- Focus must never fall to `<body>` during dock transitions, Enter must insert a newline instead of sending, and delivery failure must use an assertive alert.
- Tests must use an injected manual scheduler for timer unit tests and one real-timer end-to-end journey for the production path.
- The implementation must preserve the existing package boundaries, generated-type workflow, and both-surface isolation rules.

### Normative Scope Conflicts

The explicit user decisions on 2026-09-21 require all approved-mockup behavior, G1–G4, successful Codex file-change rows, and FR16–FR33 in the current implementation.
This is a normative current-scope constraint.

`SPEC.md` CAP-5 says successful Codex file changes are "explicitly excluded here" and "separately tracked work."
This is a normative exclusion and is mutually exclusive with FR14.
No implementation can both persist and render those rows in this delivery and exclude them from this delivery.

`SPEC.md` under `Constraints > Write half` says G1–G4 are a "post-v1 gated backlog" and that none blocks v1.
This is a normative release-scope exclusion and is mutually exclusive with the current-scope decision for FR12, FR13, and FR15.
No implementation can satisfy both scopes without correcting the PRD-equivalent and dependent artifacts.

`SPEC.md` under `Non-goals` excludes or defers every capability represented by FR16–FR33.
This is a normative exclusion and is mutually exclusive with the explicit current-scope decision.
The user decision is authoritative for this assessment, so each contrary non-goal or deferred label is a planning defect.

`control-states.md` under `Behaviour inside a state` says, "No per-item send while generating."
The approved Console and Legacy mockups show per-item `Send now` for soft-inject transports, and the user explicitly requires that behavior now.
These are mutually exclusive normative interaction requirements, so the control-state contract must be corrected.

### PRD Completeness Assessment

The original 13-capability contract is detailed, testable, and supported by strong technical companions.
It does not describe the full current product scope.
Twenty explicit current-scope requirements are missing, excluded, deferred, or only described as unverified future mechanisms.
FR16–FR33 lack complete product behavior, architecture decisions, story acceptance criteria, and test contracts.
Several current-scope provider mechanisms also remain technically unverified.
The PRD-equivalent is therefore incomplete and internally inconsistent for the approved implementation scope.

## Epic Coverage Validation

The Epic document defines stories only for the original FR1–FR13 set.
Its coverage map assigns G1–G4 to a post-v1 gated backlog, excludes detached runs from Story 2.1, makes steering state process-local and non-durable, and separately tracks successful Codex `file_change` rows.
Those classifications conflict with the explicit current-scope decisions and cannot count as complete implementation coverage.

### Epic FR Coverage Extracted

- FR1 is mapped to Story 1.1.
- FR2 is mapped to Story 1.3.
- FR3 is mapped to Story 1.5.
- FR4 is mapped to Story 1.6.
- FR5 is mapped to Story 1.4.
- FR6 is mapped to Story 1.7.
- FR7 is mapped to Story 1.2.
- FR8 is mapped to Stories 2.1, 2.2, 2.9, and 2.10.
- FR9 is mapped to Stories 2.3 through 2.7.
- FR10 is mapped to Stories 2.3 through 2.7.
- FR11 is mapped to Stories 2.8 and 2.13.
- FR12 has a boundary-delivery floor in Stories 2.1 and 2.3 through 2.7, but its current-scope Claude, Grok, and OMP soft-inject behavior appears only in G2–G4 under `Post-v1 gated backlog`.
- FR13 has a `sent` floor in Story 2.8, but current-scope Claude `delivered` confirmation appears only in G1 under `Post-v1 gated backlog`.
- FR14 through FR33 have no FR coverage-map entries.
- Story 2.11 covers terminal reconciliation, Story 2.12 covers idle-after-interrupt expiry, and Story 2.13 covers concurrent ordering and attribution.

The Epic document claims coverage for 13 original FR identifiers.
Only 11 of the 33 current-scope FRs have complete in-scope story coverage.

### Coverage Matrix

| FR   | Current-scope requirement                                                                                     | Epic coverage                                                                                                                                        | Status             |
| ---- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| FR1  | Scannable one-line tool rows with family, status, headline, badges, and correct default disclosure.           | Story 1.1                                                                                                                                            | COVERED            |
| FR2  | Family-specific expanded bodies and a bounded generic fallback.                                               | Story 1.3                                                                                                                                            | COVERED            |
| FR3  | Unified todo folding and the pinned current-state strip.                                                      | Story 1.5                                                                                                                                            | COVERED            |
| FR4  | Normalized subagent dispatch and subtask cards.                                                               | Story 1.6                                                                                                                                            | COVERED            |
| FR5  | Deterministic file-edit diffs without fabricated before/after content.                                        | Story 1.4                                                                                                                                            | COVERED            |
| FR6  | Occurrence grouping, approved `Run N` and `Iteration N` headers, navigation, and finished-iteration behavior. | Story 1.7, with finished-iteration support in Story 2.10                                                                                             | COVERED            |
| FR7  | Raw-only original JSON with the existing full-output path.                                                    | Story 1.2                                                                                                                                            | COVERED            |
| FR8  | Live composer, immediate queue acceptance, shared queued state, and tab-local unsent text.                    | Stories 2.1, 2.2, 2.9, and 2.10                                                                                                                      | COVERED            |
| FR9  | Stop the provider turn without stopping the node, preserve the session, and show interruption.                | Stories 2.3 through 2.7                                                                                                                              | COVERED            |
| FR10 | Flush queued and new guidance on the same session after interruption.                                         | Stories 2.3 through 2.7                                                                                                                              | COVERED            |
| FR11 | Persist operator guidance and interrupted calls as attributed transcript rows in event order.                 | Stories 2.8 and 2.13                                                                                                                                 | COVERED            |
| FR12 | Boundary delivery, interrupt continuation, and all current provider-specific soft-inject paths.               | Boundary and interrupt paths are in Stories 2.1 and 2.3 through 2.7, but Claude, Grok, and OMP soft-inject are only G2–G4.                           | PARTIAL / CONFLICT |
| FR13 | Distinguish `sent` from `delivered` by message ID and upgrade Claude SDK.                                     | Story 2.8 covers `sent`, but `delivered` is only G1.                                                                                                 | PARTIAL / CONFLICT |
| FR14 | Persist and render successful Codex `file_change` transcript rows.                                            | Story 1.4 explicitly excludes these rows as separately tracked work.                                                                                 | MISSING / CONFLICT |
| FR15 | Provide per-item `Send now` for soft-inject providers while generating.                                       | No story or coverage-map entry exists, and the referenced control contract forbids it.                                                               | MISSING / CONFLICT |
| FR16 | Steer detached runs across process boundaries.                                                                | Story 2.1 rejects detached runs.                                                                                                                     | MISSING / CONFLICT |
| FR17 | Preserve steering and recovery state across server restarts.                                                  | NFR4 declares the state process-local and lost on restart.                                                                                           | MISSING / CONFLICT |
| FR18 | Store and recover drafts and queued guidance durably.                                                         | Stories 2.1 and 2.9 use a process-local queue and tab-local draft.                                                                                   | MISSING / CONFLICT |
| FR19 | Support a defined auto-send queue mode.                                                                       | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR20 | Apply readable tool presentation to RunStream.                                                                | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR21 | Apply readable tool presentation to Chat.                                                                     | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR22 | Align backend tool-card formatting with the readable presentation contract.                                   | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR23 | Provide a run-level Files Changed panel.                                                                      | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR24 | Provide broader node-level Git attribution.                                                                   | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR25 | Support qodercli steering.                                                                                    | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR26 | Support pi steering.                                                                                          | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR27 | Support GitHub Copilot steering.                                                                              | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR28 | Support OpenCode steering.                                                                                    | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR29 | Expose agent thinking under a defined contract.                                                               | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR30 | Expose the triggering prompt under a defined contract.                                                        | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR31 | Expose advisor notifications under a defined contract.                                                        | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |
| FR32 | Define whole-node Cancel interaction with steering, durability, recovery, and reconciliation.                 | Cancel precedence and terminal reconciliation appear as fragments in Stories 2.11 and 2.12, but no story covers the complete current-scope behavior. | PARTIAL / CONFLICT |
| FR33 | Support individual-tool cancellation with provider, engine, UI, audit, and failure contracts.                 | No story or coverage-map entry exists.                                                                                                               | MISSING / CONFLICT |

### Missing Requirements

Every requirement below is critical because the user explicitly placed it in the current implementation scope.

#### Provider Delivery and Current Mockup Behavior

FR12: Every provider must accept ordinary prompt delivery at a natural turn boundary, support interrupt-then-continue, and implement every current provider-specific mid-turn path.
Claude must support streaming-input soft injection.
OMP must support RPC-mode soft injection with protocol version 2 and ordered all-message delivery.
Grok must support hook-based soft injection.
Queue-only providers must still deliver on the next turn.

- Impact: The stories implement the fallback floor but omit three required mid-turn paths from the committed epics.
- Recommendation: Move G2–G4 into Epic 2 as current stories with provider-specific acceptance criteria and conformance tests.

FR13: The interface must distinguish `sent` from `delivered` by caller-stamped message ID.
Claude delivery confirmation and the required SDK upgrade to at least 0.3.246 are current scope.
No implementation may infer delivery from text or timestamps.

- Impact: The existing story stops at `sent`, so the current delivery-state contract has no committed implementation path.
- Recommendation: Move G1 into Epic 2 as a current story and include the SDK upgrade, message-ID correlation, negative cases, and transcript-state tests.

FR14: Successful Codex `file_change` events must become persisted transcript rows and must use the same readable file presentation and Raw behavior as other file rows.

- Impact: Codex changes remain absent from the transcript and the readable file contract is incomplete for a current provider.
- Recommendation: Expand Epic 1 with a persistence-to-presentation story for successful Codex `file_change` events.

FR15: While a provider supports soft injection and is generating, each queued item must provide its own accessible `Send now` control.
Queue-only providers must omit that control instead of disabling it.

- Impact: The approved mockup interaction has no story, acceptance criteria, or test ownership.
- Recommendation: Add an Epic 2 story that derives control visibility from provider capability and covers keyboard, ordering, idempotency, and both web surfaces.

#### Cross-Process and Durable Steering

FR16: Steering must reach detached runs whose executor lives in another process.

- Impact: The current send story rejects a required execution mode.
- Recommendation: Replace the detached-run rejection with an Epic 2 cross-process routing story and cover ownership, authorization, error handling, and reconnection.

FR17: Steering state, pending guidance, active continuation state, and required recovery behavior must survive server restarts.

- Impact: The declared process-local model loses required live state and leaves no restart recovery contract.
- Recommendation: Add a restart-survival story that defines durable state, executor reattachment, ambiguous ownership handling, and recovery tests.

FR18: Draft and queued guidance must have durable storage and recovery semantics.

- Impact: Current tab-local drafts and process-local queues can lose operator work.
- Recommendation: Add durable draft and queue stories with identity, ordering, retention, recovery, and multi-operator acceptance criteria.

FR19: The composer must support an auto-send queue mode with defined activation, ordering, failure, cancellation, and audit behavior.

- Impact: A required steering mode has no product or implementation path.
- Recommendation: Add an Epic 2 auto-send story that covers all state transitions and its interaction with manual send, Stop, Cancel, restart, and delivery audit.

#### Additional Presentation and Attribution Surfaces

FR20: RunStream tool-call presentation must use the readable transcript contract.

- Impact: Tool behavior can diverge between the Node Room and RunStream.
- Recommendation: Expand Epic 1 with a RunStream adoption story and shared-contract tests.

FR21: Chat tool-call presentation must use the readable transcript contract.

- Impact: Chat remains outside the current readability and consistency guarantee.
- Recommendation: Expand Epic 1 with a Chat adoption story and shared-contract tests.

FR22: Backend tool-card formatting must align with the readable transcript contract.

- Impact: Backend-produced presentation can disagree with the web normalization contract.
- Recommendation: Add an architecture-owned story that defines the shared source of truth and contract tests across backend and web outputs.

FR23: The product must provide a run-level Files Changed panel.

- Impact: The required run-wide change summary has no epic, story, or acceptance criteria.
- Recommendation: Add a current epic story for aggregation, ordering, empty states, attribution, navigation, and both web surfaces.

FR24: The product must provide broader node-level Git attribution beyond per-tool-call diffs.

- Impact: Changes that cannot be tied to one persisted tool call remain unattributed at node level.
- Recommendation: Add a story that defines attribution sources, precedence, ambiguous cases, and reconciliation with per-tool and run-level views.

#### Additional Steering Providers

FR25: Steering must support `qodercli`.

- Impact: A required provider has no capability mapping, engine path, story, or conformance fixture.
- Recommendation: Add a provider story under Epic 2 with boundary delivery, interrupt, continuation, soft-inject capability if supported, and failure semantics.

FR26: Steering must support `pi`.

- Impact: A required provider has no capability mapping, engine path, story, or conformance fixture.
- Recommendation: Add a provider story under Epic 2 with boundary delivery, interrupt, continuation, soft-inject capability if supported, and failure semantics.

FR27: Steering must support GitHub Copilot.

- Impact: A required provider has no capability mapping, engine path, story, or conformance fixture.
- Recommendation: Add a provider story under Epic 2 with boundary delivery, interrupt, continuation, soft-inject capability if supported, and failure semantics.

FR28: Steering must support OpenCode.

- Impact: A required provider has no capability mapping, engine path, story, or conformance fixture.
- Recommendation: Add a provider story under Epic 2 with boundary delivery, interrupt, continuation, soft-inject capability if supported, and failure semantics.

#### Additional Transcript Content

FR29: The transcript must expose agent thinking with a defined privacy, persistence, presentation, and provider-normalization contract.

- Impact: A required transcript source lacks safety rules and implementation ownership.
- Recommendation: Add an Epic 1 story only after the PRD-equivalent and architecture define the privacy and persistence contract.

FR30: The transcript must expose the triggering prompt with a defined privacy, persistence, presentation, and attribution contract.

- Impact: The initiating context remains unavailable and has no redaction or attribution rules.
- Recommendation: Add an Epic 1 story with explicit data-source, authorization, redaction, persistence, and presentation acceptance criteria.

FR31: The transcript must expose advisor notifications with defined persistence, ordering, and presentation behavior.

- Impact: Advisor events have no durable transcript or ordering contract.
- Recommendation: Add an Epic 1 story with event ownership, ordering, retry, display, and both-surface tests.

#### Cancellation Scope

FR32: Whole-node Cancel behavior and its interaction with steering, queues, persistence, restart recovery, and transcript reconciliation are current implementation scope.

- Impact: Existing stories mention Cancel precedence and reconciliation but do not cover the complete current behavior.
- Recommendation: Add a dedicated Epic 2 story that connects node cancellation to durable queue state, recovery, transcript outcomes, and concurrent steering races.

FR33: Individual-tool cancellation is current implementation scope and needs a provider capability contract, engine behavior, UI states, audit behavior, and failure semantics.

- Impact: There is no safe or testable implementation path for the required cancellation action.
- Recommendation: Add a dedicated story after the PRD-equivalent and architecture define capability negotiation, cancellation boundaries, provider results, node continuation, audit rows, and UI states.

### Epic Scope Conflicts

The Epic coverage map classifies FR12 soft injection as `post-v1` G2–G4 and FR13 delivery confirmation as `post-v1` G1.
The `Post-v1 gated backlog` section says these items do not block either epic.
The user explicitly requires G1–G4 in the current implementation, so the classifications are mutually exclusive and must be corrected.

Story 1.4 says successful Codex `file_change` visibility is separately tracked work.
The user explicitly requires it in the current implementation, so this is a direct normative conflict.

Story 2.1 treats a detached run as a send error, and NFR4 says steering state is process-local and lost on restart.
The user explicitly requires detached-run steering, restart survival, and durable queues, so these are direct normative conflicts.

The Epic document has no current stories for FR15–FR33 except partial Cancel fragments for FR32.
No reinterpretation of the existing stories can provide traceability for those requirements because their affected surfaces, providers, persistence boundaries, or actions are absent or explicitly rejected.

### Coverage Statistics

- Total current-scope PRD FRs: 33.
- FRs fully covered in current epics and stories: 11.
- FRs partially covered but in conflict with current scope: 3.
- FRs missing and in conflict with current scope: 19.
- FRs without complete current-scope story coverage: 22.
- Full coverage percentage: 33.3%.

## UX Alignment Assessment

### UX Document Status

UX documentation exists and is substantial.
`DESIGN.md` is final, `EXPERIENCE.md` defines interaction and accessibility behavior, and four approved rendered HTML mockups define both shipping shells, transcript states, and steering states.
The rendered audit covered Console and Legacy prompt and loop modes, live and finished iterations, all eight dock states, soft-inject and queue-only transports, every transcript family body, occurrence headings, Raw, todo state, operator rows, and message statuses.

The state-selector, node-kind-selector, and transport-selector controls above the Console and Legacy frames are review scaffolding, not product UI, as stated in the handoff README.
The `Pass N` and reason-only examples in `Transcript States` are review alternatives rather than product behavior.
The recorded occurrence decision selects `Run N` for retry-driven groups, optional `· retry` or `· failed` only when known, and `Iteration N` without a suffix for loop-driven groups.

### UX ↔ PRD Alignment Issues

- `EXPERIENCE.md` State Patterns says a detached run is not steerable here, while current-scope FR16 requires steering to reach detached runs across process boundaries.
- `EXPERIENCE.md` State Patterns and Interaction Primitives say unsent drafts are tab-local, queued messages are process-local, and server restart loses steering state, while FR17 and FR18 require restart survival and durable draft and queue recovery.
- `EXPERIENCE.md` Interaction Primitives bans per-item send while a node runs, while FR15 and the approved Console and Legacy mockups require per-item `Send now` for soft-inject transports.
- The handoff and mockup notes call Claude soft injection spike-gated and call `delivered` unreachable until a later SDK bump, while FR12 and FR13 make both mechanisms current scope.
- The rendered detached state shows controls absent and a `not steerable here` disclosure, which is mutually exclusive with FR16.
- The rendered queue and draft scope cues do not represent FR17–FR19 durability, restart recovery, or auto-send mode.
- The transcript mockup does not define a successful Codex `file_change` ingestion state for FR14.
- No selected UX artifact defines the RunStream, Chat, backend formatter, run-level Files Changed, or broader Git-attribution experiences required by FR20–FR24.
- No selected UX artifact defines provider-specific steering states for qodercli, pi, GitHub Copilot, or OpenCode as required by FR25–FR28.
- No selected UX artifact defines agent thinking, triggering-prompt, or advisor-notification rows as required by FR29–FR31.
- The mockups distinguish Stop from Cancel but do not define the complete whole-node Cancel changes required by FR32.
- No selected UX artifact defines an individual-tool cancellation control, capability state, progress state, result state, or audit row for FR33.

### UX ↔ Architecture Alignment Issues

- Steering AD-3 calls soft injection provider-gated and spike-gated, which conflicts with current-scope FR12 and the approved per-item soft-inject behavior.
- Steering AD-5 makes the registry in-process only, defers detached steering, drops steering on restart, and rejects durable steering state, which conflicts with FR16–FR18.
- Steering AD-8 defers Claude `delivered` until the SDK bump, which conflicts with current-scope FR13.
- Steering AD-1 says whole-node Cancel is out of scope and untouched, which conflicts with current-scope FR32.
- Neither architecture spine provides an implementation decision path for FR14, FR19–FR31, or FR33.
- Transcript AD-12 and Story 1.5 require the pinned todo strip above the transcript, while the rendered Console and Legacy prototypes place it below the transcript scroller.
- Transcript AD-12 says the pinned strip renders only folded `TodoPhase[]`, while the rendered states include inline todo checklists and terminal `todoEnd` status rewrites that the handoff itself says are not adopted.
- The selected architecture supports the finished-iteration read-only queue, shared queue polling, Stop, idle-after-interrupt, same-session continuation, operator rows, occurrence grouping, family bodies, Raw, and both-shell parity.

### Mockup Feature Behavior Matrix

The matrix inventories product behavior in the rendered frames and state catalogues.
Locations use the visible section or state label plus the source line where that element or state starts.

| ID     | Exact mockup location                                                                   | Visible control or state                                                                                               | Precondition                                                                      | User action                                            | Affected item or items                                                        | Timing                                                          | Expected result                                                                             | Remaining state                                                | PRD citation                                                                   | Architecture citation                                                                    | Epic or Story AC citation                                                       | Status   |
| ------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| MF-001 | `Console Node Room.dc.html`, shipping frame, panel shell at lines 115–307               | Console node room uses a 520px panel and Console tokens.                                                               | Console run room is open.                                                         | Open a node.                                           | Console room shell.                                                           | On render.                                                      | The complete transcript and dock fit the 520px panel.                                       | Console keeps its own markup and token root.                   | NFR16, equivalent Console and Legacy anatomy.                                  | Transcript AD-1 and inherited HITL AD-4.                                                 | Story 1.1 AC1 names Console, but no AC fixes 520px.                             | PARTIAL  |
| MF-002 | `Legacy Node Room.dc.html`, shipping frame, panel shell at lines 104–298                | Legacy node room uses a 460px panel and Legacy tokens.                                                                 | Legacy workflow room is open.                                                     | Open a node.                                           | Legacy room shell.                                                            | On render.                                                      | The complete transcript and dock fit the 460px panel.                                       | Legacy keeps its own markup and token root.                    | NFR16, equivalent Console and Legacy anatomy.                                  | Transcript AD-1 and inherited HITL AD-4.                                                 | Story 1.1 AC1 names Legacy, but no AC fixes 460px.                              | PARTIAL  |
| MF-003 | Console lines 124–153 and Legacy lines 113–141                                          | Header shows type, node name, status, metadata, Execution when applicable, and close.                                  | A node room is open.                                                              | Read metadata, select an execution, or close the room. | Room header and selection.                                                    | Immediate UI response.                                          | Header controls expose the shown information and close behavior.                            | The selected run view or closed room remains.                  | FR6 covers Execution only.                                                     | Transcript AD-16 covers Execution only.                                                  | Stories 1.7 and 2.10 cover selection only.                                      | MISSING  |
| MF-004 | Console lines 155–294 and Legacy lines 143–285                                          | Rendered panel places the transcript before the todo strip.                                                            | A node has todo state.                                                            | Open the room.                                         | Transcript scroller and todo strip.                                           | On render.                                                      | Todo appears below the transcript in the prototype.                                         | Todo stays outside the scroller.                               | FR3 requires the strip at the top of the transcript panel.                     | Transcript AD-12 item 6 requires the top placement.                                      | Story 1.5 AC2 requires a strip pinned above the transcript.                     | CONFLICT |
| MF-005 | Console line 147 and Legacy line 135, `Execution` select                                | Live loop defaults to the running iteration.                                                                           | A loop node has finished and live iterations.                                     | Open the room.                                         | Execution selection and room content.                                         | On render.                                                      | The running iteration is selected.                                                          | Steering targets the live iteration.                           | FR6, live-node selection clause.                                               | Transcript AD-16.                                                                        | Story 2.10 AC3.                                                                 | MATCHED  |
| MF-006 | Console and Legacy loop mode, `Execution` select and finished-iteration view            | Selecting a finished iteration shows its completed status, timing, transcript, and todo state.                         | A loop node remains live and an earlier iteration is finished.                    | Select the finished iteration.                         | Header, transcript, todo strip, and dock.                                     | Immediately after selection.                                    | The room projects the selected iteration instead of the live one.                           | The live iteration continues unchanged.                        | FR6, finished-iteration clause.                                                | Transcript AD-16.                                                                        | Story 2.10 AC1.                                                                 | MATCHED  |
| MF-007 | Console and Legacy finished-iteration dock; README delta 6                              | Finished iteration shows `Go to iteration N` and the shared queue read-only.                                           | A finished iteration of a live loop is selected.                                  | Inspect the dock or activate `Go to iteration N`.      | Finished view, shared queue, and live selection.                              | Poll stays current; navigation is immediate.                    | No composer, per-item send, delete, Stop, or interrupt mutation is available.               | Pending messages remain queued for the live iteration.         | FR6, finished-iteration clause.                                                | Transcript AD-16.                                                                        | Story 2.10 AC1–AC3.                                                             | MATCHED  |
| MF-008 | `EXPERIENCE.md` behavior rendered by Console and Legacy selection states                | A different non-live execution has no dock.                                                                            | The selected execution is not an earlier iteration of the live node.              | Select it.                                             | Dock area.                                                                    | On selection.                                                   | The steering dock is absent.                                                                | The selected transcript remains readable.                      | FR6, non-live selection clause.                                                | Transcript AD-16 fail-closed rule.                                                       | Story 2.10 AC5.                                                                 | MATCHED  |
| MF-009 | Console line 159 and Legacy lines 148 and 169                                           | Retry-driven groups show ordinal `Run N` headings.                                                                     | More than one retry occurrence exists.                                            | Open or navigate the transcript.                       | Occurrence groups.                                                            | On render.                                                      | Each group keeps its ordinal.                                                               | Group order remains transcript order.                          | FR6, `Run N`.                                                                  | Transcript AD-7 item 2.                                                                  | Story 1.7 AC1 requires one header per occurrence.                               | MATCHED  |
| MF-010 | Console and Legacy occurrence headings; `Transcript States` section E lines 298–321     | Known retry reasons append only `· retry` or `· failed`.                                                               | A retry or failure reason is known.                                               | Read a group heading.                                  | Heading and navigator label.                                                  | On render.                                                      | The reason follows the ordinal.                                                             | Unknown reasons add no suffix.                                 | FR6, approved suffix vocabulary.                                               | Transcript AD-7 and AD-10.                                                               | Story 1.7 AC1 does not specify suffix vocabulary.                               | PARTIAL  |
| MF-011 | Console and Legacy loop mode; `Transcript States` section E                             | Loop-driven groups use `Iteration N` with no suffix.                                                                   | Multiple loop occurrences are loaded.                                             | Read or navigate groups.                               | Loop occurrence headings.                                                     | On render.                                                      | Each heading shows only the iteration ordinal.                                              | Provider and attempt IDs remain hidden.                        | FR6, `Iteration N`.                                                            | Transcript AD-7 item 2.                                                                  | Story 1.7 AC1 does not specify loop wording.                                    | PARTIAL  |
| MF-012 | Console and Legacy `Jump to` selector                                                   | Navigator scrolls to the matching loaded occurrence header.                                                            | More than one occurrence is loaded.                                               | Choose a navigator option.                             | Transcript scroll position.                                                   | Immediate scroll.                                               | The matching heading becomes the navigation target.                                         | Execution selection does not change.                           | FR6, navigator clause.                                                         | Transcript AD-7 and AD-16.                                                               | Story 1.7 AC2.                                                                  | MATCHED  |
| MF-013 | Console and Legacy single-occurrence prompt mode                                        | One occurrence shows no occurrence header or navigator.                                                                | Exactly one occurrence is loaded.                                                 | Open the room.                                         | Transcript chrome.                                                            | On render.                                                      | Rows render without redundant grouping controls.                                            | Transcript content stays unchanged.                            | FR6, single-occurrence clause.                                                 | Transcript AD-7 item 1.                                                                  | Story 1.7 AC3.                                                                  | MATCHED  |
| MF-014 | `Transcript States` section C lines 62–118 and both room transcripts                    | Every tool call is one scan line with chevron, glyph, chip, headline, and badges.                                      | A tool row exists.                                                                | Scan the transcript.                                   | One logical tool call.                                                        | On render and live update.                                      | The primary facts are visible without expansion or JSON punctuation.                        | The body remains available behind disclosure.                  | FR1.                                                                           | Transcript AD-1, AD-10, and AD-14.                                                       | Story 1.1 AC1.                                                                  | MATCHED  |
| MF-015 | `Transcript States` sections C and D                                                    | Initial disclosure is collapsed for success, running, interrupted, and unknown, and expanded for failure.              | A row first renders with one of five outcomes.                                    | None.                                                  | The row disclosure.                                                           | First render.                                                   | Only failure opens automatically.                                                           | The row remains user-controllable.                             | FR1.                                                                           | Transcript AD-12 items 1–2.                                                              | Story 1.1 AC1–AC2.                                                              | MATCHED  |
| MF-016 | Native `<details>` rows in all three transcript mockups                                 | A manual open or close survives live re-render.                                                                        | A reader changes a row and new live data arrives.                                 | Toggle the row.                                        | That row only.                                                                | Immediate and across subsequent polls.                          | The user choice is not reset by outcome projection.                                         | Other rows follow their own state.                             | FR1 permits row disclosure but does not state persistence.                     | Transcript AD-12 item 2.                                                                 | Story 1.1 has no manual-precedence AC.                                          | PARTIAL  |
| MF-017 | `Transcript States` section A and section C                                             | Chips use provider tool names only when they are one token of at most 24 characters, else the family name.             | A tool row is resolved.                                                           | Read the chip.                                         | Tool identity and family.                                                     | On render.                                                      | Recognizable short names remain and unsafe long names fall back.                            | Full identity remains in expanded details or Raw.              | FR1 and FR2.                                                                   | Transcript AD-1 and AD-10.                                                               | Story 1.1 AC3.                                                                  | MATCHED  |
| MF-018 | `Transcript States` section B lines 52–60                                               | `✓`, `✕`, `◐`, `⚠`, and `–` carry outcome without colour.                                                              | Any tool outcome exists.                                                          | Read the row.                                          | Status glyph and accessible name.                                             | On render and outcome change.                                   | Interrupted is distinct from failed.                                                        | Colour only reinforces the word or shape.                      | FR1 and NFR2.                                                                  | Transcript AD-10 and AD-13.                                                              | Story 1.1 AC2–AC3.                                                              | MATCHED  |
| MF-019 | `Transcript States` hard case 1 at lines 77–81                                          | Long paths elide in the middle and preserve the filename.                                                              | The path exceeds the row width.                                                   | Read or copy the row.                                  | Path headline.                                                                | On layout.                                                      | The visible tail stays useful while the full value remains accessible.                      | The core value is not truncated.                               | FR1 requires a salient target.                                                 | Transcript AD-11.                                                                        | Story 1.1 has no exact middle-elision AC.                                       | PARTIAL  |
| MF-020 | `Transcript States` hard case 2 at lines 83–98                                          | A Codex whole-script tool name becomes a shell row after wrapper stripping.                                            | Codex supplies a multiline command as the tool name with no input.                | Expand the row.                                        | Headline, terminal body, and Raw.                                             | On normalization.                                               | The first meaningful command is readable and the untouched name stays available.            | The row remains a shell-family tool call.                      | FR2.                                                                           | Transcript AD-15.                                                                        | Story 1.3 AC2.                                                                  | MATCHED  |
| MF-021 | `Transcript States` hard case 3 at lines 100–103                                        | MCP identity is shown as `server · tool` with a generic body.                                                          | An MCP tool does not match a known family.                                        | Expand the row.                                        | MCP label and generic facts.                                                  | On normalization.                                               | The server and tool stay distinguishable without a JSON dump.                               | Raw remains available.                                         | FR2.                                                                           | Transcript AD-1 and AD-3.                                                                | Story 1.3 AC3 does not state the MCP label.                                     | PARTIAL  |
| MF-022 | `Transcript States` hard case 4 at lines 105–118                                        | Unknown tools show at most three scalar facts and collapse objects and arrays.                                         | No family resolver matches.                                                       | Expand the row.                                        | Generic headline and body.                                                    | On normalization.                                               | The body is bounded and never a default JSON dump.                                          | Full payload stays behind Raw.                                 | FR2.                                                                           | Transcript AD-3.                                                                         | Story 1.3 AC3.                                                                  | MATCHED  |
| MF-023 | `Transcript States` section D, shell at lines 124–143                                   | Shell body shows command, output, exit, duration, and cwd, with failures open.                                         | A shell call has terminal data.                                                   | Expand or inspect the failed row.                      | Shell presentation.                                                           | On render.                                                      | Terminal output is readable in a shell-shaped body.                                         | Raw remains available.                                         | FR2.                                                                           | Transcript AD-1 and AD-3.                                                                | Story 1.3 AC1.                                                                  | MATCHED  |
| MF-024 | `Transcript States` section D, file at lines 145–160                                    | File edit shows deterministic inline hunks and `+n −m`.                                                                | Both before and after strings exist.                                              | Expand the row.                                        | File-edit presentation.                                                       | Diff is computed when the row is built.                         | The attempted change is readable without fabrication.                                       | Path-plus-preview remains the fallback.                        | FR5.                                                                           | Transcript AD-4 and AD-5.                                                                | Story 1.4 AC1–AC5.                                                              | MATCHED  |
| MF-025 | `Transcript States` section D, web at lines 162–177                                     | Web body shows URL, title, and markdown.                                                                               | A web-family payload is available.                                                | Expand the row.                                        | Web result presentation.                                                      | On render.                                                      | The result is shown as web content, not serialized data.                                    | Raw remains available.                                         | FR2.                                                                           | Transcript AD-1 and AD-3.                                                                | Story 1.3 AC1.                                                                  | MATCHED  |
| MF-026 | `Transcript States` section D, search at lines 179–192                                  | Search body shows matches according to `output_mode` with path and line.                                               | A search result is available.                                                     | Expand the row.                                        | Search results.                                                               | On render.                                                      | Matches are scannable and source-located.                                                   | Raw remains available.                                         | FR2.                                                                           | Transcript AD-1 and AD-3.                                                                | Story 1.3 AC1.                                                                  | MATCHED  |
| MF-027 | `Transcript States` section D, glob at lines 194–208                                    | Glob body shows a flat path list.                                                                                      | A glob result is available.                                                       | Expand the row.                                        | Path list.                                                                    | On render.                                                      | Paths appear without invented line numbers.                                                 | Raw remains available.                                         | FR2.                                                                           | Transcript AD-1 and AD-3.                                                                | Story 1.3 AC1.                                                                  | MATCHED  |
| MF-028 | `Transcript States` section D, code at lines 210–225                                    | Code body shows highlighted source with language.                                                                      | A code-family result is available.                                                | Expand the row.                                        | Source presentation.                                                          | On render.                                                      | Code is readable in its native form.                                                        | Raw remains available.                                         | FR2.                                                                           | Transcript AD-1 and AD-3.                                                                | Story 1.3 AC1.                                                                  | MATCHED  |
| MF-029 | `Transcript States` section D, OMP todo at lines 227–249                                | The rendered OMP row expands an inline folded checklist at the last todo call.                                         | OMP todo mutations exist.                                                         | Expand the last todo row.                              | Todo row and checklist.                                                       | On render.                                                      | The mock repeats current state inside the transcript flow.                                  | Earlier todo rows stay compact.                                | FR3 requires the checklist only in the pinned strip.                           | Transcript AD-12 items 5–6 forbid inline duplication.                                    | Story 1.5 AC2–AC3 forbids the inline checklist.                                 | CONFLICT |
| MF-030 | `Transcript States` section D, Claude todo at lines 251–269                             | The rendered Claude row expands an inline whole-list checklist.                                                        | Claude `TodoWrite` exists.                                                        | Expand the row.                                        | Todo row and checklist.                                                       | On render.                                                      | The mock shows the current list inside the transcript flow.                                 | Other todo calls remain rows.                                  | FR3 requires the checklist only in the pinned strip.                           | Transcript AD-12 items 5–6 forbid inline duplication.                                    | Story 1.5 AC2–AC3 forbids the inline checklist.                                 | CONFLICT |
| MF-031 | Both room transcripts and `Transcript States` todo history                              | Every todo mutation remains a compact `todo updated` row.                                                              | More than one todo call exists.                                                   | Scan history.                                          | Each todo call.                                                               | On render.                                                      | Mutation history remains visible without repeating state.                                   | Pinned state remains separate.                                 | FR3.                                                                           | Transcript AD-12 item 5.                                                                 | Story 1.5 AC3.                                                                  | MATCHED  |
| MF-032 | `Transcript States` OMP task at lines 271–283                                           | OMP batch shows context and one card per subtask with agent and name.                                                  | A batch task dispatch exists.                                                     | Expand the row.                                        | Batch context and subtasks.                                                   | On render.                                                      | Delegated work is individually inspectable.                                                 | The parent row remains one transcript item.                    | FR4.                                                                           | Transcript AD-1 and AD-3.                                                                | Story 1.6 AC1–AC2.                                                              | MATCHED  |
| MF-033 | `Transcript States` Claude task at lines 285–296                                        | Claude single dispatch shows one card and no batch context.                                                            | One Claude Agent dispatch exists.                                                 | Expand the row.                                        | Single subtask.                                                               | On render.                                                      | Provider shape normalizes to the same card model.                                           | The row remains a single dispatch.                             | FR4.                                                                           | Transcript AD-1 and AD-3.                                                                | Story 1.6 AC1–AC2.                                                              | MATCHED  |
| MF-034 | `Transcript States` section F lines 322–339 and every expanded family body              | Raw opens the original JSON and is closed by default.                                                                  | Any tool row exists.                                                              | Activate Raw.                                          | Original tool payload.                                                        | Immediate, with full-output loading when needed.                | JSON appears only in the Raw panel.                                                         | Readable row and body remain intact.                           | FR7.                                                                           | Transcript AD-1, AD-3, and AD-12.                                                        | Story 1.2 AC1–AC3.                                                              | MATCHED  |
| MF-035 | Console and Legacy todo strip                                                           | Pinned todo strip is absent without todos and defaults collapsed with current item, meter, and count.                  | Folded todo state is non-empty.                                                   | Open the room or toggle the strip.                     | Current todo state.                                                           | On render and toggle.                                           | Current work stays visible while the transcript scrolls.                                    | Transcript rows and folded state are unchanged.                | FR3 covers pinned, collapsible state but not every header detail.              | Transcript AD-7 and AD-12 item 6.                                                        | Story 1.5 AC2 omits default collapse, meter, and current-item precedence.       | PARTIAL  |
| MF-036 | Console lines 239–280 and Legacy lines 230–271                                          | Queue is a full-width band, visible only when non-empty, ordered, and expanded by default.                             | One or more accepted queued messages exist.                                       | Inspect or collapse the band.                          | Shared pending queue.                                                         | Immediately after acceptance and during polling.                | Written order and next item are visible.                                                    | Messages remain pending until delivery or withdrawal.          | FR8 covers shared order but not full-bleed presentation or default disclosure. | Steering AD-3 and AD-11.                                                                 | Stories 2.1 and 2.9 omit this full visual contract.                             | PARTIAL  |
| MF-037 | Console state 1 lines 317–329 and Legacy state 1 lines 309–320                          | Composer is mounted and enabled while the agent generates.                                                             | Node is running with agent sub-state `generating`.                                | Type guidance.                                         | Tab draft and live composer.                                                  | Immediately.                                                    | Text can be prepared without affecting the active turn.                                     | Agent remains generating and node remains running.             | FR8.                                                                           | Steering AD-1, AD-3, and AD-9.                                                           | Story 2.1 AC1.                                                                  | MATCHED  |
| MF-038 | Console and Legacy queue bands show `this tab only`; README queue scope notes           | Draft and queued guidance are shown with tab-local or process-local scope and are lost on tab close or server restart. | Guidance exists before or after Queue.                                            | Close the tab or restart the server.                   | Draft, queue, and continuation state.                                         | On close or restart.                                            | The selected UX contract loses state.                                                       | Durable recovery is absent.                                    | FR17 and FR18 require restart survival and durable draft and queue recovery.   | Steering AD-5 explicitly rejects durability.                                             | Stories 2.1 and 2.9 specify process-local queue and tab-local draft.            | CONFLICT |
| MF-039 | Console and Legacy `Queue` control in state 1                                           | Queue accepts guidance without interrupting the current tool or turn.                                                  | Agent is generating.                                                              | Activate `Queue`.                                      | New guidance message and node queue.                                          | Immediate acceptance; delivery at natural turn end.             | The message appends to the queue and no transcript row changes yet.                         | Agent and node keep running.                                   | FR8 and FR12 boundary path.                                                    | Steering AD-3 and AD-4.                                                                  | Story 2.1 AC1–AC2.                                                              | MATCHED  |
| MF-040 | Queue band ordinal and state notes                                                      | A new message joins the queue tail and delivery preserves written order.                                               | Existing queued messages are present.                                             | Queue another message.                                 | All pending messages.                                                         | On receipt and later drain.                                     | The new item never jumps earlier corrections.                                               | FIFO order remains visible.                                    | FR8 and NFR8.                                                                  | Steering AD-3 and AD-11.                                                                 | Stories 2.1 and 2.13.                                                           | MATCHED  |
| MF-041 | Queue item `✕` controls in Console and Legacy                                           | A queued message can be withdrawn before drain.                                                                        | The item is pending and mutable.                                                  | Activate its message-specific delete control.          | One identified queue item.                                                    | Immediate server mutation and view convergence.                 | Only that item disappears.                                                                  | Other items keep their order.                                  | FR8 and additional queue contract.                                             | Steering AD-11.                                                                          | Story 2.2 AC1–AC3.                                                              | MATCHED  |
| MF-042 | Console line 271, Legacy line 262, and soft-inject transport mode                       | Each queued item has `Send now` when the open stream supports soft injection.                                          | A soft-inject provider is generating and an item is queued.                       | Activate that item's `Send now`.                       | One selected queue item and the active turn.                                  | Mid-turn.                                                       | That item reaches the running turn without interrupt or a new turn-start event.             | Other queued items remain pending and node remains running.    | FR12 and FR15 require this now.                                                | Steering AD-3 and AD-7 call soft injection spike-gated.                                  | G2–G4 are outside the current epics and no story owns per-item send.            | CONFLICT |
| MF-043 | Console and Legacy queue-only transport mode                                            | Queue-only providers omit per-item `Send now` instead of disabling it.                                                 | A queue-only provider is generating.                                              | Inspect a queued item.                                 | Per-item actions.                                                             | On render.                                                      | Only truthful actions remain visible.                                                       | Item waits for the natural boundary or later redirect.         | FR15.                                                                          | Steering AD-3 defines the queue-only path but not this exact control rule.               | No Story AC covers capability-based per-item omission.                          | MISSING  |
| MF-044 | Console and Legacy `Stop` in state 1                                                    | Stop interrupts the current provider turn without stopping the node.                                                   | Agent is generating.                                                              | Activate `Stop`.                                       | Active provider turn and in-flight tool.                                      | Sub-second provider interrupt or stream abort.                  | The call becomes `⚠ interrupted` and the session stays alive.                               | Node remains `running`; written work remains.                  | FR9.                                                                           | Steering AD-1 and AD-2.                                                                  | Stories 2.3–2.7 AC1–AC3.                                                        | MATCHED  |
| MF-045 | Console state 2 lines 331–341 and Legacy state 2 lines 322–332                          | `Stopping…` is a brief UI-local transient with `aria-disabled`, while send still reads `Queue`.                        | Stop request is in flight.                                                        | Wait or continue typing.                               | Stop control, composer, and active turn.                                      | Until interrupt acknowledgement.                                | UI does not claim idle early and keyboard focus is retained.                                | Node remains running and queue remains pending.                | FR9 and NFR2.                                                                  | Steering AD-9.                                                                           | Story 2.3 AC5 includes `aria-disabled` and serialized announcements.            | MATCHED  |
| MF-046 | Console state 3 lines 343–354 and Legacy state 3 lines 334–344                          | Idle-after-interrupt removes Stop, changes the band to `Will send`, and changes the send control to `Send now`.        | Provider interrupt is acknowledged.                                               | Inspect or type final guidance.                        | Dock controls and queued messages.                                            | Immediately after acknowledgement.                              | The UI exposes the safe redirect moment.                                                    | Session is alive, queue remains pending, node remains running. | FR9 and FR10.                                                                  | Steering AD-4 and AD-9.                                                                  | Stories 2.3–2.7 AC1–AC3.                                                        | MATCHED  |
| MF-047 | Console and Legacy dock-level `Send now` in state 3                                     | Send now flushes queued messages and new text in written order on the same session.                                    | Agent is idle-after-interrupt.                                                    | Activate dock-level `Send now`.                        | All queued guidance plus current composer text.                               | Immediately as the next provider turn.                          | Messages leave the box once and continuation begins.                                        | Node remains running on the same provider session.             | FR10.                                                                          | Steering AD-3 and AD-4.                                                                  | Stories 2.3–2.7 AC3.                                                            | MATCHED  |
| MF-048 | State 3 disclosure line                                                                 | UI says the stop occurred after the last completed tool and written files remain written.                              | Agent is idle-after-interrupt.                                                    | Read the disclosure.                                   | Operator understanding of effects.                                            | At the state transition.                                        | Stop is not mistaken for rollback or node cancellation.                                     | Files and node state remain unchanged.                         | FR9.                                                                           | Steering AD-1 and AD-2.                                                                  | Story 2.3 AC4.                                                                  | MATCHED  |
| MF-049 | State 3 note and state 7 timeout                                                        | Idle-after-interrupt expires only after 30 minutes of genuine inactivity, and composing keepalive re-arms it.          | Agent is idle-after-interrupt.                                                    | Type, focus, send, cancel, or wait.                    | Idle timer and node.                                                          | Re-armed by activity; resolved once by send, Cancel, or expiry. | Active composing keeps the window open; expiry fails the node.                              | Pending messages remain eligible for reconciliation.           | NFR9 and additional timer requirement.                                         | Steering AD-4 and AD-11.                                                                 | Story 2.12 AC1–AC4.                                                             | MATCHED  |
| MF-050 | Console state 4 lines 356–364 and Legacy state 4 lines 346–354                          | After delivery, controls return to Stop and Queue and an empty queue band disappears.                                  | Redirect turn begins and queue drains.                                            | Observe the resumed node.                              | Dock, queue band, transcript, and active turn.                                | As projected sub-state returns to generating.                   | Operator rows appear before the caused turn and controls reset from state, not memory.      | Node remains running and interrupt is not sticky.              | FR8, FR10, and FR11.                                                           | Steering AD-6 and AD-9.                                                                  | Stories 2.3 and 2.8.                                                            | MATCHED  |
| MF-051 | `Steering Dock States` operator record at lines 233–248 and room state 4                | Operator guidance is a full-strength attributed transcript row in event order.                                         | Guidance is delivered.                                                            | Read the transcript.                                   | Operator rows, preceding interrupted call, and following assistant/tool rows. | When the executor delivers and appends.                         | Sender name and message text are distinct from assistant prose without colour.              | Row remains in permanent history.                              | FR11.                                                                          | Steering AD-6, AD-10, and AD-12.                                                         | Story 2.8 AC1–AC4 and Story 2.13.                                               | MATCHED  |
| MF-052 | `Steering Dock States` message status `sent` at lines 250–257                           | Accepted guidance first shows `sent`.                                                                                  | Browser has a successful receipt but no provider echo.                            | Inspect the operator row.                              | One message ID.                                                               | Immediately after acceptance and persistence.                   | UI claims only that the message left the browser.                                           | It can later advance only by matching ID evidence.             | FR13.                                                                          | Steering AD-6 and AD-8.                                                                  | Story 2.8 AC5 covers the original floor.                                        | MATCHED  |
| MF-053 | `Steering Dock States` message status `delivered` at lines 258–265                      | Claude can advance `sent` to `delivered` by echoed message ID.                                                         | Claude SDK is at least 0.3.246 and echoes the stamped ID.                         | Observe the operator row.                              | Matching operator message.                                                    | When the echo arrives.                                          | The word `delivered` appears with colour as reinforcement.                                  | Other providers remain `sent` without evidence.                | FR13 requires this in current scope.                                           | Steering AD-8 labels it gated and deferred.                                              | G1 is outside both current epics.                                               | CONFLICT |
| MF-054 | Console state 5 lines 366–378, Legacy state 5 lines 356–369, and `Never sent` status    | Terminal reconciliation restores unmatched guidance as read-only `Never sent`.                                         | Node terminates with observed message IDs lacking operator rows.                  | Inspect the terminal dock.                             | Unmatched sent messages and half-typed draft.                                 | Only after authoritative node-terminal evidence.                | Messages return in order with no active steering controls.                                  | Terminal transcript remains read-only.                         | NFR10 and FR32 reconciliation clause.                                          | Steering AD-11 terminal reconciliation.                                                  | Story 2.11 AC1–AC3.                                                             | MATCHED  |
| MF-055 | Console state 6 lines 380–389 and Legacy state 6 lines 371–379                          | A finished clean node has no dock.                                                                                     | Node is terminal and no guidance remains.                                         | Open the node.                                         | Dock area.                                                                    | On terminal render.                                             | Transcript uses the remaining panel height and no false composer appears.                   | Retry remains a separate capability.                           | FR8 implies composer only while running.                                       | Steering AD-1 and AD-11.                                                                 | Story 2.11 covers unmatched terminal state but has no explicit clean-state AC.  | PARTIAL  |
| MF-056 | Console state 7 lines 391–403, Legacy state 7 lines 381–392, and dock catalogue state 7 | Thirty-minute inactivity fails the node and shows the cause plus `Never sent`.                                         | Idle-after-interrupt reaches its inactivity bound.                                | Wait without keepalive or Send now.                    | Node, session, pending guidance, and dock.                                    | At 30 minutes of inactivity.                                    | Node fails once and partial output does not complete it.                                    | Retry uses a fresh session and messages remain read-only.      | NFR9 and NFR10.                                                                | Steering AD-4.                                                                           | Story 2.12 AC1–AC6.                                                             | MATCHED  |
| MF-057 | Console state 8 lines 405–417, Legacy state 8 lines 394–405, and dock catalogue state 8 | Detached run shows `not steerable here` with no field or controls.                                                     | Executor is in another process.                                                   | Open the running node.                                 | Dock and detached live session.                                               | On render.                                                      | The mock refuses steering.                                                                  | Cancel and normal run behavior remain separate.                | FR16 requires detached steering in current scope.                              | Steering AD-5 defers it.                                                                 | Story 2.1 explicitly rejects detached sends.                                    | CONFLICT |
| MF-058 | Composer in Console, Legacy, and dock catalogue                                         | Plain Enter inserts a newline and does not send.                                                                       | Composer has focus.                                                               | Press Enter.                                           | Current draft.                                                                | Immediate.                                                      | Draft gains a newline and no network mutation occurs.                                       | Agent and queue remain unchanged.                              | Additional requirement: Enter must insert a newline.                           | Steering AD-11 route mutation model.                                                     | Story 2.1 AC1 permits button or Cmd/Ctrl+Enter and does not assign plain Enter. | MATCHED  |
| MF-059 | Stop, send, field, row, and strip focus styles across all mockups                       | Focus remains visible and never falls to `<body>` during dock transitions.                                             | Keyboard focus is inside the panel.                                               | Toggle, Stop, or transition to idle.                   | Focus target and reading order.                                               | At each interaction and state change.                           | `Stopping…` keeps focus and idle moves focus to `Send now` deliberately.                    | Keyboard use continues in the dock.                            | NFR2 and additional focus requirement.                                         | Transcript AD-12 and Steering AD-9.                                                      | Story 2.3 AC5.                                                                  | MATCHED  |
| MF-060 | Dock catalogue state notes and `EXPERIENCE.md` Accessibility Floor                      | State transitions use one serialized polite status channel, while delivery failure uses an assertive alert.            | A steering or transcript transition occurs.                                       | Trigger Stop, delivery, timeout, or failure.           | Assistive announcements.                                                      | Coalesced per transition; failure is immediate.                 | Important state changes are announced once with their consequence.                          | Focus and visual state remain independent.                     | NFR2.                                                                          | Transcript AD-12 item 3 and Steering AD-9.                                               | Story 2.3 AC5 and Story 2.11 AC3.                                               | MATCHED  |
| MF-061 | README `Send now` failure behavior and queue state                                      | Delivery failure returns items to the queue front and announces the failure.                                           | Dock-level delivery has removed items optimistically and provider delivery fails. | Wait for the result.                                   | Failed batch and existing queue.                                              | On failure.                                                     | Failed items return before later items and the alert is assertive.                          | Node remains in the truthful recoverable state.                | NFR7, NFR10, and additional queue ordering requirement.                        | Steering AD-11 covers no-loss races but not the complete front-restoration presentation. | Story 2.11 covers terminal restoration, not this live delivery failure.         | PARTIAL  |
| MF-062 | Console and Legacy terminal states use `todoEnd`; README Pinned todo strip notes        | Terminal mock states rewrite todo items to all-done or demote the interrupted item.                                    | Node completes or fails.                                                          | Select a terminal state.                               | Pinned todo statuses and count.                                               | At terminal render.                                             | The rendered prototype fabricates a lifecycle-derived todo result.                          | Original recorded todo mutation state is replaced visually.    | FR3 permits state changes only through folded todo calls.                      | Transcript AD-12 item 6 renders core-supplied `TodoPhase[]` unchanged.                   | Story 1.5 AC1–AC3 has no lifecycle rewrite.                                     | CONFLICT |
| MF-063 | State 1 copy and dock refusal table mention separate run-header `Cancel`                | Whole-node Cancel is distinct from Stop and can end the node.                                                          | A node is running or idle-after-interrupt.                                        | Activate the separate Cancel action.                   | Whole node, queue, recovery, and transcript.                                  | Node-level teardown.                                            | Mockup only establishes distinction and does not define the current-scope changed behavior. | Steering state must reconcile after cancellation.              | FR32 requires complete Cancel behavior now.                                    | Steering AD-1 calls Cancel out of scope and untouched.                                   | Stories 2.11–2.12 contain fragments but no complete Cancel story.               | CONFLICT |
| MF-064 | Console and Legacy soft-inject note plus per-item control                               | Mid-turn soft injection causes no interrupt, interrupted tool row, or steering turn-start event.                       | A supported provider is generating.                                               | Activate an item's `Send now`.                         | Selected message and active turn.                                             | Mid-turn.                                                       | Guidance reaches the active turn without changing node or tool outcome.                     | Remaining queue and session continue.                          | FR12 and FR15 require this now.                                                | Steering AD-3 and AD-7 define the behavior but label it spike-gated.                     | G2–G4 are post-v1 backlog entries instead of current stories.                   | CONFLICT |
| MF-065 | Flow race rendered in dock behavior notes                                               | A naturally ending turn auto-drains queued guidance before node completion.                                            | Messages are queued and the turn ends before Stop lands.                          | None.                                                  | Pending queue and next turn.                                                  | At the natural boundary.                                        | Queue becomes the next turn and the interrupt is spent.                                     | Node continues unless the queue is empty.                      | FR8 and additional natural-drain requirement.                                  | Steering AD-4 and AD-11.                                                                 | Story 2.1 AC2 and provider stories.                                             | MATCHED  |
| MF-066 | Queue band in states 1–4 and clean terminal state                                       | Empty queue bands are not rendered.                                                                                    | Queue count becomes zero.                                                         | Drain or withdraw the last item.                       | Queue band only.                                                              | Immediately after confirmed state.                              | Empty chrome disappears and stops pretending there is pending work.                         | Composer or transcript remains.                                | FR8 does not state empty-band suppression.                                     | Steering AD-9 projects controls but does not require this view rule.                     | Stories 2.1, 2.2, and 2.9 have no exact empty-band AC.                          | PARTIAL  |

### Mockup Coverage Statistics

- Total atomic mockup behaviors: 66.
- MATCHED: 42.
- PARTIAL: 12.
- MISSING: 2.
- CONFLICT: 10.
- UNCLEAR: 0.
- Exact matched coverage: 63.6%.

### Warnings

The selected UX is detailed enough to guide the original transcript and in-process steering work, but it does not cover the complete current implementation scope.
The approved mockups also contain behavior that directly conflicts with the later explicit scope decisions for detached steering, durability, current soft injection, Claude delivery confirmation, and whole-node Cancel.
The mockup, PRD-equivalent, architecture, epics, acceptance criteria, and test contracts must be updated together before implementation can proceed without inventing product behavior.

## Epic Quality Review

### Epic Structure Validation

Both defined epics are user-centered rather than technical milestones.
Epic 1 delivers a readable transcript that is useful without Epic 2.
Epic 2 delivers live agent guidance and can use Epic 1 without depending on an undefined later epic.
The formal `_Depends on` relationships point only to earlier stories, and no circular dependency exists.
The project is brownfield, so no starter-template, initial repository, or CI setup story is required.
The original in-process design needs no new table, and Story 2.8 adds metadata only when it is first needed.
However, the current-scope durability requirements require storage decisions and stories that do not exist, so database timing cannot be validated for FR17–FR19 and FR32.

### Dependency Map

- Epic 1 starts with Story 1.1.
- Stories 1.2, 1.3, 1.5, 1.6, and 1.7 depend only on Story 1.1.
- Story 1.4 depends on Stories 1.1 and 1.3.
- Epic 2 starts with Story 2.1.
- Story 2.2 depends on Story 2.1.
- Story 2.3 depends on Stories 1.1 and 2.1.
- Stories 2.4 through 2.7 depend on Story 2.3.
- Story 2.8 depends on Stories 1.1, 2.1, and 2.3.
- Story 2.9 depends on Stories 2.1 and 2.2.
- Story 2.10 depends on Stories 1.7 and 2.9.
- Story 2.11 depends on Stories 2.8 and 2.9.
- Story 2.12 depends on Stories 2.3 and 2.11.
- Story 2.13 depends on Stories 2.8 and 2.9.

The declared dependency graph has no forward edge.
Story 2.1 must own the provider-agnostic same-session turn-loop work required by its natural-boundary AC, as promised by the Epic 2 statement that shared work stays in the first story that needs it.
If that work is instead left for Story 2.3, Story 2.1 gains an undeclared forward dependency and cannot pass independently.

### Story-by-Story Assessment

| Story | User value                                    | Independence and size                                                                                                                                   | Acceptance-criteria quality                                                                                                                                                      | Finding                                                                                                       |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1.1   | Clear scannable transcript value.             | Cohesive and independently deliverable.                                                                                                                 | Specific BDD criteria cover anatomy, five outcomes, fallback, and interruption folding.                                                                                          | COMPLIANT                                                                                                     |
| 1.2   | Clear diagnostic access to original payloads. | Small and depends only on the base row.                                                                                                                 | Covers default state, full-output loading, failure, and JSON exclusivity.                                                                                                        | COMPLIANT                                                                                                     |
| 1.3   | Clear family-shaped expanded details.         | Large because it combines five bodies, four-tier resolution, provider normalization, and a release audit.                                               | Testable, but the release audit and all body families make the story difficult to complete and review as one increment.                                                          | MAJOR SIZE CONCERN                                                                                            |
| 1.4   | Clear inline-diff value.                      | Very large because it combines UX, diff algorithm bounds, sanitization, caching, adapter movement, and extensive edge tests.                            | Detailed and testable, but its scope clause explicitly excludes current-scope Codex `file_change` rows.                                                                          | CRITICAL SCOPE CONFLICT; MAJOR SIZE CONCERN                                                                   |
| 1.5   | Clear current-plan value.                     | Cohesive and independently deliverable after the base row.                                                                                              | Covers both provider folds, pinned state, compact history, and empty-phase removal.                                                                                              | COMPLIANT, subject to mockup conflicts recorded above                                                         |
| 1.6   | Clear delegated-work value.                   | Cohesive and independently deliverable.                                                                                                                 | Covers both provider shapes, context, cards, and malformed data.                                                                                                                 | COMPLIANT                                                                                                     |
| 1.7   | Clear repeated-execution navigation value.    | Cohesive and depends only on the base row.                                                                                                              | Covers grouping key, navigator, and single occurrence, but omits the approved exact `Run N` and `Iteration N` wording, suffix rules, collision qualifiers, and forbidden labels. | MAJOR COMPLETENESS GAP                                                                                        |
| 2.1   | Clear non-interrupting guidance value.        | Epic-sized across web UI, typed routes, authorization, idempotency, registry, shared executor loop, provider boundary delivery, and accessibility.      | Specific for the old process-local floor, but it rejects detached runs and requires process-local queue and tab-local draft contrary to FR16–FR18.                               | CRITICAL SCOPE CONFLICT; MAJOR SIZE CONCERN                                                                   |
| 2.2   | Clear withdrawal value.                       | Small and properly depends on queue creation.                                                                                                           | Covers idempotency, errors, accessibility, and focus, but has no durable-queue or restart-recovery cases.                                                                        | MAJOR CURRENT-SCOPE GAP                                                                                       |
| 2.3   | Clear Claude redirect value.                  | Epic-sized across provider adapter, abort-signal architecture, executor classification, direct and loop paths, state projection, UI, and accessibility. | Detailed for interrupt-then-continue, but omits current-scope Claude soft injection and per-item `Send now`.                                                                     | CRITICAL CURRENT-SCOPE GAP; MAJOR SIZE CONCERN                                                                |
| 2.4   | Clear Codex redirect value.                   | Cohesive provider conformance increment after the shared Claude seam.                                                                                   | Covers abort result and exception classification on direct and loop paths.                                                                                                       | COMPLIANT for redirect, but it does not address current-scope Codex `file_change` persistence owned elsewhere |
| 2.5   | Clear OMP redirect value.                     | Cohesive provider conformance increment.                                                                                                                | The last AC explicitly gates current-scope OMP soft injection behind G4.                                                                                                         | CRITICAL SCOPE CONFLICT                                                                                       |
| 2.6   | Clear Grok redirect value.                    | Cohesive provider conformance increment.                                                                                                                | The last AC explicitly gates current-scope Grok hook soft injection behind G3.                                                                                                   | CRITICAL SCOPE CONFLICT                                                                                       |
| 2.7   | Clear DeepSeek redirect value.                | Cohesive provider conformance increment.                                                                                                                | Covers provider-specific abort marker and direct and loop paths.                                                                                                                 | COMPLIANT for the stated provider floor                                                                       |
| 2.8   | Clear permanent-audit value.                  | Cohesive across persistence, read model, and both renderers, but the reader change must land before writer activation inside the story.                 | Covers metadata, ordering, attribution, and fallback, but explicitly forbids current-scope `delivered` before G1.                                                                | CRITICAL SCOPE CONFLICT                                                                                       |
| 2.9   | Clear multi-operator queue value.             | Cohesive and properly depends on queue and withdrawal.                                                                                                  | Covers convergence and leakage, but explicitly keeps drafts tab-local and the queue process-local instead of durable.                                                            | CRITICAL SCOPE CONFLICT                                                                                       |
| 2.10  | Clear safe finished-iteration value.          | Well-sized and depends on the needed grouping and shared queue.                                                                                         | Specific about entry points, read-only mutations, allowed polling, return to live, and non-live execution.                                                                       | COMPLIANT                                                                                                     |
| 2.11  | Clear no-silent-loss value.                   | Large because it combines observation ledger, terminal evidence, message reconciliation, UI restoration, and accessibility.                             | Testable for the client-observed in-process queue, but cannot recover messages or state across a server restart and therefore cannot satisfy FR17–FR18 or complete FR32.         | CRITICAL CURRENT-SCOPE GAP; MAJOR SIZE CONCERN                                                                |
| 2.12  | Clear abandoned-redirect safety value.        | Large across timer, keepalive API, cancellation polling, retry semantics, reconciliation, and UI.                                                       | Specific for the old in-process design, but incomplete for restart recovery and the expanded whole-node Cancel contract.                                                         | MAJOR CURRENT-SCOPE GAP; MAJOR SIZE CONCERN                                                                   |
| 2.13  | Clear concurrent attribution value.           | Cohesive and properly depends on persistence and shared queue.                                                                                          | Specific integration assertions cover order, identity, and isolation.                                                                                                            | COMPLIANT for in-process concurrency                                                                          |

### Critical Violations

1. The epic set implements only the original in-process scope and does not contain implementation stories for FR14–FR33.
   This breaks the requirement that every current FR has a traceable implementation path.

2. G1–G4 are placed outside both epics under `Post-v1 gated backlog`.
   The user explicitly made all four mechanisms current scope, so backlog status, external-gate wording, and non-blocking wording are invalid.

3. Story 1.4 explicitly excludes successful Codex `file_change` rows as separately tracked work.
   This is mutually exclusive with current-scope FR14.

4. Story 2.1 rejects detached runs and commits to process-local queue state and tab-local unsent drafts.
   These ACs are mutually exclusive with FR16–FR18.

5. Stories 2.3, 2.5, and 2.6 omit or explicitly gate the required Claude, OMP, and Grok soft-inject paths and the per-item delivery action.
   They cannot satisfy FR12 and FR15.

6. Story 2.8 explicitly holds every message at `sent` before G1.
   This is mutually exclusive with current-scope FR13.

7. No story defines auto-send, RunStream, Chat, backend formatting, Files Changed, broader Git attribution, qodercli, pi, Copilot, OpenCode, thinking, triggering prompts, advisor notifications, whole-node Cancel changes, or individual-tool cancellation.
   This leaves FR19–FR33 without acceptance criteria, dependencies, test ownership, or delivery order, except partial Cancel fragments in Stories 2.11 and 2.12.

### Major Issues

1. Stories 1.3, 1.4, 2.1, 2.3, 2.11, and 2.12 span too many independent implementation and verification concerns for reliable completion as single stories.
   They should be split along observable vertical outcomes while preserving backward-only dependencies.

2. Story 1.7 does not encode the approved occurrence-header language or collision behavior.
   An implementer can satisfy its ACs while shipping forbidden `Pass`, reason-only, or `Attempt` labels.

3. G1–G4 are acceptance snippets rather than complete stories.
   They lack user-story framing, explicit dependencies, error cases, both-surface criteria, provider conformance ownership, and test acceptance.

4. Durable storage is absent rather than introduced by the first story that needs it.
   FR17–FR19 and FR32 therefore have no validated entity-creation timing, upgrade path, recovery ownership, or rollback path.

5. The current test-plan traceability stops at the old feature floor.
   No story owns test acceptance for the nineteen missing FRs or the complete current-scope behavior of FR12, FR13, and FR32.

### Minor Concerns

- The coverage map and story references use `v1 floor`, `post-v1`, and gate terminology that no longer matches the current scope decision.
- Several AC blocks combine multiple independently failing expectations in one `Then` chain, which will make failure diagnosis harder even when the behavior is testable.
- Story 2.4 notes the Codex redirect path but gives no cross-reference to the separate current-scope Codex `file_change` ingestion need, which increases delivery-order risk.

### Best-Practices Compliance Checklist

| Check                                             | Epic 1                                           | Epic 2                                                  | Current-scope result                 |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------ |
| Epic delivers user value.                         | Pass.                                            | Pass.                                                   | Pass.                                |
| Epic can function without a later epic.           | Pass.                                            | Pass.                                                   | Pass.                                |
| Stories are appropriately sized.                  | Fail for Stories 1.3 and 1.4.                    | Fail for Stories 2.1, 2.3, 2.11, and 2.12.              | Fail.                                |
| No forward dependency exists.                     | Pass.                                            | Pass if Story 2.1 owns its declared shared engine work. | Conditional pass.                    |
| Data structures are introduced when first needed. | Pass for the original read-only scope.           | Pass for metadata, but durable entities are absent.     | Fail.                                |
| Acceptance criteria are clear and complete.       | Fail for occurrence wording and Codex ingestion. | Fail for G1–G4 and FR16–FR33.                           | Fail.                                |
| Traceability to every FR is maintained.           | Fail.                                            | Fail.                                                   | Fail, with 22 FRs not fully covered. |

### Remediation

1. Replace the `Post-v1 gated backlog` with current, numbered stories for G1–G4 and connect them to FR12, FR13, and FR15.
2. Add stories for every missing FR14–FR33 before implementation planning continues.
3. Correct Story 2.1, Story 2.9, and all dependent stories for detached execution, durable state, and restart recovery.
4. Split the oversized stories by independently demonstrable user outcomes without creating forward dependencies.
5. Add the exact approved occurrence-header vocabulary and collision rules to Story 1.7.
6. Give each new story explicit happy-path, error, race, accessibility, security, restart, and test acceptance criteria where applicable.
7. Rebuild the coverage map after the PRD-equivalent, architecture, UX, epics, stories, and test plans use one current scope.

## Scope Decision Audit

The user made one controlling scope decision on 2026-09-21: every approved-mockup behavior and every listed capability is current implementation scope, and no artifact may classify one as future, post-v1, later, deferred, gated, optional, stretch, removed, superseded, or out of scope unless the user explicitly makes that decision.
The user also directed this audit to mark every contrary non-goal or deferred label as a conflict.

| Audit ID | Label and exact artifact locations                                                                                                                                                                                                                                | Classification                                                                | Explicit user decision citation                                                                                                                                                               | Result                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| SD-01    | Handoff README `Read these first` says the earlier readable-transcript and live-steering specs are `superseded`; README `Files in this bundle` says the earlier static mockups are superseded by this bundle.                                                     | Document lineage, not product scope.                                          | The user selected target `agent-node-room`, chose the consolidated document set, and supplied the four bundle URLs for the rendered audit.                                                    | VERIFIED                                                                           |
| SD-02    | Steering architecture frontmatter says the prior durable pause/marker/re-entry design is `superseded`.                                                                                                                                                            | Historical architecture alternative.                                          | The user requires durable steering and restart recovery, but did not require steering to pause the whole run; Stop remains a turn interrupt and Cancel remains node-level.                    | VERIFIED only for rejecting pause-as-steering; it cannot exclude FR16–FR18 or FR32 |
| SD-03    | `tool-presentation-contract.md` says `TOOL_CONTEXT_KEYS` and `toolContext()` are superseded by the resolver.                                                                                                                                                      | Internal implementation replacement, not product-scope removal.               | Current FR1–FR2 require the resolver behavior and do not require the obsolete helper.                                                                                                         | VERIFIED                                                                           |
| SD-04    | Handoff README marks the prototype todo placement as superseded by top placement.                                                                                                                                                                                 | Product-view override.                                                        | The user says every visible approved-mockup behavior is current scope, while the rendered Console and Legacy prototypes still show the todo strip below the transcript.                       | CONFLICT until the approved mockups and canonical UX show one placement            |
| SD-05    | Handoff README marks the filled Legacy send note as superseded; `DESIGN.md` marks the earlier 4.3:1 error treatment as superseded.                                                                                                                                | Visual corrections already present in the approved HTML or final design.      | The approved Console and Legacy HTML files use bordered controls, and final `DESIGN.md` requires the corrected contrast.                                                                      | VERIFIED                                                                           |
| SD-06    | `SPEC.md` Read half says schema, migration, backend, and persisted-data work are out of scope; Story 1.4 separately tracks successful Codex `file_change` rows.                                                                                                   | Normative scope exclusion.                                                    | The user explicitly requires successful Codex `file_change` rows, backend presentation alignment, durable state, additional transcript content, and other persistence-dependent behavior now. | CONFLICT                                                                           |
| SD-07    | `SPEC.md` Constraints and Open Questions, provider matrix, `EXPERIENCE.md`, handoff README, both room HTML notes, Epic coverage map, Stories 2.5–2.6, and the Epic `Post-v1 gated backlog` label G1–G4 as gated, spike-gated, post-v1, or deferred.               | Normative release-scope exclusion.                                            | The user explicitly requires G1 delivered, G2 Claude soft injection and per-item Send now, G3 Grok soft injection, and G4 OMP soft injection now.                                             | CONFLICT                                                                           |
| SD-08    | `SPEC.md` and steering architecture AD-1 and Deferred say whole-node Cancel is out of scope or untouched; `SPEC.md` Non-goals excludes individual-tool cancellation.                                                                                              | Normative scope exclusion.                                                    | The user explicitly requires whole-node Cancel changes and individual-tool cancellation now.                                                                                                  | CONFLICT                                                                           |
| SD-09    | `SPEC.md` Non-goals, provider matrix, engine integration, steering architecture AD-5 and Deferred, `EXPERIENCE.md`, and mock state 8 defer detached steering and restart survival and reject durable steering state.                                              | Normative scope and architecture exclusion.                                   | The user explicitly requires steering detached runs, surviving server restarts, durable draft queues, and active continuation recovery now.                                                   | CONFLICT                                                                           |
| SD-10    | `SPEC.md` Non-goals excludes persisted draft queues and auto-send mode.                                                                                                                                                                                           | Normative scope exclusion.                                                    | The user explicitly requires durable draft queues and auto-send mode now.                                                                                                                     | CONFLICT                                                                           |
| SD-11    | `SPEC.md` Non-goals excludes RunStream, Chat, backend tool formatting, Files Changed, and broader Git attribution; `tool-presentation-contract.md` says Chat can adopt later; readable-transcript architecture Deferred calls Chat a separate slice and non-goal. | Normative scope exclusion and deferral.                                       | The user explicitly requires RunStream, Chat, backend tool-card presentation, run-level Files Changed, and broader node-level Git attribution now.                                            | CONFLICT                                                                           |
| SD-12    | `SPEC.md` Non-goals excludes qodercli, pi, Copilot, and OpenCode steering; steering architecture Deferred delays per-provider soft injection beyond its original set.                                                                                             | Normative provider-scope exclusion.                                           | The user explicitly requires steering for all four providers now, in addition to current Claude, Codex, OMP, Grok, and DeepSeek behavior.                                                     | CONFLICT                                                                           |
| SD-13    | `SPEC.md` Non-goals excludes agent thinking, triggering prompts, and advisor notifications as the rest of Track B.                                                                                                                                                | Normative transcript-scope exclusion.                                         | The user explicitly requires all three transcript sources now.                                                                                                                                | CONFLICT                                                                           |
| SD-14    | Readable-transcript architecture Deferred lists resolver memoization, an error boundary, Legacy deletion, parent-spine wording, and long-transcript virtualization.                                                                                               | Technical alternatives that do not remove a current requested behavior.       | The user's no-deferral rule prevents these labels from cutting any listed or visible behavior, but none of these alternatives is itself a listed or visible product feature.                  | NO CURRENT-SCOPE EFFECT; labels are not authority for later scope cuts             |
| SD-15    | Steering architecture Deferred lists the operator-row item kind as owned by the transcript update and lists deploy, environment, and infrastructure work as able to wait.                                                                                         | Work ownership and topology assumptions.                                      | Operator-row presentation is current under FR11 and Story 2.8; detached and durable steering are current and may require architecture changes regardless of the old no-topology assumption.   | PARTIAL / CONFLICT where the labels obstruct current behavior                      |
| SD-16    | `DESIGN.md` calls a distinct code-family hue out of scope.                                                                                                                                                                                                        | Rejected visual alternative, not removal of the visible code-family behavior. | The approved mockup uses the existing shell/code hue, and no current requirement asks for a new code hue.                                                                                     | VERIFIED for the current visible treatment                                         |
| SD-17    | Incidental words such as optional schema fields, later transcript rows, removed queue items, future tool names, and `removed-*` token identifiers appear in contracts and mockups.                                                                                | Grammar, sequence, data semantics, or identifiers rather than scope labels.   | They do not classify a feature or behavior as outside the implementation.                                                                                                                     | NOT A SCOPE LABEL                                                                  |

All contrary feature-scope labels have an explicit user decision and are recorded as conflicts.
No scope question remains unanswered.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY**

The planning set is not implementation-ready for the approved current scope.
Only 11 of 33 FRs have complete current-scope epic coverage.
Three FRs are only partially covered under conflicting gate or Cancel assumptions, and 19 FRs are missing or expressly excluded.
The mockup matrix has 42 MATCHED rows and 24 non-matching rows, including 10 direct conflicts.
The customization rule requires NOT READY while any matrix row is not MATCHED or lacks exact PRD, Architecture, and Epic or Story coverage.

### Critical Issues Requiring Immediate Action

1. The canonical PRD-equivalent still defines a smaller product than the user approved.
   It excludes Codex `file_change`, G1–G4, durable and detached steering, additional surfaces, additional providers, additional transcript content, Cancel changes, and individual-tool cancellation.

2. The architecture is incompatible with required cross-process and restart-safe behavior.
   AD-5 makes the live registry process-local and non-durable, while current scope requires detached routing, durable pending state, recovery, and restart survival.

3. The approved mockups and canonical UX disagree with current product decisions.
   Detached state still refuses steering, drafts and queues still use non-durable semantics, current soft injection and delivery confirmation are called gated, terminal todo state is fabricated in the prototype, and todo placement differs.

4. Epic and story traceability is incomplete.
   Twenty-two FRs lack complete current-scope story coverage, and G1–G4 remain outside the epics.

5. The selected test plans do not cover the full implementation contract.
   There is no accepted test ownership for FR14, FR19–FR31, FR33, or the complete durability, restart, detached, Cancel, and delivery behavior of FR12, FR13, FR16–FR18, and FR32.

6. Several existing stories are too large for safe independent delivery.
   Stories 1.3, 1.4, 2.1, 2.3, 2.11, and 2.12 combine multiple cross-module outcomes and verification domains.

### Recommended Next Steps

1. Rewrite the PRD-equivalent and every affected companion contract so all 33 FRs are current scope and every contrary non-goal, gate, deferral, and process-local assumption is removed or replaced.
2. Update the approved mockups first for the product decisions that changed visible behavior, including steerable detached runs, durable and restart-safe states, auto-send, all additional presentation surfaces, all additional providers, new transcript sources, whole-node Cancel, and individual-tool cancellation.
3. Resolve the todo presentation conflicts by making the approved HTML, UX, PRD, architecture, and stories agree on top placement, no inline duplicate checklist, and no lifecycle-fabricated status rewrite.
4. Replace the two architecture spines or amend them with complete decisions for cross-process routing, durable queues and drafts, restart recovery, provider capabilities, new transcript persistence and privacy, all required presentation surfaces, Git attribution, Cancel, and tool cancellation.
5. Replace G1–G4 with current numbered stories and add numbered stories for FR14–FR33, with backward-only dependencies and exact acceptance criteria.
6. Split the six oversized stories along independently demonstrable user outcomes and preserve a runnable vertical increment after each story.
7. Expand the test plans with unit, integration, both-surface, provider-conformance, restart, detached-process, race, accessibility, security, durability, recovery, and end-to-end coverage for every current FR.
8. Re-run implementation readiness only after the traceability map reaches 33 of 33 FRs and the updated mockup matrix has no PARTIAL, MISSING, CONFLICT, or UNCLEAR row.

### Final Note

This assessment identified six blocking issue classes across requirements, UX and mockups, architecture, epic coverage, story quality, and test coverage.
The evidence includes 22 FRs without complete current-scope story coverage and 24 non-matching atomic mockup rows.
Implementation should not start from the present artifacts because teams would have to invent behavior or follow requirements that directly contradict the approved scope.

**Assessment date:** 2026-09-21.
**Assessor:** Codex, applying the BMAD implementation-readiness workflow and the project-specific mockup and scope rules.
