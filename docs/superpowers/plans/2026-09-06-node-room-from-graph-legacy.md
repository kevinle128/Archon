# Node Room From Graph (Legacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task.
> Track progress with the checkbox steps below.

**Goal:** Give the legacy run view a node-centric graph as a second door into the same mounted per-type node room as Logs, while retaining the unmerged Logs view and excluding AskHuman chrome.

**Architecture:** Add the adopted dependency-free `packages/web/src/lib/run-graph/` module for deterministic cycle-safe layout, cubic edge routing, and taken-path classification.
Keep `@xyflow/react` as the legacy pan-and-zoom shell, but feed it only positions and routes from the pure module.
Evolve the current Logs-only composition into one `LegacyGraphLogsPane` that stays mounted while its left navigation switches between Graph and Logs, so both doors share selection and exactly one `LegacyNodeRoom` instance.

**Tech stack:** Bun, strict TypeScript, React 19, `@xyflow/react`, TanStack Query, happy-dom, react-dom/server, and bun:test.

**Story authority:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 5.3, FR1, UX-DR2, and UX-DR3.

**Approved design authority:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-1, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/README.md`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md` AD-4.

**Issue:** https://github.com/anhle128/Archon/issues/83

## Scope and Non-Goals

- Implement only Story 5.3 on the legacy `WorkflowExecution` Graph and Logs surfaces.
- Keep the Graph and Logs tabs and keep Logs as an unmerged chronological list of node-run rows.
- Use one mounted legacy room pane for Graph and Logs, with a graph click and the equivalent Logs-row click resolving to the same `LogRow` and `LegacyNodeRoom` chrome.
- Preserve the selected node and room when switching between Graph and Logs.
- Keep loop-iteration and route-iteration selection when the operator clicks a specific Logs row.
- Reset an iteration-specific Logs selection to the graph's canonical row when the operator clicks that graph node, including when it is the already-selected node.
- Keep the existing graph auto-selection behavior for the running or first available DAG node.
- Keep `LegacyNodeRoom` and every Story 5.2 per-type room implementation unchanged.
- Keep the Graph shell inspect-only and do not add an Ask card, an empty Ask slot, awaiting chrome, waiting-on-you copy, or a new status badge.
- Do not add `awaiting` to `WorkflowStepStatus`, `workflowNodeStateSchema`, the generated API types, or a live UI mapper in this story.
- The pure run-graph module must still accept an `awaiting` fixture and classify it as on-path rather than skipped.
- Do not change the engine, database, API routes, workflow schemas, workflow YAML, provider behavior, CLI, chat, `manage_run`, or command-center behavior.
- Do not implement the console graph shell.
- Do not import any legacy React component into `packages/web/src/experiments/console/`.
- Do not import `@archon/workflows` from `@archon/web`.
- Do not add a frontend dependency or call dagre from `packages/web/src/lib/run-graph/`.
- Do not change `packages/web/src/lib/dag-layout.ts`; the Workflow Builder continues to use its existing dagre layout.
- Sequential non-DAG runs continue to use the merged `WorkflowLogs` or `StepLogs` panel.
- Do not introduce the TypeScript `any` type.
- Use only existing design tokens.
- Do not run `bun test` from the repository root.
- For every behavior change, write and run the failing test first, confirm that it fails for the missing behavior, implement the minimum production change, and refactor only while green.
- Do not update sprint tracking until all focused and repository validation succeeds.

## Verified Repository Baseline

- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:48-49` marks Story 5.2 done and Story 5.3 backlog.
- Issue 83 requires the Story 5.3 acceptance criteria, focused test evidence, and the sprint-status transition before close.
- `packages/web/src/lib/run-graph/` does not exist.
- `packages/web/src/lib/dag-layout.ts:6-7` uses a 180 by 80 node box.
- `packages/web/src/lib/dag-layout.ts:49-84` uses dagre for the builder and the current run viewer.
- `packages/web/src/lib/dag-layout.ts:145-211` produces dependency and `route_loop` edges for React Flow.
- `packages/web/src/components/workflows/WorkflowDagViewer.tsx:59-120` currently calls `dagNodesToReactFlow` and colors an edge from only the target status.
- `packages/web/src/components/workflows/WorkflowDagViewer.tsx:149-155` already forwards a clicked node id.
- `packages/web/src/components/workflows/ExecutionDagNode.tsx:88-160` owns the existing node card, selection ring, status display, and React Flow handles.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:261-280` owns `selectedDagNode`, defaults to Graph, and resets selection on a run change.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:492-498` auto-selects a running or first DAG node.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:687-774` renders Graph beside a merged logs panel.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:787-811` renders Logs through `LegacyNodeLogs`.
- `packages/web/src/components/workflows/LegacyNodeLogs.tsx:70-100` synthesizes missing gate and control-flow node states.
- `packages/web/src/components/workflows/LegacyNodeLogs.tsx:118-164` owns a Logs-only row selection and its own `LegacyNodeRoom`.
- `packages/web/src/components/workflows/LegacyNodeRoom.tsx:24-170` is the single per-type room dispatcher from Story 5.2.
- `packages/web/src/components/workflows/build-log-rows.ts:9-22` defines the complete `LogRow` selection contract.
- `packages/web/src/components/workflows/build-log-rows.ts:100-143` emits either iteration rows or one ordinary row for each projected node.
- `packages/web/src/components/workflows/NodeRunList.tsx` already accepts complete `LogRow` values on selection.
- `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx:23-24` already renders Graph before Logs.
- `packages/web/src/lib/types.ts:13` and `packages/web/src/lib/api.generated.d.ts:4841-4846` intentionally have no `awaiting` live status yet.
- `packages/web/package.json` already depends on `@xyflow/react` and dagre, so this story needs no dependency change.
- `eslint.config.mjs:116-156` permits a future console import from `@/lib/run-graph` while continuing to forbid console imports from legacy components and API functions.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js:225-312` supplies the approved cycle breaking, longest-path layering, two-direction barycenter sweeps, and horizontally centered layers.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js:391-467` supplies the approved bottom-to-top, bottom-to-side, and left-flank cubic route geometry.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js:471-483` defines taken path by whether the target has started, which maps to `running`, `completed`, `failed`, or future `awaiting` and excludes `pending` and `skipped`.

## Design Decisions

1. Keep React Flow as the legacy viewport shell.
Story 5.3 and AD-4 require each surface to own its shell, and the existing legacy shell already supplies keyboard focus, pan, zoom, fit, controls, and node clicks.

2. Put all layout and route geometry in the pure module.
The React Flow edge component renders the returned SVG path and does not recompute ports, bends, cycle lanes, or taken state.

3. Detect DFS back edges before layering.
A naive Kahn pass over all edges flattens a valid workflow containing a retry loop, which contradicts the approved complex-graph design.

4. Use the approved target-started rule for taken path.
An edge is taken when its target state is `running`, `completed`, `failed`, or `awaiting`.
An edge is not taken when the target is missing, `pending`, or `skipped`.

5. Use the current 180 by 80 legacy graph node dimensions.
This preserves the existing card geometry while adopting the approved layout algorithm.

6. Keep one room component mounted across Graph and Logs.
`LegacyGraphLogsPane` owns the row selection and renders a stable right-hand `LegacyNodeRoom`; only the left navigation child switches.

7. Treat a graph node as a node-level selection.
Prefer an ordinary row for that node, otherwise use the last iteration row in `buildLogRows` order, and synthesize a pending ordinary row only when no row exists.

8. Preserve route and conditional edge metadata in the shared input type.
This prevents the legacy shell and the future console shell from inventing parallel label and style side channels.

9. Do not expand `include` or `loop_group` bodies in the browser.
Use the top-level nodes returned by the existing `GET /api/workflows/:name` response exactly as the current viewer does.

## Authoritative Interfaces

### Pure run-graph types

Create `packages/web/src/lib/run-graph/types.ts` with these exact contracts.

```ts
export type NodeState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'awaiting';

export type RouteOutcome = 'positive' | 'negative' | 'exhausted';

export type LayoutEdgeKind = 'dependency' | 'conditional' | 'route';

export interface LayoutNode {
  id: string;
  nodeState: NodeState;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  kind?: LayoutEdgeKind;
  label?: string;
  outcome?: RouteOutcome;
}

export interface Point {
  x: number;
  y: number;
}

export type PortSide = 'top' | 'bottom' | 'left' | 'right';

export interface LayoutRoute {
  edgeId: string;
  source: string;
  target: string;
  kind: LayoutEdgeKind;
  label?: string;
  outcome?: RouteOutcome;
  sourcePort: PortSide;
  targetPort: PortSide;
  path: string;
  labelPosition: Point;
  backEdge: boolean;
  taken: boolean;
}

export interface LayoutResult {
  positions: Record<string, Point>;
  routes: LayoutRoute[];
}

export interface LayoutInput {
  nodes: readonly LayoutNode[];
  edges: readonly LayoutEdge[];
}
```

The public entry point is exact.

```ts
export function layout(input: LayoutInput): LayoutResult;
```

`packages/web/src/lib/run-graph/index.ts` exports `layout` as its only runtime value and re-exports the public types above with `export type`.
It does not export internal DFS, barycenter, or route-builder helpers.

### Constants

Create `packages/web/src/lib/run-graph/constants.ts` with these exact values.

```ts
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 80;
export const NODE_SEP = 40;
export const RANK_SEP = 80;
export const SIDE_PORT_THRESHOLD = NODE_WIDTH * 0.75;
export const BACK_EDGE_GUTTER = 46;
```

### Taken-path classification

Create `packages/web/src/lib/run-graph/taken-path.ts` with these internal contracts.

```ts
export function isOnPath(state: NodeState | undefined): boolean;
export function isEdgeTaken(targetState: NodeState | undefined): boolean;
```

`isOnPath` returns true only for `running`, `completed`, `failed`, and `awaiting`.
`isEdgeTaken` delegates to the target's `isOnPath` result because the approved semantic is that the target started.

### Cycle-safe positions

Create `packages/web/src/lib/run-graph/positions.ts` with this internal result.

```ts
export interface PositionResult {
  positions: Record<string, Point>;
  layers: Record<string, number>;
  backEdgeIds: ReadonlySet<string>;
}

export function computePositions(
  nodeIds: readonly string[],
  edges: readonly LayoutEdge[]
): PositionResult;
```

The algorithm is deterministic and follows the approved prototype.

- Deduplicate node ids by preserving their first appearance.
- Ignore an edge whose source or target is not in that deduplicated id set.
- Build adjacency lists in input edge order.
- Visit nodes in first-seen order with a white, gray, and black DFS.
- Mark self-edges and edges to a gray node as back edges.
- Exclude only those back edges from longest-path layering.
- Place every source at layer zero.
- For each forward edge, assign `targetLayer = max(targetLayer, sourceLayer + 1)` in topological order.
- Start every layer in first-seen node order.
- Perform two complete barycenter sweeps, each with a top-down pass using predecessor positions and a bottom-up pass using successor positions.
- Use the current position for a node with no neighbors in the adjacent direction.
- Break equal barycenters with the node's original first-seen index.
- Center every layer within the width of the widest layer.
- Use `NODE_WIDTH + NODE_SEP` horizontally and `NODE_HEIGHT + RANK_SEP` vertically.
- Return top-left coordinates.
- Never read a node state while calculating positions.

### Cubic routes

Create `packages/web/src/lib/run-graph/routes.ts` with this internal contract.

```ts
export function buildRoutes(input: {
  positions: Readonly<Record<string, Point>>;
  layers: Readonly<Record<string, number>>;
  backEdgeIds: ReadonlySet<string>;
  edges: readonly LayoutEdge[];
  states: Readonly<Record<string, NodeState>>;
}): LayoutRoute[];
```

Every route is one cubic SVG path in `M x y C x y x y x y` form.
The helper that formats this path stays in `routes.ts`, so the shell does not own route math.

For a forward edge, start at the source's bottom center.
Use the target's top center when the edge spans at most one layer or the absolute horizontal center offset is at most `SIDE_PORT_THRESHOLD`.
Use the target's left center when the long-offset target is to the right of the source.
Use the target's right center when the long-offset target is to the left of the source.
For a top-target route, calculate `bend = Math.max(18, (end.y - start.y) * 0.45)` and use control points `{ x: start.x, y: start.y + bend }` and `{ x: end.x, y: end.y - bend }`.
For a side-target route, let `direction` be `Math.sign(targetCenterX - sourceCenterX)`.
Calculate `sourceBend = Math.max(24, (end.y - start.y) * 0.5)` and `targetBend = Math.max(40, Math.abs(targetCenterX - sourceCenterX) * 0.35)`.
Use control points `{ x: start.x, y: start.y + sourceBend }` and `{ x: end.x - direction * targetBend, y: end.y }`.

For a non-self back edge, start at the source's left center and end at the target's left center.
Use `min(source.x, target.x) - BACK_EDGE_GUTTER` for both control-point x coordinates.
Keep the first control point at the start y and the second control point at the end y.
For a self-edge, start at the left center, end at the top center, set `lane = source.x - BACK_EDGE_GUTTER`, set `topLane = source.y - BACK_EDGE_GUTTER`, and use `{ x: lane, y: start.y }` and `{ x: lane, y: topLane }` as the controls.

For a top-target route, set `labelPosition` to `{ x: (start.x + end.x) / 2 + 8, y: (start.y + end.y) / 2 }`.
For a side-target route, set `labelPosition` to `{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 8 }`.
For a non-self back edge, set `labelPosition` to `{ x: lane + 4, y: (start.y + end.y) / 2 }`.
For a self-edge, set `labelPosition` at the upper-left gutter control point.
Copy `kind`, `label`, and `outcome` from the input edge.
Default a missing `kind` to `dependency`.
Omit a route when either endpoint has no position.
Set `taken` from only the target state.
Set `backEdge` from `backEdgeIds`.

### Workflow-to-layout adapter

Create `packages/web/src/components/workflows/build-run-graph-input.ts` with these exact contracts.

```ts
export interface RunGraphInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export function buildRunGraphInput(
  dagNodes: readonly DagNode[],
  liveStatus: readonly { nodeId: string; status: WorkflowStepStatus }[]
): RunGraphInput;

export function layoutRunGraph(
  dagNodes: readonly DagNode[],
  liveStatus: readonly { nodeId: string; status: WorkflowStepStatus }[]
): LayoutResult;
```

`buildRunGraphInput` copies top-level definition nodes in definition order.
The last matching live status wins, and a missing live status maps to `pending`.
This live adapter never emits `awaiting` in Story 5.3.

An ordinary `depends_on` edge has id `${dependency}->${node.id}`.
An ordinary edge has `kind: 'conditional'` and `label: node.when` when `node.when` is a non-empty string.
Otherwise an ordinary edge has `kind: 'dependency'` and no label.

Do not emit an ordinary dependency edge from a `route_loop` controller to one of that controller's configured route targets.
Emit route targets in `exhausted`, `negative`, and `positive` insertion order to retain the current visual ordering.
Derive that order with `[...ROUTE_LOOP_OUTCOMES].reverse()` rather than duplicating the canonical outcome tuple.
Each route edge has `kind: 'route'`, its `outcome`, and the outcome as its label.
Use `${source}->${target}` when free and `${source}->${target}:${outcome}` on an id collision.

`layoutRunGraph` passes the adapter result directly to `layout`.

### React Flow view model

Create `packages/web/src/components/workflows/build-workflow-dag-view-model.ts` with a pure mapping boundary.

```ts
export interface WorkflowDagViewModel {
  nodes: ExecutionFlowNode[];
  edges: RunGraphFlowEdge[];
}

export function buildWorkflowDagViewModel(input: {
  dagNodes: readonly DagNode[];
  liveStatus: readonly DagNodeState[];
  selectedNodeId: string | null;
}): WorkflowDagViewModel;
```

The function calls `layoutRunGraph` and creates one `ExecutionFlowNode` for every definition node.
It continues to use `resolveExecutionNodeDisplay` and copies all current status, duration, error, iteration, route-decision, provider, model, tier, effort, and thinking fields.
It sets each node's `position` from the pure layout result and sets `selected` from `selectedNodeId`.

The function creates one React Flow edge for every returned route.
Each edge uses `type: 'runGraphRoute'`, retains the route label, stores the complete route in typed `data`, and animates only while the target status is `running`.
Each edge uses the existing `MarkerType.ArrowClosed` marker.
The mapping never marks a skipped target as taken.

Create `packages/web/src/components/workflows/RunGraphRouteEdge.tsx` with these types.

```ts
export type RunGraphFlowEdge = Edge<
  { route: LayoutRoute },
  'runGraphRoute'
>;

export function RunGraphRouteEdge(
  props: EdgeProps<RunGraphFlowEdge>
): React.ReactElement | null;
```

The component renders nothing when `data?.route.path` is empty.
Otherwise it renders `BaseEdge` with `path`, `labelX`, `labelY`, `label`, and `markerEnd` taken from the route and React Flow props.
It does not calculate geometry.
Untaken edges use `var(--border)`.
Taken dependency and conditional edges use `var(--accent-bright)`.
Taken positive routes use `var(--success)`.
Taken negative routes use `var(--accent)`.
Taken exhausted routes use `var(--error)`.
Back edges and conditional edges use a dashed stroke.

### Shared Graph and Logs room pane

Move `packages/web/src/components/workflows/LegacyNodeLogs.tsx` to `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` and rename its export.
Preserve its state synthesizer, `buildLogRows`, and Story 5.2 room props.

Add these props to the renamed component.

```ts
export interface LegacyGraphLogsPaneProps {
  activeView: 'graph' | 'logs';
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
  roomHeader?: ReactNode;
  roomFooter?: ReactNode;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}
```

Create `packages/web/src/components/workflows/resolve-graph-room-row.ts` with this contract.

```ts
export function resolveGraphRoomRow(input: {
  rows: readonly LogRow[];
  nodeId: string | null;
  liveStatus: readonly {
    nodeId: string;
    name: string;
    status: WorkflowNodeStateResponse['status'];
  }[];
}): LogRow | null;
```

Return null when `nodeId` is null.
Among matching rows, return the last ordinary `{ kind: 'node' }` row when present.
Otherwise return the last matching row in current array order.
When no row matches, synthesize this exact row from the last matching live status or the node id.

```ts
{
  id: `node:${nodeId}`,
  nodeId,
  label: live?.name ?? nodeId,
  status: live?.status ?? 'pending',
  order: 0,
  sourceIndex: 0,
  selection: { kind: 'node' },
}
```

`LegacyGraphLogsPane` retains `selectedLogRowId` for iteration-specific Logs selection.
Resolve `explicitSelectedRow` from that id before deriving the displayed selection.
Its selected row is `explicitSelectedRow` only while that row exists and belongs to `selectedNodeId`.
Otherwise its selected row comes from `resolveGraphRoomRow`.
Pass the synthesized visible node states as the resolver's `liveStatus` input.

The graph callback clears `selectedLogRowId` before calling `onSelectNode(nodeId)`.
This rule applies even when the clicked graph node is already selected.
The Logs callback stores the complete row id and calls `onSelectNode(row.nodeId)`.
A run-id change or polling that removes the explicit selected row clears `selectedLogRowId` and calls `onSelectNode(null)` exactly once, preserving the Story 5.1 reset contract.
An external selected-node change clears an explicit row belonging to the previous node.

Render one stable `ResizablePanelGroup` for both Graph and Logs.
Use the current Graph split values of left `defaultSize={60}` and `minSize={30}` plus right `defaultSize={40}` and `minSize={20}`.
The left panel calls `renderGraph` in Graph mode and renders the existing `NodeRunList` in Logs mode.
Pass `selectedRow?.id ?? null` to `NodeRunList.selectedRowId` so the row resolved from a Graph selection is visibly selected after switching to Logs.
The right panel always renders `roomHeader`, one `LegacyNodeRoom`, and `roomFooter` in the same React tree position.
Do not render `NodeRunList` in Graph mode.
Do not mount a second `LegacyNodeRoom` in either mode.

## Task 1: Add the Pure Types and Taken-Path Contract

**Files:**

- Create `packages/web/src/lib/run-graph/types.ts`.
- Create `packages/web/src/lib/run-graph/constants.ts`.
- Create `packages/web/src/lib/run-graph/taken-path.ts`.
- Create `packages/web/src/lib/run-graph/taken-path.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Test every `NodeState` value through `isOnPath`.
Assert that `running`, `completed`, `failed`, and `awaiting` are true.
Assert that `pending`, `skipped`, and `undefined` are false.
Assert that `isEdgeTaken('awaiting')` is true and `isEdgeTaken('skipped')` is false.

- [ ] **Step 2: Run the RED test.**

```bash
( cd packages/web && bun test src/lib/run-graph/taken-path.test.ts )
```

Expected result: FAIL because the new module does not exist.

- [ ] **Step 3: Implement only the declared types, constants, and classifiers.**

Keep these files free of React, DOM, API, React Flow, and dagre imports.

- [ ] **Step 4: Run the GREEN test.**

```bash
( cd packages/web && bun test src/lib/run-graph/taken-path.test.ts )
```

Expected result: PASS.

- [ ] **Step 5: Refactor only while green.**

Do not add status aliases or a live `awaiting` mapper.

- [ ] **Step 6: Commit Task 1.**

```bash
git add packages/web/src/lib/run-graph/types.ts packages/web/src/lib/run-graph/constants.ts packages/web/src/lib/run-graph/taken-path.ts packages/web/src/lib/run-graph/taken-path.test.ts
git commit -m "feat(web): define run graph path states"
```

## Task 2: Implement Cycle-Safe Layered Positions

**Files:**

- Create `packages/web/src/lib/run-graph/positions.ts`.
- Create `packages/web/src/lib/run-graph/positions.test.ts`.

- [ ] **Step 1: Write the failing position tests.**

Cover all of these cases in `positions.test.ts`.

- An empty input returns empty positions, layers, and back-edge ids.
- A single node is at `{ x: 0, y: 0 }`.
- Duplicate node ids preserve the first position only.
- Edges with a missing endpoint do not affect layout.
- A fork centers the one-node parent layer over its two-node child layer.
- The crossing fixture `a -> d` and `b -> c` reorders the second layer to `d, c`.
- The retry fixture `start -> work -> review -> work` marks only `review -> work` as a back edge and leaves `start`, `work`, and `review` on three successive layers.
- A two-node cycle is not flattened into one layer.
- Repeating the same input returns byte-for-byte equal output.

Use constants in coordinate assertions rather than copying numeric gaps.

- [ ] **Step 2: Run the RED test.**

```bash
( cd packages/web && bun test src/lib/run-graph/positions.test.ts )
```

Expected result: FAIL because `positions.ts` does not exist.

- [ ] **Step 3: Implement DFS cycle breaking, longest-path layering, barycenter sweeps, and centered coordinates.**

Use typed `Map` and `Set` values internally.
Use stable original-index tie breaks after every barycenter calculation.
Do not catch and silently replace a programming error with arbitrary fallback positions.

- [ ] **Step 4: Run the GREEN test.**

```bash
( cd packages/web && bun test src/lib/run-graph/positions.test.ts )
```

Expected result: PASS.

- [ ] **Step 5: Refactor only while green.**

Keep all traversal order explicit and deterministic.

- [ ] **Step 6: Commit Task 2.**

```bash
git add packages/web/src/lib/run-graph/positions.ts packages/web/src/lib/run-graph/positions.test.ts
git commit -m "feat(web): add cycle-safe run graph positions"
```

## Task 3: Implement Cubic Routes and the Public Layout Function

**Files:**

- Create `packages/web/src/lib/run-graph/routes.ts`.
- Create `packages/web/src/lib/run-graph/routes.test.ts`.
- Create `packages/web/src/lib/run-graph/layout.ts`.
- Create `packages/web/src/lib/run-graph/layout.test.ts`.
- Create `packages/web/src/lib/run-graph/index.ts`.

- [ ] **Step 1: Write the failing route tests.**

Cover all of these cases in `routes.test.ts`.

- An adjacent-layer forward edge leaves the source bottom and enters the target top.
- A vertically aligned multi-layer edge still enters the target top.
- A long edge offset to the right leaves the source bottom and enters the target left.
- A long edge offset to the left leaves the source bottom and enters the target right.
- A retry back edge uses left-to-left ports and a lane exactly `BACK_EDGE_GUTTER` left of the leftmost endpoint.
- A self-edge emits a non-empty visible upper-left curve.
- Missing endpoints omit the route.
- Edge kind, label, and outcome survive into the route.
- An `awaiting` target produces `taken: true`.
- A `skipped`, `pending`, or missing target state produces `taken: false`.

Assert exact ports, endpoints, back-edge flags, and deterministic path strings.

- [ ] **Step 2: Write the failing public-layout tests.**

Cover all of these cases in `layout.test.ts`.

- Empty input returns `{ positions: {}, routes: [] }`.
- Changing only node states leaves all positions byte-for-byte equal.
- `completed -> awaiting` is taken.
- `completed -> skipped` is not taken.
- A retry loop keeps progressive layers and returns one left-flank back route.
- Duplicate node ids keep the first layout position and use the last state for taken-path classification.

- [ ] **Step 3: Run both RED tests.**

```bash
( cd packages/web && bun test src/lib/run-graph/routes.test.ts src/lib/run-graph/layout.test.ts )
```

Expected result: FAIL because route and layout modules do not exist.

- [ ] **Step 4: Implement the route builder and `layout`.**

`layout` deduplicates ids for positioning, lets the last duplicate state win, calls `computePositions`, and passes its complete topology result to `buildRoutes`.
Return routes in valid input-edge order.

- [ ] **Step 5: Add the narrow public export file.**

Export only the `layout` runtime value and type-only public contracts from `index.ts`.

- [ ] **Step 6: Run all pure-module GREEN tests.**

```bash
( cd packages/web && bun test src/lib/run-graph/taken-path.test.ts src/lib/run-graph/positions.test.ts src/lib/run-graph/routes.test.ts src/lib/run-graph/layout.test.ts )
```

Expected result: PASS.

- [ ] **Step 7: Refactor only while green.**

Run this import audit after refactoring.

```bash
rg -n "from ['\"](react|@xyflow/react|@dagrejs/dagre|@/lib/api)['\"]" packages/web/src/lib/run-graph --glob '!*.test.ts'
rg -n "\b(document|window)\b" packages/web/src/lib/run-graph --glob '!*.test.ts'
```

Expected result: both searches return no matches.

- [ ] **Step 8: Commit Task 3.**

```bash
git add packages/web/src/lib/run-graph
git commit -m "feat(web): add pure run graph layout"
```

## Task 4: Adapt Workflow Definitions to the Shared Layout Input

**Files:**

- Create `packages/web/src/components/workflows/build-run-graph-input.ts`.
- Create `packages/web/src/components/workflows/build-run-graph-input.test.ts`.

- [ ] **Step 1: Write the failing adapter tests.**

Cover all of these cases.

- Definition order becomes layout-node order.
- The last duplicate live status wins.
- A missing live status becomes `pending`.
- The adapter never emits `awaiting` from `WorkflowStepStatus`.
- Ordinary dependencies become dependency edges.
- A non-empty `when` makes each incoming ordinary edge conditional and carries the exact condition label.
- `route_loop` targets suppress duplicate ordinary controller-to-target dependencies.
- `route_loop` edges are emitted in `exhausted`, `negative`, and `positive` order with stable ids, kinds, labels, and outcomes.
- Repeated route targets receive unique ids.
- `layoutRunGraph` returns every definition node position and a skipped target's incoming route is not taken.

- [ ] **Step 2: Run the RED test.**

```bash
( cd packages/web && bun test src/components/workflows/build-run-graph-input.test.ts )
```

Expected result: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the adapter.**

Import the `ROUTE_LOOP_OUTCOMES` value and the `RouteLoopConfig` and `DagNode` types from `@/lib/api` instead of redeclaring their value or shapes.
Keep any defensive route-loop narrowing local and typed.
Do not import React Flow or dagre.

- [ ] **Step 4: Run the GREEN test and the unchanged builder layout tests.**

```bash
( cd packages/web && bun test src/components/workflows/build-run-graph-input.test.ts src/lib/dag-layout.test.ts )
```

Expected result: PASS.

- [ ] **Step 5: Refactor only while green.**

Do not move builder callers away from `dag-layout.ts`.

- [ ] **Step 6: Commit Task 4.**

```bash
git add packages/web/src/components/workflows/build-run-graph-input.ts packages/web/src/components/workflows/build-run-graph-input.test.ts
git commit -m "feat(web): adapt workflow runs to graph layout"
```

## Task 5: Render Shared Routes in the Legacy React Flow Viewer

**Files:**

- Create `packages/web/src/components/workflows/RunGraphRouteEdge.tsx`.
- Create `packages/web/src/components/workflows/RunGraphRouteEdge.test.tsx`.
- Create `packages/web/src/components/workflows/build-workflow-dag-view-model.ts`.
- Create `packages/web/src/components/workflows/build-workflow-dag-view-model.test.ts`.
- Modify `packages/web/src/components/workflows/WorkflowDagViewer.tsx`.

- [ ] **Step 1: Write the failing view-model tests.**

Cover all of these cases.

- Every definition node receives the pure layout position.
- Missing live status remains a pending visual node without changing the definition label.
- Live status metadata is preserved exactly as the current viewer preserves it.
- Changing only statuses changes edge `taken` and animation without changing positions.
- A skipped target has `route.taken === false` and is not animated.
- Every edge uses `type: 'runGraphRoute'`, typed route data, its label, and an arrow marker.
- A retry cycle produces progressive node y coordinates and one `backEdge: true` route.

- [ ] **Step 2: Write the failing edge-renderer tests.**

Use `renderToStaticMarkup` with fully typed props and no `any` assertion.
Assert that an untaken edge renders the exact shared path with `var(--border)`.
Assert that a taken dependency uses `var(--accent-bright)`.
Assert positive, negative, and exhausted taken routes use the declared existing tokens.
Assert conditional and back-edge routes have a dashed stroke.
Assert an empty path renders an empty string.

- [ ] **Step 3: Run the RED tests.**

```bash
( cd packages/web && bun test src/components/workflows/build-workflow-dag-view-model.test.ts src/components/workflows/RunGraphRouteEdge.test.tsx )
```

Expected result: FAIL because both modules do not exist.

- [ ] **Step 4: Implement the view model and custom edge.**

Define `edgeTypes` at module scope in `WorkflowDagViewer.tsx` as `{ runGraphRoute: RunGraphRouteEdge }`.
Replace the `dagNodesToReactFlow` and edge-color memos with one memoized `buildWorkflowDagViewModel` call.
Depend on `dagNodes`, `liveStatus`, and `selectedNodeId` so taken state updates live while positions remain stable by contract.
Keep the executing chip, node types, MiniMap, Controls, fit, pan, zoom, and existing click callback.
Do not import dagre into the new adapter or viewer.

- [ ] **Step 5: Run the GREEN tests and viewer neighbors.**

```bash
( cd packages/web && bun test src/components/workflows/build-workflow-dag-view-model.test.ts src/components/workflows/RunGraphRouteEdge.test.tsx src/components/workflows/build-run-graph-input.test.ts src/lib/run-graph/layout.test.ts src/lib/dag-layout.test.ts )
```

Expected result: PASS.

- [ ] **Step 6: Run the web type checker.**

```bash
( cd packages/web && bun run type-check )
```

Expected result: PASS with no `any` and no React Flow generic mismatch.

- [ ] **Step 7: Commit Task 5.**

```bash
git add packages/web/src/components/workflows/RunGraphRouteEdge.tsx packages/web/src/components/workflows/RunGraphRouteEdge.test.tsx packages/web/src/components/workflows/build-workflow-dag-view-model.ts packages/web/src/components/workflows/build-workflow-dag-view-model.test.ts packages/web/src/components/workflows/WorkflowDagViewer.tsx
git commit -m "feat(web): render shared run graph routes"
```

## Task 6: Share One Room Between Graph and Logs

**Files:**

- Create `packages/web/src/components/workflows/resolve-graph-room-row.ts`.
- Create `packages/web/src/components/workflows/resolve-graph-room-row.test.ts`.
- Move `packages/web/src/components/workflows/LegacyNodeLogs.tsx` to `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`.
- Move `packages/web/src/components/workflows/LegacyNodeLogs.test.tsx` to `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.test.tsx` for the exact composition selector below.

Add this pure selector to `packages/web/src/components/workflows/WorkflowExecution.tsx` and use it in `renderBody`.

```ts
export type WorkflowExecutionBody =
  | 'graph-logs-pane'
  | 'source-control'
  | 'chat'
  | 'sequential';

export function resolveWorkflowExecutionBody(input: {
  isDag: boolean;
  activeView: WorkflowRunView;
  parentPlatformId: string | null;
}): WorkflowExecutionBody;
```

Return `sequential` when `isDag` is false.
Return `source-control` for a DAG Source Control view.
Return `chat` only for a DAG Chat view with a non-null parent platform id.
Return `graph-logs-pane` for DAG Graph or Logs views and for the existing impossible Chat-without-parent fallback.

- [ ] **Step 1: Write the failing graph-row resolver tests.**

Cover all of these cases.

- Null node selection returns null.
- An ordinary matching row wins over iteration rows regardless of its array position.
- When no ordinary row exists, the last matching iteration row wins.
- Rows for other nodes are ignored.
- No row plus live status produces the exact synthetic row.
- No row and no live status produces a pending synthetic row labelled with the node id.
- Duplicate live statuses use the last match.

- [ ] **Step 2: Run the resolver RED test.**

```bash
( cd packages/web && bun test src/components/workflows/resolve-graph-room-row.test.ts )
```

Expected result: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement the resolver and run it GREEN.**

```bash
( cd packages/web && bun test src/components/workflows/resolve-graph-room-row.test.ts )
```

Expected result: PASS.

- [ ] **Step 4: Move the existing Logs test first and add failing shared-pane cases.**

Use `git mv` for the test file.
Change its dynamic import and harness to expect `LegacyGraphLogsPane`.
Keep the existing Story 5.2 agent, stdout, gate, workflow, route-loop, loop-group, selection-reset, and no-Ask assertions.
Default the existing cases to `activeView: 'logs'`.

Add these new mounted cases.

- Graph mode renders the injected graph navigation and no `Node runs` list.
- Clicking an injected graph-node button opens the same bash room without loading messages.
- Clicking an injected command node loads only that node's messages.
- Switching from Graph to Logs for the same selection preserves the exact labelled room DOM element and does not issue another message request.
- The equivalent Logs row is selected with `aria-current="true"` after switching from Graph to Logs.
- Clicking a loop iteration row preserves that iteration selection.
- Clicking the same loop node in Graph clears the iteration-specific row and resolves the graph's canonical last iteration row.
- A run-id change clears selection and reports null once.
- Neither mode contains `AskHuman`, `awaiting`, or `waiting-on-you` copy.

- [ ] **Step 5: Run the shared-pane RED test before moving production code.**

```bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx )
```

Expected result: FAIL because `LegacyGraphLogsPane.tsx` and its new export do not exist.

- [ ] **Step 6: Move and evolve the production composition.**

Use `git mv packages/web/src/components/workflows/LegacyNodeLogs.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`.
Rename the export and props.
Keep the state synthesizer and existing Story 5.2 room inputs.
Implement the authoritative shared-pane rules above.
Do not duplicate `LegacyNodeRoom` or `NodeRunList`.

- [ ] **Step 7: Run the shared-pane GREEN test and Story 5.2 room regression tests.**

```bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx )
```

Expected result: PASS.

- [ ] **Step 8: Write the failing WorkflowExecution composition-selector assertions before wiring.**

Import `resolveWorkflowExecutionBody` in the existing test file.
Assert both DAG Graph and DAG Logs return `graph-logs-pane`.
Assert DAG Source Control returns `source-control`.
Assert DAG Chat with a parent returns `chat`.
Assert DAG Chat without a parent retains the current fallback by returning `graph-logs-pane`.
Assert every non-DAG input returns `sequential`.
Do not add `mock.module` to the shared component test process.

- [ ] **Step 9: Run the WorkflowExecution RED test.**

```bash
( cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx )
```

Expected result: FAIL because the selector is absent.

- [ ] **Step 10: Wire Graph and Logs through the same pane.**

Replace the `LegacyNodeLogs` import with `LegacyGraphLogsPane`.
Implement and use `resolveWorkflowExecutionBody` rather than retaining parallel branch predicates.
Combine the DAG Graph and Logs branches so both render one `LegacyGraphLogsPane` at the same tree position.
When the resolved body is `graph-logs-pane`, pass pane mode `graph` only for `activeView === 'graph'` and pass pane mode `logs` for the Logs and Chat-without-parent fallback cases.
Pass `activeView`, `selectedDagNode`, `setSelectedDagNode`, raw node states, events, the workflow definition, room callbacks, retry header, and artifact footer.
Pass a `renderGraph` callback containing the current loaded, failed, pending, and unavailable graph states.
Inside the successful graph state, render `WorkflowDagViewer` with the selection callback supplied by `LegacyGraphLogsPane`.
Remove `mergedLogsPanel` from DAG Graph mode.
Rename it to `sequentialLogsPanel` and retain it only in the non-DAG branch.
Keep Chat and Source Control branches unchanged for later stories.
Keep the current auto-selection effect.

- [ ] **Step 11: Run the complete focused GREEN set.**

```bash
( cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/resolve-graph-room-row.test.ts src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/build-log-rows.test.ts )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx )
( cd packages/web && bun run type-check )
```

Expected result: PASS.

- [ ] **Step 12: Refactor only while green.**

Run `rg -n "LegacyNodeLogs" packages/web/src` and remove stale imports or names.
Do not delete any Story 5.2 behavioral assertion during the rename.

- [ ] **Step 13: Commit Task 6.**

```bash
git add packages/web/src/components/workflows/resolve-graph-room-row.ts packages/web/src/components/workflows/resolve-graph-room-row.test.ts packages/web/src/components/workflows/LegacyGraphLogsPane.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx
git commit -m "feat(web): share the legacy graph and logs room"
```

## Task 7: Validate and Update Sprint Tracking Last

**Files:**

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after every preceding check passes.

- [ ] **Step 1: Run every new pure and adapter test from `packages/web`.**

```bash
( cd packages/web && bun test src/lib/run-graph/taken-path.test.ts src/lib/run-graph/positions.test.ts src/lib/run-graph/routes.test.ts src/lib/run-graph/layout.test.ts )
( cd packages/web && bun test src/components/workflows/build-run-graph-input.test.ts src/components/workflows/build-workflow-dag-view-model.test.ts src/components/workflows/RunGraphRouteEdge.test.tsx src/components/workflows/resolve-graph-room-row.test.ts src/lib/dag-layout.test.ts )
```

Expected result: PASS.

- [ ] **Step 2: Run the mounted pane and room tests in isolated invocations.**

```bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx )
```

Expected result: PASS.

- [ ] **Step 3: Run neighboring regressions and the web type checker.**

```bash
( cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/build-log-rows.test.ts )
( cd packages/web && bun run type-check )
```

Expected result: PASS.

- [ ] **Step 4: Run root lint and the complete repository validation.**

```bash
bun run lint --max-warnings 0
bun run validate
```

Expected result: both commands exit zero with no warnings.
Do not substitute a root `bun test` command.

- [ ] **Step 5: Update sprint status only after Step 4 succeeds.**

Change only `5-3-open-the-same-node-room-from-the-graph-legacy` from `backlog` to `done`.
Update the comment-form and YAML-form `last_updated` timestamps in the file's existing `YYYY-MM-DD HH:mm:ss +0700` format.
Do not change `generated`, either epic status, any other story, or the absolute metadata paths.

- [ ] **Step 6: Validate the tracking-only edit and final diff.**

```bash
git diff --check
bun run format:check
bun run validate
git status --short
```

Expected result: all validation commands exit zero and status shows only intended story files.

- [ ] **Step 7: Commit the validated tracking update.**

```bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark legacy graph node room done"
```

## Acceptance Criteria

- [ ] `packages/web/src/lib/run-graph/index.ts` exposes `layout({ nodes: { id, nodeState }[], edges })` and returns positions plus routes.
- [ ] The pure module has no React, DOM, API, React Flow, or dagre production imports.
- [ ] No dependency is added.
- [ ] A retry-loop edge is removed from layering, routed around the left flank, and does not flatten the forward graph.
- [ ] Forward routes always leave the source bottom, enter the target top for short or vertical connections, and enter the facing target side for long offset connections.
- [ ] Positions are deterministic and do not change when only node states change.
- [ ] Taken-path classification uses the target-started rule and treats `awaiting` as on-path while treating `skipped` as off-path.
- [ ] The live Story 5.3 adapter never emits `awaiting`.
- [ ] The legacy viewer gets every node position and route path from the pure module.
- [ ] React Flow retains fit, pan, zoom, controls, keyboard-selectable nodes, status cards, and graph-node clicks.
- [ ] The Graph tab renders no merged `WorkflowLogs` panel and no second `NodeRunList`.
- [ ] The Logs tab remains an unmerged node-run list with iteration rows.
- [ ] Graph and Logs render the same mounted `LegacyNodeRoom` in the same right-hand panel.
- [ ] Clicking a graph node resolves the same canonical `LogRow` and per-type chrome as clicking its equivalent Logs row.
- [ ] Switching between Graph and Logs preserves selection and the mounted room DOM node.
- [ ] Clicking an explicit Logs iteration preserves that iteration until a graph-node click intentionally returns to the canonical graph row.
- [ ] Sequential non-DAG runs keep their merged logs behavior.
- [ ] Chat, Source Control, console, engine, database, routes, generated API types, provider behavior, and workflow language are unchanged.
- [ ] No Ask card, Ask slot, `awaiting`, or waiting-on-you chrome is introduced.
- [ ] All focused tests, type checking, lint, formatting, and `bun run validate` pass.
- [ ] Story 5.3 moves to done only after validation succeeds.

## Test Coverage Map

- `packages/web/src/lib/run-graph/taken-path.test.ts` proves future `awaiting` and current skipped semantics.
- `packages/web/src/lib/run-graph/positions.test.ts` proves deterministic cycle-safe layering and barycenter ordering.
- `packages/web/src/lib/run-graph/routes.test.ts` proves distance-aware ports, cubic paths, back-edge lanes, and route metadata.
- `packages/web/src/lib/run-graph/layout.test.ts` proves the public AD-4 contract and state-independent positions.
- `packages/web/src/components/workflows/build-run-graph-input.test.ts` proves definition and live-status adaptation.
- `packages/web/src/components/workflows/build-workflow-dag-view-model.test.ts` proves React Flow nodes and edges consume shared output.
- `packages/web/src/components/workflows/RunGraphRouteEdge.test.tsx` proves visual edge semantics use existing tokens without recalculating geometry.
- `packages/web/src/components/workflows/resolve-graph-room-row.test.ts` proves graph-node-to-row resolution and pending synthesis.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` proves one mounted room, shared selection, unmerged Logs, every Story 5.2 room type, and no Ask chrome.
- `packages/web/src/components/workflows/WorkflowExecution.test.tsx` proves Graph and Logs select the same composition branch.
- `packages/web/src/lib/dag-layout.test.ts` protects the unchanged builder layout.
- `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx` protects the existing tab order.

## Implementation Order

1. Define independent graph types, constants, and taken-path classification.
2. Implement cycle-safe positions before route geometry.
3. Implement routes and expose the public `layout` function.
4. Adapt workflow definitions and statuses into the shared input type.
5. Build typed React Flow elements and switch the existing viewer to shared routes.
6. Resolve graph nodes to rows and replace the Logs-only composition with one Graph-and-Logs pane.
7. Wire both tabs through that pane while preserving non-DAG, Chat, and Source Control branches.
8. Run focused and complete validation.
9. Update and commit sprint tracking last.

## Rollback Boundary

The runtime change is isolated to the new `run-graph` and legacy graph-room files plus `WorkflowDagViewer.tsx` and `WorkflowExecution.tsx`.
Reverting Tasks 4 through 6 restores the old dagre-backed Graph and Logs-only room composition without touching the Workflow Builder or backend contracts.
Reverting Tasks 1 through 3 then removes the unused pure module.

## Open Questions

None.
