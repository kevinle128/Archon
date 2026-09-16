# Node Transcript From Logs (Legacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator open an unmerged node-run row in the legacy Logs tab and inspect that agent node's durable chronological text, tool-call, and lifecycle-status transcript during a live run or after completion.

**Architecture:** The workflow executor appends immutable, per-node transcript rows through a new narrow IWorkflowStore capability, and the core adapter persists them in one additive SQLite/PostgreSQL table with a store-assigned sequence.
The server exposes the table through one nested GET route and adds the approved empty pending-interactions embed to GET run, while the legacy Logs tab renders a node-run list and one reusable node room without changing the Graph tab.
The server-projected nodeStates remain the sole lifecycle source; existing workflow events may describe loop and route-loop executions in the Logs list but may not reconstruct current node lifecycle.

**Tech Stack:** Bun, strict TypeScript, Zod from @hono/zod-openapi, SQLite/PostgreSQL, OpenAPIHono, React 19, TanStack Query, react-dom/server, and bun:test.

**Spec:** _bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md, Story 5.1.

**Approved design inputs:** _bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md, _bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md, _bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md, _bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md, _bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/README.md, and _bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md.

**Issue:** https://github.com/anhle128/Archon/issues/81

## Global Constraints

- Story 5.1 is inspect-only.
- Do not add an Ask card, an empty Ask slot, awaiting or waiting-on-you chrome, an awaiting node status, node_awaiting or interaction_resolved events, or remote_agent_pending_interactions.
- Do not change workflow YAML, NativeTool.handler, provider resume behavior, pauseWorkflowRun, CLI/chat/manage_run behavior, or the command-center surface.
- Do not add packages/web/src/lib/run-graph because the graph work belongs to Story 5.3.
- Keep the Graph tab and its existing merged WorkflowLogs panel unchanged.
- Keep remote_agent_messages as the merged chat path and do not add a node identifier to it.
- Store transcript status rows only as lifecycle notes, never as pending-interaction cards.
- Keep nodeMessageSchema and pendingInteractionSchema in packages/workflows/src/schemas and derive their TypeScript types with z.infer.
- Import Zod from @hono/zod-openapi and use an explicit key schema in every z.record call.
- Extend IWorkflowStore with only appendNodeMessage and listNodeMessages, matching the adopted AD-3 store-port list.
- The executor must await transcript appends in provider-chunk order but must fail open if an append fails.
- Never include text, tool input, tool output, or a complete payload in a transcript failure log.
- GET /api/workflows/runs/:runId/nodes/:nodeId/messages reads only remote_agent_workflow_node_messages and orders by seq ascending.
- GET /api/workflows/runs/:runId keeps using projectLatestEffectiveNodeStates through projectApiWorkflowNodeStates and always returns pending_interactions as an empty array in this story.
- The legacy UI must never fall back to buildDagNodeStatesFromEvents when nodeStates is missing.
- Event-derived loop and route-loop rows are execution-list metadata, not a second current-lifecycle projector.
- Schema changes are additive-only and must be mirrored in migrations/000_combined.sql and SqliteAdapter.createSchema.
- Put PostgreSQL column comments in the trailing Indexes and column comments section.
- Do not add a redundant standalone index because the unique constraint on workflow_run_id, node_id, and seq is the covering lookup/order index.
- Regenerate packages/core/src/db/bundled-schema.generated.ts from migrations/000_combined.sql.
- Generate packages/web/src/lib/api.generated.d.ts from the live OpenAPI document and never hand-edit it.
- Do not use any.
- Do not run bun test from the repository root.
- Run focused tests from their package directory and finish with bun run validate from the repository root.
- Keep each RED test in place, observe the expected failure, add only the minimal production behavior, observe GREEN, and refactor only while the tests remain green.

---

## Verified Repository Baseline

- packages/workflows/src/store.ts currently has IRunTreeStore and IWorkflowEnvOverlayStore as narrow capabilities inherited by IWorkflowStore.
- Typed IWorkflowStore test doubles exist in packages/workflows/src/dag-executor.test.ts, executor.test.ts, executor-preamble.test.ts, script-node-deps.test.ts, and subrun.test.ts.
- executeNodeInternal handles command and prompt nodes, while executeLoopNode owns loop-node provider turns and iteration lifecycle.
- Assistant chunks, tool chunks, and lifecycle events already have explicit ordered branches in packages/workflows/src/dag-executor.ts.
- createWorkflowEvent is deliberately fire-and-forget and non-throwing, so a transcript append cannot depend on the event write completing.
- projectApiWorkflowNodeStates in packages/server/src/routes/api.ts already calls projectLatestEffectiveNodeStates.
- WorkflowExecution currently falls back to buildDagNodeStatesFromEvents and enrichDagNodesWithRouteDecisions can synthesize a missing node and force it completed.
- WorkflowRunQueryData currently drops the raw nodeStates returned by getWorkflowRun.
- The current Logs tab reuses the merged WorkflowLogs panel and DagNodeProgress list.
- packages/web/src/lib/api.generated.d.ts is generated by the @archon/web generate:types script against a running server.
- migrations/000_combined.sql currently has 21 application tables, and the SQLite parity floor is 162 compared non-auth columns.
- _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml currently marks the Story 5.1 key as backlog.

## File Map

### Workflow engine contracts and recording

- Create packages/workflows/src/schemas/node-message.ts as the canonical discriminated transcript-row schema.
- Create packages/workflows/src/schemas/node-message.test.ts for kind/payload correlation and row validation.
- Create packages/workflows/src/schemas/pending-interaction.ts as the adopted pending-row shape used by the empty GET-run embed.
- Create packages/workflows/src/schemas/pending-interaction.test.ts for the exact adopted fields and enums.
- Modify packages/workflows/src/schemas/index.ts to re-export both schema modules.
- Modify packages/workflows/src/store.ts to add IWorkflowNodeMessageStore with appendNodeMessage and listNodeMessages.
- Create packages/workflows/src/node-transcript.ts for the awaited fail-open append boundary.
- Create packages/workflows/src/node-transcript.test.ts for success and redacted failure logging.
- Modify packages/workflows/src/dag-executor.ts to append command, prompt, and loop transcripts.
- Modify packages/workflows/src/dag-executor.test.ts to test real executor ordering and loop markers.
- Modify packages/workflows/src/executor.test.ts, executor-preamble.test.ts, script-node-deps.test.ts, and subrun.test.ts so concrete stores satisfy the new narrow capability.
- Modify packages/workflows/package.json to put the two schema tests in the schema shard and node-transcript.test.ts in its own mock-isolated shard.

### Persistence

- Modify migrations/000_combined.sql to add application table 22 and its trailing column comments.
- Modify packages/core/src/db/adapters/sqlite.ts to mirror the table in createSchema.
- Modify packages/core/src/db/adapters/sqlite.test.ts to raise the parity floor to 169 and assert the fresh schema.
- Modify packages/core/src/db/bundled-schema.generated.ts only through bun run generate:bundled-schema.
- Modify AGENTS.md to document 22 application tables and Better Auth tables 23 through 26.
- Create packages/core/src/schemas/workflow-node-message.ts as the core row-schema alias.
- Modify packages/core/src/schemas/index.ts to export that row schema.
- Create packages/core/src/db/workflow-node-messages.ts for append, ordered list, corruption handling, and one conflict retry.
- Create packages/core/src/db/workflow-node-messages.test.ts as a real in-memory SQLite test shard.
- Modify packages/core/src/db/index.ts to add namespaced and direct exports.
- Modify packages/core/src/workflows/store-adapter.ts to implement the two engine ports.
- Modify packages/core/src/workflows/store-adapter.test.ts to verify the adapter boundary.
- Modify packages/core/package.json to run workflow-node-messages.test.ts in its own mock-isolated invocation.

### HTTP and generated client

- Modify packages/server/src/routes/schemas/workflow.schemas.ts to add pending_interactions and the transcript response schemas.
- Modify packages/server/src/routes/api.ts to register the nested GET and return the empty embed.
- Modify packages/server/src/routes/api.workflow-runs.test.ts to mock the new DB module and cover response behavior and OpenAPI.
- Regenerate packages/web/src/lib/api.generated.d.ts from a live server.
- Modify packages/web/src/lib/api.ts to export generated aliases and getWorkflowNodeMessages.
- Create packages/web/src/lib/get-workflow-node-messages.test.ts to verify URL encoding and response forwarding.

### Legacy Logs UI

- Create packages/web/src/components/workflows/build-log-rows.ts for chronological node-run row identities.
- Create packages/web/src/components/workflows/build-log-rows.test.ts for normal, loop-iteration, and route-loop rows.
- Create packages/web/src/components/workflows/NodeRunList.tsx for the accessible clickable left list.
- Create packages/web/src/components/workflows/NodeRunList.test.tsx for row labels, status, and button markup.
- Create packages/web/src/components/workflows/NodeRoom.tsx for transcript slicing and kind-based rendering.
- Create packages/web/src/components/workflows/NodeRoom.test.tsx for all room states, kinds, and iteration scoping.
- Create packages/web/src/components/workflows/NodeTranscriptPane.tsx for the selected-row query and live polling boundary.
- Create packages/web/src/components/workflows/NodeTranscriptPane.test.tsx for mounted selection, fetch, error, retry, and polling-policy behavior.
- Create packages/web/src/components/workflows/LegacyNodeLogs.tsx for the tested Logs-only list/room composition and selection ownership.
- Create packages/web/src/components/workflows/LegacyNodeLogs.test.tsx for mounted list-to-room wiring and selection reset behavior.
- Modify packages/web/src/components/workflows/WorkflowExecution.tsx to render the Logs-only composition without touching the Graph branch.
- Modify packages/web/src/components/workflows/WorkflowExecution.test.tsx to remove client lifecycle reconstruction and preserve server status during route enrichment.

### Completion tracking

- Modify _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml only after all validation passes.

## Authoritative Contracts

### Transcript storage

The PostgreSQL table is:

~~~sql
CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('text', 'tool', 'status')),
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workflow_node_messages_run_node_seq
    UNIQUE (workflow_run_id, node_id, seq)
);
~~~

SQLite uses TEXT for ids, payload, and timestamps, keeps the same checks and named unique constraint, and uses ON DELETE CASCADE.
The store supplies a dialect-generated id and JSON.stringify(payload) on both dialects.
The node_id is the executor stepName, including the loop-group prefix when present.
The store calculates MAX(seq) plus one within a transaction.
If that transaction loses a unique race, the store starts one new transaction and retries exactly once.
Never retry inside the PostgreSQL transaction that saw SQLSTATE 23505 because that transaction is aborted.
PostgreSQL conflict classification requires code 23505 and constraint uq_workflow_node_messages_run_node_seq.
SQLite conflict classification requires all three fully qualified unique columns on remote_agent_workflow_node_messages.

### Engine schemas and ports

nodeMessageSchema is a discriminated union so kind and payload cannot drift.

~~~ts
export type NodeMessage =
  | {
      id: string;
      workflow_run_id: string;
      node_id: string;
      seq: number;
      kind: 'text';
      payload: { text: string };
      created_at: Date | string;
    }
  | {
      id: string;
      workflow_run_id: string;
      node_id: string;
      seq: number;
      kind: 'tool';
      payload: { name: string; id: string; input?: unknown; output?: unknown };
      created_at: Date | string;
    }
  | {
      id: string;
      workflow_run_id: string;
      node_id: string;
      seq: number;
      kind: 'status';
      payload: { state: string; detail?: string };
      created_at: Date | string;
    };

export interface IWorkflowNodeMessageStore {
  appendNodeMessage(input: AppendNodeMessageInput): Promise<NodeMessage>;
  listNodeMessages(workflowRunId: string, nodeId: string): Promise<NodeMessage[]>;
}
~~~

AppendNodeMessageInput is inferred from appendNodeMessageSchema and has the same discriminated payloads without id, seq, or created_at.
Allowed status states written by this story are started, completed, failed, iteration_started, iteration_completed, and iteration_failed.
The status schema deliberately accepts any non-empty state string so future note kinds do not need a database migration.

pendingInteractionSchema has the adopted AD-1 fields even though Story 5.1 returns no rows:

~~~ts
{
  id: string;
  workflow_run_id: string;
  node_id: string;
  tool_use_id: string;
  kind: 'ask' | 'permission';
  status: 'pending' | 'answered' | 'purged';
  envelope: Record<string, unknown>;
  answer: Record<string, unknown> | null;
  provider_session_id: string;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
}
~~~

### Executor recording

Record only command and prompt nodes in executeNodeInternal and loop nodes in executeLoopNode.
Loop-group body command and prompt nodes record under their prefixed stepName because they enter executeNodeInternal.
Do not record bash, script, workflow, approval, plannotator_gate, route_loop, or loop_group container output in this story.
Append one non-empty text row as each assistant chunk arrives so transcript sequence stays correct relative to tool chunks even when the platform batches delivery.
For loop chunks, store stripCompletionTags output and skip a row when the cleaned text is empty.
Append one tool row when a tool chunk arrives, using the stable provider toolCallId or the executor's existing anonymous id and the untruncated tool input.
Do not add a second tool-result row and do not mutate the first row in Story 5.1.
Append started after scheduling the existing node_started event.
Append completed or failed at every corresponding agent-node terminal path after scheduling the existing lifecycle event.
For executeLoopNode, this includes both the normal completionDetected branch and the early finalizeLoopFromSignal return on an approved signal.
Append iteration markers immediately after scheduling the corresponding loop_iteration event.
Use detail equal to String(iteration) on every iteration marker so the room can select an exact range.
Use the actual node error string as detail on node-level failed status.
Do not duplicate assistant text at the final batch send.

### HTTP

GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages returns:

~~~ts
{
  messages: Array<{
    id: string;
    seq: number;
    kind: 'text' | 'tool' | 'status';
    payload:
      | { text: string }
      | { name: string; id: string; input?: unknown; output?: unknown }
      | { state: string; detail?: string };
    created_at: string;
  }>;
}
~~~

The route returns 404 before listing when the run does not exist.
The route returns 200 with an empty array when the run exists but the node has no transcript.
The route uses registerOpenApiRoute and has documented 200, 404, and 500 responses.
GET /api/workflows/runs/{runId} adds pending_interactions and returns an empty array without reading a pending table.
No new authorization rule is introduced because the existing API gate applies.

### Legacy Logs behavior

The Logs list contains one row for a normal server nodeState.
When a node has loop_iteration events, replace its single base row with one row per distinct iteration.
When a node has node_routed events, replace its single base row with one row per route execution_seq.
Sort every row by its matching event position, using the already ordered event array and the original nodeStates position as the final stable tie-breaker.
For the provisional single ordinary-node row, use that node's latest node_started event position so a re-executed node appears at its latest pass rather than at its first historical pass.
If the node has no node_started event, use its latest matching lifecycle event and then the stable nodeStates fallback.
Use server nodeStates for every normal row status.
Use the explicit iteration completion or failure event only for that iteration row's status.
Treat node_routed as the completed result of that route-loop execution without changing the current server node state.
Selecting a loop iteration slices messages from its matching iteration_started marker through its matching iteration_completed or iteration_failed marker.
If the start marker is not present, show the full node transcript rather than an empty or guessed slice.
The room is a labelled region with aria-label equal to the node id plus room.
Use exact empty copy Select a node and Node hasn't produced output.
The live transcript query polls every second while the run is pending or running and stops polling for completed, failed, or cancelled runs.
The Graph tab continues to show the existing merged WorkflowLogs panel.

## Open Questions With Binding Provisional Defaults

### Q1: How should an ordinary node re-executed by a route loop appear when nodeStates has only the latest state?

**Provisional default:** Story 5.1 shows one latest base row for an ordinary node, while loop iterations and route-loop controller executions receive the explicit rows required by the story.
Do not invent a pass id or reconstruct ordinary-node lifecycle from raw events.
A future exact per-pass room requires an adopted execution identity in the message/API contract.

### Q2: Should a completed tool mutate its tool-call row or append a second row?

**Provisional default:** Persist one immutable tool-call row with name, id, and optional input at invocation time.
Leave output absent in Story 5.1 because AD-3 adopts append/list only, an in-place update adds an unapproved port, and a second row would display as a second timeline item.

### Q3: What happens when PostgreSQL is unavailable locally?

**Provisional default:** Always run SQLite parity, migration-order, and bundled-schema checks.
Run bun run check:schema-upgrades when DATABASE_URL or PGHOST identifies a reachable PostgreSQL instance, and record the missing external prerequisite in validation evidence if neither is available.
CI remains the required PostgreSQL upgrade gate.

---

### Task 1: Add canonical schemas and the narrow workflow-store capability

**Files:**

- Create packages/workflows/src/schemas/node-message.ts.
- Create packages/workflows/src/schemas/node-message.test.ts.
- Create packages/workflows/src/schemas/pending-interaction.ts.
- Create packages/workflows/src/schemas/pending-interaction.test.ts.
- Modify packages/workflows/src/schemas/index.ts.
- Modify packages/workflows/src/store.ts.
- Modify packages/workflows/src/dag-executor.test.ts.
- Modify packages/workflows/src/executor.test.ts.
- Modify packages/workflows/src/executor-preamble.test.ts.
- Modify packages/workflows/src/script-node-deps.test.ts.
- Modify packages/workflows/src/subrun.test.ts.
- Modify packages/workflows/package.json.

**Interfaces:**

- Consumes the repository Zod convention and existing IWorkflowStore composition.
- Produces nodeMessageSchema, appendNodeMessageSchema, pendingInteractionSchema, their z.infer types, and IWorkflowNodeMessageStore.

- [ ] **Step 1: Write the failing transcript-schema tests.**

Add tests with literal expected values:

~~~ts
import { describe, expect, test } from 'bun:test';
import { appendNodeMessageSchema, nodeMessageSchema } from './node-message';

describe('nodeMessageSchema', () => {
  test('keeps kind and payload correlated', () => {
    const valid = nodeMessageSchema.parse({
      id: 'message-1',
      workflow_run_id: 'run-1',
      node_id: 'review',
      seq: 1,
      kind: 'tool',
      payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
      created_at: '2026-09-06T00:00:00.000Z',
    });
    expect(valid.kind).toBe('tool');
    expect(
      nodeMessageSchema.safeParse({
        ...valid,
        kind: 'text',
        payload: { state: 'started' },
      }).success
    ).toBe(false);
  });

  test('rejects invalid row identity and accepts a future status note', () => {
    expect(
      appendNodeMessageSchema.parse({
        workflow_run_id: 'run-1',
        node_id: 'review',
        kind: 'status',
        payload: { state: 'future_note', detail: 'kept extensible' },
      })
    ).toEqual({
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'status',
      payload: { state: 'future_note', detail: 'kept extensible' },
    });
    expect(
      nodeMessageSchema.safeParse({
        id: 'message-1',
        workflow_run_id: 'run-1',
        node_id: '',
        seq: 0,
        kind: 'text',
        payload: { text: 'hello' },
        created_at: new Date(),
      }).success
    ).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run the transcript-schema test and verify RED.**

~~~bash
( cd packages/workflows && bun test src/schemas/node-message.test.ts )
~~~

Expected: FAIL because ./node-message does not exist.

- [ ] **Step 3: Implement node-message.ts as strict discriminated unions.**

Implement the canonical file with these strict variants and inferred types:

~~~ts
import { z } from '@hono/zod-openapi';

const identityShape = {
  workflow_run_id: z.string().min(1),
  node_id: z.string().min(1),
};

export const nodeMessageTextPayloadSchema = z.object({ text: z.string().min(1) }).strict();
export const nodeMessageToolPayloadSchema = z
  .object({
    name: z.string().min(1),
    id: z.string().min(1),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  })
  .strict();
export const nodeMessageStatusPayloadSchema = z
  .object({ state: z.string().min(1), detail: z.string().optional() })
  .strict();

export const nodeMessageTextInputSchema = z
  .object({ ...identityShape, kind: z.literal('text'), payload: nodeMessageTextPayloadSchema })
  .strict();
export const nodeMessageToolInputSchema = z
  .object({ ...identityShape, kind: z.literal('tool'), payload: nodeMessageToolPayloadSchema })
  .strict();
export const nodeMessageStatusInputSchema = z
  .object({ ...identityShape, kind: z.literal('status'), payload: nodeMessageStatusPayloadSchema })
  .strict();

export const appendNodeMessageSchema = z.discriminatedUnion('kind', [
  nodeMessageTextInputSchema,
  nodeMessageToolInputSchema,
  nodeMessageStatusInputSchema,
]);

const rowShape = {
  id: z.string().min(1),
  seq: z.number().int().positive(),
  created_at: z.union([z.date(), z.string()]),
};

export const nodeMessageTextSchema = nodeMessageTextInputSchema.safeExtend(rowShape);
export const nodeMessageToolSchema = nodeMessageToolInputSchema.safeExtend(rowShape);
export const nodeMessageStatusSchema = nodeMessageStatusInputSchema.safeExtend(rowShape);
export const nodeMessageSchema = z.discriminatedUnion('kind', [
  nodeMessageTextSchema,
  nodeMessageToolSchema,
  nodeMessageStatusSchema,
]);

export type NodeMessageTextPayload = z.infer<typeof nodeMessageTextPayloadSchema>;
export type NodeMessageToolPayload = z.infer<typeof nodeMessageToolPayloadSchema>;
export type NodeMessageStatusPayload = z.infer<typeof nodeMessageStatusPayloadSchema>;
export type AppendNodeMessageInput = z.infer<typeof appendNodeMessageSchema>;
export type NodeMessage = z.infer<typeof nodeMessageSchema>;
~~~

- [ ] **Step 4: Re-run the transcript-schema test and verify GREEN.**

~~~bash
( cd packages/workflows && bun test src/schemas/node-message.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Write the failing pending-interaction schema tests.**

~~~ts
import { describe, expect, test } from 'bun:test';
import { pendingInteractionSchema } from './pending-interaction';

const valid = {
  id: 'pending-1',
  workflow_run_id: 'run-1',
  node_id: 'review',
  tool_use_id: 'tool-1',
  kind: 'ask',
  status: 'pending',
  envelope: { questions: [] },
  answer: null,
  provider_session_id: 'session-1',
  created_at: '2026-09-06T00:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
};

describe('pendingInteractionSchema', () => {
  test('accepts the adopted empty-embed row contract', () => {
    expect(pendingInteractionSchema.parse(valid)).toEqual(valid);
  });

  test('rejects forked kind and status values', () => {
    expect(pendingInteractionSchema.safeParse({ ...valid, kind: 'question' }).success).toBe(false);
    expect(pendingInteractionSchema.safeParse({ ...valid, status: 'open' }).success).toBe(false);
  });
});
~~~

- [ ] **Step 6: Run the pending schema test and verify RED.**

~~~bash
( cd packages/workflows && bun test src/schemas/pending-interaction.test.ts )
~~~

Expected: FAIL because ./pending-interaction does not exist.

- [ ] **Step 7: Implement pending-interaction.ts with the exact adopted fields.**

Implement the exact adopted object and derive its type:

~~~ts
import { z } from '@hono/zod-openapi';

const pendingJsonObjectSchema = z.record(z.string(), z.unknown());

export const pendingInteractionSchema = z
  .object({
    id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    kind: z.enum(['ask', 'permission']),
    status: z.enum(['pending', 'answered', 'purged']),
    envelope: pendingJsonObjectSchema,
    answer: pendingJsonObjectSchema.nullable(),
    provider_session_id: z.string().min(1),
    created_at: z.union([z.date(), z.string()]),
    resolved_at: z.union([z.date(), z.string()]).nullable(),
    resolved_by: z.string().min(1).nullable(),
  })
  .strict();

export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;
~~~

- [ ] **Step 8: Re-run the pending schema test and verify GREEN.**

~~~bash
( cd packages/workflows && bun test src/schemas/pending-interaction.test.ts )
~~~

Expected: PASS.

- [ ] **Step 9: Export the schemas and add the store capability.**

In schemas/index.ts, add value and type exports for both modules:

~~~ts
export * from './node-message';
export * from './pending-interaction';
~~~

In store.ts, import AppendNodeMessageInput and NodeMessage as types from ./schemas/node-message.
Add this narrow capability and composition:

~~~ts
export interface IWorkflowNodeMessageStore {
  appendNodeMessage(input: AppendNodeMessageInput): Promise<NodeMessage>;
  listNodeMessages(workflowRunId: string, nodeId: string): Promise<NodeMessage[]>;
}

export interface IWorkflowStore
  extends IRunTreeStore, IWorkflowEnvOverlayStore, IWorkflowNodeMessageStore {
  // Keep every existing member unchanged.
}
~~~

- [ ] **Step 10: Run the workflow package type-check and observe the expected store-double failures.**

~~~bash
( cd packages/workflows && bun x tsc --noEmit )
~~~

Expected: FAIL only where concrete IWorkflowStore objects lack appendNodeMessage or listNodeMessages.

- [ ] **Step 11: Update every concrete typed store double.**

For object factories, add this typed default with a per-factory counter and add listNodeMessages that returns an empty array:

~~~ts
let nodeMessageSeq = 0;
appendNodeMessage: async input => ({
  ...input,
  id: `node-message-${String(++nodeMessageSeq)}`,
  seq: nodeMessageSeq,
  created_at: new Date(),
}),
listNodeMessages: async () => [],
~~~

For subrun.test.ts InMemoryStore, keep an in-memory NodeMessage array, assign the next sequence within the matching run/node pair, and filter plus sort in listNodeMessages.
Do not change plannotator tests that intentionally cast through unknown.

- [ ] **Step 12: Add the tests to mock-safe package shards and verify GREEN.**

Add both schema tests to the existing schema invocation in packages/workflows/package.json.
Do not add node-transcript.test.ts until Task 4.

~~~bash
( cd packages/workflows && bun x tsc --noEmit )
( cd packages/workflows && bun test src/schemas/node-message.test.ts src/schemas/pending-interaction.test.ts )
( cd packages/workflows && bun test src/executor-preamble.test.ts src/script-node-deps.test.ts src/subrun.test.ts )
~~~

Expected: PASS with no warnings.

- [ ] **Step 13: Commit the contract slice.**

~~~bash
git add packages/workflows/src/schemas/node-message.ts packages/workflows/src/schemas/node-message.test.ts packages/workflows/src/schemas/pending-interaction.ts packages/workflows/src/schemas/pending-interaction.test.ts packages/workflows/src/schemas/index.ts packages/workflows/src/store.ts packages/workflows/src/dag-executor.test.ts packages/workflows/src/executor.test.ts packages/workflows/src/executor-preamble.test.ts packages/workflows/src/script-node-deps.test.ts packages/workflows/src/subrun.test.ts packages/workflows/package.json
git commit -m "feat(workflows): define node transcript contracts"
~~~

### Task 2: Add the transcript table to both database schemas

**Files:**

- Modify migrations/000_combined.sql.
- Modify packages/core/src/db/adapters/sqlite.ts.
- Modify packages/core/src/db/adapters/sqlite.test.ts.
- Generate packages/core/src/db/bundled-schema.generated.ts.
- Modify AGENTS.md.

**Interfaces:**

- Consumes the transcript storage contract.
- Produces table 22 with cascade deletion and one covering unique constraint on both dialects.

- [ ] **Step 1: Write the failing fresh-schema test.**

In packages/core/src/db/adapters/sqlite.test.ts, raise MIN_NON_AUTH_COLUMNS from 162 to 169.
Add a test beside the output_root parity test that reads pragma_table_info and sqlite_master.

~~~ts
test('workflow node messages table mirrors the Postgres contract', async () => {
  db = createTestDb();
  expect(raw_pragma(currentDbPath, 'remote_agent_workflow_node_messages').sort()).toEqual(
    ['created_at', 'id', 'kind', 'node_id', 'payload', 'seq', 'workflow_run_id'].sort()
  );
  const indexes = raw_indexes(currentDbPath);
  expect(indexes.some(name => name.includes('workflow_node_messages'))).toBe(true);
  expect(getSchemaSQL()).toContain('uq_workflow_node_messages_run_node_seq');
  expect(getSchemaSQL()).toContain('ON DELETE CASCADE');
});
~~~

- [ ] **Step 2: Run the SQLite schema test and verify RED.**

~~~bash
( cd packages/core && bun test src/db/adapters/sqlite.test.ts )
~~~

Expected: FAIL because the table is absent and the parity floor increased by seven columns.

- [ ] **Step 3: Add the PostgreSQL table and trailing comments.**

Change the migration inventory to 22 application tables.
Insert the exact CREATE TABLE from Authoritative Contracts after remote_agent_workflow_envs and before the trailing Indexes and column comments heading.
Add COMMENT ON TABLE beside the CREATE TABLE.
Add COMMENT ON COLUMN statements for workflow_run_id, node_id, seq, kind, and payload in the trailing section after the workflow-env comments.
Do not add CREATE INDEX because the named unique constraint already covers the route query.

- [ ] **Step 4: Mirror the table in SqliteAdapter.createSchema.**

Add this statement after remote_agent_workflow_envs inside createSchema:

~~~sql
CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'tool', 'status')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_workflow_node_messages_run_node_seq
    UNIQUE (workflow_run_id, node_id, seq)
);
~~~

Do not add this new table to migrateColumns.

- [ ] **Step 5: Regenerate the bundled schema.**

~~~bash
bun run generate:bundled-schema
~~~

Expected: packages/core/src/db/bundled-schema.generated.ts changes and reports the generated byte count.

- [ ] **Step 6: Verify the schema tests are GREEN.**

~~~bash
( cd packages/core && bun test src/db/adapters/sqlite.test.ts )
( cd packages/core && bun test src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts )
bun run check:bundled-schema
~~~

Expected: PASS.

- [ ] **Step 7: Update the repository table inventory.**

Change AGENTS.md to 22 application tables, add workflow_node_messages as item 22 with its unique sequence and cascade behavior, and renumber Better Auth to 23 through 26.

- [ ] **Step 8: Commit the schema slice.**

~~~bash
git add migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts packages/core/src/db/adapters/sqlite.test.ts packages/core/src/db/bundled-schema.generated.ts AGENTS.md
git commit -m "feat(db): add workflow node transcript table"
~~~

### Task 3: Implement core persistence and the workflow-store adapter

**Files:**

- Create packages/core/src/schemas/workflow-node-message.ts.
- Modify packages/core/src/schemas/index.ts.
- Create packages/core/src/db/workflow-node-messages.ts.
- Create packages/core/src/db/workflow-node-messages.test.ts.
- Modify packages/core/src/db/index.ts.
- Modify packages/core/src/workflows/store-adapter.ts.
- Modify packages/core/src/workflows/store-adapter.test.ts.
- Modify packages/core/package.json.

**Interfaces:**

- Consumes appendNodeMessageSchema, nodeMessageSchema, AppendNodeMessageInput, NodeMessage, getDatabase, and getDialect.
- Produces appendNodeMessage(input), listNodeMessages(workflowRunId, nodeId), isNodeMessageSequenceConflict(error), and WorkflowNodeMessageCorruptRowError.

- [ ] **Step 1: Write the failing real-SQLite persistence tests.**

Create one in-memory SqliteAdapter, register mock.module('./connection') with pool, getDatabase, getDialect, and getDatabaseType, and dynamically import the DB module only after those mocks are installed.
Mock @archon/paths before the dynamic import so createLogger captures error metadata in an array without stringifying input payloads.
Seed the required foreign-key parents before each test with this helper, using a unique conversation platform id when a test needs more than one run:

~~~ts
async function seedRun(runId = 'run-1', conversationId = 'conversation-1'): Promise<void> {
  await db.query(
    'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
    [conversationId, 'web', conversationId + '-platform']
  );
  await db.query(
    'INSERT INTO remote_agent_workflow_runs (id, workflow_name, conversation_id, user_message, status) VALUES ($1, $2, $3, $4, $5)',
    [runId, 'transcript-test', conversationId, 'inspect this run', 'running']
  );
}
~~~

Cover these literal behaviors in separate tests:

~~~ts
test('append assigns independent monotonic sequences and list returns seq order', async () => {
  const first = await appendNodeMessage({
    workflow_run_id: 'run-1',
    node_id: 'review',
    kind: 'text',
    payload: { text: 'first' },
  });
  const second = await appendNodeMessage({
    workflow_run_id: 'run-1',
    node_id: 'review',
    kind: 'status',
    payload: { state: 'completed' },
  });
  const otherNode = await appendNodeMessage({
    workflow_run_id: 'run-1',
    node_id: 'test',
    kind: 'text',
    payload: { text: 'other' },
  });
  expect([first.seq, second.seq, otherNode.seq]).toEqual([1, 2, 1]);
  expect((await listNodeMessages('run-1', 'review')).map(row => row.seq)).toEqual([1, 2]);
});

test('deleting a run cascade-deletes its transcript', async () => {
  await appendNodeMessage({
    workflow_run_id: 'run-1',
    node_id: 'review',
    kind: 'text',
    payload: { text: 'kept only with run' },
  });
  await db.query('DELETE FROM remote_agent_workflow_runs WHERE id = $1', ['run-1']);
  expect(await listNodeMessages('run-1', 'review')).toEqual([]);
});

test('corrupt payload fails closed without logging the payload body', async () => {
  await db.query(
    'INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload) VALUES ($1, $2, $3, $4, $5, $6)',
    ['bad-1', 'run-1', 'review', 1, 'text', '{"secret":"DO_NOT_LOG"}']
  );
  await expect(listNodeMessages('run-1', 'review')).rejects.toBeInstanceOf(
    WorkflowNodeMessageCorruptRowError
  );
  expect(JSON.stringify(errorLogs)).not.toContain('DO_NOT_LOG');
  expect(JSON.stringify(errorLogs)).toContain('bad-1');
});
~~~

Also add one Promise.all test that two SQLite appends receive sequences 1 and 2.
Add classifier tests for exact PostgreSQL and SQLite sequence conflicts and negative cases for unrelated unique violations.

- [ ] **Step 2: Run the persistence test and verify RED.**

~~~bash
( cd packages/core && bun test src/db/workflow-node-messages.test.ts )
~~~

Expected: FAIL because ./workflow-node-messages does not exist.

- [ ] **Step 3: Add the core row schema.**

Use this complete core schema adapter:

~~~ts
import { z } from '@hono/zod-openapi';
import { nodeMessageSchema } from '@archon/workflows/schemas/node-message';

export const workflowNodeMessageRowSchema = nodeMessageSchema;
export type WorkflowNodeMessageRow = z.infer<typeof workflowNodeMessageRowSchema>;
~~~

Re-export it from packages/core/src/schemas/index.ts.
Do not create a forwarding-only schema test; the real database test exercises Date/string timestamps and payload parsing.

- [ ] **Step 4: Implement row normalization and corruption handling.**

Use a fixed column list of id, workflow_run_id, node_id, seq, kind, payload, and created_at.
If payload is a string, JSON.parse it.
Pass the normalized row through workflowNodeMessageRowSchema.safeParse.
On JSON or schema failure, log only messageId and a fixed reason such as payload_json_parse or row_schema, then throw WorkflowNodeMessageCorruptRowError whose message contains only the row id.
Use this shape for the fail-closed boundary:

~~~ts
export class WorkflowNodeMessageCorruptRowError extends Error {
  constructor(readonly messageId: string) {
    super(`Workflow node message row corrupt: ${messageId}`);
    this.name = 'WorkflowNodeMessageCorruptRowError';
  }
}

function throwCorrupt(messageId: string, reason: 'payload_json_parse' | 'row_schema'): never {
  getLog().error({ messageId, reason }, 'db.workflow_node_message_corrupt_row');
  throw new WorkflowNodeMessageCorruptRowError(messageId);
}

function parseNodeMessageRow(raw: unknown): NodeMessage {
  const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const messageId = typeof row.id === 'string' ? row.id : 'unknown';
  let payload = row.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      throwCorrupt(messageId, 'payload_json_parse');
    }
  }
  const parsed = workflowNodeMessageRowSchema.safeParse({ ...row, payload });
  if (!parsed.success) throwCorrupt(messageId, 'row_schema');
  return parsed.data;
}
~~~

- [ ] **Step 5: Implement one transaction attempt and one fresh retry.**

Classify only the adopted sequence constraint before using this control flow:

~~~ts
export function isNodeMessageSequenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const dbError = error as Error & { code?: string; constraint?: string };
  if (
    dbError.code === '23505' &&
    dbError.constraint === 'uq_workflow_node_messages_run_node_seq'
  ) {
    return true;
  }
  if (!/UNIQUE constraint failed/i.test(dbError.message)) return false;
  const columns = dbError.message
    .replace(/^[\s\S]*UNIQUE constraint failed:\s*/i, '')
    .split(',')
    .map(column => column.trim().toLowerCase());
  return [
    'remote_agent_workflow_node_messages.workflow_run_id',
    'remote_agent_workflow_node_messages.node_id',
    'remote_agent_workflow_node_messages.seq',
  ].every(column => columns.includes(column));
}
~~~

Use this transaction and fresh-retry control flow:

~~~ts
async function appendOnce(input: AppendNodeMessageInput): Promise<NodeMessage> {
  const db = getDatabase();
  const dialect = getDialect();
  return db.withTransaction(async query => {
    const next = await query<{ next_seq: number }>(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM remote_agent_workflow_node_messages WHERE workflow_run_id = $1 AND node_id = $2',
      [input.workflow_run_id, input.node_id]
    );
    const seq = Number(next.rows[0]?.next_seq ?? 1);
    const id = dialect.generateUuid();
    await query(
      'INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, input.workflow_run_id, input.node_id, seq, input.kind, JSON.stringify(input.payload)]
    );
    const inserted = await query<Record<string, unknown>>(
      'SELECT id, workflow_run_id, node_id, seq, kind, payload, created_at FROM remote_agent_workflow_node_messages WHERE id = $1',
      [id]
    );
    return parseNodeMessageRow(inserted.rows[0]);
  });
}

export async function appendNodeMessage(input: AppendNodeMessageInput): Promise<NodeMessage> {
  const parsed = appendNodeMessageSchema.parse(input);
  try {
    return await appendOnce(parsed);
  } catch (error) {
    if (!isNodeMessageSequenceConflict(error)) throw error;
    return appendOnce(parsed);
  }
}
~~~

Implement listNodeMessages with the fixed columns, both identity filters, and ORDER BY seq ASC.

- [ ] **Step 6: Add exports, a dedicated test shard, and verify GREEN.**

Add these exports in packages/core/src/db/index.ts:

~~~ts
export * as workflowNodeMessageDb from './workflow-node-messages';
export * from './workflow-node-messages';
~~~

Add bun test src/db/workflow-node-messages.test.ts as its own command in packages/core/package.json because its connection mock is process-global.

~~~bash
( cd packages/core && bun test src/db/workflow-node-messages.test.ts )
( cd packages/core && bun x tsc --noEmit )
~~~

Expected: PASS.

- [ ] **Step 7: Write the failing adapter tests.**

In store-adapter.test.ts, mock ../db/workflow-node-messages before importing store-adapter.
Add appendNodeMessage and listNodeMessages to requiredMethods.
Assert that each adapter method returns the DB result and forwards the exact arguments.

- [ ] **Step 8: Run the adapter test and verify RED.**

~~~bash
( cd packages/core && bun test src/workflows/store-adapter.test.ts )
~~~

Expected: FAIL because createWorkflowStore does not expose the new methods.

- [ ] **Step 9: Implement the two adapter pass-throughs and verify GREEN.**

Import the DB module as a namespace in store-adapter.ts and add both methods beside the workflow-node-session methods.

~~~ts
appendNodeMessage: input => workflowNodeMessageDb.appendNodeMessage(input),
listNodeMessages: (workflowRunId, nodeId) =>
  workflowNodeMessageDb.listNodeMessages(workflowRunId, nodeId),
~~~

~~~bash
( cd packages/core && bun test src/workflows/store-adapter.test.ts )
( cd packages/core && bun x tsc --noEmit )
~~~

Expected: PASS.

- [ ] **Step 10: Commit the persistence slice.**

~~~bash
git add packages/core/src/schemas/workflow-node-message.ts packages/core/src/schemas/index.ts packages/core/src/db/workflow-node-messages.ts packages/core/src/db/workflow-node-messages.test.ts packages/core/src/db/index.ts packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts packages/core/package.json
git commit -m "feat(core): persist workflow node transcripts"
~~~

### Task 4: Add the awaited fail-open transcript boundary

**Files:**

- Create packages/workflows/src/node-transcript.ts.
- Create packages/workflows/src/node-transcript.test.ts.
- Modify packages/workflows/package.json.

**Interfaces:**

- Consumes IWorkflowNodeMessageStore and AppendNodeMessageInput.
- Produces appendNodeTranscript(store, input): Promise<void>.

- [ ] **Step 1: Write failing success and failure-boundary tests.**

Use a collecting fake store for success and a rejecting fake store for failure.
Mock @archon/paths before dynamically importing node-transcript.ts so the test can inspect the logged metadata.

~~~ts
test('awaits and forwards one append', async () => {
  const received: AppendNodeMessageInput[] = [];
  await appendNodeTranscript(
    {
      appendNodeMessage: async input => {
        received.push(input);
        return { ...input, id: 'message-1', seq: 1, created_at: new Date() };
      },
      listNodeMessages: async () => [],
    },
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'hello' },
    }
  );
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'hello' },
    },
  ]);
});

test('fails open and excludes the payload from logs', async () => {
  rejectingStore.appendNodeMessage = async () => {
    throw new Error('DO_NOT_LOG');
  };
  await expect(
    appendNodeTranscript(rejectingStore, {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'tool',
      payload: { name: 'Read', id: 'tool-1', input: { secret: 'DO_NOT_LOG' } },
    })
  ).resolves.toBeUndefined();
  expect(JSON.stringify(errorCalls)).not.toContain('DO_NOT_LOG');
});
~~~

- [ ] **Step 2: Run the helper test and verify RED.**

~~~bash
( cd packages/workflows && bun test src/node-transcript.test.ts )
~~~

Expected: FAIL because ./node-transcript does not exist.

- [ ] **Step 3: Implement the minimal helper.**

Implement the awaited fail-open boundary exactly once:

~~~ts
import { createLogger } from '@archon/paths';
import type { AppendNodeMessageInput } from './schemas/node-message';
import type { IWorkflowNodeMessageStore } from './store';

const log = createLogger('workflows.node-transcript');

export async function appendNodeTranscript(
  store: IWorkflowNodeMessageStore,
  input: AppendNodeMessageInput
): Promise<void> {
  try {
    await store.appendNodeMessage(input);
  } catch (error) {
    log.error(
      {
        workflowRunId: input.workflow_run_id,
        nodeId: input.node_id,
        kind: input.kind,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      'workflow.node_message_append_failed'
    );
  }
}
~~~

Do not add the error object, its message, or input.payload to this log.

- [ ] **Step 4: Add an isolated test shard and verify GREEN.**

Add a separate bun test src/node-transcript.test.ts command in packages/workflows/package.json so its @archon/paths mock cannot pollute other shards.

~~~bash
( cd packages/workflows && bun test src/node-transcript.test.ts )
( cd packages/workflows && bun x tsc --noEmit )
~~~

Expected: PASS.

- [ ] **Step 5: Commit the helper slice.**

~~~bash
git add packages/workflows/src/node-transcript.ts packages/workflows/src/node-transcript.test.ts packages/workflows/package.json
git commit -m "feat(workflows): add fail-open transcript writer"
~~~

### Task 5: Record command, prompt, and loop transcripts

**Files:**

- Modify packages/workflows/src/dag-executor.ts.
- Modify packages/workflows/src/dag-executor.test.ts.

**Interfaces:**

- Consumes appendNodeTranscript and the existing provider MessageChunk order.
- Produces durable text, tool-call, node-status, and loop-iteration rows keyed by executor stepName.

- [ ] **Step 1: Add a failing command-node ordering test.**

Extend createMockStore so appendNodeMessage assigns increasing sequence values and retains inputs for assertions.
Use table-driven streaming command-node and prompt-node cases whose provider yields assistant first, a tool with toolCallId tool-1, another assistant chunk, and result.
For each node kind, assert the stored kind/state sequence is exactly started, text, tool, text, completed.
For each node kind, assert the tool payload is exactly { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } }.
For each node kind, assert every row uses the workflow run id and its command or prompt stepName.

- [ ] **Step 2: Add a failing batch-order regression test.**

Use batch mode with assistant text before a tool.
Assert the transcript text row precedes the tool row even though platform delivery flushes text later.
This test would fail if implementation records only final batch sends.

- [ ] **Step 3: Run the focused executor tests and verify RED for command recording.**

~~~bash
( cd packages/workflows && bun test src/dag-executor.test.ts )
~~~

Expected: FAIL because command nodes do not yet append transcript rows.

- [ ] **Step 4: Record executeNodeInternal start, chunks, tools, and successful completion.**

Import appendNodeTranscript.
Add a local status helper after stepName is available:

~~~ts
const recordNodeStatus = async (state: string, detail?: string): Promise<void> => {
  await appendNodeTranscript(deps.store, {
    workflow_run_id: workflowRun.id,
    node_id: stepName,
    kind: 'status',
    payload: { state, ...(detail !== undefined ? { detail } : {}) },
  });
};
~~~

After scheduling node_started and before provider work, append status { state: 'started' } with workflowRun.id and stepName.
At the start of every non-empty assistant branch, append { kind: 'text', payload: { text: msg.content } } before platform batching logic.
Do not append again when batchMessages flush.
After the existing stable or anonymous toolCallId is chosen, append one tool row with name, id, and msg.toolInput only when it is defined.
Do not record tool_result in this story.
Append state completed after scheduling node_completed and before returning the successful result.
Use these append shapes in the existing assistant and tool branches:

~~~ts
await appendNodeTranscript(deps.store, {
  workflow_run_id: workflowRun.id,
  node_id: stepName,
  kind: 'text',
  payload: { text: msg.content },
});

await appendNodeTranscript(deps.store, {
  workflow_run_id: workflowRun.id,
  node_id: stepName,
  kind: 'tool',
  payload: {
    name: msg.toolName,
    id: toolCallId,
    ...(msg.toolInput !== undefined ? { input: msg.toolInput } : {}),
  },
});
~~~

- [ ] **Step 5: Re-run the command recording tests and verify GREEN.**

~~~bash
( cd packages/workflows && bun test src/dag-executor.test.ts )
~~~

Expected: PASS for the command ordering and batch-order tests.

- [ ] **Step 6: Add failing terminal-status tests.**

Use the existing command-load failure fixture and assert started then failed with the exact command-load error in detail.
Use a prompt containing an invalid $node.output.field reference and assert started then failed with the exact OutputRefError message in detail.
Use a provider lookup that throws and assert started then failed with the provider error in detail.
Use a normal completion fixture and assert exactly one completed status.
Use a store whose append rejects and assert the workflow still completes, relying on Task 4 for log-redaction details.

- [ ] **Step 7: Run the focused executor tests and verify RED for terminal failures.**

~~~bash
( cd packages/workflows && bun test src/dag-executor.test.ts )
~~~

Expected: FAIL because command failure paths do not yet append failed status rows.

- [ ] **Step 8: Record every executeNodeInternal failure terminal.**

Add a small local recordFailedStatus(error) closure that calls appendNodeTranscript with state failed and detail error.
Invoke it after scheduling node_failed in the command-load failure, prompt substitution failure, cancellation, credit exhaustion, empty-output, and catch paths.
Also invoke it in the abort-driven cancellation return inside catch even though that path currently returns before scheduling a second node_failed event.
Move substituteNodeOutputRefs into the existing buildPromptWithContext try block so an OutputRefError follows the existing prompt-substitution node_failed path and receives the same failed transcript terminal instead of escaping to the outer runLayers catch.
Wrap deps.getAgentProvider in a local failure branch that schedules the same node_failed event/emitter pair, records the provider error as the failed transcript detail, and returns a failed NodeExecutionResult instead of escaping to the outer runLayers catch.
Keep the existing event/emitter ordering otherwise unchanged.
The failure helper is only this specialization of recordNodeStatus:

~~~ts
const recordFailedStatus = (error: string): Promise<void> => recordNodeStatus('failed', error);
~~~

- [ ] **Step 9: Re-run the terminal-status tests and verify GREEN.**

~~~bash
( cd packages/workflows && bun test src/dag-executor.test.ts )
~~~

Expected: PASS with one completed terminal on success, one failed terminal on each covered failure, and fail-open persistence.

- [ ] **Step 10: Add failing loop transcript tests.**

Use a two-iteration loop fixture.
Assert started appears once per executeLoopNode invocation.
Assert each iteration has iteration_started and iteration_completed with detail equal to its decimal iteration string.
Assert cleaned assistant text lies between the matching start and terminal markers.
Add an iteration-error fixture and assert iteration_failed precedes node-level failed.
Use the existing finalize-on-approve fixture and assert the resumed invocation records started then completed without a new iteration marker.

- [ ] **Step 11: Run the focused executor tests and verify RED for loop recording.**

~~~bash
( cd packages/workflows && bun test src/dag-executor.test.ts )
~~~

Expected: FAIL because executeLoopNode does not yet append transcript rows.

- [ ] **Step 12: Record executeLoopNode node-level lifecycle.**

Append started after scheduling loop node_started.
Make failLoopNode append state failed with its error after scheduling node_failed and before returning.
Use a loop-local helper keyed by stepName so loop-group prefixes are retained:

~~~ts
const recordLoopStatus = (state: string, detail?: string): Promise<void> =>
  appendNodeTranscript(deps.store, {
    workflow_run_id: workflowRun.id,
    node_id: stepName,
    kind: 'status',
    payload: { state, ...(detail !== undefined ? { detail } : {}) },
  });
~~~

- [ ] **Step 13: Record executeLoopNode iteration markers and chunks.**

Append iteration_started with detail String(i) after scheduling loop_iteration_started.
Append cleaned non-empty assistant text as each loop assistant chunk arrives.
Append tool calls at the same point and with the same id/input rule as executeNodeInternal.
Append iteration_completed with detail String(i) after scheduling loop_iteration_completed.
At both existing loop_iteration_failed event sites, append iteration_failed with detail String(i) before calling failLoopNode.
Append node-level completed in the completionDetected branch immediately after scheduling its node_completed event.
Append node-level completed after finalizeLoopFromSignal returns and before its early successful return.
Max-iteration exhaustion continues through failLoopNode and therefore records failed, not completed.
Do not append completed when an interactive loop returns to an existing declared approval gate without a node_completed event.
Use recordLoopStatus for all marker rows, and use these chunk shapes:

~~~ts
if (cleaned !== '') {
  await appendNodeTranscript(deps.store, {
    workflow_run_id: workflowRun.id,
    node_id: stepName,
    kind: 'text',
    payload: { text: cleaned },
  });
}

await appendNodeTranscript(deps.store, {
  workflow_run_id: workflowRun.id,
  node_id: stepName,
  kind: 'tool',
  payload: {
    name: msg.toolName,
    id: toolCallId,
    ...(msg.toolInput !== undefined ? { input: msg.toolInput } : {}),
  },
});
~~~

- [ ] **Step 14: Re-run executor tests and verify GREEN.**

~~~bash
( cd packages/workflows && bun test src/dag-executor.test.ts )
( cd packages/workflows && bun x tsc --noEmit )
~~~

Expected: PASS with exact transcript ordering and no duplicate batch text.

- [ ] **Step 15: Refactor only duplicated append argument construction and re-run GREEN.**

Keep the fail-open boundary in node-transcript.ts.
Local closures may reduce repeated run/node fields, but do not create a generic event-plus-transcript transaction abstraction because event writes remain deliberately fire-and-forget.

~~~bash
( cd packages/workflows && bun test src/dag-executor.test.ts )
~~~

Expected: PASS.

- [ ] **Step 16: Commit executor recording.**

~~~bash
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts
git commit -m "feat(workflows): record agent node transcripts"
~~~

### Task 6: Expose transcript messages and the empty pending embed

**Files:**

- Modify packages/server/src/routes/schemas/workflow.schemas.ts.
- Modify packages/server/src/routes/api.ts.
- Modify packages/server/src/routes/api.workflow-runs.test.ts.

**Interfaces:**

- Consumes pendingInteractionSchema, the node-message variant schemas, workflowDb.getWorkflowRun, and workflowNodeMessageDb.listNodeMessages.
- Produces WorkflowNodeMessage, WorkflowNodeMessagesResponse, the nested GET route, and pending_interactions on WorkflowRunDetail.

- [ ] **Step 1: Mock only the new DB boundary in api.workflow-runs.test.ts.**

Define mockListNodeMessages and register mock.module('@archon/core/db/workflow-node-messages') before importing ./api.
Do not edit unrelated api.*.test.ts files because the new DB module has no import-time side effect that requires a suite-wide mock.

- [ ] **Step 2: Write failing route behavior tests.**

Add separate tests for:

- An absent run returns 404 and does not call mockListNodeMessages.
- An existing run with no rows returns { messages: [] }.
- An existing run returns literal text, tool, and status rows in the DB-provided sequence with workflow_run_id and node_id omitted.
- Date created_at becomes an ISO string while an existing string remains a string.
- A DB exception returns 500 without embedding transcript payloads in the API error.
- GET run includes pending_interactions: [].

- [ ] **Step 3: Write the failing OpenAPI test.**

Read app.getOpenAPIDocument and assert the GET path /api/workflows/runs/{runId}/nodes/{nodeId}/messages exists.
Assert the 200 schema references WorkflowNodeMessagesResponse.
Assert pending_interactions is a required WorkflowRunDetail array whose items reference PendingInteraction.

- [ ] **Step 4: Run the server test and verify RED.**

~~~bash
( cd packages/server && bun test src/routes/api.workflow-runs.test.ts )
~~~

Expected: FAIL because the nested path and pending_interactions are absent.

- [ ] **Step 5: Add exact route schemas.**

Import pendingInteractionSchema and safeExtend its timestamps to wire strings before assigning the PendingInteraction OpenAPI identity.
Import nodeMessageTextSchema, nodeMessageToolSchema, and nodeMessageStatusSchema, omit workflow_run_id and node_id from each, safeExtend created_at to z.string(), and rebuild a route-level discriminated union without redefining payload fields.
Create workflowNodeMessagesParamsSchema with non-empty runId and nodeId.
Create workflowNodeMessagesResponseSchema as a strict object with messages array.
Add pending_interactions to workflowRunDetailSchema.
Use these schema compositions:

~~~ts
export const pendingInteractionResponseSchema = pendingInteractionSchema
  .safeExtend({
    created_at: z.string(),
    resolved_at: z.string().nullable(),
  })
  .openapi('PendingInteraction');

const nodeMessageWireShape = { created_at: z.string() };
export const workflowNodeMessageTextResponseSchema = nodeMessageTextSchema
  .omit({ workflow_run_id: true, node_id: true })
  .safeExtend(nodeMessageWireShape);
export const workflowNodeMessageToolResponseSchema = nodeMessageToolSchema
  .omit({ workflow_run_id: true, node_id: true })
  .safeExtend(nodeMessageWireShape);
export const workflowNodeMessageStatusResponseSchema = nodeMessageStatusSchema
  .omit({ workflow_run_id: true, node_id: true })
  .safeExtend(nodeMessageWireShape);
export const workflowNodeMessageResponseSchema = z
  .discriminatedUnion('kind', [
    workflowNodeMessageTextResponseSchema,
    workflowNodeMessageToolResponseSchema,
    workflowNodeMessageStatusResponseSchema,
  ])
  .openapi('WorkflowNodeMessage');

export const workflowNodeMessagesParamsSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
});
export const workflowNodeMessagesResponseSchema = z
  .object({ messages: z.array(workflowNodeMessageResponseSchema) })
  .strict()
  .openapi('WorkflowNodeMessagesResponse');
~~~

The WorkflowRunDetail field is pending_interactions: z.array(pendingInteractionResponseSchema).

- [ ] **Step 6: Register and implement the nested GET.**

Declare its createRoute beside the existing retry-node route declarations.
Register it before GET run for readability.
Read runId and nodeId from validated params.
Call workflowDb.getWorkflowRun first and return the existing 404 shape on miss.
Call workflowNodeMessageDb.listNodeMessages only after the run exists.
Map rows to id, seq, kind, payload, and created_at.
Use the existing toISOString helper for Date/string conversion.
Return 500 with the fixed message Failed to list workflow node messages on errors.
Log only runId, nodeId, and errorType at that boundary, not the thrown error object or message.
Use this route and handler shape:

~~~ts
const getWorkflowNodeMessagesRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/messages',
  tags: ['Workflows'],
  summary: 'List one workflow node transcript',
  request: { params: workflowNodeMessagesParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowNodeMessagesResponseSchema } },
      description: 'Workflow node transcript in sequence order',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

registerOpenApiRoute(getWorkflowNodeMessagesRoute, async c => {
  const runId = c.req.param('runId') ?? '';
  const nodeId = c.req.param('nodeId') ?? '';
  try {
    const run = await workflowDb.getWorkflowRun(runId);
    if (!run) return apiError(c, 404, 'Workflow run not found');
    const rows = await workflowNodeMessageDb.listNodeMessages(runId, nodeId);
    return c.json({
      messages: rows.map(row => ({
        id: row.id,
        seq: row.seq,
        kind: row.kind,
        payload: row.payload,
        created_at: toISOString(row.created_at),
      })),
    });
  } catch (error) {
    getLog().error(
      {
        runId,
        nodeId,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      'workflow_node_messages_list_failed'
    );
    return apiError(c, 500, 'Failed to list workflow node messages');
  }
});
~~~

- [ ] **Step 7: Add the empty embed to GET run.**

Insert this field beside nodeStates and usage in the existing response object:

~~~ts
pending_interactions: [],
~~~

Do not query a pending table and do not change nodeStates projection.

- [ ] **Step 8: Run server tests and verify GREEN.**

~~~bash
( cd packages/server && bun test src/routes/api.workflow-runs.test.ts )
( cd packages/server && bun x tsc --noEmit )
~~~

Expected: PASS.

- [ ] **Step 9: Commit the HTTP slice.**

~~~bash
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "feat(server): expose workflow node transcripts"
~~~

### Task 7: Regenerate OpenAPI types and add the web client

**Files:**

- Generate packages/web/src/lib/api.generated.d.ts.
- Modify packages/web/src/lib/api.ts.
- Create packages/web/src/lib/get-workflow-node-messages.test.ts.

**Interfaces:**

- Consumes the live OpenAPI document from Task 6.
- Produces WorkflowNodeStateResponse, WorkflowNodeMessageResponse, WorkflowNodeMessagesResponse, and getWorkflowNodeMessages(runId, nodeId).

- [ ] **Step 1: Start an isolated local server for generation.**

In terminal A, run:

~~~bash
OPENAPI_ARCHON_DIR="$(mktemp -d)"
ARCHON_HOME="$OPENAPI_ARCHON_DIR" DATABASE_URL="" CLAUDE_API_KEY="type-generation-only" ARCHON_TELEMETRY_DISABLED="1" bun -e "import { startServer } from './packages/server/src/index.ts'; await startServer({ port: 3090, skipPlatformAdapters: true });"
~~~

Expected: the server listens on port 3090 with SQLite under the temporary ARCHON_HOME.

- [ ] **Step 2: Generate the client types from the live document.**

In terminal B, run:

~~~bash
bun --filter @archon/web generate:types
~~~

Expected: packages/web/src/lib/api.generated.d.ts changes and contains WorkflowNodeMessage, WorkflowNodeMessagesResponse, PendingInteraction, and WorkflowRunDetail.pending_interactions.
Stop terminal A with Ctrl-C after generation.
Do not hand-edit the generated file.

- [ ] **Step 3: Write the failing API client test.**

Mirror packages/web/src/lib/api.conversations.test.ts by importing getWorkflowNodeMessages from ./api, spying on globalThis.fetch, and restoring the spy in afterEach.
The success path does not read window, so do not install unrelated browser globals.

~~~ts
test('encodes run and node ids and returns the generated response', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        messages: [
          {
            id: 'message-1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello' },
            created_at: '2026-09-06T00:00:00.000Z',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );
  const result = await getWorkflowNodeMessages('run/one', 'group.review');
  expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
    '/api/workflows/runs/run%2Fone/nodes/group.review/messages'
  );
  expect(result.messages[0]?.payload).toEqual({ text: 'hello' });
});
~~~

- [ ] **Step 4: Run the client test and verify RED.**

~~~bash
( cd packages/web && bun test src/lib/get-workflow-node-messages.test.ts )
~~~

Expected: FAIL because getWorkflowNodeMessages is not exported.

- [ ] **Step 5: Add generated aliases and the client function.**

~~~ts
export type WorkflowNodeStateResponse = components['schemas']['WorkflowNodeState'];
export type WorkflowNodeMessageResponse = components['schemas']['WorkflowNodeMessage'];
export type WorkflowNodeMessagesResponse = components['schemas']['WorkflowNodeMessagesResponse'];

export async function getWorkflowNodeMessages(
  runId: string,
  nodeId: string
): Promise<WorkflowNodeMessagesResponse> {
  return fetchJSON(
    '/api/workflows/runs/' +
      encodeURIComponent(runId) +
      '/nodes/' +
      encodeURIComponent(nodeId) +
      '/messages'
  );
}
~~~

- [ ] **Step 6: Run the client test and type-check to verify GREEN.**

~~~bash
( cd packages/web && bun test src/lib/get-workflow-node-messages.test.ts )
( cd packages/web && bun x tsc --noEmit )
~~~

Expected: PASS.

- [ ] **Step 7: Commit generated types and the client.**

~~~bash
git add packages/web/src/lib/api.generated.d.ts packages/web/src/lib/api.ts packages/web/src/lib/get-workflow-node-messages.test.ts
git commit -m "feat(web): add workflow node transcript client"
~~~

### Task 8: Build chronological Logs rows and remove client lifecycle fallback

**Files:**

- Create packages/web/src/components/workflows/build-log-rows.ts.
- Create packages/web/src/components/workflows/build-log-rows.test.ts.
- Modify packages/web/src/components/workflows/WorkflowExecution.tsx.
- Modify packages/web/src/components/workflows/WorkflowExecution.test.tsx.

**Interfaces:**

- Consumes WorkflowNodeStateResponse and WorkflowEventResponse from packages/web/src/lib/api.ts.
- Produces LogRow, LogRowSelection, buildLogRows(nodeStates, events), and server-authoritative DAG node state enrichment.

- [ ] **Step 1: Write failing buildLogRows tests.**

Create literal node states and already ordered events.
Assert:

- A normal node produces one node row with the exact server status.
- A loop base row is replaced by distinct iteration rows.
- Iteration status comes from matching iteration_started, iteration_completed, and iteration_failed events.
- A route-loop base row is replaced by one row per node_routed execution_seq.
- Rows interleave by event index rather than grouping all base rows before all iterations.
- A normal node with more than one node_started event appears once at the latest start position under the Q1 provisional default.
- A missing iteration number or execution_seq is ignored instead of guessed.
- Equal positions retain the input nodeStates order.

Use nodeState.name as the normal label, `${nodeState.name} ×${String(iteration)}` as the loop label, and `${nodeState.name} #${String(executionSeq)}` as the route-loop label.

Use event ids in row ids so repeated route and iteration events never collide.

- [ ] **Step 2: Run the row-model test and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/build-log-rows.test.ts )
~~~

Expected: FAIL because ./build-log-rows does not exist.

- [ ] **Step 3: Implement the discriminated row model.**

Define the public row and selection contract exactly:

~~~ts
import type { WorkflowEventResponse, WorkflowNodeStateResponse } from '@/lib/api';

export type LogRowSelection =
  | { kind: 'node' }
  | { kind: 'loop_iteration'; iteration: number }
  | { kind: 'route_iteration'; executionSeq: number };

export interface LogRow {
  id: string;
  nodeId: string;
  label: string;
  status: WorkflowNodeStateResponse['status'];
  order: number;
  sourceIndex: number;
  selection: LogRowSelection;
}

export function buildLogRows(
  nodeStates: readonly WorkflowNodeStateResponse[],
  events: readonly WorkflowEventResponse[]
): LogRow[] {
  const statesById = new Map<
    string,
    { state: WorkflowNodeStateResponse; index: number }
  >();
  nodeStates.forEach((state, index) => statesById.set(state.nodeId, { state, index }));
  const loopRowsByNode = new Map<string, Map<number, LogRow>>();
  const routeRowsByNode = new Map<string, Map<number, LogRow>>();

  events.forEach((event, order) => {
    const nodeId = event.step_name;
    if (!nodeId) return;
    const stateEntry = statesById.get(nodeId);
    if (!stateEntry) return;
    if (
      event.event_type === 'loop_iteration_started' ||
      event.event_type === 'loop_iteration_completed' ||
      event.event_type === 'loop_iteration_failed'
    ) {
      const iteration = event.data.iteration;
      if (typeof iteration !== 'number' || !Number.isSafeInteger(iteration) || iteration < 1) return;
      const rows = loopRowsByNode.get(nodeId) ?? new Map<number, LogRow>();
      const existing = rows.get(iteration);
      const status =
        event.event_type === 'loop_iteration_failed'
          ? 'failed'
          : event.event_type === 'loop_iteration_completed'
            ? 'completed'
            : 'running';
      rows.set(iteration, {
        id: existing?.id ?? event.id,
        nodeId,
        label: `${stateEntry.state.name} ×${String(iteration)}`,
        status,
        order: existing?.order ?? order,
        sourceIndex: stateEntry.index,
        selection: { kind: 'loop_iteration', iteration },
      });
      loopRowsByNode.set(nodeId, rows);
      return;
    }
    if (event.event_type === 'node_routed') {
      const executionSeq = event.data.execution_seq;
      if (
        typeof executionSeq !== 'number' ||
        !Number.isSafeInteger(executionSeq) ||
        executionSeq < 1
      ) {
        return;
      }
      const rows = routeRowsByNode.get(nodeId) ?? new Map<number, LogRow>();
      if (!rows.has(executionSeq)) {
        rows.set(executionSeq, {
          id: event.id,
          nodeId,
          label: `${stateEntry.state.name} #${String(executionSeq)}`,
          status: 'completed',
          order,
          sourceIndex: stateEntry.index,
          selection: { kind: 'route_iteration', executionSeq },
        });
      }
      routeRowsByNode.set(nodeId, rows);
    }
  });

  const lifecycleTypes = new Set([
    'node_started',
    'node_completed',
    'node_failed',
    'node_skipped',
    'node_skipped_prior_success',
  ]);
  const rows: LogRow[] = [];
  nodeStates.forEach((state, sourceIndex) => {
    const loopRows = loopRowsByNode.get(state.nodeId);
    if (loopRows) {
      rows.push(...loopRows.values());
      return;
    }
    const routeRows = routeRowsByNode.get(state.nodeId);
    if (routeRows) {
      rows.push(...routeRows.values());
      return;
    }
    let eventIndex = -1;
    for (let index = events.length - 1; index >= 0; index--) {
      if (events[index]?.step_name === state.nodeId && events[index]?.event_type === 'node_started') {
        eventIndex = index;
        break;
      }
    }
    if (eventIndex < 0) {
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event?.step_name === state.nodeId && lifecycleTypes.has(event.event_type)) {
          eventIndex = index;
          break;
        }
      }
    }
    rows.push({
      id: eventIndex >= 0 ? (events[eventIndex]?.id ?? `node:${state.nodeId}`) : `node:${state.nodeId}`,
      nodeId: state.nodeId,
      label: state.name,
      status: state.status,
      order: eventIndex >= 0 ? eventIndex : events.length + sourceIndex,
      sourceIndex,
      selection: { kind: 'node' },
    });
  });
  return rows.sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex);
}
~~~

Use node, loop_iteration, and route_iteration as the three selection variants.
Use the latest node_started event id for a normal row, the matching loop_iteration_started event id for a loop row, and the node_routed event id for a route row as shown.
When a normal row has no node_started event, use its latest lifecycle event id or node:${nodeId} as the final stable id.
Determine base order from the latest node_started event with matching step_name, otherwise from the latest matching lifecycle event, and otherwise from a stable node-state fallback after all events.
Sort by order and then stable source index.

- [ ] **Step 4: Run the row-model test and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/build-log-rows.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Rewrite lifecycle tests before production code.**

Replace the existing tests that expect an event-only lifecycle fallback.
Add:

~~~ts
test('returns no DAG lifecycle when server nodeStates are absent', () => {
  expect(
    buildWorkflowDagNodeStates(undefined, [
      workflowEvent({ event_type: 'node_started', step_name: 'review' }),
      workflowEvent({ event_type: 'node_routed', step_name: 'router' }),
    ])
  ).toEqual([]);
});

test('route decisions enrich an existing node without overriding server status', () => {
  const nodes = buildWorkflowDagNodeStates(
    [{ nodeId: 'router', name: 'Router', status: 'running', retryEpoch: 0 }],
    [workflowEvent({ event_type: 'node_routed', step_name: 'router', data: routeDecision })]
  );
  expect(nodes).toHaveLength(1);
  expect(nodes[0]?.status).toBe('running');
  expect(nodes[0]?.routeDecision).toEqual(routeDecision);
});
~~~

- [ ] **Step 6: Run WorkflowExecution.test.tsx and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx )
~~~

Expected: FAIL because event fallback and forced completed status still exist.

- [ ] **Step 7: Remove lifecycle reconstruction and preserve server status.**

Delete buildDagNodeStatesFromEvents.
Change buildWorkflowDagNodeStates to map nodeStates when present and otherwise use an empty array.
Change enrichDagNodesWithRouteDecisions to skip an event when its node is absent and to spread routeDecision onto the existing node without changing status.
Retain loop-iteration and loop-progress enrichment only for nodes already present.
Remove runtimeMetadataFromEventData only if no remaining caller uses it.
The two decisive branches become:

~~~ts
const existing = nodeMap.get(nodeId);
if (!existing) continue;
nodeMap.set(nodeId, { ...existing, routeDecision: e.data });

const baseNodes = (nodeStates ?? []).map(toDagNodeState);
~~~

- [ ] **Step 8: Preserve raw nodeStates in WorkflowRunQueryData.**

Add nodeStates with the generated getWorkflowRun type to WorkflowRunQueryData.
Return data.nodeStates from the query function so Task 9 can build the Logs rows without reading reconstructed workflow.dagNodes.

~~~ts
nodeStates: WorkflowRunNodeState[];
nodeStates: data.nodeStates,
~~~

- [ ] **Step 9: Run both focused suites and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/build-log-rows.test.ts src/components/workflows/WorkflowExecution.test.tsx )
( cd packages/web && bun x tsc --noEmit )
~~~

Expected: PASS.

- [ ] **Step 10: Commit row modeling and lifecycle-source repair.**

~~~bash
git add packages/web/src/components/workflows/build-log-rows.ts packages/web/src/components/workflows/build-log-rows.test.ts packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx
git commit -m "fix(web): keep server node lifecycle authoritative"
~~~

### Task 9: Render and wire the legacy node room

**Files:**

- Create packages/web/src/components/workflows/NodeRunList.tsx.
- Create packages/web/src/components/workflows/NodeRunList.test.tsx.
- Create packages/web/src/components/workflows/NodeRoom.tsx.
- Create packages/web/src/components/workflows/NodeRoom.test.tsx.
- Create packages/web/src/components/workflows/NodeTranscriptPane.tsx.
- Create packages/web/src/components/workflows/NodeTranscriptPane.test.tsx.
- Create packages/web/src/components/workflows/LegacyNodeLogs.tsx.
- Create packages/web/src/components/workflows/LegacyNodeLogs.test.tsx.
- Modify packages/web/src/components/workflows/WorkflowExecution.tsx.

**Interfaces:**

- Consumes LogRow, LogRowSelection, WorkflowNodeMessageResponse, and getWorkflowNodeMessages.
- Produces one Logs-only selectable list, selectNodeRoomMessages(messages, selection), the accessible room renderer, a mounted query boundary with injected loadMessages, and a tested Logs-only composition boundary.

- [ ] **Step 1: Write the failing NodeRunList markup test.**

Use renderToStaticMarkup.
Assert every row is a button, the selected row has aria-current=true, a loop row includes the multiplication-sign iteration label, a route row includes its execution number, and status text is visible.
Assert no merged transcript text is rendered in the list.

- [ ] **Step 2: Run the list test and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeRunList.test.tsx )
~~~

Expected: FAIL because NodeRunList does not exist.

- [ ] **Step 3: Implement NodeRunList.**

Accept rows, selectedRowId, and onSelect.
Render a nav with aria-label Node runs and one type=button per row.
Call onSelect with the complete LogRow so an iteration selection is not collapsed to nodeId.
Use existing status color classes and plain text labels.
Use this public prop contract and button semantics:

~~~tsx
interface NodeRunListProps {
  rows: readonly LogRow[];
  selectedRowId: string | null;
  onSelect: (row: LogRow) => void;
}

<button
  type="button"
  aria-current={row.id === selectedRowId ? 'true' : undefined}
  onClick={(): void => onSelect(row)}
>
  <span>{row.label}</span>
  <span>{row.status}</span>
</button>
~~~

- [ ] **Step 4: Re-run the list test and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeRunList.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 5: Write failing transcript slicing and room-render tests.**

Use literal messages with sequences:

1. started.
2. iteration_started detail 1.
3. text first.
4. iteration_completed detail 1.
5. iteration_started detail 2.
6. tool.
7. iteration_failed detail 2.
8. failed.

Assert selecting iteration 2 returns only rows 5 through 7.
Assert a missing iteration marker returns all rows.
Use renderToStaticMarkup to assert:

- Null selection renders Select a node.
- Loading renders Loading node transcript.
- Error renders Failed to load node transcript and a Retry button.
- Empty loaded messages render Node hasn't produced output.
- Text, tool name/input, and status state render in seq order.
- The root loaded panel has role=region and aria-label=review room.
- No Ask, waiting, or pending-interaction chrome appears.

- [ ] **Step 6: Run the room test and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeRoom.test.tsx )
~~~

Expected: FAIL because NodeRoom does not exist.

- [ ] **Step 7: Implement exact iteration slicing.**

Sort a copy of messages by seq ascending.
For a non-loop selection, return the sorted array.
For a loop selection, find status iteration_started with matching detail.
End at the first later status whose state is iteration_completed or iteration_failed and whose detail matches.
If there is no terminal marker, end immediately before the next iteration_started or at the array end.
If no matching start exists, return the full sorted array.
Implement the pure selector with this control flow:

~~~ts
export function selectNodeRoomMessages(
  messages: readonly WorkflowNodeMessageResponse[],
  selection: LogRowSelection
): WorkflowNodeMessageResponse[] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  if (selection.kind !== 'loop_iteration') return ordered;
  const detail = String(selection.iteration);
  const start = ordered.findIndex(
    message =>
      message.kind === 'status' &&
      message.payload.state === 'iteration_started' &&
      message.payload.detail === detail
  );
  if (start < 0) return ordered;
  const terminalOffset = ordered.slice(start + 1).findIndex(
    message =>
      message.kind === 'status' &&
      (message.payload.state === 'iteration_completed' ||
        message.payload.state === 'iteration_failed') &&
      message.payload.detail === detail
  );
  if (terminalOffset >= 0) return ordered.slice(start, start + terminalOffset + 2);
  const nextStartOffset = ordered.slice(start + 1).findIndex(
    message => message.kind === 'status' && message.payload.state === 'iteration_started'
  );
  return ordered.slice(start, nextStartOffset >= 0 ? start + nextStartOffset + 1 : undefined);
}
~~~

- [ ] **Step 8: Implement the room renderer.**

Accept nodeId, selection, messages, isPending, error, and onRetry.
Render the exact states from the tests.
Render text through ReactMarkdown using the existing legacy styling idiom.
Render tools as a named chip with optional details/pre blocks for input and output using JSON.stringify(value, null, 2).
Render status as a visible lifecycle note.
Key items by message id and use a kind switch.
Do not import or render pending interactions.
Use a strict discriminated switch so a newly generated kind causes a compile error at the renderer boundary:

~~~tsx
function assertNever(value: never): never {
  void value;
  throw new Error('Unsupported workflow node message kind');
}

switch (message.kind) {
  case 'text':
    return <ReactMarkdown>{message.payload.text}</ReactMarkdown>;
  case 'tool':
    return <ToolTranscriptItem message={message} />;
  case 'status':
    return <StatusTranscriptItem message={message} />;
  default:
    return assertNever(message);
}
~~~

- [ ] **Step 9: Re-run room tests and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 10: Write the failing mounted query-boundary test.**

Create NodeTranscriptPane.test.tsx with a HappyDOM Window, createRoot, React act, and QueryClientProvider.
Construct the test QueryClient with query retries disabled so the first rejection reaches the asserted error state deterministically.
Pass a collecting async loadMessages function instead of mocking the API module.
Return the eight-message two-iteration fixture from the loader.
Mount with a selected review row and isLive=false, flush the query, and assert the loader receives run-1 and review exactly once and the returned text appears in the room.
Re-render with a loop-iteration row for the same node and assert the marker-bounded iteration is displayed without another network dependency or a second room instance.
Use a rejecting loader, assert Failed to load node transcript and Retry, click Retry, switch the loader result to success, and assert the room recovers.
Assert transcriptRefetchInterval(true) is 1000 and transcriptRefetchInterval(false) is false.
Unmount the root, close HappyDOM, clear the QueryClient, and restore every installed global in afterEach.

- [ ] **Step 11: Run the query-boundary test and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeTranscriptPane.test.tsx )
~~~

Expected: FAIL because NodeTranscriptPane does not exist.

- [ ] **Step 12: Implement the mounted query boundary.**

Export transcriptRefetchInterval(isLive): 1000 | false.
Accept runId, row, isLive, and a required loadMessages function with the same signature as getWorkflowNodeMessages.
Use query key ['workflowNodeMessages', runId, row?.nodeId], enable the query only when row is non-null, and call loadMessages with the selected run and node.
Pass row?.nodeId, query.data?.messages, query.isPending, query.error, and a callback that voids query.refetch to NodeRoom.
Pass the complete row.selection to NodeRoom so a same-node iteration change re-slices cached messages without a redundant fetch.
Use this query policy:

~~~tsx
export function transcriptRefetchInterval(isLive: boolean): 1000 | false {
  return isLive ? 1000 : false;
}

const query = useQuery({
  queryKey: ['workflowNodeMessages', runId, row?.nodeId],
  queryFn: () => loadMessages(runId, row?.nodeId ?? ''),
  enabled: row !== null,
  refetchInterval: transcriptRefetchInterval(isLive),
});

<NodeRoom
  nodeId={row?.nodeId ?? null}
  selection={row?.selection ?? null}
  messages={query.data?.messages}
  isPending={query.isPending}
  error={query.error}
  onRetry={(): void => {
    void query.refetch();
  }}
/>
~~~

- [ ] **Step 13: Run the query-boundary test and verify GREEN.**

~~~bash
( cd packages/web && bun test src/components/workflows/NodeTranscriptPane.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 14: Write the failing Logs composition test.**

Create LegacyNodeLogs.test.tsx with the same HappyDOM and QueryClient cleanup discipline as NodeTranscriptPane.test.tsx.
Mount it with run-1, one review nodeState, its node_started event, a collecting loadMessages function, and an onSelectNode callback.
Assert the review row and Select a node render before selection.
Click the review row, flush the transcript query, and assert onSelectNode receives review, the loader receives run-1 and review, and the returned text appears in the single room region.
Re-render with run-2 and no rows, then assert onSelectNode receives null and the room returns to Select a node.

- [ ] **Step 15: Run the Logs composition test and verify RED.**

~~~bash
( cd packages/web && bun test src/components/workflows/LegacyNodeLogs.test.tsx )
~~~

Expected: FAIL because LegacyNodeLogs does not exist.

- [ ] **Step 16: Implement LegacyNodeLogs and wire WorkflowExecution.**

In LegacyNodeLogs.tsx, accept runId, nodeStates, events, isLive, loadMessages, onSelectNode, roomHeader, and roomFooter.
Build logRows with useMemo, own selectedLogRowId, and resolve the selected row by id.
Track the previous runId in a ref and reset selection plus call onSelectNode(null) only when an already-mounted instance receives a different runId or when polling removes a currently selected row.
Render the fixed-width NodeRunList column and one right column containing roomHeader, NodeTranscriptPane, and roomFooter.
On row selection, store its id and call onSelectNode(row.nodeId) so the existing retry action follows the opened node.
Use this prop contract and one combined reset effect so a run change cannot fire duplicate null callbacks:

~~~tsx
interface LegacyNodeLogsProps {
  runId: string;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  onSelectNode: (nodeId: string | null) => void;
  roomHeader?: ReactNode;
  roomFooter?: ReactNode;
}

const rows = useMemo(() => buildLogRows(nodeStates, events), [nodeStates, events]);
const [selectedLogRowId, setSelectedLogRowId] = useState<string | null>(null);
const selectedRow = rows.find(row => row.id === selectedLogRowId) ?? null;
const previousRunId = useRef(runId);

useEffect(() => {
  const runChanged = previousRunId.current !== runId;
  const selectedRowRemoved = selectedLogRowId !== null && selectedRow === null;
  previousRunId.current = runId;
  if (!runChanged && !selectedRowRemoved) return;
  setSelectedLogRowId(null);
  onSelectNode(null);
}, [onSelectNode, runId, selectedLogRowId, selectedRow]);

return (
  <div className="flex flex-1 overflow-hidden min-h-0">
    <div className="w-64 border-r border-border overflow-auto">
      <NodeRunList
        rows={rows}
        selectedRowId={selectedLogRowId}
        onSelect={(row): void => {
          setSelectedLogRowId(row.id);
          onSelectNode(row.nodeId);
        }}
      />
    </div>
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 h-full">
      {roomHeader}
      <NodeTranscriptPane
        runId={runId}
        row={selectedRow}
        isLive={isLive}
        loadMessages={loadMessages}
      />
      {roomFooter}
    </div>
  </div>
);
~~~

In WorkflowExecution.tsx, preserve raw nodeStates in WorkflowRunQueryData as established in Task 8 and pass queryData.nodeStates plus queryData.events to LegacyNodeLogs.
Rename the current logsPanel to mergedLogsPanel and continue using it only in the Graph branch.
Pass getWorkflowNodeMessages as loadMessages, isRunning as isLive, setSelectedDagNode as onSelectNode, retryActionPanel as roomHeader, and the existing completed-run ArtifactSummary as roomFooter.
Replace only the Logs branch with LegacyNodeLogs.
Keep StepLogs, WorkflowLogs, toolEvents, graph click scrolling, and the Graph branch unchanged.

- [ ] **Step 17: Run the Logs composition test and all focused web tests to verify GREEN.**

~~~bash
( cd packages/web && bun test src/lib/get-workflow-node-messages.test.ts )
( cd packages/web && bun test src/components/workflows/build-log-rows.test.ts src/components/workflows/NodeRunList.test.tsx src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/WorkflowExecution.test.tsx )
( cd packages/web && bun x tsc --noEmit )
~~~

Expected: PASS with no warnings.

- [ ] **Step 18: Commit the legacy Logs UI.**

~~~bash
git add packages/web/src/components/workflows/NodeRunList.tsx packages/web/src/components/workflows/NodeRunList.test.tsx packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/NodeRoom.test.tsx packages/web/src/components/workflows/NodeTranscriptPane.tsx packages/web/src/components/workflows/NodeTranscriptPane.test.tsx packages/web/src/components/workflows/LegacyNodeLogs.tsx packages/web/src/components/workflows/LegacyNodeLogs.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx
git commit -m "feat(web): open node transcripts from legacy logs"
~~~

### Task 10: Validate the complete story and mark it done

**Files:**

- Modify _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml.

**Interfaces:**

- Consumes every prior task.
- Produces reviewable validation evidence and the completed Story 5.1 status.

- [ ] **Step 1: Run focused package tests in isolation.**

~~~bash
( cd packages/workflows && bun test src/schemas/node-message.test.ts src/schemas/pending-interaction.test.ts )
( cd packages/workflows && bun test src/node-transcript.test.ts )
( cd packages/workflows && bun test src/dag-executor.test.ts )
( cd packages/core && bun test src/db/workflow-node-messages.test.ts )
( cd packages/core && bun test src/db/adapters/sqlite.test.ts )
( cd packages/core && bun test src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts )
( cd packages/core && bun test src/workflows/store-adapter.test.ts )
( cd packages/server && bun test src/routes/api.workflow-runs.test.ts )
( cd packages/web && bun test src/lib/get-workflow-node-messages.test.ts )
( cd packages/web && bun test src/components/workflows/build-log-rows.test.ts src/components/workflows/NodeRunList.test.tsx src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/WorkflowExecution.test.tsx )
~~~

Expected: every command passes independently.

- [ ] **Step 2: Run the PostgreSQL upgrade gate when configured.**

~~~bash
bun run check:schema-upgrades
~~~

Expected: PASS against every released schema baseline and idempotent reapply.
If neither DATABASE_URL nor PGHOST identifies a reachable PostgreSQL service, record that external prerequisite explicitly and rely on the mandatory CI job before merge.

- [ ] **Step 3: Run full repository validation.**

~~~bash
bun run validate
~~~

Expected: bundled checks, type-check, zero-warning lint, format check, install test, package-isolated tests, and script tests all pass.

- [ ] **Step 4: Perform the manual acceptance walkthrough.**

Start the app with bun run dev and run a workflow containing one prompt or command node with a tool call plus one loop with at least two iterations.
Confirm the Logs list is unmerged and chronological.
Confirm selecting the normal agent row shows started, text, tool, and terminal items in seq order.
Confirm selecting each loop row shows only that iteration's marker-bounded transcript.
Confirm the same rows replay after the run reaches a terminal status.
Confirm a node with no transcript shows Node hasn't produced output.
Confirm the Graph tab still shows the original graph and merged WorkflowLogs panel.
Confirm no Ask card, empty Ask slot, awaiting copy, or waiting-on-you chrome is present.

- [ ] **Step 5: Mark the story done only after automated and manual acceptance pass.**

Change only development_status.5-1-open-a-nodes-own-transcript-from-logs-legacy from backlog to done in _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml.

- [ ] **Step 6: Commit completion evidence.**

~~~bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "docs: mark legacy node transcript story done"
~~~

## Acceptance Criteria Traceability

- Story AC for unmerged node-run rows is covered by Tasks 8 and 9 and the manual Logs-list walkthrough.
- Story AC for command, prompt, and loop transcript replay is covered by Tasks 5, 6, 7, and 9.
- Story AC for kind-keyed extensible items is covered by the discriminated schema in Task 1 and kind switch in Task 9.
- Story AC prohibiting Ask placeholders and awaiting chrome is enforced by Global Constraints and the Task 9 render assertions.
- Story AC for the additive table, cascade, sequence, and unchanged remote_agent_messages is covered by Tasks 2 and 3.
- Story AC for authoritative nodeStates and pending_interactions as an empty array is covered by Tasks 6 and 8.
- Story AC for PostgreSQL upgrade evidence is covered by Task 10 and the mandatory CI gate.

## Definition of Done

- Both database dialects contain remote_agent_workflow_node_messages with the exact seven columns, cascade foreign key, checks, and covering unique constraint.
- Core append/list behavior assigns monotonic per-node sequence values, retries one sequence conflict in a fresh transaction, validates stored payloads, and never logs payload bodies.
- IWorkflowStore exposes exactly appendNodeMessage and listNodeMessages for transcripts.
- Command, prompt, and loop execution writes ordered text, tool-call, and lifecycle rows without changing workflow success on transcript persistence failure.
- GET run returns pending_interactions as an empty array and retains projectLatestEffectiveNodeStates as its lifecycle projector.
- The nested messages GET returns only the requested node transcript in seq order, returns 404 for a missing run, and returns an empty array for an existing node without rows.
- Generated web types come from the live OpenAPI document.
- The legacy Logs tab shows chronological unmerged rows and opens one accessible node room with live polling and historical replay.
- Loop iteration selection displays the exact marker-bounded iteration transcript.
- The legacy client has no raw-event lifecycle fallback and never synthesizes or force-completes a route node.
- The Graph tab, command-center surface, remote_agent_messages, workflow language, provider contract, and HITL behavior are unchanged.
- Focused tests, package type-checks, schema checks, bun run validate, and the applicable PostgreSQL upgrade check pass.
- The Story 5.1 sprint-status key changes to done only after every preceding criterion passes.
