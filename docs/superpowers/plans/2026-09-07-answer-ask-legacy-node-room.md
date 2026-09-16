# Answer the Ask in the Legacy Node Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the authenticated run starter answer or decline every structured Ask inline at its tool invocation in the legacy agent room, while teammates see named read-only state and awaiting and CAP-7 chrome remain visually distinct.

**Architecture:** Extend the existing GET-run read model with server-derived viewer and starter-display fields, and continue treating `pending_interactions` as the only Ask-card source.
Keep one legacy Graph/Logs/Chat room, add generic transcript extension slots to `NodeRoom`, and let `NodeTranscriptPane` select, parse, and place Ask cards without teaching the generic transcript renderer about HITL or mutation.
Keep mutation in a small per-request controller owned by `WorkflowExecution`, and derive card, run, and node presentation from generated API types plus exact persisted state.

**Tech Stack:** Bun, strict TypeScript, React 19, TanStack Query, happy-dom, `bun:test`, existing shadcn `Button`, `Card`, `Textarea`, and `AlertDialog`, native radio and checkbox inputs, Hono OpenAPI, and generated OpenAPI TypeScript types.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` Story 6.5, `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-3, CAP-4, CAP-6, and CAP-7, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` `PendingInteractionCard`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md` AD-3, AD-7, AD-8, and AD-9.

**Issue:** `https://github.com/anhle128/Archon/issues/90`.

## Global Constraints

- Story 6.5 changes the legacy workflow-run surface only.
- Stories 5.4 and 6.3 are completed prerequisites and their behavior must remain green.
- GET `/api/workflows/runs/:runId` `pending_interactions` is the only source of Ask cards.
- SSE `node_awaiting` and `interaction_resolved` are identifier-only refetch triggers and never card payloads.
- Transcript `status` rows remain lifecycle notes and never become Ask cards.
- One POST answers or declines one whole card through `/api/workflows/runs/:runId/ask/:requestId/answer`, where `requestId` is `tool_use_id`.
- Submit remains disabled until every question is valid, including non-empty Other text and at least one value for multi-select.
- Decline remains a first-class secondary action behind an `AlertDialog` whose description is exactly `The agent will be told you declined`.
- A teammate or unsigned viewer sees disabled answer inputs, factual `Waiting for <starter> to answer` copy, and no Submit or Decline affordance.
- The Chat-tab `RunChatComposer` remains a parent-conversation message path and never receives pending-interaction props.
- Awaiting chrome uses warning tokens and the visible copy `waiting on you` or `Awaiting input (n)`.
- CAP-7 start rejection uses error tokens and the persisted executor message beginning `AskHuman is not supported by provider`.
- `@archon/web` imports generated types through `@/lib/api` and never imports `@archon/workflows`.
- No legacy React Ask component may be imported by `packages/web/src/experiments/console/`.
- Do not add a shared React NodePanel.
- Do not render `kind: permission` cards.
- Do not implement Command Center Ask chrome in this story.
- Do not change the workflow engine, persistence schema, workflow YAML, provider resume behavior, CLI, chat orchestrator, or `manage_run`.
- Do not add an `awaiting` workflow-run status or write Ask state into `metadata.approval`.
- Do not add UI packages or new shadcn radio and checkbox primitives.
- Every new or modified TypeScript function has complete types and no unjustified `any`.
- Each production behavior follows an observed RED, minimal GREEN, and refactor only while green.
- Run package-scoped tests from the owning package directory and never run unscoped `bun test` at repository root.
- Do not update sprint tracking until all focused tests and `bun run validate` pass.

---

## Verified Repository Facts

- Story 6.5 acceptance criteria are at `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md:469`.
- The accepted UX explicitly requires teammate copy to name the starter at `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md:42` and `:109`.
- `pendingInteractionSchema`, `askHumanQuestionSchema`, and `askAnswerBodySchema` are canonical at `packages/workflows/src/schemas/pending-interaction.ts:10`, `:42`, and `:61`.
- The existing answer POST already enforces starter identity, first-answer-wins, body validity, and resume dispatch.
- `workflowRunDetailSchema` embeds pending interactions at `packages/server/src/routes/schemas/workflow.schemas.ts:210` but has no viewer or starter-display fields.
- GET-run assembly is at `packages/server/src/routes/api.ts:5063` and already has access to `resolveAuthContext` and the imported `userDb` module.
- `userDb.getUserById` returns `display_name` at `packages/core/src/db/users.ts:41`.
- `packages/server/src/routes/api.workflow-runs.test.ts:655` must extend its users-module mock with `getUserById` before the route imports.
- `packages/web/src/lib/api.ts:429` wraps GET run, while generated types already include `PendingInteraction`, `AskAnswerBody`, and `WorkflowRunActionResponse` components.
- `WorkflowExecution` maps GET-run data inline at `packages/web/src/components/workflows/WorkflowExecution.tsx:293` and currently drops pending interactions, starter presentation, and `metadata.error`.
- GET-run polling already continues for `paused` because only terminal statuses stop the 3000 ms interval at `WorkflowExecution.tsx:335`.
- `NodeTranscriptPane` currently receives `isLive`, so its message poll incorrectly stops during an Ask pause at `packages/web/src/components/workflows/NodeTranscriptPane.tsx:12`.
- `NodeRoom` owns loop-iteration transcript slicing at `packages/web/src/components/workflows/NodeRoom.tsx:86` and generic text, tool, and status rendering at `:181`.
- `LegacyGraphLogsPane` already keeps Graph, Logs, and Chat pointed at one `LegacyNodeRoom` and keeps the composer separate.
- `workflow-store.ts:228` invalidates GET queries for `running` and terminal SSE statuses but not `paused`.
- The server projector exposes exact per-node `error` text through `WorkflowNodeState.error` at `packages/server/src/routes/schemas/workflow.schemas.ts:157`.
- Resume failure persists exact node error `Could not resume the AskHuman session` at `packages/workflows/src/dag-executor.ts:1770` and `:3223`.
- CAP-7 persists an error beginning `AskHuman is not supported by provider` at `packages/workflows/src/dag-executor.ts:10056`.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:64-82` contains a literal conflict-diagnostic block, not Git conflict markers.
- The two real `last_updated` fields in that sprint file already agree at lines 2 and 37.

## Locked Design and Interfaces

### GET-run identity presentation

Add required response fields to `workflowRunDetailSchema`.

```ts
viewer_is_starter: z.boolean(),
starter_display_name: z.string().nullable(),
```

Compute them in the GET-run handler after loading the run.

```ts
const requester = await resolveAuthContext(c);
const viewerIsStarter =
  requester !== undefined &&
  requester.userId.length > 0 &&
  run.user_id !== null &&
  requester.userId === run.user_id;
const starter = run.user_id === null ? null : await userDb.getUserById(run.user_id);
const starterDisplayName = starter?.display_name?.trim() || run.user_id;
```

Return `viewer_is_starter: viewerIsStarter` and `starter_display_name: starterDisplayName` at the response root.
The `run.user_id` fallback guarantees a factual identifier if a legacy user row has no display name.
A starter-less run returns `false` and `null`.
Never compare a Better Auth session id directly with `workflow_runs.user_id`.

### Web API exports and answer client

Add these exact exports beside `getWorkflowRun` in `packages/web/src/lib/api.ts`.

```ts
export type PendingInteraction = components['schemas']['PendingInteraction'];
export type AskAnswerBody = components['schemas']['AskAnswerBody'];
export type WorkflowRunActionResponse = components['schemas']['WorkflowRunActionResponse'];

export function getApiErrorStatus(error: unknown): number | null;

export async function answerAskHuman(
  runId: string,
  requestId: string,
  body: AskAnswerBody
): Promise<WorkflowRunActionResponse>;
```

`answerAskHuman` must call the existing `fetchJSON` once with an encoded run id, an encoded request id, method `POST`, `Content-Type: application/json`, and `JSON.stringify(body)`.
`getApiErrorStatus` returns a numeric own or inherited `status` from a non-null object and otherwise returns `null`.

### Ask parser and answer decoder

Create `packages/web/src/components/workflows/parse-ask-envelope.ts` with these exact public contracts.

```ts
import type { AskAnswerBody } from '@/lib/api';

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
export function isQuestionValid(
  question: AskQuestion,
  value: AskDraftValue | undefined
): boolean;
export function isAskDraftValid(
  questions: readonly AskQuestion[],
  draft: AskDraft
): boolean;
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

### Loop-safe transcript placement

Create `packages/web/src/components/workflows/merge-agent-room-items.ts` with these exact contracts.

```ts
import type { PendingInteraction, WorkflowNodeMessageResponse } from '@/lib/api';

export type AgentRoomItem =
  | { kind: 'message'; id: string; message: WorkflowNodeMessageResponse }
  | { kind: 'ask'; id: string; interaction: PendingInteraction };

export function selectVisibleNodeAskInteractions(input: {
  pending: readonly PendingInteraction[];
  nodeId: string;
  allMessages: readonly WorkflowNodeMessageResponse[];
  visibleMessages: readonly WorkflowNodeMessageResponse[];
}): PendingInteraction[];

export function mergeAgentRoomItems(
  visibleMessages: readonly WorkflowNodeMessageResponse[],
  interactions: readonly PendingInteraction[]
): AgentRoomItem[];
```

Selection keeps `kind === 'ask'`, the selected `node_id`, and status `pending` or `answered`, while preserving GET order and excluding `purged` and `permission` rows.
An Ask with a tool id found in the full transcript is included only when that tool row is in the selected loop slice.
An Ask with no matching tool row anywhere is included only when the visible slice reaches the end of the full transcript, including the ordinary whole-node selection.
This rule keeps a late tool row from hiding the current Ask without leaking one loop iteration's Ask into another iteration room.
The merger sorts visible messages by `seq`, inserts matching cards immediately after the matching tool message, and appends only the remaining already-selected Ask rows.
Ask item ids use `ask:${interaction.id}` because database row ids remain unique even if corrupt input repeats a tool id.

Extend `NodeRoomProps` with generic slots and no interaction-specific types.

```ts
renderAfterMessage?: (message: WorkflowNodeMessageResponse) => React.ReactNode;
renderAtEnd?: React.ReactNode;
```

`NodeRoom` renders `renderAfterMessage(message)` immediately after that message and renders `renderAtEnd` after the selected transcript slice.
When the selected slice is empty and `renderAtEnd` is present, it renders the end content instead of `Node hasn't produced output`.
Loading continues to suppress both slots.
The error state renders its retry UI followed by `renderAtEnd` so a transcript-fetch failure cannot make a GET-run Ask unanswerable.

### Per-request mutation and presentation state

Create `packages/web/src/components/workflows/ask-answer-controller.ts`.

```ts
import type { AskAnswerBody, WorkflowRunActionResponse } from '@/lib/api';

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

The controller owns a private `Set<string>` of in-flight request ids.
A duplicate call for the same in-flight request returns without another POST.
Different request ids may submit concurrently and update independently.
The controller emits `sending` before POST, `accepted` with the submitted body after success, `rejected-late` for HTTP 409, and `error` with the thrown message or `Failed to answer.` for other failures.
Success and 409 both call `invalidate` after updating local state so canonical GET state can replace the optimistic view.
The controller catches an invalidation failure, logs one `console.warn` with the run and request ids, and leaves accepted or rejected-late state intact because the mutation result is already final.

Create `packages/web/src/components/workflows/ask-card-presentation.ts`.

```ts
import type { AskAnswerBody, PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';
import type { AskActionState } from './ask-answer-controller';

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
  nodeStatus: WorkflowNodeStateResponse['status'] | undefined;
  nodeError: string | undefined;
}): AskCardPresentation;
```

`rejected-late` remains visible even after refetch finds the winning canonical answer.
Canonical `interaction.answer` takes precedence over a local accepted answer for summaries.
An accepted local answer remains visible until GET refetch catches up.
`failed-resume` is selected only when an effective accepted or canonical answer exists, node status is `failed`, and node error starts with `Could not resume the AskHuman session`.
An unrelated node failure after an answered Ask remains `answered` or `declined`.
Malformed canonical answers produce an inline error while retaining the honest answered state and raw payload disclosure.

### Ask card

Create `packages/web/src/components/workflows/AskCard.tsx` with this exact public contract.

```ts
import type { AskAnswerBody, PendingInteraction } from '@/lib/api';
import type { AskCardPresentation } from './ask-card-presentation';
import type { AskQuestion } from './parse-ask-envelope';

export interface AskCardProps {
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

export function AskCard(props: AskCardProps): React.ReactElement;

export function InvalidAskCard(props: {
  interaction: PendingInteraction;
  agentDisplayName: string;
  nodeId: string;
}): React.ReactElement;
```

The valid-card root is a form with `aria-label="question from agent, N questions"` and warning-border elevated styling.
The header is `${agentDisplayName} is asking`, and it includes the node id plus elapsed waiting time derived from `interaction.created_at` and `nowMs` with existing `formatDurationMs`.
Each question is a fieldset with its prompt as legend.
Single choice uses radios and multi choice uses checkboxes.
When `allowOther` is true, an `Other` control reveals a text input labelled `Other answer for ${question.prompt}` with `aria-required="true"` while selected.
Keep Other-selected flags and Other text in separate component state so custom text equal to a listed option cannot move the checked indicator to that listed option.
Project an empty-string sentinel into the draft while selected Other text is empty so the shared validity function keeps Submit disabled.
Only the first actionable card in the selected room receives `autoFocus: true`, and that card focuses its first choice.
Starter pending cards render Submit and Decline.
Non-starter pending cards render disabled answer controls, omit both action buttons, and show `Waiting for ${starterDisplayName ?? 'the run starter'} to answer`.
Decline opens the existing `AlertDialog` with title `Decline this ask?`, description `The agent will be told you declined`, Cancel, and Decline buttons.
Sending disables the form and shows `Sending…`.
Any non-pending presentation disables answer controls and omits Submit and Decline.
The form handler always prevents browser navigation and calls `onSubmit` only when the starter's current draft is valid.
Answered shows a question-labelled summary and `Answered · by you` only for the current starter, while a teammate sees `Answered` without `by you`.
Declined shows `Declined`.
Rejected-late shows `Already answered`.
Failed resume shows `Resume failed — node failed; your answer is preserved below` with error text only on that stamp.
An ordinary non-409 mutation error leaves the card pending, re-enables starter actions, and renders the error inline.
Resolved stamps include a semantic `<time dateTime={presentation.resolvedAt}>` when the timestamp exists.
Every state retains a `View payload` details disclosure with pretty-printed envelope JSON.
`InvalidAskCard` is a non-interactive `role="alert"` surface with `Invalid Ask payload`, node identity, and the same raw-payload disclosure.
Malformed envelopes must never disappear silently and must never expose Submit or Decline.

### Awaiting and CAP-7 chrome

Create `packages/web/src/components/workflows/awaiting-chrome.ts`.

```ts
import type { PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

export function countPendingAsks(pending: readonly PendingInteraction[]): number;
export function isAskAwaitingRun(
  status: WorkflowRunStatus,
  pending: readonly PendingInteraction[]
): boolean;
export function firstAwaitingNodeId(
  nodes: readonly WorkflowNodeStateResponse[]
): string | null;
export function isAskHumanUnsupportedError(error: string | null | undefined): boolean;
export function nodeStatusLabel(status: WorkflowNodeStateResponse['status']): string;
```

Run awaiting is exactly `status === 'paused'` with at least one pending Ask.
Permission rows, answered rows, purged rows, and declared-gate pauses do not contribute to the count.
The node label for `awaiting` is exactly `waiting on you`.
CAP-7 matching is a prefix check for `AskHuman is not supported by provider`.

Create `packages/web/src/components/workflows/WorkflowAskChrome.tsx`.

```ts
export interface WorkflowAskChromeProps {
  status: WorkflowRunStatus;
  pendingInteractions: readonly PendingInteraction[];
  nodeStates: readonly WorkflowNodeStateResponse[];
  runError: string | null;
  onSelectAwaitingNode: (nodeId: string) => void;
  onRequestGraphView: () => void;
}
```

Paused plus pending Ask renders a button with `aria-live="polite"`, warning tokens, and `Awaiting input (n)`.
Clicking it first calls `onRequestGraphView` and then calls `onSelectAwaitingNode` with the first awaiting node.
The click is a no-op when no projected awaiting node exists.
Failed plus a matching CAP-7 message renders an error banner with the full persisted message and no awaiting pill.

Node chrome changes are exact.
`StatusIcon` adds an awaiting glyph with `text-warning` and accessible label `waiting on you`.
`ExecutionDagNode` adds awaiting warning border/background, a visible `waiting on you` label, optional pulse, and `motion-reduce:animate-none`.
`NodeRunList` and `LegacyNodeRoom` change awaiting color to warning and render `nodeStatusLabel(row.status)`.
Do not change declared-gate UI to Ask copy.

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | Modify | Add required GET-run viewer and starter-display fields |
| `packages/server/src/routes/api.ts` | Modify | Resolve canonical viewer identity and starter display name |
| `packages/server/src/routes/api.workflow-runs.test.ts` | Modify | Prove identity/name cases and OpenAPI shape |
| `packages/web/src/lib/api.generated.d.ts` | Regenerate | Carry the GET-run fields and existing interaction schemas to web |
| `packages/web/src/lib/api.ts` | Modify | Re-export generated types and wrap the answer POST |
| `packages/web/src/lib/api.ask.test.ts` | Create | Prove encoded URL, body, and HTTP status extraction |
| `packages/web/src/components/workflows/parse-ask-envelope.ts` | Create | Parse questions, answers, draft validity, and request body |
| `packages/web/src/components/workflows/parse-ask-envelope.test.ts` | Create | Prove parser and validity matrices |
| `packages/web/src/components/workflows/merge-agent-room-items.ts` | Create | Select loop-safe Ask rows and interleave them with transcript messages |
| `packages/web/src/components/workflows/merge-agent-room-items.test.ts` | Create | Prove selected-node, loop-slice, anchor, and fallback behavior |
| `packages/web/src/components/workflows/NodeRoom.tsx` | Modify | Add generic after-message and end slots |
| `packages/web/src/components/workflows/NodeRoom.test.tsx` | Modify | Prove slot order without adding HITL knowledge |
| `packages/web/src/components/workflows/ask-answer-controller.ts` | Create | Own independent mutation lifecycle and duplicate suppression |
| `packages/web/src/components/workflows/ask-answer-controller.test.ts` | Create | Prove success, concurrency, 409, and error behavior |
| `packages/web/src/components/workflows/ask-card-presentation.ts` | Create | Derive canonical and optimistic card presentation |
| `packages/web/src/components/workflows/ask-card-presentation.test.ts` | Create | Prove state matrix and exact resume-failure classification |
| `packages/web/src/components/workflows/AskCard.tsx` | Create | Render accessible interactive, read-only, resolved, and invalid cards |
| `packages/web/src/components/workflows/AskCard.test.tsx` | Create | Prove form semantics, copy, focus, actions, summaries, and errors |
| `packages/web/src/components/workflows/awaiting-chrome.ts` | Create | Derive pending count, navigation target, labels, and CAP-7 match |
| `packages/web/src/components/workflows/awaiting-chrome.test.ts` | Create | Prove exact run and node chrome decisions |
| `packages/web/src/components/workflows/WorkflowAskChrome.tsx` | Create | Render run-level awaiting pill or CAP-7 banner |
| `packages/web/src/components/workflows/WorkflowAskChrome.test.tsx` | Create | Prove run-chrome rendering and navigation callback |
| `packages/web/src/components/workflows/StatusIcon.tsx` | Modify | Add accessible awaiting warning glyph |
| `packages/web/src/components/workflows/StatusIcon.test.tsx` | Create | Prove warning, accessible, non-error awaiting icon |
| `packages/web/src/components/workflows/ExecutionDagNode.tsx` | Modify | Add warning graph-node state |
| `packages/web/src/components/workflows/ExecutionDagNode.test.tsx` | Modify | Prove graph warning style and visible copy |
| `packages/web/src/components/workflows/NodeRunList.tsx` | Modify | Add warning sidebar state and copy |
| `packages/web/src/components/workflows/NodeRunList.test.tsx` | Modify | Prove sidebar warning state and copy |
| `packages/web/src/stores/workflow-store.ts` | Modify | Invalidate GET-run data on paused SSE |
| `packages/web/src/stores/workflow-store.test.ts` | Modify | Prove paused invalidation through the real query client |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx` | Modify | Poll paused runs and compose Ask cards into slots |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` | Modify | Prove placement, loop isolation, invalid envelope, focus, and callbacks |
| `packages/web/src/components/workflows/LegacyNodeRoom.tsx` | Modify | Pass Ask state only to agent rooms and show warning node chrome |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` | Modify | Prove awaiting header and final agent-pane props |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` | Modify | Thread Ask props through the one shared room |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` | Modify | Prove all three doors, teammate state, and composer isolation |
| `packages/web/src/components/workflows/WorkflowExecution.tsx` | Modify | Map GET data, own controller, invalidate queries, and render run chrome |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx` | Modify | Prove pure GET mapping and run-id reset helpers |
| `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` | Modify last | Remove diagnostic text and mark Story 6.5 done after validation |

Do not modify `packages/web/src/experiments/console/`, `packages/web/src/lib/run-graph/`, engine packages, provider packages, migrations, `ChatTimeline.tsx`, or `RunChatComposer.tsx` production code.

## TDD Execution Rule

Each numbered RED/GREEN cycle below is atomic.
Add only the named test, run the exact command until it fails for the stated missing behavior rather than an import, syntax, fixture, or environment error, implement only enough production code for that test, rerun to PASS with pristine output, and only then begin the next cycle.
Generated `api.generated.d.ts` and sprint YAML are the only test-first exceptions because they are generated output and tracking configuration.

## Tasks

### Task 1: Extend GET run with viewer and starter presentation

**Files:**

- Modify: `packages/server/src/routes/schemas/workflow.schemas.ts:209-231`.
- Modify: `packages/server/src/routes/api.ts:5063-5130`.
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts:15-30`, `:644-657`, `:1774-1785`, and `:2856-2896`.
- Regenerate: `packages/web/src/lib/api.generated.d.ts`.

**Interfaces:**

- Consumes: `resolveAuthContext(c)`, `run.user_id`, and `userDb.getUserById(id)`.
- Produces: required `viewer_is_starter: boolean` and `starter_display_name: string | null` on `WorkflowRunDetail`.

- [ ] **Step 1: Add one failing table-driven route test for viewer presentation.**

Add `mockGetUserById` before the users-module `mock.module` and reset it in the GET-run `beforeEach`.
Use the existing trusted `X-Archon-User` test header to cover a signed-in starter, a different signed-in teammate, an unsigned viewer, a starter with no display name, and a starter-less run.
Assert starter true plus `Avery`, teammate and unsigned false plus `Avery`, missing display name fallback to the non-null run user id, and starter-less false plus null without a user lookup.

- [ ] **Step 2: Run the viewer-presentation test and verify RED.**

Run `cd packages/server && bun test src/routes/api.workflow-runs.test.ts --test-name-pattern "returns viewer and starter presentation"`.
Expected failure: the response has neither new property.

- [ ] **Step 3: Add the minimal handler lookup and response fields.**

Use the exact GET-run identity code in the locked design and do not modify the OpenAPI schema yet.

- [ ] **Step 4: Rerun the viewer-presentation test and verify GREEN.**

Run `cd packages/server && bun test src/routes/api.workflow-runs.test.ts --test-name-pattern "returns viewer and starter presentation"`.
Expected result: PASS.

- [ ] **Step 5: Add an OpenAPI assertion for both required fields.**

Extend the existing `WorkflowRunDetail` assertion to require both property names with boolean and nullable-string schemas.

- [ ] **Step 6: Run the OpenAPI assertion and verify RED.**

Run `cd packages/server && bun test src/routes/api.workflow-runs.test.ts --test-name-pattern "OpenAPI documents"`.
Expected failure: the schema lacks both presentation properties.

- [ ] **Step 7: Add the two fields to `workflowRunDetailSchema`.**

Use the exact Zod fields in the locked design and keep them at the response root.

- [ ] **Step 8: Run the whole route test file and verify GREEN.**

Run `cd packages/server && bun test src/routes/api.workflow-runs.test.ts`.
Expected result: PASS with no warnings.

- [ ] **Step 9: Start a local server for OpenAPI generation.**

Run `bun run dev:server` from repository root in a dedicated terminal and wait for port 3090.

- [ ] **Step 9a: Regenerate the web declaration.**

Run `bun --filter @archon/web generate:types` from repository root in a second terminal.

- [ ] **Step 9b: Stop the local server and inspect the generated fields.**

Stop the dedicated server process and verify `WorkflowRunDetail` contains both required fields.

- [ ] **Step 10: Commit Task 1.**

```bash
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts packages/web/src/lib/api.generated.d.ts
git commit -m "feat(server): expose Ask viewer presentation"
```

### Task 2: Add the typed Ask answer client

**Files:**

- Modify: `packages/web/src/lib/api.ts:429-435`.
- Create: `packages/web/src/lib/api.ask.test.ts`.

**Interfaces:**

- Consumes: generated `PendingInteraction`, `AskAnswerBody`, and `WorkflowRunActionResponse` schemas plus the existing private `fetchJSON` behavior.
- Produces: `answerAskHuman` and `getApiErrorStatus` with the signatures in the locked design.

- [ ] **Step 1: Write one failing URL/body test.**

Spy on `globalThis.fetch`, return a successful JSON response, call `answerAskHuman('run/a', 'tool b', { answers: [{ questionId: 'q1', value: 'Ship' }] })`, and assert exactly one call to `/api/workflows/runs/run%2Fa/ask/tool%20b/answer` with POST JSON headers and the literal body.

- [ ] **Step 2: Run the client test and verify RED.**

Run `cd packages/web && bun test src/lib/api.ask.test.ts --test-name-pattern "posts one encoded Ask answer"`.
Expected failure: `answerAskHuman` is not exported.

- [ ] **Step 3: Add the generated type exports and minimal POST wrapper.**

Implement the exact API contract above and reuse `fetchJSON` so non-2xx behavior remains consistent with every other web client.

- [ ] **Step 4: Rerun the POST test and verify GREEN.**

Run `cd packages/web && bun test src/lib/api.ask.test.ts --test-name-pattern "posts one encoded Ask answer"`.
Expected result: PASS.

- [ ] **Step 5: Add one table-driven error-status test.**

Assert `{ status: 409 }` returns 409, `new Error('x')`, null, a string, and `{ status: '409' }` each return null.

- [ ] **Step 6: Run the error-status test and verify RED.**

Run `cd packages/web && bun test src/lib/api.ask.test.ts --test-name-pattern "reads numeric API error status"`.
Expected failure: `getApiErrorStatus` is not exported.

- [ ] **Step 7: Implement the numeric-status type guard.**

Use `typeof error === 'object'`, a null guard, the `in` operator, and a numeric value check without an `any` assertion.

- [ ] **Step 8: Run the whole client test file and verify GREEN.**

Run `cd packages/web && bun test src/lib/api.ask.test.ts`.
Expected result: PASS.

- [ ] **Step 9: Commit Task 2.**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.ask.test.ts
git commit -m "feat(web): add typed Ask answer client"
```

### Task 3: Parse Ask envelopes, answers, and valid drafts

**Files:**

- Create: `packages/web/src/components/workflows/parse-ask-envelope.ts`.
- Create: `packages/web/src/components/workflows/parse-ask-envelope.test.ts`.

**Interfaces:**

- Consumes: `AskAnswerBody` from Task 2.
- Produces: `AskQuestion`, `AskDraft`, `parseAskEnvelope`, `parseAskAnswer`, `isQuestionValid`, `isAskDraftValid`, and `draftToAnswerBody` exactly as locked above.

- [ ] **Step 1: Write one failing happy-path parser test.**

Use a literal envelope with one single-select and one multi-select question and assert the exact two-question array in order.

- [ ] **Step 2: Run the parser test and verify RED.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts --test-name-pattern "parses ordered Ask questions"`.
Expected failure: the module or export is missing.

- [ ] **Step 3: Implement only the happy-path type guards.**

Return the ordered question array for the literal valid fixture without adding duplicate-id handling yet.

- [ ] **Step 4: Rerun the happy-path parser test and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts --test-name-pattern "parses ordered Ask questions"`.
Expected result: PASS.

- [ ] **Step 5: Add one table-driven malformed-envelope test.**

Cases are missing questions, non-array questions, empty questions, non-object item, empty id, non-string prompt, invalid selection, non-array options, non-string option, non-boolean `allowOther`, and duplicate ids.
Every case must assert `null` from real parser output.

- [ ] **Step 6: Run the malformed-envelope test and verify RED.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts --test-name-pattern "rejects malformed Ask envelopes"`.
Expected failure: the duplicate-id fixture still parses.

- [ ] **Step 7: Implement the missing rejection paths.**

Track ids in a local `Set<string>` and return null at the first invalid item.

- [ ] **Step 8: Rerun the malformed-envelope test and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts --test-name-pattern "rejects malformed Ask envelopes"`.
Expected result: PASS.

- [ ] **Step 9: Add one table-driven validity test.**

Cover a listed single option, allowed and forbidden Other, whitespace Other, empty multi, listed multi, mixed listed plus Other, a wrong scalar/array shape, and an incomplete two-question draft.

- [ ] **Step 10: Run the validity matrix and verify RED.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts --test-name-pattern "validates complete Ask drafts"`.
Expected failure: the validity exports are missing.

- [ ] **Step 11: Implement question and complete-draft validity.**

Use the locked rules and require every parsed question to pass.

- [ ] **Step 12: Rerun the validity matrix and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts --test-name-pattern "validates complete Ask drafts"`.
Expected result: PASS.

- [ ] **Step 13: Add one failing answer-codec test.**

Assert strict decline and strict answers decode, malformed answers return null, and `draftToAnswerBody` emits literal question ids and values in envelope order.

- [ ] **Step 14: Run the answer-codec test and verify RED.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts --test-name-pattern "decodes stored answers and builds an ordered answer body"`.
Expected failure: answer codec exports are missing.

- [ ] **Step 15: Implement strict answer decoding and answer-body construction.**

Reject extra object keys so the runtime decoder matches the canonical strict Zod union.

- [ ] **Step 16: Run the whole parser test file and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts`.
Expected result: PASS with no warnings.

- [ ] **Step 17: Refactor duplicated object guards.**

Do not change any parser output or exported type.

- [ ] **Step 17a: Rerun the parser suite after refactoring.**

Run `cd packages/web && bun test src/components/workflows/parse-ask-envelope.test.ts`.
Expected result: PASS.

- [ ] **Step 18: Commit Task 3.**

```bash
git add packages/web/src/components/workflows/parse-ask-envelope.ts packages/web/src/components/workflows/parse-ask-envelope.test.ts
git commit -m "feat(web): parse and validate Ask card data"
```

### Task 4: Add loop-safe placement and generic transcript slots

**Files:**

- Create: `packages/web/src/components/workflows/merge-agent-room-items.ts`.
- Create: `packages/web/src/components/workflows/merge-agent-room-items.test.ts`.
- Modify: `packages/web/src/components/workflows/NodeRoom.tsx:15-22` and `:204-251`.
- Modify: `packages/web/src/components/workflows/NodeRoom.test.tsx`.

**Interfaces:**

- Consumes: generated pending-interaction and node-message types plus `NodeRoom`'s existing `selectNodeRoomMessages` result.
- Produces: `selectVisibleNodeAskInteractions`, `mergeAgentRoomItems`, and the two generic `NodeRoomProps` slots.

- [ ] **Step 1: Write one failing selection test for kind, node, and status filtering.**

Use literal ask and permission rows across two nodes and assert only pending and answered Ask rows for the selected node remain in original order.

- [ ] **Step 2: Run selection RED.**

Run `cd packages/web && bun test src/components/workflows/merge-agent-room-items.test.ts --test-name-pattern "selects renderable Asks for one node"`.
Expected failure: the module or function is missing.

- [ ] **Step 3: Implement minimal kind, node, and status selection.**

Preserve input order and do not add loop-tail logic yet.

- [ ] **Step 4: Rerun the selection test and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/merge-agent-room-items.test.ts --test-name-pattern "selects renderable Asks for one node"`.
Expected result: PASS.

- [ ] **Step 5: Add one failing loop-boundary test.**

Build a full transcript with iteration-one and iteration-two tool rows, pass only iteration-one messages as visible, and assert iteration-two's anchored Ask is excluded.
Also assert an unanchored Ask is excluded from a historical slice but included in a current slice whose last visible message is the full transcript tail.

- [ ] **Step 6: Run the loop-boundary test and verify RED.**

Run `cd packages/web && bun test src/components/workflows/merge-agent-room-items.test.ts --test-name-pattern "keeps Asks inside the selected loop slice"`.
Expected failure: the initial selector leaks an anchored or unanchored Ask across the historical slice.

- [ ] **Step 7: Implement the full/visible tool-id and transcript-tail rules.**

Build sets from tool-message `payload.id` values and compare the last visible message id with the sorted full-transcript tail.

- [ ] **Step 8: Rerun the loop-boundary test and verify GREEN.**

Run the same command and require PASS.

- [ ] **Step 9: Add one failing merge-order test.**

Assert unsorted messages become sequence order, two cards sharing an anchor retain GET order immediately after that tool, and one selected unanchored card is last.

- [ ] **Step 10: Run the merge-order test and verify RED.**

Run `cd packages/web && bun test src/components/workflows/merge-agent-room-items.test.ts --test-name-pattern "interleaves Ask cards in stable order"`.
Expected failure: `mergeAgentRoomItems` is missing.

- [ ] **Step 11: Implement the ordered merger.**

Track placed interaction ids so every selected database row appears exactly once.

- [ ] **Step 12: Run the whole merger test file and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/merge-agent-room-items.test.ts`.
Expected result: PASS.

- [ ] **Step 13: Add one failing generic-slot test to `NodeRoom.test.tsx`.**

Render text and tool messages with `renderAfterMessage` returning `extension-${message.id}` and `renderAtEnd` returning `end-extension`, then assert DOM order is message, matching extension, next message, matching extension, end extension.
Add a second assertion that an empty transcript renders end extension instead of the old empty placeholder.
Add a third assertion that a transcript error renders Retry followed by end extension.

- [ ] **Step 14: Run the slot test and verify RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx --test-name-pattern "renders generic transcript extension slots"`.
Expected failure: `NodeRoom` does not accept or render the slots.

- [ ] **Step 15: Implement the two generic slots.**

Use `React.Fragment` with the message id as the key so each message and its extension remain adjacent.
Render end content in the empty and error branches exactly as locked.

- [ ] **Step 16: Run `NodeRoom.test.tsx` and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx`.
Expected result: existing inspect-only behavior and new generic slot behavior pass.

- [ ] **Step 17: Commit Task 4.**

```bash
git add packages/web/src/components/workflows/merge-agent-room-items.ts packages/web/src/components/workflows/merge-agent-room-items.test.ts packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/NodeRoom.test.tsx
git commit -m "feat(web): add loop-safe transcript extensions"
```

### Task 5: Implement independent Ask mutation and presentation state

**Files:**

- Create: `packages/web/src/components/workflows/ask-answer-controller.ts`.
- Create: `packages/web/src/components/workflows/ask-answer-controller.test.ts`.
- Create: `packages/web/src/components/workflows/ask-card-presentation.ts`.
- Create: `packages/web/src/components/workflows/ask-card-presentation.test.ts`.

**Interfaces:**

- Consumes: Task 2 `answerAskHuman` contract, Task 2 `getApiErrorStatus`, and Task 3 `parseAskAnswer`.
- Produces: `AskActionState`, `AskActionStateByRequest`, `createAskAnswerController`, `AskCardPresentation`, and `resolveAskCardPresentation` exactly as locked above.

- [ ] **Step 1: Write one failing controller success test.**

Use deferred real promises rather than timer sleeps, assert state transitions from sending to accepted with the submitted body and fixed ISO timestamp, assert one POST, and assert one invalidation after acceptance.

- [ ] **Step 2: Run controller success RED.**

Run `cd packages/web && bun test src/components/workflows/ask-answer-controller.test.ts --test-name-pattern "accepts one Ask answer"`.
Expected failure: the controller module is missing.

- [ ] **Step 3: Implement the controller success path.**

Emit sending, await one POST, emit accepted with `now().toISOString()`, then invalidate.

- [ ] **Step 4: Rerun controller success and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/ask-answer-controller.test.ts --test-name-pattern "accepts one Ask answer"`.
Expected result: PASS.

- [ ] **Step 5: Add one failing concurrency test.**

Hold POST promises open, call the same request twice and a different request once, assert two POSTs total, and assert both request ids receive independent sending and accepted states.

- [ ] **Step 6: Run the concurrency test and verify RED.**

Run `cd packages/web && bun test src/components/workflows/ask-answer-controller.test.ts --test-name-pattern "deduplicates only the same in-flight request"`.
Expected failure: the same request posts twice.

- [ ] **Step 7: Implement the private in-flight set.**

Add before POST and delete in a `finally` block after all state and invalidation work.

- [ ] **Step 8: Rerun the concurrency test and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/ask-answer-controller.test.ts --test-name-pattern "deduplicates only the same in-flight request"`.
Expected result: PASS.

- [ ] **Step 9: Add one table-driven failure test.**

Assert a status-409 error yields rejected-late and invalidates, while a normal Error yields its message without invalidation and a non-Error yields `Failed to answer.`.

- [ ] **Step 10: Run the failure matrix and verify RED.**

Run `cd packages/web && bun test src/components/workflows/ask-answer-controller.test.ts --test-name-pattern "classifies rejected and failed Ask answers"`.
Expected failure: the success-only controller rejects or emits no final failure state.

- [ ] **Step 11: Implement failure classification and logged invalidation fallback.**

Use `getApiErrorStatus`, call invalidation for 409 only, and catch invalidation errors with the locked warning.

- [ ] **Step 12: Run the controller test file and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/ask-answer-controller.test.ts`.
Expected result: PASS.

- [ ] **Step 13: Write one failing presentation-state matrix.**

Cover pending, sending, accepted answers, accepted decline, canonical answer overriding local answer, rejected-late overriding canonical answer, and per-card error retention.

- [ ] **Step 14: Run the presentation matrix and verify RED.**

Run `cd packages/web && bun test src/components/workflows/ask-card-presentation.test.ts --test-name-pattern "derives honest Ask card states"`.
Expected failure: the presentation module is missing.

- [ ] **Step 15: Implement canonical and optimistic presentation precedence.**

Use `parseAskAnswer` and retain a malformed-canonical-answer error string without throwing.

- [ ] **Step 16: Rerun the presentation matrix and verify GREEN.**

Run the same command and require PASS.

- [ ] **Step 17: Add one failing exact resume-failure test.**

Assert answered plus failed plus `Could not resume the AskHuman session` yields failed-resume, while answered plus failed plus `lint failed` remains answered.

- [ ] **Step 18: Run the resume-failure test and verify RED.**

Run `cd packages/web && bun test src/components/workflows/ask-card-presentation.test.ts --test-name-pattern "uses failed-resume only for the persisted resume error"`.
Expected failure: the exact error path is not classified yet.

- [ ] **Step 19: Implement the exact resume-error prefix check.**

Do not classify from node status alone.

- [ ] **Step 20: Run both Task 5 test files and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/ask-answer-controller.test.ts src/components/workflows/ask-card-presentation.test.ts`.
Expected result: PASS.

- [ ] **Step 21: Commit Task 5.**

```bash
git add packages/web/src/components/workflows/ask-answer-controller.ts packages/web/src/components/workflows/ask-answer-controller.test.ts packages/web/src/components/workflows/ask-card-presentation.ts packages/web/src/components/workflows/ask-card-presentation.test.ts
git commit -m "feat(web): model independent Ask card actions"
```

### Task 6: Render the accessible Ask card

**Files:**

- Create: `packages/web/src/components/workflows/AskCard.tsx`.
- Create: `packages/web/src/components/workflows/AskCard.test.tsx`.

**Interfaces:**

- Consumes: Task 3 questions and draft functions plus Task 5 `AskCardPresentation`.
- Produces: `AskCard` and `InvalidAskCard` with the exact locked props and render rules.

- [ ] **Step 1: Write one failing basic-form test.**

Render two questions and assert the form label, agent header, node id, elapsed waiting text, fieldset legends, radio and checkbox roles, payload disclosure, and initially disabled Submit.

- [ ] **Step 2: Run basic-form RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "renders an accessible Ask form"`.
Expected failure: the component is missing.

- [ ] **Step 3: Implement the static form and minimal draft state.**

Use existing UI primitives and native inputs only.

- [ ] **Step 4: Rerun the basic-form test and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "renders an accessible Ask form"`.
Expected result: PASS.

- [ ] **Step 5: Add one failing validity and submit test.**

Select a single option, select one multi option, select Other with whitespace, assert Submit stays disabled, enter non-empty Other text, submit the form with Enter or `submit` event, and assert the exact one-body answer array in question order.

- [ ] **Step 6: Run validity and submit RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "submits only a complete valid draft"`.
Expected failure: controls do not update a complete request body.

- [ ] **Step 7: Implement input updates and `draftToAnswerBody`.**

Use a non-option draft string for single Other and one non-option array entry for multi Other so the final body contains custom text rather than the label `Other`.

- [ ] **Step 8: Rerun validity and submit and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "submits only a complete valid draft"`.
Expected result: PASS.

- [ ] **Step 9: Add one failing Decline-dialog test.**

Assert Decline opens the exact title and description, Cancel does nothing, confirm calls `onDecline` once, and neither path calls `onSubmit`.

- [ ] **Step 10: Run Decline-dialog RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "confirms Decline as a separate action"`.
Expected failure: Decline has no confirmation flow.

- [ ] **Step 11: Implement the existing `AlertDialog` composition.**

Keep the primary form submit and secondary decline handlers separate.

- [ ] **Step 12: Rerun Decline-dialog and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "confirms Decline as a separate action"`.
Expected result: PASS.

- [ ] **Step 13: Add one failing read-only and focus test.**

Render a non-starter named Avery, assert disabled inputs, exact `Waiting for Avery to answer`, and absence of Submit and Decline.
Render two pending starter cards with only the first `autoFocus`, then assert only the first card's first control is active.

- [ ] **Step 14: Run read-only and focus RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "renders named read-only state|focuses only the requested card"`.
Expected failure: read-only actions remain present or both cards focus.

- [ ] **Step 15: Implement read-only omission and controlled focus.**

Apply `autoFocus` only to the first rendered choice when the prop is true.

- [ ] **Step 16: Rerun read-only and focus and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "renders named read-only state|focuses only the requested card"`.
Expected result: PASS.

- [ ] **Step 17: Add one table-driven resolved-state test.**

Assert Sending, starter Answered by you with summary, teammate Answered without by you, Declined, Already answered, failed-resume copy with preserved summary, inline error, and semantic resolved time.

- [ ] **Step 18: Run lifecycle-state RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "renders Ask lifecycle states"`.
Expected failure: resolved stamps and summaries are missing.

- [ ] **Step 19: Implement state-specific stamps and summaries.**

Match answer items to question prompts by `questionId`, fall back to the raw question id for unknown ids, and join string-array values with comma-space.

- [ ] **Step 20: Rerun lifecycle states and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "renders Ask lifecycle states"`.
Expected result: PASS.

- [ ] **Step 21: Add one failing malformed-card test.**

Assert `InvalidAskCard` has role alert, shows `Invalid Ask payload`, includes node identity and raw JSON, and has no form, Submit, or Decline.

- [ ] **Step 22: Run malformed-card RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx --test-name-pattern "renders malformed Ask data as a visible contract error"`.
Expected failure: `InvalidAskCard` is missing.

- [ ] **Step 23: Implement invalid-card fail-fast UI.**

Use a semantic section rather than a form and reuse only the raw-payload disclosure markup.

- [ ] **Step 24: Run the whole card test file and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx`.
Expected result: PASS with no React warnings.

- [ ] **Step 25: Commit Task 6.**

```bash
git add packages/web/src/components/workflows/AskCard.tsx packages/web/src/components/workflows/AskCard.test.tsx
git commit -m "feat(web): render accessible Ask cards"
```

### Task 7: Add awaiting and CAP-7 presentation chrome

**Files:**

- Create: `packages/web/src/components/workflows/awaiting-chrome.ts`.
- Create: `packages/web/src/components/workflows/awaiting-chrome.test.ts`.
- Create: `packages/web/src/components/workflows/WorkflowAskChrome.tsx`.
- Create: `packages/web/src/components/workflows/WorkflowAskChrome.test.tsx`.
- Modify: `packages/web/src/components/workflows/StatusIcon.tsx`.
- Create: `packages/web/src/components/workflows/StatusIcon.test.tsx`.
- Modify: `packages/web/src/components/workflows/ExecutionDagNode.tsx:17-25`.
- Modify: `packages/web/src/components/workflows/ExecutionDagNode.test.tsx`.
- Modify: `packages/web/src/components/workflows/NodeRunList.tsx:10-18`.
- Modify: `packages/web/src/components/workflows/NodeRunList.test.tsx`.
- Modify: `packages/web/src/components/workflows/LegacyNodeRoom.tsx:52-59` and `:87-96`.

**Interfaces:**

- Consumes: generated pending-interaction and node-state types and `WorkflowRunStatus`.
- Produces: locked awaiting helpers, `WorkflowAskChrome`, and consistent warning node chrome.

- [ ] **Step 1: Write one failing pure-helper matrix.**

Assert only pending Ask rows count, paused plus count is awaiting, gate-only paused is not awaiting, first awaiting node uses input order, unsupported-provider matching uses the exact prefix, and `nodeStatusLabel('awaiting')` is `waiting on you`.

- [ ] **Step 2: Run helper RED.**

Run `cd packages/web && bun test src/components/workflows/awaiting-chrome.test.ts`.
Expected failure: the helper module is missing.

- [ ] **Step 3: Implement the five pure awaiting helpers.**

Use the locked exact predicates and preserve node-state input order.

- [ ] **Step 4: Rerun the helper suite and verify GREEN.**

Run `cd packages/web && bun test src/components/workflows/awaiting-chrome.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Write one failing run-chrome component test.**

Assert paused plus two pending Asks renders warning `Awaiting input (2)`, click requests Graph view before reporting the first awaiting node id, no awaiting node makes both callbacks no-ops, and failed CAP-7 renders the full error with error classes and no pill.

- [ ] **Step 6: Run the run-chrome component test and verify RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/WorkflowAskChrome.test.tsx`.
Expected failure: `WorkflowAskChrome` is missing.

- [ ] **Step 7: Implement `WorkflowAskChrome`.**

Render mutually exclusive warning-pill and CAP-7 error-banner branches from the locked helpers.

- [ ] **Step 8: Rerun the run-chrome component test and verify GREEN.**

Run the same command and require PASS.

- [ ] **Step 9: Add one failing `StatusIcon` awaiting test.**

Render to static markup and assert `text-warning`, accessible `waiting on you`, and absence of `text-error`.

- [ ] **Step 10: Run the awaiting-icon test and verify RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/StatusIcon.test.tsx`.
Expected failure: awaiting falls through to the default glyph.

- [ ] **Step 11: Add the accessible awaiting glyph.**

Use an existing lucide icon or a text glyph without adding a dependency.

- [ ] **Step 12: Rerun the awaiting-icon test and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/StatusIcon.test.tsx`.
Expected result: PASS.

- [ ] **Step 13: Add focused failing graph, sidebar, and room-header tests.**

Assert awaiting graph markup has warning border, visible `waiting on you`, and reduced-motion class.
Assert awaiting sidebar and room header show warning tokens plus visible `waiting on you`, while existing running and failed fixtures retain their current treatments.

- [ ] **Step 14: Run node-chrome RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/ExecutionDagNode.test.tsx src/components/workflows/NodeRunList.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx`.
Expected failure: awaiting still uses accent or raw `awaiting` copy.

- [ ] **Step 15: Implement warning classes and shared label usage.**

Keep existing styles for every status other than awaiting.

- [ ] **Step 16: Rerun node-chrome tests and verify GREEN.**

Run the same command and require PASS.

- [ ] **Step 17: Commit Task 7.**

```bash
git add packages/web/src/components/workflows/awaiting-chrome.ts packages/web/src/components/workflows/awaiting-chrome.test.ts packages/web/src/components/workflows/WorkflowAskChrome.tsx packages/web/src/components/workflows/WorkflowAskChrome.test.tsx packages/web/src/components/workflows/StatusIcon.tsx packages/web/src/components/workflows/StatusIcon.test.tsx packages/web/src/components/workflows/ExecutionDagNode.tsx packages/web/src/components/workflows/ExecutionDagNode.test.tsx packages/web/src/components/workflows/NodeRunList.tsx packages/web/src/components/workflows/NodeRunList.test.tsx packages/web/src/components/workflows/LegacyNodeRoom.tsx packages/web/src/components/workflows/LegacyNodeRoom.test.tsx
git commit -m "feat(web): distinguish awaiting and Ask rejection chrome"
```

### Task 8: Invalidate Ask data on paused SSE

**Files:**

- Modify: `packages/web/src/stores/workflow-store.ts:186-231`.
- Modify: `packages/web/src/stores/workflow-store.test.ts`.

**Interfaces:**

- Consumes: identifier-only `WorkflowStatusEvent.status`.
- Produces: paused SSE invalidation through the existing `invalidateWorkflowQueries` path.

- [ ] **Step 1: Add one failing store test through the real imported query client.**

Spy on `queryClient.invalidateQueries`, call `handleWorkflowStatus` with paused, and assert a call whose query key is `['workflowRun']`.
Also keep existing running and terminal expectations green and restore the spy after the test.

- [ ] **Step 2: Run store RED.**

Run `cd packages/web && bun test src/stores/workflow-store.test.ts --test-name-pattern "invalidates run detail on paused workflow status"`.
Expected failure: paused does not call the invalidator.

- [ ] **Step 3: Add `event.status === 'paused'` to the existing invalidation predicate.**

Do not change the store event shape or approval mapping.

- [ ] **Step 4: Run the whole store test file and verify GREEN.**

Run `cd packages/web && bun test src/stores/workflow-store.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Commit Task 8.**

```bash
git add packages/web/src/stores/workflow-store.ts packages/web/src/stores/workflow-store.test.ts
git commit -m "fix(web): refresh run detail on paused status"
```

### Task 9: Integrate Ask cards through the complete legacy run surface

**Files:**

- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`.
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`.
- Modify: `packages/web/src/components/workflows/LegacyNodeRoom.tsx:24-36` and agent branch at `:108-113`.
- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:30-58` and its `LegacyNodeRoom` render.
- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`.
- Modify: `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` for required new props.
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx:68-81`, `:282-341`, `:786-821`, and header at `:841-877`.
- Modify: `packages/web/src/components/workflows/WorkflowExecution.test.tsx`.

**Interfaces:**

- Consumes: Task 1 GET fields, Task 2 answer client, Tasks 3 through 6 card contracts, Task 7 run chrome, Task 8 invalidation, existing Graph/Logs/Chat selection, and the selected node's generated state.
- Produces: exported `WorkflowRunQueryData`, exported `mapWorkflowRunDetail`, per-run action ownership, final pane prop contracts, paused polling, and the complete legacy Ask flow.

Use this exact mapper boundary.

```ts
export interface WorkflowRunQueryData {
  workflowState: WorkflowState;
  workerPlatformId: string | null;
  parentPlatformId: string | null;
  conversationPlatformId: string | null;
  codebaseId: string | null;
  events: WorkflowEventResponse[];
  nodeStates: WorkflowRunNodeState[];
  approval: unknown;
  pendingInteractions: PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  runError: string | null;
}

export function mapWorkflowRunDetail(
  data: Awaited<ReturnType<typeof getWorkflowRun>>
): WorkflowRunQueryData;

export function emptyAskActionStates(): AskActionStateByRequest;
```

Map pending interactions and both presentation fields directly.
Map `runError` only when `data.run.metadata.error` is a string.
Keep all current workflow-state, event, node, approval, and navigation mapping behavior unchanged.

Replace `NodeTranscriptPaneProps` with these fields.

```ts
export interface NodeTranscriptPaneProps {
  runId: string;
  row: LogRow | null;
  runStatus: WorkflowRunStatus;
  loadMessages: typeof getWorkflowNodeMessages;
  pendingInteractions: readonly PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  nodeState: WorkflowNodeStateResponse | undefined;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
}
```

The pane computes `visibleMessages` with existing `selectNodeRoomMessages`, calls `selectVisibleNodeAskInteractions`, derives presentations, and supplies anchored cards through `renderAfterMessage` plus unanchored cards through `renderAtEnd`.
When the transcript query has failed, the pane treats every renderable node Ask as unanchored so `NodeRoom` can show it below the retry UI.
The pane passes `row.label` as the agent display name and passes `Date.now()` as the card time snapshot.
The pane passes `{ decline: true }` through the same `onSubmitAsk` callback instead of inventing a second mutation path.

Add these exact shared props to `LegacyGraphLogsPaneProps` and `LegacyNodeRoomProps`.

```ts
pendingInteractions: readonly PendingInteraction[];
viewerIsStarter: boolean;
starterDisplayName: string | null;
actionStates: AskActionStateByRequest;
onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
```

Remove `isLive` from both prop interfaces because `runStatus` now controls every poll.
`LegacyGraphLogsPane` derives the selected node state from `visibleNodeStates` and passes it to `LegacyNodeRoom`, which passes it only to the agent pane.
Add `nodeState: WorkflowNodeStateResponse | undefined` to `LegacyNodeRoomProps`; do not add it to `LegacyGraphLogsPaneProps` because that component already receives the complete `nodeStates` collection.
`WorkflowExecution` owns `AskActionStateByRequest` and resets it in the existing run-id effect.
Create one controller per `runId` with `useMemo`.
Wrap `setActionState` and the invalidator in `useCallback` so the controller's private in-flight set survives the rerender caused by its own sending-state update.
Its `setActionState` performs an immutable update by request id.
Its invalidator uses `Promise.allSettled` for `['workflowRun', runId]` and the prefix `['workflowNodeMessages', runId]`, and always resolves so a cache failure cannot rewrite mutation state.
Pass the merged `workflow.status`, not the possibly stale raw GET status, as `runStatus` to `LegacyGraphLogsPane`.
Pass the selected node's generated state, pending rows, viewer/name fields, action map, and `controller.submit` through the pane props.
Render `WorkflowAskChrome` beside `StatusBadge`.
Pass `setSelectedDagNode` to `onSelectAwaitingNode` and pass a callback that calls `setActiveView('graph')` to `onRequestGraphView`.

- [ ] **Step 1: Extract `mapWorkflowRunDetail` with no behavior change.**

Move the current query-function mapping verbatim into the exported function before adding new fields.

- [ ] **Step 1a: Run the existing execution suite and verify the refactor stays GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/WorkflowExecution.test.tsx`.
Expected result: the existing suite stays green because this is a covered refactor.

- [ ] **Step 2: Add one failing mapper test.**

Use one literal generated-shape response and assert pending interactions, viewer flag, starter display name, and string metadata error are retained.
Use a second metadata fixture with non-string error and assert `runError` is null.

- [ ] **Step 3: Run mapper RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/WorkflowExecution.test.tsx --test-name-pattern "maps Ask read-model fields"`.
Expected failure: the returned interface lacks the new fields.

- [ ] **Step 4: Add the four mapped fields.**

Use direct field assignment and the locked string guard for `metadata.error`.

- [ ] **Step 4a: Rerun the mapper test and verify GREEN.**

Run the same command and require PASS.

- [ ] **Step 5: Add one failing pure reset-state test.**

Extract and export `emptyAskActionStates(): AskActionStateByRequest`, assert it returns a fresh empty object on each call, and use it as the initial state and run-id reset value.

- [ ] **Step 6: Run the fresh-state test and verify RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/WorkflowExecution.test.tsx --test-name-pattern "creates fresh Ask action state per run"`.
Expected failure: `emptyAskActionStates` is missing.

- [ ] **Step 6a: Add the fresh-state helper and use it for initialization and run-id reset.**

Return a new typed object on every call.

- [ ] **Step 6b: Rerun the fresh-state test and verify GREEN.**

Run the same command and require PASS.

- [ ] **Step 7: Change only the polling helper test to accept run statuses.**

Assert pending, running, and paused return 1000 while completed, failed, and cancelled return false.

- [ ] **Step 7a: Run the polling-helper test and verify RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx --test-name-pattern "polls node messages for non-terminal run statuses"`.
Expected failure: the current boolean helper cannot satisfy the status matrix.

- [ ] **Step 8: Replace `transcriptRefetchInterval` with an exhaustive status switch.**

Do not change component props in this step.

- [ ] **Step 8a: Rerun the polling-helper test and verify GREEN.**

Run the same command and require PASS.

- [ ] **Step 9: Add one failing anchored-card pane test.**

Return a tool message whose `payload.id` matches a pending Ask and assert the tool chip precedes the form plus Submit reports the exact request id and body.

- [ ] **Step 9a: Add one failing three-door integration test.**

Select the same agent node from Logs, the Graph callback, and a Chat timeline entry in isolated renders and assert each opens the same `${nodeId} room` with the same anchored Ask card.

- [ ] **Step 9b: Narrow `expectNoAskHumanChrome` only for the agent-room fixtures that now deliberately render Ask state.**

Keep its existing bans for bash, script, gate, workflow, route, loop-group, Chat timeline, and composer fixtures.

- [ ] **Step 9c: Add one failing pane placement-boundary test.**

Assert an unanchored current Ask renders at the end, an Ask anchored in a different loop slice does not render, and a transcript status row named awaiting never creates a card.

- [ ] **Step 9d: Add one failing transcript-error availability test.**

Assert a transcript query error still renders every node Ask after its Retry UI.

- [ ] **Step 9e: Add one failing multiple-card independence test.**

Assert two pending Asks keep independent states and only the first actionable card focuses.

- [ ] **Step 9f: Add one failing malformed-envelope integration test.**

Assert malformed pending data renders `Invalid Ask payload` with no mutation actions.

- [ ] **Step 9g: Add one failing named read-only integration test.**

Assert a non-starter card names Avery, disables choices, and omits Submit and Decline.

- [ ] **Step 9h: Add one characterization test for non-agent room isolation.**

Assert a non-agent room with a pending row renders its normal typed room without an Ask form.

- [ ] **Step 9i: Add one characterization test for composer isolation.**

Assert the Chat composer keeps aria-label `Run conversation composer`, calls only `sendParentMessage`, and never calls `onSubmitAsk`.

- [ ] **Step 10: Run vertical integration RED.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx`.
Expected failure: the new pane and three-door tests fail because legacy composition does not yet accept Ask props or render cards.
The two isolation characterizations may already pass and require no production change.

- [ ] **Step 11: Implement final Ask composition in `NodeTranscriptPane`.**

Use the locked final pane interface, selection functions, presentation function, and generic `NodeRoom` slots.

- [ ] **Step 11a: Thread the final props through `LegacyNodeRoom` and `LegacyGraphLogsPane`.**

Remove both `isLive` props and pass Ask props only into the agent-room branch.
Derive `nodeState` from `visibleNodeStates` for the selected row.

- [ ] **Step 11b: Add controller ownership and final legacy-pane props in `WorkflowExecution`.**

Use `emptyAskActionStates` for initialization and the existing run-id reset effect.
Create stable callbacks and one memoized controller with Task 2's answer client and the two exact query invalidations.
Pass merged `workflow.status` to the legacy pane.

- [ ] **Step 12: Run the vertical integration suites and verify GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx`.

- [ ] **Step 12a: Run package type-check and verify GREEN.**

Run `cd packages/web && bun run type-check`.
Expected result: PASS with no stale `isLive` props or missing fields.

- [ ] **Step 13: Render the already-tested `WorkflowAskChrome` beside `StatusBadge` with both state-setter callbacks.**

Task 7's component test already proves the click requests Graph view before node selection.
This step supplies the live mapped props and the existing state setters without adding a second navigation implementation.

- [ ] **Step 14: Verify all direct component suites GREEN.**

Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/WorkflowAskChrome.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/AskCard.test.tsx`.

- [ ] **Step 15: Verify package type-check GREEN.**

Run `cd packages/web && bun run type-check`.
Expected result: PASS with no missing props or type errors.

- [ ] **Step 16: Commit Task 9.**

```bash
git add packages/web/src/components/workflows/NodeTranscriptPane.tsx packages/web/src/components/workflows/NodeTranscriptPane.test.tsx packages/web/src/components/workflows/LegacyNodeRoom.tsx packages/web/src/components/workflows/LegacyNodeRoom.test.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx packages/web/src/components/workflows/WorkflowAskChrome.tsx packages/web/src/components/workflows/WorkflowAskChrome.test.tsx
git commit -m "feat(web): answer Asks from the legacy run view"
```

### Task 10: Run regressions, validate, and close sprint tracking

**Files:**

- Verify without production changes: `packages/web/src/components/workflows/ChatTimeline.test.tsx`.
- Verify without production changes: `packages/web/src/components/workflows/RunChatComposer.test.tsx`.
- Verify without production changes: `packages/web/src/components/workflows/GateRoom.test.tsx`.
- Verify without production changes: Story 6.3 answer-route cases in `packages/server/src/routes/api.workflow-runs.test.ts`.
- Modify after all validation: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:2`, `:37`, `:59`, and remove `:64-82`.

**Interfaces:**

- Consumes: every prior task's committed result.
- Produces: validation evidence and a clean Story 6.5 `done` tracking entry.

- [ ] **Step 1: Run the focused web logic and store suites.**

```bash
cd packages/web
bun test src/lib/api.ask.test.ts src/lib/api.conversations.test.ts
bun test src/stores/workflow-store.test.ts
bun test src/components/workflows/parse-ask-envelope.test.ts src/components/workflows/merge-agent-room-items.test.ts src/components/workflows/ask-answer-controller.test.ts src/components/workflows/ask-card-presentation.test.ts src/components/workflows/awaiting-chrome.test.ts
```

Expected result: every command exits 0 with no warning or unhandled rejection.

- [ ] **Step 2: Run the focused legacy component suites.**

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx src/components/workflows/WorkflowAskChrome.test.tsx src/components/workflows/StatusIcon.test.tsx src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/NodeRunList.test.tsx src/components/workflows/ExecutionDagNode.test.tsx src/components/workflows/ChatTimeline.test.tsx src/components/workflows/RunChatComposer.test.tsx src/components/workflows/GateRoom.test.tsx
```

Expected result: every suite passes with no React act, key, hydration, or accessibility warnings.

- [ ] **Step 3: Run the complete server route file.**

Run `cd packages/server && bun test src/routes/api.workflow-runs.test.ts`.
Expected result: GET-run presentation and all existing Story 6.3 answer-route tests pass.

- [ ] **Step 4: Run type-check, lint, and formatting checks from repository root.**

```bash
bun run type-check
bun run lint
bun run format:check
```

Expected result: every command exits 0 with zero lint warnings.

- [ ] **Step 5: Run the repository validation command.**

Run `bun run validate` from repository root.
Expected result: all per-package isolated tests and validation checks pass.

- [ ] **Step 6: Run non-mutating scope guards.**

Run `rg -n "AskCard|WorkflowAskChrome|ask-answer-controller" packages/web/src/experiments/console packages/web/src/lib/run-graph` and require no matches.
Expected result for that `rg` command is exit status 1 because no match is the success condition.
Set `PLAN_BASE_SHA=$(tr -d '[:space:]' < /Users/agent/.archon/workspaces/anhle128/Archon/artifacts/runs/52a92fd38973120e3a4c058443e39582/superpowers/base-sha.txt)`.
Run `git diff --name-only "$PLAN_BASE_SHA"..HEAD -- packages/workflows packages/providers migrations packages/web/src/components/workflows/RunChatComposer.tsx packages/web/src/components/workflows/ChatTimeline.tsx` and require no output.

- [ ] **Step 7: Update sprint tracking only after Steps 1 through 6 are green.**

Delete the literal conflict-diagnostic block beginning `⚠ 2 unresolved conflicts detected` through the final `>>> theirs` line.
Set both the comment-form and YAML-form `last_updated` fields to the same current `+0700` timestamp because that is the file's established offset.
Set only `6-5-answer-the-ask-in-the-legacy-node-room` from `backlog` to `done`.
Leave `6-4`, `6-6`, `6-7`, and epic status unchanged.

- [ ] **Step 8: Validate the tracking file and inspect the final diff.**

Run `bun -e 'const text = await Bun.file("_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml").text(); Bun.YAML.parse(text); console.log("valid")'`.
Run `git diff --check`.
Run `git status --short` and confirm only planned files are present.

- [ ] **Step 9: Commit Task 10.**

```bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark AskHuman legacy room story 6.5 done"
```

- [ ] **Step 10: Record implementation evidence in the handoff or PR Validation section.**

Record the exact commands from Steps 1 through 5 and their passing results.
Do not claim manual browser, keyboard, screen-reader, or multi-user evidence unless it was actually performed.
Do not close issue 90 directly unless the later PR workflow links it with `Closes #90`.

## Acceptance Criteria

- [ ] A selected agent node renders each pending or answered `kind: ask` row inline immediately after its matching tool invocation from the shared Logs, Graph, and Chat doors.
- [ ] A current Ask whose tool row has not arrived remains visible at the end of the current room, while loop-iteration rooms never show an Ask anchored in another iteration.
- [ ] Cards originate only from GET-run `pending_interactions`; transcript status rows and SSE payloads never create cards.
- [ ] Malformed Ask envelopes render a non-interactive visible contract error with raw payload instead of disappearing or crashing.
- [ ] Single, multi, and Other inputs obey the canonical validity rules, and one submit sends the whole ordered answer set once.
- [ ] Two Ask cards have independent sending, error, accepted, and duplicate states, and a rapid duplicate submit for one request cannot issue a second POST.
- [ ] Decline uses the same answer endpoint with `{ decline: true }` after the exact confirmation copy.
- [ ] Successful answers remain visibly accepted while refetch catches up, 409 renders `Already answered`, and unrelated node failures do not render failed-resume.
- [ ] Exact resume failure renders the preserved answer and failed-resume error stamp.
- [ ] Only the first actionable card in a room receives focus.
- [ ] A non-starter sees disabled inputs, `Waiting for <starter name> to answer`, and no Submit or Decline.
- [ ] A starter-less or unsigned view is never treated as the starter.
- [ ] Paused plus pending Ask renders warning `Awaiting input (n)`, and clicking the pill selects the first awaiting node in Graph view.
- [ ] Awaiting graph, sidebar, and room chrome uses warning tokens, accessible state, and visible `waiting on you` copy without error tokens.
- [ ] A declared-gate pause with no pending Ask does not render Ask awaiting chrome.
- [ ] CAP-7 start rejection renders the persisted unsupported-provider message with error chrome and no awaiting pill.
- [ ] Paused SSE invalidates GET-run data, and node transcript polling continues for pending, running, and paused statuses.
- [ ] The Chat composer remains a parent-conversation path and cannot answer or decline an Ask.
- [ ] Permission rows and non-agent rooms never render Ask cards.
- [ ] Legacy code does not introduce a shared React NodePanel or any import into Command Center.
- [ ] Focused tests, server tests, type-check, lint, formatting, and `bun run validate` all pass.
- [ ] The sprint file contains valid YAML, no conflict-diagnostic block, matching timestamps, and Story 6.5 marked done.

## Open Questions

None.
The approved Story 6.5 artifacts and current repository provide enough information for the locked defaults above.
