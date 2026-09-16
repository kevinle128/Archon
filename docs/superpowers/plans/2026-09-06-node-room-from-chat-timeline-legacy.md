# Node Room From Chat Timeline (Legacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task.
> Track progress with the checkbox steps below.

**Goal:** Replace the legacy run Chat tab's full `ChatInterface` with a user-turn plus node-status timeline that opens the same mounted per-type node room as Graph and Logs, without AskHuman chrome.

**Architecture:** Keep `LegacyGraphLogsPane` as the single inspect shell for Graph, Logs, and Chat, with one right-hand `LegacyNodeRoom` mounted across all three tabs.
The Chat left pane contains a new `ChatTimeline`, fed by a pure merger of parent-conversation user messages and run node-status events, followed by the existing regular parent-conversation composer behavior in a small dedicated component.
A node-status click resolves to a `LogRow` through the existing Graph/Logs selection path while a separate timeline-entry id records which chronological status entry was clicked.

**Tech Stack:** Bun, strict TypeScript, React 19, TanStack Query, happy-dom, react-dom/server, and bun:test.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 5.4, together with `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md`, and `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/`.

## Global Constraints

- Story 5.4 implements FR3's legacy timeline and status-click slice only; Ask cards and awaiting chrome remain in Epic 6.
- The Chat timeline shows parent-conversation `user` turns and qualifying run lifecycle events, never parent assistant messages or node transcripts.
- A Chat status click opens the already-mounted legacy room without changing `activeView` away from `chat`.
- The ordinary composer remains a parent-conversation message path and must not read, answer, decline, or otherwise act on pending interactions.
- Product-authored Chat timeline labels, status values, empty states, and errors must not introduce AskHuman, awaiting, or waiting-on-you chrome; user-authored message content is never censored.
- `@archon/web` must use generated API types from `@/lib/api` and must not import `@archon/workflows`.
- All new and modified TypeScript remains strict, fully annotated, and free of `any`.
- Existing design tokens and dependencies are sufficient; do not add a package.
- Every production behavior follows RED, GREEN, refactor, then a focused commit.
- Run focused tests from `packages/web`; never run `bun test` from the repository root.

---

**Story authority:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 5.4, FR3 (timeline + status click, not Ask card), UX-DR7.

**Approved design authority:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-3, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` Direction A and `ChatTimeline`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js` `addChat`/`openPanel`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md` AD-3 and AD-4 isolation.

**Issue:** https://github.com/anhle128/Archon/issues/84

## Scope and Non-Goals

- Implement only Story 5.4 on the legacy `WorkflowExecution` Chat tab.
- Keep Graph and Logs behavior from Stories 5.1 through 5.3, including unmerged Logs rows and the shared `LegacyNodeRoom`.
- Replace the run Chat tab body so it shows the operator's parent-conversation user turns plus node-status entries in chronological order.
- Clicking a node-status entry must open the same per-type room as Logs or Graph for that node.
- Keep the operator on the Chat tab when they click a node-status entry.
- Do not switch `activeView` to `graph` as a substitute for opening the room.
- Keep one mounted `LegacyNodeRoom` across Graph, Logs, and Chat.
- Do not inline the agent transcript, tool cards, or worker-conversation stream in the Chat timeline.
- Do not add an Ask card, an empty Ask slot, awaiting chrome, or "waiting on you" copy.
- Do not render `node_awaiting` or `interaction_resolved` as timeline entries.
- Do not generate an `awaiting` timeline status, detail, badge, empty state, or error label.
- Do not censor the operator's message content merely because it contains the word `awaiting`.
- Preserve a text composer for the parent conversation because Story 5.4 says the composer remains non-HITL, the approved mockup contains `#chat-composer`, and Story 6.5 later verifies that this composer is not an Ask path.
- Keep the composer text-only in this story; file attachment parity and SSE-rendered assistant replies remain available on `/legacy/chat/:id` and are not part of the timeline contract.
- Disable the run-view composer for non-Web parent conversations with the existing `Continuing chats from other platforms in the Web UI is coming soon` explanation.
- Keep `/legacy/chat/:id` `ChatInterface` unchanged.
- Do not implement the console timeline.
- Do not import any legacy React component into `packages/web/src/experiments/console/`.
- Do not import `@archon/workflows` from `@archon/web`.
- Do not change the engine, database, API routes, workflow schemas, workflow YAML, provider behavior, CLI, chat orchestrator, or `manage_run`.
- Do not regenerate `packages/web/src/lib/api.generated.d.ts`.
- Adding a typed Web client wrapper for the already-existing `GET /api/conversations/:id` route is allowed; do not change the route or its schema.
- Sequential non-DAG runs continue to use the merged `WorkflowLogs` or `StepLogs` panel.
- Keep the Chat tab gated on `parentPlatformId` in `DagRunTabs`.
- Do not introduce the TypeScript `any` type.
- Use only existing design tokens and existing dependencies.
- Do not run `bun test` from the repository root.
- For every behavior change, write and run the failing test first, confirm that it fails for the missing behavior, implement the minimum production change, and refactor only while green.
- Do not update sprint tracking until all focused and repository validation succeeds.

## Verified Repository Baseline

- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:49-50` marks Story 5.3 done and Story 5.4 backlog.
- Issue 84 requires the Story 5.4 acceptance criteria, focused test evidence, and the sprint-status transition before close.
- `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx:6-30` already has a Chat tab that renders only when `parentPlatformId` is set.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:235-246` returns `'chat'` for DAG Chat with a parent and `'graph-logs-pane'` for Graph, Logs, and Chat without a parent.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:827-831` mounts full `ChatInterface` against `parentPlatformId` with `cwdOverride={workingPath}`.
- `packages/web/src/components/workflows/WorkflowExecution.test.tsx:136-153` currently asserts that DAG Chat with a parent returns `'chat'`.
- `packages/web/src/components/chat/ChatInterface.tsx` is the standalone conversation product used by `/legacy/chat/:id` and must remain.
- `packages/web/src/components/chat/ChatInterface.tsx:762-775` currently renders the regular composer and disables it for non-Web conversations with the established explanatory copy.
- `packages/server/src/routes/api.ts:889-905` and `packages/server/src/routes/api.ts:3322-3335` already expose `GET /api/conversations/:id`; only a Web client wrapper is missing.
- `packages/web/src/lib/api.conversations.test.ts:1-62` is the focused client-URL test file for conversation endpoints.
- `packages/web/src/lib/api.ts:221-227` already exposes `getMessages(conversationId, limit = 200)` returning `MessageResponse[]`.
- `packages/web/src/lib/api.generated.d.ts:4209-4218` defines `Message` as `{ id, conversation_id, role: 'user' | 'assistant', content, metadata, user_id, created_at }`.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:22-43` accepts `activeView: 'graph' | 'logs'` and owns `selectedLogRowId` plus one `LegacyNodeRoom`.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:166-174` treats a graph click as a node-level selection and a Logs click as an exact `LogRow` selection.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:176-213` keeps Graph and Logs in one `ResizablePanelGroup` with the room on the right.
- `packages/web/src/components/workflows/resolve-graph-room-row.ts:11-42` maps a node id to an ordinary row, else the last matching iteration row, else a synthetic pending row.
- `packages/web/src/components/workflows/build-log-rows.ts:9-22` is the complete `LogRow` selection contract.
- `packages/web/src/components/workflows/build-log-rows.ts:38-88` already understands loop iterations and `node_routed` execution sequences.
- `packages/web/src/components/workflows/NodeRunList.tsx:20-55` renders Logs rows as buttons with `aria-current` and status badges.
- `packages/web/src/lib/format.ts:16-25` already formats timestamps via `formatStarted`.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md:264-272` chooses Direction A: tabs stay and the right panel is the node room.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md:302` maps the NodePanel as shared across Graph, Logs, and Chat.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md:462-466` specifies `ChatTimeline` as user turns plus `NodeStatusEntry` rows and says the full agent transcript is never inlined.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js:704-715` and `918-923` open the shared side panel from a chat node chip without switching tabs.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/index.html:91-113` keeps a Chat stream plus a shared node panel for all tabs.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx:201-206` already forbids `AskHuman`, `awaiting`, and `waiting-on-you` copy.
- `packages/web/package.json:11` runs `bun test src/components/` as part of the package test script.

## Design Decisions

1. Keep the operator on the Chat tab.
The mockup `openPanel` call and Direction A share the right-hand room.
Switching to Graph would replace the Chat surface and violate UX-DR7's "panel meaning does not switch" for this door.

2. Fold Chat into `LegacyGraphLogsPane` instead of keeping a separate `'chat'` body.
Unmounting the pane on Chat currently drops `selectedLogRowId` and a second room instance.
Story 5.4 requires the three doors to select the same node and the same per-type chrome.

3. User turns come only from parent-conversation messages with `role === 'user'`.
Assistant rows, tool metadata, worker-conversation messages, and workflow-status prose stay out of this timeline.

4. Node-status entries come from run events, not from `remote_agent_messages`.
Each qualifying lifecycle event is its own chronological entry, matching the mockup's started-then-completed chips.

5. A node-status click is a `LogRow` selection.
Loop-iteration and route-iteration events preserve that selection, matching Logs.
Ordinary lifecycle events use `resolveGraphRoomRow`, matching Graph.

6. Preserve regular parent-conversation messaging without preserving the full `ChatInterface`.
The approved mockup has a text composer below the timeline, Story 5.4 says the composer remains non-HITL, and Story 6.5 later tests that invariant.
Use the existing `POST /api/conversations/:id/message` client, but do not add optimistic assistant rows, SSE hydration, file attachment UI, or any pending-interaction behavior to the timeline.
Keep `/legacy/chat/:id` as the full conversation surface.

7. Keep the Chat tab hidden when `parentPlatformId` is null.
CLI-created runs have no parent turns, and `DagRunTabs` already encodes that gate.

8. Poll parent messages with TanStack Query while the run is non-terminal, using the same 3000 ms interval as GET run.
Treat `paused` as non-terminal; the existing `isLive` prop excludes paused runs and therefore must not control this query.
Do not attach ChatInterface SSE to this tab.

9. Never emit or label `awaiting` on this timeline.
`expectNoAskHumanChrome` is the characterization contract for Epic 5 inspect chrome.

10. Track the exact clicked timeline entry separately from `selectedLogRowId`.
A `node_completed` event resolves to the ordinary row whose id is usually the earlier `node_started` event id, so comparing a timeline event id with a selected row id cannot correctly set `aria-current`.

11. Render a node-type glyph from the existing room taxonomy.
Resolve `NodeBodyKind` through `resolveRoomKind` so the timeline and room agree even for nested loop-group nodes and replayed runs whose definition is unavailable.

12. Keep one text-only run-view composer and preserve the existing non-Web guard.
Load the precise parent conversation through the existing conversation endpoint rather than guessing platform type from the platform id.

## Authoritative Interfaces

### Chat timeline model

Create `packages/web/src/components/workflows/build-chat-timeline.ts` with these exact contracts.

```ts
import type { MessageResponse, WorkflowEventResponse, WorkflowNodeStateResponse } from '@/lib/api';

import type { LogRowSelection } from './build-log-rows';
import type { NodeBodyKind } from './resolve-room-kind';

export type ChatTimelineNodeStatus = Exclude<WorkflowNodeStateResponse['status'], 'awaiting'>;

export type ChatTimelineEntry =
  | {
      kind: 'user';
      id: string;
      createdAt: string;
      content: string;
    }
  | {
      kind: 'node_status';
      id: string;
      createdAt: string;
      nodeId: string;
      label: string;
      nodeType: NodeBodyKind;
      status: ChatTimelineNodeStatus;
      detail: string;
      selection: LogRowSelection;
    };

export function buildChatTimeline(input: {
  messages: readonly MessageResponse[];
  events: readonly WorkflowEventResponse[];
  nodeStates: readonly WorkflowNodeStateResponse[];
  resolveNodeType: (nodeId: string) => NodeBodyKind;
}): ChatTimelineEntry[];
```

User-turn rules:

- Include a message only when `role === 'user'`.
- Skip a user message whose trimmed `content` is empty.
- Copy `id`, `created_at`, and `content` verbatim.
- Do not parse `metadata`.
- Do not include assistant messages.

Node-status event types, and only these:

- `node_started` → status `running`, detail `started`, selection `{ kind: 'node' }`
- `node_completed` → status `completed`, detail `completed`, selection `{ kind: 'node' }`
- `node_failed` → status `failed`, detail `failed`, selection `{ kind: 'node' }`
- `node_skipped` and `node_skipped_prior_success` → status `skipped`, detail `skipped`, selection `{ kind: 'node' }`
- `approval_requested` → status `running`, detail `gate requested`, selection `{ kind: 'node' }`
- `loop_iteration_started` → status `running`, detail `iteration N started`, selection `{ kind: 'loop_iteration', iteration: N }`
- `loop_iteration_completed` → status `completed`, detail `iteration N completed`, selection `{ kind: 'loop_iteration', iteration: N }`
- `loop_iteration_failed` → status `failed`, detail `iteration N failed`, selection `{ kind: 'loop_iteration', iteration: N }`
- `node_routed` with a positive safe-integer `execution_seq` → status `completed`, detail `routed {outcome} → {to}`, selection `{ kind: 'route_iteration', executionSeq }`
- `node_routed` without a valid `execution_seq` → status `completed`, detail `routed {outcome} → {to}` using `'unknown'` for a missing field, selection `{ kind: 'node' }`

Skip an event when all of the following fail to yield a node id: non-empty `step_name`, then non-empty string `data.nodeId`.
Skip loop-iteration events whose `data.iteration` is not a safe integer `>= 1`.
Skip `tool_called`, `tool_completed`, `workflow_artifact`, `node_awaiting`, `interaction_resolved`, and every other event type.

Label rules:

- Prefer `nodeStates` `name` for that `nodeId`, otherwise the `nodeId`.
- Set `nodeType` with `input.resolveNodeType(nodeId)` for every included node-status entry.
- For `loop_iteration`, append a space, `×`, and the iteration number, matching `build-log-rows.ts`.
- For `route_iteration`, append a space, `#`, and the execution sequence, matching `build-log-rows.ts`.

Sort rules:

- Convert `createdAt` with `ensureUtc` and `Date.parse`.
- Treat a non-finite timestamp as `0`.
- Sort ascending by timestamp, then `kind` with `user` before `node_status`, then original encounter index.
- Do not sort events by `event_order`.

### Timeline to LogRow

Create `packages/web/src/components/workflows/resolve-timeline-room-row.ts` with this exact contract.

```ts
import type { LogRow } from './build-log-rows';
import type { ChatTimelineEntry } from './build-chat-timeline';
import type { GraphRoomLiveStatus } from './resolve-graph-room-row';

export function resolveTimelineRoomRow(input: {
  rows: readonly LogRow[];
  entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>;
  liveStatus: readonly GraphRoomLiveStatus[];
}): LogRow;
```

Resolution order:

1. Find the last `LogRow` whose `nodeId` equals `entry.nodeId` and whose `selection` deeply equals `entry.selection`.
2. If none, return `resolveGraphRoomRow({ rows, nodeId: entry.nodeId, liveStatus })`.
3. `resolveGraphRoomRow` never returns null for a non-null node id, so this function always returns a `LogRow`.

### Chat timeline view

Create `packages/web/src/components/workflows/ChatTimeline.tsx` with this exact public contract.

```ts
import type { ChatTimelineEntry } from './build-chat-timeline';

export interface ChatTimelineProps {
  entries: readonly ChatTimelineEntry[];
  selectedEntryId: string | null;
  onSelectNodeStatus: (entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>) => void;
  loading: boolean;
  error: string | null;
}

export function ChatTimeline(props: ChatTimelineProps): React.ReactElement;
```

Render rules:

- The root is `<div aria-label="Run chat timeline" className="flex h-full min-h-0 flex-col overflow-auto p-3">`.
- When `loading` is true and `entries` is empty, show exactly `Loading conversation turns…`.
- When `error` is non-null, show that error string in `text-error` and still render any entries.
- When not loading, there is no error, and `entries` is empty, show exactly `No conversation turns or node-status entries yet.`
- Each `user` entry is a non-button `<div>` with classes `ml-auto max-w-[80%] rounded-lg bg-accent/20 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap`.
- Do not render user content as markdown.
- Each `node_status` entry is a `<button type="button">`.
- The selected node-status button is the one whose `id` equals `selectedEntryId` and it has `aria-current="true"`.
- The button content, in order, is: a node-type glyph, node `label`, `detail`, a status badge using the same token classes as `NodeRunList` for `pending`/`running`/`completed`/`failed`/`skipped`, `formatStarted(createdAt)`, and a `ChevronRight` icon from `lucide-react` with `className="h-3 w-3 text-text-tertiary"`.
- Map `command` to `Zap`, `prompt` to `FileText`, `loop` to `RefreshCw`, `bash` and `script` to `Terminal`, `approval` and `plannotator_gate` to `Eye`, `workflow` to `Workflow`, `route_loop` to `GitBranch`, `loop_group` to `Box`, and `unknown` to `Bot`, all from `lucide-react`.
- Give the type glyph `aria-hidden="true"` and `className="h-3.5 w-3.5 shrink-0 text-text-tertiary"`.
- Clicking a user bubble does nothing.
- `ChatTimeline` itself contains no form; `RunChatComposer` is its sibling in the Chat left pane.

### Regular parent-conversation composer

Add this client wrapper to `packages/web/src/lib/api.ts` immediately before `updateConversation`.

```ts
export async function getConversation(id: string): Promise<ConversationResponse> {
  return fetchJSON<ConversationResponse>(`/api/conversations/${encodeURIComponent(id)}`);
}
```

Create `packages/web/src/components/workflows/RunChatComposer.tsx` with this controlled contract.

```ts
export interface RunChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  sending: boolean;
  disabledReason: string | null;
  error: string | null;
}

export function RunChatComposer(props: RunChatComposerProps): React.ReactElement;
```

Composer rules:

- Render a `<form aria-label="Run conversation composer">` with one text `<textarea aria-label="Message the run conversation">` and one `type="submit"` button whose visible label is `Send`.
- Use `Message the run's conversation…` as the enabled placeholder.
- Disable both controls when `sending` is true or `disabledReason` is non-null.
- Use `disabledReason` as the disabled placeholder and `title`; do not duplicate the explanation as a second text node.
- Render `error` once with `role="alert"` and `text-error` when it is non-null.
- Submit only through `onSubmit`; the component has no API imports and no knowledge of pending interactions.
- Keep the draft controlled so the parent clears it only after a successful regular message POST.
- Do not add attachment controls, Ask controls, Reply/Continue semantics, or assistant-message rendering.

### Pane extension

Update `LegacyGraphLogsPaneProps` in `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` to this exact added surface.

```ts
export interface LegacyGraphLogsPaneProps {
  activeView: 'graph' | 'logs' | 'chat';
  renderGraph: (input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }) => ReactNode;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  runId: string;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  parentPlatformId: string | null;
  loadParentMessages: (conversationId: string) => Promise<MessageResponse[]>;
  loadParentConversation: (conversationId: string) => Promise<ConversationResponse>;
  sendParentMessage: (
    conversationId: string,
    message: string
  ) => Promise<{ accepted: boolean; status: string }>;
  roomHeader?: ReactNode;
  roomFooter?: ReactNode;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

export function runChatMessagesRefetchInterval(
  status: WorkflowRunStatus
): 3000 | false;
```

Chat data loading inside the pane:

- Enable the parent-message query only when `activeView === 'chat'` and `parentPlatformId !== null`.
- Query key is `['runChatMessages', parentPlatformId]`.
- `queryFn` calls `loadParentMessages(parentPlatformId)`.
- `runChatMessagesRefetchInterval` returns `3000` for `pending`, `running`, and `paused`, and returns `false` for `completed`, `failed`, and `cancelled`.
- The parent-message query uses `refetchInterval: runChatMessagesRefetchInterval(runStatus)`.
- `retry` is `false`.
- Pass `loading={query.fetchStatus === 'fetching' && query.data === undefined}` so a disabled query never produces a permanent loading state.
- On query error, pass the `Error` message or `Failed to load conversation turns.` and treat messages as `[]`.
- Build entries with `buildChatTimeline({ messages: data ?? [], events, nodeStates: visibleNodeStates, resolveNodeType: nodeId => resolveRoomKind(nodeId, definitionNodes, events, approval).nodeType })`.

Composer data and submit behavior inside the pane:

- Enable a second query only when `activeView === 'chat'` and `parentPlatformId !== null`.
- Use query key `['runChatConversation', parentPlatformId]`, call `loadParentConversation(parentPlatformId)`, set `staleTime: Infinity`, and set `retry: false`.
- Disable with `Loading conversation…` while the conversation query is fetching without data.
- Disable with `Unable to load conversation details.` when the conversation query fails.
- Disable with `Continuing chats from other platforms in the Web UI is coming soon` when the loaded conversation has `platform_type !== 'web'`.
- On submit, trim the draft, return when it is empty or disabled, set `sending`, clear the prior send error, and call `sendParentMessage(parentPlatformId, trimmedDraft)` exactly once.
- On POST success, clear the draft and call `void parentMessagesQuery.refetch()` so the persisted user turn appears without waiting for the polling interval.
- On POST failure, preserve the draft and render the thrown `Error` message or `Failed to send message.`.
- Clear draft and send error when `runId` changes so a draft cannot leak between runs.

Left-pane switch:

- `graph` keeps `renderGraph`.
- `logs` keeps `NodeRunList`.
- `chat` renders a `flex h-full min-h-0 flex-col` wrapper with `ChatTimeline` in a `min-h-0 flex-1` child and `RunChatComposer` below it.

Node-status handler:

```ts
const handleNodeStatusSelect = (
  entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>
): void => {
  const row = resolveTimelineRoomRow({
    rows,
    entry,
    liveStatus: visibleNodeStates,
  });
  const rowExists = rows.some(candidate => candidate.id === row.id);
  setSelectedLogRowId(rowExists ? row.id : null);
  setSelectedTimelineEntryId(entry.id);
  onSelectNode(row.nodeId);
};
```

Add `selectedTimelineEntryId` state initialized to null and pass it as `selectedEntryId` into `ChatTimeline`.
Clear `selectedTimelineEntryId` on a Graph click, a Logs-row click, a run reset, or an external selected-node change.
When `resolveTimelineRoomRow` returns a synthetic fallback that is not in `rows`, keep `selectedLogRowId` null and let the existing `selectedNodeId` fallback own the room so the row-removal effect does not immediately clear the Chat selection.
Do not clear it merely because the operator switches tabs, so switching Chat → Graph → Chat preserves which status entry was used as the door.

### Execution body

Replace `resolveWorkflowExecutionBody` in `packages/web/src/components/workflows/WorkflowExecution.tsx` with:

```ts
export type WorkflowExecutionBody = 'graph-logs-pane' | 'source-control' | 'sequential';

export function resolveWorkflowExecutionBody(input: {
  isDag: boolean;
  activeView: WorkflowRunView;
}): WorkflowExecutionBody {
  if (!input.isDag) return 'sequential';
  if (input.activeView === 'source-control') return 'source-control';
  return 'graph-logs-pane';
}
```

DAG Chat therefore keeps `LegacyGraphLogsPane` mounted.
Pass `activeView={activeView === 'chat' ? 'chat' : activeView === 'graph' ? 'graph' : 'logs'}`.
Import `getConversation`, `getMessages`, and `sendMessage` from `@/lib/api` and pass them as `loadParentConversation`, `loadParentMessages`, and `sendParentMessage` respectively.
Pass `parentPlatformId={parentPlatformId}`.
Remove the `ChatInterface` import and the `'chat'` render branch.
Delete `workingPath` from `WorkflowRunQueryData`, delete `workingPath: data.run.working_path ?? null` from the query mapper, and delete the `const workingPath` local because no remaining caller uses it.

## File Map

| File | Action | Justification |
| --- | --- | --- |
| `packages/web/src/components/workflows/build-chat-timeline.ts` | CREATE | Pure user-turn plus node-status merger |
| `packages/web/src/components/workflows/build-chat-timeline.test.ts` | CREATE | RED/GREEN contract for the merger |
| `packages/web/src/components/workflows/resolve-timeline-room-row.ts` | CREATE | Map a node-status entry onto a `LogRow` |
| `packages/web/src/components/workflows/resolve-timeline-room-row.test.ts` | CREATE | RED/GREEN contract for that mapping |
| `packages/web/src/components/workflows/ChatTimeline.tsx` | CREATE | Presentational Chat tab left pane |
| `packages/web/src/components/workflows/ChatTimeline.test.tsx` | CREATE | Markup, node-type glyph, exact-selection, and no Ask chrome contract |
| `packages/web/src/components/workflows/RunChatComposer.tsx` | CREATE | Controlled text-only regular conversation composer |
| `packages/web/src/components/workflows/RunChatComposer.test.tsx` | CREATE | Composer markup, disabled, and error contract |
| `packages/web/src/lib/api.ts` | UPDATE | Typed client for the existing single-conversation GET route |
| `packages/web/src/lib/api.conversations.test.ts` | UPDATE | URL-encoding contract for the added client |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` | UPDATE | Third left view, parent queries, regular send, and exact timeline selection |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` | UPDATE | Three-door same-room, polling/error, and regular-composer characterization |
| `packages/web/src/components/workflows/WorkflowExecution.tsx` | UPDATE | Keep the pane mounted for Chat; drop `ChatInterface` |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx` | UPDATE | Chat with a parent returns `graph-logs-pane` |
| `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` | UPDATE | Mark Story 5.4 done after validation |

Do not modify `packages/web/src/components/chat/ChatInterface.tsx`.
Do not modify `packages/web/src/components/workflows/LegacyNodeRoom.tsx`.
Do not modify `packages/web/src/lib/run-graph/`.
Do not modify `packages/web/src/experiments/console/`.

## Step-by-Step Tasks

### Task 1: CREATE `build-chat-timeline.ts`

**Files:**

- Create `packages/web/src/components/workflows/build-chat-timeline.ts`.
- Create `packages/web/src/components/workflows/build-chat-timeline.test.ts`.

**Interfaces:**

- Consumes `MessageResponse`, `WorkflowEventResponse`, `WorkflowNodeStateResponse`, `LogRowSelection`, `NodeBodyKind`, and `ensureUtc`.
- Produces `ChatTimelineNodeStatus`, `ChatTimelineEntry`, and `buildChatTimeline(input): ChatTimelineEntry[]` exactly as declared above.

- [ ] **Step 1: Write the failing tests.**

Create `packages/web/src/components/workflows/build-chat-timeline.test.ts` with literal fixtures and these cases.

1. Empty messages and events yield `[]`.
2. Only `role: 'user'` messages become `kind: 'user'` entries, in input order when timestamps match.
3. Assistant messages are omitted even when they sit between user messages.
4. A user message whose content is `'   '` is omitted.
5. `node_started`, `node_completed`, `node_failed`, `node_skipped`, and `approval_requested` become node-status entries with the mapped status, detail, and `{ kind: 'node' }`.
6. A loop-iteration triple with `iteration: 2` becomes three entries labelled `{name} ×2` with the three details `iteration 2 started`, `iteration 2 completed`, and `iteration 2 failed`.
7. A `node_routed` event with `execution_seq: 4`, `outcome: 'negative'`, and `to: 'fix'` becomes detail `routed negative → fix` and selection `{ kind: 'route_iteration', executionSeq: 4 }`.
8. A `node_routed` event missing `execution_seq` uses selection `{ kind: 'node' }` and substitutes `'unknown'` for missing outcome or target.
9. `tool_called`, `node_awaiting`, and `interaction_resolved` are omitted.
10. An event with empty `step_name` and `data.nodeId: 'review'` still emits a node-status entry for `review`.
11. An event with neither `step_name` nor `data.nodeId` is omitted.
12. A loop-iteration event with `iteration: 0` is omitted.
13. Node labels prefer `nodeStates[].name` over the raw id.
14. The injected `resolveNodeType` result is copied to every node-status entry and is never called for a user entry.
15. A user message at `T` sorts before a node-status event at the same `T`.
16. A later timestamp sorts after an earlier timestamp regardless of array order.
17. Invalid timestamps sort as epoch zero and retain the documented kind/encounter tie breaks.
18. No generated entry has `status: 'awaiting'` and no generated `detail` contains `awaiting`.

Use typed fixture builders so every generated OpenAPI field remains explicit.

```ts
const message = (overrides: Partial<MessageResponse> = {}): MessageResponse => ({
  id: 'message-1',
  conversation_id: 'parent-1',
  role: 'user',
  content: 'Ship it',
  metadata: '{}',
  user_id: 'user-1',
  created_at: '2026-09-06T00:00:00.000Z',
  ...overrides,
});

const event = (overrides: Partial<WorkflowEventResponse> = {}): WorkflowEventResponse => ({
  id: 'event-1',
  workflow_run_id: 'run-1',
  event_type: 'node_started',
  step_index: null,
  step_name: 'review',
  data: {},
  created_at: '2026-09-06T00:00:01.000Z',
  ...overrides,
});

const build = (
  input: Partial<Parameters<typeof buildChatTimeline>[0]> = {}
): ChatTimelineEntry[] =>
  buildChatTimeline({
    messages: [],
    events: [],
    nodeStates: [{ nodeId: 'review', name: 'Review', status: 'running', retryEpoch: 0 }],
    resolveNodeType: (): NodeBodyKind => 'command',
    ...input,
  });

test('merges user turns before node status at an equal timestamp', () => {
  expect(build({ messages: [message()], events: [event({ created_at: message().created_at })] }))
    .toMatchObject([
      { kind: 'user', id: 'message-1', content: 'Ship it' },
      {
        kind: 'node_status',
        id: 'event-1',
        nodeId: 'review',
        label: 'Review',
        nodeType: 'command',
        status: 'running',
        detail: 'started',
        selection: { kind: 'node' },
      },
    ]);
});

test('omits assistant, blank-user, tool, and Ask/HITL trigger rows', () => {
  expect(build({
    messages: [message({ role: 'assistant' }), message({ id: 'blank', content: '   ' })],
    events: [
      event({ id: 'tool', event_type: 'tool_called' }),
      event({ id: 'ask', event_type: 'node_awaiting' }),
      event({ id: 'resolved', event_type: 'interaction_resolved' }),
    ],
  })).toEqual([]);
});
```

Do not create the production module yet.

- [ ] **Step 2: Run the tests and confirm they fail for the missing module.**

Run:

```bash
cd packages/web && bun test src/components/workflows/build-chat-timeline.test.ts
```

Expected: fail because `./build-chat-timeline` cannot be resolved.

- [ ] **Step 3: Implement the minimum production module.**

Create `packages/web/src/components/workflows/build-chat-timeline.ts` to the Authoritative Interfaces contract.
Import `ensureUtc` from `@/lib/format`.
Do not import React.

Implement the mapping with an exhaustive local switch that returns null for every non-whitelisted event, then decorate and sort indexed entries.

```ts
interface IndexedEntry {
  entry: ChatTimelineEntry;
  timestamp: number;
  encounterIndex: number;
}

function timestampOf(createdAt: string): number {
  const parsed = Date.parse(ensureUtc(createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventNodeId(event: WorkflowEventResponse): string | null {
  const stepName = event.step_name;
  if (typeof stepName === 'string' && stepName.trim().length > 0) return stepName;
  const dataNodeId = event.data.nodeId;
  return typeof dataNodeId === 'string' && dataNodeId.trim().length > 0 ? dataNodeId : null;
}

interface MappedNodeStatus {
  status: ChatTimelineNodeStatus;
  detail: string;
  selection: LogRowSelection;
}

function printableRouteField(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return 'unknown';
}

function mapNodeEvent(event: WorkflowEventResponse): MappedNodeStatus | null {
  switch (event.event_type) {
    case 'node_started':
      return { status: 'running', detail: 'started', selection: { kind: 'node' } };
    case 'node_completed':
      return { status: 'completed', detail: 'completed', selection: { kind: 'node' } };
    case 'node_failed':
      return { status: 'failed', detail: 'failed', selection: { kind: 'node' } };
    case 'node_skipped':
    case 'node_skipped_prior_success':
      return { status: 'skipped', detail: 'skipped', selection: { kind: 'node' } };
    case 'approval_requested':
      return { status: 'running', detail: 'gate requested', selection: { kind: 'node' } };
    case 'loop_iteration_started':
    case 'loop_iteration_completed':
    case 'loop_iteration_failed': {
      const iteration = event.data.iteration;
      if (typeof iteration !== 'number' || !Number.isSafeInteger(iteration) || iteration < 1) {
        return null;
      }
      const suffix =
        event.event_type === 'loop_iteration_started'
          ? 'started'
          : event.event_type === 'loop_iteration_completed'
            ? 'completed'
            : 'failed';
      const status: ChatTimelineNodeStatus =
        suffix === 'started' ? 'running' : suffix === 'completed' ? 'completed' : 'failed';
      return {
        status,
        detail: `iteration ${String(iteration)} ${suffix}`,
        selection: { kind: 'loop_iteration', iteration },
      };
    }
    case 'node_routed': {
      const executionSeq = event.data.execution_seq;
      const selection: LogRowSelection =
        typeof executionSeq === 'number' &&
        Number.isSafeInteger(executionSeq) &&
        executionSeq >= 1
          ? { kind: 'route_iteration', executionSeq }
          : { kind: 'node' };
      return {
        status: 'completed',
        detail: `routed ${printableRouteField(event.data.outcome)} → ${printableRouteField(event.data.to)}`,
        selection,
      };
    }
    default:
      return null;
  }
}
```

Call `eventNodeId` and `mapNodeEvent` for each event, skip when either returns null, then call `resolveNodeType` only after the event has passed every inclusion check.
Build indexed user entries first and indexed node-status entries second, sort by timestamp, then `user` before `node_status`, then encounter index, and finally return only `.entry`.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Run the same command as Step 2.
Expected: all cases pass.

- [ ] **Step 5: Refactor only while green.**

Do not add composer data, assistant rows, or `awaiting` mapping.
Re-run the same command.

- [ ] **Step 6: Commit Task 1.**

```bash
git add packages/web/src/components/workflows/build-chat-timeline.ts packages/web/src/components/workflows/build-chat-timeline.test.ts
git commit -m "feat(web): build run chat timeline entries"
```

### Task 2: CREATE `resolve-timeline-room-row.ts`

**Files:**

- Create `packages/web/src/components/workflows/resolve-timeline-room-row.ts`.
- Create `packages/web/src/components/workflows/resolve-timeline-room-row.test.ts`.

**Interfaces:**

- Consumes a node-status `ChatTimelineEntry`, existing `LogRow[]`, and existing `GraphRoomLiveStatus[]`.
- Produces `resolveTimelineRoomRow(input): LogRow`, which always returns a row for a non-null timeline node id.

- [ ] **Step 1: Write the failing tests.**

Create `packages/web/src/components/workflows/resolve-timeline-room-row.test.ts` with these cases.

1. An ordinary `{ kind: 'node' }` entry returns the last ordinary `LogRow` for that node, not an earlier iteration row.
2. A `{ kind: 'loop_iteration', iteration: 2 }` entry returns the matching iteration row even when an ordinary row for the same node exists.
3. A `{ kind: 'route_iteration', executionSeq: 4 }` entry returns the matching route row.
4. A loop-iteration entry with no matching row falls through to `resolveGraphRoomRow` and therefore the last matching row or a synthetic pending row.
5. Rows for other nodes are ignored.
6. The returned row's `nodeId` always equals `entry.nodeId`.

Include an exact-match fixture like this before the fallback cases.

```ts
const rows: readonly LogRow[] = [
  {
    id: 'ordinary',
    nodeId: 'group',
    label: 'Group',
    status: 'running',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
  },
  {
    id: 'iteration-2',
    nodeId: 'group',
    label: 'Group ×2',
    status: 'completed',
    order: 1,
    sourceIndex: 0,
    selection: { kind: 'loop_iteration', iteration: 2 },
  },
];

test('returns the exact loop iteration before graph fallback', () => {
  expect(resolveTimelineRoomRow({
    rows,
    entry: {
      kind: 'node_status',
      id: 'iteration-finished',
      createdAt: '2026-09-06T00:00:02.000Z',
      nodeId: 'group',
      label: 'Group ×2',
      nodeType: 'loop_group',
      status: 'completed',
      detail: 'iteration 2 completed',
      selection: { kind: 'loop_iteration', iteration: 2 },
    },
    liveStatus: [],
  })).toBe(rows[1]);
});
```

Do not create the production module yet.

- [ ] **Step 2: Run the tests and confirm they fail for the missing module.**

Run:

```bash
cd packages/web && bun test src/components/workflows/resolve-timeline-room-row.test.ts
```

Expected: fail because `./resolve-timeline-room-row` cannot be resolved.

- [ ] **Step 3: Implement the minimum production module.**

Create `packages/web/src/components/workflows/resolve-timeline-room-row.ts` to the Authoritative Interfaces contract.
Reuse `resolveGraphRoomRow`.
Do not duplicate synthetic-row construction.

Use this exact selection comparison and reverse scan.

```ts
function selectionsEqual(left: LogRowSelection, right: LogRowSelection): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'node') return true;
  if (left.kind === 'loop_iteration') {
    return right.kind === 'loop_iteration' && left.iteration === right.iteration;
  }
  return right.kind === 'route_iteration' && left.executionSeq === right.executionSeq;
}

export function resolveTimelineRoomRow(input: {
  rows: readonly LogRow[];
  entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>;
  liveStatus: readonly GraphRoomLiveStatus[];
}): LogRow {
  for (let index = input.rows.length - 1; index >= 0; index -= 1) {
    const row = input.rows[index];
    if (
      row !== undefined &&
      row.nodeId === input.entry.nodeId &&
      selectionsEqual(row.selection, input.entry.selection)
    ) {
      return row;
    }
  }
  const fallback = resolveGraphRoomRow({
    rows: input.rows,
    nodeId: input.entry.nodeId,
    liveStatus: input.liveStatus,
  });
  if (fallback === null) {
    throw new Error('Timeline node selection did not resolve a room row');
  }
  return fallback;
}
```

Keep the explicit impossible-state throw instead of a non-null assertion because the existing resolver's public return type is `LogRow | null`.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Keep selection equality explicit for the three `LogRowSelection` variants.
Re-run the same command.

- [ ] **Step 6: Commit Task 2.**

```bash
git add packages/web/src/components/workflows/resolve-timeline-room-row.ts packages/web/src/components/workflows/resolve-timeline-room-row.test.ts
git commit -m "feat(web): resolve chat statuses to node rooms"
```

### Task 3: CREATE `ChatTimeline.tsx`

**Files:**

- Create `packages/web/src/components/workflows/ChatTimeline.tsx`.
- Create `packages/web/src/components/workflows/ChatTimeline.test.tsx`.

**Interfaces:**

- Consumes `ChatTimelineEntry[]`, `selectedEntryId`, loading/error state, and one node-status callback.
- Produces the accessible, presentational `ChatTimeline` left-pane list and no data-fetching or message-sending behavior.

- [ ] **Step 1: Write the failing markup tests.**

Create `packages/web/src/components/workflows/ChatTimeline.test.tsx` using `renderToStaticMarkup`.

Cover:

1. The root has `aria-label="Run chat timeline"`.
2. Empty non-loading markup contains exactly the empty copy `No conversation turns or node-status entries yet.`
3. `loading: true` with empty entries contains `Loading conversation turns…` and no node-status button.
4. A non-null `error` is visible even when entries exist.
5. A user entry renders its content and does not render a `<button>`.
6. A node-status entry renders a `<button type="button">` containing the mapped node-type glyph, `label`, `detail`, `status`, and a formatted `formatStarted` timestamp.
7. The status whose event id equals `selectedEntryId` has `aria-current="true"`, even when its id differs from the room's `LogRow.id`, and there is only one such attribute.
8. Markup generated from controlled entries does not contain `AskHuman`, `awaiting`, `waiting-on-you`, `<form`, `placeholder="Message`, or `Send`.
9. User content is rendered as escaped plain text, so `<strong>operator text</strong>` is visible text rather than a markup element.

Use one user entry and two lifecycle entries for the exact-selection assertion.

```tsx
const entries: readonly ChatTimelineEntry[] = [
  {
    kind: 'user',
    id: 'message-1',
    createdAt: '2026-09-06T00:00:00.000Z',
    content: '<strong>operator text</strong>',
  },
  {
    kind: 'node_status',
    id: 'start-review',
    createdAt: '2026-09-06T00:00:01.000Z',
    nodeId: 'review',
    label: 'Review',
    nodeType: 'command',
    status: 'running',
    detail: 'started',
    selection: { kind: 'node' },
  },
  {
    kind: 'node_status',
    id: 'complete-review',
    createdAt: '2026-09-06T00:00:02.000Z',
    nodeId: 'review',
    label: 'Review',
    nodeType: 'command',
    status: 'completed',
    detail: 'completed',
    selection: { kind: 'node' },
  },
];

test('marks the exact clicked lifecycle entry rather than the room row id', () => {
  const markup = renderToStaticMarkup(
    <ChatTimeline
      entries={entries}
      selectedEntryId="complete-review"
      onSelectNodeStatus={(): void => undefined}
      loading={false}
      error={null}
    />
  );
  const selected = /<button\b[^>]*aria-current="true"[^>]*>[\s\S]*?<\/button>/.exec(markup);
  expect(selected?.[0]).toContain('completed');
  expect(markup.split('aria-current="true"')).toHaveLength(2);
  expect(markup).toContain('&lt;strong&gt;operator text&lt;/strong&gt;');
  expect(markup).not.toContain('<strong>operator text</strong>');
});
```

Do not create the production component yet.

- [ ] **Step 2: Run the tests and confirm they fail for the missing module.**

Run:

```bash
cd packages/web && bun test src/components/workflows/ChatTimeline.test.tsx
```

Expected: fail because `./ChatTimeline` cannot be resolved.

- [ ] **Step 3: Implement the minimum production component.**

Create `packages/web/src/components/workflows/ChatTimeline.tsx` to the Authoritative Interfaces contract.
Reuse `cn` from `@/lib/utils` if class joining is needed.
Copy the non-awaiting status badge classes from `NodeRunList.tsx` locally.
Do not import `ChatInterface`, `MessageList`, or `MessageInput`.

Define the icon and status maps with exhaustive record types, then render distinct keys for messages and events so equal ids cannot collide.

```tsx
const TYPE_ICONS: Record<NodeBodyKind, LucideIcon> = {
  command: Zap,
  prompt: FileText,
  loop: RefreshCw,
  bash: Terminal,
  script: Terminal,
  approval: Eye,
  plannotator_gate: Eye,
  workflow: Workflow,
  route_loop: GitBranch,
  loop_group: Box,
  unknown: Bot,
};

const STATUS_COLORS: Record<ChatTimelineNodeStatus, string> = {
  pending: 'bg-accent/20 text-accent',
  running: 'bg-accent/20 text-accent',
  completed: 'bg-success/20 text-success',
  failed: 'bg-error/20 text-error',
  skipped: 'bg-surface text-text-secondary',
};
```

Use a `message:${entry.id}` React key for user entries and an `event:${entry.id}` React key for status entries.
On each status button, call `onSelectNodeStatus(entry)` directly, use `entry.id === selectedEntryId` for `aria-current`, render the mapped icon before the label, and keep the status badge text equal to the status value.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Do not extract a shared badge module unless the same object would otherwise be copied a third time after this story.
Re-run the same command.

- [ ] **Step 6: Commit Task 3.**

```bash
git add packages/web/src/components/workflows/ChatTimeline.tsx packages/web/src/components/workflows/ChatTimeline.test.tsx
git commit -m "feat(web): render run chat timeline"
```

### Task 4: Add the Regular Parent-Conversation Composer

**Files:**

- Modify `packages/web/src/lib/api.ts:159-193`.
- Modify `packages/web/src/lib/api.conversations.test.ts:1-62`.
- Create `packages/web/src/components/workflows/RunChatComposer.tsx`.
- Create `packages/web/src/components/workflows/RunChatComposer.test.tsx`.

**Interfaces:**

- Produces `getConversation(id: string): Promise<ConversationResponse>` over the existing server route.
- Produces controlled `RunChatComposer(props): React.ReactElement` with no API or HITL knowledge.
- Task 5 consumes both through injected pane props.

- [ ] **Step 1: Write the failing API-client and composer markup tests.**

Extend `api.conversations.test.ts` with an encoded GET assertion and update its import.

```ts
import {
  updateConversation,
  deleteConversation,
  getConversation,
  type ConversationResponse,
} from './api';

test('GETs the URL-encoded conversation ID', async () => {
  const conversation: ConversationResponse = {
    id: 'conversation-1',
    platform_type: 'web',
    platform_conversation_id: FORGE_ID,
    codebase_id: null,
    cwd: null,
    isolation_env_id: null,
    ai_assistant_type: 'claude',
    title: null,
    hidden: false,
    deleted_at: null,
    last_activity_at: null,
    user_id: null,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
  };
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(conversation), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );

  expect(await getConversation(FORGE_ID)).toEqual(conversation);
  expect(fetchSpy).toHaveBeenCalledWith(ENCODED_URL);
});
```

Create `RunChatComposer.test.tsx` with `renderToStaticMarkup` tests for the enabled, disabled, sending, and error states.

```tsx
function renderComposer(overrides: Partial<RunChatComposerProps> = {}): string {
  return renderToStaticMarkup(
    <RunChatComposer
      value="ship it"
      onValueChange={(): void => undefined}
      onSubmit={(): void => undefined}
      sending={false}
      disabledReason={null}
      error={null}
      {...overrides}
    />
  );
}

test('renders one regular conversation form and no Ask controls', () => {
  const markup = renderComposer();
  expect(markup).toContain('aria-label="Run conversation composer"');
  expect(markup).toContain('aria-label="Message the run conversation"');
  expect(markup).toContain('type="submit"');
  expect(markup).toContain('Send');
  expect(markup).not.toContain('AskHuman');
  expect(markup).not.toContain('Decline');
});

test('disables input and submit with the established non-Web explanation', () => {
  const reason = 'Continuing chats from other platforms in the Web UI is coming soon';
  const markup = renderComposer({ disabledReason: reason });
  expect(markup.split('disabled=""')).toHaveLength(3);
  expect(markup).toContain(`placeholder="${reason}"`);
});
```

- [ ] **Step 2: Run both RED tests.**

```bash
cd packages/web && bun test src/lib/api.conversations.test.ts src/components/workflows/RunChatComposer.test.tsx
```

Expected: `getConversation` and `RunChatComposer` are missing.

- [ ] **Step 3: Implement the API wrapper and controlled component.**

Add the exact `getConversation` wrapper from Authoritative Interfaces without changing server routes or generated types.
Implement the controlled component with this structure.

```tsx
import type { FormEvent } from 'react';

export function RunChatComposer(props: RunChatComposerProps): React.ReactElement {
  const disabled = props.sending || props.disabledReason !== null;
  const placeholder = props.disabledReason ?? "Message the run's conversation…";
  return (
    <form
      aria-label="Run conversation composer"
      className="border-t border-border bg-surface p-3"
      title={props.disabledReason ?? undefined}
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (!disabled) props.onSubmit();
      }}
    >
      {props.error !== null ? <p role="alert" className="mb-2 text-xs text-error">{props.error}</p> : null}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message the run conversation"
          value={props.value}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event): void => props.onValueChange(event.target.value)}
        />
        <button
          type="submit"
          disabled={disabled || props.value.trim().length === 0}
          className="h-10 rounded-lg bg-primary px-4 text-sm text-primary-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {props.sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run both GREEN tests.**

Run the same command as Step 2.

Expected: both focused files pass.

- [ ] **Step 5: Refactor only while green.**

Keep the component controlled and text-only.
Do not import `sendMessage`, pending interactions, `ChatInterface`, or SSE hooks into it.

- [ ] **Step 6: Commit Task 4.**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.conversations.test.ts packages/web/src/components/workflows/RunChatComposer.tsx packages/web/src/components/workflows/RunChatComposer.test.tsx
git commit -m "feat(web): add run conversation composer"
```

### Task 5: UPDATE `LegacyGraphLogsPane` for the Chat door

**Files:**

- Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:1-215`.
- Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx:1-1340`.

**Interfaces:**

- Consumes `ChatTimeline`, `RunChatComposer`, `buildChatTimeline`, `resolveTimelineRoomRow`, `resolveRoomKind`, and the three injected parent-conversation functions from Tasks 1 through 4.
- Extends `LegacyGraphLogsPaneProps` exactly as declared above.
- Preserves the existing `LegacyNodeRoom` instance and Graph/Logs callbacks while producing the Chat left pane.

- [ ] **Step 1: Write the failing pane tests.**

Extend `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`.

Update `PaneHarness` and `renderLogs` so `activeView` accepts `'chat'` and so the harness passes `parentPlatformId`, `loadParentMessages`, `loadParentConversation`, and `sendParentMessage`.
Default `parentPlatformId` to `'parent-1'`, default `loadParentMessages` to `async () => []`, default `loadParentConversation` to a complete Web `ConversationResponse`, and default `sendParentMessage` to `async () => ({ accepted: true, status: 'accepted' })` so current Graph/Logs cases stay green after the props become required.

Use this fixture and add the optional props to both harness argument types.

```ts
const PARENT_CONVERSATION: ConversationResponse = {
  id: 'conversation-1',
  platform_type: 'web',
  platform_conversation_id: 'parent-1',
  codebase_id: null,
  cwd: null,
  isolation_env_id: null,
  ai_assistant_type: 'claude',
  title: 'Parent',
  hidden: false,
  deleted_at: null,
  last_activity_at: null,
  user_id: 'user-1',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

interface ParentConversationOverrides {
  parentPlatformId?: string | null;
  loadParentMessages?: (conversationId: string) => Promise<MessageResponse[]>;
  loadParentConversation?: (conversationId: string) => Promise<ConversationResponse>;
  sendParentMessage?: (
    conversationId: string,
    message: string
  ) => Promise<{ accepted: boolean; status: string }>;
}
```

Add these new tests:

1. `activeView: 'chat'` does not render `aria-label="Node runs"` and does not render `data-testid="injected-graph"`.
2. `activeView: 'chat'` renders `aria-label="Run chat timeline"`.
3. Injected parent user message content appears in the timeline and is not a button.
4. A `node_started` event for `setup` appears as a node-status button.
5. Clicking that setup node-status button opens `[aria-label="setup room"]` and does not call `loadMessages`.
6. Clicking a command node-status button for `review` opens `[aria-label="review room"]` and calls `loadMessages` once with `['run-1', 'review']`.
7. Clicking a loop-iteration node-status button preserves that iteration the same way the existing Logs iteration test does.
8. Click graph setup, switch to Chat, then switch to Logs: the setup room region is the same DOM node and `loadMessages` is not called for bash.
9. Click the `node_completed` Chat entry for review, switch to Graph and back to Chat: the review room region is the same DOM node, `loadMessages` is not recalled, and only the completed timeline event retains `aria-current="true"` even though the room row id is `node_started`.
10. Clicking the user bubble does not change the selected room and does not call `loadMessages`.
11. When `loadParentMessages` rejects, the error copy is visible and node-status buttons still render.
12. A disabled parent-message query with `parentPlatformId: null` does not display a permanent loading state.
13. `runChatMessagesRefetchInterval` returns `3000` for pending, running, and paused runs, while completed, failed, and cancelled runs return `false`.
14. The Chat view renders exactly one regular composer and `expectNoAskHumanChrome` still passes for controlled fixtures.
15. Submitting trimmed composer text calls `sendParentMessage('parent-1', 'follow up')` once, clears the draft only on success, and refetches parent messages so the returned user row appears.
16. A failed send preserves the draft and renders the thrown message without changing the selected room.
17. A non-Web parent conversation disables the textarea and submit button with the existing explanation and never calls `sendParentMessage`.
18. A status whose node has no persisted `LogRow` opens the synthetic fallback room, retains the exact timeline selection, and does not immediately reset the room.

These tests must fail before production wiring because `activeView: 'chat'` currently falls through to Logs.

The central door test should use distinct start and completion event ids to catch accidental row-id comparison.

```ts
test('opens the command room from the exact completed status and preserves it across tabs', async () => {
  const calls: [string, string][] = [];
  const paneArgs = {
    runId: 'run-1',
    nodeStates: [REVIEW_STATE],
    events: [
      REVIEW_STARTED,
      workflowEvent({
        id: 'complete-review',
        event_type: 'node_completed',
        step_name: 'review',
        created_at: '2026-09-06T00:00:02.000Z',
      }),
    ],
    definitionNodes: [{ id: 'review', command: 'review' }] satisfies readonly DagNode[],
    definitionPending: false,
    runStatus: 'completed' as const,
    approval: null,
    loadMessages: async (requestRunId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    },
    loadParentMessages: async (): Promise<MessageResponse[]> => [],
    onSelectNode: (): void => undefined,
  };
  await act(async () => renderLogs({ ...paneArgs, activeView: 'chat' }));
  await flushUntil(host, 'chat timeline', () => host.querySelector('[aria-label="Run chat timeline"]') !== null);
  await clickRow('completed');
  const room = host.querySelector('[aria-label="review room"]');
  expect(room).not.toBeNull();
  expect(calls).toEqual([['run-1', 'review']]);
  expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('completed');

  await act(async () => renderLogs({ ...paneArgs, activeView: 'graph' }));
  expect(host.querySelector('[aria-label="review room"]')).toBe(room);
  await act(async () => renderLogs({ ...paneArgs, activeView: 'chat' }));
  expect(host.querySelector('[aria-label="review room"]')).toBe(room);
  expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('completed');
  expect(calls).toEqual([['run-1', 'review']]);
});
```

For the composer submit test, use the native textarea value setter before dispatching a bubbling `input` event, submit the form, and wait for the injected message loader's second result.

```ts
const textarea = host.querySelector('[aria-label="Message the run conversation"]');
if (!(textarea instanceof win.HTMLTextAreaElement)) throw new Error('missing run composer');
const valueSetter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set;
if (valueSetter === undefined) throw new Error('missing textarea value setter');
await act(async () => {
  valueSetter.call(textarea, '  follow up  ');
  textarea.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: '  follow up  ' }));
});
const form = host.querySelector('[aria-label="Run conversation composer"]');
if (!(form instanceof win.HTMLFormElement)) throw new Error('missing run composer form');
await act(async () => form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })));
await flushUntil(host, 'sent turn', () => (host.textContent ?? '').includes('follow up'));
expect(sendCalls).toEqual([['parent-1', 'follow up']]);
```

- [ ] **Step 2: Run the pane tests and confirm the new cases fail.**

Run:

```bash
cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx
```

Expected: the new Chat assertions fail because Chat falls through to `NodeRunList`, no parent query runs, and no composer exists.
The test file can pass the future props through `createElement` before the component interface declares them, so do not modify production merely to make the RED test compile.

- [ ] **Step 3: Implement the minimum pane production change.**

Update `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` to the Authoritative Interfaces pane contract.
Import `useQuery` from `@tanstack/react-query`.
Import `ConversationResponse` and `MessageResponse` as types from `@/lib/api`.
Do not import `ChatInterface`.

Add the two enabled-only queries and derive entries in `useMemo` exactly as specified above.
Derive the polling interval from `runStatus`, not `isLive`.
Use `query.fetchStatus === 'fetching' && query.data === undefined` for loading.

Use explicit null guards inside both query functions because `enabled` is a runtime guard and does not narrow the captured prop for TypeScript.

```ts
const parentMessagesQuery = useQuery({
  queryKey: ['runChatMessages', parentPlatformId],
  enabled: activeView === 'chat' && parentPlatformId !== null,
  queryFn: async (): Promise<MessageResponse[]> => {
    if (parentPlatformId === null) throw new Error('Parent conversation is unavailable');
    return loadParentMessages(parentPlatformId);
  },
  retry: false,
  refetchInterval: runChatMessagesRefetchInterval(runStatus),
});

const parentConversationQuery = useQuery({
  queryKey: ['runChatConversation', parentPlatformId],
  enabled: activeView === 'chat' && parentPlatformId !== null,
  queryFn: async (): Promise<ConversationResponse> => {
    if (parentPlatformId === null) throw new Error('Parent conversation is unavailable');
    return loadParentConversation(parentPlatformId);
  },
  retry: false,
  staleTime: Infinity,
});

const composerDisabledReason =
  parentPlatformId === null
    ? 'Conversation unavailable.'
    : parentConversationQuery.fetchStatus === 'fetching' &&
        parentConversationQuery.data === undefined
      ? 'Loading conversation…'
      : parentConversationQuery.isError
        ? 'Unable to load conversation details.'
        : parentConversationQuery.data?.platform_type !== 'web'
          ? 'Continuing chats from other platforms in the Web UI is coming soon'
          : null;
```

Add a direct table test for the polling helper so the suite does not wait on real timers.

```ts
test('polls parent turns for every non-terminal run status', () => {
  expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('pending')).toBe(3000);
  expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('running')).toBe(3000);
  expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('paused')).toBe(3000);
  expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('completed')).toBe(false);
  expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('failed')).toBe(false);
  expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('cancelled')).toBe(false);
});
```

Keep send state local and invalidate stale completions when the run changes.

```ts
const [selectedTimelineEntryId, setSelectedTimelineEntryId] = useState<string | null>(null);
const [chatDraft, setChatDraft] = useState('');
const [chatSending, setChatSending] = useState(false);
const [chatSendError, setChatSendError] = useState<string | null>(null);
const sendGeneration = useRef(0);

const handleChatSubmit = (): void => {
  const message = chatDraft.trim();
  if (parentPlatformId === null || message.length === 0 || composerDisabledReason !== null) return;
  const generation = ++sendGeneration.current;
  setChatSending(true);
  setChatSendError(null);
  void sendParentMessage(parentPlatformId, message)
    .then((): void => {
      if (sendGeneration.current !== generation) return;
      setChatDraft('');
      void parentMessagesQuery.refetch();
    })
    .catch((error: unknown): void => {
      if (sendGeneration.current !== generation) return;
      setChatSendError(error instanceof Error ? error.message : 'Failed to send message.');
    })
    .finally((): void => {
      if (sendGeneration.current === generation) setChatSending(false);
    });
};
```

Refactor the existing run-reset/removed-row effect so draft and send state reset only for a real run-id change, while either trigger still clears selection and calls `onSelectNode(null)` exactly once.

```ts
useEffect(() => {
  const runChanged = previousRunId.current !== runId;
  const selectedRowRemoved = selectedLogRowId !== null && explicitSelectedRow === null;
  previousRunId.current = runId;
  if (runChanged) {
    sendGeneration.current += 1;
    setChatDraft('');
    setChatSending(false);
    setChatSendError(null);
  }
  if (!runChanged && !selectedRowRemoved) return;
  setSelectedLogRowId(null);
  setSelectedTimelineEntryId(null);
  onSelectNode(null);
}, [explicitSelectedRow, onSelectNode, runId, selectedLogRowId]);
```

Derive `selectedTimelineNodeId` from the selected id and the current node-status entries.
In the existing external-node effect, clear the row id when `explicitSelectedRow.nodeId` belongs to the previous external selection, and clear the timeline id when `selectedTimelineNodeId` belongs to that previous selection.
Those independent checks preserve a new Chat click while still clearing a stale Chat highlight after a Graph or external node change.

```ts
const selectedTimelineNodeId =
  chatEntries.find(
    entry => entry.kind === 'node_status' && entry.id === selectedTimelineEntryId
  )?.nodeId ?? null;

useEffect(() => {
  const previous = previousSelectedNodeId.current;
  previousSelectedNodeId.current = selectedNodeId;
  if (previous === selectedNodeId) return;
  if (explicitSelectedRow !== null && explicitSelectedRow.nodeId === previous) {
    setSelectedLogRowId(null);
  }
  if (selectedTimelineNodeId === previous) {
    setSelectedTimelineEntryId(null);
  }
}, [explicitSelectedRow, selectedNodeId, selectedTimelineNodeId]);
```

Use the Authoritative Interfaces handler's `rowExists` guard when Chat resolves a synthetic fallback.
Render the left child with an explicit three-way branch rather than allowing Chat to fall through to Logs.

- [ ] **Step 4: Re-run the pane tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Keep Graph click clearing `selectedLogRowId`.
Keep Logs click setting `selectedLogRowId` to `row.id`.
Make Graph and Logs clicks clear `selectedTimelineEntryId` before calling `onSelectNode`.
Keep Chat node-status click setting `selectedLogRowId` to the resolved row id only when that row exists in `rows`; otherwise keep it null for the synthetic fallback path.
Keep the exact timeline event id in `selectedTimelineEntryId`.
Re-run the same command.

- [ ] **Step 6: Commit Task 5.**

```bash
git add packages/web/src/components/workflows/LegacyGraphLogsPane.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx
git commit -m "feat(web): open node rooms from run chat"
```

### Task 6: UPDATE `WorkflowExecution` composition

**Files:**

- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx:13-27,67-77,235-246,294-350,789-833`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.test.tsx:106-174`.
- Verify unchanged `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx:6-34`.

**Interfaces:**

- Consumes the extended `LegacyGraphLogsPaneProps` and the `getConversation`, `getMessages`, and `sendMessage` clients.
- Narrows `WorkflowExecutionBody` to `graph-logs-pane | source-control | sequential` and removes `parentPlatformId` from its resolver input.
- Preserves the existing Chat-tab visibility gate in `DagRunTabs`.

- [ ] **Step 1: Write the failing composition tests.**

In `packages/web/src/components/workflows/WorkflowExecution.test.tsx`:

1. Change `DAG Chat with a parent returns chat` so the same inputs return `'graph-logs-pane'`.
2. Keep `DAG Chat without a parent falls back to the graph-logs pane` returning `'graph-logs-pane'`.
3. Stop passing `parentPlatformId` into `resolveWorkflowExecutionBody`.
4. Add an assertion that `'chat'` is not a `WorkflowExecutionBody` by expecting the function never to return the string `'chat'` for any `WorkflowRunView`.

These tests fail until the resolver drops the `'chat'` branch.

Replace the resolver test block with table-driven assertions that exercise every view.

```ts
test('every DAG inspect view shares the pane and source control stays separate', () => {
  const expected: Record<WorkflowRunView, WorkflowExecutionBody> = {
    graph: 'graph-logs-pane',
    logs: 'graph-logs-pane',
    chat: 'graph-logs-pane',
    'source-control': 'source-control',
  };
  for (const activeView of views) {
    expect(resolveWorkflowExecutionBody({ isDag: true, activeView })).toBe(expected[activeView]);
  }
  expect(Object.values(expected)).not.toContain('chat');
});

test('every non-DAG input returns sequential', () => {
  for (const activeView of views) {
    expect(resolveWorkflowExecutionBody({ isDag: false, activeView })).toBe('sequential');
  }
});
```

- [ ] **Step 2: Run the composition tests and confirm they fail.**

Run:

```bash
cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx
```

Expected: the parent-chat case still returns `'chat'`.

- [ ] **Step 3: Implement the minimum production wiring.**

Update `packages/web/src/components/workflows/WorkflowExecution.tsx`:

- Replace `resolveWorkflowExecutionBody` with the Authoritative Interfaces version.
- Pass `activeView` `'chat' | 'graph' | 'logs'` through to `LegacyGraphLogsPane`.
- Pass `parentPlatformId`, `loadParentConversation={getConversation}`, `loadParentMessages={getMessages}`, and `sendParentMessage={sendMessage}`.
- Delete the `body === 'chat'` branch.
- Delete the `ChatInterface` import.
- Delete the now-unused `workingPath` property from `WorkflowRunQueryData`, its query-mapper assignment, and its local binding.
- Leave `DagRunTabs` Chat visibility unchanged.

The body branch must have this exact view adapter.

```tsx
<LegacyGraphLogsPane
  activeView={activeView === 'chat' ? 'chat' : activeView === 'graph' ? 'graph' : 'logs'}
  renderGraph={renderGraph}
  selectedNodeId={selectedDagNode}
  onSelectNode={setSelectedDagNode}
  runId={runId}
  nodeStates={queryData?.nodeStates ?? []}
  events={queryData?.events ?? []}
  isLive={isRunning}
  loadMessages={getWorkflowNodeMessages}
  parentPlatformId={parentPlatformId}
  loadParentConversation={getConversation}
  loadParentMessages={getMessages}
  sendParentMessage={sendMessage}
  definitionNodes={dagDefinitionNodes ?? []}
  definitionPending={workflowDefPending}
  runStatus={queryData?.workflowState.status ?? workflow.status}
  approval={queryData?.approval ?? null}
  onApprove={handleGateApprove}
  onReject={handleGateReject}
  roomHeader={retryActionPanel}
  roomFooter={
    isRunning || workflow.artifacts.length === 0 ? undefined : (
      <div className="border-t border-border p-3">
        <ArtifactSummary artifacts={workflow.artifacts} runId={runId} />
      </div>
    )
  }
/>
```

- [ ] **Step 4: Re-run the composition tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Confirm `ChatInterface` still exists for `/legacy/chat`.
Run:

```bash
cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/source-control/dag-run-tabs.test.tsx
```

Expected: Chat tab still renders in `DagRunTabs` when `parentPlatformId` is set and is absent when it is null.

- [ ] **Step 6: Commit Task 6.**

```bash
git add packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx
git commit -m "feat(web): mount run chat in shared node pane"
```

### Task 7: Validate and mark the story done

**Files:**

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after validation passes.

**Interfaces:**

- No runtime interface changes occur in this task.
- The repository validation contract is `bun run validate`, and the tracker contract is matching `last_updated` values plus Story 5.4 set to `done`.

- [ ] **Step 1: Run the focused Story 5.4 tests together.**

```bash
cd packages/web && bun test src/lib/api.conversations.test.ts src/components/workflows/build-chat-timeline.test.ts src/components/workflows/resolve-timeline-room-row.test.ts src/components/workflows/ChatTimeline.test.tsx src/components/workflows/RunChatComposer.test.tsx src/components/workflows/WorkflowExecution.test.tsx && NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run repository validation from the repo root.**

```bash
bun run validate
```

Expected: every validate step passes.
Do not run `bun test` from the repository root as a substitute.

- [ ] **Step 3: Update sprint tracking.**

In `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`, set `5-4-open-the-node-room-from-the-chat-timeline-legacy` to `done`.
Capture the completion timestamp with `date '+%Y-%m-%d %H:%M:%S %z'` and write that same value to both the leading `# last_updated:` comment and the `last_updated:` YAML field.
Do not mark `epic-5` done.
Story 5.5 remains `backlog`.

- [ ] **Step 4: Verify the tracker-only diff and commit Task 7.**

```bash
git diff --check
git diff -- _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark workflow run chat story done"
```

Expected: the diff changes only the two matching `last_updated` values and the Story 5.4 status before the commit.

## Testing Strategy

### Tests to Write

| Test File | Test Cases | Validates |
| --- | --- | --- |
| `packages/web/src/components/workflows/build-chat-timeline.test.ts` | User-only turns, omitted assistant/tool/awaiting events, iteration labels, chronological merge | FR3 timeline content |
| `packages/web/src/components/workflows/resolve-timeline-room-row.test.ts` | Ordinary, loop, route, and fallback mapping | Same room as Logs/Graph |
| `packages/web/src/components/workflows/ChatTimeline.test.tsx` | Accessible buttons, no embedded composer, no Ask chrome | UX-DR7 inspect chrome |
| `packages/web/src/components/workflows/RunChatComposer.test.tsx` | Regular composer markup, disabled state, and no Ask controls | Composer remains non-HITL |
| `packages/web/src/lib/api.conversations.test.ts` | Encoded single-conversation GET | Existing route client contract |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` | Chat door, three-door persistence, exact status selection, parent-message polling/errors, regular send, and non-Web guard | Story 5.4 AC |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx` | Chat uses `graph-logs-pane` | Shared pane mount |

### Edge Cases Checklist

- [ ] Parent conversation has assistant and user rows; only user rows appear.
- [ ] Parent message fetch fails; node-status entries still open rooms.
- [ ] Parent conversation lookup fails; the regular composer fails closed while the timeline remains usable.
- [ ] Regular send fails; draft and selected room remain unchanged.
- [ ] Paused runs continue parent-message polling; terminal runs do not.
- [ ] Chat tab hidden without `parentPlatformId`; resolver still returns `graph-logs-pane`.
- [ ] Loop iteration clicked from Chat survives a switch to Logs.
- [ ] A completion event remains the only selected Chat entry even though its resolved ordinary row uses the start-event id.
- [ ] A node-status event without a persisted row uses the synthetic room fallback without resetting its timeline selection.
- [ ] Graph click after a Chat iteration click resets to the canonical node row, matching existing Graph behavior that clears `selectedLogRowId`.
- [ ] No Ask card, empty Ask slot, or awaiting copy.
- [ ] `/legacy/chat/:id` is untouched.

## Validation Commands

From `packages/web`:

```bash
bun test src/components/workflows/build-chat-timeline.test.ts
bun test src/components/workflows/resolve-timeline-room-row.test.ts
bun test src/components/workflows/ChatTimeline.test.tsx
bun test src/components/workflows/RunChatComposer.test.tsx
bun test src/lib/api.conversations.test.ts
bun test src/components/workflows/WorkflowExecution.test.tsx
NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx
```

From the repository root:

```bash
bun run type-check
bun run lint --max-warnings 0
bun run validate
```

Do not run `bun test` from the repository root.

## Acceptance Criteria

- [ ] On a live or historical DAG run with `parentPlatformId`, the Chat tab shows user turns and node-status entries in chronological order.
- [ ] The Chat tab does not inline the agent transcript or the worker conversation.
- [ ] The Chat tab retains one text-only regular parent-conversation composer, and that composer is not connected to pending-interaction or approval APIs.
- [ ] The run-view composer is disabled for non-Web parent conversations with the existing explanatory copy.
- [ ] Clicking a node-status entry opens the same `LegacyNodeRoom` chrome as Logs or Graph for that node.
- [ ] The exact clicked status entry has `aria-current="true"` even when its resolved room row has a different id.
- [ ] Clicking Logs, Graph, and a timeline status for the same node in any order keeps the same node and the same per-type chrome.
- [ ] The Chat tab does not switch to Graph in order to show the room.
- [ ] The regular composer is not an Ask channel and does not read or mutate pending interactions.
- [ ] There is no Ask card, empty Ask slot, or awaiting chrome.
- [ ] Console timeline is not implemented.
- [ ] Focused tests above pass.
- [ ] `bun run validate` passes.
- [ ] `5-4-open-the-node-room-from-the-chat-timeline-legacy` is `done` in `sprint-status.yaml`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Replacing `ChatInterface` could accidentally turn the composer into a second HITL path | Low | High | Keep the composer on the ordinary conversation POST only and test that it has no Ask/Decline controls or pending-interaction inputs |
| A stale send promise could clear the next run's draft | Low | Med | Invalidate send generations when `runId` changes and ignore stale completions |
| Parent messages and run events use clocks that do not interleave as humans expect | Low | Med | Sort by `ensureUtc` timestamps with user-before-status tie-break; do not invent a second clock |
| `expectNoAskHumanChrome` fails if any status text says `awaiting` | Med | High | Timeline status union excludes `awaiting`; skip `node_awaiting` events |
| Required new pane props break existing Graph/Logs tests | High | Low | Default the new harness fields in the same test file before asserting Chat behavior |

## Open Questions

None.
The approved mockup and the Story 5.4/6.5 composer language resolve the prior ambiguity in favor of preserving a regular, text-only parent-conversation composer while keeping all Ask behavior out of this story.
