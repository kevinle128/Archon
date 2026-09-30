import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { IWorkflowStore } from '@archon/workflows/store';

// Mock DB modules before importing store-adapter
const mockCreateWorkflowRun = mock(() => Promise.resolve({ id: 'run-1' }));
const mockGetWorkflowRun = mock(() => Promise.resolve(null));
const mockGetActiveWorkflowRunByPath = mock(() => Promise.resolve(null));
const mockFailOrphanedRuns = mock(() => Promise.resolve({ count: 0 }));
const mockFindResumableRun = mock(() => Promise.resolve(null));
const mockResumeWorkflowRun = mock(() => Promise.resolve({ id: 'run-1' }));
const mockResumeApprovedGate = mock(() => Promise.resolve({ resumed: true }));
const mockUpdateWorkflowRun = mock(() => Promise.resolve());
const mockSetWorkflowRunEnvOverlay = mock(() => Promise.resolve({ id: 'run-1' }));
const mockUpdateWorkflowActivity = mock(() => Promise.resolve());
const mockGetWorkflowRunStatus = mock(() => Promise.resolve('running'));
const mockCompleteWorkflowRun = mock(() => Promise.resolve());
const mockFailWorkflowRun = mock(() => Promise.resolve());
const mockCancelWorkflowRun = mock(() => Promise.resolve());
const mockPauseWorkflowRun = mock(() => Promise.resolve());
const mockResolveApprovalGate = mock(() => Promise.resolve({ resolved: true }));
const mockTransitionPlannotatorGate = mock(() =>
  Promise.resolve({ outcome: 'superseded' as const })
);
const mockPersistRouteDecisionTransition = mock(() => Promise.resolve({ id: 'run-1' }));

mock.module('../db/workflows', () => ({
  createWorkflowRun: mockCreateWorkflowRun,
  getWorkflowRun: mockGetWorkflowRun,
  getActiveWorkflowRunByPath: mockGetActiveWorkflowRunByPath,
  failOrphanedRuns: mockFailOrphanedRuns,
  findResumableRun: mockFindResumableRun,
  resumeWorkflowRun: mockResumeWorkflowRun,
  resumeApprovedGate: mockResumeApprovedGate,
  updateWorkflowRun: mockUpdateWorkflowRun,
  setWorkflowRunEnvOverlay: mockSetWorkflowRunEnvOverlay,
  updateWorkflowActivity: mockUpdateWorkflowActivity,
  getWorkflowRunStatus: mockGetWorkflowRunStatus,
  completeWorkflowRun: mockCompleteWorkflowRun,
  failWorkflowRun: mockFailWorkflowRun,
  cancelWorkflowRun: mockCancelWorkflowRun,
  pauseWorkflowRun: mockPauseWorkflowRun,
  resolveApprovalGate: mockResolveApprovalGate,
  transitionPlannotatorGate: mockTransitionPlannotatorGate,
  persistRouteDecisionTransition: mockPersistRouteDecisionTransition,
  claimWriteback: mock(() => Promise.resolve({ claimed: true })),
  releaseWritebackClaim: mock(() => Promise.resolve()),
}));

const mockCreateWorkflowEvent = mock(() => Promise.resolve());
const mockGetDagResumeSnapshot = mock(() =>
  Promise.resolve({
    completedNodeOutputs: new Map<string, string>(),
    tokens: { input: 0, output: 0 },
  })
);
mock.module('../db/workflow-events', () => ({
  createWorkflowEvent: mockCreateWorkflowEvent,
  getDagResumeSnapshot: mockGetDagResumeSnapshot,
}));

const mockEnqueueExternalWorkflowEvent = mock(() => Promise.resolve());
mock.module('../db/workflow-event-outbox', () => ({
  enqueueExternalWorkflowEvent: mockEnqueueExternalWorkflowEvent,
}));
const mockResolveEventRoute = mock(() =>
  Promise.resolve({
    routable: false,
    codebase: null,
    binding: null,
    reason: 'missing-codebase',
  })
);
mock.module('../events/binding-router', () => ({
  resolveEventRoute: mockResolveEventRoute,
}));

const mockUpsertWorkflowNodeCheckpoint = mock(() => Promise.resolve({ workflow_run_id: 'run-1' }));
const mockGetLatestWorkflowNodeCheckpoint = mock(() => Promise.resolve(null));
mock.module('../db/workflow-checkpoints', () => ({
  upsertWorkflowNodeCheckpoint: mockUpsertWorkflowNodeCheckpoint,
  getLatestWorkflowNodeCheckpoint: mockGetLatestWorkflowNodeCheckpoint,
}));

const mockGetCodebase = mock(() => Promise.resolve(null));
mock.module('../db/codebases', () => ({
  getCodebase: mockGetCodebase,
}));

mock.module('@archon/providers', () => ({
  getAgentProvider: mock(() => ({})),
  getRegisteredProviders: mock(() => []),
  // Vendor → env-var map consumed by credentials/delivery (#1955). A realistic
  // subset of the generated map (incl. HF_TOKEN, the upstream var).
  PI_PROVIDER_ENV_VARS: {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    'github-copilot': 'COPILOT_GITHUB_TOKEN',
    openrouter: 'OPENROUTER_API_KEY',
    google: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    huggingface: 'HF_TOKEN',
    'google-vertex': 'GOOGLE_CLOUD_API_KEY',
  },
  PI_AMBIENT_VENDORS: ['amazon-bedrock', 'google-vertex'],
}));

mock.module('../config/config-loader', () => ({
  loadConfig: mock(() => Promise.resolve({ assistant: 'claude' })),
  // Required even though nothing here calls it: this factory replaces the module
  // for the whole process, and child-isolation-resolver.ts (same `bun test
  // src/workflows/` batch) does `import { loadRepoConfig }`. Omit it and that
  // import fails at module-eval with "Export named 'loadRepoConfig' not found".
  loadRepoConfig: mock(() => Promise.resolve(null)),
}));

// usage-recorder pulls estimate → loadGlobalConfig; keep this suite focused on
// the store adapter by stubbing the recorder factory.
mock.module('./usage-recorder', () => ({
  createWorkflowUsageRecorder: mock(() => ({
    recordWorkflowUsage: mock(() => Promise.resolve()),
  })),
}));

// Per-user provider credentials mocks
const mockIsPerUserProviderKeysEnabled = mock(() => false);
mock.module('../credentials/config', () => ({
  isPerUserProviderKeysEnabled: mockIsPerUserProviderKeysEnabled,
}));

const mockListDecryptedUserProviderCredentials = mock(async () => []);
mock.module('../db/user-provider-key-store', () => ({
  listDecryptedUserProviderCredentials: mockListDecryptedUserProviderCredentials,
  saveUserProviderKey: mock(() => Promise.resolve()),
  getUserProviderKeyRecord: mock(() => Promise.resolve(null)),
  listUserProviderKeys: mock(() => Promise.resolve([])),
  deleteUserProviderKey: mock(() => Promise.resolve()),
  getDecryptedProviderCredential: mock(() => Promise.resolve(null)),
}));

// github-auth mocks (required by store-adapter imports)
mock.module('../github-auth/config', () => ({
  isPerUserGitHubEnabled: mock(() => false),
}));
mock.module('../db/user-github-token-store', () => ({
  getDecryptedAccessToken: mock(() => Promise.resolve(undefined)),
}));
mock.module('../db/env-vars', () => ({
  getCodebaseEnvVars: mock(() => Promise.resolve({})),
}));
mock.module('../db/workflow-node-sessions', () => ({
  getWorkflowNodeSession: mock(() => Promise.resolve(null)),
  setWorkflowNodeSession: mock(() => Promise.resolve()),
  deleteWorkflowNodeSessions: mock(() => Promise.resolve()),
}));
const mockAppendNodeMessage = mock(() => Promise.resolve({ id: 'msg-1' }));
const mockListNodeMessages = mock(() => Promise.resolve([]));
mock.module('../db/workflow-node-messages', () => ({
  appendNodeMessage: mockAppendNodeMessage,
  listNodeMessages: mockListNodeMessages,
  getNodeMessage: mock(() => Promise.resolve(null)),
  getNodeMessageHighWatermark: mock(() => Promise.resolve(0)),
}));
const mockInsertPendingInteraction = mock(() => Promise.resolve({ id: 'pend-1' }));
const mockListPendingInteractions = mock(() => Promise.resolve([]));
const mockResolvePendingInteraction = mock(() =>
  Promise.resolve({
    interaction: { id: 'pend-1' },
    resumed: false,
    remaining_pending: 0,
  })
);
mock.module('../db/workflow-pending-interactions', () => ({
  insertPendingInteraction: mockInsertPendingInteraction,
  listPendingInteractions: mockListPendingInteractions,
  resolvePendingInteraction: mockResolvePendingInteraction,
}));

class TestTransformError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const mockTransformWorkflowEventBody = mock(
  async (envelope: Record<string, unknown>, transform: unknown) => ({
    body: JSON.stringify(envelope),
    outputBytes: new TextEncoder().encode(JSON.stringify(envelope)).length,
    engine: transform ? ('jsonata' as const) : ('identity' as const),
    durationMs: 1,
  })
);
// Spread the real module so provider-bindings (pulled in via binding-router)
// still sees normalize/validate exports; only enqueue-path transform is mocked.
const transformActual = await import('../events/provider-binding-transform');
const isActualProviderBindingTransformError = transformActual.isProviderBindingTransformError;
mock.module('../events/provider-binding-transform', () => ({
  ...transformActual,
  transformWorkflowEventBody: mockTransformWorkflowEventBody,
  isProviderBindingTransformError: (error: unknown): boolean =>
    error instanceof TestTransformError || isActualProviderBindingTransformError(error),
}));

const mockLogDebug = mock(() => {});
const mockLogWarn = mock(() => {});
const mockLogError = mock(() => {});
// Spread the real module: a createLogger-only stub omits BUNDLED_IS_BINARY and
// breaks transitive imports (db/bundled-schema) during store-adapter load.
const pathsActual = await import('@archon/paths');
mock.module('@archon/paths', () => ({
  ...pathsActual,
  createLogger: mock(() => ({
    info: mock(() => {}),
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
    trace: mock(() => {}),
    fatal: mock(() => {}),
  })),
}));

const { createWorkflowStore, createWorkflowDeps } = await import('./store-adapter');

const originalArchonPublicUrl = process.env.ARCHON_PUBLIC_URL;

function workflowRunRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'run-1',
    workflow_name: 'bmad-dev-story',
    codebase_id: 'cb-1',
    user_message: 'Build the approved bridge.',
    ...overrides,
  };
}

function codebaseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cb-1',
    name: 'workflow-engine',
    default_cwd: '/workspace/workflow-engine',
    default_branch: 'dev',
    ...overrides,
  };
}

function bindingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'binding-1',
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebase_id: 'cb-1',
    event_route: 'https://hermes.example/events',
    event_types: [],
    signing_secret: 'test-secret',
    state: 'active',
    transform: null,
    delivery_headers: {},
    ...overrides,
  };
}

describe('createWorkflowStore', () => {
  beforeEach(() => {
    process.env.ARCHON_PUBLIC_URL = 'https://archon.example.ts.net';
    mockCreateWorkflowEvent.mockReset();
    mockCreateWorkflowEvent.mockImplementation(() => Promise.resolve());
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun.mockImplementation(() => Promise.resolve(null));
    mockResolveApprovalGate.mockClear();
    mockTransitionPlannotatorGate.mockClear();
    mockEnqueueExternalWorkflowEvent.mockReset();
    mockEnqueueExternalWorkflowEvent.mockImplementation(() => Promise.resolve());
    mockResolveEventRoute.mockReset();
    mockResolveEventRoute.mockImplementation(() =>
      Promise.resolve({
        routable: false,
        codebase: null,
        binding: null,
        reason: 'missing-codebase',
      })
    );
    mockTransformWorkflowEventBody.mockReset();
    mockTransformWorkflowEventBody.mockImplementation(
      async (envelope: Record<string, unknown>, transform: unknown) => ({
        body: JSON.stringify(envelope),
        outputBytes: new TextEncoder().encode(JSON.stringify(envelope)).length,
        engine: transform ? ('jsonata' as const) : ('identity' as const),
        durationMs: 1,
      })
    );
    mockLogDebug.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  afterEach(() => {
    if (originalArchonPublicUrl === undefined) {
      delete process.env.ARCHON_PUBLIC_URL;
    } else {
      process.env.ARCHON_PUBLIC_URL = originalArchonPublicUrl;
    }
  });

  test('returns object with all IWorkflowStore methods', () => {
    const store = createWorkflowStore();
    const requiredMethods: (keyof IWorkflowStore)[] = [
      'createWorkflowRun',
      'getWorkflowRun',
      'getActiveWorkflowRunByPath',
      'failOrphanedRuns',
      'findResumableRun',
      'resumeWorkflowRun',
      'resumeApprovedGate',
      'updateWorkflowRun',
      'setWorkflowRunEnvOverlay',
      'updateWorkflowActivity',
      'getWorkflowRunStatus',
      'completeWorkflowRun',
      'failWorkflowRun',
      'pauseWorkflowRun',
      'resolveApprovalGate',
      'transitionPlannotatorGate',
      'claimWriteback',
      'releaseWritebackClaim',
      'cancelWorkflowRun',
      'persistRouteDecisionTransition',
      'createWorkflowEvent',
      'enqueueExternalWorkflowEvent',
      'getDagResumeSnapshot',
      'upsertWorkflowNodeCheckpoint',
      'getLatestWorkflowNodeCheckpoint',
      'getCodebase',
      'getCodebaseEnvVars',
      'appendNodeMessage',
      'listNodeMessages',
      'insertPendingInteraction',
      'listPendingInteractions',
      'resolvePendingInteraction',
    ];
    for (const method of requiredMethods) {
      expect(typeof store[method]).toBe('function');
    }
  });

  test('delegates appendNodeMessage to DB and returns the result', async () => {
    const input = {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text' as const,
      payload: { text: 'hello' },
    };
    const row = {
      ...input,
      id: 'msg-1',
      seq: 1,
      created_at: '2026-09-06T00:00:00.000Z',
    };
    mockAppendNodeMessage.mockResolvedValueOnce(row);
    const store = createWorkflowStore();
    const result = await store.appendNodeMessage(input);
    expect(mockAppendNodeMessage).toHaveBeenCalledWith(input);
    expect(result).toEqual(row);
  });

  test('delegates listNodeMessages to DB and returns the result', async () => {
    const rows = [
      {
        id: 'msg-1',
        workflow_run_id: 'run-1',
        node_id: 'review',
        seq: 1,
        kind: 'text' as const,
        payload: { text: 'hello' },
        created_at: '2026-09-06T00:00:00.000Z',
      },
    ];
    mockListNodeMessages.mockResolvedValueOnce(rows);
    const store = createWorkflowStore();
    const result = await store.listNodeMessages('run-1', 'review');
    expect(mockListNodeMessages).toHaveBeenCalledWith('run-1', 'review');
    expect(result).toEqual(rows);
  });

  test('delegates insertPendingInteraction to DB and returns the result', async () => {
    const input = {
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask' as const,
      envelope: { questions: [] },
      provider_session_id: 'sess-1',
    };
    const row = {
      ...input,
      id: 'pend-1',
      status: 'pending' as const,
      answer: null,
      created_at: new Date('2026-09-06T00:00:00.000Z'),
      resolved_at: null,
      resolved_by: null,
    };
    mockInsertPendingInteraction.mockResolvedValueOnce(row);
    const store = createWorkflowStore();
    const result = await store.insertPendingInteraction(input);
    expect(mockInsertPendingInteraction).toHaveBeenCalledWith(input);
    expect(result).toBe(row);
  });

  test('delegates listPendingInteractions to DB and returns the result', async () => {
    const rows = [
      {
        id: 'pend-1',
        workflow_run_id: 'run-1',
        node_id: 'review',
        tool_use_id: 'toolu_1',
        kind: 'ask' as const,
        status: 'pending' as const,
        envelope: { questions: [] },
        answer: null,
        provider_session_id: 'sess-1',
        created_at: new Date('2026-09-06T00:00:00.000Z'),
        resolved_at: null,
        resolved_by: null,
      },
      {
        id: 'pend-2',
        workflow_run_id: 'run-1',
        node_id: 'review',
        tool_use_id: 'toolu_2',
        kind: 'ask' as const,
        status: 'pending' as const,
        envelope: { questions: [] },
        answer: null,
        provider_session_id: 'sess-1',
        created_at: new Date('2026-09-06T00:00:01.000Z'),
        resolved_at: null,
        resolved_by: null,
      },
    ];
    mockListPendingInteractions.mockResolvedValueOnce(rows);
    const store = createWorkflowStore();
    const result = await store.listPendingInteractions('run-1');
    expect(mockListPendingInteractions).toHaveBeenCalledWith('run-1');
    expect(result).toBe(rows);
  });

  test('delegates resolvePendingInteraction with the exact input and result', async () => {
    const input = {
      workflow_run_id: 'run-1',
      tool_use_id: 'toolu_1',
      answer: { decline: true as const },
      resolved_by: 'user-1',
    };
    const result = {
      interaction: {
        id: 'pend-1',
        workflow_run_id: 'run-1',
        node_id: 'review',
        tool_use_id: 'toolu_1',
        kind: 'ask' as const,
        status: 'answered' as const,
        envelope: { questions: [] },
        answer: { decline: true },
        provider_session_id: 'sess-1',
        created_at: new Date('2026-09-06T00:00:00.000Z'),
        resolved_at: new Date('2026-09-06T00:00:01.000Z'),
        resolved_by: 'user-1',
      },
      resumed: true,
      remaining_pending: 0,
    };
    mockResolvePendingInteraction.mockResolvedValueOnce(result);
    const store = createWorkflowStore();
    const actual = await store.resolvePendingInteraction(input);
    expect(mockResolvePendingInteraction).toHaveBeenCalledWith(input);
    expect(actual).toBe(result);
  });

  test('delegates getWorkflowRunStatus to DB and returns typed status', async () => {
    mockGetWorkflowRunStatus.mockResolvedValueOnce('completed');
    const store = createWorkflowStore();
    const result = await store.getWorkflowRunStatus('run-123');
    expect(result).toBe('completed');
    expect(mockGetWorkflowRunStatus).toHaveBeenCalledWith('run-123');
  });

  test('delegates setWorkflowRunEnvOverlay to DB', async () => {
    const snapshot = {
      envId: 'env-1',
      envName: 'fast',
      workflowName: 'wf',
      patches: { plan: { model: 'm' } },
      skippedNodeIds: [],
      latestMissingNodeIds: [],
      resolved: { plan: { provider: 'claude', model: 'm' } },
    };
    mockSetWorkflowRunEnvOverlay.mockResolvedValueOnce({
      id: 'run-123',
      metadata: { envOverlay: snapshot },
    });
    const store = createWorkflowStore();
    const result = await store.setWorkflowRunEnvOverlay('run-123', snapshot);
    expect(mockSetWorkflowRunEnvOverlay).toHaveBeenCalledWith('run-123', snapshot);
    expect(result).toEqual({ id: 'run-123', metadata: { envOverlay: snapshot } });
  });

  test('delegates getWorkflowRunStatus returns null for missing run', async () => {
    mockGetWorkflowRunStatus.mockResolvedValueOnce(null);
    const store = createWorkflowStore();
    const result = await store.getWorkflowRunStatus('nonexistent');
    expect(result).toBeNull();
  });

  test('delegates route decision persistence to DB', async () => {
    const input: Parameters<IWorkflowStore['persistRouteDecisionTransition']>[0] = {
      workflow_run_id: 'run-123',
      expected_execution_seq: 0,
      metadata: { executionSeq: 1 },
      event: {
        step_name: 'router',
        data: { outcome: 'positive' },
      },
    };
    const store = createWorkflowStore();
    await store.persistRouteDecisionTransition(input);
    expect(mockPersistRouteDecisionTransition).toHaveBeenCalledWith(input);
  });

  test('delegates atomic gate operations directly to DB', async () => {
    const store = createWorkflowStore();
    const identity = { nodeId: 'review', gateId: 'gate-a' };
    const metadata = { approval: { resolved: 'approved' } };
    const events = [
      {
        event_type: 'approval_received' as const,
        step_name: 'review',
        data: { decision: 'approved' },
      },
    ];
    const transition = {
      runId: 'run-123',
      nodeId: 'review',
      expectedGateId: 'gate-a',
      document: '/tmp/plan.md',
      phase: 'waiting_decision' as const,
    };

    await store.resolveApprovalGate('run-123', identity, metadata, events);
    await store.transitionPlannotatorGate(transition);
    await store.resumeApprovedGate('run-123', identity);

    expect(mockResolveApprovalGate).toHaveBeenCalledWith('run-123', identity, metadata, events);
    expect(mockTransitionPlannotatorGate).toHaveBeenCalledWith(transition);
    expect(mockResumeApprovedGate).toHaveBeenCalledWith('run-123', identity);
  });

  test('createWorkflowEvent catches and logs unexpected throws', async () => {
    mockCreateWorkflowEvent.mockRejectedValueOnce(new Error('DB connection lost'));
    const store = createWorkflowStore();
    // Should not throw — the wrapper guarantees the non-throwing contract
    await expect(
      store.createWorkflowEvent({
        workflow_run_id: 'run-1',
        event_type: 'step_started',
        step_index: 0,
        step_name: 'test-step',
      })
    ).resolves.toBeUndefined();
  });

  test('enqueueExternalWorkflowEvent catches unexpected throws', async () => {
    mockGetWorkflowRun.mockRejectedValueOnce(new Error('DB connection lost'));
    const store = createWorkflowStore();
    await expect(
      store.enqueueExternalWorkflowEvent({
        workflow_run_id: 'run-1',
        event_type: 'workflow.run.started',
        occurred_at: new Date().toISOString(),
        payload: { state: 'running' },
      })
    ).resolves.toBeUndefined();
  });

  test('enqueueExternalWorkflowEvent persists a routable envelope with a queued delivery time', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow(),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.completed',
      occurred_at: '2026-07-25T00:00:00.000Z',
      payload: {
        state: 'completed',
        result: { outcome: 'accepted', completedAt: '2026-07-25T00:00:00.000Z' },
      },
    });

    expect(mockResolveEventRoute).toHaveBeenCalledWith('cb-1');
    expect(mockEnqueueExternalWorkflowEvent).toHaveBeenCalledTimes(1);
    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(insert).toMatchObject({
      event_type: 'workflow.run.completed',
      workflow_run_id: 'run-1',
      codebase_id: 'cb-1',
      binding_id: 'binding-1',
      event_route: 'https://hermes.example/events',
      status: 'pending',
      next_attempt_at: '2026-07-25T00:00:00.000Z',
    });
    const body = JSON.parse(insert.event_body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toHaveLength(10);
    expect(body).toMatchObject({
      schemaVersion: 'workflow-event-envelope.v1',
      provider: 'archon',
      eventType: 'workflow.run.completed',
      occurredAt: '2026-07-25T00:00:00.000Z',
      idempotencyKey: insert.idempotency_key,
    });
    expect(body).not.toHaveProperty('signature');
    expect(body).not.toHaveProperty('delivery');
  });

  test('enqueueExternalWorkflowEvent filters events disallowed by the binding', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.started',
      occurred_at: '2026-08-15T00:00:00.000Z',
      payload: { state: 'running', startedAt: '2026-08-15T00:00:00.000Z' },
    });

    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('enqueueExternalWorkflowEvent filters disallowed events before not-routable insertion', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: false,
      codebase: codebaseRow(),
      binding: bindingRow({
        event_types: ['workflow.approval.requested'],
        signing_secret: null,
      }),
      reason: 'missing-secret',
    });
    const store = createWorkflowStore();

    await store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.started',
      occurred_at: '2026-08-15T00:00:00.000Z',
      payload: { state: 'running', startedAt: '2026-08-15T00:00:00.000Z' },
    });

    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('enqueueExternalWorkflowEvent persists events allowed by the binding', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.approval.requested',
      occurred_at: '2026-08-15T00:00:00.000Z',
      payload: {
        state: 'waiting-for-approval',
        approval: {
          requestId: 'approval:run-1:review',
          requestedAction: 'approve-or-reject',
          phase: 'review',
          gateType: 'approval',
          nodeId: 'review',
          message: 'Review the plan.',
        },
      },
    });

    expect(mockEnqueueExternalWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  test('routable events call the transform once and persist its exact body', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    const configuredTransform = {
      engine: 'jsonata',
      expression: '{ "eventType": eventType }',
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    };
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ transform: configuredTransform }),
      route: 'https://example.invalid/events',
      secret: 'test-secret',
    });
    mockTransformWorkflowEventBody.mockResolvedValueOnce({
      body: '{"eventType":"workflow.run.completed"}',
      outputBytes: 38,
      engine: 'jsonata',
      durationMs: 2,
    });
    const store = createWorkflowStore();
    await store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.completed',
      occurred_at: '2026-08-18T00:00:00.000Z',
      payload: { state: 'completed', result: { outcome: 'accepted' } },
    });
    expect(mockTransformWorkflowEventBody).toHaveBeenCalledTimes(1);
    expect(mockTransformWorkflowEventBody.mock.calls[0]?.[1]).toEqual(configuredTransform);
    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(insert.event_body).toBe('{"eventType":"workflow.run.completed"}');
    expect(insert.status).toBe('pending');
  });

  test('event filtering happens before envelope transformation', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({
        event_types: ['workflow.approval.requested'],
        transform: { engine: 'jsonata', expression: '$now()' },
      }),
      route: 'https://example.invalid/events',
      secret: 'test-secret',
    });
    await createWorkflowStore().enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.started',
      occurred_at: '2026-08-18T00:00:00.000Z',
      payload: { state: 'running', startedAt: '2026-08-18T00:00:00.000Z' },
    });
    expect(mockTransformWorkflowEventBody).not.toHaveBeenCalled();
    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('classified failure stores canonical evidence and does not reject the workflow', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ transform: { engine: 'jsonata', expression: 'eventType' } }),
      route: 'https://example.invalid/events',
      secret: 'test-secret',
    });
    mockTransformWorkflowEventBody.mockRejectedValueOnce(
      new TestTransformError('TRANSFORM_RESULT_INVALID')
    );
    await expect(
      createWorkflowStore().enqueueExternalWorkflowEvent({
        workflow_run_id: 'run-1',
        event_type: 'workflow.run.started',
        occurred_at: '2026-08-18T00:00:00.000Z',
        payload: { state: 'running', startedAt: '2026-08-18T00:00:00.000Z' },
      })
    ).resolves.toBeUndefined();
    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(insert).toMatchObject({
      status: 'not-routable',
      not_routable_reason: 'transform-failed',
      last_error: 'TRANSFORM_RESULT_INVALID',
      next_attempt_at: null,
    });
    expect(JSON.parse(insert.event_body as string)).toMatchObject({
      schemaVersion: 'workflow-event-envelope.v1',
      eventType: 'workflow.run.started',
    });
    const [fields] = mockLogWarn.mock.calls.find(
      call => call[1] === 'workflow_event_outbox_transform_failed'
    ) as [Record<string, unknown>, string];
    expect(fields).toEqual({
      bindingId: 'binding-1',
      eventType: 'workflow.run.started',
      engine: 'jsonata',
      durationMs: expect.any(Number),
      errorCode: 'TRANSFORM_RESULT_INVALID',
    });
    // Plan regex `/expression|envelope|err/` false-positives on `errorCode`;
    // assert the unsafe keys themselves are absent from the safe log fields.
    expect(JSON.stringify(fields)).not.toMatch(/"(expression|envelope|err)":/);
  });

  test('createWorkflowEvent enriches standard approval callbacks with user prompt and run URL', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.createWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'approval_requested',
      step_name: 'review',
      data: {
        gateType: 'approval',
        nodeId: 'review',
        message: 'Review the plan.',
      },
    });

    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(JSON.parse(insert.event_body as string)).toMatchObject({
      eventType: 'workflow.approval.requested',
      payload: {
        approval: {
          gateType: 'approval',
          nodeId: 'review',
          message: 'Review the plan.',
          userPrompt: 'Build the approved bridge.',
          reviewUrl: 'https://archon.example.ts.net/workflows/runs/run-1',
        },
      },
    });
  });

  test('corrupt persisted transform config produces durable safe failure evidence', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ transform: '{not-json' }),
      route: 'https://example.invalid/events',
      secret: 'test-secret',
    });

    await expect(
      createWorkflowStore().enqueueExternalWorkflowEvent({
        workflow_run_id: 'run-1',
        event_type: 'workflow.run.started',
        occurred_at: '2026-08-18T00:00:00.000Z',
        payload: { state: 'running', startedAt: '2026-08-18T00:00:00.000Z' },
      })
    ).resolves.toBeUndefined();

    expect(mockTransformWorkflowEventBody).not.toHaveBeenCalled();
    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(insert).toMatchObject({
      status: 'not-routable',
      not_routable_reason: 'transform-failed',
      last_error: 'TRANSFORM_CONFIG_INVALID',
      next_attempt_at: null,
    });
    expect(JSON.stringify(insert)).not.toContain('{not-json');
  });

  test('createWorkflowEvent replaces configured URL path and encodes approval route parts', async () => {
    process.env.ARCHON_PUBLIC_URL = 'https://archon.example.ts.net/base/path?old=1#stale';
    mockGetWorkflowRun.mockResolvedValueOnce(
      workflowRunRow({
        id: 'run/1?x#y',
        codebase_id: 'cb/1?x#y',
      })
    );
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow({ id: 'cb/1?x#y' }),
      binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.createWorkflowEvent({
      workflow_run_id: 'run/1?x#y',
      event_type: 'approval_requested',
      step_name: 'review',
      data: {
        gateType: 'approval',
        nodeId: 'review',
        message: 'Review the plan.',
      },
    });

    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(JSON.parse(insert.event_body as string)).toMatchObject({
      payload: {
        approval: {
          reviewUrl: 'https://archon.example.ts.net/workflows/runs/run%2F1%3Fx%23y',
        },
      },
    });
  });

  test('createWorkflowEvent keeps Plannotator approval callbacks on the live review URL', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.createWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'approval_requested',
      step_name: 'review',
      data: {
        gateType: 'plannotator_gate',
        nodeId: 'review',
        message: 'Review the document.',
        reviewUrl: 'https://archon-host.example.ts.net:19432',
      },
    });

    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(JSON.parse(insert.event_body as string)).toMatchObject({
      eventType: 'workflow.approval.requested',
      payload: {
        approval: {
          gateType: 'plannotator_gate',
          nodeId: 'review',
          message: 'Review the document.',
          userPrompt: 'Build the approved bridge.',
          reviewUrl: 'https://archon-host.example.ts.net:19432',
        },
      },
    });
  });

  test('createWorkflowEvent keeps internal approval event when ARCHON_PUBLIC_URL is unset', async () => {
    delete process.env.ARCHON_PUBLIC_URL;
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();
    const event = {
      workflow_run_id: 'run-1',
      event_type: 'approval_requested',
      step_name: 'review',
      data: {
        gateType: 'approval',
        nodeId: 'review',
        message: 'Review the plan.',
      },
    };

    await expect(store.createWorkflowEvent(event)).resolves.toBeUndefined();

    expect(mockCreateWorkflowEvent).toHaveBeenCalledWith(event);
    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('createWorkflowEvent keeps internal approval event when ARCHON_PUBLIC_URL is invalid', async () => {
    process.env.ARCHON_PUBLIC_URL = 'file:///tmp/archon';
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();
    const event = {
      workflow_run_id: 'run-1',
      event_type: 'approval_requested',
      step_name: 'review',
      data: {
        gateType: 'approval',
        nodeId: 'review',
        message: 'Review the plan.',
      },
    };

    await expect(store.createWorkflowEvent(event)).resolves.toBeUndefined();

    expect(mockCreateWorkflowEvent).toHaveBeenCalledWith(event);
    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('createWorkflowEvent keeps internal approval event when ARCHON_PUBLIC_URL has credentials', async () => {
    process.env.ARCHON_PUBLIC_URL = 'https://user:token@archon.example.ts.net';
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();
    const event = {
      workflow_run_id: 'run-1',
      event_type: 'approval_requested',
      step_name: 'review',
      data: {
        gateType: 'approval',
        nodeId: 'review',
        message: 'Review the plan.',
      },
    };

    await expect(store.createWorkflowEvent(event)).resolves.toBeUndefined();

    expect(mockCreateWorkflowEvent).toHaveBeenCalledWith(event);
    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('createWorkflowEvent keeps internal approval event when codebase_id is missing', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow({ codebase_id: null }));
    const store = createWorkflowStore();
    const event = {
      workflow_run_id: 'run-1',
      event_type: 'approval_requested',
      step_name: 'review',
      data: {
        gateType: 'approval',
        nodeId: 'review',
        message: 'Review the plan.',
      },
    };

    await expect(store.createWorkflowEvent(event)).resolves.toBeUndefined();

    expect(mockCreateWorkflowEvent).toHaveBeenCalledWith(event);
    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('enqueueExternalWorkflowEvent does not persist invalid typed event payloads', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow(),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await expect(
      store.enqueueExternalWorkflowEvent({
        workflow_run_id: 'run-1',
        event_type: 'workflow.run.completed',
        occurred_at: '2026-07-25T00:00:00.000Z',
        payload: { state: 'completed' },
      })
    ).resolves.toBeUndefined();

    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('enqueueExternalWorkflowEvent records not-routable events without scheduling delivery', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: false,
      codebase: codebaseRow(),
      binding: bindingRow({ signing_secret: null }),
      reason: 'missing-secret',
    });
    const store = createWorkflowStore();

    await store.enqueueExternalWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow.run.started',
      occurred_at: '2026-07-25T00:00:00.000Z',
      payload: { state: 'running', startedAt: '2026-07-25T00:00:00.000Z' },
    });

    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    expect(insert).toMatchObject({
      event_type: 'workflow.run.started',
      workflow_run_id: 'run-1',
      codebase_id: 'cb-1',
      binding_id: 'binding-1',
      status: 'not-routable',
      not_routable_reason: 'missing-secret',
    });
    expect(insert).not.toHaveProperty('event_route');
    expect(insert).not.toHaveProperty('next_attempt_at');
  });

  test('createWorkflowEvent mirrors supported internal lifecycle events to the external outbox', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
    mockResolveEventRoute.mockResolvedValueOnce({
      routable: true,
      codebase: codebaseRow(),
      binding: bindingRow(),
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
    const store = createWorkflowStore();

    await store.createWorkflowEvent({
      workflow_run_id: 'run-1',
      event_type: 'workflow_started',
      step_index: 0,
      step_name: 'workflow',
    });

    expect(mockCreateWorkflowEvent).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      event_type: 'workflow_started',
      step_index: 0,
      step_name: 'workflow',
    });
    expect(mockEnqueueExternalWorkflowEvent).toHaveBeenCalledTimes(1);
    const [insert] = mockEnqueueExternalWorkflowEvent.mock.calls[0] as [Record<string, unknown>];
    const body = JSON.parse(insert.event_body as string) as Record<string, unknown>;
    expect(insert.event_type).toBe('workflow.run.started');
    expect(body).toMatchObject({
      eventType: 'workflow.run.started',
      payload: {
        state: 'running',
      },
    });
  });

  test('delegates getDagResumeSnapshot to DB', async () => {
    const expected = {
      completedNodeOutputs: new Map([['step1', 'output text']]),
      tokens: { input: 40, output: 4 },
    };
    mockGetDagResumeSnapshot.mockResolvedValueOnce(expected);
    const store = createWorkflowStore();
    const result = await store.getDagResumeSnapshot('run-123');
    expect(result).toBe(expected);
    expect(mockGetDagResumeSnapshot).toHaveBeenCalledWith('run-123');
  });

  test('delegates workflow node checkpoint upsert to DB', async () => {
    const expected = {
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      checkpoint_ref: 'refs/archon/checkpoints/run-1/0/build',
      commit_sha: 'abc',
      created_commit: false,
      fallback_from_node_id: null,
      created_at: new Date(),
    };
    mockUpsertWorkflowNodeCheckpoint.mockResolvedValueOnce(expected);
    const store = createWorkflowStore();
    const result = await store.upsertWorkflowNodeCheckpoint?.({
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      checkpoint_ref: 'refs/archon/checkpoints/run-1/0/build',
      commit_sha: 'abc',
      created_commit: false,
      fallback_from_node_id: null,
    });
    expect(result).toBe(expected);
  });

  test('delegates cancelWorkflowRun to DB', async () => {
    mockCancelWorkflowRun.mockResolvedValueOnce(undefined);
    const store = createWorkflowStore();
    await store.cancelWorkflowRun('run-123');
    expect(mockCancelWorkflowRun).toHaveBeenCalledWith('run-123');
  });

  test('delegates getCodebase to DB', async () => {
    mockGetCodebase.mockResolvedValueOnce({
      id: 'cb-1',
      name: 'owner/repo',
      repository_url: 'https://github.com/owner/repo',
      default_cwd: '/workspace/repo',
    });
    const store = createWorkflowStore();
    const result = await store.getCodebase('cb-1');
    expect(result).toEqual({
      id: 'cb-1',
      name: 'owner/repo',
      repository_url: 'https://github.com/owner/repo',
      default_cwd: '/workspace/repo',
    });
  });
});

describe('createWorkflowDeps', () => {
  test('returns WorkflowDeps with store, getAgentProvider, loadConfig, and usageRecorder', () => {
    const deps = createWorkflowDeps();
    expect(deps.store).toBeDefined();
    expect(typeof deps.getAgentProvider).toBe('function');
    expect(typeof deps.loadConfig).toBe('function');
    expect(deps.usageRecorder).toBeDefined();
    expect(typeof deps.usageRecorder.recordWorkflowUsage).toBe('function');
  });

  test('exposes the run-end git-snapshot hook', () => {
    const deps = createWorkflowDeps();
    expect(typeof deps.onRunEndGitSnapshot).toBe('function');
  });

  test('store from createWorkflowDeps has all IWorkflowStore methods', () => {
    const deps = createWorkflowDeps();
    expect(typeof deps.store.createWorkflowRun).toBe('function');
    expect(typeof deps.store.getWorkflowRun).toBe('function');
    expect(typeof deps.store.createWorkflowEvent).toBe('function');
    expect(typeof deps.store.enqueueExternalWorkflowEvent).toBe('function');
    expect(typeof deps.store.getCodebase).toBe('function');
  });

  describe('provider credential fields', () => {
    beforeEach(() => {
      mockListDecryptedUserProviderCredentials.mockReset();
      mockListDecryptedUserProviderCredentials.mockImplementation(async () => []);
      mockIsPerUserProviderKeysEnabled.mockReset();
      mockIsPerUserProviderKeysEnabled.mockImplementation(() => false);
    });

    test('exposes isPerUserProviderKeysEnabled and getUserProviderEnv', () => {
      const deps = createWorkflowDeps();
      expect(typeof deps.isPerUserProviderKeysEnabled).toBe('function');
      expect(typeof deps.getUserProviderEnv).toBe('function');
    });

    test('getUserProviderEnv returns { env: {}, files: [] } when list query throws', async () => {
      mockListDecryptedUserProviderCredentials.mockRejectedValueOnce(new Error('db gone'));
      const deps = createWorkflowDeps();
      const result = await deps.getUserProviderEnv?.('u-1', '/tmp/art');
      expect(result).toEqual({ env: {}, files: [] });
    });

    // Regression guard for #2035: enabling the credential vault (auto-key on by
    // default) must be ADDITIVE. An unconnected user yields an empty env bag, so
    // their ambient ANTHROPIC_API_KEY / OPENAI_API_KEY pass through untouched —
    // there is no scrub on the AI-provider path (unlike the GitHub org-token path).
    // A future change that scrubbed ambient provider keys would fail this.
    test('getUserProviderEnv is additive: unconnected user gets empty env (no ambient scrub)', async () => {
      mockListDecryptedUserProviderCredentials.mockResolvedValueOnce([]);
      const deps = createWorkflowDeps();
      const result = await deps.getUserProviderEnv?.('u-unconnected', '/tmp/art');
      expect(result).toEqual({ env: {}, files: [] });
    });

    test('getUserProviderEnv aggregates env from multiple providers', async () => {
      mockListDecryptedUserProviderCredentials.mockResolvedValueOnce([
        { provider: 'openrouter', cred: { kind: 'api_key', apiKey: 'or-k' } },
        { provider: 'google', cred: { kind: 'api_key', apiKey: 'g-k' } },
      ]);
      const deps = createWorkflowDeps();
      const result = await deps.getUserProviderEnv?.('u-1', '/tmp/art');
      expect(result?.env).toMatchObject({ OPENROUTER_API_KEY: 'or-k', GEMINI_API_KEY: 'g-k' });
    });
  });
});
