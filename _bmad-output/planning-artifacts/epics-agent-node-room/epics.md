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
