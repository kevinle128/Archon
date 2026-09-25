---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
targetSlug: agent-node-room
selectedFiles:
  requirements: '_bmad-output/specs/spec-agent-node-room/SPEC.md'
  architecture_read: '_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md'
  architecture_steering: '_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md'
  epics: '_bmad-output/planning-artifacts/epics-agent-node-room/epics.md'
  ux_design: '_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md'
  ux_experience: '_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md'
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-25
**Project:** Archon
**Target:** `agent-node-room`

## Step 1: Document Discovery

The explicit target resolves to one complete same-lineage document set.
The selected Epic frontmatter names the canonical target SPEC, both Architecture spines, both UX companions, and the approved mockup handoff.
All 14 paths in `inputDocuments` exist.

### Requirements files found

**Whole canonical document:**

- `_bmad-output/specs/spec-agent-node-room/SPEC.md` (38,033 bytes; modified 2026-09-24 23:31).

**Supporting target documents:**

- `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` (25,983 bytes; modified 2026-09-24 22:22).
- `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md` (6,901 bytes; modified 2026-09-24 12:38).
- `_bmad-output/specs/spec-agent-node-room/test-plan.md` (16,388 bytes; modified 2026-09-24 22:25).
- `_bmad-output/specs/spec-agent-node-room/engine-integration.md` (21,822 bytes; modified 2026-09-24 23:31).
- `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md` (11,620 bytes; modified 2026-09-24 23:33).
- `_bmad-output/specs/spec-agent-node-room/control-states.md` (14,674 bytes; modified 2026-09-24 23:33).
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` (14,826 bytes; modified 2026-09-24 23:32).
- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` (18,369 bytes; modified 2026-09-24 23:32).

**Source documents:**

- `_bmad-output/specs/spec-agent-node-room/sources/spec-readable-agent-transcript/` and `_bmad-output/specs/spec-agent-node-room/sources/spec-live-agent-steering/` are provenance named by the canonical SPEC frontmatter.
- They are not competing canonical requirements documents.

### Architecture files found

**Paired whole documents:**

- `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` (42,285 bytes; modified 2026-09-24 23:32).
- `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` (50,646 bytes; modified 2026-09-24 23:32).

Their frontmatter assigns the read projection and live steering to separate scopes.
The target SPEC and Epic link both spines as companions, so they form one Architecture set.

### Epic and Story files found

**Whole document:**

- `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (71,006 bytes; modified 2026-09-24 23:32).

No competing `agent-node-room` Epic or Story index was found.
Earlier readiness reports and sprint change proposals in this folder are historical reports, not alternate Epics.

### UX files found

**Paired whole documents:**

- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` (69,055 bytes; modified 2026-09-24 23:32).
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` (172,665 bytes; modified 2026-09-24 23:32).

The documents share the same target lineage and form a design and behavior pair.
The rendered UX mockups in the target UX folder are supporting views, not a second UX specification.

### Approved mockup files found

The Epic frontmatter points to `claude-design/design_handoff_node_room_transcript_steering/`.
The manifest source set equals all four `.dc.html` mockups and `support.js` in that handoff folder.
The validator reports that all recorded source and comparison hashes are current.

- `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` (SHA-256 `207764b40c36a4ac605e84097fb21434bcdaf8634f933623c13609af169f0332`).
- `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html` (SHA-256 `01c56edf7f7d87cf284acc0b1dd872d47ccb79db0cb4c4355a030e085b294855`).
- `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html` (SHA-256 `347bf999707b424814d3a55020a41c042d41be480d1cbff22877b91c2809c237`).
- `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html` (SHA-256 `85d97585f368bf75cae49461042f9718756e7a53b669c132532ba3844a5caf79`).
- `claude-design/design_handoff_node_room_transcript_steering/support.js` (SHA-256 `8fe7df74405f3c55f49b7249c74ea1397e65d07dea2b1bd3b4a489bec2e28cbe`).

### Unrelated alternatives and duplicate check

Other requirements, Architecture, Epic, and UX sets belong to source control, workflow run view, durable workflow runtime, workflow commander, or route loop routing targets.
Their frontmatter or path lineage does not select them for `agent-node-room`.
No required target document is missing, and no unresolved same-lineage duplicate exists.
**Step 1 selection:** proceed without a menu.

## Frozen Mockup Change Boundary

The following mockup-side inventory was copied from the validated manifest before assessment of planning-document claims.
The manifest is the sole source for mockup behavior in this report.

Current-scope changes are the TODO strip position on both rooms, the full-room shared queue disclosure and truthful accepted-queue label, per-item mid-turn Send now on true soft-inject providers, universal Run N occurrence headers, sender-free operator rows produced by accepted per-item Send now, and delivered status after evidence that the agent consumed the selected message. The approved HTML conflicts with user decisions on the queue label, operator name, and delivered gate; the static refusal of per-item send applies only to queue-only providers. Stored operator attribution remains intact.

**Classification evidence:**

- implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queue-list` — Current queues lack per-item Send now and disclosure.
- implementation: `packages/web/src/lib/occurrence-groups.ts#factsOf` — Current occurrence labels use Iteration N for loops.
- implementation: `packages/web/src/components/workflows/NodeRoom.tsx#OperatorHistory` — Current operator rows show sender names and stay sent.
- epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.5` — The completed strip position is above the transcript.
- epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed occurrence wording varies by context.
- epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.8` — The completed operator row shows a name and stays sent.

## Mockup Behavior Evidence Ledger

Each value and its evidence below comes from the validated manifest.
The comparison evidence records current implementation or tests and completed Epics.

### M001 — Console TODO strip placement and disclosure

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running prompt node`.
- Inventory IDs: I007; action key: `none`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** One collapsible TODO strip on the Console node room directly below the transcript and above the steering dock
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=todo-strip` — The TODO strip sits below the transcript and directly above the queue or dock.
- **Precondition:** The selected agent node has todo calls
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=todo-strip` — The selected running agent node has todo calls and a visible current todo item.
- **Action or trigger:** The selected node room renders or the operator toggles the strip
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#showTodoStrip` — The mockup enables the strip in the selected agent room.
- **Target identity:** The selected node todo strip
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=todo-strip` — The strip belongs to the selected implement node.
- **Target cardinality:** One strip for the selected node
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=todo-strip` — One strip appears for the selected node.
- **Timing:** Pinned and visible while the transcript scrolls
  - Evidence — annotation: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=D;todo` — The todo checklist is pinned while the transcript scrolls.
- **Effect on active work:** None; expanding the strip changes only its display
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#onToggleTodo` — The toggle only changes the strip open state; agent work is not changed.
- **Collection mutation:** None
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#onToggleTodo` — The toggle updates local disclosure state and does not alter a queue or transcript collection.
- **Expected result:** The current todo item and progress remain visible; expansion shows the checklist
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=todo-strip` — The collapsed strip shows the current item and 4/6 progress; expansion exposes checklist items.
- **Remaining or next state:** The strip is collapsed or expanded while the node keeps its agent sub-state
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#onToggleTodo` — The strip changes between collapsed and expanded while the selected node stays running.
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx#RoomRegion` — The current room mounts TodoStrip before the transcript scroller, above the transcript.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.5` — The completed Story describes the strip as pinned above the transcript; the mockup renders it below.

### M002 — Legacy TODO strip placement and disclosure

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `running prompt node`.
- Inventory IDs: I070; action key: `none`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** One collapsible TODO strip on the Legacy node room directly below the transcript and above the steering dock
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=todo-strip` — The TODO strip sits below the transcript and directly above the queue or dock.
- **Precondition:** The selected agent node has todo calls
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=todo-strip` — The selected running agent node has todo calls and a visible current todo item.
- **Action or trigger:** The selected node room renders or the operator toggles the strip
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#showTodoStrip` — The mockup enables the strip in the selected agent room.
- **Target identity:** The selected node todo strip
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=todo-strip` — The strip belongs to the selected implement node.
- **Target cardinality:** One strip for the selected node
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=todo-strip` — One strip appears for the selected node.
- **Timing:** Pinned and visible while the transcript scrolls
  - Evidence — annotation: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=D;todo` — The todo checklist is pinned while the transcript scrolls.
- **Effect on active work:** None; expanding the strip changes only its display
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#onToggleTodo` — The toggle only changes the strip open state; agent work is not changed.
- **Collection mutation:** None
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#onToggleTodo` — The toggle updates local disclosure state and does not alter a queue or transcript collection.
- **Expected result:** The current todo item and progress remain visible; expansion shows the checklist
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=todo-strip` — The collapsed strip shows the current item and 4/6 progress; expansion exposes checklist items.
- **Remaining or next state:** The strip is collapsed or expanded while the node keeps its agent sub-state
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#onToggleTodo` — The strip changes between collapsed and expanded while the selected node stays running.
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/components/workflows/NodeTranscriptPane.tsx#RoomRegion` — The current room mounts TodoStrip before the transcript scroller, above the transcript.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.5` — The completed Story describes the strip as pinned above the transcript; the mockup renders it below.

### M003 — Per-item Send now during generation

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent generating on soft-inject transport`.
- Inventory IDs: I009; action key: `send-queued-item-now`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** A Send now button on each queued item
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=queued-send-now` — Every queued item has a Send now button.
- **Precondition:** An agent is generating on a soft-inject transport with a queued item in the live iteration
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#canSendNow` — The code shows the button only with softInject, Queue mode, no Stop request in flight, and the live iteration selected.
- **Action or trigger:** The operator selects that queued item’s Send now button
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#draftItems.sendNow` — The per-item button calls that item’s sendNow handler.
- **Target identity:** The queued message beside the selected button
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#draftItems.sendNow` — The handler is attached to one mapped queued item whose accessible label contains its text.
- **Target cardinality:** Exactly one selected queued item.
  - Evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Timing:** Immediately upon provider acceptance during the running turn, without waiting for turn end.
  - Evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Effect on active work:** The active turn and tool call continue without interruption or a new turn.
  - Evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#stateNote=soft-inject` — The mockup note says this path does not interrupt the turn or current tool call.
- **Collection mutation:** Exactly the selected accepted item leaves the shared queue; other queued items remain.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Expected result:** The selected ordinary prompt enters the active turn immediately and appears as an operator transcript row without a sender name.
  - Evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Remaining or next state:** That item is absent from the queue; its transcript row reads sent until a matching lifecycle event or a response stream causally linked to that item proves agent consumption, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-stream-consumption` — khi agent nhận message, agent có stream lại mà, nếu harness không có thì phải dựa vào đó để biết delivery hay chưa
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queue-list` — The current queued-item JSX renders message text, sent, and Delete, but has no per-item Send now button.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.2` — The completed queue and withdraw stories define Queue and Delete, but no per-item soft-inject action.

### M004 — Per-item Send now during generation

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `agent generating on soft-inject transport`.
- Inventory IDs: I029; action key: `send-queued-item-now`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** A Send now button on each queued item
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=queued-send-now` — Every queued item has a Send now button.
- **Precondition:** An agent is generating on a soft-inject transport with a queued item in the live iteration
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#canSendNow` — The code shows the button only with softInject, Queue mode, no Stop request in flight, and the live iteration selected.
- **Action or trigger:** The operator selects that queued item’s Send now button
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#draftItems.sendNow` — The per-item button calls that item’s sendNow handler.
- **Target identity:** The queued message beside the selected button
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#draftItems.sendNow` — The handler is attached to one mapped queued item whose accessible label contains its text.
- **Target cardinality:** Exactly one selected queued item.
  - Evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Timing:** Immediately upon provider acceptance during the running turn, without waiting for turn end.
  - Evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Effect on active work:** The active turn and tool call continue without interruption or a new turn.
  - Evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#stateNote=soft-inject` — The mockup note says this path does not interrupt the turn or current tool call.
- **Collection mutation:** Exactly the selected accepted item leaves the shared queue; other queued items remain.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Expected result:** The selected ordinary prompt enters the active turn immediately and appears as an operator transcript row without a sender name.
  - Evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Remaining or next state:** That item is absent from the queue; its transcript row reads sent until a matching lifecycle event or a response stream causally linked to that item proves agent consumption, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-stream-consumption` — khi agent nhận message, agent có stream lại mà, nếu harness không có thì phải dựa vào đó để biết delivery hay chưa
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queue-list` — The current queued-item JSX renders message text, sent, and Delete, but has no per-item Send now button.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.2` — The completed queue and withdraw stories define Queue and Delete, but no per-item soft-inject action.

### M005 — Shared queued-message band and disclosure

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent generating with accepted queued guidance`.
- Inventory IDs: I008; action key: `toggle-shared-queue`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** A collapsible QUEUED count band below the transcript with ordered items, ordinals, and a next-out mark; accepted items have no this-tab-only label.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=queued-list` — The full room shows the QUEUED count, ordered rows, and a misleading this-tab-only label.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- **Precondition:** At least one accepted message is queued for the selected live node.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=queued-list` — Two queued items are visible.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- **Action or trigger:** The operator selects the queue disclosure header.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#handler=onToggleDraft` — The queue header invokes onToggleDraft.
- **Target identity:** The selected node's shared accepted-message queue band.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#handler=onToggleDraft` — The handler changes the draftOpen state used by the queued list.
- **Target cardinality:** One band for the selected node.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=queued-list` — One QUEUED band contains the accepted items.
- **Timing:** The band expands or collapses immediately when selected.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#handler=onToggleDraft` — The handler updates local draftOpen state directly.
- **Effect on active work:** None; disclosure changes only the queue display.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#handler=onToggleDraft` — The handler only toggles draftOpen.
- **Collection mutation:** None; opening or closing the band does not add, send, or delete a queued item.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#handler=onToggleDraft` — The handler only toggles draftOpen.
- **Expected result:** The operator can show or hide the accepted rows while their shared count and order remain available.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=queued-list` — The expanded band shows its accepted rows.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#handler=onToggleDraft` — The disclosure toggles row visibility.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- **Remaining or next state:** The shared queue band is expanded or collapsed; accepted messages remain shared across tabs and operators.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#handler=onToggleDraft` — The state changes only draftOpen.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx#queueBandHeader` — The current room shows a flat accepted-message band with sent and Delete, without mockup ordinals, next-out mark, or disclosure.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.1` — The completed story covers a shared QUEUED list and local unsent draft; it does not define the mockup disclosure and row treatment.

### M006 — Shared queued-message band and disclosure

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `agent generating with accepted queued guidance`.
- Inventory IDs: I028; action key: `toggle-shared-queue`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** A collapsible QUEUED count band below the transcript with ordered items, ordinals, and a next-out mark; accepted items have no this-tab-only label.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=queued-list` — The full room shows the QUEUED count, ordered rows, and a misleading this-tab-only label.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- **Precondition:** At least one accepted message is queued for the selected live node.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=queued-list` — Two queued items are visible.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- **Action or trigger:** The operator selects the queue disclosure header.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#handler=onToggleDraft` — The queue header invokes onToggleDraft.
- **Target identity:** The selected node's shared accepted-message queue band.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#handler=onToggleDraft` — The handler changes the draftOpen state used by the queued list.
- **Target cardinality:** One band for the selected node.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=queued-list` — One QUEUED band contains the accepted items.
- **Timing:** The band expands or collapses immediately when selected.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#handler=onToggleDraft` — The handler updates local draftOpen state directly.
- **Effect on active work:** None; disclosure changes only the queue display.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#handler=onToggleDraft` — The handler only toggles draftOpen.
- **Collection mutation:** None; opening or closing the band does not add, send, or delete a queued item.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#handler=onToggleDraft` — The handler only toggles draftOpen.
- **Expected result:** The operator can show or hide the accepted rows while their shared count and order remain available.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=queued-list` — The expanded band shows its accepted rows.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#handler=onToggleDraft` — The disclosure toggles row visibility.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- **Remaining or next state:** The shared queue band is expanded or collapsed; accepted messages remain shared across tabs and operators.
  - Evidence — interaction_code: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#handler=onToggleDraft` — The state changes only draftOpen.
  - Evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queueBandHeader` — The current room shows a flat accepted-message band with sent and Delete, without mockup ordinals, next-out mark, or disclosure.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.1` — The completed story covers a shared QUEUED list and local unsent draft; it does not define the mockup disclosure and row treatment.

### M007 — Run N occurrence separator

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `multi-occurrence node`.
- Inventory IDs: I052; action key: `none`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** Run 1, Run 2, and later Run N separators, with a contextual suffix such as retry or iteration when applicable.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=occurrence-options` — The first displayed variant shows Run 1, Run 2 · retry, and Run 3 · iteration 2.
  - Evidence — user_answer: `user_answer:coordinator-260924-occurrence` — For multi-occurrence transcript separators, use the first mockup variant universally: Run 1, Run 2, etc., with a contextual suffix such as retry or iteration when applicable; do not choose Pass N or reason-only as the primary header. A single occurrence has no separator.
- **Precondition:** The selected node has more than one occurrence.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=single-occurrence-note` — The sheet says separators appear only for more than one occurrence.
  - Evidence — user_answer: `user_answer:coordinator-260924-occurrence` — For multi-occurrence transcript separators, use the first mockup variant universally: Run 1, Run 2, etc., with a contextual suffix such as retry or iteration when applicable; do not choose Pass N or reason-only as the primary header. A single occurrence has no separator.
- **Action or trigger:** The transcript renders occurrence groups.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=occurrence-options` — The mockup renders separators between occurrence groups.
- **Target identity:** The selected node's transcript occurrence groups.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=occurrence-options` — The separators are shown in the occurrence-header section.
- **Target cardinality:** One separator per occurrence when there are multiple occurrences.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=occurrence-options` — The first variant renders a separator for each of three occurrences.
  - Evidence — user_answer: `user_answer:coordinator-260924-occurrence` — For multi-occurrence transcript separators, use the first mockup variant universally: Run 1, Run 2, etc., with a contextual suffix such as retry or iteration when applicable; do not choose Pass N or reason-only as the primary header. A single occurrence has no separator.
- **Timing:** When the multi-occurrence transcript is rendered.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=single-occurrence-note` — The sheet states the condition for rendering the headers.
- **Effect on active work:** None; the separator labels existing transcript history.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=occurrence-options` — The section presents read-only transcript headers.
- **Collection mutation:** None; displaying separators does not alter transcript rows.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=occurrence-options` — The section presents read-only transcript headers.
- **Expected result:** Each occurrence has a Run N header with the relevant suffix; Pass N and reason-only are not primary headers.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=occurrence-options` — The first variant shows numbered Run headers with retry or iteration suffixes.
  - Evidence — user_answer: `user_answer:coordinator-260924-occurrence` — For multi-occurrence transcript separators, use the first mockup variant universally: Run 1, Run 2, etc., with a contextual suffix such as retry or iteration when applicable; do not choose Pass N or reason-only as the primary header. A single occurrence has no separator.
- **Remaining or next state:** The multi-occurrence transcript remains grouped under Run N headers; a single occurrence has no separator.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=single-occurrence-note` — The sheet omits the header for one occurrence.
  - Evidence — user_answer: `user_answer:coordinator-260924-occurrence` — For multi-occurrence transcript separators, use the first mockup variant universally: Run 1, Run 2, etc., with a contextual suffix such as retry or iteration when applicable; do not choose Pass N or reason-only as the primary header. A single occurrence has no separator.
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/lib/occurrence-groups.ts#factsOf` — The current grouping labels loop occurrences Iteration N instead of a universal Run N header.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed story selects Run, Iteration, Pass, or reason-only by context; the user selected universal Run N with suffixes.

### M008 — Operator transcript row without sender name

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `operator exchange`.
- Inventory IDs: I063; action key: `none`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** An operator message row with full-strength text and a sent badge, without the sender's name.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#section=operator-record;element=operator-rows` — The approved static example shows operator · kevin and sent; the user changed only the name display.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Precondition:** One selected message is accepted by the provider and recorded in the transcript.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Action or trigger:** That accepted operator message renders in the transcript.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Target identity:** The transcript row for that selected stamped operator message.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Target cardinality:** Exactly one transcript row for the selected item.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Timing:** Immediately on provider acceptance.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Effect on active work:** None from the name display; stored attribution remains intact.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Collection mutation:** None from the visual name treatment; provider acceptance still removes the selected queue item and creates its operator transcript row.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Expected result:** The row shows the operator message and sent badge without the sender's name.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Remaining or next state:** The row remains sent until a matching lifecycle event or a response stream causally linked to that item proves agent consumption, then reads delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-stream-consumption` — khi agent nhận message, agent có stream lại mà, nếu harness không có thì phải dựa vào đó để biết delivery hay chưa
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/components/workflows/NodeRoom.tsx#OperatorHistory` — The current operator row includes operatorDisplayName in its label and a sent badge.
  - implementation: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx#OperatorHistory` — The Console row also includes operatorDisplayName in its label.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.8` — The completed story requires operator · <display name> and a sent badge; the user removed the visible name only.

### M009 — Delivered operator-message status

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `message status after provider confirmation`.
- Inventory IDs: I068; action key: `none`; classification: `CHANGE_FEATURE`; manifest status: `PROVEN`.
- **Visible presentation:** A delivered badge on the matching operator message row.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#section=status;element=delivered` — The status examples render a delivered badge.
  - Evidence — user_answer: `user_answer:coordinator-260924-delivery` — Delivered is current scope, not future; any SDK update needed for confirmation is an implementation prerequisite.
- **Precondition:** The selected operator transcript row is sent and agent consumption can be established for that message.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-delivery` — Delivered is current scope, not future; any SDK update needed for confirmation is an implementation prerequisite.
  - Evidence — user_answer: `user_answer:coordinator-260924-stream-consumption` — khi agent nhận message, agent có stream lại mà, nếu harness không có thì phải dựa vào đó để biết delivery hay chưa
- **Action or trigger:** A matching provider lifecycle event or a response stream causally linked to the selected message proves that the agent consumed it.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-stream-consumption` — khi agent nhận message, agent có stream lại mà, nếu harness không có thì phải dựa vào đó để biết delivery hay chưa
- **Target identity:** The operator transcript row with that matching stamped message_id.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Target cardinality:** Exactly one matching operator message row.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Timing:** After evidence that the agent consumed the selected message, not merely after transport acceptance or unrelated stream output.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-stream-consumption` — khi agent nhận message, agent có stream lại mà, nếu harness không có thì phải dựa vào đó để biết delivery hay chưa
- **Effect on active work:** None; confirmation updates the displayed delivery status.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Collection mutation:** None; the row stays in the transcript and only its status changes.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
- **Expected result:** The matching row changes from sent to delivered.
  - Evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#section=status;element=delivered` — The sheet shows the delivered status example.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-delivery` — Delivered is current scope, not future; any SDK update needed for confirmation is an implementation prerequisite.
- **Remaining or next state:** The matching operator row reads delivered; unconfirmed rows continue to read sent.
  - Evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.
  - Evidence — user_answer: `user_answer:coordinator-260924-delivery` — Delivered is current scope, not future; any SDK update needed for confirmation is an implementation prerequisite.
- **Current product and completed Epic classification evidence:**
  - implementation: `packages/web/src/components/workflows/NodeRoom.tsx#OperatorHistory` — The current row always renders sent and has no confirmation transition.
  - implementation: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx#OperatorHistory` — The Console row always renders sent and has no confirmation transition.
  - epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.8` — The completed story leaves every v1 provider row at sent; its later delivered transition is not part of that completed baseline.

## Context Inventory

Each item is current behavior shown in an approved mockup and already present in the product and a completed Epic.
These items do not need new target requirements.

### C001 — Run shell, Running status, and separate Cancel control

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I001.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/experiments/console/routes/RunDetailPage.tsx#RunDetailPage` — The current product implements run shell, running status, and separate cancel control on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#Epic-5` — The completed Epic records the existing run shell, running status, and separate cancel control contract.

### C002 — Log, Graph, Artifacts, Tool calls, and System controls

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I002.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/experiments/console/routes/RunDetailPage.tsx#RunDetailPage` — The current product implements log, graph, artifacts, tool calls, and system controls on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#Epic-5` — The completed Epic records the existing log, graph, artifacts, tool calls, and system controls contract.

### C003 — Node log with completed, running, and pending steps

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I003.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx#ConsoleNodeRoom` — The current product implements node log with completed, running, and pending steps on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#Epic-5` — The completed Epic records the existing node log with completed, running, and pending steps contract.

### C004 — Selected implement node transcript and close control

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I004.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx#ConsoleRoomHeader` — The current product implements selected implement node transcript and close control on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#Epic-5` — The completed Epic records the existing selected implement node transcript and close control contract.

### C005 — Assistant text and tool calls grouped by run

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I005.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx#ConsoleAgentHistoryList` — The current product implements assistant text and tool calls grouped by run on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing assistant text and tool calls grouped by run contract.

### C006 — Expandable tool row and Raw control

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I006.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx#ToolHistory` — The current product implements expandable tool row and raw control on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing expandable tool row and raw control contract.

### C010 — Per-item Delete controls

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent generating`; inventory IDs: I010.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queue-list` — The current product implements per-item delete controls on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.2` — The completed Epic records the existing per-item delete controls contract.

### C011 — Message composer and Queue control

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent generating`; inventory IDs: I011.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#composer` — The current product implements message composer and queue control on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing message composer and queue control contract.

### C012 — Stop current agent turn

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent generating`; inventory IDs: I012.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#stop` — The current product implements stop current agent turn on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing stop current agent turn contract.

### C013 — Stopping transient while node remains running

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent interrupting`; inventory IDs: I013.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#interrupting` — The current product implements stopping transient while node remains running on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing stopping transient while node remains running contract.

### C014 — Will send queue and Send now control

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent idle after interrupt`; inventory IDs: I014.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#idle` — The current product implements will send queue and send now control on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing will send queue and send now control contract.

### C015 — Interrupted tool glyph and retained-file disclosure

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent idle after interrupt`; inventory IDs: I015.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#STEERING_INTERRUPT_DISCLOSURE` — The current product implements interrupted tool glyph and retained-file disclosure on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing interrupted tool glyph and retained-file disclosure contract.

### C016 — Operator messages in transcript and active work resumes

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `agent generating again`; inventory IDs: I016.
- Classification: `UNCHANGED_CONTEXT`; reason: The Console transcript already records operator messages in sequence and resumes generation; M008 separately records the user-selected removal of the visible sender name.
- Evidence — implementation: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx#OperatorHistory` — The current product implements operator messages in transcript and active work resumes on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.8` — The completed Epic records the existing operator messages in transcript and active work resumes contract.

### C017 — Read-only Never sent draft list

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `completed node with undelivered messages`; inventory IDs: I017.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#finished` — The current product implements read-only never sent draft list on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing read-only never sent draft list contract.

### C018 — No steering dock

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `completed clean node`; inventory IDs: I018.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#steeringDockMode` — The current product implements no steering dock on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing no steering dock contract.

### C019 — Failed 30-minute state and Never sent drafts

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `failed after idle interrupt`; inventory IDs: I019.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#neverSentDisclosure` — The current product implements failed 30-minute state and never sent drafts on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing failed 30-minute state and never sent drafts contract.

### C020 — Not steerable disclosure without composer

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `detached running node`; inventory IDs: I020.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#STEERING_DETACHED_DISCLOSURE` — The current product implements not steerable disclosure without composer on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing not steerable disclosure without composer contract.

### C021 — Per-iteration log entries and Execution selector

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running loop node`; inventory IDs: I021.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx#ConsoleRoomHeader` — The current product implements per-iteration log entries and execution selector on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed Epic records the existing per-iteration log entries and execution selector contract.

### C022 — Read-only old iteration and Go to live iteration

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `finished loop iteration selected`; inventory IDs: I022.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#finished-iteration` — The current product implements read-only old iteration and go to live iteration on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed Epic records the existing read-only old iteration and go to live iteration contract.

### C023 — Per-item Send now absent

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html`, rendered state: `running queue-only provider`; inventory IDs: I023.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queue-list` — The current product implements per-item send now absent on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing per-item send now absent contract.

### C024 — Legacy run shell, status, Cancel, and tabs

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I024.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/WorkflowExecution.tsx#WorkflowExecution` — The current product implements legacy run shell, status, cancel, and tabs on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#Epic-5` — The completed Epic records the existing legacy run shell, status, cancel, and tabs contract.

### C025 — Legacy node list with two implement runs

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I025.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/WorkflowExecution.tsx#buildLogRows` — The current product implements legacy node list with two implement runs on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed Epic records the existing legacy node list with two implement runs contract.

### C026 — Selected implement transcript and Execution selector

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I026.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoomHeader.tsx#NodeRoomHeader` — The current product implements selected implement transcript and execution selector on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed Epic records the existing selected implement transcript and execution selector contract.

### C027 — Expandable tool rows and Raw output

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `running prompt node`; inventory IDs: I027.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#ToolHistory` — The current product implements expandable tool rows and raw output on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing expandable tool rows and raw output contract.

### C030 — Stopping transient

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `agent interrupting`; inventory IDs: I030.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#interrupting` — The current product implements stopping transient on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing stopping transient contract.

### C031 — Will send and Send now with interrupted tool

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `agent idle after interrupt`; inventory IDs: I031.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#idle` — The current product implements will send and send now with interrupted tool on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing will send and send now with interrupted tool contract.

### C032 — Operator correction in transcript

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `agent generating again`; inventory IDs: I032.
- Classification: `UNCHANGED_CONTEXT`; reason: The Legacy transcript already records operator correction in sequence; M008 separately records the user-selected removal of the visible sender name.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#OperatorHistory` — The current product implements operator correction in transcript on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.8` — The completed Epic records the existing operator correction in transcript contract.

### C033 — Read-only Never sent list

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `completed with undelivered messages`; inventory IDs: I033.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#finished` — The current product implements read-only never sent list on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing read-only never sent list contract.

### C034 — No steering dock

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `completed clean node`; inventory IDs: I034.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#steeringDockMode` — The current product implements no steering dock on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing no steering dock contract.

### C035 — Failure and Never sent list

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `failed after idle interrupt`; inventory IDs: I035.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#neverSentDisclosure` — The current product implements failure and never sent list on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing failure and never sent list contract.

### C036 — Not steerable disclosure

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `detached running node`; inventory IDs: I036.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#STEERING_DETACHED_DISCLOSURE` — The current product implements not steerable disclosure on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing not steerable disclosure contract.

### C037 — Iteration selector and per-iteration entries

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `running loop node`; inventory IDs: I037.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoomHeader.tsx#NodeRoomHeader` — The current product implements iteration selector and per-iteration entries on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed Epic records the existing iteration selector and per-iteration entries contract.

### C038 — Read-only earlier iteration and live navigation

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `finished loop iteration selected`; inventory IDs: I038.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#finished-iteration` — The current product implements read-only earlier iteration and live navigation on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed Epic records the existing read-only earlier iteration and live navigation contract.

### C039 — Per-item Send now absent

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `running queue-only provider`; inventory IDs: I039.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queue-list` — The current product implements per-item send now absent on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing per-item send now absent contract.

### C040 — Tool name chips use family colour

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `tool family palette`; inventory IDs: I040.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#CHIP_TONE` — The current product implements tool name chips use family colour on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing tool name chips use family colour contract.

### C041 — Five status glyphs

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `tool status key`; inventory IDs: I041.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/tool-presentation.ts#OUTCOME_GLYPH` — The current product implements five status glyphs on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing five status glyphs contract.

### C042 — Family-specific one-line summaries

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `collapsed tool rows`; inventory IDs: I042.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/tool-presentation.ts#toolRowPresentation` — The current product implements family-specific one-line summaries on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing family-specific one-line summaries contract.

### C043 — Middle-elided path preserves filename

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `collapsed long path`; inventory IDs: I043.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#ToolHeadline` — The current product implements middle-elided path preserves filename on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing middle-elided path preserves filename contract.

### C044 — Multiline script headline and shell fallback chip

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `collapsed Codex shell row`; inventory IDs: I044.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/tool-presentation.ts#shellHeadline` — The current product implements multiline script headline and shell fallback chip on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing multiline script headline and shell fallback chip contract.

### C045 — Server and tool headline

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `collapsed MCP row`; inventory IDs: I045.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/tool-presentation.ts#mcpLabel` — The current product implements server and tool headline on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing server and tool headline contract.

### C046 — Generic scalar summary

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `collapsed unknown tool row`; inventory IDs: I046.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/tool-presentation.ts#genericFacts` — The current product implements generic scalar summary on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing generic scalar summary contract.

### C047 — Terminal output body and Raw control

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `expanded shell row`; inventory IDs: I047.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#ToolBodySwitch` — The current product implements terminal output body and raw control on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing terminal output body and raw control contract.

### C048 — Inline edit diff body

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `expanded file row`; inventory IDs: I048.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#InlineDiff` — The current product implements inline edit diff body on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing inline edit diff body contract.

### C049 — Family-specific bodies

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `expanded web, search, glob, and code rows`; inventory IDs: I049.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#ToolBodySwitch` — The current product implements family-specific bodies on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing family-specific bodies contract.

### C050 — Folded latest checklist and earlier call summaries

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `expanded todo row`; inventory IDs: I050.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeTranscriptPane.tsx#TodoStrip` — The current product implements folded latest checklist and earlier call summaries on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.5` — The completed Epic records the existing folded latest checklist and earlier call summaries contract.

### C051 — Batch and single-agent dispatch bodies

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `expanded task row`; inventory IDs: I051.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#TaskBody` — The current product implements batch and single-agent dispatch bodies on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing batch and single-agent dispatch bodies contract.

### C053 — No occurrence header

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `single-occurrence node`; inventory IDs: I053.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/occurrence-groups.ts#groupByOccurrence` — The current product implements no occurrence header on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.7` — The completed Epic records the existing no occurrence header contract.

### C054 — Raw JSON toggle

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html`, rendered state: `expanded tool row`; inventory IDs: I054.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#ToolHistory` — The current product implements raw json toggle on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — The completed Epic records the existing raw json toggle contract.

### C055 — Composer, Queue, and Stop beneath transcript

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `agent generating`; inventory IDs: I055.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#composer` — The current product implements composer, queue, and stop beneath transcript on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing composer, queue, and stop beneath transcript contract.

### C056 — Stopping transient and Queue

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `agent interrupting`; inventory IDs: I056.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#interrupting` — The current product implements stopping transient and queue on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing stopping transient and queue contract.

### C057 — Will send, Send now, and retained-file disclosure

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `agent idle after interrupt`; inventory IDs: I057.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#idle` — The current product implements will send, send now, and retained-file disclosure on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing will send, send now, and retained-file disclosure contract.

### C058 — Resume with Stop and Queue

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `agent generating again`; inventory IDs: I058.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#composer` — The current product implements resume with stop and queue on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing resume with stop and queue contract.

### C059 — Read-only Never sent state

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `completed with undelivered messages`; inventory IDs: I059.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#finished` — The current product implements read-only never sent state on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing read-only never sent state contract.

### C060 — No dock

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `completed clean node`; inventory IDs: I060.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#steeringDockMode` — The current product implements no dock on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing no dock contract.

### C061 — Failure and Never sent state

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `failed after 30-minute idle`; inventory IDs: I061.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#neverSentDisclosure` — The current product implements failure and never sent state on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing failure and never sent state contract.

### C062 — Not steerable disclosure

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `detached running node`; inventory IDs: I062.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#STEERING_DETACHED_DISCLOSURE` — The current product implements not steerable disclosure on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing not steerable disclosure contract.

### C064 — Sent message status example

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `message statuses`; inventory IDs: I064.
- Classification: `UNCHANGED_CONTEXT`; reason: The sent badge remains the unconfirmed operator-message state; M009 separately records the delivered transition after evidence that the agent consumed that message.
- Evidence — implementation: `packages/web/src/components/workflows/NodeRoom.tsx#OperatorHistory` — The current product implements sent message status example on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.8` — The completed Epic records the existing sent message status example contract.

### C066 — No Enter-to-send shortcut

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `running agent`; inventory IDs: I066.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/lib/steering-dock.ts#isQueueShortcut` — The current product implements no enter-to-send shortcut on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.1-2.7` — The completed Epic records the existing no enter-to-send shortcut contract.

### C067 — Per-item Delete control

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html`, rendered state: `agent generating`; inventory IDs: I067.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queue-list` — The current product implements per-item delete control on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.2` — The completed Epic records the existing per-item delete control contract.

### C069 — Never sent message status example

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `message status example`; inventory IDs: I069.
- Classification: `UNCHANGED_CONTEXT`; reason: The completed product already presents this control or state with the same operator-visible purpose.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#finished` — The current product implements never sent message status example on this surface.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.11-2.12` — The completed Epic records the existing never sent message status example contract.

### C065 — Per-item send absent for a queue-only provider

- Mockup: `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, rendered state: `refused-actions table`; inventory IDs: I065.
- Classification: `UNCHANGED_CONTEXT`; reason: The current queue-only path has no per-item send. The static sheet refuses this action generally, but the user limits the refusal to queue-only providers and approves it for true soft-inject providers.
- Evidence — implementation: `packages/web/src/components/workflows/ComposerDock.tsx#queue-list` — The current queued list offers Delete but no per-item Send now, including queue-only operation.
- Evidence — epic: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.1` — The completed queue story provides Queue and a queued list, without a per-item action.

## Action Identity Audit: Frozen Manifest

These groups preserve the manifest decisions before planning-document mapping.

### send-queued-item-now

- Feature IDs: M003, M004; manifest outcome: `SAME_ACTION`.
- Recorded differences: none.
- Decision evidence — user_answer: `user_answer:coordinator-260924-send` — Per-item Send now during generation is current for a provider that can truly soft-inject mid-turn. It sends exactly the selected queued item immediately into the active turn, without waiting for the turn to end or interrupting work; queue-only providers do not show this per-item action.
- Decision evidence — user_answer: `user_answer:coordinator-260924-receipt` — On provider acceptance, exactly that selected item leaves the queue and appears immediately in the transcript as an operator message. Do NOT show the sender's name on that transcript row. This is a visual decision only; the user did not authorize removing stored attribution. Show sent until the provider confirms the same stamped message_id, then delivered.

### toggle-shared-queue

- Feature IDs: M005, M006; manifest outcome: `SAME_ACTION`.
- Recorded differences: none.
- Decision evidence — user_answer: `user_answer:coordinator-260924-queue` — Once Queue accepts a message, the queue is shared across tabs/operators. Only text still typed but not submitted is this-tab-only. The this-tab-only label beside QUEUED 2 in the mockup is misleading; record the conflict, do not infer a tab-local accepted queue.
- Decision evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#handler=onToggleDraft` — Console disclosure toggles its accepted-list display.
- Decision evidence — rendered: `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#handler=onToggleDraft` — Legacy disclosure toggles its accepted-list display.

## Workflow Sequence

- Step 1 completed and saved.
- Further steps will be recorded after each is completed.

## PRD Analysis

**Canonical requirements source:** `_bmad-output/specs/spec-agent-node-room/SPEC.md`.
The canonical SPEC defines capabilities `CAP-1` through `CAP-13`; it has no native FR or NFR numbering.
The FR numbers below are report trace IDs for those complete capability clauses.

### Functional Requirements Extracted

#### FR1 — CAP-1

- **CAP-1** — Scan a node's work without expanding anything
  - **intent:** A reader can scan a node's tool calls one line each and tell what ran, what it ran on, and whether it worked.
  - **success:** A node with forty tool calls renders forty single-line rows, each carrying a family chip, a status glyph, a headline naming the salient argument, and right-aligned badges.
    Successful calls are collapsed on first render and failed calls are expanded.
    No collapsed row contains serialized-data punctuation.

#### FR2 — CAP-2

- **CAP-2** — Expand a call into a body shaped for that kind of tool
  - **intent:** A reader can open any tool call and see its input and output rendered for the kind of tool it is.
  - **success:** Every family renders its declared body arm per `tool-presentation-contract.md`.
    A tool matching no family renders at most three scalar `key: value` pairs, with objects and arrays collapsed to `{…}` / `[n]`, and never a JSON dump.
    Measured against the production corpus, the generic fallback claims under 2% of rows.

#### FR3 — CAP-3

- **CAP-3** — Follow the agent's checklist as state, not as mutations
  - **intent:** A reader can see the agent's current todo list, with phases and per-item status, instead of a sequence of opaque updates.
  - **success:** Both provider shapes normalize to the same `TodoPhase[]` per `todo-fold-contract.md`.
    Every todo call in the transcript collapses to a one-line row; the current checklist lives only in the pinned todo strip, not inline in the transcript.
    A phase emptied by `rm` disappears rather than rendering an empty header.
    The **pinned todo strip** is after the transcript and immediately above the queue or dock, stays visible while transcript rows scroll, and is absent when the node has no todos.
    Its collapsed header shows the current item, completed count, and segmented meter.
    Its expanded state shows phases and items and exposes Raw.
    Terminal presentation marks remaining items done when the node completes and resets the current item to todo after the 30-minute interruption failure, without changing stored provider rows.

#### FR4 — CAP-4

- **CAP-4** — See what a subagent dispatch asked for
  - **intent:** A reader can see the brief a task dispatch carried and which subtasks it spawned.
  - **success:** Both provider shapes normalize to `TaskSubtask[]`.
    The card renders batch context as markdown when the provider sends any, then one collapsible card per subtask naming the subtask and its agent.

#### FR5 — CAP-5

- **CAP-5** — See what a file edit changed
  - **intent:** A reader can see the actual change a file edit made, inline, without leaving the transcript.
  - **success:** When the payload carries both before and after content, a line diff renders through `react-diff-view`.
    Claude always qualifies — `FileEditInput` declares `old_string` and `new_string` as required.
    Any persisted file tool row without both before/after string sides falls back to path plus preview, and a diff is never fabricated from one side.
    Scope is presentation over persisted rows only: current Codex `file_change` events are emitted as `system` chunks (`codex/provider.ts:709`) that the executor debug-logs as `dag.system_message_unhandled` (`dag-executor.ts:2691-2748`) instead of appending them to the node transcript, so they never become persisted file rows and are explicitly excluded here.
    Making successful Codex file changes visible in the transcript is separately tracked work.
  - **data contract:** `packages/web/src/lib/diff-hunks.ts` is the only `structuredPatch` caller, on `diff@9.0.0` — deterministic bounds (65,536-byte and 2,000-line side caps, `context: 4`, `maxEditLength: 2000`, no wall-clock timeout) and dual-bounded memoization (256 entries capped at 1,048,576 source code units).
    `tool-presentation.ts` qualifies a pair only after the family resolves to `file`, only as own-property strings (`''` valid; inherited keys, throwing accessors, one-sided, and wrong types never qualify), and caches the result per input record in a `WeakMap` so summary and body compute once.
    Collapsed rows carry `+n`/`−m` badges; expanded rows carry `N hunk(s)` or `no changes` plus `replace_all` when the input sends it as an own boolean.
    Line content is display-sanitised — ANSI/C0/C1 stripped, `Cf`/`U+2028`/`U+2029` escaped as `\u{HEX}`, 1,024-code-unit ceiling — while diffing runs on raw strings and Raw keeps the original payload.
    Refused, identical, and non-qualifying pairs degrade honestly; a failed edit still shows its attempted diff alongside the normalized failure output.

#### FR6 — CAP-6

- **CAP-6** — Tell attempts and loop iterations apart
  - **intent:** A reader can tell which attempt or loop iteration produced a given tool call.
  - **success:** A node whose rows span more than one `occurrence_id` renders a header per group; a single-occurrence node renders none.
    Grouping keys on `occurrence_id`, never on `attempt_id`.
    Every group header uses primary `Run N` in occurrence order; loop iteration, provider pass, retry, and interruption context follows as a suffix when relevant.
    A **loop-iteration selector** lets the reader navigate directly between occurrence groups; the per-group headers remain its targets, and it is absent on a single-occurrence node.
    On a live loop node, selecting a **finished** iteration through the **`Execution` selection controls** (header select, Logs row, or graph occurrence; `Jump to` stays scroll-only) renders a read-only dock, a `Go to iteration N` control, and a read-only band that mirrors the node-scoped shared pending queue across operators and tabs.
    The composer and steering actions are absent in this view.
    Every steering mutation carries the selected `retry_epoch`, and the server fails closed when that epoch is stale, so a delayed or replayed mutation from a finished iteration cannot affect the live iteration.
    The authenticated node-scoped `GET …/queue` read is allowed so the band stays current.

#### FR7 — CAP-7

- **CAP-7** — Keep the raw payload reachable
  - **intent:** A developer debugging a provider can still read the exact bytes the provider sent.
  - **success:** Every card exposes a Raw toggle revealing the original JSON, closed by default.
    This is the **only** place serialized JSON appears.
    Today's `canLoadFullOutput` / `onLoadFullOutput` flow keeps working.

### Write — steer the live agent

#### FR8 — CAP-8

- **CAP-8** — Compose while the agent works
  - **intent:** An operator watching a running node can write a message without disturbing it.
  - **success:** The composer is mounted and enabled while the node runs, and the send control reads `Queue`.
    Sending holds the message; the node is untouched, no tool call is interrupted and nothing is lost.
    The message is delivered as the next turn when the current turn ends naturally.
    The words `this tab only` apply only to unsent composer draft content, including when that draft shares one combined surface with queued items.
    A queued message is node-scoped, shared across operators and tabs, and server-process-local; it survives a tab close and dies only on a server restart.

#### FR9 — CAP-9

- **CAP-9** — Interrupt the agent's thinking; the node keeps running
  - **intent:** An operator can stop the agent's _current generation_ to redirect it, without stopping the node or abandoning the run.
  - **success:** An interrupt control in the node's composer dock ends the agent's **current turn** — via the provider's own primitive (claude `interrupt()`) or a stream-abort — and the **provider session stays alive**.
    The **node stays `running`** throughout (its agent moves to a projected `idle-after-interrupt` sub-state) — never paused, never `pending`, never `node_failed`.
    The transcript shows the in-flight tool call as _interrupted_ rather than _failed_ (this is CAP-1's status glyph `⚠`).
    Interrupting the agent is **not** stopping the node: that is the existing **Cancel** feature, separate and untouched.
    Nothing suggests the interrupt undid work already written.

#### FR10 — CAP-10

- **CAP-10** — Redirect and continue on the same live session
  - **intent:** After interrupting, the operator sends what to do instead and the agent carries on from there — on the same session, in the same node.
  - **success:** Once the agent is `idle-after-interrupt`, the send control reads `Send now`.
    Sending dispatches the newly typed message (the queued messages are already on the registry); the executor then flushes the registry — the already-queued messages followed by this one, **in receipt/written order** — as the **next turn on the same provider session** (reusing the `attemptResumeId` re-ask seam).
    The node **continues** — it never "resumes" from a pause, because it never paused.
    Ordering is enforced by us, not assumed of the provider.
    Both controls follow the agent's projected sub-state, not a remembered mode.

#### FR11 — CAP-11

- **CAP-11** — The exchange is part of the record
  - **intent:** Anyone reading the transcript afterwards can see what the operator said, and when, relative to what the agent did.
  - **success:** The operator's messages and the interrupted tool call appear as ordinary transcript rows in the order they happened — between the call they interrupted and the one they caused.
    An operator row is visibly the operator's, never mistakable for the agent's own text.
    _This is where the write half writes into the read half — see Cross-half dependency._

#### FR12 — CAP-12

- **CAP-12** — Mid-turn delivery, as fast as each provider's transport allows
  - **intent:** The operator's message reaches a running agent without interrupting it, and sooner on a provider whose transport can take it mid-turn.
  - **success:** Sending to a running agent is an **ordinary prompt**, not a separate steer primitive.
    `Queue` remains available on every provider and delivers at the next natural boundary without an interrupt.
    Per-item `Send now` appears only while the agent generates on an Archon transport proven to accept live input.
    Selecting it sends exactly that queued item into the active turn without Stop, a natural-end wait, an interrupted tool call, or another turn.
    On provider transport acceptance, only that item leaves the shared queue and appears immediately as an operator transcript row with `sent` and no visible sender name.
    A queue-only mode omits the per-item action; a direct unsupported request returns a typed refusal without changing the queue.
    Claude streaming input, OMP RPC, and a new Grok live-input path must pass current release proof gates G2, G4, and G3 respectively.
    G3 requires Grok per-item Send now during the active agent turn in this release, including causal proof that the agent received the selected item.
    An advertised hook is a candidate mechanism, not proof of this behavior.
    Archon's current Grok `--single` path is queue-only.

#### FR13 — CAP-13

- **CAP-13** — The interface claims only what it knows
  - **intent:** An operator can tell whether a message merely left the browser or actually reached the agent.
  - **success:** A queued receipt remains `queued`; only provider acceptance into the active turn changes the selected item to `sent` and creates its single transcript row.
    The row changes to `delivered` only when a matching native lifecycle event or a stream causally tied to that item proves agent consumption.
    An RPC acknowledgement, unrelated ongoing stream, text match, or timestamp does not prove consumption.
    The caller-stamped `message_id` stays the row and idempotency key; an echoed id is sufficient but is not the only valid proof.
    G1 is a current release proof and implementation gate, and an unconfirmed accepted row stays `sent`.

**Total FRs:** 13.

### Non-Functional Requirements Extracted

The SPEC has no numbered NFR section.
The following report IDs index its explicit quality and safety constraints; the full source constraints follow below.

1. **NFR1 — Type and validation quality.** Strict TypeScript, no unjustified `any`, zero ESLint warnings, and `bun run validate` before a PR (`SPEC.md`, Shared constraints).
2. **NFR2 — Accessible status.** A glyph character must convey tool status without color (`SPEC.md`, Read-half constraints).
3. **NFR3 — Honest bounded display.** Serialized JSON is hidden by default, unknown assistant text keeps its original bytes, and a tool name is shown only when it is one token of at most 24 characters (`SPEC.md`, Read-half constraints).
4. **NFR4 — Safe live lifecycle.** Steering uses a per-turn signal, leaves the node running, and never mistakes an interrupted partial result for completion or failure (`SPEC.md`, Write-half constraints).
5. **NFR5 — Process-bound ownership.** Live steering state remains in process, detached runs report unavailable, and a server restart does not cause autonomous mutation of an ambiguous non-terminal run (`SPEC.md`, Write-half constraints).
6. **NFR6 — Authorized, fenced mutations.** The send and interrupt routes resolve an authenticated actor, attribute the sender, and reject stale `retry_epoch` values without state change (`SPEC.md`, Write-half constraints).
7. **NFR7 — Idempotent and causally truthful delivery.** A selected `message_id` yields one send and one transcript row; provider acceptance alone gives `sent`, while `delivered` requires causal consumption evidence (`SPEC.md`, Write-half constraints).
8. **NFR8 — Idle recovery.** An interrupted idle node fails after 30 minutes of true inactivity, with authorized composing activity re-arming the timer and one winner among send, cancel, and timeout (`SPEC.md`, Write-half constraints).
9. **NFR9 — Deterministic bounded rendering.** Inline diff and expanded tool bodies obey the fixed byte, line, item, and display bounds in the companion `tool-presentation-contract.md` (`SPEC.md`, CAP-5; companion, Bounded output contract and Inline diff).
10. **NFR10 — Retroactive read behavior.** The read half requires no schema change, migration, or backend change and improves stored historical runs from existing rows (`SPEC.md`, Why and Read-half constraints).

**Total report-indexed NFRs:** 10.

### Additional Requirements and Constraints

The complete canonical constraint, dependency, and non-goal text follows.
This preserves requirements that are functional or technical but do not carry a CAP or NFR identifier.

#### Canonical SPEC constraints and dependencies

## Constraints

### Shared — both halves land in `packages/web`

- `@archon/web` must **not** import from `@archon/workflows`; wire types come from `api.generated.d.ts` through `lib/api.ts`.
- **Console must not import from `@/components/`.**
  Shared logic lands in `packages/web/src/lib/` and the JSX is written twice, thin — duplicating a little JSX for a surface scheduled for deletion beats refactoring code on its way out.
- Both node rooms (Legacy + Console) ship **together**, on the owner's explicit and re-confirmed decision, even though Legacy is scheduled for deletion and Console is the default route.
- Strict TypeScript, no unjustified `any`, ESLint at zero warnings.
  `bun run validate` is the pre-PR gate.
- Code comments and test names carry **no** plan/section/finding references — comments explain the invariant.

### Read half

- Ships **no schema change, no migration, and no backend change.**
  Anything that would need new persisted data is out of scope by definition — that is the line that keeps it retroactive.
- **Serialized JSON is never a default presentation, and unclassifiable assistant text fails closed to its original bytes.**
  Tool payloads keep CAP-7's explicit Raw affordance — that toggle remains the only place tool input/output JSON appears.
  Assistant text is classified losslessly or left alone: when the matched definition node's `output_format` is an object schema declaring exactly one `type: 'string'` property and the stored text is the canonical serialization of that one-key envelope, the transcript renders the envelope's string value through the existing Markdown path; every other shape — absent or ineligible schema, malformed or non-canonical text — renders the original bytes unchanged.
  The shared `buildAgentHistory()` projector applies this rule with the schema forwarded by the three production surfaces — `LegacyNodeRoom` via `NodeTranscriptPane`, `ConsoleNodeRoom`, and `ConsoleInspectPane` via `ConsoleExecutionHistory`.
  Stored rows, API output, and the engine's structured result are never mutated.
- Status must be decodable **without colour** — a glyph character carries it, colour only reinforces.
- A chip shows the tool name only when that name is **a single token of at most 24 characters**; otherwise it shows the **family name**.
  The 24-character cap is the guard behind the rule, never an instruction to truncate with an ellipsis.
- Tool identification **duck-types over alias sets**; no name-keyed mapping table.
  Match **exact tokens, never substrings** (`search_replace` is an edit, not a search).
- **Provider shape differences are normalized at the edge, never branched on in a renderer.**
  A small normalizer in `lib/` converts each provider shape to one shared shape; `ToolPresentation` stays render-neutral and neither renderer learns a provider name.
- Path headlines elide in the **middle**; commands and patterns elide at the **end**.

### Write half

- **Current release scope.**
  G1 truthful delivery, G2 Claude soft-inject, G3 Grok live-turn delivery, and G4 OMP soft-inject are current release proof and implementation gates.
  The candidate Archon paths are not proven by an SDK feature or another product's adapter.
  Grok must support per-item Send now during an active turn in this release through a path proved in Archon.
  Its current `--single` adapter remains queue-only and omits the action until a separate path proves same-turn acceptance and causal agent receipt.
  The universal interrupt plus `Queue` path remains available on every provider.
- **Steering acts on the live agent, never on the node lifecycle.**
  _Send_ and _interrupt_ both operate on the running node's **live provider session**.
  The node stays `running` throughout — no pause, no `pending`, no resume, no `node_failed`.
  There is **no durable steering state**: no marker, no phase, no CAS, no attempt-key.
  Stopping the whole node is the existing **Cancel**/abort path, out of scope and untouched.
- **Interrupt is the provider's own primitive (or a stream-abort) on a per-turn signal, never the node-level one.**
  The executor's `nodeAbortController` (`dag-executor.ts:2209`) is **one-shot and Cancel's** (its `:3124` check fails the node; the re-ask loop stops on it, `:3032`).
  Steering interrupts through a **fresh per-turn signal** combined with the node-level one (`AbortSignal.any`), so each new turn gets a fresh signal — which is what lets the node run multiple turns and never trips `:3124`.
  `operatorInterrupt` is a **per-turn flag resolved by placement** in the existing flow (`stream → validation → canReask :3032 → :3124 Cancel check → completion`): `canReask` must also stop on it; validation is skipped on an interrupted turn; its branch sits immediately after the `:3124` Cancel check so Cancel dominates by position; it is reset at turn N+1.
  **End cause** is a five-case rule the executor resolves, not result-presence alone: a `result` with no abort marker is a natural end; a `result` carrying an abort marker (DeepSeek `stopReason:'aborted'`) or a thrown abort (OMP `Query aborted`) with `operatorInterrupt` set is an **interrupted end** into idle-await, never `node_failed`; a throw without the flag is a real failure; Cancel dominates by position.
  The executor classifies the abort-marked `result` and the abort throw — the provider adapter never suppresses them.
  This applies on both `executeNodeInternal` and `executeLoopNode` (AI loop nodes are steerable in v1).
  See `engine-integration.md`.
- **A steered node runs multiple provider turns on one live session — the one new engine behaviour.**
  It reuses the structured-output re-ask seam that re-invokes `sendQuery` with `attemptResumeId` on the same session (`dag-executor.ts:2290`).
  **Turn-end has two causes:** a **natural** end **auto-drains** (next turn on a queued message, else completes the node when the queue is empty); an **interrupted** end produces a **partial** result that must not be validated, completed, or advanced, and **always enters idle-await whatever the queue holds** — draining only on the operator's `Send now`.
- **In-process only; no durable steering state.**
  The **in-process registry** — keyed `(runId, nodeId)`, holding the node's live session handle plus an in-memory inbound queue, valid only while the node runs in this process — is the sole mechanism.
  Web dispatch runs the executor in the API server's process; a detached CLI run has no reachable handle, so steering is **unavailable** for it in v1 (Cancel and normal resume still work; the UI states this).
  A server restart drops the live session, timer, and any in-flight steer, leaving a durable non-terminal run.
  Archon does not autonomously fail or resume that ambiguous run from staleness; the operator must use explicit recovery.
- **Two queues, split on typing vs queued.**
  The pre-`Queue` **draft** is text still being composed and is per-tab browser state with no table or migration.
  The `this tab only` label qualifies only this unsent draft, even when draft and queued content share one combined surface.
  Pressing `Queue` dispatches the message to the send route with `intent: 'queue'`, and from that moment it rides the node-scoped shared in-memory registry queue on the live handle.
  The executor drains it at the natural turn boundary, `Send now` after an interrupt flushes the queue, and per-item `Send now` during generation attempts soft-inject.
  Delete of a queued message calls an idempotent withdraw route.
  A queued message survives a tab close and dies on a server restart.
  The crossover from client to server is `Queue`-press, not the drain moment.
- **An operator message is an ordinary `text` transcript row carrying three additive `metadata` fields:** `origin = 'operator'`, `operator_user_id` (the sender, for CAP-11 attribution on a multi-user install), and `message_id` (the caller-stamped id, so the client can reconcile which `sent` messages became rows).
  No new table, no widened `kind` enum — the `.strict()` metadata schema takes additive fields plus a regenerated `api.generated`, not a migration.
  The executor is the **sole** writer; the row is a receipt for the record, not the delivery vehicle.
  Only the row created by accepted per-item `Send now` during generation hides its visible sender name; stored attribution and other operator-row display paths remain.
- **Send and Interrupt are new routes; the queue absorbs races and epoch checks fail closed.**
  `POST /api/workflows/runs/:runId/nodes/:nodeId/send` and `…/interrupt` resolve identity through `resolveAuthContext` under the steering-specific actor grant.
  Any authenticated identity may steer and is attributed by `operator_user_id`; unauthenticated calls return 401; identity-less runs are allowed.
  Every mutation carries `retry_epoch`.
  A stale epoch returns a typed refusal and changes no node, queue, or transcript state.
  A Send arriving while an interrupt is in flight waits in the queue for the operator's `Send now`.
  A node no longer running returns 409, a detached run returns `not steerable here`, and a direct per-item request on a queue-only mode returns a typed capability refusal without removing the item.
  Queue-only UI omits that per-item action.
  On any terminal event, the client reconciles queued receipts against operator-row ids only after the executor's terminal write; an item proven unaccepted may return as `Never sent`.
  An accepted id with a failed transcript write is a recording failure, never a sendable `Never sent` draft.
  With two docks on one node, global order is the registry receipt order and each row keeps its `operator_user_id`.
- **The dock does not appear on a finished node.**
  Settled by the owner.
  The field and both controls are absent — a control that cannot act must not be drawn.
  Re-running a finished node is `workflow retry-node`, its own capability with its own confirmation, not this dock.
  An undelivered draft box stays rendered **read-only**, stating the node finished and the messages never left.
- **Interrupt is not undo.**
  Session state is saved up to the last completed tool call, but files already written stay written — nothing is rolled back.
  The control must not imply otherwise.
- **A steer delivery must not emit a turn-start event** — a stray one opens a phantom turn boundary and corrupts the record the transcript is built from.
- **Delivery requires causal consumption proof, never matching text or timestamps.**
  A matching native lifecycle event or stream causally tied to the selected message can prove consumption.
  An RPC acknowledgement proves only transport acceptance, and unrelated ongoing stream output proves neither selected-message consumption nor `delivered`.
- **Selected-item live input is separate from dock Send now.**
  A server-owned queued `message_id` and selected `retry_epoch` identify the item; the caller cannot replace its stored text or `operator_user_id`.
  The registry claims that one item against the active turn token and asks a provider-owned live-input port for acceptance.
  Acceptance removes only that item and writes one idempotent `sent` operator row immediately; consumption changes only that row to `delivered`.
  A rejected attempt releases the claim without moving the item; a turn-end or Stop race never silently falls back to a new turn.
  An uncertain timeout must not trigger blind reinjection, and a transcript-write failure after acceptance must not return the item to a sendable queue.
  Repeated receipts, concurrent operators, and reconnects preserve one send and one row per stamped id.
  Dock `Send now` after Stop remains the separate next-turn flush of queued items plus the new draft.
- **Steering is universal over a queue-and-flush floor; mid-turn is the acceleration.**
  Every provider delivers an operator message — at worst as the next prompt at turn-end.
  A provider earns _soft-inject_ only from a transport exercised against it, never one merely advertised.
  Providers differ on two honest axes: **boundary granularity** (mid-turn vs turn-end) and **delivery confirmation** (CAP-13).
- **Approved queue layouts are context-specific.**
  The full Legacy and Console rooms use the full-bleed queue band.
  The compact dock and state-review layout uses the inset queue well.
  These are two layouts for two contexts, not alternatives for one context.
- **Approved room controls are product behavior.**
  The in-product `Execution` selector, Cancel, Re-run, Log or Logs, Graph, counted Artifacts, and node-room close control act as shown in the approved mockups.
  Outer numbered review-state, node-kind, and provider-transport controls are fixture scaffolding.
- **The 30-minute idle-await fail is an inactivity timer (owner-ratified, SC 2.2.1).**
  While the agent is `idle-after-interrupt` and nothing is sent, a **fresh 30-minute timer** (an explicit fail branch — not the existing idle-timeout, which _completes_ the node) fails the node (`interrupted by operator, no redirect received`).
  Idle-await runs its own timer-driven status poll so `/workflow cancel` still reaches it, and **resolves exactly once** (`Send now`, cancel-poll, or timer).
  The timer is an **inactivity** timer: a debounced, authorized composing keepalive **re-arms** it without resolving idle-await, so the node fails only after 30 minutes of genuine operator inactivity — the limit is disclosed in the dock and adjustable by activity; the 30-minute value is unchanged.
  Resuming a 30-minute-failed node re-runs it with a **fresh session** — the interrupted context is gone.

## Cross-half dependency

CAP-11 (the operator row) writes into the read half.
`AgentHistoryItem` has kinds `assistant | tool | lifecycle`, and an operator row is none of them; the read half's architecture puts every row's meaning in the shared core (`packages/web/src/lib`).
So CAP-11 adds a **new item kind** and its two-shell treatment, and the CAP-1/CAP-2 transcript renderer must recognize it — an operator `text` row must not reach a live transcript until the reader recognizes `origin='operator'`, else it renders as agent text.
Because the two halves are now one spec, this is an **internal** ordering dependency, not a cross-spec one: build the reader's recognition of `origin='operator'` before CAP-11 ships.

**Second cross-half reader dependency — the interrupted status row.**
CAP-9 makes `⚠ interrupted` universal: the executor writes a separate `interrupted` status row on **every** provider at delivery, not only through Claude's `PostToolUseFailure` hook.
For that glyph to reach the row, the read half's `deriveOutcome` (`agent-history.ts:120`) must fold that status row into the **preceding** tool call's outcome — else `⚠` is unreachable on non-Claude providers even after the write lands.
Like the operator row, this is an internal ordering dependency: the reader's fold ships before the write half emits cross-provider interrupted rows.

## Non-goals

- **Cancelling the whole node.**
  The existing Cancel/abort feature is untouched.
  This feature only interrupts the agent's generation and keeps the node running.
- **Cancelling one individual tool call.**
  No provider offers it below turn level.
  Interrupt is turn-level; Cancel is node/session-level.
- **Surviving a server restart mid-steer, and steering a detached run.**
  Both are deferred in v1 because steering is in-process only.
- **Persisting the draft queue**, and **auto-send queue mode** — every send stays operator-initiated.
- **RunStream `ToolCallItem.tsx`, Chat `ToolCallCard.tsx`, and the backend `tool-formatter.ts`.**
  The read half touches only the two node rooms; the others are a different data path or a deliberate design.
- **A run-level "Files changed" panel**, and node-level git attribution generally — the git routes are run-scoped.
  Per-tool-call diffs (CAP-5) are the only node-level attribution available.
- **`qodercli`, `pi`, `copilot`, `opencode` steering.**
  These providers are not in use today.
- **Agent thinking, the triggering prompt, and advisor notifications** (the rest of "Track B") — they need persistence that does not exist and are out of scope; mid-turn steering, which used to sit in that bucket, is now the write half above.

### PRD Completeness Assessment

The canonical SPEC defines 13 complete capabilities and explicit constraints across both node-room surfaces.
It names eight local contract and test companions, two UX documents, two Architecture spines, and the approved mockup handoff.
The canonical requirements source is complete enough for coverage validation; equivalence with the Epic and mockup behavior is assessed in later steps.

## Epic Coverage Validation

The Epic file was read in full.
Its Requirements Inventory contains FR1–FR13 and a coverage map that names Stories for each capability.
Epic 4 supplies current correction criteria where the completed Stories are historical.

### Coverage Matrix

| FR   | PRD requirement                                                                                    | Epic and Story coverage                           | Status  |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------- |
| FR1  | One scannable row for each tool call; full CAP clause is in PRD Analysis above.                    | 1.1, 3.1                                          | Covered |
| FR2  | Tool-family body and bounded generic fallback; full CAP clause is in PRD Analysis above.           | 1.3                                               | Covered |
| FR3  | Folded TODO state and pinned strip; full CAP clause is in PRD Analysis above.                      | 1.5, 3.1 historical; 4.1 current                  | Covered |
| FR4  | Normalized subagent dispatch cards; full CAP clause is in PRD Analysis above.                      | 1.6                                               | Covered |
| FR5  | Inline file-edit diff with honest fallback; full CAP clause is in PRD Analysis above.              | 1.4                                               | Covered |
| FR6  | Occurrence grouping and navigation; full CAP clause is in PRD Analysis above.                      | 1.7, 2.9, 2.10, 3.2 historical; 4.2 current       | Covered |
| FR7  | Original payload behind Raw toggle; full CAP clause is in PRD Analysis above.                      | 1.2                                               | Covered |
| FR8  | Composer, Queue, draft and shared queue; full CAP clause is in PRD Analysis above.                 | 2.1, 2.2, 2.9, 2.10, 3.3 historical; 4.3 current  | Covered |
| FR9  | Interrupt current turn while node keeps running; full CAP clause is in PRD Analysis above.         | 2.3–2.7, 3.6                                      | Covered |
| FR10 | Redirect through same-session next turn; full CAP clause is in PRD Analysis above.                 | 2.3–2.7                                           | Covered |
| FR11 | Auditable operator and interrupted rows; full CAP clause is in PRD Analysis above.                 | 2.8, 2.13 historical; 4.3 current                 | Covered |
| FR12 | Boundary delivery plus selected-item live-turn delivery; full CAP clause is in PRD Analysis above. | 2.1, 2.3–2.7; 3.4/3.5 historical; 4.3/4.4 current | Covered |
| FR13 | Queued, sent, delivered causal status; full CAP clause is in PRD Analysis above.                   | 2.8, 3.5 historical; 4.4 current                  | Covered |

### Missing Requirements

No numbered FR is absent from the selected Epic coverage map.
There are no Epic FR numbers beyond the canonical SPEC’s CAP-1–CAP-13 set.
Semantic equivalence, historical contradictions, and atomic mockup coverage require the later alignment and story review steps; this section records claimed and traceable FR presence only.

### Coverage Statistics

- Total canonical PRD FRs: 13.
- FRs with Epic and Story coverage: 13.
- Numbered FR coverage: 100%.

## UX Alignment Assessment

### UX Document Status

The target has a final `DESIGN.md` and a final `EXPERIENCE.md` in `ux-Archon-agent-node-room-2026-09-09/`.
Both are named by the canonical SPEC and target Epic.
The approved manifest, rather than either planning document, remains the mockup-side behavior source.

### UX, Requirements, and Architecture Alignment

| Mockup change                       | UX clause                                                  | Requirements clause                                    | Architecture clause                                                    | Result                                                            |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| M001, M002 TODO strip               | `DESIGN.md:664–669`; `EXPERIENCE.md:159` checklist pattern | `SPEC.md:93–101` CAP-3                                 | Read spine AD-17, `ARCHITECTURE-SPINE.md:305–327`                      | Aligned below transcript and above queue or dock.                 |
| M003, M004 selected-item Send now   | `DESIGN.md:412–419,748–756`; `EXPERIENCE.md:287–296`       | `SPEC.md:170–189` CAP-12/13                            | Steering spine AD-3 and AD-11, `ARCHITECTURE-SPINE.md:141–163,254–298` | Aligned on one selected queued item in the active turn.           |
| M005, M006 shared queue disclosure  | `DESIGN.md:733–741`; `EXPERIENCE.md:177,282–287`           | `SPEC.md:140–147` CAP-8                                | Steering spine AD-13, `ARCHITECTURE-SPINE.md:314–329`                  | Aligned on one shared queue and display-only collapse.            |
| M007 primary Run N                  | `DESIGN.md:409–410,681–682`; `EXPERIENCE.md:489–501`       | `SPEC.md:119–129` CAP-6                                | Read spine AD-7, `ARCHITECTURE-SPINE.md:167–199`                       | Aligned on universal primary Run N and contextual suffixes.       |
| M008 nameless accepted operator row | `DESIGN.md:689–695`; `EXPERIENCE.md:402–407`               | `SPEC.md:170–189` CAP-12/13 and write-half constraints | Steering spine AD-6 and AD-12, `ARCHITECTURE-SPINE.md:205–216,299–313` | Aligned on visual name omission with stored attribution retained. |
| M009 delivered after consumption    | `DESIGN.md:697–700`; `EXPERIENCE.md:172,383–403`           | `SPEC.md:175–189` CAP-13                               | Steering spine AD-8, `ARCHITECTURE-SPINE.md:224–235`                   | Aligned on causal proof and a sent state before proof.            |

The UX and Architecture also support the two shell layouts, the 460-pixel room, keyboard access, focus recovery, reduced motion, and the separate in-product controls (`DESIGN.md:702–788`; read spine AD-17; steering spine AD-13).
The outer numbered review controls, node-kind switch, and transport switch are fixtures in the UX, SPEC, and both Architecture spines; the in-product `Execution` selector remains a product control.

### Alignment Issues and Warnings

No current UX-to-SPEC or UX-to-Architecture contradiction is established for the nine manifest changes.
G1, G2, G3, and G4 are current proof gates, and the actual Grok path remains a release verification dependency, not a UX scope exclusion (`DESIGN.md:412–419`; steering spine, Current Grok release proof).
The report-indexed NFR labels in Step 2 are local trace IDs; the Epic has a separate native NFR1–NFR8 sequence.
Historical Epic and Story contradictions are reviewed in the next step and in the final scope audit.

## Epic Quality Review

### Epic Structure

| Epic                              | User outcome                                                 | Dependency result                                                          | Assessment                                                         |
| --------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 — Readable Agent Transcript     | Operators scan and inspect stored tool activity.             | Stands on existing stored rows.                                            | User value and independent delivery are clear.                     |
| 2 — Live Agent Steering           | Operators queue, interrupt, redirect, and audit a live node. | Uses Epic 1's transcript row and status projection, an earlier dependency. | User value and dependency direction are clear.                     |
| 3 — Approved-Behavior Remediation | Operators receive corrected behavior across both rooms.      | Uses delivered Epics 1 and 2.                                              | Completed historical baseline; superseded criteria are identified. |
| 4 — Current-Contract Correction   | Operators receive the current 70-item approved contract.     | Corrects the delivered baseline and closes with a conformance check.       | User value and current acceptance owner are clear.                 |

### Story and Dependency Review

All 33 Stories have a user or product-owner outcome and at least two complete Given/When/Then acceptance scenarios.
Every explicit Story dependency points to an earlier Story or to delivered baseline work; no forward or circular dependency was found.
Stories 4.1–4.5 define separately testable current behavior, and Story 4.6 depends on them for the product-owner conformance result.
The queue disclosure in Story 4.3 uses the delivered shared-queue baseline in Stories 2.9 and 3.3; it does not require a later Story to become testable.
The selected target is brownfield, and the contracts require no new database table or starter-template setup Story.
The route, registry, provider, and schema work sits within observable steering Stories rather than in a technical-only Epic.

### Historical-Criteria Reconciliation

The Epic Overview says that Epic 4 and the current Requirements Inventory govern new acceptance work and supersede conflicting criteria in completed Epics 1–3.
The following older criteria remain as delivery history and do not bind a current implementation to two mutually exclusive outcomes:

| Historical clause                                                                                  | Current binding clause                                                                                      | Reconciliation                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Story 1.5 introduction says the TODO strip is above the transcript.                                | Story 4.1 says after the transcript scroller and before the queue or dock.                                  | Story 4.1 supersedes the old location; the acceptance criterion inside Story 1.5 already says below.                                          |
| Stories 1.7 and 3.2 permit `Iteration N`, `Pass N`, or a reason as the primary occurrence heading. | Story 4.2 requires primary `Run N` with context as a suffix.                                                | Story 4.2 supersedes the old primary-label rule.                                                                                              |
| Story 2.8 shows a sender name and Story 3.5 requires exact id echo for delivered.                  | Stories 4.3 and 4.4 require a nameless accepted selected-item row and causal consumption evidence.          | The current clauses govern the changed path; stored attribution remains.                                                                      |
| Story 3.6 treats outer mockup review switches as product controls.                                 | Story 4.5 identifies them as fixtures and retains actual in-product controls.                               | Story 4.5 supersedes the fixture claim.                                                                                                       |
| Story 3.7 names a 64-row inventory.                                                                | Story 4.6 names the validated 70-item manifest.                                                             | Story 3.7 is a completed historical check; Story 4.6 is the current gate.                                                                     |
| The old `Future capability` section calls G3 hook-based soft-inject future.                        | The Epic Overview and Stories 4.3, 4.4, and 4.6 make an actual Grok live-input path a current release gate. | The old hook implementation candidate is not a visible mockup feature; the visible per-item action and explicit user G3 decision are current. |

### Quality Findings

No critical structural violation, forward dependency, technical-only Epic, or untestable current Story criterion was found.
The actual G1/G2/G3/G4 provider proof remains work to execute under Stories 4.3, 4.4, and 4.6; the Stories state the acceptance gates and failure behavior.

## Final Manifest Alignment Audit

### Mockup Feature Behavior Matrix

The mockup columns repeat frozen manifest values and locations.
The ledger above gives field-level provenance and current-product plus completed-Epic classification evidence for every row.
The planning citations point to the current requirements, Architecture decisions, and exact Story acceptance criteria.

| ID   | Exact mockup location and visible item                                                                                                                                               | Precondition                                                                                            | Action                                                                                                                              | Target identity and cardinality                                                                                      | Timing                                                                                                                         | Effect on active work                                                      | Collection mutation                                                                                                                     | Expected result                                                                                                                  | Remaining or next state                                                                                                                                                                        | PRD requirement                                          | Architecture decision                                                     | Epic or Story acceptance criterion                       | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- | ------- |
| M001 | `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=todo-strip`; Console TODO strip placement and disclosure              | The selected agent node has todo calls                                                                  | The selected node room renders or the operator toggles the strip                                                                    | The selected node todo strip; One strip for the selected node                                                        | Pinned and visible while the transcript scrolls                                                                                | None; expanding the strip changes only its display                         | None                                                                                                                                    | The current todo item and progress remain visible; expansion shows the checklist                                                 | The strip is collapsed or expanded while the node keeps its agent sub-state                                                                                                                    | SPEC.md:93–101, CAP-3                                    | Read spine AD-17, ARCHITECTURE-SPINE.md:305–327                           | Epic Story 4.1 AC, epics.md:1224–1241                    | MATCHED |
| M002 | `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=todo-strip`; Legacy TODO strip placement and disclosure                | The selected agent node has todo calls                                                                  | The selected node room renders or the operator toggles the strip                                                                    | The selected node todo strip; One strip for the selected node                                                        | Pinned and visible while the transcript scrolls                                                                                | None; expanding the strip changes only its display                         | None                                                                                                                                    | The current todo item and progress remain visible; expansion shows the checklist                                                 | The strip is collapsed or expanded while the node keeps its agent sub-state                                                                                                                    | SPEC.md:93–101, CAP-3                                    | Read spine AD-17, ARCHITECTURE-SPINE.md:305–327                           | Epic Story 4.1 AC, epics.md:1224–1241                    | MATCHED |
| M003 | `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=queued-send-now`; Per-item Send now during generation                 | An agent is generating on a soft-inject transport with a queued item in the live iteration              | The operator selects that queued item’s Send now button                                                                             | The queued message beside the selected button; Exactly one selected queued item.                                     | Immediately upon provider acceptance during the running turn, without waiting for turn end.                                    | The active turn and tool call continue without interruption or a new turn. | Exactly the selected accepted item leaves the shared queue; other queued items remain.                                                  | The selected ordinary prompt enters the active turn immediately and appears as an operator transcript row without a sender name. | That item is absent from the queue; its transcript row reads sent until a matching lifecycle event or a response stream causally linked to that item proves agent consumption, then delivered. | SPEC.md:170–189, CAP-12/13                               | Steering spine AD-3/6/8/11, ARCHITECTURE-SPINE.md:141–163,205–235,254–298 | Epic Story 4.3/4.4 AC, epics.md:1265–1334                | MATCHED |
| M004 | `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=queued-send-now`; Per-item Send now during generation                  | An agent is generating on a soft-inject transport with a queued item in the live iteration              | The operator selects that queued item’s Send now button                                                                             | The queued message beside the selected button; Exactly one selected queued item.                                     | Immediately upon provider acceptance during the running turn, without waiting for turn end.                                    | The active turn and tool call continue without interruption or a new turn. | Exactly the selected accepted item leaves the shared queue; other queued items remain.                                                  | The selected ordinary prompt enters the active turn immediately and appears as an operator transcript row without a sender name. | That item is absent from the queue; its transcript row reads sent until a matching lifecycle event or a response stream causally linked to that item proves agent consumption, then delivered. | SPEC.md:170–189, CAP-12/13                               | Steering spine AD-3/6/8/11, ARCHITECTURE-SPINE.md:141–163,205–235,254–298 | Epic Story 4.3/4.4 AC, epics.md:1265–1334                | MATCHED |
| M005 | `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=generating;element=queued-list`; Shared queued-message band and disclosure               | At least one accepted message is queued for the selected live node.                                     | The operator selects the queue disclosure header.                                                                                   | The selected node's shared accepted-message queue band.; One band for the selected node.                             | The band expands or collapses immediately when selected.                                                                       | None; disclosure changes only the queue display.                           | None; opening or closing the band does not add, send, or delete a queued item.                                                          | The operator can show or hide the accepted rows while their shared count and order remain available.                             | The shared queue band is expanded or collapsed; accepted messages remain shared across tabs and operators.                                                                                     | SPEC.md:140–147, CAP-8; SPEC.md:250–257, shared queue    | Steering spine AD-11/13, ARCHITECTURE-SPINE.md:254–298,314–329            | Epic Stories 3.3 and 4.3 AC, epics.md:982–1024,1275–1282 | MATCHED |
| M006 | `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating;element=queued-list`; Shared queued-message band and disclosure                | At least one accepted message is queued for the selected live node.                                     | The operator selects the queue disclosure header.                                                                                   | The selected node's shared accepted-message queue band.; One band for the selected node.                             | The band expands or collapses immediately when selected.                                                                       | None; disclosure changes only the queue display.                           | None; opening or closing the band does not add, send, or delete a queued item.                                                          | The operator can show or hide the accepted rows while their shared count and order remain available.                             | The shared queue band is expanded or collapsed; accepted messages remain shared across tabs and operators.                                                                                     | SPEC.md:140–147, CAP-8; SPEC.md:250–257, shared queue    | Steering spine AD-11/13, ARCHITECTURE-SPINE.md:254–298,314–329            | Epic Stories 3.3 and 4.3 AC, epics.md:982–1024,1275–1282 | MATCHED |
| M007 | `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#section=E;element=occurrence-options`; Run N occurrence separator                              | The selected node has more than one occurrence.                                                         | The transcript renders occurrence groups.                                                                                           | The selected node's transcript occurrence groups.; One separator per occurrence when there are multiple occurrences. | When the multi-occurrence transcript is rendered.                                                                              | None; the separator labels existing transcript history.                    | None; displaying separators does not alter transcript rows.                                                                             | Each occurrence has a Run N header with the relevant suffix; Pass N and reason-only are not primary headers.                     | The multi-occurrence transcript remains grouped under Run N headers; a single occurrence has no separator.                                                                                     | SPEC.md:121–130, CAP-6                                   | Read spine AD-7, ARCHITECTURE-SPINE.md:167–199                            | Epic Story 4.2 AC, epics.md:1243–1263                    | MATCHED |
| M008 | `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#section=operator-record;element=operator-rows`; Operator transcript row without sender name | One selected message is accepted by the provider and recorded in the transcript.                        | That accepted operator message renders in the transcript.                                                                           | The transcript row for that selected stamped operator message.; Exactly one transcript row for the selected item.    | Immediately on provider acceptance.                                                                                            | None from the name display; stored attribution remains intact.             | None from the visual name treatment; provider acceptance still removes the selected queue item and creates its operator transcript row. | The row shows the operator message and sent badge without the sender's name.                                                     | The row remains sent until a matching lifecycle event or a response stream causally linked to that item proves agent consumption, then reads delivered.                                        | SPEC.md:170–189, CAP-12/13; SPEC.md:258–261, attribution | Steering spine AD-6/8/12, ARCHITECTURE-SPINE.md:205–235,299–313           | Epic Stories 4.3/4.4 AC, epics.md:1265–1334              | MATCHED |
| M009 | `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#section=status;element=delivered`; Delivered operator-message status                        | The selected operator transcript row is sent and agent consumption can be established for that message. | A matching provider lifecycle event or a response stream causally linked to the selected message proves that the agent consumed it. | The operator transcript row with that matching stamped message_id.; Exactly one matching operator message row.       | After evidence that the agent consumed the selected message, not merely after transport acceptance or unrelated stream output. | None; confirmation updates the displayed delivery status.                  | None; the row stays in the transcript and only its status changes.                                                                      | The matching row changes from sent to delivered.                                                                                 | The matching operator row reads delivered; unconfirmed rows continue to read sent.                                                                                                             | SPEC.md:183–189, CAP-13                                  | Steering spine AD-8, ARCHITECTURE-SPINE.md:224–235                        | Epic Story 4.4 AC, epics.md:1300–1334                    | MATCHED |

**Changed-feature coverage:** 9 of 9 MATCHED; 0 PARTIAL; 0 MISSING; 0 CONFLICT; 0 UNCLEAR.
**Visible-item classification:** 70 of 70 exactly once; nine CHANGE_FEATURE and 61 UNCHANGED_CONTEXT.

### Scope Decision Audit

The scan covered the selected canonical SPEC and its local companions, both UX documents, both Architecture spines, and the target Epic.
Only labels that assign product scope are listed below; words such as optional TypeScript fields and later stream output are not scope decisions.

| Scope label and source                                                                                                                          | Decision and mockup applicability                                                                                                                                                                                                                                                                                                   | Audit result                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Read-half persisted-data work excluded; `SPEC.md:203–206`.                                                                                      | The read half is explicitly retroactive and needs no new persisted data; the nine changed manifest behaviors do not require read-half persistence.                                                                                                                                                                                  | No visible change deferred.                             |
| Existing Cancel excluded from steering; `SPEC.md:231–233`, steering spine AD-1.                                                                 | Cancel is existing product context in the manifest, distinct from Stop; its current behavior remains available.                                                                                                                                                                                                                     | No visible change deferred.                             |
| Detached steering and server-restart survival deferred; `SPEC.md:328–333,364–366`, steering spine AD-5 and Deferred table.                      | The approved detached state shows the unavailable disclosure; the current target expressly uses an in-process live handle.                                                                                                                                                                                                          | No visible change deferred.                             |
| Persisted draft, automatic send, other product surfaces, run-level file attribution, unused providers, and Track B excluded; `SPEC.md:332–339`. | These are absent from the approved changed inventory and are explicit canonical non-goals.                                                                                                                                                                                                                                          | No visible change deferred.                             |
| Chat presenter adoption, Legacy deletion, resolver memoization, and a new error boundary deferred; read spine `ARCHITECTURE-SPINE.md:422–435`.  | These are separate product or internal changes; both approved rooms remain current and ship together.                                                                                                                                                                                                                               | No visible change deferred.                             |
| New color token excluded; `DESIGN.md:445`, with the owner contrast override at `DESIGN.md:834–860`.                                             | The approved behavior uses a derived color mix over existing tokens; status and contrast remain current.                                                                                                                                                                                                                            | No visible change deferred.                             |
| Completed Epic 3 labels G3 future or gated; `epics.md:668,892,903,1199–1210`.                                                                   | The Epic Overview explicitly marks Epics 1–3 historical and makes Epic 4 and its Requirements Inventory current (`epics.md:30–38,1214–1222`). The explicit user G3 decision requires a real Grok path in this release. The old label names an unproven hook candidate, while M003/M004 remain current on any proven live-turn mode. | Historical label superseded; no current-scope deferral. |
| Epic 3 64-row conformance target; `epics.md:1158–1195`.                                                                                         | Epic 4 Story 4.6 uses the validated 70-item manifest.                                                                                                                                                                                                                                                                               | Historical target superseded.                           |

No current target clause assigns a visible approved change to future, post-v1, later, deferred, gated, optional, stretch, removed, superseded, or out-of-scope work.

### Action Identity Audit

| Grouped IDs and shared label or intent                                                                            | Distinct behavior signatures and evidence                                                                                                                                                                                                                                                                                                                                                                 | Audit result                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| M003, M004 — per-item `Send now` during generation.                                                               | The two shells have the same selected-item target, one-item cardinality, immediate same-turn timing, no interrupt, selected-item queue removal, and sent-to-delivered status. Field evidence is recorded separately under M003 and M004; the manifest group cites direct user answers `coordinator-260924-send` and `coordinator-260924-receipt`.                                                         | MATCHED across shells; SAME_ACTION.                                            |
| M005, M006 — shared queue disclosure.                                                                             | The two shells have the same one-band target, immediate display-only toggle, no active-work effect or queue mutation, and retained shared count and order. Field evidence is recorded separately under M005 and M006; the manifest group cites `onToggleDraft` in each approved room and `coordinator-260924-queue`.                                                                                      | MATCHED across shells; SAME_ACTION.                                            |
| M003/M004 per-item `Send now` and unchanged dock context C014/C031/C057 — same visible words in different states. | The approved generating control is attached to a selected queued row and has the direct selected-item user answer; the manifest context rows show a separate dock control only after interrupt beside `WILL SEND`. The completed dock flow already flushes queued messages at the next turn, and Epic Story 4.4 keeps it separate. The manifest does not transfer dock semantics to the per-item control. | MATCHED — distinct current actions by state and placement; no behavior merged. |

Every action group is accounted for; no grouped signature is left UNCLEAR.

## Summary and Recommendations

### Overall Readiness Status

**READY for implementation planning handoff.**

The selected target has one complete document set, all 13 canonical capabilities have Story coverage, and all nine atomic changed-feature behaviors match the current SPEC, Architecture, and Epic acceptance criteria.
The 61 unchanged context items have implementation and completed-Epic evidence and remain current without being re-specified as new work.

### Critical Issues Requiring Immediate Action

None.
No current planning gap, unresolved changed-feature behavior, or non-MATCHED matrix row was found.

### Recommended Next Steps

1. Implement Epic 4 Stories 4.1–4.5 against their exact accepted behavior signatures.
2. Prove G1 causal consumption and G2 Claude, G3 Grok, and G4 OMP active-turn paths through the actual Archon adapters before exposing each mode’s per-item action.
3. Run Story 4.6 conformance across all 70 items and both rooms, including the unchanged context controls.

### Final Note

This is a planning-readiness verdict.
The provider release proof gates remain implementation and verification work specified by the current Stories.
No product code or planning source was edited by this assessment.

### Process Compliance

The skill and merged customization were read before Step 1.
The target and approved source set were resolved, the manifest was validated, and its frozen change, context, and action inventories were copied before planning-document mapping.
Step 1 was opened, completed, and saved before Step 2 was opened.
Steps 2, 3, 4, and 5 were each opened only after the preceding step was completed and saved.
Step 6 was opened after Step 5 was saved and completed the assessment.
The unique complete target set triggered the revised Step 1 automatic selection rule, so no menu or user selection was required.
**Every workflow step was followed in order.**

**Assessor:** Codex.
**Assessment date:** 2026-09-25.

## Terminal Audit After Report Reopen

The completed report was reopened and checked against the immutable manifest.
The manifest validator again reported: `Manifest is valid and source hashes are current.`
All 70 inventory IDs occur in exactly one classification; all nine changed rows have every required field value and field-level rendered, interaction, annotation, or direct-user evidence.
Each changed and unchanged item has current-product implementation or test evidence and completed-Epic evidence in the copied inventory.
The matrix has separate precondition, action, target and cardinality, timing, active-work effect, collection mutation, expected result, and next-state columns.
The two manifest action-identity groups have identical behavior signatures across the Console and Legacy rows, and the separate per-item and dock `Send now` controls remain distinct by state, position, and target.
No planning text supplied or repaired a mockup-side field.

### Visible Label and Internal-Term Mapping

| Visible product action                                | Internal term and effect                                                                                               | Evidence and result                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-item `Send now` on a queued row during generation | Selected-item live input or soft-inject; one server-owned queued id enters the same active turn.                       | Manifest M003/M004 direct user answers and interaction evidence; SPEC CAP-12; steering AD-3/11; Epic Story 4.3. MATCHED.                                                                                  |
| Dock `Send now` after Stop                            | Same-session next-turn flush of queued items plus the new draft.                                                       | Manifest unchanged context C014/C031/C057 shows the idle dock; current product and completed Epic evidence classify it as existing; SPEC CAP-10 and Epic Story 4.4 preserve its separate effect. MATCHED. |
| Queue-row Delete                                      | Idempotent queue withdraw for that item; it does not cancel the node or erase a delivered row.                         | `SPEC.md:250–255`; `steering-api-contract.md`, Routes and Idempotency and races; completed Story 2.2. MATCHED.                                                                                            |
| Dock `Stop`                                           | Per-turn provider interrupt or stream abort; the provider session and workflow node continue.                          | `SPEC.md:148–157`; steering AD-1/2; completed Stories 2.3–2.7. MATCHED.                                                                                                                                   |
| Run or node `Cancel`                                  | Existing node-level abort and lifecycle action, separate from steering Stop.                                           | Manifest unchanged product context; `SPEC.md:231–233`; steering AD-1/2; Epic Story 4.5. MATCHED.                                                                                                          |
| Agent continues after redirect                        | Executor reuses the live session and runs the next provider turn; the workflow node never enters a pause/resume state. | `SPEC.md:158–168`; steering AD-4; completed Stories 2.3–2.7. MATCHED.                                                                                                                                     |

The terminal audit changed no comparison status, issue count, recommendation, or verdict.
**Final verdict: READY for implementation planning handoff.**
**Process result: every step was followed in order.**
