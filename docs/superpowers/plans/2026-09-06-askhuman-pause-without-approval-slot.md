# Pause a Run When the Agent Asks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a structured AskHuman pending row, pause the run without writing `metadata.approval`, project `awaiting`, and reject unsupported `allowed_tools: [AskHuman]` before a turn.

**Architecture:** `@archon/workflows` owns the `AskHuman` NativeTool.
The handler inserts `remote_agent_pending_interactions` and `node_awaiting` in one transaction, then throws `AskHumanAwaitingError`.
Claude and Pi wrappers abort the in-flight query and reject `sendQuery` with that same class instead of stringifying it as a tool result.
`pauseWorkflowRun` becomes optional-approval and idempotent for Ask so the declared-gate slot stays untouched.
Story 6.3 owns answer POST, CAS resume, and `resumeInteractions`.
Stories 6.5 and 6.6 own Ask cards.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi` (providers converters import `zod` directly), SQLite/PostgreSQL, OpenAPIHono, Bun Test, Claude Agent SDK `0.3.209`, Pi `0.80.6`.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.2.

**Approved design inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md`, `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md`.

**Issue:** https://github.com/anhle128/Archon/issues/87

## Global Constraints

- Story 6.2 persists and pauses only.
- Do not implement `resolvePendingInteraction`, answer POST, `resumeInteractions`, provider resume mappers, Ask cards, awaiting chrome, or permission POST.
- Do not write `metadata.approval` on Ask pause.
- Do not add a run status `awaiting`.
- Do not write `node_completed` for an asking node.
- Do not classify assistant prose as an ask.
- Do not wrap Claude `AskUserQuestion`.
- Do not inject `AskHuman` from the chat orchestrator.
- Do not add a workflow YAML field for AskHuman.
- `NativeTool.handler` remains `Promise<string>`.
- `pendingInteractionSchema` stays the single row shape in `packages/workflows/src/schemas/pending-interaction.ts`.
- Server routes import or `.extend` that schema and do not fork it.
- `node_awaiting` is written in the same `withTransaction` as the pending insert through `insertWorkflowEvent`, never through fire-and-forget `createWorkflowEvent`.
- Schema changes are additive-only and mirrored in `migrations/000_combined.sql` and `SqliteAdapter.createSchema`.
- Put PostgreSQL column comments in the trailing Indexes and column comments section.
- Do not add a redundant standalone index.
- The unique constraint on `(workflow_run_id, tool_use_id)` is the covering lookup.
- Regenerated files must come from their generators: `bun run generate:bundled-schema`, `bun run generate:capability-matrix`, and `packages/web` `generate:types`.
- Do not use `any`.
- Import engine Zod from `@hono/zod-openapi`.
- Claude converters remain a documented `zod` direct-import exception.
- Add every new `mock.module()` test file as its own `bun test <file>` process.
- Do not run an unscoped `bun test` from the repository root.
- Run focused tests from the package directory.
- Finish with `bun run validate` from the repository root.
- Keep each RED test in place, observe the expected failure, add only the minimal production behavior, observe GREEN, then run an explicit REFACTOR step while those tests remain green, then commit.
- Keep each full Markdown sentence on its own physical line in this plan.

---

## Verified Repository Baseline

- `pendingInteractionSchema` already exists at `packages/workflows/src/schemas/pending-interaction.ts` and types the empty GET-run embed from Story 5.1.
- `GET /api/workflows/runs/:runId` currently hardcodes `pending_interactions: []` in `packages/server/src/routes/api.ts`.
- `IWorkflowStore.pauseWorkflowRun` requires `ApprovalContext` and `packages/core/src/db/workflows.ts` always json-merges `metadata.approval`.
- `pauseWorkflowRun` updates only `WHERE status = 'running'` and throws on a zero-row match.
- `createWorkflowEvent` is fire-and-forget.
- Transactional event writes use `insertWorkflowEvent` inside `withTransaction`.
- `WORKFLOW_EVENT_TYPES` does not include `node_awaiting` or `interaction_resolved`.
- `nodeStateSchema`, `workflowStepStatusSchema`, and server `workflowNodeStateSchema.status` are `pending|running|completed|failed|skipped`.
- `workflow-run.ts` currently asserts that `NodeOutput['state']` and `NodeState` are equal in both directions, so adding the projection-only `awaiting` state requires narrowing that assertion to `NodeOutput['state'] extends NodeState`.
- `ApiWorkflowNodeState.status` in `packages/server/src/routes/api.ts` repeats the five-state union independently of the OpenAPI schema.
- `projectLatestEffectiveNodeStates` in `packages/workflows/src/retry-state.ts` ignores unknown event types and does not read pending rows.
- `NativeTool.handler` is `(input) => Promise<string>` with no context argument.
- Claude `buildArchonMcpServer` and Pi `buildPiNativeToolDefinitions` await the handler with no try/catch, so a throw becomes a tool error inside the agent loop.
- Claude's `PreToolUse` hook exposes the real SDK `tool_use_id`, as demonstrated by `packages/providers/src/claude/askhuman-resume-spike.ts`; the MCP callback itself does not expose that id.
- Pi's native-tool `execute` callback receives the real tool-call id as its first argument, and `session.sessionId` exists before `session.prompt()`.
- Converters accept only a flat object of string / string-enum / boolean fields.
- `dag-executor` never sets `SendQueryOptions.nativeTools`.
- Chat orchestrator injects only `manage_run` when `capabilities.nativeTools` is true.
- `ProviderCapabilities` has no `askHuman` field.
- Claude and Pi have `nativeTools: true`.
- Codex, Grok, OpenCode, Copilot, OMP, QoderCLI, and e2e-fake have `nativeTools: false`.
- Load-time `allowed_tools` checks are warnings, never start-blocking errors.
- Application table 22 is `remote_agent_workflow_node_messages`.
- SQLite parity floor is `MIN_NON_AUTH_COLUMNS = 169`.
- Story 6.1 confirmed Claude `0.3.209` host-abort plus one provider-owned user message, and Pi durable `appendMessage` then `session.agent.continue()`.
- Story 6.3, not this story, implements that resume protocol.

## File Map

### Engine contracts

- Modify `packages/workflows/src/schemas/workflow-run.ts` to add `awaiting` to `workflowStepStatusSchema` and `nodeStateSchema` while keeping `NodeOutput['state']` a strict subset of `NodeState`.
- Modify `packages/workflows/src/schemas.test.ts` to prove the two status schemas accept `awaiting` and `nodeOutputSchema` rejects it.
- Modify `packages/workflows/src/schemas/pending-interaction.ts` to add `insertPendingInteractionSchema`.
- Modify `packages/workflows/src/schemas/pending-interaction.test.ts` for the insert schema.
- Modify `packages/workflows/src/store.ts` to add `node_awaiting` and `interaction_resolved`, optionalize `pauseWorkflowRun`, and compose `IWorkflowPendingInteractionStore`.
- Modify `packages/workflows/src/retry-state.ts` so the projector maps `node_awaiting` or pending rows to `awaiting` and ignores `interaction_resolved` as completion.
- Modify `packages/workflows/src/retry-state.test.ts` for those projector rules.
- Create `packages/workflows/src/ask-human.ts` for the NativeTool, input schema, and persist-then-throw handler.
- Create `packages/workflows/src/ask-human.test.ts` for handler behavior.
- Modify `packages/workflows/src/dag-executor.ts` to inject AskHuman, catch branded errors, Ask-pause, and CAP-7 preflight.
- Modify `packages/workflows/src/dag-executor.test.ts` for inject, pause, no `node_completed`, no-starter fail, and CAP-7.
- Modify `packages/workflows/src/executor.test.ts`, `executor-preamble.test.ts`, `script-node-deps.test.ts`, and `subrun.test.ts` so store doubles satisfy the new ports.
- Modify `packages/workflows/package.json` to run `src/ask-human.test.ts` in its own `bun test` invocation.

### Persistence

- Modify `migrations/000_combined.sql` to add application table 23 and trailing column comments.
- Modify `packages/core/src/db/adapters/sqlite.ts` to mirror the table in `createSchema`.
- Modify `packages/core/src/db/adapters/sqlite.test.ts` to raise the parity floor to 181 and assert the fresh schema.
- Modify `packages/core/src/db/bundled-schema.generated.ts` only through `bun run generate:bundled-schema`.
- Modify `AGENTS.md` to document 23 application tables and Better Auth tables 24 through 27.
- Create `packages/core/src/schemas/pending-interaction.ts` as the core row-schema alias.
- Modify `packages/core/src/schemas/index.ts` to export that alias.
- Create `packages/core/src/db/workflow-pending-interactions.ts` for insert, list, no-starter, and same-transaction `node_awaiting`.
- Create `packages/core/src/db/workflow-pending-interactions.test.ts` as its own mock-isolated shard.
- Modify `packages/core/src/db/index.ts` to add namespaced and direct exports.
- Modify `packages/core/src/db/workflows.ts` so Ask pause omits `metadata.approval` and is idempotent when already paused.
- Modify `packages/core/src/db/workflows.test.ts` for those pause behaviors.
- Modify `packages/core/src/workflows/store-adapter.ts` to implement the new ports and pass optional approval through.
- Modify `packages/core/src/workflows/store-adapter.test.ts` for the new required methods.
- Modify `packages/core/package.json` to run `workflow-pending-interactions.test.ts` in its own invocation.

### Providers

- Modify `packages/providers/src/types.ts` to add `AskHumanAwaitingError`, `AskHumanNoStarterError`, and optional `NativeToolHandlerContext` while keeping `NativeTool.handler` on `Promise<string>`.
- Modify `packages/providers/src/claude/native-tools.ts` to convert AskHuman `questions[]`, pass handler context, and report only branded control errors through a provider-local bridge.
- Modify `packages/providers/src/claude/native-tools.test.ts` for nested schema and branded-error reject.
- Modify `packages/providers/src/claude/provider.ts` to capture the real SDK tool-use id and session id, abort on a branded control error, and rethrow the same instance before generic abort classification or retry.
- Modify `packages/providers/src/claude/provider.test.ts` for provider-level same-instance rejection, real id/session context, abort, and no retry.
- Modify `packages/providers/src/community/pi/native-tools.ts` with the same converter, context, and branded-control reporting rules.
- Modify `packages/providers/src/community/pi/native-tools.test.ts` for the same cases.
- Modify `packages/providers/src/community/pi/provider.ts` to populate provider-local context from `_toolCallId` and `session.sessionId`, abort, and rethrow a branded error even if Pi converts the tool throw internally.
- Modify `packages/providers/src/community/pi/provider.test.ts` for provider-level same-instance rejection, real id/session context, abort, and no normal-error promotion.
- Modify `packages/providers/src/claude/capabilities.ts` and `packages/providers/src/community/pi/capabilities.ts` to set `askHuman: true`.
- Modify `packages/providers/src/codex/capabilities.ts`, `packages/providers/src/grok/capabilities.ts`, `packages/providers/src/community/copilot/capabilities.ts`, `packages/providers/src/community/omp/capabilities.ts`, `packages/providers/src/community/opencode/capabilities.ts`, `packages/providers/src/community/qodercli/capabilities.ts`, and `packages/providers/src/e2e-fake/capabilities.ts` to set `askHuman: false`.
- Modify `packages/providers/src/registry.test.ts` and `packages/providers/src/observability.test.ts` for the required capability field and the exact capable-provider set.
- Modify `scripts/generate-capability-matrix.ts` to add the `askHuman` axis.
- Modify `packages/docs-web/src/content/docs/reference/provider-capabilities.md` only through `bun run generate:capability-matrix`.

### HTTP, SSE, chat

- Modify `packages/server/src/routes/schemas/workflow.schemas.ts` to reuse `nodeStateSchema` for `workflowNodeStateSchema.status`.
- Modify `packages/server/src/routes/api.ts` to type `ApiWorkflowNodeState.status` as `NodeState`, list pending rows, serialize their dates, and pass them into the projector.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts` to mock the new DB module and cover embed, awaiting, and empty messages.
- Modify `packages/server/src/adapters/web/workflow-bridge.ts` so live and persisted `node_awaiting` events are refetch triggers without an envelope.
- Modify `packages/server/src/adapters/web/dashboard-event-poller.test.ts` and `packages/server/src/adapters/web/workflow-bridge.test.ts` for persisted and live mapping.
- Modify `packages/workflows/src/event-emitter.ts` to add a live `node_awaiting` event with `runId` and `nodeId` only.
- Modify `packages/workflows/src/event-emitter.test.ts` to prove the new event is deliverable without card data.
- Modify `packages/core/src/orchestrator/orchestrator-agent.test.ts` so chat still injects only `manage_run`.
- Regenerate `packages/web/src/lib/api.generated.d.ts` from a live server after the OpenAPI status enum changes.

### Completion tracking

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after all validation passes.

## Authoritative Contracts

### Pending table

PostgreSQL:

```sql
CREATE TABLE IF NOT EXISTS remote_agent_pending_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  tool_use_id VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('ask', 'permission')),
  status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'answered', 'purged')),
  envelope JSONB NOT NULL,
  answer JSONB,
  provider_session_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by VARCHAR(255),
  CONSTRAINT uq_pending_interactions_run_tool_use
    UNIQUE (workflow_run_id, tool_use_id)
);
```

SQLite uses TEXT for ids, json columns, and timestamps, keeps the same checks and named unique constraint, and uses `ON DELETE CASCADE`.
The store supplies a dialect-generated id.
`tool_use_id` is unique per run and is the Ask `request_id`.
Do not add a second index.

### Store ports

```ts
export const insertPendingInteractionSchema = pendingInteractionSchema
  .pick({
    workflow_run_id: true,
    node_id: true,
    tool_use_id: true,
    kind: true,
    envelope: true,
    provider_session_id: true,
  })
  .strict();

export type InsertPendingInteractionInput = z.infer<typeof insertPendingInteractionSchema>;

export interface IWorkflowPendingInteractionStore {
  insertPendingInteraction(input: InsertPendingInteractionInput): Promise<PendingInteraction>;
  listPendingInteractions(workflowRunId: string): Promise<PendingInteraction[]>;
}

pauseWorkflowRun(
  id: string,
  approvalContext?: ApprovalContext,
  extraMetadata?: Record<string, unknown>
): Promise<void>;
```

`insertPendingInteraction` must, in one `withTransaction`:

1. Parse the caller input with `insertPendingInteractionSchema` before opening the transaction.
2. `SELECT user_id, status FROM remote_agent_workflow_runs WHERE id = $1` with a local `getDatabaseType() === 'postgresql' ? ' FOR UPDATE' : ''` clause because `rowLockClause()` in `packages/core/src/db/workflows.ts` is private.
3. Throw a normal `Error` if no run row exists.
4. Throw `AskHumanNoStarterError` if the existing run's `user_id` is null, without inserting.
5. Insert the row with `status = 'pending'`, `answer = null`, `resolved_at = null`, `resolved_by = null`.
6. Call `insertWorkflowEvent` with the transaction query, `event_type: 'node_awaiting'`, `step_name: node_id`, and `data: { node_id, tool_use_id, kind }` only.
7. Select and parse the inserted row through the canonical row schema, converting SQLite JSON strings for `envelope` and `answer` before parsing.
8. Return the parsed row.

`listPendingInteractions` returns every row for the run ordered by `created_at` ascending, then `id` ascending.
Corrupt or malformed stored JSON throws `PendingInteractionCorruptRowError` with only the row id in its message and never logs `envelope` or `answer` bodies.
Do not add `resolvePendingInteraction`.

### Ask pause

When `approvalContext` is provided, keep today's gate write, including explicit-null approval subfields and `WHERE status = 'running'`.
When `approvalContext` is omitted, set `status = 'paused'` and do not json-merge `metadata.approval` or any other metadata.
If that UPDATE matches zero rows and the current status is `paused`, return success.
If that UPDATE matches zero rows and the status is anything else, throw the existing not-running error.
Do not emit `approval_pending` for Ask.

### Projector

`RetryNodeProjection.state` uses `NodeState`, which now includes `awaiting`.
Do not add `awaiting` to `nodeOutputSchema`.
Replace the two-way `AssertNodeOutputCoversNodeState` compile assertion with a one-way `AssertNodeOutputStateIsNodeState` assertion so every executable `NodeOutput` state must be a `NodeState`, while projection-only `awaiting` is allowed outside `NodeOutput`.
An asking node still returns `{ state: 'completed', output }` so the between-layer paused check halts the DAG, matching `executeApprovalNode`.

```ts
projectLatestEffectiveNodeStates(
  events: readonly RetryProjectionEvent[],
  pending?: readonly { node_id: string; status: string }[]
): Map<string, RetryNodeProjection>
```

Event rules in order:

- Existing retry/start/completed/failed/skipped rules stay.
- `node_awaiting` sets `state: 'awaiting'` and does not write output.
- `interaction_resolved` does not change state and never completes the node.

After events, every pending row with `status === 'pending'` forces that `node_id` to `awaiting`, matching AD-7 exactly.
`GET` run passes `listPendingInteractions` into this overlay.
`settleApiWorkflowNodeStatesForRunStatus` must not rewrite `awaiting` on a paused run.

### AskHuman tool

Name is `AskHuman`.
Claude MCP remains `mcp__archon__AskHuman` because `ARCHON_TOOL_SERVER` is `archon`.

```ts
export const ASK_HUMAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'Ordered structured questions for the run starter.',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          selection: { type: 'string', enum: ['single', 'multi'] },
          options: { type: 'array', items: { type: 'string' } },
          allowOther: { type: 'boolean' },
        },
        required: ['id', 'prompt', 'selection', 'options', 'allowOther'],
      },
    },
  },
  required: ['questions'],
};
```

Description is exactly the following single string:

```text
Ask the run starter one or more structured questions. Call this tool instead of asking in prose. Wait after calling; do not guess the answer.
```

Handler algorithm:

1. Validate `questions` as a non-empty array of the fields above.
2. Invalid input throws a normal `Error`, which remains a tool error.
3. `toolUseId` comes from `NativeToolHandlerContext.toolUseId`.
4. `provider_session_id` comes from `context.sessionId`.
5. Missing `toolUseId` or empty session id throws a normal `Error`.
6. Call `insertPendingInteraction` with `kind: 'ask'` and `envelope: { questions }`.
7. Log `workflow.ask_pending` with `workflowRunId`, `nodeId`, `toolUseId`, and `kind` only.
8. Throw `AskHumanAwaitingError`.

Never log envelope, question text, or answer bodies.

### Provider wrappers

```ts
export interface NativeToolHandlerContext {
  toolUseId?: string;
  sessionId?: string;
}

export class AskHumanAwaitingError extends Error {
  readonly name = 'AskHumanAwaitingError';
  constructor(
    readonly toolUseId: string,
    readonly nodeId: string,
    readonly workflowRunId: string
  ) {
    super(`AskHuman awaiting input for ${toolUseId}`);
  }
}

export class AskHumanNoStarterError extends Error {
  readonly name = 'AskHumanNoStarterError';
  constructor(readonly workflowRunId: string) {
    super(`AskHuman requires workflow_runs.user_id (run ${workflowRunId})`);
  }
}

export type AskHumanControlError = AskHumanAwaitingError | AskHumanNoStarterError;
```

`NativeTool.handler` is `(input: Record<string, unknown>, context?: NativeToolHandlerContext) => Promise<string>`.
Do not add a public `sessionIdSink` to `SendQueryOptions`; each provider owns a mutable per-attempt native-tool bridge because session discovery and abort control are provider concerns.
Use these local converter boundaries, with the runtime optional only to preserve existing non-Ask tests and callers:

```ts
interface ClaudeNativeToolRuntime {
  contextFor(toolName: string): NativeToolHandlerContext;
  onControlError(error: AskHumanControlError): void;
}

buildArchonMcpServer(
  nativeTools: NativeTool[],
  runtime?: ClaudeNativeToolRuntime
): McpSdkServerConfigWithInstance;

interface PiNativeToolRuntime {
  sessionId(): string | undefined;
  onControlError(error: AskHumanControlError): void;
}

buildPiNativeToolDefinitions(
  nativeTools: NativeTool[],
  defineTool: PiDefineTool,
  runtime?: PiNativeToolRuntime
): ToolDefinition[];
```

The Claude bridge stores the first non-empty `session_id` seen on any raw SDK message and the real `tool_use_id` from a `PreToolUse` hook matched to `mcp__archon__AskHuman`.
The Claude callback consumes that captured id, passes `{ toolUseId, sessionId }` to the handler, and never invents a replacement id.
If the Claude callback runs without the matching hook id or a non-empty session id, the AskHuman handler throws a normal tool error and persists nothing.
The Pi wrapper passes `_toolCallId` and the already-created `session.sessionId` as handler context.
When either wrapper catches `AskHumanAwaitingError` or `AskHumanNoStarterError`, it stores the same instance in its provider-local bridge and aborts the in-flight SDK operation.
Claude checks the bridge before generic aborted-query classification and before retry, and checks it again after a swallowed/clean iterator exit.
Pi checks the bridge after `bridgeSession` returns or throws, so a branded error still rejects `sendQuery` if Pi converted the tool rejection into an internal tool result.
Other handler throws are not stored in the control bridge and remain ordinary SDK tool errors.

Converters must accept, fail-fast otherwise:

- string
- string enum
- boolean
- array of strings
- array of objects whose fields are those types

Do not add `resumeInteractions` in this story.

### Executor

Inject `AskHuman` onto `command`, `prompt`, and `loop` sendQuery options when `getProviderCapabilities(provider).askHuman` is true.
Do not inject for bash, script, approval, plannotator_gate, workflow, route_loop, or loop_group containers.
Loop-group body command/prompt/loop nodes enter the existing executors and therefore receive the tool.
On `AskHumanAwaitingError`, handle the class before the existing abort/cancel and generic-error branches, call `pauseWorkflowRun(runId)` with no approval context, record a transcript lifecycle status of `awaiting`, emit live `node_awaiting`, skip `node_completed` and `node_failed`, skip `approval_pending`, and return `{ state: 'completed', output: nodeOutputText }`.
The command/prompt catch returns the text accumulated before the Ask.
The loop catch returns the text accumulated in the current iteration plus usage accumulated before the Ask and must not call `failLoopIteration`.
On `AskHumanNoStarterError`, take the existing node-failed path and do not pause.
Do not resume.

### CAP-7

Before any node runs, walk every `command` / `prompt` / `loop` node, including nested `loop_group` bodies, using the same scope inheritance as `collectContainerIncompatibleProviders`.
If `allowed_tools` contains `AskHuman` or `mcp__archon__AskHuman` after stripping a `Name(specifier)` suffix, and the resolved provider has `askHuman === false`, throw before the first turn:

```text
AskHuman is not supported by provider '<id>'. Remove AskHuman from allowed_tools, or use claude or pi.
```

The same workflow without that `allowed_tools` entry starts and has no Ask tool.
Build the `WorkflowModelScope` once near the start of `executeDagWorkflow`, run the AskHuman preflight unconditionally, and reuse that scope for the conditional container preflight.
Do not fail identity-less CLI runs at start.

### SSE

`node_awaiting` maps to `workflow_status` with `status: 'paused'` and no `approval` field and no envelope.
Add `node_awaiting` to `DASHBOARD_SOURCE_EVENT_TYPES`.
Both `mapWorkflowEvent` for the in-process emitter and `mapWorkflowEventRow` for the dashboard poller must produce the same refetch-only shape.
Live emitter payload is `{ type: 'node_awaiting', runId, nodeId }` only.

---

## Resolved Decisions

- Claude uses the real `PreToolUse.tool_use_id`; it never fabricates a pending-interaction id.
- Missing tool id or provider session id is a normal tool error and persists nothing.
- GET run returns pending, answered, and purged rows in store order, while the projector overlays only pending rows.
- Ask pause preserves any existing `metadata.approval` value by not touching metadata at all.
- Both `AskHuman` and `mcp__archon__AskHuman`, including a trailing permission-rule specifier, count as explicit CAP-7 names.
- PostgreSQL upgrade verification is mandatory before completion; if the local prerequisite is unavailable, the implementer must leave sprint status unchanged and obtain the CI result before marking the story done.
- No product or repository decision remains open for Story 6.2.

---

### Task 1: Add `awaiting` to node status enums and the projector

**Files:**

- Modify: `packages/workflows/src/schemas/workflow-run.ts`.
- Test: `packages/workflows/src/schemas.test.ts`.
- Modify: `packages/workflows/src/retry-state.ts`.
- Test: `packages/workflows/src/retry-state.test.ts`.

**Interfaces:**

- Consumes: current `projectLatestEffectiveNodeStates(events)` and `NodeState`.
- Produces: `NodeState` including `'awaiting'`; `projectLatestEffectiveNodeStates(events, pending?)`.

- [ ] **Step 1: Write the failing projector tests.**

Add this contract test to `packages/workflows/src/schemas.test.ts` and import `nodeOutputSchema`, `nodeStateSchema`, and `workflowStepStatusSchema` from `./schemas`:

```ts
test('awaiting is a projection state and not an executable NodeOutput state', () => {
  expect(nodeStateSchema.parse('awaiting')).toBe('awaiting');
  expect(workflowStepStatusSchema.parse('awaiting')).toBe('awaiting');
  expect(nodeOutputSchema.safeParse({ state: 'awaiting', output: '' }).success).toBe(false);
});
```

Append to `packages/workflows/src/retry-state.test.ts`:

```ts
test('maps node_awaiting to awaiting without completing the node', () => {
  const states = projectLatestEffectiveNodeStates([
    { event_type: 'node_started', step_name: 'review', data: {} },
    { event_type: 'node_awaiting', step_name: 'review', data: { node_id: 'review', tool_use_id: 'toolu_1', kind: 'ask' } },
  ]);
  expect(states.get('review')?.state).toBe('awaiting');
});

test('does not complete a node on interaction_resolved', () => {
  const states = projectLatestEffectiveNodeStates([
    { event_type: 'node_started', step_name: 'review', data: {} },
    { event_type: 'node_awaiting', step_name: 'review', data: { node_id: 'review' } },
    { event_type: 'interaction_resolved', step_name: 'review', data: { node_id: 'review', tool_use_id: 'toolu_1' } },
  ]);
  expect(states.get('review')?.state).toBe('awaiting');
});

test('pending rows overlay awaiting onto a running node', () => {
  const states = projectLatestEffectiveNodeStates(
    [{ event_type: 'node_started', step_name: 'review', data: {} }],
    [{ node_id: 'review', status: 'pending' }]
  );
  expect(states.get('review')?.state).toBe('awaiting');
});

test('answered pending rows do not overlay awaiting', () => {
  const states = projectLatestEffectiveNodeStates(
    [{ event_type: 'node_started', step_name: 'review', data: {} }],
    [{ node_id: 'review', status: 'answered' }]
  );
  expect(states.get('review')?.state).toBe('running');
});

```

- [ ] **Step 2: Run the tests and verify they fail.**

Run:

```bash
(cd packages/workflows && bun test src/schemas.test.ts)
(cd packages/workflows && bun test src/retry-state.test.ts)
```

Expected: FAIL because `awaiting` is not a `NodeState` and the function does not take pending rows.

- [ ] **Step 3: Add `awaiting` and implement the projector rules.**

In `packages/workflows/src/schemas/workflow-run.ts` change both enums to:

```ts
export const workflowStepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'awaiting',
]);

export const nodeStateSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'awaiting',
]);
```

Do not add `awaiting` to `workflowRunStatusSchema` or `nodeOutputSchema`.
Replace the compile-only assertion at the bottom of `workflow-run.ts` with:

```ts
type AssertNodeOutputStateIsNodeState = NodeOutput['state'] extends NodeState ? true : never;
const nodeOutputStateIsNodeState: AssertNodeOutputStateIsNodeState = true;
void nodeOutputStateIsNodeState;
```

Change `RetryNodeProjection.state` from `NodeOutput['state']` to `NodeState`.
Implement the event and pending overlay rules in the authoritative contract.
Import `NodeState` from `./schemas`.
Do not treat `interaction_resolved` as completion.

- [ ] **Step 4: Re-run the projector tests.**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/schemas/workflow-run.ts packages/workflows/src/schemas.test.ts packages/workflows/src/retry-state.ts packages/workflows/src/retry-state.test.ts
git commit -m "feat(workflows): project awaiting from node_awaiting and pending rows"
```

---

### Task 2: Make Ask pause optional-approval and idempotent

**Files:**

- Modify: `packages/workflows/src/store.ts`.
- Modify: `packages/core/src/db/workflows.ts`.
- Test: `packages/core/src/db/workflows.test.ts`.

**Interfaces:**

- Consumes: current required `pauseWorkflowRun(id, approvalContext, extraMetadata?)`.
- Produces: `pauseWorkflowRun(id, approvalContext?, extraMetadata?)`.

- [ ] **Step 1: Write the failing pause tests.**

Append inside `describe('pauseWorkflowRun')` in `packages/core/src/db/workflows.test.ts`:

```ts
test('Ask pause sets paused and does not write metadata', async () => {
  mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

  await pauseWorkflowRun('workflow-run-123', undefined, { source: 'ask' });

  const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
  expect(query).toContain("status = 'paused'");
  expect(query).toContain("AND status = 'running'");
  expect(query).not.toContain('metadata');
  expect(params).toEqual(['workflow-run-123']);
});

test('Ask pause succeeds when the run is already paused', async () => {
  mockQuery
    .mockResolvedValueOnce(createQueryResult([], 0))
    .mockResolvedValueOnce(createQueryResult([{ status: 'paused' }], 1));

  await pauseWorkflowRun('workflow-run-123');
});

test('Ask pause still throws when the run is completed', async () => {
  mockQuery
    .mockResolvedValueOnce(createQueryResult([], 0))
    .mockResolvedValueOnce(createQueryResult([{ status: 'completed' }], 1));

  await expect(pauseWorkflowRun('workflow-run-123')).rejects.toThrow(
    'not found or not in running state'
  );
});

test('gate pause still writes metadata.approval', async () => {
  mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

  await pauseWorkflowRun('workflow-run-123', {
    nodeId: 'review',
    message: 'Please review',
    type: 'approval',
  });

  const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
  const payload = JSON.parse(params[1] as string) as { approval: Record<string, unknown> };
  expect(payload.approval.nodeId).toBe('review');
  expect(payload.approval.resolved).toBeNull();
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

Run:

```bash
(cd packages/core && bun test src/db/workflows.test.ts)
```

Expected: FAIL because the second argument is required and every pause writes `metadata.approval`.

- [ ] **Step 3: Optionalize the port and implement Ask pause.**

Change `IWorkflowStore.pauseWorkflowRun` in `packages/workflows/src/store.ts` to `approvalContext?: ApprovalContext`.
In `packages/core/src/db/workflows.ts`, branch on `approvalContext === undefined` using the Ask pause contract.
The new branch is structurally:

```ts
if (approvalContext === undefined) {
  const result = await pool.query(
    "UPDATE remote_agent_workflow_runs SET status = 'paused' WHERE id = $1 AND status = 'running'",
    [id]
  );
  if (result.rowCount !== 0) return;
  const current = await pool.query<{ status: WorkflowRunStatus }>(
    'SELECT status FROM remote_agent_workflow_runs WHERE id = $1',
    [id]
  );
  if (current.rows[0]?.status === 'paused') return;
  throw new Error(`Workflow run not found or not in running state (id: ${id})`);
}
```

Keep the existing approval json-merge path byte-for-byte when context is provided, including the current throw on zero rows without a paused fallback.

- [ ] **Step 4: Re-run the pause tests.**

Run the command from Step 2.

Expected: PASS, including the older gate tests.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/store.ts packages/core/src/db/workflows.ts packages/core/src/db/workflows.test.ts
git commit -m "feat(core): pause Ask runs without writing metadata.approval"
```

---

### Task 3: Add `remote_agent_pending_interactions` additively

**Files:**

- Modify: `migrations/000_combined.sql`.
- Modify: `packages/core/src/db/adapters/sqlite.ts`.
- Modify: `packages/core/src/db/adapters/sqlite.test.ts`.
- Modify: `AGENTS.md`.
- Modify: `packages/core/src/db/bundled-schema.generated.ts` via generator only.

**Interfaces:**

- Consumes: table 22 `remote_agent_workflow_node_messages` placement.
- Produces: table 23 with 12 columns and unique `(workflow_run_id, tool_use_id)`.

- [ ] **Step 1: Write the failing fresh-schema test.**

Add beside the node-messages fresh-schema test in `packages/core/src/db/adapters/sqlite.test.ts`:

```ts
test('pending interactions table mirrors the Postgres contract', async () => {
  db = createTestDb();
  expect(raw_pragma(currentDbPath, 'remote_agent_pending_interactions').sort()).toEqual(
    [
      'answer',
      'created_at',
      'envelope',
      'id',
      'kind',
      'node_id',
      'provider_session_id',
      'resolved_at',
      'resolved_by',
      'status',
      'tool_use_id',
      'workflow_run_id',
    ].sort()
  );

  await db.query(
    `INSERT INTO remote_agent_conversations
       (id, platform_type, platform_conversation_id)
     VALUES ($1, $2, $3)`,
    ['conv-1', 'cli', 'conv-1']
  );
  await db.query(
    `INSERT INTO remote_agent_workflow_runs
       (id, workflow_name, conversation_id, user_message, status)
     VALUES ($1, $2, $3, $4, $5)`,
    ['run-1', 'test', 'conv-1', 'go', 'running']
  );
  const insert = [
    'pending-1',
    'run-1',
    'review',
    'toolu_1',
    'ask',
    'pending',
    JSON.stringify({ questions: [] }),
    'sess-1',
  ];
  await db.query(
    `INSERT INTO remote_agent_pending_interactions
       (id, workflow_run_id, node_id, tool_use_id, kind, status, envelope, provider_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    insert
  );
  await expect(
    db.query(
      `INSERT INTO remote_agent_pending_interactions
         (id, workflow_run_id, node_id, tool_use_id, kind, status, envelope, provider_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['pending-2', ...insert.slice(1)]
    )
  ).rejects.toThrow();
  await expect(
    db.query(
      `INSERT INTO remote_agent_pending_interactions
         (id, workflow_run_id, node_id, tool_use_id, kind, status, envelope, provider_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['pending-3', 'run-1', 'review', 'toolu_3', 'other', 'pending', '{}', 'sess-1']
    )
  ).rejects.toThrow();
  await expect(
    db.query(
      `INSERT INTO remote_agent_pending_interactions
         (id, workflow_run_id, node_id, tool_use_id, kind, status, envelope, provider_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['pending-4', 'run-1', 'review', 'toolu_4', 'ask', 'open', '{}', 'sess-1']
    )
  ).rejects.toThrow();
  await db.query('DELETE FROM remote_agent_workflow_runs WHERE id = $1', ['run-1']);
  const remaining = await db.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM remote_agent_pending_interactions',
    []
  );
  expect(Number(remaining.rows[0]?.count)).toBe(0);
});
```

Change `MIN_NON_AUTH_COLUMNS` from `169` to `181`.

- [ ] **Step 2: Run the schema tests and verify they fail.**

Run:

```bash
(cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts)
```

Expected: FAIL because the table does not exist and the parity floor is still 169.
The constraint and cascade assertions remain in the test after GREEN; they are behavior checks, not source-text checks.

- [ ] **Step 3: Add the table in both dialects.**

Update `migrations/000_combined.sql` header from 22 application tables to 23, listing `remote_agent_pending_interactions` as 23 and Better Auth as 24-27.
Place the PostgreSQL `CREATE TABLE` from the authoritative contract after `remote_agent_workflow_node_messages` and before `-- Indexes and column comments`.
Keep `COMMENT ON TABLE` beside the create.
Put every `COMMENT ON COLUMN` in the trailing section.
Do not add `CREATE INDEX`.

Mirror the table in `SqliteAdapter.createSchema` immediately after the node-messages table, using TEXT ids, TEXT json, TEXT timestamps, the same CHECKs, named unique constraint, and `ON DELETE CASCADE`.
Do not add the table to `migrateColumns`.

Update `AGENTS.md` so the application table count is 23, item 23 documents this table, and Better Auth tables are 24-27.

- [ ] **Step 4: Generate bundled schema and re-run schema tests.**

Run:

```bash
bun run generate:bundled-schema
(cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts)
```

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the schema tests from Step 4.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts packages/core/src/db/adapters/sqlite.test.ts packages/core/src/db/bundled-schema.generated.ts AGENTS.md
git commit -m "feat(db): add remote_agent_pending_interactions"
```

---

### Task 4: Insert and list pending rows in the same transaction as `node_awaiting`

**Files:**

- Modify: `packages/workflows/src/schemas/pending-interaction.ts`.
- Modify: `packages/workflows/src/schemas/pending-interaction.test.ts`.
- Create: `packages/core/src/schemas/pending-interaction.ts`.
- Modify: `packages/core/src/schemas/index.ts`.
- Create: `packages/core/src/db/workflow-pending-interactions.ts`.
- Test: `packages/core/src/db/workflow-pending-interactions.test.ts`.
- Modify: `packages/core/src/db/index.ts`.
- Modify: `packages/core/package.json`.
- Modify: `packages/providers/src/types.ts`.

**Interfaces:**

- Consumes: `pendingInteractionSchema`, `insertWorkflowEvent`, `AskHumanNoStarterError`.
- Produces: `insertPendingInteraction`, `listPendingInteractions`.

- [ ] **Step 1: Add insert schema tests first.**

Extend the existing import in `packages/workflows/src/schemas/pending-interaction.test.ts`, then append these cases:

```ts
import {
  insertPendingInteractionSchema,
  pendingInteractionSchema,
} from './pending-interaction';

test('insert schema accepts only caller-assigned fields', () => {
  const parsed = insertPendingInteractionSchema.parse({
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'toolu_1',
    kind: 'ask',
    envelope: { questions: [] },
    provider_session_id: 'sess-1',
  });
  expect(parsed.kind).toBe('ask');
  expect(
    insertPendingInteractionSchema.safeParse({ ...parsed, status: 'pending' }).success
  ).toBe(false);
});

test('insert schema rejects empty provider_session_id', () => {
  expect(
    insertPendingInteractionSchema.safeParse({
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      envelope: { questions: [] },
      provider_session_id: '',
    }).success
  ).toBe(false);
});
```

Do not add the schema implementation before observing RED.

Run:

```bash
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
```

Expected: FAIL because the insert schema is not exported.

- [ ] **Step 2: Write failing DB tests in an isolated file.**

Create `packages/core/src/db/workflow-pending-interactions.test.ts` against a real `new SqliteAdapter(':memory:')` and use the exact top-level `mock.module('./connection')` wiring from `workflow-node-messages.test.ts` so the production module receives that adapter, dialect, and database type.
Seed a user, a conversation, and a running workflow run with that `user_id` through SQL in `beforeEach`.
Retain the logger capture pattern from `workflow-node-messages.test.ts` so secret redaction is observable.
Cover all of these behaviors through the public store functions and real rows:

1. Insert returns a canonical pending row, and the table has exactly one `node_awaiting` event whose `step_name` is the node id and whose parsed `data` is exactly `{ node_id, tool_use_id, kind }` with no envelope, question, or answer.
2. A run whose `user_id` is null throws `AskHumanNoStarterError` and leaves both pending and event tables empty.
3. A missing run throws a normal `Error`, not `AskHumanNoStarterError`, and leaves both tables empty.
4. Install a temporary SQLite trigger that aborts `remote_agent_workflow_events` inserts, call `insertPendingInteraction`, prove the pending insert rolled back, and drop the trigger in `finally`; this is the atomicity assertion.
5. After setting the seeded run to `paused`, inserting another row with a different tool id succeeds; this proves already-paused runs can accumulate concurrent pending asks.
6. Reusing `(workflow_run_id, tool_use_id)` throws and leaves the original row unchanged.
7. `listPendingInteractions` orders equal or different timestamps by `created_at ASC, id ASC`.
8. A malformed envelope JSON row and a schema-invalid JSON row each throw `PendingInteractionCorruptRowError` whose message contains only the row id; captured logs must not contain the sentinel question or answer.

Do not replace these with SQL-string assertions, because the story depends on transaction rollback, constraints, canonical parsing, and redaction behavior.

- [ ] **Step 3: Run the new tests and verify they fail.**

Add this exact invocation to `packages/core/package.json` immediately after `bun test src/db/workflow-node-messages.test.ts`:

`&& bun test src/db/workflow-pending-interactions.test.ts`

Run:

```bash
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the DB module.**

Define `insertPendingInteractionSchema` with `pendingInteractionSchema.pick({...}).strict()` exactly as shown in the Store ports contract.
Export `InsertPendingInteractionInput` only as `z.infer<typeof insertPendingInteractionSchema>`; do not hand-write a parallel interface.
Create `packages/core/src/db/workflow-pending-interactions.ts` implementing the insert transaction contract.
Add `AskHumanNoStarterError`, `AskHumanAwaitingError`, and `AskHumanControlError` to `packages/providers/src/types.ts` using the exact declarations in Authoritative Contracts.
Import `AskHumanNoStarterError` from `@archon/providers/types`.
Parse the input before opening `pool.withTransaction`, then use only its transaction-scoped query for the lock, pending insert, `insertWorkflowEvent`, and inserted-row read.
Build the lock suffix locally as `getDatabaseType() === 'postgresql' ? ' FOR UPDATE' : ''`; do not import the private `rowLockClause()` from `workflows.ts`.
Use `getDialect().generateUuid()` for the row id.
Alias the engine schema from `packages/core/src/schemas/pending-interaction.ts` as `export { pendingInteractionSchema, insertPendingInteractionSchema, type PendingInteraction, type InsertPendingInteractionInput } from '@archon/workflows/schemas/pending-interaction';`.
Export namespaced `workflowPendingInteractionDb` and direct functions from `packages/core/src/db/index.ts` beside the node-message exports.
Convert SQLite JSON text before canonical parsing, preserve the adapter's accepted date-or-string timestamp values, and throw `PendingInteractionCorruptRowError(rowId)` on JSON or schema corruption.
Log only the corrupt row id and never log `envelope` or `answer`.

- [ ] **Step 5: Re-run the isolated DB tests.**

Run the command from Step 3.

Expected: PASS.
Also re-run `(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)`.

- [ ] **Step 6: Refactor while green.**

Do not add behavior.
Re-run the command from Step 3.
Re-run the schema test from Step 1.
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/workflows/src/schemas/pending-interaction.ts packages/workflows/src/schemas/pending-interaction.test.ts packages/core/src/schemas/pending-interaction.ts packages/core/src/schemas/index.ts packages/core/src/db/workflow-pending-interactions.ts packages/core/src/db/workflow-pending-interactions.test.ts packages/core/src/db/index.ts packages/core/package.json packages/providers/src/types.ts
git commit -m "feat(core): persist pending interactions with node_awaiting"
```

---

### Task 5: Expose pending ports on `IWorkflowStore`

**Files:**

- Modify: `packages/workflows/src/store.ts`.
- Modify: `packages/core/src/workflows/store-adapter.ts`.
- Modify: `packages/core/src/workflows/store-adapter.test.ts`.
- Modify: `packages/workflows/src/dag-executor.test.ts`.
- Modify: `packages/workflows/src/executor.test.ts`.
- Modify: `packages/workflows/src/executor-preamble.test.ts`.
- Modify: `packages/workflows/src/script-node-deps.test.ts`.
- Modify: `packages/workflows/src/subrun.test.ts`.

**Interfaces:**

- Consumes: `insertPendingInteraction` and `listPendingInteractions`.
- Produces: `IWorkflowStore` extending `IWorkflowPendingInteractionStore`.

- [ ] **Step 1: Write the failing adapter test.**

In `packages/core/src/workflows/store-adapter.test.ts`, extend `requiredMethods` with `'insertPendingInteraction'` and `'listPendingInteractions'`.
Add a mock.module for `../db/workflow-pending-interactions` before the adapter import, matching the node-messages mock.
Define `mockInsertPendingInteraction` and `mockListPendingInteractions`, then add behavior tests beside the existing node-message delegation tests.
The insert test must pass a complete `InsertPendingInteractionInput`, assert the DB mock received the same object, and assert the adapter returns the same row object.
The list test must call with `run-1`, assert exact argument forwarding, and assert the adapter returns the same ordered array.

- [ ] **Step 2: Run the adapter test and verify it fails.**

Run:

```bash
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
```

Expected: FAIL because `createWorkflowStore()` does not yet expose the methods.

- [ ] **Step 3: Add the narrow store capability and wire the adapter.**

In `packages/workflows/src/store.ts`:

```ts
export interface IWorkflowPendingInteractionStore {
  insertPendingInteraction(input: InsertPendingInteractionInput): Promise<PendingInteraction>;
  listPendingInteractions(workflowRunId: string): Promise<PendingInteraction[]>;
}
```

Extend `IWorkflowStore` with that interface beside `IWorkflowNodeMessageStore`.
Do not add `resolvePendingInteraction`.
Wire pass-throughs in `createWorkflowStore()`.
Add in-memory implementations to every typed `IWorkflowStore` double listed in Files.
`subrun.test.ts` `InMemoryStore` should store rows in an array and return them for the run.
Keep the adapter methods as direct delegations; do not add policy or parsing at this boundary.

- [ ] **Step 4: Re-run adapter and workflow store-double tests.**

Run:

```bash
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/workflows && bun test src/executor.test.ts)
(cd packages/workflows && bun test src/executor-preamble.test.ts)
(cd packages/workflows && bun test src/script-node-deps.test.ts)
(cd packages/workflows && bun test src/subrun.test.ts)
```

Expected: PASS, including TypeScript compile of the doubles.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the commands from Step 4.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/store.ts packages/workflows/src/dag-executor.test.ts packages/workflows/src/executor.test.ts packages/workflows/src/executor-preamble.test.ts packages/workflows/src/script-node-deps.test.ts packages/workflows/src/subrun.test.ts packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts
git commit -m "feat(workflows): add pending interaction store ports"
```

---

### Task 6: Embed pending rows on GET run and keep messages Ask-free

**Files:**

- Modify: `packages/server/src/routes/schemas/workflow.schemas.ts`.
- Modify: `packages/server/src/routes/api.ts`.
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`.
- Modify: `packages/web/src/lib/api.generated.d.ts` via generator only.

**Interfaces:**

- Consumes: `listPendingInteractions`, `projectLatestEffectiveNodeStates(events, pending)`.
- Produces: GET run `pending_interactions` from the table and `nodeStates[].status` including `awaiting`.

- [ ] **Step 1: Write the failing GET-run tests.**

In `packages/server/src/routes/api.workflow-runs.test.ts` add `mock.module('@archon/core/db/workflow-pending-interactions', () => ({ listPendingInteractions: mockListPendingInteractions }))`.
Reset `mockListPendingInteractions` to `[]` in the existing GET-run `beforeEach` so unrelated route cases remain isolated.
Replace the Story 5.1 test that expects a hardcoded empty array without a table with tests that:

1. Return listed rows through `pending_interactions`, with `created_at` and non-null `resolved_at` serialized as ISO strings and null `resolved_at` preserved.
2. Project `awaiting` when events include `node_started` plus a pending row for that node.
3. Keep `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` free of Ask envelopes in `status` payloads.
4. Keep OpenAPI `pending_interactions` required and `WorkflowNodeState.status` enum including `awaiting`.

The OpenAPI test must inspect the emitted `WorkflowNodeState` schema instead of only parsing the local Zod schema.

- [ ] **Step 2: Run the workflow-runs tests and verify the new cases fail.**

Run:

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
```

Expected: FAIL on embed contents and awaiting status.

- [ ] **Step 3: Implement GET-run wiring.**

Change `projectApiWorkflowNodeStates` to accept pending rows and pass `{ node_id, status }` into `projectLatestEffectiveNodeStates`.
Call `listPendingInteractions(runId)` in the GET-run handler and return those rows as `pending_interactions`.
Map every pending row to the API shape with `created_at: toISOString(row.created_at)` and `resolved_at: row.resolved_at ? toISOString(row.resolved_at) : null` before returning it.
Import `NodeState` for `ApiWorkflowNodeState.status`, and use `nodeStateSchema` directly for `workflowNodeStateSchema.status` instead of repeating a six-value enum.
Do not read pending data from transcript messages.
Do not rewrite `awaiting` in `settleApiWorkflowNodeStatesForRunStatus`.

- [ ] **Step 4: Re-run the route tests and regenerate web types.**

Run the command from Step 2.
In terminal A, start the server from the repository root:

```bash
bun run dev:server
```

After the server reports port 3090 ready, run this in terminal B from the repository root:

```bash
bun --filter @archon/web generate:types
```

Stop terminal A after generation completes.
Do not hand-edit `api.generated.d.ts`.

Expected: route tests PASS and generated `WorkflowNodeState` status includes `awaiting`.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the route tests from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts packages/web/src/lib/api.generated.d.ts
git commit -m "feat(server): embed pending interactions and awaiting node state"
```

---

### Task 7: Make `node_awaiting` a refetch trigger

**Files:**

- Modify: `packages/workflows/src/store.ts`.
- Modify: `packages/workflows/src/event-emitter.ts`.
- Test: `packages/workflows/src/event-emitter.test.ts`.
- Modify: `packages/server/src/adapters/web/workflow-bridge.ts`.
- Test: `packages/server/src/adapters/web/dashboard-event-poller.test.ts`.
- Test: `packages/server/src/adapters/web/workflow-bridge.test.ts`.

**Interfaces:**

- Consumes: `WORKFLOW_EVENT_TYPES`, `DASHBOARD_SOURCE_EVENT_TYPES`, `mapWorkflowEventRow`.
- Produces: `node_awaiting` and `interaction_resolved` event type names; SSE refetch without envelope.

- [ ] **Step 1: Write the failing SSE mapping test.**

In `packages/server/src/adapters/web/dashboard-event-poller.test.ts`:

```ts
test('node_awaiting → workflow_status paused without approval payload', () => {
  const e = JSON.parse(
    mapWorkflowEventRow(
      row({ event_type: 'node_awaiting', step_name: 'review', data: { node_id: 'review', tool_use_id: 'toolu_1', kind: 'ask' } })
    ) as string
  );
  expect(e).toMatchObject({ type: 'workflow_status', runId: 'r1', status: 'paused' });
  expect(e.approval).toBeUndefined();
  expect(e.envelope).toBeUndefined();
  expect(e.questions).toBeUndefined();
});
```

In `packages/server/src/adapters/web/workflow-bridge.test.ts`, add the equivalent assertion for `mapWorkflowEvent({ type: 'node_awaiting', runId: 'r1', nodeId: 'review' })`.
In `packages/workflows/src/event-emitter.test.ts`, subscribe to the run, emit `{ type: 'node_awaiting', runId: 'r1', nodeId: 'review' }`, and assert the listener receives that exact payload with no envelope or questions.

- [ ] **Step 2: Run the poller tests and verify they fail.**

Run:

```bash
(cd packages/workflows && bun test src/event-emitter.test.ts)
(cd packages/server && bun test src/adapters/web/dashboard-event-poller.test.ts)
(cd packages/server && bun test src/adapters/web/workflow-bridge.test.ts)
```

Expected: FAIL because the live event type and both mappings do not exist.

- [ ] **Step 3: Add event types and mapping.**

Append `'node_awaiting'` and `'interaction_resolved'` to `WORKFLOW_EVENT_TYPES`.
Add live emitter event `{ type: 'node_awaiting'; runId: string; nodeId: string }`.
Do not put `node_awaiting` in `ROW_WORKFLOW_STATUS` because that map cannot express `paused`.
Add a special case in `mapWorkflowEventRow` beside `approval_requested` that emits `workflow_status` with `status: 'paused'` and omits `approval`, `envelope`, and `questions`.
Append `'node_awaiting'` to `DASHBOARD_SOURCE_EVENT_TYPES`.
Add the equivalent special case in `mapWorkflowEvent` for the live event.
Do not map a card payload.
Do not emit or map `interaction_resolved` in Story 6.2; Story 6.3 owns that refetch path when it writes the event.

- [ ] **Step 4: Re-run the poller tests.**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/store.ts packages/workflows/src/event-emitter.ts packages/workflows/src/event-emitter.test.ts packages/server/src/adapters/web/workflow-bridge.ts packages/server/src/adapters/web/dashboard-event-poller.test.ts packages/server/src/adapters/web/workflow-bridge.test.ts
git commit -m "feat(server): treat node_awaiting as an SSE refetch trigger"
```

---

### Task 8: Convert `questions[]` and preserve branded tool errors at the converter boundary

**Files:**

- Modify: `packages/providers/src/types.ts`.
- Modify: `packages/providers/src/claude/native-tools.ts`.
- Test: `packages/providers/src/claude/native-tools.test.ts`.
- Modify: `packages/providers/src/community/pi/native-tools.ts`.
- Test: `packages/providers/src/community/pi/native-tools.test.ts`.

**Interfaces:**

- Consumes: flat JSON-schema converters and `NativeTool.handler(input)`.
- Produces: nested AskHuman schema conversion and `NativeTool.handler(input, context?)` while retaining `Promise<string>`.

- [ ] **Step 1: Write failing converter and callback tests.**

Use the exact `ASK_HUMAN_INPUT_SCHEMA` fixture from the Authoritative Contracts in both native-tools test files.
Extend the Claude SDK mock so `tool()` captures the registered callback and `createSdkMcpServer()` preserves the tool list.
Use Pi's existing `defineTool` seam to capture the `execute` callback.
Add these cases in both files:

1. The converter accepts `questions[]`, validates a valid nested value, rejects an empty questions array through `minItems: 1`, and rejects a question missing a required field.
2. A schema containing a number at the top level or inside a question still throws `/unsupported type/`.
3. The callback passes the supplied `{ toolUseId, sessionId }` to the NativeTool handler.
4. When a handler throws `AskHumanAwaitingError` or `AskHumanNoStarterError`, the local `onControlError` callback receives that exact instance and the tool callback rejects with the same instance.
5. A normal handler error rejects normally and is never reported to `onControlError`.

- [ ] **Step 2: Run the native-tools tests and verify they fail.**

```bash
(cd packages/providers && bun test src/claude/native-tools.test.ts)
(cd packages/providers && bun test src/community/pi/native-tools.test.ts)
```

Expected: FAIL because nested arrays, handler context, and branded-control reporting do not exist.

- [ ] **Step 3: Implement the narrow converter contracts.**

Add `NativeToolHandlerContext` and the optional context parameter from the Provider wrappers contract to `packages/providers/src/types.ts`.
Do not add a session sink or another public field to `SendQueryOptions`.
Extend each converter only for array-of-strings and array-of-objects whose fields recursively use the approved string, string-enum, boolean, or array-of-strings subset.
Preserve `minItems` on arrays when the canonical schema declares it.
Keep the Claude file on its documented direct `zod` import and keep the Pi file on TypeBox.
Give each build function a narrow provider-supplied runtime argument that returns context for the invocation and accepts a branded control error.
The Pi execution path must use its `_toolCallId`; the Claude context is populated by the provider in Task 9.
Catch only `AskHumanAwaitingError` and `AskHumanNoStarterError` to call `onControlError(error)`, then rethrow the same instance.
Let every other error follow the existing SDK tool-error behavior.

- [ ] **Step 4: Re-run the converter tests.**

Run the commands from Step 2.

Expected: PASS, including all existing flat `manage_run` conversion cases.

- [ ] **Step 5: Refactor while green.**

Keep the recursive converters small and fail-fast without introducing a general JSON Schema implementation.
Re-run the commands from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/providers/src/types.ts packages/providers/src/claude/native-tools.ts packages/providers/src/claude/native-tools.test.ts packages/providers/src/community/pi/native-tools.ts packages/providers/src/community/pi/native-tools.test.ts
git commit -m "feat(providers): pass AskHuman context through native tool converters"
```

---

### Task 9: Make Claude abort and reject with the same Ask control error

**Files:**

- Modify: `packages/providers/src/claude/provider.ts`.
- Test: `packages/providers/src/claude/provider.test.ts`.

**Interfaces:**

- Consumes: Claude raw-message `session_id`, `PreToolUse.tool_use_id`, and Task 8's converter runtime.
- Produces: one-attempt `sendQuery` rejection with the original branded error.

- [ ] **Step 1: Write the failing provider-level tests.**

Extend the Claude SDK mock in `provider.test.ts` with capturing `tool()` and `createSdkMcpServer()` functions.
Make the scripted `query()` yield a message with `session_id: 'sess-real'`, invoke the registered `PreToolUse` hook with `tool_name: 'mcp__archon__AskHuman'` and `tool_use_id: 'toolu_real'`, then invoke the captured MCP callback.
Use a NativeTool handler that asserts context equals `{ toolUseId: 'toolu_real', sessionId: 'sess-real' }` and throws a pre-created `AskHumanAwaitingError`.
Simulate both SDK outcomes seen in the spike: iterator abort rejection and a clean iterator exit after the callback rejection is swallowed.
In both cases, consume `sendQuery` and assert the rejection is `toBe(controlError)`, the SDK abort signal is aborted, and `query` is called once even when retry count permits more attempts.
Add a `AskHumanNoStarterError` case with the same identity/no-retry assertions.
Add a normal handler-error case in which the SDK mock catches the callback rejection, then assert the provider does not throw either Ask control class and does not take the control-error abort path.

- [ ] **Step 2: Run the Claude provider test and verify it fails.**

```bash
(cd packages/providers && bun test src/claude/provider.test.ts)
```

Expected: FAIL because the provider neither captures the real tool id nor prioritizes the branded error over abort/retry handling.

- [ ] **Step 3: Implement the per-attempt Claude bridge.**

Create the mutable bridge inside each `sendQuery` attempt, with slots for the first non-empty SDK `session_id`, the pending AskHuman `tool_use_id`, and the branded control error.
Compose a `PreToolUse` hook with existing hooks so only `mcp__archon__AskHuman` records its real `tool_use_id` and all existing hook behavior remains intact.
On every raw SDK message, capture the first non-empty `session_id` before mapping the message.
Build the MCP server with a runtime that consumes the captured Ask id for the Ask callback, supplies the captured session id, stores branded errors, and aborts the attempt controller.
Clear the captured Ask id when `contextFor('AskHuman')` consumes it so a later callback cannot reuse a stale SDK id.
Never generate or substitute a tool id.
Before generic abort classification, rate-limit classification, or retry, throw the stored control error.
Check once more after a clean iterator exit so SDK swallowing cannot turn an Ask into successful completion.

- [ ] **Step 4: Re-run the Claude provider test.**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Keep the bridge attempt-local and preserve the existing hook composition order.
Re-run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/providers/src/claude/provider.ts packages/providers/src/claude/provider.test.ts
git commit -m "feat(providers): surface Claude AskHuman control errors"
```

---

### Task 10: Make Pi abort and reject with the same Ask control error

**Files:**

- Modify: `packages/providers/src/community/pi/provider.ts`.
- Test: `packages/providers/src/community/pi/provider.test.ts`.

**Interfaces:**

- Consumes: Pi `_toolCallId`, `session.sessionId`, and Task 8's converter runtime.
- Produces: `sendQuery` rejection with the original branded error even when Pi swallows the tool rejection.

- [ ] **Step 1: Write the failing Pi provider-level tests.**

Extend the existing Pi `defineTool` mock so the test can invoke the AskHuman custom tool from inside `mockPrompt`.
Pass a NativeTool whose handler asserts `{ toolUseId: 'call-real', sessionId: 'mock-session-uuid' }` and throws a pre-created `AskHumanAwaitingError`.
Have `mockPrompt` catch the custom tool rejection and resolve, matching Pi's tool-error conversion behavior.
Consume `sendQuery` and assert the final error is `toBe(controlError)`, `session.abort()` ran, and `createAgentSession` ran once.
Repeat for `AskHumanNoStarterError`.
Add a normal handler-error case in which `mockPrompt` catches the callback rejection, then assert `sendQuery` has no stored Ask control error and the provider does not take the control-error abort path after `bridgeSession` returns.

- [ ] **Step 2: Run the Pi provider test and verify it fails.**

```bash
(cd packages/providers && bun test src/community/pi/provider.test.ts)
```

Expected: FAIL because Pi's current custom-tool path does not retain a branded error outside the SDK callback.

- [ ] **Step 3: Implement the per-session Pi bridge.**

Create a mutable control-error slot before building custom tool definitions.
Pass a runtime that closes over an initially undefined session reference into `buildPiNativeToolDefinitions`.
After `createAgentSession` returns, assign that session reference before `bridgeSession` or `session.prompt()` can run, so `sessionId()` reads the real non-empty `session.sessionId`.
Make `onControlError` store the exact error and call `void session.abort()` through the same reference.
Pass `_toolCallId` directly from the custom tool callback.
After `bridgeSession` returns or throws, check the control slot before classifying or returning, and throw the stored instance.
Do not change how normal tool errors are represented.

- [ ] **Step 4: Re-run the Pi provider test.**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Keep the bridge local to one `sendQuery` session and preserve existing dispose/abort ownership in `bridgeSession`.
Re-run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/providers/src/community/pi/provider.ts packages/providers/src/community/pi/provider.test.ts
git commit -m "feat(providers): surface Pi AskHuman control errors"
```

---

### Task 11: Add the `askHuman` capability axis

**Files:**

- Modify: `packages/providers/src/types.ts` to add `askHuman: boolean` on `ProviderCapabilities`.
- Modify: `packages/providers/src/claude/capabilities.ts`.
- Modify: `packages/providers/src/codex/capabilities.ts`.
- Modify: `packages/providers/src/grok/capabilities.ts`.
- Modify: `packages/providers/src/community/copilot/capabilities.ts`.
- Modify: `packages/providers/src/community/omp/capabilities.ts`.
- Modify: `packages/providers/src/community/opencode/capabilities.ts`.
- Modify: `packages/providers/src/community/pi/capabilities.ts`.
- Modify: `packages/providers/src/community/qodercli/capabilities.ts`.
- Modify: `packages/providers/src/e2e-fake/capabilities.ts`.
- Test: `packages/providers/src/registry.test.ts`.
- Test: `packages/providers/src/observability.test.ts`.
- Test: `packages/providers/src/claude/provider.test.ts`.
- Test: `packages/providers/src/community/pi/provider.test.ts`.
- Modify: `scripts/generate-capability-matrix.ts`.
- Modify: `packages/docs-web/src/content/docs/reference/provider-capabilities.md` via generator only.

**Interfaces:**

- Consumes: `ProviderCapabilities` without `askHuman`.
- Produces: `askHuman: true` only for Claude and Pi.

- [ ] **Step 1: Write the failing registry behavior test.**

Add this test to `packages/providers/src/registry.test.ts`:

```ts
test('only Claude and Pi advertise AskHuman', () => {
  registerCommunityProviders();
  const capable = getProviderInfoList()
    .filter(info => info.capabilities.askHuman)
    .map(info => info.id)
    .sort();
  expect(capable).toEqual(['claude', 'pi']);
});
```

Run:

```bash
(cd packages/providers && bun test src/registry.test.ts)
```

Expected: FAIL because no provider advertises `askHuman`.

- [ ] **Step 2: Add the typed capability field and verify totality also fails.**

Add `askHuman: boolean` to `ProviderCapabilities` in `packages/providers/src/types.ts` and do not yet add `AXES` or capability object fields.

Run:

```bash
bun run check:capability-matrix
```

Expected: FAIL because `askHuman` is missing from `AXES` or from provider objects.

- [ ] **Step 3: Set every flag and add the axis.**

Set `askHuman: true` in `packages/providers/src/claude/capabilities.ts` and `packages/providers/src/community/pi/capabilities.ts`.
Set `askHuman: false` in Codex, Grok, OpenCode, Copilot, OMP, QoderCLI, and e2e-fake capabilities.
Add `{ key: 'askHuman', label: 'AskHuman mid-turn questions' }` to `AXES`.
Update the typed capability helper literals in `observability.test.ts` and `registry.test.ts`.
Add `askHuman` expectations to the existing Claude and Pi capability assertions, but do not mechanically edit unrelated provider snapshots that compile from their production constants.

- [ ] **Step 4: Run the behavior test, regenerate the matrix, and re-check.**

Run:

```bash
(cd packages/providers && bun test src/registry.test.ts src/observability.test.ts)
bun run generate:capability-matrix
bun run check:capability-matrix
```

Expected: PASS, with Claude and Pi true and every other provider false.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the commands from Step 4.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/providers/src/types.ts packages/providers/src/claude/capabilities.ts packages/providers/src/community/pi/capabilities.ts packages/providers/src/codex/capabilities.ts packages/providers/src/grok/capabilities.ts packages/providers/src/community/opencode/capabilities.ts packages/providers/src/community/copilot/capabilities.ts packages/providers/src/community/omp/capabilities.ts packages/providers/src/community/qodercli/capabilities.ts packages/providers/src/e2e-fake/capabilities.ts scripts/generate-capability-matrix.ts packages/docs-web/src/content/docs/reference/provider-capabilities.md
git add packages/providers/src/observability.test.ts packages/providers/src/registry.test.ts packages/providers/src/claude/provider.test.ts packages/providers/src/community/pi/provider.test.ts
git commit -m "feat(providers): add askHuman capability axis"
```

---

### Task 12: Inject AskHuman, persist, throw, and pause without completing the node

**Files:**

- Create: `packages/workflows/src/ask-human.ts`.
- Test: `packages/workflows/src/ask-human.test.ts`.
- Modify: `packages/workflows/src/dag-executor.ts`.
- Test: `packages/workflows/src/dag-executor.test.ts`.
- Modify: `packages/workflows/package.json`.

**Interfaces:**

- Consumes: `insertPendingInteraction`, branded errors, `pauseWorkflowRun(id)`, `capabilities.askHuman`.
- Produces: workflow-owned `AskHuman` NativeTool injected on command/prompt/loop.

- [ ] **Step 1: Write failing AskHuman handler tests.**

Create `packages/workflows/src/ask-human.test.ts`:

```ts
import { beforeEach, describe, expect, test, mock } from 'bun:test';
import { AskHumanAwaitingError } from '@archon/providers/types';
import type { IWorkflowStore } from './store';

const infoLogs: unknown[][] = [];
mock.module('@archon/paths', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => infoLogs.push(args),
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

const { createAskHumanTool, ASK_HUMAN_INPUT_SCHEMA } = await import('./ask-human');

beforeEach(() => {
  infoLogs.length = 0;
});

const questions = [
  {
    id: 'q1',
    prompt: 'Ship it?',
    selection: 'single' as const,
    options: ['yes', 'no'],
    allowOther: false,
  },
];

function store(overrides: Partial<IWorkflowStore> = {}): IWorkflowStore {
  return {
    insertPendingInteraction: mock(async input => ({
      id: 'pending-1',
      status: 'pending' as const,
      answer: null,
      created_at: new Date(),
      resolved_at: null,
      resolved_by: null,
      ...input,
    })),
    listPendingInteractions: mock(async () => []),
    ...overrides,
  } as IWorkflowStore;
}

describe('AskHuman tool', () => {
  test('persists envelope without answer then throws AskHumanAwaitingError', async () => {
    const s = store();
    const tool = createAskHumanTool({
      store: s,
      workflowRunId: 'run-1',
      nodeId: 'review',
    });
    expect(tool.name).toBe('AskHuman');
    expect(tool.inputSchema).toBe(ASK_HUMAN_INPUT_SCHEMA);
    await expect(
      tool.handler({ questions }, { toolUseId: 'toolu_1', sessionId: 'sess-1' })
    ).rejects.toBeInstanceOf(AskHumanAwaitingError);
    expect(s.insertPendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      envelope: { questions },
      provider_session_id: 'sess-1',
    });
    expect(JSON.stringify(infoLogs)).toContain('workflow.ask_pending');
    expect(JSON.stringify(infoLogs)).toContain('toolu_1');
    expect(JSON.stringify(infoLogs)).not.toContain('Ship it?');
  });

  test('does not stringify invalid questions as awaiting', async () => {
    const s = store();
    const tool = createAskHumanTool({ store: s, workflowRunId: 'run-1', nodeId: 'review' });
    await expect(tool.handler({ questions: 'nope' }, { toolUseId: 'toolu_1', sessionId: 'sess-1' })).rejects.not.toBeInstanceOf(
      AskHumanAwaitingError
    );
    expect(s.insertPendingInteraction).not.toHaveBeenCalled();
  });

  test('requires the real tool-use id and provider session id', async () => {
    const s = store();
    const tool = createAskHumanTool({ store: s, workflowRunId: 'run-1', nodeId: 'review' });
    await expect(tool.handler({ questions }, { sessionId: 'sess-1' })).rejects.not.toBeInstanceOf(
      AskHumanAwaitingError
    );
    await expect(tool.handler({ questions }, { toolUseId: 'toolu_1' })).rejects.not.toBeInstanceOf(
      AskHumanAwaitingError
    );
    expect(s.insertPendingInteraction).not.toHaveBeenCalled();
  });
});
```

Add `&& bun test src/ask-human.test.ts` to `packages/workflows/package.json` immediately after `bun test src/node-transcript.test.ts`.

- [ ] **Step 2: Run the handler tests and verify they fail.**

Run:

```bash
(cd packages/workflows && bun test src/ask-human.test.ts)
```

Expected: FAIL because `ask-human.ts` does not exist.

- [ ] **Step 3: Implement `createAskHumanTool`.**

Create `packages/workflows/src/ask-human.ts` with `ASK_HUMAN_INPUT_SCHEMA`, name `AskHuman`, the exact description in the authoritative contract, and the persist-then-throw algorithm.
If `insertPendingInteraction` throws `AskHumanNoStarterError`, rethrow it unchanged.
Log `workflow.ask_pending` with ids only.
Use a Zod runtime schema for the handler input so `questions` is non-empty and every nested field and enum is checked before persistence; derive its TypeScript type with `z.infer`.

- [ ] **Step 4: Write failing executor tests, then implement injection.**

In `packages/workflows/src/dag-executor.test.ts`, add tests that use a provider fake whose `sendQuery` calls the injected NativeTool handler with valid questions and `{ toolUseId: 'toolu_1', sessionId: 'sess-1' }`.
Cover command and prompt nodes on Claude with a table-driven test, and assert `insertPendingInteraction` receives the exact row input.
For each asking node, assert `pauseWorkflowRun` is called with the run id as its only argument, the node return state is `completed`, the transcript gets lifecycle `{ state: 'awaiting' }`, and the live emitter receives only `{ type: 'node_awaiting', runId, nodeId }`.
Assert no `node_completed`, `node_failed`, `approval_requested`, or `approval_pending` event is written and no approval context is created.
Add a Codex command case asserting `nativeTools` is absent or empty.
Add a generic persist-error case and an `AskHumanNoStarterError` case asserting the normal node-failed path runs and `pauseWorkflowRun` does not.
Add a Pi loop case in which text and usage arrive before the Ask, then assert the loop returns completed with that accumulated text/usage, does not call `failLoopIteration`, and pauses without completing or failing the node.

Implement one helper in `dag-executor.ts` that returns the workflow-owned AskHuman tool only when `getProviderCapabilities(provider).askHuman` is true:

```ts
const nativeTools = capabilities.askHuman
  ? [createAskHumanTool({ store: deps.store, workflowRunId: workflowRun.id, nodeId: stepName })]
  : undefined;
```

Pass that value on command and prompt sends inside `executeNodeInternal` and on loop sends inside `executeLoopNode`.
Do not add a public session bridge option; Claude and Pi populate NativeTool context in Tasks 9 and 10.
In the command/prompt catch, handle `AskHumanAwaitingError` before the existing abort/cancel classifier and generic failed branch.
In the loop catch, handle it before `failLoopIteration`, preserving the current iteration's accumulated text and usage.
On the Ask path, pause without approval, append lifecycle `awaiting`, emit live `node_awaiting`, and return `{ state: 'completed', output: nodeOutputText }` without writing terminal or approval events.
Let `AskHumanNoStarterError` and every other persistence error use the existing failed path.

- [ ] **Step 5: Run handler and executor tests.**

Run:

```bash
(cd packages/workflows && bun test src/ask-human.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
```

Expected: PASS.
Fix any existing Claude option snapshots that break because `nativeTools` is now present by asserting AskHuman is included rather than deleting injection.

- [ ] **Step 6: Refactor while green.**

Do not add behavior.
Re-run the commands from Step 5.
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/workflows/src/ask-human.ts packages/workflows/src/ask-human.test.ts packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts packages/workflows/package.json
git commit -m "feat(workflows): persist AskHuman and pause without the approval slot"
```

---

### Task 13: Reject AskHuman on unsupported providers at run start and keep chat clean

**Files:**

- Modify: `packages/workflows/src/dag-executor.ts`.
- Modify: `packages/workflows/src/dag-executor.test.ts`.
- Modify: `packages/core/src/orchestrator/orchestrator-agent.test.ts`.

**Interfaces:**

- Consumes: `allowed_tools`, `capabilities.askHuman`, chat `nativeTools`.
- Produces: CAP-7 start throw; chat still injects only `manage_run`.

- [ ] **Step 1: Write failing CAP-7 and chat tests.**

First add table-driven unit cases for exported `collectAskHumanUnsupportedProviders`, using the existing preflight fixture builders.
Cover a top-level provider, inherited workflow provider, nested `loop_group` provider inheritance, group model scope, and a model alias resolved through `WorkflowModelScope`.
Across those scopes, prove all of these name rules: `AskHuman`, `mcp__archon__AskHuman`, and `AskHuman(allow)` match after `entry.split('(')[0].trim()`, while `denied_tools: ['AskHuman']`, unrelated tools, and workflows without explicit `allowed_tools` do not match.
Include command, prompt, and loop nodes, and prove a Claude or Pi resolved provider is not reported.
Expect unsupported provider ids to be returned once in deterministic sorted order.

Executor tests:

```ts
it('rejects Codex allowed_tools AskHuman before any sendQuery', async () => {
  const mockDeps = createMockDeps();
  mockGetAgentProviderDag.mockImplementation(() => ({
    sendQuery: mockSendQueryDag,
    getType: () => 'codex',
    getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
  }));
  await expect(
    executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'cap7-codex-ask',
        provider: 'codex',
        nodes: [{ id: 'review', prompt: 'ask', allowed_tools: ['AskHuman'] }],
      },
      makeWorkflowRun(),
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    )
  ).rejects.toThrow(/AskHuman is not supported by provider 'codex'/);
  expect(mockSendQueryDag.mock.calls.length).toBe(0);
});

it('starts the same Codex workflow when allowed_tools omits AskHuman', async () => {
  const mockDeps = createMockDeps();
  mockGetAgentProviderDag.mockImplementation(() => ({
    sendQuery: mockSendQueryDag,
    getType: () => 'codex',
    getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
  }));
  await executeDagWorkflow(
    mockDeps,
    createMockPlatform(),
    'conv-dag',
    testDir,
    {
      name: 'cap7-codex-ok',
      provider: 'codex',
      nodes: [{ id: 'review', prompt: 'no ask', allowed_tools: ['Read'] }],
    },
    makeWorkflowRun(),
    'codex',
    undefined,
    join(testDir, 'artifacts'),
    join(testDir, 'state'),
    join(testDir, 'logs'),
    'main',
    'docs/',
    minimalConfig
  );
  expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
  const optionsArg = mockSendQueryDag.mock.calls[0][3] as { nativeTools?: unknown };
  expect(optionsArg.nativeTools === undefined || (optionsArg.nativeTools as unknown[]).length === 0).toBe(true);
});

it('rejects mcp__archon__AskHuman on Grok at start', async () => {
  const mockDeps = createMockDeps();
  mockGetAgentProviderDag.mockImplementation(() => ({
    sendQuery: mockSendQueryDag,
    getType: () => 'grok',
    getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
  }));
  await expect(
    executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'cap7-grok-ask',
        provider: 'grok',
        nodes: [{ id: 'review', prompt: 'ask', allowed_tools: ['mcp__archon__AskHuman'] }],
      },
      makeWorkflowRun(),
      'grok',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    )
  ).rejects.toThrow(/AskHuman is not supported by provider 'grok'/);
  expect(mockSendQueryDag.mock.calls.length).toBe(0);
});
```

Follow existing dag-executor workflow fixtures for provider and `sendQuery` spies.
Place the preflight next to `collectContainerIncompatibleProviders`, before the first node, and always run it (not only for container exec).
Strip `Name(specifier)` the same way `validator.ts` strips permission-rule specifiers.

Chat test in `packages/core/src/orchestrator/orchestrator-agent.test.ts`, in the existing `nativeTools: true` Claude project-scoped fixture:

```ts
test('project-scoped nativeTools injects manage_run and not AskHuman', async () => {
  expect(requestOptions.nativeTools?.map((t: { name: string }) => t.name)).toEqual(['manage_run']);
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

Run:

```bash
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/core && bun test src/orchestrator/orchestrator-agent.test.ts)
```

Expected: the new collector and executor cases FAIL because no start-blocking AskHuman preflight exists, while the chat characterization case already PASSES.

- [ ] **Step 3: Implement CAP-7 preflight.**

Add `collectAskHumanUnsupportedProviders` that visits command/prompt/loop nodes and nested loop_group bodies.
Reuse `resolveNodeProviderForPreflight`, `resolveGroupModelScope`, and the passed `WorkflowModelScope`; do not reimplement provider/model/alias inheritance.
Normalize only entries in `allowed_tools` with `entry.split('(')[0].trim()` and compare the result to the two exact AskHuman names.
Ignore `denied_tools` and implicit model behavior.
If `allowed_tools` contains `AskHuman` or `mcp__archon__AskHuman` and `askHuman === false`, throw:

```text
AskHuman is not supported by provider '<id>'. Remove AskHuman from allowed_tools, or use claude or pi.
```

Build the outer `WorkflowModelScope` once near the start of `executeDagWorkflow`, call the Ask collector unconditionally before any node or `sendQuery`, and reuse the same scope in the conditional container-exec preflight.
Do not change load-time validator warnings into errors.
Do not add AskHuman to `orchestrator-agent.ts`.

- [ ] **Step 4: Re-run CAP-7 and chat tests.**

Run the commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the commands from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts packages/core/src/orchestrator/orchestrator-agent.test.ts
git commit -m "feat(workflows): reject AskHuman on providers that cannot ask"
```

---

### Task 14: Validate the story and mark sprint status done

**Files:**

- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after the gate passes.

**Interfaces:**

- Consumes: every prior task.
- Produces: Story 6.2 sprint key `done`.

- [ ] **Step 1: Run focused package tests.**

```bash
(cd packages/workflows && bun test src/schemas.test.ts)
(cd packages/workflows && bun test src/retry-state.test.ts)
(cd packages/workflows && bun test src/ask-human.test.ts)
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/workflows && bun test src/event-emitter.test.ts)
(cd packages/workflows && bun test src/executor.test.ts)
(cd packages/workflows && bun test src/executor-preamble.test.ts)
(cd packages/workflows && bun test src/script-node-deps.test.ts)
(cd packages/workflows && bun test src/subrun.test.ts)
(cd packages/core && bun test src/db/workflows.test.ts)
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
(cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts)
(cd packages/core && bun test src/db/bundled-schema.test.ts)
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
(cd packages/core && bun test src/orchestrator/orchestrator-agent.test.ts)
(cd packages/providers && bun test src/claude/native-tools.test.ts)
(cd packages/providers && bun test src/community/pi/native-tools.test.ts)
(cd packages/providers && bun test src/claude/provider.test.ts)
(cd packages/providers && bun test src/community/pi/provider.test.ts)
(cd packages/providers && bun test src/registry.test.ts)
(cd packages/providers && bun test src/observability.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/server && bun test src/adapters/web/dashboard-event-poller.test.ts)
(cd packages/server && bun test src/adapters/web/workflow-bridge.test.ts)
```

Expected: all PASS.
Keep `workflow-pending-interactions.test.ts` and each provider mock-heavy file in its own Bun process exactly as shown; do not combine them into another test file's process.

- [ ] **Step 2: Regenerate and check generated artifacts.**

```bash
bun run generate:bundled-schema
bun run generate:capability-matrix
bun run check:bundled-schema
bun run check:capability-matrix
```

Expected: generators produce no unexplained drift and both checks PASS.
If either generator changes a tracked artifact, commit that generated change with its owning task before continuing.

- [ ] **Step 3: Prove additive PostgreSQL upgrades.**

Start the repository's PostgreSQL service if an external test database is not already configured:

```bash
docker-compose --profile with-db up -d postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/remote_coding_agent bun run check:schema-upgrades
```

If `POSTGRES_PASSWORD` was overridden, use the matching password in `DATABASE_URL`.
Expected: every shipped schema baseline upgrades, reapplies idempotently, and matches a fresh database except the one documented constraint exception enforced by the script.
This gate is mandatory; if Docker and an external PostgreSQL are both unavailable, leave sprint status unchanged until the repository CI `check:schema-upgrades` job passes for the implementation branch.

- [ ] **Step 4: Run full validation.**

```bash
bun run validate
```

Expected: PASS, including `check:bundled-schema` and `check:capability-matrix`.

- [ ] **Step 5: Confirm Story 6.2 acceptance criteria.**

- Table exists on SQLite and Postgres, additive, comments trailing.
- `pendingInteractionSchema` remains the server source.
- Columns match AD-1.
- Ports `insertPendingInteraction` and `listPendingInteractions` exist.
- Ask pause does not write `metadata.approval` and is idempotent when already paused.
- `awaiting` exists on node/step/server node-state enums.
- Run status stays `paused`.
- AskHuman injects on Claude/Pi command/prompt/loop with no YAML field.
- Handler persists then throws `AskHumanAwaitingError`.
- Claude and Pi wrappers reject `sendQuery` with the same branded instance, abort the SDK operation, and do not retry or stringify it.
- Claude stores the real PreToolUse tool id and a real SDK session id; Pi passes the real execute call id and session id.
- Missing tool or session ids persist nothing and are never replaced with fabricated ids.
- Converters accept `questions[]`.
- `askHuman` is true only for Claude and Pi.
- `NativeTool.handler` is still `Promise<string>`.
- `SendQueryOptions` has no public session-id sink.
- Chat orchestrator does not inject AskHuman.
- `AskUserQuestion` is not wrapped.
- GET run embeds pending rows and projects `awaiting`.
- `node_awaiting` is same-transaction as insert.
- SSE `node_awaiting` is a refetch trigger.
- Messages GET has no Ask cards in status rows.
- Persist fails when `user_id` is null without failing every identity-less start.
- `allowed_tools` naming AskHuman on Codex/Grok/OpenCode/Copilot is rejected before a turn.
- The same workflow without that entry starts with no Ask tool.
- `workflow.ask_pending` is logged without answer bodies.

- [ ] **Step 6: Mark sprint status done and commit.**

Set `6-2-pause-a-run-when-the-agent-asks-without-stealing-the-approval-slot: done` in `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.
Update `last_updated`.
Do not mark later 6.x stories done.
Do not perform this step unless both Step 3 and Step 4 passed.

```bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark workflow-run-view-hitl story 6.2 done"
```

---

## Acceptance Criteria

- [ ] Story 6.2 acceptance criteria in `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` are satisfied.
- [ ] Focused tests listed in Task 14 exist and pass.
- [ ] `bun run check:schema-upgrades` passes against PostgreSQL locally or in the implementation branch's required CI job.
- [ ] `bun run validate` passes.
- [ ] `6-2-pause-a-run-when-the-agent-asks-without-stealing-the-approval-slot` is `done` only after the criteria above pass.
- [ ] No Ask card, answer POST, or provider resume mapper shipped.

## Validation Commands

```bash
(cd packages/workflows && bun test src/schemas.test.ts)
(cd packages/workflows && bun test src/retry-state.test.ts)
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
(cd packages/workflows && bun test src/ask-human.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/workflows && bun test src/event-emitter.test.ts)
(cd packages/core && bun test src/db/workflows.test.ts)
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
(cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts)
(cd packages/core && bun test src/db/bundled-schema.test.ts)
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
(cd packages/core && bun test src/orchestrator/orchestrator-agent.test.ts)
(cd packages/providers && bun test src/claude/native-tools.test.ts)
(cd packages/providers && bun test src/community/pi/native-tools.test.ts)
(cd packages/providers && bun test src/claude/provider.test.ts)
(cd packages/providers && bun test src/community/pi/provider.test.ts)
(cd packages/providers && bun test src/registry.test.ts src/observability.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/server && bun test src/adapters/web/dashboard-event-poller.test.ts)
(cd packages/server && bun test src/adapters/web/workflow-bridge.test.ts)
bun run generate:bundled-schema
bun run generate:capability-matrix
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/remote_coding_agent bun run check:schema-upgrades
bun run validate
```

Do not run `bun test` from the repository root.
