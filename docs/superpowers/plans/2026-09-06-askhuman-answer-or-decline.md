# Answer or Decline the Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.
> Track each checkbox in order, and do not combine RED, GREEN, REFACTOR, or commit steps.

**Goal:** Let the authenticated run starter submit one valid AskHuman answer set or decline exactly once, atomically resume after the last pending Ask, and continue the interrupted Claude or Pi session without putting answers into the executor prompt.

**Architecture:** `answerAskHuman` in `workflow-operations.ts` is the only application-level Ask-resume owner.
Its single persistence call resolves one pending row and, when no pending row remains, invokes a query-scoped resume compare-and-swap inside that same database transaction.
A new database helper holds the shared resume SQL so the public `resumeWorkflowRun` path and the Ask transaction cannot drift or import each other.
The executor never changes the run from `paused` to `running` for AskHuman.
After the operation-owned transaction has already made the run `running`, hydrate recognizes answered interactions and re-enters each unfinished asking node.
The pending row's `provider_session_id` overrides sequential and persisted-session cursors.
Claude resumes with one provider-owned user message and `forkSession: false`.
Pi reopens the required session, durably appends matching `ToolResultMessage` rows, constructs the agent session, and calls `session.agent.continue()`.
Cancel and failure transitions purge unresolved rows in the same transaction that wins the terminal status change.
`interaction_resolved` remains an identifier-only refetch signal and never carries the envelope or answer.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi`, SQLite and PostgreSQL, OpenAPIHono, Bun Test, Claude Agent SDK `0.3.209`, and Pi `0.80.6`.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.3.

**Approved design inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/.memlog.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md`, and `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md`.

**Issue:** https://github.com/anhle128/Archon/issues/88

## Global Constraints

- Story 6.1 and Story 6.2 are complete prerequisites, and this plan must preserve their characterization coverage.
- The Ask answer route is `POST /api/workflows/runs/{runId}/ask/{requestId}/answer`, where `requestId` is `tool_use_id`.
- The route must use `registerOpenApiRoute(createRoute(...), handler)`.
- Only the identity in `workflow_runs.user_id` may answer, and an admin is not an override.
- A request without a resolved identity is `401` even when the installation API gate is disabled.
- A pending Ask cannot exist for an unowned run because Story 6.2 already throws `AskHumanNoStarterError` before insert.
- First write wins, and a second answer or decline returns `409` without changing the original answer.
- Ask answers remain in the `answer` JSON column as the submitted object.
- Decline remains `{ decline: true }` in storage and becomes the string `"declined"` only in `resumeInteractions`.
- The executor must not concatenate, interpolate, or append answers to a node prompt.
- The executor must not call `resumeWorkflowRun` for an Ask pause.
- Ask pause and resume must not write `metadata.approval`.
- Run status remains `paused` or `running`, and no `awaiting` run status is added.
- An asking node must not receive `node_completed` until the continued provider turn finishes.
- The run must remain paused while any `status = 'pending'` interaction exists on that run.
- The wait is indefinite, with no timeout, auto-answer, or default selection.
- `NativeTool.handler` remains `(input, context?) => Promise<string>`.
- `pendingInteractionSchema` remains the canonical row schema in `packages/workflows/src/schemas/pending-interaction.ts`.
- Server route schemas must import and decorate engine schemas instead of copying them.
- `interaction_resolved` is already a `WORKFLOW_EVENT_TYPES` value and must not be added a second time.
- `Claude` must stay pinned to `0.3.209`.
- Pi must stay on lockfile version `0.80.6` and must call `session.agent.continue()` rather than `AgentSession.continue()`.
- No `any` type is permitted.
- Every added or changed `mock.module()` factory must expose all runtime exports imported by the module under test.
- Each test file that uses `mock.module()` must run in its package's existing isolated process.
- Do not run unscoped `bun test` from the repository root.
- Do not add migrations because Story 6.2 already shipped the pending-interaction table and event type.
- Do not modify `packages/core/src/schemas/pending-interaction.ts`, `packages/core/src/schemas/index.ts`, `packages/core/src/db/index.ts`, or `packages/core/src/handlers/command-handler.ts`.
- Do not add a purge method to `IWorkflowPendingInteractionStore` because purge is an internal lifecycle primitive, not an engine capability.
- Do not implement Ask cards, composer controls, teammate copy, or the Permission confirmation route.
- Do not add CLI, chat, or `manage_run` answer commands.
- Do not add a workflow YAML field or parse assistant prose as an Ask.
- Each behavior slice must follow RED, observed expected failure, minimal GREEN, explicit REFACTOR, focused GREEN, and commit.
- Each full Markdown sentence in this plan must remain on its own physical line.

## Verified Repository Baseline

- `packages/workflows/src/ask-human.ts` owns AskHuman and already persists before throwing `AskHumanAwaitingError`.
- `packages/core/src/db/workflow-pending-interactions.ts` already inserts and lists canonical rows in `created_at ASC, id ASC` order.
- `packages/core/src/db/workflows.ts` currently owns `resumeWorkflowRun`, `cancelWorkflowRun`, `cancelRecoveryWorkflowRun`, `resolveAndCancelApprovalGate`, `failWorkflowRun`, and `failOrphanedRuns`.
- `resumeWorkflowRun` currently opens its own transaction, so it cannot be called directly from the pending-row transaction.
- Importing `workflows.ts` from `workflow-pending-interactions.ts` and importing purge logic in the reverse direction would create a cycle.
- `IWorkflowPendingInteractionStore` currently contains only insert and list.
- `resumeWorkflow` in `packages/core/src/operations/workflow-operations.ts` rejects every `running` run.
- `inspectResumableRun` returns `null` for a first-node Ask because there can be zero `node_completed` events.
- `executeNodeInternal` currently forces `forkSession: true` whenever a resume session id exists.
- `runLayers` currently lets sequential and `persist_session` cursors replace the session id.
- `executeLoopNode` currently has no Ask-specific resume input.
- Claude currently passes the executor prompt unchanged to `query({ prompt, options })`.
- Pi currently creates a fresh session after a missing resume id and always begins with `session.prompt(prompt)`.
- `bridgeSession` already owns subscription, abort, queue, and `dispose()` cleanup.
- `packages/providers/src/community/pi/askhuman-resume.characterization.test.ts` proves reopen, append, create, and `agent.continue()` at the pinned Pi version.
- `node_awaiting` already maps to paused SSE state, while `interaction_resolved` has no live or persisted SSE mapping.
- Story 6.2 already rejects Ask insertion when `workflow_runs.user_id` is null.
- The current worktree has no database schema change for Story 6.3.

## File Map

### Create

- Create `packages/core/src/db/workflow-resume-transition.ts` for the query-scoped resume primitive and shared transaction query type.

### Modify for contracts

- Modify `packages/providers/src/types.ts` for `ResumeInteraction` and `SendQueryOptions.resumeInteractions`.
- Modify `packages/workflows/src/schemas/pending-interaction.ts` for answer, resolve-input, and resolve-result schemas.
- Modify `packages/workflows/src/schemas/pending-interaction.test.ts` for exact schema behavior.
- Modify `packages/workflows/src/ask-human.ts` to import the canonical question schema without changing its accepted shape.

### Modify for persistence and operations

- Modify `packages/core/src/db/workflow-pending-interactions.ts` for answer validation, first-write CAS, atomic last-pending resume, and transaction-scoped purge.
- Modify `packages/core/src/db/workflow-pending-interactions.test.ts` for real-SQLite answer and purge behavior.
- Modify `packages/core/src/db/workflows.ts` to reuse the shared resume primitive and call purge from every in-scope cancel or failure transition.
- Modify `packages/core/src/db/workflows.test.ts` for mocked transaction ordering and no-op behavior.
- Modify `packages/core/src/db/workflows.resume-cas.integration.test.ts` to preserve the real-SQLite public resume behavior after extraction.
- Modify `packages/workflows/src/store.ts` to add only `resolvePendingInteraction` to `IWorkflowPendingInteractionStore`.
- Modify `packages/core/src/workflows/store-adapter.ts` and `packages/core/src/workflows/store-adapter.test.ts` for delegation.
- Modify `packages/workflows/src/ask-human.test.ts`, `packages/workflows/src/dag-executor.test.ts`, `packages/workflows/src/executor.test.ts`, `packages/workflows/src/executor-preamble.test.ts`, `packages/workflows/src/plannotator-gate-executor.test.ts`, `packages/workflows/src/plannotator-gate-supervisor.test.ts`, `packages/workflows/src/script-node-deps.test.ts`, and `packages/workflows/src/subrun.test.ts` so every concrete `IWorkflowStore` double implements the new method.
- Modify `packages/core/src/operations/workflow-operations.ts` and `packages/core/src/operations/workflow-operations.test.ts` for starter authorization, resolution ownership, safe logs, and the already-running Ask dispatch case.

### Modify for HTTP and events

- Modify `packages/server/src/routes/schemas/workflow.schemas.ts` for the OpenAPI request schema.
- Modify `packages/server/src/routes/api.ts` for the registered POST route and Ask auto-dispatch action.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts` for HTTP status, auth, and auto-dispatch behavior.
- Modify `packages/workflows/src/event-emitter.ts` and `packages/workflows/src/event-emitter.test.ts` for the live refetch event.
- Modify `packages/server/src/adapters/web/workflow-bridge.ts`, `packages/server/src/adapters/web/workflow-bridge.test.ts`, and `packages/server/src/adapters/web/dashboard-event-poller.test.ts` for live and persisted refetch mapping.
- Modify `packages/adapters/src/chat/slack/workflow-bridge.ts` and `packages/adapters/src/chat/slack/workflow-bridge.test.ts` to keep the exhaustive switch silent for this web-only signal.

### Modify for executor and providers

- Modify `packages/workflows/src/executor.ts` and `packages/workflows/src/executor.test.ts` for first-node Ask inspection and hydrate-when-running.
- Modify `packages/workflows/src/dag-executor.ts` and `packages/workflows/src/dag-executor.test.ts` for ordered per-node re-entry, session precedence, prompt isolation, and safe failure.
- Modify `packages/providers/src/claude/provider.ts` and `packages/providers/src/claude/provider.test.ts` for one same-session user message and sanitized failure logging.
- Modify `packages/providers/src/community/pi/session-resolver.ts` and `packages/providers/src/community/pi/session-resolver.test.ts` for required-session resolution.
- Modify `packages/providers/src/community/pi/event-bridge.ts` and `packages/providers/src/community/pi/event-bridge.test.ts` for a continue start mode.
- Modify `packages/providers/src/community/pi/provider.ts` and `packages/providers/src/community/pi/provider.test.ts` for durable tool-result injection and no cold fallback.

### Modify at completion

- Regenerate `packages/web/src/lib/api.generated.d.ts` only through the existing generator.
- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after every validation gate passes.

## Authoritative Contracts

### Request and response

The route is `POST /api/workflows/runs/{runId}/ask/{requestId}/answer`.

The engine-owned request schemas are:

```ts
export const askAnswerItemSchema = z
  .object({
    questionId: z.string().min(1),
    value: z.union([z.string(), z.array(z.string())]),
  })
  .strict();

export const askAnswerBodySchema = z.union([
  z.object({ answers: z.array(askAnswerItemSchema).min(1) }).strict(),
  z.object({ decline: z.literal(true) }).strict(),
]);

export type AskAnswerBody = z.infer<typeof askAnswerBodySchema>;
```

The route returns `200` with `workflowRunActionResponseSchema` after a winning write.

The route returns `400` for invalid JSON, a mixed union body, empty answers, duplicate or unknown question ids, a missing question id, a selection/value type mismatch, an invalid option, whitespace-only Other text, or `kind !== 'ask'`.

The route returns `401` when `resolveAuthContext` returns no requester.

The route returns `403` when the requester id differs from `workflow_runs.user_id`, including for an admin.

The route returns `404` when the run or `(runId, requestId)` row is missing.

The route returns `409` when the row is not pending or the run is not yet paused.

The route returns `500` for an unexpected operation or database error.

The operation succeeds before auto-dispatch, so a failed auto-dispatch is logged and the HTTP write still returns `200`.

### Stored answer and provider payload

The stored answer remains one of these two objects:

```ts
{ answers: Array<{ questionId: string; value: string | string[] }> }
{ decline: true }
```

The provider contract is:

```ts
export interface ResumeInteraction {
  tool_use_id: string;
  payload: unknown;
  declined: boolean;
}

export interface SendQueryOptions extends AgentRequestOptions {
  nodeConfig?: NodeConfig;
  assistantConfig?: Record<string, unknown>;
  execContext?: ExecutionContext;
  resumeInteractions?: readonly ResumeInteraction[];
}
```

An answers row maps to `{ tool_use_id, payload: answer.answers, declined: false }`.

A decline row maps to `{ tool_use_id, payload: 'declined', declined: true }`.

Rows are passed in the existing `created_at ASC, id ASC` store order for each node.

### Semantic answer validation

The shape parser uses `safeParse` before opening the database transaction and converts failure to `PendingInteractionValidationError('invalid_body')` without serializing the input.

The semantic validator runs after locking and parsing the stored row so it validates against the authoritative envelope.

The validator parses `envelope.questions` with `askHumanQuestionSchema` exported from `packages/workflows/src/schemas/pending-interaction.ts`.

Every envelope question id must occur exactly once in `answers`.

No answer may use an id absent from the envelope.

Duplicate answer ids are invalid.

A `single` question requires one string value.

A `multi` question requires a non-empty string array.

Each submitted string is valid when it exactly equals an item in `options`.

A string outside `options` is valid only when `allowOther` is true and `value.trim()` is non-empty.

Decline bypasses per-question validation.

The semantic validator must throw `PendingInteractionValidationError` with a safe code and must not include the envelope, prompt, options, or answer in the error message.

### Resolve schemas

The persistence boundary uses these engine-derived schemas:

```ts
export const resolvePendingInteractionInputSchema = z
  .object({
    workflow_run_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    answer: askAnswerBodySchema,
    resolved_by: z.string().min(1),
  })
  .strict();

export const resolvePendingInteractionResultSchema = z
  .object({
    interaction: pendingInteractionSchema,
    resumed: z.boolean(),
    remaining_pending: z.number().int().nonnegative(),
  })
  .strict();

export type ResolvePendingInteractionInput = z.infer<
  typeof resolvePendingInteractionInputSchema
>;
export type ResolvePendingInteractionResult = z.infer<
  typeof resolvePendingInteractionResultSchema
>;
```

### Transaction ownership and locking

`packages/core/src/db/workflow-resume-transition.ts` exports the minimal shared types and primitive:

```ts
export type WorkflowTransactionQuery = <T>(
  sql: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

export type ResumeEligibility = 'standard' | 'paused-ask';

export const ORPHAN_RESUME_STALE_DAYS = 1;

export function resumableWorkflowStatusClause(
  dialect: SqlDialect,
  dayParamIndex: number
): string;

export function workflowRunLockClause(): string;

export async function resumeWorkflowRunInTransaction(
  query: WorkflowTransactionQuery,
  id: string,
  dialect: SqlDialect,
  eligibility: ResumeEligibility
): Promise<{ resumed: boolean }>;
```

The helper owns the resume `UPDATE`, metadata-error clear, last-activity timestamps, and conditional `workflow_resumed` audit write that currently live in `resumeWorkflowRun`.

`workflows.ts` imports the shared stale-day constant, status clause, and lock clause for every existing caller that currently uses its private copies.

`eligibility: 'standard'` preserves the current failed, paused, cancelled, or stale-running predicate.

`eligibility: 'paused-ask'` matches only `status = 'paused'` and prevents an answer from resurrecting a cancelled or failed run.

`resumeWorkflowRun` continues to own its public transaction, CAS-miss probe, typed `WorkflowNotResumableError`, final select, logging, and return normalization.

`resolvePendingInteraction` owns one `withTransaction` and performs these actions in order:

1. Lock the run row with `FOR UPDATE` on PostgreSQL and the existing SQLite transaction semantics.
2. Throw a typed not-found error when the run is missing.
3. Lock the interaction selected by `workflow_run_id` and `tool_use_id`.
4. Throw `PendingInteractionNotFoundError` when the interaction is missing.
5. Throw `PendingInteractionAlreadyResolvedError` when its status is not `pending`.
6. Throw `PendingInteractionRunNotPausedError` when the run is not `paused`.
7. Parse the canonical row and reject `kind !== 'ask'`.
8. Validate the submitted body against the stored envelope.
9. Compare-and-swap the row from `pending` to `answered` while setting `answer`, `resolved_at`, and `resolved_by`.
10. Treat a zero-row update as `PendingInteractionAlreadyResolvedError`.
11. Count remaining `pending` rows for the whole run.
12. Invoke `resumeWorkflowRunInTransaction(..., 'paused-ask')` only when the count is zero.
13. Require the resume CAS to win or throw a safe conflict that rolls the row update back.
14. Insert `interaction_resolved` with `step_name = node_id` and non-sensitive data after the resume result is known.
15. Re-read and parse the resolved interaction.
16. Return the canonical result.

The persisted event data is:

```ts
{
  node_id: string;
  tool_use_id: string;
  kind: 'ask';
  declined: boolean;
  resumed: boolean;
}
```

The call chain `answerAskHuman -> resolvePendingInteraction -> resumeWorkflowRunInTransaction` is the only Ask-resume path.

The executor and route must never invoke the query-scoped primitive.

### Purge on terminal transitions

`purgePendingInteractionsInTransaction` remains exported only from the core database module for lifecycle callers.

Its signature is:

```ts
export async function purgePendingInteractionsInTransaction(
  query: WorkflowTransactionQuery,
  workflowRunId: string,
  terminalStatus: 'failed' | 'cancelled'
): Promise<{ purged: number }>;
```

It selects the run's pending rows in store order, changes only those rows to `purged`, sets `resolved_at`, leaves `answer` and `resolved_by` null, and inserts one `interaction_resolved` audit row per purged interaction.

A purge event contains ids, `kind`, `purged: true`, `resumed: false`, and `terminal_status`, but no envelope or answer.

The following winning status transitions call the helper inside their existing or newly added transaction:

- `resolveAndCancelApprovalGate` calls it after its guarded cancel update and approval events.
- `cancelWorkflowRun` calls it after its guarded cancel update.
- `cancelRecoveryWorkflowRun` calls it after its guarded cancel update.
- `failWorkflowRun` calls it after its guarded fail update.
- `failOrphanedRuns` locks the selected running run ids, fails them, and purges each selected run before commit.

A no-op status transition must not purge rows or insert purge events.

`completeWorkflowRun` does not purge because completion is neither cancel nor failure and a run with a pending Ask must never reach completion.

### Authorization and operation result

`workflow-operations.ts` adds these typed errors and function contracts:

```ts
export class AskHumanRunNotFoundError extends Error {}
export class AskHumanAuthenticationRequiredError extends Error {}
export class AskHumanForbiddenError extends Error {}

export interface AnswerAskHumanInput {
  runId: string;
  requestId: string;
  body: AskAnswerBody;
  actorUserId: string | undefined;
}

export interface AnswerAskHumanResult {
  run: WorkflowRun;
  interaction: PendingInteraction;
  resumed: boolean;
  remainingPending: number;
}

export async function answerAskHuman(
  input: AnswerAskHumanInput
): Promise<AnswerAskHumanResult>;
```

The operation loads the run, requires `actorUserId`, requires a non-null matching `run.user_id`, calls the persistence CAS once, logs once after commit, emits once after commit, and returns the pre-resolution run for transport routing.

The winning log is exactly `workflow.ask_resolved` with `workflowRunId`, `nodeId`, `toolUseId`, `declined`, and `resumed`.

The log must not receive `body`, `answer`, `envelope`, questions, options, or a raw serialized error.

`resumeWorkflow` must reject a run with any pending interaction.

`resumeWorkflow` may return an already-`running` run only when at least one Ask row is `answered` and no row is `pending`.

`resumeWorkflow` preserves its current behavior for failed, paused, and cancelled runs that are not blocked on Ask.

A plain running run with no answered Ask remains non-resumable.

### Hydrate-when-running

`inspectResumableRun` loads the pending-interaction rows in addition to the DAG snapshot.

At least one pending row causes a safe error with `Answer or decline the Ask before resuming run <id>`.

At least one answered Ask row makes a first-node run resumable even when the completed-node map is empty.

`hydrateResumableRun` returns the candidate unchanged and does not call `store.resumeWorkflowRun` when the candidate is already `running` and answered Ask rows make it eligible.

`hydrateResumableRun` continues to call `store.resumeWorkflowRun` for the existing failed, paused, and cancelled resume paths.

The inspection result may carry an internal `hasAnsweredAsk` boolean so hydrate does not repeat the store read.

### Executor re-entry

`executeDagWorkflow` loads `listPendingInteractions(workflowRun.id)` once after it has the resumed run and before `runLayers`.

It rejects a running run that still has a pending row.

It ignores answered Permission rows for this Ask flow.

It verifies every answered Ask `node_id` exists among the static executable step names, including `<loopGroupId>.<bodyNodeId>` names.

The provisional missing-node behavior is specified in Open Questions and must be implemented consistently with its test.

`runLayers` finds answered Ask rows with `row.node_id === stepNamePrefix + node.id`.

The mapper parses each stored `answer` with `askAnswerBodySchema` and fails safely when the answer is null or malformed.

All rows for one node must have the same non-empty `provider_session_id`.

The Ask session id is applied after sequential and `persist_session` lookup, so those cursors cannot replace it.

Command and prompt nodes receive `resumeInteractions` on only the first stream pass.

Loop nodes receive `resumeInteractions` on only the first stream pass of the first resumed iteration.

The request uses `forkSession: false` whenever `resumeInteractions` is non-empty.

A structured-output correction pass and later loop iteration must not receive the old `resumeInteractions`.

A node resumed from Ask uses zero engine retry attempts even when its YAML retry policy says `on_error: all`.

The provider receives the original resolved node prompt argument, and the executor never writes the answer into that prompt.

If a continued provider turn invokes AskHuman again, the existing `AskHumanAwaitingError` branch persists and pauses the new Ask rather than treating it as a resume failure.

A non-control re-entry failure writes `node_failed`, keeps all answered rows unchanged, and uses the safe node error `Could not resume the AskHuman session`.

The failure log is `workflow.ask_resume_failed` with `workflowRunId`, `nodeId`, `toolUseIds`, and `errorType` only.

The failure log, node event, transcript status, and log file must not contain answer values or a provider error string that can echo the injected answer.

### Claude mapping

`buildClaudeAskResumePrompt` is exported from `packages/providers/src/claude/provider.ts` for direct unit testing.

Its implementation is:

```ts
export function buildClaudeAskResumePrompt(
  interactions: readonly ResumeInteraction[]
): string {
  const blocks = interactions.map(interaction =>
    interaction.declined
      ? `AskHuman ` + interaction.tool_use_id + ` was declined.`
      : `AskHuman ` +
        interaction.tool_use_id +
        ` answers:\n` +
        JSON.stringify(interaction.payload)
  );
  return (
    blocks.join('\n\n') +
    '\n\nContinue the task using these answers. Do not call AskHuman again for these tool_use_id values.'
  );
}
```

When `resumeInteractions` is non-empty, Claude requires `resumeSessionId`, sets `options.resume` to it, forces `options.forkSession = false`, and calls `query` once with the provider-owned resume prompt instead of the executor prompt.

The native AskHuman tool remains registered so the continued turn can create a later Ask.

A thrown resume-interaction failure bypasses Claude's subprocess retry loop and logs only a safe error class without `err` or `stderrContext`.

An `isError: true` terminal result on this path replaces its `errors` array with `['Could not resume the AskHuman session']` while preserving usage, token, cost, and session fields.

The provider throws a new safe error whose message contains no answer or raw SDK error.

Claude behavior without `resumeInteractions` remains byte-for-byte on the existing prompt, fork, classification, and retry path.

### Pi mapping

`resolvePiSession` gains `{ requireExisting?: boolean }` as its fourth argument.

When `requireExisting` is true and the id is absent, empty, or cannot be found after an `ENOENT` or `ENOTDIR` list result, it throws `PiSessionResumeRequiredError` and never calls `SessionManager.create`.

Unexpected list errors continue to propagate.

The provider sets `requireExisting: true` only when `resumeInteractions` is non-empty.

The provider calls `sessionManager.buildSessionContext()` before `createAgentSession`.

For each interaction in order, the provider either verifies an identical existing AskHuman tool-result or appends this value:

```ts
const toolResult: ToolResultMessage = {
  role: 'toolResult',
  toolCallId: interaction.tool_use_id,
  toolName: 'AskHuman',
  content: [
    {
      type: 'text',
      text: interaction.declined
        ? 'declined'
        : JSON.stringify(interaction.payload),
    },
  ],
  isError: false,
  timestamp: Date.now(),
};
```

An existing tool result with the same `toolCallId` but different tool name, content, or error state fails safely.

After injection, the last transcript message must be the final expected AskHuman tool result.

The provider passes the same `SessionManager` to `createAgentSession` and verifies the constructed agent's transcript tail still matches.

`bridgeSession` adds a final `startMode: 'prompt' | 'continue' = 'prompt'` parameter.

`startMode: 'continue'` starts `session.agent.continue()`, never calls `session.prompt`, and preserves the existing queue, abort, structured-output, and `dispose()` behavior.

A thrown Pi Ask resume failure logs no raw `err` and throws a safe error without answer content.

An `isError: true` terminal result on this path replaces its `errors` array with `['Could not resume the AskHuman session']` while preserving usage, token, cost, and session fields.

Non-Ask Pi calls retain fresh-session fallback, resume warnings, and `session.prompt(prompt)`.

### Live and persisted events

`WorkflowEmitterEvent` gains:

```ts
interface InteractionResolvedEvent {
  type: 'interaction_resolved';
  runId: string;
  nodeId: string;
  resumed: boolean;
}
```

The live web bridge maps it to `workflow_status` with `status: event.resumed ? 'running' : 'paused'`.

The persisted mapper adds `interaction_resolved` to `DASHBOARD_SOURCE_EVENT_TYPES`.

For an answered event, the persisted mapper reads `data.resumed` and maps to `running` or `paused`.

For a purge event, the persisted mapper reads `data.terminal_status` and maps to `failed` or `cancelled`.

Both SSE payloads contain the run id, status, and timestamp only.

Neither SSE payload contains `toolUseId`, `envelope`, `answer`, questions, options, or approval data.

The Slack bridge ignores `interaction_resolved` in its exhaustive switch because this event exists only to trigger web refetch.

### Auto-continue after the POST

When `resumed` is false, the route returns `200` with a message that other interactions remain and does not dispatch.

When `resumed` is true and the run has a web parent conversation, the route calls the existing auto-resume helper with `'ask-answer'` and the authenticated actor id.

The helper dispatches `/workflow resume <runId>` exactly once.

The new log names are `api.workflow_ask_answer_auto_resume_dispatched`, `api.workflow_ask_answer_auto_resume_failed`, and `api.workflow_ask_answer_auto_resume_skipped_non_web_parent`.

A non-web or absent parent returns `200` after logging the skip.

## Implementation Order

### Task 1: Add the answer and provider contracts

**Files:**

- Modify `packages/workflows/src/schemas/pending-interaction.test.ts`.
- Modify `packages/workflows/src/schemas/pending-interaction.ts`.
- Modify `packages/workflows/src/ask-human.ts`.
- Modify `packages/providers/src/types.ts`.

- [ ] **Step 1: Write the RED schema tests.**

Add tests named `accepts exactly one answers-or-decline variant`, `accepts string arrays for multi answers`, `rejects empty answers and false decline`, `rejects unknown keys at every object level`, and `derives strict resolve input and result shapes`.

Use the exact sample bodies from the Authoritative Contracts section.

- [ ] **Step 2: Run the schema test and observe RED.**

```bash
cd packages/workflows
bun test src/schemas/pending-interaction.test.ts
```

Expected failure: `askAnswerBodySchema` and the resolve schemas are absent, rather than a fixture, syntax, or test-harness failure.

- [ ] **Step 3: Add the minimal schemas and inferred types.**

Import `z` only from `@hono/zod-openapi`, use `z.infer` for every schema type, and keep explicit key types on every `z.record`.

- [ ] **Step 4: Move the existing question schema to the canonical pending-interaction schema module and add the provider-neutral type.**

Export `askHumanQuestionSchema` from `schemas/pending-interaction.ts`, import it into `ask-human.ts`, and add `ResumeInteraction` plus the optional readonly array on `SendQueryOptions`.

- [ ] **Step 5: Run GREEN and then refactor names and comments without changing behavior.**

```bash
cd packages/workflows
bun test src/schemas/pending-interaction.test.ts
bun test src/ask-human.test.ts
cd ../providers
bun x tsc --noEmit
```

- [ ] **Step 6: Commit the contract slice.**

```bash
git add packages/workflows/src/schemas/pending-interaction.ts packages/workflows/src/schemas/pending-interaction.test.ts packages/workflows/src/ask-human.ts packages/providers/src/types.ts
git commit -m "feat(workflows): define AskHuman answer and resume contracts"
```

### Task 2: Implement the atomic answer CAS and shared resume primitive

**Files:**

- Create `packages/core/src/db/workflow-resume-transition.ts`.
- Modify `packages/core/src/db/workflow-pending-interactions.test.ts`.
- Modify `packages/core/src/db/workflow-pending-interactions.ts`.
- Modify `packages/core/src/db/workflows.ts`.
- Modify `packages/core/src/db/workflows.resume-cas.integration.test.ts`.

- [ ] **Step 1: Write the first RED real-SQLite answer test.**

Name the test `resolves one pending Ask, writes an id-only event, and resumes the last pending row atomically`.

Seed a started user, a paused run, and one Ask whose envelope contains one single and one multi question.

Assert the resolved row, stored JSON, `resolved_by`, zero pending count, `running` run status, one `interaction_resolved` event, and absence of sentinel prompt and answer values from `errorLogs`.

- [ ] **Step 2: Run the pending-interaction test and observe RED.**

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
```

Expected failure: `resolvePendingInteraction` is absent.

- [ ] **Step 3: Add the shared transaction module and preserve public resume behavior.**

Move `ORPHAN_RESUME_STALE_DAYS`, `resumableStatusClause`, the PostgreSQL lock suffix, metadata error parsing, and the resume update/event body into `workflow-resume-transition.ts`.

Have `resumeWorkflowRun` call `resumeWorkflowRunInTransaction` with `'standard'` and leave its CAS-miss probe and final select in `workflows.ts`.

- [ ] **Step 4: Implement the minimal winning resolution path.**

Add the typed errors, semantic validation, row CAS, last-pending count, `'paused-ask'` resume, event insert, and canonical result described above.

- [ ] **Step 5: Run GREEN for the first slice and the existing public resume integration suite.**

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
bun test src/db/workflows.resume-cas.integration.test.ts
```

- [ ] **Step 6: Add RED edge-case tests one at a time.**

Add tests named `keeps the first answer and reports already-resolved on a second write`, `does not resume while a sibling interaction is pending`, `rolls back the answer when the interaction-resolved event insert fails`, `rolls back the answer when the paused-run resume CAS cannot win`, `rejects an answer before the run reaches paused`, `rejects a permission row on the Ask endpoint`, `rejects missing duplicate and unknown question ids`, `rejects duplicate ids in the stored envelope`, `enforces single and multi value shapes`, `accepts an exact option and a nonblank Other value`, `rejects blank or forbidden Other values`, `redacts a shape-validation sentinel from errors and logs`, and `reports corrupt stored JSON with the row id only`.

After adding each named test, run the same test file, confirm the intended assertion fails, add the smallest behavior, and rerun before adding the next test.

- [ ] **Step 7: Refactor the validator and error construction while all answer tests remain green.**

Keep safe machine-readable validation codes on `PendingInteractionValidationError`, and keep user content out of every error message.

- [ ] **Step 8: Run the complete focused persistence gate.**

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
bun test src/db/workflows.resume-cas.integration.test.ts
bun test src/db/workflows.test.ts
```

- [ ] **Step 9: Commit the atomic answer slice.**

```bash
git add packages/core/src/db/workflow-resume-transition.ts packages/core/src/db/workflow-pending-interactions.ts packages/core/src/db/workflow-pending-interactions.test.ts packages/core/src/db/workflows.ts packages/core/src/db/workflows.resume-cas.integration.test.ts
git commit -m "feat(core): resolve AskHuman answers with atomic resume"
```

### Task 3: Purge pending interactions on every cancel or failure transition

**Files:**

- Modify `packages/core/src/db/workflow-pending-interactions.test.ts`.
- Modify `packages/core/src/db/workflow-pending-interactions.ts`.
- Modify `packages/core/src/db/workflows.test.ts`.
- Modify `packages/core/src/db/workflows.ts`.
- Modify `packages/core/src/db/workflows.resume-cas.integration.test.ts`.

- [ ] **Step 1: Write the RED purge primitive test.**

Name it `purges only pending rows, leaves answers null, and writes one safe event per row`.

Assert `answered` rows are untouched and every purge event omits the envelope and answer sentinels.

- [ ] **Step 2: Run RED.**

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
```

Expected failure: `purgePendingInteractionsInTransaction` is absent.

- [ ] **Step 3: Implement the transaction-scoped purge primitive.**

Use the caller's query function and do not open a nested transaction.

- [ ] **Step 4: Write RED transition tests before changing each lifecycle function.**

Add exact tests for `cancelWorkflowRun`, `cancelRecoveryWorkflowRun`, `resolveAndCancelApprovalGate`, `failWorkflowRun`, and `failOrphanedRuns`.

Each test must assert status and purge commit together, and each guarded no-op test must assert no purge update and no purge event.

- [ ] **Step 5: Run the lifecycle tests and observe RED.**

```bash
cd packages/core
bun test src/db/workflows.test.ts
bun test src/db/workflows.resume-cas.integration.test.ts
```

- [ ] **Step 6: Convert the five transitions to transactions and call purge only after a winning status update.**

For `failOrphanedRuns`, lock and collect the running run ids first, update that locked set, purge each selected id, and return the selected count.

- [ ] **Step 7: Run GREEN and refactor duplicated transaction error handling only when three call sites have the same stable shape.**

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
bun test src/db/workflows.test.ts
bun test src/db/workflows.resume-cas.integration.test.ts
```

- [ ] **Step 8: Commit the terminal cleanup slice.**

```bash
git add packages/core/src/db/workflow-pending-interactions.ts packages/core/src/db/workflow-pending-interactions.test.ts packages/core/src/db/workflows.ts packages/core/src/db/workflows.test.ts packages/core/src/db/workflows.resume-cas.integration.test.ts
git commit -m "feat(core): purge pending interactions on terminal transitions"
```

### Task 4: Add the resolve store port and update every concrete test double

**Files:**

- Modify `packages/workflows/src/store.ts`.
- Modify `packages/core/src/workflows/store-adapter.ts`.
- Modify `packages/core/src/workflows/store-adapter.test.ts`.
- Modify `packages/workflows/src/ask-human.test.ts`.
- Modify `packages/workflows/src/dag-executor.test.ts`.
- Modify `packages/workflows/src/executor.test.ts`.
- Modify `packages/workflows/src/executor-preamble.test.ts`.
- Modify `packages/workflows/src/plannotator-gate-executor.test.ts`.
- Modify `packages/workflows/src/plannotator-gate-supervisor.test.ts`.
- Modify `packages/workflows/src/script-node-deps.test.ts`.
- Modify `packages/workflows/src/subrun.test.ts`.

- [ ] **Step 1: Write the RED adapter delegation test.**

Add `delegates resolvePendingInteraction with the exact input and result` to `store-adapter.test.ts`, and extend its pending-interaction module mock with `mockResolvePendingInteraction` before importing the adapter.

- [ ] **Step 2: Run RED.**

```bash
cd packages/core
bun test src/workflows/store-adapter.test.ts
```

Expected failure: the returned store has no `resolvePendingInteraction` method.

- [ ] **Step 3: Add only the resolve method to the narrow pending store interface and adapter.**

Use the inferred `ResolvePendingInteractionInput` and `ResolvePendingInteractionResult` types from the engine schema.

- [ ] **Step 4: Update every listed `IWorkflowStore` object or class with a typed resolve stub.**

Do not add a purge stub because purge is not part of the port.

- [ ] **Step 5: Run adapter GREEN and compile all workflow doubles.**

```bash
cd packages/core
bun test src/workflows/store-adapter.test.ts
cd ../workflows
bun x tsc --noEmit
```

- [ ] **Step 6: Refactor repeated fixture defaults only inside the test file that already owns them.**

Do not introduce a cross-suite mock factory.

- [ ] **Step 7: Commit the store-port slice.**

```bash
git add packages/workflows/src/store.ts packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts packages/workflows/src/ask-human.test.ts packages/workflows/src/dag-executor.test.ts packages/workflows/src/executor.test.ts packages/workflows/src/executor-preamble.test.ts packages/workflows/src/plannotator-gate-executor.test.ts packages/workflows/src/plannotator-gate-supervisor.test.ts packages/workflows/src/script-node-deps.test.ts packages/workflows/src/subrun.test.ts
git commit -m "feat(workflows): expose pending-interaction resolution port"
```

### Task 5: Add the interaction-resolved refetch event

**Files:**

- Modify `packages/workflows/src/event-emitter.test.ts`.
- Modify `packages/workflows/src/event-emitter.ts`.
- Modify `packages/server/src/adapters/web/workflow-bridge.test.ts`.
- Modify `packages/server/src/adapters/web/workflow-bridge.ts`.
- Modify `packages/server/src/adapters/web/dashboard-event-poller.test.ts`.
- Modify `packages/adapters/src/chat/slack/workflow-bridge.test.ts`.
- Modify `packages/adapters/src/chat/slack/workflow-bridge.ts`.

- [ ] **Step 1: Write the RED emitter test.**

Assert a subscriber receives `{ type: 'interaction_resolved', runId, nodeId, resumed }` and that the type exposes no envelope or answer field.

- [ ] **Step 2: Run RED.**

```bash
cd packages/workflows
bun test src/event-emitter.test.ts
```

- [ ] **Step 3: Add the live event union member.**

Do not change `WORKFLOW_EVENT_TYPES` because `interaction_resolved` is already present there.

- [ ] **Step 4: Write separate RED web bridge tests for `resumed: true` and `resumed: false`.**

Assert the resulting `workflow_status` payload is `running` or `paused` and contains none of `approval`, `envelope`, `answer`, `questions`, or `options`.

- [ ] **Step 5: Write the RED persisted-event and poller allowlist tests.**

Use one `interaction_resolved` row with `data: { resumed: true }` and assert the dashboard emits a running refetch trigger.

Use a second row with `data: { purged: true, terminal_status: 'cancelled' }` and assert the dashboard emits a cancelled refetch trigger.

- [ ] **Step 6: Run the server RED tests in separate processes.**

```bash
cd packages/server
bun test src/adapters/web/workflow-bridge.test.ts
bun test src/adapters/web/dashboard-event-poller.test.ts
```

- [ ] **Step 7: Implement live and persisted mappings and add a boolean data reader.**

Unknown or missing persisted `resumed` must fail safe to `paused` rather than claim the run is active.

- [ ] **Step 8: Add `case 'interaction_resolved': break` to Slack and assert it sends no message.**

```bash
cd packages/adapters
bun test src/chat/slack/workflow-bridge.test.ts
```

- [ ] **Step 9: Run all event GREEN tests and refactor duplicate safe-payload assertions.**

```bash
cd packages/workflows
bun test src/event-emitter.test.ts
cd ../server
bun test src/adapters/web/workflow-bridge.test.ts
bun test src/adapters/web/dashboard-event-poller.test.ts
cd ../adapters
bun test src/chat/slack/workflow-bridge.test.ts
```

- [ ] **Step 10: Commit the event slice.**

```bash
git add packages/workflows/src/event-emitter.ts packages/workflows/src/event-emitter.test.ts packages/server/src/adapters/web/workflow-bridge.ts packages/server/src/adapters/web/workflow-bridge.test.ts packages/server/src/adapters/web/dashboard-event-poller.test.ts packages/adapters/src/chat/slack/workflow-bridge.ts packages/adapters/src/chat/slack/workflow-bridge.test.ts
git commit -m "feat(server): map AskHuman resolution as a refetch event"
```

### Task 6: Add the operation owner and Ask-aware resume validation

**Files:**

- Modify `packages/core/src/operations/workflow-operations.test.ts`.
- Modify `packages/core/src/operations/workflow-operations.ts`.

- [ ] **Step 1: Extend all operation-test mocks before importing production code.**

Add `listPendingInteractions` and `resolvePendingInteraction` to a new `mock.module('../db/workflow-pending-interactions')` factory, and add a typed event-emitter mock that records `emit`.

- [ ] **Step 2: Write RED authorization tests.**

Add tests named `requires an authenticated actor`, `rejects a different starter even when that actor is admin upstream`, `rejects an unowned run`, and `passes the matching starter as resolved_by`.

- [ ] **Step 3: Run RED and implement only authorization plus one persistence call.**

```bash
cd packages/core
bun test src/operations/workflow-operations.test.ts
```

- [ ] **Step 4: Write RED success, logging, and emission tests.**

Assert `workflow.ask_resolved` and `interaction_resolved` occur only after the persistence promise resolves, contain `resumed`, and omit unique answer and prompt sentinels from every mock logger call and emitted event.

- [ ] **Step 5: Implement the post-commit result, safe log, and live event.**

Map no database error by message text, and preserve the typed database errors for the route.

- [ ] **Step 6: Write RED `resumeWorkflow` tests.**

Cover pending Ask rejection, already-running answered Ask acceptance, plain running rejection, and unchanged failed, paused, and cancelled acceptance.

- [ ] **Step 7: Implement the narrow Ask-aware running branch.**

Do not call `resumeWorkflowRun` from this operation.

- [ ] **Step 8: Run GREEN and perform the explicit refactor pass.**

```bash
cd packages/core
bun test src/operations/workflow-operations.test.ts
```

Refactor only duplicated ownership checks and keep the three public error classes distinct for HTTP mapping.

- [ ] **Step 9: Commit the operation slice.**

```bash
git add packages/core/src/operations/workflow-operations.ts packages/core/src/operations/workflow-operations.test.ts
git commit -m "feat(core): own AskHuman answer and resume operations"
```

### Task 7: Register the Ask answer POST route

**Files:**

- Modify `packages/server/src/routes/schemas/workflow.schemas.ts`.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts`.
- Modify `packages/server/src/routes/api.ts`.

- [ ] **Step 1: Extend route-test mocks before the RED tests.**

Add `user_id?: string | null` to `MockWorkflowRun`, set `user_id: null` on `MOCK_RUNNING_RUN`, and override it with the starter id in the new answer fixtures.

Add `mockResolvePendingInteraction` and the real-shape typed pending error classes to the existing pending-interaction module factory.

Add a `@archon/core/db/users` mock whose `findOrCreateUserByPlatformIdentity` maps a trusted header value to a deterministic Archon user id.

Keep the real `answerAskHuman` operation under test rather than replacing the whole operations module.

- [ ] **Step 2: Write the first RED happy-path route test.**

Use `X-Archon-User` to resolve the same id as `run.user_id`, post one valid answer, assert `200`, and assert the DB CAS receives the exact run id, request id, body, and resolved actor id.

- [ ] **Step 3: Run RED.**

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

Expected failure: no matching POST route exists.

- [ ] **Step 4: Add the imported OpenAPI request schema and register the route.**

Use these route definitions:

```ts
export const askAnswerRequestSchema =
  askAnswerBodySchema.openapi('AskAnswerBody');

const answerAskHumanRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/ask/{requestId}/answer',
  tags: ['Workflows'],
  request: {
    params: z.object({
      runId: z.string().min(1),
      requestId: z.string().min(1),
    }),
    body: {
      content: {
        'application/json': { schema: askAnswerRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: workflowRunActionResponseSchema },
      },
      description: 'AskHuman answer accepted',
    },
    400: jsonError('Invalid AskHuman answer'),
    401: jsonError('Authentication required'),
    403: jsonError('Forbidden'),
    404: jsonError('Not found'),
    409: jsonError('Conflict'),
    500: jsonError('Server error'),
  },
});
```

- [ ] **Step 5: Add RED status-mapping tests one at a time.**

Cover decline `200`, missing auth `401`, different starter `403`, missing run `404`, missing request id `404`, already-resolved `409`, run-not-paused `409`, mixed body `400`, semantic validation `400`, and unexpected error `500`.

After every new test, run the same route test, observe the intended failure, add the typed catch branch, and rerun.

- [ ] **Step 6: Add RED auto-dispatch tests.**

Assert a last-pending web run dispatches `/workflow resume <runId>` once with the actor id, an intermediate answer does not dispatch, and a non-web parent logs the skip without changing the `200` response.

- [ ] **Step 7: Extend `tryAutoResumeAfterGate` with the exact `'ask-answer'` action and log names.**

Do not move answer persistence into the transport helper.

- [ ] **Step 8: Run GREEN and refactor error mapping into explicit `instanceof` branches.**

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

- [ ] **Step 9: Commit the HTTP slice.**

```bash
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "feat(server): add starter-only AskHuman answer route"
```

### Task 8: Hydrate an operation-resumed Ask without a second resume CAS

**Files:**

- Modify `packages/workflows/src/executor.test.ts`.
- Modify `packages/workflows/src/executor.ts`.

- [ ] **Step 1: Write the RED first-node inspection test.**

Seed zero completed nodes, one answered Ask row, no pending row, and assert `inspectResumableRun` returns a non-null inspection.

- [ ] **Step 2: Run RED.**

```bash
cd packages/workflows
bun test src/executor.test.ts
```

- [ ] **Step 3: Add pending-row inspection and the internal `hasAnsweredAsk` result field.**

Filter eligibility to `kind === 'ask' && status === 'answered'`.

- [ ] **Step 4: Write the RED still-pending test.**

Assert both `inspectResumableRun` and `hydrateResumableRun` reject with `Answer or decline the Ask before resuming run run-1` and never call `resumeWorkflowRun`.

- [ ] **Step 5: Implement the fail-closed pending branch.**

Do not mutate interaction or run state.

- [ ] **Step 6: Write the RED already-running hydrate test.**

Assert the candidate object is returned as `preCreatedRun` and `store.resumeWorkflowRun` has zero calls.

- [ ] **Step 7: Implement the narrow running branch and preserve existing gate behavior.**

A running candidate without `hasAnsweredAsk` must still fail rather than enter this branch.

- [ ] **Step 8: Run existing interactive-loop, Plannotator, child-workflow, failed, paused, and cancelled resume tests.**

```bash
cd packages/workflows
bun test src/executor.test.ts
```

- [ ] **Step 9: Refactor duplicate row predicates into local named functions and rerun GREEN.**

- [ ] **Step 10: Commit the hydrate slice.**

```bash
git add packages/workflows/src/executor.ts packages/workflows/src/executor.test.ts
git commit -m "feat(workflows): hydrate operation-resumed AskHuman runs"
```

### Task 9: Re-enter every unfinished asking node with ordered interactions

**Files:**

- Modify `packages/workflows/src/dag-executor.test.ts`.
- Modify `packages/workflows/src/dag-executor.ts`.

- [ ] **Step 1: Write the RED single command-node re-entry test.**

Seed one answered Ask and assert `sendQuery` receives the original prompt, the row's `provider_session_id`, `forkSession: false`, and the exact mapped `resumeInteractions`.

Use a unique answer sentinel and assert the prompt argument does not contain it.

- [ ] **Step 2: Run RED.**

```bash
cd packages/workflows
bun test src/dag-executor.test.ts
```

- [ ] **Step 3: Load pending rows once and add the per-node mapper.**

Pass the ordered answered Ask rows through `RunLayersContext` and propagate the same array into loop-group body contexts.

- [ ] **Step 4: Apply Ask session precedence after every ordinary session lookup.**

The final Ask override must occur after `lastSequentialSession` and `getWorkflowNodeSession` handling.

- [ ] **Step 5: Force no fork and one pass for command and prompt nodes.**

Set `forkSession: false` explicitly and use a retry configuration with zero retries for a node that has resume interactions.

- [ ] **Step 6: Run GREEN for the first slice.**

```bash
cd packages/workflows
bun test src/dag-executor.test.ts
```

- [ ] **Step 7: Add RED mapping and ordering tests one at a time.**

Cover decline mapping, two rows ordered by creation then id, all rows sharing one session id, conflicting session ids, a malformed stored answer, no interactions on an unrelated later node, and two sibling asking nodes both re-entered.

- [ ] **Step 8: Implement each mapping guard with a safe error.**

Do not include the stored answer or raw provider error in any thrown message.

- [ ] **Step 9: Add the RED loop-node test.**

Assert the first resumed iteration gets the pending-row session and interactions, while a structured correction pass and the next iteration get no `resumeInteractions`.

- [ ] **Step 10: Add the loop resume arguments and first-pass-only condition.**

Do not change interactive-loop `$LOOP_USER_INPUT` behavior.

- [ ] **Step 11: Add RED failure and repeated-Ask tests.**

Assert a provider resume throw calls `sendQuery` once despite `retry.on_error = 'all'`, writes `node_failed` with the safe fixed message, logs only ids and error type, leaves the store rows answered, and does not expose the sentinel through logs, transcript status, event data, or log-file writes.

Assert a new `AskHumanAwaitingError` during the continued turn pauses normally and does not write `workflow.ask_resume_failed`.

- [ ] **Step 12: Implement the safe resume-failure branch after the existing control-error branch.**

Preserve usage already reported before failure.

- [ ] **Step 13: Add the RED missing-static-node test using the provisional default in Open Questions.**

Use a row whose `node_id` is absent from top-level and loop-group executable step names.

- [ ] **Step 14: Implement static step-name collection and the provisional missing-node behavior.**

- [ ] **Step 15: Run GREEN and refactor mapping into one local pure helper used by command, prompt, and loop paths.**

```bash
cd packages/workflows
bun test src/dag-executor.test.ts
```

- [ ] **Step 16: Commit the executor re-entry slice.**

```bash
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts
git commit -m "feat(workflows): re-enter AskHuman nodes with resume interactions"
```

### Task 10: Map Claude interactions to one same-session user message

**Files:**

- Modify `packages/providers/src/claude/provider.test.ts`.
- Modify `packages/providers/src/claude/provider.ts`.

- [ ] **Step 1: Write the RED prompt-builder unit test.**

Assert ordered answer and decline blocks, exact tool-use ids, the final continuation instruction, and no executor prompt text.

- [ ] **Step 2: Write the RED provider integration test.**

Call `sendQuery` with a resume id and interactions, then assert the SDK `query` spy receives `options.resume`, `options.forkSession === false`, the builder output as `prompt`, and an AskHuman MCP registration.

- [ ] **Step 3: Run RED.**

```bash
cd packages/providers
bun test src/claude/provider.test.ts
```

- [ ] **Step 4: Implement the builder and narrow Ask-resume branch.**

Require a non-empty resume id before invoking the SDK.

- [ ] **Step 5: Add RED failure-sanitization and no-retry tests.**

Make the SDK throw an error containing an answer sentinel and make stderr contain a second sentinel.

Assert one `query` call, a safe thrown message, and absence of both sentinels from every logger call.

- [ ] **Step 6: Add a RED terminal-result sanitization test.**

Make the SDK yield `isError: true` with a sentinel in `errors`, and assert the provider yields the safe fixed error while preserving usage fields.

- [ ] **Step 7: Implement the sanitized terminal-result mapping and no-retry catch before the ordinary classifier and retry branch.**

Do not pass the raw error as a `cause` because Pino may serialize it later.

- [ ] **Step 8: Run non-Ask regression tests.**

Assert ordinary resume still uses its executor prompt and existing fork behavior.

```bash
cd packages/providers
bun test src/claude/provider.test.ts
bun test src/claude/askhuman-resume-spike.test.ts
```

- [ ] **Step 9: Refactor the Ask predicate into one local boolean and rerun GREEN.**

- [ ] **Step 10: Commit the Claude slice.**

```bash
git add packages/providers/src/claude/provider.ts packages/providers/src/claude/provider.test.ts
git commit -m "feat(providers): continue Claude after AskHuman answers"
```

### Task 11: Map Pi interactions to durable tool results and agent continue

**Files:**

- Modify `packages/providers/src/community/pi/session-resolver.test.ts`.
- Modify `packages/providers/src/community/pi/session-resolver.ts`.
- Modify `packages/providers/src/community/pi/event-bridge.test.ts`.
- Modify `packages/providers/src/community/pi/event-bridge.ts`.
- Modify `packages/providers/src/community/pi/provider.test.ts`.
- Modify `packages/providers/src/community/pi/provider.ts`.

- [ ] **Step 1: Write RED required-session resolver tests.**

Cover a missing id, an empty id, `ENOENT`, and `ENOTDIR` with `requireExisting: true`, and assert `SessionManager.create` is never called.

- [ ] **Step 2: Run RED.**

```bash
cd packages/providers
bun test src/community/pi/session-resolver.test.ts
```

- [ ] **Step 3: Add `PiSessionResumeRequiredError` and the fourth resolver argument.**

Preserve every existing non-required resolver test unchanged.

- [ ] **Step 4: Run resolver GREEN and refactor the missing-session branch once.**

```bash
cd packages/providers
bun test src/community/pi/session-resolver.test.ts
```

- [ ] **Step 5: Write the RED bridge continue-mode test.**

Use a fake session with both `prompt` and `agent.continue` spies, run `bridgeSession(..., 'continue')`, assert only `agent.continue` runs, and assert `dispose` still runs.

- [ ] **Step 6: Run RED and implement the start-mode branch.**

```bash
cd packages/providers
bun test src/community/pi/event-bridge.test.ts
```

Keep the existing default parameter so every current call remains prompt mode.

- [ ] **Step 7: Extend the provider-test SessionManager and AgentSession fakes.**

Each manager fake must expose `appendMessage` and `buildSessionContext` over a mutable message array.

The session fake must expose `agent.state.messages` and `agent.continue`, and `mockCreateAgentSession` must receive the same manager instance.

- [ ] **Step 8: Write the RED ordered-injection provider test.**

Use one answer and one decline, assert both exact `ToolResultMessage` values are appended before `createAgentSession`, assert the row order, assert `agent.continue` once, and assert `session.prompt` never runs.

- [ ] **Step 9: Implement required resolution, idempotent verification, tail checks, and continue mode.**

Use type-only `ToolResultMessage` imports so the providers package does not gain a runtime dependency edge.

- [ ] **Step 10: Add RED safety tests one at a time.**

Cover missing session without create, an identical already-appended tool result, a conflicting existing tool result, a matching result that is not the transcript tail, a constructed-agent tail mismatch, an injected throw whose raw error contains an answer sentinel, and an `isError: true` terminal result whose errors contain a sentinel.

Assert safe errors and sentinel-free logger calls for every failure case.

- [ ] **Step 11: Add the RED non-Ask regression test.**

Assert ordinary Pi resume still permits cold fallback and starts with `session.prompt(effectivePrompt)`.

- [ ] **Step 12: Run all Pi GREEN tests and the pinned characterization.**

```bash
cd packages/providers
bun test src/community/pi/session-resolver.test.ts
bun test src/community/pi/event-bridge.test.ts
bun test src/community/pi/provider.test.ts
bun test src/community/pi/askhuman-resume.characterization.test.ts
```

- [ ] **Step 13: Refactor tool-result equality into one private structural predicate and rerun the same four tests.**

- [ ] **Step 14: Commit the Pi slice.**

```bash
git add packages/providers/src/community/pi/session-resolver.ts packages/providers/src/community/pi/session-resolver.test.ts packages/providers/src/community/pi/event-bridge.ts packages/providers/src/community/pi/event-bridge.test.ts packages/providers/src/community/pi/provider.ts packages/providers/src/community/pi/provider.test.ts
git commit -m "feat(providers): continue Pi after AskHuman answers"
```

### Task 12: Regenerate the API contract, validate, and mark Story 6.3 done

**Files:**

- Regenerate `packages/web/src/lib/api.generated.d.ts`.
- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.

- [ ] **Step 1: Start the server in terminal A from the repository root.**

```bash
bun run dev:server
```

Wait for the server to report port `3090`.

- [ ] **Step 2: Regenerate types in terminal B.**

```bash
curl --fail http://localhost:3090/api/health
bun --filter @archon/web generate:types
```

Stop terminal A after generation completes.

- [ ] **Step 3: Verify the generated contract exactly.**

```bash
rg -n "/api/workflows/runs/\\{runId\\}/ask/\\{requestId\\}/answer|AskAnswerBody" packages/web/src/lib/api.generated.d.ts
git diff -- packages/web/src/lib/api.generated.d.ts
```

The diff must contain the new path, path parameters, the exclusive request union, `200`, `400`, `401`, `403`, `404`, `409`, and `500`.

- [ ] **Step 4: Run every focused suite in its safe package process.**

```bash
cd packages/workflows
bun test src/schemas/pending-interaction.test.ts
bun test src/ask-human.test.ts
bun test src/event-emitter.test.ts
bun test src/executor.test.ts
bun test src/dag-executor.test.ts
cd ../core
bun test src/db/workflow-pending-interactions.test.ts
bun test src/db/workflows.test.ts
bun test src/db/workflows.resume-cas.integration.test.ts
bun test src/workflows/store-adapter.test.ts
bun test src/operations/workflow-operations.test.ts
cd ../server
bun test src/routes/api.workflow-runs.test.ts
bun test src/adapters/web/workflow-bridge.test.ts
bun test src/adapters/web/dashboard-event-poller.test.ts
cd ../adapters
bun test src/chat/slack/workflow-bridge.test.ts
cd ../providers
bun test src/claude/provider.test.ts
bun test src/claude/askhuman-resume-spike.test.ts
bun test src/community/pi/session-resolver.test.ts
bun test src/community/pi/event-bridge.test.ts
bun test src/community/pi/provider.test.ts
bun test src/community/pi/askhuman-resume.characterization.test.ts
```

- [ ] **Step 5: Run repository validation from the repository root.**

```bash
cd ../..
bun run validate
```

Expected result: every command exits zero with no ESLint warnings.

- [ ] **Step 6: Confirm no migration files or dependency versions changed.**

```bash
git diff --name-only origin/dev | rg "^(migrations/|packages/core/src/db/adapters/sqlite.ts|package.json|bun.lock)$" && exit 1 || true
```

Expected result: no matching changed path.

- [ ] **Step 7: Mark only Story 6.3 done after validation passes.**

Set `6-3-answer-or-decline-the-ask-so-the-node-can-continue: done` and update `last_updated` in `sprint-status.yaml`.

Leave Stories 6.4 through 6.7 unchanged.

- [ ] **Step 8: Commit generated types and story status.**

```bash
git add packages/web/src/lib/api.generated.d.ts _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark AskHuman answer story 6.3 done"
```

- [ ] **Step 9: Record the final evidence before closing issue 88.**

```bash
git status --short
git log --oneline --max-count=12
```

The worktree must be clean, the focused test commands and `bun run validate` must be recorded in the implementation handoff, and issue 88 must remain open until those results are available.

## Testing Strategy

| Layer | Test file | Required evidence |
| --- | --- | --- |
| Contract | `packages/workflows/src/schemas/pending-interaction.test.ts` | Exclusive request union, multi values, strict resolve types |
| Persistence | `packages/core/src/db/workflow-pending-interactions.test.ts` | Real-SQLite CAS, validation, last-pending resume, rollback, safe logs, purge |
| Resume regression | `packages/core/src/db/workflows.resume-cas.integration.test.ts` | Existing public resume semantics survive extraction |
| Lifecycle | `packages/core/src/db/workflows.test.ts` | Every cancel and failure transition purges only after a winning update |
| Store port | `packages/core/src/workflows/store-adapter.test.ts` | Resolve delegation and complete store shape |
| Operation | `packages/core/src/operations/workflow-operations.test.ts` | Starter-only ownership, safe logging, event emission, running Ask dispatch |
| HTTP | `packages/server/src/routes/api.workflow-runs.test.ts` | `200/400/401/403/404/409/500` and auto-dispatch gating |
| Live events | `packages/workflows/src/event-emitter.test.ts` | Identifier-only interaction event |
| Web events | `packages/server/src/adapters/web/workflow-bridge.test.ts` | Accurate paused/running refetch status and no card payload |
| Poller | `packages/server/src/adapters/web/dashboard-event-poller.test.ts` | Persisted interaction event reaches the dashboard |
| Slack | `packages/adapters/src/chat/slack/workflow-bridge.test.ts` | No chat message for the web refetch signal |
| Hydration | `packages/workflows/src/executor.test.ts` | First-node eligibility, pending guard, and no second CAS |
| DAG | `packages/workflows/src/dag-executor.test.ts` | Every asking node, session precedence, loop first pass, safe no-retry failure |
| Claude | `packages/providers/src/claude/provider.test.ts` | One provider message, same session, no fork, no raw-error leak |
| Pi resolver | `packages/providers/src/community/pi/session-resolver.test.ts` | Required session never cold-starts |
| Pi bridge | `packages/providers/src/community/pi/event-bridge.test.ts` | `agent.continue` start mode preserves cleanup |
| Pi provider | `packages/providers/src/community/pi/provider.test.ts` | Durable ordered tool results, idempotence, tail checks, no raw-error leak |
| Characterization | `packages/providers/src/community/pi/askhuman-resume.characterization.test.ts` | Pinned SDK still supports reopen, append, create, and continue |

## Acceptance Criteria

- [ ] The registered POST accepts exactly `{ answers: { questionId, value }[] }` or `{ decline: true }`.
- [ ] The route validates the body against the stored Ask envelope.
- [ ] Only the authenticated `workflow_runs.user_id` can mutate the Ask.
- [ ] Missing identity returns `401` and a different identity returns `403`.
- [ ] A second answer or decline returns `409` and preserves the first write.
- [ ] A request received before the run reaches `paused` returns `409` without consuming the answer.
- [ ] Decline remains an object in storage and reaches the provider as `"declined"`.
- [ ] Other is accepted only when `allowOther` is true and its trimmed value is non-empty.
- [ ] The answer row, audit event, and last-pending resume commit atomically.
- [ ] An intermediate answer leaves the run paused and does not auto-dispatch.
- [ ] The last answer moves the run to running exactly once and auto-dispatches only for a web parent.
- [ ] The executor never invokes the Ask resume CAS.
- [ ] A first-node Ask with zero completed nodes hydrates successfully after the operation-owned resume.
- [ ] Every unfinished node with answered Ask rows re-enters with ordered `resumeInteractions`.
- [ ] The pending row's `provider_session_id` overrides sequential and persisted-session cursors.
- [ ] The executor prompt contains no answer data.
- [ ] Claude sends one provider-owned user message on the same session with no fork.
- [ ] Pi appends durable `ToolResultMessage` values before session construction and uses `session.agent.continue()`.
- [ ] Pi never creates a fresh session when Ask resume requires a missing session.
- [ ] A resume failure fails the node once, keeps the answered row, and exposes no answer through logs, events, transcript status, or log files.
- [ ] A continued node may invoke AskHuman again and pause under the existing Story 6.2 path.
- [ ] `interaction_resolved` is persisted and mapped as a payload-free SSE refetch trigger.
- [ ] Cancel and failure transitions purge all remaining pending rows atomically.
- [ ] No timeout or auto-default exists.
- [ ] No database migration, dependency bump, UI card, Permission route, YAML field, CLI answer path, or chat answer path is added.
- [ ] The generated OpenAPI types contain the new route and request union.
- [ ] `bun run validate` passes.
- [ ] The Story 6.3 sprint key is `done` only after validation passes.

## Not Building

- Ask cards, Submit controls, teammate chrome, and composer HITL belong to Stories 6.5 and 6.6.
- The Permission confirmation POST and Permission cards belong to Story 6.7.
- Per-node independent scheduling belongs to Story 6.4.
- CLI, Slack, Telegram, Discord, GitHub, and `manage_run` answer UX are out of scope.
- Claude `AskUserQuestion` wrapping is out of scope.
- Assistant-prose detection is prohibited.
- A new workflow authoring field is prohibited.
- A new run status is prohibited.
- An SDK upgrade is out of scope.

## Open Questions

1. The approved HITL contract does not name the success response status or body.
Safe provisional default: return `200` with `workflowRunActionResponseSchema`, matching adjacent workflow action routes.

2. The approved HITL contract does not name the wire type for a `multi` selection value.
Safe provisional default: require `string[]` for `multi` and `string` for `single` because one POST represents the whole structured form.

3. Story 6.2 persists the interaction before the executor pauses the run, so an extremely early POST can observe a pending row while the run is still `running`.
Safe provisional default: return `409` without resolving the row, and let the client refetch and retry after `node_awaiting` and pause complete.

4. The approved contract does not define recovery when an answered row names a node removed from the static DAG before cold resume.
Safe provisional default: fail the workflow before provider execution, keep the answered row, and log `workflow.ask_resume_failed` with ids only because silently completing would lose an accepted human answer.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A circular import between workflow runs and pending interactions | Build failure or partially initialized functions | Put shared query-scoped resume logic in `workflow-resume-transition.ts` |
| A second resume CAS after the answer transaction | Double claim or false non-resumable error | Hydrate returns an eligible running candidate without calling `resumeWorkflowRun` |
| A generic resume predicate resurrects a terminal run | Cancel or failure is undone | Use `'paused-ask'` eligibility inside answer resolution |
| An answer races the Story 6.2 pause | Row consumed before the pause strands the run | Reject non-paused resolution with `409` |
| Sequential or persisted-session state replaces the Ask session | Provider continues the wrong transcript | Apply pending-row session precedence last |
| Claude forks the aborted transcript | Answer is detached from the tool call | Force `forkSession: false` for resume interactions |
| Pi cold-starts after a missing session | Accepted answer is never attached to its tool call | Require an existing session and prohibit `SessionManager.create` |
| A retry duplicates provider side effects | Same answer is continued more than once | Disable engine and provider retry for an Ask resume pass |
| An SDK error echoes the injected answer | Sensitive answer reaches logs or events | Use safe fixed errors and never log raw errors on Ask resume |
| A terminal transition leaves a pending card | UI shows an actionable card for dead work | Purge in the same winning cancel or failure transaction |
| A first-node Ask has no completed event | Resume inspection returns null | Treat answered Ask rows as re-runnable state |
| A generated type is edited by hand | OpenAPI drift | Run the generator against a live server and inspect the diff |

## Completion Gate

Story 6.3 is complete only when every acceptance criterion is satisfied, every focused test passes in its isolated package process, `bun run validate` exits zero, generated API types are current, and the sprint key is `done`.

If any gate fails, leave the sprint key unchanged and do not close issue 88.
