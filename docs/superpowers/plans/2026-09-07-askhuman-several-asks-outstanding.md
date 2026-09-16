# AskHuman Several Asks Outstanding Implementation Plan

> **For Grok:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and preserve the Story 6.4 contract for multiple outstanding `AskHuman` interactions across concurrent nodes, repeated asks from one node, and child runs without introducing per-node scheduling or a second pause model.

**Architecture:** Keep the existing run-scoped model in which every `AskHuman` call persists one pending-interaction row and idempotently pauses the workflow run.
The database remains the source of truth for the run-wide pending count, the retry-state projector derives each node's `awaiting` overlay from pending rows owned by that node, and the DAG executor continues already-started siblings while refusing to schedule another layer after any node awaits input.
Child workflow asks stay keyed to the child `workflow_run_id`; the existing sub-run policy propagates that child pause to its parent without copying the pending row.
The implementation is predominantly characterization coverage because the accepted Story 6.1 through Story 6.3 code already contains these mechanics; the only known behavior defect is in the stateful sub-run test double, which currently writes approval metadata for an Ask-only pause.

**Tech Stack:** Bun test runner, TypeScript strict mode, Hono route tests, SQLite through the real `SqliteAdapter`, workflow DAG executor, Claude native-tool injection, and the stateful in-memory sub-run harness.

**Issue:** [GitHub #89](https://github.com/anhle128/Archon/issues/89).

**Canonical Specification:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, especially CAP-5, together with `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, especially Story 6.4.

**Approved Design Inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, and `_bmad-output/project-context.md`.

---

## Scope and Constraints

- [ ] Preserve the single run-status scheduling boundary: already-started nodes in a `Promise.allSettled` layer may finish, but no later layer may start after an Ask pauses the run.
- [ ] Preserve one pending-interaction row per tool call, keyed by `(workflow_run_id, tool_use_id)` and attributed to its owning `node_id`.
- [ ] Preserve the database transaction in `resolvePendingInteraction()` as the sole owner of the answer write, run-wide pending count, `interaction_resolved` event, and transition back to `running` when the count reaches zero.
- [ ] Preserve `answerAskHuman()` as the service entry point and preserve the HTTP route's current rule that automatic continuation is dispatched only when the resolver returns `resumed: true`.
- [ ] Preserve the child run as the owner of a child Ask row, while the existing child-pause policy controls the parent run's paused state and explanatory approval copy.
- [ ] Do not add per-node pause state, a node-local resume scheduler, provider-native resume behavior, a second Ask endpoint, a new run-status enum value, or a new workflow YAML field.
- [ ] Do not change the production database schema, OpenAPI schema, generated web API types, provider wrappers, or workflow public interfaces.
- [ ] Do not infer run chrome from `nodeStates`; the UI contract remains `run.status === 'paused' && pending_interactions.some(row => row.status === 'pending')`.
- [ ] Treat pending rows of every interaction kind as run blockers, even though this story's new end-to-end coverage creates Ask rows.
- [ ] Use `import type` for type-only imports, add no `any`, and keep every new helper and callback explicitly typed.
- [ ] Never run unscoped `bun test` from the repository root; use the focused package commands in this plan and finish with `bun run validate`.

## Verified Repository Baseline

- [ ] Confirm `packages/workflows/src/retry-state.ts` overlays `awaiting` once per row whose status is `pending`, keyed by that row's `node_id`, after replaying workflow events.
- [ ] Confirm `packages/core/src/db/workflow-pending-interactions.ts` permits insertions while a run is `running` or `paused`, counts every pending row for the same `workflow_run_id`, and changes the run back to `running` only when that count is zero.
- [ ] Confirm `packages/workflows/src/dag-executor.ts` recognizes `AskHumanAwaitingError`, returns a pending node result without `node_completed`, evaluates a whole layer with `Promise.allSettled`, and allows an already-started stream to continue while run status is `paused`.
- [ ] Confirm `packages/workflows/src/ask-human.ts` persists with the current `workflowRunId` and `nodeId`, calls `pauseWorkflowRun(workflowRunId)` without approval metadata, emits the awaiting status, and throws `AskHumanAwaitingError` to unwind that node's provider stream.
- [ ] Confirm `packages/server/src/routes/api.ts` lists pending interactions for the requested run, passes the complete list to `projectLatestEffectiveNodeStates()`, and dispatches continuation after an answer only when `result.resumed` is true.
- [ ] Confirm `packages/workflows/src/subrun.test.ts` is the only known mismatch: its `InMemoryStore.pauseWorkflowRun()` unconditionally creates `metadata.approval` even when `approvalContext` is `undefined`.
- [ ] Confirm `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` has Story 6.3 marked `done` and Story 6.4 marked `backlog`, but also has two registered virtual conflicts between the older `2026-09-06 23:44:20 +0700` timestamp and the newer `2026-09-07 01:23:49 +0700` timestamp.
- [ ] Preserve the `theirs` side of both registered conflicts because it is the side from commit `c25ea00c` that records the accepted Story 6.3 completion.

## Files in Scope

### Modify

- `packages/workflows/src/retry-state.test.ts` adds projector characterization for mixed rows on one node and independent overlays on sibling nodes.
- `packages/core/src/db/workflow-pending-interactions.test.ts` adds real-SQLite characterization for run-wide remaining counts, interaction-kind blocking, and parent-versus-child ownership.
- `packages/workflows/src/dag-executor.test.ts` adds deterministic concurrency coverage for two simultaneous Ask nodes, an already-started streaming sibling, and two Ask calls from one provider invocation.
- `packages/workflows/src/dag-executor.ts` updates three stale comments that currently describe paused-stream continuation as approval-only.
- `packages/workflows/src/subrun.test.ts` first repairs the Ask-only pause semantics of the stateful test store under a failing test, then adds the child-run Ask characterization.
- `packages/server/src/routes/api.workflow-runs.test.ts` adds a run-detail characterization proving that all sibling and same-node rows feed node projection and remain embedded in the response.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` resolves the two registered timestamp conflicts and moves Story 6.4 from `backlog` to `done` only after every required validation command passes.

### Read and Rely On Without Editing

- `packages/workflows/src/retry-state.ts` already implements the row-driven per-node `awaiting` overlay.
- `packages/core/src/db/workflow-pending-interactions.ts` already implements run-scoped pending counting and last-answer resume in one transaction.
- `packages/core/src/db/workflows.ts` already makes Ask-only pause a status-only, idempotent write.
- `packages/core/src/operations/workflow-operations.ts` already delegates Ask resolution to the transactional pending-interaction resolver.
- `packages/workflows/src/ask-human.ts` already persists before pausing and unwinds through the branded awaiting error.
- `packages/workflows/src/dag-executor.ts` already performs layer-level scheduling and permits a paused stream to finish.
- `packages/server/src/routes/api.ts` already exposes all rows and uses the resolver's `resumed` result to gate continuation dispatch.
- `packages/server/src/routes/schemas/workflow.schemas.ts` already defines the pending-interaction response shape.

## Existing Regression Coverage That Must Stay Green

- `packages/core/src/db/workflows.test.ts` covers an idempotent second Ask-only pause and preservation of approval metadata for genuine approval pauses.
- `packages/core/src/operations/workflow-operations.test.ts` covers the non-final answer path and proves that service code does not resume while another interaction is pending.
- `packages/server/src/routes/api.workflow-runs.test.ts` already covers a missing request ID as HTTP 404 and prevents automatic dispatch for an intermediate answer.
- `packages/workflows/src/dag-executor.test.ts` already covers a single Ask unwind, no downstream advance after an answer-versus-pause race, persist failure, no-starter failure, and Pi loop Ask behavior.
- `packages/providers/src/claude/native-tools.test.ts` and `packages/providers/src/community/pi/native-tools.test.ts` already cover provider-boundary Ask tool metadata.

## Implementation Order

The tasks proceed from pure projection, through the transactional store, through scheduler concurrency, into recursive child execution, and finally into the HTTP read model.
This order localizes a failure to the narrowest owning layer before a broader integration test depends on it.
Tasks 1, 2, 3, and 5 add characterization tests that are expected to pass against the verified baseline and therefore must not trigger speculative production changes.
Task 4 contains the one required test-harness red-green cycle; its code change is limited to the test-only `InMemoryStore`.
If an expected-green characterization fails, stop, record the observed repository drift, and repair this plan before changing production behavior.

---

## Task 1: Characterize Pending-Row Projection Per Node

**Files:**

- Modify: `packages/workflows/src/retry-state.test.ts`.
- Read only: `packages/workflows/src/retry-state.ts`.

**Why this task comes first:** The GET route and run-view UI consume this projector, so the smallest unit must prove the same-node and sibling-node invariants without relying on stale `node_awaiting` events.

### Step 1: Add a same-node mixed-row characterization

- [ ] Append this test beside the existing pending-row overlay tests.

```ts
test('keeps a node awaiting while one of its two Ask rows remains pending', () => {
  const states = projectLatestEffectiveNodeStates(
    [{ event_type: 'node_started', step_name: 'review', data: {} }],
    [
      { node_id: 'review', status: 'answered' },
      { node_id: 'review', status: 'pending' },
    ]
  );

  expect(states.get('review')?.state).toBe('awaiting');
});
```

This fixture intentionally omits `node_awaiting`; deleting the pending-row overlay must make the assertion fail as `running`.

### Step 2: Add a sibling-ownership characterization

- [ ] Append this test after the same-node test.

```ts
test('overlays awaiting only onto the sibling node that owns a pending Ask row', () => {
  const states = projectLatestEffectiveNodeStates(
    [
      { event_type: 'node_started', step_name: 'alpha', data: {} },
      { event_type: 'node_started', step_name: 'beta', data: {} },
    ],
    [
      { node_id: 'alpha', status: 'answered' },
      { node_id: 'beta', status: 'pending' },
    ]
  );

  expect(states.get('alpha')?.state).toBe('running');
  expect(states.get('beta')?.state).toBe('awaiting');
});
```

This fixture catches an implementation that treats one run-wide pending row as an `awaiting` overlay for every active node.

### Step 3: Run the focused projector test

- [ ] Run the test from the workflows package.

```bash
cd packages/workflows
bun test src/retry-state.test.ts
```

Expected result: PASS, including both new test names.

### Step 4: Commit the characterization

- [ ] Commit only the projector test file.

```bash
git add packages/workflows/src/retry-state.test.ts
git commit -m "test(workflows): cover multiple pending ask projections"
```

---

## Task 2: Characterize Run-Wide Resolution and Run Ownership in Real SQLite

**Files:**

- Modify: `packages/core/src/db/workflow-pending-interactions.test.ts`.
- Read only: `packages/core/src/db/workflow-pending-interactions.ts`.
- Read only: `packages/core/src/db/workflows.ts`.

**Why real SQLite:** The acceptance criteria depend on transaction boundaries, run-scoped counting, status changes, and row lookup predicates, which a mocked store would not prove.

### Step 1: Import the ownership error

- [ ] Add `PendingInteractionNotFoundError` to the existing destructured dynamic import from `./workflow-pending-interactions`.

```ts
const {
  insertPendingInteraction,
  listPendingInteractions,
  resolvePendingInteraction,
  purgePendingInteractionsInTransaction,
  PendingInteractionCorruptRowError,
  PendingInteractionAlreadyResolvedError,
  PendingInteractionNotFoundError,
  PendingInteractionRunNotPausedError,
  PendingInteractionValidationError,
} = await import('./workflow-pending-interactions');
```

### Step 2: Add the independent-node count characterization

- [ ] Add this test inside `describe('resolvePendingInteraction', ...)` after the existing sibling-interaction test.

```ts
test('keeps two Ask nodes blocked until the last run-wide pending row is answered', async () => {
  await insertPendingInteraction({
    ...baseInput,
    node_id: 'alpha',
    tool_use_id: 'toolu_alpha',
    envelope: mixedEnvelope,
  });
  await insertPendingInteraction({
    ...baseInput,
    node_id: 'beta',
    tool_use_id: 'toolu_beta',
    envelope: mixedEnvelope,
  });
  await pauseRun();

  const first = await resolvePendingInteraction(
    resolveInput({ tool_use_id: 'toolu_alpha' })
  );
  expect(first.resumed).toBe(false);
  expect(first.remaining_pending).toBe(1);
  expect(await runStatus()).toBe('paused');

  const halfway = await listPendingInteractions('run-1');
  expect(
    halfway
      .map(row => ({ nodeId: row.node_id, status: row.status }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
  ).toEqual([
    { nodeId: 'alpha', status: 'answered' },
    { nodeId: 'beta', status: 'pending' },
  ]);

  const last = await resolvePendingInteraction(
    resolveInput({ tool_use_id: 'toolu_beta' })
  );
  expect(last.resumed).toBe(true);
  expect(last.remaining_pending).toBe(0);
  expect(await runStatus()).toBe('running');
});
```

This test must fail if the count is scoped to a node instead of the whole workflow run, or if the first answer resumes the run prematurely.

### Step 3: Add the cross-kind blocker characterization

- [ ] Add this test immediately after the independent-node count test.

```ts
test('counts a pending permission interaction when an Ask answer is resolved', async () => {
  await insertPendingInteraction({
    ...baseInput,
    node_id: 'alpha',
    tool_use_id: 'toolu_ask',
    envelope: mixedEnvelope,
  });
  await insertPendingInteraction({
    ...baseInput,
    node_id: 'beta',
    tool_use_id: 'toolu_permission',
    kind: 'permission',
    envelope: { intent: 'write repository files' },
  });
  await pauseRun();

  const result = await resolvePendingInteraction(
    resolveInput({ tool_use_id: 'toolu_ask' })
  );

  expect(result.resumed).toBe(false);
  expect(result.remaining_pending).toBe(1);
  expect(await runStatus()).toBe('paused');
  const listed = await listPendingInteractions('run-1');
  expect(listed.find(row => row.tool_use_id === 'toolu_permission')).toMatchObject({
    tool_use_id: 'toolu_permission',
    kind: 'permission',
    status: 'pending',
  });
});
```

This test pins the accepted rule that the last-pending-row transaction counts all interaction kinds rather than Ask rows only.

### Step 4: Add the parent-versus-child ownership characterization

- [ ] Add this test immediately after the cross-kind test.

```ts
test('resolves a child Ask only through the child workflow run id', async () => {
  await seedRun({
    runId: 'child-run-1',
    userId: 'child-user-1',
    conversationId: 'child-conversation-1',
  });
  await db.query(
    'UPDATE remote_agent_workflow_runs SET parent_run_id = $1 WHERE id = $2',
    ['run-1', 'child-run-1']
  );
  await insertPendingInteraction({
    ...baseInput,
    workflow_run_id: 'child-run-1',
    node_id: 'child-review',
    tool_use_id: 'toolu_child',
    envelope: mixedEnvelope,
  });
  await pauseRun('run-1');
  await pauseRun('child-run-1');

  await expect(
    resolvePendingInteraction(
      resolveInput({
        workflow_run_id: 'run-1',
        tool_use_id: 'toolu_child',
      })
    )
  ).rejects.toBeInstanceOf(PendingInteractionNotFoundError);
  expect((await listPendingInteractions('child-run-1'))[0]?.status).toBe('pending');

  const result = await resolvePendingInteraction(
    resolveInput({
      workflow_run_id: 'child-run-1',
      tool_use_id: 'toolu_child',
      resolved_by: 'child-user-1',
    })
  );

  expect(result.resumed).toBe(true);
  expect(result.remaining_pending).toBe(0);
  expect(await runStatus('child-run-1')).toBe('running');
  expect(await runStatus('run-1')).toBe('paused');
});
```

This test must fail if row lookup uses `tool_use_id` without `workflow_run_id`, if answering the child mutates the parent row, or if the child Ask is copied into the parent run.

### Step 5: Run the focused database test

- [ ] Run this file in its own process because it mocks `./connection` at module scope.

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
```

Expected result: PASS, including all three new characterizations.

### Step 6: Commit the transaction coverage

- [ ] Commit only the database test file.

```bash
git add packages/core/src/db/workflow-pending-interactions.test.ts
git commit -m "test(core): cover run-wide ask resolution"
```

---

## Task 3: Characterize Concurrent DAG Ask Scheduling

**Files:**

- Modify: `packages/workflows/src/dag-executor.test.ts`.
- Modify comments only: `packages/workflows/src/dag-executor.ts`.
- Read only: `packages/workflows/src/ask-human.ts`.

**Why deterministic barriers:** A test that lets every fake provider yield immediately can pass without ever observing a sibling stream or second Ask after the run becomes paused.
The barrier below forces those operations to occur after the first pause while keeping the test independent of timers.

### Step 1: Generalize the Ask test helpers

- [ ] In `describe('executeDagWorkflow -- AskHuman pause', ...)`, replace `wireAskPause()` and `invokeInjectedAskHuman()` with the following helpers, and update existing callers to use the default arguments.

```ts
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (!resolvePromise) throw new Error('Deferred resolver was not initialized');
      resolvePromise();
    },
  };
}

function wireAskPause(store: IWorkflowStore, onPause?: () => void): void {
  let status: WorkflowRun['status'] = 'running';
  store.getWorkflowRunStatus = mock(async () => status);
  store.pauseWorkflowRun = mock(async (_runId, approvalContext) => {
    if (approvalContext !== undefined) {
      throw new Error('AskHuman pause must not supply approval context');
    }
    if (status !== 'running' && status !== 'paused') {
      throw new Error(`Cannot pause AskHuman run from ${status}`);
    }
    status = 'paused';
    onPause?.();
  });
}

async function invokeInjectedAskHuman(
  options: SendQueryOptions | undefined,
  toolUseId = 'toolu_1',
  sessionId = 'sess-1'
): Promise<void> {
  const ask = options?.nativeTools?.find(tool => tool.name === 'AskHuman');
  if (!ask) throw new Error('AskHuman was not injected');
  await ask.handler({ questions: askQuestions }, { toolUseId, sessionId });
}

async function executeAskDag(
  store: IWorkflowStore,
  workflowRun: WorkflowRun,
  nodes: DagNode[]
): Promise<void> {
  await executeDagWorkflow(
    createMockDeps(store),
    createMockPlatform(),
    'conv-dag',
    testDir,
    { name: 'ask-several-outstanding', nodes },
    workflowRun,
    'claude',
    undefined,
    join(testDir, 'artifacts'),
    join(testDir, 'state'),
    join(testDir, 'logs'),
    'main',
    'docs/',
    minimalConfig
  );
}
```

The repository already imports `WorkflowRun`, `DagNode`, `SendQueryOptions`, and `IWorkflowStore` in this file, so do not introduce duplicate imports.

### Step 2: Add the two-node Ask characterization

- [ ] Add this test after the existing single-Ask cases.

```ts
it('persists a second sibling Ask after the first Ask has paused the run', async () => {
  const firstPause = deferred();
  mockSendQueryDag.mockImplementation(async function* (
    prompt: string,
    _cwd: string,
    _resume?: string,
    options?: SendQueryOptions
  ) {
    if (prompt.includes('alpha asks')) {
      await invokeInjectedAskHuman(options, 'toolu_alpha', 'sess-alpha');
      return;
    }
    await firstPause.promise;
    await invokeInjectedAskHuman(options, 'toolu_beta', 'sess-beta');
  });

  const inserted: Array<{ node_id: string; tool_use_id: string }> = [];
  const store = createMockStore();
  store.insertPendingInteraction = mock(async input => {
    inserted.push({ node_id: input.node_id, tool_use_id: input.tool_use_id });
    return {
      id: `pending-${input.tool_use_id}`,
      ...input,
      status: 'pending' as const,
      answer: null,
      created_at: new Date(),
      resolved_at: null,
      resolved_by: null,
    };
  });
  wireAskPause(store, firstPause.resolve);
  const workflowRun = makeWorkflowRun('ask-two-nodes-run');

  await executeAskDag(store, workflowRun, [
    { id: 'alpha', prompt: 'alpha asks' },
    { id: 'beta', prompt: 'beta asks' },
    { id: 'after', depends_on: ['alpha', 'beta'], prompt: 'must not run' },
  ]);

  expect(inserted).toEqual([
    { node_id: 'alpha', tool_use_id: 'toolu_alpha' },
    { node_id: 'beta', tool_use_id: 'toolu_beta' },
  ]);
  expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(2);
  expect((store.pauseWorkflowRun as ReturnType<typeof mock>).mock.calls).toEqual([
    [workflowRun.id],
    [workflowRun.id],
  ]);
  const nodeEvents = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
    call => call[0] as { event_type: string; step_name?: string }
  );
  expect(nodeEvents.filter(event => event.event_type === 'node_completed')).toEqual([]);
  expect(mockSendQueryDag).toHaveBeenCalledTimes(2);
});
```

The explicit re-pause assertion proves the second native-tool handler completes its persist-and-pause teardown while the run is already paused.
The two provider calls and absence of `node_completed` prove the later `after` layer never starts and neither asking node is reported complete.

### Step 3: Add the paused-stream sibling characterization

- [ ] Add this test immediately after the two-node Ask test.

```ts
it('lets an already-started sibling finish streaming after another node pauses the run', async () => {
  const firstPause = deferred();
  mockSendQueryDag.mockImplementation(async function* (
    prompt: string,
    _cwd: string,
    _resume?: string,
    options?: SendQueryOptions
  ) {
    if (prompt.includes('alpha asks')) {
      await invokeInjectedAskHuman(options, 'toolu_alpha', 'sess-alpha');
      return;
    }
    await firstPause.promise;
    yield { type: 'assistant', content: 'beta finished after pause' };
    yield { type: 'result', sessionId: 'sess-beta' };
  });

  const store = createMockStore();
  wireAskPause(store, firstPause.resolve);
  const workflowRun = makeWorkflowRun('ask-streaming-sibling-run');

  await executeAskDag(store, workflowRun, [
    { id: 'alpha', prompt: 'alpha asks' },
    { id: 'beta', prompt: 'beta streams' },
    { id: 'after', depends_on: ['alpha', 'beta'], prompt: 'must not run' },
  ]);

  const betaRows = await store.listNodeMessages(workflowRun.id, 'beta');
  expect(betaRows.some(row => row.kind === 'text' && row.payload.text === 'beta finished after pause')).toBe(
    true
  );
  expect(
    betaRows.some(row => row.kind === 'status' && row.payload.state === 'completed')
  ).toBe(true);
  expect(storedEventTypes(store).filter(type => type === 'node_completed')).toEqual([
    'node_completed',
  ]);
  expect(mockSendQueryDag).toHaveBeenCalledTimes(2);
});
```

Removing `paused` from `shouldContinueStreamingForStatus()` must prevent beta's text or completion from being recorded and fail this test.

### Step 4: Add the same-node two-Ask characterization

- [ ] Add this test immediately after the paused-stream sibling test.

```ts
it('persists two Ask calls from one node before unwinding it as awaiting', async () => {
  mockSendQueryDag.mockImplementation(async function* (
    _prompt: string,
    _cwd: string,
    _resume?: string,
    options?: SendQueryOptions
  ) {
    const attempts = await Promise.allSettled([
      invokeInjectedAskHuman(options, 'toolu_one', 'sess-one'),
      invokeInjectedAskHuman(options, 'toolu_two', 'sess-two'),
    ]);
    const rejected = attempts.find(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected'
    );
    if (!rejected) throw new Error('Expected AskHuman to unwind the provider invocation');
    if (rejected.reason instanceof Error) throw rejected.reason;
    throw new Error(String(rejected.reason));
  });

  const insertedToolUseIds: string[] = [];
  const store = createMockStore();
  store.insertPendingInteraction = mock(async input => {
    insertedToolUseIds.push(input.tool_use_id);
    return {
      id: `pending-${input.tool_use_id}`,
      ...input,
      status: 'pending' as const,
      answer: null,
      created_at: new Date(),
      resolved_at: null,
      resolved_by: null,
    };
  });
  wireAskPause(store);
  const workflowRun = makeWorkflowRun('ask-two-same-node-run');

  await executeAskDag(store, workflowRun, [{ id: 'review', prompt: 'ask twice' }]);

  expect(insertedToolUseIds.sort()).toEqual(['toolu_one', 'toolu_two']);
  expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(2);
  const rows = await store.listNodeMessages(workflowRun.id, 'review');
  expect(rows.some(row => row.kind === 'status' && row.payload.state === 'awaiting')).toBe(true);
  expect(rows.some(row => row.kind === 'status' && row.payload.state === 'completed')).toBe(
    false
  );
  expect(rows.some(row => row.kind === 'status' && row.payload.state === 'failed')).toBe(false);
});
```

Do not swallow both branded rejections in the fake provider; rethrowing one after both handlers settle models SDK teardown while still allowing both inserts to finish.

### Step 5: Run the focused executor test

- [ ] Run the DAG executor file from the workflows package.

```bash
cd packages/workflows
bun test src/dag-executor.test.ts
```

Expected result: PASS, including all three new characterizations.

### Step 6: Correct the stale production comments

- [ ] In `packages/workflows/src/dag-executor.ts`, change the `shouldContinueStreamingForStatus()` comment from “a concurrent approval node” to “a concurrent approval or AskHuman node”.
- [ ] In the `executeNodeInternal()` event-loop comment, change “an approval node can transition the run” to “an approval or AskHuman node can transition the run”.
- [ ] In the loop-node event-loop comment, change “a sibling approval node may pause” to “a sibling approval or AskHuman node may pause”.
- [ ] Do not change any function body because the characterized scheduler behavior is already implemented.

### Step 7: Re-run and commit

- [ ] Re-run the focused executor test after the comment-only source edit.

```bash
cd packages/workflows
bun test src/dag-executor.test.ts
```

- [ ] Commit the executor coverage and comment correction.

```bash
git add packages/workflows/src/dag-executor.test.ts packages/workflows/src/dag-executor.ts
git commit -m "test(workflows): cover concurrent ask scheduling"
```

---

## Task 4: Repair the Stateful Sub-Run Harness and Characterize Child Ask Ownership

**Files:**

- Modify: `packages/workflows/src/subrun.test.ts`.

**Why this task has a red-green cycle:** The current test-only `InMemoryStore.pauseWorkflowRun()` writes `metadata.approval` for every pause, while the real store intentionally leaves metadata unchanged for Ask-only pauses.
The child-run characterization would otherwise pass with an impossible production state.

### Step 1: Write the failing test for test-store parity

- [ ] Add this test near the `InMemoryStore` harness tests, before the sub-run end-to-end cases.

```ts
it('keeps approval metadata absent for an Ask-only pause in the stateful test store', async () => {
  const store = new InMemoryStore();
  const run = await store.createWorkflowRun({
    workflow_name: 'ask-only',
    conversation_id: 'conversation-1',
    user_message: 'go',
    user_id: 'starter-1',
  });

  await store.pauseWorkflowRun(run.id);

  expect((await store.getWorkflowRun(run.id))?.status).toBe('paused');
  expect((await store.getWorkflowRun(run.id))?.metadata.approval).toBeUndefined();
});
```

### Step 2: Verify the expected failure

- [ ] Run the sub-run test file in its own workflows-package process.

```bash
cd packages/workflows
bun test src/subrun.test.ts
```

Expected result: FAIL only at the new assertion because the current test double creates an `approval` object whose fields are undefined.

### Step 3: Make the minimal test-harness repair

- [ ] Replace only `InMemoryStore.pauseWorkflowRun()` with this implementation.

```ts
pauseWorkflowRun: IWorkflowStore['pauseWorkflowRun'] = (id, approvalContext, extraMetadata) => {
  const r = this.runs.get(id);
  if (r) {
    r.status = 'paused';
    if (approvalContext !== undefined) {
      r.metadata = {
        ...r.metadata,
        approval: { ...approvalContext, resolved: null },
        ...(extraMetadata ?? {}),
      };
    }
  }
  return Promise.resolve();
};
```

This is test infrastructure, not a production lifecycle change.
It deliberately preserves the existing approval path while making Ask-only pause status-only, matching `packages/core/src/db/workflows.ts`.

### Step 4: Verify green before adding the child scenario

- [ ] Re-run the sub-run test file.

```bash
cd packages/workflows
bun test src/subrun.test.ts
```

Expected result: PASS.

### Step 5: Add an exact provider type import

- [ ] Add this import with the other type-only imports at the top of `packages/workflows/src/subrun.test.ts`.

```ts
import type { SendQueryOptions } from '@archon/providers/types';
```

Do not use `Function`, `any`, or a hand-written copy of the provider callback type.

### Step 6: Add the child-run Ask end-to-end characterization

- [ ] Add this test inside `describe('workflow: sub-run e2e (#2121 Phase 2)', ...)`.

```ts
it('stores an Ask on the child run and pauses its parent without copying the row', async () => {
  await writeWorkflow(
    'child-asks',
    `
name: child-asks
description: child that asks the starter
nodes:
  - id: child-review
    prompt: "ask starter"
`
  );
  await writeWorkflow(
    'parent-of-ask',
    `
name: parent-of-ask
description: parent that invokes the asking child
nodes:
  - id: child
    workflow: child-asks
`
  );

  const store = new InMemoryStore();
  const provider = {
    ...makeProvider(),
    sendQuery: mock(async function* (
      prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      if (prompt.includes('ask starter')) {
        const ask = options?.nativeTools?.find(tool => tool.name === 'AskHuman');
        if (!ask) throw new Error('AskHuman was not injected into the child node');
        await ask.handler(
          {
            questions: [
              {
                id: 'ship',
                prompt: 'Ship it?',
                selection: 'single' as const,
                options: ['yes', 'no'],
                allowOther: false,
              },
            ],
          },
          { toolUseId: 'toolu_child', sessionId: 'sess-child' }
        );
        return;
      }
      yield { type: 'assistant', content: 'ai-output' };
      yield { type: 'result', sessionId: 'sess-parent' };
    }),
  };
  const deps: WorkflowDeps = {
    ...makeDeps(store),
    getAgentProvider: mock(() => provider) as unknown as WorkflowDeps['getAgentProvider'],
  };
  const parent = await discover('parent-of-ask');

  const result = await executeWorkflow(
    deps,
    makePlatform(),
    'conv-plat',
    cwd,
    parent,
    'go',
    'conv-db',
    { userId: 'starter-1' }
  );

  expect(result.success && 'paused' in result && result.paused).toBe(true);
  const parentRun = [...store.runs.values()].find(
    run => run.workflow_name === 'parent-of-ask'
  );
  const childRun = [...store.runs.values()].find(run => run.workflow_name === 'child-asks');
  if (!parentRun || !childRun) throw new Error('Expected parent and child workflow runs');

  expect(childRun.parent_run_id).toBe(parentRun.id);
  expect(childRun.user_id).toBe('starter-1');
  expect(childRun.status).toBe('paused');
  expect(childRun.metadata.approval).toBeUndefined();
  expect(parentRun.status).toBe('paused');
  expect(parentRun.metadata.approval).toMatchObject({
    type: 'child_workflow',
    nodeId: 'child',
    childRunId: childRun.id,
  });

  expect(await store.listPendingInteractions(childRun.id)).toEqual([
    expect.objectContaining({
      workflow_run_id: childRun.id,
      node_id: 'child-review',
      tool_use_id: 'toolu_child',
      kind: 'ask',
      status: 'pending',
      provider_session_id: 'sess-child',
    }),
  ]);
  expect(await store.listPendingInteractions(parentRun.id)).toEqual([]);
  expect(
    store.events.some(
      event =>
        event.workflow_run_id === childRun.id &&
        event.step_name === 'child-review' &&
        event.event_type === 'node_completed'
    )
  ).toBe(false);
});
```

The explicit `userId` keeps the harness aligned with the real store's no-starter policy.
The guarded run lookup avoids non-null assertions, and the pending-row assertions prove ownership rather than merely proving that a child run exists.

### Step 7: Run the child characterization

- [ ] Run the sub-run file again.

```bash
cd packages/workflows
bun test src/subrun.test.ts
```

Expected result: PASS, including the parity test and the child-run Ask test.

### Step 8: Commit the test-harness repair and child coverage

- [ ] Commit only the sub-run test file.

```bash
git add packages/workflows/src/subrun.test.ts
git commit -m "test(workflows): cover child run ask ownership"
```

---

## Task 5: Characterize the Run-Detail Read Model for Several Outstanding Asks

**Files:**

- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`.
- Read only: `packages/server/src/routes/api.ts`.
- Read only: `packages/server/src/routes/schemas/workflow.schemas.ts`.

**Why one route test is enough:** The projector unit tests own the state algorithm and the SQLite tests own resume transitions.
This route test only needs to prove that the server supplies all rows to the projector and returns those rows unchanged apart from timestamp serialization.

### Step 1: Add the run-detail characterization

- [ ] Add this test inside the existing GET run-detail describe block after the current single-pending-row projection test.

```ts
test('embeds sibling and same-node Ask rows while projecting every pending owner as awaiting', async () => {
  mockGetWorkflowRun.mockImplementationOnce(async () => ({
    ...MOCK_RUNNING_RUN,
    status: 'paused',
  }));
  mockListWorkflowEvents.mockImplementationOnce(async () => [
    {
      id: 'evt-review-start',
      workflow_run_id: 'run-uuid-1',
      event_type: 'node_started',
      step_index: null,
      step_name: 'review',
      data: { node_id: 'review', provider: 'claude' },
      created_at: NOW,
    },
    {
      id: 'evt-beta-start',
      workflow_run_id: 'run-uuid-1',
      event_type: 'node_started',
      step_index: null,
      step_name: 'beta',
      data: { node_id: 'beta', provider: 'claude' },
      created_at: NOW,
    },
  ]);
  mockGetConversationById.mockImplementationOnce(async () => ({
    id: 'conv-uuid-1',
    platform_conversation_id: 'web-conv-abc',
  }));
  mockListPendingInteractions.mockImplementationOnce(async () => [
    {
      id: 'pend-review-answered',
      workflow_run_id: 'run-uuid-1',
      node_id: 'review',
      tool_use_id: 'toolu_review_answered',
      kind: 'ask',
      status: 'answered',
      envelope: { questions: [{ prompt: 'First review question' }] },
      answer: { answers: [{ questionId: 'first', value: 'yes' }] },
      provider_session_id: 'sess-review',
      created_at: '2026-09-06T00:00:00.000Z',
      resolved_at: '2026-09-06T00:01:00.000Z',
      resolved_by: 'user-1',
    },
    {
      id: 'pend-review-open',
      workflow_run_id: 'run-uuid-1',
      node_id: 'review',
      tool_use_id: 'toolu_review_open',
      kind: 'ask',
      status: 'pending',
      envelope: { questions: [{ prompt: 'Second review question' }] },
      answer: null,
      provider_session_id: 'sess-review',
      created_at: '2026-09-06T00:00:01.000Z',
      resolved_at: null,
      resolved_by: null,
    },
    {
      id: 'pend-beta-open',
      workflow_run_id: 'run-uuid-1',
      node_id: 'beta',
      tool_use_id: 'toolu_beta_open',
      kind: 'ask',
      status: 'pending',
      envelope: { questions: [{ prompt: 'Beta question' }] },
      answer: null,
      provider_session_id: 'sess-beta',
      created_at: '2026-09-06T00:00:02.000Z',
      resolved_at: null,
      resolved_by: null,
    },
  ]);

  const { app } = makeApp();
  const response = await app.request('/api/workflows/runs/run-uuid-1');

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    run: { status: string };
    pending_interactions: Array<{ node_id: string; tool_use_id: string; status: string }>;
    nodeStates: Array<{ nodeId: string; status: string }>;
  };
  expect(mockListPendingInteractions).toHaveBeenCalledWith('run-uuid-1');
  expect(body.run.status).toBe('paused');
  expect(
    body.pending_interactions.map(row => [row.node_id, row.tool_use_id, row.status])
  ).toEqual([
    ['review', 'toolu_review_answered', 'answered'],
    ['review', 'toolu_review_open', 'pending'],
    ['beta', 'toolu_beta_open', 'pending'],
  ]);
  expect(body.nodeStates).toEqual([
    { nodeId: 'review', name: 'review', status: 'awaiting', retryEpoch: 0, provider: 'claude' },
    { nodeId: 'beta', name: 'beta', status: 'awaiting', retryEpoch: 0, provider: 'claude' },
  ]);
});
```

Do not compute a second `isAwaitingInput` boolean inside the test because reproducing the UI formula in test code would be tautological and would not exercise server behavior.
The returned `run.status` and row statuses are the exact server inputs from which the existing web client derives run chrome.

### Step 2: Run the focused route test

- [ ] Run this route file from the server package.

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

Expected result: PASS, including the new row-embedding and node-projection assertions.

### Step 3: Commit the route characterization

- [ ] Commit only the route test file.

```bash
git add packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "test(server): cover several outstanding asks"
```

---

## Task 6: Validate the Story and Update Tracking

**Files:**

- Verify: every file modified in Tasks 1 through 5.
- Modify after all gates pass: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.

### Step 1: Run the focused regression matrix

- [ ] Run each command as a separate process from the named package directory.

```bash
(cd packages/workflows && bun test src/retry-state.test.ts)
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
(cd packages/core && bun test src/db/workflows.test.ts)
(cd packages/core && bun test src/operations/workflow-operations.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/workflows && bun test src/subrun.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
```

Expected result: every process exits zero.

### Step 2: Run repository-wide validation

- [ ] Check patch whitespace before the full gate.

```bash
git diff --check
```

- [ ] Run the repository's complete pre-PR validation command from the repository root.

```bash
bun run validate
```

Expected result: type checking, lint with zero warnings, formatting, package-isolated tests, dependency checks, generated-file checks, and the remaining validation stages all pass.

### Step 3: Resolve the registered tracking conflicts only after validation passes

- [ ] Read `conflict://1/theirs` and `conflict://2/theirs` through the workspace conflict interface and verify that both contain the `2026-09-07 01:23:49 +0700` timestamp from commit `c25ea00c`.
- [ ] Resolve both registered blocks in one conflict-aware workspace write with the exact operation below; do not copy the rendered conflict diagnostic into the YAML file.

```text
write({ path: "conflict://*", content: "1: @theirs\n2: @theirs" })
```

- [ ] Re-read `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` and verify that Story 6.3 remains `done`, Story 6.4 remains `backlog`, both timestamp locations contain `2026-09-07 01:23:49 +0700`, and no unresolved-conflict diagnostic remains.

### Step 4: Update Story 6.4 only after resolving the tracking file

- [ ] Capture one real local timestamp and use that exact value for both the leading `# last_updated:` comment and the `last_updated:` YAML field.

```bash
date '+%Y-%m-%d %H:%M:%S %z'
```

- [ ] In `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`, change `6-4-keep-several-asks-outstanding-without-a-second-scheduler: backlog` to `6-4-keep-several-asks-outstanding-without-a-second-scheduler: done`.
- [ ] Do not change the Epic 6 status or any other story status.
- [ ] Verify the edited YAML contains no conflict markers and is formatted.

```bash
rg -n '^(<<<<<<<|=======|>>>>>>>)|^⚠ |^NOTICE:|^──── |^<<< |^>>> ' _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
bun x prettier --check _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git diff --check
```

Expected result: `rg` exits 1 with no matches, while Prettier and `git diff --check` exit zero.

### Step 5: Commit the tracking update

- [ ] Commit the validated story status.

```bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore(planning): mark AskHuman several asks done"
```

### Step 6: Prepare the pull-request handoff

- [ ] Copy `.github/pull_request_template.md` into the PR body, retain the required Problem and outcome, Review guidance, Solution, and Validation sections, and remove unused conditional sections and instructional comments.
- [ ] Include `Closes #89` in the PR description.
- [ ] Report the focused regression matrix and `bun run validate` as the validation evidence.

---

## Acceptance Criteria

- [ ] Two independent agent nodes can each persist an Ask row, and the second node can complete its Ask persist-and-pause teardown after the first node has already paused the run.
- [ ] An already-started sibling may finish streaming and record `node_completed` while the run is paused by another node's Ask.
- [ ] A later DAG layer does not start after any node in the current layer awaits an Ask response.
- [ ] An asking node records `awaiting` and does not record `node_completed` or `node_failed` solely because `AskHumanAwaitingError` unwinds its provider stream.
- [ ] Two Ask calls from one node produce two distinct pending rows and unwind the node only after both fake-provider calls have settled.
- [ ] Answering one of several run-scoped pending rows returns `resumed: false`, leaves the run `paused`, and reports the exact remaining count.
- [ ] Answering the last pending row returns `resumed: true`, changes the run to `running` in the same database transaction, and reports zero remaining rows.
- [ ] A pending non-Ask interaction also prevents resume, proving that the resolver counts all pending kinds.
- [ ] Node projection remains `awaiting` while any pending row owned by that node exists, including when an older row on the same node is already answered.
- [ ] One node's pending row does not incorrectly overlay `awaiting` onto a sibling that owns only answered rows.
- [ ] A child node's Ask row is stored only under the child `workflow_run_id`, carries the child `node_id`, and cannot be answered through the parent run ID.
- [ ] A child Ask pauses the child without approval metadata, causes the existing child-workflow policy to pause the parent with its explanatory approval copy, and emits no child `node_completed` event for the asking node.
- [ ] GET `/api/workflows/runs/:runId` returns all answered and pending rows for that exact run and projects every node that still owns a pending row as `awaiting`.
- [ ] The run chrome contract remains derivable from the existing response as `run.status === 'paused' && pending_interactions.some(row => row.status === 'pending')` without adding an API boolean.
- [ ] No schema, generated type, YAML language, provider contract, scheduling model, or public interface changes are introduced.
- [ ] Every focused test command, `git diff --check`, and `bun run validate` passes before Story 6.4 is marked `done`.

## Definition of Done

- [ ] All code blocks in this plan have been applied without replacing exact types or assertions with placeholders.
- [ ] Every characterization test has a named mutation or regression that would make it fail.
- [ ] The single red-green cycle fails for the expected test-double reason before the minimal harness repair and passes afterward.
- [ ] No production behavior is changed beyond correcting stale comments because the accepted mechanics are already present in the verified repository baseline.
- [ ] Sprint status contains one consistent real timestamp and marks only Story 6.4 `done`.
- [ ] The implementation is ready for review with `Closes #89` and complete validation evidence.
