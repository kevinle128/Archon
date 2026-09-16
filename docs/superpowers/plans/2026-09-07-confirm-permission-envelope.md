# Confirm a Permission by Envelope Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the authenticated run starter confirm one pending `kind: permission` interaction exactly once through `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm` with an exact `{ intent: string }` body, where `callId` is the persisted `tool_use_id`.

**Architecture:** Add a split Permission request schema beside the existing Ask schemas while continuing to use the canonical `pendingInteractionSchema` row.
Core persistence owns the first-write CAS and the transaction that records `interaction_resolved` and resumes the run when no pending interactions remain.
`workflow-operations` owns starter authorization and post-commit notification, while the OpenAPI route remains a thin transport adapter and deliberately does not add live Permission activation, provider resume injection, auto-dispatch, or UI cards.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi`, SQLite and PostgreSQL through the existing database adapter, OpenAPIHono, Bun Test, and generated `openapi-typescript` declarations.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.7, with `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md` as binding companions.

## Global Constraints

- Implement GitHub issue `anhle128/Archon#92`, whose accepted outcome is Story 6.7 only.
- Story 6.3 is complete at base SHA `19482482bc8fa270b8ed30d989e99a6fb48b2762` and supplies the Ask-only reference path.
- The Permission route is `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm`, and `callId` maps exactly to `tool_use_id`.
- The route must use `registerOpenApiRoute(createRoute({...}), handler)`.
- Server route schemas must decorate the engine-owned schema instead of copying it.
- Only `workflow_runs.user_id` may confirm, and an admin role is not an override.
- A request without a resolved requester is `401` before body validation, even when the installation API gate is disabled.
- First write wins on `(workflow_run_id, tool_use_id)`, and a later write is `409` without changing the first answer.
- The stored answer is exactly `{ intent: string }` as submitted after proving that the string contains at least one non-whitespace character.
- `intent` is opaque and must not become an allow/deny enum or a permission-card vocabulary.
- Never include the submitted intent value or answer/envelope payload in structured logs, persisted event data, live emitter payloads, HTTP errors, or SSE payloads.
- Permission envelopes remain opaque JSON objects and receive no semantic validation in this story.
- `resolvePendingInteraction` remains Ask-only and continues to reject a pending Permission row with `kind_not_ask`.
- `confirmPendingPermission` remains Permission-only and rejects a pending Ask row with `kind_not_permission`.
- The last-pending transition remains inside the persistence transaction through `resumeWorkflowRunInTransaction(..., 'paused-ask')`.
- Keep the existing `'paused-ask'` eligibility name because renaming it would expand this story into an unrelated compatibility change.
- Do not call public `resumeWorkflowRun` from the executor, operation, or route.
- Do not extend `tryAutoResumeAfterGate` with a Permission action because the approved scope has no live activation or Permission resume-injection path.
- `mapAnsweredAskResume` must continue to ignore answered Permission rows.
- Persisted `interaction_resolved` data is an identifier-only refetch signal and must not contain `intent`, `answer`, or `envelope`.
- Run status remains `paused` or `running`, and this story adds no `awaiting` run status.
- The wait remains indefinite, with no timeout, auto-confirm, or default intent.
- `pendingInteractionSchema` in `packages/workflows/src/schemas/pending-interaction.ts` remains the canonical row schema.
- Use `z.infer<typeof schema>` for new schema-derived types, and do not use `any`.
- Do not add a migration because Story 6.2 already shipped `kind: permission` in `remote_agent_pending_interactions`.
- Do not add `confirmPendingPermission` to `IWorkflowStore`, because no workflow-engine caller confirms Permission in this story.
- Do not modify `packages/core/src/workflows/store-adapter.ts` or `packages/core/src/workflows/store-adapter.test.ts`.
- Do not modify `packages/workflows/src/dag-executor.ts`, `packages/workflows/src/executor.ts`, provider implementations, `packages/web/src/components/workflows/WorkflowExecution.tsx`, or any file under `packages/web/src/experiments/console/`.
- Do not add a Permission producer, Permission card, CLI command, chat command, `manage_run` command, workflow YAML field, or prose parser.
- Every production behavior must follow RED, observed expected failure, minimal GREEN, explicit REFACTOR, and focused GREEN before its commit.
- Each `mock.module()` factory touched by this work must expose every runtime export imported by its module under test.
- Run mock-heavy test files in their existing package-isolated processes, and never run unscoped `bun test` from the repository root.
- Regenerate `packages/web/src/lib/api.generated.d.ts`; never hand-edit it.
- Use base SHA `19482482bc8fa270b8ed30d989e99a6fb48b2762` for scope checks instead of the moving `origin/dev` ref.
- Keep each full Markdown sentence in this plan on its own physical line.

---

## Verified Repository Baseline

- `packages/workflows/src/schemas/pending-interaction.ts:5-86` owns the canonical row, Ask answer body, Ask resolve input, and shared resolve result schemas.
- `packages/core/src/db/workflow-pending-interactions.ts:79-90` defines the Ask validation codes, and `:279-387` implements the existing Ask-only transaction.
- `packages/core/src/db/workflow-pending-interactions.test.ts:416-850` already proves Ask CAS, rollback, run-status, kind-mismatch, validation, and safe-event behavior against real SQLite.
- `packages/core/src/db/workflow-resume-transition.ts:87-141` exposes the query-scoped resume primitive, and `'paused-ask'` matches only `status = 'paused'`.
- `packages/core/src/operations/workflow-operations.ts:91-125` defines the Ask operation contract, and `:271-340` authorizes the starter, delegates once, logs, and emits after commit.
- `packages/server/src/routes/schemas/workflow.schemas.ts:307-308` decorates the engine-owned Ask request schema.
- `packages/server/src/routes/api.ts:1457-1488` defines the Ask OpenAPI route, and `:4861-4923` registers its pre-validation auth middleware and handler.
- `packages/server/src/routes/api.ts:2879-2967` auto-dispatches only declared gates, review-open, and answered Ask interactions.
- `packages/workflows/src/dag-executor.ts:1839-1865` filters resume injection to answered Ask rows.
- `packages/workflows/src/dag-executor.test.ts:26025-26044` already proves answered Permission rows are ignored by Ask resume mapping.
- `packages/workflows/src/executor.test.ts:2616-2641` and `:2806-2831` already prove pending Permission rows block inspect and hydrate without claiming the run.
- Exactly four non-persistence test modules need a new DB mock export once `workflow-operations.ts` imports it: `packages/core/src/operations/workflow-operations.test.ts`, `packages/server/src/routes/api.workflow-runs.test.ts`, `packages/cli/src/commands/workflow.test.ts`, and `packages/cli/src/commands/workflow-command-contract.test.ts`.
- `packages/core/src/workflows/store-adapter.test.ts` does not load `workflow-operations.ts` and therefore does not need a speculative `confirmPendingPermission` mock or store method.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:64-81` contains literal conflict-registry report text appended after valid YAML, not ordinary Git conflict markers.
- The generated-types script in `packages/web/package.json:12` is hard-coded to port `3090`, while worktree servers otherwise auto-allocate ports.

## File Map

### Modify

- `packages/workflows/src/schemas/pending-interaction.ts` owns `permissionConfirmBodySchema`, `PermissionConfirmBody`, `confirmPendingPermissionInputSchema`, and `ConfirmPendingPermissionInput`.
- `packages/workflows/src/schemas/pending-interaction.test.ts` proves the exact body and persistence-input contracts.
- `packages/core/src/db/workflow-pending-interactions.ts` owns `confirmPendingPermission` and `kind_not_permission`.
- `packages/core/src/db/workflow-pending-interactions.test.ts` proves the real-SQLite Permission CAS, atomic resume/event behavior, and error boundaries.
- `packages/core/src/operations/workflow-operations.ts` owns starter authorization, post-commit logging, and live notification for Permission confirm.
- `packages/core/src/operations/workflow-operations.test.ts` proves the operation boundary and supplies the DB mock used by that module.
- `packages/server/src/routes/schemas/workflow.schemas.ts` exposes the engine request schema to OpenAPI.
- `packages/server/src/routes/api.ts` registers the authenticated route and maps typed errors.
- `packages/server/src/routes/api.workflow-runs.test.ts` proves HTTP validation, authorization, status mapping, OpenAPI publication, no auto-dispatch, and safe logging.
- `packages/cli/src/commands/workflow.test.ts` and `packages/cli/src/commands/workflow-command-contract.test.ts` add the DB mock export needed when their real workflow-operations import graph loads.
- `packages/web/src/lib/api.generated.d.ts` is regenerated from the live OpenAPI document.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` is repaired and marks only Story 6.7 done after validation.

### Do Not Create

- Do not create a package, table, migration, UI module, provider module, workflow field, or new store interface.

## Authoritative Contracts

The request body is strict and preserves the submitted string without trimming it.

```ts
export const permissionConfirmBodySchema = z
  .object({
    intent: z
      .string()
      .min(1)
      .refine(value => value.trim().length > 0, 'Intent must not be blank'),
  })
  .strict();

export type PermissionConfirmBody = z.infer<typeof permissionConfirmBodySchema>;

export const confirmPendingPermissionInputSchema = z
  .object({
    workflow_run_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    answer: permissionConfirmBodySchema,
    resolved_by: z.string().min(1),
  })
  .strict();

export type ConfirmPendingPermissionInput = z.infer<
  typeof confirmPendingPermissionInputSchema
>;
```

The persistence function is:

```ts
export async function confirmPendingPermission(
  input: ConfirmPendingPermissionInput
): Promise<ResolvePendingInteractionResult>;
```

The winning persisted event data is exactly:

```ts
{
  node_id: string;
  tool_use_id: string;
  kind: 'permission';
  resumed: boolean;
}
```

The operation contract is:

```ts
export class PermissionRunNotFoundError extends Error {}
export class PermissionAuthenticationRequiredError extends Error {}
export class PermissionForbiddenError extends Error {}

export interface ConfirmPermissionInput {
  runId: string;
  callId: string;
  body: PermissionConfirmBody;
  actorUserId: string | undefined;
}

export interface ConfirmPermissionResult {
  run: WorkflowRun;
  interaction: PendingInteraction;
  resumed: boolean;
  remainingPending: number;
}

export async function confirmPermission(
  input: ConfirmPermissionInput
): Promise<ConfirmPermissionResult>;
```

The HTTP status contract is `200` for the winning confirm, `400` for an invalid body or wrong interaction kind, `401` for missing requester identity, `403` for a non-starter or unowned run, `404` for a missing run or interaction, `409` for an already-resolved interaction or a run that is not paused, and `500` for an unexpected safe failure.

## Implementation Order

Execute Tasks 1 through 5 in numeric order.
Do not start Task 3 until Task 2 is green, and do not start Task 4 until Task 3 plus its mock consumers are green.
Do not update sprint status until the generated types, focused tests, and full validation have passed.

### Task 1: Add the split Permission schemas

**Files:**

- Modify: `packages/workflows/src/schemas/pending-interaction.test.ts:1-165`
- Modify: `packages/workflows/src/schemas/pending-interaction.ts:52-86`

**Interfaces:**

- Consumes: `z` from `@hono/zod-openapi` and the existing `resolvePendingInteractionResultSchema`.
- Produces: `permissionConfirmBodySchema`, `PermissionConfirmBody`, `confirmPendingPermissionInputSchema`, and `ConfirmPendingPermissionInput` with the exact shapes in Authoritative Contracts.

- [ ] **Step 1: Write the RED schema tests.**

Add these imports and tests to `pending-interaction.test.ts`.

```ts
import {
  confirmPendingPermissionInputSchema,
  permissionConfirmBodySchema,
  type ConfirmPendingPermissionInput,
  type PermissionConfirmBody,
} from './pending-interaction';

describe('permissionConfirmBodySchema', () => {
  test('accepts an exact opaque intent and preserves surrounding whitespace', () => {
    const body: PermissionConfirmBody = permissionConfirmBodySchema.parse({
      intent: ' allow-once ',
    });
    expect(body).toEqual({ intent: ' allow-once ' });
  });

  test.each([
    {},
    { intent: '' },
    { intent: '   ' },
    { intent: 1 },
    { intent: 'allow-once', extra: true },
    { intent: 'allow-once', decline: true },
    { answers: [{ questionId: 'q1', value: 'yes' }] },
  ])('rejects a body outside the exact intent contract: %#', body => {
    expect(permissionConfirmBodySchema.safeParse(body).success).toBe(false);
  });
});

test('confirmPendingPermissionInputSchema accepts only the persistence fields', () => {
  const input: ConfirmPendingPermissionInput = confirmPendingPermissionInputSchema.parse({
    workflow_run_id: 'run-1',
    tool_use_id: 'tool-1',
    answer: { intent: 'allow-once' },
    resolved_by: 'user-1',
  });
  expect(input.answer).toEqual({ intent: 'allow-once' });
  expect(
    confirmPendingPermissionInputSchema.safeParse({ ...input, extra: true }).success
  ).toBe(false);
});
```

- [ ] **Step 2: Run the schema test and observe RED.**

Run:

```bash
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
```

Expected result: the new tests fail because the Permission schemas and inferred types do not exist, rather than because of a fixture or syntax error.

- [ ] **Step 3: Add the minimal engine-owned schemas and inferred types.**

Add the exact schema code from Authoritative Contracts immediately after `AskAnswerBody` and before `resolvePendingInteractionInputSchema`.
Do not change `pendingInteractionSchema`, `askAnswerBodySchema`, or `resolvePendingInteractionInputSchema`.
Do not trim or normalize `intent`.

- [ ] **Step 4: Run GREEN, perform the schema-only REFACTOR check, and rerun.**

Run:

```bash
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
```

Expected result: every test in the file passes.
For REFACTOR, verify that no parallel hand-written body type or Permission envelope schema was added, then rerun the same command without changing behavior.

- [ ] **Step 5: Commit the contract slice.**

```bash
git add packages/workflows/src/schemas/pending-interaction.ts packages/workflows/src/schemas/pending-interaction.test.ts
git commit -m "feat(workflows): define permission confirm contract"
```

### Task 2: Implement the atomic Permission confirmation CAS

**Files:**

- Modify: `packages/core/src/db/workflow-pending-interactions.test.ts:11-868`
- Modify: `packages/core/src/db/workflow-pending-interactions.ts:8-439`

**Interfaces:**

- Consumes: `ConfirmPendingPermissionInput`, `confirmPendingPermissionInputSchema`, `ResolvePendingInteractionResult`, `workflowRunLockClause()`, `resumeWorkflowRunInTransaction(query, runId, dialect, 'paused-ask')`, and `insertWorkflowEvent()`.
- Produces: `confirmPendingPermission(input): Promise<ResolvePendingInteractionResult>` and the added validation code `'kind_not_permission'`.

- [ ] **Step 1: Add the RED real-SQLite fixtures and confirmation tests before production code.**

Import `ConfirmPendingPermissionInput`, destructure `confirmPendingPermission` and `PendingInteractionNotFoundError` from the dynamic module import, and add these fixtures beside `resolveInput` and `insertPausedAsk`.

```ts
const SENTINEL_INTENT = 'DO_NOT_LOG_PERMISSION_INTENT';

function permissionInput(
  overrides: Partial<ConfirmPendingPermissionInput> = {}
): ConfirmPendingPermissionInput {
  return {
    workflow_run_id: 'run-1',
    tool_use_id: 'toolu_perm_1',
    answer: { intent: ` ${SENTINEL_INTENT} ` },
    resolved_by: 'user-1',
    ...overrides,
  };
}

async function insertPausedPermission(): Promise<void> {
  await insertPendingInteraction({
    ...baseInput,
    tool_use_id: 'toolu_perm_1',
    kind: 'permission',
    envelope: { tool: 'Bash' },
  });
  await pauseRun();
}
```

Add a new `describe('confirmPendingPermission', ...)` with these tests.

```ts
test('confirms the last Permission and commits an identifier-only event with the resume', async () => {
  await insertPausedPermission();

  const result = await confirmPendingPermission(permissionInput());

  expect(result.resumed).toBe(true);
  expect(result.remaining_pending).toBe(0);
  expect(result.interaction.status).toBe('answered');
  expect(result.interaction.answer).toEqual({ intent: ` ${SENTINEL_INTENT} ` });
  expect(result.interaction.resolved_by).toBe('user-1');
  expect(await runStatus()).toBe('running');
  expect((await resolvedEvents())[0]?.data).toEqual({
    node_id: 'review',
    tool_use_id: 'toolu_perm_1',
    kind: 'permission',
    resumed: true,
  });
  expect(JSON.stringify(await resolvedEvents())).not.toContain(SENTINEL_INTENT);
  expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_INTENT);
});

test('preserves the first intent when a second confirmation loses the CAS', async () => {
  await insertPausedPermission();
  await confirmPendingPermission(permissionInput());

  await expect(
    confirmPendingPermission(permissionInput({ answer: { intent: 'second-intent' } }))
  ).rejects.toBeInstanceOf(PendingInteractionAlreadyResolvedError);

  const [row] = await listPendingInteractions('run-1');
  expect(row?.answer).toEqual({ intent: ` ${SENTINEL_INTENT} ` });
});

test('leaves the run paused while a sibling Ask remains pending', async () => {
  await insertPendingInteraction({
    ...baseInput,
    tool_use_id: 'toolu_perm_1',
    kind: 'permission',
    envelope: {},
  });
  await insertPendingInteraction({ ...baseInput, tool_use_id: 'toolu_ask_1', envelope: mixedEnvelope });
  await pauseRun();

  const result = await confirmPendingPermission(permissionInput());

  expect(result.resumed).toBe(false);
  expect(result.remaining_pending).toBe(1);
  expect(await runStatus()).toBe('paused');
});

test('resumes when an answered Ask leaves Permission as the final pending row', async () => {
  await insertPendingInteraction({
    ...baseInput,
    tool_use_id: 'toolu_perm_1',
    kind: 'permission',
    envelope: {},
  });
  await insertPendingInteraction({ ...baseInput, tool_use_id: 'toolu_ask_1', envelope: mixedEnvelope });
  await pauseRun();
  const askResult = await resolvePendingInteraction(
    resolveInput({ tool_use_id: 'toolu_ask_1' })
  );
  expect(askResult.resumed).toBe(false);

  const result = await confirmPendingPermission(permissionInput());

  expect(result.resumed).toBe(true);
  expect(result.remaining_pending).toBe(0);
  expect(await runStatus()).toBe('running');
});

test('rolls back the confirmation when the resolved event insert fails', async () => {
  await insertPausedPermission();
  await db.query(`
    CREATE TRIGGER abort_permission_event BEFORE INSERT ON remote_agent_workflow_events
    BEGIN
      SELECT RAISE(ABORT, 'event insert blocked');
    END
  `);
  try {
    await expect(confirmPendingPermission(permissionInput())).rejects.toThrow();
    const [row] = await listPendingInteractions('run-1');
    expect(row?.status).toBe('pending');
    expect(row?.answer).toBeNull();
    expect(await runStatus()).toBe('paused');
  } finally {
    await db.query('DROP TRIGGER IF EXISTS abort_permission_event');
  }
});

test('rolls back the confirmation when the paused-run resume CAS loses', async () => {
  await insertPausedPermission();
  await db.query(`
    CREATE TRIGGER skip_permission_resume BEFORE UPDATE ON remote_agent_workflow_runs
    WHEN NEW.status = 'running' AND OLD.status = 'paused'
    BEGIN
      SELECT RAISE(IGNORE);
    END
  `);
  try {
    await expect(confirmPendingPermission(permissionInput())).rejects.toBeInstanceOf(
      PendingInteractionRunNotPausedError
    );
    const [row] = await listPendingInteractions('run-1');
    expect(row?.status).toBe('pending');
    expect(row?.answer).toBeNull();
  } finally {
    await db.query('DROP TRIGGER IF EXISTS skip_permission_resume');
  }
});

test('rejects a confirmation before the run reaches paused', async () => {
  await insertPendingInteraction({
    ...baseInput,
    tool_use_id: 'toolu_perm_1',
    kind: 'permission',
    envelope: {},
  });
  await expect(confirmPendingPermission(permissionInput())).rejects.toBeInstanceOf(
    PendingInteractionRunNotPausedError
  );
  expect((await listPendingInteractions('run-1'))[0]?.status).toBe('pending');
});

test('rejects a pending Ask without consuming it', async () => {
  await insertPendingInteraction({ ...baseInput, tool_use_id: 'toolu_perm_1', envelope: mixedEnvelope });
  await pauseRun();
  const error = await confirmPendingPermission(permissionInput()).then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(PendingInteractionValidationError);
  expect((error as PendingInteractionValidationError).code).toBe('kind_not_permission');
  expect((await listPendingInteractions('run-1'))[0]?.status).toBe('pending');
});

test('rejects a whitespace-only intent before opening the transaction', async () => {
  await insertPausedPermission();
  const error = await confirmPendingPermission(
    permissionInput({ answer: { intent: '   ' } })
  ).then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(PendingInteractionValidationError);
  expect((error as PendingInteractionValidationError).code).toBe('invalid_body');
  expect((await listPendingInteractions('run-1'))[0]?.status).toBe('pending');
});

test('reports a missing run and a missing call id without exposing intent', async () => {
  const missingRun = await confirmPendingPermission(
    permissionInput({ workflow_run_id: 'missing-run' })
  ).then(
    () => null,
    (caught: unknown) => caught
  );
  expect(missingRun).toBeInstanceOf(PendingInteractionNotFoundError);

  await pauseRun();
  const missingCall = await confirmPendingPermission(permissionInput()).then(
    () => null,
    (caught: unknown) => caught
  );
  expect(missingCall).toBeInstanceOf(PendingInteractionNotFoundError);
  expect(JSON.stringify([missingRun, missingCall, errorLogs])).not.toContain(SENTINEL_INTENT);
});
```

- [ ] **Step 2: Run the persistence test and observe RED.**

Run:

```bash
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
```

Expected result: the new Permission tests fail because `confirmPendingPermission` and `kind_not_permission` are absent, while the existing Ask tests still execute normally.

- [ ] **Step 3: Implement the minimal Permission transaction.**

Add the two schema imports, add `'kind_not_permission'` to `PendingInteractionValidationCode`, update the module docblock to cover Ask and Permission resolution, and add this function immediately after `resolvePendingInteraction`.

```ts
export async function confirmPendingPermission(
  input: ConfirmPendingPermissionInput
): Promise<ResolvePendingInteractionResult> {
  const parsedInput = confirmPendingPermissionInputSchema.safeParse(input);
  if (!parsedInput.success) throwValidation('invalid_body');

  const workflowRunId = parsedInput.data.workflow_run_id;
  const toolUseId = parsedInput.data.tool_use_id;
  const answer = parsedInput.data.answer;
  const resolvedBy = parsedInput.data.resolved_by;
  const db = getDatabase();
  const dialect = getDialect();
  const lockSuffix = workflowRunLockClause();

  return db.withTransaction(async query => {
    const runResult = await query<{ status: string }>(
      `SELECT status FROM remote_agent_workflow_runs WHERE id = $1${lockSuffix}`,
      [workflowRunId]
    );
    const run = runResult.rows[0];
    if (!run) {
      throw new PendingInteractionNotFoundError(workflowRunId, toolUseId);
    }

    const interactionResult = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS}
       FROM remote_agent_pending_interactions
       WHERE workflow_run_id = $1 AND tool_use_id = $2${lockSuffix}`,
      [workflowRunId, toolUseId]
    );
    const rawInteraction = interactionResult.rows[0];
    if (!rawInteraction) {
      throw new PendingInteractionNotFoundError(workflowRunId, toolUseId);
    }
    const current = parsePendingInteractionRow(rawInteraction);
    if (current.status !== 'pending') {
      throw new PendingInteractionAlreadyResolvedError(workflowRunId, toolUseId, current.status);
    }
    if (run.status !== 'paused') {
      throw new PendingInteractionRunNotPausedError(workflowRunId, run.status);
    }
    if (current.kind !== 'permission') throwValidation('kind_not_permission');

    const cas = await query(
      `UPDATE remote_agent_pending_interactions
       SET status = 'answered',
           answer = $2,
           resolved_at = ${dialect.now()},
           resolved_by = $3
       WHERE id = $1 AND status = 'pending'`,
      [current.id, JSON.stringify(answer), resolvedBy]
    );
    if (cas.rowCount === 0) {
      throw new PendingInteractionAlreadyResolvedError(workflowRunId, toolUseId, current.status);
    }

    const remainingResult = await query<{ remaining: number | string }>(
      `SELECT COUNT(*) AS remaining
       FROM remote_agent_pending_interactions
       WHERE workflow_run_id = $1 AND status = 'pending'`,
      [workflowRunId]
    );
    const remainingPending = Number(remainingResult.rows[0]?.remaining ?? 0);
    let resumed = false;
    if (remainingPending === 0) {
      const resumeResult = await resumeWorkflowRunInTransaction(
        query,
        workflowRunId,
        dialect,
        'paused-ask'
      );
      if (!resumeResult.resumed) {
        throw new PendingInteractionRunNotPausedError(workflowRunId, run.status);
      }
      resumed = true;
    }

    await insertWorkflowEvent(query, {
      workflow_run_id: workflowRunId,
      event_type: 'interaction_resolved',
      step_name: current.node_id,
      data: {
        node_id: current.node_id,
        tool_use_id: toolUseId,
        kind: 'permission',
        resumed,
      },
    });

    const resolvedRows = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM remote_agent_pending_interactions WHERE id = $1`,
      [current.id]
    );
    const resolvedRow = resolvedRows.rows[0];
    if (!resolvedRow) {
      throw new Error(`Pending interaction vanished after resolve: ${current.id}`);
    }
    return {
      interaction: parsePendingInteractionRow(resolvedRow),
      resumed,
      remaining_pending: remainingPending,
    };
  });
}
```

Keep the Permission and Ask transaction bodies explicit.
Do not extract a two-caller generic resolver because the repository rule of three favors local duplication here and the kind-specific validation and event payloads differ.

- [ ] **Step 4: Run GREEN for persistence and its existing resume regression.**

Run:

```bash
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
(cd packages/core && bun test src/db/workflows.resume-cas.integration.test.ts)
```

Expected result: both commands exit zero, all existing Ask behavior stays green, and every Permission test passes.

- [ ] **Step 5: Perform the persistence REFACTOR check and rerun GREEN.**

Remove repeated local variable names or comments only when doing so keeps the Ask and Permission branches explicit.
Confirm that no body, answer, envelope, or raw input was added to an error or logger call.
Rerun the two commands from Step 4 after any cleanup.

- [ ] **Step 6: Commit the persistence slice.**

```bash
git add packages/core/src/db/workflow-pending-interactions.ts packages/core/src/db/workflow-pending-interactions.test.ts
git commit -m "feat(core): confirm permission interactions atomically"
```

### Task 3: Add starter-authorized Permission operations

**Files:**

- Modify: `packages/core/src/operations/workflow-operations.test.ts:1-1464`
- Modify: `packages/core/src/operations/workflow-operations.ts:1-340`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts:603-644`
- Modify: `packages/cli/src/commands/workflow.test.ts:235-251`
- Modify: `packages/cli/src/commands/workflow-command-contract.test.ts:107-123`

**Interfaces:**

- Consumes: `PermissionConfirmBody`, `PendingInteraction`, `confirmPendingPermission`, and `workflowDb.getWorkflowRun`.
- Produces: the three Permission error classes, `ConfirmPermissionInput`, `ConfirmPermissionResult`, and `confirmPermission(input)` from Authoritative Contracts.

- [ ] **Step 1: Add the RED operation tests and the configurable DB double.**

In `workflow-operations.test.ts`, define `mockConfirmPendingPermission` beside `mockResolvePendingInteraction`.
Replace the existing pending-interaction mock factory with the shown three-export factory, extend the existing dynamic import destructuring with the four shown names, and add this describe beside `answerAskHuman`.

```ts
const INTENT_SENTINEL = 'DO_NOT_LOG_PERMISSION_INTENT';
const mockConfirmPendingPermission = mock(() =>
  Promise.resolve({
    interaction: makePendingInteraction({
      kind: 'permission',
      status: 'answered',
      envelope: {},
      answer: { intent: INTENT_SENTINEL },
      resolved_at: new Date(),
      resolved_by: 'starter-1',
    }),
    resumed: false,
    remaining_pending: 1,
  })
);

mock.module('../db/workflow-pending-interactions', () => ({
  listPendingInteractions: mockListPendingInteractions,
  resolvePendingInteraction: mockResolvePendingInteraction,
  confirmPendingPermission: mockConfirmPendingPermission,
}));

const {
  confirmPermission,
  PermissionAuthenticationRequiredError,
  PermissionForbiddenError,
  PermissionRunNotFoundError,
} = await import('./workflow-operations');

describe('confirmPermission', () => {
  const starterId = 'starter-1';
  const body = { intent: INTENT_SENTINEL } as const;

  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockConfirmPendingPermission.mockReset();
    mockConfirmPendingPermission.mockResolvedValue({
      interaction: makePendingInteraction({
        kind: 'permission',
        status: 'answered',
        envelope: {},
        answer: body,
        resolved_at: new Date(),
        resolved_by: starterId,
      }),
      resumed: false,
      remaining_pending: 1,
    });
    mockEmit.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
  });

  test('requires an authenticated actor before persistence', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: starterId }));
    await expect(
      confirmPermission({ runId: 'run-1', callId: 'tool-1', body, actorUserId: undefined })
    ).rejects.toBeInstanceOf(PermissionAuthenticationRequiredError);
    expect(mockConfirmPendingPermission).not.toHaveBeenCalled();
  });

  test.each([null, 'different-user'])('rejects a run not owned by the actor: %s', async owner => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: owner }));
    await expect(
      confirmPermission({ runId: 'run-1', callId: 'tool-1', body, actorUserId: starterId })
    ).rejects.toBeInstanceOf(PermissionForbiddenError);
    expect(mockConfirmPendingPermission).not.toHaveBeenCalled();
  });

  test('throws the Permission not-found error when the run is missing', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);
    await expect(
      confirmPermission({ runId: 'missing', callId: 'tool-1', body, actorUserId: starterId })
    ).rejects.toBeInstanceOf(PermissionRunNotFoundError);
  });

  test('redacts the database lookup error message', async () => {
    mockGetWorkflowRun.mockRejectedValueOnce(new Error(INTENT_SENTINEL));
    await expect(
      confirmPermission({ runId: 'run-1', callId: 'tool-1', body, actorUserId: starterId })
    ).rejects.toThrow('Failed to look up workflow run run-1');
    expect(mockLogger.error).toHaveBeenCalledWith(
      { errorName: 'Error', runId: 'run-1' },
      'operations.workflow_permission_lookup_failed'
    );
    expect(loggerAndEmitPayloads()).not.toContain(INTENT_SENTINEL);
  });

  test('passes the call id and starter id to persistence exactly once', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: starterId }));
    await confirmPermission({ runId: 'run-1', callId: 'tool-1', body, actorUserId: starterId });
    expect(mockConfirmPendingPermission).toHaveBeenCalledTimes(1);
    expect(mockConfirmPendingPermission).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      tool_use_id: 'tool-1',
      answer: body,
      resolved_by: starterId,
    });
  });

  test('logs and emits only after the persistence promise commits', async () => {
    const run = makePausedRun({ user_id: starterId });
    const interaction = makePendingInteraction({
      kind: 'permission',
      status: 'answered',
      envelope: {},
      answer: body,
      resolved_at: new Date(),
      resolved_by: starterId,
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);
    let finish!: (value: {
      interaction: PendingInteraction;
      resumed: boolean;
      remaining_pending: number;
    }) => void;
    mockConfirmPendingPermission.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const pending = confirmPermission({
      runId: 'run-1',
      callId: 'tool-1',
      body,
      actorUserId: starterId,
    });
    await Promise.resolve();
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();

    finish({ interaction, resumed: true, remaining_pending: 0 });
    const result = await pending;

    expect(result).toEqual({ run, interaction, resumed: true, remainingPending: 0 });
    expect(mockLogger.info).toHaveBeenCalledWith(
      {
        workflowRunId: 'run-1',
        nodeId: 'ask-node',
        toolUseId: 'tool-1',
        resumed: true,
      },
      'workflow.permission_resolved'
    );
    expect(mockEmit).toHaveBeenCalledWith({
      type: 'interaction_resolved',
      runId: 'run-1',
      nodeId: 'ask-node',
      resumed: true,
    });
    expect(loggerAndEmitPayloads()).not.toContain(INTENT_SENTINEL);
  });

  test('propagates a persistence error without logging or emitting', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: starterId }));
    const error = new Error('persistence failed');
    mockConfirmPendingPermission.mockRejectedValueOnce(error);
    await expect(
      confirmPermission({ runId: 'run-1', callId: 'tool-1', body, actorUserId: starterId })
    ).rejects.toBe(error);
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the operation test and observe RED.**

Run:

```bash
(cd packages/core && bun test src/operations/workflow-operations.test.ts)
```

Expected result: the Permission operation and error imports are absent, while the existing Ask operation tests remain intact.

- [ ] **Step 3: Implement the minimal operation and Permission-specific errors.**

Add `PermissionConfirmBody` to the type import, import `confirmPendingPermission`, add the contracts from Authoritative Contracts beside the Ask contracts, and add the following implementation beside `answerAskHuman`.

```ts
export class PermissionRunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`Workflow run not found: ${runId}`);
    this.name = 'PermissionRunNotFoundError';
  }
}

export class PermissionAuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'PermissionAuthenticationRequiredError';
  }
}

export class PermissionForbiddenError extends Error {
  constructor(readonly runId: string) {
    super(`Not allowed to confirm permission for run ${runId}`);
    this.name = 'PermissionForbiddenError';
  }
}

export interface ConfirmPermissionInput {
  runId: string;
  callId: string;
  body: PermissionConfirmBody;
  actorUserId: string | undefined;
}

export interface ConfirmPermissionResult {
  run: WorkflowRun;
  interaction: PendingInteraction;
  resumed: boolean;
  remainingPending: number;
}

export async function confirmPermission(
  input: ConfirmPermissionInput
): Promise<ConfirmPermissionResult> {
  const run = await loadPermissionRun(input.runId);
  const actorUserId = assertPermissionActor(run, input.actorUserId);
  const resolved = await confirmPendingPermission({
    workflow_run_id: input.runId,
    tool_use_id: input.callId,
    answer: input.body,
    resolved_by: actorUserId,
  });
  getLog().info(
    {
      workflowRunId: input.runId,
      nodeId: resolved.interaction.node_id,
      toolUseId: resolved.interaction.tool_use_id,
      resumed: resolved.resumed,
    },
    'workflow.permission_resolved'
  );
  getWorkflowEventEmitter().emit({
    type: 'interaction_resolved',
    runId: input.runId,
    nodeId: resolved.interaction.node_id,
    resumed: resolved.resumed,
  });
  return {
    run,
    interaction: resolved.interaction,
    resumed: resolved.resumed,
    remainingPending: resolved.remaining_pending,
  };
}

async function loadPermissionRun(runId: string): Promise<WorkflowRun> {
  let run: WorkflowRun | null;
  try {
    run = await workflowDb.getWorkflowRun(runId);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    getLog().error(
      { errorName, runId },
      'operations.workflow_permission_lookup_failed'
    );
    throw new Error(`Failed to look up workflow run ${runId}`);
  }
  if (!run) throw new PermissionRunNotFoundError(runId);
  return run;
}

function assertPermissionActor(run: WorkflowRun, actorUserId: string | undefined): string {
  if (actorUserId === undefined || actorUserId === '') {
    throw new PermissionAuthenticationRequiredError();
  }
  if (run.user_id === null || run.user_id !== actorUserId) {
    throw new PermissionForbiddenError(run.id);
  }
  return actorUserId;
}
```

Use these exact constructor messages: `Authentication required`, `Not allowed to confirm permission for run ${runId}`, and `Workflow run not found: ${runId}`.
Do not reuse the Ask error classes or change Ask messages.

- [ ] **Step 4: Add the new DB export to the three remaining import-graph mocks before running their tests.**

In `packages/server/src/routes/api.workflow-runs.test.ts`, define a configurable `mockConfirmPendingPermission` next to `mockResolvePendingInteraction` and expose it from the existing factory.

```ts
const mockConfirmPendingPermission = mock(
  async (
    _input: unknown
  ): Promise<{
    interaction: MockPendingInteractionRow;
    resumed: boolean;
    remaining_pending: number;
  }> => ({
    interaction: {
      id: 'pending-permission',
      workflow_run_id: 'run-permission',
      node_id: 'permission-node',
      tool_use_id: 'tool-permission',
      kind: 'permission',
      status: 'answered',
      envelope: {},
      answer: { intent: 'allow-once' },
      provider_session_id: 'session-permission',
      created_at: new Date('2026-09-07T00:00:00.000Z'),
      resolved_at: new Date('2026-09-07T00:00:01.000Z'),
      resolved_by: 'user-permission',
    },
    resumed: false,
    remaining_pending: 1,
  })
);

mock.module('@archon/core/db/workflow-pending-interactions', () => ({
  listPendingInteractions: mockListPendingInteractions,
  resolvePendingInteraction: mockResolvePendingInteraction,
  confirmPendingPermission: mockConfirmPendingPermission,
  PendingInteractionNotFoundError,
  PendingInteractionAlreadyResolvedError,
  PendingInteractionRunNotPausedError,
  PendingInteractionValidationError,
}));
```

In `packages/cli/src/commands/workflow.test.ts`, add this property to the existing factory.

```ts
confirmPendingPermission: mock(() =>
  Promise.resolve({
    interaction: {
      id: 'pending-permission',
      workflow_run_id: 'run-permission',
      node_id: 'permission-node',
      tool_use_id: 'tool-permission',
      kind: 'permission' as const,
      status: 'answered' as const,
      envelope: {},
      answer: { intent: 'allow-once' },
      provider_session_id: 'session-permission',
      created_at: new Date('2026-09-07T00:00:00.000Z'),
      resolved_at: new Date('2026-09-07T00:00:01.000Z'),
      resolved_by: 'user-permission',
    },
    resumed: false,
    remaining_pending: 1,
  })
),
```

In `packages/cli/src/commands/workflow-command-contract.test.ts`, add this complete property to that file's independent factory.

```ts
confirmPendingPermission: mock(() =>
  Promise.resolve({
    interaction: {
      id: 'pending-permission',
      workflow_run_id: 'run-permission',
      node_id: 'permission-node',
      tool_use_id: 'tool-permission',
      kind: 'permission' as const,
      status: 'answered' as const,
      envelope: {},
      answer: { intent: 'allow-once' },
      provider_session_id: 'session-permission',
      created_at: new Date('2026-09-07T00:00:00.000Z'),
      resolved_at: new Date('2026-09-07T00:00:01.000Z'),
      resolved_by: 'user-permission',
    },
    resumed: false,
    remaining_pending: 1,
  })
),
```

Do not touch the store-adapter mock because its module under test does not import the new operation.

- [ ] **Step 5: Run GREEN for the operation and every affected mock consumer.**

Run:

```bash
(cd packages/core && bun test src/operations/workflow-operations.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/cli && bun test src/commands/workflow.test.ts)
(cd packages/cli && bun test src/commands/workflow-command-contract.test.ts)
```

Expected result: all four commands exit zero.

- [ ] **Step 6: Perform the operation REFACTOR check and rerun GREEN.**

Keep Permission-specific lookup and authorization helpers explicit because their error names and safe logging differ from Ask.
Update the file docblock to mention Permission, verify no intent-bearing value reaches a logger or emitter, and rerun Step 5.

- [ ] **Step 7: Commit the operation and mock-contract slice.**

```bash
git add packages/core/src/operations/workflow-operations.ts packages/core/src/operations/workflow-operations.test.ts packages/server/src/routes/api.workflow-runs.test.ts packages/cli/src/commands/workflow.test.ts packages/cli/src/commands/workflow-command-contract.test.ts
git commit -m "feat(core): authorize permission confirmation"
```

### Task 4: Register the authenticated Permission route

**Files:**

- Modify: `packages/server/src/routes/schemas/workflow.schemas.ts:13-20,307-308`
- Modify: `packages/server/src/routes/api.ts:417-459,1457-1488,4861-4923`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts:555-644,4134-4510`

**Interfaces:**

- Consumes: `permissionConfirmBodySchema`, `confirmPermission`, the three Permission operation errors, the four existing pending-interaction DB errors, and `workflowRunActionResponseSchema`.
- Produces: `permissionConfirmRequestSchema` and the registered POST route with the HTTP status contract in Authoritative Contracts.

- [ ] **Step 1: Write the RED HTTP tests against the real registered route.**

Extend the local `PendingInteractionValidationCode` union with `'kind_not_permission'`.
Add these fixtures and request helper beside the Ask route fixtures.

```ts
const PERMISSION_STARTER_ID = 'permission-starter';
const PERMISSION_CALL_ID = 'toolu_permission_1';
const PERMISSION_INTENT_SENTINEL = 'DO_NOT_LOG_PERMISSION_INTENT';

function mockPermissionRun(overrides: Partial<MockWorkflowRun> = {}): MockWorkflowRun {
  return {
    ...MOCK_PAUSED_RUN,
    id: 'run-permission-1',
    workflow_name: 'permission-flow',
    user_id: PERMISSION_STARTER_ID,
    metadata: {},
    ...overrides,
  };
}

async function postPermission(body: string, userId?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId !== undefined) headers['X-Archon-User'] = userId;
  const { app } = makeApp();
  return app.request(
    `/api/workflows/runs/run-permission-1/permissions/${PERMISSION_CALL_ID}/confirm`,
    { method: 'POST', headers, body }
  );
}
```

Add this describe immediately after the Ask answer describe.

```ts
describe('POST /api/workflows/runs/:runId/permissions/:callId/confirm', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockConfirmPendingPermission.mockReset();
    mockHandleMessage.mockReset();
    mockApiLogError.mockClear();
    mockConfirmPendingPermission.mockResolvedValue({
      interaction: {
        id: 'pi-permission-1',
        workflow_run_id: 'run-permission-1',
        node_id: 'permission-node',
        tool_use_id: PERMISSION_CALL_ID,
        kind: 'permission',
        status: 'answered',
        envelope: {},
        answer: { intent: PERMISSION_INTENT_SENTINEL },
        provider_session_id: 'permission-session',
        created_at: NOW,
        resolved_at: NOW,
        resolved_by: PERMISSION_STARTER_ID,
      },
      resumed: true,
      remaining_pending: 0,
    });
  });

  test('returns 200 and confirms by call id with the authenticated starter', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(mockPermissionRun());
    const response = await postPermission(
      JSON.stringify({ intent: PERMISSION_INTENT_SENTINEL }),
      PERMISSION_STARTER_ID
    );
    expect(response.status).toBe(200);
    expect(mockConfirmPendingPermission).toHaveBeenCalledWith({
      workflow_run_id: 'run-permission-1',
      tool_use_id: PERMISSION_CALL_ID,
      answer: { intent: PERMISSION_INTENT_SENTINEL },
      resolved_by: PERMISSION_STARTER_ID,
    });
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('returns 401 before body validation and run lookup', async () => {
    const response = await postPermission('{"intent":', undefined);
    expect(response.status).toBe(401);
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
    expect(mockConfirmPendingPermission).not.toHaveBeenCalled();
  });

  test.each([
    '{}',
    '{"intent":""}',
    '{"intent":"   "}',
    '{"intent":1}',
    '{"intent":"allow-once","extra":true}',
    '{"intent":"allow-once","decline":true}',
    '{"answers":[{"questionId":"q1","value":"yes"}]}',
    '{"intent":',
  ])('returns 400 for a body outside the exact intent contract: %s', async body => {
    const response = await postPermission(body, PERMISSION_STARTER_ID);
    expect(response.status).toBe(400);
    expect(mockConfirmPendingPermission).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-starter even when identity resolution marks users as admin', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(mockPermissionRun());
    const response = await postPermission('{"intent":"allow-once"}', 'other-admin');
    expect(response.status).toBe(403);
    expect(mockConfirmPendingPermission).not.toHaveBeenCalled();
  });

  test('returns 404 when the run is missing', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);
    const response = await postPermission('{"intent":"allow-once"}', PERMISSION_STARTER_ID);
    expect(response.status).toBe(404);
  });

  test.each([
    [new PendingInteractionNotFoundError('run-permission-1', PERMISSION_CALL_ID), 404],
    [new PendingInteractionAlreadyResolvedError('run-permission-1', PERMISSION_CALL_ID, 'answered'), 409],
    [new PendingInteractionRunNotPausedError('run-permission-1', 'running'), 409],
    [new PendingInteractionValidationError('kind_not_permission'), 400],
  ] as const)('maps a typed persistence error to HTTP %i', async (error, status) => {
    mockGetWorkflowRun.mockResolvedValueOnce(mockPermissionRun());
    mockConfirmPendingPermission.mockRejectedValueOnce(error);
    const response = await postPermission('{"intent":"allow-once"}', PERMISSION_STARTER_ID);
    expect(response.status).toBe(status);
  });

  test('returns a safe 500 and never logs the intent or raw error message', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(mockPermissionRun());
    mockConfirmPendingPermission.mockRejectedValueOnce(new Error(PERMISSION_INTENT_SENTINEL));
    const response = await postPermission(
      JSON.stringify({ intent: PERMISSION_INTENT_SENTINEL }),
      PERMISSION_STARTER_ID
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to confirm permission' });
    expect(JSON.stringify(mockApiLogError.mock.calls)).not.toContain(PERMISSION_INTENT_SENTINEL);
  });

  test('publishes the Permission request component and route in OpenAPI', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/openapi.json');
    const document = (await response.json()) as {
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    expect(
      document.paths['/api/workflows/runs/{runId}/permissions/{callId}/confirm']
    ).toBeDefined();
    expect(document.components?.schemas?.PermissionConfirmBody).toMatchObject({
      type: 'object',
      required: ['intent'],
      additionalProperties: false,
    });
  });
});
```

- [ ] **Step 2: Run the route test and observe RED.**

Run:

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
```

Expected result: the new requests receive `404` because no Permission route is registered, while the mock graph loads cleanly and existing Ask tests remain green.

- [ ] **Step 3: Add the OpenAPI request schema and route declaration.**

In `workflow.schemas.ts`, import `permissionConfirmBodySchema` and add:

```ts
/** POST /api/workflows/runs/:runId/permissions/:callId/confirm request body. */
export const permissionConfirmRequestSchema =
  permissionConfirmBodySchema.openapi('PermissionConfirmBody');
```

In `api.ts`, import the new request schema, `confirmPermission`, and the three Permission operation errors.
Declare this route next to `answerAskHumanRoute`.

```ts
const confirmPermissionRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/permissions/{callId}/confirm',
  tags: ['Workflows'],
  summary: 'Confirm a pending permission interaction',
  request: {
    params: z.object({
      runId: z.string().min(1),
      callId: z.string().min(1),
    }),
    body: {
      content: {
        'application/json': { schema: permissionConfirmRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: workflowRunActionResponseSchema },
      },
      description: 'Permission confirmation accepted',
    },
    400: jsonError('Invalid permission confirmation'),
    401: jsonError('Authentication required'),
    403: jsonError('Forbidden'),
    404: jsonError('Not found'),
    409: jsonError('Conflict'),
    500: jsonError('Server error'),
  },
});
```

- [ ] **Step 4: Register pre-validation auth and the minimal handler.**

Place the middleware and handler immediately after the Ask route so the two split POST contracts remain discoverable together.

```ts
app.use('/api/workflows/runs/:runId/permissions/:callId/confirm', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const requester = await resolveAuthContext(c);
  if (!requester) return apiError(c, 401, 'Authentication required');
  return next();
});

registerOpenApiRoute(confirmPermissionRoute, async c => {
  const runId = c.req.param('runId') ?? '';
  const callId = c.req.param('callId') ?? '';
  try {
    const requester = await resolveAuthContext(c);
    if (!requester) return apiError(c, 401, 'Authentication required');
    const body = getValidatedBody(c, permissionConfirmRequestSchema);
    const result = await confirmPermission({
      runId,
      callId,
      body,
      actorUserId: requester.userId,
    });
    return c.json({
      success: true,
      message:
        result.remainingPending > 0
          ? `Permission confirmation accepted: ${result.run.workflow_name}. Other interactions remain.`
          : `Permission confirmation accepted: ${result.run.workflow_name}.`,
    });
  } catch (error) {
    if (error instanceof PermissionAuthenticationRequiredError) {
      return apiError(c, 401, error.message);
    }
    if (error instanceof PermissionForbiddenError) {
      return apiError(c, 403, error.message);
    }
    if (
      error instanceof PermissionRunNotFoundError ||
      error instanceof workflowPendingInteractionDb.PendingInteractionNotFoundError
    ) {
      return apiError(c, 404, error.message);
    }
    if (
      error instanceof workflowPendingInteractionDb.PendingInteractionAlreadyResolvedError ||
      error instanceof workflowPendingInteractionDb.PendingInteractionRunNotPausedError
    ) {
      return apiError(c, 409, error.message);
    }
    if (error instanceof workflowPendingInteractionDb.PendingInteractionValidationError) {
      return apiError(c, 400, error.message);
    }
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    getLog().error(
      { errorName, runId, callId },
      'api.workflow_permission_confirm_failed'
    );
    return apiError(c, 500, 'Failed to confirm permission');
  }
});
```

Do not call `tryAutoResumeAfterGate`, `dispatchToOrchestrator`, or `resumeWorkflowRun` from this handler.
The persistence transaction may move the run to `running`, but the dormant Permission contract has no provider payload injection to dispatch in Story 6.7.

- [ ] **Step 5: Run GREEN, perform the route REFACTOR check, and rerun.**

Run:

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
```

Expected result: the Permission and existing Ask describes pass, the OpenAPI document contains the new route, and no Permission success path dispatches a message.
For REFACTOR, keep the split handlers explicit unless a helper removes duplication without changing status precedence, messages, or safe logging, then rerun the same command.

- [ ] **Step 6: Commit the HTTP slice.**

```bash
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "feat(server): add permission confirmation route"
```

### Task 5: Regenerate types, prove non-goals, validate, and complete Story 6.7

**Files:**

- Regenerate: `packages/web/src/lib/api.generated.d.ts`
- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:1-81`

**Interfaces:**

- Consumes: the live `/api/openapi.json` document and all focused test contracts from Tasks 1 through 4.
- Produces: current generated web types, a clean Story 6.7 tracker entry, and recorded validation evidence.

- [ ] **Step 1: Run every focused behavior and characterization test.**

```bash
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
(cd packages/core && bun test src/db/workflows.resume-cas.integration.test.ts)
(cd packages/core && bun test src/operations/workflow-operations.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/cli && bun test src/commands/workflow.test.ts)
(cd packages/cli && bun test src/commands/workflow-command-contract.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts -t "ignores answered Permission rows when mapping Ask resume")
(cd packages/workflows && bun test src/executor.test.ts -t "rejects a still-pending Permission")
```

Expected result: every command exits zero.
The two characterization commands prove this story neither injects Permission answers nor bypasses a still-pending Permission row.

- [ ] **Step 2: Prove the change set contains only the approved files and no migrations, providers, engine resume logic, or UI cards.**

```bash
PLAN_BASE_SHA="$(tr -d '\n' < /Users/agent/.archon/workspaces/anhle128/Archon/artifacts/runs/a1c068923453f3040c321b27b9615e95/superpowers/base-sha.txt)"
git diff --name-only "$PLAN_BASE_SHA" -- | sort
FORBIDDEN_PATHS="$(git diff --name-only "$PLAN_BASE_SHA" -- | rg '^(migrations/|bun\.lock$|(^|.*/)package\.json$|packages/providers/|packages/workflows/src/(ask-human|dag-executor|executor)\.ts$|packages/web/src/components/workflows/WorkflowExecution\.tsx$|packages/web/src/experiments/console/)' || true)"
test -z "$FORBIDDEN_PATHS"
```

Expected result: `FORBIDDEN_PATHS` is empty.
The intended changed set is the plan plus the thirteen implementation, test, generated, and tracker files named in this plan.

- [ ] **Step 3: Regenerate the OpenAPI declaration from a supervised worktree server.**

Run this from the repository root.

```bash
PLAN_API_PORT=3090
while lsof -nP -iTCP:"$PLAN_API_PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PLAN_API_PORT=$((PLAN_API_PORT + 1))
done
PLAN_TMP_DIR="$(mktemp -d)"
PLAN_SERVER_LOG="$PLAN_TMP_DIR/server.log"
ARCHON_HOME="$PLAN_TMP_DIR/archon-home" DATABASE_URL= SLACK_BOT_TOKEN= TELEGRAM_BOT_TOKEN= DISCORD_BOT_TOKEN= GITHUB_WEBHOOK_SECRET= NODE_ENV=development WEB_UI_DEV=1 HOST=127.0.0.1 PORT="$PLAN_API_PORT" bun --cwd packages/server src/index.ts >"$PLAN_SERVER_LOG" 2>&1 &
PLAN_SERVER_PID=$!
cleanup_plan_server() {
  kill "$PLAN_SERVER_PID" 2>/dev/null || true
  wait "$PLAN_SERVER_PID" 2>/dev/null || true
}
trap cleanup_plan_server EXIT INT TERM
PLAN_SERVER_READY=0
for PLAN_WAIT_ATTEMPT in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PLAN_API_PORT/api/openapi.json" >/dev/null; then
    PLAN_SERVER_READY=1
    break
  fi
  kill -0 "$PLAN_SERVER_PID" 2>/dev/null || break
  sleep 2
done
if [ "$PLAN_SERVER_READY" -ne 1 ]; then
  tail -80 "$PLAN_SERVER_LOG"
  exit 1
fi
(cd packages/web && bun x openapi-typescript "http://127.0.0.1:$PLAN_API_PORT/api/openapi.json" -o src/lib/api.generated.d.ts)
cleanup_plan_server
trap - EXIT INT TERM
rg -n "PermissionConfirmBody|/api/workflows/runs/\{runId\}/permissions/\{callId\}/confirm" packages/web/src/lib/api.generated.d.ts
```

Expected result: both generated symbols are present, and only the recorded server PID is stopped.
Do not hand-edit the declaration if generation differs from an expected shape; fix the OpenAPI source and regenerate.

- [ ] **Step 4: Run repository validation from the repository root.**

```bash
bun run validate
```

Expected result: the full package-isolated validation exits zero with no lint warnings or generated-file drift.

- [ ] **Step 5: Repair the tracker artifact and mark only Story 6.7 done.**

Delete the entire literal conflict-registry report beginning with `⚠ 2 unresolved conflicts detected` from `sprint-status.yaml`.
Set `development_status.6-7-confirm-a-permission-by-envelope-only` to `done`.
Leave `epic-6` as `in-progress` because Stories 6.4 through 6.6 remain backlog.
Leave every other story key unchanged.
Run `date '+%Y-%m-%d %H:%M:%S %z'` and use that one value for both the top commented `last_updated` line and the active `last_updated` field.

- [ ] **Step 6: Validate the tracker-only edit and inspect the final diff.**

```bash
bun x prettier --check _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git diff --check
if rg -n "unresolved conflicts detected|conflict://|<<< ours|>>> theirs" _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml; then exit 1; fi
git diff --stat
git diff -- _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
```

Expected result: formatting and whitespace checks pass, no conflict-registry text remains, and only the timestamp, Story 6.7 status, and invalid appended report are changed in the tracker.

- [ ] **Step 7: Commit generated types and the completed tracker.**

```bash
git add packages/web/src/lib/api.generated.d.ts _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: complete permission confirmation story"
```

- [ ] **Step 8: Record final evidence without closing issue 92 from this plan.**

```bash
git status --short
git log --oneline --max-count=12
```

Expected result: the worktree is clean and the implementation handoff records every focused test plus `bun run validate`.
Issue 92 remains open until the normal PR and issue-closing workflow consumes that evidence.

## Acceptance Criteria

- [ ] The exact registered endpoint is `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm`.
- [ ] `callId` selects the row by `tool_use_id` under the supplied `runId`.
- [ ] The request accepts only `{ intent: string }`, rejects unknown or Ask-only keys, rejects empty and whitespace-only values, and preserves a valid submitted string without trimming.
- [ ] Only the authenticated `workflow_runs.user_id` can confirm, with missing identity returning `401` before validation and every non-starter returning `403`.
- [ ] A missing run or interaction returns `404`.
- [ ] A second confirmation returns `409` and preserves the first answer.
- [ ] Confirmation before the run reaches `paused` returns `409` without consuming the row.
- [ ] Confirming an Ask row returns `400` with `kind_not_permission` and leaves the Ask pending.
- [ ] Resolving a Permission row through the Ask helper still returns `kind_not_ask`.
- [ ] The row update, last-pending resume CAS, and `interaction_resolved` audit event commit or roll back together.
- [ ] A sibling pending interaction keeps the run paused, while confirmation of the final pending interaction moves it to running once.
- [ ] Persisted event data contains only `node_id`, `tool_use_id`, `kind: 'permission'`, and `resumed`.
- [ ] Structured logs, live events, HTTP errors, and generated API types do not expose `intent`, `answer`, or `envelope` values.
- [ ] The operation logs `workflow.permission_resolved` and emits the existing identifier-only `interaction_resolved` live signal only after persistence resolves.
- [ ] The HTTP route does not auto-dispatch or add a Permission answer to Ask resume injection.
- [ ] No live Permission producer, Permission variant card, UI rendering requirement, provider change, YAML field, CLI/chat confirm command, migration, or dependency change ships.
- [ ] Generated OpenAPI types contain `PermissionConfirmBody` and the new route.
- [ ] Every focused test and `bun run validate` pass.
- [ ] The tracker contains valid YAML without conflict-registry prose, and Story 6.7 changes to `done` only after validation.

## Open Questions

1. The approved HITL contract says `intent: string` but does not define whitespace-only input.
Safe provisional default: reject strings whose trimmed length is zero while preserving every accepted string exactly as submitted.

2. The approved contract does not prescribe the success response status or body.
Safe provisional default: return `200` with the existing `workflowRunActionResponseSchema`, matching the neighboring Ask route.

3. The approved story is dormant envelope/type-contract work and does not define continuation after a Permission confirm.
Safe provisional default: preserve the existing all-pending transaction invariant so the final row moves the run to `running`, but do not dispatch the orchestrator or inject Permission data until a later accepted story adds a live activation and provider resume contract.

## Completion Gate

Story 6.7 is complete only when every acceptance criterion is satisfied, the focused commands pass in their package-isolated processes, the generated API declaration is current, `bun run validate` exits zero, the tracker is valid and updated, and the final worktree is clean.
If any gate fails, leave Story 6.7 as backlog and do not close issue 92.
