# Node Type Rooms (Legacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator select any row in the legacy run Logs view and see one accessible room whose header and body match the node type, without representing deterministic or control-flow nodes as agent chat.

**Architecture:** Keep LegacyNodeLogs as the single Logs list-and-room shell introduced by Story 5.1.
Resolve the selected row from the current workflow definition first, then from persisted run events and the current ApprovalContext, and mount NodeTranscriptPane only for command, prompt, loop, or unmatched agent-compatible nodes.
Read non-agent room data from the already-fetched run events and metadata; this story changes no engine, database, API, workflow language, console, or full-run graph contract.

**Tech Stack:** Bun, strict TypeScript, React 19, TanStack Query, react-dom/server, happy-dom, and bun:test.

**Spec:** _bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md, Story 5.2.

**Approved design inputs:** _bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md, _bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md, _bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md, _bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md, _bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/README.md, and _bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md.

**Issue:** https://github.com/anhle128/Archon/issues/82

## Global Constraints

- Implement only Story 5.2 on the legacy WorkflowExecution Logs surface.
- Keep Story 5.2 inspect-only for AskHuman.
- Do not add an Ask card, an empty Ask slot, awaiting or waiting-on-you chrome, an awaiting run status, node_awaiting or interaction_resolved events, or remote_agent_pending_interactions.
- Keep declared approval and Plannotator gates on the existing ApprovalContext slot.
- Do not change workflow YAML, the NativeTool handler contract, provider resume behavior, pauseWorkflowRun, CLI, chat, manage_run, or command-center behavior.
- Do not add packages/web/src/lib/run-graph because Story 5.3 owns the full run graph.
- Keep the Graph tab and its existing merged WorkflowLogs panel unchanged.
- Keep remote_agent_messages as the merged chat path and do not add a node identifier to it.
- Keep GET /api/workflows/runs/:runId/nodes/:nodeId/messages as the command, prompt, and loop room source only.
- Do not write bash, script, workflow, approval, plannotator_gate, route_loop, or loop_group output to remote_agent_workflow_node_messages.
- Do not add type or node_output to workflowNodeStateSchema.
- Do not change an API route or regenerate packages/web/src/lib/api.generated.d.ts.
- Do not import @archon/workflows from @archon/web.
- Do not import packages/web/src/experiments/console into packages/web/src/components/workflows.
- Do not share a React room or panel component with the console.
- Keep exactly one list and one selected-room body mounted in the legacy Logs shell.
- A workflow room links a child run and never inlines the child transcript.
- Command, prompt, and loop rooms stay on the Story 5.1 NodeTranscriptPane and NodeRoom timeline.
- Do not introduce the TypeScript `any` type.
- Use only existing design tokens and existing dependencies.
- Do not run bun test from the repository root.
- Run focused tests from packages/web and finish with bun run validate from the repository root.
- For every behavior change, write and run the failing test first, confirm that it fails for the missing behavior, implement only enough production code to pass, rerun the focused test, and refactor only while green.
- Do not mark the sprint story done until all validation succeeds.

---

## Verified Repository Baseline

- Issue 82 requests Story 5.2 and requires its epic acceptance criteria, focused evidence, and the sprint-status transition.
- _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:47 marks Story 5.1 done and line 48 marks Story 5.2 backlog.
- packages/web/src/components/workflows/LegacyNodeLogs.tsx:16-75 owns the Logs list selection and always mounts NodeTranscriptPane.
- packages/web/src/components/workflows/NodeTranscriptPane.tsx:14-48 owns the TanStack Query boundary for the agent transcript.
- packages/web/src/components/workflows/NodeRoom.tsx:118-124 owns the exact shared empty-state markup.
- packages/web/src/components/workflows/NodeRoom.tsx:186-235 places the labelled region only around a loaded transcript, so selected loading, error, and empty agent states currently have no labelled room.
- packages/web/src/components/workflows/build-log-rows.ts:6-23 defines LogRow and its node, loop-iteration, and route-iteration selections.
- packages/web/src/components/workflows/build-log-rows.ts:25-143 treats the event array as chronological and uses the latest ordinary node start as that row's id.
- packages/web/src/components/workflows/WorkflowExecution.tsx:69-78 omits run.metadata.approval from WorkflowRunQueryData.
- packages/web/src/components/workflows/WorkflowExecution.tsx:279-319 maps the GET run response into that query shape.
- packages/web/src/components/workflows/WorkflowExecution.tsx:397-418 already fetches the current workflow definition for the Graph tab.
- packages/web/src/components/workflows/WorkflowExecution.tsx:770-788 renders LegacyNodeLogs only for the Logs branch.
- packages/web/src/components/dashboard/WorkflowRunCard.tsx:118-133 contains the existing HTTP(S)-only Plannotator review URL validation.
- packages/web/src/components/dashboard/WorkflowRunCard.tsx:333-376 contains the current Plannotator, Approve, and Reject affordances.
- packages/web/src/components/dashboard/ConfirmRunActionDialog.tsx:24-43 defines an optional rejection reason and calls onConfirm with string or undefined.
- packages/web/src/lib/api.ts:381-402 exposes approveWorkflowRun and rejectWorkflowRun.
- packages/web/src/lib/api.ts:421-449 exposes GET run and GET node messages.
- packages/web/src/lib/api.generated.d.ts:4227-4578 exposes the flat generated DagNode shape used by the web package.
- packages/web/src/lib/api.generated.d.ts:4725-4794 exposes run detail, event, and node-state response types.
- packages/workflows/src/dag-executor.ts:3282-3485 persists bash type, completion stdout, optional truncation metadata, and failure detail.
- packages/workflows/src/dag-executor.ts:3568-3870 persists the equivalent script lifecycle without the bash byte cap.
- packages/workflows/src/dag-executor.ts:4031-4091 namespaces loop-group body step names with dot-separated group ids.
- packages/workflows/src/dag-executor.ts:4181-4475 persists loop_iteration_started and loop_iteration_completed events for loop groups.
- packages/workflows/src/dag-executor.ts:6296-6324 persists approval_requested with gateType, nodeId, and message.
- packages/workflows/src/plannotator-gate-supervisor.ts:195-204 persists approval_requested with gateType plannotator_gate and the live review URL.
- packages/workflows/src/dag-executor.ts:6727-6742 persists a single child run id on a completed workflow node.
- packages/workflows/src/dag-executor.ts:7180-7194 persists fan_out true on a completed fan-out workflow node without a single child id.
- packages/workflows/src/dag-executor.ts:8661-8668 persists node_routed decisions.
- GET run nodeStates have neither node type nor stdout, and the implementation must not expand that schema for this UI.

## Scope Decisions

These are resolved implementation decisions, not open product questions.

1. Fan-out workflow nodes do not add a children-list API in this story.
A fan-out room shows the persisted summary and captured node output when present, without inventing individual child links.

2. Bash and script rooms do not live-stream subprocess output.
They show persisted completion output and update through the existing GET run polling.

3. Definition lookup uses the current GET workflow payload because the run does not persist an authored-definition snapshot.
Persisted event and ApprovalContext fallbacks keep include-expanded and definition-unavailable rows useful without changing the backend.
While the definition query is pending, an otherwise unknown row shows Loading node room and does not start an agent transcript request.

4. An unmatched row remains agent-compatible only after non-agent ApprovalContext and event hints are exhausted.
This preserves Story 5.1 for include-expanded command, prompt, and loop ids while preventing known deterministic nodes from issuing the transcript request.

5. Gate rooms reuse the existing Approve, Reject, and Open Plannotator behavior only when the selected declared gate owns the unresolved paused ApprovalContext.
They never expose parent approval controls for child_workflow, interactive_loop, or writeback contexts.

6. A loop-group room shows authored body topology as node ids plus each node's direct dependencies and shows per-iteration body status in details elements.
It does not add a second graph layout implementation before Story 5.3.

7. Ordinary stdout, gate, and workflow reruns show data only from the selected latest row attempt.
A failed rerun must not display stdout or a child id from an earlier successful attempt.

8. The event array order is authoritative for latest-event selection, matching build-log-rows.ts.
Selectors never sort by timestamps.

9. Every selected room state, including loading, error, and no-output states, has exactly one region labelled with the selected node id.
The unselected Select a node state has no room region.

## File Map and Responsibilities

### Shared approval metadata

- Create packages/web/src/lib/approval-context.ts to normalize the untyped run metadata approval value and validate Plannotator URLs.
- Create packages/web/src/lib/approval-context.test.ts for malformed metadata, historical omitted type, URL protocol, and paused-status coverage.
- Modify packages/web/src/components/dashboard/WorkflowRunCard.tsx:118-133 and 193 to use the extracted helper without changing dashboard behavior.

### Room classification and persisted-data selection

- Create packages/web/src/components/workflows/resolve-room-kind.ts for pure definition, ApprovalContext, and event classification.
- Create packages/web/src/components/workflows/resolve-room-kind.test.ts for every authored node mode, nested loop-group body ids, active metadata, gate events, and include-expanded fallbacks.
- Create packages/web/src/components/workflows/select-room-data.ts for stdout, gate, child-run, route-decision, and loop-group view models.
- Create packages/web/src/components/workflows/select-room-data.test.ts for chronological selection, latest-attempt isolation, malformed event data, and every view-model branch.

### Type-specific legacy room bodies

- Modify packages/web/src/components/workflows/NodeRoom.tsx:118-124 and 186-235 to export the shared placeholder and give every selected agent state one labelled region.
- Modify packages/web/src/components/workflows/NodeRoom.test.tsx:70-203 for the selected loading, error, and no-output region contract.
- Create packages/web/src/components/workflows/StdoutRoom.tsx and packages/web/src/components/workflows/StdoutRoom.test.tsx.
- Create packages/web/src/components/workflows/GateRoom.tsx and packages/web/src/components/workflows/GateRoom.test.tsx.
- Create packages/web/src/components/workflows/ChildWorkflowRoom.tsx and packages/web/src/components/workflows/ChildWorkflowRoom.test.tsx.
- Create packages/web/src/components/workflows/RouteControllerRoom.tsx and packages/web/src/components/workflows/RouteControllerRoom.test.tsx.
- Create packages/web/src/components/workflows/LoopGroupRoom.tsx and packages/web/src/components/workflows/LoopGroupRoom.test.tsx.

### Dispatcher and one-panel wiring

- Create packages/web/src/components/workflows/LegacyNodeRoom.tsx for the shared selected-node header and the single type switch.
- Create packages/web/src/components/workflows/LegacyNodeRoom.test.tsx for dispatcher behavior and transcript-fetch suppression.
- Modify packages/web/src/components/workflows/LegacyNodeLogs.tsx:6-25 and 27-75 to pass the definition, definition pending state, approval, status, and actions into LegacyNodeRoom.
- Modify packages/web/src/components/workflows/LegacyNodeLogs.test.tsx:1-307 for end-to-end Logs selection across agent and non-agent types.
- Modify packages/web/src/components/workflows/WorkflowExecution.tsx:18-24, 69-78, 279-319, and 770-788 to retain approval metadata and wire actions only in the Logs branch.
- Leave packages/web/src/components/workflows/NodeTranscriptPane.tsx unchanged.
- Leave packages/web/src/components/workflows/WorkflowExecution.test.tsx unchanged because the new WorkflowExecution work is typed prop plumbing; consumer behavior is covered in LegacyNodeLogs.test.tsx and action failures are covered in GateRoom.test.tsx.

### Completion tracking

- Modify _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:2, 37, and 48 only after validation passes.

## Authoritative Interfaces

### Room classification

~~~ts
export type NodeBodyKind =
  | 'command'
  | 'prompt'
  | 'loop'
  | 'bash'
  | 'script'
  | 'approval'
  | 'plannotator_gate'
  | 'workflow'
  | 'route_loop'
  | 'loop_group'
  | 'unknown';

export type RoomKind =
  | 'agent'
  | 'stdout'
  | 'gate'
  | 'workflow'
  | 'route_loop'
  | 'loop_group';

export interface RoomResolution {
  kind: RoomKind;
  nodeType: NodeBodyKind;
  definitionNode: DagNode | null;
}

export function resolveRoomKind(
  nodeId: string,
  definitionNodes: readonly DagNode[],
  events: readonly WorkflowEventResponse[],
  approval: unknown
): RoomResolution;
~~~

For an authored node, inspect the mutually exclusive Story 5.2 body fields in this order: route_loop, loop_group, loop, plannotator_gate, approval, bash, script, workflow, command, prompt.

Find an authored match recursively.
At each level, compare the qualified id formed by the current dot-separated loop-group prefix plus node.id, then recurse into loop_group.nodes with that qualified id as the next prefix.

After definition lookup fails, use these fallbacks in order:

1. A matching normalized ApprovalContext with type child_workflow resolves to workflow.
2. A matching normalized ApprovalContext with type approval, plannotator_gate, or omitted resolves to gate.
3. Any matching node_routed event resolves to route_loop.
4. The latest matching node_started, node_completed, or node_failed event with data.type bash or script resolves to stdout.
5. The latest matching node_completed or node_failed event with data.type workflow resolves to workflow.
6. The latest matching approval_requested event with data.gateType approval or plannotator_gate resolves to gate.
7. Otherwise resolve to agent with nodeType unknown.

Do not use loop_iteration events alone to distinguish loop from loop_group.

### Attempt-scoped event data

For an ordinary LogRow, locate row.id in the original event array and inspect matching step_name events from that index onward.
If row.id is absent, inspect all matching events as a defensive fallback.
For route_iteration, match data.execution_seq exactly.
For a loop-group iteration row, set selectedIteration from row.selection and build the accordion from every positive safe-integer iteration in the event array.
This matches build-log-rows.ts, which collapses loop history by iteration number rather than preserving retry attempts.

~~~ts
export interface StdoutView {
  text: string | null;
  status: LogRow['status'];
  exitCode: 0 | null;
  truncated: boolean;
  originalBytes: number | null;
  failedDetail: string | null;
}

export interface GateChrome {
  gateType: 'approval' | 'plannotator_gate';
  message: string;
  document: string | null;
  decision: 'approved' | 'rejected' | null;
  canDecide: boolean;
  showInactiveNotice: boolean;
  reviewUrl: string | null;
}

export interface ChildRunRef {
  childRunId: string | null;
  fanOut: boolean;
  output: string | null;
  paused: boolean;
  message: string | null;
  status: LogRow['status'];
}

export interface RouteDecisionView {
  outcome: string | null;
  to: string | null;
  condition: string | null;
  conditionResult: string | null;
  attempt: string | null;
  executionSeq: string | null;
  negativeCount: string | null;
  maxIterations: string | null;
}

export interface LoopGroupBodyNode {
  id: string;
  qualifiedId: string;
  dependsOn: string[];
}

export interface LoopGroupBodyState extends LoopGroupBodyNode {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

export interface LoopGroupIterationView {
  iteration: number;
  status: 'running' | 'completed' | 'failed';
  body: LoopGroupBodyState[];
}

export interface LoopGroupChrome {
  body: LoopGroupBodyNode[];
  iterations: LoopGroupIterationView[];
  selectedIteration: number | null;
}

export function selectNodeStdout(
  events: readonly WorkflowEventResponse[],
  row: LogRow
): StdoutView;

export function selectGateChrome(input: {
  definitionNode: DagNode | null;
  events: readonly WorkflowEventResponse[];
  row: LogRow;
  approval: unknown;
  runStatus: WorkflowRunStatus;
  gateType: 'approval' | 'plannotator_gate';
}): GateChrome;

export function selectChildRun(input: {
  events: readonly WorkflowEventResponse[];
  approval: unknown;
  row: LogRow;
  runStatus: WorkflowRunStatus;
}): ChildRunRef;

export function selectRouteDecision(
  events: readonly WorkflowEventResponse[],
  row: LogRow
): RouteDecisionView | null;

export function selectLoopGroupChrome(input: {
  definitionNode: DagNode | null;
  events: readonly WorkflowEventResponse[];
  row: LogRow;
}): LoopGroupChrome;
~~~

selectNodeStdout returns a StdoutView for every selected stdout row.
It uses the last terminal event in the selected attempt.
A later node_failed suppresses an earlier completion from that attempt.
A completed event with a string node_output returns that exact string, including the empty string, and exitCode 0.
Truncation is true only for literal true, and originalBytes accepts only a non-negative safe integer.

selectGateChrome uses the declared message first, then the matching ApprovalContext message, then Approval required or Plannotator review.
For a Plannotator gate it uses the matching ApprovalContext document first and the declared document second.
It reads approved or rejected first from a matching selected-attempt node_completed data.approval_decision, then from a matching ApprovalContext resolved value while auto-resume is still pending.
It sets canDecide only when the run is paused, the normalized context belongs to this node, its type is compatible with the selected gate, and resolved is neither approved nor rejected.
It sets showInactiveNotice only while the run is paused at another or incompatible context.
It sets reviewUrl from getPlannotatorReviewUrl only when that same normalized ApprovalContext belongs to the selected node; otherwise reviewUrl is null.

selectChildRun accepts the selected row and run status.
A paused child_workflow ApprovalContext wins only when the run is paused and nodeId matches.
Otherwise the last selected-attempt workflow completion supplies fan_out, child_run_id, and node_output.
A later selected-attempt failure suppresses an earlier completion.

selectRouteDecision returns null if the selected route event is absent.
It stringifies only string, finite number, or boolean fields and represents every missing or malformed field as null.

selectLoopGroupChrome keeps authored body order.
For each direct definitionNode.loop_group.nodes entry, it sets qualifiedId to row.nodeId + '.' + child.id and copies depends_on to a fresh array, defaulting to an empty array.
It uses last-event-wins for each positive safe-integer loop iteration.
Inside each iteration it derives direct body status from qualified lifecycle events with the same data.iteration.
It does not derive lifecycle from this selector for the full run or write back to nodeStates.

### Shared selected-room contract

~~~ts
export interface LegacyNodeRoomProps {
  runId: string;
  row: LogRow | null;
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  events: readonly WorkflowEventResponse[];
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}
~~~

LegacyNodeRoom renders Select a node and no region when row is null.
For a selected row it renders a compact header with row.label, the resolved node type, and row.status, followed by exactly one labelled room region.
Only the agent branch mounts NodeTranscriptPane.
When definitionPending is true and classification has only the unknown agent fallback, it renders Loading node room inside RoomRegion instead of mounting NodeTranscriptPane.

### Exact visible copy

- Select a node
- Node hasn't produced output
- Loading node transcript
- Loading node room
- Failed to load node transcript
- Output truncated from N bytes
- Output truncated
- Exit status: 0
- Gate is not the active pause
- Waiting for approval
- Approved
- Rejected
- Open Plannotator
- Approve
- Reject
- Child run
- Open child run
- This node spawned multiple child runs
- Sub-run is paused awaiting review
- Routing decision
- Loop group
- Body nodes

Do not add a period to Select a node.
Do not change the primary no-output copy to Node hasn't produced output yet.

---

### Task 1: Extract the web ApprovalContext and Plannotator URL boundary

**Files:**

- Create packages/web/src/lib/approval-context.ts.
- Create packages/web/src/lib/approval-context.test.ts.
- Modify packages/web/src/components/dashboard/WorkflowRunCard.tsx:118-133 and 193.

**Interfaces:**

- Produces WebApprovalContext, readApprovalContext, and getPlannotatorReviewUrl.
- Consumed by Tasks 2, 3, and 5.

- [ ] **Step 1: Write the failing helper tests.**

Create literal fixtures and these tests:

~~~ts
import { describe, expect, test } from 'bun:test';
import { getPlannotatorReviewUrl, readApprovalContext } from './approval-context';

describe('readApprovalContext', () => {
  test('keeps required and type-correct optional fields', () => {
    expect(
      readApprovalContext({
        nodeId: 'review',
        message: 'Review the plan',
        type: 'plannotator_gate',
        childRunId: 'child-1',
        document: '/tmp/review.md',
        reviewUrl: 'https://review.example/session',
        resolved: null,
      })
    ).toEqual({
      nodeId: 'review',
      message: 'Review the plan',
      type: 'plannotator_gate',
      childRunId: 'child-1',
      document: '/tmp/review.md',
      reviewUrl: 'https://review.example/session',
      resolved: null,
    });
  });

  test('rejects values without the two required strings', () => {
    expect(readApprovalContext(null)).toBeNull();
    expect(readApprovalContext({ nodeId: 'review' })).toBeNull();
    expect(readApprovalContext({ nodeId: 1, message: 'Review' })).toBeNull();
  });

  test('keeps the historical approval shape whose type is omitted', () => {
    expect(readApprovalContext({ nodeId: 'review', message: 'Review' })).toEqual({
      nodeId: 'review',
      message: 'Review',
    });
  });

  test('rejects unsupported optional enum values', () => {
    expect(
      readApprovalContext({
        nodeId: 'review',
        message: 'Review',
        type: 'unsupported',
        resolved: 'pending',
      })
    ).toBeNull();
  });
});

describe('getPlannotatorReviewUrl', () => {
  const approval = {
    nodeId: 'review',
    message: 'Review',
    type: 'plannotator_gate',
    reviewUrl: 'https://review.example/session',
  };

  test('returns a normalized HTTP(S) URL only for a paused Plannotator gate', () => {
    expect(getPlannotatorReviewUrl({ status: 'paused', approval })).toBe(
      'https://review.example/session'
    );
    expect(
      getPlannotatorReviewUrl({
        status: 'paused',
        approval: { ...approval, reviewUrl: 'http://review.example/session' },
      })
    ).toBe('http://review.example/session');
    expect(getPlannotatorReviewUrl({ status: 'running', approval })).toBeNull();
    expect(
      getPlannotatorReviewUrl({
        status: 'paused',
        approval: { ...approval, type: 'approval' },
      })
    ).toBeNull();
  });

  test('rejects malformed and unsafe URLs', () => {
    expect(
      getPlannotatorReviewUrl({
        status: 'paused',
        approval: { ...approval, reviewUrl: 'javascript:alert(1)' },
      })
    ).toBeNull();
    expect(
      getPlannotatorReviewUrl({
        status: 'paused',
        approval: { ...approval, reviewUrl: 'not a url' },
      })
    ).toBeNull();
  });
});
~~~

- [ ] **Step 2: Run the helper test and verify RED.**

Run:

~~~bash
( cd packages/web && bun test src/lib/approval-context.test.ts )
~~~

Expected: FAIL because approval-context.ts and its exports do not exist.

- [ ] **Step 3: Implement the normalized metadata boundary and switch WorkflowRunCard to it.**

Use this complete public shape:

~~~ts
export type WebApprovalContextType =
  | 'approval'
  | 'plannotator_gate'
  | 'child_workflow'
  | 'interactive_loop'
  | 'writeback';

export interface WebApprovalContext {
  nodeId: string;
  message: string;
  type?: WebApprovalContextType;
  childRunId?: string;
  document?: string;
  reviewUrl?: string | null;
  resolved?: 'approved' | 'rejected' | null;
}

function isApprovalContextType(value: unknown): value is WebApprovalContextType {
  return (
    value === 'approval' ||
    value === 'plannotator_gate' ||
    value === 'child_workflow' ||
    value === 'interactive_loop' ||
    value === 'writeback'
  );
}

export function readApprovalContext(value: unknown): WebApprovalContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.nodeId !== 'string' || typeof record.message !== 'string') return null;
  if (record.type !== undefined && !isApprovalContextType(record.type)) return null;
  if (
    record.resolved !== undefined &&
    record.resolved !== null &&
    record.resolved !== 'approved' &&
    record.resolved !== 'rejected'
  ) {
    return null;
  }
  return {
    nodeId: record.nodeId,
    message: record.message,
    ...(isApprovalContextType(record.type) ? { type: record.type } : {}),
    ...(typeof record.childRunId === 'string' ? { childRunId: record.childRunId } : {}),
    ...(typeof record.document === 'string' ? { document: record.document } : {}),
    ...(typeof record.reviewUrl === 'string' || record.reviewUrl === null
      ? { reviewUrl: record.reviewUrl }
      : {}),
    ...(record.resolved === 'approved' ||
        record.resolved === 'rejected' ||
        record.resolved === null
      ? { resolved: record.resolved }
      : {}),
  };
}

export function getPlannotatorReviewUrl(input: {
  status: string;
  approval: unknown;
}): string | null {
  if (input.status !== 'paused') return null;
  const approval = readApprovalContext(input.approval);
  if (approval?.type !== 'plannotator_gate' || typeof approval.reviewUrl !== 'string') return null;
  try {
    const url = new URL(approval.reviewUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
~~~

Delete the private helper in WorkflowRunCard.
Import getPlannotatorReviewUrl from @/lib/approval-context and call it with run.status and run.metadata.approval.

- [ ] **Step 4: Run the helper and dashboard regression tests and verify GREEN.**

Run:

~~~bash
( cd packages/web && bun test src/lib/approval-context.test.ts src/components/dashboard/WorkflowRunCard.test.tsx )
~~~

Expected: PASS, including the existing unsafe-scheme dashboard case.

- [ ] **Step 5: Commit Task 1.**

~~~bash
git add packages/web/src/lib/approval-context.ts packages/web/src/lib/approval-context.test.ts packages/web/src/components/dashboard/WorkflowRunCard.tsx
git commit -m "refactor(web): share approval metadata parsing"
~~~

### Task 2: Add pure node-room classification

**Files:**

- Create packages/web/src/components/workflows/resolve-room-kind.ts.
- Create packages/web/src/components/workflows/resolve-room-kind.test.ts.

**Interfaces:**

- Consumes DagNode and WorkflowEventResponse from @/lib/api and readApprovalContext from Task 1.
- Produces NodeBodyKind, RoomKind, RoomResolution, and resolveRoomKind exactly as declared above.

- [ ] **Step 1: Write the failing classifier tests.**

Use literal DagNode fixtures and assert all of these independent mutations:

~~~ts
import { describe, expect, test } from 'bun:test';
import type { DagNode, WorkflowEventResponse } from '@/lib/api';
import { resolveRoomKind } from './resolve-room-kind';

function event(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

const nodes: DagNode[] = [
  { id: 'command', command: 'review' },
  { id: 'prompt', prompt: 'Write' },
  { id: 'loop', loop: { max_iterations: 2, fresh_context: false } },
  { id: 'bash', bash: 'echo hi' },
  { id: 'script', script: 'console.log(1)' },
  { id: 'approval', approval: { message: 'Ship?' } },
  {
    id: 'plannotator',
    plannotator_gate: { document: 'review.md', rework: { prompt: 'Fix' } },
  },
  { id: 'workflow', workflow: 'child' },
  {
    id: 'router',
    route_loop: {
      condition: '$review.output',
      max_iterations: 2,
      routes: { positive: 'done', negative: 'fix', exhausted: 'stop' },
    },
  },
  {
    id: 'group',
    loop_group: {
      max_iterations: 2,
      fresh_context: false,
      nodes: [
        { id: 'body', prompt: 'Work' },
        {
          id: 'nested',
          loop_group: {
            max_iterations: 2,
            fresh_context: false,
            nodes: [{ id: 'check', bash: 'echo ok' }],
          },
        },
      ],
    },
  },
];

describe('resolveRoomKind', () => {
  test('maps every authored body mode without resolveNodeDisplay collapse', () => {
    expect(nodes.map(node => resolveRoomKind(node.id, nodes, [], null).kind)).toEqual([
      'agent',
      'agent',
      'agent',
      'stdout',
      'stdout',
      'gate',
      'gate',
      'workflow',
      'route_loop',
      'loop_group',
    ]);
  });

  test('recursively resolves qualified loop-group body ids', () => {
    expect(resolveRoomKind('group.body', nodes, [], null).nodeType).toBe('prompt');
    expect(resolveRoomKind('group.nested', nodes, [], null).kind).toBe('loop_group');
    expect(resolveRoomKind('group.nested.check', nodes, [], null).kind).toBe('stdout');
  });

  test('uses matching ApprovalContext when the current definition is unavailable', () => {
    expect(
      resolveRoomKind('gate', [], [], {
        nodeId: 'gate',
        message: 'Review',
        type: 'plannotator_gate',
      })
    ).toMatchObject({ kind: 'gate', nodeType: 'plannotator_gate' });
    expect(
      resolveRoomKind('child', [], [], {
        nodeId: 'child',
        message: 'Child paused',
        type: 'child_workflow',
        childRunId: 'child-1',
      }).kind
    ).toBe('workflow');
  });

  test('uses persisted non-agent event hints before the agent fallback', () => {
    expect(
      resolveRoomKind(
        'shell',
        [],
        [event({ step_name: 'shell', data: { type: 'script' } })],
        null
      ).kind
    ).toBe('stdout');
    expect(
      resolveRoomKind(
        'router',
        [],
        [event({ event_type: 'node_routed', step_name: 'router' })],
        null
      ).kind
    ).toBe('route_loop');
    expect(
      resolveRoomKind(
        'gate',
        [],
        [
          event({
            event_type: 'approval_requested',
            step_name: 'gate',
            data: { gateType: 'approval', message: 'Review' },
          }),
        ],
        null
      ).kind
    ).toBe('gate');
    expect(resolveRoomKind('include__agent', nodes, [], null).kind).toBe('agent');
  });
});
~~~

- [ ] **Step 2: Run the classifier test and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/resolve-room-kind.test.ts )
~~~

Expected: FAIL because resolve-room-kind.ts does not exist.

- [ ] **Step 3: Implement the pure classifier.**

Use a recursive findDefinitionNode that carries a string prefix.
Return the matched DagNode in definitionNode so later selectors do not repeat the tree walk.
Use explicit property checks and the exact priority in Authoritative Interfaces.
Scan fallback events from the end when the fallback says latest.
Never call resolveNodeDisplay and never import console detectVariant.

Use these exact definition helpers:

~~~ts
function findDefinitionNode(
  nodeId: string,
  nodes: readonly DagNode[],
  prefix = ''
): DagNode | null {
  for (const node of nodes) {
    const qualifiedId = prefix.length === 0 ? node.id : prefix + '.' + node.id;
    if (qualifiedId === nodeId) return node;
    if (node.loop_group !== undefined) {
      const nested = findDefinitionNode(nodeId, node.loop_group.nodes, qualifiedId);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function nodeBodyKind(node: DagNode): NodeBodyKind {
  if (node.route_loop !== undefined) return 'route_loop';
  if (node.loop_group !== undefined) return 'loop_group';
  if (node.loop !== undefined) return 'loop';
  if (node.plannotator_gate !== undefined) return 'plannotator_gate';
  if (node.approval !== undefined) return 'approval';
  if (node.bash !== undefined) return 'bash';
  if (node.script !== undefined) return 'script';
  if (node.workflow !== undefined) return 'workflow';
  if (node.command !== undefined) return 'command';
  if (node.prompt !== undefined) return 'prompt';
  return 'unknown';
}
~~~

The switch from body type to room kind is:

~~~ts
const ROOM_BY_BODY: Record<NodeBodyKind, RoomKind> = {
  command: 'agent',
  prompt: 'agent',
  loop: 'agent',
  bash: 'stdout',
  script: 'stdout',
  approval: 'gate',
  plannotator_gate: 'gate',
  workflow: 'workflow',
  route_loop: 'route_loop',
  loop_group: 'loop_group',
  unknown: 'agent',
};
~~~

Return a new RoomResolution value for every call and keep the module free of React and mutable module state.

- [ ] **Step 4: Run the classifier test and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/resolve-room-kind.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Commit Task 2.**

~~~bash
git add packages/web/src/components/workflows/resolve-room-kind.ts packages/web/src/components/workflows/resolve-room-kind.test.ts
git commit -m "feat(web): classify legacy node rooms"
~~~

### Task 3: Add attempt-scoped room data selectors

**Files:**

- Create packages/web/src/components/workflows/select-room-data.ts.
- Create packages/web/src/components/workflows/select-room-data.test.ts.

**Interfaces:**

- Consumes LogRow, DagNode and WorkflowEventResponse from @/lib/api, WorkflowRunStatus from @/lib/types, readApprovalContext, and getPlannotatorReviewUrl.
- Produces the five view-model interfaces and selectors defined in Authoritative Interfaces.
- Consumed by Tasks 4 through 8 and Task 9.

- [ ] **Step 1: Write failing selector tests with literal results.**

Use the existing workflowEvent helper pattern from build-log-rows.test.ts.
Create a normal row whose id is the latest node_started event and route and loop rows with their real selection variants.
The test names and required literal results are:

| Test name | Fixture | Required result |
| --- | --- | --- |
| returns the selected attempt's empty successful stdout | latest attempt completes with node_output empty string after an older completion | text empty string, exitCode 0, no old text |
| does not leak stdout from a successful attempt into a failed rerun | old completion, new start, new failure | text null and failedDetail from new failure |
| validates bash truncation metadata | node_output cut, true truncation, original bytes 40000 | truncated true and originalBytes 40000 |
| ignores malformed truncation metadata | negative, floating, or string original bytes | originalBytes null |
| exposes only the selected gate's active actions | matching paused approval and unresolved context | canDecide true |
| suppresses incompatible or resolved gate actions | child_workflow, another node, approved, and running variants | canDecide false |
| reads a completed gate decision from the selected attempt | matching node_completed approval_decision approved | decision approved |
| reads the current gate resolution while auto-resume is pending | matching paused ApprovalContext resolved rejected | decision rejected and canDecide false |
| selects a paused child before completion history | matching child_workflow context on a paused run | paused true and current childRunId |
| does not leak an old child id into a failed rerun | old workflow completion, new start, new failure | childRunId null |
| represents fan-out without one child link | current workflow completion with fan_out true and node_output summary | fanOut true, childRunId null, output summary |
| selects the exact route execution | two node_routed events and route_iteration 2 | executionSeq 2 and the second outcome |
| returns null for a missing route execution | route_iteration 3 with only executions 1 and 2 | null |
| stringifies only safe route primitives | false boolean, finite number, object, and Infinity | false and numeric strings; object and Infinity become null |
| builds loop-group body and iteration state in authored order | two body nodes and mixed lifecycle events for iterations 1 and 2 | literal body order, dependencies, selected iteration, and last-event statuses |
| ignores invalid loop iteration values | zero, negative, floating, and string iteration values | no iterations |

At least one selector test must use events in an order where sorting by created_at would produce the wrong answer.
This catches an implementation that diverges from build-log-rows.ts array-order semantics.

Use this exact attempt-isolation spine and assert complete view models in the remaining matrix cases:

~~~ts
import { describe, expect, test } from 'bun:test';
import type { WorkflowEventResponse } from '@/lib/api';
import type { LogRow } from './build-log-rows';
import { selectNodeStdout } from './select-room-data';

function workflowEvent(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: 'setup',
    data: {},
    created_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

const ROW: LogRow = {
  id: 'start-new',
  nodeId: 'setup',
  label: 'Setup',
  status: 'failed',
  order: 2,
  sourceIndex: 0,
  selection: { kind: 'node' },
};

describe('selectNodeStdout', () => {
  test('does not leak stdout from a successful attempt into a failed rerun', () => {
    const events = [
      workflowEvent({ id: 'start-old' }),
      workflowEvent({
        id: 'done-old',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: 'stale' },
      }),
      workflowEvent({
        id: 'start-new',
        created_at: '2026-09-06T00:00:03.000Z',
      }),
      workflowEvent({
        id: 'failed-new',
        event_type: 'node_failed',
        data: { type: 'bash', error: 'new failure' },
        created_at: '2026-09-06T00:00:01.000Z',
      }),
    ];
    expect(selectNodeStdout(events, ROW)).toEqual({
      text: null,
      status: 'failed',
      exitCode: null,
      truncated: false,
      originalBytes: null,
      failedDetail: 'new failure',
    });
  });

  test('keeps an empty successful stdout distinct from no output', () => {
    const completedRow = { ...ROW, status: 'completed' as const };
    const events = [
      workflowEvent({ id: 'start-new' }),
      workflowEvent({
        id: 'done-new',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: '' },
      }),
    ];
    expect(selectNodeStdout(events, completedRow)).toEqual({
      text: '',
      status: 'completed',
      exitCode: 0,
      truncated: false,
      originalBytes: null,
      failedDetail: null,
    });
  });
});
~~~

- [ ] **Step 2: Run the selector test and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/select-room-data.test.ts )
~~~

Expected: FAIL because select-room-data.ts does not exist.

- [ ] **Step 3: Implement the selectors with the exact attempt boundary.**

Start with these private helpers:

~~~ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function eventsForRow(
  events: readonly WorkflowEventResponse[],
  row: LogRow
): WorkflowEventResponse[] {
  const start = events.findIndex(event => event.id === row.id);
  const scoped = start >= 0 ? events.slice(start) : events;
  return scoped.filter(event => event.step_name === row.nodeId);
}

function safePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function routePrimitive(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}
~~~

For terminal selection, scan the scoped array from the end and stop at the first node_completed or node_failed.
Do not combine an older completion with a newer failure.

For gate action ownership, use this exact predicate:

~~~ts
const compatibleType =
  approvalContext?.type === undefined ||
  approvalContext.type === gateType;
const ownsActiveSlot =
  runStatus === 'paused' &&
  approvalContext?.nodeId === row.nodeId &&
  compatibleType;
const unresolved =
  approvalContext?.resolved === undefined || approvalContext.resolved === null;
const canDecide = ownsActiveSlot && unresolved;
const reviewUrl =
  approvalContext?.nodeId === row.nodeId
    ? getPlannotatorReviewUrl({ status: runStatus, approval })
    : null;
~~~

For loop-group body lifecycle, recognize node_started as running, node_completed as completed, node_failed as failed, and node_skipped or node_skipped_prior_success as skipped.
Use pending when no matching lifecycle event exists.
Do not call eventsForRow from selectLoopGroupChrome.
Scan the original event array, group loop events by data.iteration, and let the last lifecycle event for each qualified body id and iteration win.

Do not parse error prose for numeric exit codes.
Do not inspect transcript messages or pending_interactions.

- [ ] **Step 4: Run the selector test and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/select-room-data.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Refactor selector duplication and rerun the focused test.**

Keep helpers private unless another production module has a current caller.
Rerun:

~~~bash
( cd packages/web && bun test src/components/workflows/select-room-data.test.ts )
~~~

Expected: PASS after refactoring.

- [ ] **Step 6: Commit Task 3.**

~~~bash
git add packages/web/src/components/workflows/select-room-data.ts packages/web/src/components/workflows/select-room-data.test.ts
git commit -m "feat(web): select legacy room event data"
~~~

### Task 4: Make the selected-room shell accessible and add StdoutRoom

**Files:**

- Modify packages/web/src/components/workflows/NodeRoom.tsx:118-124 and 186-235.
- Modify packages/web/src/components/workflows/NodeRoom.test.tsx:70-203.
- Create packages/web/src/components/workflows/StdoutRoom.tsx.
- Create packages/web/src/components/workflows/StdoutRoom.test.tsx.

**Interfaces:**

- NodeRoom exports RoomPlaceholder and RoomRegion.
- StdoutRoom consumes nodeId and StdoutView.
- Tasks 5 through 9 reuse RoomRegion so every selected body has the same accessible boundary.

- [ ] **Step 1: Extend NodeRoom tests and write failing StdoutRoom tests.**

Update the existing NodeRoom state test so unselected markup has no region and each selected loading, error, empty, and loaded state has exactly one region labelled review room.

Add these stdout tests:

~~~tsx
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StdoutRoom } from './StdoutRoom';

function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

describe('StdoutRoom', () => {
  test('renders captured stdout and the successful exit status in one labelled room', () => {
    const markup = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: 'hello\nworld',
          status: 'completed',
          exitCode: 0,
          truncated: false,
          originalBytes: null,
          failedDetail: null,
        }}
      />
    );
    expect(markup).toContain('aria-label="setup room"');
    expect(markup).toContain('hello\nworld');
    expect(markup).toContain('font-mono');
    expect(markup).toContain('bg-surface-inset');
    expect(markup).toContain('Exit status: 0');
    expect(markup).not.toContain('chat-markdown');
  });

  test('distinguishes an empty successful output from missing output', () => {
    const emptySuccess = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: '',
          status: 'completed',
          exitCode: 0,
          truncated: false,
          originalBytes: null,
          failedDetail: null,
        }}
      />
    );
    const missing = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: null,
          status: 'running',
          exitCode: null,
          truncated: false,
          originalBytes: null,
          failedDetail: null,
        }}
      />
    );
    expect(emptySuccess).toContain('<pre');
    expect(visibleText(emptySuccess)).not.toContain("Node hasn't produced output");
    expect(visibleText(missing)).toContain("Node hasn't produced output");
  });

  test('renders truncation and failure details without inventing an exit code', () => {
    const truncated = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: 'cut',
          status: 'completed',
          exitCode: 0,
          truncated: true,
          originalBytes: 40000,
          failedDetail: null,
        }}
      />
    );
    const failed = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: null,
          status: 'failed',
          exitCode: null,
          truncated: false,
          originalBytes: null,
          failedDetail: 'Bash node failed',
        }}
      />
    );
    expect(truncated).toContain('Output truncated from 40000 bytes');
    expect(failed).toContain('Bash node failed');
    expect(failed).not.toContain('Exit status:');
  });
});
~~~

- [ ] **Step 2: Run both test files and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/StdoutRoom.test.tsx )
~~~

Expected: NodeRoom selected loading, error, and empty states lack a region, and StdoutRoom does not exist.

- [ ] **Step 3: Export the shared room primitives and restructure NodeRoom.**

Use these public components:

~~~tsx
export function RoomPlaceholder({ children }: { children: string }): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-text-secondary">
      {children}
    </div>
  );
}

export function RoomRegion({
  nodeId,
  children,
}: {
  nodeId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      role="region"
      aria-label={nodeId + ' room'}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {children}
    </section>
  );
}
~~~

Keep the existing unselected early return.
For every selected NodeRoom branch, choose loading, error, empty, or transcript content first and return it inside one RoomRegion.
Keep the existing Retry callback and transcript ordering unchanged.

- [ ] **Step 4: Implement StdoutRoom with no transcript dependency.**

Use RoomRegion around the whole selected room.
Render status at the top, failure detail when present, and the exact truncation copy.
Render a pre element whenever text is a string, including the empty string.
Render RoomPlaceholder only when text is null.
Use whitespace-pre-wrap, overflow-x-auto, bg-surface-inset, font-mono, and text-text-primary on the terminal well.

Use this component body:

~~~tsx
export function StdoutRoom({
  nodeId,
  stdout,
}: {
  nodeId: string;
  stdout: StdoutView;
}): React.ReactElement {
  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-text-secondary">Status: {stdout.status}</p>
        {stdout.truncated && (
          <p className="text-xs text-warning">
            {stdout.originalBytes === null
              ? 'Output truncated'
              : `Output truncated from ${String(stdout.originalBytes)} bytes`}
          </p>
        )}
        {stdout.failedDetail && <p className="text-sm text-error">{stdout.failedDetail}</p>}
        {stdout.text === null ? (
          <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-sm text-text-primary">
            {stdout.text}
          </pre>
        )}
        {stdout.exitCode === 0 && (
          <p className="text-xs text-text-secondary">Exit status: 0</p>
        )}
      </div>
    </RoomRegion>
  );
}
~~~

- [ ] **Step 5: Run both test files and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/StdoutRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 6: Commit Task 4.**

~~~bash
git add packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/NodeRoom.test.tsx packages/web/src/components/workflows/StdoutRoom.tsx packages/web/src/components/workflows/StdoutRoom.test.tsx
git commit -m "feat(web): render legacy stdout rooms"
~~~

### Task 5: Add declared GateRoom behavior

**Files:**

- Create packages/web/src/components/workflows/GateRoom.tsx.
- Create packages/web/src/components/workflows/GateRoom.test.tsx.

**Interfaces:**

~~~ts
export interface GateRoomProps {
  nodeId: string;
  chrome: GateChrome;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}
~~~

- Consumes ConfirmRunActionDialog and RoomRegion.
- Owns only local pending and action-error UI.
- Does not own run-data fetching or query invalidation.

- [ ] **Step 1: Write failing render and interaction tests.**

Static markup cases must prove:

- A declared approval message is visible.
- A Plannotator document and safe Open Plannotator link are visible.
- The link has target blank and rel noopener noreferrer.
- Approve and Reject appear only when canDecide is true.
- Gate is not the active pause appears only when showInactiveNotice is true.
- A completed approved decision is visible without decision buttons.
- No AskHuman, awaiting, or waiting-on-you copy is present.

Use the LegacyNodeLogs.test.tsx happy-dom setup for this interaction case:

~~~tsx
import type { GateChrome } from './select-room-data';

const gateRoom = await import('./GateRoom');

function renderGate(args: {
  chrome: GateChrome;
  onApprove: () => Promise<void>;
  onReject?: (reason?: string) => Promise<void>;
}): void {
  root.render(
    createElement(gateRoom.GateRoom, {
      nodeId: 'review',
      chrome: args.chrome,
      onApprove: args.onApprove,
      onReject: args.onReject ?? (async (): Promise<void> => undefined),
    })
  );
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(candidate =>
    (candidate.textContent ?? '').includes(label)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('missing button: ' + label);
  return button;
}

async function clickButton(label: string): Promise<void> {
  await act(async () => {
    findButton(label).click();
  });
}

async function flushUntil(label: string, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt++) {
    await flush();
    if (predicate()) return;
  }
  throw new Error(label + ': ' + (host.textContent ?? ''));
}

test('surfaces an approval failure and re-enables the actions', async () => {
  let calls = 0;
  const onApprove = async (): Promise<void> => {
    calls++;
    throw new Error('approval failed');
  };
  renderGate({
    chrome: {
      gateType: 'approval',
      message: 'Ship?',
      document: null,
      decision: null,
      canDecide: true,
      showInactiveNotice: false,
      reviewUrl: null,
    },
    onApprove,
  });
  await clickButton('Approve');
  await flushUntil('action error', () => (host.textContent ?? '').includes('approval failed'));
  expect(calls).toBe(1);
  expect(findButton('Approve').disabled).toBe(false);
});
~~~

The helpers above operate on the real GateRoom within the copied happy-dom setup.
The callbacks are specific boundary doubles; assertions remain on visible component behavior as well as the required call count.

- [ ] **Step 2: Run GateRoom tests and verify RED.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/GateRoom.test.tsx )
~~~

Expected: FAIL because GateRoom.tsx does not exist.

- [ ] **Step 3: Implement GateRoom and its action state.**

Use useState for actionPending and actionError.
The shared runner must clear the old error, disable both controls, await the callback, show Error.message on rejection, and re-enable the controls in finally.
Call the runner with void from click handlers so no rejected promise escapes React.

Use this action runner inside GateRoom:

~~~tsx
const [actionPending, setActionPending] = useState(false);
const [actionError, setActionError] = useState<string | null>(null);

async function runAction(action: () => Promise<void>): Promise<void> {
  setActionError(null);
  setActionPending(true);
  try {
    await action();
  } catch (error: unknown) {
    setActionError(error instanceof Error ? error.message : String(error));
  } finally {
    setActionPending(false);
  }
}
~~~

The Approve click handler must be:

~~~tsx
<button
  type="button"
  disabled={actionPending}
  onClick={(): void => {
    void runAction(onApprove);
  }}
>
  Approve
</button>
~~~

Use ConfirmRunActionDialog with this exact rejection configuration:

~~~tsx
<ConfirmRunActionDialog
  trigger={
    <button type="button" disabled={actionPending}>
      Reject
    </button>
  }
  title="Reject workflow?"
  description={
    <>
      Reject the paused workflow at gate <strong>{nodeId}</strong>.
      If the approval node defines an on_reject prompt, it receives the optional reason.
    </>
  }
  confirmLabel="Reject"
  reasonInput={{
    label: 'Reason (optional)',
    placeholder: 'Why are you rejecting?',
  }}
  onConfirm={(reason): void => {
    void runAction(() => onReject(reason));
  }}
/>
~~~

Render the safe Plannotator URL only when chrome.reviewUrl is non-null.
Do not re-parse the URL in the component.
Use the warning banner tokens bg-warning/5 and border-warning/20 for gate context.
Use error color only for an actual action failure or the destructive Reject control.
Render the asynchronous failure inside RoomRegion with:

~~~tsx
{actionError !== null && (
  <p role="alert" className="text-sm text-error">
    {actionError}
  </p>
)}
~~~

- [ ] **Step 4: Run GateRoom tests and verify GREEN.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/GateRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 5: Commit Task 5.**

~~~bash
git add packages/web/src/components/workflows/GateRoom.tsx packages/web/src/components/workflows/GateRoom.test.tsx
git commit -m "feat(web): render declared gate rooms"
~~~

### Task 6: Add ChildWorkflowRoom

**Files:**

- Create packages/web/src/components/workflows/ChildWorkflowRoom.tsx.
- Create packages/web/src/components/workflows/ChildWorkflowRoom.test.tsx.

**Interfaces:**

~~~ts
export interface ChildWorkflowRoomProps {
  nodeId: string;
  child: ChildRunRef;
}
~~~

- Consumes RoomRegion.
- Produces only inspection chrome and a legacy child-run link.

- [ ] **Step 1: Write failing static-markup tests.**

~~~tsx
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChildWorkflowRoom } from './ChildWorkflowRoom';

function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

const BASE = {
  fanOut: false,
  output: null,
  paused: false,
  message: null,
  status: 'completed' as const,
};

describe('ChildWorkflowRoom', () => {
  test('links one child run without rendering a transcript', () => {
    const markup = renderToStaticMarkup(
      <ChildWorkflowRoom nodeId="child" child={{ ...BASE, childRunId: 'child-1' }} />
    );
    expect(markup).toContain('Child run');
    expect(markup).toContain('href="/legacy/workflows/runs/child-1"');
    expect(markup).toContain('Open child run');
    expect(markup).not.toContain('chat-markdown');
  });

  test('renders the paused-child message and current child link', () => {
    const markup = renderToStaticMarkup(
      <ChildWorkflowRoom
        nodeId="child"
        child={{
          ...BASE,
          childRunId: 'child-1',
          paused: true,
          message: 'Child needs review',
          status: 'running',
        }}
      />
    );
    expect(markup).toContain('Child needs review');
    expect(markup).toContain('Open child run');
  });

  test('renders fan-out summary without inventing a single child link', () => {
    const markup = renderToStaticMarkup(
      <ChildWorkflowRoom
        nodeId="children"
        child={{
          ...BASE,
          childRunId: null,
          fanOut: true,
          output: '3 children completed',
        }}
      />
    );
    expect(markup).toContain('This node spawned multiple child runs');
    expect(markup).toContain('3 children completed');
    expect(markup).not.toContain('Open child run');
  });

  test('uses the shared no-output copy without losing the selected region', () => {
    const markup = renderToStaticMarkup(
      <ChildWorkflowRoom
        nodeId="child"
        child={{ ...BASE, childRunId: null, status: 'pending' }}
      />
    );
    expect(visibleText(markup)).toContain("Node hasn't produced output");
    expect(markup).toContain('aria-label="child room"');
  });
});
~~~

- [ ] **Step 2: Run ChildWorkflowRoom tests and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/ChildWorkflowRoom.test.tsx )
~~~

Expected: FAIL because ChildWorkflowRoom.tsx does not exist.

- [ ] **Step 3: Implement the child-run card.**

Use encodeURIComponent when building the href.
Use a normal anchor so browser navigation and static markup both exercise the real link.
Show the ApprovalContext message when paused, otherwise Sub-run is paused awaiting review.
Show fan-out output in a mono bg-surface-inset pre element when output is non-null.
Never call the transcript loader from this component.

Use this render structure:

~~~tsx
export function ChildWorkflowRoom({
  nodeId,
  child,
}: ChildWorkflowRoomProps): React.ReactElement {
  const hasContent =
    child.childRunId !== null || child.fanOut || child.output !== null || child.paused;
  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium text-text-primary">Child run</h3>
        {child.paused && (
          <p className="rounded border border-warning/20 bg-warning/5 p-3 text-sm text-warning">
            {child.message ?? 'Sub-run is paused awaiting review'}
          </p>
        )}
        {child.fanOut && (
          <p className="text-sm text-text-secondary">This node spawned multiple child runs</p>
        )}
        {child.childRunId !== null && (
          <a
            href={`/legacy/workflows/runs/${encodeURIComponent(child.childRunId)}`}
            className="text-sm text-primary hover:underline"
          >
            Open child run
          </a>
        )}
        {child.output !== null && (
          <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-sm text-text-primary">
            {child.output}
          </pre>
        )}
        {!hasContent && <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>}
      </div>
    </RoomRegion>
  );
}
~~~

- [ ] **Step 4: Run ChildWorkflowRoom tests and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/ChildWorkflowRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 5: Commit Task 6.**

~~~bash
git add packages/web/src/components/workflows/ChildWorkflowRoom.tsx packages/web/src/components/workflows/ChildWorkflowRoom.test.tsx
git commit -m "feat(web): link legacy child workflow rooms"
~~~

### Task 7: Add RouteControllerRoom

**Files:**

- Create packages/web/src/components/workflows/RouteControllerRoom.tsx.
- Create packages/web/src/components/workflows/RouteControllerRoom.test.tsx.

**Interfaces:**

~~~ts
export interface RouteControllerRoomProps {
  nodeId: string;
  decision: RouteDecisionView | null;
}
~~~

- Consumes RoomRegion.
- Renders only the selected route execution supplied by Task 3.

- [ ] **Step 1: Write failing static-markup tests.**

Use one literal decision with outcome negative, target fix, condition text, conditionResult false, attempt 2, executionSeq 4, negativeCount 1, and maxIterations 3.
Assert every literal is visible, the region is labelled router room, and chat-markdown is absent.
Render null and assert the exact no-output copy inside the labelled region.
Render a decision with null optional fields and assert no strings undefined, null, or object Object appear.

Use this literal primary case and use visibleText for the null cases:

~~~tsx
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RouteDecisionView } from './select-room-data';
import { RouteControllerRoom } from './RouteControllerRoom';

function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

test('renders the selected routing decision without an agent timeline', () => {
  const decision: RouteDecisionView = {
    outcome: 'negative',
    to: 'fix',
    condition: '$review.output.approved == true',
    conditionResult: 'false',
    attempt: '2',
    executionSeq: '4',
    negativeCount: '1',
    maxIterations: '3',
  };
  const markup = renderToStaticMarkup(
    <RouteControllerRoom nodeId="router" decision={decision} />
  );
  const text = visibleText(markup);
  expect(markup).toContain('aria-label="router room"');
  expect(text).toContain('Routing decision');
  expect(text).toContain('negative');
  expect(text).toContain('fix');
  expect(text).toContain('$review.output.approved == true');
  expect(text).toContain('false');
  expect(text).toContain('2');
  expect(text).toContain('4');
  expect(text).toContain('1');
  expect(text).toContain('3');
  expect(markup).not.toContain('chat-markdown');
});
~~~

- [ ] **Step 2: Run RouteControllerRoom tests and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/RouteControllerRoom.test.tsx )
~~~

Expected: FAIL because RouteControllerRoom.tsx does not exist.

- [ ] **Step 3: Implement the routing-decision card.**

Render the heading Routing decision.
Render a labelled definition list whose rows are included only when their value is non-null.
Use labels Outcome, Target, Condition, Condition result, Attempt, Execution, Negative count, and Maximum iterations.
Use font-mono on condition and identifier values.
Do not render a NodeRoom, route controls, or an agent timeline.

Use this implementation shape:

~~~tsx
const FIELDS = [
  ['Outcome', 'outcome'],
  ['Target', 'to'],
  ['Condition', 'condition'],
  ['Condition result', 'conditionResult'],
  ['Attempt', 'attempt'],
  ['Execution', 'executionSeq'],
  ['Negative count', 'negativeCount'],
  ['Maximum iterations', 'maxIterations'],
] as const;

export function RouteControllerRoom({
  nodeId,
  decision,
}: RouteControllerRoomProps): React.ReactElement {
  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium text-text-primary">Routing decision</h3>
        {decision === null ? (
          <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
        ) : (
          <dl className="space-y-2">
            {FIELDS.map(([label, key]) =>
              decision[key] === null ? null : (
                <div key={key} className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className="font-mono text-text-primary">{decision[key]}</dd>
                </div>
              )
            )}
          </dl>
        )}
      </div>
    </RoomRegion>
  );
}
~~~

- [ ] **Step 4: Run RouteControllerRoom tests and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/RouteControllerRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 5: Commit Task 7.**

~~~bash
git add packages/web/src/components/workflows/RouteControllerRoom.tsx packages/web/src/components/workflows/RouteControllerRoom.test.tsx
git commit -m "feat(web): render route controller rooms"
~~~

### Task 8: Add LoopGroupRoom

**Files:**

- Create packages/web/src/components/workflows/LoopGroupRoom.tsx.
- Create packages/web/src/components/workflows/LoopGroupRoom.test.tsx.

**Interfaces:**

~~~ts
export interface LoopGroupRoomProps {
  nodeId: string;
  chrome: LoopGroupChrome;
}
~~~

- Consumes RoomRegion.
- Renders authored topology and persisted iteration history without a graph package.

- [ ] **Step 1: Write failing static-markup tests.**

Use body nodes body with no dependencies and check with dependsOn body.
Use iteration 1 completed with both body nodes completed and iteration 2 failed with body completed and check failed.
Set selectedIteration to 2.
Assert Body nodes, body, check, After body, ×1, ×2, completed, failed, and aria-label group room are present.
Assert the details element for iteration 2 is open.
Assert chat-markdown and svg are absent.
Add an empty-history case that still shows authored body topology and the exact no-output copy for iterations.

Use this literal primary fixture:

~~~tsx
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LoopGroupChrome } from './select-room-data';
import { LoopGroupRoom } from './LoopGroupRoom';

function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

const chrome: LoopGroupChrome = {
  body: [
    { id: 'body', qualifiedId: 'group.body', dependsOn: [] },
    { id: 'check', qualifiedId: 'group.check', dependsOn: ['body'] },
  ],
  iterations: [
    {
      iteration: 1,
      status: 'completed',
      body: [
        { id: 'body', qualifiedId: 'group.body', dependsOn: [], status: 'completed' },
        {
          id: 'check',
          qualifiedId: 'group.check',
          dependsOn: ['body'],
          status: 'completed',
        },
      ],
    },
    {
      iteration: 2,
      status: 'failed',
      body: [
        { id: 'body', qualifiedId: 'group.body', dependsOn: [], status: 'completed' },
        {
          id: 'check',
          qualifiedId: 'group.check',
          dependsOn: ['body'],
          status: 'failed',
        },
      ],
    },
  ],
  selectedIteration: 2,
};

test('renders authored topology and opens only the selected iteration', () => {
  const markup = renderToStaticMarkup(<LoopGroupRoom nodeId="group" chrome={chrome} />);
  const text = visibleText(markup);
  expect(markup).toContain('aria-label="group room"');
  expect(text).toContain('Body nodes');
  expect(text).toContain('After body');
  expect(text).toContain('×1 completed');
  expect(text).toContain('×2 failed');
  expect(markup.match(/<details[^>]*open/g)?.length).toBe(1);
  expect(markup).not.toContain('chat-markdown');
  expect(markup).not.toContain('<svg');
});
~~~

- [ ] **Step 2: Run LoopGroupRoom tests and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/LoopGroupRoom.test.tsx )
~~~

Expected: FAIL because LoopGroupRoom.tsx does not exist.

- [ ] **Step 3: Implement container chrome.**

Render heading Loop group.
Under Body nodes, render each authored id and either Start or After followed by the direct dependency ids.
Render one details element per iteration with summary text containing ×N and the iteration status.
Set open only on the selected iteration.
Inside each details body, render each qualified body id and its derived status.
When iterations is empty, render Node hasn't produced output below the body topology.
Do not add SVG, dagre, React Flow, packages/web/src/lib/run-graph, or clickable nested graph behavior.

Use this component body:

~~~tsx
export function LoopGroupRoom({ nodeId, chrome }: LoopGroupRoomProps): React.ReactElement {
  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-4 p-4">
        <h3 className="text-sm font-medium text-text-primary">Loop group</h3>
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase text-text-secondary">Body nodes</h4>
          {chrome.body.map(node => (
            <div key={node.qualifiedId} className="text-sm text-text-primary">
              <span className="font-mono">{node.id}</span>
              <span className="ml-2 text-text-secondary">
                {node.dependsOn.length === 0 ? 'Start' : `After ${node.dependsOn.join(', ')}`}
              </span>
            </div>
          ))}
        </div>
        {chrome.iterations.length === 0 ? (
          <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
        ) : (
          chrome.iterations.map(iteration => (
            <details
              key={iteration.iteration}
              open={iteration.iteration === chrome.selectedIteration}
              className="rounded border border-border bg-surface-elevated p-3"
            >
              <summary className="cursor-pointer text-sm text-text-primary">
                {'×' + String(iteration.iteration) + ' ' + iteration.status}
              </summary>
              <div className="mt-2 space-y-1">
                {iteration.body.map(node => (
                  <p key={node.qualifiedId} className="text-sm text-text-secondary">
                    <span className="font-mono text-text-primary">{node.qualifiedId}</span>{' '}
                    {node.status}
                  </p>
                ))}
              </div>
            </details>
          ))
        )}
      </div>
    </RoomRegion>
  );
}
~~~

- [ ] **Step 4: Run LoopGroupRoom tests and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/LoopGroupRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 5: Commit Task 8.**

~~~bash
git add packages/web/src/components/workflows/LoopGroupRoom.tsx packages/web/src/components/workflows/LoopGroupRoom.test.tsx
git commit -m "feat(web): render loop group container rooms"
~~~

### Task 9: Add the LegacyNodeRoom dispatcher and shared selected-node header

**Files:**

- Create packages/web/src/components/workflows/LegacyNodeRoom.tsx.
- Create packages/web/src/components/workflows/LegacyNodeRoom.test.tsx.

**Interfaces:**

- Consumes the complete LegacyNodeRoomProps contract.
- Uses resolveRoomKind once per render.
- Uses selectors from Task 3 and room bodies from Tasks 4 through 8.
- Is the only production switch that chooses a legacy room body.

- [ ] **Step 1: Write failing dispatcher tests with the real query boundary.**

Copy the happy-dom global installation, QueryClientProvider, flush, and cleanup pattern from NodeTranscriptPane.test.tsx.
Use a complete loadMessages boundary double that records runId and nodeId and returns literal WorkflowNodeMessagesResponse data.

Cover these cases:

1. A null row renders Select a node, no selected header, no region, and no message request.
2. A command row renders the header labels Command and running, mounts NodeTranscriptPane, and requests run-1 plus command exactly once.
3. A bash row renders persisted stdout, header labels Bash and completed, and makes no message request.
4. A script event fallback without a definition renders stdout and makes no message request.
5. An approval row renders its declared message and makes no message request.
6. An active Plannotator metadata fallback without a definition renders Open Plannotator and makes no message request.
7. A workflow row renders the selected-attempt child link and makes no message request.
8. A route_iteration row renders the matching execution sequence rather than the latest different sequence.
9. A loop_group row renders authored body topology and the selected iteration.
10. Rerendering the same mounted dispatcher from bash to command triggers the first message request only after the command selection.
11. Rerendering from command to bash leaves exactly one labelled room and does not make another message request.
12. An unknown row while definitionPending is true renders a Loading type pill and Loading node room without a message request, then rerendering with a command definition mounts the transcript boundary.

For every selected case, assert exactly one role region and the exact node room aria-label.
For all non-agent cases, assert the visible non-agent result in addition to the zero-call side-effect contract.

Use this literal bash case before adding the DOM selection cases:

~~~tsx
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkflowEventResponse, WorkflowNodeMessagesResponse } from '@/lib/api';
import type { LogRow } from './build-log-rows';
import { LegacyNodeRoom } from './LegacyNodeRoom';

function workflowEvent(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

test('renders bash stdout without invoking the transcript boundary', () => {
  let requests = 0;
  const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => {
    requests++;
    return { messages: [] };
  };
  const row: LogRow = {
    id: 'start-setup',
    nodeId: 'setup',
    label: 'Setup',
    status: 'completed',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
  };
  const events = [
    workflowEvent({ id: 'start-setup', step_name: 'setup', event_type: 'node_started' }),
    workflowEvent({
      id: 'done-setup',
      step_name: 'setup',
      event_type: 'node_completed',
      data: { type: 'bash', node_output: 'ready' },
    }),
  ];
  const markup = renderToStaticMarkup(
    <LegacyNodeRoom
      runId="run-1"
      row={row}
      isLive={false}
      loadMessages={loadMessages}
      definitionNodes={[{ id: 'setup', bash: 'echo ready' }]}
      definitionPending={false}
      events={events}
      runStatus="completed"
      approval={null}
      onApprove={async (): Promise<void> => undefined}
      onReject={async (): Promise<void> => undefined}
    />
  );
  expect(markup).toContain('ready');
  expect(markup).toContain('Bash');
  expect(markup.match(/role="region"/g)?.length).toBe(1);
  expect(markup).toContain('aria-label="setup room"');
  expect(requests).toBe(0);
});
~~~

The happy-dom command case must await the real QueryClient render until requests contains exactly [['run-1', 'command']].

- [ ] **Step 2: Run dispatcher tests and verify RED.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx )
~~~

Expected: FAIL because LegacyNodeRoom.tsx does not exist.

- [ ] **Step 3: Implement the shared selected-node header.**

When row is non-null, render a non-region header before the body with:

- row.label as the primary label.
- A humanized type pill derived from resolution.nodeType, or Loading while waitingForDefinition is true.
- row.status using the existing status token families.

Use one exhaustive NodeBodyKind mapping for labels.
Do not use resolveNodeDisplay because it collapses script, loop_group, and workflow.

Use these exact header maps and render the header outside the room body:
Keep TYPE_LABELS and STATUS_COLORS at module scope, then place the early return, resolution, waitingForDefinition, and header inside LegacyNodeRoom in the shown order.

~~~tsx
const TYPE_LABELS: Record<NodeBodyKind, string> = {
  command: 'Command',
  prompt: 'Prompt',
  loop: 'Loop',
  bash: 'Bash',
  script: 'Script',
  approval: 'Approval',
  plannotator_gate: 'Plannotator gate',
  workflow: 'Workflow',
  route_loop: 'Route loop',
  loop_group: 'Loop group',
  unknown: 'Agent',
};

const STATUS_COLORS: Record<LogRow['status'], string> = {
  pending: 'bg-accent/20 text-accent',
  running: 'bg-accent/20 text-accent',
  completed: 'bg-success/20 text-success',
  failed: 'bg-error/20 text-error',
  skipped: 'bg-surface text-text-secondary',
};

if (row === null) return <RoomPlaceholder>Select a node</RoomPlaceholder>;

const resolution = resolveRoomKind(row.nodeId, definitionNodes, events, approval);
const waitingForDefinition =
  definitionPending &&
  resolution.definitionNode === null &&
  resolution.kind === 'agent' &&
  resolution.nodeType === 'unknown';

const header = (
  <div className="flex items-center gap-2 border-b border-border px-4 py-2">
    <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
      {row.label}
    </h2>
    <span className="rounded bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
      {waitingForDefinition ? 'Loading' : TYPE_LABELS[resolution.nodeType]}
    </span>
    <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_COLORS[row.status])}>
      {row.status}
    </span>
  </div>
);
~~~

- [ ] **Step 4: Implement one exhaustive room switch.**

The control flow must have this shape:

~~~tsx
let body: React.ReactElement;

if (waitingForDefinition) {
  body = (
    <RoomRegion nodeId={row.nodeId}>
      <RoomPlaceholder>Loading node room</RoomPlaceholder>
    </RoomRegion>
  );
} else {
  switch (resolution.kind) {
    case 'agent':
      body = (
        <NodeTranscriptPane
          runId={runId}
          row={row}
          isLive={isLive}
          loadMessages={loadMessages}
        />
      );
      break;
    case 'stdout':
      body = <StdoutRoom nodeId={row.nodeId} stdout={selectNodeStdout(events, row)} />;
      break;
    case 'gate':
      body = (
        <GateRoom
          nodeId={row.nodeId}
          chrome={selectGateChrome({
            definitionNode: resolution.definitionNode,
            events,
            row,
            approval,
            runStatus,
            gateType:
              resolution.nodeType === 'plannotator_gate' ? 'plannotator_gate' : 'approval',
          })}
          onApprove={onApprove}
          onReject={onReject}
        />
      );
      break;
    case 'workflow':
      body = (
        <ChildWorkflowRoom
          nodeId={row.nodeId}
          child={selectChildRun({ events, approval, row, runStatus })}
        />
      );
      break;
    case 'route_loop':
      body = (
        <RouteControllerRoom
          nodeId={row.nodeId}
          decision={selectRouteDecision(events, row)}
        />
      );
      break;
    case 'loop_group':
      body = (
        <LoopGroupRoom
          nodeId={row.nodeId}
          chrome={selectLoopGroupChrome({
            definitionNode: resolution.definitionNode,
            events,
            row,
          })}
        />
      );
      break;
    default:
      body = assertNever(resolution.kind);
  }
}
~~~

Define assertNever locally:

~~~ts
function assertNever(value: never): never {
  throw new Error('Unhandled legacy room kind: ' + String(value));
}
~~~

Return the shared selected-node header and body from one parent container.
Do not add a second room region around body because each branch already owns exactly one.

Finish the component with:

~~~tsx
return (
  <div className="flex min-h-0 flex-1 flex-col">
    {header}
    {body}
  </div>
);
~~~

- [ ] **Step 5: Run dispatcher tests and verify GREEN.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 6: Run the existing transcript regressions.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 7: Commit Task 9.**

~~~bash
git add packages/web/src/components/workflows/LegacyNodeRoom.tsx packages/web/src/components/workflows/LegacyNodeRoom.test.tsx
git commit -m "feat(web): dispatch legacy node rooms by type"
~~~

### Task 10: Wire the dispatcher into LegacyNodeLogs and WorkflowExecution

**Files:**

- Modify packages/web/src/components/workflows/LegacyNodeLogs.tsx:6-25 and 27-75.
- Modify packages/web/src/components/workflows/LegacyNodeLogs.test.tsx:1-307.
- Modify packages/web/src/components/workflows/WorkflowExecution.tsx:18-24, 69-78, 279-319, and 770-788.

**Interfaces:**

Extend LegacyNodeLogsProps with:

~~~ts
definitionNodes: readonly DagNode[];
definitionPending: boolean;
runStatus: WorkflowRunStatus;
approval: unknown;
onApprove: () => Promise<void>;
onReject: (reason?: string) => Promise<void>;
~~~

Keep every existing prop.
LegacyNodeLogs passes the selected LogRow and all room inputs to LegacyNodeRoom.

- [ ] **Step 1: Extend LegacyNodeLogs tests before changing production wiring.**

Update renderLogs to accept and pass all new required props.
Give every existing agent fixture a command definition so its existing click-to-load behavior remains explicit.

Add these end-to-end cases:

1. Clicking a bash row renders exact persisted stdout and does not call loadMessages.
2. Clicking an approval row renders the authored message and active controls when the matching paused ApprovalContext is provided.
3. Clicking a workflow row renders Open child run and does not call loadMessages.
4. Clicking route execution number 2 renders decision number 2.
5. Clicking a loop-group iteration row renders Body nodes and opens that iteration.
6. Clicking bash and then command keeps one Node runs navigation, one selected room, and calls loadMessages once for the command.
7. Changing runId clears the selection, removes the labelled region, and calls onSelectNode with null exactly as Story 5.1 already requires.
8. No AskHuman, awaiting, or waiting-on-you chrome appears in any fixture.

Assert on rendered behavior and exact request arguments.
Do not mock LegacyNodeRoom, NodeTranscriptPane, or any room body.

Add this literal stdout boundary case inside the existing LegacyNodeLogs describe block:

~~~tsx
test('selecting bash renders captured stdout without requesting node messages', async () => {
  const calls: [string, string][] = [];
  const loadMessages = async (
    requestRunId: string,
    nodeId: string
  ): Promise<WorkflowNodeMessagesResponse> => {
    calls.push([requestRunId, nodeId]);
    return { messages: [] };
  };
  const events: WorkflowEventResponse[] = [
    {
      id: 'start-setup',
      workflow_run_id: 'run-1',
      event_type: 'node_started',
      step_index: null,
      step_name: 'setup',
      data: { type: 'bash' },
      created_at: CREATED_AT,
    },
    {
      id: 'done-setup',
      workflow_run_id: 'run-1',
      event_type: 'node_completed',
      step_index: null,
      step_name: 'setup',
      data: { type: 'bash', node_output: 'ready' },
      created_at: CREATED_AT,
    },
  ];
  await act(async () => {
    renderLogs({
      runId: 'run-1',
      nodeStates: [
        { nodeId: 'setup', name: 'Setup', status: 'completed', retryEpoch: 0 },
      ],
      events,
      definitionNodes: [{ id: 'setup', bash: 'echo ready' }],
      definitionPending: false,
      runStatus: 'completed',
      approval: null,
      loadMessages,
      onSelectNode: (): void => undefined,
      onApprove: async (): Promise<void> => undefined,
      onReject: async (): Promise<void> => undefined,
    });
  });
  const setup = Array.from(host.querySelectorAll('button')).find(button =>
    (button.textContent ?? '').includes('Setup')
  );
  if (setup === undefined) throw new Error('missing Setup row');
  await act(async () => {
    setup.click();
  });
  await flushUntil(host, 'bash stdout', () => (host.textContent ?? '').includes('ready'));
  expect(calls).toEqual([]);
  expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
});
~~~

- [ ] **Step 2: Run LegacyNodeLogs tests and verify RED.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx )
~~~

Expected: FAIL because LegacyNodeLogsProps and the rendered body do not yet support the new room inputs.

- [ ] **Step 3: Replace only the direct NodeTranscriptPane mount in LegacyNodeLogs.**

Import DagNode from @/lib/api and WorkflowRunStatus from @/lib/types as types, and import LegacyNodeRoom.
Keep buildLogRows, selectedLogRowId, the run-change reset effect, NodeRunList, roomHeader, and roomFooter unchanged.
Replace lines 65-70 with one LegacyNodeRoom using the selected row and new props.
Do not add another list, resizable shell, or selection state.

Use this exact replacement:

~~~tsx
<LegacyNodeRoom
  runId={runId}
  row={selectedRow}
  isLive={isLive}
  loadMessages={loadMessages}
  definitionNodes={definitionNodes}
  definitionPending={definitionPending}
  events={events}
  runStatus={runStatus}
  approval={approval}
  onApprove={onApprove}
  onReject={onReject}
/>
~~~

- [ ] **Step 4: Retain approval metadata in the WorkflowExecution GET mapping.**

Add approval: unknown to WorkflowRunQueryData.
In the query result at lines 289-319, add:

~~~ts
approval: data.run.metadata.approval ?? null,
~~~

Import approveWorkflowRun and rejectWorkflowRun from @/lib/api.
Do not copy approval into WorkflowState because its current SSE type intentionally contains only nodeId and message.

- [ ] **Step 5: Add action callbacks that preserve visible failures.**

Add these callbacks after handleRetryDispatched:

~~~ts
const handleGateApprove = useCallback(async (): Promise<void> => {
  await approveWorkflowRun(runId);
  await queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
}, [queryClient, runId]);

const handleGateReject = useCallback(
  async (reason?: string): Promise<void> => {
    await rejectWorkflowRun(runId, reason);
    await queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
  },
  [queryClient, runId]
);
~~~

Do not catch here.
GateRoom owns the visible action error and must receive the rejected promise.

- [ ] **Step 6: Pass the new inputs only to the Logs branch.**

At the existing LegacyNodeLogs call, add:

~~~tsx
definitionNodes={dagDefinitionNodes ?? []}
definitionPending={workflowDefPending}
runStatus={queryData?.workflowState.status ?? workflow.status}
approval={queryData?.approval ?? null}
onApprove={handleGateApprove}
onReject={handleGateReject}
~~~

Keep activeView graph, source-control, chat, and sequential branches byte-for-byte unchanged except for import formatting.

- [ ] **Step 7: Run Logs and existing workflow regressions and verify GREEN.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx )
( cd packages/web && bun test src/components/workflows/build-log-rows.test.ts src/components/workflows/WorkflowExecution.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 8: Run the web type checker before committing.**

~~~bash
( cd packages/web && bun run type-check )
~~~

Expected: PASS with no any, missing callback, generated-DagNode, or optional-reason errors.

- [ ] **Step 9: Commit Task 10.**

~~~bash
git add packages/web/src/components/workflows/LegacyNodeLogs.tsx packages/web/src/components/workflows/LegacyNodeLogs.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx
git commit -m "feat(web): wire per-type rooms into legacy logs"
~~~

### Task 11: Validate the story and update sprint tracking last

**Files:**

- Modify _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:2, 37, and 48.

**Interfaces:**

- Produces no runtime interface.
- This task is permitted only after Tasks 1 through 10 are green.

- [ ] **Step 1: Run selector and helper tests.**

~~~bash
( cd packages/web && bun test src/lib/approval-context.test.ts src/components/workflows/resolve-room-kind.test.ts src/components/workflows/select-room-data.test.ts )
~~~

Expected: PASS.

- [ ] **Step 2: Run every static room test.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/StdoutRoom.test.tsx src/components/workflows/ChildWorkflowRoom.test.tsx src/components/workflows/RouteControllerRoom.test.tsx src/components/workflows/LoopGroupRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 3: Run DOM room and Logs integration tests in isolated invocations.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/GateRoom.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx )
~~~

Expected: PASS.
Keep GateRoom in its own Bun process so happy-dom and module state cannot pollute the dispatcher suite.

- [ ] **Step 4: Run neighboring regression tests and the web type checker.**

~~~bash
( cd packages/web && bun test src/components/dashboard/WorkflowRunCard.test.tsx src/components/workflows/build-log-rows.test.ts src/components/workflows/WorkflowExecution.test.tsx )
( cd packages/web && bun run type-check )
~~~

Expected: PASS.

- [ ] **Step 5: Run repository lint and full validation from the repository root.**

~~~bash
bun run lint --max-warnings 0
bun run validate
~~~

Expected: both commands exit zero with no warnings.
Do not run bun test directly from the root.

- [ ] **Step 6: Update sprint status only after Step 5 succeeds.**

Change 5-2-see-the-right-room-for-each-node-type-legacy from backlog to done.
Set both last_updated fields to the implementation completion time in the file's existing timestamp format.
Do not change generated, any other story, or either epic status.

- [ ] **Step 7: Check the final diff and rerun formatting validation for the tracking edit.**

~~~bash
git diff --check
bun run format:check
bun run validate
~~~

Expected: all three commands exit zero after the tracking edit.

- [ ] **Step 8: Commit the validated tracking update.**

~~~bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark legacy node rooms done"
~~~

---

## Test Coverage Matrix

| Behavior | Primary test | Regression boundary |
| --- | --- | --- |
| Safe untyped ApprovalContext parsing | packages/web/src/lib/approval-context.test.ts | WorkflowRunCard.test.tsx |
| Every authored and fallback room type | resolve-room-kind.test.ts | LegacyNodeRoom.test.tsx |
| Latest-attempt stdout isolation | select-room-data.test.ts | LegacyNodeLogs.test.tsx |
| Empty successful stdout | select-room-data.test.ts and StdoutRoom.test.tsx | LegacyNodeRoom.test.tsx |
| Gate ownership and completed decision | select-room-data.test.ts | GateRoom.test.tsx |
| Gate action failure visibility | GateRoom.test.tsx | LegacyNodeLogs.test.tsx |
| Safe Plannotator link | approval-context.test.ts and GateRoom.test.tsx | WorkflowRunCard.test.tsx |
| Paused, completed, failed, and fan-out child views | select-room-data.test.ts | ChildWorkflowRoom.test.tsx |
| Route execution selection | select-room-data.test.ts | RouteControllerRoom.test.tsx and LegacyNodeRoom.test.tsx |
| Loop-group body topology and selected iteration | select-room-data.test.ts | LoopGroupRoom.test.tsx and LegacyNodeLogs.test.tsx |
| No transcript request for non-agent rooms | LegacyNodeRoom.test.tsx | LegacyNodeLogs.test.tsx |
| Story 5.1 agent replay remains intact | NodeTranscriptPane.test.tsx | NodeRoom.test.tsx |
| One Logs list and one selected room | LegacyNodeLogs.test.tsx | LegacyNodeRoom.test.tsx |
| Graph and event enrichment remain unchanged | WorkflowExecution.test.tsx | build-log-rows.test.ts |

## Acceptance Criteria

- [ ] Selecting command, prompt, or loop mounts the existing Story 5.1 agent transcript and requests only that node's GET messages endpoint.
- [ ] Selecting bash or script shows only the selected attempt's captured stdout, status, successful exit status when knowable, truncation metadata, or failure detail.
- [ ] A failed bash or script rerun never displays output from an earlier successful attempt.
- [ ] An empty successful stdout value renders an empty terminal well rather than the no-output state.
- [ ] Selecting approval or plannotator_gate shows declared gate chrome and never an AskHuman card.
- [ ] An unresolved paused gate that owns the current ApprovalContext shows the existing Approve and Reject actions.
- [ ] A Plannotator gate that owns a safe current review URL shows Open Plannotator.
- [ ] Another node's gate, a resolved gate, child_workflow, interactive_loop, and writeback contexts expose no declared-gate mutation controls.
- [ ] A failed gate action remains visible and retryable in the room.
- [ ] A matching resolved ApprovalContext shows Approved or Rejected while auto-resume is still pending and exposes no mutation controls.
- [ ] Selecting workflow shows the current child link, paused-child message, fan-out summary, or no-output state without loading a transcript.
- [ ] A failed workflow rerun never links a child from an earlier successful attempt.
- [ ] Selecting a route_loop execution shows that exact execution_seq decision rather than another iteration.
- [ ] Selecting loop_group shows authored body ids and dependencies plus persisted iteration and body status without an agent timeline.
- [ ] Definition-unavailable rows with matching ApprovalContext, node_routed, typed bash or script lifecycle, typed workflow terminal, or approval_requested data use the corresponding non-agent fallback.
- [ ] An unmatched include-expanded agent node still uses the Story 5.1 agent room.
- [ ] Every selected state has exactly one region labelled with the selected node id, while the unselected state has none.
- [ ] Switching types keeps one Node runs navigation and one room body in the existing Logs shell.
- [ ] No non-agent selection invokes loadMessages.
- [ ] An unresolved node type never invokes loadMessages while the workflow-definition query is pending.
- [ ] No Ask card, pending-interaction slot, awaiting copy, or waiting-on-you copy is added.
- [ ] The Graph tab, console tree, engine, database, route schemas, generated API types, and workflow language remain unchanged.
- [ ] No new dependency, run-graph module, shared console React panel, or console import is added.
- [ ] All focused tests and bun run validate pass.
- [ ] The Story 5.2 sprint-status entry changes to done only after validation.

## Validation Commands

Run from packages/web:

~~~bash
bun test src/lib/approval-context.test.ts src/components/workflows/resolve-room-kind.test.ts src/components/workflows/select-room-data.test.ts
bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/StdoutRoom.test.tsx src/components/workflows/ChildWorkflowRoom.test.tsx src/components/workflows/RouteControllerRoom.test.tsx src/components/workflows/LoopGroupRoom.test.tsx
NODE_ENV=development bun test src/components/workflows/GateRoom.test.tsx
NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx
bun test src/components/dashboard/WorkflowRunCard.test.tsx src/components/workflows/build-log-rows.test.ts src/components/workflows/WorkflowExecution.test.tsx
bun run type-check
~~~

Run from the repository root:

~~~bash
bun run lint --max-warnings 0
bun run validate
git diff --check
~~~

There is no schema migration, so bun run check:schema-upgrades is not required.
There is no route-schema change, so packages/web/src/lib/api.generated.d.ts must remain unchanged.

## Implementation Order

1. Extract the existing metadata and URL boundary without changing behavior.
2. Add pure classification.
3. Add pure attempt-scoped selectors.
4. Establish the accessible shared room primitives and stdout body.
5. Add each remaining room body with its own red-green cycle.
6. Add the dispatcher and prove that only its agent branch creates the transcript query.
7. Wire the dispatcher into the existing Logs shell and retain GET run approval metadata.
8. Run focused and full validation.
9. Mark sprint tracking done and commit the tracking change last.

## Risks and Guardrails

| Risk | Guardrail |
| --- | --- |
| Current workflow definition differs from a historical run | ApprovalContext and persisted event hints cover known non-agent modes; unmatched rows remain agent-compatible without a backend expansion |
| A retry displays stale stdout or child identity | Selectors start at the selected ordinary row id and let the last terminal event win |
| A non-agent room still polls the transcript endpoint | NodeTranscriptPane exists only in the agent switch branch and both dispatcher and Logs tests verify the side effect |
| A child-blocked parent exposes the wrong Approve action | Gate action ownership rejects child_workflow, interactive_loop, and writeback types |
| Unsafe Plannotator URLs reach an anchor | One shared helper accepts only parsed HTTP(S) URLs |
| Loop and loop_group are confused by identical iteration events | Authored definition decides these modes; loop events alone never classify the room |
| Script, workflow, or loop_group collapse to prompt | The new classifier never calls resolveNodeDisplay |
| A second panel or graph implementation appears | LegacyNodeLogs retains its one shell and this story adds no run-graph or console code |
| Action failures disappear | GateRoom awaits the action promise and renders the rejected Error message |
| TDD becomes test-after | Each task names the expected RED failure and runs it before its production step |

## Open Questions

None.
All Story 5.2 decisions are resolved by the approved epic, current repository contracts, and the scope decisions above.
