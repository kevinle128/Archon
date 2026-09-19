# Scout: Node Transcript Tail-First Loading Pipeline

**Date:** 2026-09-20  
**Task:** Map transcript loading end-to-end for 6.3k-message running node (3 MB response, severe lag on legacy page `/legacy/workflows/runs/:runId`)

## Server Route & Schema

**Route Definition** — `packages/server/src/routes/api.ts:1389-1407`

- `GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages`
- Params: `runId`, `nodeId`
- Query Schema: `packages/server/src/routes/schemas/workflow.schemas.ts:207-214`
  - `afterSeq?: number` (forward cursor, for paging from N onwards)
  - `limit?: number` (1–500, default 100)
  - `occurrenceId?: string` (filter by loop occurrence)
  - `attemptId?: string` (filter by attempt within occurrence)
- Response Schema: `workflow.schemas.ts:216-224`
  - `messages: WorkflowNodeMessage[]`
  - `nextCursor?: string` (seq of last row, for next `afterSeq`)
  - `hasMore?: boolean` (true if truncated)
  - `highWatermark?: number` (MAX(seq) for running nodes)

**Handler Logic** — `api.ts:5600-5649`

- **No cursor params** → returns full list: `listNodeMessages(runId, nodeId)` (line 5613)
- **Any cursor param** (afterSeq/limit/occurrence/attempt) → enters cursor mode:
  - Fetches highWatermark (line 5619)
  - Queries with `afterSeq` forward paging (line 5623–5629)
  - Returns page + nextCursor (line 5635) + hasMore + highWatermark
  - Default limit: 100 (line 5618)

## Database Backing

**`listNodeMessages()`** — `packages/core/src/db/workflow-node-messages.ts:174-197`

- Query interface (line 134–140): `afterSeq?`, `throughSeq?`, `limit?`, `occurrenceId?`, `attemptId?`
- SQL:
  ```sql
  SELECT ... FROM remote_agent_workflow_node_messages
  WHERE workflow_run_id = $1 AND node_id = $2 [filters]
  ORDER BY seq ASC [LIMIT n]
  ```
- **Key constraint:** Always ascending (`seq ASC`), no descending support
- Filter builder (line 142–172): handles afterSeq (seq > afterSeq), throughSeq (seq <= throughSeq), occurrence/attempt JSON metadata extraction (dialect-aware Postgres/SQLite)

**`getNodeMessageHighWatermark()`** — `workflow-node-messages.ts:199-212`

- Returns `COALESCE(MAX(seq), 0)` for the node (scoped by occurrence/attempt if filtered)

## Client API & Paging

**API Wrapper** — `packages/web/src/lib/api.ts:705-731`

```typescript
getWorkflowNodeMessages(
  runId, nodeId,
  { afterSeq?, limit?, occurrenceId?, attemptId?, signal? }
): Promise<WorkflowNodeMessagesResponse>
```

- Builds URLSearchParams from options
- Calls `/api/workflows/runs/{runId}/nodes/{nodeId}/messages?...`
- **Supports:** forward paging via `afterSeq` only; no `beforeSeq`

**Paging Helper** — `packages/web/src/lib/node-message-pages.ts`

- **`NodeMessageState`** (line 10–18): `{ rows, afterSeq, highWatermark, complete, loading, error }`
- **`NodeMessageLoader`** typedef (line 20–30): function expecting `(runId, nodeId, { afterSeq, limit, occurrenceId?, attemptId?, signal? })`
- **`drainNodeMessages()`** (line 216–263): **Core eager-load loop**
  - Line 238–260: while loop; exits when `state.complete` is true
  - Calls loader with `afterSeq: state.afterSeq` and `limit: 100` (line 201–203)
  - Merges pages: `mergeRows()` dedupes by seq (line 114–123)
  - Resolves next cursor: `resolveAfterSeq()` picks max seq from page or nextCursor (line 80–94)
  - Completion logic (line 154–156): complete when `afterSeq >= highWatermark`
  - **No backwards paging, no tail-first mode**

## Legacy UI Components

**NodeTranscriptPane** — `packages/web/src/components/workflows/NodeTranscriptPane.tsx`

- **Props** (line 78–97): `loadMessages: NodeMessageLoader`, `runStatus`, `initialScrollTop?`, `onScrollTopChange?`
- **Effect** (line 170–231): Calls `drainNodeMessages()` on mount; re-runs on scope/retry change; polls every 1000 ms while running (line 200–202) via `beginNodeMessageRefresh()`
  - Line 187–197: single `drainNodeMessages()` call with callbacks updating `pageState`
  - Line 194–196: `onState` callback invoked incrementally as pages load
- **Scroll** (line 233–243): Auto-follow to bottom if `follow.pinToBottom`; restore `follow.scrollTop` if set
- **Render** (line 433–467): Plain `<div overflow-y-auto>` with `onScroll` handler; **no virtualization (react-virtual/react-window)**
  - Line 442–465: Renders `<NodeRoom>` component with `items` (built from `pageState.rows`)
  - Line 496–500: "Jump to latest" button when not following and running/awaiting
- **Occurrence navigation** (line 469–493): `<select>` dropdown to jump to loop iteration

**Scroll Follow** — `packages/web/src/lib/room-scroll-follow.ts:27–56`

- `createScrollFollow(status, savedScrollTop?)` → `{ pinToBottom, follow, scrollTop }`
- `jumpToLatest(state)` → sets `pinToBottom: true`
- `onRoomScroll(el, state)` → detects manual scroll up, sets `follow: false`

**Error Affordance** — `packages/web/src/components/workflows/RoomIncompleteNotice.tsx:3–13`

- Renders error message + "Retry" button
- Used by NodeRoom (line 987, 1026) and LegacyGraphLogsPane when paging fails

**LegacyNodeRoom** — `packages/web/src/components/workflows/LegacyNodeRoom.tsx:176`

- Passes `loadMessages: getWorkflowNodeMessages` to NodeTranscriptPane

## New Console UI (No New Implementation)

**ConsoleNodeRoom** — `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:548`

- Also calls `drainNodeMessages()` with same eager-load pattern

**ConsoleExecutionHistory** — `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:173`

- Also uses `drainNodeMessages()` — no tail-first variant

## Tests

**Server Messages Route** — `packages/server/src/routes/api.workflow-runs.test.ts:2921–3290`

- No-query mode: returns `{ messages }` only, no paging keys (line 3141–3167)
- Cursor mode: tests `?limit=1&afterSeq=0` → returns `{ messages, nextCursor, hasMore, highWatermark }` (line 3223–3290)
- Filters: occurrence/attempt metadata extraction tested (line 3282–3289)
- Tool output truncation in cursor mode (line 3169–3221)

**Client Paging** — `packages/web/src/lib/node-message-pages.test.ts`

- State reduction, merging, cursor tracking
- Completion logic for compat + paged modes

**Component** — `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`

- Lifecycle, retry, scroll follow state

## Gaps for Tail-First Loading

| Layer      | Gap                                                          | Impact                                   |
| ---------- | ------------------------------------------------------------ | ---------------------------------------- |
| **Server** | No `beforeSeq` param; no `ORDER BY seq DESC`                 | Cannot load last N messages first        |
| **Server** | Must add descending query + reverse results before returning | Required for tail-first response shape   |
| **Client** | `drainNodeMessages` starts from seq 0; no backwards cursor   | Cannot load older on scroll-up trigger   |
| **Client** | No "load older" scroll detection or handler                  | No way to fetch prior pages              |
| **UI**     | No virtualization (react-virtual)                            | 6k DOM nodes = lag even after server fix |

## Existing Reusable Code

- **RoomIncompleteNotice** (error + retry button) → can extend to "load older" affordance
- **Cursor paging pattern** in `node-message-pages.ts` → can invert for backwards paging
- **ScrollFollowState** → track follow/non-follow for scroll-up detection
- **Polling loop** in NodeTranscriptPane (line 200–202) → can adapt for incremental fetches

---

**Confidence:** 95% (all paths scouted; no tail-first implementation found in either legacy or new console UI)
