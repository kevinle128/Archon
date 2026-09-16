---
stepsCompleted:
  [
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
inputDocuments:
  - ../../specs/spec-workflow-run-view-hitl/SPEC.md
  - ../../specs/spec-workflow-run-view-hitl/hitl-contract.md
  - ../../specs/spec-workflow-run-view-hitl/brownfield.md
  - ../architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md
---

# Archon Workflow Run View HITL - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Archon Workflow Run View HITL (mid-turn AskHuman + node-centric run view on legacy `WorkflowExecution` and Command Center `/console`), decomposing the requirements from the spec kernel, HITL contract, brownfield seams, and adopted architecture spine into implementable stories.

There is **no PRD.md** for this feature. CAP-1–7 in `SPEC.md` are the functional source. There is **no bmad-ux DESIGN.md + EXPERIENCE.md pair**; UX-DRs below are extracted from SPEC constraints and architecture conventions (AD-4, awaiting tone, Logs IA, unified render).

Feature-scoped epic directory (same pattern as `epics-source-control`): `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/` holds **only** this `epics.md`. Do not write `{planning_artifacts}/epics.md` and do not merge into `epics-source-control`. Architecture ADs AD-1–AD-9 are adopted — stories implement them; they do not re-decide them.

Epic numbers start at **5** so they do not collide with Source Control (Epics 1, 2, 4) or Workflow Commander (Epic 3) in `{implementation_artifacts}/sprint-status.yaml`. Story files will be `{implementation_artifacts}/{{story_key}}.md`.

## Requirements Inventory

### Functional Requirements

FR1: An operator can inspect a live or historical run as a node-centric graph **and** as an unmerged chronological list of node-runs; clicking a graph node or a Logs row opens that node's room; a loop or `route_loop` iteration appears as its own row; both legacy and console keep the Logs list; the graph is additional, not a replacement. (CAP-1)

FR2: Opening a selected node shows a per-type panel: `command`/`prompt`/`loop` show an agent room (prose + tool cards); `bash`/`script` show stdout; `approval`/`plannotator_gate` show the declared gate; `workflow` links the child run; `route_loop`/`loop_group` show controller/container chrome; a completed agent node replays the same room as a static transcript. (CAP-2)

FR3: An operator can follow a chat-style timeline of their turns plus node-status entries; clicking a node-status entry opens that node's room without changing the panel's meaning; when the agent asks, an Ask card appears **inline in the agent room** at the tool invocation — not as free-text in the composer. (CAP-3)

FR4: An in-flight agent node can pose structured questions to the run starter mid-turn. The card supports one or more questions (single-select, multi-select, Other requiring non-empty text); Submit stays disabled until every question is valid; exactly one POST answers the whole card `{ answers: { questionId, value }[] }` **or** `{ decline: true }`; decline delivers `"declined"` and the **agent** decides the node outcome; the node then continues with that payload. (CAP-4)

FR5: Several asks can be outstanding at once without a second scheduler. Two agent nodes (or two asks on one node) show independent cards; a node stays `awaiting` until every ask on that node is resolved; run-level "awaiting input" clears only when the last pending interaction in the run is resolved; in-flight siblings may finish their current turn; the next DAG layer does not start until the run resumes. (CAP-5)

FR6: Only `workflow_runs.user_id` (the starter) can answer or decline; a teammate view is read-only with factual "waiting for \<starter\>" copy and no Submit/Decline. A starter-less run never reaches an unanswerable awaiting state: identity fails **when an Ask would be persisted**, not at the start of every identity-less CLI run. First answer wins; already resolved → 409. (CAP-6)

FR7: A workflow that **requires** AskHuman on a provider that cannot ask fails before spending a turn; other runs on those providers still start. `allowed_tools` naming AskHuman on Codex/Grok/OpenCode/Copilot (`askHuman: false`) is rejected at run start with error chrome; the same workflow without that requirement starts and simply has no Ask tool; only Claude and Pi produce Ask in v1. (CAP-7)

FR8: Both legacy `WorkflowExecution` and `/console` ship this feature. Engine and contract are surface-agnostic; each surface is a thin renderer of the same envelope, states, validity, and copy — not a shared React NodePanel.

FR9: Permission is in-scope as **envelope/type-contract only**: `kind: permission`, `call_id` ≡ `tool_use_id`, POST `{ intent }`. Variant permission cards and a live activation source are out of scope.

FR10: Child-run Ask: pending rows live on the **child** `run_id`; the parent follows existing `workflow:` child-paused behavior; the operator answers the child, not the parent.

FR11: The product reads/writes through the HITL contract: GET `/api/workflows/runs/:runId` embeds `pending_interactions[]` and `nodeStates` including `awaiting`; GET `/api/workflows/runs/:runId/nodes/:nodeId/messages` returns the agent-room transcript; POST `/api/workflows/runs/:runId/ask/:requestId/answer` (`requestId` = `tool_use_id`); POST `/api/workflows/runs/:runId/permissions/:callId/confirm` (`callId` = `tool_use_id`). SSE `node_awaiting` / `interaction_resolved` are refetch triggers, not card payloads. Cards come from `pending_interactions`, never from transcript `status` rows or the SSE buffer.

FR12: AskHuman tool invocation is the **only** ask channel. The engine never classifies assistant prose as an ask; never wraps Claude `AskUserQuestion`; console Reply/composer is not HITL. A model that asks in prose is an accepted residual.

### NonFunctional Requirements

NFR1 (Language): No workflow YAML authoring-language changes. No new YAML field for AskHuman. Injection is by capability, not a new node type.

NFR2 (Lifecycle): Wait indefinitely at an Ask — no timeout, no auto-default, no autonomous lifecycle mutation of non-terminal work.

NFR3 (Data): Additive-only schema on both SQLite and PostgreSQL. `awaiting` is a node/UI state, not a new run status. Run status stays `paused` during Ask. Declared gates keep `ApprovalContext`; AskHuman never occupies that slot. Indexes and column comments go in the trailing section of `migrations/000_combined.sql`. `bun run check:schema-upgrades` is required.

NFR4 (Console isolation): Console must not import `@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, `@tanstack/react-query`, or `@/lib/api` **functions**. Type-only `api.generated.d.ts` is allowed. The **one** sanctioned exception is `packages/web/src/lib/run-graph/`.

NFR5 (Tone): Awaiting chrome is warning / "waiting on you", never error/destructive. CAP-7 start rejection is the error state.

NFR6 (Scope): No new deploy, env, or infra topology. No change to `NativeTool.handler` return type (`Promise<string>`). No CLI / chat / `manage_run` answer UX in this epic set (same REST later). No Source Control viewer inside the node room. No per-node independent scheduling.

NFR7 (SDK lock): Claude Agent SDK install is lockfile-exact **0.3.209** until the AD-6 spike amends AD-6. Pi resume uses `session.agent.continue()` at `pi-agent-core` 0.80.6, not `AgentSession.continue()`.

NFR8 (Observability): Log `workflow.ask_pending` / `workflow.ask_resolved` / `workflow.ask_resume_failed`. Never log answer bodies.

NFR9 (Idempotency): CAS first-wins on `(workflow_run_id, tool_use_id)`. Ask pause is idempotent (already-paused + another pending insert is success). Surfaces must not re-project node status from raw events.

NFR10 (Compatibility): Existing `remote_agent_messages` stay the merged/chat path and are not node-tagged. `manage_run` remains unchanged.

### Additional Requirements

- **Brownfield, not a starter template.** No greenfield scaffold. Stories extend existing packages behind existing ports (`IWorkflowStore`, `WorkflowDeps`, `@archon/providers/types`).
- Canonical `pendingInteractionSchema` lives in `packages/workflows/src/schemas/`. Server route schemas import or `.extend` it — they do not fork it. Web + console consume `api.generated.d.ts` types only.
- Tables: `remote_agent_pending_interactions`, `remote_agent_workflow_node_messages`. Store-assigned monotonic `seq` per `(run_id, node_id)` for messages. Payload kinds: `text` `{ text }`; `tool` `{ name, id, input?, output? }`; `status` `{ state, detail? }` — status rows are **not** Ask cards. Cascade-delete with the run.
- Store ports: `insertPendingInteraction`, `resolvePendingInteraction` (CAS), `listPendingInteractions`, `appendNodeMessage`, `listNodeMessages`; `pauseWorkflowRun(id, approvalContext?)`.
- Ask pause must not write `metadata.approval`. Concurrent sibling Ask: persist + tear down **that** node's `sendQuery`; do not fail the node if the run is already paused. Do not write `node_completed` for an asking node.
- **One Ask-resume owner:** `workflow-operations` CAS that moves the last pending row to `answered`|`purged` is the only caller of `resumeWorkflowRun` for this feature, in the same transaction. The executor never resumes an Ask pause; on hydrate-when-running it re-enters **every** node with no `node_completed` and ≥1 answered pending row. A resume that cannot re-enter **fails the node** and keeps the answer. Purge pending on cancel/fail.
- `@archon/workflows` owns the `AskHuman` `NativeTool`. Executor injects it onto `command`/`prompt`/`loop` when `capabilities.askHuman` is true. Handler persist-then-throws `AskHumanAwaitingError` (`@archon/providers/types`); wrappers **reject `sendQuery`**, they do not stringify the branded error. Converters must accept `questions[]` of string/enum/boolean objects. New `askHuman` capability + `generate:capability-matrix` axis. Tool name `AskHuman` (Claude MCP: `mcp__archon__AskHuman`).
- Provider-owned resume: `SendQueryOptions.resumeInteractions: Array<{ tool_use_id, payload, declined }>`. Executor does **not** put answers in the prompt. Claude: one new user message, no AskHuman re-issue. Pi: `ToolResultMessage` + `session.agent.continue()`. Session SoT is `provider_session_id` on the pending row.
- **Required spikes before those stories ship:** Claude `tool_deferred` / PreToolUse `defer` vs host abort (may amend AD-6); Pi reopen-after-dispose continue (unproven after Archon's `dispose()`).
- One projector `projectLatestEffectiveNodeStates` in `@archon/workflows`: `node_started`→`running`, `node_awaiting` **or** pending rows for that node→`awaiting`, `interaction_resolved` does not complete the node, `node_completed` only when the node actually completes. GET `nodeStates` **must** use that projector. Legacy `buildDagNodeStatesFromEvents` is not a second lifecycle projector.
- `node_awaiting` write is the same transaction as the pending insert (not best-effort-swallowed).
- Run chrome "awaiting input" = `status === 'paused'` AND count(pending)>0. Auth via `resolveAuthContext`.
- Shared graph module: `packages/web/src/lib/run-graph/` — pure TS, own tests, public API `layout({ nodes: { id, nodeState }[], edges }) → { positions, routes }`. Taken-path treats `awaiting` as on-path, never skipped. No new frontend dependency for the graph module.
- Architecture spine status is **final**. Stories bind to AD-1–AD-9; do not reopen CAP-7 narrowing or Q1–Q5.

### UX Design Requirements

No bmad-ux `DESIGN.md` + `EXPERIENCE.md` pair exists for this feature (`ux-design.md` / mockup were not on disk at extraction). The following UX-DRs are the implementable visual/IA contract from SPEC + spine conventions.

UX-DR1: Both surfaces keep an unmerged Logs / log-history view of node-**run** rows (each loop / `route_loop` iteration is its own row). The graph is an extra door into the same node room, not a replacement for Logs.

UX-DR2: Shared `run-graph` layout: distance-aware edge routing (short/vertical → top ports; long + offset → side ports); taken-path classification treats `awaiting` as active/on-path, never skipped. Each surface owns its React/SVG shell (pan/zoom, click, cards).

UX-DR3: One panel instance per surface. Unified render means the same envelope, states, validity, and copy — **not** a shared React NodePanel imported across legacy and console.

UX-DR4: Node taxonomy chrome matches FR2: agent room for `command`/`prompt`/`loop`; stdout for `bash`/`script`; declared-gate chrome for `approval`/`plannotator_gate`; child-run link for `workflow`; controller vs container chrome for `route_loop` vs `loop_group`.

UX-DR5: Ask card lives inline in the agent room at the tool invocation. Submit stays disabled until every question is valid. Other is a first-class option and requires non-empty text. Decline is a first-class action on the card. Console composer/Reply is **not** an ask path.

UX-DR6: Awaiting chrome uses warning tokens ("waiting on you"), never `--error`. Teammate copy is factual, names the starter, and omits Submit/Decline.

UX-DR7: Chat timeline node-status entries are clickable into the same room; they do not switch the panel into a different product meaning.

UX-DR8: CAP-7 start rejection uses error chrome. Ask-awaiting never uses that error treatment.

### FR Coverage Map

- **FR1** → 5.1 Logs + iteration rows; 5.3 graph door; 5.5 console
- **FR2** → 5.1 agent room + replay; 5.2 per-type; 5.5 console
- **FR3** → 5.4 / 5.5 timeline click; 6.5 / 6.6 Ask card
- **FR4** → 6.2 persist; 6.3 POST + continue; 6.5 card validity
- **FR5** → 6.4
- **FR6** → 6.2 fail-at-persist; 6.3 starter + 409; 6.5 teammate
- **FR7** → 6.2; error chrome 6.5 / 6.6
- **FR8** → 5.1–5.4 legacy inspect; 5.5 console inspect; 6.5 / 6.6 Ask chrome
- **FR9** → 6.7
- **FR10** → 6.4
- **FR11** → 5.1 messages GET + projector + empty pending; 6.2 pending embed + `node_awaiting`; 6.3 ask POST + `interaction_resolved`; 6.7 permission POST
- **FR12** → 6.2 no `AskUserQuestion` / no chat inject; 6.5 / 6.6 composer not HITL
- **NFR1–NFR10** → as tagged on stories (schema 5.1/6.2; isolation 5.5/6.6; SDK 6.1; wait 6.3)
- **UX-DR1–UX-DR4, UX-DR7** → Epic 5
- **UX-DR5, UX-DR6, UX-DR8** → 6.5 / 6.6

## Epic List

### Epic 5: Inspect a run as nodes

On both legacy `WorkflowExecution` and `/console`, an operator can inspect a live or historical run as a node-centric graph **and** as an unmerged Logs list of node-runs, open a per-type node room from either, follow chat timeline node-status entries into that same room, and replay a completed agent node's transcript. The graph is additional, not a replacement for Logs. No Ask cards yet — this epic is independently useful without HITL.

**FRs covered:** FR1, FR2, FR3 (timeline + status click), FR8 (shells + contract, not Ask cards), FR11 (messages GET + projector `nodeStates`).
**UX-DRs:** UX-DR1–UX-DR4, UX-DR7.
**Depends on:** nothing in this feature set. Brownfield run screen already exists.
**Enables:** Epic 6 inserts Ask cards and awaiting chrome into these rooms (no reserved empty seat in Epic 5).
**Implementation notes:** AD-3 transcript table; AD-4 `packages/web/src/lib/run-graph/`; AD-7 GET messages + one `projectLatestEffectiveNodeStates` (legacy stops rebuilding from events); GET run may return `pending_interactions: []` so the embed shape exists — **do not render cards from it in this epic**. Console isolation except `run-graph`; each surface owns its shell.
**Party decision (A+):** Epic 5 ships inspect-only chrome. No Ask card, no placeholder slot, no awaiting/"waiting on you" tone. The agent room is an extensible chronological timeline of `text` / `tool` / `status` items so Epic 6 can insert a card at the tool invocation. Do not write an Epic 5 story for an AskCard placeholder. FR3 Ask-card slice and UX-DR5/6/8 stay Epic 6.

#### Story 5.6: Align agent history and the responsive run room

As a run-detail operator,
I want execution-scoped agent history in an open-on-demand percentage run room that stays usable on narrow containers,
So that Story 5.6 matches the approved HITL run-view contract on both Legacy and Console.

**Issue:** [Align Agent History and Responsive Run Room](https://github.com/anhle128/Archon/issues/147)
**Brainstorm:** `plans/reports/brainstorm-260908-1653-workflow-run-hitl-ui-gap.md`
**Plan:** `docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md`

**Acceptance Criteria:**

1. Both Legacy and Console open with the room absent and the primary work area using the released width.
2. Clicking a Log execution or graph node opens the room and gives it the stored percentage of the available work area.
3. Closing the room removes its panel and divider, returns the width to the main view, and restores focus to the opener when that opener still exists.
4. On a single-pane container, opening the room keeps the main view mounted but hidden, and Back restores the exact Log or Graph state.
5. A valid `?node=` deep link opens the required node exactly once per query-value entry and does not reopen after a manual close until the query leaves and re-enters that value.
6. Changing the run id resets room selection, explicit-execution memory, saved room scroll positions, Ask drafts, and the deep-link application marker.
7. A graph-node click restores the last explicit execution for that node, then prefers awaiting, then running, then the latest execution.
8. The room header identifies the selected execution with node label, iteration or attempt context, status, run-relative start time, duration when recorded, and provider/model only from the matching selected execution event.
9. Completed executions open at the top, active executions open at the bottom in follow mode, scrolling up disables follow mode, and Jump to latest re-enables it.
10. Node-message paging drains all pages through the scoped high-water mark, polls a live scope without overlapping requests, deduplicates by `seq`, ignores late responses from an obsolete scope, aborts obsolete requests, and retains already loaded rows if a later page fails.
11. Assistant text is projected in sequence order without duplicated deltas or snapshots.
12. Every tool invocation is one structured card with tool name, full allowlisted context, initially expanded Input and Output, inline outcome and duration, honest pending, missing, failed, interrupted, and truncated states, and a detail link only when the list response marks the output truncated.
13. Ask cards and approval gates appear at their actual execution position when execution scope is recorded, and an explicit limitation appears for legacy unscoped data.
14. The same pending Ask request uses one controlled draft whether rendered in the room or in the main execution section, and answered or declined requests remain as compact read-only records.
15. Console Log renders one section per `ConsoleLogEntry` and never assigns repeated executions by node id alone.
16. Console Reply sends only to an existing parent conversation whose recorded `platform_type` is `web`, and it never creates a fallback conversation.
17. The Awaiting-input action opens the matching execution and focuses its Ask card, while run tabs, graph selection, graph pan and zoom, and existing operational controls remain usable.
18. A 120-tool-call fixture proves that the UI itself requests more than one cursor page and renders every distinct recorded call.
19. The acceptance report records actual behavior at 1440 by 1000, 1024 by 900, 768 by 900, and 390 by 844 for both surfaces, and labels every mismatch as a concrete deviation.
20. Legacy Chat, Source Control, and Terminal remain available, including timeline-only Chat with a disabled composer when no parent conversation exists.
21. Console Artifacts remains in the main pane while the selected room stays docked.
22. `bun run validate` and the focused Playwright HITL suite pass.

### Epic 6: Answer an agent mid-turn

On both surfaces, the run starter sees warning "awaiting input," answers or declines a structured Ask card inline in the agent room, and the node continues with that payload. Teammates can watch but not submit. Concurrent asks work without a second scheduler. A Codex (etc.) run that names AskHuman in `allowed_tools` is rejected at start; one that does not still starts. Permission is envelope-only. Child-run Ask is answered on the child.

**FRs covered:** FR3 (Ask card), FR4, FR5, FR6, FR7, FR8 (Ask chrome on both surfaces), FR9, FR10, FR11 (pending embed, POSTs, SSE), FR12.
**UX-DRs:** UX-DR5, UX-DR6, UX-DR8.
**Depends on:** Epic 5 rooms, transcript GET, and projector.
**Does not require a later epic.**
**Implementation notes:** AD-1, AD-2, AD-5, AD-6, AD-7 remainder, AD-8, AD-9. Required Claude/Pi resume spikes are stories in this epic and may amend AD-6; they are not a third epic.

## Epic 5: Inspect a run as nodes

On both legacy `WorkflowExecution` and `/console`, an operator can inspect a live or historical run as a node-centric graph **and** as an unmerged Logs list of node-runs, open a per-type node room from either, follow chat timeline node-status entries into that same room, and replay a completed agent node's transcript. The graph is additional, not a replacement for Logs. No Ask cards yet — this epic is independently useful without HITL.

### Story 5.1: Open a node's own transcript from Logs (legacy)

As an operator,
I want to click an unmerged Logs row on the legacy run screen and see that agent node's own chronological transcript,
So that I can inspect what this node did without reading a merged run log.

**FRs:** FR1 (Logs + iteration rows), FR2 (agent room + replay), FR11 (messages GET + projector). **UX-DR1, UX-DR3 (A+).**

**Acceptance Criteria:**

**Given** a run with `command` / `prompt` / `loop` nodes that have produced output
**When** I open the legacy run view Logs list
**Then** I see unmerged node-**run** rows (a loop / `route_loop` iteration is its own row), not a merged all-nodes stream
**And** the graph is not required for this story (FR1 graph waits for 5.3)

**Given** I click a Logs row for a `command` / `prompt` / `loop` node
**When** the node room opens
**Then** I see that node's timeline of `text` / `tool` / `status` items in store `seq` order from `GET /api/workflows/runs/:runId/nodes/:nodeId/messages`
**And** the room is an extensible item list keyed by `kind` (not a prose-only dump; not an AskCard placeholder)
**And** there is no Ask card, empty card slot, or awaiting / "waiting on you" chrome (A+)

**Given** the node has completed
**When** I open the same room
**Then** I see the same timeline as a static transcript (replay), not only while it was streaming

**Given** `remote_agent_workflow_node_messages` does not exist yet
**When** this story ships
**Then** the table exists on SQLite and Postgres (additive, cascade-delete with the run, `seq` assigned by the store per `(run_id, node_id)`)
**And** the executor appends `text` / `tool` / `status` payloads; `status` is lifecycle notes only, never an Ask card
**And** `remote_agent_messages` stays the merged/chat path and is not node-tagged
**And** indexes / column comments are in the trailing migration section; `check:schema-upgrades` is in the story's validation

**Given** `GET /api/workflows/runs/:runId`
**When** a client fetches the run
**Then** `nodeStates` come from `projectLatestEffectiveNodeStates` (legacy must not rebuild lifecycle from raw events)
**And** `pending_interactions` is present as `[]` with **no** `remote_agent_pending_interactions` table yet
**And** the UI does not render cards from that array

### Story 5.2: See the right room for each node type (legacy)

As an operator,
I want the selected node's panel to match that node's type,
So that a bash step, a gate, a child workflow, or a loop controller is not shown as a fake agent chat.

**FRs:** FR2, FR8 (legacy panel). **UX-DR4.**

**Acceptance Criteria:**

**Given** I am on the legacy run view from Story 5.1 (Logs → one panel instance)
**When** I open a `bash` or `script` node
**Then** the room shows that node's stdout (not an agent timeline)
**And** there is still no Ask card / awaiting chrome

**Given** I open an `approval` or `plannotator_gate` node
**When** the panel renders
**Then** I see the **declared** gate chrome (`ApprovalContext` / existing gate UX)
**And** AskHuman does not occupy that slot

**Given** I open a `workflow` node
**When** the panel renders
**Then** I get a link to the child run (not the child's transcript inlined as this node's room)

**Given** I open a `route_loop` node
**When** the panel renders
**Then** I see controller chrome (not an agent room)

**Given** I open a `loop_group` node
**When** the panel renders
**Then** I see container chrome (not an agent room)

**Given** I switch between node types via Logs
**When** the panel updates
**Then** it is still one panel instance on this surface (UX-DR3)
**And** this story does not add a shared React NodePanel for console
**And** the graph is still not required (5.3)

### Story 5.3: Open the same node room from the graph (legacy)

As an operator,
I want a node-centric graph on the legacy run view as a second door into the same room,
So that I can see structure and taken path without losing unmerged Logs.

**FRs:** FR1 (graph door). **UX-DR2.**

**Acceptance Criteria:**

**Given** `packages/web/src/lib/run-graph/` does not exist
**When** this story ships
**Then** a pure-TS module exposes `layout({ nodes: { id, nodeState }[], edges }) → { positions, routes }` with its own tests
**And** it has no React, DOM, or API imports
**And** no new frontend dependency is added for the graph
**And** taken-path treats `awaiting` as on-path, never skipped (fixture even if the UI does not produce `awaiting` yet)
**And** edge routing is distance-aware (short/vertical → top ports; long + offset → side ports)

**Given** the legacy run view from Stories 5.1–5.2
**When** I view a live or historical run
**Then** I see the graph **in addition to** unmerged Logs (Logs must remain)
**And** there is still no Ask card / awaiting chrome

**Given** I click a graph node
**When** the panel updates
**Then** I open the **same** node room as clicking that node's Logs row (same panel instance, same per-type chrome from 5.2)
**And** this story does not implement the console graph shell (5.5)

### Story 5.4: Open the node room from the chat timeline (legacy)

As an operator,
I want to follow my turns plus node-status entries in the run chat timeline and click a status into the same node room,
So that the timeline and the room stay one product, not two meanings.

**FRs:** FR3 (timeline + status click, not Ask card). **UX-DR7.**

**Acceptance Criteria:**

**Given** a live or historical run on the legacy screen with chat turns and node-status entries
**When** I scan the timeline
**Then** I see my turns and node-status entries in chronological chat order
**And** the composer/Reply is still not an Ask channel (this story does not wire HITL)

**Given** I click a node-status entry
**When** the panel updates
**Then** I open the **same** node room as Logs (5.1–5.2) or graph (5.3) for that node
**And** the panel's meaning does not switch (UX-DR7)
**And** there is still no Ask card, empty card slot, or awaiting chrome (A+)

**Given** I click Logs, graph, and a timeline status for the same node in any order
**When** the room is showing
**Then** all three doors select the same node and the same per-type chrome
**And** this story does not implement console timeline (5.5)

### Story 5.5: Inspect a run as nodes on Command Center

As an operator,
I want the same inspect contract on `/console` — unmerged Logs, graph, per-type rooms, timeline click — in console's own shell,
So that Command Center is not a second product with a merged log and a different room.

**FRs:** FR1, FR2, FR3 (timeline), FR8 (console inspect). **UX-DR1–UX-DR4, UX-DR7. NFR4.**

**Acceptance Criteria:**

**Given** Stories 5.1–5.4 exist on legacy
**When** I open a live or historical run on `/console`
**Then** I see unmerged Logs (iteration = own row) **and** a graph that uses `packages/web/src/lib/run-graph/` `layout()`
**And** clicking a Logs row, a graph node, or a node-status timeline entry opens the **same** per-type room for that node
**And** `command`/`prompt`/`loop` rooms render the GET messages timeline; other types match Story 5.2 chrome
**And** Logs remain; the graph is additional
**And** there is no Ask card, empty card slot, or awaiting chrome (A+)

**Given** console isolation (NFR4)
**When** this story ships
**Then** console does not import `@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, `@tanstack/react-query`, or `@/lib/api` **functions**
**And** the only production-web import is `run-graph` (plus type-only `api.generated.d.ts`)
**And** console does **not** import a shared React NodePanel from legacy (UX-DR3)

**Given** a completed agent node
**When** I open its room on console
**Then** I see the static transcript replay, same as legacy 5.1

## Epic 6: Answer an agent mid-turn

On both surfaces, the run starter sees warning "awaiting input," answers or declines a structured Ask card inline in the agent room, and the node continues with that payload. Teammates can watch but not submit. Concurrent asks work without a second scheduler. A Codex (etc.) run that names AskHuman in `allowed_tools` is rejected at start; one that does not still starts. Permission is envelope-only. Child-run Ask is answered on the child.

### Story 6.1: Prove Claude and Pi can resume after AskHuman

As an operator,
I want the resume protocol proven on the pinned Claude SDK and Pi `session.agent.continue()` before production continue ships,
So that answering an Ask does not depend on an untested vendor path.

**FRs:** none directly (gates FR4 continue in 6.3). **NFR7.** Spike exception: required by AD-6, not a user-facing slice.

**Acceptance Criteria:**

**Given** AD-6 as adopted (provider-owned `resumeInteractions`; Claude = one new user message, no tool re-issue; Pi = `ToolResultMessage` + `session.agent.continue()` at `pi-agent-core` 0.80.6)
**When** the Claude spike runs against lockfile **0.3.209**
**Then** it records whether host abort vs `tool_deferred` / PreToolUse `defer` is required
**And** if the Rule must change, this story amends AD-6 in the architecture spine — it does not fork a silent second protocol
**And** the lockfile stays exact `0.3.209` until that amendment (NFR7)

**Given** Archon's Pi path today ends in `session.dispose()`
**When** the Pi spike runs
**Then** it records whether `session.agent.continue()` works after dispose/reopen (or what reopen contract is required)
**And** the same amend-or-confirm rule applies to AD-6
**And** `AgentSession.continue()` is not treated as the API

**Given** either spike is incomplete
**When** Story 6.3 would call production resume
**Then** 6.3 must not ship continue until this story's outcome is written (6.2 may persist an Ask without continue)

### Story 6.2: Pause a run when the agent asks, without stealing the approval slot

As a run starter,
I want an in-flight Claude or Pi agent node to persist a structured Ask and pause the run without writing `metadata.approval`,
So that declared gates stay intact and the pending Ask survives refetch.

**FRs:** FR4 (persist Ask), FR6 (fail at persist), FR7, FR11 (pending embed + `node_awaiting`), FR12. **NFR1, NFR3, NFR8, NFR9.** Sizing risk: one agent may split at implementation into schema/pause vs tool/inject vs CAP-7.

**Acceptance Criteria:**

**Given** `remote_agent_pending_interactions` does not exist
**When** this story ships
**Then** the table exists on SQLite and Postgres (additive; indexes/comments trailing; `check:schema-upgrades`)
**And** `pendingInteractionSchema` lives in `packages/workflows/src/schemas/`; server routes import or `.extend` it (no fork)
**And** columns match AD-1 (`tool_use_id` unique per run = Ask `request_id` = Permission `call_id`; `kind` `ask|permission`; `status` `pending|answered|purged`; envelope without answer; nullable answer; `provider_session_id`)
**And** store ports `insertPendingInteraction` and `listPendingInteractions` exist; engine reads/writes only through `IWorkflowStore`

**Given** `pauseWorkflowRun` currently requires `ApprovalContext`
**When** Ask pause runs
**Then** `approvalContext` is optional; Ask pause sets `status='paused'` and **must not** write `metadata.approval`
**And** Ask pause is idempotent: already-paused + another pending insert succeeds
**And** `awaiting` is added to `nodeStateSchema`, `workflowStepStatusSchema`, and server `workflowNodeStateSchema.status`
**And** run status is still `paused` (no new run status)

**Given** `@archon/workflows` owns `AskHuman`
**When** a `command` / `prompt` / `loop` node runs on a provider with `capabilities.askHuman`
**Then** the executor injects `AskHuman` (no new YAML field; NFR1)
**And** the handler persists pending then throws `AskHumanAwaitingError`; wrappers **reject** `sendQuery` and do not stringify that class
**And** converters accept `questions[]` of string/enum/boolean object fields
**And** `askHuman` is a capability-matrix axis; v1 true only for Claude and Pi
**And** `NativeTool.handler` remains `Promise<string>`
**And** AskHuman is not injected by the chat orchestrator; `AskUserQuestion` is not wrapped (FR12)

**Given** an Ask is persisted
**When** `GET /api/workflows/runs/:runId` is fetched
**Then** `pending_interactions` contains the row(s); `nodeStates` use the projector (`node_awaiting` or pending rows → `awaiting`; `interaction_resolved` does not complete the node)
**And** `node_awaiting` is written in the **same transaction** as the insert
**And** SSE `node_awaiting` is a refetch trigger, not a card payload
**And** `GET .../nodes/:nodeId/messages` still has no Ask cards in `status` rows
**And** if the run has no `user_id`, persist **fails** (does not start every identity-less CLI run as failed) (FR6)

**Given** `allowed_tools` names `AskHuman` on Codex/Grok/OpenCode/Copilot (`askHuman: false`)
**When** the run starts
**Then** it is rejected before a turn with error chrome (FR7, UX-DR8)
**And** the same workflow without that `allowed_tools` entry starts and has no Ask tool

**Given** logs
**When** an Ask is pending
**Then** `workflow.ask_pending` is emitted and answer bodies are never logged (NFR8)

### Story 6.3: Answer or decline the Ask so the node can continue

As the run starter,
I want one POST to submit a valid answer set or decline,
So that the agent receives that payload and the node continues (using Story 6.1's resume protocol).

**FRs:** FR4 (POST + continue), FR6 (starter + 409), FR11 (ask POST + `interaction_resolved`). **NFR2, NFR8, NFR9.**

**Acceptance Criteria:**

**Given** a pending Ask with `tool_use_id` = `requestId`
**When** I `POST /api/workflows/runs/:runId/ask/:requestId/answer` with `{ answers: { questionId, value }[] }` or `{ decline: true }`
**Then** first write wins; already resolved → 409
**And** only `workflow_runs.user_id` may mutate (`resolveAuthContext`)
**And** decline stores `"declined"` for `resumeInteractions`; the **agent** decides node outcome
**And** Other selected requires non-empty `value`

**Given** this POST moves the last `pending` row on the run to `answered` or `purged`
**When** that CAS commits
**Then** `workflow-operations` is the **only** caller of `resumeWorkflowRun` for Ask, in the same transaction
**And** the executor never resumes an Ask pause
**And** `interaction_resolved` is written; SSE is a refetch trigger
**And** `workflow.ask_resolved` is logged without answer bodies

**Given** Story 6.1 confirmed (or amended) AD-6
**When** the run hydrates-when-running after resume
**Then** the executor re-enters **every** node with no `node_completed` and ≥1 answered pending row
**And** `sendQuery` includes `resumeInteractions: Array<{ tool_use_id, payload, declined }>` in store order for that node
**And** answers are **not** stuffed into the prompt
**And** Claude maps to one new user message (no AskHuman re-issue) unless AD-6 was amended
**And** Pi maps to `ToolResultMessage` + `session.agent.continue()` unless AD-6 was amended
**And** `provider_session_id` on the pending row is the session SoT
**And** a resume that cannot re-enter **fails the node** and keeps the answer
**And** `workflow.ask_resume_failed` is logged (no answer body)
**And** wait is indefinite (no timeout, no auto-default) (NFR2)

**Given** cancel or fail
**When** the run terminates
**Then** remaining pending rows are purged

### Story 6.4: Keep several Asks outstanding without a second scheduler

As an operator,
I want two asking nodes (or two Asks on one node) to stay independent, with run-level "awaiting input" clearing only on the last pending in the run,
So that concurrency uses the existing pause, not a new per-node scheduler.

**FRs:** FR5, FR10. **NFR6.**

**Acceptance Criteria:**

**Given** two in-flight agent nodes each persist an Ask
**When** the first Ask pauses the run
**Then** the second persist + tear-down of **that** node's `sendQuery` succeeds (does not fail because the run is already paused)
**And** in-flight siblings may finish streaming (`shouldContinueStreamingForStatus`)
**And** the next DAG layer does not start
**And** `node_completed` is not written for an asking node

**Given** two pending Asks on the **same** node
**When** one is answered
**Then** that node stays `awaiting` until **all** pending rows for `(run_id, node_id)` are resolved
**And** run chrome "awaiting input" = `paused` AND count(pending)>0; it clears only when the last pending **in the run** is resolved

**Given** a `workflow:` child run persists an Ask
**When** the operator answers
**Then** pending rows live on the **child** `run_id`; the parent follows existing child-paused behavior
**And** the operator answers the child, not the parent (FR10)

**Given** per-node independent scheduling (sibling progressing past an Ask while the run stays `running`)
**When** this story is evaluated
**Then** that behavior is out of scope (NFR6)

### Story 6.5: Answer the Ask in the legacy node room

As the run starter,
I want the structured Ask card inline in the legacy agent room at the tool invocation, with warning awaiting chrome,
So that I can answer without leaving the run and without using the composer as HITL.

**FRs:** FR3 (Ask card), FR4 (validity/Other/Decline), FR6 (teammate), FR8 (legacy Ask), FR12. **UX-DR5, UX-DR6, UX-DR8.**

**Acceptance Criteria:**

**Given** a pending `kind: ask` on the selected agent node
**When** I open that room on legacy (Logs, graph, or timeline door)
**Then** the card appears **in the timeline at the tool invocation**, not in the composer (UX-DR5, FR3)
**And** cards come from `pending_interactions` (refetch on SSE), never from transcript `status` or the SSE buffer
**And** Submit stays disabled until every question is valid (single/multi/Other)
**And** Decline is a first-class action
**And** one POST answers the whole card (Story 6.3)

**Given** the run is `paused` with count(pending)>0
**When** I look at run chrome
**Then** I see warning / "waiting on you", never error (UX-DR6, NFR5)

**Given** I am not `workflow_runs.user_id`
**When** I view the same run
**Then** I see factual "waiting for \<starter\>" copy and no Submit/Decline (FR6)

**Given** the composer/Reply
**When** I type there
**Then** it is not an Ask path (FR12)

**Given** CAP-7 start rejection
**When** it is shown on this surface
**Then** it uses error chrome, distinct from awaiting (UX-DR8)

**Given** UX-DR3
**When** this story ships
**Then** copy, validity, and states match the contract; this is not a shared React NodePanel exported to console

### Story 6.6: Answer the Ask in the Command Center room

As the run starter,
I want the same Ask card, validity, copy, and awaiting chrome on `/console`,
So that Command Center is not a free-text HITL composer.

**FRs:** FR3 (Ask card), FR8 (console Ask), FR12. **UX-DR5, UX-DR6, UX-DR8. NFR4.**

**Acceptance Criteria:**

**Given** Story 6.5's contract
**When** I open the asking node's room on `/console`
**Then** I get the same envelope, states, validity, and copy (card inline at tool invocation; Submit disabled until valid; Decline; warning awaiting; teammate read-only)
**And** console composer/Reply is **not** HITL (AD-9)
**And** cards still come from `pending_interactions` + refetch, not from a second projector

**Given** NFR4
**When** this story ships
**Then** console still must not import production UI modules / react-query / `@/lib/api` functions
**And** it does not import legacy's Ask card React module; it renders the same contract in its own shell
**And** Logs remain on console

**Given** CAP-7 start rejection
**When** it is shown on this surface
**Then** it uses error chrome, distinct from awaiting (UX-DR8)

### Story 6.7: Confirm a permission by envelope only

As a run starter,
I want a Permission POST `{ intent }` keyed by `call_id` ≡ `tool_use_id`,
So that the type contract exists without shipping variant permission cards.

**FRs:** FR9, FR11 (permission POST).

**Acceptance Criteria:**

**Given** a pending row with `kind: permission`
**When** I `POST /api/workflows/runs/:runId/permissions/:callId/confirm` with `{ intent: string }`
**Then** `callId` = `tool_use_id`; CAS first-wins; already resolved → 409; starter-only
**And** no variant permission cards and no live activation source ship (FR9)
**And** UIs are not required to render a permission card in this story

## Validation (step 4)

Validated 2026-09-06. Coverage: FR1–FR12, UX-DR1–UX-DR8, NFR1–NFR10 each appear in at least one story AC.

**Architecture:** No starter template (brownfield). Tables created when first needed: `remote_agent_workflow_node_messages` in 5.1; `remote_agent_pending_interactions` in 6.2. `resolvePendingInteraction` belongs to 6.3 (first CAS writer).

**Epic independence:** Epic 5 is inspect-only and useful without Ask (A+). Epic 6 builds on Epic 5 rooms; it does not require a later epic.

**Within-epic order:** Each story depends only on earlier stories in the same epic. 5.1 explicitly defers the graph to 5.3 (does not wait on it). 6.3 continue is gated on 6.1 (previous). 6.2 may persist without 6.1.

**File churn:** Legacy `WorkflowExecution` and `/console` are touched in Epic 5 and again in 6.5/6.6. Split kept: AD-6 spike risk wall, inspect feedback before Ask chrome, party A+. Not consolidated.

**Accepted exceptions:**

- 6.1 is a spike, not a user-facing slice; required by AD-6.
- 6.2 is large for one agent; implementer may split schema/pause vs AskHuman inject vs CAP-7 at story-file time without changing FR coverage.
