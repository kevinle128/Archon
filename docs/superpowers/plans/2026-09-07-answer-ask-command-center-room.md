# Answer the Ask in the Command Center Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the authenticated run starter answer or decline every structured Ask inline at its tool invocation in the Command Center agent room, with the same envelope, validity, copy, and warning awaiting chrome as Story 6.5, while teammates see named read-only state and the console composer stays a conversation path.

**Architecture:** Keep console production code isolated under `packages/web/src/experiments/console/**`.
Consume generated OpenAPI types only from `@/lib/api.generated`, call the existing GET-run embed and Ask POST through console `requestJson`, and mirror only the Story 6.5 helper behavior that the console actually calls.
Keep the React shell console-owned so NFR4 and FR8 stay intact.
Do not import legacy React, `@/lib/api` functions, React Query, or `@/components/workflows/*`.
GET `/api/workflows/runs/:runId` `pending_interactions` remains the only Ask-card source.
SSE `workflow_status` (mapped from `node_awaiting` / `interaction_resolved`) remains an identifier-only refetch trigger.

**Tech Stack:** Bun, strict TypeScript, React 19, console `useEntity` cache, happy-dom, `bun:test`, native `form` / `radio` / `checkbox` / `dialog` / `textarea`, Hono OpenAPI-generated types, and existing console warning/error tokens.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` Story 6.6, `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-3, CAP-4, CAP-6, and CAP-7, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` `PendingInteractionCard` plus Surface Fit, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md` AD-3, AD-4, AD-7, AD-8, and AD-9.

**Issue:** `https://github.com/anhle128/Archon/issues/91`.

## Global Constraints

- Story 6.6 changes the Command Center `/console` run-detail inspect surface only.
- Stories 5.5 and 6.5 are completed prerequisites and their focused suites must remain green.
- Console still must not import `@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, `@tanstack/react-query`, or `@/lib/api` functions.
- Type-only `api.generated.d.ts` remains allowed.
- The one sanctioned production-web runtime import remains `@/lib/run-graph`.
- Console must not import legacy `AskCard`, `WorkflowAskChrome`, `parse-ask-envelope`, `merge-agent-room-items`, `ask-answer-controller`, `ask-card-presentation`, or `awaiting-chrome`.
- Mirror the required pure behavior under `packages/web/src/experiments/console/components/ask/` and render it with console-owned markup.
- Do not copy the legacy-only, currently unused `mergeAgentRoomItems` or `nodeStatusLabel` exports, and do not introduce any helper with no console production caller.
- GET `/api/workflows/runs/:runId` `pending_interactions` is the only source of Ask cards.
- SSE payloads never become cards.
- Transcript `status` rows remain lifecycle notes and never become Ask cards.
- One POST answers or declines one whole card through `/api/workflows/runs/:runId/ask/:requestId/answer`, where `requestId` is `tool_use_id`.
- Submit stays disabled until every question is valid, including non-empty Other text and at least one value for multi-select.
- Decline remains a first-class secondary action behind a confirmation whose description is exactly `The agent will be told you declined`.
- A teammate or unsigned viewer sees disabled answer inputs, factual `Waiting for <starter> to answer` copy, and no Submit or Decline affordance.
- ChatPage `ChatComposer` remains a parent-conversation message path and never receives pending-interaction props.
- `a` / `r` keymap bindings stay declared-gate only and never submit or decline an Ask.
- Awaiting chrome uses warning tokens and the visible copy `waiting on you` or `Awaiting input (n)`.
- CAP-7 start rejection uses error tokens and the persisted executor message beginning `AskHuman is not supported by provider`.
- Do not render `kind: permission` cards.
- Do not add a shared React NodePanel.
- Do not change the workflow engine, persistence schema, workflow YAML, provider resume behavior, CLI, chat orchestrator, `manage_run`, or legacy `packages/web/src/components/workflows/**` production code.
- Do not add an `awaiting` workflow-run status or write Ask state into `metadata.approval`.
- Do not add UI packages or shadcn radio, checkbox, or dialog primitives.
- Every new or modified TypeScript function has complete types and no unjustified `any`.
- Each production behavior follows an observed RED, minimal GREEN, and refactor only while green.
- Run package-scoped tests from the owning package directory and never run unscoped `bun test` at repository root.
- Do not use `mock.module()` in the new tests.
- Do not update sprint tracking until all focused tests and `bun run validate` pass.
- Run every `git add` and `git commit` from the repository root.

---

## Verified Repository Facts

- Story 6.6 acceptance criteria are in `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` under `### Story 6.6: Answer the Ask in the Command Center room`.
- NFR4 isolation is in the requirements inventory in `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` and is enforced by `eslint.config.mjs` plus `packages/web/src/experiments/console/console-isolation.test.ts`.
- Unified render means envelope, states, validity, and copy, not a shared React module (`ARCHITECTURE-SPINE.md` convention table and Story 6.6 AC).
- Story 6.5 already added required GET-run fields `pending_interactions`, `viewer_is_starter`, and `starter_display_name` to the generated `WorkflowRunDetail` schema in `packages/web/src/lib/api.generated.d.ts`.
- `AskAnswerBody` is `{ answers: { questionId: string; value: string | string[] }[] } | { decline: true }` in `packages/web/src/lib/api.generated.d.ts`.
- `WorkflowNodeState.status` already includes `awaiting` and optional `error` in `packages/web/src/lib/api.generated.d.ts`.
- `NodeState` in `packages/web/src/lib/run-graph/types.ts` already includes `'awaiting'`.
- Console `getRun` in `packages/web/src/experiments/console/skills/runs.ts` currently drops the GET-run Ask fields.
- Console `inspectStatus` in `packages/web/src/experiments/console/components/inspect/inspect-status.ts` currently maps `awaiting` to `running`.
- `build-run-graph-input.test.ts` currently asserts awaiting is normalized to running before layout.
- `build-console-log-entries.test.ts` currently asserts awaiting display status is `running`.
- The `inspect and room production files omit premature HITL chrome` case in `console-isolation.test.ts` currently forbids `pending_interactions`, `AskCard`, `ChatComposer`, `Waiting on you`, and `awaiting` in inspect production files.
- The `assertNoEpicSix` helper in `ConsoleNodeRoom.test.tsx` currently forbids those same strings in mounted rooms.
- `ChatComposer` mounts only in `ChatPage.tsx` and sends conversation messages.
- Run-detail SSE already maps `node_awaiting` / `interaction_resolved` to `workflow_status` and invalidates `K.run` in `packages/web/src/experiments/console/lib/sse.ts`.
- Agent rooms already poll node messages every 1s while `isInspectRunLive` is true, and paused is live.
- `RunActionBar` returns null while `run.status === 'paused'`.
- Declared-gate UI remains the `ApprovalContext` / `ApprovalPanel` log-footer path in `RunDetailPage.tsx`.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` currently has `6-6-answer-the-ask-in-the-command-center-room: backlog`.
- Stories 6.1 through 6.5 and 6.7 are already `done`.

## Locked Design and Interfaces

### Console GET-run Ask fields

Extend `ConsoleRunDetail` in `packages/web/src/experiments/console/skills/runs.ts` to this exact shape.

```ts
export type PendingInteraction = components['schemas']['PendingInteraction'];
export type AskAnswerBody = components['schemas']['AskAnswerBody'];
export type WorkflowRunActionResponse = components['schemas']['WorkflowRunActionResponse'];

export interface ConsoleRunDetail {
  run: Run;
  events: RunEvent[];
  rawEvents: WorkflowEvent[];
  nodeStates: WorkflowNodeState[];
  approval: unknown;
  usage: RunDetailResponse['usage'];
  pendingInteractions: PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  runError: string | null;
}
```

`getRun` keeps the current `toRun`, `events`, `rawEvents`, `nodeStates`, `approval`, and `usage` mapping.
It also sets `pendingInteractions` to `res.pending_interactions ?? []`, `viewerIsStarter` to `res.viewer_is_starter === true`, `starterDisplayName` to `res.starter_display_name`, and `runError` to the string `res.run.metadata.error` or `null` when that value is missing or not a string.

Add this exact skill beside `getRun`.

```ts
export async function answerAskHuman(
  runId: string,
  requestId: string,
  body: AskAnswerBody
): Promise<WorkflowRunActionResponse> {
  return requestJson<WorkflowRunActionResponse>(
    `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}
```

### Console-owned pure Ask modules

Create console-owned copies under `packages/web/src/experiments/console/components/ask/`.
Copy the Story 6.5 algorithms from the legacy files listed below, changing import paths so they use console `PendingInteraction`, `AskAnswerBody`, `WorkflowRunActionResponse`, `WorkflowNodeMessage`, and `HttpError`.
Keep only exports with an identified console production caller.

| Console file | Copy algorithm from |
| --- | --- |
| `parse-ask-envelope.ts` | `packages/web/src/components/workflows/parse-ask-envelope.ts` |
| `select-visible-node-ask-interactions.ts` | `selectVisibleNodeAskInteractions` and its private helpers from `packages/web/src/components/workflows/merge-agent-room-items.ts` |
| `ask-answer-controller.ts` | `packages/web/src/components/workflows/ask-answer-controller.ts` |
| `ask-card-presentation.ts` | `packages/web/src/components/workflows/ask-card-presentation.ts` |
| `awaiting-chrome.ts` | `packages/web/src/components/workflows/awaiting-chrome.ts` |

Public contracts must stay exactly these signatures.

```ts
export interface AskQuestion {
  id: string;
  prompt: string;
  selection: 'single' | 'multi';
  options: string[];
  allowOther: boolean;
}

export type AskDraftValue = string | string[];
export type AskDraft = Record<string, AskDraftValue>;

export function parseAskEnvelope(envelope: Record<string, unknown>): AskQuestion[] | null;
export function parseAskAnswer(answer: Record<string, unknown> | null): AskAnswerBody | null;
export function isQuestionValid(question: AskQuestion, value: AskDraftValue | undefined): boolean;
export function isAskDraftValid(questions: readonly AskQuestion[], draft: AskDraft): boolean;
export function draftToAnswerBody(
  questions: readonly AskQuestion[],
  draft: AskDraft
): Extract<AskAnswerBody, { answers: unknown }>;
```

`parseAskEnvelope` returns `null` for missing, non-array, or empty `questions`, a non-object item, an empty question id, a non-string prompt, an invalid selection, non-string options, non-boolean `allowOther`, or duplicate question ids.
It uses type guards and must not import Zod or `@archon/workflows`.
Single-select validity accepts one listed option or one trimmed non-empty custom value when `allowOther` is true.
Multi-select validity requires a non-empty array whose values are listed options or one trimmed non-empty custom value when `allowOther` is true.
`draftToAnswerBody` emits exactly one answer per question in envelope order and is called only for a valid draft.
`parseAskAnswer` recognizes only the strict `{ decline: true }` union member or a non-empty strict `answers` array with non-empty `questionId` and string or string-array `value`.

```ts
export function selectVisibleNodeAskInteractions(input: {
  pending: readonly PendingInteraction[];
  nodeId: string;
  allMessages: readonly WorkflowNodeMessage[];
  visibleMessages: readonly WorkflowNodeMessage[];
}): PendingInteraction[];
```

Selection keeps `kind === 'ask'`, the selected `node_id`, and status `pending` or `answered`, while preserving GET order and excluding `purged` and `permission` rows.
An Ask with a tool id found in the full transcript is included only when that tool row is in the selected loop slice.
An Ask with no matching tool row anywhere is included only when the visible slice reaches the end of the full transcript, including the ordinary whole-node selection.
`ConsoleNodeRoom` inserts selected anchored cards immediately after their matching tool message and appends selected unanchored cards after the visible transcript slice.

```ts
export type AskActionState =
  | { phase: 'sending' }
  | { phase: 'accepted'; answer: AskAnswerBody; resolvedAt: string }
  | { phase: 'rejected-late' }
  | { phase: 'error'; message: string };

export type AskActionStateByRequest = Record<string, AskActionState | undefined>;

export interface AskAnswerController {
  submit: (requestId: string, answer: AskAnswerBody) => Promise<void>;
}

export function createAskAnswerController(input: {
  runId: string;
  postAnswer: (
    runId: string,
    requestId: string,
    answer: AskAnswerBody
  ) => Promise<WorkflowRunActionResponse>;
  setActionState: (requestId: string, state: AskActionState) => void;
  invalidate: () => Promise<void>;
  now: () => Date;
}): AskAnswerController;
```

Detect HTTP 409 with `error instanceof HttpError && error.status === 409`.
Do not import `getApiErrorStatus`.
A duplicate in-flight submit for the same request id returns without another POST.
Different request ids may submit concurrently.
Emit `sending` before POST, `accepted` after success, `rejected-late` for 409, and `error` with the thrown message or `Failed to answer.` otherwise.
Success and 409 both call `invalidate` after updating local state.
An invalidation failure logs one `console.warn` with run and request ids and leaves accepted or rejected-late state intact.

```ts
export type AskCardViewState =
  | 'pending'
  | 'sending'
  | 'answered'
  | 'declined'
  | 'rejected-late'
  | 'failed-resume';

export interface AskCardPresentation {
  viewState: AskCardViewState;
  answer: AskAnswerBody | null;
  error: string | null;
  resolvedAt: string | null;
}

export function resolveAskCardPresentation(input: {
  interaction: PendingInteraction;
  action: AskActionState | undefined;
  nodeStatus: WorkflowNodeState['status'] | undefined;
  nodeError: string | undefined;
}): AskCardPresentation;
```

`rejected-late` remains visible even after refetch finds the winning canonical answer.
Canonical `interaction.answer` takes precedence over a local accepted answer for summaries.
An accepted local answer remains visible until GET refetch catches up.
`failed-resume` is selected only when an effective accepted or canonical answer exists, node status is `failed`, and node error starts with `Could not resume the AskHuman session`.
An unrelated node failure after an answered Ask remains `answered` or `declined`.
Malformed canonical answers produce inline error `Malformed canonical answer` while retaining the honest answered state.

```ts
export function countPendingAsks(pending: readonly PendingInteraction[]): number;
export function isAskAwaitingRun(
  status: Run['status'],
  pending: readonly PendingInteraction[]
): boolean;
export function firstAwaitingNodeId(nodes: readonly WorkflowNodeState[]): string | null;
export function isAskHumanUnsupportedError(error: string | null | undefined): boolean;
```

Run awaiting is exactly `status === 'paused'` with at least one pending Ask.
Permission rows, answered rows, purged rows, and declared-gate pauses do not contribute to the count.
CAP-7 matching is a prefix check for `AskHuman is not supported by provider`.

### Inspect status policy

Replace `packages/web/src/experiments/console/components/inspect/inspect-status.ts` with this exact policy.

```ts
export type InspectStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'awaiting';

export function inspectStatus(value: string): InspectStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'awaiting'
  ) {
    return value;
  }
  return 'pending';
}

export function inspectStatusLabel(value: string): string {
  return value === 'awaiting' ? 'waiting on you' : value;
}

export function isInspectRunLive(status: string): boolean {
  return status === 'running' || status === 'paused';
}
```

`resolveInitialInspectSelection` precedence is exact: valid `?node=` wins, else the first `awaiting` node, else the first `running` node, else declared approval, else the first log row, else none.
Do not treat awaiting as running.

`NodeDivider` status union adds `'awaiting'`.
Its label for awaiting is `waiting on you`.
Its color class is `text-warning`.
`RunGraphPanel` `InspectCardStatus` adds `'awaiting'` with warning fill, warning border, warning glyph class, visible `waiting on you`, `animate-[pulse_2.4s_ease-in-out_infinite]`, and `motion-reduce:animate-none`.
`build-run-graph-input` passes `awaiting` through to `@/lib/run-graph` so taken-path stays on.

### Console Ask card

Create `packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx`.
Do not import shadcn or `@/components/ui/*`.
Use native `form`, `fieldset`, `legend`, `input type="radio"`, `input type="checkbox"`, `textarea`, `button`, and `dialog`.

```ts
export interface ConsoleAskCardProps {
  interaction: PendingInteraction;
  questions: readonly AskQuestion[];
  presentation: AskCardPresentation;
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  agentDisplayName: string;
  nodeId: string;
  autoFocus: boolean;
  nowMs: number;
  onSubmit: (body: Extract<AskAnswerBody, { answers: unknown }>) => void;
  onDecline: () => void;
}

export function ConsoleAskCard(props: ConsoleAskCardProps): React.ReactElement;

export function ConsoleInvalidAskCard(props: {
  interaction: PendingInteraction;
  agentDisplayName: string;
  nodeId: string;
}): React.ReactElement;
```

Copy the Story 6.5 interaction model and copy exactly.

- Root form `aria-label` is `question from agent, N questions`.
- Warning border and elevated surface classes are `border-warning bg-surface-elevated`.
- Header is `${agentDisplayName} is asking`.
- Meta row shows `nodeId` plus elapsed waiting time from `interaction.created_at` and `nowMs` using console `formatDurationMs`.
- Each question is a fieldset whose legend is the prompt.
- Keep Other-selected flags and Other text in separate component state.
- Project an empty-string sentinel into the draft while selected Other text is empty.
- Other text input is labelled `Other answer for ${question.prompt}` with `aria-required="true"` while selected.
- Only the first actionable card receives `autoFocus: true` and focuses its first choice.
- Starter pending cards render Submit and Decline.
- Non-starter pending cards render disabled answer controls, omit both action buttons, and show `Waiting for ${starterDisplayName ?? 'the run starter'} to answer`.
- Decline opens a native `dialog` with title `Decline this ask?`, description `The agent will be told you declined`, Cancel, and Decline.
- Sending disables the form and shows `Sending…`.
- Any non-pending presentation disables answer controls and omits Submit and Decline.
- The form handler always prevents browser navigation and calls `onSubmit` only when the starter's current draft is valid.
- Answered shows a question-labelled summary and `Answered · by you` only for the current starter, while a teammate sees `Answered` without `by you`.
- Declined shows `Declined`.
- Rejected-late shows `Already answered`.
- Failed resume shows `Resume failed — node failed; your answer is preserved below` with error text only on that stamp.
- An ordinary non-409 mutation error leaves the card pending, re-enables starter actions, and renders the error inline.
- Resolved stamps include a semantic `<time dateTime={presentation.resolvedAt}>` when the timestamp exists.
- Every state retains a `View payload` details disclosure with pretty-printed envelope JSON.
- `ConsoleInvalidAskCard` is a non-interactive `role="alert"` surface with `Invalid Ask payload`, node identity, and the same raw-payload disclosure.

Add this helper to `packages/web/src/experiments/console/lib/format.ts`.

```ts
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
```

### Run chrome

Create `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx`.

```ts
export interface ConsoleAskChromeProps {
  status: Run['status'];
  pendingInteractions: readonly PendingInteraction[];
  nodeStates: readonly WorkflowNodeState[];
  runError: string | null;
  onSelectAwaitingNode: (nodeId: string) => void;
  onRequestGraphView: () => void;
}

export function ConsoleAskChrome(props: ConsoleAskChromeProps): React.ReactElement | null;
```

Failed plus a matching CAP-7 message renders an error banner with `role="alert"`, `border-error bg-error/10 text-error`, the full persisted message, and no awaiting pill.
Paused plus pending Ask renders a button with `aria-live="polite"`, warning tokens, and `Awaiting input (${count})`.
Clicking it first calls `onRequestGraphView` and then `onSelectAwaitingNode` with the first awaiting node.
The click is a no-op when no projected awaiting node exists.

Run-detail header paused copy is `Awaiting input` when `isAskAwaitingRun` is true.
Otherwise keep the existing `statusLabel` map, including `Waiting for approval` for declared-gate pauses.
Do not change `lib/run-status.ts` globally.

### Room composition

Extend `AgentTranscript` with generic slots and no interaction-specific types.

```ts
renderAfterMessage?: (message: WorkflowNodeMessage) => React.ReactNode;
renderAtEnd?: React.ReactNode;
```

Render `renderAfterMessage(message)` immediately after that message.
Render `renderAtEnd` after the selected transcript slice.
When the selected slice is empty and `renderAtEnd` is present, render the end content instead of `Node hasn't produced output`.
Loading continues to suppress both slots.
The error state renders its retry UI followed by `renderAtEnd`.

The final `ConsoleNodeRoom` and `ConsoleInspectPane` contracts receive these additional required props.
Task 10 keeps only the pane's public handoff props optional with empty defaults as a temporary buildable seam for the not-yet-wired page caller.
Task 11 wires the page and makes the pane props required in the same GREEN change, so the final type checker cannot hide a missing production path.

```ts
pendingInteractions: readonly PendingInteraction[];
viewerIsStarter: boolean;
starterDisplayName: string | null;
actionStates: AskActionStateByRequest;
onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
```

Only `resolution.kind === 'agent'` uses those props.
Compose cards with `selectNodeRoomMessages`, `selectVisibleNodeAskInteractions`, and the same first-actionable-id rule implemented by `packages/web/src/components/workflows/NodeTranscriptPane.tsx`.
`agentDisplayName` is `row?.label ?? ''`.
`nowMs` is `Date.now()`.
Do not pass Ask props into stdout, gate, workflow, route, or loop-group bodies.
Do not import or render `ChatComposer` in the room.

### Page ownership

`RunDetailPage` owns `AskActionStateByRequest` and one `createAskAnswerController` per `run.id`.
Reset local action state when `runId` changes.
Controller `invalidate` must `invalidate(K.run(runId))` and, when a node id is selected, `invalidate(K.nodeMessages(runId, nodeId))`.
Pass Ask fields from `detail` into `ConsoleInspectPane`.
Render `ConsoleAskChrome` under `RunDetailHeader`.
`onRequestGraphView` writes view `'graph'`.
`onSelectAwaitingNode` calls the existing `onInspectSelect`.
Tighten keymap `a` / `r` `when` to `isPaused && run.approval != null`.
Do not pass pending interactions into `ChatComposer`, `ChatPage`, or `RunActionBar`.

### Isolation rewrite

Keep the NFR4 import scan.
Replace the premature-HITL identifier scan with a final architecture guard.

- `ConsoleNodeRoom`, `ConsoleInspectPane`, and `RunDetailPage` must not import `ChatComposer` or any legacy `components/workflows` module through either alias or relative paths.
- The room must import its console-owned `ConsoleAskCard`, and the page must import its console-owned `ConsoleAskChrome`.
- `ChatComposer.tsx` and `ChatPage.tsx` production source must not contain `pendingInteractions`, `answerAskHuman`, `ConsoleAskCard`, or `ConsoleAskChrome`.

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/web/src/experiments/console/skills/runs.ts` | Modify | Keep GET-run Ask fields and wrap the answer POST |
| `packages/web/src/experiments/console/skills/runs.node-messages.test.ts` | Modify | Prove GET-run Ask field retention |
| `packages/web/src/experiments/console/skills/runs.ask.test.ts` | Create | Prove encoded answer POST and 409 `HttpError` |
| `packages/web/src/experiments/console/components/ask/parse-ask-envelope.ts` | Create | Parse questions, answers, draft validity, and request body |
| `packages/web/src/experiments/console/components/ask/parse-ask-envelope.test.ts` | Create | Prove parser and validity matrices |
| `packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.ts` | Create | Select loop-safe Ask rows for the active node-room slice |
| `packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.test.ts` | Create | Prove selected-node, loop-slice, anchor, and fallback behavior |
| `packages/web/src/experiments/console/components/ask/ask-answer-controller.ts` | Create | Own independent mutation lifecycle and duplicate suppression |
| `packages/web/src/experiments/console/components/ask/ask-answer-controller.test.ts` | Create | Prove success, concurrency, 409, and error behavior |
| `packages/web/src/experiments/console/components/ask/ask-card-presentation.ts` | Create | Derive canonical and optimistic card presentation |
| `packages/web/src/experiments/console/components/ask/ask-card-presentation.test.ts` | Create | Prove state matrix and exact resume-failure classification |
| `packages/web/src/experiments/console/components/ask/awaiting-chrome.ts` | Create | Derive pending count, navigation target, labels, and CAP-7 match |
| `packages/web/src/experiments/console/components/ask/awaiting-chrome.test.ts` | Create | Prove exact run and node chrome decisions |
| `packages/web/src/experiments/console/components/inspect/inspect-status.ts` | Modify | Pass awaiting through with `waiting on you` |
| `packages/web/src/experiments/console/components/inspect/inspect-status.test.ts` | Modify | Invert the Story 5.5 awaiting-as-running assertions |
| `packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts` | Modify | Prefer first awaiting node after `?node=` |
| `packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts` | Modify | Prove awaiting-over-running precedence |
| `packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts` | Modify | Expect awaiting display status |
| `packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts` | Modify | Expect awaiting nodeState on-path |
| `packages/web/src/experiments/console/components/NodeDivider.tsx` | Modify | Warning awaiting log chrome |
| `packages/web/src/experiments/console/components/NodeDivider.test.tsx` | Modify | Prove warning label and class |
| `packages/web/src/experiments/console/components/RunGraphPanel.tsx` | Modify | Warning awaiting graph chrome |
| `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx` | Modify | Prove `waiting on you` and warning tokens |
| `packages/web/src/experiments/console/lib/format.ts` | Modify | Add `formatDurationMs` |
| `packages/web/src/experiments/console/lib/format.test.ts` | Modify | Prove millisecond, second, and minute formatting boundaries |
| `packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx` | Create | Console-owned accessible Ask card |
| `packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx` | Create | Prove form semantics, copy, focus, actions, summaries, and errors |
| `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx` | Create | Run-level awaiting pill or CAP-7 banner |
| `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.test.tsx` | Create | Prove run-chrome rendering and navigation callback |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` | Modify | Slot Ask cards into the agent transcript |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` | Modify | Replace no-HITL assertions with Ask placement coverage |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` | Modify | Thread Ask props through the persistent room |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` | Modify | Prove Log and Graph doors share one Ask-capable room |
| `packages/web/src/experiments/console/components/RunDetailHeader.tsx` | Modify | Show `Awaiting input` instead of approval copy for Ask pauses |
| `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx` | Modify | Prove Ask versus declared-gate header copy |
| `packages/web/src/experiments/console/routes/RunDetailPage.tsx` | Modify | Own the controller, chrome, keymap gate, and pane props |
| `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx` | Modify | Prove composer isolation, keymap, and chrome wiring |
| `packages/web/src/experiments/console/console-isolation.test.ts` | Modify | Keep NFR4 and allow console Ask chrome |
| `packages/web/src/experiments/console/README.md` | Modify | Replace the Epic 6 handoff paragraph |
| `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` | Modify last | Mark Story 6.6 and Epic 6 done after validation |

Do not modify `packages/web/src/components/workflows/**`, `packages/web/src/lib/api.ts`, `packages/web/src/lib/run-graph/**`, engine packages, provider packages, migrations, `ChatComposer.tsx` production behavior, or `PendingInputBanner.tsx`.

## TDD Execution Rule

Each numbered RED/GREEN cycle below is atomic.
Add only the named test, run the exact command until it fails for the stated missing behavior rather than an import, syntax, fixture, or environment error, implement only enough production code for that test, rerun to PASS with pristine output, and only then begin the next cycle.
Sprint YAML is the only test-first exception because it is tracking configuration.

Component suites that import `react-dom/client` must set `process.env.NODE_ENV = 'development'` as the first statement, matching `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`.

---

## Implementation Preflight

Before editing production code, run `git status --short` from the repository root and preserve every unrelated user change.
Run the current console boundary, inspect, room, page, and isolation suites to establish a green baseline.

```bash
cd packages/web
bun test src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/components/inspect/inspect-status.test.ts src/experiments/console/components/inspect/console-inspect-selection.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts src/experiments/console/components/graph/build-run-graph-input.test.ts
bun test src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/RunDetailHeader.test.tsx src/experiments/console/routes/RunDetailPage.test.tsx src/experiments/console/console-isolation.test.ts
```

Expected result: every command exits 0.
Stop and investigate any baseline failure before attributing it to Story 6.6.

---

## Tasks

### Task 1: Extend the typed console Ask data boundary

**Files:**

- Modify: `packages/web/src/experiments/console/skills/runs.ts`
- Modify: `packages/web/src/experiments/console/skills/runs.node-messages.test.ts`
- Create: `packages/web/src/experiments/console/skills/runs.ask.test.ts`

**Interfaces:**

- Consumes: generated `WorkflowRunDetail`, `PendingInteraction`, `AskAnswerBody`, `WorkflowRunActionResponse`, and `requestJson`.
- Produces: `ConsoleRunDetail.pendingInteractions`, `viewerIsStarter`, `starterDisplayName`, `runError`, and `answerAskHuman`.

- [ ] **Step 1: Write the failing GET-run Ask-field test.**

Add this test to `runs.node-messages.test.ts` inside `describe('getRun inspect boundary')`.

```ts
test('keeps pending interactions, viewer presentation, and string metadata error', async () => {
  const pending: components['schemas']['PendingInteraction'] = {
    id: 'pi-1',
    workflow_run_id: 'run/1',
    node_id: 'review',
    tool_use_id: 'toolu_1',
    kind: 'ask',
    status: 'pending',
    envelope: { questions: [{ id: 'q1', prompt: 'Ship?', selection: 'single', options: ['yes'], allowOther: false }] },
    answer: null,
    provider_session_id: 'sess-1',
    created_at: '2026-09-07T00:00:00.000Z',
    resolved_at: null,
    resolved_by: null,
  };
  stubFetch(() =>
    jsonResponse({
      run: { ...detailRun('run/1'), user_id: 'user-1', metadata: { error: 'AskHuman is not supported by provider: grok' } },
      events: [],
      nodeStates: [],
      pending_interactions: [pending],
      usage: null,
      viewer_is_starter: true,
      starter_display_name: 'Avery',
    } satisfies RunDetailResponse)
  );
  const result = await getRun('run/1');
  expect(result.pendingInteractions).toEqual([pending]);
  expect(result.viewerIsStarter).toBe(true);
  expect(result.starterDisplayName).toBe('Avery');
  expect(result.runError).toBe('AskHuman is not supported by provider: grok');

  fetchSpy?.mockRestore();
  stubFetch(() =>
    jsonResponse({
      run: { ...detailRun('run/1'), metadata: { error: { unsafe: true } } },
      events: [],
      nodeStates: [],
      pending_interactions: [],
      usage: null,
      viewer_is_starter: false,
      starter_display_name: null,
    } satisfies RunDetailResponse)
  );
  const nonStringError = await getRun('run/1');
  expect(nonStringError.pendingInteractions).toEqual([]);
  expect(nonStringError.viewerIsStarter).toBe(false);
  expect(nonStringError.starterDisplayName).toBeNull();
  expect(nonStringError.runError).toBeNull();
});
```

- [ ] **Step 2: Run the GET-run Ask-field test and verify RED.**

Run `cd packages/web && bun test src/experiments/console/skills/runs.node-messages.test.ts --test-name-pattern "keeps pending interactions"`.
Expected failure: `pendingInteractions` is missing on the result.

- [ ] **Step 3: Implement the ConsoleRunDetail fields in `getRun`.**

Add the generated type aliases beside the existing run-detail aliases.

```ts
export type PendingInteraction = components['schemas']['PendingInteraction'];
export type AskAnswerBody = components['schemas']['AskAnswerBody'];
export type WorkflowRunActionResponse = components['schemas']['WorkflowRunActionResponse'];
```

Add these properties after `usage` in `ConsoleRunDetail`.

```ts
pendingInteractions: PendingInteraction[];
viewerIsStarter: boolean;
starterDisplayName: string | null;
runError: string | null;
```

Replace the body of `getRun` with this exact mapping.

```ts
export async function getRun(id: string): Promise<ConsoleRunDetail> {
  const res = await requestJson<RunDetailResponse>(
    `/api/workflows/runs/${encodeURIComponent(id)}`
  );
  const approval = res.run.metadata.approval ?? null;
  const metadataError = res.run.metadata.error;
  return {
    run: toRun(res.run),
    events: res.events.map(toRunEvent),
    rawEvents: res.events,
    nodeStates: res.nodeStates,
    approval,
    usage: res.usage,
    pendingInteractions: res.pending_interactions ?? [],
    viewerIsStarter: res.viewer_is_starter === true,
    starterDisplayName: res.starter_display_name,
    runError: typeof metadataError === 'string' ? metadataError : null,
  };
}
```

- [ ] **Step 4: Rerun the GET-run Ask-field test and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/skills/runs.node-messages.test.ts --test-name-pattern "keeps pending interactions"`.
Expected result: PASS.

- [ ] **Step 5: Write the failing answer POST tests.**

Create `runs.ask.test.ts` using the same `spyOn(globalThis, 'fetch')` pattern as `runs.node-messages.test.ts`.

```ts
import { afterEach, expect, spyOn, test } from 'bun:test';
import { HttpError } from '../lib/http';
import { answerAskHuman } from './runs';

type FetchSpy = ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
let fetchSpy: FetchSpy | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (url: string) => Response): FetchSpy {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url));
  }) as typeof fetch);
  return fetchSpy;
}

function ensureWindow(): void {
  if (typeof (globalThis as { window?: { location: { origin: string } } }).window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'http://localhost', hostname: 'localhost' } },
    });
  }
}
```

Add these two tests below the helpers.

```ts
test('answerAskHuman posts an encoded URL and JSON body', async () => {
  stubFetch(url => {
    expect(url).toBe('/api/workflows/runs/run%2F1/ask/toolu%20a/answer');
    return jsonResponse({ success: true, message: 'ok' });
  });
  const result = await answerAskHuman('run/1', 'toolu a', { decline: true });
  expect(result).toEqual({ success: true, message: 'ok' });
  const init = fetchSpy?.mock.calls[0]?.[1] as RequestInit;
  expect(init.method).toBe('POST');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  expect(init.body).toBe(JSON.stringify({ decline: true }));
});

test('answerAskHuman rejects a 409 as HttpError with status 409', async () => {
  ensureWindow();
  stubFetch(() => new Response('taken', { status: 409 }));
  try {
    await answerAskHuman('run/1', 'toolu_1', { answers: [{ questionId: 'q1', value: 'yes' }] });
    throw new Error('expected reject');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
  }
});
```

- [ ] **Step 6: Run the answer POST tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/skills/runs.ask.test.ts`.
Expected failure: `answerAskHuman` is not exported.

- [ ] **Step 7: Add `answerAskHuman` with the locked URL and JSON POST.**

```ts
export async function answerAskHuman(
  runId: string,
  requestId: string,
  body: AskAnswerBody
): Promise<WorkflowRunActionResponse> {
  return requestJson<WorkflowRunActionResponse>(
    `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}
```

- [ ] **Step 8: Rerun both skill files and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/skills/runs.ask.test.ts`.
Expected result: PASS.

- [ ] **Step 9: Format and commit Task 1.**

```bash
bun x prettier --write packages/web/src/experiments/console/skills/runs.ts packages/web/src/experiments/console/skills/runs.node-messages.test.ts packages/web/src/experiments/console/skills/runs.ask.test.ts
git add packages/web/src/experiments/console/skills/runs.ts packages/web/src/experiments/console/skills/runs.node-messages.test.ts packages/web/src/experiments/console/skills/runs.ask.test.ts
git commit -m "feat(web): expose console Ask run fields and answer POST"
```

### Task 2: Duplicate the Ask envelope parser

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/parse-ask-envelope.ts`
- Create: `packages/web/src/experiments/console/components/ask/parse-ask-envelope.test.ts`

**Interfaces:**

- Consumes: `AskAnswerBody` from `../../skills/runs`.
- Produces: `AskQuestion`, `AskDraft`, `parseAskEnvelope`, `parseAskAnswer`, `isQuestionValid`, `isAskDraftValid`, `draftToAnswerBody`.

- [ ] **Step 1: Write the failing parser suite.**

Create the console test by copying the already-approved Story 6.5 behavioral table byte-for-byte.
The test already imports `./parse-ask-envelope`, so it will exercise the console module and fail until that module exists.

```bash
cp packages/web/src/components/workflows/parse-ask-envelope.test.ts \
  packages/web/src/experiments/console/components/ask/parse-ask-envelope.test.ts
```

Before running it, confirm the copied table includes malformed envelopes, duplicate ids, listed and Other choices, empty multi-select, ordered request bodies, decline decoding, and strict extra-key rejection.

- [ ] **Step 2: Run the parser tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/parse-ask-envelope.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Add the parser implementation from the approved Story 6.5 source.**

Copy the implementation, then replace its production API import with the console-owned generated-type re-export.

```bash
cp packages/web/src/components/workflows/parse-ask-envelope.ts \
  packages/web/src/experiments/console/components/ask/parse-ask-envelope.ts
```

The only source change from the copied file is this import.

```ts
import type { AskAnswerBody } from '../../skills/runs';
```

- [ ] **Step 4: Rerun the parser tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/parse-ask-envelope.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 2.**

```bash
bun x prettier --write packages/web/src/experiments/console/components/ask/parse-ask-envelope.ts packages/web/src/experiments/console/components/ask/parse-ask-envelope.test.ts
git add packages/web/src/experiments/console/components/ask/parse-ask-envelope.ts packages/web/src/experiments/console/components/ask/parse-ask-envelope.test.ts
git commit -m "feat(web): parse console Ask envelopes without legacy imports"
```

### Task 3: Add loop-safe Ask selection

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.ts`
- Create: `packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.test.ts`

**Interfaces:**

- Consumes: `PendingInteraction` and `WorkflowNodeMessage` from `../../skills/runs`.
- Produces: `selectVisibleNodeAskInteractions`.

- [ ] **Step 1: Write the failing selector suite.**

Create a focused table with literal expected interaction ids.
Use complete generated-shape fixtures, not partial type assertions.

```ts
import { describe, expect, test } from 'bun:test';
import type { PendingInteraction, WorkflowNodeMessage } from '../../skills/runs';
import { selectVisibleNodeAskInteractions } from './select-visible-node-ask-interactions';

const CREATED_AT = '2026-09-07T00:00:00.000Z';

function interaction(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-1',
    kind: 'ask',
    status: 'pending',
    envelope: { questions: [] },
    answer: null,
    provider_session_id: 'session-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function message(
  id: string,
  seq: number,
  kind: 'text' | 'tool',
  toolId?: string
): WorkflowNodeMessage {
  return kind === 'tool'
    ? {
        id,
        seq,
        kind,
        payload: { name: 'AskHuman', id: toolId ?? id, input: {} },
        created_at: CREATED_AT,
      }
    : { id, seq, kind, payload: { text: id }, created_at: CREATED_AT };
}

describe('selectVisibleNodeAskInteractions', () => {
  test('keeps only visible pending or answered Ask rows for the selected node', () => {
    const all = [message('m1', 1, 'tool', 'tool-1')];
    const selected = selectVisibleNodeAskInteractions({
      pending: [
        interaction(),
        interaction({ id: 'answered', tool_use_id: 'tool-1', status: 'answered' }),
        interaction({ id: 'purged', tool_use_id: 'tool-1', status: 'purged' }),
        interaction({ id: 'permission', tool_use_id: 'tool-1', kind: 'permission' }),
        interaction({ id: 'other-node', node_id: 'ship', tool_use_id: 'tool-1' }),
      ],
      nodeId: 'review',
      allMessages: all,
      visibleMessages: all,
    });
    expect(selected.map(item => item.id)).toEqual(['ask-1', 'answered']);
  });

  test('does not leak an anchored Ask into a different loop slice', () => {
    const first = message('m1', 1, 'tool', 'tool-1');
    const second = message('m2', 2, 'tool', 'tool-2');
    expect(
      selectVisibleNodeAskInteractions({
        pending: [interaction({ tool_use_id: 'tool-1' })],
        nodeId: 'review',
        allMessages: [first, second],
        visibleMessages: [second],
      })
    ).toEqual([]);
  });

  test('shows an unanchored Ask only when the visible slice reaches the transcript tail', () => {
    const first = message('m1', 1, 'text');
    const last = message('m2', 2, 'text');
    const current = interaction({ tool_use_id: 'tool-missing' });
    expect(
      selectVisibleNodeAskInteractions({
        pending: [current],
        nodeId: 'review',
        allMessages: [first, last],
        visibleMessages: [first],
      })
    ).toEqual([]);
    expect(
      selectVisibleNodeAskInteractions({
        pending: [current],
        nodeId: 'review',
        allMessages: [first, last],
        visibleMessages: [last],
      }).map(item => item.id)
    ).toEqual(['ask-1']);
    expect(
      selectVisibleNodeAskInteractions({
        pending: [current],
        nodeId: 'review',
        allMessages: [],
        visibleMessages: [],
      }).map(item => item.id)
    ).toEqual(['ask-1']);
  });
});
```

- [ ] **Step 2: Run the selector tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/select-visible-node-ask-interactions.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Add only the selector and its private helpers.**

Copy `collectToolIds`, `sortedBySeq`, `visibleReachesTranscriptTail`, and `selectVisibleNodeAskInteractions` from `packages/web/src/components/workflows/merge-agent-room-items.ts`.
Do not copy `AgentRoomItem` or `mergeAgentRoomItems` because no console production path calls them.
Use this exact import and replace every `WorkflowNodeMessageResponse` annotation with `WorkflowNodeMessage`.

```ts
import type { PendingInteraction, WorkflowNodeMessage } from '../../skills/runs';
```

- [ ] **Step 4: Rerun the selector tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/select-visible-node-ask-interactions.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 3.**

```bash
bun x prettier --write packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.ts packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.test.ts
git add packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.ts packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.test.ts
git commit -m "feat(web): select visible console Ask interactions"
```

### Task 4: Add the Ask mutation controller

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/ask-answer-controller.ts`
- Create: `packages/web/src/experiments/console/components/ask/ask-answer-controller.test.ts`

**Interfaces:**

- Consumes: `AskAnswerBody`, `WorkflowRunActionResponse`, and console `HttpError`.
- Produces: `AskActionStateByRequest` and `createAskAnswerController`.

- [ ] **Step 1: Write the failing controller suite.**

Copy the approved Story 6.5 suite, switch its API types to `../../skills/runs`, import `HttpError` from `../../lib/http`, and replace the generic 409 fixture with a real console HTTP error.

```bash
cp packages/web/src/components/workflows/ask-answer-controller.test.ts \
  packages/web/src/experiments/console/components/ask/ask-answer-controller.test.ts
```

The changed imports and 409 row are exactly:

```ts
import type { AskAnswerBody, WorkflowRunActionResponse } from '../../skills/runs';
import { HttpError } from '../../lib/http';

// In the rejected/failed table:
{
  name: '409',
  error: new HttpError(409, '/ask', 'taken'),
  expected: { phase: 'rejected-late' },
  invalidateCalls: 1,
}
```

- [ ] **Step 2: Run the controller tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ask-answer-controller.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Add the controller implementation.**

Copy the legacy source, replace the API imports with the console imports below, and replace the 409 condition exactly.

```bash
cp packages/web/src/components/workflows/ask-answer-controller.ts \
  packages/web/src/experiments/console/components/ask/ask-answer-controller.ts
```

```ts
import type { AskAnswerBody, WorkflowRunActionResponse } from '../../skills/runs';
import { HttpError } from '../../lib/http';

// Replace getApiErrorStatus(error) === 409 with:
error instanceof HttpError && error.status === 409
```

- [ ] **Step 4: Rerun the controller tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ask-answer-controller.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 4 from the repository root.**

```bash
bun x prettier --write packages/web/src/experiments/console/components/ask/ask-answer-controller.ts packages/web/src/experiments/console/components/ask/ask-answer-controller.test.ts
git add packages/web/src/experiments/console/components/ask/ask-answer-controller.ts packages/web/src/experiments/console/components/ask/ask-answer-controller.test.ts
git commit -m "feat(web): control console Ask answer mutations"
```

### Task 5: Add canonical and optimistic Ask presentation

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/ask-card-presentation.ts`
- Create: `packages/web/src/experiments/console/components/ask/ask-card-presentation.test.ts`

**Interfaces:**

- Consumes: `PendingInteraction`, `WorkflowNodeState`, `AskActionState`, and `parseAskAnswer`.
- Produces: `AskCardPresentation` and `resolveAskCardPresentation`.

- [ ] **Step 1: Write the failing presentation suite.**

Copy the Story 6.5 table and replace only its generated type import.

```bash
cp packages/web/src/components/workflows/ask-card-presentation.test.ts \
  packages/web/src/experiments/console/components/ask/ask-card-presentation.test.ts
```

```ts
import type { AskAnswerBody, PendingInteraction } from '../../skills/runs';
```

- [ ] **Step 2: Run the presentation tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ask-card-presentation.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Add the presentation implementation.**

Copy the Story 6.5 implementation.
Use the console type import below and replace every `WorkflowNodeStateResponse` reference with `WorkflowNodeState`.

```bash
cp packages/web/src/components/workflows/ask-card-presentation.ts \
  packages/web/src/experiments/console/components/ask/ask-card-presentation.ts
```

```ts
import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowNodeState,
} from '../../skills/runs';
```

- [ ] **Step 4: Rerun parser and presentation tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/parse-ask-envelope.test.ts src/experiments/console/components/ask/ask-card-presentation.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 5 from the repository root.**

```bash
bun x prettier --write packages/web/src/experiments/console/components/ask/ask-card-presentation.ts packages/web/src/experiments/console/components/ask/ask-card-presentation.test.ts
git add packages/web/src/experiments/console/components/ask/ask-card-presentation.ts packages/web/src/experiments/console/components/ask/ask-card-presentation.test.ts
git commit -m "feat(web): derive console Ask card presentation"
```

### Task 6: Derive awaiting state and initial inspect selection

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/awaiting-chrome.ts`
- Create: `packages/web/src/experiments/console/components/ask/awaiting-chrome.test.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/inspect-status.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/inspect-status.test.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts`
- Modify: `packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts`

**Interfaces:**

- Consumes: `InspectStatus`, `WorkflowNodeState`, `PendingInteraction`, `Run['status']`.
- Produces: pending-Ask count, CAP-7 classification, first-awaiting navigation, `awaiting` pass-through, and deterministic initial selection.

- [ ] **Step 1: Write the failing awaiting-chrome suite.**

Copy the Story 6.5 suite, switch its imports to console types, and remove the `nodeStatusLabel` import and three label assertions because `inspectStatusLabel` is the console's existing label owner.

```bash
cp packages/web/src/components/workflows/awaiting-chrome.test.ts \
  packages/web/src/experiments/console/components/ask/awaiting-chrome.test.ts
```

```ts
import type { PendingInteraction, WorkflowNodeState } from '../../skills/runs';
```

- [ ] **Step 2: Run awaiting-chrome tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/awaiting-chrome.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Add the used awaiting helpers.**

Copy `countPendingAsks`, `isAskAwaitingRun`, `firstAwaitingNodeId`, and `isAskHumanUnsupportedError` from the legacy module.
Do not copy `nodeStatusLabel` because console production already owns that behavior in `inspectStatusLabel`.
Use this import.

```ts
import type { Run } from '../../primitives/run';
import type { PendingInteraction, WorkflowNodeState } from '../../skills/runs';
```

Use `Run['status']` for `isAskAwaitingRun` and `WorkflowNodeState` for `firstAwaitingNodeId`.

- [ ] **Step 4: Rerun the awaiting-helper suite and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/awaiting-chrome.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Write failing status, log, and graph-input expectations.**

Replace `maps typed awaiting to running` with these assertions.

```ts
test('passes typed awaiting through', () => {
  expect(inspectStatus('awaiting')).toBe('awaiting');
});

test('labels typed awaiting as waiting on you', () => {
  expect(inspectStatusLabel('awaiting')).toBe('waiting on you');
});

```

Keep `isInspectRunLive` covering only `running` and `paused`.
In `build-console-log-entries.test.ts`, rename `maps awaiting node status to running display status` to `keeps awaiting as the display status` and expect `displayStatus` to equal `'awaiting'`.
In `build-run-graph-input.test.ts`, rename `normalizes awaiting to running before layout` to `passes awaiting through to layout as on-path`, expect the node's `nodeState` to equal `'awaiting'`, and keep `incoming?.taken` equal to `true`.

- [ ] **Step 6: Run the three status-propagation suites and verify RED.**

```bash
cd packages/web
bun test src/experiments/console/components/inspect/inspect-status.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts src/experiments/console/components/graph/build-run-graph-input.test.ts
```

Expected failures are the old `awaiting`-to-`running` normalization in all three consumers.

- [ ] **Step 7: Implement only the status policy.**

Replace `inspect-status.ts` with this exact implementation.

```ts
export type InspectStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'awaiting';

export function inspectStatus(value: string): InspectStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'awaiting'
  ) {
    return value;
  }
  return 'pending';
}

export function inspectStatusLabel(value: string): string {
  return value === 'awaiting' ? 'waiting on you' : value;
}

export function isInspectRunLive(status: string): boolean {
  return status === 'running' || status === 'paused';
}
```

Do not add `isInspectLiveNode` because there is no production caller.

- [ ] **Step 8: Rerun the three status-propagation suites and verify GREEN.**

```bash
cd packages/web
bun test src/experiments/console/components/inspect/inspect-status.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts src/experiments/console/components/graph/build-run-graph-input.test.ts
```

Expected result: PASS.

- [ ] **Step 9: Write failing initial-selection precedence tests.**

Rename the invalid-query selection test to `an invalid query falls back to the first awaiting node` and keep its expected `review` selection.
Add this case to `console-inspect-selection.test.ts`.

```ts
test('awaiting wins over an earlier running node', () => {
  expect(
    resolveInitialInspectSelection({
      requestedNodeId: null,
      nodeStates: [
        nodeState({ nodeId: 'review', name: 'Review', status: 'running' }),
        nodeState({ nodeId: 'ship', name: 'Ship', status: 'awaiting' }),
      ],
      rows: [
        row({ id: 'review-row', nodeId: 'review', status: 'running' }),
        row({ id: 'ship-row', nodeId: 'ship', status: 'awaiting' }),
      ],
      approvalNodeId: null,
    })
  ).toEqual({ nodeId: 'ship', logRowId: 'ship-row' });
});
```

- [ ] **Step 10: Run the initial-selection suite and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/inspect/console-inspect-selection.test.ts`.
Expected failures are approval or running selection winning over the awaiting node.

- [ ] **Step 11: Implement only the awaiting-first selection branch.**

In `resolveInitialInspectSelection`, insert the awaiting lookup before the existing running lookup.

```ts
const awaiting = nodeStates.find(state => inspectStatus(state.status) === 'awaiting');
if (awaiting !== undefined) return selectionForNode(awaiting.nodeId, rows);

const running = nodeStates.find(state => inspectStatus(state.status) === 'running');
if (running !== undefined) return selectionForNode(running.nodeId, rows);
```

- [ ] **Step 12: Run the Task 6 suites and verify GREEN.**

```bash
cd packages/web
bun test src/experiments/console/components/ask/awaiting-chrome.test.ts src/experiments/console/components/inspect/inspect-status.test.ts src/experiments/console/components/inspect/console-inspect-selection.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts src/experiments/console/components/graph/build-run-graph-input.test.ts
```

Expected result: PASS.

- [ ] **Step 13: Format and commit Task 6 from the repository root.**

```bash
bun x prettier --write packages/web/src/experiments/console/components/ask/awaiting-chrome.ts packages/web/src/experiments/console/components/ask/awaiting-chrome.test.ts packages/web/src/experiments/console/components/inspect/inspect-status.ts packages/web/src/experiments/console/components/inspect/inspect-status.test.ts packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts
git add packages/web/src/experiments/console/components/ask/awaiting-chrome.ts packages/web/src/experiments/console/components/ask/awaiting-chrome.test.ts packages/web/src/experiments/console/components/inspect/inspect-status.ts packages/web/src/experiments/console/components/inspect/inspect-status.test.ts packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts
git commit -m "feat(web): preserve console awaiting inspect state"
```

### Task 7: Render awaiting warning chrome in Logs and Graph

**Files:**

- Modify: `packages/web/src/experiments/console/components/NodeDivider.tsx`
- Modify: `packages/web/src/experiments/console/components/NodeDivider.test.tsx`
- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.tsx`
- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx`

**Interfaces:**

- Consumes: the `awaiting` `InspectStatus` and `inspectStatusLabel` from Task 6.
- Produces: warning-colored `waiting on you` chrome in both console renderers.

- [ ] **Step 1: Write failing divider and graph-card tests.**

Add this test to `NodeDivider.test.tsx`.

```ts
test('renders awaiting as warning waiting-on-you chrome', async () => {
  await act(async () => {
    renderDivider({ status: 'awaiting' });
  });
  const status = [...host.querySelectorAll('span')].find(
    item => (item.textContent ?? '').trim() === 'waiting on you · 00:01 · $0.25 / ≈$0.30 · 2t'
  );
  expect(status).toBeDefined();
  expect(status?.className).toContain('text-warning');
});
```

Add an awaiting node to the graph-panel test fixture and assert the real card's output and styling.

```ts
const waitingCard = host.querySelector('[data-node-id="review"]');
expect(waitingCard?.textContent).toContain('waiting on you');
expect(waitingCard?.getAttribute('title')).toContain('waiting on you');
expect(waitingCard?.className).toContain('animate-[pulse_2.4s_ease-in-out_infinite]');
expect(waitingCard?.className).toContain('motion-reduce:animate-none');
expect(waitingCard?.querySelector('span[aria-hidden]')?.className).toContain('text-warning');
```

Set `review` to `awaiting` in that test only so the existing route, selection, and zoom coverage remains independent.

- [ ] **Step 2: Run both suites and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx`.
Expected failures are the missing divider status member and the graph card falling back to pending chrome.

- [ ] **Step 3: Implement the divider and graph status branches.**

Add `'awaiting'` to `NodeDividerProps['status']` and to both maps.

```ts
awaiting: 'waiting on you',
```

```ts
awaiting: 'text-warning',
```

Add `'awaiting'` to `InspectCardStatus` and `cardStatus`.
Add these exact switch branches.

```ts
// statusFill
case 'awaiting':
  return 'color-mix(in oklch, var(--warning), transparent 90%)';

// statusBorder
case 'awaiting':
  return 'color-mix(in oklch, var(--warning), transparent 40%)';

// statusGlyphClass
case 'awaiting':
  return 'text-warning';
```

Replace the graph-card animation expression with this exact branch.

```ts
${
  status === 'running'
    ? 'animate-pulse'
    : status === 'awaiting'
      ? 'animate-[pulse_2.4s_ease-in-out_infinite] motion-reduce:animate-none'
      : ''
}
```

- [ ] **Step 4: Rerun both suites and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 7 from the repository root.**

```bash
bun x prettier --write packages/web/src/experiments/console/components/NodeDivider.tsx packages/web/src/experiments/console/components/NodeDivider.test.tsx packages/web/src/experiments/console/components/RunGraphPanel.tsx packages/web/src/experiments/console/components/RunGraphPanel.test.tsx
git add packages/web/src/experiments/console/components/NodeDivider.tsx packages/web/src/experiments/console/components/NodeDivider.test.tsx packages/web/src/experiments/console/components/RunGraphPanel.tsx packages/web/src/experiments/console/components/RunGraphPanel.test.tsx
git commit -m "feat(web): render console awaiting warning chrome"
```

### Task 8: Build the console Ask card

**Files:**

- Modify: `packages/web/src/experiments/console/lib/format.ts`
- Modify: `packages/web/src/experiments/console/lib/format.test.ts`
- Create: `packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx`
- Create: `packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx`

**Interfaces:**

- Consumes: `ConsoleAskCardProps`, parser, presentation, `formatDurationMs`.
- Produces: `ConsoleAskCard` and `ConsoleInvalidAskCard`.

- [ ] **Step 1: Write the failing duration-format boundary test.**

Import `formatDurationMs` in `packages/web/src/experiments/console/lib/format.test.ts` and add this table.

```ts
describe('formatDurationMs', () => {
  test('formats millisecond, second, and minute boundaries', () => {
    expect(formatDurationMs(0)).toBe('0ms');
    expect(formatDurationMs(999)).toBe('999ms');
    expect(formatDurationMs(1000)).toBe('1.0s');
    expect(formatDurationMs(59999)).toBe('60.0s');
    expect(formatDurationMs(60000)).toBe('1.0m');
    expect(formatDurationMs(90000)).toBe('1.5m');
  });
});
```

- [ ] **Step 2: Run the formatter test and verify RED.**

Run `cd packages/web && bun test src/experiments/console/lib/format.test.ts --test-name-pattern "formatDurationMs"`.
Expected failure: `formatDurationMs` is not exported.

- [ ] **Step 3: Add `formatDurationMs` with the locked body and verify GREEN.**

Add this exact export to `packages/web/src/experiments/console/lib/format.ts`.

```ts
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
```

Run `cd packages/web && bun test src/experiments/console/lib/format.test.ts --test-name-pattern "formatDurationMs"`.
Expected result: PASS.

- [ ] **Step 4: Write the failing console card suite from the approved Story 6.5 suite.**

Copy the complete legacy suite so every lifecycle and validity row remains literal and mutation-sensitive.

```bash
cp packages/web/src/components/workflows/AskCard.test.tsx \
  packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx
```

Apply these exact test-only substitutions.

```ts
import type { AskAnswerBody, PendingInteraction } from '../../skills/runs';
import { formatDurationMs } from '../../lib/format';
import type { ConsoleAskCardProps } from './ConsoleAskCard';
import type { AskCardPresentation } from './ask-card-presentation';
import type { AskQuestion } from './parse-ask-envelope';
```

Rename the component module to `./ConsoleAskCard`, `AskCardProps` to `ConsoleAskCardProps`, the `AskCard` export to `ConsoleAskCard`, and the `InvalidAskCard` export to `ConsoleInvalidAskCard`.
Keep the existing complete fixtures, static state table, full-draft submission assertion, Other identity assertion, and focus assertion.
In the decline test, query `dialog`, assert `dialog.open` is `true` after the first Decline click, assert the exact description, click Cancel and assert `dialog.open` is `false`, reopen it, click the dialog's Decline button, and assert `onDecline` ran exactly once while `onSubmit` never ran.
The test's first physical statement remains `process.env.NODE_ENV = 'development';`.

- [ ] **Step 5: Run the card suite and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ConsoleAskCard.test.tsx`.
Expected failure: the console card module does not exist.

- [ ] **Step 6: Add the console-owned card implementation.**

Start from `packages/web/src/components/workflows/AskCard.tsx` so the approved state, summary, validity, payload, focus, and copy logic stays identical.
Use only these imports.

```ts
import { useMemo, useRef, useState } from 'react';
import type { AskAnswerBody, PendingInteraction } from '../../skills/runs';
import { ensureUtc, formatDurationMs } from '../../lib/format';
import type { AskCardPresentation } from './ask-card-presentation';
import {
  draftToAnswerBody,
  isAskDraftValid,
  type AskDraft,
  type AskQuestion,
} from './parse-ask-envelope';
```

Rename `AskCardProps` to `ConsoleAskCardProps`, `AskCard` to `ConsoleAskCard`, and `InvalidAskCard` to `ConsoleInvalidAskCard`.
Copy `elapsedWaitingMs`, `formatAnswerValue`, `answerSummaries`, `PayloadDisclosure`, `ResolvedStamp`, the four draft-state maps, the `useMemo` draft projection, `draftValid`, `isPending`, `lockAnswers`, `showActions`, `waitingLabel`, every choice handler, and `handleSubmit` without behavioral changes.
Replace the legacy `declineOpen` state with this native-dialog control.

```ts
const declineDialogRef = useRef<HTMLDialogElement | null>(null);

function openDeclineDialog(): void {
  declineDialogRef.current?.showModal();
}

function closeDeclineDialog(): void {
  declineDialogRef.current?.close();
}
```

Replace `Card`, `CardHeader`, `CardContent`, and `CardFooter` with plain `div` elements while retaining their children.
The outer elevated surface is:

```tsx
<div className="rounded-lg border border-warning bg-surface-elevated shadow-sm">
```

Use `p-4` on the header, `space-y-4 px-4 pb-4` on the content, and `flex flex-col items-stretch gap-3 px-4 pb-4` on the footer.
Replace every shadcn `Button` with a native `button` carrying the same `type`, disabled rule, click handler, and visible copy.
Keep the nested `fieldset`, `legend`, radio, checkbox, Other `textarea`, disabled behavior, auto-focus rule, summaries, semantic `time`, inline error, and payload disclosure exactly as specified in Locked Design and as exercised by the copied test.
Replace the legacy AlertDialog subtree with this exact native confirmation inside the starter-actions branch.

```tsx
<button
  type="button"
  className="rounded-md border border-border px-3 py-2 text-sm text-text-primary"
  onClick={openDeclineDialog}
>
  Decline
</button>
<dialog
  ref={declineDialogRef}
  role="dialog"
  aria-modal="true"
  aria-labelledby={`${interaction.id}:decline-title`}
  aria-describedby={`${interaction.id}:decline-description`}
  className="rounded-lg border border-border bg-surface-elevated p-4 text-text-primary"
>
  <h2 id={`${interaction.id}:decline-title`} className="text-sm font-medium">
    Decline this ask?
  </h2>
  <p
    id={`${interaction.id}:decline-description`}
    className="mt-2 text-sm text-text-secondary"
  >
    The agent will be told you declined
  </p>
  <div className="mt-4 flex justify-end gap-2">
    <button type="button" onClick={closeDeclineDialog}>
      Cancel
    </button>
    <button
      type="button"
      onClick={(): void => {
        closeDeclineDialog();
        onDecline();
      }}
    >
      Decline
    </button>
  </div>
</dialog>
```

The `aria-labelledby` and `aria-describedby` values are template literals using `${interaction.id}`.
The explicit `role="dialog"` is required because `packages/web/src/experiments/console/lib/keymap.ts` suppresses route shortcuts only for `[role="dialog"][aria-modal="true"]`.
Do not import `@/components/ui/*` or any legacy workflow module.

- [ ] **Step 7: Rerun formatter and card suites and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/lib/format.test.ts src/experiments/console/components/ask/ConsoleAskCard.test.tsx`.
Expected result: PASS with no React warnings.

- [ ] **Step 8: Format and commit Task 8 from the repository root.**

```bash
bun x prettier --write packages/web/src/experiments/console/lib/format.ts packages/web/src/experiments/console/lib/format.test.ts packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx
git add packages/web/src/experiments/console/lib/format.ts packages/web/src/experiments/console/lib/format.test.ts packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx
git commit -m "feat(web): render console-owned Ask cards"
```

### Task 9: Build the console run Ask chrome

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx`
- Create: `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.test.tsx`

**Interfaces:**

- Consumes: `ConsoleAskChromeProps` and awaiting-chrome helpers.
- Produces: the run-level pill and CAP-7 banner.

- [ ] **Step 1: Write the failing chrome suite.**

Copy the approved Story 6.5 component test.

```bash
cp packages/web/src/components/workflows/WorkflowAskChrome.test.tsx \
  packages/web/src/experiments/console/components/ask/ConsoleAskChrome.test.tsx
```

Switch `PendingInteraction` and `WorkflowNodeStateResponse` to `PendingInteraction` and `WorkflowNodeState` from `../../skills/runs`.
Rename the imported module to `./ConsoleAskChrome`, `WorkflowAskChromeProps` to `ConsoleAskChromeProps`, and the rendered export to `ConsoleAskChrome`.
Retain the literal cases for the count, callback order, no-node no-op, CAP-7 banner, and declared-gate null render.

- [ ] **Step 2: Run the chrome tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ConsoleAskChrome.test.tsx`.
Expected failure: module not found.

- [ ] **Step 3: Add `ConsoleAskChrome` from the approved legacy shell.**

Copy the legacy implementation, then make these exact type and name substitutions.

```bash
cp packages/web/src/components/workflows/WorkflowAskChrome.tsx \
  packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx
```

```ts
import type { Run } from '../../primitives/run';
import type { PendingInteraction, WorkflowNodeState } from '../../skills/runs';
```

Rename `WorkflowAskChromeProps` to `ConsoleAskChromeProps` and `WorkflowAskChrome` to `ConsoleAskChrome`.
Use `Run['status']` for `status` and `readonly WorkflowNodeState[]` for `nodeStates`.
Keep the error-first branch, null branch, guarded node lookup, callback order, exact copy, and warning/error classes byte-for-byte.
Add `mx-6 mt-3 w-fit` to both returned roots so the component sits directly below `RunDetailHeader` without an empty wrapper when it returns `null`.

- [ ] **Step 4: Rerun the chrome tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ConsoleAskChrome.test.tsx`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 9 from the repository root.**

```bash
bun x prettier --write packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx packages/web/src/experiments/console/components/ask/ConsoleAskChrome.test.tsx
git add packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx packages/web/src/experiments/console/components/ask/ConsoleAskChrome.test.tsx
git commit -m "feat(web): add console Ask awaiting pill and CAP-7 banner"
```

### Task 10: Place Ask cards in the Command Center agent room

**Files:**

- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`

**Interfaces:**

- Consumes: required Ask props, `selectNodeRoomMessages`, `selectVisibleNodeAskInteractions`, `ConsoleAskCard`.
- Produces: cards inline at tool invocation in the persistent room.

- [ ] **Step 1: Write the failing room placement tests.**

Remove `assertNoEpicSix`.
Replace it with a helper that asserts the room contains neither `ChatComposer` nor `Reply…`.
Extend the `runs` type import with `AskAnswerBody` and `PendingInteraction` and add this complete fixture.

```ts
function ask(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-1',
    kind: 'ask',
    status: 'pending',
    envelope: {
      questions: [
        {
          id: 'q1',
          prompt: 'Ship it?',
          selection: 'single',
          options: ['Ship', 'Hold'],
          allowOther: false,
        },
      ],
    },
    answer: null,
    provider_session_id: 'session-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}
```

Add `pendingInteractions: []`, `viewerIsStarter: true`, `starterDisplayName: 'Avery'`, `actionStates: {}`, and an async no-op `onSubmitAsk` to the existing `renderRoom` defaults.
Then add literal tests for these room-only responsibilities.

```ts
test('places independent anchored Ask cards after their tool rows', async () => {
  const messages: WorkflowNodeMessage[] = [
    ...FIXTURE,
    {
      id: 'm9',
      seq: 9,
      kind: 'tool',
      payload: { name: 'AskHuman', id: 'tool-2', input: {} },
      created_at: CREATED_AT,
    },
  ];
  await act(async () => {
    renderRoom({
      selectedRow: row({ nodeId: 'review', label: 'Review', status: 'awaiting' }),
      nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'awaiting' })],
      pendingInteractions: [
        ask(),
        ask({ id: 'ask-2', tool_use_id: 'tool-2' }),
      ],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages }),
    });
  });
  await flushUntil('two Ask cards', () => host.querySelectorAll('form').length === 2);
  const firstTool = [...host.querySelectorAll('span')].find(
    item => (item.textContent ?? '').trim() === 'Read'
  );
  const firstCard = host.querySelector('form');
  expect(firstTool).toBeDefined();
  expect(firstCard).not.toBeNull();
  expect((firstTool?.compareDocumentPosition(firstCard) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING)
    .not.toBe(0);
  expect(host.textContent).toContain('waiting on you');
  assertNoConversationComposer(host);
});

test('appends an unanchored Ask for an empty transcript and keeps it on fetch error', async () => {
  await act(async () => {
    renderRoom({
      pendingInteractions: [ask({ tool_use_id: 'not-yet-persisted' })],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
    });
  });
  await flushUntil('empty transcript Ask', () => host.querySelector('form') !== null);
  expect(host.textContent).not.toContain("Node hasn't produced output");

  invalidate('run-node-messages');
  await act(async () => {
    renderRoom({
      run: run({ id: 'run-error-ask' }),
      pendingInteractions: [ask({ workflow_run_id: 'run-error-ask', tool_use_id: 'missing' })],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => {
        throw new Error('boom');
      },
    });
  });
  await flushUntil('error and Ask', () =>
    (host.textContent ?? '').includes('Failed to load node transcript')
  );
  expect(host.querySelector('form')).not.toBeNull();
  expect(host.textContent).toContain('Retry');
});

test('maps malformed and teammate cards but never renders Ask in stdout rooms', async () => {
  await act(async () => {
    renderRoom({
      viewerIsStarter: false,
      pendingInteractions: [ask({ envelope: { broken: true } })],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: FIXTURE }),
    });
  });
  await flushUntil('invalid Ask', () => (host.textContent ?? '').includes('Invalid Ask payload'));
  expect(host.textContent).not.toContain('Submit');

  await act(async () => {
    renderRoom({
      viewerIsStarter: false,
      pendingInteractions: [ask()],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: FIXTURE }),
    });
  });
  await flushUntil('teammate Ask', () =>
    (host.textContent ?? '').includes('Waiting for Avery to answer')
  );
  expect(host.textContent).not.toContain('Submit');
  expect(host.textContent).not.toContain('Decline');

  await act(async () => {
    renderRoom({
      nodeId: 'setup',
      selectedRow: row({ nodeId: 'setup', label: 'Setup' }),
      definitionNodes: [{ id: 'setup', bash: 'echo ok' }],
      nodeStates: [nodeState({ nodeId: 'setup', name: 'Setup', status: 'completed' })],
      pendingInteractions: [ask({ node_id: 'setup' })],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
    });
  });
  await flush();
  expect(host.querySelector('form')).toBeNull();
});
```

Keep the existing loop-slice test and change its awaiting header expectation from `running` to `waiting on you`.
The pure Task 3 suite remains the mutation guard for cross-iteration, permission, purged, and transcript-tail selection.

- [ ] **Step 2: Run ConsoleNodeRoom tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx`.
Expected failure: Ask cards are absent or header still says `running`.

- [ ] **Step 3: Implement generic transcript slots and agent-only Ask composition in `ConsoleNodeRoom`.**

Change `AgentTranscript` to this generic slot contract.

```tsx
function AgentTranscript({
  messages,
  renderAfterMessage,
  renderAtEnd,
}: {
  messages: readonly WorkflowNodeMessage[];
  renderAfterMessage?: (message: WorkflowNodeMessage) => ReactNode;
  renderAtEnd?: ReactNode;
}): ReactElement {
  if (messages.length === 0) {
    return renderAtEnd === undefined ? (
      <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">{renderAtEnd}</div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {messages.map(message => (
        <div key={message.id}>
          {renderTranscriptItem(message)}
          {renderAfterMessage?.(message)}
        </div>
      ))}
      {renderAtEnd}
    </div>
  );
}
```

Add the required Ask props from Locked Design to `ConsoleNodeRoomProps`.
Import the console card, parser, selector, presentation resolver, and action-state types only from `./ask/*`.
After `row` is derived, compute `allMessages` as an empty array on query error, compute `visibleMessages` with `selectNodeRoomMessages`, and compute `visibleAsks` with `selectVisibleNodeAskInteractions` only for `resolution.kind === 'agent'`.
Split `visibleAsks` into anchored and unanchored arrays using the visible transcript's tool ids.
Build `orderedAsks` in visible-message order followed by unanchored GET order.
Choose `firstActionableId` as the first row for which the viewer is starter, status is pending, the envelope parses, and `resolveAskCardPresentation(...).viewState` is pending.
Use `row.label`, `row.nodeId`, and one `const nowMs = Date.now()` for every card in that render.
For a valid row, pass the exact card props from Locked Design and call `void onSubmitAsk(interaction.tool_use_id, body)` or `void onSubmitAsk(interaction.tool_use_id, { decline: true })`.
For a malformed row, render `ConsoleInvalidAskCard`.
Pass anchored cards through `renderAfterMessage` only when the message is a matching tool row, and pass unanchored cards through `renderAtEnd`.
Loading continues to render only `Loading node transcript`.
In the error branch, keep the existing error and Retry controls inside a wrapper and render the unanchored card array immediately after that wrapper.

Add this local helper beside the transcript helpers.

```ts
function collectToolIds(messages: readonly WorkflowNodeMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool') {
      ids.add(message.payload.id);
    }
  }
  return ids;
}
```

Use this exact derivation.

```tsx
const allMessages = messagesQuery.error === undefined ? (messagesQuery.data?.messages ?? []) : [];
const visibleMessages =
  row === null ? [] : selectNodeRoomMessages(allMessages, row.selection);
const visibleAsks =
  row !== null && resolution?.kind === 'agent'
    ? selectVisibleNodeAskInteractions({
        pending: pendingInteractions,
        nodeId: row.nodeId,
        allMessages,
        visibleMessages,
      })
    : [];
const visibleToolIds = collectToolIds(visibleMessages);
const anchoredAsks = visibleAsks.filter(interaction =>
  visibleToolIds.has(interaction.tool_use_id)
);
const unanchoredAsks = visibleAsks.filter(
  interaction => !visibleToolIds.has(interaction.tool_use_id)
);
const orderedAsks = [
  ...visibleMessages.flatMap(message =>
    message.kind === 'tool'
      ? anchoredAsks.filter(interaction => interaction.tool_use_id === message.payload.id)
      : []
  ),
  ...unanchoredAsks,
];
const selectedNodeState =
  row === null ? undefined : nodeStates.find(state => state.nodeId === row.nodeId);
const firstActionableId = orderedAsks.find(interaction => {
  if (!viewerIsStarter || interaction.status !== 'pending') return false;
  if (parseAskEnvelope(interaction.envelope) === null) return false;
  return (
    resolveAskCardPresentation({
      interaction,
      action: actionStates[interaction.tool_use_id],
      nodeStatus: selectedNodeState?.status,
      nodeError: selectedNodeState?.error,
    }).viewState === 'pending'
  );
})?.id;
const nowMs = Date.now();
const agentDisplayName = row?.label ?? '';
const roomNodeId = row?.nodeId ?? '';

const renderAskCard = (interaction: PendingInteraction): ReactElement => {
  const questions = parseAskEnvelope(interaction.envelope);
  if (questions === null) {
    return (
      <ConsoleInvalidAskCard
        key={interaction.id}
        interaction={interaction}
        agentDisplayName={agentDisplayName}
        nodeId={roomNodeId}
      />
    );
  }
  const requestId = interaction.tool_use_id;
  return (
    <ConsoleAskCard
      key={interaction.id}
      interaction={interaction}
      questions={questions}
      presentation={resolveAskCardPresentation({
        interaction,
        action: actionStates[requestId],
        nodeStatus: selectedNodeState?.status,
        nodeError: selectedNodeState?.error,
      })}
      viewerIsStarter={viewerIsStarter}
      starterDisplayName={starterDisplayName}
      agentDisplayName={agentDisplayName}
      nodeId={roomNodeId}
      autoFocus={interaction.id === firstActionableId}
      nowMs={nowMs}
      onSubmit={(body): void => {
        void onSubmitAsk(requestId, body);
      }}
      onDecline={(): void => {
        void onSubmitAsk(requestId, { decline: true });
      }}
    />
  );
};
```

Keep the loading branch before either slot is rendered.
Replace the successful agent body with this exact call.

```tsx
body = (
  <AgentTranscript
    messages={visibleMessages}
    renderAfterMessage={(message: WorkflowNodeMessage): ReactNode =>
      message.kind === 'tool'
        ? anchoredAsks
            .filter(interaction => interaction.tool_use_id === message.payload.id)
            .map(renderAskCard)
        : undefined
    }
    renderAtEnd={
      unanchoredAsks.length === 0 ? undefined : unanchoredAsks.map(renderAskCard)
    }
  />
);
```

Replace the agent error body with this exact wrapper so authoritative pending rows stay actionable during a transcript fetch failure.

```tsx
body = (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[13px] text-text-secondary">
      <p>Failed to load node transcript</p>
      <button
        type="button"
        className="text-[12px] text-primary transition-colors hover:text-accent-bright"
        onClick={(): void => {
          messagesQuery.refetch();
        }}
      >
        Retry
      </button>
    </div>
    {unanchoredAsks.length === 0 ? null : (
      <div className="flex flex-col gap-3 p-3">{unanchoredAsks.map(renderAskCard)}</div>
    )}
  </div>
);
```

- [ ] **Step 4: Extend `ConsoleInspectPane.test.tsx` so switching Log to Graph does not remount the room and the Ask card remains.**

Add the five Ask props to `ConsoleInspectPaneProps` as optional for this task only, destructure them with `[]`, `false`, `null`, `{}`, and an async no-op defaults, and pass the resulting values unchanged into `ConsoleNodeRoom`.
Extend the pane test's run-skill type import with `PendingInteraction` and add these exact defaults to `baseProps`.

```ts
pendingInteractions: [],
viewerIsStarter: true,
starterDisplayName: 'Avery',
actionStates: {},
onSubmitAsk: async (): Promise<void> => undefined,
```

In the pane persistence test, add this complete unanchored row before creating `props`.

```ts
const pendingAsk: PendingInteraction = {
  id: 'ask-plan',
  workflow_run_id: 'run-1',
  node_id: 'plan',
  tool_use_id: 'tool-not-persisted',
  kind: 'ask',
  status: 'pending',
  envelope: {
    questions: [
      {
        id: 'q1',
        prompt: 'Ship it?',
        selection: 'single',
        options: ['Ship', 'Hold'],
        allowOther: false,
      },
    ],
  },
  answer: null,
  provider_session_id: 'session-1',
  created_at: CREATED_AT,
  resolved_at: null,
  resolved_by: null,
};
const props = baseProps({ loadMessages, pendingInteractions: [pendingAsk] });
```

After the initial transcript flush, record `const formBefore = host.querySelector('form');` and assert it is non-null.
After the Log-to-Graph switch, assert `host.querySelector('form')` is exactly `formBefore` in addition to the existing room and loader identity assertions.

- [ ] **Step 5: Rerun room and pane tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx`.
Expected result: PASS.

- [ ] **Step 6: Format and commit Task 10 from the repository root.**

```bash
bun x prettier --write packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx
git add packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx
git commit -m "feat(web): place Ask cards in the console agent room"
```

### Task 11: Wire run-detail ownership, chrome, and composer isolation

**Files:**

- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.tsx`
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx`

**Interfaces:**

- Consumes: `ConsoleRunDetail` Ask fields, `createAskAnswerController`, `answerAskHuman`, `ConsoleAskChrome`.
- Produces: page-owned mutation, header chrome, graph jump, gate-only keymap.

- [ ] **Step 1: Write the failing header copy test.**

Extend the local `renderHeader` helper with `askAwaiting?: boolean` and add:

```ts
test('uses Awaiting input only for an Ask pause', () => {
  const ask = renderHeader({
    usage: usage(),
    runOverrides: { status: 'paused' },
    askAwaiting: true,
  });
  expect(ask).toContain('Awaiting input');
  expect(ask).not.toContain('Waiting for approval');

  const gate = renderHeader({
    usage: usage(),
    runOverrides: { status: 'paused' },
    askAwaiting: false,
  });
  expect(gate).toContain('Waiting for approval');
  expect(gate).not.toContain('Awaiting input');
});
```

- [ ] **Step 2: Run header tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/RunDetailHeader.test.tsx --test-name-pattern "Awaiting input"`.
Expected failure: copy still `Waiting for approval`.

- [ ] **Step 3: Add the header prop and minimal conditional copy.**

Add `askAwaiting?: boolean` to `RunDetailHeaderProps`, default it to `false` in the destructuring, and replace the status label expression with:

```tsx
{isPaused && askAwaiting ? 'Awaiting input' : statusLabel[run.status]}
```

- [ ] **Step 4: Write failing RunDetailPage tests.**

Replace the existing run-skill type import with this exact import.

```ts
import type {
  PendingInteraction,
  RunDetailResponse,
  WorkflowEvent,
  WorkflowNodeState,
} from '../skills/runs';
```

Add the request record beside the other mutable test state, reset it in `beforeEach`, and add the complete fixture below beside `nodeState`.

```ts
let answerPosts: Array<{ path: string; body: unknown }> = [];

// In beforeEach:
answerPosts = [];

function ask(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: runId,
    node_id: 'review',
    tool_use_id: 'tool-1',
    kind: 'ask',
    status: 'pending',
    envelope: {
      questions: [
        {
          id: 'q1',
          prompt: 'Ship it?',
          selection: 'single',
          options: ['Ship', 'Hold'],
          allowOther: false,
        },
      ],
    },
    answer: null,
    provider_session_id: 'session-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}
```

Extend `stubPageFetch` options with these exact fields.

```ts
pendingInteractions?: PendingInteraction[];
viewerIsStarter?: boolean;
starterDisplayName?: string | null;
```

Replace the GET-run response defaults with these values.

```ts
pending_interactions: options.pendingInteractions ?? [],
usage: null,
viewer_is_starter: options.viewerIsStarter ?? false,
starter_display_name: options.starterDisplayName ?? null,
```

Extend the fetch mock implementation signature to accept `init`, and add this branch before the final unmocked response.

```ts
if (
  path.startsWith(`/api/workflows/runs/${encodeURIComponent(runId)}/ask/`) &&
  path.endsWith('/answer')
) {
  if (init?.method !== 'POST') throw new Error('Ask answer must use POST');
  if (new Headers(init.headers).get('Content-Type') !== 'application/json') {
    throw new Error('Ask answer must use JSON');
  }
  if (typeof init.body !== 'string') throw new Error('Ask answer body must be JSON text');
  answerPosts.push({ path, body: JSON.parse(init.body) as unknown });
  return Promise.resolve(jsonResponse({ success: true, message: 'ok' }));
}
```

The updated mock callback signature is `(input: RequestInfo | URL, init?: RequestInit)` and the outer cast remains `as typeof fetch`.
Then add these integration cases.

```ts
test('jumps to an awaiting room, answers through the skill, and keeps gate keys inactive', async () => {
  const pending = ask();
  stubPageFetch({
    status: 'paused',
    nodeStates: [
      nodeState({ nodeId: 'review', name: 'Review', status: 'awaiting' }),
      nodeState({ nodeId: 'build', name: 'Build', status: 'running' }),
    ],
    pendingInteractions: [pending],
    viewerIsStarter: true,
    starterDisplayName: 'Avery',
  });
  await act(async () => {
    renderPage('?node=build');
  });
  await flushUntil('awaiting chrome', () =>
    (host.textContent ?? '').includes('Awaiting input (1)')
  );

  await act(async () => {
    tabButton('Awaiting input (1)').click();
  });
  await flushUntil(
    'review Ask room',
    () =>
      host.querySelector('[data-testid="console-run-graph-scroller"]') !== null &&
      host.querySelector('[aria-label="review room"] form') !== null
  );
  expect(locationSearch()).toContain('node=review');

  const choice = host.querySelector('input[type="radio"][value="Ship"]');
  if (!(choice instanceof HTMLInputElement)) throw new Error('missing Ship choice');
  await act(async () => {
    choice.click();
  });
  const submit = [...host.querySelectorAll('button')].find(
    button => (button.textContent ?? '').trim() === 'Submit'
  );
  if (!(submit instanceof HTMLButtonElement)) throw new Error('missing Submit');
  expect(submit.disabled).toBe(false);
  await act(async () => {
    submit.click();
  });
  await flushUntil('accepted answer', () => (host.textContent ?? '').includes('Answered · by you'));
  expect(answerPosts).toEqual([
    {
      path: `/api/workflows/runs/${encodeURIComponent(runId)}/ask/tool-1/answer`,
      body: { answers: [{ questionId: 'q1', value: 'Ship' }] },
    },
  ]);

  document.body.focus();
  const approveKey = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
  const rejectKey = new KeyboardEvent('keydown', { key: 'r', cancelable: true });
  window.dispatchEvent(approveKey);
  window.dispatchEvent(rejectKey);
  expect(approveKey.defaultPrevented).toBe(false);
  expect(rejectKey.defaultPrevented).toBe(false);
  expect(host.textContent).not.toContain('Reply…');
});

test('renders CAP-7 failure as error chrome without an awaiting pill', async () => {
  const message = 'AskHuman is not supported by provider: grok';
  stubPageFetch({ status: 'failed', metadata: { error: message } });
  await act(async () => {
    renderPage();
  });
  await flushUntil('CAP-7 banner', () => (host.textContent ?? '').includes(message));
  const alert = host.querySelector('[role="alert"]');
  expect(alert?.className).toContain('text-error');
  expect(host.textContent).not.toContain('Awaiting input (');
});
```

Keep the existing paused Plannotator test as the declared-gate regression and assert it still renders `Waiting for approval` with no Ask pill.

- [ ] **Step 5: Run RunDetailPage tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/routes/RunDetailPage.test.tsx`.
Expected failure: Ask chrome and controller are unwired.

- [ ] **Step 6: Implement page-owned state, controller, chrome, and prop wiring.**

Add these console-owned imports and replace the existing `../skills/runs` type import with the exact import below.

```ts
import { ConsoleAskChrome } from '../components/ask/ConsoleAskChrome';
import {
  createAskAnswerController,
  type AskActionState,
  type AskActionStateByRequest,
} from '../components/ask/ask-answer-controller';
import { isAskAwaitingRun } from '../components/ask/awaiting-chrome';
import type { AskAnswerBody, ArtifactFile, ConsoleRunDetail } from '../skills/runs';
```

Keep state keyed by the route run id so navigation cannot display an old request id for one paint.

```ts
const [askActions, setAskActions] = useState<{
  runId: string | undefined;
  states: AskActionStateByRequest;
}>({ runId, states: {} });
const actionStates = askActions.runId === runId ? askActions.states : {};
const selectedNodeIdRef = useRef<string | null>(null);
selectedNodeIdRef.current = inspectSelection.nodeId;

const setAskActionState = useCallback(
  (requestId: string, state: AskActionState): void => {
    setAskActions(current => ({
      runId,
      states: {
        ...(current.runId === runId ? current.states : {}),
        [requestId]: state,
      },
    }));
  },
  [runId]
);

const askController = useMemo(
  () =>
    runId === undefined
      ? null
      : createAskAnswerController({
          runId,
          postAnswer: skill.answerAskHuman,
          setActionState: setAskActionState,
          invalidate: async (): Promise<void> => {
            invalidate(K.run(runId));
            const selectedNodeId = selectedNodeIdRef.current;
            if (selectedNodeId !== null) {
              invalidate(K.nodeMessages(runId, selectedNodeId));
            }
          },
          now: (): Date => new Date(),
        }),
  [runId, setAskActionState]
);

const submitAsk = useCallback(
  (requestId: string, body: AskAnswerBody): Promise<void> =>
    askController?.submit(requestId, body) ?? Promise.resolve(),
  [askController]
);
```

Keep these hooks above all early returns.
In the same change, remove the temporary optional markers and defaults from the five `ConsoleInspectPane` Ask props so they match the required final contract in Locked Design.
Pass `pendingInteractions`, `viewerIsStarter`, `starterDisplayName`, `actionStates`, and `submitAsk` into `ConsoleInspectPane`.
Render the chrome immediately after `RunDetailHeader`.

```tsx
<RunDetailHeader
  run={run}
  projectId={projectId}
  projectName={project?.name ?? projectId}
  usage={detail.usage}
  askAwaiting={isAskAwaitingRun(run.status, detail.pendingInteractions)}
/>
<ConsoleAskChrome
  status={run.status}
  pendingInteractions={detail.pendingInteractions}
  nodeStates={inspectNodeStates}
  runError={detail.runError}
  onRequestGraphView={(): void => {
    setViewPersist('graph');
  }}
  onSelectAwaitingNode={(nodeId: string): void => {
    onInspectSelect(nodeId);
  }}
/>
```

Add `const hasDeclaredGate = isPaused && detail?.run.approval != null;` beside `isPaused`.
Change both `a` and `r` binding predicates to `(): boolean => hasDeclaredGate` and replace `isPaused` with `hasDeclaredGate` in the binding memo dependencies.
Do not add Ask props to `ChatComposer`, `ChatPage`, `RunActionBar`, or the declared-gate footer.

- [ ] **Step 7: Rerun header and page tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/RunDetailHeader.test.tsx src/experiments/console/routes/RunDetailPage.test.tsx`.
Expected result: PASS.

- [ ] **Step 8: Format and commit Task 11 from the repository root.**

```bash
bun x prettier --write packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx packages/web/src/experiments/console/components/RunDetailHeader.tsx packages/web/src/experiments/console/components/RunDetailHeader.test.tsx
git add packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx packages/web/src/experiments/console/components/RunDetailHeader.tsx packages/web/src/experiments/console/components/RunDetailHeader.test.tsx
git commit -m "feat(web): wire console run-detail Ask ownership"
```

### Task 12: Isolation, docs, validate, and close tracking

**Files:**

- Modify: `packages/web/src/experiments/console/console-isolation.test.ts`
- Modify: `packages/web/src/experiments/console/README.md`
- Modify last: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

**Interfaces:**

- Consumes: completed Tasks 1 through 11.
- Produces: NFR4 proof, README contract, sprint done.

- [ ] **Step 1: Replace the obsolete premature-HITL isolation guard with the final architecture guard.**

Keep the existing NFR4 import scan unchanged.
Delete `FORBIDDEN_INSPECT_IDENTIFIERS` and `FORBIDDEN_INSPECT_STRINGS`.
Replace the `inspect and room production files omit premature HITL chrome` test with this exact test.

```ts
test('Ask UI stays console-owned and out of the conversation composer', async () => {
  const askSurfaceFiles = [
    'components/ConsoleNodeRoom.tsx',
    'components/ConsoleInspectPane.tsx',
    'routes/RunDetailPage.tsx',
  ];
  const importViolations: string[] = [];
  for (const relativePath of askSurfaceFiles) {
    const source = await readFile(join(CONSOLE_ROOT, relativePath), 'utf8');
    for (const site of parseImports(source)) {
      if (site.spec.includes('components/workflows') || site.spec.endsWith('/ChatComposer')) {
        importViolations.push(`${relativePath} imports ${site.spec}`);
      }
    }
  }
  expect(importViolations).toEqual([]);

  const room = compact(
    await readFile(join(CONSOLE_ROOT, 'components/ConsoleNodeRoom.tsx'), 'utf8')
  );
  const page = compact(await readFile(join(CONSOLE_ROOT, 'routes/RunDetailPage.tsx'), 'utf8'));
  expect(room).toContain("from'./ask/ConsoleAskCard'");
  expect(page).toContain("from'../components/ask/ConsoleAskChrome'");

  const chatViolations: string[] = [];
  for (const relativePath of ['components/ChatComposer.tsx', 'routes/ChatPage.tsx']) {
    const source = await readFile(join(CONSOLE_ROOT, relativePath), 'utf8');
    for (const identifier of [
      'pendingInteractions',
      'answerAskHuman',
      'ConsoleAskCard',
      'ConsoleAskChrome',
    ]) {
      if (source.includes(identifier)) {
        chatViolations.push(`${relativePath} contains ${identifier}`);
      }
    }
  }
  expect(chatViolations).toEqual([]);
});
```

- [ ] **Step 2: Run the final architecture guard.**

Run `cd packages/web && bun test src/experiments/console/console-isolation.test.ts`.
Expected result: PASS only if the completed room and page use console-owned Ask modules and the conversation composer remains isolated.

- [ ] **Step 3: Replace the README Epic 6 handoff paragraph with this exact text.**

```md
- **AskHuman.** Command Center agent rooms render structured Ask cards from GET-run `pending_interactions` at the matching tool invocation.
  Awaiting chrome uses warning tokens and `waiting on you` / `Awaiting input (n)`.
  Console still must not import production UI modules, React Query, `@/lib/api` functions, or legacy Ask React modules.
  `ChatComposer` on the chat page is not an Ask path.
```

- [ ] **Step 4: Run focused console Ask and inspect suites.**

```bash
cd packages/web
bun test src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/skills/runs.ask.test.ts
bun test src/experiments/console/components/ask/parse-ask-envelope.test.ts src/experiments/console/components/ask/select-visible-node-ask-interactions.test.ts src/experiments/console/components/ask/ask-answer-controller.test.ts src/experiments/console/components/ask/ask-card-presentation.test.ts src/experiments/console/components/ask/awaiting-chrome.test.ts src/experiments/console/components/ask/ConsoleAskCard.test.tsx src/experiments/console/components/ask/ConsoleAskChrome.test.tsx
bun test src/experiments/console/components/inspect/inspect-status.test.ts src/experiments/console/components/inspect/console-inspect-selection.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts src/experiments/console/components/graph/build-run-graph-input.test.ts
bun test src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/RunDetailHeader.test.tsx src/experiments/console/routes/RunDetailPage.test.tsx src/experiments/console/console-isolation.test.ts
```

Expected result: every command exits 0 with no warning or unhandled rejection.

- [ ] **Step 5: Run Story 6.5 legacy Ask regressions so the console work did not import or break them.**

```bash
cd packages/web
bun test src/components/workflows/parse-ask-envelope.test.ts src/components/workflows/merge-agent-room-items.test.ts src/components/workflows/ask-answer-controller.test.ts src/components/workflows/ask-card-presentation.test.ts src/components/workflows/awaiting-chrome.test.ts src/components/workflows/AskCard.test.tsx src/components/workflows/WorkflowAskChrome.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx
```

Expected result: PASS.

- [ ] **Step 6: Run type-check, lint, formatting, and repository validation from repository root.**

```bash
bun run type-check
bun run lint
bun run format:check
bun run validate
```

Expected result: every command exits 0 with zero lint warnings.

- [ ] **Step 7: Update sprint tracking only after Steps 4 through 6 are green.**

Set both comment-form and YAML-form `last_updated` fields to the same current `+0700` timestamp because that is the file's established offset.
Set `6-6-answer-the-ask-in-the-command-center-room` from `backlog` to `done`.
Set `epic-6` from `in-progress` to `done` because 6.1 through 6.7 are then all `done`.
Leave `epic-6-retrospective: optional`.

- [ ] **Step 8: Validate the tracking file.**

Run `bun -e 'const text = await Bun.file("_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml").text(); Bun.YAML.parse(text); console.log("valid")'`.
Run `git diff --check`.

- [ ] **Step 9: Commit Task 12.**

```bash
git add packages/web/src/experiments/console/console-isolation.test.ts packages/web/src/experiments/console/README.md _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark AskHuman command-center room story 6.6 done"
```

- [ ] **Step 10: Record implementation evidence.**

Record the exact commands from Steps 4 through 6 and their passing results.
Do not claim manual browser, keyboard, screen-reader, or multi-user evidence unless it was actually performed.
Do not close issue 91 directly unless the later PR workflow links it with `Closes #91`.

## Acceptance Criteria

- [ ] Opening the asking node's room on `/console` from Log or Graph shows the same envelope, states, validity, and copy as Story 6.5.
- [ ] The card appears inline at the tool invocation, not in `ChatComposer` or the run action bar.
- [ ] Cards originate only from GET-run `pending_interactions`; transcript status rows and SSE payloads never create cards.
- [ ] Submit stays disabled until every question is valid, including Other and multi-select.
- [ ] Decline is a first-class action behind exact copy `The agent will be told you declined`.
- [ ] One POST answers the whole card through `/api/workflows/runs/:runId/ask/:requestId/answer`.
- [ ] Two Ask cards on one node have independent sending, error, accepted, and duplicate states.
- [ ] The decline confirmation is a native modal `dialog` with explicit `role="dialog"`, so global route shortcuts stay suppressed while it is open.
- [ ] A teammate or unsigned viewer sees `Waiting for <starter> to answer` and no Submit or Decline.
- [ ] Warning awaiting chrome uses `waiting on you` and `Awaiting input (n)` and never error tokens.
- [ ] Clicking the awaiting pill opens Graph and selects the first awaiting node.
- [ ] CAP-7 start rejection renders the persisted unsupported-provider message with error chrome and no awaiting pill.
- [ ] Declared-gate pauses without pending asks keep approval chrome and do not render Ask awaiting chrome.
- [ ] Console composer/Reply is not HITL, and `a`/`r` remain gate-only.
- [ ] Console production code still does not import production UI modules, React Query, `@/lib/api` functions, or legacy Ask React modules.
- [ ] Logs remain on console and the persistent room still survives Log/Graph switches.
- [ ] Permission rows are not rendered.
- [ ] Focused console tests, legacy Ask regressions, type-check, lint, formatting, and `bun run validate` all pass.
- [ ] Sprint tracking marks `6-6-answer-the-ask-in-the-command-center-room` and `epic-6` done.
