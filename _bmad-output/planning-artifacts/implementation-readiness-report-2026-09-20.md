---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
targetSlug: agent-node-room
assessmentBoundary: _bmad-output/specs/spec-agent-node-room/
inputDocuments:
  - _bmad-output/specs/spec-agent-node-room/SPEC.md
  - _bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md
  - _bmad-output/specs/spec-agent-node-room/todo-fold-contract.md
  - _bmad-output/specs/spec-agent-node-room/test-plan.md
  - _bmad-output/specs/spec-agent-node-room/engine-integration.md
  - _bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md
  - _bmad-output/specs/spec-agent-node-room/control-states.md
  - _bmad-output/specs/spec-agent-node-room/steering-api-contract.md
  - _bmad-output/specs/spec-agent-node-room/steering-test-plan.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - claude-design/design_handoff_node_room_transcript_steering/README.md
  - claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html
  - claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html
  - claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html
  - claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html
  - claude-design/design_handoff_node_room_transcript_steering/support.js
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-20
**Project:** Archon
**Target:** `agent-node-room`
**Branch:** `develop`

## Document Discovery

### PRD and Requirements Files

**Canonical document:**

- `_bmad-output/specs/spec-agent-node-room/SPEC.md` — 33,169 bytes, modified 2026-09-20 11:55:01 +0700.

**Target companion documents:**

- `tool-presentation-contract.md` — 25,185 bytes, modified 2026-09-20 01:47:16 +0700.
- `todo-fold-contract.md` — 5,974 bytes, modified 2026-09-18 23:45:15 +0700.
- `test-plan.md` — 13,693 bytes, modified 2026-09-20 01:47:16 +0700.
- `engine-integration.md` — 18,388 bytes, modified 2026-09-17 17:55:05 +0700.
- `provider-steering-matrix.md` — 10,762 bytes, modified 2026-09-17 17:55:05 +0700.
- `control-states.md` — 12,592 bytes, modified 2026-09-20 11:55:01 +0700.
- `steering-api-contract.md` — 11,287 bytes, modified 2026-09-20 11:55:01 +0700.
- `steering-test-plan.md` — 12,731 bytes, modified 2026-09-20 17:58:20 +0700.

The earlier readable-transcript and live-steering source specifications are superseded and excluded.

### Architecture Files

The target has two complementary Architecture documents.
They cover the read and write scopes of the merged target.

- `architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` — 36,188 bytes, modified 2026-09-20 11:55:01 +0700.
- `architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` — 45,217 bytes, modified 2026-09-20 17:58:20 +0700.

No whole-versus-sharded Architecture duplicate exists for this target.

### Epics and Stories Files

- `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` — 40,589 bytes, modified 2026-09-20 11:55:01 +0700.

Previous readiness reports and sprint change proposals in this folder are workflow outputs, not canonical source documents.
No whole-versus-sharded Epics duplicate exists for this target.

### UX Design Files

The target has two complementary UX documents.

- `ux-Archon-agent-node-room-2026-09-09/DESIGN.md` — 63,403 bytes, modified 2026-09-20 11:55:01 +0700.
- `ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` — 189,839 bytes, modified 2026-09-20 11:55:01 +0700.

No whole-versus-sharded UX duplicate exists for this target.

### Approved Mockup Handoff

The approved handoff is `claude-design/design_handoff_node_room_transcript_steering/`.

- `README.md` — 31,964 bytes, modified 2026-09-18 23:45:15 +0700.
- `Console Node Room.dc.html` — 67,725 bytes, modified 2026-09-17 17:55:05 +0700.
- `Legacy Node Room.dc.html` — 65,371 bytes, modified 2026-09-17 17:55:05 +0700.
- `Transcript States.dc.html` — 67,304 bytes, modified 2026-09-17 17:55:05 +0700.
- `Steering Dock States.dc.html` — 44,333 bytes, modified 2026-09-17 17:55:05 +0700.
- `support.js` — 69,150 bytes, modified 2026-09-17 17:55:05 +0700.

Earlier static mockups are superseded and excluded.

### Discovery Result

All required document types exist.
All selected documents share the `agent-node-room` lineage.
No unresolved duplicate format or missing source blocks the assessment.

## PRD Analysis

### Functional Requirements

**FR1 — Scan a node without expanding tool calls.**
A node with forty tool calls must render forty single-line rows.
Each row must show a family chip, a status glyph, a headline that names the salient argument, and right-aligned badges.
Successful calls must be collapsed on first render, failed calls must be expanded, and collapsed rows must contain no serialized-data punctuation.
Source: `SPEC.md`, CAP-1.

**FR2 — Render a family-specific expanded body.**
Every tool family must render the body arm declared in `tool-presentation-contract.md`.
An unmatched tool must render no more than three scalar `key: value` pairs, must represent objects and arrays as `{…}` and `[n]`, and must never render a JSON dump.
The generic fallback must account for less than 2% of logical tool cards in the production corpus.
Source: `SPEC.md`, CAP-2; `tool-presentation-contract.md`; `test-plan.md`, “Generic-fallback corpus audit.”

**FR3 — Project todo calls into current checklist state.**
Claude and OMP todo payloads must normalize to one `TodoPhase[]` shape according to `todo-fold-contract.md`.
Each todo call must remain a one-line transcript row, while the current checklist must appear only in one collapsible pinned Todo strip at the top of the transcript panel.
The strip must stay visible while the transcript scrolls, must be absent when the node has no todos, and must omit phases emptied by `rm`.
Source: `SPEC.md`, CAP-3; `todo-fold-contract.md`.

**FR4 — Present task dispatches as normalized subtasks.**
Claude and OMP task payloads must normalize to `TaskSubtask[]`.
The expanded body must render provider-supplied batch context as Markdown and must render one collapsible card per subtask with its subtask name and agent.
Source: `SPEC.md`, CAP-4; `tool-presentation-contract.md`, “task → TaskSubtask[].”

**FR5 — Present file edits honestly as inline diffs or previews.**
A persisted file-tool row must render a line diff through `react-diff-view` only when both before and after values are own-property strings.
An empty string is a valid side, but inherited keys, throwing accessors, wrong types, one-sided inputs, and alias-shaped inputs on non-file families must not qualify.
A nonqualifying or refused pair must fall back to path plus preview, and the system must never fabricate a diff from one side.
The diff must use deterministic input, line, edit-length, memoization, line-number, no-newline-marker, and display-sanitization bounds from `tool-presentation-contract.md`, while Raw must preserve the original payload.
Current nonpersisted Codex `file_change` events are outside this capability and must not be represented by a fake Codex fixture.
Source: `SPEC.md`, CAP-5; `tool-presentation-contract.md`, “Inline diff”; `test-plan.md`, CAP-5 sections.

**FR6 — Distinguish transcript occurrences and loop iterations.**
Rows that span multiple `occurrence_id` values must render one header per occurrence group, while a single-occurrence node must render no group header.
Grouping must use `occurrence_id`, never `attempt_id`.
A loop-iteration selector must navigate between occurrence groups and must be absent for a single occurrence.
When an operator selects a finished iteration of a live loop through the Execution controls, the dock must become read-only, show a collapsed disclosure and `Go to iteration N`, mirror the node-scoped pending queue, omit the composer, allow the queue GET, and issue no send, withdraw, or interrupt mutation.
Source: `SPEC.md`, CAP-6; `tool-presentation-contract.md`, “Occurrence grouping”; `control-states.md`, “Viewing a finished iteration.”

**FR7 — Keep original provider payloads reachable.**
Every tool card must provide a Raw toggle that is closed by default and reveals the original JSON.
Raw must be the only location where serialized tool input or output JSON appears.
The existing `canLoadFullOutput` and `onLoadFullOutput` flow must continue to work.
Source: `SPEC.md`, CAP-7.

**FR8 — Let an operator compose and queue while the agent generates.**
The composer must stay mounted and enabled while the node runs, and its send control must read `Queue` while the agent generates.
Pressing `Queue` must submit the message immediately to the server-side registry with `intent: 'queue'` without interrupting the agent.
The executor must deliver queued messages at the next natural turn boundary.
Only the unsubmitted composer draft may be tab-local; accepted queued messages must be node-scoped, visible to all permitted tabs and operators, survive a tab close, and disappear on a server restart.
Source: `SPEC.md`, CAP-8; `control-states.md`; `steering-api-contract.md`.

**FR9 — Interrupt the current agent turn without stopping the node.**
The dock must provide a Stop control that ends the current provider turn through the provider interrupt primitive or a per-turn stream abort while preserving the live session.
The node must remain `running`, project `idle-after-interrupt`, and never move to paused, pending, or failed because of the steering interrupt.
The interrupted tool call must render as `⚠ interrupted`, and the existing node-level Cancel action must remain separate and unchanged.
The interface must not suggest that Stop rolls back completed file writes.
Source: `SPEC.md`, CAP-9; `engine-integration.md`; `control-states.md`.

**FR10 — Redirect the same live session after interruption.**
When the agent is `idle-after-interrupt`, the send control must read `Send now`.
The newly typed message must join the already accepted queue, and the executor must flush all messages in server receipt order as the next turn on the same provider session through the existing resume seam.
The interrupted turn must not be validated or completed.
An interrupted node must drain only after `Send now`, while a naturally ended turn must auto-drain a nonempty queue or complete when the queue is empty.
Both controls must follow the projected agent sub-state, never a remembered operator mode.
Source: `SPEC.md`, CAP-10; `engine-integration.md`; `control-states.md`.

**FR11 — Persist the operator exchange in transcript order.**
The executor must write each delivered operator message as an ordinary text row with strict metadata `origin: 'operator'`, `operator_user_id`, and `message_id`.
The executor must also write the interrupted status evidence needed to fold `⚠ interrupted` into the preceding tool call on every provider.
The operator row and interrupted call must appear in the order in which they occurred, and the operator row must be visually distinct from agent text.
The read model must derive `operator_display_name` at response time, with the current trimmed display name or the first eight id characters for a non-null sender and `null` only for an identity-less row.
Source: `SPEC.md`, CAP-11 and “Cross-half dependency”; `steering-api-contract.md`, “Transcript operator row”; `steering-test-plan.md`, “Operator row and reconciliation.”

**FR12 — Deliver ordinary prompts at the fastest verified provider boundary.**
Every in-use provider must support the universal v1 floor of interrupt plus noninterrupting Queue delivery at the next natural turn boundary.
Only a provider with an exercised transport may add soft-inject before turn-end, and that path must not create an interrupted tool call or a turn-start event.
Claude soft-inject must remain spike-gated until streaming input is verified with session resume.
No provider may be excluded from v1 because it lacks soft-inject.
Source: `SPEC.md`, CAP-12; `provider-steering-matrix.md`.

**FR13 — Report only verified message-delivery state.**
An accepted message must read `sent` until the provider echoes its caller-stamped id, and only then may it read `delivered`.
Correlation must use the id only, never message text or timestamps.
At the current Claude SDK pin 0.3.209, every provider must remain at `sent` because the required Claude echo needs version 0.3.246 or later.
Claude-only `delivered` is a post-v1 gated capability after that SDK upgrade.
Source: `SPEC.md`, CAP-13; `provider-steering-matrix.md`.

**Total functional requirements: 13.**

### Non-Functional Requirements

**NFR1 — Package boundaries.**
`@archon/web` must not import `@archon/workflows`, Console code must not import `@/components/`, shared logic must stay in `packages/web/src/lib/`, and the two surfaces must use thin separate JSX.

**NFR2 — Surface parity.**
Legacy and Console node rooms must ship together and must receive equivalent behavior and verification.

**NFR3 — Type and lint quality.**
The implementation must use strict TypeScript, must contain no unjustified `any`, must produce zero ESLint warnings, and must pass `bun run validate` before a pull request.

**NFR4 — Retroactive read behavior.**
The read half must add no schema, migration, or backend change and must improve already stored runs without a rerun.

**NFR5 — Lossless presentation.**
Serialized JSON must never be the default tool presentation, and unclassifiable or noncanonical assistant text must render its original bytes unchanged.
The projector must not mutate stored rows, API output, or structured engine results.

**NFR6 — Accessible status and controls.**
Status must be understandable without color, the transient Stopping control must use `aria-disabled` rather than the native `disabled` attribute, transitions must have suitable live-region behavior, delivery failure must use an assertive alert, focus must never fall to the document body, Enter must insert a newline, and reduced-motion preferences must be respected.

**NFR7 — Stable tool identification.**
Tool names may appear as chips only when they are single tokens of at most 24 characters.
Resolver matching must use exact aliases and structural evidence, never substring matching, and provider shape differences must normalize at the edge instead of branching in renderers.

**NFR8 — Bounded rendering work.**
Expanded output must apply the declared 65,536-code-unit text limit, 500-item output limit, 2,000-entry inspection limit, 1,024-code-unit path and value limits, 32-field inspection limit, 128-code-unit key limit, and visible truncation metadata.

**NFR9 — Deterministic and safe diffing.**
Diff construction must apply deterministic byte, line, and edit-length limits with no wall-clock timeout, preserve real positive snippet-relative line numbers, handle no-newline markers in place, sanitize display controls, and use dual-bounded LRU memoization of at most 256 entries and 1,048,576 retained source code units.

**NFR10 — Process-local steering boundary.**
Steering must use an in-process `(runId, nodeId)` live-handle registry and must not add durable steering state.
A detached or restarted executor is not steerable in v1, and the interface must disclose that limitation without mutating the nonterminal node.

**NFR11 — Lifecycle safety.**
Steering must use a fresh per-turn abort signal composed with the node Cancel signal.
Cancel must dominate an operator interrupt, and natural result, abort-marked result, abort throw, real failure, and Cancel must follow the five-case end-cause rule on both normal and loop nodes.

**NFR12 — Idle-await reliability.**
Idle-after-interrupt must have a fresh 30-minute inactivity timer that an authorized composing keepalive can re-arm.
Exactly one of Send now, cancel polling, or expiry may resolve the wait, expiry must fail with `interrupted by operator, no redirect received`, and retry after expiry must start a fresh session.

**NFR13 — Authentication and attribution.**
Steering routes must resolve identity with `resolveAuthContext`, allow any authenticated identity and an identity-less solo run, reject unauthenticated calls, and preserve the originating `operator_user_id` through queue acceptance and transcript projection.

**NFR14 — Typed API behavior.**
All five routes must use `registerOpenApiRoute(createRoute(...), handler)` with generated web types, one structured error shape, the declared HTTP status codes, UUID correlation, and no body or undeclared query fields on bodyless operations.

**NFR15 — Atomicity, idempotency, and race safety.**
Duplicate sends, repeated idle interrupts, and withdrawals of drained or unknown ids must be idempotent.
Rejected requests must leave the node, queue, and transcript unchanged, and mutation-generation handling must prevent an older queue snapshot from erasing a client’s successful send or withdrawal.

**NFR16 — Queue privacy and cache safety.**
Queue reads must expose only ordered `{ message_id, message }` values, must use `Cache-Control: no-store` for success and errors, must not log operator message text, and must not write run, event, message, or pending-interaction data.

**NFR17 — Concurrent-operator ordering.**
Global order must be the registry handle’s acceptance order, not client timestamps or response order.
Attribution must never move between senders, and queues are deliberately shared by permitted operators rather than split by user.

**NFR18 — Provider conformance.**
Claude, Codex, OMP, Grok, and DeepSeek must each prove that interrupt ends the current turn and preserves a follow-up session, with provider-specific terminal shapes classified correctly.

**NFR19 — Verification quality.**
Every applicable table must include at least one Claude fixture and one OMP or Codex fixture, timer tests must use fake time, process-boundary tests must cover live and detached execution, and both shells must receive unit, integration, E2E, accessibility, and visual checks at their required widths.

**NFR20 — Corpus quality gate.**
The generic fallback fraction must be measured by a read-only deployment replay over one logical UI card per invocation, must use exact integer threshold comparison, and must fail the release gate when the fraction is at least 2%.

**NFR21 — Honest release scope.**
The v1 gate is interrupt plus Queue with `sent` status on every current provider.
Claude delivered state, Claude soft-inject, OMP soft-inject, and Grok hooks are independent post-v1 gates and must not be presented as v1 behavior.

**Total non-functional requirements: 21.**

### Additional Requirements

- The tool-presentation resolver must apply its four ordered tiers, preserve sent tool names for display, use the documented family-specific path and grep rules, carry exit codes into collapsed badges, and remove the superseded `TOOL_CONTEXT_KEYS` path.
- `projectTodoState()` must implement Claude last-call-wins and all nine OMP operations, infer the two documented missing-op forms, apply mutation auto-promotion, accept legacy batches atomically, reject malformed calls atomically, preserve unknown-op state, and remove empty phases.
- The send route request is `{ message, message_id, intent }`, where `message` is nonempty, `message_id` is a UUID, and `intent` is `queue` or `send_now`.
- Interrupt and keepalive use empty request bodies, withdraw uses the path `messageId`, and queue read has no body or query parameters.
- Send must return the original id and `queued` or `awaiting_send_now`; interrupt must return `idle-after-interrupt` or `generating`; queue read must return only the ordered pending queue; and all failures must use `{ success: false, error: { code, message } }`.
- Error handling must distinguish unknown ids as 404 `not_found`, invalid input as 400 `invalid_request`, finished nodes as 409 `node_finished`, and a known nonterminal node without an in-process handle as 422 `not_steerable_here`.
- Parked handles may expose and withdraw retained queue rows, but must refuse new sends, while closed handles must report node completion.
- Terminal reconciliation must run only on exact node-terminal evidence and must restore unmatched observed ids as `Never sent`; it must not run on live refresh or run-level terminal status alone.
- A finished live-loop iteration may poll the node queue but must not issue steering mutations, and a different non-live execution must show no dock.
- The cross-half implementation order must add operator-row recognition and cross-provider interrupted-status folding before the write half emits those rows.
- Test commands must use the project’s isolated package scripts and `bun run validate`; root `bun test` is forbidden.
- Code comments and test names must describe behavior and must not carry plan, section, or finding identifiers.

### Constraints and Non-Goals

- Node Cancel, individual-tool cancellation, detached-run steering, restart survival, durable draft queues, auto-send mode, unrelated RunStream and Chat tool cards, backend tool formatting, run-level file panels, unused providers, agent thinking, triggering prompts, and advisor notifications are outside this target.
- Successful Codex file changes that are not persisted as transcript rows are separate work and are not evidence for CAP-5.
- No steering delivery may emit a turn-start event.
- No message may advance to delivered by matching prose, timestamps, or any value other than its stamped id.

### PRD Completeness Assessment

The canonical specification and its eight requirement companions define all 13 capabilities, the v1 boundary, provider behavior, lifecycle rules, public API shapes, test obligations, and explicit non-goals.
The unresolved soft-inject and delivery-confirmation items are explicitly assigned to independent post-v1 gates, so they do not make the v1 scope ambiguous.
The corpus is sufficiently complete for epic coverage validation.
Implementation readiness still depends on whether the architecture, UX, epics, stories, and approved mockups agree with these requirements at atomic behavior level.

## Epic Coverage Validation

### Epic FR Coverage Extracted

- FR1 is covered by Story 1.1.
- FR2 is covered by Story 1.3.
- FR3 is covered by Story 1.5.
- FR4 is covered by Story 1.6.
- FR5 is covered by Story 1.4.
- FR6 is covered by Stories 1.7 and 2.10.
- FR7 is covered by Story 1.2.
- FR8 is covered by Stories 2.1, 2.2, 2.9, and 2.10.
- FR9 is covered by Stories 2.3 through 2.7.
- FR10 is covered by Stories 2.3 through 2.7.
- FR11 is covered by Stories 2.8, 2.11, and 2.13.
- FR12 v1 is covered by Stories 2.1 and 2.3 through 2.7, while post-v1 soft-inject is assigned to G2 through G4.
- FR13 v1 is covered by Story 2.8, while post-v1 Claude delivery confirmation is assigned to G1.

The epics document claims all 13 functional requirements.
The detailed comparison confirms those claims, with Story 2.10 supplying the finished-iteration part of FR6 and Story 2.11 supplying the terminal-reconciliation part of FR11.

### Coverage Matrix

| FR   | PRD requirement                                                                                                    | Epic and story coverage                                         | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------- |
| FR1  | Scannable one-line tool rows with truthful status, headline, badges, and initial expansion.                        | Epic 1, Story 1.1.                                              | Covered |
| FR2  | Family-specific expanded bodies and a measured generic fallback below 2%.                                          | Epic 1, Story 1.3.                                              | Covered |
| FR3  | Provider-neutral current todo state in one pinned strip.                                                           | Epic 1, Story 1.5.                                              | Covered |
| FR4  | Normalized task dispatch context and per-subtask cards.                                                            | Epic 1, Story 1.6.                                              | Covered |
| FR5  | Honest bounded inline file diffs with preview fallback.                                                            | Epic 1, Story 1.4.                                              | Covered |
| FR6  | Occurrence grouping, loop navigation, and read-only finished-iteration behavior.                                   | Epic 1, Story 1.7; Epic 2, Story 2.10.                          | Covered |
| FR7  | Closed-by-default Raw access with full-output preservation.                                                        | Epic 1, Story 1.2.                                              | Covered |
| FR8  | Live composer, process-local ordered queue, withdrawal, cross-view convergence, and finished-iteration queue view. | Epic 2, Stories 2.1, 2.2, 2.9, and 2.10.                        | Covered |
| FR9  | Per-turn interruption that preserves the session and running node across all in-use providers.                     | Epic 2, Stories 2.3 through 2.7.                                | Covered |
| FR10 | Same-session ordered redirect after interruption for all in-use providers.                                         | Epic 2, Stories 2.3 through 2.7.                                | Covered |
| FR11 | Ordered operator and interrupted rows, sender attribution, terminal recovery, and concurrent attribution.          | Epic 2, Stories 2.8, 2.11, and 2.13.                            | Covered |
| FR12 | Universal Queue and interrupt floor, with provider-gated soft-inject.                                              | Epic 2, Stories 2.1 and 2.3 through 2.7; backlog G2 through G4. | Covered |
| FR13 | `sent` at the v1 floor and id-confirmed Claude `delivered` after its external gate.                                | Epic 2, Story 2.8; backlog G1.                                  | Covered |

### Missing Requirements

No functional requirement is absent from the epics and stories document.
No epic functional requirement exists outside the canonical 13-requirement set.

The epics document’s compact FR Coverage Map lists only Story 1.7 for FR6 and only Stories 2.8 and 2.13 for FR11.
The story bodies supply the remaining coverage through Story 2.10 and Story 2.11 respectively, so this is a map-detail omission rather than missing implementation scope.

### Coverage Statistics

- Total PRD FRs: 13.
- FRs covered in epics and stories: 13.
- Missing FRs: 0.
- Functional coverage: 100%.

## UX Alignment Assessment

### UX Document Status

Two target UX documents exist and have `status: final`.

- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` defines the shared anatomy, tokens, dimensions, contrast, responsive behavior, and the finished-iteration treatment for both shells.
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` defines information architecture, behavior, states, interaction primitives, accessibility, and four end-to-end user flows.

Both documents are in the target lineage through the canonical specification’s adopted companions and the epic frontmatter.
The approved mockup handoff also exists and its complete HTML, JavaScript, and README source was reviewed.
A live local-file render could not be inspected because the available browser security policy blocked access to the existing `file://` tab.
This limits visual evidence but does not hide the source-defined states and interactions.

### Aligned UX and Architecture Areas

- The PRD, UX, and read architecture all require one render-neutral functional core and thin Legacy and Console shells.
- They agree that both node rooms ship together and use their own existing token roots with the same anatomy and behavior.
- They agree on one-line tool rows, family-specific bodies, Raw as the only JSON view, pinned todo state, task normalization, bounded diffs, occurrence grouping, and a separate scroll-only occurrence navigator.
- They agree that the `Execution` controls, not the scroll navigator, select a finished iteration of a live loop.
- They agree that the finished-iteration dock allows a node-scoped queue read but no send, withdraw, or interrupt mutation.
- They agree that Queue dispatches at button press into a process-local node queue and that only unsubmitted text is tab-local.
- They agree that Stop interrupts a provider turn, preserves the session, leaves the node `running`, and remains distinct from Cancel.
- They agree that `Send now` continues the same session, that natural and interrupted turn endings have different drain rules, and that server receipt order is authoritative.
- They agree on the two projected core sub-states, with `interrupting` restricted to a UI-local transient.
- They agree that the executor is the only operator-row writer, that sender display names are derived at read time, and that message confirmation uses only the stamped id.
- They agree that detached runs and restart survival are outside v1 and must be disclosed rather than simulated.
- They agree on the accessibility floor, including color-independent status, native disclosure semantics, focus preservation, live-region serialization, assertive delivery failure, reduced motion, and the 24px or 32px target floors.
- Architecture supplies the performance support that UX needs through bounded projection, bounded diffing, memoization of diff results, and one in-process queue snapshot path.

### Alignment Issues

#### UX-A1 — Interrupted status has conflicting provider scope

**Status:** CONFLICT.

`DESIGN.md`, “Colors,” states: “Only Claude ever produces the outcome” and “Codex cannot produce it at all.”
`SPEC.md`, “Cross-half dependency,” requires the executor to write a separate `interrupted` status row “on every provider.”
The steering architecture AD-2 also defines provider-specific abort result and throw classification for Codex, OMP, Grok, and DeepSeek, and `steering-test-plan.md` requires the non-Claude row to render `⚠ interrupted`.

These are normative and mutually exclusive claims about whether non-Claude providers can produce the interrupted outcome.
The canonical specification and steering architecture require universal interrupted presentation at the v1 floor.
`DESIGN.md` must remove the provider limitation and explain that provider-native hook output is not the only source because the executor supplies the cross-provider status row.

#### UX-A2 — `Send now` is incorrectly included as timer-rearm activity

**Status:** CONFLICT.

`EXPERIENCE.md`, “State Patterns,” says: “any activity in the composer — a keystroke, focus, or `Send now` — re-arms” the 30-minute timer.
`SPEC.md`, “Write half,” says the composing keepalive re-arms the timer while `Send now` resolves idle-await.
The steering architecture AD-4 says idle-await resolves on `Send now`, cancel polling, or timer expiry, and that composing keepalive adds a re-arm input rather than another resolution.
`steering-test-plan.md`, “Engine — idle-await lifecycle,” explicitly says keepalive activity is “not `Send now`, which resolves idle-await.”

These are normative and mutually exclusive classifications of the `Send now` action.
`EXPERIENCE.md` must remove `Send now` from the re-arm list and limit re-arm behavior to authorized composing activity such as keystroke or focus keepalive.

### Warnings

- `DESIGN.md` contains historical text about earlier drafts and superseded choices.
  Implementers must treat the latest adopted or resolved statement in each section as authoritative, not the superseded rationale that remains for context.
- The UX frontmatter still cites the pre-merge source specifications rather than the merged canonical file.
  The canonical `SPEC.md` explicitly adopts those sources and provides the capability-number mapping, so this is lineage-compatible but increases citation risk during implementation.
- Live visual inspection of the approved handoff remains an evidence limitation for this assessment.
  The final atomic mockup comparison therefore uses complete source-defined structure, controls, scripted transitions, and copy, and it must not claim pixel verification.

### UX Alignment Result

The UX and architecture are structurally complete and cover all user-facing requirements.
They are not fully aligned while UX-A1 and UX-A2 remain unreconciled.
Both conflicts can send an implementation down a different behavior path, so they block a READY result.

## Epic Quality Review

### Epic Structure Validation

| Epic                               | User value                                                                                     | Independence                                                                                   | Result |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| Epic 1 — Readable Agent Transcript | Operators can scan and inspect historical and live agent work without reading raw JSON.        | It uses stored data and can ship without Epic 2.                                               | Pass   |
| Epic 2 — Live Agent Steering       | Operators can queue, interrupt, redirect, and audit live agent work without stopping the node. | It uses the completed transcript primitives from Epic 1 and does not depend on any later epic. | Pass   |

Neither epic is a technical milestone.
The project is brownfield, so no starter-template, initial-environment, or broad database-setup story is required.
The read half correctly avoids schema and migration work, while the write half uses additive metadata in an existing JSON column.

### Dependency Analysis

All declared story dependencies point backward.
No story depends on a later story or a post-v1 gate for its v1 acceptance.
G1 through G4 are explicitly excluded from the v1 completion boundary.

The main dependency chain is valid:

`1.1 → 1.2/1.3/1.5/1.6/1.7 → 1.4`, followed by `2.1 → 2.2/2.3 → 2.4–2.8 → 2.9 → 2.10/2.11/2.13 → 2.12` where applicable.

Story 2.10 also relies on Story 2.8 for its criterion that already delivered operator messages appear inline in the finished iteration.
That is a backward dependency because Story 2.8 comes first, but the `_Depends on:_` line omits it.

### Story-by-Story Assessment

| Story | User value and size                                                                                                                                                  | Acceptance criteria                                                                                                                             | Result                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1.1   | Clear scannable-row value and a coherent first vertical slice.                                                                                                       | Specific and testable across status, accessibility, malformed data, and interrupted folding.                                                    | Pass                        |
| 1.2   | Clear diagnostic value and appropriately bounded scope.                                                                                                              | Covers default state, full-output loading, and JSON isolation.                                                                                  | Pass                        |
| 1.3   | Clear family-body value but broad because it includes all family rendering and a release audit.                                                                      | The release-audit denominator wording conflicts with the adopted logical-card metric.                                                           | Major issue Q1              |
| 1.4   | Clear file-review value and large but cohesive diff scope.                                                                                                           | Covers honest fallback, failed edits, deterministic bounds, hostile content, and adapter compatibility.                                         | Pass                        |
| 1.5   | Clear current-plan value and coherent fold scope.                                                                                                                    | Covers both provider shapes, pinned state, compact rows, and empty-phase removal.                                                               | Pass                        |
| 1.6   | Clear delegation-inspection value and small scope.                                                                                                                   | Covers both provider shapes and malformed input.                                                                                                | Pass                        |
| 1.7   | Clear repeated-execution navigation value.                                                                                                                           | Covers grouping keys, navigation, focus parity, and single-occurrence absence.                                                                  | Pass                        |
| 2.1   | Clear queue-without-interrupting value and a coherent live slice.                                                                                                    | Covers server acceptance, natural drain, idempotency, errors, accessibility, and the send actor grant.                                          | Pass                        |
| 2.2   | Clear queue-correction value and small scope.                                                                                                                        | Covers removal, idempotency, error atomicity, and accessible focus.                                                                             | Pass                        |
| 2.3   | Clear end-to-end Claude redirect value but owns the shared registry, executor turn loop, route race behavior, loop parity, dock state, and accessibility foundation. | Criteria are specific, but the story is an unusually large vertical slice and needs an execution-task breakdown before coding.                  | Major delivery risk Q2      |
| 2.4   | Clear Codex conformance value and reuses prior infrastructure.                                                                                                       | Covers abort shape, `resumeThread`, loop parity, and failure classification.                                                                    | Pass                        |
| 2.5   | Clear OMP conformance value and reuses prior infrastructure.                                                                                                         | Covers the thrown-abort case, same-session delivery, loops, and the v1 gate.                                                                    | Pass                        |
| 2.6   | Clear Grok conformance value and reuses prior infrastructure.                                                                                                        | Covers stream abort, same-session delivery, loops, and the v1 gate.                                                                             | Pass                        |
| 2.7   | Clear DeepSeek conformance value and reuses prior infrastructure.                                                                                                    | Covers abort-marked results, continued session behavior, and loops.                                                                             | Pass                        |
| 2.8   | Clear audit-trail value and cohesive row projection.                                                                                                                 | Covers the sole writer, order, display name, and v1 status, but “no new row kind” is ambiguous across persistence and the projected read model. | Minor concern Q3            |
| 2.9   | Clear collaborative-queue value.                                                                                                                                     | Covers shared queue convergence, tab-local drafts, withdrawal, identity, keyboard use, and node isolation, with the API contract cited.         | Pass                        |
| 2.10  | Clear finished-iteration safety value.                                                                                                                               | Covers read-only mode, allowed queue GET, forbidden mutations, return-to-live, inline delivered rows, and non-live execution absence.           | Minor dependency concern Q4 |
| 2.11  | Clear data-loss-prevention value.                                                                                                                                    | The criteria omit and partly misstate the authoritative reconciliation evidence model.                                                          | Major issue Q5              |
| 2.12  | Clear bounded-wait safety value.                                                                                                                                     | Covers inactivity keepalive, exact-once resolution, Cancel, terminal recovery, fresh retry, and disclosure.                                     | Pass                        |
| 2.13  | Clear concurrent audit integrity value.                                                                                                                              | Covers receipt order, attribution, end-to-end ordering, and isolation.                                                                          | Pass with wording note Q6   |

### Major Issues

#### Q1 — Story 1.3 can implement the wrong generic-fallback denominator

Story 1.3 says the release audit “resolves distinct tool names with row counts.”
`test-plan.md`, “Generic-fallback corpus audit,” explicitly adopts `logical-tool-cards-v1`: one projected logical card per invocation, including pending call-only and legacy result-only cards once each, with text and status rows excluded.
It also says raw storage rows double-count modern calls and that distinct-name diagnostics are optional.

The story must name `logical-tool-cards-v1` as the only denominator and must require the projection and exact integer threshold comparison.
Otherwise a builder can satisfy the current story wording with the rejected raw-row or distinct-name count.

#### Q2 — Story 2.3 is too large to enter implementation without an execution breakdown

Story 2.3 is one valuable vertical feature, so it should not be replaced by technical user stories.
However, it combines registry lifecycle, per-turn abort composition, the five-case end classifier, same-session looping, loop-node parity, interrupt-route races, projected sub-state, dock behavior, live announcements, and focus transfer.

Before implementation, it needs explicit implementation tasks and a safe order that keeps the reader fold and route contracts ahead of cross-provider emission.
The story can remain one user story, but its current size creates high integration and verification risk.

#### Q5 — Story 2.11 does not specify exact terminal reconciliation

Story 2.11 says the client compares “every queued `message_id` shown by the node queue” when it receives a node terminal event.
That is insufficient because the in-process queue is torn down at terminal time and a later queue snapshot can omit an id that the client previously observed.

The steering architecture AD-11 requires all of the following:

- An observation ledger that retains every generation-valid shared-queue receipt and this tab’s successful sends.
- A later snapshot omission must not erase ledger evidence.
- Only this tab’s confirmed withdrawal may remove its id from the ledger.
- Reconciliation must start only from a persisted node terminal event or the server’s exact-scope terminal projection for a purged parked Ask.
- Run-level terminal status and live refetch are insufficient.
- Cancel can require a three-second read-only catch-up before raw node evidence settles.
- Comparison must use a complete node-wide transcript drain without occurrence filters.
- Ambiguous or incomplete terminal evidence must fail closed without a `NEVER SENT` claim.
- A half-typed draft must be folded after restored ledger items without losing identity or order.

`steering-test-plan.md`, “Operator row and reconciliation,” assigns focused unit, shell, server, parent, pane, and E2E coverage to these cases.
Story 2.11 does not carry those acceptance conditions, so an implementation can meet the story and still lose or falsely restore operator messages.

### Minor Concerns

#### Q3 — Story 2.8 uses “row kind” for two different layers

Story 2.8 correctly forbids a new persisted node-message kind and requires an ordinary `text` row.
The steering architecture AD-10 separately requires a projected `AgentHistoryItem` operator variant so that the row cannot render as agent text.
The story must distinguish “no new persisted kind” from “new projected operator item variant.”

#### Q4 — Story 2.10 omits a backward dependency

Its inline delivered-message criterion uses the operator-row behavior from Story 2.8, but the dependency line lists only Stories 1.7 and 2.9.
Add Story 2.8 to the dependency line.

#### Q6 — Story 2.13 should qualify within-stream order

The story says written order remains stable within each operator’s stream.
`steering-test-plan.md` clarifies that this holds when one dock or request stream waits for its prior send response, while two tabs for the same identity are separate streams and receive only global server acceptance order.
The story should include that qualification to prevent an identity-wide ordering assumption.

### Best-Practices Result

- Epic user value: pass.
- Epic independence: pass.
- Forward dependencies: none.
- Story format: pass.
- Acceptance-criteria specificity: two major gaps and three minor concerns.
- Story sizing: one major delivery risk.
- Database and migration timing: pass.
- Functional traceability: pass.

The epic set is structurally strong, but Stories 1.3 and 2.11 need corrected acceptance criteria before implementation.
Story 2.3 needs an execution-task breakdown before it can be implemented safely.

## Mockup Feature Behavior Matrix

### Citation Key

- `CNR` — `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`.
- `LNR` — `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`.
- `TS` — `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`.
- `SDS` — `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`.
- `HO` — `claude-design/design_handoff_node_room_transcript_steering/README.md`.
- `P` — `_bmad-output/specs/spec-agent-node-room/SPEC.md`.
- `TP` — `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`.
- `TF` — `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md`.
- `CS` — `_bmad-output/specs/spec-agent-node-room/control-states.md`.
- `RA` — `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`.
- `SA` — `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md`.
- `E` — `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.
- `OD` — `_bmad-output/planning-artifacts/epics-agent-node-room/sprint-change-proposal-2026-09-15.md`.

Locations below use the current line numbers and named sections in those exact files.

### Normative Conflict Reconciliation

**M-036 — Todo-strip placement.**
The shipping-surface prototypes place the Todo strip after the transcript scroller at `CNR:227-248` and `LNR:218-241`.
`P`, CAP-3, requires “a pinned todo strip at the top of the transcript panel,” and `HO:80-86` says it is the first room child immediately above the scroller.
These are mutually exclusive DOM orders.
The documented resolution is to keep the canonical top placement and correct both interactive mockups, but the approved mockup source has not applied that resolution.

**M-041 — Terminal todo rewriting.**
The interactive state logic at `CNR:478-487` and `LNR:441-450` changes unfinished todo items when a node finishes or fails.
`HO:84-86` says “node lifecycle events never rewrite todo statuses,” and `TF`, “Rendering rules,” says the strip renders the fold of recorded todo calls.
These are mutually exclusive sources of todo state.
The documented resolution is to keep recorded fold state unchanged and remove the demo-only lifecycle rewrite, but the approved mockup source still performs it.

**M-043 — Queue-band geometry.**
`SDS:49-59` renders the queue as a padded `surface-inset` well inside the dock.
`HO`, “The queue is a full-bleed band,” requires a full-width `surface-elevated` sibling band, and the two shipping-surface prototypes use that newer geometry.
These are mutually exclusive component structures.
The state catalogue must be updated to the adopted full-width band.

**M-048 — `this tab only` scope.**
`SDS:54-57`, `CNR` queued states, and `LNR` queued states show `this tab only` on accepted queue content.
`P`, “Two queues, split on typing vs queued,” says only the pre-Queue draft is per-tab, and `HO:314` limits the label to the unsent draft.
These are mutually exclusive ownership claims.
The label must be removed from the server-side queue and retained only on unsubmitted composer text.

### Atomic Behavior Traceability

| ID    | Mockup file/location                                                  | Visible control or state                                 | Precondition                                                       | User action                                | Affected item(s)                           | Delivery or transition timing                             | Expected result                                                                                                   | Remaining state                                    | Exact PRD citation                                              | Exact Architecture citation                                                     | Exact Epic/Story AC citation                                                           | Status                         | Direct user decision evidence                                                         |
| ----- | --------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| M-001 | `CNR:104-305`; `LNR:96-294`                                           | Thin shell with surface-specific tokens                  | Either node-room shell opens                                       | Open node room                             | Whole room                                 | Initial render                                            | Same product anatomy uses each shell's token root                                                                 | Shell remains independently styled                 | `P`, “Shared — both halves land in packages/web”                | `RA` AD-1, AD-2, AD-12                                                          | `E` NFR2, UX-DR8; Story 1.1 AC 1                                                       | MATCHED                        | —                                                                                     |
| M-002 | `CNR:153-223`; `LNR:145-209`                                          | Transcript row parity                                    | Same node data is available                                        | Compare both shells                        | Tool and operator rows                     | Initial render                                            | Row meaning, order, and controls are equivalent                                                                   | Markup stays shell-specific                        | `P`, CAP-1 and Constraints                                      | `RA` AD-1, AD-10, AD-12                                                         | `E` Story 1.1 AC 1; UX-DR8                                                             | MATCHED                        | —                                                                                     |
| M-003 | `TS:62-118`; `CNR:161-220`; `LNR:153-206`                             | One-line tool-row anatomy                                | Tool call exists                                                   | Scan collapsed row                         | One tool call                              | Initial render                                            | Chevron, glyph, chip, headline, and ordered badges fit one row                                                    | Body stays collapsed                               | `P`, CAP-1                                                      | `RA` AD-10, AD-11, AD-14                                                        | `E` Story 1.1 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-004 | `TS:64-82`                                                            | Successful call collapsed                                | Outcome is success                                                 | Open transcript                            | Successful call                            | Initial render                                            | Success row starts collapsed with `✓`                                                                             | Manual disclosure remains available                | `P`, CAP-1                                                      | `RA` AD-12 item 1, AD-13                                                        | `E` Story 1.1 AC 2-3                                                                   | MATCHED                        | —                                                                                     |
| M-005 | `TS:83-96`; `CNR:159-173`; `LNR:157-169`                              | Failed call expanded                                     | Outcome is failed                                                  | Open transcript                            | Failed call                                | Initial render                                            | Failure row starts expanded with `✕` and failure detail                                                           | Reader can close it                                | `P`, CAP-1                                                      | `RA` AD-12 items 1-2, AD-13                                                     | `E` Story 1.1 AC 1-3                                                                   | MATCHED                        | —                                                                                     |
| M-006 | `TS:52-60`                                                            | Running glyph                                            | Outcome is running                                                 | Scan row                                   | Running call                               | Live projection                                           | `◐` carries status without color                                                                                  | Row starts collapsed                               | `P`, CAP-1; Read constraint on color                            | `RA` AD-13                                                                      | `E` Story 1.1 AC 2-3                                                                   | MATCHED                        | —                                                                                     |
| M-007 | `TS:52-60`; `CNR:203-210`; `LNR:189-196`                              | Interrupted glyph                                        | Interrupted evidence follows a call                                | Scan row                                   | Interrupted call                           | After interrupt evidence is read                          | `⚠ interrupted` folds into the preceding call                                                                     | Row starts collapsed                               | `P`, CAP-1 and Cross-half dependency                            | `RA` AD-12 item 1, AD-13; `SA` AD-2                                             | `E` Story 1.1 AC 5; Stories 2.3-2.7 interrupt ACs                                      | MATCHED                        | —                                                                                     |
| M-008 | `TS:52-60`                                                            | Unknown glyph                                            | Outcome cannot be derived                                          | Scan row                                   | Unknown call                               | Initial render                                            | `–` means unknown only                                                                                            | Output state remains a separate badge              | `P`, CAP-1                                                      | `RA` AD-13                                                                      | `E` Story 1.1 AC 2-3                                                                   | MATCHED                        | —                                                                                     |
| M-009 | `TS:42-50,64-74`                                                      | Sent tool name as chip                                   | Name is one token and at most 24 characters                        | Scan row                                   | Tool chip                                  | Initial render                                            | Provider-sent name is shown                                                                                       | Family still determines treatment                  | `P`, Read constraint on chip names                              | `RA` AD-10, AD-11                                                               | `E` Story 1.1 AC 3                                                                     | MATCHED                        | —                                                                                     |
| M-010 | `TS:75-82,97-118`                                                     | Family fallback chip                                     | Name is long, multiline, or not one token                          | Scan row                                   | Tool chip                                  | Initial render                                            | Family name replaces unsafe sent name                                                                             | Full payload remains in Raw                        | `P`, Read constraint on chip names                              | `RA` AD-10, AD-11                                                               | `E` Story 1.1 AC 3-4                                                                   | MATCHED                        | —                                                                                     |
| M-011 | `TS:97-102`                                                           | Middle-elided path                                       | Path exceeds row width                                             | Scan row                                   | Path headline                              | Layout time                                               | Path keeps useful start and end                                                                                   | Full value remains in body or Raw                  | `P`, Read constraint on path elision                            | `RA` AD-11                                                                      | `E` UX-DR1; Story 1.1 AC 1                                                             | MATCHED                        | —                                                                                     |
| M-012 | `TS:103-108`                                                          | End-elided command or pattern                            | Text exceeds row width                                             | Scan row                                   | Command or pattern headline                | Layout time                                               | Text elides at the end                                                                                            | Full value remains in body or Raw                  | `P`, Read constraint on command and pattern elision             | `RA` AD-11                                                                      | `E` UX-DR1; Story 1.1 AC 1                                                             | MATCHED                        | —                                                                                     |
| M-013 | `TS:62-118`                                                           | Right-aligned non-wrapping badges                        | Row has several facts                                              | Narrow the panel                           | Badge list                                 | Layout time                                               | Badges keep core order and drop by priority without wrapping                                                      | Dropped facts remain in body bar                   | `P`, CAP-1                                                      | `RA` AD-10, AD-14                                                               | `E` Story 1.1 AC 1; UX-DR1                                                             | MATCHED                        | —                                                                                     |
| M-014 | `TS:64-118`; `CNR:159-220`; `LNR:157-206`                             | Native disclosure and manual row state                   | Row is rendered                                                    | Toggle a row                               | One row disclosure                         | Immediate                                                 | Reader choice survives live re-renders                                                                            | Other rows are unchanged                           | `P`, CAP-1                                                      | `RA` AD-12 items 1-2                                                            | `E` Story 1.1 AC 1-2                                                                   | MATCHED                        | —                                                                                     |
| M-015 | `TS:120-143`                                                          | Shell body                                               | Shell row is expanded                                              | Open row                                   | Command, output, exit state                | Immediate                                                 | Terminal-shaped body replaces serialized data                                                                     | Raw remains closed                                 | `P`, CAP-2                                                      | `RA` AD-1, AD-3                                                                 | `E` Story 1.3 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-016 | `TS:145-161`; `CNR:175-190`; `LNR:173-186`                            | File diff body                                           | File pair qualifies                                                | Open row                                   | Before and after content                   | Immediate from precomputed model                          | Inline line diff shows honest changes                                                                             | Raw preserves original payload                     | `P`, CAP-5                                                      | `RA` AD-4, AD-5, AD-6                                                           | `E` Story 1.4 AC 1-5                                                                   | MATCHED                        | —                                                                                     |
| M-017 | `TS:163-178`                                                          | Web body                                                 | Web-family call exists                                             | Open row                                   | URL and response                           | Immediate                                                 | URL and Markdown-shaped content render                                                                            | Raw remains available                              | `P`, CAP-2                                                      | `RA` AD-1, AD-3                                                                 | `E` Story 1.3 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-018 | `TS:180-193`                                                          | Search body                                              | Search-family call exists                                          | Open row                                   | Matches or paths                           | Immediate                                                 | Body arm follows `output_mode`                                                                                    | Raw remains available                              | `P`, CAP-2; `TP`, “search body arm”                             | `RA` AD-1, AD-3                                                                 | `E` Story 1.3 AC 1-2                                                                   | MATCHED                        | —                                                                                     |
| M-019 | `TS:195-209`                                                          | Glob body                                                | Glob-family call exists                                            | Open row                                   | Path results                               | Immediate                                                 | Flat path list renders                                                                                            | Raw remains available                              | `P`, CAP-2                                                      | `RA` AD-1, AD-3                                                                 | `E` Story 1.3 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-020 | `TS:211-226`                                                          | Code body                                                | Code-family call exists                                            | Open row                                   | Source text                                | Immediate                                                 | Highlighted source renders within bounds                                                                          | Raw remains available                              | `P`, CAP-2                                                      | `RA` AD-1, AD-3                                                                 | `E` Story 1.3 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-021 | `TS:105-118`                                                          | Bounded generic body                                     | No family matches                                                  | Open row                                   | Up to three scalar facts                   | Immediate                                                 | Scalars render as `key: value`; objects and arrays render `{…}` and `[n]`                                         | Original JSON stays in Raw                         | `P`, CAP-2                                                      | `RA` AD-3, AD-10                                                                | `E` Story 1.3 AC 3                                                                     | MATCHED                        | —                                                                                     |
| M-022 | `TS:228-248`                                                          | OMP todo body and fold                                   | Ordered OMP todo mutations exist                                   | Open todo row or inspect strip             | Current todo phases                        | After each accepted mutation                              | Nine operations fold to one normalized state                                                                      | Each history call stays one line                   | `P`, CAP-3; `TF`, “nine OMP ops”                                | `RA` AD-7                                                                       | `E` Story 1.5 AC 1, 3-4                                                                | MATCHED                        | —                                                                                     |
| M-023 | `TS:250-267`                                                          | Claude todo last-call-wins                               | Claude TodoWrite snapshots exist                                   | Inspect strip                              | Current task list                          | After accepted snapshot                                   | Latest whole list replaces earlier state                                                                          | One `Tasks` phase remains                          | `P`, CAP-3; `TF`, “Claude is the degenerate case”               | `RA` AD-7                                                                       | `E` Story 1.5 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-024 | `TS:269-281`                                                          | OMP task batch                                           | Batch task payload exists                                          | Open task row                              | Batch context and subtasks                 | Immediate                                                 | Context is Markdown and each subtask is collapsible                                                               | Dispatch row remains one item                      | `P`, CAP-4; `TP`, “task to TaskSubtask[]”                       | `RA` capability map CAP-4                                                       | `E` Story 1.6 AC 1-2                                                                   | MATCHED                        | —                                                                                     |
| M-025 | `TS:282-296`                                                          | Claude single task                                       | Claude task payload exists                                         | Open task row                              | One normalized subtask                     | Immediate                                                 | Single task uses the same subtask-card model                                                                      | Provider name does not enter renderer logic        | `P`, CAP-4; `TP`, “task to TaskSubtask[]”                       | `RA` capability map CAP-4                                                       | `E` Story 1.6 AC 1-3                                                                   | MATCHED                        | —                                                                                     |
| M-026 | `TS:228-267`; `CNR` and `LNR` transcript rows                         | Todo calls remain compact                                | Todo calls exist                                                   | Scan history                               | Each todo call                             | Initial render                                            | Each call is one `todo updated` row                                                                               | Checklist appears only once in strip               | `P`, CAP-3                                                      | `RA` AD-7                                                                       | `E` Story 1.5 AC 3                                                                     | MATCHED                        | —                                                                                     |
| M-027 | `TS:120-296`; `CNR:165,181`; `LNR:165,181`                            | Raw closed by default                                    | Any tool card exists                                               | Open transcript                            | Tool payload                               | Initial render                                            | Original JSON is hidden                                                                                           | Readable presentation stays visible                | `P`, CAP-7                                                      | `RA` AD-12; capability map CAP-7                                                | `E` Story 1.2 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-028 | `TS:322-341`                                                          | Raw open view                                            | Tool card exists                                                   | Activate Raw                               | Original input and output JSON             | Immediate                                                 | Raw panel reveals original payload without replacing readable row                                                 | Disclosure can close again                         | `P`, CAP-7                                                      | `RA` AD-10, AD-12                                                               | `E` Story 1.2 AC 1-3                                                                   | MATCHED                        | —                                                                                     |
| M-029 | `TS:298-320`                                                          | `Run 2 · retry` occurrence header                        | Multiple occurrences include a retry                               | Navigate transcript                        | One occurrence group                       | Initial group projection                                  | Retry group has non-attempt wording                                                                               | Rows remain grouped by `occurrence_id`             | `P`, CAP-6                                                      | `RA` AD-7, AD-10                                                                | `E` Story 1.7 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-030 | `TS:298-320`                                                          | `Iteration N` occurrence header                          | Loop has multiple occurrences                                      | Navigate transcript                        | One loop occurrence                        | Initial group projection                                  | Iteration header identifies the group                                                                             | Selector targets its anchor                        | `P`, CAP-6                                                      | `RA` AD-7, AD-10                                                                | `E` Story 1.7 AC 1-2                                                                   | MATCHED                        | —                                                                                     |
| M-031 | `TS:298-320`                                                          | `Run 1 · failed` occurrence header                       | Earlier occurrence failed                                          | Navigate transcript                        | Failed occurrence                          | Initial group projection                                  | Failure is visible without using `attempt_id` as group key                                                        | Later groups remain separate                       | `P`, CAP-6                                                      | `RA` AD-7, AD-10                                                                | `E` Story 1.7 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-032 | `CNR:146-151`; `LNR:134-139`                                          | Execution selector                                       | Live loop has several iterations                                   | Select an iteration                        | Selected occurrence view                   | Immediate                                                 | View switches to the corresponding occurrence                                                                     | Live execution identity stays known                | `P`, CAP-6                                                      | `RA` AD-16                                                                      | `E` Story 1.7 AC 2; Story 2.10 AC 1                                                    | MATCHED                        | —                                                                                     |
| M-033 | `CNR:146-151,421-467`; `LNR:134-139,408-430`                          | Selected iteration pill and metadata                     | Execution selection changes                                        | Pick finished iteration                    | Header status and timing                   | Immediate                                                 | Pill and metadata describe the selected iteration                                                                 | Live iteration remains the return target           | `P`, CAP-6                                                      | `RA` AD-16                                                                      | `E` Story 2.10 AC 1                                                                    | MATCHED                        | —                                                                                     |
| M-034 | `CNR:212-215`; `LNR:198-201`; `SDS:233-248`                           | Operator row                                             | Guidance was delivered                                             | Read transcript                            | Delivered operator message                 | After executor write                                      | `operator · display name` and full-strength text distinguish it from model text                                   | Message remains ordinary transcript evidence       | `P`, CAP-11                                                     | `SA` AD-6, AD-10, AD-12                                                         | `E` Story 2.8 AC 1-4                                                                   | MATCHED                        | —                                                                                     |
| M-035 | `CNR:191-220`; `LNR:187-206`                                          | Assistant row around operator exchange                   | Agent text surrounds steering exchange                             | Read transcript                            | Assistant messages                         | After resumed turn streams                                | Agent text remains visually distinct and ordered around operator row                                              | Stored bytes remain unchanged                      | `P`, CAP-11 and Success signal                                  | `SA` AD-6; `RA` AD-10                                                           | `E` Story 2.8 AC 2-3                                                                   | MATCHED                        | —                                                                                     |
| M-036 | `CNR:227-248`; `LNR:218-241`; `HO:80-86`                              | Todo strip below scroller in interactive files           | Folded todo state exists                                           | Open node room                             | Todo strip and transcript order            | Initial render                                            | Canonical rule requires Todo above the scroller, but prototypes put it below                                      | Strip remains sticky as a sibling                  | `P`, CAP-3: “top of the transcript panel”                       | `RA` AD-7, AD-12                                                                | `E` Story 1.5 AC 2                                                                     | CONFLICT                       | —                                                                                     |
| M-037 | `CNR:227-234`; `LNR:218-225`                                          | Collapsed Todo summary                                   | Folded state is nonempty                                           | Open node room                             | Current checklist summary                  | Initial render                                            | Header shows current phase, progress, and disclosure                                                              | Items remain hidden                                | `P`, CAP-3                                                      | `RA` AD-7                                                                       | `E` Story 1.5 AC 2                                                                     | MATCHED                        | —                                                                                     |
| M-038 | `CNR:228-248`; `LNR:219-241`                                          | Todo expand and collapse                                 | Todo strip is present                                              | Activate Todo header                       | Current checklist                          | Immediate                                                 | Native disclosure shows or hides phases and item status                                                           | Folded data is unchanged                           | `P`, CAP-3                                                      | `RA` AD-7, AD-12                                                                | `E` Story 1.5 AC 2                                                                     | MATCHED                        | —                                                                                     |
| M-039 | `CNR:559`; `LNR:513`; `TF`, Rendering rules                           | No strip for empty state                                 | Fold returns `[]`                                                  | Open node room                             | Todo strip                                 | Initial render                                            | Strip is absent                                                                                                   | Transcript uses the freed space                    | `P`, CAP-3                                                      | `RA` AD-7                                                                       | `E` Story 1.5 AC 2, 4                                                                  | MATCHED                        | —                                                                                     |
| M-040 | `CNR:239-245`; `LNR:234-240`; `HO:84-86`                              | Todo-strip body bar and Raw footer                       | Todo strip is expanded                                             | Inspect footer                             | Folded todo state                          | Immediate                                                 | Interactive mocks show a Raw footer, but no product requirement defines it and the handoff says it is not adopted | Checklist remains visible                          | `P`, CAP-7 applies to tool cards only; no Todo-strip Raw rule   | No exact Architecture rule                                                      | `E` Story 1.5 has no Raw-footer AC                                                     | DEFERRED_WITHOUT_USER_APPROVAL | `HO` claims it is not adopted, but no direct user decision source approves removal    |
| M-041 | `CNR:366,380,391,478-487`; `LNR:356,371,381,441-450`; `HO:296-299`    | Terminal state rewrites todo statuses                    | Live iteration reaches completed or failed                         | Switch terminal state                      | Folded Todo items                          | At node terminal projection                               | Mock rewrites unfinished items, but canonical fold must stay unchanged unless a recorded todo call changed it     | Original fold must remain                          | `P`, CAP-3; `TF`, Rendering rules                               | `RA` AD-7                                                                       | `E` Story 1.5 AC 1-4                                                                   | CONFLICT                       | —                                                                                     |
| M-042 | `CNR:254-278`; `LNR:245-269`; `HO`, queue-band section                | Full-width elevated queue band                           | Accepted queue is nonempty                                         | View live dock                             | Accepted messages                          | After queue GET or successful send                        | Band is a full-width sibling between transcript/Todo and composer                                                 | Composer remains a separate inset well             | `P`, CAP-8 and “Two queues”                                     | `SA` AD-3, AD-9                                                                 | `E` Story 2.1 AC 1-3; UX-DR4                                                           | MATCHED                        | `OD:15` directly records owner adoption of the full-bleed band                        |
| M-043 | `SDS:49-59,77-87`; `HO`, “The queue is a full-bleed band”             | Inset queue well in state catalogue                      | Queued messages exist                                              | Review state sheet                         | Accepted queue                             | Initial render                                            | Catalogue uses the rejected inset well instead of the adopted full-width sibling band                             | Composer remains below it                          | `P`, CAP-8 and “Two queues”                                     | `SA` AD-9                                                                       | `E` Story 2.1 AC 1; UX-DR4                                                             | CONFLICT                       | `OD:15` selects the full-bleed alternative, so `SDS` is stale                         |
| M-044 | `CNR:613`; `LNR:574`; `CS`, “The draft box”                           | Empty queue has no band                                  | Accepted queue is empty                                            | View live dock                             | Queue band                                 | Projection refresh                                        | No empty queue shell renders                                                                                      | Composer remains mounted when steerable            | `P`, CAP-8                                                      | `SA` AD-3, AD-9                                                                 | `E` Story 2.1 AC 1-3                                                                   | MATCHED                        | —                                                                                     |
| M-045 | `CNR:254-278`; `LNR:245-269`; `SDS:54`                                | `QUEUED · n` header                                      | Agent generates and queue is nonempty                              | Queue guidance                             | Queue list                                 | Immediately after server acceptance                       | Header reports queued count                                                                                       | Items wait in server receipt order                 | `P`, CAP-8                                                      | `SA` AD-3, AD-9                                                                 | `E` Story 2.1 AC 1-3                                                                   | MATCHED                        | —                                                                                     |
| M-046 | `CNR` idle state `344-353`; `LNR` idle state `336-343`; `SDS:104-122` | `WILL SEND · n` header                                   | Agent is idle after interrupt                                      | View dock                                  | Queue list                                 | After interrupt completes                                 | Header signals that Send now will flush the queue                                                                 | Node remains running                               | `P`, CAP-10                                                     | `SA` AD-4, AD-9                                                                 | `E` Story 2.3 AC 5-6                                                                   | MATCHED                        | —                                                                                     |
| M-047 | `CNR:365-402`; `LNR:355-390`; `SDS:149-210`                           | `NEVER SENT · n` header                                  | Node ends with unmatched observed messages                         | View terminal dock residue                 | Restored messages                          | After authoritative terminal reconciliation               | Read-only band identifies undelivered messages                                                                    | Composer and steering controls stay absent         | `P`, terminal reconciliation rule under Write half              | `SA` AD-11                                                                      | `E` Story 2.11 AC 1-3                                                                  | MATCHED                        | —                                                                                     |
| M-048 | `SDS:54-57,82-85`; queued `CNR` and `LNR` states; `HO:314`            | `this tab only` on accepted queue                        | Message has passed Queue acceptance                                | View queue                                 | Server-side queued items                   | After acceptance                                          | Mock labels server queue as tab-local, but canonical scope reserves the label for unsubmitted draft               | Shared queue must remain node-scoped               | `P`, “Two queues, split on typing vs queued”                    | `SA` AD-3 and process-local registry rules                                      | `E` Story 2.9 AC 1-2                                                                   | CONFLICT                       | —                                                                                     |
| M-049 | `CNR:256-272`; `LNR:247-263`                                          | Ordered queue items                                      | More than one item is accepted                                     | Inspect band                               | Queue items                                | After each acceptance                                     | Ordinals and list order match server receipt order                                                                | Later delivery keeps that order                    | `P`, CAP-8 and concurrent ordering rule                         | `SA` AD-3, AD-11                                                                | `E` Story 2.1 AC 3; Story 2.13 AC 1                                                    | MATCHED                        | —                                                                                     |
| M-050 | `CNR:255-278`; `LNR:246-269`                                          | Queue expand and collapse                                | Queue is nonempty                                                  | Activate queue header                      | Queue list                                 | Immediate                                                 | Disclosure opens or closes without changing queue                                                                 | Count remains visible                              | `P`, CAP-8                                                      | `SA` AD-9                                                                       | `E` Story 2.1 AC 1; UX-DR4                                                             | MATCHED                        | —                                                                                     |
| M-051 | `CNR:270`; `LNR:265`                                                  | Per-item delete or withdraw                              | Item is still queued                                               | Activate its delete control                | One queued message                         | On withdraw response                                      | Item is removed idempotently with accessible identity                                                             | Other items keep order                             | `P`, CAP-8 and idempotent withdraw rule                         | `SA` AD-11                                                                      | `E` Story 2.2 AC 1-4                                                                   | MATCHED                        | —                                                                                     |
| M-052 | `CNR:501,615-634`; `LNR:464,576-595`; `HO:88-105`                     | Per-item `Send now` during generation                    | Claude soft-inject spike and gate pass                             | Activate item Send now                     | One queued message                         | Mid-turn                                                  | Prompt enters the active turn without interrupt or new turn-start event                                           | Other queued items stay queued                     | `P`, CAP-12 and v1 release gate                                 | `SA` AD-3, AD-7; Deferred                                                       | `E` G2 AC and gate                                                                     | DEFERRED_WITH_USER_APPROVAL    | `OD:13` records owner decision that Claude soft-inject is post-v1 gated backlog       |
| M-053 | `CNR:289-305`; `LNR:283-294`; `SDS:40-66`                             | Composer mounted while generating                        | Live handle is steerable and agent generates                       | Focus composer                             | Unsubmitted draft                          | Immediate                                                 | Composer is enabled                                                                                               | Agent continues current turn                       | `P`, CAP-8                                                      | `SA` AD-3, AD-9                                                                 | `E` Story 2.1 AC 1                                                                     | MATCHED                        | —                                                                                     |
| M-054 | `CNR` and `LNR` composer; `SDS:59-62`                                 | Enter inserts newline                                    | Composer is enabled                                                | Press plain Enter                          | Unsubmitted draft                          | Immediate                                                 | A newline is inserted and nothing is sent                                                                         | Draft remains local                                | `P`, Write accessibility constraints                            | `SA` AD-9                                                                       | `E` Story 2.1 AC 6                                                                     | MATCHED                        | —                                                                                     |
| M-055 | `CNR:299`; `LNR:291`; `SDS:61`                                        | Stop while generating                                    | Agent is interruptible                                             | Activate Stop                              | Current provider turn                      | Sub-second provider interrupt                             | Current turn ends without ending node or session                                                                  | Dock enters idle-after-interrupt                   | `P`, CAP-9                                                      | `SA` AD-1, AD-2, AD-4                                                           | `E` Story 2.3 AC 2-4; Stories 2.4-2.7                                                  | MATCHED                        | —                                                                                     |
| M-056 | `CNR:301`; `LNR:293`; `SDS:62`                                        | Queue while generating                                   | Agent generates                                                    | Submit composer                            | New message                                | Immediate server acceptance; delivery at natural boundary | Message joins registry without interrupting current turn                                                          | Node remains running                               | `P`, CAP-8                                                      | `SA` AD-3, AD-4                                                                 | `E` Story 2.1 AC 2-3                                                                   | MATCHED                        | —                                                                                     |
| M-057 | `SDS:66`; `CNR:328`; `LNR:319-320`                                    | Queue does not interrupt                                 | In-flight tool or generation exists                                | Press Queue                                | Current turn and new queue item            | Immediate acceptance                                      | No tool-call or row state changes because of Queue                                                                | Message waits                                      | `P`, CAP-8                                                      | `SA` AD-3                                                                       | `E` Story 2.1 AC 2                                                                     | MATCHED                        | —                                                                                     |
| M-058 | `CNR:339-340`; `LNR:330-331`; `SDS:89-94`                             | Focusable `Stopping…`                                    | Interrupt request is in flight                                     | Activate Stop                              | Stop control and focus                     | Brief transient                                           | Control uses `aria-disabled`, remains focusable, and announces once                                               | Queue remains available                            | `P`, Write accessibility constraints                            | `SA` AD-9                                                                       | `E` Story 2.3 AC 8                                                                     | MATCHED                        | —                                                                                     |
| M-059 | `CNR:338-340`; `LNR:329-331`; `SDS:82-90`                             | Queue remains during interrupting                        | Interrupt is landing                                               | Submit guidance                            | Queue item                                 | Immediate acceptance                                      | Send still reads Queue and item waits                                                                             | Node is still running                              | `P`, CAP-8 and race rule                                        | `SA` AD-11                                                                      | `E` Story 2.3 AC 3                                                                     | MATCHED                        | —                                                                                     |
| M-060 | `CNR:651`; `LNR:612`; `SDS:100-122`                                   | Stop transition to idle                                  | Provider confirms operator interrupt                               | Observe dock                               | Agent sub-state and controls               | Immediately after classified interrupt                    | Stop disappears, header becomes Will send, send becomes Send now                                                  | Node and session stay live                         | `P`, CAP-9 and CAP-10                                           | `SA` AD-2, AD-4, AD-9                                                           | `E` Story 2.3 AC 4-5                                                                   | MATCHED                        | —                                                                                     |
| M-061 | `CNR:344-353`; `LNR:336-343`; `SDS:100-122`                           | Interrupted status row                                   | A tool was in flight at interrupt                                  | Inspect transcript                         | Preceding tool call                        | After executor writes status evidence                     | Tool renders `⚠ interrupted`                                                                                      | Operator redirect has not yet been sent            | `P`, CAP-9 and Cross-half dependency                            | `SA` AD-2, AD-10                                                                | `E` Story 1.1 AC 5; Story 2.3 AC 4                                                     | MATCHED                        | —                                                                                     |
| M-062 | `CNR:352`; `LNR:342`; `SDS:118`                                       | Stop absent when idle                                    | Agent is idle after interrupt                                      | View controls                              | Stop control                               | Idle projection                                           | Stop is not rendered                                                                                              | Send now remains                                   | `P`, CAP-10                                                     | `SA` AD-9                                                                       | `E` Story 2.3 AC 5                                                                     | MATCHED                        | —                                                                                     |
| M-063 | `CNR:352`; `LNR:342`; `SDS:118`                                       | `Send now` when idle                                     | Agent is idle after interrupt                                      | Activate Send now                          | Existing queue and new draft               | Immediate idle resolution; next turn starts               | Messages flush in receipt order on same session                                                                   | Dock returns to generating                         | `P`, CAP-10                                                     | `SA` AD-3, AD-4                                                                 | `E` Story 2.3 AC 6                                                                     | MATCHED                        | —                                                                                     |
| M-064 | `CNR:353`; `LNR` idle note; `SDS:122`                                 | Stop is not undo disclosure                              | Turn was interrupted                                               | Read idle disclosure                       | Written files and operator understanding   | Idle render                                               | Copy states that prior writes are not rolled back                                                                 | Node remains running                               | `P`, “Interrupt is not undo”                                    | `SA` AD-1, AD-2                                                                 | `E` Story 2.3 AC 5                                                                     | MATCHED                        | —                                                                                     |
| M-065 | `CNR:361-363`; `LNR:351-353`                                          | Ordered same-session flush                               | Idle queue is nonempty                                             | Press Send now                             | All accepted guidance                      | Before next provider turn                                 | Messages become operator rows in receipt order and same session resumes                                           | Queue becomes empty                                | `P`, CAP-10 and CAP-11                                          | `SA` AD-3, AD-4, AD-6                                                           | `E` Story 2.3 AC 6; Story 2.8 AC 2                                                     | MATCHED                        | —                                                                                     |
| M-066 | `CNR:355-363`; `LNR:345-353`; `SDS:126-145`                           | Generating-again controls reset                          | Redirect turn starts                                               | Observe dock                               | Controls and sub-state                     | As projected state becomes generating                     | Stop and Queue return from core state, not remembered UI mode                                                     | Draft band disappears when empty                   | `P`, CAP-10                                                     | `SA` AD-4, AD-9                                                                 | `E` Story 2.3 AC 6, 8                                                                  | MATCHED                        | —                                                                                     |
| M-067 | `CNR:361-363`; `LNR:351-353`                                          | Operator rows precede redirect tail                      | Redirect was delivered                                             | Read transcript                            | Interrupted call, operator rows, next call | After next turn emits output                              | Wrong call, correction, and new work appear in actual order                                                       | Transcript remains durable                         | `P`, CAP-11 and Success signal                                  | `SA` AD-6, AD-10                                                                | `E` Story 2.8 AC 1-3                                                                   | MATCHED                        | —                                                                                     |
| M-068 | `CNR:365-377`; `LNR:355-366`; `SDS:149-172`                           | Finished-undelivered read-only residue                   | Node is terminal and unmatched guidance exists                     | View node                                  | Never-sent messages                        | After terminal reconciliation                             | No field or steering control renders; messages remain readable                                                    | Transcript and residue stay read-only              | `P`, terminal reconciliation and finished-node rules            | `SA` AD-11                                                                      | `E` Story 2.11 AC 1-3 restores messages but does not require read-only control removal | PARTIAL                        | —                                                                                     |
| M-069 | `CNR:377`; `LNR` finished-undelivered state; `SDS:172`                | Half-typed draft folds last                              | Node becomes terminal while local draft is nonempty                | Observe terminal transition                | Restored ledger items and local draft      | After reconciliation                                      | Local draft is preserved after restored items                                                                     | No message is silently lost                        | No exact PRD clause for the half-typed draft                    | `SA` AD-11                                                                      | `E` Story 2.11 has no half-typed-draft AC, as reported in Q5                           | MISSING                        | —                                                                                     |
| M-070 | `CNR:380-388`; `LNR:371-378`; `SDS:176-184`                           | Finished-clean has no dock                               | Node is terminal and nothing is undelivered                        | View node                                  | Dock region                                | Terminal render                                           | No dock or empty residue appears                                                                                  | Transcript uses remaining height                   | `P`, “The dock does not appear on a finished node”              | `SA` AD-11                                                                      | `E` Story 2.11 has no exact clean-terminal dock-absence AC                             | PARTIAL                        | —                                                                                     |
| M-071 | `CNR:391-402`; `LNR:381-390`; `SDS:188-210`                           | 30-minute failure and Never Sent residue                 | Idle-after-interrupt has no activity for 30 minutes                | Wait                                       | Node and queued guidance                   | On inactivity expiry                                      | Node fails once with exact error and unmatched messages become Never Sent                                         | Retry uses a fresh session                         | `P`, idle-await rule                                            | `SA` AD-4                                                                       | `E` Story 2.12 AC 1, 4-5                                                               | MATCHED                        | —                                                                                     |
| M-072 | `CNR:404-412`; `LNR:393-400`; `HO`, detached state                    | Detached disclosure                                      | Run has no live handle in this process                             | View node                                  | Dock region                                | Initial live-state projection                             | No controls render and copy says not steerable here                                                               | Node state is not mutated                          | `P`, in-process-only rule and Non-goals                         | `SA` AD-5                                                                       | `E` Story 2.1 AC 5; NFR4                                                               | MATCHED                        | —                                                                                     |
| M-073 | `CNR:281-287`; `LNR:272-279`                                          | Finished-iteration disclosure                            | A finished iteration of a live loop is selected                    | View dock area                             | Selected iteration and live target         | Immediate after selection                                 | One line states that the agent works in the live iteration                                                        | Queue context remains below                        | `P`, CAP-6 finished-iteration clause                            | `RA` AD-16                                                                      | `E` Story 2.10 AC 1                                                                    | MATCHED                        | —                                                                                     |
| M-074 | `CNR:284`; `LNR:277`                                                  | `Go to iteration N`                                      | Finished iteration is selected                                     | Activate Go to                             | Execution selection                        | Immediate                                                 | Existing selection callback returns to live iteration                                                             | Live dock becomes interactive                      | `P`, CAP-6 finished-iteration clause                            | `RA` AD-16                                                                      | `E` Story 2.10 AC 1, 3                                                                 | MATCHED                        | —                                                                                     |
| M-075 | `CNR:254-278,281-287`; `LNR:245-279`                                  | Read-only queue band on finished iteration               | Shared live queue is nonempty and finished iteration is selected   | Inspect band                               | Live node queue                            | Serial queue read                                         | Band mirrors ordered pending items without mutation controls                                                      | Messages remain pending for live iteration         | `P`, CAP-6 and CAP-8                                            | `RA` AD-16                                                                      | `E` Story 2.10 AC 1-3                                                                  | MATCHED                        | —                                                                                     |
| M-076 | `CNR`/`LNR` `viewingStale` branches; `CS`, finished-iteration section | No mutation; queue GET allowed                           | Finished iteration is selected                                     | Leave view open                            | Network operations                         | While view stays selected                                 | Only authenticated node-scoped queue GET is allowed                                                               | Server queue remains live and shared               | `P`, CAP-6 finished-iteration clause                            | `RA` AD-16                                                                      | `E` Story 2.10 AC 2                                                                    | MATCHED                        | —                                                                                     |
| M-077 | `CNR:147,421-467`; `LNR:135,408-430`                                  | Select finished loop iteration                           | Live loop has prior occurrences                                    | Choose earlier Execution option            | Transcript, header, and dock               | Immediate                                                 | Earlier occurrence becomes the selected read view                                                                 | Live iteration remains identified                  | `P`, CAP-6                                                      | `RA` AD-16                                                                      | `E` Story 2.10 AC 1                                                                    | MATCHED                        | —                                                                                     |
| M-078 | `CNR:421-467,551-597`; `LNR:408-430,543-551`; `HO:155-161`            | Finished iteration shows its final Todo checklist        | Finished loop iteration is selected                                | Inspect pinned Todo                        | Selected occurrence Todo state             | Immediate after selection                                 | Checklist switches to that iteration's final fold                                                                 | Live iteration Todo remains recoverable on return  | No exact PRD clause                                             | No exact Architecture decision                                                  | No exact Epic or Story AC                                                              | MISSING                        | —                                                                                     |
| M-079 | `CNR`/`LNR` finished-iteration mode; `CS`, finished-iteration section | Queue retains order on return live                       | Pending queue exists while finished iteration is selected          | Activate Go to live                        | Shared queue and dock                      | Immediate                                                 | Live controls return and pending order is unchanged                                                               | Messages remain deliverable                        | `P`, CAP-6 finished-iteration clause                            | `RA` AD-16                                                                      | `E` Story 2.10 AC 3                                                                    | MATCHED                        | —                                                                                     |
| M-080 | `CNR:212-215`; `LNR:198-201`; `CS`, finished-iteration section        | Delivered messages stay inline                           | Guidance was delivered during selected occurrence                  | View finished iteration                    | Operator transcript rows                   | Transcript load                                           | Delivered rows appear in occurrence group, not queue band                                                         | Pending queue shows only undelivered items         | `P`, CAP-11                                                     | `RA` AD-16; `SA` AD-6                                                           | `E` Story 2.10 AC 4                                                                    | MATCHED                        | —                                                                                     |
| M-081 | `CS`, end of finished-iteration section; dock absence in prototypes   | No dock on a different non-live execution                | Selected execution is a different run, not a live-loop occurrence  | Open execution                             | Dock region                                | Initial render                                            | Steering dock is absent                                                                                           | Historical transcript remains readable             | `P`, CAP-6 finished-iteration clause                            | `RA` AD-16                                                                      | `E` Story 2.10 AC 5                                                                    | MATCHED                        | —                                                                                     |
| M-082 | `CNR:328`; `SDS:66,279`; run-header context in both surfaces          | Cancel remains separate                                  | Node is running                                                    | Compare Stop and Cancel                    | Provider turn versus node lifecycle        | Before operator action                                    | Stop affects the turn; Cancel remains the node action                                                             | Neither control impersonates the other             | `P`, CAP-9 and Non-goals                                        | `SA` AD-1, AD-2                                                                 | `E` FR9; Story 2.3 AC 2                                                                | MATCHED                        | —                                                                                     |
| M-083 | `CNR:353`; `SDS:122`; `CS`, “What the stop control must not imply”    | Stop does not undo                                       | Tool writes completed before interrupt                             | Read disclosure                            | Completed filesystem effects               | Idle-after-interrupt render                               | Copy states that interruption does not roll back work                                                             | Written changes remain                             | `P`, “Interrupt is not undo”                                    | `SA` AD-1                                                                       | `E` FR9; Story 2.3 AC 5                                                                | MATCHED                        | —                                                                                     |
| M-084 | `CS`, “On send”; queue states in `CNR` and `LNR`                      | Delivery failure returns items to queue front            | Queue flush starts and provider delivery fails                     | Observe failure                            | Drained queue batch                        | On delivery failure                                       | Failed batch returns to the front and assertive alert fires                                                       | Later items remain behind it                       | `P`, CAP-10 safety rules                                        | `SA` AD-3 and consistency conventions do not state front reinsertion completely | `E` Story 2.3 AC 8 covers alert but no AC requires front reinsertion                   | PARTIAL                        | —                                                                                     |
| M-085 | `CNR` interrupting and generating states; `SA` AD-11 race table       | Stop loses race to empty natural finish                  | Natural turn ends before interrupt takes effect and queue is empty | Activate Stop near boundary                | Turn and node                              | Race resolution                                           | Node completes naturally or route returns node-finished truth; no false idle state                                | No accepted message exists to lose                 | `P`, interrupt race rule                                        | `SA` AD-11                                                                      | `E` Story 2.3 AC 3                                                                     | MATCHED                        | —                                                                                     |
| M-086 | `CNR` interrupting and generating-again states; `SA` AD-11            | Stop loses race with queued guidance                     | Natural turn ends first and accepted queue is nonempty             | Activate Stop near boundary                | Turn and queue                             | Race resolution                                           | Queue auto-drains and route reports generating                                                                    | Accepted messages remain ordered                   | `P`, CAP-10 turn-end causes                                     | `SA` AD-4, AD-11                                                                | `E` Story 2.3 AC 3                                                                     | MATCHED                        | —                                                                                     |
| M-087 | Draft label in `CNR`/`LNR`; `HO:314`                                  | Unsubmitted draft is tab-local                           | Text has not been queued                                           | Type without submitting                    | Composer draft                             | While composing                                           | Draft stays only in this tab                                                                                      | Server queue is unchanged                          | `P`, “Two queues”                                               | `SA` AD-3                                                                       | `E` Story 2.9 AC 2                                                                     | MATCHED                        | —                                                                                     |
| M-088 | `CNR`/`LNR` queue band; detached and restart notes                    | Accepted queue survives tab close but not restart        | Server accepted message                                            | Close tab or restart server                | Node registry queue                        | Tab close or process restart                              | Tab close preserves queue; restart drops in-process steering state                                                | Normal run recovery remains unchanged              | `P`, CAP-8 and in-process-only rule                             | `SA` AD-5                                                                       | `E` FR8, NFR4; Story 2.9 AC 1-2                                                        | MATCHED                        | —                                                                                     |
| M-089 | `CNR`/`LNR` queue band; `SDS` live states                             | Shared queue across views                                | Same node is open in two permitted views                           | Queue or withdraw in one view              | Node-scoped queue                          | Next serial refresh                                       | Both views converge on count, ids, and order                                                                      | Drafts remain separate                             | `P`, CAP-8                                                      | `SA` AD-5, AD-11                                                                | `E` Story 2.9 AC 1-4                                                                   | MATCHED                        | —                                                                                     |
| M-090 | `CNR:339-352`; `LNR:330-342`; `SDS:89-118`                            | Focus transfers from Stopping to Send now                | Focus is on Stopping when interrupt completes                      | Wait for transition                        | Keyboard focus and replacement control     | On sub-state transition                                   | Focus lands on Send now rather than body                                                                          | Composer remains ready                             | `P`, Write accessibility constraints are general                | `SA` AD-9 projects state but has no exact focus rule                            | `E` NFR8 and Story 2.3 AC 8 do not name this replacement-focus case                    | PARTIAL                        | —                                                                                     |
| M-091 | `CNR`/`LNR` finished-clean state; `E` UX-DR6                          | Dock removal moves focus to transcript                   | Focus is inside dock when terminal clean state removes it          | Let node end                               | Keyboard focus                             | On dock removal                                           | Focus moves to last transcript row, never document body                                                           | Transcript remains navigable                       | `P`, Write accessibility constraints                            | `SA` AD-9 and accessibility binding                                             | `E` Story 2.3 AC 8; UX-DR6                                                             | MATCHED                        | —                                                                                     |
| M-092 | State changes in `CNR`, `LNR`, and `SDS`                              | Coalesced polite announcements                           | Several sub-state changes occur quickly                            | Operate Stop and Send now                  | Live region                                | Serialized by transition                                  | One polite region announces the latest meaningful transition                                                      | No row-by-row announcement noise                   | `P`, Write accessibility constraints                            | `RA` AD-12 item 3; `SA` AD-9                                                    | `E` UX-DR7; Story 2.3 AC 8                                                             | MATCHED                        | —                                                                                     |
| M-093 | Terminal residue and delivery-failure states                          | Assertive delivery failure                               | Send or reconciliation reports undelivered guidance                | Observe state                              | Alert message                              | Immediately on failure                                    | `role="alert"` announces the failure                                                                              | Read-only evidence remains visible                 | `P`, Write accessibility constraints                            | `SA` AD-9, AD-11                                                                | `E` Story 2.3 AC 8; Story 2.11 AC 3                                                    | MATCHED                        | —                                                                                     |
| M-094 | Both shipping surfaces; motion styles in handoff                      | Reduced motion                                           | User prefers reduced motion                                        | Interact with disclosures and dock         | Transitions                                | During interaction                                        | Nonessential motion is suppressed without hiding state                                                            | Controls and status remain usable                  | `P`, Write accessibility constraints                            | `RA` AD-12 accessibility binding; `SA` AD-9                                     | `E` NFR8, UX-DR7; Story 2.1 AC 6                                                       | MATCHED                        | —                                                                                     |
| M-095 | `SDS:250-256`; operator rows in `CNR`/`LNR`                           | `sent` status                                            | Operator message was written without provider echo                 | Read transcript                            | Operator row badge                         | After executor writes row                                 | Badge remains `sent` for every v1 provider                                                                        | It never advances by text or time                  | `P`, CAP-13                                                     | `SA` AD-8                                                                       | `E` Story 2.8 AC 5                                                                     | MATCHED                        | —                                                                                     |
| M-096 | `SDS:257-261`                                                         | `delivered` status                                       | Claude SDK is at least 0.3.246 and id echo gate passes             | Read matching operator row                 | One operator message                       | On caller-stamped id echo                                 | Badge advances from sent to delivered by id only                                                                  | Other providers remain sent                        | `P`, CAP-13 and v1 release gate                                 | `SA` AD-8; Deferred                                                             | `E` G1 AC and gate                                                                     | DEFERRED_WITH_USER_APPROVAL    | `OD:13` records owner decision that delivered is post-v1 gated backlog                |
| M-097 | `SDS:263-267`; terminal states `149-210`                              | `Never sent` status                                      | Observed sent id has no terminal operator row                      | Read terminal residue                      | Undelivered guidance                       | After terminal reconciliation                             | Message is restored with Never Sent status                                                                        | No false delivery claim remains                    | `P`, terminal reconciliation rule                               | `SA` AD-11                                                                      | `E` Story 2.11 AC 1-3                                                                  | MATCHED                        | —                                                                                     |
| M-098 | Controls above `CNR` and `LNR` frames; `HO`, Screens                  | Eight-state review switch                                | Reviewer opens prototype                                           | Choose a state tab                         | Prototype-only whole screen                | Immediate                                                 | Prototype changes among eight review states                                                                       | No product state is mutated                        | No exact product PRD requirement                                | No exact Architecture decision                                                  | No exact Epic or Story AC                                                              | DEFERRED_WITHOUT_USER_APPROVAL | `HO` calls it review scaffolding, but no direct user decision source approves removal |
| M-099 | Controls above `CNR` and `LNR` frames; `HO`, Screens                  | Prompt versus loop review switch                         | Reviewer opens prototype                                           | Toggle node kind                           | Prototype execution model                  | Immediate                                                 | Prototype exposes prompt and loop examples                                                                        | No product state is mutated                        | No exact product PRD requirement                                | No exact Architecture decision                                                  | No exact Epic or Story AC                                                              | DEFERRED_WITHOUT_USER_APPROVAL | `HO` calls it review scaffolding, but no direct user decision source approves removal |
| M-100 | `CNR:500-509`; `LNR:463-472`; controls above frames                   | Claude soft-inject versus Codex queue-only review switch | Reviewer opens prototype                                           | Toggle provider mode                       | Prototype queue controls                   | Immediate                                                 | Per-item control appears only in soft-inject review mode                                                          | Product provider capability is unchanged           | No PRD requires a product provider toggle                       | No Architecture decision requires this UI                                       | No Epic or Story AC requires this UI                                                   | DEFERRED_WITHOUT_USER_APPROVAL | `HO` calls it review scaffolding, but no direct user decision source approves removal |
| M-101 | Send controls in `CNR`, `LNR`, and `SDS`; `HO`, bordered-control note | Bordered send control in both shells                     | Dock is interactive                                                | View send control                          | Queue or Send now button                   | Render time                                               | Both shells use bordered controls with accessible contrast                                                        | Right-edge position carries primacy                | `P`, shared-shell and accessibility constraints                 | `SA` AD-9; `RA` AD-1                                                            | `E` UX-DR8                                                                             | MATCHED                        | —                                                                                     |
| M-102 | `LNR` 460px frame; `CNR` 520px panel; `HO`, Screens                   | Narrow-shell adaptation                                  | Node room uses either supported panel width                        | Resize or compare shells                   | Rows, bands, and dock                      | Layout time                                               | Same behavior fits both widths with each token root                                                               | No horizontal behavior fork appears                | `P`, shared-shell constraints                                   | `RA` AD-1, AD-11, AD-12                                                         | `E` NFR2, UX-DR8                                                                       | MATCHED                        | —                                                                                     |
| M-103 | Queue bands in `CNR`/`LNR`; `CS`, finished-iteration section          | Queue list caps at `33vh`                                | Queue contains many items                                          | Expand queue                               | Queue list                                 | Layout time                                               | Queue scrolls within a 33vh maximum                                                                               | Composer or read-only disclosure stays reachable   | `P`, CAP-6 finished-iteration clause and bounded UI requirement | `RA` AD-16                                                                      | `E` Story 2.10 AC 1-2                                                                  | MATCHED                        | —                                                                                     |
| M-104 | `TS:52-60`; all status rows; `SDS:233-267`                            | Color-independent accessible status                      | Any call or message status is shown                                | Read visually or with assistive technology | Glyph, label, and badge                    | Every render                                              | Character and text carry meaning; color only reinforces                                                           | Status remains distinguishable under reduced color | `P`, Read and Write accessibility constraints                   | `RA` AD-10, AD-13; `SA` AD-9                                                    | `E` NFR2, NFR8, UX-DR2; Story 1.1 AC 3                                                 | MATCHED                        | —                                                                                     |

### Matrix Coverage

| Comparison status              | Atomic rows |
| ------------------------------ | ----------: |
| MATCHED                        |          88 |
| PARTIAL                        |           4 |
| MISSING                        |           2 |
| CONFLICT                       |           4 |
| UNCLEAR                        |           0 |
| DEFERRED_WITH_USER_APPROVAL    |           2 |
| DEFERRED_WITHOUT_USER_APPROVAL |           4 |
| **Total**                      |     **104** |

- Strict fully matched coverage is 88 of 104 rows, or 84.6%.
- Fully matched or directly user-approved deferred coverage is 90 of 104 rows, or 86.5%.
- Fourteen rows block readiness under the project customization: four PARTIAL, two MISSING, four CONFLICT, and four DEFERRED_WITHOUT_USER_APPROVAL.
- The two user-approved deferrals are M-052 and M-096.
- The live-render limitation means these figures prove source-defined behavior coverage, not pixel-level rendering fidelity.

The matrix exposes six more planning gaps beyond the visible source conflicts.
M-068 lacks an exact Story criterion for the read-only terminal residue and control removal.
M-070 lacks an exact Story criterion for complete dock absence on a clean terminal node.
M-084 lacks exact Architecture and Story criteria for returning a failed delivery batch to the front of the queue.
M-090 lacks exact Architecture and Story criteria for focus transfer from `Stopping…` to `Send now`.
M-069 and M-078 are absent from one or more required planning layers.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY**

Functional requirement traceability is 100%, and the two-epic structure is sound.
That result does not override the unresolved normative conflicts, incomplete story acceptance criteria, and fourteen blocking mockup-matrix rows.
The project customization requires a NOT READY result while any matrix row is PARTIAL, MISSING, CONFLICT, UNCLEAR, or DEFERRED_WITHOUT_USER_APPROVAL, or lacks an exact citation in any required planning layer.

### Critical Issues Requiring Immediate Action

1. Correct the approved handoff so the interactive sources match the selected behavior for Todo placement, unchanged terminal Todo state, the full-width queue band, and tab-local labeling.
2. Resolve UX-A1 by making interrupted status universal across all v1 providers, and resolve UX-A2 by removing `Send now` from inactivity-timer re-arm activity.
3. Rewrite Story 2.11 with the exact terminal reconciliation evidence model: an observation ledger, omission preservation, confirmed-withdraw removal, exact node-terminal evidence or exact-scope Ask projection, Cancel catch-up, a complete unfiltered node transcript drain, fail-closed ambiguity handling, and last-position handling for a half-typed draft.
4. Add exact PRD, Architecture, and Story criteria for M-068, M-069, M-070, M-078, M-084, and M-090.
5. Obtain and cite direct user decisions for M-040 and the three review-scaffold controls, or promote each behavior into all three planning layers.
6. Correct Story 1.3 to name `logical-tool-cards-v1` as the only generic-fallback denominator.
7. Add an implementation-task breakdown for Story 2.3 without replacing its user-value story.
8. Clarify Story 2.8's persisted row versus projected item distinction, add Story 2.8 to Story 2.10's dependencies, and qualify Story 2.13's within-stream ordering guarantee.

### Recommended Next Steps

1. Update the canonical PRD companions, both Architecture spines, UX documents, Epics, and approved handoff as one reconciliation change.
2. Record direct user dispositions for every proposed mockup removal or deferral that does not already have owner evidence.
3. Add the Story 2.3 execution task sequence and the missing terminal-reconciliation verification cases before coding starts.
4. Re-run this implementation-readiness workflow against the same `agent-node-room` boundary.
5. Perform a live rendered inspection when an approved local rendering surface is available, because this assessment could verify source behavior but not pixels.

### Final Note

This assessment recorded fourteen blocking atomic mockup rows and eight UX or epic-quality findings across three review areas.
Q5 overlaps the terminal-reconciliation gaps in M-068 through M-070, so these counts are evidence views rather than an additive defect total.
The two owner-approved post-v1 deferrals, M-052 and M-096, do not block v1.
Address every blocking row and the critical cross-artifact issues before implementation.

**Assessment date:** 2026-09-20.
**Assessor:** Codex, using the BMAD implementation-readiness workflow and the active project customization.
