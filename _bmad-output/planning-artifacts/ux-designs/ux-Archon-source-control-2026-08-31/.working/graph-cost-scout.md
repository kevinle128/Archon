# Commit-graph implementation cost — findings (GraphCostScout) + risk note

**Verified: NO new dependency needed** — React Flow is already present and already reused by the run screen's Graph tab; parent OIDs are the only data delta. **NOT verified as trivially LOW:** the commit lane-assignment algorithm (especially through merges) and keeping lane continuity across paged/virtualized history are custom, unprototyped work → **cost = TBD / medium-risk until a spike**. What is disproven is only the fear that a _new library_ is required (a code fact). The **normative** graph requirement (history = graph, not the specced list) still requires **Correct Course + a rerun of IR** — a process fact that dependency reuse does not decide. The custom lane-layout risk remains open.

## Verified reuse / no-new-dependency evidence

- `archon/packages/web/package.json` already ships a production node-link graph stack: **`@xyflow/react` ^12.10.1 (React Flow v12)** + **`@dagrejs/dagre` ^2.0.4**, plus **`@tanstack/react-virtual` ^3.0.0** and `highlight.js ^11.11.1`. No other packages carry viz libs; `@types/d3-hierarchy` is an orphaned devDep (no d3 imports).
- The run screen's own **"Graph" tab already uses it:** `WorkflowExecution.tsx` tab strip (Graph|Logs|Chat, ~:861-877) → `WorkflowDagViewer.tsx` = `<ReactFlow>` with Background/Controls/MiniMap, custom `executionNode`, layout via `lib/dag-layout.ts` (dagre). Same stack also powers the builder (`WorkflowCanvas.tsx`) and experiments (`BuilderCanvas.tsx`, `RunGraphPanel.tsx`).
- React Flow is **layout-engine-agnostic** (renders nodes at given positions). A commit-topology lane view reuses it with a custom lane-assignment layout (size TBD by spike) instead of dagre — OR renders rows as plain virtualized SVG with **zero new deps**. Rendering infra already exists either way; the lane algorithm itself is unverified.
- **No new dependency required** (code fact). The normative graph requirement still requires **Correct Course + an IR rerun** — dependency reuse does not settle the process question.

## Unverified — spike this (medium risk)

Verified = the rendering infra (React Flow, or virtualized SVG) is free. NOT verified (custom, unprototyped):

- **Lane assignment through merges** — mapping each commit to a stable column given multi-parent merges is a known-but-nontrivial algorithm; not built or tested here yet.
- **Lane continuity across pages** — history loads via cursor pagination (+ window virtualization for long histories). Keeping lanes aligned across page boundaries / as rows are windowed is the real risk.
  Recommend a **spike**: prototype the lane layout + one paged/virtualized boundary against real run history before locking any effort estimate.

## The one real data delta

- The specced-but-unbuilt `@archon/git` `log` helper must return **parent OIDs** (`git log --format=%H %P`) so lanes/merges can be drawn. This is a wire-schema addition at design time, not a rework (architecture already lists `log` under "missing pieces").

## Minimal, precise spec updates (the omission is real but small)

1. **PRD** `prd.md` FR-6 (~:137-146) + §4.4: history is rendered as a **commit-topology graph** (branch/merge lanes, one row per commit), not an unspecified list; keep click-to-inspect + `parent→commit` diff direction. Mirror in `epics.md` FR6 summary (:25).
2. **architecture.md** Key decisions → Stack & libraries: commit graph **reuses already-installed `@xyflow/react`** (as WorkflowDagViewer does) — **no new dep**; note the `log` wire shape includes parent OIDs.
3. **epics.md** Epic 2 Story 2.1 AC (:194-206): "lists the run branch's commits" → **renders a lane graph** incl. commits not on base; add a merge/branch-rendering AC. Story 2.2 (inspect on click) unchanged.
4. **addendum.md** endpoint table (~:27-29) `log` row: add `%H %P` parents field (+ the CAP-8 snapshot manifest log entry, ~:59-61).

## Perf

Long histories: `@tanstack/react-virtual` (already installed + used in `StepLogs.tsx`) virtualizes fixed-height commit rows (~24px). Server `log` is specced with cursor/truncated pagination + fetch-on-click (NFR1), so paged fetching exists — BUT keeping the graph's lane continuity across those pages / windowed rows is the spike risk noted above, not a solved problem.
