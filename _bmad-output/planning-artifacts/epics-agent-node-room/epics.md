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

This document records the completed Epics 1–3 and the current corrective Epic 4 for the Legacy and Console node rooms.

**Current contract (2026-09-24).**
The [validated mockup manifest](../mockup-manifests/agent-node-room.json) defines 70 current product items: nine changed features and 61 unchanged context items.
Epic 4 owns the corrections and supersedes conflicting criteria in the completed historical Stories below, including Story 1.5's TODO wording, Story 3.6's outer fixture controls, and Story 3.7's 64-row target.
The text of Epics 1–3 and their old gate notes remains historical evidence; Epic 4 and the current Requirements Inventory govern new acceptance work where those records conflict.
The outer numbered state, node-kind, and provider-transport controls are review fixtures; the in-product `Execution` selector remains product scope.
G1, G2, G3, and G4 are current release proof gates, and no approved visible behavior is future work.
The user's 2026-09-24 G3 decision requires Grok per-item Send now during the active turn in this release and supersedes the completed Epic 3 future label without rewriting that historical Epic.
Current Grok `--single` is queue-only; Claude streaming input, a new Grok live-input path, and OMP RPC require conformance before their modes show the per-item action.

- **Epic 1 — Readable Agent Transcript** replaces raw-JSON tool output with a transcript that operators can scan and inspect.
  It is retroactive and uses data that is already stored.
  It has no schema, migration, or backend change.
- **Epic 2 — Live Agent Steering** lets operators queue guidance, interrupt and redirect each supported provider, and audit the result without stopping the node.
  It is in-process and reaches only a node whose executor is in the current server process.
  All original Stories were completed, but the post-implementation review found behavior gaps against the approved mockups.
- **Epic 3 — Agent Node Room Approved-Behavior Remediation** brings every visible approved mockup behavior into current scope without rewriting delivered Story history.
  Its Stories are completed historical work; Epic 4 carries the revised approved contract.
- **Epic 4 — Agent Node Room Current-Contract Correction** implements and verifies the 70-item approved product inventory and current active-turn delivery behavior.

Epic 1 supplies the transcript primitives that Epic 2 uses for interrupted tool rows and operator messages.
Epics 1–3 are the delivered baseline; Epic 4 corrects approved-behavior gaps across both surfaces.
Each story delivers one observable feature that can be accepted independently.
Registry, routes, sub-state projection, race handling, API regeneration, tests, and accessibility work are tasks or acceptance criteria of the feature that owns them.
They are not separate technical stories.

Completed Stories remain historical delivery records and are not reopened or rewritten as new work.
Tracking state records implementation progress and does not classify product scope.

The mockup handoff is in `claude-design/design_handoff_node_room_transcript_steering/`.
Every visible approved product behavior in the 70-item manifest is current scope.
The requirements, Architecture, UX, Stories, and verification evidence must agree with that behavior and cannot defer it through notes or backlog labels.
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
The checklist appears only in a collapsible pinned strip below the transcript and immediately above the queue or dock, stays visible while the transcript scrolls, and is absent when there are no todos.
Its collapsed header shows the current item, completed count, and segmented meter, and it provides its approved Raw control.
An `rm`-emptied phase disappears.
Terminal todo changes are display projections and never rewrite stored provider state.

FR4 (CAP-4): Render a subagent dispatch as batch context plus one collapsible card for each normalized `TaskSubtask`, with the subtask name and agent.

FR5 (CAP-5): Render an inline line diff when a file-edit payload contains before and after content.
Otherwise render a path and preview, and never fabricate a diff from one side.

FR6 (CAP-6): Group rows by `occurrence_id` when a node has more than one occurrence.
Never group by `attempt_id`.
Use primary `Run N` for every multi-occurrence separator in occurrence order, with loop iteration, provider pass, retry, or interruption context as a suffix; a single occurrence has no separator.
Keep execution selection separate from scroll-only occurrence navigation, and omit group headers and navigation for a single occurrence.
A mutation from a finished iteration carries its retry epoch and fails closed when that epoch is stale.

FR7 (CAP-7): Every tool card provides a Raw toggle that reveals the original JSON and is closed by default.
Raw is the only place serialized JSON appears, and the current `canLoadFullOutput` flow remains available.

FR8 (CAP-8): Mount and enable a composer while the node runs.
While the agent generates, send reads `Queue` and holds guidance without interrupting the current turn.
The executor delivers queued guidance at the natural turn boundary.
The unsent draft is tab-local and the server queue is node-scoped and process-local.
Accepted queue items are shared across tabs and operators.
Full Legacy and Console rooms use the full-bleed queue band, while compact dock and state-review layouts use the inset queue well.

FR9 (CAP-9): An interrupt ends the current provider turn but keeps the provider session and workflow node alive.
The node stays `running`, the agent enters `idle-after-interrupt`, and the in-flight tool call is `interrupted`, not `failed`.
Interrupt is distinct from Cancel and does not undo written work.

FR10 (CAP-10): During `idle-after-interrupt`, send reads `Send now`.
It flushes already queued messages and the new message in written order as the next turn on the same provider session.
The node continues and never enters a workflow resume state.

FR11 (CAP-11): Operator messages and interrupted tool calls appear as ordinary transcript rows in happened order.
An operator row is clearly distinct from agent text.
Only the row created by accepted per-item Send now during generation hides its visible sender name; stored attribution and other operator-row display paths remain.

FR12 (CAP-12): Sending is an ordinary provider prompt.
Every provider supports boundary delivery through `Queue` and interrupt-then-continue.
On a proven Archon live-turn mode, per-item Send now sends exactly the selected queued item into the active turn during generation without Stop, natural-end wait, or a new turn.
Only that item leaves the queue on provider acceptance and appears immediately as a nameless `sent` operator row.
Queue-only modes omit the per-item action; direct unsupported requests refuse without queue mutation.
Claude streaming input, Grok live input, and OMP RPC are independent current G2/G3/G4 release proof gates, not proven capabilities of the current adapters.
Grok must pass a real active-turn selected-item path and causal agent receipt gate in this release; its current `--single` mode remains queue-only.

FR13 (CAP-13): A registry receipt is `queued`, and accepted live-turn transport creates the `sent` operator row.
The matching row advances to `delivered` only after a native lifecycle event or response stream causally linked to that selected message proves agent consumption.
An RPC acknowledgement, unrelated stream, text match, or timestamp does not prove consumption.
The stamped id remains the row and idempotency key, but exact echo is not the only valid proof.
G1 is current release proof and implementation work.

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

UX-DR5 (CAP-11): The accepted per-item active-turn row shows operator role, full-strength text, and `sent` without a visible sender name; stored attribution remains.
Other operator-row paths keep their existing display-name treatment.

UX-DR6 (CAP-9/10): The dock discloses the 30-minute inactivity behavior, shows `NEVER SENT` after reconciliation, and restores focus safely when removed.

UX-DR7: Live-region output is serialized by transition.
Delivery failure is assertive.
Blocked controls use `aria-disabled` with an accessible reason.
Reduced-motion and visible-label matching requirements apply to both surfaces.

UX-DR8: The Legacy and Console docks use their own token roots but have identical anatomy, order, wording, and bordered send controls.

UX-DR9 (CAP-3): The pinned todo strip is in scope and is the only place the current checklist appears.
It appears below the transcript and immediately above the queue or dock in both approved room layouts.

UX-DR10 (CAP-6): Execution selection and scroll-only occurrence navigation are distinct controls.
Every multi-occurrence separator uses primary `Run N` in occurrence order with the applicable context suffix.

### FR Coverage Map

| FR / CAP                                     | Story coverage                                   |
| -------------------------------------------- | ------------------------------------------------ |
| FR1 (CAP-1)                                  | 1.1, 3.1                                         |
| FR7 (CAP-7)                                  | 1.2                                              |
| FR2 (CAP-2)                                  | 1.3                                              |
| FR5 (CAP-5)                                  | 1.4                                              |
| FR3 (CAP-3)                                  | 1.5, 3.1 historical; 4.1 current                 |
| FR4 (CAP-4)                                  | 1.6                                              |
| FR6 (CAP-6)                                  | 1.7, 2.9, 2.10, 3.2 historical; 4.2 current      |
| FR8 (CAP-8)                                  | 2.1, 2.2, 2.9, 2.10, 3.3 historical; 4.3 current |
| FR9 (CAP-9)                                  | 2.3, 2.4, 2.5, 2.6, 2.7, 3.6                     |
| FR10 (CAP-10)                                | 2.3, 2.4, 2.5, 2.6, 2.7                          |
| FR11 (CAP-11)                                | 2.8, 2.13 historical; 4.3 current                |
| FR12 (CAP-12) boundary floor                 | 2.1, 2.3, 2.4, 2.5, 2.6, 2.7                     |
| FR12 (CAP-12) active-turn Send now           | 3.4, 3.5 historical; 4.3, 4.4 current            |
| FR12 (CAP-12) queue-only state               | 4.4 current                                      |
| FR13 (CAP-13) `sent` and `delivered`         | 2.8, 3.5 historical; 4.4 current                 |
| Terminal reconciliation                      | 2.11, 3.5                                        |
| 30-minute idle-await safety                  | 2.12, 3.5                                        |
| Concurrent ordering and attribution          | 2.13, 3.3, 3.4                                   |
| Approved product chrome and fixture boundary | 3.6 historical; 4.5 current                      |
| All 70 manifest product items                | 3.7 historical; 4.6 current                      |

## Epic List

1. **Epic 1 — Readable Agent Transcript** (CAP-1…7) lets operators scan, inspect, and navigate historical or live agent activity without reading raw JSON.
2. **Epic 2 — Live Agent Steering** (CAP-8…13) lets operators queue guidance, interrupt and redirect each supported provider, and audit steering safely while the workflow node stays running.
3. **Epic 3 — Agent Node Room Approved-Behavior Remediation** is completed historical work against an earlier 64-row review inventory.
4. **Epic 4 — Agent Node Room Current-Contract Correction** owns the 70-item manifest, live-turn Send now, truthful status, and conformance across Legacy and Console.

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

_Scope:_ Presentation-only over persisted tool rows.
Current Codex `file_change` events are emitted as `system` chunks (`codex/provider.ts:709`) that the executor debug-logs (`dag.system_message_unhandled`) rather than persisting, so they never become file rows and nothing here is a Codex row.
Making successful Codex file-change events visible in the transcript is separately tracked work.

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
**Then** a collapsible pinned strip appears below the transcript and immediately above the queue or dock
**And** its collapsed header shows the current item, completed count, and segmented meter
**And** it expands to phase headers and per-item status, remains visible while the transcript scrolls, and is absent when there are no todos.

**Given** a reader needs the exact folded todo data
**When** the reader activates the todo strip's Raw control
**Then** the approved raw projection appears without duplicating the checklist in transcript history.

**Given** any todo call in transcript history
**When** the row renders
**Then** it stays a compact one-line row
**And** the checklist is not duplicated inline.

**Given** an `rm` operation that empties a phase
**When** state folds
**Then** the empty phase disappears.

**Given** the node reaches a terminal presentation
**When** the room projects completion or failure
**Then** any terminal todo change is a display projection
**And** stored provider todo state remains unchanged.

_Refs:_ CAP-3, UX-DR3, UX-DR9, `todo-fold-contract.md`, approved behaviors T20–T24.
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
**When** I use the scroll-only occurrence navigation
**Then** it navigates directly to the matching occurrence header without changing the selected execution
**And** keyboard and focus behavior are equivalent on both surfaces.

**Given** a repeated top-level execution, a loop occurrence, another provider turn in the same occurrence, or a non-numbered interruption or recovery occurrence
**When** its occurrence heading renders
**Then** the heading uses `Run N`, `Iteration N`, `Pass N`, or the approved reason-only label for that context.

**Given** execution selection controls and scroll-only occurrence navigation are both present
**When** I use either control
**Then** execution selection changes the displayed execution and scroll-only navigation changes only the viewport target.

**Given** a single occurrence
**When** the transcript renders
**Then** it shows neither occurrence headers nor an iteration selector.

_Refs:_ CAP-6, UX-DR10, `EXPERIENCE.md`, approved behaviors T25–T28.
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
**When** the approved per-item action is used during generation
**Then** current-scope Story 3.4 owns the G4 soft-inject path
**And** this completed Story continues to own the interrupt-then-continue baseline.

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
**And** current-scope Story 3.5 advances it to `delivered` only after provider confirmation by the stamped message id.

_Refs:_ CAP-11, CAP-13, UX-DR5, `engine-integration.md`, `EXPERIENCE.md`, approved behavior S12.
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
**And** any mutation request associated with the selected iteration carries its retry epoch and fails closed when that epoch is stale
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

_Refs:_ CAP-8, UX-DR4, `control-states.md` "Viewing a finished iteration", `EXPERIENCE.md`, approved behaviors T28 and S24.
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

## Epic 3: Agent Node Room Approved-Behavior Remediation

Operators can use every visible behavior in the approved Agent Node Room mockups on both Legacy and Console without misleading state, missing ownership, or conflicting interaction rules.
This Epic preserves the completed history in Epics 1 and 2 and keeps new corrective work separate.
Visible G1, G2, and G4 behavior is current scope in this Epic.
G3 alone remains deferred because Grok hook-based soft-inject behavior is absent from the approved mockups.

The corrective Stories execute in order from Story 3.1 through Story 3.7.
No Story is complete until its approved behavior identifiers have requirement, implementation, and verification evidence in both approved shells.

### Completion Criteria

- Every visible approved mockup behavior is current scope and has one consistent product rule.
- The 64-behavior matrix reaches 64 `MATCHED` rows and has no `PARTIAL`, `MISSING`, `CONFLICT`, or `UNCLEAR` row.
- Legacy and Console provide equivalent meaning, state transitions, keyboard behavior, focus behavior, and accessibility for shared behavior.
- Visible G1, G2, and G4 behavior is complete in Stories 3.4 and 3.5.
- G3 is the only deferred gate, and no approved mockup exposes its Grok hook behavior.
- Epics 1 and 2 and all original Story rows remain `done` in the file-system tracker.
- A new implementation-readiness assessment passes before this Epic closes.

### Story 3.1: Reconcile transcript, family-chip, todo, and terminal projections

As an operator reading a node transcript,
I want its family chips, todo strip, Raw data, and terminal todo projections to match the approved room context,
So that the transcript remains truthful and easy to scan from start through terminal state.

**Acceptance Criteria:**

**Given** any of the nine approved tool families renders in Legacy or Console
**When** its transcript row appears
**Then** its family chip uses the approved five-treatment mapping
**And** text and shape continue to carry meaning without relying on colour alone.

**Given** the selected node has a non-empty folded todo state
**When** either approved full room renders
**Then** one collapsible pinned todo strip appears below the transcript and immediately above the queue or dock
**And** the collapsed header shows the current item, completed count, and segmented meter
**And** expansion shows the approved phase and item details without duplicating the checklist in historical todo rows.

**Given** the pinned todo strip is visible
**When** I activate its Raw control
**Then** I can inspect the approved raw todo projection
**And** the readable folded checklist remains the default presentation.

**Given** a node completes or reaches the 30-minute failure state with unfinished todo items
**When** the terminal room presentation renders
**Then** the approved completion or reset treatment is a display projection only
**And** stored provider todo calls and their folded source state remain unchanged.

**Given** no current todo state exists
**When** the transcript renders or reaches a terminal state
**Then** no empty todo strip or fabricated terminal todo state appears.

_Approved behavior evidence:_ T05 and T20–T24.
_Affected completed Stories:_ 1.1, 1.2, 1.5, and 2.11.
_Refs:_ CAP-1, CAP-3, FR1, FR3, UX-DR1, UX-DR3, UX-DR9, `tool-presentation-contract.md`, `todo-fold-contract.md`.
_Depends on:_ The delivered transcript baseline in Stories 1.1 and 1.2.

### Story 3.2: Reconcile occurrence labels and finished-iteration targeting

As an operator reviewing repeated execution,
I want each occurrence label and finished-iteration target to describe the execution that I am viewing,
So that I can navigate history and avoid steering the wrong retry epoch.

**Acceptance Criteria:**

**Given** the room shows a repeated top-level execution, a loop occurrence, another provider turn in the same occurrence, or a non-numbered interruption or recovery occurrence
**When** its heading renders
**Then** the heading uses `Run N`, `Iteration N`, `Pass N`, or the approved reason-only label for that context
**And** the label never substitutes `attempt_id` for `occurrence_id`.

**Given** execution selection and occurrence navigation are both available
**When** I select an execution
**Then** the displayed execution changes and the room controls synchronize with that selection
**And** when I use the scroll-only occurrence navigation, only the viewport target changes.

**Given** I view a finished iteration of a live loop node
**When** the room renders
**Then** it shows the finished transcript, final todo projection, shared pending queue, and `Go to iteration N`
**And** it does not present active steering controls for that finished iteration.

**Given** a mutation request is associated with a selected finished iteration
**When** the request reaches the server
**Then** it carries the selected retry epoch
**And** the server fails closed without node, queue, or transcript mutation when that epoch is stale.

**Given** I use `Go to iteration N`
**When** the live iteration opens
**Then** the active dock returns with the same shared queue order.

_Approved behavior evidence:_ T25–T28 and S24.
_Affected completed Stories:_ 1.7, 2.9, and 2.10.
_Refs:_ CAP-6, CAP-8, FR6, UX-DR10, `control-states.md`, `EXPERIENCE.md`.
_Depends on:_ Story 3.1 and the shared queue baseline in Story 2.9.

### Story 3.3: Present truthful shared queues in every approved layout

As an operator working across tabs or with another operator,
I want every approved queue layout to show the same node-scoped queue truthfully,
So that I know which guidance is shared, which draft is local, and which item will send next.

**Acceptance Criteria:**

**Given** a full Legacy or Console room has queued messages
**When** its queue renders
**Then** it uses the approved full-bleed collapsible band
**And** it shows the queue count, stable receipt order, ordinals, and next-out treatment.

**Given** a compact dock or approved state-review layout has queued messages
**When** its queue renders
**Then** it uses the approved inset queue well
**And** it represents the same node-scoped messages and order as the full-room band.

**Given** the same live node is open in more than one tab or by more than one operator
**When** any view queues or withdraws an item
**Then** every view converges on the same accepted items, count, order, and identity
**And** no view labels accepted queue data as `this tab only`.

**Given** I have typed text that I have not submitted
**When** the composer and queue render
**Then** only that unsent draft carries the `this tab only` label
**And** accepted queue items remain visibly shared.

**Given** the room width is 460 pixels or the dock changes state
**When** the queue and controls reflow
**Then** the transcript remains the only scroller
**And** Stop and Send remain on opposite edges with a stable send width and do not cover the watched row.

**Given** the shared queue is empty
**When** any approved layout renders
**Then** no empty queue shell appears.

_Approved behavior evidence:_ S03–S06, S20, S22, and S23.
_Affected completed Stories:_ 2.1, 2.2, 2.9, 2.10, and 2.13.
_Refs:_ CAP-8, FR8, NFR4, NFR8, UX-DR4, UX-DR7, UX-DR8, `control-states.md`, `steering-api-contract.md`.
_Depends on:_ Story 3.2 and the shared queue behavior in Stories 2.2, 2.9, and 2.13.

### Story 3.4: Send one queued item now during generation

As an operator who has queued guidance,
I want to send one selected item into a generating agent turn,
So that urgent guidance can arrive without interrupting the turn or draining unrelated queue items.

**Acceptance Criteria:**

**Given** the selected provider supports current-scope soft-inject and the agent is generating
**When** a queued item renders
**Then** that item provides the approved `Send now` action
**And** the normal composer action continues to read `Queue`.

**Given** I activate `Send now` on one queued item
**When** the provider accepts the soft-inject
**Then** only that item leaves the queue and enters the active turn
**And** the current tool is not interrupted, no interrupted status is written, and no phantom turn-start event is emitted.

**Given** other messages remain queued
**When** one selected item sends
**Then** the remaining messages keep their receipt order, identity, attribution, and next-out state across all views.

**Given** the current provider is Claude or OMP
**When** provider conformance runs
**Then** Claude uses the current G2 path and OMP uses the independent current G4 path
**And** each path proves mid-turn delivery without depending on the other path.

**Given** the same `message_id` is submitted again for per-item delivery
**When** the action is replayed
**Then** the original result is returned idempotently and the item is not delivered twice.

_Approved behavior evidence:_ S07 and R04.
_Affected completed Stories:_ 2.1, 2.3, 2.5, 2.9, and 2.13.
_Refs:_ CAP-8, CAP-12, FR8, FR12, former gates G2 and G4, `provider-steering-matrix.md`, `steering-api-contract.md`.
_Depends on:_ Story 3.3 and the delivered ordering and attribution baseline in Stories 2.9 and 2.13.

### Story 3.5: Show honest soft-inject refusal and delivery-confirmation states

As an operator sending guidance,
I want unavailable delivery paths and confirmed delivery states to be explicit,
So that the room never claims that guidance entered a turn or reached a provider when it did not.

**Acceptance Criteria:**

**Given** per-item `Send now` is visible but the selected provider or live handle cannot soft-inject
**When** I activate the action
**Then** the room shows the approved accessible refusal reason
**And** the item stays queued in its original order without interrupting the turn or changing node or transcript state.

**Given** a soft-inject request fails after it starts
**When** the failure returns
**Then** the item returns to the queue front with `couldn't send · back in the queue`
**And** the failure is announced assertively without losing the message or its sender identity.

**Given** an operator message has been accepted but the provider has not echoed its stamped `message_id`
**When** the transcript renders the operator row
**Then** its delivery badge reads `sent`.

**Given** the provider echoes the same stamped `message_id`
**When** the confirmation is reconciled
**Then** only the matching operator row advances to `delivered`
**And** no text, time, or positional match can advance another row.

**Given** the room is `idle-after-interrupt`
**When** either approved shell renders the live dock
**Then** visible and accessible copy states that the node fails after 30 minutes of inactivity
**And** it states that typing keeps the redirect open.

**Given** the node is parked at its own unanswered ask or an interrupt acknowledgement is still pending
**When** I attempt to send or inspect state
**Then** the control exposes the approved accessible refusal or `Stopping…` state
**And** it does not claim idle, delivery, or provider confirmation early.

_Approved behavior evidence:_ S12, S17–S19, and S25.
_Affected completed Stories:_ 2.3, 2.8, 2.11, and 2.12.
_Refs:_ CAP-9, CAP-12, CAP-13, FR12, FR13, NFR6, NFR8, former gate G1, `control-states.md`, `provider-steering-matrix.md`.
_Depends on:_ Story 3.4 and the delivered operator-row and terminal-reconciliation baseline in Stories 2.8 and 2.11.

### Story 3.6: Provide approved state, node-kind, provider, rerun, navigation, artifact, and close controls

As an operator using the approved node-room frame,
I want every visible state, example, lifecycle, navigation, artifact, and close control to work in its approved context,
So that no visible control is decorative or without a product owner.

**Acceptance Criteria:**

**Given** the approved state-review controls are present
**When** I activate one of the eight numbered state controls
**Then** the complete run, node, transcript, todo, queue, and dock frame changes to that scenario
**And** the selected review state persists locally for that review context.

**Given** the node-kind controls are present
**When** I select `prompt` or `loop ×3`
**Then** the log rows, execution options, todo state, and dock show the matching approved example
**And** the selection remains synchronized across the frame.

**Given** the provider control is present
**When** I switch between the approved provider modes
**Then** the queue actions, capability state, and explanatory copy change together
**And** the room does not claim soft-inject for a provider that refuses it.

**Given** an active run or node is displayed
**When** I use Cancel
**Then** the existing lifecycle action runs separately from steering
**And** Stop is never presented as Cancel.

**Given** a terminal Legacy run shows `Re-run`
**When** I activate it
**Then** the existing rerun behavior starts the approved new execution
**And** it does not reuse a stale steering or retry-epoch state.

**Given** `Log` or `Logs`, `Graph`, or a counted `Artifacts` control is visible
**When** I activate the control
**Then** the matching run surface opens and the run state does not change
**And** the artifact count remains visible and correct.

**Given** I activate a node execution row
**When** the node room opens or changes selection
**Then** the log selection, room header, transcript, and `Execution` control identify the same execution.

**Given** the node room is open
**When** I activate its `✕` control
**Then** the room closes and focus returns to the control that opened it.

**Given** any approved control is used with a keyboard or assistive technology
**When** it receives focus or changes state
**Then** its visible label, accessible name, focus order, and announcement describe the same action and result in both shells.

_Approved behavior evidence:_ R01–R03 and C01–C07.
_Affected completed Stories:_ 1.7, 2.3, and 2.10.
_Refs:_ CAP-6, CAP-9, FR6, FR9, NFR8, UX-DR4, UX-DR7, approved Console and Legacy room mockups.
_Depends on:_ Story 3.5 and the existing run lifecycle and navigation behavior.

### Story 3.7: Prove Legacy and Console conformance for all 64 behaviors

As a product owner and operator,
I want one complete conformance result for both approved node rooms,
So that corrective work closes only when every visible behavior is implemented and proven.

**Acceptance Criteria:**

**Given** Stories 3.1 through 3.6 are complete
**When** the behavior trace is reviewed
**Then** every identifier T01–T28, S01–S25, R01–R04, and C01–C07 has an exact requirement, Architecture owner, UX rule, Story owner, and verification path.

**Given** the focused module, component, route, provider, executor, registry, and integration checks run
**When** their results are collected
**Then** all affected behavior passes without skipped current-scope cases
**And** no test weakens the delivered baseline or treats visible G1, G2, or G4 behavior as optional.

**Given** the end-to-end suite opens Legacy and Console
**When** it exercises all approved transcript, todo, occurrence, queue, soft-inject, refusal, delivery, lifecycle, navigation, artifact, and close behavior
**Then** both shells produce equivalent outcomes and preserve their approved shell-specific tokens and markup.

**Given** each approved layout is tested at its required width and state
**When** browser visual and accessibility evidence is collected
**Then** the transcript remains usable at 460 pixels
**And** keyboard, focus, screen-reader, contrast, timing disclosure, reduced-motion, and control-placement requirements pass in both shells.

**Given** the final 64-row behavior matrix is scored
**When** corrective verification completes
**Then** all 64 rows are `MATCHED`
**And** no row is `PARTIAL`, `MISSING`, `CONFLICT`, or `UNCLEAR`.

**Given** the behavior matrix is complete
**When** implementation readiness runs again
**Then** the Agent Node Room target receives a passing verdict before Epic 3 closes.

_Approved behavior evidence:_ T01–T28, S01–S25, R01–R04, and C01–C07.
_Affected completed Stories:_ 1.1–1.7 and 2.1–2.13.
_Refs:_ FR1–FR13, NFR1–NFR8, UX-DR1–UX-DR10, `test-plan.md`, `steering-test-plan.md`, `implementation-readiness-report-2026-09-20-agent-node-room.md`.
_Depends on:_ Stories 3.1 through 3.6.

---

## Future capability

Only G3 has a future label because Grok hook-based soft-inject behavior is absent from every approved mockup.
Visible G1, G2, and G4 behavior is current scope in Stories 3.4 and 3.5.

### G3: Soft-inject guidance through Grok hooks

**Given** the Grok `pre_tool_use` payload-shape spike succeeds
**When** guidance is delivered through the hook
**Then** it arrives mid-turn without interrupting the active tool call.

_Gate:_ Grok hook payload-shape spike.
_Refs:_ CAP-12, `provider-steering-matrix.md`.

---

## Epic 4: Agent Node Room Current-Contract Correction

Operators can read and steer both approved node rooms with the current 70-item product contract.
This Epic corrects the completed historical Epics 1–3 without reopening or rewriting their Stories.
The [validated manifest](../mockup-manifests/agent-node-room.json) is the inventory authority for nine changed features and 61 unchanged context items.
G1, G2, G3, and G4 are current release proof and implementation gates.
G3 requires an actual Grok path for per-item Send now in the active turn in this release; a hook advertisement does not prove the path.
The active Archon adapter and mode must pass the provider-specific gate before the per-item action appears.

### Story 4.1: Place and disclose the TODO strip

As an operator, I want the current checklist below the scrolling transcript so that I can read work and progress together.

**Acceptance Criteria:**

**Given** a Console or Legacy node with TODO state
**When** the room renders
**Then** one pinned, collapsible TODO strip is after the transcript scroller and before the queue or dock
**And** its current item and progress remain visible while transcript rows scroll.

**Given** the strip is expanded
**When** the operator reads it
**Then** phases, items, status, and Raw use the existing fold and disclosure contract
**And** no duplicate checklist appears inline in the transcript.

_Manifest:_ M001/I007 and M002/I070.
_Supersedes:_ The location phrase in completed Story 1.5; its prior acceptance text remains historical.

### Story 4.2: Label every occurrence with Run N

As a reader, I want one primary occurrence label so that I can compare executions without changing label rules by context.

**Acceptance Criteria:**

**Given** a transcript with two or more occurrences
**When** the groups render
**Then** every separator uses primary `Run N` in occurrence order
**And** loop iteration, provider pass, retry, interruption, recovery, and collision detail follows as a suffix when relevant.

**Given** a single occurrence
**When** the transcript renders
**Then** it has no occurrence separator.

**Given** the operator uses navigation
**When** `Execution` or `Jump to` changes
**Then** `Execution` selects the occurrence and `Jump to` only scrolls within loaded content.

_Manifest:_ M007/I052.
_Supersedes:_ Alternative primary headings in completed Stories 1.7 and 3.2.

### Story 4.3: Send one queued item into the active turn

As an operator, I want per-item Send now to deliver my selected correction while the agent generates.

**Acceptance Criteria:**

**Given** a queued item and a proven Archon live-turn mode
**When** I select that item's Send now during generation
**Then** exactly that existing server-owned item enters the same active turn without Stop, a natural-end wait, an interrupted tool call, or another turn
**And** every other queued item keeps its order.

**Given** queued messages in either full node room
**When** the shared queue band renders or its disclosure changes
**Then** it stays below the TODO strip and above the dock, shows the node-scoped receipt order, and keeps the approved collapse and expand behavior
**And** disclosure changes no queue contents.

**Given** the provider transport accepts the selected item
**When** the receipt is recorded
**Then** only that item leaves the shared queue and one operator row appears immediately with `sent` and no visible sender name
**And** its stored `operator_user_id`, derived read-model attribution, and stamped id remain intact.

**Given** the provider rejects before acceptance or the turn ends first
**When** the operation resolves
**Then** the item stays queued in its original position or an explicit unresolved result is reported
**And** no silent next-turn fallback, duplicate injection, or false operator row occurs.

**Given** an uncertain timeout or a transcript-write failure after acceptance
**When** the client retries or reconnects
**Then** the selected id does not enter a sendable queue again and the recording failure is visible.

_Manifest:_ M003/I009, M004/I029, M005/I008, M006/I028, and M008/I063.
_Release proof:_ G2 Claude actual `AsyncIterable` path, G3 an actual Grok live-input path, and G4 OMP actual RPC path must each prove same-turn input on the exercised Archon adapter and mode, including tool-boundary and pure-text cases.
G3 is required for this release; if hooks cannot pass the gate, another Grok path must pass it or release remains blocked.
_Supersedes:_ Per-item refusal and sender-name criteria in completed Stories 3.4 and 2.8 only for this accepted row.

### Story 4.4: Show queue-only controls and truthful delivery status

As an operator, I want controls and status to reflect what the active transport proved.

**Acceptance Criteria:**

**Given** a queue-only mode, including current Codex, DeepSeek, or Grok `--single`
**When** the queued list renders
**Then** it omits per-item Send now and retains Queue, Delete, Stop, and dock Send now after Stop under their existing state rules.

**Given** a new Grok live-input mode
**When** its actual Archon path has proved selected-item same-turn acceptance and causal agent receipt
**Then** per-item Send now may appear during generation in both rooms for that mode
**And** an advertised hook or unsupported mode does not make the action appear.

**Given** a direct per-item request reaches a queue-only or stale mode
**When** the server checks it
**Then** it returns a typed refusal and changes no queue or transcript state.

**Given** a selected accepted row reads `sent`
**When** a matching native lifecycle event or a stream causally tied to that message proves agent consumption
**Then** only that row changes to `delivered`.

**Given** only an RPC acknowledgement, unrelated ongoing stream, text match, timestamp, or route receipt
**When** the status is projected
**Then** that row remains `sent`.

**Given** the operator presses dock Send now after Stop
**When** the idle session continues
**Then** all queued messages plus the new draft flush in receipt order as the next turn, separate from per-item active-turn delivery.

_Manifest:_ M003/I009, M004/I029, and M009/I068; queue-only context C065/I065 in the manifest's inventory.
_Release proof:_ G1 requires causal consumption evidence through the actual provider path; an SDK version or exact echoed id is not the universal test.
G3 requires this proof on the new Grok path before that mode exposes the per-item action.
_Supersedes:_ Visible queue-only refusal and exact-id-only status criteria in completed Stories 3.5 and 2.8.

### Story 4.5: Keep product room controls inside the fixture boundary

As an operator, I want the room's actual controls without review-only switches.

**Acceptance Criteria:**

**Given** either product node room
**When** it renders
**Then** the outer numbered review-state, node-kind, and provider-transport controls from the mockup sheets are absent
**And** the in-product `Execution`, Cancel, Re-run, Log or Logs, Graph, counted Artifacts, and close controls retain their approved behavior.

**Given** a Logs row or execution is selected
**When** the room updates
**Then** the selected row, room header, transcript, TODO projection, queue, and dock agree.

_Manifest:_ Fixture exclusion applies to the 70-item product inventory; unchanged product controls remain in the 61 manifest `UNCHANGED_CONTEXT` rows.
_Supersedes:_ The outer-control criteria in completed Story 3.6.

### Story 4.6: Prove all 70 approved product items

As a product owner, I want one conformance result for both rooms so that the current contract can be reviewed.

**Acceptance Criteria:**

**Given** the validated manifest
**When** the trace is built
**Then** every one of its 70 product items has a requirement, implementation owner, and verification path on each applicable Legacy or Console surface
**And** the nine `CHANGE_FEATURE` rows M001–M009 match their full behavior signatures
**And** all 61 manifest `UNCHANGED_CONTEXT` rows remain covered without counting outer fixture controls.

**Given** focused route, registry, executor, provider, component, and end-to-end checks
**When** they run against actual Archon adapters and both rooms
**Then** G2 Claude, G3 Grok, and G4 OMP actual adapter paths prove the active-turn contract, with G1 causal consumption evidence for each displayed `delivered` state
**And** selected-item races, queue-only absence, TODO placement, universal headers, attribution, and room chrome pass without a skipped current item.

**Given** the conformance inventory is scored
**When** Epic 4 closes
**Then** all 70 items are `MATCHED` and none is `PARTIAL`, `MISSING`, `CONFLICT`, or `UNCLEAR`.

_Manifest:_ M001–M009 and all 61 `UNCHANGED_CONTEXT` rows.
_Depends on:_ Stories 4.1–4.5 and proven G1/G2/G3/G4 release gates.
