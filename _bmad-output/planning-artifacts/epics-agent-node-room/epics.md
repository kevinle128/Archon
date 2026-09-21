---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
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
  - ../../../claude-design/design_handoff_node_room_transcript_steering/README.md
mockup: ../../../claude-design/design_handoff_node_room_transcript_steering/
---

# Archon — Agent Node Room — Epic Breakdown

## Overview

This document decomposes `spec-agent-node-room` into two user-value epics for the Legacy and Console node rooms.

- **Epic 1 — Readable Agent Transcript** replaces raw-JSON tool output with a transcript that operators can scan and inspect.
  It is retroactive and uses data that is already stored.
  It has no schema, migration, or backend change.
- **Epic 2 — Live Agent Steering** lets operators queue guidance, interrupt and redirect each supported provider, and audit the result without stopping the node.
  It is in-process and reaches only a node whose executor is in the current server process.
  v1 ends at the interrupt + `Queue` + `sent` floor.

Epic 1 ships first and supplies the transcript primitives that Epic 2 uses for interrupted tool rows and operator messages.
Each story delivers one observable feature that can be accepted independently.
Registry, routes, sub-state projection, race handling, API regeneration, tests, and accessibility work are tasks or acceptance criteria of the feature that owns them.
They are not separate technical stories.

The mockup handoff is in `claude-design/design_handoff_node_room_transcript_steering/`.
The contracts and the two UX documents win if a mockup conflicts with them.
The implementation must use existing Legacy and Console tokens instead of copying literal mockup values.

The Legacy surface is in `packages/web/src/components/workflows/`.
The Console surface is in `packages/web/src/experiments/console/`.
Shared render-neutral logic belongs in `packages/web/src/lib/`.
`@archon/web` must not import `@archon/workflows`.
Console must not import from `@/components/`.
Both node rooms ship together, with thin JSX implemented on each surface.

## Requirements Inventory

### Functional Requirements

FR1 (CAP-1): Render each tool call as one scannable row with a family chip, status glyph, salient headline, and right-aligned badges.
Successful calls are collapsed on first render, failed calls are expanded, and a collapsed row contains no serialized-data punctuation.

FR2 (CAP-2): Expand a call into a body shaped for its family as defined by `tool-presentation-contract.md`.
A tool that matches no family renders at most three scalar `key: value` pairs, with `{…}` or `[n]` for objects and arrays, and never renders a JSON dump.
Generic fallback must remain below 2% of production rows.

FR3 (CAP-3): Fold provider todo calls into `TodoPhase[]` current state.
Every todo call remains a one-line transcript row.
The checklist appears only in a pinned strip at the top of the transcript, stays visible during scroll, and is absent when there are no todos.
An `rm`-emptied phase disappears.

FR4 (CAP-4): Render a subagent dispatch as batch context plus one collapsible card for each normalized `TaskSubtask`, with the subtask name and agent.

FR5 (CAP-5): Render an inline line diff when a file-edit payload contains before and after content.
Otherwise render a path and preview, and never fabricate a diff from one side.

FR6 (CAP-6): Group rows by `occurrence_id` when a node has more than one occurrence.
Never group by `attempt_id`.
Provide a loop-iteration selector that navigates to the group headers, and omit both group headers and selector for a single occurrence.

FR7 (CAP-7): Every tool card provides a Raw toggle that reveals the original JSON and is closed by default.
Raw is the only place serialized JSON appears, and the current `canLoadFullOutput` flow remains available.

FR8 (CAP-8): Mount and enable a composer while the node runs.
While the agent generates, send reads `Queue` and holds guidance without interrupting the current turn.
The executor delivers queued guidance at the natural turn boundary.
The unsent draft is tab-local and the server queue is node-scoped and process-local.

FR9 (CAP-9): An interrupt ends the current provider turn but keeps the provider session and workflow node alive.
The node stays `running`, the agent enters `idle-after-interrupt`, and the in-flight tool call is `interrupted`, not `failed`.
Interrupt is distinct from Cancel and does not undo written work.

FR10 (CAP-10): During `idle-after-interrupt`, send reads `Send now`.
It flushes already queued messages and the new message in written order as the next turn on the same provider session.
The node continues and never enters a workflow resume state.

FR11 (CAP-11): Operator messages and interrupted tool calls appear as ordinary transcript rows in happened order.
An operator row is clearly distinct from agent text and shows its sender.

FR12 (CAP-12): Sending is an ordinary provider prompt.
Every provider supports boundary delivery through `Queue` and interrupt-then-continue in v1.
Mid-turn soft-inject remains provider-gated post-v1 work.

FR13 (CAP-13): A delivered operator message reads `sent` at the v1 floor.
The Claude-only `sent → delivered` advance remains gated on an SDK version that echoes the stamped message id.

### NonFunctional Requirements

NFR1: Epic 1 has no schema, migration, or backend change and improves historical runs immediately.

NFR2: Status is decodable without colour because the glyph carries the meaning.

NFR3: Raw `JSON.stringify` output never appears as the default transcript presentation.

NFR4: Steering state is in-process and non-durable.
A server restart drops the live steering handle and in-flight steering state, while normal run recovery remains unchanged.

NFR5: An operator interrupt never fails the workflow node and never trips the node-level Cancel abort check.

NFR6: Idle-after-interrupt uses a fixed 30-minute inactivity timer.
Composer activity re-arms the timer through keepalive.
Retrying the failed node starts a fresh provider session.

NFR7: The implementation uses strict TypeScript, has no unjustified `any`, produces no ESLint warnings, and passes `bun run validate`.

NFR8: Both surfaces meet the WCAG 2.2 AA requirements in `EXPERIENCE.md` and `DESIGN.md`.
This includes colour-independent status, serialized live-region announcements, assertive delivery-failure alerts, timing disclosure, `aria-disabled` behavior, contrast, keyboard access, and reduced motion.

### Additional Requirements

- Wire types for `@archon/web` come from `api.generated.d.ts` through `lib/api.ts`.
- The shared tool presenter is a pure React-free module at `packages/web/src/lib/tool-presentation.ts`.
- Tool-family resolution uses the four contract tiers, exact-token alias matches, edge normalization, Codex shell-wrapper stripping, and the declared MCP label conversion.
- Inline diffs use a bounded and memoized `packages/web/src/lib/diff-hunks.ts`, the existing `git-hunk-adapter.ts`, and `react-diff-view`.
- Interrupt uses a fresh per-turn signal composed with the node-level signal and never aborts the one-shot node controller.
- Same-session turns reuse the established `attemptResumeId` seam.
- The live registry is keyed by `(runId, nodeId)` and is torn down on every terminal outcome.
- Send, interrupt, keepalive, and withdraw use typed OpenAPI routes under `resolveAuthContext` and the steering actor grant.
- Operator messages use ordinary text rows with additive strict metadata for `origin`, `operator_user_id`, and `message_id`.
- The executor is the only writer for operator rows.
- Terminal reconciliation runs only on the node terminal event.

### UX Design Requirements

UX-DR1 (CAP-1): A collapsed row contains a chevron, status glyph, family chip, elided headline, and non-wrapping badges.

UX-DR2 (CAP-1/CAP-9): Use the five colour-independent glyphs `✓ ✕ ◐ ⚠ –`.
Interrupted uses `⚠` and is never a recoloured failure glyph.

UX-DR3 (CAP-2/3/4/5): Expanded bodies use the declared terminal, diff, match, path, code, todo, task, or generic presentation.

UX-DR4 (CAP-8/9/10): The dock reflects `generating`, UI-local `interrupting`, `idle-after-interrupt`, generating again, and finished states.

UX-DR5 (CAP-11): An operator row shows `operator · <sender display name>`, full-strength text, and the delivery badge.

UX-DR6 (CAP-9/10): The dock discloses the 30-minute inactivity behavior, shows `NEVER SENT` after reconciliation, and restores focus safely when removed.

UX-DR7: Live-region output is serialized by transition.
Delivery failure is assertive.
Blocked controls use `aria-disabled` with an accessible reason.
Reduced-motion and visible-label matching requirements apply to both surfaces.

UX-DR8: The Legacy and Console docks use their own token roots but have identical anatomy, order, wording, and bordered send controls.

UX-DR9 (CAP-3): The pinned todo strip is in scope and is the only place the current checklist appears.

UX-DR10 (CAP-6): The loop-iteration selector is in scope and navigates to occurrence-group headers.

### FR Coverage Map

| FR / CAP                            | Story coverage               |
| ----------------------------------- | ---------------------------- |
| FR1 (CAP-1)                         | 1.1                          |
| FR7 (CAP-7)                         | 1.2                          |
| FR2 (CAP-2)                         | 1.3                          |
| FR5 (CAP-5)                         | 1.4                          |
| FR3 (CAP-3)                         | 1.5                          |
| FR4 (CAP-4)                         | 1.6                          |
| FR6 (CAP-6)                         | 1.7                          |
| FR8 (CAP-8)                         | 2.1, 2.2, 2.9, 2.10          |
| FR9 (CAP-9)                         | 2.3, 2.4, 2.5, 2.6, 2.7      |
| FR10 (CAP-10)                       | 2.3, 2.4, 2.5, 2.6, 2.7      |
| FR11 (CAP-11)                       | 2.8, 2.13                    |
| FR12 (CAP-12) v1 floor              | 2.1, 2.3, 2.4, 2.5, 2.6, 2.7 |
| FR12 (CAP-12) post-v1 soft-inject   | G2, G3, G4                   |
| FR13 (CAP-13) `sent` floor          | 2.8                          |
| FR13 (CAP-13) post-v1 `delivered`   | G1                           |
| Terminal reconciliation             | 2.11                         |
| 30-minute idle-await safety         | 2.12                         |
| Concurrent ordering and attribution | 2.13                         |

## Epic List

1. **Epic 1 — Readable Agent Transcript** (CAP-1…7) lets operators scan, inspect, and navigate historical or live agent activity without reading raw JSON.
2. **Epic 2 — Live Agent Steering** (CAP-8…13) lets operators queue guidance, interrupt and redirect each supported provider, and audit steering safely while the workflow node stays running.

---

## Epic 1: Readable Agent Transcript

Operators can understand an agent node from a compact transcript on both web surfaces.
The feature is a pure presentation of stored data and improves historical runs as soon as it ships.

### Story 1.1: Scan a tool call as one readable row

As an operator opening an agent node,
I want each tool call rendered as one readable row,
So that I can follow the agent without reading serialized data.

**Acceptance Criteria:**

**Given** a node with tool calls
**When** I open it in Legacy or Console
**Then** each call renders as one row with a chevron, family chip, status glyph, salient headline, and right-aligned badges
**And** successful calls start collapsed, failed calls start expanded, and no collapsed row contains serialized-data punctuation.

**Given** rows with `success`, `failed`, `running`, `interrupted`, and unknown outcomes
**When** the transcript first renders
**Then** initial expansion is table-driven as collapsed, expanded, collapsed, collapsed, and collapsed respectively
**And** the five states are covered by one focused test table.

**Given** any status
**When** the row renders
**Then** its meaning is available without colour through `✓ ✕ ◐ ⚠ –`
**And** the chip uses the sent tool name only when it is one token of at most 24 characters, otherwise it uses the family name.

**Given** malformed or adversarial stored payloads
**When** the presenter resolves them
**Then** each payload degrades to a safe generic row without throwing
**And** every bounded algorithm terminates.

**Given** an existing or future interrupted status row immediately after a tool call
**When** the transcript derives the call outcome
**Then** it folds that status into the preceding call and renders `⚠ interrupted`.

_Refs:_ CAP-1, NFR1–3, UX-DR1–2, `tool-presentation-contract.md`, `test-plan.md`.

### Story 1.2: Inspect the raw payload of a tool call

As an operator who needs exact diagnostic data,
I want to open the original payload for one tool call,
So that readable presentation never hides information I need for debugging.

**Acceptance Criteria:**

**Given** any tool row
**When** I activate its Raw toggle
**Then** the original JSON appears in an expanded raw panel
**And** the panel is closed by default.

**Given** a payload whose full output is not loaded
**When** I request Raw
**Then** the existing `canLoadFullOutput` flow remains available
**And** loading failure is shown without replacing the readable row.

**Given** the transcript outside an open Raw panel
**When** it renders
**Then** serialized JSON does not appear anywhere else.

_Refs:_ CAP-7, NFR3, `tool-presentation-contract.md`.
_Depends on:_ Story 1.1.

### Story 1.3: Read expanded details shaped for the tool family

As an operator,
I want expanded tool details shaped for the kind of action,
So that I see a terminal, search result, path list, code block, or web result instead of a data structure.

**Acceptance Criteria:**

**Given** a known tool family
**When** I expand its row
**Then** shell renders command, output, and exit state; search renders matches or paths by `output_mode`; glob renders flat paths; code renders highlighted source; and web renders URL plus markdown.

**Given** aliases and provider-specific payload shapes
**When** the presenter classifies them
**Then** it follows the four resolution tiers, uses exact-token alias matching, and normalizes provider shapes only at the edge.

**Given** a tool that matches no family
**When** I expand it
**Then** it shows at most three scalar `key: value` pairs
**And** objects and arrays collapse to `{…}` and `[n]` instead of JSON.

**Given** the production corpus
**When** the read-only release audit resolves distinct tool names with row counts
**Then** it records the generic numerator, denominator, and fraction
**And** the release gate fails if generic fallback is 2% or more.

_Refs:_ CAP-2, UX-DR3, `tool-presentation-contract.md`, `test-plan.md`.
_Depends on:_ Story 1.1.

### Story 1.4: View a file edit as an inline diff

As an operator reviewing an agent change,
I want a file edit shown as an inline line diff,
So that I can understand the change without leaving the transcript.

**Acceptance Criteria:**

**Given** a file-edit payload with before and after content
**When** I expand it
**Then** it renders add, delete, and hunk lines through `react-diff-view` — a single hunk undecorated, a text-only `@@` separator before each later hunk.

**Given** a persisted file tool row without both before/after string sides — a one-sided write, a refused pair, or a call with no usable input
**When** I expand it
**Then** it renders path and preview
**And** it never fabricates a diff.

**Given** a failed file-edit row with a qualified pair
**When** I expand it
**Then** the attempted diff still renders and the normalized failure output appears alongside it.

**Given** pathological or large content
**When** the diff is computed
**Then** `diff-hunks.ts` applies the declared byte, line, and `maxEditLength` caps — all functions of the inputs, never a wall-clock timeout
**And** it falls back to path and preview instead of blocking the UI
**And** display lines strip ANSI/C0/C1 and escape `Cf`/`U+2028`/`U+2029` as `\u{HEX}` so hostile content cannot draw hidden or fake rows.

**Given** repeated content, mid-array no-newline markers, repeated computation, or adapter conversion
**When** tests run
**Then** output is deterministic, memoized (per-record `WeakMap` plus the dual-bounded pair cache), and has valid snippet-relative line numbers as required by the diff contract.

_Scope:_ presentation-only over persisted tool rows. Current Codex `file_change` events are emitted as `system` chunks (`codex/provider.ts:709`) that the executor debug-logs (`dag.system_message_unhandled`) rather than persisting, so they never become file rows and nothing here is a Codex row. Making successful Codex file-change events visible in the transcript is separately tracked work.

_Refs:_ CAP-5, UX-DR3, `test-plan.md` diff-hunks contract.
_Depends on:_ Stories 1.1 and 1.3.

### Story 1.5: Track the agent's current todo state in a pinned strip

As an operator,
I want the agent's current todo state pinned above the transcript,
So that I can track the plan while the transcript scrolls.

**Acceptance Criteria:**

**Given** OMP todo operations or Claude whole-list `TodoWrite` calls
**When** the transcript derives current state
**Then** both shapes fold into one `TodoPhase[]` according to `todo-fold-contract.md`.

**Given** current todo state
**When** the transcript renders
**Then** a pinned strip shows phase headers and per-item status, remains visible while the transcript scrolls, and is absent when there are no todos.

**Given** any todo call in transcript history
**When** the row renders
**Then** it stays a compact one-line row
**And** the checklist is not duplicated inline.

**Given** an `rm` operation that empties a phase
**When** state folds
**Then** the empty phase disappears.

_Refs:_ CAP-3, UX-DR3, UX-DR9, `todo-fold-contract.md`.
_Depends on:_ Story 1.1.

### Story 1.6: Inspect a subagent dispatch and its subtasks

As an operator,
I want a subagent dispatch shown as its brief and subtasks,
So that I can see what work was delegated and to which agent.

**Acceptance Criteria:**

**Given** an OMP batch dispatch or Claude single-task dispatch
**When** I expand its row
**Then** both provider shapes normalize to `TaskSubtask[]`.

**Given** a normalized dispatch
**When** the body renders
**Then** batch context appears as markdown
**And** each subtask appears as one collapsible card that names the subtask and agent.

**Given** malformed task data
**When** normalization runs
**Then** it degrades to a safe generic body without crashing the transcript.

_Refs:_ CAP-4, UX-DR3, `tool-presentation-contract.md`.
_Depends on:_ Story 1.1.

### Story 1.7: Navigate transcript occurrences and loop iterations

As an operator reviewing a repeated node,
I want to navigate each occurrence or loop iteration,
So that repeated execution is not one undifferentiated transcript.

**Acceptance Criteria:**

**Given** rows from more than one `occurrence_id`
**When** the transcript renders
**Then** it shows one header per occurrence
**And** grouping never uses `attempt_id`.

**Given** more than one occurrence
**When** I use the loop-iteration selector
**Then** it navigates directly to the matching occurrence header
**And** keyboard and focus behavior are equivalent on both surfaces.

**Given** a single occurrence
**When** the transcript renders
**Then** it shows neither occurrence headers nor an iteration selector.

_Refs:_ CAP-6, UX-DR10, `EXPERIENCE.md`.
_Depends on:_ Story 1.1.

---

## Epic 2: Live Agent Steering

Operators can guide a live agent without cancelling the workflow node.
Every story below delivers one operator-visible feature.
Shared engine and transport work stays inside the first feature that needs it.

### Story 2.1: Queue guidance for a running agent

As an operator watching a running node,
I want to queue guidance without disturbing the current turn,
So that the agent receives it at the next natural boundary.

**Acceptance Criteria:**

**Given** a running agent that is generating
**When** the dock renders
**Then** the composer is enabled, send reads `Queue`, queued messages show under `QUEUED · n`, and unsent draft text is labelled `this tab only`.

**Given** I submit guidance with the button or `Cmd`/`Ctrl`+Enter
**When** the send route accepts it with `intent: 'queue'`
**Then** it enters the process-local queue keyed by `(runId, nodeId)` immediately
**And** the current turn and in-flight tool call remain untouched.

**Given** a natural turn boundary
**When** queued guidance exists
**Then** the executor drains it in server receipt order as the next turn on the same provider session
**And** the node remains `running`.

**Given** a duplicate `message_id`
**When** the send route receives it
**Then** it returns the original receipt idempotently and creates no duplicate queue item.

**Given** an unauthenticated caller, invalid payload, unknown run or node, detached run, or terminal node
**When** send is attempted
**Then** the typed route returns the contract status and changes no node, queue, or transcript state.

**Given** a pending ask or other blocked state
**When** the composer renders
**Then** send uses `aria-disabled` with an `aria-describedby` reason, plain Enter inserts a newline, the shortcut uses the same guard as the button, and reduced-motion preferences are respected.

**Given** the run starter, another authenticated member, an admin, or an identity-less run
**When** the send route authorizes the request
**Then** the steering actor grant applies exactly as defined in the API contract.

_Refs:_ CAP-8, CAP-12 v1 floor, NFR4, NFR8, UX-DR4, UX-DR7–8, `steering-api-contract.md`, `engine-integration.md`.

### Story 2.2: Withdraw a queued guidance message

As an operator,
I want to withdraw guidance that has not left the queue,
So that obsolete instructions do not reach the agent.

**Acceptance Criteria:**

**Given** a message still in the live node queue
**When** I activate its delete control
**Then** the typed withdraw route removes it and returns `{ success: true, message_id }`.

**Given** a message that already drained or an unknown `message_id`
**When** withdraw is repeated
**Then** it returns the same idempotent success response
**And** it does not return a message-level 404.

**Given** an unknown run or node, unauthenticated caller, or malformed request
**When** withdraw is attempted
**Then** the contract error is returned and no queue, node, or transcript state changes.

**Given** keyboard or screen-reader operation
**When** the delete control is used
**Then** its accessible name identifies the specific queued message and focus moves predictably after removal.

_Refs:_ CAP-8, NFR8, `steering-api-contract.md`.
_Depends on:_ Story 2.1.

### Story 2.3: Interrupt and redirect a running Claude agent

As an operator using Claude,
I want to stop the current turn and send a correction on the same session,
So that Claude changes direction without stopping the workflow node.

**Acceptance Criteria:**

**Given** a Claude node running in the current process
**When** execution starts and ends
**Then** the executor registers and tears down its `(runId, nodeId)` live handle and inbound queue on every terminal path.

**Given** Claude is generating
**When** I activate `Stop`
**Then** the interrupt route calls Claude's native `interrupt()` through a fresh per-turn abort seam
**And** the node-level controller remains untouched, the node stays `running`, and the provider session stays alive.

**Given** the interrupt races a natural turn end
**When** the route resolves
**Then** it returns `idle-after-interrupt`, returns `generating` after a queued message auto-drains, or returns 409 `node_finished` according to the actual end state
**And** it never loses an accepted message.

**Given** an interrupted Claude turn
**When** the executor classifies the end
**Then** it enters `idle-after-interrupt`, skips validation and re-ask for that turn, writes one interrupted status row for the in-flight call, and never emits `dag_node_failed`.

**Given** Claude is `idle-after-interrupt`
**When** the dock renders
**Then** Stop is absent, send reads `Send now`, the header reads `WILL SEND · n`, and the dock states that interrupt did not undo written work.

**Given** I activate `Send now`
**When** delivery runs
**Then** already queued messages and the new message are sent in receipt order as the next turn through the same Claude session
**And** the dock returns to generating state.

**Given** the node is a direct AI node, AI loop node, or a provider-calling node in a loop group
**When** I interrupt and redirect Claude
**Then** the same live registry, end-cause, idle-await, same-session, and interrupted-row behavior applies before the normal loop-completion check.

**Given** dock state changes or the dock is removed
**When** the UI updates
**Then** transition announcements are serialized, `Stopping…` uses `aria-disabled`, delivery failure uses `role="alert"`, and focus moves to the last transcript row instead of the document body.

_Refs:_ CAP-9–10, NFR4–5, NFR8, UX-DR2, UX-DR4, UX-DR6–8, `engine-integration.md`, `control-states.md`, `provider-steering-matrix.md`.
_Depends on:_ Stories 1.1 and 2.1.

### Story 2.4: Interrupt and redirect a running Codex agent

As an operator using Codex,
I want to stop the current turn and send a correction on the same thread,
So that Codex changes direction without stopping the workflow node.

**Acceptance Criteria:**

**Given** Codex is generating
**When** I activate `Stop`
**Then** the provider aborts the current stream, keeps the node `running`, and enters `idle-after-interrupt` without classifying the turn as failed.

**Given** I activate `Send now`
**When** queued and new guidance drains
**Then** Codex continues by calling `resumeThread` for the same provider session
**And** the transcript shows the interrupted tool with `⚠`.

**Given** direct and loop execution paths
**When** the Codex conformance fixture interrupts and redirects
**Then** both paths preserve the same message order, status projection, and workflow-node state as Claude.

**Given** Codex returns an abort-shaped result or exception
**When** the executor classifies it
**Then** an operator-marked abort is interrupted and an unmarked exception remains a real failure.

_Refs:_ CAP-9–10, CAP-12 v1 floor, `provider-steering-matrix.md`, `steering-test-plan.md`.
_Depends on:_ Story 2.3.

### Story 2.5: Interrupt and redirect a running OMP agent

As an operator using OMP,
I want to stop the current turn and send a correction on the same session,
So that OMP changes direction without stopping the workflow node.

**Acceptance Criteria:**

**Given** OMP is generating
**When** I activate `Stop`
**Then** the provider aborts the current stream, keeps the session and node alive, and enters `idle-after-interrupt`.

**Given** OMP reports `Query aborted`
**When** the operator interrupt flag is set
**Then** the executor classifies it as interrupted, writes the interrupted status row, and does not fail the node.

**Given** I activate `Send now`
**When** guidance drains
**Then** OMP continues on the same session in written order and the dock returns to generating.

**Given** direct and loop execution paths
**When** the OMP conformance fixture interrupts and redirects
**Then** both paths pass the shared steering contract.

**Given** OMP soft-inject capability
**When** v1 ships
**Then** this story uses interrupt-then-continue only
**And** mid-turn soft-inject remains gated by G4.

_Refs:_ CAP-9–10, CAP-12 v1 floor, `provider-steering-matrix.md`, `steering-test-plan.md`.
_Depends on:_ Story 2.3.

### Story 2.6: Interrupt and redirect a running Grok agent

As an operator using Grok,
I want to stop the current turn and send a correction on the same session,
So that Grok changes direction without stopping the workflow node.

**Acceptance Criteria:**

**Given** Grok is generating
**When** I activate `Stop`
**Then** the provider aborts the current stream, keeps the session and node alive, and enters `idle-after-interrupt`.

**Given** I activate `Send now`
**When** queued and new guidance drains
**Then** Grok continues on the same session in written order
**And** the transcript shows the interrupted call with `⚠`.

**Given** direct and loop execution paths
**When** the Grok conformance fixture interrupts and redirects
**Then** both paths pass the shared steering contract without a node failure.

**Given** Grok hook capability
**When** v1 ships
**Then** this story uses interrupt-then-continue only
**And** hook-based soft-inject remains gated by G3.

_Refs:_ CAP-9–10, CAP-12 v1 floor, `provider-steering-matrix.md`, `steering-test-plan.md`.
_Depends on:_ Story 2.3.

### Story 2.7: Interrupt and redirect a running DeepSeek agent

As an operator using DeepSeek,
I want to stop the current turn and send a correction on the continued session,
So that DeepSeek changes direction without stopping the workflow node.

**Acceptance Criteria:**

**Given** DeepSeek is generating
**When** I activate `Stop`
**Then** the provider uses its cancel-and-continue mechanism, keeps the node `running`, and enters `idle-after-interrupt`.

**Given** DeepSeek returns a result with an abort marker
**When** the operator interrupt flag is set
**Then** the executor classifies it as interrupted rather than natural or failed.

**Given** I activate `Send now`
**When** guidance drains
**Then** DeepSeek continues in written order on the preserved logical session
**And** the transcript shows the interrupted call with `⚠`.

**Given** direct and loop execution paths
**When** the DeepSeek conformance fixture interrupts and redirects
**Then** both paths pass the shared steering contract without a node failure.

_Refs:_ CAP-9–10, CAP-12 v1 floor, `provider-steering-matrix.md`, `steering-test-plan.md`.
_Depends on:_ Story 2.3.

### Story 2.8: See operator messages in the transcript

As anyone reading the transcript,
I want operator guidance recorded among the agent's calls,
So that the steering exchange is part of the permanent audit trail.

**Acceptance Criteria:**

**Given** guidance is delivered to a provider
**When** the executor records it
**Then** it writes one ordinary text row with strict additive `origin='operator'`, `operator_user_id`, and `message_id` metadata
**And** it adds no table, migration, or new row kind.

**Given** the message affected a turn
**When** transcript rows are ordered by `seq`
**Then** the operator row appears between the call it interrupted or followed and the call caused by the guidance.

**Given** an operator row reaches either web surface
**When** it renders
**Then** it shows `operator · <display name>` with full-strength text and a `sent` badge
**And** it cannot be mistaken for agent output.

**Given** the display-name projection cannot join `operator_user_id`
**When** the server builds the read model
**Then** it falls back to the short user id without a client-side user fetch.

**Given** a message on any v1 provider
**When** the transcript shows it
**Then** it remains `sent`
**And** no provider advances it to `delivered` before G1.

_Refs:_ CAP-11, CAP-13 v1 floor, UX-DR5, `engine-integration.md`, `EXPERIENCE.md`.
_Depends on:_ Stories 1.1, 2.1, and 2.3.

### Story 2.9: See the same live queue across tabs and operators

As an operator collaborating on a live node,
I want every open node room to show the same server queue,
So that all operators act on current shared steering state.

**Acceptance Criteria:**

**Given** the same live node is open in two tabs or by two authenticated operators
**When** either view queues or withdraws a message
**Then** both views converge on the same `QUEUED · n` and ordered message list from the node registry.

**Given** two views of the same node
**When** their composers contain unsent text
**Then** only queued items are shared
**And** each unsent draft remains local to its tab.

**Given** one operator withdraws a shared queued item
**When** the other view refreshes through the normal live update path
**Then** the item disappears without a duplicate request or stale count.

**Given** two-tab E2E coverage
**When** it queues and withdraws on one live node
**Then** it verifies convergence, message identity, keyboard access, and no cross-node leakage.

_Refs:_ CAP-8, NFR4, NFR8, `control-states.md`, `steering-api-contract.md`.
_Depends on:_ Stories 2.1 and 2.2.

### Story 2.10: See queued guidance while viewing a finished iteration

As an operator inspecting an earlier loop iteration,
I want to see the live node's pending guidance without steering the finished iteration,
So that I retain context without sending to the wrong place.

**Acceptance Criteria:**

**Given** a live loop node and a finished iteration selected through the `Execution` selection controls (header select, Logs row, or graph occurrence) — Story 1.7 `Jump to` stays scroll-only
**When** the dock area renders
**Then** it shows a collapsed disclosure, a `Go to iteration N` control, and a read-only band with the live node's shared pending queue.

**Given** the read-only finished-iteration band
**When** I inspect it
**Then** it provides no composer, `Send now`, withdraw/delete, or interrupt action
**And** the client issues no send, withdraw, or interrupt mutation for that finished iteration
**And** the existing authenticated node-scoped `GET …/queue` poll remains allowed so the band can mirror the shared pending queue.

**Given** I return to the live iteration
**When** the dock renders
**Then** the normal live composer and queue controls return and queued guidance keeps its order.

**Given** an operator message was already delivered during the finished iteration
**When** I inspect that iteration
**Then** the message appears inline in its occurrence group and is not repeated in the read-only queue band.

**Given** I view a different non-live execution rather than an earlier iteration of the live node
**When** the page renders
**Then** the steering dock is absent.

_Refs:_ CAP-8, UX-DR4, `control-states.md` "Viewing a finished iteration", `EXPERIENCE.md`.
_Depends on:_ Stories 1.7 and 2.9.

### Story 2.11: Recover messages that were never sent when the node ends

As an operator,
I want accepted but undelivered guidance restored when the node ends,
So that no message disappears silently.

**Acceptance Criteria:**

**Given** a node reaches finish, Cancel, failure, or idle-await expiry
**When** the client receives the node terminal event
**Then** it compares every queued `message_id` shown by the node queue with written operator rows
**And** unmatched messages return to the draft area as `NEVER SENT`.

**Given** a live refetch before terminal state
**When** operator-row persistence is still in flight
**Then** reconciliation does not run and cannot mark the message prematurely.

**Given** one or more messages are restored
**When** the UI reports the result
**Then** the failure is announced through an assertive `role="alert"`
**And** each restored message retains its original text and identity.

_Refs:_ CAP-11, NFR4, NFR8, UX-DR6–7, `engine-integration.md`, `control-states.md`.
_Depends on:_ Stories 2.8 and 2.9.

### Story 2.12: Fail an abandoned redirect safely after 30 minutes

As an operator and workflow owner,
I want an interrupted node to fail safely if nobody sends a redirect,
So that abandoned steering cannot leave a run hanging forever.

**Acceptance Criteria:**

**Given** an agent in `idle-after-interrupt`
**When** 30 minutes of composer inactivity pass
**Then** the node fails once with `interrupted by operator, no redirect received`
**And** it never uses the existing idle timeout that completes a node.

**Given** keystroke or focus activity while idle-after-interrupt
**When** the authenticated keepalive route receives it
**Then** the fixed inactivity timer re-arms without resolving idle-await
**And** `Send now` is excluded because it resolves idle-await.

**Given** idle-after-interrupt is active
**When** workflow Cancel, `Send now`, or timer expiry wins
**Then** the idle-await branch resolves exactly once
**And** the cancel poll remains reachable even though no provider stream is active.

**Given** queued messages exist at expiry
**When** the registry is torn down
**Then** Story 2.11 restores unmatched messages as `NEVER SENT`.

**Given** the 30-minute failure is retried through the supported failed-node action
**When** execution starts again
**Then** it uses a fresh provider session because the interrupted context is gone.

**Given** the dock is idle-after-interrupt
**When** it renders
**Then** it discloses the 30-minute limit and that typing keeps it open in accessible text.

_Refs:_ NFR6, NFR8, UX-DR6–7, `engine-integration.md`, `control-states.md`.
_Depends on:_ Stories 2.3 and 2.11.

### Story 2.13: Preserve message order and attribution under concurrent operators

As operators sharing one Archon install,
I want concurrent steering messages to have deterministic order and authorship,
So that the audit trail remains trustworthy during collaboration.

**Acceptance Criteria:**

**Given** two distinct authenticated operators send to one live node concurrently
**When** the registry accepts their messages
**Then** global order is the registry's server receipt order
**And** written order remains stable within each operator's stream.

**Given** those messages are delivered
**When** the executor writes operator rows
**Then** each row carries the correct `operator_user_id` and `message_id`
**And** the display-name projection resolves the matching sender.

**Given** the concurrency integration test
**When** both identities send overlapping requests
**Then** it asserts registry order, queue order, transcript order, and attribution
**And** it proves there is no cross-node or cross-user identity leakage.

_Refs:_ CAP-11, NFR4, NFR8, steering AD-11, `steering-test-plan.md`.
_Depends on:_ Stories 2.8 and 2.9.

---

## Post-v1 gated backlog

The two epics complete at the interrupt + `Queue` + `sent` v1 floor.
The following items depend on separate external gates and do not block either epic.

### G1: Show `delivered` after the Claude SDK echoes message ids

**Given** `@anthropic-ai/claude-agent-sdk` is upgraded to at least 0.3.246
**When** Claude echoes a stamped `message_id`
**Then** the matching operator message advances from `sent` to `delivered` by id alone.

_Gate:_ Claude SDK pin moves from 0.3.209 to at least 0.3.246.
_Refs:_ CAP-13, `provider-steering-matrix.md`.

### G2: Soft-inject guidance into Claude mid-turn

**Given** the Claude `AsyncIterable` input and resume-protocol spike succeeds
**When** guidance is soft-injected
**Then** it arrives mid-turn without interrupt, interrupted tool status, or a new turn-start event.

_Gate:_ Claude streaming-input and resume-protocol spike.
_Refs:_ CAP-12, `provider-steering-matrix.md`.

### G3: Soft-inject guidance through Grok hooks

**Given** the Grok `pre_tool_use` payload-shape spike succeeds
**When** guidance is delivered through the hook
**Then** it arrives mid-turn without interrupting the active tool call.

_Gate:_ Grok hook payload-shape spike.
_Refs:_ CAP-12, `provider-steering-matrix.md`.

### G4: Soft-inject guidance into OMP mid-turn

**Given** the OMP RPC protocol-version-2 path with `set_steering_mode:'all'` passes conformance
**When** guidance is soft-injected
**Then** it arrives mid-turn without interrupt, interrupted tool status, or a new turn-start event.

_Gate:_ Independent OMP soft-inject conformance.
_Refs:_ CAP-12, `provider-steering-matrix.md`.

---

## Approved Course Correction — 2026-09-21

Epic 1, Epic 2, Stories 1.1 through 2.13, and G1 through G4 above are completed historical planning records.
They remain unchanged and are cited below only for dependency and traceability.
Every implementation outcome in the current approved scope is owned by a new story in Epic 3 through Epic 9.
G1 through G4 retain historical provenance, while their current outcomes are owned by Stories 8.3, 8.5, and 8.7.

The current scope has three explicit exclusions.
It does not change the completed historical Cancel feature.
It does not add individual-tool cancellation because Stop ends the whole current agent turn.
It does not change CLI `archon workflow run --detach` or add detached behavior to Agent Node Room.

## Epic 3: Complete the Approved Node Room Experience

Operators get the complete approved Console and Legacy Node Room experience with equivalent behavior, correct todo presentation, and accessible transcript interaction.

### Story 3.1: Match the approved Console and Legacy room anatomy

As an operator,
I want both Node Room shells to match the approved anatomy,
So that I can use the same workflow in either surface without relearning its structure.

**Acceptance Criteria:**

**Given** the Console Node Room is open
**When** the node panel renders
**Then** the panel uses the approved 520-pixel width
**And** the transcript, todo strip, queue band, composer dock, and room controls follow the approved order.

**Given** the Legacy Node Room is open
**When** the node panel renders
**Then** the panel uses the approved 460-pixel width
**And** it has behavior equivalent to Console while using Legacy tokens and markup.

**Given** the two shells
**When** shared semantic data changes
**Then** each shell renders the same meaning without importing the other shell's components.

_Refs:_ Agent Node Room CAP-1, CAP-2, `EXPERIENCE.md`, `DESIGN.md`.
_Depends on:_ completed historical Stories 1.1 through 1.7 for traceability.

### Story 3.2: Present todo state exactly as approved

As an operator,
I want todo progress in the approved locations and forms,
So that I can understand current work without losing the event history.

**Acceptance Criteria:**

**Given** a node has todo events
**When** its transcript renders
**Then** a collapsible todo strip appears below the transcript scroller and above the queue and composer dock
**And** it remains visible while the transcript scrolls.

**Given** several todo mutations exist
**When** the rows render
**Then** earlier mutations remain compact `todo updated` rows
**And** the latest applicable row can expose the same folded inline checklist as the strip.

**Given** the node becomes completed or interrupted
**When** the todo presentation updates
**Then** the terminal treatment is derived only for presentation
**And** no persisted todo event is rewritten.

_Refs:_ Agent Node Room CAP-3, `todo-fold-contract.md`, readable-transcript AD-12 and AD-21.
_Depends on:_ Story 3.1 and completed historical Story 1.5 for traceability.

### Story 3.3: Complete transcript interaction and accessibility behavior

As a keyboard or assistive-technology user,
I want the complete transcript interaction contract on both shells,
So that live updates do not take control or hide meaning from me.

**Acceptance Criteria:**

**Given** tool rows with different outcomes
**When** they first render
**Then** succeeded rows are collapsed, failed rows are expanded, and running, interrupted, and unknown rows are collapsed
**And** a reader's manual disclosure choice survives live rerenders.

**Given** new transcript rows arrive
**When** the reader is already at the bottom
**Then** the scroller remains pinned to the bottom
**And** otherwise the reader's position and focus remain unchanged.

**Given** either Node Room shell
**When** keyboard, focus, live-region, reduced-motion, and colour-independent status checks run
**Then** the shell meets the accessibility requirements in `EXPERIENCE.md`
**And** Console passes at 520 pixels while Legacy passes at 460 pixels.

_Refs:_ Agent Node Room CAP-4, CAP-6, CAP-7, `EXPERIENCE.md`, `test-plan.md`.
_Depends on:_ Stories 3.1 and 3.2.

## Epic 4: Apply Readable Tool Presentation Everywhere

Operators receive the same readable tool meaning in Node Room, RunStream, Chat, and backend-formatted output, including successful Codex file changes.

### Story 4.1: Persist successful Codex file-change rows

As an operator using Codex,
I want successful file changes to appear in the durable transcript,
So that Codex edits are visible through the same file presentation as other providers.

**Acceptance Criteria:**

**Given** Codex emits a successful `file_change` event
**When** the provider and executor process it
**Then** they normalize and persist a typed node-message row
**And** the row retains path, outcome, ordering, and bounded diff or preview evidence.

**Given** the persisted Codex file row
**When** the shared presenter reads it
**Then** it resolves to the file family
**And** it renders a diff when both sides exist or a path and preview otherwise.

**Given** a successful Codex event is tested
**When** acceptance evidence is collected
**Then** the test starts at the provider event and ends at the persisted rendered row
**And** a synthetic no-input row is not accepted as ingestion evidence.

_Refs:_ Agent Node Room CAP-5, CAP-14, readable-transcript AD-17.
_Depends on:_ Story 3.1 and completed historical Story 1.4 for traceability.

### Story 4.2: Use readable tool presentation in RunStream

As an operator reading RunStream,
I want tool events presented with the shared readable contract,
So that RunStream and Node Room describe the same event in the same way.

**Acceptance Criteria:**

**Given** a persisted tool event appears in RunStream
**When** it renders
**Then** it uses the shared family, headline, outcome, ordered badges, body facts, and safe fallback
**And** it does not render raw JSON by default.

**Given** the cross-surface fixture set
**When** Node Room and RunStream render the same event
**Then** their semantic outputs match
**And** only their shell markup can differ.

_Refs:_ Agent Node Room CAP-16, readable-transcript AD-1 and AD-18.
_Depends on:_ Story 4.1.

### Story 4.3: Use readable tool presentation in Chat

As an operator reading Chat,
I want tool calls to use the same readable meaning as Node Room,
So that switching surfaces does not change what an event means.

**Acceptance Criteria:**

**Given** a tool call appears in Chat
**When** its card renders
**Then** it consumes the shared Web semantic presentation
**And** it preserves the Chat shell without reinterpreting provider payloads.

**Given** the cross-surface fixture set
**When** Chat and Node Room render the same event
**Then** their family, headline, outcome, badge order, and fallback match.

_Refs:_ Agent Node Room CAP-16, readable-transcript AD-1 and AD-18.
_Depends on:_ Story 4.2.

### Story 4.4: Align backend tool formatting

As an operator receiving backend-formatted output,
I want it to carry the same readable tool meaning as the Web surfaces,
So that platform adapters do not report a conflicting interpretation.

**Acceptance Criteria:**

**Given** a tool event is formatted outside the Web package
**When** backend formatting runs
**Then** it produces the same semantic family, headline, outcome, and facts as the shared fixture
**And** it keeps a compact transport-appropriate text form.

**Given** package-boundary checks
**When** the formatter is built
**Then** backend code does not import Web code
**And** fixture parity proves agreement across the boundary.

_Refs:_ Agent Node Room CAP-16, readable-transcript AD-18.
_Depends on:_ Story 4.3.

## Epic 5: Show Files Changed and Git Attribution

Operators can inspect run-level changed files and trace deterministic repository changes to node executions.

### Story 5.1: Show a run-level Files Changed panel

As an operator,
I want one Files Changed panel for the workflow run,
So that I can review repository impact without inspecting every tool row.

**Acceptance Criteria:**

**Given** a run has repository changes
**When** the Files Changed panel opens
**Then** it lists each changed path once in deterministic repository order
**And** it shows the known node executions associated with that path.

**Given** the run contains edits from several providers
**When** the panel computes its content
**Then** it uses repository evidence instead of provider prose or tool names
**And** equivalent changes do not create duplicate paths.

**Given** no changed paths exist
**When** the panel opens
**Then** it presents the approved empty state without inventing activity.

_Refs:_ Agent Node Room CAP-17, readable-transcript AD-20.
_Depends on:_ Story 4.4.

### Story 5.2: Attribute Git changes to node executions

As an operator,
I want each Git change attributed to the node execution that produced it,
So that I can audit repository effects beyond individual tool-call diffs.

**Acceptance Criteria:**

**Given** a node execution starts and ends in a Git repository
**When** the executor records its boundaries
**Then** it retains the deterministic repository evidence needed for attribution
**And** the server computes the comparison through `@archon/git` functions.

**Given** one path changed across multiple node executions
**When** attribution renders
**Then** every proven execution is shown in stable order
**And** the run-level panel folds the same evidence.

**Given** evidence is missing or ambiguous
**When** attribution renders
**Then** it shows `unknown`
**And** it never guesses from agent text.

_Refs:_ Agent Node Room CAP-17, readable-transcript AD-20.
_Depends on:_ Story 5.1.

## Epic 6: Expose Additional Agent Context

Operators can read displayable thinking, the triggering prompt, and advisor notifications under explicit privacy, attribution, persistence, and ordering rules.

### Story 6.1: Persist and present agent thinking

As an operator,
I want displayable agent thinking shown under a clear privacy contract,
So that I can understand the agent's progress without exposing hidden reasoning.

**Acceptance Criteria:**

**Given** a provider emits content explicitly classified as displayable thinking
**When** Archon ingests it
**Then** Archon persists a typed node-message row in server sequence order
**And** the transcript renders it with the `thinking` role treatment.

**Given** provider content is hidden reasoning or lacks display permission
**When** Archon processes it
**Then** the content is not persisted or presented as thinking.

**Given** displayable thinking exists
**When** application logs are inspected
**Then** the thinking content is absent from logs.

_Refs:_ Agent Node Room CAP-19, readable-transcript AD-17 and AD-19.
_Depends on:_ Story 4.4.

### Story 6.2: Persist and present the triggering prompt

As an operator,
I want to see the prompt that triggered the agent turn with its attribution,
So that I can understand why the agent acted.

**Acceptance Criteria:**

**Given** an agent turn starts
**When** its triggering prompt is accepted
**Then** Archon persists the exact prompt with actor, source, turn, and node attribution
**And** it assigns transcript order at the server boundary.

**Given** the transcript renders the prompt
**When** an operator reads it
**Then** the prompt text is preserved without editorial changes
**And** the actor and source appear on the label line.

**Given** application logs are inspected
**When** the prompt has been persisted
**Then** its content is not copied into logs.

_Refs:_ Agent Node Room CAP-20, readable-transcript AD-17 and AD-19.
_Depends on:_ Story 6.1.

### Story 6.3: Persist and present advisor notifications

As an operator,
I want advisor notifications in the ordered transcript,
So that I can see external guidance in the context where it affected the agent.

**Acceptance Criteria:**

**Given** an advisor emits a notification for a node
**When** Archon accepts it
**Then** Archon persists a typed row with advisor identity and server sequence
**And** it associates the row with the correct run, node, and turn context.

**Given** advisor and agent events arrive near each other
**When** the transcript renders
**Then** it follows server sequence order
**And** the advisor notification does not float over later content.

**Given** application logs are inspected
**When** an advisor notification has been persisted
**Then** its content is absent from logs.

_Refs:_ Agent Node Room CAP-21, readable-transcript AD-17 and AD-19.
_Depends on:_ Story 6.2.

## Epic 7: Make Drafts and Guidance Durable

Operators keep author drafts, shared node guidance, delivery state, and auto-send settings across reloads and server restarts without Archon guessing the fate of a lost process.

### Story 7.1: Add durable steering storage

As an operator,
I want steering control data stored durably,
So that a server process is not the only owner of my drafts and guidance.

**Acceptance Criteria:**

**Given** SQLite or PostgreSQL is active
**When** the steering schema is applied
**Then** additive records store author drafts, node queue entries, FIFO position, delivery intent, delivery state, timestamps, failure evidence, and auto-send settings
**And** both dialects remain in schema parity.

**Given** the server needs steering data
**When** it uses the steering-store contract
**Then** storage policy remains separate from the volatile live-turn registry
**And** strict typed interfaces expose only the required operations.

**Given** fresh-install, historical-upgrade, and reapply checks
**When** the schema is validated
**Then** each check passes without destructive migration behavior.

_Refs:_ Agent Node Room CAP-8, live-steering AD-1 through AD-4.
_Depends on:_ Story 3.3.

### Story 7.2: Save and restore composer drafts

As an operator,
I want my composer draft saved on the server,
So that reload, tab close, or server restart does not discard my words.

**Acceptance Criteria:**

**Given** an authenticated operator edits a node composer
**When** draft persistence settles
**Then** the server stores the draft for that operator, run, and node
**And** another operator cannot read or overwrite it.

**Given** the author reloads, reopens the node, or reconnects after restart
**When** the composer loads
**Then** the latest committed draft is restored
**And** the interface says `saved for you` or equivalent server-persistence copy.

**Given** the author clears or sends the draft
**When** the durable operation commits
**Then** later reads do not restore the cleared text.

_Refs:_ Agent Node Room CAP-8, live-steering AD-5, `steering-api-contract.md`.
_Depends on:_ Story 7.1.

### Story 7.3: Preserve the shared queue and FIFO order

As operators sharing a node,
I want one durable queue with deterministic order and authorship,
So that guidance remains trustworthy under concurrency.

**Acceptance Criteria:**

**Given** permitted operators queue messages concurrently
**When** the server accepts them
**Then** it assigns one transactional FIFO order
**And** every entry retains its author and caller-stamped `message_id`.

**Given** the same `message_id` is submitted again
**When** the request is processed
**Then** the existing receipt is returned
**And** no duplicate entry is inserted.

**Given** a queued entry is withdrawn
**When** the durable delete commits
**Then** it is removed before dispatch
**And** withdrawal of a dispatched, delivered, or unknown identifier is an idempotent no-op.

**Given** a queue request succeeds
**When** the client receives acknowledgement
**Then** the durable write has already committed
**And** another permitted observer reads the same order.

_Refs:_ Agent Node Room CAP-8, live-steering AD-6, `steering-api-contract.md`.
_Depends on:_ Story 7.2 and completed historical Story 2.13 for traceability.

### Story 7.4: Recover guidance after server restart

As an operator,
I want durable steering data restored after a server restart,
So that I can continue through the existing Resume workflow without data loss or unsafe guesses.

**Acceptance Criteria:**

**Given** a non-terminal node has a draft, queue, delivery state, or auto-send setting
**When** the server restarts with the same database
**Then** those durable values are restored
**And** the lost provider process is not represented as still live.

**Given** no live turn handle exists after restart
**When** the Node Room loads
**Then** it is read-only and says `restored after server restart · Resume the workflow to continue`
**And** it uses the existing Resume action rather than a new resume mechanism.

**Given** a dispatch may have crossed the lost process boundary
**When** recovery classifies it
**Then** the entry remains explicitly ambiguous
**And** Archon does not resend it automatically.

**Given** the server starts
**When** durable recovery runs
**Then** it does not automatically resume the workflow or mark the old turn completed, failed, cancelled, or abandoned.

_Refs:_ Agent Node Room CAP-14, live-steering AD-7, `control-states.md`.
_Depends on:_ Story 7.3 and the existing Resume capability.

### Story 7.5: Support durable auto-send mode

As an operator,
I want a durable auto-send mode for queued guidance,
So that one correction can follow each natural reply without manual dispatch.

**Acceptance Criteria:**

**Given** the operator changes auto-send
**When** the server commits the setting
**Then** the setting survives reload and server restart
**And** permitted observers see the current node setting.

**Given** auto-send is enabled and the agent finishes a natural reply
**When** an eligible queue entry exists
**Then** exactly one FIFO entry is claimed and dispatched
**And** no later entry overtakes it.

**Given** Stop ends a turn
**When** the interrupted outcome settles
**Then** auto-send does not dispatch an entry.

**Given** automatic dispatch fails before delivery is proven
**When** failure is recorded
**Then** the entry returns to the front of the queue with failure evidence.

_Refs:_ Agent Node Room CAP-15, live-steering AD-8.
_Depends on:_ Story 7.4.

## Epic 8: Stop and Redirect Turns Across Core Providers

Operators can stop only the current turn, redirect the same provider session, and see only actions and delivery states that each verified core adapter supports.

### Story 8.1: Implement the provider-neutral Stop contract

As an operator,
I want Stop to end only the current agent turn,
So that I can redirect the agent without ending the node or losing completed work.

**Acceptance Criteria:**

**Given** any agent turn starts
**When** the executor invokes the provider
**Then** it supplies a fresh per-turn signal through `AgentRequestOptions.interruptSignal`
**And** the node-level `abortSignal` remains separate.

**Given** the agent is thinking or executing a tool
**When** Stop is accepted
**Then** the current turn ends
**And** the node, workflow run, and provider session remain available.

**Given** a tool was active when Stop settled
**When** the transcript is written
**Then** the tool outcome is `interrupted`, not `failed`
**And** completed writes and side effects remain in place with no rollback.

**Given** the provider contract is reviewed
**When** Stop support is added
**Then** `IAgentProvider` does not gain a `cancel()` method
**And** adapters map the existing interrupt signal to their native mechanism.

_Refs:_ Agent Node Room CAP-9, live-steering AD-9 and AD-10.
_Depends on:_ Story 7.3.

### Story 8.2: Expose Stop through the API and both Node Room shells

As an operator,
I want Stop available through the authenticated API and both approved Node Room shells,
So that turn control is consistent across the product.

**Acceptance Criteria:**

**Given** a live current turn exists
**When** an authorized user invokes the typed Stop route
**Then** the route interrupts that turn through the volatile live handle
**And** returns the current typed control state.

**Given** the active turn already ended
**When** the same Stop request is repeated
**Then** the operation is idempotent
**And** no node-level abort is triggered.

**Given** Console or Legacy displays a generating turn
**When** Stop is pressed
**Then** the shell shows the `Stopping…` transient without native disabling the focused control
**And** the final disclosure says that files already written stay written.

**Given** the server restarted and no live handle exists
**When** Stop is requested
**Then** the API returns typed 409 `recovery_required`
**And** it does not classify the run as detached.

_Refs:_ Agent Node Room CAP-9, `steering-api-contract.md`, `EXPERIENCE.md`.
_Depends on:_ Stories 7.4 and 8.1.

### Story 8.3: Complete Claude Stop, soft injection, and delivery acknowledgement

As a Claude operator,
I want Stop, mid-turn guidance, and truthful delivery acknowledgement,
So that I can redirect Claude with the full approved interaction.

**Acceptance Criteria:**

**Given** Claude is generating or using a tool
**When** Stop aborts `interruptSignal`
**Then** the adapter invokes the supported Claude interrupt path
**And** the same session remains usable for the next turn.

**Given** a queued Claude message has per-item `Send now`
**When** the operator invokes it during generation
**Then** the adapter soft-injects the message without invoking Stop
**And** the durable entry retains FIFO position and author identity.

**Given** Archon stamps a Claude message with `message_id`
**When** the supported SDK path echoes that identifier
**Then** only the matching entry advances to `delivered`
**And** missing or mismatched identifiers do not advance another entry.

_Refs:_ Agent Node Room CAP-12, CAP-13, historical G1 and G2 for traceability.
_Depends on:_ Story 8.2 and completed historical Story 2.3 for traceability.

### Story 8.4: Complete Codex Stop and session continuation

As a Codex operator,
I want Stop to abort the current Codex turn and keep the thread usable,
So that my next correction continues in the same context.

**Acceptance Criteria:**

**Given** Codex is streaming a turn
**When** Stop aborts `interruptSignal`
**Then** the adapter aborts the turn stream through the supported Codex mechanism
**And** it classifies the terminal provider shape as interrupted.

**Given** the interrupted turn has settled
**When** queued guidance starts the next turn
**Then** the adapter continues on the existing thread or session
**And** it does not create a replacement conversation silently.

**Given** Codex had an active tool
**When** Stop settles
**Then** the persisted tool row becomes `interrupted`
**And** completed file changes remain visible through Story 4.1.

_Refs:_ Agent Node Room CAP-9, CAP-18, `provider-steering-matrix.md`.
_Depends on:_ Stories 4.1 and 8.2 and completed historical Story 2.4 for traceability.

### Story 8.5: Complete Grok Stop and soft injection

As a Grok operator,
I want Stop and verified mid-turn guidance,
So that I can redirect Grok without misleading controls.

**Acceptance Criteria:**

**Given** Grok has an active turn
**When** Stop aborts `interruptSignal`
**Then** the adapter uses the supported Grok stream-abort path
**And** the session can continue with the next turn.

**Given** the Grok adapter has a verified soft-injection transport
**When** per-item `Send now` is invoked
**Then** the message arrives through that transport without invoking Stop
**And** the durable delivery state records only proven progress.

**Given** Grok conformance tests fail
**When** capabilities are projected
**Then** the unproven action is not advertised
**And** the story remains incomplete until the adapter behavior passes.

_Refs:_ Agent Node Room CAP-12, CAP-18, historical G3 for traceability.
_Depends on:_ Story 8.3 and completed historical Story 2.6 for traceability.

### Story 8.6: Complete DeepSeek Stop and continuation

As a DeepSeek operator,
I want an aborted provider result classified as Stop rather than failure,
So that I can continue the same session after redirecting the turn.

**Acceptance Criteria:**

**Given** DeepSeek has an active turn
**When** Stop aborts `interruptSignal`
**Then** the adapter uses its supported cancel-and-continue path
**And** the provider session remains reusable.

**Given** DeepSeek returns its provider-specific aborted result
**When** the executor classifies the end cause
**Then** it records an interrupted turn rather than a natural completion or node failure.

**Given** queued guidance follows the interrupt
**When** the next turn starts
**Then** it uses the same continuation contract
**And** preserves durable FIFO order.

_Refs:_ Agent Node Room CAP-9, CAP-18, `provider-steering-matrix.md`.
_Depends on:_ Story 8.4 and completed historical Story 2.7 for traceability.

### Story 8.7: Complete OMP Stop and soft injection

As an OMP operator,
I want Stop and verified mid-turn guidance,
So that an OMP abort is not mistaken for a failed node and supported redirects can arrive immediately.

**Acceptance Criteria:**

**Given** OMP has an active turn
**When** Stop aborts `interruptSignal`
**Then** the adapter aborts the stream through its supported mechanism
**And** the executor classifies the OMP abort throw as interrupted rather than failed.

**Given** the OMP adapter has a verified protocol path for soft injection
**When** per-item `Send now` is invoked
**Then** the message is injected without invoking Stop
**And** durable order and authorship remain unchanged.

**Given** the next OMP turn starts after Stop
**When** guidance is delivered
**Then** the existing session contract is reused
**And** no completed side effect is rolled back.

_Refs:_ Agent Node Room CAP-12, CAP-18, historical G4 for traceability.
_Depends on:_ Story 8.5 and completed historical Story 2.5 for traceability.

### Story 8.8: Present truthful provider capabilities

As an operator,
I want the Node Room to show only actions and delivery states proven for the active provider,
So that every visible control tells the truth.

**Acceptance Criteria:**

**Given** provider conformance fixtures run
**When** Stop, soft injection, continuation, or delivery acknowledgement is proven
**Then** the provider capability source records the supported behavior
**And** an unproven behavior remains false.

**Given** the Node Room renders controls
**When** it receives provider capabilities
**Then** it shows per-item `Send now` only for verified soft injection
**And** it does not branch on provider names.

**Given** an operator message is dispatched
**When** provider evidence changes its delivery state
**Then** the UI advances only to the last state that the adapter proves.

_Refs:_ Agent Node Room CAP-12, CAP-13, CAP-18, live-steering AD-11.
_Depends on:_ Stories 8.3 through 8.7.

## Epic 9: Extend Steering to Remaining Providers

Operators can Stop and redirect Qoder CLI, Pi, GitHub Copilot, and OpenCode through the same provider-neutral contract and truthful capability model.

### Story 9.1: Support Stop and redirect for Qoder CLI

As a Qoder CLI operator,
I want to stop the current turn and continue with redirected guidance,
So that Qoder CLI behaves consistently with the Node Room contract.

**Acceptance Criteria:**

**Given** Qoder CLI has an active turn
**When** Stop aborts `interruptSignal`
**Then** the adapter ends the current Qoder CLI turn through its supported native process or stream mechanism
**And** it does not end the workflow node.

**Given** the interrupted turn has settled
**When** guidance starts the next turn
**Then** the adapter uses its supported continuation contract
**And** preserves durable FIFO order and authorship.

**Given** Qoder CLI conformance fixtures run
**When** capabilities are published
**Then** every true capability is backed by deterministic adapter evidence.

_Refs:_ Agent Node Room CAP-18, `provider-steering-matrix.md`.
_Depends on:_ Story 8.8.

### Story 9.2: Support Stop and redirect for Pi

As a Pi operator,
I want to stop the current turn and continue with redirected guidance,
So that Pi participates in the same governed steering flow.

**Acceptance Criteria:**

**Given** Pi has an active turn
**When** Stop aborts `interruptSignal`
**Then** the adapter ends the current Pi turn through its supported native mechanism
**And** records an interrupted active tool when applicable.

**Given** durable guidance is ready after Stop
**When** the next turn starts
**Then** Pi uses its supported session continuation contract
**And** the workflow node remains running.

**Given** Pi conformance fixtures run
**When** capabilities are published
**Then** the UI receives only behaviors the adapter proves.

_Refs:_ Agent Node Room CAP-18, `provider-steering-matrix.md`.
_Depends on:_ Story 9.1.

### Story 9.3: Support Stop and redirect for GitHub Copilot

As a GitHub Copilot operator,
I want to stop the current turn and continue with redirected guidance,
So that Copilot follows the same auditable turn-control contract.

**Acceptance Criteria:**

**Given** GitHub Copilot has an active turn
**When** Stop aborts `interruptSignal`
**Then** the adapter ends only the current turn through its supported native mechanism
**And** completed side effects remain in place.

**Given** redirected guidance is dispatched
**When** the follow-up turn starts
**Then** the adapter uses its supported continuation contract
**And** operator transcript rows retain message and author correlation.

**Given** GitHub Copilot conformance fixtures run
**When** capabilities are published
**Then** the UI does not expose unsupported soft injection or acknowledgement states.

_Refs:_ Agent Node Room CAP-18, `provider-steering-matrix.md`.
_Depends on:_ Story 9.2.

### Story 9.4: Support Stop and redirect for OpenCode

As an OpenCode operator,
I want to stop the current turn and continue with redirected guidance,
So that all registered providers in the approved scope share the same governed behavior.

**Acceptance Criteria:**

**Given** OpenCode has an active turn
**When** Stop aborts `interruptSignal`
**Then** the adapter ends only the current OpenCode turn through its supported native mechanism
**And** the node-level abort signal remains untouched.

**Given** guidance follows the interrupted turn
**When** OpenCode starts the next turn
**Then** it uses its supported continuation contract
**And** the provider session remains consistent with its adapter guarantees.

**Given** the complete nine-provider conformance suite runs
**When** OpenCode and the other adapters report capabilities
**Then** every current provider passes Stop and redirect acceptance
**And** the Node Room renders capability-driven controls without provider-branded forks.

_Refs:_ Agent Node Room CAP-18, `provider-steering-matrix.md`, `steering-test-plan.md`.
_Depends on:_ Story 9.3.
