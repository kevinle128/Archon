import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ConversationLockManager } from '@archon/core';
import type { WebAdapter } from '../adapters/web';
import { validationErrorHook } from './openapi-defaults';
import { mockAllWorkflowModules } from '../test/workflow-mock-factories';
import { MAX_TOOL_OUTPUT_CHARS } from '../adapters/web/truncate';

// ---------------------------------------------------------------------------
// Mock setup — must be before dynamic imports of mocked modules
// ---------------------------------------------------------------------------

const mockGetWorkflowRun = mock(async (_id: string) => null as null | MockWorkflowRun);
const mockCancelWorkflowRun = mock(async (_id: string) => ({ cancelled: true }));
const mockListWorkflowRuns = mock(async () => [] as MockWorkflowRun[]);
const mockListDashboardRuns = mock(async () => ({
  runs: [] as MockWorkflowRun[],
  total: 0,
  counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
}));
const mockGetWorkflowRunByWorkerPlatformId = mock(
  async (_id: string) => null as null | MockWorkflowRun
);
const mockListWorkflowEvents = mock(async (_runId: string) => [] as MockWorkflowEvent[]);
const mockGetConversationById = mock(
  async (_id: string) =>
    null as null | { id: string; platform_conversation_id: string; platform_type: string }
);
const mockFindConversationByPlatformId = mock(
  async (_id: string) =>
    null as null | {
      id: string;
      platform_conversation_id: string;
      title: string | null;
      ai_assistant_type: string;
      created_at: Date;
      updated_at: Date;
      platform_type: string;
      deleted_at: Date | null;
      codebase_id: string | null;
    }
);
const mockHandleMessage = mock(async () => {});
const mockAddMessage = mock(async () => ({
  id: 'msg-1',
  conversation_id: 'conv-1',
  role: 'user' as const,
  content: 'hi',
  metadata: '{}',
  created_at: new Date().toISOString(),
}));
const mockGenerateAndSetTitle = mock(async () => {});
const mockResolveTitleRequest = mock(async () => ({
  provider: 'claude',
  options: {} as Record<string, unknown>,
}));

// Type aliases for clarity in tests
type MockWorkflowRun = {
  id: string;
  workflow_name: string;
  conversation_id: string | null;
  parent_conversation_id: string | null;
  codebase_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  user_id?: string | null;
  user_message: string;
  started_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  working_path: string | null;
  last_activity_at: string | null;
};

type MockWorkflowEvent = {
  id: string;
  workflow_run_id: string;
  event_type: string;
  step_index: number | null;
  step_name: string | null;
  data: Record<string, unknown>;
  created_at: string;
};

mock.module('@archon/core', () => ({
  handleMessage: mockHandleMessage,
  getDatabaseType: () => 'sqlite',
  loadConfig: mock(async () => ({})),
  cloneRepository: mock(async () => ({ codebaseId: 'x', alreadyExisted: false })),
  registerRepository: mock(async () => ({ codebaseId: 'x', alreadyExisted: false })),
  ConversationNotFoundError: class ConversationNotFoundError extends Error {
    constructor(id: string) {
      super(`Conversation not found: ${id}`);
      this.name = 'ConversationNotFoundError';
    }
  },
  getArchonWorkspacesPath: () => '/tmp/.archon/workspaces',
  generateAndSetTitle: mockGenerateAndSetTitle,
  resolveTitleRequest: mockResolveTitleRequest,
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
}));

/**
 * Deterministic stand-ins for the shared identity→paths helpers (#2200),
 * mirroring the real branch order and layout under the mocked ARCHON_HOME.
 */
type FakeStorageKey =
  | { kind: 'repo'; owner: string; repo: string }
  | { kind: 'folder'; slug: string }
  | { kind: 'cwd'; cwd: string };

function parseOwnerRepoFake(name: string): { owner: string; repo: string } | null {
  const parts = name.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) return null;
  return { owner, repo };
}

function basenameFake(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? '';
}

function resolveProjectStorageKeyFake(
  codebase: { kind?: string | null; name: string; default_cwd: string } | null | undefined,
  cwd: string
): FakeStorageKey {
  if (codebase) {
    if (codebase.kind === 'folder') {
      const slug =
        codebase.name
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'folder';
      return { kind: 'folder', slug };
    }
    const parsed = parseOwnerRepoFake(codebase.name);
    if (parsed) return { kind: 'repo', ...parsed };
    const base = basenameFake(codebase.default_cwd);
    if (base && base !== '.' && base !== '..') return { kind: 'repo', owner: '_local', repo: base };
  }
  return { kind: 'cwd', cwd };
}

/**
 * Mutable so the filesystem-touching artifact tests can point ARCHON_HOME at a
 * real temp dir. A hard-coded '/tmp/...' is fine for tests that only assert
 * status codes, but tests that mkdir/readdir need a path that is absolute on
 * Windows too.
 */
let mockArchonHome = '/tmp/.archon';
function wsRoot(): string {
  return join(mockArchonHome, 'workspaces');
}

function storageRootFake(key: FakeStorageKey): string {
  if (key.kind === 'repo') return join(wsRoot(), key.owner, key.repo);
  if (key.kind === 'folder') return join(wsRoot(), '_folder', key.slug);
  return join(wsRoot(), '_cwd', basenameFake(key.cwd) || '_');
}

function storagePathsForRootFake(root: string): {
  root: string;
  artifactsRoot: string;
  logsDir: string;
  stateRoot: string;
} {
  return {
    root,
    artifactsRoot: join(root, 'artifacts'),
    logsDir: join(root, 'logs'),
    stateRoot: join(root, 'state'),
  };
}

const mockCaptureApprovalResolved = mock(() => undefined);
const mockApiLogError = mock(() => undefined);
const mockApiLogWarn = mock(() => undefined);

mock.module('@archon/paths', () => ({
  captureApprovalResolved: mockCaptureApprovalResolved,
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mockApiLogError,
    warn: mockApiLogWarn,
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
  getWorkflowFolderSearchPaths: mock(() => ['.archon/workflows']),
  getCommandFolderSearchPaths: mock(() => ['.archon/commands']),
  getDefaultCommandsPath: mock(() => '/tmp/.archon-test-nonexistent/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/tmp/.archon-test-nonexistent/workflows/defaults'),
  getArchonWorkspacesPath: () => wsRoot(),
  getArchonHome: () => mockArchonHome,
  getRunArtifactsPath: (owner: string, repo: string, runId: string): string =>
    join(wsRoot(), owner, repo, 'artifacts', 'runs', runId),
  // Mirrors the real parseOwnerRepo semantics (exactly owner/repo, no
  // traversal segments, GitHub-safe characters only).
  parseOwnerRepo: parseOwnerRepoFake,
  // Mirrors the real identity→paths resolver (#2200) so the routes are
  // exercised as delegation, with paths rooted at the mocked ARCHON_HOME.
  resolveProjectStorageKey: resolveProjectStorageKeyFake,
  getStoragePathsForRoot: storagePathsForRootFake,
  getRunArtifactsDirForKey: (key: FakeStorageKey, runId: string): string =>
    join(storageRootFake(key), 'artifacts', 'runs', runId),
}));

mockAllWorkflowModules();

mock.module('@archon/git', () => ({
  fileAt: mock(async () => ({
    path: 'x.ts',
    bytes: new Uint8Array(),
    binary: false,
    contentHash: '0'.repeat(64),
  })),
  fileDiff: mock(async () => ({
    path: 'x.ts',
    status: 'M' as const,
    scope: 'now' as const,
    ref: 'live' as const,
    hunks: [],
    cursor: '' as const,
    truncated: false as const,
    binary: false,
  })),
  removeWorktree: mock(async () => {}),
  toRepoPath: (p: string) => p,
  toWorktreePath: (p: string) => p,
  changedFiles: mock(async () => ({ files: [], revision: '0'.repeat(64) })),
  isGitWorkTree: mock(async () => false),
  log: mock(async () => ({ commits: [], revision: '0'.repeat(64), truncated: false })),
}));

mock.module('@archon/core/db/conversations', () => ({
  findConversationByPlatformId: mockFindConversationByPlatformId,
  listConversations: mock(async () => []),
  getOrCreateConversation: mock(async () => ({
    id: 'internal-uuid-123',
    platform_conversation_id: 'web-test-abc',
    title: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    platform_type: 'web',
    deleted_at: null,
    codebase_id: null,
    ai_assistant_type: 'claude',
  })),
  softDeleteConversation: mock(async () => {}),
  updateConversationTitle: mock(async () => {}),
  getConversationById: mockGetConversationById,
}));

const mockGetCodebase = mock(async (_id: string) => null as null | { name: string });

mock.module('@archon/core/db/codebases', () => ({
  listCodebases: mock(async () => [{ default_cwd: '/tmp/project' }]),
  getCodebase: mockGetCodebase,
  deleteCodebase: mock(async () => {}),
}));

mock.module('@archon/core/db/isolation-environments', () => ({
  listByCodebase: mock(async () => []),
  updateStatus: mock(async () => {}),
  getById: mock(async () => null),
}));

const mockDeleteWorkflowRun = mock(async (_id: string) => {});
const mockUpdateWorkflowRun = mock(async (_id: string, _update: unknown) => {});
// CAS gate resolvers (#2113) — the real approve/reject operations stamp the
// resolution here. resolveAndCancelApprovalGate is the atomic resolve+cancel for
// terminal reject outcomes. Default to "won the race".
// The 4th arg (approve) / 3rd arg (cancel) is the audit-event batch written in the
// same transaction as the resolution (#2146).
const mockResolveApprovalGate = mock(
  async (_id: string, _identity: unknown, _md: unknown, _events?: unknown) => ({
    resolved: true,
  })
);
const mockResolveAndCancelApprovalGate = mock(
  async (_id: string, _identity: unknown, _events?: unknown) => ({
    resolved: true,
  })
);
const mockTransitionPlannotatorGate = mock(async (_input: unknown) => ({
  outcome: 'updated' as const,
  approval: {},
}));
const mockFindChildRuns = mock(async (_parentRunId: string): Promise<unknown[]> => []);
const mockSubmitReviewFeedback = mock(async (_input: unknown) => ({
  outcome: 'accepted' as const,
  receipt: {
    requestId: 'aaaaaaaa-0000-0000-0000-000000000001',
    reviewSessionId: 'bbbbbbbb-0000-0000-0000-000000000001',
    nodeId: 'review',
    gateId: 'gate-1',
    feedback: 'looks good',
    status: 'accepted' as const,
    submittedAt: new Date().toISOString(),
    source: 'inline' as const,
  },
}));
const mockClaimGateDecision = mock(async (_input: unknown) => ({ claimed: true }));

mock.module('@archon/core/db/workflows', () => ({
  listWorkflowRuns: mockListWorkflowRuns,
  listDashboardRuns: mockListDashboardRuns,
  getWorkflowRun: mockGetWorkflowRun,
  findChildRuns: mockFindChildRuns,
  cancelWorkflowRun: mockCancelWorkflowRun,
  deleteWorkflowRun: mockDeleteWorkflowRun,
  updateWorkflowRun: mockUpdateWorkflowRun,
  resolveApprovalGate: mockResolveApprovalGate,
  resolveAndCancelApprovalGate: mockResolveAndCancelApprovalGate,
  transitionPlannotatorGate: mockTransitionPlannotatorGate,
  getWorkflowRunByWorkerPlatformId: mockGetWorkflowRunByWorkerPlatformId,
  submitReviewFeedback: mockSubmitReviewFeedback,
  claimGateDecision: mockClaimGateDecision,
}));

const mockCreateWorkflowEvent = mock(async (_event: unknown) => {});

mock.module('@archon/core/db/workflow-events', () => ({
  listWorkflowEvents: mockListWorkflowEvents,
  createWorkflowEvent: mockCreateWorkflowEvent,
}));

mock.module('@archon/core/db/messages', () => ({
  addMessage: mockAddMessage,
  listMessages: mock(async () => []),
}));

const mockGetWorkflowNodeRetryPreview = mock(async () => ({
  runId: 'run-web-retry',
  workflowName: 'deploy',
  nodeId: 'build',
  retryEpoch: 1,
  invalidatedNodeIds: ['build'],
  resetSkipped: false,
  checkpointRef: 'refs/archon/checkpoints/run-web-retry/0/build',
  checkpointCommitSha: 'checkpoint-sha',
  currentHeadSha: 'head-sha',
  hasNewerHead: true,
  requiresCommitChoice: true,
}));
const mockPrepareWorkflowNodeRetry = mock(
  async (input: { checkoutStrategy?: 'checkpoint' | 'current' }) => ({
    runId: 'run-web-retry',
    workflowName: 'deploy',
    preCreatedRun: {
      id: 'run-web-retry',
      workflow_name: 'deploy',
      conversation_id: 'worker-conv',
      parent_conversation_id: 'parent-conv',
      codebase_id: null,
      status: 'running',
      user_message: 'retry',
      started_at: NOW,
      completed_at: null,
      metadata: { retry_epoch: 1 },
      working_path: '/tmp/worktrees/feature',
      last_activity_at: NOW,
    },
    retryEpoch: 1,
    invalidatedNodeIds: ['build'],
    preservedCompletedOutputs: new Map<string, string>(),
    resetSkipped: input.checkoutStrategy === 'current',
    safetyRef: 'refs/archon/retry-safety/run-web-retry/1',
    safetyCommitSha: 'safety-sha',
    checkoutStrategy: input.checkoutStrategy ?? 'checkpoint',
  })
);

mock.module('@archon/core/operations/workflow-retry', () => ({
  getWorkflowNodeRetryPreview: mockGetWorkflowNodeRetryPreview,
  prepareWorkflowNodeRetry: mockPrepareWorkflowNodeRetry,
}));

const mockExecuteWorkflow = mock(async () => ({
  success: true,
  workflowRunId: 'run-web-retry',
}));
const mockCreateWorkflowDeps = mock(() => ({}));
const mockEnqueueExternalWorkflowEvent = mock(async () => {});
const mockCreateWorkflowStore = mock(() => ({
  enqueueExternalWorkflowEvent: mockEnqueueExternalWorkflowEvent,
}));

mock.module('@archon/workflows/executor', () => ({
  executeWorkflow: mockExecuteWorkflow,
}));

mock.module('@archon/core/workflows/store-adapter', () => ({
  createWorkflowDeps: mockCreateWorkflowDeps,
  createWorkflowStore: mockCreateWorkflowStore,
}));

mock.module('@archon/core/utils/commands', () => ({
  findMarkdownFilesRecursive: mock(async () => []),
}));

function emptyUsageMetrics() {
  return {
    tokensInput: null as number | null,
    tokensOutput: null as number | null,
    tokensReasoning: null as number | null,
    tokensCacheRead: null as number | null,
    tokensCacheWrite: null as number | null,
    requests: null as number | null,
    reportedUsd: null as number | null,
    estimatedUsd: null as number | null,
    recordCount: 0,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 0,
    missingTokensCacheRead: 0,
    missingTokensCacheWrite: 0,
    missingRequests: 0,
    rowsMissingUsd: 0,
  };
}

function emptyUsageReport(runId?: string) {
  return {
    scope: {
      from: null as string | null,
      to: null as string | null,
      ...(runId ? { runId } : {}),
      includesChildRollup: false as const,
    },
    groupBy: 'node' as const,
    totals: emptyUsageMetrics(),
    groups: [] as Array<{
      dimensions: Record<string, unknown>;
      metrics: {
        tokensInput: number | null;
        tokensOutput: number | null;
        tokensReasoning: number | null;
        tokensCacheRead: number | null;
        tokensCacheWrite: number | null;
        requests: number | null;
        reportedUsd: number | null;
        estimatedUsd: number | null;
        recordCount: number;
        missingTokensInput: number;
        missingTokensOutput: number;
        missingTokensReasoning: number;
        missingTokensCacheRead: number;
        missingTokensCacheWrite: number;
        missingRequests: number;
        rowsMissingUsd: number;
      };
    }>,
    coverage: {
      usageEventCount: 0,
      ledgeredEventCount: 0,
      unledgeredEventCount: 0,
      hasRecordedUsage: false,
      historicalBackfill: false as const,
      filterScope: 'date-project-run-node' as const,
    },
  };
}

class MockUsageReportQueryError extends Error {
  readonly code: 'validation' | 'overflow' | 'unsafe_aggregate' | 'query_failed';
  constructor(
    code: 'validation' | 'overflow' | 'unsafe_aggregate' | 'query_failed',
    message: string
  ) {
    super(message);
    this.name = 'UsageReportQueryError';
    this.code = code;
  }
}

const mockQueryUsageReport = mock(async (opts: { runId?: string; groupBy?: string } = {}) =>
  emptyUsageReport(opts.runId)
);

mock.module('@archon/core/db/usage-report', () => ({
  queryUsageReport: mockQueryUsageReport,
  UsageReportQueryError: MockUsageReportQueryError,
}));

// Mutable ENV row used by Start freeze tests (US-008). Mutation after Start
// must not change the frozen candidate handed to handleMessage.
const liveEnvPatches: Record<string, Record<string, string>> = {
  research: { model: 'haiku' },
};

const mockGetWorkflowEnvById = mock(async (envId: string) => {
  if (envId === 'env-deploy') {
    return {
      id: 'env-deploy',
      workflow_name: 'deploy',
      name: 'staging',
      patches: liveEnvPatches,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      created_by_user_id: null,
    };
  }
  if (envId === 'env-other') {
    return {
      id: 'env-other',
      workflow_name: 'other-workflow',
      name: 'x',
      patches: { research: { model: 'haiku' } },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      created_by_user_id: null,
    };
  }
  if (envId === 'env-corrupt') {
    throw new WorkflowEnvCorruptRowError('env-corrupt');
  }
  return null;
});

class WorkflowEnvCorruptRowError extends Error {
  readonly envId: string;
  constructor(envId: string) {
    super(`Workflow ENV row corrupt: ${envId}`);
    this.name = 'WorkflowEnvCorruptRowError';
    this.envId = envId;
  }
}

type MockNodeMessageRow = {
  id: string;
  workflow_run_id: string;
  node_id: string;
  seq: number;
  kind: 'text' | 'tool' | 'status';
  payload: Record<string, unknown>;
  created_at: Date | string;
  metadata?: Record<string, unknown> | null;
};

const mockListNodeMessages = mock(
  async (_runId: string, _nodeId: string, _query?: Record<string, unknown>) =>
    [] as MockNodeMessageRow[]
);
const mockGetNodeMessage = mock(
  async (_runId: string, _nodeId: string, _messageId: string) => null as MockNodeMessageRow | null
);
const mockGetNodeMessageHighWatermark = mock(
  async (_runId: string, _nodeId: string, _query?: Record<string, unknown>) => 0
);

mock.module('@archon/core/db/workflow-node-messages', () => ({
  listNodeMessages: mockListNodeMessages,
  getNodeMessage: mockGetNodeMessage,
  getNodeMessageHighWatermark: mockGetNodeMessageHighWatermark,
}));

type MockPendingInteractionRow = {
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
};

class PendingInteractionNotFoundError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly toolUseId: string
  ) {
    super(`Pending interaction not found: ${workflowRunId}/${toolUseId}`);
    this.name = 'PendingInteractionNotFoundError';
  }
}

class PendingInteractionAlreadyResolvedError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly toolUseId: string,
    readonly status: string
  ) {
    super(`Pending interaction already resolved: ${workflowRunId}/${toolUseId}`);
    this.name = 'PendingInteractionAlreadyResolvedError';
  }
}

class PendingInteractionRunNotPausedError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly status: string
  ) {
    super(`Workflow run is not paused: ${workflowRunId}`);
    this.name = 'PendingInteractionRunNotPausedError';
  }
}

type PendingInteractionValidationCode =
  | 'invalid_body'
  | 'kind_not_ask'
  | 'kind_not_permission'
  | 'missing_question'
  | 'unknown_question'
  | 'duplicate_question'
  | 'duplicate_envelope_id'
  | 'invalid_single_value'
  | 'invalid_multi_value'
  | 'invalid_option'
  | 'blank_other';

class PendingInteractionValidationError extends Error {
  constructor(readonly code: PendingInteractionValidationCode) {
    super(`Pending interaction validation failed: ${code}`);
    this.name = 'PendingInteractionValidationError';
  }
}

const mockListPendingInteractions = mock(
  async (_runId: string) => [] as MockPendingInteractionRow[]
);
const mockResolvePendingInteraction = mock(
  async (
    _input: unknown
  ): Promise<{
    interaction: MockPendingInteractionRow;
    resumed: boolean;
    remaining_pending: number;
  }> => {
    throw new Error('resolvePendingInteraction mock not configured');
  }
);

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

type MockUserRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: 'admin' | 'member';
  created_at: Date;
  updated_at: Date;
};

const mockGetUserById = mock(async (_id: string) => null as null | MockUserRow);

const mockGetUserDisplayNamesByIds = mock(
  async (_ids: readonly string[]) => [] as Array<{ id: string; display_name: string | null }>
);

const mockFindOrCreateUserByPlatformIdentity = mock(
  async (_platform: string, platformUserId: string, _displayName?: string) => ({
    id: platformUserId,
    display_name: platformUserId,
    email: null,
    role: 'admin' as const,
    created_at: new Date(),
    updated_at: new Date(),
  })
);

mock.module('@archon/core/db/users', () => ({
  findOrCreateUserByPlatformIdentity: mockFindOrCreateUserByPlatformIdentity,
  getUserById: mockGetUserById,
  getUserDisplayNamesByIds: mockGetUserDisplayNamesByIds,
}));

mock.module('@archon/core/db/workflow-envs', () => ({
  listWorkflowEnvSummaries: mock(async () => []),
  getWorkflowEnvById: mockGetWorkflowEnvById,
  createWorkflowEnv: mock(async () => {
    throw new Error('createWorkflowEnv not used by workflow-runs tests');
  }),
  updateWorkflowEnv: mock(async () => null),
  deleteWorkflowEnv: mock(async () => false),
  WorkflowEnvNameConflictError: class WorkflowEnvNameConflictError extends Error {
    readonly workflowName: string;
    readonly envName: string;
    constructor(workflowName: string, envName: string) {
      super(`Workflow ENV '${envName}' already exists for workflow '${workflowName}'`);
      this.name = 'WorkflowEnvNameConflictError';
      this.workflowName = workflowName;
      this.envName = envName;
    }
  },
  WorkflowEnvCorruptRowError,
  isWorkflowEnvNameConflict: () => false,
}));

import { registerApiRoutes } from './api';
import { getSteeringRegistry } from '@archon/workflows/steering-registry';
import type {
  NodeSteeringHandle,
  SteeringHandleSnapshot,
  SteeringIdleWake,
} from '@archon/workflows/steering-registry';
import { getAuth } from '../auth';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

const MOCK_RUNNING_RUN: MockWorkflowRun = {
  id: 'run-uuid-1',
  workflow_name: 'deploy',
  conversation_id: 'conv-uuid-1',
  parent_conversation_id: null,
  codebase_id: 'cb-uuid-1',
  status: 'running',
  user_id: null,
  user_message: 'Deploy to staging',
  started_at: NOW,
  completed_at: null,
  metadata: {},
  working_path: '/tmp/worktrees/feature',
  last_activity_at: NOW,
};

const MOCK_COMPLETED_RUN: MockWorkflowRun = {
  ...MOCK_RUNNING_RUN,
  id: 'run-uuid-2',
  status: 'completed',
  completed_at: NOW,
};

const MOCK_FAILED_RUN: MockWorkflowRun = {
  ...MOCK_RUNNING_RUN,
  id: 'run-uuid-4',
  status: 'failed',
  completed_at: NOW,
};

const MOCK_PENDING_RUN: MockWorkflowRun = {
  ...MOCK_RUNNING_RUN,
  id: 'run-uuid-3',
  status: 'pending',
};

const MOCK_EVENTS: MockWorkflowEvent[] = [
  {
    id: 'evt-1',
    workflow_run_id: 'run-uuid-1',
    event_type: 'step_started',
    step_index: 0,
    step_name: 'plan',
    data: {},
    created_at: NOW,
  },
  {
    id: 'evt-2',
    workflow_run_id: 'run-uuid-1',
    event_type: 'step_completed',
    step_index: 0,
    step_name: 'plan',
    data: { duration_ms: 1234 },
    created_at: NOW,
  },
  {
    id: 'evt-3',
    workflow_run_id: 'run-uuid-1',
    event_type: 'tool_called',
    step_index: 0,
    step_name: 'plan',
    data: { tool_name: 'Read', tool_input: { file_path: '/tmp/test.ts' } },
    created_at: NOW,
  },
];

const MOCK_CONV = {
  id: 'internal-uuid-123',
  platform_conversation_id: 'web-test-abc',
  title: null,
  ai_assistant_type: 'claude',
  created_at: new Date(),
  updated_at: new Date(),
  platform_type: 'web',
  deleted_at: null,
  codebase_id: null,
};

function makeApp(): { app: OpenAPIHono; mockWebAdapter: WebAdapter } {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const mockWebAdapter = {
    setConversationDbId: mock((_platformId: string, _dbId: string) => {}),
    emitSSE: mock(async () => {}),
    emitLockEvent: mock(async () => {}),
  } as unknown as WebAdapter;
  const mockLockManager = {
    acquireLock: mock(async (_id: string, fn: () => Promise<void>) => {
      await fn();
      return { status: 'started' };
    }),
    getStats: mock(() => ({ active: 0, queued: 0 })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, mockWebAdapter, mockLockManager);
  return { app, mockWebAdapter };
}

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/:name/run
// ---------------------------------------------------------------------------

describe('POST /api/workflows/:name/run', () => {
  beforeEach(() => {
    mockFindConversationByPlatformId.mockReset();
    mockHandleMessage.mockReset();
    mockAddMessage.mockReset();
    mockGenerateAndSetTitle.mockReset();
    mockGetWorkflowEnvById.mockClear();
  });

  test('dispatches workflow run to orchestrator and returns accepted', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Deploy to staging',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Deploy to staging' }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { accepted: boolean; status: string };
    expect(body.accepted).toBe(true);
    expect(body.status).toBe('started');
  });

  test('sends /workflow run <name> <message> to orchestrator', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Run tests',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    await app.request('/api/workflows/test-suite/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Run tests' }),
    });

    expect(mockHandleMessage).toHaveBeenCalledWith(
      expect.anything(),
      'web-test-abc',
      '/workflow run test-suite Run tests',
      expect.objectContaining({
        isolationHints: { workflowType: 'thread', workflowId: 'web-test-abc' },
      })
    );
  });

  test('accepts a percent-encoded namespaced name and forwards the decoded name', async () => {
    // Regression guard: percent-encoded '/' must be decoded and validate, not raw-route to 400.
    const { isValidWorkflowName, isValidCommandName } =
      await import('@archon/workflows/command-validation');
    const segmentOk = (seg: string) =>
      !!seg && !seg.startsWith('.') && !seg.includes('\\') && !seg.includes('..');
    // Real namespaced logic: `triage/review` is valid (one subfolder deep).
    (isValidWorkflowName as ReturnType<typeof mock>).mockImplementationOnce((name: string) => {
      if (!name) return false;
      const segments = name.split('/');
      if (segments.length > 2) return false;
      return segments.every(segmentOk);
    });
    // Strict command logic that rejects `/`, so this test goes red if the run
    // route validates with isValidCommandName instead of isValidWorkflowName.
    (isValidCommandName as ReturnType<typeof mock>).mockImplementationOnce(
      (name: string) => segmentOk(name) && !name.includes('/')
    );

    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Run triage',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    const response = await app.request('/api/workflows/triage%2Freview/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Run triage' }),
    });
    expect(response.status).toBe(200);

    expect(mockHandleMessage).toHaveBeenCalledWith(
      expect.anything(),
      'web-test-abc',
      '/workflow run triage/review Run triage',
      expect.objectContaining({
        isolationHints: { workflowType: 'thread', workflowId: 'web-test-abc' },
      })
    );
  });

  test('persists user message to DB when conversation found', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Deploy',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Deploy' }),
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      MOCK_CONV.id,
      'user',
      'Deploy',
      undefined,
      undefined
    );
  });

  test('fires title generation for conversations without title', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => ({
      ...MOCK_CONV,
      title: null,
    }));
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Deploy',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Deploy' }),
    });

    // generateAndSetTitle is fire-and-forget; just verify it was called
    // (it runs asynchronously so we check the mock was called, not the result)
    // Allow the microtask queue to flush
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockGenerateAndSetTitle).toHaveBeenCalled();
  });

  test('returns 400 when conversationId is missing', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Deploy to staging' }),
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('conversationId');
  });

  test('returns 400 when message is missing', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc' }),
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('message');
  });

  test('returns 400 for invalid workflow name (path traversal)', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/workflows/../secret/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Test' }),
    });
    // Hono routes won't match ../secret as /:name due to path normalization — either 400 or 404
    expect([400, 404]).toContain(response.status);
  });

  test('returns 400 when isValidWorkflowName rejects the name', async () => {
    const { isValidWorkflowName } = await import('@archon/workflows/command-validation');
    (isValidWorkflowName as ReturnType<typeof mock>).mockReturnValueOnce(false);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/.hidden/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Test' }),
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Invalid workflow name');
  });

  test('returns 400 for malformed JSON body', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    });
    expect(response.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Declared inputs (#2554)
  // -------------------------------------------------------------------------

  test('forwards a JSON `inputs` map on the context, never in the message text', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Review it',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    const response = await app.request('/api/workflows/review-block/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'web-test-abc',
        message: 'Review it',
        inputs: { diff: 'D1', style: 'terse' },
      }),
    });
    expect(response.status).toBe(200);

    expect(mockHandleMessage).toHaveBeenCalledWith(
      expect.anything(),
      'web-test-abc',
      // The command text is untouched — a supplied value must never be confusable
      // with $ARGUMENTS, and this route must not invent a chat grammar.
      '/workflow run review-block Review it',
      expect.objectContaining({ workflowInputs: { diff: 'D1', style: 'terse' } })
    );
  });

  test('omits workflowInputs entirely when no inputs are supplied', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Go',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Go' }),
    });

    const ctx = mockHandleMessage.mock.calls[0][3] as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('workflowInputs');
  });

  test('returns 400 when `inputs` is not an object of strings', async () => {
    const { app } = makeApp();
    for (const inputs of [['a'], 'nope', { diff: 5 }, { diff: null }]) {
      const response = await app.request('/api/workflows/deploy/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Go', inputs }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('inputs');
    }
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('treats an explicit empty `inputs` object as nothing supplied', async () => {
    // `{}` is valid, not an error — it means "take every declared default", so the
    // context must carry no workflowInputs rather than an empty map.
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Go',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Go', inputs: {} }),
    });
    expect(response.status).toBe(200);

    const ctx = mockHandleMessage.mock.calls[0][3] as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('workflowInputs');
  });

  test('accepts a multipart `inputs` field carrying the map JSON-encoded', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Review it',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const form = new FormData();
    form.append('conversationId', 'web-test-abc');
    form.append('message', 'Review it');
    form.append('inputs', JSON.stringify({ diff: 'D1' }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/review-block/run', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(200);

    expect(mockHandleMessage).toHaveBeenCalledWith(
      expect.anything(),
      'web-test-abc',
      '/workflow run review-block Review it',
      expect.objectContaining({ workflowInputs: { diff: 'D1' } })
    );
  });

  test('returns 400 for a malformed multipart `inputs` field rather than dropping it', async () => {
    const form = new FormData();
    form.append('conversationId', 'web-test-abc');
    form.append('message', 'Review it');
    form.append('inputs', 'not json {{{');

    const { app } = makeApp();
    const response = await app.request('/api/workflows/review-block/run', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(400);
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Workflow ENV freeze at Start (US-008)
  // -------------------------------------------------------------------------

  test('omits envOverlay when no envId is supplied (YAML-only)', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Go',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Go' }),
    });
    expect(response.status).toBe(200);

    expect(mockGetWorkflowEnvById).not.toHaveBeenCalled();
    const ctx = mockHandleMessage.mock.calls[0][3] as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('envOverlay');
  });

  test('treats empty envId as YAML-only', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Go',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'web-test-abc', message: 'Go', envId: '' }),
    });
    expect(response.status).toBe(200);
    expect(mockGetWorkflowEnvById).not.toHaveBeenCalled();
    const ctx = mockHandleMessage.mock.calls[0][3] as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('envOverlay');
  });

  test('forwards a frozen JSON envId candidate out-of-band', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Deploy',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'web-test-abc',
        message: 'Deploy',
        envId: 'env-deploy',
      }),
    });
    expect(response.status).toBe(200);

    expect(mockGetWorkflowEnvById).toHaveBeenCalledWith('env-deploy');
    expect(mockHandleMessage).toHaveBeenCalledWith(
      expect.anything(),
      'web-test-abc',
      '/workflow run deploy Deploy',
      expect.objectContaining({
        envOverlay: {
          envId: 'env-deploy',
          envName: 'staging',
          workflowName: 'deploy',
          patches: { research: { model: 'haiku' } },
        },
      })
    );
  });

  test('accepts multipart envId and freezes the same candidate shape', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Deploy',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const form = new FormData();
    form.append('conversationId', 'web-test-abc');
    form.append('message', 'Deploy');
    form.append('envId', 'env-deploy');

    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(200);

    expect(mockHandleMessage).toHaveBeenCalledWith(
      expect.anything(),
      'web-test-abc',
      '/workflow run deploy Deploy',
      expect.objectContaining({
        envOverlay: {
          envId: 'env-deploy',
          envName: 'staging',
          workflowName: 'deploy',
          patches: { research: { model: 'haiku' } },
        },
      })
    );
  });

  test('returns 400 invalid_env_id for JSON envId null before lookup', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'web-test-abc',
        message: 'Go',
        envId: null,
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_env_id' });
    expect(mockGetWorkflowEnvById).not.toHaveBeenCalled();
    expect(mockHandleMessage).not.toHaveBeenCalled();
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  test('returns 400 invalid_env_id when JSON envId is not a string', async () => {
    const { app } = makeApp();
    for (const envId of [42, true, { id: 'x' }, ['env-deploy']] as const) {
      mockGetWorkflowEnvById.mockClear();
      mockHandleMessage.mockClear();
      mockAddMessage.mockClear();
      const response = await app.request('/api/workflows/deploy/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: 'web-test-abc',
          message: 'Go',
          envId,
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_env_id' });
      expect(mockGetWorkflowEnvById).not.toHaveBeenCalled();
      expect(mockHandleMessage).not.toHaveBeenCalled();
      expect(mockAddMessage).not.toHaveBeenCalled();
    }
  });

  test('returns 400 invalid_env_id when multipart envId is duplicated', async () => {
    const form = new FormData();
    form.append('conversationId', 'web-test-abc');
    form.append('message', 'Go');
    form.append('envId', 'env-deploy');
    form.append('envId', 'env-other');

    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_env_id' });
    expect(mockGetWorkflowEnvById).not.toHaveBeenCalled();
    expect(mockHandleMessage).not.toHaveBeenCalled();
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  test('returns 400 env_not_found before message persistence', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'web-test-abc',
        message: 'Go',
        envId: 'missing-env',
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'env_not_found' });
    expect(mockGetWorkflowEnvById).toHaveBeenCalledWith('missing-env');
    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('returns 400 env_workflow_mismatch before message persistence', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'web-test-abc',
        message: 'Go',
        envId: 'env-other',
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'env_workflow_mismatch' });
    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('returns env_store_corrupt before message persistence for a corrupt row', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'web-test-abc',
        message: 'Go',
        envId: 'env-corrupt',
      }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'env_store_corrupt' });
    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('passes a deep-frozen copy; later store mutation does not change context', async () => {
    mockFindConversationByPlatformId.mockImplementationOnce(async () => MOCK_CONV);
    mockAddMessage.mockImplementationOnce(async () => ({
      id: 'msg-1',
      conversation_id: MOCK_CONV.id,
      role: 'user' as const,
      content: 'Deploy',
      metadata: '{}',
      created_at: NOW,
    }));
    mockHandleMessage.mockImplementationOnce(async () => {});

    const { app } = makeApp();
    const response = await app.request('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'web-test-abc',
        message: 'Deploy',
        envId: 'env-deploy',
      }),
    });
    expect(response.status).toBe(200);

    // Mutate the "store" row after Start froze the candidate.
    liveEnvPatches.research = { model: 'mutated-after-start' };
    (liveEnvPatches as Record<string, Record<string, string>>).extra = { prompt: 'nope' };

    const ctx = mockHandleMessage.mock.calls[0][3] as {
      envOverlay: {
        envId: string;
        envName: string;
        workflowName: string;
        patches: Record<string, Record<string, string>>;
      };
    };
    expect(ctx.envOverlay.patches).toEqual({ research: { model: 'haiku' } });
    expect(ctx.envOverlay.patches).not.toBe(liveEnvPatches);

    // Restore for later tests.
    delete (liveEnvPatches as Record<string, unknown>).extra;
    liveEnvPatches.research = { model: 'haiku' };
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/callback/test
// ---------------------------------------------------------------------------

describe('POST /api/workflows/runs/:runId/callback/test', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockCreateWorkflowStore.mockClear();
    mockEnqueueExternalWorkflowEvent.mockReset();
  });

  test('queues a completed event through the callback outbox', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(MOCK_COMPLETED_RUN);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-2/callback/test', {
      method: 'POST',
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: true,
      runId: 'run-uuid-2',
      eventType: 'workflow.run.completed',
    });
    expect(mockEnqueueExternalWorkflowEvent).toHaveBeenCalledWith({
      workflow_run_id: 'run-uuid-2',
      event_type: 'workflow.run.completed',
      occurred_at: expect.any(String),
      payload: {
        state: 'completed',
        result: { outcome: 'manual-test', completedAt: expect.any(String) },
      },
    });
  });

  test('returns 404 without touching the outbox when the run does not exist', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/missing/callback/test', {
      method: 'POST',
    });

    expect(response.status).toBe(404);
    expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/cancel
// ---------------------------------------------------------------------------

describe('POST /api/workflows/runs/:runId/cancel', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockCancelWorkflowRun.mockReset();
  });

  test('cancels a running workflow run and returns success', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockCancelWorkflowRun.mockImplementationOnce(async () => ({ cancelled: true }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/cancel', {
      method: 'POST',
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('deploy');
    expect(mockCancelWorkflowRun).toHaveBeenCalledWith('run-uuid-1');
  });

  test('cancels a pending workflow run and returns success', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_PENDING_RUN);
    mockCancelWorkflowRun.mockImplementationOnce(async () => ({ cancelled: true }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-3/cancel', {
      method: 'POST',
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('reports "nothing to cancel" when the run finished in the cancel TOCTOU window', async () => {
    // Run passes the status pre-check (running), but cancelWorkflowRun no-ops
    // because the run reached a terminal state first — the route must not claim
    // a false "Cancelled" (#1830 I1).
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockCancelWorkflowRun.mockImplementationOnce(async () => ({ cancelled: false }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/cancel', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('nothing to cancel');
  });

  test('returns 404 when run not found', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => null);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/unknown-run/cancel', {
      method: 'POST',
    });
    expect(response.status).toBe(404);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  test('returns 400 when trying to cancel a completed run', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_COMPLETED_RUN);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-2/cancel', {
      method: 'POST',
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('completed');
  });

  test('returns 400 when trying to cancel an already-cancelled run', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      status: 'cancelled' as const,
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/cancel', {
      method: 'POST',
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('cancelled');
  });

  test('returns 400 when trying to cancel a failed run', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      status: 'failed' as const,
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/cancel', {
      method: 'POST',
    });
    expect(response.status).toBe(400);
  });

  test('returns 500 when DB throws during cancel', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockCancelWorkflowRun.mockImplementationOnce(async () => {
      throw new Error('DB locked');
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/cancel', {
      method: 'POST',
    });
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Failed to cancel');
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/workflows/runs
// ---------------------------------------------------------------------------

describe('GET /api/workflows/runs', () => {
  beforeEach(() => {
    mockListWorkflowRuns.mockReset();
  });

  test('returns empty runs array when no runs exist', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => []);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { runs: unknown[] };
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.length).toBe(0);
  });

  test('returns list of workflow runs', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => [MOCK_RUNNING_RUN, MOCK_COMPLETED_RUN]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.length).toBe(2);
    expect(body.runs[0]?.id).toBe('run-uuid-1');
  });

  test('converts Date objects to ISO strings in response', async () => {
    const now = new Date('2025-06-01T12:00:00.000Z');
    mockListWorkflowRuns.mockImplementationOnce(async () => [
      {
        ...MOCK_RUNNING_RUN,
        started_at: now,
        completed_at: null,
        last_activity_at: undefined as unknown as string,
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      runs: Array<{ started_at: string; completed_at: null; last_activity_at: null }>;
    };
    expect(body.runs[0]?.started_at).toBe('2025-06-01T12:00:00.000Z');
    expect(body.runs[0]?.completed_at).toBeNull();
    expect(body.runs[0]?.last_activity_at).toBeNull();
  });

  test('filters by status query param', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => [MOCK_RUNNING_RUN]);

    const { app } = makeApp();
    await app.request('/api/workflows/runs?status=running');

    const [[callArgs]] = mockListWorkflowRuns.mock.calls as [
      [{ status?: string; limit?: number }],
    ][];
    expect(callArgs?.status).toBe('running');
  });

  test('ignores invalid status values', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => []);

    const { app } = makeApp();
    await app.request('/api/workflows/runs?status=invalid_status');

    const [[callArgs]] = mockListWorkflowRuns.mock.calls as [
      [{ status?: string; limit?: number }],
    ][];
    expect(callArgs?.status).toBeUndefined();
  });

  test('filters by conversationId query param', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => []);

    const { app } = makeApp();
    await app.request('/api/workflows/runs?conversationId=conv-123');

    const [[callArgs]] = mockListWorkflowRuns.mock.calls as [[{ conversationId?: string }]][];
    expect(callArgs?.conversationId).toBe('conv-123');
  });

  test('filters by codebaseId query param', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => []);

    const { app } = makeApp();
    await app.request('/api/workflows/runs?codebaseId=cb-uuid-1');

    const [[callArgs]] = mockListWorkflowRuns.mock.calls as [[{ codebaseId?: string }]][];
    expect(callArgs?.codebaseId).toBe('cb-uuid-1');
  });

  test('caps limit at 200', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => []);

    const { app } = makeApp();
    await app.request('/api/workflows/runs?limit=9999');

    const [[callArgs]] = mockListWorkflowRuns.mock.calls as [[{ limit?: number }]][];
    expect(callArgs?.limit).toBeLessThanOrEqual(200);
  });

  test('uses default limit of 50 when not specified', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => []);

    const { app } = makeApp();
    await app.request('/api/workflows/runs');

    const [[callArgs]] = mockListWorkflowRuns.mock.calls as [[{ limit?: number }]][];
    expect(callArgs?.limit).toBe(50);
  });

  test('returns 500 when DB throws', async () => {
    mockListWorkflowRuns.mockImplementationOnce(async () => {
      throw new Error('DB failure');
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs');
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Failed to list workflow runs');
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/workflows/runs/:runId
// ---------------------------------------------------------------------------

describe('GET /api/workflows/runs/:runId', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockListWorkflowEvents.mockReset();
    mockGetConversationById.mockReset();
    mockQueryUsageReport.mockReset();
    mockQueryUsageReport.mockImplementation(async (opts: { runId?: string } = {}) =>
      emptyUsageReport(opts.runId)
    );
    mockListPendingInteractions.mockReset();
    mockListPendingInteractions.mockImplementation(async () => []);
    mockGetUserById.mockReset();
    mockGetUserById.mockImplementation(async () => null);
  });

  test('returns run with events for a known runId', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => MOCK_EVENTS);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'web-conv-abc',
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      run: { id: string; workflow_name: string };
      events: Array<{ event_type: string }>;
      nodeStates: Array<{ nodeId: string; status: string }>;
    };
    expect(body.run.id).toBe('run-uuid-1');
    expect(body.run.workflow_name).toBe('deploy');
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBe(3);
    expect(body.events[0]?.event_type).toBe('step_started');
    expect(body.events[2]?.event_type).toBe('tool_called');
    expect(body.nodeStates).toEqual([]);
  });

  test('returns viewer and starter presentation', async () => {
    const starterId = 'user-starter-1';
    const cases: Array<{
      name: string;
      userId: string | null;
      header?: string;
      displayName: string | null;
      viewerIsStarter: boolean;
      starterDisplayName: string | null;
      expectLookup: boolean;
    }> = [
      {
        name: 'signed-in starter',
        userId: starterId,
        header: starterId,
        displayName: 'Avery',
        viewerIsStarter: true,
        starterDisplayName: 'Avery',
        expectLookup: true,
      },
      {
        name: 'signed-in teammate',
        userId: starterId,
        header: 'user-teammate-1',
        displayName: 'Avery',
        viewerIsStarter: false,
        starterDisplayName: 'Avery',
        expectLookup: true,
      },
      {
        name: 'unsigned viewer',
        userId: starterId,
        displayName: 'Avery',
        viewerIsStarter: false,
        starterDisplayName: 'Avery',
        expectLookup: true,
      },
      {
        name: 'starter with no display name',
        userId: starterId,
        header: starterId,
        displayName: null,
        viewerIsStarter: true,
        starterDisplayName: starterId,
        expectLookup: true,
      },
      {
        name: 'starter-less run',
        userId: null,
        header: 'user-anyone',
        displayName: 'Avery',
        viewerIsStarter: false,
        starterDisplayName: null,
        expectLookup: false,
      },
    ];

    for (const row of cases) {
      mockGetWorkflowRun.mockReset();
      mockListWorkflowEvents.mockReset();
      mockGetConversationById.mockReset();
      mockGetUserById.mockReset();
      mockGetUserById.mockImplementation(async () => null);

      mockGetWorkflowRun.mockImplementation(async () => ({
        ...MOCK_RUNNING_RUN,
        user_id: row.userId,
      }));
      mockListWorkflowEvents.mockImplementation(async () => []);
      mockGetConversationById.mockImplementation(async () => null);
      if (row.userId !== null) {
        mockGetUserById.mockImplementation(async (id: string) =>
          id === row.userId
            ? {
                id,
                display_name: row.displayName,
                email: null,
                role: 'admin' as const,
                created_at: new Date(),
                updated_at: new Date(),
              }
            : null
        );
      }

      const { app } = makeApp();
      const response = await app.request('/api/workflows/runs/run-uuid-1', {
        headers: row.header ? { 'X-Archon-User': row.header } : undefined,
      });
      expect(response.status, row.name).toBe(200);
      const body = (await response.json()) as {
        viewer_is_starter: boolean;
        starter_display_name: string | null;
      };
      expect(body.viewer_is_starter, row.name).toBe(row.viewerIsStarter);
      expect(body.starter_display_name, row.name).toBe(row.starterDisplayName);
      if (row.expectLookup) {
        expect(
          mockGetUserById.mock.calls.map(call => call[0]),
          row.name
        ).toEqual([row.userId]);
      } else {
        expect(mockGetUserById.mock.calls, row.name).toEqual([]);
      }
    }
  });

  test('projects later retry epoch completion as authoritative in nodeStates while preserving raw events', async () => {
    const events: MockWorkflowEvent[] = [
      {
        id: 'evt-b-old',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_failed',
        step_index: null,
        step_name: 'build',
        data: { error: 'old failure' },
        created_at: NOW,
      },
      {
        id: 'evt-retry',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_retry_requested',
        step_index: null,
        step_name: 'build',
        data: { node_id: 'build', retry_epoch: 1, invalidated_node_ids: ['build'] },
        created_at: NOW,
      },
      {
        id: 'evt-b-new',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'build',
        data: { node_id: 'build', retry_epoch: 1, duration_ms: 25, node_output: 'ok' },
        created_at: NOW,
      },
    ];
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => events);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'web-conv-abc',
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: MockWorkflowEvent[];
      nodeStates: Array<{ nodeId: string; status: string; retryEpoch: number; duration?: number }>;
    };

    expect(body.events).toHaveLength(3);
    expect(body.events[0]?.event_type).toBe('node_failed');
    expect(body.nodeStates).toEqual([
      { nodeId: 'build', name: 'build', status: 'completed', retryEpoch: 1, duration: 25 },
    ]);
  });

  test('preserves runtime AI metadata from node_started after later node completion', async () => {
    const events: MockWorkflowEvent[] = [
      {
        id: 'evt-start',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_started',
        step_index: null,
        step_name: 'create-story',
        data: {
          provider: 'codex',
          model: 'gpt-5.5',
          tier: 'large',
          modelReasoningEffort: 'xhigh',
        },
        created_at: NOW,
      },
      {
        id: 'evt-complete',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'create-story',
        data: { duration_ms: 1500, node_output: 'done' },
        created_at: NOW,
      },
    ];
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => events);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'web-conv-abc',
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      nodeStates: Array<{
        nodeId: string;
        status: string;
        provider?: string;
        model?: string;
        tier?: string;
        modelReasoningEffort?: string;
      }>;
    };

    expect(body.nodeStates).toEqual([
      expect.objectContaining({
        nodeId: 'create-story',
        status: 'completed',
        provider: 'codex',
        model: 'gpt-5.5',
        tier: 'large',
        modelReasoningEffort: 'xhigh',
      }),
    ]);
  });

  test('preserves Qoder max reasoning metadata from node_started', async () => {
    const events: MockWorkflowEvent[] = [
      {
        id: 'evt-start',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_started',
        step_index: null,
        step_name: 'create-story',
        data: {
          provider: 'qodercli',
          model: 'qoder-pro',
          tier: 'large',
          modelReasoningEffort: 'max',
        },
        created_at: NOW,
      },
    ];
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => events);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'web-conv-abc',
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      nodeStates: Array<{
        nodeId: string;
        modelReasoningEffort?: string;
      }>;
    };

    expect(body.nodeStates).toEqual([
      expect.objectContaining({
        nodeId: 'create-story',
        modelReasoningEffort: 'max',
      }),
    ]);
  });

  test('projects invalidated retry epoch nodes as pending before new lifecycle events arrive', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => [
      {
        id: 'evt-old',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'test',
        data: { node_output: 'old' },
        created_at: NOW,
      },
      {
        id: 'evt-retry',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_retry_requested',
        step_index: null,
        step_name: 'build',
        data: { node_id: 'build', retry_epoch: 2, invalidated_node_ids: ['build', 'test'] },
        created_at: NOW,
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      nodeStates: Array<{ nodeId: string; status: string; retryEpoch: number }>;
    };

    expect(body.nodeStates).toEqual([
      { nodeId: 'test', name: 'test', status: 'pending', retryEpoch: 2 },
      { nodeId: 'build', name: 'build', status: 'pending', retryEpoch: 2 },
    ]);
  });

  test('keeps older failed and skipped retry history visible when nodeStates uses the active retry epoch', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => [
      {
        id: 'evt-old-fail',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_failed',
        step_index: null,
        step_name: 'build',
        data: { error: 'old failure' },
        created_at: NOW,
      },
      {
        id: 'evt-old-skip',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_skipped',
        step_index: null,
        step_name: 'deploy',
        data: { reason: 'trigger_rule' },
        created_at: NOW,
      },
      {
        id: 'evt-retry',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_retry_requested',
        step_index: null,
        step_name: 'build',
        data: { node_id: 'build', retry_epoch: 1, invalidated_node_ids: ['build'] },
        created_at: NOW,
      },
      {
        id: 'evt-new-start',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_started',
        step_index: null,
        step_name: 'build',
        data: { retry_epoch: 1 },
        created_at: NOW,
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: MockWorkflowEvent[];
      nodeStates: Array<{ nodeId: string; status: string; retryEpoch: number }>;
    };

    expect(body.events.map(event => event.event_type)).toEqual([
      'node_failed',
      'node_skipped',
      'node_retry_requested',
      'node_started',
    ]);
    expect(body.nodeStates).toEqual([
      { nodeId: 'build', name: 'build', status: 'running', retryEpoch: 1 },
      {
        nodeId: 'deploy',
        name: 'deploy',
        status: 'skipped',
        retryEpoch: 0,
        reason: 'trigger_rule',
      },
    ]);
  });

  test('does not project running nodeStates for cancelled runs with incomplete node history', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      status: 'cancelled',
      completed_at: NOW,
    }));
    mockListWorkflowEvents.mockImplementationOnce(async () => [
      {
        id: 'evt-prepare-start',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_started',
        step_index: null,
        step_name: 'prepare',
        data: {},
        created_at: NOW,
      },
      {
        id: 'evt-prepare-done',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'prepare',
        data: { duration_ms: 13 },
        created_at: NOW,
      },
      {
        id: 'evt-dev-story-start',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_started',
        step_index: null,
        step_name: 'dev-story',
        data: { provider: 'codex' },
        created_at: NOW,
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      run: { status: string };
      nodeStates: Array<{
        nodeId: string;
        status: string;
        retryEpoch: number;
        provider?: string;
        error?: string;
      }>;
    };

    expect(body.run.status).toBe('cancelled');
    expect(body.nodeStates).toEqual([
      { nodeId: 'prepare', name: 'prepare', status: 'completed', retryEpoch: 0, duration: 13 },
      {
        nodeId: 'dev-story',
        name: 'dev-story',
        status: 'failed',
        retryEpoch: 0,
        provider: 'codex',
        error: 'Cancelled by user',
      },
    ]);
  });

  test('returns route-loop decisions and latest route output while preserving historical attempts', async () => {
    const negativeDecision = {
      sources: ['review'],
      outcome: 'negative',
      to: 'fix',
      condition: "$review.output.result == '<redacted>'",
      condition_result: false,
      negative_count: 1,
      max_iterations: 10,
      attempt: 1,
      execution_seq: 3,
    } satisfies Record<string, unknown>;
    const positiveDecision = {
      sources: ['review'],
      outcome: 'positive',
      to: 'done',
      condition: "$review.output.result == '<redacted>'",
      condition_result: true,
      negative_count: 1,
      max_iterations: 10,
      attempt: 2,
      execution_seq: 6,
    } satisfies Record<string, unknown>;
    const events: MockWorkflowEvent[] = [
      {
        id: 'evt-fix-1',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'fix',
        data: { node_id: 'fix', node_output: 'fix attempt 1', attempt: 1, execution_seq: 1 },
        created_at: NOW,
      },
      {
        id: 'evt-review-1',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'review',
        data: {
          node_id: 'review',
          node_output: '{"result":"negative"}',
          attempt: 1,
          execution_seq: 2,
        },
        created_at: NOW,
      },
      {
        id: 'evt-route-negative',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_routed',
        step_index: null,
        step_name: 'review-router',
        data: negativeDecision,
        created_at: NOW,
      },
      {
        id: 'evt-router-output-negative',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'review-router',
        data: {
          node_id: 'review-router',
          node_output: JSON.stringify(negativeDecision),
          structured_output: negativeDecision,
          attempt: 1,
          execution_seq: 3,
          duration_ms: 0,
        },
        created_at: NOW,
      },
      {
        id: 'evt-fix-2',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'fix',
        data: { node_id: 'fix', node_output: 'fix attempt 2', attempt: 2, execution_seq: 4 },
        created_at: NOW,
      },
      {
        id: 'evt-review-2',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'review',
        data: {
          node_id: 'review',
          node_output: '{"result":"positive"}',
          attempt: 2,
          execution_seq: 5,
        },
        created_at: NOW,
      },
      {
        id: 'evt-route-positive',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_routed',
        step_index: null,
        step_name: 'review-router',
        data: positiveDecision,
        created_at: NOW,
      },
      {
        id: 'evt-router-output-positive',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'review-router',
        data: {
          node_id: 'review-router',
          node_output: JSON.stringify(positiveDecision),
          structured_output: positiveDecision,
          attempt: 2,
          execution_seq: 6,
          duration_ms: 0,
        },
        created_at: NOW,
      },
      {
        id: 'evt-done',
        workflow_run_id: 'run-uuid-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'done',
        data: { node_id: 'done', node_output: 'done', attempt: 1, execution_seq: 7 },
        created_at: NOW,
      },
    ];

    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => events);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: MockWorkflowEvent[];
      nodeStates: Array<{ nodeId: string; status: string; retryEpoch: number; duration?: number }>;
    };

    const routedEvents = body.events.filter(event => event.event_type === 'node_routed');
    expect(routedEvents.map(event => event.data)).toEqual([negativeDecision, positiveDecision]);
    expect(routedEvents.map(event => event.data.attempt)).toEqual([1, 2]);
    expect(routedEvents.map(event => event.data.execution_seq)).toEqual([3, 6]);

    const reviewAttempts = body.events.filter(
      event => event.event_type === 'node_completed' && event.step_name === 'review'
    );
    expect(reviewAttempts.map(event => event.data.attempt)).toEqual([1, 2]);
    expect(reviewAttempts.map(event => event.data.node_output)).toEqual([
      '{"result":"negative"}',
      '{"result":"positive"}',
    ]);

    const routeOutputs = body.events.filter(
      event => event.event_type === 'node_completed' && event.step_name === 'review-router'
    );
    expect(routeOutputs.map(event => event.data.attempt)).toEqual([1, 2]);
    const latestRouteOutput = routeOutputs[routeOutputs.length - 1]?.data.node_output;
    expect(typeof latestRouteOutput).toBe('string');
    expect(JSON.parse(latestRouteOutput as string) as Record<string, unknown>).toEqual(
      positiveDecision
    );

    expect(body.nodeStates).toEqual(
      expect.arrayContaining([
        { nodeId: 'fix', name: 'fix', status: 'completed', retryEpoch: 0 },
        { nodeId: 'review', name: 'review', status: 'completed', retryEpoch: 0 },
        {
          nodeId: 'review-router',
          name: 'review-router',
          status: 'completed',
          retryEpoch: 0,
          duration: 0,
        },
        { nodeId: 'done', name: 'done', status: 'completed', retryEpoch: 0 },
      ])
    );
    expect(body.nodeStates).toHaveLength(4);
  });

  test('returns 404 when run not found', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => null);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/unknown-run-id');
    expect(response.status).toBe(404);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  test('includes conversation_platform_id for CLI runs (no parent_conversation_id)', async () => {
    // CLI run: conversation_id set, no parent_conversation_id
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      parent_conversation_id: null,
    }));
    mockListWorkflowEvents.mockImplementationOnce(async () => []);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'cli-conv-xyz',
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      run: {
        conversation_platform_id: string | null;
        worker_platform_id: string | undefined;
      };
    };
    // CLI run: conversation_platform_id should be set, worker_platform_id should be undefined
    expect(body.run.conversation_platform_id).toBe('cli-conv-xyz');
    expect(body.run.worker_platform_id).toBeUndefined();
  });

  test('includes worker_platform_id for web runs (with parent_conversation_id)', async () => {
    // Web run: conversation_id is the worker, parent_conversation_id is the parent
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      parent_conversation_id: 'parent-conv-uuid',
    }));
    mockListWorkflowEvents.mockImplementationOnce(async () => []);
    // First call: worker conversation
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'worker-platform-id',
    }));
    // Second call: parent conversation
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'parent-platform-id',
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      run: {
        worker_platform_id: string | undefined;
        parent_platform_id: string | undefined;
        conversation_platform_id: string | null;
      };
    };
    expect(body.run.worker_platform_id).toBe('worker-platform-id');
    expect(body.run.parent_platform_id).toBe('parent-platform-id');
  });

  test('returns run with null conversation fields when no conversation_id', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      conversation_id: null,
      parent_conversation_id: null,
    }));
    mockListWorkflowEvents.mockImplementationOnce(async () => []);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      run: { conversation_platform_id: null };
    };
    expect(body.run.conversation_platform_id).toBeNull();
  });

  test('returns 500 when DB throws', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => {
      throw new Error('DB timeout');
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Failed to get workflow run');
  });

  test('includes empty direct-run usage with hasRecordedUsage false for old runs', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => []);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'web-conv-abc',
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      usage: {
        scope: {
          runId?: string;
          from: string | null;
          to: string | null;
          includesChildRollup: boolean;
        };
        groupBy: string;
        coverage: { hasRecordedUsage: boolean };
      } | null;
    };
    expect(body.usage).not.toBeNull();
    expect(body.usage?.groupBy).toBe('node');
    expect(body.usage?.scope.runId).toBe('run-uuid-1');
    expect(body.usage?.scope.from).toBeNull();
    expect(body.usage?.scope.to).toBeNull();
    expect(body.usage?.scope.includesChildRollup).toBe(false);
    expect(body.usage?.coverage.hasRecordedUsage).toBe(false);

    const [[callArgs]] = mockQueryUsageReport.mock.calls as [
      [{ runId?: string; groupBy?: string }],
    ][];
    expect(callArgs).toEqual({ runId: 'run-uuid-1', groupBy: 'node' });
  });

  test('returns usage null when usage query fails without failing run detail', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => MOCK_EVENTS);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'web-conv-abc',
    }));
    mockQueryUsageReport.mockImplementationOnce(async () => {
      throw new MockUsageReportQueryError('query_failed', 'ledger unavailable');
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      run: { id: string };
      events: unknown[];
      usage: null;
    };
    expect(body.run.id).toBe('run-uuid-1');
    expect(body.events).toHaveLength(3);
    expect(body.usage).toBeNull();
  });

  test('OpenAPI marks run-detail usage via NullableUsageReport without contaminating UsageReport', async () => {
    const { app } = makeApp();
    const document = app.getOpenAPIDocument({
      openapi: '3.0.0',
      info: { title: 'test', version: '0' },
    });

    const detail = document.components?.schemas?.WorkflowRunDetail as
      | {
          properties?: {
            usage?: { $ref?: string; nullable?: boolean };
          };
        }
      | undefined;
    expect(detail?.properties?.usage?.$ref).toBe('#/components/schemas/NullableUsageReport');

    const usageReport = document.components?.schemas?.UsageReport as
      | { type?: string; nullable?: boolean }
      | undefined;
    expect(usageReport?.type).toBe('object');
    expect(usageReport?.nullable).toBeUndefined();

    const nullable = document.components?.schemas?.NullableUsageReport as
      | { type?: string; nullable?: boolean }
      | undefined;
    expect(nullable?.nullable).toBe(true);
    expect(nullable).not.toEqual(usageReport);
  });

  test('serializes listed pending_interactions with ISO timestamps and null resolved_at', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListWorkflowEvents.mockImplementationOnce(async () => MOCK_EVENTS);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'web-conv-abc',
    }));
    mockListPendingInteractions.mockImplementationOnce(async () => [
      {
        id: 'pend-open',
        workflow_run_id: 'run-uuid-1',
        node_id: 'review',
        tool_use_id: 'toolu_open',
        kind: 'ask',
        status: 'pending',
        envelope: { questions: [{ prompt: 'Need a decision' }] },
        answer: null,
        provider_session_id: 'sess-1',
        created_at: new Date('2026-09-06T00:00:00.000Z'),
        resolved_at: null,
        resolved_by: null,
      },
      {
        id: 'pend-done',
        workflow_run_id: 'run-uuid-1',
        node_id: 'review',
        tool_use_id: 'toolu_done',
        kind: 'ask',
        status: 'answered',
        envelope: { questions: [{ prompt: 'Already answered' }] },
        answer: { answers: ['ship it'] },
        provider_session_id: 'sess-1',
        created_at: '2026-09-06T00:00:01.000Z',
        resolved_at: new Date('2026-09-06T00:01:00.000Z'),
        resolved_by: 'user-1',
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { pending_interactions: unknown[] };
    expect(mockListPendingInteractions).toHaveBeenCalledWith('run-uuid-1');
    expect(body.pending_interactions).toEqual([
      {
        id: 'pend-open',
        workflow_run_id: 'run-uuid-1',
        node_id: 'review',
        tool_use_id: 'toolu_open',
        kind: 'ask',
        status: 'pending',
        envelope: { questions: [{ prompt: 'Need a decision' }] },
        answer: null,
        provider_session_id: 'sess-1',
        created_at: '2026-09-06T00:00:00.000Z',
        resolved_at: null,
        resolved_by: null,
      },
      {
        id: 'pend-done',
        workflow_run_id: 'run-uuid-1',
        node_id: 'review',
        tool_use_id: 'toolu_done',
        kind: 'ask',
        status: 'answered',
        envelope: { questions: [{ prompt: 'Already answered' }] },
        answer: { answers: ['ship it'] },
        provider_session_id: 'sess-1',
        created_at: '2026-09-06T00:00:01.000Z',
        resolved_at: '2026-09-06T00:01:00.000Z',
        resolved_by: 'user-1',
      },
    ]);
  });

  test('projects awaiting from a pending row on a paused run without rewriting to paused or running', async () => {
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
    ]);
    mockGetConversationById.mockImplementationOnce(async () => ({
      id: 'conv-uuid-1',
      platform_conversation_id: 'web-conv-abc',
    }));
    mockListPendingInteractions.mockImplementationOnce(async () => [
      {
        id: 'pend-review',
        workflow_run_id: 'run-uuid-1',
        node_id: 'review',
        tool_use_id: 'toolu_1',
        kind: 'ask',
        status: 'pending',
        envelope: { questions: [{ prompt: 'Need a decision' }] },
        answer: null,
        provider_session_id: 'sess-1',
        created_at: '2026-09-06T00:00:00.000Z',
        resolved_at: null,
        resolved_by: null,
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      run: { status: string };
      nodeStates: Array<{ nodeId: string; status: string; retryEpoch: number; provider?: string }>;
    };
    expect(body.run.status).toBe('paused');
    expect(body.nodeStates).toEqual([
      { nodeId: 'review', name: 'review', status: 'awaiting', retryEpoch: 0, provider: 'claude' },
    ]);
  });

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
});

// ---------------------------------------------------------------------------
// Tests: GET /api/workflows/runs/:runId/nodes/:nodeId/messages
// ---------------------------------------------------------------------------

describe('GET /api/workflows/runs/:runId/nodes/:nodeId/messages', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockListNodeMessages.mockReset();
    mockGetNodeMessage.mockReset();
    mockGetNodeMessageHighWatermark.mockReset();
    mockApiLogError.mockReset();
    mockApiLogWarn.mockReset();
    mockGetUserDisplayNamesByIds.mockReset();
    mockGetUserDisplayNamesByIds.mockImplementation(async () => []);
    mockListNodeMessages.mockImplementation(async () => []);
    mockGetNodeMessage.mockImplementation(async () => null);
    mockGetNodeMessageHighWatermark.mockImplementation(async () => 0);
    mockListPendingInteractions.mockReset();
    mockListPendingInteractions.mockImplementation(async () => []);
  });

  test('returns 404 for a missing run without listing messages', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => null);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/unknown-run-id/nodes/plan/messages');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('not found');
    expect(mockListNodeMessages).not.toHaveBeenCalled();
  });

  test('returns an empty messages array for an existing run with no rows', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListNodeMessages.mockImplementationOnce(async () => []);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/plan/messages');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { messages: unknown[] };
    expect(body).toEqual({ messages: [] });
    expect(mockListNodeMessages).toHaveBeenCalledTimes(1);
    expect(mockListNodeMessages.mock.calls[0]).toEqual(['run-uuid-1', 'plan']);
  });

  test('returns literal text, tool, and status rows in DB sequence without identity columns', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListNodeMessages.mockImplementationOnce(async () => [
      {
        id: 'msg-text',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 1,
        kind: 'text',
        payload: { text: 'hello' },
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'msg-tool',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 2,
        kind: 'tool',
        payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
        created_at: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'msg-status',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 3,
        kind: 'status',
        payload: { state: 'completed' },
        created_at: '2026-01-01T00:00:02.000Z',
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/plan/messages');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages).toEqual([
      {
        id: 'msg-text',
        seq: 1,
        kind: 'text',
        payload: { text: 'hello' },
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'msg-tool',
        seq: 2,
        kind: 'tool',
        payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
        created_at: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'msg-status',
        seq: 3,
        kind: 'status',
        payload: { state: 'completed' },
        created_at: '2026-01-01T00:00:02.000Z',
      },
    ]);
    expect(body.messages.every(row => !('workflow_run_id' in row))).toBe(true);
    expect(body.messages.every(row => !('node_id' in row))).toBe(true);
  });

  test('converts Date created_at to ISO while leaving string timestamps unchanged', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListNodeMessages.mockImplementationOnce(async () => [
      {
        id: 'msg-date',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 1,
        kind: 'text',
        payload: { text: 'from-date' },
        created_at: new Date('2026-03-04T05:06:07.000Z'),
      },
      {
        id: 'msg-string',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 2,
        kind: 'text',
        payload: { text: 'from-string' },
        created_at: '2026-03-04T05:06:08.000Z',
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/plan/messages');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ created_at: string }>;
    };
    expect(body.messages.map(row => row.created_at)).toEqual([
      '2026-03-04T05:06:07.000Z',
      '2026-03-04T05:06:08.000Z',
    ]);
  });

  test('returns a safe 500 without embedding transcript payload or error text', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListNodeMessages.mockImplementationOnce(async () => {
      throw new Error('DO_NOT_LOG transcript payload {"text":"secret-row"}');
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/plan/messages');
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'Failed to list workflow node messages' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('DO_NOT_LOG');
    expect(serialized).not.toContain('secret-row');

    const listFailed = mockApiLogError.mock.calls.find(
      call => call[1] === 'workflow_node_messages_list_failed'
    );
    expect(listFailed).toBeDefined();
    expect(listFailed?.[0]).toEqual({
      runId: 'run-uuid-1',
      nodeId: 'plan',
      errorType: 'Error',
    });
    const logged = JSON.stringify(listFailed);
    expect(logged).not.toContain('DO_NOT_LOG');
    expect(logged).not.toContain('secret-row');
  });

  test('never puts Ask envelopes into status message payloads', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListPendingInteractions.mockImplementationOnce(async () => [
      {
        id: 'pend-review',
        workflow_run_id: 'run-uuid-1',
        node_id: 'review',
        tool_use_id: 'toolu_1',
        kind: 'ask',
        status: 'pending',
        envelope: { questions: [{ prompt: 'secret-ask-envelope' }] },
        answer: null,
        provider_session_id: 'sess-1',
        created_at: '2026-09-06T00:00:00.000Z',
        resolved_at: null,
        resolved_by: null,
      },
    ]);
    mockListNodeMessages.mockImplementationOnce(async () => [
      {
        id: 'msg-status',
        workflow_run_id: 'run-uuid-1',
        node_id: 'review',
        seq: 1,
        kind: 'status',
        payload: { state: 'awaiting' },
        created_at: '2026-09-06T00:00:02.000Z',
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/review/messages');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
    expect(body.messages).toEqual([
      {
        id: 'msg-status',
        seq: 1,
        kind: 'status',
        payload: { state: 'awaiting' },
        created_at: '2026-09-06T00:00:02.000Z',
      },
    ]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('secret-ask-envelope');
    expect(serialized).not.toContain('questions');
    expect(serialized).not.toContain('envelope');
    expect(body.messages[0]?.payload.envelope).toBeUndefined();
    expect(body.messages[0]?.payload.questions).toBeUndefined();
  });

  test('no-query response is exactly { messages } with row metadata and no paging keys', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListNodeMessages.mockImplementationOnce(async () => [
      {
        id: 'msg-meta',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 1,
        kind: 'text',
        payload: { text: 'hello' },
        created_at: '2026-01-01T00:00:00.000Z',
        metadata: { stream_id: 'stream-1' },
      },
    ]);

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/plan/messages');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['messages']);
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.metadata).toEqual({ stream_id: 'stream-1' });
    expect(body).not.toHaveProperty('nextCursor');
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('highWatermark');
    expect(mockListNodeMessages.mock.calls[0]).toEqual(['run-uuid-1', 'plan']);
  });

  test('cursor mode marks truncated tool output without writing it back', async () => {
    const fullOutput = 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 200_000);
    const storedMetadata = { stream_id: 'stream-1' };
    const storedRow: MockNodeMessageRow = {
      id: 'msg-long',
      workflow_run_id: 'run-uuid-1',
      node_id: 'plan',
      seq: 1,
      kind: 'tool',
      payload: {
        name: 'Read',
        id: 'tool-1',
        input: { path: 'big.txt' },
        output: fullOutput,
      },
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: storedMetadata,
    };
    mockGetWorkflowRun.mockImplementation(async () => MOCK_RUNNING_RUN);
    mockGetNodeMessageHighWatermark.mockImplementationOnce(async () => 1);
    mockListNodeMessages.mockImplementationOnce(async () => [storedRow]);
    mockGetNodeMessage.mockImplementationOnce(async () => storedRow);

    const { app } = makeApp();
    const listResponse = await app.request(
      '/api/workflows/runs/run-uuid-1/nodes/plan/messages?limit=1'
    );
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as {
      messages: Array<{ payload: { output?: string }; metadata?: Record<string, unknown> }>;
    };
    const listOutput = listBody.messages[0]?.payload.output ?? '';
    expect(listOutput.length).toBeLessThan(fullOutput.length);
    expect(listBody.messages[0]?.metadata).toEqual({
      stream_id: 'stream-1',
      truncated: true,
      output_state: 'truncated',
      full_output_available: true,
    });
    expect(storedMetadata).toEqual({ stream_id: 'stream-1' });
    expect(storedRow.payload.output).toBe(fullOutput);

    const detailResponse = await app.request(
      '/api/workflows/runs/run-uuid-1/nodes/plan/messages/msg-long'
    );
    expect(detailResponse.status).toBe(200);
    const detailBody = (await detailResponse.json()) as {
      payload: { output?: string };
      metadata?: Record<string, unknown>;
    };
    expect(detailBody.payload.output).toBe(fullOutput);
    expect(detailBody.metadata).toEqual({ stream_id: 'stream-1' });
  });

  test('cursor mode returns metadata, nextCursor, hasMore, and highWatermark', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    const queryOrder: string[] = [];
    mockGetNodeMessageHighWatermark.mockImplementationOnce(async () => {
      queryOrder.push('watermark');
      return 3;
    });
    mockListNodeMessages.mockImplementationOnce(async () => {
      queryOrder.push('list');
      return [
        {
          id: 'msg-1',
          workflow_run_id: 'run-uuid-1',
          node_id: 'plan',
          seq: 1,
          kind: 'tool',
          payload: {
            name: 'Read',
            id: 'tool-1',
            input: { path: 'a.ts' },
            output: 'HITL_TOOL_OUTPUT',
          },
          created_at: '2026-01-01T00:00:00.000Z',
          metadata: {
            execution: {
              occurrence_id: '11111111-1111-4111-8111-111111111111',
              attempt_id: '22222222-2222-4222-8222-222222222222',
              retry_epoch: 0,
            },
            tool_phase: 'result',
          },
        },
        {
          id: 'msg-2',
          workflow_run_id: 'run-uuid-1',
          node_id: 'plan',
          seq: 2,
          kind: 'text',
          payload: { text: 'next' },
          created_at: '2026-01-01T00:00:01.000Z',
        },
      ];
    });

    const { app } = makeApp();
    const response = await app.request(
      '/api/workflows/runs/run-uuid-1/nodes/plan/messages?limit=1&afterSeq=0'
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<Record<string, unknown>>;
      nextCursor?: string;
      hasMore?: boolean;
      highWatermark?: number;
    };
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('1');
    expect(body.highWatermark).toBe(3);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.metadata).toEqual({
      execution: {
        occurrence_id: '11111111-1111-4111-8111-111111111111',
        attempt_id: '22222222-2222-4222-8222-222222222222',
        retry_epoch: 0,
      },
      tool_phase: 'result',
    });
    expect(mockListNodeMessages.mock.calls[0]?.[2]).toEqual({
      afterSeq: 0,
      limit: 2,
      throughSeq: 3,
    });
    expect(queryOrder).toEqual(['watermark', 'list']);
  });

  test('rejects invalid cursor limit and afterSeq with 400 and does not list rows', async () => {
    mockGetWorkflowRun.mockImplementation(async () => MOCK_RUNNING_RUN);
    const { app } = makeApp();

    const overLimit = await app.request(
      '/api/workflows/runs/run-uuid-1/nodes/plan/messages?limit=501'
    );
    expect(overLimit.status).toBe(400);
    const overBody = (await overLimit.json()) as { error: string };
    expect(overBody.error.toLowerCase()).toContain('limit');

    const negative = await app.request(
      '/api/workflows/runs/run-uuid-1/nodes/plan/messages?afterSeq=-1'
    );
    expect(negative.status).toBe(400);
    const negativeBody = (await negative.json()) as { error: string };
    expect(negativeBody.error.toLowerCase()).toContain('afterseq');

    const badUuid = await app.request(
      '/api/workflows/runs/run-uuid-1/nodes/plan/messages?occurrenceId=not-a-uuid'
    );
    expect(badUuid.status).toBe(400);

    expect(mockListNodeMessages).not.toHaveBeenCalled();
  });

  test('trims operator display names and falls back to short ids', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListNodeMessages.mockImplementationOnce(async () => [
      {
        id: 'msg-named',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 1,
        kind: 'text',
        payload: { text: 'named guidance' },
        created_at: '2026-01-01T00:00:00.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-alice-long',
          message_id: 'caller-msg-1',
        },
      },
      {
        id: 'msg-blank',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 2,
        kind: 'text',
        payload: { text: 'blank name guidance' },
        created_at: '2026-01-01T00:00:01.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-blank-name',
          message_id: 'caller-msg-2',
        },
      },
      {
        id: 'msg-missing',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 3,
        kind: 'text',
        payload: { text: 'missing user guidance' },
        created_at: '2026-01-01T00:00:02.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-missing-1',
          message_id: 'caller-msg-3',
        },
      },
      {
        id: 'msg-null-identity',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 4,
        kind: 'text',
        payload: { text: 'identity-less guidance' },
        created_at: '2026-01-01T00:00:03.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: null,
          message_id: 'caller-msg-4',
        },
      },
      {
        id: 'msg-assistant',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 5,
        kind: 'text',
        payload: { text: 'assistant prose' },
        created_at: '2026-01-01T00:00:04.000Z',
        metadata: { stream_id: 'stream-1' },
      },
      {
        id: 'msg-tool',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 6,
        kind: 'tool',
        payload: { name: 'Read', id: 'tool-1' },
        created_at: '2026-01-01T00:00:05.000Z',
      },
    ]);
    mockGetUserDisplayNamesByIds.mockImplementationOnce(async ids => {
      expect([...ids].sort()).toEqual(
        ['user-alice-long', 'user-blank-name', 'user-missing-1'].sort()
      );
      return [
        { id: 'user-alice-long', display_name: '  Alice  ' },
        { id: 'user-blank-name', display_name: '   ' },
      ];
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/plan/messages');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages).toEqual([
      {
        id: 'msg-named',
        seq: 1,
        kind: 'text',
        payload: { text: 'named guidance' },
        created_at: '2026-01-01T00:00:00.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-alice-long',
          message_id: 'caller-msg-1',
        },
        operator_display_name: 'Alice',
      },
      {
        id: 'msg-blank',
        seq: 2,
        kind: 'text',
        payload: { text: 'blank name guidance' },
        created_at: '2026-01-01T00:00:01.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-blank-name',
          message_id: 'caller-msg-2',
        },
        operator_display_name: 'user-bla',
      },
      {
        id: 'msg-missing',
        seq: 3,
        kind: 'text',
        payload: { text: 'missing user guidance' },
        created_at: '2026-01-01T00:00:02.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-missing-1',
          message_id: 'caller-msg-3',
        },
        operator_display_name: 'user-mis',
      },
      {
        id: 'msg-null-identity',
        seq: 4,
        kind: 'text',
        payload: { text: 'identity-less guidance' },
        created_at: '2026-01-01T00:00:03.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: null,
          message_id: 'caller-msg-4',
        },
        operator_display_name: null,
      },
      {
        id: 'msg-assistant',
        seq: 5,
        kind: 'text',
        payload: { text: 'assistant prose' },
        created_at: '2026-01-01T00:00:04.000Z',
        metadata: { stream_id: 'stream-1' },
      },
      {
        id: 'msg-tool',
        seq: 6,
        kind: 'tool',
        payload: { name: 'Read', id: 'tool-1' },
        created_at: '2026-01-01T00:00:05.000Z',
      },
    ]);
    expect(mockGetUserDisplayNamesByIds).toHaveBeenCalledTimes(1);
  });

  test('batches two distinct sender ids across three operator rows once', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListNodeMessages.mockImplementationOnce(async () => [
      {
        id: 'msg-a1',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 1,
        kind: 'text',
        payload: { text: 'a1' },
        created_at: '2026-01-01T00:00:00.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-a',
          message_id: 'm1',
        },
      },
      {
        id: 'msg-b1',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 2,
        kind: 'text',
        payload: { text: 'b1' },
        created_at: '2026-01-01T00:00:01.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-b',
          message_id: 'm2',
        },
      },
      {
        id: 'msg-a2',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 3,
        kind: 'text',
        payload: { text: 'a2' },
        created_at: '2026-01-01T00:00:02.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-a',
          message_id: 'm3',
        },
      },
    ]);
    mockGetUserDisplayNamesByIds.mockImplementationOnce(async ids => {
      expect([...ids].sort()).toEqual(['user-a', 'user-b']);
      return [
        { id: 'user-a', display_name: 'A' },
        { id: 'user-b', display_name: 'B' },
      ];
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/plan/messages');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ operator_display_name?: string | null }>;
    };
    expect(body.messages.map(row => row.operator_display_name)).toEqual(['A', 'B', 'A']);
    expect(mockGetUserDisplayNamesByIds).toHaveBeenCalledTimes(1);
  });

  test('cursor mode excludes overflow row from operator name lookup', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockGetNodeMessageHighWatermark.mockImplementationOnce(async () => 3);
    mockListNodeMessages.mockImplementationOnce(async () => [
      {
        id: 'msg-page',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 1,
        kind: 'text',
        payload: { text: 'on page' },
        created_at: '2026-01-01T00:00:00.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-page',
          message_id: 'm-page',
        },
      },
      {
        id: 'msg-overflow',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 2,
        kind: 'text',
        payload: { text: 'overflow only' },
        created_at: '2026-01-01T00:00:01.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-overflow',
          message_id: 'm-overflow',
        },
      },
    ]);
    mockGetUserDisplayNamesByIds.mockImplementationOnce(async ids => {
      expect(ids).toEqual(['user-page']);
      return [{ id: 'user-page', display_name: 'Page User' }];
    });

    const { app } = makeApp();
    const response = await app.request(
      '/api/workflows/runs/run-uuid-1/nodes/plan/messages?limit=1&afterSeq=0'
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<Record<string, unknown>>;
      hasMore?: boolean;
    };
    expect(body.hasMore).toBe(true);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.operator_display_name).toBe('Page User');
    expect(mockGetUserDisplayNamesByIds).toHaveBeenCalledTimes(1);
    expect(mockGetUserDisplayNamesByIds.mock.calls[0]?.[0]).toEqual(['user-page']);
  });

  test('detail route projects operator display name', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockGetNodeMessage.mockImplementationOnce(async () => ({
      id: 'msg-detail',
      workflow_run_id: 'run-uuid-1',
      node_id: 'plan',
      seq: 9,
      kind: 'text',
      payload: { text: 'detail guidance' },
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        origin: 'operator',
        operator_user_id: 'user-detail-1',
        message_id: 'caller-detail',
      },
    }));
    mockGetUserDisplayNamesByIds.mockImplementationOnce(async ids => {
      expect(ids).toEqual(['user-detail-1']);
      return [{ id: 'user-detail-1', display_name: 'Detail Operator' }];
    });

    const { app } = makeApp();
    const response = await app.request(
      '/api/workflows/runs/run-uuid-1/nodes/plan/messages/msg-detail'
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      id: 'msg-detail',
      seq: 9,
      kind: 'text',
      payload: { text: 'detail guidance' },
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        origin: 'operator',
        operator_user_id: 'user-detail-1',
        message_id: 'caller-detail',
      },
      operator_display_name: 'Detail Operator',
    });
    expect(mockGetUserDisplayNamesByIds).toHaveBeenCalledTimes(1);
  });

  test('lookup rejection still returns 200 with short-id fallback and one safe warning', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => MOCK_RUNNING_RUN);
    mockListNodeMessages.mockImplementationOnce(async () => [
      {
        id: 'msg-fail',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 1,
        kind: 'text',
        payload: { text: 'secret-operator-body' },
        created_at: '2026-01-01T00:00:00.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-fail-abc',
          message_id: 'caller-fail',
        },
      },
      {
        id: 'msg-fail-2',
        workflow_run_id: 'run-uuid-1',
        node_id: 'plan',
        seq: 2,
        kind: 'text',
        payload: { text: 'second' },
        created_at: '2026-01-01T00:00:01.000Z',
        metadata: {
          origin: 'operator',
          operator_user_id: 'user-fail-xyz',
          message_id: 'caller-fail-2',
        },
      },
    ]);
    mockGetUserDisplayNamesByIds.mockImplementationOnce(async () => {
      throw new Error('DO_NOT_LOG db failure with secret-operator-body');
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/nodes/plan/messages');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ operator_display_name?: string | null }>;
    };
    expect(body.messages.map(row => row.operator_display_name)).toEqual(['user-fai', 'user-fai']);

    expect(mockApiLogWarn).toHaveBeenCalledTimes(1);
    expect(mockApiLogWarn.mock.calls[0]?.[1]).toBe('workflow_node_operator_names_lookup_failed');
    expect(mockApiLogWarn.mock.calls[0]?.[0]).toEqual({
      runId: 'run-uuid-1',
      nodeId: 'plan',
      distinctSenderCount: 2,
      errorType: 'Error',
    });
    const logged = JSON.stringify(mockApiLogWarn.mock.calls);
    expect(logged).not.toContain('DO_NOT_LOG');
    expect(logged).not.toContain('secret-operator-body');
    expect(logged).not.toContain('user-fail-abc');
    expect(logged).not.toContain('user-fail-xyz');
  });

  test('OpenAPI documents the nested messages path and required pending_interactions', async () => {
    const { app } = makeApp();
    const document = app.getOpenAPIDocument({
      openapi: '3.0.0',
      info: { title: 'test', version: '0' },
    });

    const pathItem = document.paths?.['/api/workflows/runs/{runId}/nodes/{nodeId}/messages'];
    expect(pathItem?.get).toBeDefined();
    const okSchema = pathItem?.get?.responses?.['200']?.content?.['application/json']?.schema as
      | { $ref?: string }
      | undefined;
    expect(okSchema?.$ref).toBe('#/components/schemas/WorkflowNodeMessagesResponse');
    expect(pathItem?.get?.responses?.['404']).toBeDefined();
    expect(pathItem?.get?.responses?.['500']).toBeDefined();

    const detail = document.components?.schemas?.WorkflowRunDetail as
      | {
          required?: string[];
          properties?: {
            pending_interactions?: { items?: { $ref?: string }; type?: string };
            viewer_is_starter?: { type?: string };
            starter_display_name?: { type?: string; nullable?: boolean };
          };
        }
      | undefined;
    expect(detail?.required).toContain('pending_interactions');
    expect(detail?.required).toContain('viewer_is_starter');
    expect(detail?.required).toContain('starter_display_name');
    expect(detail?.properties?.pending_interactions?.items?.$ref).toBe(
      '#/components/schemas/PendingInteraction'
    );
    expect(detail?.properties?.viewer_is_starter).toEqual({ type: 'boolean' });
    expect(detail?.properties?.starter_display_name?.type).toBe('string');
    expect(detail?.properties?.starter_display_name?.nullable).toBe(true);

    const nodeState = document.components?.schemas?.WorkflowNodeState as
      | { properties?: { status?: { enum?: string[] } } }
      | undefined;
    expect(nodeState?.properties?.status?.enum).toEqual([
      'pending',
      'running',
      'completed',
      'failed',
      'skipped',
      'awaiting',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/dashboard/runs
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/runs', () => {
  beforeEach(() => {
    mockListDashboardRuns.mockReset();
  });

  test('returns paginated runs with total and counts', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [MOCK_RUNNING_RUN, MOCK_COMPLETED_RUN],
      total: 2,
      counts: { all: 5, running: 1, completed: 2, failed: 1, cancelled: 1, pending: 0 },
    }));

    const { app } = makeApp();
    const response = await app.request('/api/dashboard/runs');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      runs: unknown[];
      total: number;
      counts: { all: number };
    };
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.length).toBe(2);
    expect(body.total).toBe(2);
    expect(body.counts.all).toBe(5);
  });

  test('filters by status query param', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
    }));

    const { app } = makeApp();
    await app.request('/api/dashboard/runs?status=running');

    const [[callArgs]] = mockListDashboardRuns.mock.calls as [[{ status?: string }]][];
    expect(callArgs?.status).toBe('running');
  });

  test('accepts paused as valid status', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
    }));

    const { app } = makeApp();
    await app.request('/api/dashboard/runs?status=paused');

    const [[callArgs]] = mockListDashboardRuns.mock.calls as [[{ status?: string }]][];
    expect(callArgs?.status).toBe('paused');
  });

  test('ignores invalid status values in dashboard runs', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
    }));

    const { app } = makeApp();
    await app.request('/api/dashboard/runs?status=bogus');

    const [[callArgs]] = mockListDashboardRuns.mock.calls as [[{ status?: string }]][];
    expect(callArgs?.status).toBeUndefined();
  });

  test('filters by codebaseId query param', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
    }));

    const { app } = makeApp();
    await app.request('/api/dashboard/runs?codebaseId=cb-1');

    const [[callArgs]] = mockListDashboardRuns.mock.calls as [[{ codebaseId?: string }]][];
    expect(callArgs?.codebaseId).toBe('cb-1');
  });

  test('filters by search query param', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
    }));

    const { app } = makeApp();
    await app.request('/api/dashboard/runs?search=deploy');

    const [[callArgs]] = mockListDashboardRuns.mock.calls as [[{ search?: string }]][];
    expect(callArgs?.search).toBe('deploy');
  });

  test('supports after and before date filters', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
    }));

    const { app } = makeApp();
    await app.request('/api/dashboard/runs?after=2024-01-01T00:00:00Z&before=2024-12-31T23:59:59Z');

    const [[callArgs]] = mockListDashboardRuns.mock.calls as [
      [{ after?: string; before?: string }],
    ][];
    expect(callArgs?.after).toBe('2024-01-01T00:00:00Z');
    expect(callArgs?.before).toBe('2024-12-31T23:59:59Z');
  });

  test('caps limit at 200', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
    }));

    const { app } = makeApp();
    await app.request('/api/dashboard/runs?limit=9999');

    const [[callArgs]] = mockListDashboardRuns.mock.calls as [[{ limit?: number }]][];
    expect(callArgs?.limit).toBeLessThanOrEqual(200);
  });

  test('supports offset for pagination', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => ({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
    }));

    const { app } = makeApp();
    await app.request('/api/dashboard/runs?offset=50');

    const [[callArgs]] = mockListDashboardRuns.mock.calls as [[{ offset?: number }]][];
    expect(callArgs?.offset).toBe(50);
  });

  test('returns 500 when DB throws', async () => {
    mockListDashboardRuns.mockImplementationOnce(async () => {
      throw new Error('query timeout');
    });

    const { app } = makeApp();
    const response = await app.request('/api/dashboard/runs');
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Failed to list dashboard runs');
  });
});

describe('GET /api/workflows/runs/by-worker/:platformId', () => {
  beforeEach(() => {
    mockGetWorkflowRunByWorkerPlatformId.mockReset();
  });

  test('returns run when found', async () => {
    mockGetWorkflowRunByWorkerPlatformId.mockResolvedValueOnce(MOCK_RUNNING_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/by-worker/some-platform-id');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { run: unknown };
    expect(body.run).toBeDefined();
  });

  test('returns 404 when not found', async () => {
    mockGetWorkflowRunByWorkerPlatformId.mockResolvedValueOnce(null);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/by-worker/unknown-id');
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/resume
// ---------------------------------------------------------------------------

describe('POST /api/workflows/runs/:runId/resume', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockGetConversationById.mockReset();
    mockHandleMessage.mockReset();
    mockListPendingInteractions.mockReset();
    mockListPendingInteractions.mockImplementation(async () => []);
  });

  test('returns 404 when run not found', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-missing/resume', {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  test('returns 400 when run is not in failed status', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(MOCK_RUNNING_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/resume', {
      method: 'POST',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Cannot resume');
  });

  test('returns 400 with CLI hint when run has no parent_conversation_id', async () => {
    // CLI-created runs cannot be resumed from the web dashboard — the API
    // surfaces the equivalent CLI command rather than silently doing nothing.
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_FAILED_RUN,
      parent_conversation_id: null,
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-4/resume', {
      method: 'POST',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('archon workflow resume run-uuid-4');
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when parent conversation no longer exists', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_FAILED_RUN,
      parent_conversation_id: 'deleted-conv-uuid',
    });
    mockGetConversationById.mockResolvedValueOnce(null);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-4/resume', {
      method: 'POST',
    });
    expect(response.status).toBe(400);
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when parent conversation is non-web', async () => {
    // Slack/Telegram/GitHub-sourced runs cannot route through the web
    // adapter — the dispatcher is wired to webAdapter + lockManager.
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_FAILED_RUN,
      parent_conversation_id: 'slack-parent-uuid',
    });
    mockGetConversationById.mockResolvedValueOnce({
      id: 'slack-parent-uuid',
      platform_conversation_id: '1234567890.123456',
      platform_type: 'slack',
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-4/resume', {
      method: 'POST',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('archon workflow resume run-uuid-4');
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('returns 200 and dispatches resume when parent is a web conversation', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_FAILED_RUN,
      parent_conversation_id: 'parent-conv-uuid',
      user_message: 'Run the deploy',
    });
    mockGetConversationById.mockResolvedValueOnce({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-plat-abc',
      platform_type: 'web',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-4/resume', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('Resuming workflow');

    // dispatchToOrchestrator → lockManager → handleMessage
    expect(mockHandleMessage).toHaveBeenCalled();
    const [, platformConvId, dispatchedMessage] = mockHandleMessage.mock.calls[0] as [
      unknown,
      string,
      string,
    ];
    expect(platformConvId).toBe('web-plat-abc');
    expect(dispatchedMessage).toBe('/workflow resume run-uuid-4');
  });

  test('returns 200 and dispatches resume for a cancelled run with a web parent', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_FAILED_RUN,
      id: 'run-cancelled-web',
      status: 'cancelled' as const,
      completed_at: NOW,
      parent_conversation_id: 'parent-conv-uuid',
      user_message: 'Run the deploy',
    });
    mockGetConversationById.mockResolvedValueOnce({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-plat-abc',
      platform_type: 'web',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-cancelled-web/resume', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('Resuming workflow');

    const [, platformConvId, dispatchedMessage] = mockHandleMessage.mock.calls[0] as [
      unknown,
      string,
      string,
    ];
    expect(platformConvId).toBe('web-plat-abc');
    expect(dispatchedMessage).toBe('/workflow resume run-cancelled-web');
  });

  test('returns 200 and dispatches resume for an Ask-resumed running run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_RUNNING_RUN,
      id: 'run-ask-running',
      parent_conversation_id: 'parent-conv-uuid',
      user_message: 'Run the deploy',
    });
    mockListPendingInteractions.mockResolvedValueOnce([mockResolvedAskInteraction().interaction]);
    mockGetConversationById.mockResolvedValueOnce({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-plat-abc',
      platform_type: 'web',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-ask-running/resume', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('Resuming workflow');

    const [, platformConvId, dispatchedMessage] = mockHandleMessage.mock.calls[0] as [
      unknown,
      string,
      string,
    ];
    expect(platformConvId).toBe('web-plat-abc');
    expect(dispatchedMessage).toBe('/workflow resume run-ask-running');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/abandon
// ---------------------------------------------------------------------------

describe('POST /api/workflows/runs/:runId/abandon', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockCancelWorkflowRun.mockReset();
    // The shared abandonWorkflow op destructures { cancelled } from this call —
    // a bare mockReset() would make it return undefined and 500 the route.
    mockCancelWorkflowRun.mockImplementation(async (_id: string) => ({ cancelled: true }));
    mockFindChildRuns.mockReset();
    mockFindChildRuns.mockImplementation(async (_parentRunId: string): Promise<unknown[]> => []);
  });

  test('returns 404 when run not found', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-missing/abandon', {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  test('returns 400 when run is completed (non-resumable terminal)', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(MOCK_COMPLETED_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-2/abandon', {
      method: 'POST',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Cannot abandon');
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
  });

  test('returns 400 when run is cancelled (non-resumable terminal)', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_RUNNING_RUN,
      status: 'cancelled' as const,
      completed_at: NOW,
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/abandon', {
      method: 'POST',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Cannot abandon');
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
  });

  test('returns 200 and calls cancelWorkflowRun for running run', async () => {
    // Two lookups now: the route's pre-check + the shared abandonWorkflow op's own.
    mockGetWorkflowRun.mockResolvedValue(MOCK_RUNNING_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/abandon', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('Abandoned');
    expect(mockCancelWorkflowRun).toHaveBeenCalledWith('run-uuid-1');
  });

  // #1887: a failed run is terminal but resumable, so it must remain
  // abandonable — the HTTP route previously rejected it, contradicting CLI/chat.
  test('returns 200 and calls cancelWorkflowRun for failed run', async () => {
    // Two lookups now: the route's pre-check + the shared abandonWorkflow op's own.
    mockGetWorkflowRun.mockResolvedValue(MOCK_FAILED_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-4/abandon', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('Abandoned');
    expect(mockCancelWorkflowRun).toHaveBeenCalledWith('run-uuid-4');
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/workflows/runs/:runId
// ---------------------------------------------------------------------------

describe('DELETE /api/workflows/runs/:runId', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockDeleteWorkflowRun.mockReset();
  });

  test('returns 404 when run not found', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-missing', {
      method: 'DELETE',
    });
    expect(response.status).toBe(404);
  });

  test('returns 400 when run is not terminal', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(MOCK_RUNNING_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1', {
      method: 'DELETE',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Cannot delete');
  });

  test('returns 200 and deletes a completed run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(MOCK_COMPLETED_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-2', {
      method: 'DELETE',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('Deleted');
    expect(mockDeleteWorkflowRun).toHaveBeenCalledWith('run-uuid-2');
  });

  test('returns 200 and deletes a failed run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(MOCK_FAILED_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-4', {
      method: 'DELETE',
    });
    expect(response.status).toBe(200);
    expect(mockDeleteWorkflowRun).toHaveBeenCalledWith('run-uuid-4');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/approve
// ---------------------------------------------------------------------------

const MOCK_PAUSED_RUN: MockWorkflowRun = {
  ...MOCK_RUNNING_RUN,
  id: 'run-paused-1',
  status: 'paused',
  metadata: {
    approval: {
      type: 'approval',
      nodeId: 'review-gate',
      message: 'Review the plan',
    },
  },
};

describe('POST /api/workflows/runs/:runId/approve', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockUpdateWorkflowRun.mockReset();
    mockResolveApprovalGate.mockClear();
    mockResolveAndCancelApprovalGate.mockClear();
    mockCreateWorkflowEvent.mockReset();
  });

  test('returns 404 when run not found', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/missing/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'LGTM' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(404);
  });

  test('returns 400 when run is not paused', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(MOCK_RUNNING_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/approve', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(400);
  });

  // #2121 Phase 2: a parent paused blocked on a `workflow:` child has no approvable
  // gate of its own — approving the PARENT must 400 with a redirect to the child id,
  // never stamp a spurious node_completed for the parent's sub-run node.
  test('returns 400 redirecting to the child when the parent is blocked on a sub-run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_PAUSED_RUN,
      id: 'parent-blocked-1',
      metadata: {
        approval: {
          type: 'child_workflow',
          nodeId: 'sub',
          message: 'Blocked on sub-run',
          childRunId: 'child-xyz',
        },
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/parent-blocked-1/approve', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('child-xyz');
    // No gate mutation happened.
    expect(mockResolveApprovalGate).not.toHaveBeenCalled();
  });

  test('returns 400 when the gate is already resolved (double-approve guard)', async () => {
    // Post-#2075 an approved run stays 'paused' with approval.resolved set —
    // the status check alone no longer blocks a second approve.
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review-gate',
          message: 'Review the plan',
          resolved: 'approved',
        },
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-paused-1/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'again' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('already approved');
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    expect(mockUpdateWorkflowRun).not.toHaveBeenCalled();
  });

  test('stores user comment as node_output when captureResponse is true', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-capture',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review-gate',
          message: 'Review the plan',
          captureResponse: true,
        },
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-capture/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'Looks great, proceed' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(200);
    // Audit events ride the CAS transaction now (#2146), not a separate write.
    const casEvents = (mockResolveApprovalGate.mock.calls[0] as unknown[])[3] as Array<
      Record<string, unknown>
    >;
    const nodeCompleted = casEvents.find(e => e.event_type === 'node_completed');
    expect(nodeCompleted).toMatchObject({
      data: { node_output: 'Looks great, proceed', approval_decision: 'approved' },
    });
  });

  test('stores empty node_output when captureResponse is not set', async () => {
    mockGetWorkflowRun.mockResolvedValue(MOCK_PAUSED_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-paused-1/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'a comment' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(200);
    // Audit events ride the CAS transaction now (#2146), not a separate write.
    const casEvents = (mockResolveApprovalGate.mock.calls[0] as unknown[])[3] as Array<
      Record<string, unknown>
    >;
    const nodeCompleted = casEvents.find(e => e.event_type === 'node_completed');
    expect(nodeCompleted).toMatchObject({
      data: { node_output: '', approval_decision: 'approved' },
    });
    expect(mockCaptureApprovalResolved).toHaveBeenCalledWith({ resolution: 'approved' });
  });

  test('passes an absent comment through as no-feedback on an interactive_loop gate (#2074)', async () => {
    // The route must NOT default the comment to 'Approved' — approveWorkflow derives
    // loop_feedback_given from the RAW comment, and a masked no-feedback would make
    // every web approve iterate instead of finalize.
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-loop-bare',
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'refine',
          message: 'gate',
          iteration: 1,
          completionSignaled: true,
          signaledOutput: 'REPORT',
        },
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-loop-bare/approve', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(200);
    const casCall = mockResolveApprovalGate.mock.calls[0] as unknown[];
    expect(casCall[2]).toMatchObject({
      loop_feedback_given: false,
      loop_user_input: 'Approved',
    });
  });

  test('returns 400 (not a silent bare approve) when the body is sent but malformed (#2074)', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-bad-body',
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'refine',
          message: 'gate',
          iteration: 1,
          completionSignaled: true,
          signaledOutput: 'REPORT',
        },
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-bad-body/approve', {
      method: 'POST',
      body: '{"comment": "intended feedback', // truncated JSON — client bug
      headers: { 'Content-Type': 'application/json' },
    });
    // A malformed body must never be coerced into a bare approve — that would
    // FINALIZE a signal-bearing gate while silently discarding the feedback.
    expect(response.status).toBe(400);
    expect(mockResolveApprovalGate).not.toHaveBeenCalled();
  });

  test('passes a provided comment through as feedback on an interactive_loop gate (#2074)', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-loop-feedback',
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'refine',
          message: 'gate',
          iteration: 1,
        },
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-loop-feedback/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'actually re-check X' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(200);
    const casCall = mockResolveApprovalGate.mock.calls[0] as unknown[];
    expect(casCall[2]).toMatchObject({
      loop_feedback_given: true,
      loop_user_input: 'actually re-check X',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/reject
// ---------------------------------------------------------------------------

describe('POST /api/workflows/runs/:runId/reject', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockUpdateWorkflowRun.mockReset();
    mockResolveApprovalGate.mockClear();
    mockResolveAndCancelApprovalGate.mockClear();
    mockCancelWorkflowRun.mockReset();
    mockCreateWorkflowEvent.mockReset();
  });

  test('returns 404 when run not found', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/missing/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'bad' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(404);
  });

  test('returns 400 when run is not paused', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(MOCK_RUNNING_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-uuid-1/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'bad' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(400);
  });

  // #2121 Phase 2: rejecting a parent blocked on a `workflow:` child must 400 with a
  // redirect to the child id, not cancel the parent or stamp its sub-run node.
  test('returns 400 redirecting to the child when the parent is blocked on a sub-run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      ...MOCK_PAUSED_RUN,
      id: 'parent-blocked-2',
      metadata: {
        approval: {
          type: 'child_workflow',
          nodeId: 'sub',
          message: 'Blocked on sub-run',
          childRunId: 'child-abc',
        },
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/parent-blocked-2/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'no' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('child-abc');
    expect(mockResolveAndCancelApprovalGate).not.toHaveBeenCalled();
  });

  test('cancels immediately when no on_reject configured', async () => {
    mockGetWorkflowRun.mockResolvedValue(MOCK_PAUSED_RUN);
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-paused-1/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'needs work' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    // Terminal reject resolves + cancels atomically (#2113); the audit event rides
    // the same transaction (#2146).
    expect(mockResolveAndCancelApprovalGate).toHaveBeenCalledWith(
      'run-paused-1',
      { nodeId: 'review-gate', gateId: undefined },
      [
        {
          event_type: 'approval_received',
          step_name: 'review-gate',
          data: { decision: 'rejected', reason: 'needs work' },
        },
      ]
    );
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
    expect(mockCaptureApprovalResolved).toHaveBeenCalledWith({ resolution: 'rejected' });
  });

  test('records rejection and increments count when on_reject configured and under limit', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-on-reject',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review-gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-on-reject/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'needs more tests' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('On-reject prompt');
    expect(mockResolveApprovalGate).toHaveBeenCalledWith(
      'run-on-reject',
      { nodeId: 'review-gate', gateId: undefined },
      {
        approval: {
          type: 'approval',
          nodeId: 'review-gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
          resolved: 'rejected',
        },
        rejection_reason: 'needs more tests',
        rejection_count: 1,
      },
      [
        {
          event_type: 'approval_received',
          step_name: 'review-gate',
          data: { decision: 'rejected', reason: 'needs more tests' },
        },
      ]
    );
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
  });

  test('cancels when max attempts reached', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-max-attempts',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review-gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 2,
      },
    });
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-max-attempts/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'still bad' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('max attempts reached');
    // Terminal reject resolves + cancels atomically (#2113); the audit event rides
    // the same transaction (#2146).
    expect(mockResolveAndCancelApprovalGate).toHaveBeenCalledWith(
      'run-max-attempts',
      { nodeId: 'review-gate', gateId: undefined },
      [
        {
          event_type: 'approval_received',
          step_name: 'review-gate',
          data: { decision: 'rejected', reason: 'still bad' },
        },
      ]
    );
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
    expect(mockUpdateWorkflowRun).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auto-resume: approve/reject endpoints dispatch to orchestrator when the run
// has parent_conversation_id set (web-dispatched foreground/interactive
// workflows). Mirrors what the CLI does in workflowApproveCommand/RejectCommand.
// ---------------------------------------------------------------------------

describe('approve/reject auto-resume', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockUpdateWorkflowRun.mockReset();
    mockResolveApprovalGate.mockClear();
    mockResolveAndCancelApprovalGate.mockClear();
    mockCreateWorkflowEvent.mockReset();
    mockGetConversationById.mockReset();
    mockHandleMessage.mockReset();
    mockCancelWorkflowRun.mockReset();
  });

  test('approve: dispatches resume when parent_conversation_id is set', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-auto-resume-approve',
      parent_conversation_id: 'parent-conv-uuid',
      user_message: 'Deploy feature X',
    });
    mockGetConversationById.mockResolvedValueOnce({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-plat-abc',
      platform_type: 'web',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-auto-resume-approve/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'LGTM' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('Resuming workflow');

    // dispatchToOrchestrator → lockManager → handleMessage
    expect(mockHandleMessage).toHaveBeenCalled();
    const [, platformConvId, dispatchedMessage] = mockHandleMessage.mock.calls[0] as [
      unknown,
      string,
      string,
    ];
    expect(platformConvId).toBe('web-plat-abc');
    expect(dispatchedMessage).toBe('/workflow resume run-auto-resume-approve');
  });

  test('approve: leaves plannotator continuation to the live supervisor', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-plannotator-web',
      parent_conversation_id: 'parent-conv-uuid',
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'review-gate',
          message: 'Review',
          gateId: 'gate-1',
        },
      },
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-plannotator-web/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'LGTM' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('live Plannotator supervisor will continue');
    expect(mockHandleMessage).not.toHaveBeenCalled();
    expect(mockGetConversationById).not.toHaveBeenCalled();
  });

  test('approve: skips dispatch when parent_conversation_id is null (CLI-dispatched run)', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      parent_conversation_id: null,
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-paused-1/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'LGTM' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('archon workflow resume run-paused-1');
    expect(mockHandleMessage).not.toHaveBeenCalled();
    expect(mockGetConversationById).not.toHaveBeenCalled();
  });

  test('approve: skips dispatch when parent conversation no longer exists', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      parent_conversation_id: 'deleted-conv-uuid',
    });
    mockGetConversationById.mockResolvedValueOnce(null); // conversation deleted

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-paused-1/approve', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('archon workflow resume run-paused-1');
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('approve: skips dispatch when parent conversation is on a non-web platform', async () => {
    // A Slack/Telegram/GitHub-sourced run being approved via the dashboard
    // must not route through dispatchToOrchestrator — that helper is wired
    // to the web adapter + lock manager, so dispatching a Slack thread_ts
    // or Telegram chat_id would misroute through the wrong adapter.
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      parent_conversation_id: 'slack-parent-conv-uuid',
    });
    mockGetConversationById.mockResolvedValueOnce({
      id: 'slack-parent-conv-uuid',
      platform_conversation_id: '1234567890.123456', // a Slack thread_ts
      platform_type: 'slack',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-paused-1/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: 'LGTM' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    // Surfaces the exact CLI command so the web-UI user has a concrete next step.
    expect(body.message).toContain('archon workflow resume run-paused-1');
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('reject: dispatches resume for on_reject flows when parent is set', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-auto-resume-reject',
      parent_conversation_id: 'parent-conv-uuid',
      user_message: 'Review PR',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review-gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    });
    mockGetConversationById.mockResolvedValueOnce({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-plat-xyz',
      platform_type: 'web',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-auto-resume-reject/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'tests missing' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('Running on-reject prompt');
    expect(mockHandleMessage).toHaveBeenCalled();
    const [, platformConvId, dispatchedMessage] = mockHandleMessage.mock.calls[0] as [
      unknown,
      string,
      string,
    ];
    expect(platformConvId).toBe('web-plat-xyz');
    expect(dispatchedMessage).toBe('/workflow resume run-auto-resume-reject');
  });

  test('reject: surfaces CLI resume hint when on_reject configured but parent is non-web', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      id: 'run-reject-non-web',
      parent_conversation_id: 'slack-parent-conv-uuid',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review-gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    });
    mockGetConversationById.mockResolvedValueOnce({
      id: 'slack-parent-conv-uuid',
      platform_conversation_id: '1234567890.123456',
      platform_type: 'slack',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-reject-non-web/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'tests missing' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('archon workflow resume run-reject-non-web');
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('reject: does NOT dispatch when the run is being cancelled (no on_reject configured)', async () => {
    mockGetWorkflowRun.mockResolvedValue({
      ...MOCK_PAUSED_RUN,
      parent_conversation_id: 'parent-conv-uuid', // set, but doesn't matter — reject cancels
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-paused-1/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'no' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    // Cancellation path doesn't auto-resume — nothing to resume to.
    expect(mockHandleMessage).not.toHaveBeenCalled();
    // Terminal reject resolves + cancels atomically (#2113); the audit event rides
    // the same transaction (#2146).
    expect(mockResolveAndCancelApprovalGate).toHaveBeenCalledWith(
      'run-paused-1',
      { nodeId: 'review-gate', gateId: undefined },
      [
        {
          event_type: 'approval_received',
          step_name: 'review-gate',
          data: { decision: 'rejected', reason: 'no' },
        },
      ]
    );
  });
});

const ASK_STARTER_USER_ID = 'user-starter-1';
const ASK_REQUEST_ID = 'toolu_ask_1';
const ASK_ANSWER_BODY = {
  answers: [{ questionId: 'q1', value: 'yes' }],
};

function mockAskPausedRun(overrides: Partial<MockWorkflowRun> = {}): MockWorkflowRun {
  return {
    ...MOCK_PAUSED_RUN,
    id: 'run-ask-1',
    workflow_name: 'ask-flow',
    user_id: ASK_STARTER_USER_ID,
    metadata: {},
    ...overrides,
  };
}

function mockResolvedAskInteraction(overrides?: { resumed?: boolean; remainingPending?: number }): {
  interaction: MockPendingInteractionRow;
  resumed: boolean;
  remaining_pending: number;
} {
  return {
    interaction: {
      id: 'pi-ask-1',
      workflow_run_id: 'run-ask-1',
      node_id: 'ask-node',
      tool_use_id: ASK_REQUEST_ID,
      kind: 'ask',
      status: 'answered',
      envelope: { questions: [] },
      answer: ASK_ANSWER_BODY,
      provider_session_id: 'sess-ask-1',
      created_at: NOW,
      resolved_at: NOW,
      resolved_by: ASK_STARTER_USER_ID,
    },
    resumed: overrides?.resumed ?? true,
    remaining_pending: overrides?.remainingPending ?? 0,
  };
}

describe('POST /api/workflows/runs/:runId/ask/:requestId/answer', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockResolvePendingInteraction.mockReset();
    mockFindOrCreateUserByPlatformIdentity.mockClear();
    mockGetConversationById.mockReset();
    mockHandleMessage.mockReset();
    mockResolvePendingInteraction.mockImplementation(async () => mockResolvedAskInteraction());
  });

  test('returns 200 and resolves the pending Ask with the authenticated starter id', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(mockResolvePendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-ask-1',
      tool_use_id: ASK_REQUEST_ID,
      answer: ASK_ANSWER_BODY,
      resolved_by: ASK_STARTER_USER_ID,
    });
  });

  test('returns 200 for a decline body', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify({ decline: true }),
      }
    );

    expect(response.status).toBe(200);
    expect(mockResolvePendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-ask-1',
      tool_use_id: ASK_REQUEST_ID,
      answer: { decline: true },
      resolved_by: ASK_STARTER_USER_ID,
    });
  });

  test('returns 200 and records admin when no authenticated requester is present', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(200);
    expect(mockResolvePendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-ask-1',
      tool_use_id: ASK_REQUEST_ID,
      answer: ASK_ANSWER_BODY,
      resolved_by: 'admin',
    });
  });

  test('returns 400 for an invalid body when no authenticated requester is present', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decline: false }),
      }
    );

    expect(response.status).toBe(400);
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
    expect(mockResolvePendingInteraction).not.toHaveBeenCalled();
  });

  test('returns 404 for a missing run when no authenticated requester is present', async () => {
    mockGetWorkflowRun.mockResolvedValue(null);
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/missing-run/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(404);
    expect(mockResolvePendingInteraction).not.toHaveBeenCalled();
  });

  test('returns 200 when the requester is not the run starter', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': 'user-other-admin',
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(200);
    expect(mockResolvePendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-ask-1',
      tool_use_id: ASK_REQUEST_ID,
      answer: ASK_ANSWER_BODY,
      resolved_by: 'user-other-admin',
    });
  });

  test('returns 404 when the run is missing', async () => {
    mockGetWorkflowRun.mockResolvedValue(null);
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/missing-run/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(404);
    expect(mockResolvePendingInteraction).not.toHaveBeenCalled();
  });

  test('returns 404 when the request id is missing', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    mockResolvePendingInteraction.mockRejectedValueOnce(
      new PendingInteractionNotFoundError('run-ask-1', 'missing-tool')
    );
    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-ask-1/ask/missing-tool/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Archon-User': ASK_STARTER_USER_ID,
      },
      body: JSON.stringify(ASK_ANSWER_BODY),
    });

    expect(response.status).toBe(404);
  });

  test('returns 409 when the interaction is already resolved', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    mockResolvePendingInteraction.mockRejectedValueOnce(
      new PendingInteractionAlreadyResolvedError('run-ask-1', ASK_REQUEST_ID, 'answered')
    );
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(409);
  });

  test('returns 409 when the run is not paused', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    mockResolvePendingInteraction.mockRejectedValueOnce(
      new PendingInteractionRunNotPausedError('run-ask-1', 'running')
    );
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(409);
  });

  test('returns 400 for a mixed answers-and-decline body', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify({ answers: ASK_ANSWER_BODY.answers, decline: true }),
      }
    );

    expect(response.status).toBe(400);
    expect(mockResolvePendingInteraction).not.toHaveBeenCalled();
  });

  test('returns 400 for semantic envelope validation failure', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    mockResolvePendingInteraction.mockRejectedValueOnce(
      new PendingInteractionValidationError('unknown_question')
    );
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(400);
  });

  test('returns 500 for an unexpected operation error', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockAskPausedRun());
    mockResolvePendingInteraction.mockRejectedValueOnce(new Error('db exploded'));
    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(500);
  });

  test('dispatches /workflow resume once with the actor id for a last-pending web run', async () => {
    mockGetWorkflowRun.mockResolvedValue(
      mockAskPausedRun({ parent_conversation_id: 'parent-conv-uuid' })
    );
    mockGetConversationById.mockResolvedValue({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-plat-ask',
      platform_type: 'web',
    });
    mockResolvePendingInteraction.mockResolvedValue(mockResolvedAskInteraction({ resumed: true }));

    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('Resuming workflow');
    expect(mockHandleMessage).toHaveBeenCalledTimes(1);
    const [, platformConvId, dispatchedMessage, extraContext] = mockHandleMessage.mock.calls[0] as [
      unknown,
      string,
      string,
      { userId?: string },
    ];
    expect(platformConvId).toBe('web-plat-ask');
    expect(dispatchedMessage).toBe('/workflow resume run-ask-1');
    expect(extraContext.userId).toBe(ASK_STARTER_USER_ID);
  });

  test('solo auto-resume omits userId rather than passing admin', async () => {
    mockGetWorkflowRun.mockResolvedValue(
      mockAskPausedRun({ parent_conversation_id: 'parent-conv-uuid' })
    );
    mockGetConversationById.mockResolvedValue({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-plat-ask',
      platform_type: 'web',
    });
    mockResolvePendingInteraction.mockResolvedValue(mockResolvedAskInteraction({ resumed: true }));

    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(200);
    expect(mockResolvePendingInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ resolved_by: 'admin' })
    );
    const extraContext = mockHandleMessage.mock.calls[0]?.[3] as { userId?: string };
    expect(extraContext.userId).toBeUndefined();
  });

  test('does not auto-dispatch an intermediate answer', async () => {
    mockGetWorkflowRun.mockResolvedValue(
      mockAskPausedRun({ parent_conversation_id: 'parent-conv-uuid' })
    );
    mockGetConversationById.mockResolvedValue({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-plat-ask',
      platform_type: 'web',
    });
    mockResolvePendingInteraction.mockResolvedValue(
      mockResolvedAskInteraction({ resumed: false, remainingPending: 1 })
    );

    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('Other interactions remain');
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('returns 200 and skips dispatch for a non-web parent', async () => {
    mockGetWorkflowRun.mockResolvedValue(
      mockAskPausedRun({ parent_conversation_id: 'parent-conv-uuid' })
    );
    mockGetConversationById.mockResolvedValue({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'slack-thread',
      platform_type: 'slack',
    });
    mockResolvePendingInteraction.mockResolvedValue(mockResolvedAskInteraction({ resumed: true }));

    const { app } = makeApp();
    const response = await app.request(
      `/api/workflows/runs/run-ask-1/ask/${ASK_REQUEST_ID}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Archon-User': ASK_STARTER_USER_ID,
        },
        body: JSON.stringify(ASK_ANSWER_BODY),
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('archon workflow resume run-ask-1');
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });
});

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
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe('Permission confirmation accepted: permission-flow.');
    expect(mockConfirmPendingPermission).toHaveBeenCalledWith({
      workflow_run_id: 'run-permission-1',
      tool_use_id: PERMISSION_CALL_ID,
      answer: { intent: PERMISSION_INTENT_SENTINEL },
      resolved_by: PERMISSION_STARTER_ID,
    });
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  test('returns 200 and reports remaining interactions without dispatch', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(mockPermissionRun());
    mockConfirmPendingPermission.mockResolvedValueOnce({
      interaction: {
        id: 'pi-permission-1',
        workflow_run_id: 'run-permission-1',
        node_id: 'permission-node',
        tool_use_id: PERMISSION_CALL_ID,
        kind: 'permission',
        status: 'answered',
        envelope: {},
        answer: { intent: 'allow-once' },
        provider_session_id: 'permission-session',
        created_at: NOW,
        resolved_at: NOW,
        resolved_by: PERMISSION_STARTER_ID,
      },
      resumed: false,
      remaining_pending: 1,
    });
    const response = await postPermission('{"intent":"allow-once"}', PERMISSION_STARTER_ID);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('Other interactions remain');
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
    [
      new PendingInteractionAlreadyResolvedError(
        'run-permission-1',
        PERMISSION_CALL_ID,
        'answered'
      ),
      409,
    ],
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
      paths: Record<string, { post?: { requestBody?: { required?: boolean } } } | undefined>;
      components?: { schemas?: Record<string, unknown> };
    };
    const route = document.paths['/api/workflows/runs/{runId}/permissions/{callId}/confirm'];
    expect(route).toBeDefined();
    expect(route?.post?.requestBody?.required).toBe(true);
    expect(document.components?.schemas?.PermissionConfirmBody).toMatchObject({
      type: 'object',
      required: ['intent'],
      additionalProperties: false,
    });
  });
});

describe('review-open takeover auto-resume', () => {
  const reviewOpenRun: MockWorkflowRun = {
    ...MOCK_PAUSED_RUN,
    id: 'run-review-open-web',
    parent_conversation_id: 'parent-conv-uuid',
    metadata: {
      approval: {
        type: 'plannotator_gate',
        nodeId: 'review-gate',
        message: 'Review',
        gateId: 'gate-old',
        document: '/tmp/review.html',
        phase: 'idle',
      },
    },
  };

  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockGetConversationById.mockReset();
    mockHandleMessage.mockReset();
    mockTransitionPlannotatorGate.mockReset();
    mockTransitionPlannotatorGate.mockResolvedValue({ outcome: 'updated', approval: {} });
  });

  test('publishes the exact review-open success response contract', async () => {
    const { app } = makeApp();

    const response = await app.request('/api/openapi.json');
    const document = (await response.json()) as {
      paths: Record<
        string,
        {
          post?: {
            responses?: Record<
              string,
              { content?: Record<string, { schema?: Record<string, unknown> }> }
            >;
          };
        }
      >;
    };

    const schema =
      document.paths['/api/workflows/runs/{runId}/review-open']?.post?.responses?.['200']
        ?.content?.['application/json']?.schema;
    expect(schema).toEqual({
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        document: { type: 'string' },
        nodeId: { type: 'string' },
        phase: { type: 'string', enum: ['opening'] },
        continuation: { type: 'string', enum: ['caller_resume'] },
        message: { type: 'string' },
      },
      required: ['success', 'document', 'nodeId', 'phase', 'continuation', 'message'],
    });
  });

  test('dispatches exactly one explicit resume for a web parent', async () => {
    mockGetWorkflowRun.mockResolvedValue(reviewOpenRun);
    mockGetConversationById.mockResolvedValueOnce({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'web-parent-review',
      platform_type: 'web',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-review-open-web/review-open', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(mockHandleMessage).toHaveBeenCalledTimes(1);
    const [, platformConvId, dispatchedMessage] = mockHandleMessage.mock.calls[0] as [
      unknown,
      string,
      string,
    ];
    expect(platformConvId).toBe('web-parent-review');
    expect(dispatchedMessage).toBe('/workflow resume run-review-open-web');
  });

  test('does not dispatch for a non-web parent and returns manual resume instruction', async () => {
    mockGetWorkflowRun.mockResolvedValue(reviewOpenRun);
    mockGetConversationById.mockResolvedValueOnce({
      id: 'parent-conv-uuid',
      platform_conversation_id: 'slack-parent-review',
      platform_type: 'slack',
    });

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-review-open-web/review-open', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(mockHandleMessage).not.toHaveBeenCalled();
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('archon workflow resume run-review-open-web');
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/runs/:runId/artifacts — the new artifact-listing endpoint
// ---------------------------------------------------------------------------

describe('GET /api/runs/:runId/artifacts', () => {
  // These cases write real files under the resolved artifact dir, so point the
  // fake ARCHON_HOME at an OS temp dir — a hard-coded '/tmp/...' is not an
  // absolute path on Windows. Torn down per case, so no cross-test leakage.
  const originalMockHome = mockArchonHome;
  beforeEach(async () => {
    mockArchonHome = await mkdtemp(join(tmpdir(), 'archon-artifacts-home-'));
    mockGetWorkflowRun.mockReset();
    mockGetCodebase.mockReset();
  });

  afterEach(async () => {
    const used = mockArchonHome;
    mockArchonHome = originalMockHome;
    await rm(used, { recursive: true, force: true });
  });

  test('returns 400 for invalid run ids (regex guard)', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/runs/has..slash/artifacts');
    expect(response.status).toBe(400);
  });

  test('returns 404 when the run does not exist', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => null);
    const { app } = makeApp();
    const response = await app.request('/api/runs/run-missing/artifacts');
    expect(response.status).toBe(404);
  });

  // #2200: an unresolvable output location is an explicit 404. An empty 200 was
  // indistinguishable from "the run produced nothing".
  test('returns 404 when run has no codebase_id and no output_root', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: 'run-orphan',
      codebase_id: null,
    }));
    const { app } = makeApp();
    const response = await app.request('/api/runs/run-orphan/artifacts');
    expect(response.status).toBe(404);
    expect(mockGetCodebase).not.toHaveBeenCalled();
  });

  test('resolves a bare-basename (_local) codebase instead of failing the parse', async () => {
    const runId = 'run-local-listing';
    const dir = join(wsRoot(), '_local', 'workspace', 'artifacts', 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'plan.md'), '# plan');
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: runId,
      codebase_id: 'cb-1',
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      name: 'workspace',
      kind: 'repo',
      default_cwd: '/home/u/workspace',
    }));
    const { app } = makeApp();
    const response = await app.request(`/api/runs/${runId}/artifacts`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: { path: string }[] };
    // Before #2200 this returned an empty list — parseOwnerRepo(name) was null.
    expect(body.files.map(f => f.path)).toEqual(['plan.md']);
  });

  test('resolves a folder project to _folder/<slug> storage', async () => {
    const runId = 'run-folder-listing';
    const dir = join(wsRoot(), '_folder', 'my-ops-folder', 'artifacts', 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'report.md'), '# report');
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: runId,
      codebase_id: 'cb-folder',
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      name: 'My Ops Folder',
      kind: 'folder',
      default_cwd: '/srv/ops',
    }));
    const { app } = makeApp();
    const response = await app.request(`/api/runs/${runId}/artifacts`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: { path: string }[] };
    expect(body.files.map(f => f.path)).toEqual(['report.md']);
  });

  test('a persisted output_root wins over a codebase renamed since the run', async () => {
    const runId = 'run-persisted-root';
    const root = join(wsRoot(), 'acme', 'original');
    const dir = join(root, 'artifacts', 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'out.md'), 'x');
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: runId,
      codebase_id: 'cb-renamed',
      output_root: root,
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      name: 'acme/renamed-since',
      kind: 'repo',
      default_cwd: '/repos/renamed',
    }));
    const { app } = makeApp();
    const response = await app.request(`/api/runs/${runId}/artifacts`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: { path: string }[] };
    expect(body.files.map(f => f.path)).toEqual(['out.md']);
  });

  test('an out-of-tree output_root falls through to re-derivation, keeping the tree relocatable', async () => {
    // Durability, not just correctness: move ARCHON_HOME (machine migration,
    // restored backup, the ARCHON_DATA split) and EVERY stamped root is
    // out-of-tree. Hard-failing here would permanently un-browse every
    // historical run whose artifacts are sitting right there under the new
    // home — and output_root is write-once via COALESCE, so the app could never
    // clear the column to recover.
    const runId = 'run-stale-root';
    const dir = join(wsRoot(), '_local', 'workspace', 'artifacts', 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'plan.md'), '# still here');

    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: runId,
      codebase_id: 'cb-1',
      // A root from the OLD home — the shape every run has after a relocation.
      output_root: '/previous/archon/home/workspaces/_local/workspace',
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      name: 'workspace',
      kind: 'repo',
      default_cwd: '/home/u/workspace',
    }));

    const { app } = makeApp();
    const response = await app.request(`/api/runs/${runId}/artifacts`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: { path: string }[] };
    expect(body.files.map(f => f.path)).toEqual(['plan.md']);
  });

  test('the containment guard still rejects a DERIVED path that escapes the tree', async () => {
    // The guard's live purpose after the fix: nothing re-derivable, and a
    // persisted root that cannot be trusted, must not serve a path outside
    // ARCHON_HOME.
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: 'run-escape-root',
      codebase_id: null,
      output_root: '/etc',
    }));
    const { app } = makeApp();
    const response = await app.request('/api/runs/run-escape-root/artifacts');
    // No codebase to re-derive from, and the persisted root is untrusted, so the
    // location is genuinely unresolvable.
    expect(response.status).toBe(404);
  });

  test('returns 500 + logs when the codebase lookup throws', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: 'run-db-err',
      codebase_id: 'cb-broken',
    }));
    mockGetCodebase.mockImplementationOnce(async () => {
      throw new Error('DB connection lost');
    });
    const { app } = makeApp();
    const response = await app.request('/api/runs/run-db-err/artifacts');
    expect(response.status).toBe(500);
  });

  // Traversal-shaped codebase names never produce a traversal path: they fail
  // parseOwnerRepo and fall through to `_local/<basename(default_cwd)>`, which
  // is a single sanitised segment. The result is a real (empty) project dir,
  // NOT an escape — and the ARCHON_HOME containment check is the second layer.
  test('a traversal-shaped codebase name resolves inside ARCHON_HOME, never outside it', async () => {
    for (const name of ['../../etc/passwd', 'a/b/c', '../repo', 'owner/..', 'ow ner/repo']) {
      mockGetWorkflowRun.mockImplementationOnce(async () => ({
        ...MOCK_RUNNING_RUN,
        id: 'run-bad-name',
        codebase_id: 'cb-bad',
      }));
      mockGetCodebase.mockImplementationOnce(async () => ({
        name,
        kind: 'repo',
        default_cwd: '/home/u/checkout',
      }));
      const { app } = makeApp();
      const response = await app.request('/api/runs/run-bad-name/artifacts');
      // Resolved to _local/checkout (which does not exist) → empty list, not an escape.
      expect(response.status).toBe(200);
      const body = (await response.json()) as { files: unknown[] };
      expect(body.files).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/artifacts/:runId/* — the artifact file-serving endpoint
// (owner/repo derivation only; content serving hits the real filesystem)
// ---------------------------------------------------------------------------

describe('GET /api/artifacts/:runId/* storage-key resolution', () => {
  // These cases write real files under the resolved artifact dir, so point the
  // fake ARCHON_HOME at an OS temp dir — a hard-coded '/tmp/...' is not an
  // absolute path on Windows. Torn down per case, so no cross-test leakage.
  const originalMockHome = mockArchonHome;
  beforeEach(async () => {
    mockArchonHome = await mkdtemp(join(tmpdir(), 'archon-artifacts-home-'));
    mockGetWorkflowRun.mockReset();
    mockGetCodebase.mockReset();
  });

  afterEach(async () => {
    const used = mockArchonHome;
    mockArchonHome = originalMockHome;
    await rm(used, { recursive: true, force: true });
  });

  test('returns 404 when there is no codebase and no output_root to resolve from', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: 'run-serve-orphan',
      codebase_id: null,
    }));
    const { app } = makeApp();
    const response = await app.request('/api/artifacts/run-serve-orphan/plan.md');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('could not resolve');
  });

  test('serves a folder project’s artifact (404 before #2200)', async () => {
    const runId = 'run-serve-folder';
    const dir = join(wsRoot(), '_folder', 'my-ops-folder', 'artifacts', 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'plan.md'), '# folder plan');
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: runId,
      codebase_id: 'cb-folder',
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      name: 'My Ops Folder',
      kind: 'folder',
      default_cwd: '/srv/ops',
    }));
    const { app } = makeApp();
    const response = await app.request(`/api/artifacts/${runId}/plan.md`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# folder plan');
  });

  test('serves a no-remote local repo’s artifact (404 before #2200)', async () => {
    const runId = 'run-serve-local';
    const dir = join(wsRoot(), '_local', 'workspace', 'artifacts', 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'plan.md'), '# local plan');
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: runId,
      codebase_id: 'cb-local',
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      name: 'workspace',
      kind: 'repo',
      default_cwd: '/home/u/workspace',
    }));
    const { app } = makeApp();
    const response = await app.request(`/api/artifacts/${runId}/plan.md`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# local plan');
  });

  test('an out-of-tree output_root falls through to re-derivation and still serves', async () => {
    // Same relocation case as the list route: a stamped root from a previous
    // ARCHON_HOME must not permanently un-serve a run whose file is present.
    const runId = 'run-serve-stale-root';
    const dir = join(wsRoot(), '_local', 'workspace', 'artifacts', 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'plan.md'), '# still here');

    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: runId,
      codebase_id: 'cb-1',
      output_root: '/previous/archon/home/workspaces/_local/workspace',
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      name: 'workspace',
      kind: 'repo',
      default_cwd: '/home/u/workspace',
    }));

    const { app } = makeApp();
    const response = await app.request(`/api/artifacts/${runId}/plan.md`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# still here');
  });

  test('an untrusted output_root with nothing to re-derive from is unresolvable', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: 'run-serve-escape-root',
      codebase_id: null,
      output_root: '/etc',
    }));
    const { app } = makeApp();
    const response = await app.request('/api/artifacts/run-serve-escape-root/passwd');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('could not resolve');
  });

  test('a valid owner/repo name resolves and proceeds to the file read', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: 'run-serve-ok',
      codebase_id: 'cb-ok',
    }));
    mockGetCodebase.mockImplementationOnce(async () => ({
      name: 'acme/widgets',
      kind: 'repo',
      default_cwd: '/repos/widgets',
    }));
    const { app } = makeApp();
    const response = await app.request('/api/artifacts/run-serve-ok/plan.md');
    // Artifact dir does not exist on disk → ENOENT, distinct from the
    // unresolvable-location rejection above.
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Artifact file not found');
  });
});

describe('POST /api/workflows/runs/:runId/nodes/:nodeId/retry', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockGetConversationById.mockReset();
    mockGetCodebase.mockReset();
    mockGetWorkflowNodeRetryPreview.mockReset();
    mockPrepareWorkflowNodeRetry.mockReset();
    mockExecuteWorkflow.mockReset();
    mockCreateWorkflowDeps.mockReset();
    mockGetWorkflowNodeRetryPreview.mockImplementation(async () => ({
      runId: 'run-web-retry',
      workflowName: 'deploy',
      nodeId: 'build',
      retryEpoch: 1,
      invalidatedNodeIds: ['build'],
      resetSkipped: false,
      checkpointRef: 'refs/archon/checkpoints/run-web-retry/0/build',
      checkpointCommitSha: 'checkpoint-sha',
      currentHeadSha: 'head-sha',
      hasNewerHead: true,
      requiresCommitChoice: true,
    }));
    mockPrepareWorkflowNodeRetry.mockImplementation(
      async (input: { checkoutStrategy?: 'checkpoint' | 'current' }) => ({
        runId: 'run-web-retry',
        workflowName: 'deploy',
        preCreatedRun: {
          id: 'run-web-retry',
          workflow_name: 'deploy',
          conversation_id: 'worker-conv',
          parent_conversation_id: 'parent-conv',
          codebase_id: null,
          status: 'running',
          user_message: 'retry',
          started_at: NOW,
          completed_at: null,
          metadata: { retry_epoch: 1 },
          working_path: '/tmp/worktrees/feature',
          last_activity_at: NOW,
        },
        retryEpoch: 1,
        invalidatedNodeIds: ['build'],
        preservedCompletedOutputs: new Map<string, string>(),
        resetSkipped: input.checkoutStrategy === 'current',
        safetyRef: 'refs/archon/retry-safety/run-web-retry/1',
        safetyCommitSha: 'safety-sha',
        checkoutStrategy: input.checkoutStrategy ?? 'checkpoint',
      })
    );
    mockExecuteWorkflow.mockImplementation(async () => ({
      success: true,
      workflowRunId: 'run-web-retry',
    }));
    mockCreateWorkflowDeps.mockImplementation(() => ({}));
  });

  async function mockRetryWorkflowDiscovery(): Promise<void> {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        {
          workflow: {
            name: 'deploy',
            description: 'Deploy workflow',
            nodes: [{ id: 'build', command: 'build' }],
          },
          source: 'project',
        },
      ],
      errors: [],
    });
  }

  function mockWebRetryRun(): MockWorkflowRun {
    return {
      ...MOCK_FAILED_RUN,
      id: 'run-web-retry',
      workflow_name: 'deploy',
      conversation_id: 'worker-conv',
      parent_conversation_id: 'parent-conv',
      working_path: '/tmp/worktrees/feature',
    };
  }

  function mockWebRetryConversations(): void {
    mockGetConversationById.mockImplementation(async id => {
      if (id === 'parent-conv') {
        return {
          id,
          platform_conversation_id: 'web-parent',
          platform_type: 'web',
        };
      }
      if (id === 'worker-conv') {
        return {
          id,
          platform_conversation_id: 'web-worker',
          platform_type: 'web',
        };
      }
      return null;
    });
  }

  test('previews newer checkout state for an eligible web-owned retry', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => mockWebRetryRun());
    mockWebRetryConversations();
    await mockRetryWorkflowDiscovery();

    const { app } = makeApp();
    const response = await app.request(
      '/api/workflows/runs/run-web-retry/nodes/build/retry/preview'
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      currentHeadSha: string;
      checkpointCommitSha: string;
      requiresCommitChoice: boolean;
    };
    expect(body.currentHeadSha).toBe('head-sha');
    expect(body.checkpointCommitSha).toBe('checkpoint-sha');
    expect(body.requiresCommitChoice).toBe(true);
    expect(mockGetWorkflowNodeRetryPreview).toHaveBeenCalledWith({
      runId: 'run-web-retry',
      nodeId: 'build',
      workflow: expect.objectContaining({ name: 'deploy' }),
    });
  });

  test('passes selected checkout strategy to retry preparation', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => mockWebRetryRun());
    mockWebRetryConversations();
    await mockRetryWorkflowDiscovery();

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-web-retry/nodes/build/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkoutStrategy: 'current' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { checkoutStrategy: string };
    expect(body.checkoutStrategy).toBe('current');
    expect(mockPrepareWorkflowNodeRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-web-retry',
        nodeId: 'build',
        checkoutStrategy: 'current',
      })
    );
  });

  test('allows cancelled runs through status validation before web ownership checks', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_FAILED_RUN,
      id: 'run-cancelled-retry',
      status: 'cancelled',
      parent_conversation_id: null,
    }));

    const { app } = makeApp();
    const response = await app.request(
      '/api/workflows/runs/run-cancelled-retry/nodes/dev-story/retry',
      { method: 'POST' }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('created outside the web UI');
    expect(body.error).toContain('archon workflow retry-node run-cancelled-retry dev-story');
  });

  test('rejects active runs before retry ownership checks', async () => {
    mockGetWorkflowRun.mockImplementationOnce(async () => ({
      ...MOCK_RUNNING_RUN,
      id: 'run-running-retry',
      status: 'running',
      parent_conversation_id: null,
    }));

    const { app } = makeApp();
    const response = await app.request('/api/workflows/runs/run-running-retry/nodes/build/retry', {
      method: 'POST',
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(
      "Cannot retry workflow in 'running' status. Only failed, cancelled, or completed runs can be retried."
    );
  });

  test.todo(
    'returns success and dispatches a prepared retry run for eligible web-owned runs',
    () => {}
  );
  test.todo('returns 400 for malformed retry requests and invalid node ids', () => {});
  test.todo('returns 401 when no authenticated web requester is available', () => {});
  test.todo('returns 403 when the requester cannot mutate the workflow run', () => {});
  test.todo('returns 404 when the target run or failed node does not exist', () => {});
  test.todo('returns 409 when retry preparation detects an ineligible run state', () => {});
  test.todo(
    'allows retry only for failed or cancelled runs created from Web conversations',
    () => {}
  );
  test.todo('rejects CLI-created runs with actionable workflow retry-node guidance', () => {});
  test.todo('rejects non-web parent conversations with CLI retry guidance', () => {});
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/review-feedback
// ---------------------------------------------------------------------------

const REVIEW_RUN_ID = 'run-review-1';
const REVIEW_NODE_ID = 'plannotator-node';
const REVIEW_GATE_ID = 'gate-abc123';
const REVIEW_SESSION_ID = 'cccccccc-cccc-4ccc-accc-cccccccccccc';
const REVIEW_REQUEST_ID = 'dddddddd-dddd-4ddd-addd-dddddddddddd';
const REVIEW_FEEDBACK = 'Please fix the indentation in section 3.';

function makePausedPlannotatorRun(overrides?: Partial<MockWorkflowRun>): MockWorkflowRun {
  return {
    id: REVIEW_RUN_ID,
    workflow_name: 'plan',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'paused',
    user_message: 'review docs',
    started_at: NOW,
    completed_at: null,
    last_activity_at: NOW,
    working_path: null,
    metadata: {
      approval: {
        type: 'plannotator_gate',
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        message: 'Please review',
        phase: 'waiting_decision',
        reviewSessionId: REVIEW_SESSION_ID,
        resolved: null,
      },
    },
    ...overrides,
  };
}

describe('POST /api/workflows/runs/:runId/review-feedback', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockSubmitReviewFeedback.mockReset();
  });

  test('returns 404 when run does not exist', async () => {
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'rejected' as const,
      reason: 'Workflow run not found',
      statusCode: 404,
    }));
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: REVIEW_REQUEST_ID,
        feedback: REVIEW_FEEDBACK,
      }),
    });
    expect(res.status).toBe(404);
  });

  test('returns 200 with receipt when feedback is accepted', async () => {
    const submittedAt = new Date().toISOString();
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'accepted' as const,
      receipt: {
        requestId: REVIEW_REQUEST_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        feedback: REVIEW_FEEDBACK,
        status: 'accepted' as const,
        submittedAt,
        source: 'inline' as const,
      },
    }));
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: REVIEW_REQUEST_ID,
        feedback: REVIEW_FEEDBACK,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requestId: string;
      reviewSessionId: string;
      status: string;
      submittedAt: string;
    };
    expect(body.requestId).toBe(REVIEW_REQUEST_ID);
    expect(body.reviewSessionId).toBe(REVIEW_SESSION_ID);
    expect(body.status).toBe('accepted');
    expect(body.submittedAt).toBe(submittedAt);
  });

  test('returns 200 for idempotent duplicate requestId', async () => {
    const submittedAt = new Date().toISOString();
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'duplicate' as const,
      receipt: {
        requestId: REVIEW_REQUEST_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        feedback: REVIEW_FEEDBACK,
        status: 'accepted' as const,
        submittedAt,
        source: 'inline' as const,
      },
    }));
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: REVIEW_REQUEST_ID,
        feedback: REVIEW_FEEDBACK,
      }),
    });
    expect(res.status).toBe(200);
  });

  test('returns 409 for changed-body retry with same requestId', async () => {
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'conflict' as const,
      reason: 'A receipt for this requestId already exists with different feedback',
    }));
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: REVIEW_REQUEST_ID,
        feedback: 'changed feedback text',
      }),
    });
    expect(res.status).toBe(409);
  });

  test('returns 409 when another submission is already pending for the session', async () => {
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'conflict' as const,
      reason: 'Another submission is already pending for this review session',
    }));
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee',
        feedback: REVIEW_FEEDBACK,
      }),
    });
    expect(res.status).toBe(409);
  });

  test('returns 400 for wrong gate ID', async () => {
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'rejected' as const,
      reason: 'Gate ID mismatch',
      statusCode: 400,
    }));
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: 'wrong-gate',
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: REVIEW_REQUEST_ID,
        feedback: REVIEW_FEEDBACK,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 for wrong review session ID', async () => {
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'rejected' as const,
      reason: 'Review session ID mismatch',
      statusCode: 400,
    }));
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: 'ffffffff-0000-0000-0000-000000000001',
        requestId: REVIEW_REQUEST_ID,
        feedback: REVIEW_FEEDBACK,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 for terminal run', async () => {
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'rejected' as const,
      reason: "Run is in terminal status 'completed'",
      statusCode: 400,
    }));
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: REVIEW_REQUEST_ID,
        feedback: REVIEW_FEEDBACK,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('rejects missing required fields (strict schema)', async () => {
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: REVIEW_NODE_ID }),
    });
    expect(res.status).toBe(400);
  });

  test('rejects extra unknown keys (strict schema)', async () => {
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: REVIEW_REQUEST_ID,
        feedback: REVIEW_FEEDBACK,
        extraField: 'should be rejected',
      }),
    });
    expect(res.status).toBe(400);
  });

  test('does not auto-resume the run on feedback accepted', async () => {
    const submittedAt = new Date().toISOString();
    mockSubmitReviewFeedback.mockImplementationOnce(async () => ({
      outcome: 'accepted' as const,
      receipt: {
        requestId: REVIEW_REQUEST_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        feedback: REVIEW_FEEDBACK,
        status: 'accepted' as const,
        submittedAt,
        source: 'inline' as const,
      },
    }));
    const { app } = makeApp();
    await app.request(`/api/workflows/runs/${REVIEW_RUN_ID}/review-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: REVIEW_NODE_ID,
        gateId: REVIEW_GATE_ID,
        reviewSessionId: REVIEW_SESSION_ID,
        requestId: REVIEW_REQUEST_ID,
        feedback: REVIEW_FEEDBACK,
      }),
    });
    // resolveApprovalGate must NOT be called — HTTP 200 means accepted/pending, not approved.
    expect(mockResolveApprovalGate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/nodes/:nodeId/send — queued guidance
// ---------------------------------------------------------------------------

const STEER_RUN_ID = 'run-steer-1';
const STEER_NODE_ID = 'plan';
const STEER_STARTER_ID = 'user-steer-starter';
const STEER_MESSAGE_ID = '11111111-2222-4333-8444-555555555555';
const STEER_MESSAGE_ID_2 = '22222222-3333-4444-8555-666666666666';
const STEER_MESSAGE_ID_3 = '33333333-4444-4555-8666-777777777777';

function mockSteerableRun(overrides: Partial<MockWorkflowRun> = {}): MockWorkflowRun {
  return {
    ...MOCK_RUNNING_RUN,
    id: STEER_RUN_ID,
    user_id: STEER_STARTER_ID,
    ...overrides,
  };
}

function steerEvent(eventType: string, nodeId: string = STEER_NODE_ID): MockWorkflowEvent {
  return {
    id: `evt-steer-${eventType}`,
    workflow_run_id: STEER_RUN_ID,
    event_type: eventType,
    step_index: 0,
    step_name: nodeId,
    data: {},
    created_at: NOW,
  };
}

function sendPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message: 'steer the node',
    message_id: STEER_MESSAGE_ID,
    intent: 'queue',
    ...overrides,
  };
}

function postNodeSend(
  app: OpenAPIHono,
  body: unknown,
  headers: Record<string, string> = {},
  runId: string = STEER_RUN_ID,
  nodeId: string = STEER_NODE_ID
): Promise<Response> {
  return app.request(`/api/workflows/runs/${runId}/nodes/${nodeId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Rejections must leave the queue, transcript, and run state untouched. */
function expectNoSteeringMutation(
  handle: NodeSteeringHandle,
  before: SteeringHandleSnapshot
): void {
  const after = handle.snapshot();
  expect(after.phase).toBe(before.phase);
  expect(after.acceptedCount).toBe(before.acceptedCount);
  expect(after.queued).toEqual(before.queued);
  expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  expect(mockAddMessage).not.toHaveBeenCalled();
  expect(mockUpdateWorkflowRun).not.toHaveBeenCalled();
}

async function expectSteeringError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as {
    success: boolean;
    error: { code: string; message: string };
  };
  expect(body.success).toBe(false);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  expect(body.error.message.length).toBeGreaterThan(0);
}

function deleteNodeQueue(
  app: OpenAPIHono,
  messageId: string,
  headers: Record<string, string> = {},
  runId: string = STEER_RUN_ID,
  nodeId: string = STEER_NODE_ID
): Promise<Response> {
  return app.request(`/api/workflows/runs/${runId}/nodes/${nodeId}/queue/${messageId}`, {
    method: 'DELETE',
    headers,
  });
}

/** Queues an item directly on the handle — the registry state a DELETE targets. */
function queueSteerItem(
  handle: NodeSteeringHandle,
  messageId: string,
  text = 'queued guidance'
): void {
  const result = handle.enqueue({
    messageId,
    message: text,
    operatorUserId: STEER_STARTER_ID,
    receivedAt: NOW,
  });
  if (!result.ok) throw new Error('test setup: enqueue refused');
}

describe('POST /api/workflows/runs/:runId/nodes/:nodeId/send — queued guidance', () => {
  beforeEach(() => {
    getSteeringRegistry().clearForTests();
    mockGetWorkflowRun.mockReset();
    mockListWorkflowEvents.mockReset();
    mockListPendingInteractions.mockReset();
    mockFindOrCreateUserByPlatformIdentity.mockClear();
    mockCreateWorkflowEvent.mockClear();
    mockAddMessage.mockClear();
    mockUpdateWorkflowRun.mockClear();
  });

  /** Running run + node_started projection + live registry handle. */
  function liveSetup(nodeId: string = STEER_NODE_ID): NodeSteeringHandle {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', nodeId)]);
    return getSteeringRegistry().register(STEER_RUN_ID, nodeId);
  }

  // -- Actor matrix ---------------------------------------------------------

  test('returns 200 and queues one item for the run starter', async () => {
    const handle = liveSetup();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload(), { 'X-Archon-User': STEER_STARTER_ID });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message_id: STEER_MESSAGE_ID,
      state: 'queued',
    });
    const queued = handle.snapshot().queued;
    expect(queued).toHaveLength(1);
    expect(queued[0]?.operatorUserId).toBe(STEER_STARTER_ID);
    expect(queued[0]?.message).toBe('steer the node');
    expect(queued[0]?.messageId).toBe(STEER_MESSAGE_ID);
  });

  test('returns 200 for another authenticated member identity', async () => {
    const handle = liveSetup();
    mockFindOrCreateUserByPlatformIdentity.mockImplementationOnce(
      async (_platform: string, platformUserId: string) => ({
        id: platformUserId,
        display_name: platformUserId,
        email: null,
        role: 'member' as const,
        created_at: new Date(),
        updated_at: new Date(),
      })
    );
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload(), { 'X-Archon-User': 'member-other' });

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued[0]?.operatorUserId).toBe('member-other');
  });

  test('returns 200 for an admin identity that does not own the run', async () => {
    const handle = liveSetup();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload(), { 'X-Archon-User': 'user-admin-9' });

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued[0]?.operatorUserId).toBe('user-admin-9');
  });

  test('returns 200 with a null operator id on an identity-less install', async () => {
    const handle = liveSetup();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued[0]?.operatorUserId).toBeNull();
  });

  test('returns nested 401 before body validation for a gated unauthenticated caller', async () => {
    // Resolve the auth singleton as "disabled" BEFORE flipping the env gate on —
    // getAuth() caches the resolution so no pg.Pool is constructed. The API gate
    // is kept off so the route middleware (not the global /api/* gate) decides.
    getAuth();
    const savedDb = process.env.DATABASE_URL;
    const savedSecret = process.env.BETTER_AUTH_SECRET;
    const savedRequired = process.env.ARCHON_WEB_AUTH_REQUIRED;
    process.env.DATABASE_URL = 'postgres://127.0.0.1:1/archon-test';
    process.env.BETTER_AUTH_SECRET = 's'.repeat(32);
    process.env.ARCHON_WEB_AUTH_REQUIRED = 'false';
    try {
      const { app } = makeApp();
      // Malformed JSON — 401 must still win over 400.
      const res = await postNodeSend(app, '{not valid json');

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        success: false,
        error: { code: 'unauthenticated', message: 'Authentication required' },
      });
      expect(mockGetWorkflowRun).not.toHaveBeenCalled();
      expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    } finally {
      if (savedDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDb;
      if (savedSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = savedSecret;
      if (savedRequired === undefined) delete process.env.ARCHON_WEB_AUTH_REQUIRED;
      else process.env.ARCHON_WEB_AUTH_REQUIRED = savedRequired;
    }
  });

  // -- Validation matrix ------------------------------------------------------

  test('returns nested 400 for a blank-only message', async () => {
    const handle = liveSetup();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload({ message: '   \n\t  ' }));

    await expectSteeringError(res, 400, 'invalid_request');
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
    expectNoSteeringMutation(handle, before);
  });

  test('returns nested 400 for a missing field', async () => {
    const handle = liveSetup();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, { message_id: STEER_MESSAGE_ID, intent: 'queue' });

    await expectSteeringError(res, 400, 'invalid_request');
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
    expectNoSteeringMutation(handle, before);
  });

  test('returns nested 400 for unknown strict keys', async () => {
    const handle = liveSetup();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload({ extra: 'nope' }));

    await expectSteeringError(res, 400, 'invalid_request');
    expectNoSteeringMutation(handle, before);
  });

  test('returns nested 400 for malformed JSON', async () => {
    const handle = liveSetup();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, '{malformed json body');

    await expectSteeringError(res, 400, 'invalid_request');
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
    expectNoSteeringMutation(handle, before);
  });

  test('returns nested 400 for an invalid message_id', async () => {
    const handle = liveSetup();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload({ message_id: 'not-a-uuid' }));

    await expectSteeringError(res, 400, 'invalid_request');
    expectNoSteeringMutation(handle, before);
  });

  test('returns nested 400 for an invalid intent', async () => {
    const handle = liveSetup();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload({ intent: 'later' }));

    await expectSteeringError(res, 400, 'invalid_request');
    expectNoSteeringMutation(handle, before);
  });

  test('preserves original whitespace in the queued message verbatim', async () => {
    const handle = liveSetup();
    const { app } = makeApp();
    const padded = '  keep my  spacing\n\nand trailing  ';
    const res = await postNodeSend(app, sendPayload({ message: padded }));

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued[0]?.message).toBe(padded);
  });

  // -- Target/status matrix ---------------------------------------------------

  test('returns 404 for an unknown run', async () => {
    mockGetWorkflowRun.mockResolvedValue(null);
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    await expectSteeringError(res, 404, 'not_found');
    expect(getSteeringRegistry().get(STEER_RUN_ID, STEER_NODE_ID)).toBeUndefined();
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown node (no projection, no handle)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', 'other-node')]);
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    await expectSteeringError(res, 404, 'not_found');
    expect(getSteeringRegistry().get(STEER_RUN_ID, STEER_NODE_ID)).toBeUndefined();
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 409 for a terminal run even with a stale live handle', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'completed' }));
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    const handle = getSteeringRegistry().register(STEER_RUN_ID, STEER_NODE_ID);
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    await expectSteeringError(res, 409, 'node_finished');
    expectNoSteeringMutation(handle, before);
  });

  test('returns 409 for each terminal node state even with a stale live handle', async () => {
    const { app } = makeApp();
    for (const eventType of ['node_completed', 'node_failed', 'node_skipped']) {
      const nodeId = `node-${eventType}`;
      mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
      mockListWorkflowEvents.mockResolvedValue([steerEvent(eventType, nodeId)]);
      const handle = getSteeringRegistry().register(STEER_RUN_ID, nodeId);
      const before = handle.snapshot();

      const res = await postNodeSend(app, sendPayload(), {}, STEER_RUN_ID, nodeId);

      await expectSteeringError(res, 409, 'node_finished');
      expectNoSteeringMutation(handle, before);
    }
  });

  test('returns 409 for a closed handle', async () => {
    const handle = liveSetup();
    handle.close();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    await expectSteeringError(res, 409, 'node_finished');
    expectNoSteeringMutation(handle, before);
  });

  test('returns 422 for a running node with no handle (detached)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    await expectSteeringError(res, 422, 'not_steerable_here');
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 422 for a parked AskHuman handle with a new message id', async () => {
    const handle = liveSetup();
    handle.park();
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'paused' }));
    mockListPendingInteractions.mockResolvedValue([
      {
        id: 'pi-steer-ask',
        workflow_run_id: STEER_RUN_ID,
        node_id: STEER_NODE_ID,
        tool_use_id: 'toolu_steer_ask',
        kind: 'ask',
        status: 'pending',
        envelope: {},
        answer: null,
        provider_session_id: 'sess-steer',
        created_at: NOW,
        resolved_at: null,
        resolved_by: null,
      },
    ]);
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    await expectSteeringError(res, 422, 'not_steerable_here');
    expectNoSteeringMutation(handle, before);
  });

  test('returns 200 for a live handle with no projected node yet', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([]);
    const handle = getSteeringRegistry().register(STEER_RUN_ID, STEER_NODE_ID);
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued).toHaveLength(1);
  });

  test("returns 200 state 'queued' for intent send_now on a live generating handle", async () => {
    const handle = liveSetup();
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload({ intent: 'send_now' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message_id: STEER_MESSAGE_ID,
      state: 'queued',
    });
    expect(handle.snapshot().queued).toHaveLength(1);
  });

  // -- Idempotency and races --------------------------------------------------

  test('queues three distinct messages in receipt order', async () => {
    const handle = liveSetup();
    const { app } = makeApp();
    for (const [id, text] of [
      [STEER_MESSAGE_ID, 'first'],
      [STEER_MESSAGE_ID_2, 'second'],
      [STEER_MESSAGE_ID_3, 'third'],
    ] as const) {
      const res = await postNodeSend(app, sendPayload({ message_id: id, message: text }));
      expect(res.status).toBe(200);
    }
    const queued = handle.snapshot().queued;
    expect(queued.map(m => m.messageId)).toEqual([
      STEER_MESSAGE_ID,
      STEER_MESSAGE_ID_2,
      STEER_MESSAGE_ID_3,
    ]);
    expect(queued.map(m => m.message)).toEqual(['first', 'second', 'third']);
  });

  test('replays the original receipt for a duplicate id before and after drain', async () => {
    const handle = liveSetup();
    const { app } = makeApp();

    const res1 = await postNodeSend(app, sendPayload());
    expect(res1.status).toBe(200);
    const firstBody = await res1.json();

    const res2 = await postNodeSend(app, sendPayload());
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual(firstBody);
    expect(handle.snapshot().queued).toHaveLength(1);

    handle.drain();
    expect(handle.snapshot().queued).toHaveLength(0);

    const res3 = await postNodeSend(app, sendPayload());
    expect(res3.status).toBe(200);
    expect(await res3.json()).toEqual(firstBody);
    expect(handle.snapshot().queued).toHaveLength(0);
  });

  test('does not overwrite the original text for a changed-prose duplicate', async () => {
    const handle = liveSetup();
    const { app } = makeApp();
    await postNodeSend(app, sendPayload({ message: 'first text' }));

    const res = await postNodeSend(app, sendPayload({ message: 'CHANGED text' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message_id: STEER_MESSAGE_ID,
      state: 'queued',
    });
    const queued = handle.snapshot().queued;
    expect(queued).toHaveLength(1);
    expect(queued[0]?.message).toBe('first text');
  });

  test('replays a duplicate accepted id while the handle is parked', async () => {
    const handle = liveSetup();
    const { app } = makeApp();
    const res1 = await postNodeSend(app, sendPayload());
    const firstBody = await res1.json();

    handle.park();
    const res2 = await postNodeSend(app, sendPayload());
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual(firstBody);
    expect(handle.snapshot().queued).toHaveLength(1);
  });

  test('returns 409 when the run turns terminal between lookup and final re-read', async () => {
    liveSetup();
    const handle = getSteeringRegistry().get(STEER_RUN_ID, STEER_NODE_ID);
    const before = handle?.snapshot();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun
      .mockResolvedValueOnce(mockSteerableRun())
      .mockResolvedValueOnce(mockSteerableRun({ status: 'cancelled' }));
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    await expectSteeringError(res, 409, 'node_finished');
    expect(handle?.snapshot().queued).toHaveLength(0);
    expect(before && handle ? handle.snapshot().acceptedCount : 0).toBe(
      before?.acceptedCount ?? -1
    );
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 409 when the handle closes between inspection and enqueue', async () => {
    const handle = liveSetup();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun
      .mockResolvedValueOnce(mockSteerableRun())
      // The final status re-read still reports running, but the executor's
      // teardown gate closed the handle during the await.
      .mockImplementationOnce(async () => {
        handle.close();
        return mockSteerableRun();
      });
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload());

    await expectSteeringError(res, 409, 'node_finished');
    expect(handle.snapshot().queued).toHaveLength(0);
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt + idle send_now
// (issue #183) — the interrupt request awaits the engine's CLASSIFIED outcome;
// Send now releases an idle handle atomically through the same send route.
// ---------------------------------------------------------------------------

function postNodeInterrupt(
  app: OpenAPIHono,
  headers: Record<string, string> = {},
  runId: string = STEER_RUN_ID,
  nodeId: string = STEER_NODE_ID
): Promise<Response> {
  return app.request(`/api/workflows/runs/${runId}/nodes/${nodeId}/interrupt`, {
    method: 'POST',
    headers,
  });
}

/** Bounded poll — the in-process route resolves only after we settle the turn. */
async function waitUntil(pred: () => boolean, attempts = 500): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (pred()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('waitUntil timed out');
}

interface InterruptibleSetup {
  handle: NodeSteeringHandle;
  controller: AbortController;
  token: number;
  aborts: () => number;
}

/** Running run + node_started projection + live INTERRUPTIBLE handle mid-turn. */
function liveInterruptibleSetup(nodeId: string = STEER_NODE_ID): InterruptibleSetup {
  mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
  mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', nodeId)]);
  const handle = getSteeringRegistry().register(STEER_RUN_ID, nodeId, { interruptible: true });
  const controller = new AbortController();
  let abortCount = 0;
  const originalAbort = controller.abort.bind(controller);
  controller.abort = () => {
    abortCount++;
    originalAbort();
  };
  const token = handle.beginTurn(controller);
  return { handle, controller, token, aborts: () => abortCount };
}

/** Handle parked in idle-after-interrupt; `idleWait` resolves on the first wake. */
function idleInterruptibleSetup(nodeId: string = STEER_NODE_ID): InterruptibleSetup & {
  idleWait: Promise<SteeringIdleWake>;
} {
  const setup = liveInterruptibleSetup(nodeId);
  return { ...setup, idleWait: setup.handle.enterIdle(setup.token) };
}

function resetSteeringMocks(): void {
  getSteeringRegistry().clearForTests();
  mockGetWorkflowRun.mockReset();
  mockListWorkflowEvents.mockReset();
  mockListPendingInteractions.mockReset();
  // mockReset strips the default impl — reinstall the empty row the same way
  // the GET-run describe does so projection/pending reads never see undefined.
  mockListPendingInteractions.mockImplementation(async () => []);
  mockGetConversationById.mockReset();
  mockGetConversationById.mockImplementation(async () => null);
  mockQueryUsageReport.mockReset();
  mockQueryUsageReport.mockImplementation(async (opts: { runId?: string } = {}) =>
    emptyUsageReport(opts.runId)
  );
  mockGetUserById.mockReset();
  mockGetUserById.mockImplementation(async () => null);
  mockFindOrCreateUserByPlatformIdentity.mockClear();
  mockCreateWorkflowEvent.mockClear();
  mockAddMessage.mockClear();
  mockUpdateWorkflowRun.mockClear();
}

describe('POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt', () => {
  beforeEach(resetSteeringMocks);

  test('returns 200 idle when the live turn settles idle-after-interrupt', async () => {
    const { handle, controller, token } = liveInterruptibleSetup();
    const { app } = makeApp();
    const resPromise = postNodeInterrupt(app, { 'X-Archon-User': STEER_STARTER_ID });

    await waitUntil(() => controller.signal.aborted);
    void handle.enterIdle(token);
    const res = await resPromise;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, sub_state: 'idle-after-interrupt' });
    expect(handle.snapshot().subState).toBe('idle-after-interrupt');
  });

  test('returns 200 generating when the turn ended naturally before Stop took effect', async () => {
    const { handle, controller, token } = liveInterruptibleSetup();
    const { app } = makeApp();
    const resPromise = postNodeInterrupt(app);

    await waitUntil(() => controller.signal.aborted);
    handle.settleTurn(token, 'generating');
    const res = await resPromise;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, sub_state: 'generating' });
  });

  test('returns 409 node_finished when the node sealed empty during the request', async () => {
    const { handle, controller } = liveInterruptibleSetup();
    const { app } = makeApp();
    const resPromise = postNodeInterrupt(app);

    await waitUntil(() => controller.signal.aborted);
    // Natural empty end — the executor's last gate seals the live handle.
    expect(handle.closeIfEmpty()).toBe(true);
    const res = await resPromise;

    await expectSteeringError(res, 409, 'node_finished');
  });

  test('concurrent interrupts share one abort and resolve identical outcomes', async () => {
    const { handle, controller, token, aborts } = liveInterruptibleSetup();
    const { app } = makeApp();
    const p1 = postNodeInterrupt(app);
    const p2 = postNodeInterrupt(app);

    await waitUntil(() => controller.signal.aborted);
    void handle.enterIdle(token);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(aborts()).toBe(1);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = await r1.json();
    expect(b1).toEqual({ success: true, sub_state: 'idle-after-interrupt' });
    expect(await r2.json()).toEqual(b1);
  });

  test('repeated interrupts share one settlement — sequential second call after settle', async () => {
    const { handle, controller, token } = liveInterruptibleSetup();
    const { app } = makeApp();
    const resPromise = postNodeInterrupt(app);

    await waitUntil(() => controller.signal.aborted);
    void handle.enterIdle(token);
    expect((await resPromise).status).toBe(200);
    expect(handle.snapshot().subState).toBe('idle-after-interrupt');
  });

  test('returns idempotent 200 idle when the handle is already idle', async () => {
    const { handle, aborts } = idleInterruptibleSetup();
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, sub_state: 'idle-after-interrupt' });
    expect(aborts()).toBe(0);
    expect(handle.snapshot().subState).toBe('idle-after-interrupt');
  });

  // -- Actor ladder ---------------------------------------------------------

  test('actor ladder matches send: starter, member, admin, and identity-less allowed', async () => {
    for (const actor of [STEER_STARTER_ID, 'member-other', 'user-admin-9', undefined]) {
      idleInterruptibleSetup();
      const { app } = makeApp();
      const res = await postNodeInterrupt(app, actor ? { 'X-Archon-User': actor } : {});

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        sub_state: 'idle-after-interrupt',
      });
      getSteeringRegistry().clearForTests();
    }
  });

  test('returns nested 401 for a gated unauthenticated caller', async () => {
    // Same env flip as the send 401 test: resolve the auth singleton BEFORE the
    // gate goes on so getAuth() caches the "disabled" resolution; the API gate
    // stays off so the route middleware decides.
    getAuth();
    const savedDb = process.env.DATABASE_URL;
    const savedSecret = process.env.BETTER_AUTH_SECRET;
    const savedRequired = process.env.ARCHON_WEB_AUTH_REQUIRED;
    process.env.DATABASE_URL = 'postgres://127.0.0.1:1/archon-test';
    process.env.BETTER_AUTH_SECRET = 's'.repeat(32);
    process.env.ARCHON_WEB_AUTH_REQUIRED = 'false';
    try {
      const { app } = makeApp();
      const res = await postNodeInterrupt(app);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        success: false,
        error: { code: 'unauthenticated', message: 'Authentication required' },
      });
      expect(mockGetWorkflowRun).not.toHaveBeenCalled();
      expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    } finally {
      if (savedDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDb;
      if (savedSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = savedSecret;
      if (savedRequired === undefined) delete process.env.ARCHON_WEB_AUTH_REQUIRED;
      else process.env.ARCHON_WEB_AUTH_REQUIRED = savedRequired;
    }
  });

  // -- Target/status matrix ---------------------------------------------------

  test('returns 404 for an unknown run', async () => {
    mockGetWorkflowRun.mockResolvedValue(null);
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 404, 'not_found');
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown node (no projection, no handle)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', 'other-node')]);
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 404, 'not_found');
    expect(getSteeringRegistry().get(STEER_RUN_ID, STEER_NODE_ID)).toBeUndefined();
  });

  test('returns 409 for a terminal run even with a stale live handle', async () => {
    const { handle, aborts } = liveInterruptibleSetup();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'completed' }));
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 409, 'node_finished');
    expect(aborts()).toBe(0);
    expectNoSteeringMutation(handle, before);
  });

  test('returns 409 for a terminal node even with a stale live handle', async () => {
    const { handle, aborts } = liveInterruptibleSetup();
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_completed', STEER_NODE_ID)]);
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 409, 'node_finished');
    expect(aborts()).toBe(0);
    expectNoSteeringMutation(handle, before);
  });

  test('returns 409 for a closed handle', async () => {
    const { handle, aborts } = liveInterruptibleSetup();
    handle.close();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 409, 'node_finished');
    expect(aborts()).toBe(0);
    expectNoSteeringMutation(handle, before);
  });

  test('returns 422 for a running node with no handle (detached)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 422, 'not_steerable_here');
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 422 for a parked AskHuman handle', async () => {
    const { handle, aborts } = liveInterruptibleSetup();
    handle.park();
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'paused' }));
    mockListPendingInteractions.mockResolvedValue([
      {
        id: 'pi-steer-ask',
        workflow_run_id: STEER_RUN_ID,
        node_id: STEER_NODE_ID,
        tool_use_id: 'toolu_steer_ask',
        kind: 'ask',
        status: 'pending',
        envelope: {},
        answer: null,
        provider_session_id: 'sess-steer',
        created_at: NOW,
        resolved_at: null,
        resolved_by: null,
      },
    ]);
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 422, 'not_steerable_here');
    expect(aborts()).toBe(0);
    expectNoSteeringMutation(handle, before);
  });

  test('returns 422 for a live queue-only (non-interruptible) handle', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    const handle = getSteeringRegistry().register(STEER_RUN_ID, STEER_NODE_ID);
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 422, 'not_steerable_here');
    expectNoSteeringMutation(handle, before);
  });

  test('returns 409 when the run turns terminal between lookup and final re-read', async () => {
    const { aborts } = liveInterruptibleSetup();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun
      .mockResolvedValueOnce(mockSteerableRun())
      .mockResolvedValueOnce(mockSteerableRun({ status: 'cancelled' }));
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 409, 'node_finished');
    // The final gate fired BEFORE interrupt() — the controller was never torn.
    expect(aborts()).toBe(0);
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 409 when the handle seals between inspection and interrupt', async () => {
    const { handle, aborts } = liveInterruptibleSetup();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun
      .mockResolvedValueOnce(mockSteerableRun())
      // The status re-read still reports running, but the executor's natural
      // empty-end gate sealed the handle during the await — interrupt() then
      // resolves node_finished instead of a stale success.
      .mockImplementationOnce(async () => {
        expect(handle.closeIfEmpty()).toBe(true);
        return mockSteerableRun();
      });
    const { app } = makeApp();
    const res = await postNodeInterrupt(app);

    await expectSteeringError(res, 409, 'node_finished');
    expect(aborts()).toBe(0);
  });

  test('generated OpenAPI contains the interrupt route, response enum, and optional node field', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;

    const resolveRef = (node: unknown): unknown => {
      if (typeof node !== 'object' || node === null || !('$ref' in node)) return node;
      const ref = (node as { $ref: string }).$ref;
      if (!ref.startsWith('#/')) return node;
      return ref
        .slice(2)
        .split('/')
        .reduce<unknown>(
          (acc, seg) =>
            typeof acc === 'object' && acc !== null
              ? (acc as Record<string, unknown>)[seg]
              : undefined,
          doc
        );
    };
    const prop = (schema: unknown, key: string): unknown =>
      typeof schema === 'object' && schema !== null
        ? (schema as { properties?: Record<string, unknown> }).properties?.[key]
        : undefined;

    const paths = doc.paths as Record<string, { post?: { responses?: Record<string, unknown> } }>;
    const interruptRoute = paths['/api/workflows/runs/{runId}/nodes/{nodeId}/interrupt'];
    expect(interruptRoute?.post).toBeDefined();
    const okResponse = interruptRoute?.post?.responses?.['200'] as
      | { content?: Record<string, { schema?: unknown }> }
      | undefined;
    const respSchema = resolveRef(okResponse?.content?.['application/json']?.schema);
    expect(prop(respSchema, 'sub_state')).toMatchObject({
      enum: ['idle-after-interrupt', 'generating'],
    });

    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    const nodeState = schemas['WorkflowNodeState'];
    expect(prop(nodeState, 'steeringSubState')).toMatchObject({
      enum: ['generating', 'idle-after-interrupt'],
    });
    const required = (nodeState as { required?: string[] }).required ?? [];
    expect(required).not.toContain('steeringSubState');
    const sendRoute = paths['/api/workflows/runs/{runId}/nodes/{nodeId}/send'];
    expect(sendRoute?.post).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Send route intent on an idle interruptible handle (#183): one synchronous
// handle.accept(message, intent) owns receipt + release.
// ---------------------------------------------------------------------------

describe('POST /api/workflows/runs/:runId/nodes/:nodeId/send — intent on idle handle', () => {
  beforeEach(resetSteeringMocks);

  test("intent 'queue' while idle returns awaiting_send_now and does not wake", async () => {
    const { handle, idleWait } = idleInterruptibleSetup();
    let woke = false;
    void idleWait.then(() => {
      woke = true;
    });
    const { app } = makeApp();
    const res = await postNodeSend(app, sendPayload({ intent: 'queue' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message_id: STEER_MESSAGE_ID,
      state: 'awaiting_send_now',
    });
    // Queue-intent never implicitly wakes the idle executor — give it ticks.
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(woke).toBe(false);
    expect(handle.snapshot().subState).toBe('idle-after-interrupt');
    expect(handle.snapshot().queued.map(m => m.messageId)).toEqual([STEER_MESSAGE_ID]);
  });

  test("intent 'send_now' while idle returns awaiting_send_now and wakes once old-then-new", async () => {
    const { handle, idleWait } = idleInterruptibleSetup();
    const { app } = makeApp();
    // Two queue-intent receipts land on the idle handle first.
    const q1 = await postNodeSend(app, sendPayload({ intent: 'queue' }));
    expect(((await q1.json()) as { state: string }).state).toBe('awaiting_send_now');
    const q2 = await postNodeSend(
      app,
      sendPayload({ message_id: STEER_MESSAGE_ID_2, message: 'second', intent: 'queue' })
    );
    expect(((await q2.json()) as { state: string }).state).toBe('awaiting_send_now');

    const res = await postNodeSend(
      app,
      sendPayload({ message_id: STEER_MESSAGE_ID_3, message: 'third', intent: 'send_now' })
    );
    expect(res.status).toBe(200);
    // The releasing message's own receipt is STILL awaiting_send_now — the
    // receipt records the state at acceptance, not the release it triggered.
    expect(await res.json()).toEqual({
      success: true,
      message_id: STEER_MESSAGE_ID_3,
      state: 'awaiting_send_now',
    });

    const wake = await idleWait;
    expect(wake.kind).toBe('send_now');
    if (wake.kind === 'send_now') {
      expect(wake.messages.map(m => m.messageId)).toEqual([
        STEER_MESSAGE_ID,
        STEER_MESSAGE_ID_2,
        STEER_MESSAGE_ID_3,
      ]);
      expect(wake.messages.map(m => m.message)).toEqual(['steer the node', 'second', 'third']);
    }
    expect(handle.snapshot().subState).toBe('generating');
    expect(handle.snapshot().queued).toHaveLength(0);
  });

  test('duplicate send_now replays the original receipt without a second drain', async () => {
    const { handle, idleWait } = idleInterruptibleSetup();
    const { app } = makeApp();
    const res1 = await postNodeSend(app, sendPayload({ intent: 'send_now' }));
    const firstBody = (await res1.json()) as { state: string };
    expect(firstBody.state).toBe('awaiting_send_now');
    const wake = await idleWait;
    expect(wake.kind).toBe('send_now');

    const res2 = await postNodeSend(app, sendPayload({ intent: 'send_now' }));
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual(firstBody);
    // No second drain — nothing re-enqueued, nothing re-released.
    expect(handle.snapshot().queued).toHaveLength(0);
  });

  test("send during interrupting returns 'queued' and stays pending for explicit Send now", async () => {
    const { handle, controller, token } = liveInterruptibleSetup();
    const { app } = makeApp();
    const interruptPromise = postNodeInterrupt(app);
    await waitUntil(() => controller.signal.aborted);

    // Stop is in flight but unclassified — a queue-intent send lands as a
    // normal generating-time receipt.
    const sendRes = await postNodeSend(app, sendPayload({ intent: 'queue' }));
    expect(await sendRes.json()).toEqual({
      success: true,
      message_id: STEER_MESSAGE_ID,
      state: 'queued',
    });

    // Interruption wins → idle; the queued item waits for explicit Send now.
    const idleWait = handle.enterIdle(token);
    expect((await interruptPromise).status).toBe(200);
    expect(handle.snapshot().queued.map(m => m.messageId)).toEqual([STEER_MESSAGE_ID]);

    const res = await postNodeSend(
      app,
      sendPayload({ message_id: STEER_MESSAGE_ID_2, message: 'go', intent: 'send_now' })
    );
    expect(((await res.json()) as { state: string }).state).toBe('awaiting_send_now');
    const wake = await idleWait;
    if (wake.kind === 'send_now') {
      expect(wake.messages.map(m => m.messageId)).toEqual([STEER_MESSAGE_ID, STEER_MESSAGE_ID_2]);
    } else {
      throw new Error('expected send_now wake');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/workflows/runs/:runId — steeringSubState projection (#183)
// ---------------------------------------------------------------------------

describe('GET /api/workflows/runs/:runId — steeringSubState projection', () => {
  beforeEach(resetSteeringMocks);

  test('joins sub-state only onto live interrupt-capable running nodes', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([
      steerEvent('node_started', 'plan'),
      // Namespaced loop-group body key — the registry uses the same key.
      steerEvent('node_started', 'loop.body'),
      steerEvent('node_started', 'queueonly'),
      steerEvent('node_started', 'asked'),
      steerEvent('node_completed', 'done'),
    ]);
    const planHandle = getSteeringRegistry().register(STEER_RUN_ID, 'plan', {
      interruptible: true,
    });
    planHandle.beginTurn(new AbortController());
    const loopHandle = getSteeringRegistry().register(STEER_RUN_ID, 'loop.body', {
      interruptible: true,
    });
    void loopHandle.enterIdle(loopHandle.beginTurn(new AbortController()));
    // Queue-only handle on a running node — never projects.
    getSteeringRegistry().register(STEER_RUN_ID, 'queueonly');
    // Parked interruptible handle — not live, never projects.
    getSteeringRegistry().register(STEER_RUN_ID, 'asked', { interruptible: true }).park();
    // Live projecting handle on a COMPLETED node — terminal persisted state
    // outranks the stale handle, so nothing may join.
    const staleHandle = getSteeringRegistry().register(STEER_RUN_ID, 'done', {
      interruptible: true,
    });
    staleHandle.beginTurn(new AbortController());

    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${STEER_RUN_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodeStates: { nodeId: string; status: string; steeringSubState?: string }[];
    };
    const byId = new Map(body.nodeStates.map(s => [s.nodeId, s]));
    expect(byId.get('plan')?.steeringSubState).toBe('generating');
    expect(byId.get('loop.body')?.steeringSubState).toBe('idle-after-interrupt');
    const queueOnly = byId.get('queueonly');
    expect(queueOnly?.status).toBe('running');
    expect(queueOnly && 'steeringSubState' in queueOnly).toBe(false);
    const asked = byId.get('asked');
    expect(asked?.status).toBe('running');
    expect(asked && 'steeringSubState' in asked).toBe(false);
    const done = byId.get('done');
    expect(done?.status).toBe('completed');
    expect(done && 'steeringSubState' in done).toBe(false);
  });

  test('GET run without qualifying handles is wire-identical (no steeringSubState keys)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([
      steerEvent('node_started', 'plan'),
      steerEvent('node_completed', 'done'),
    ]);
    const { app } = makeApp();
    const res = await app.request(`/api/workflows/runs/${STEER_RUN_ID}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('steeringSubState');
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId — withdraw
// ---------------------------------------------------------------------------

describe('DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId — withdraw queued guidance', () => {
  beforeEach(() => {
    getSteeringRegistry().clearForTests();
    mockGetWorkflowRun.mockReset();
    mockListWorkflowEvents.mockReset();
    mockListPendingInteractions.mockReset();
    mockFindOrCreateUserByPlatformIdentity.mockClear();
    mockCreateWorkflowEvent.mockClear();
    mockAddMessage.mockClear();
    mockUpdateWorkflowRun.mockClear();
  });

  /** Running run + node_started projection + live registry handle. */
  function liveSetup(nodeId: string = STEER_NODE_ID): NodeSteeringHandle {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', nodeId)]);
    return getSteeringRegistry().register(STEER_RUN_ID, nodeId);
  }

  /** Rejections must leave the queue, transcript, and run state untouched. */
  function expectNoSteeringMutation(
    handle: NodeSteeringHandle,
    before: SteeringHandleSnapshot
  ): void {
    const after = handle.snapshot();
    expect(after.phase).toBe(before.phase);
    expect(after.acceptedCount).toBe(before.acceptedCount);
    expect(after.queued).toEqual(before.queued);
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockUpdateWorkflowRun).not.toHaveBeenCalled();
  }

  async function expectSteeringError(res: Response, status: number, code: string): Promise<void> {
    expect(res.status).toBe(status);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  }

  // -- Actor matrix ---------------------------------------------------------

  test('returns 200 and removes the queued id for the run starter', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID, {
      'X-Archon-User': STEER_STARTER_ID,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message_id: STEER_MESSAGE_ID });
    expect(handle.snapshot().queued).toHaveLength(0);
    // Accepted-id memory is preserved — only the pending item was removed.
    expect(handle.snapshot().acceptedCount).toBe(1);
  });

  test('returns 200 for another authenticated member identity', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    mockFindOrCreateUserByPlatformIdentity.mockImplementationOnce(
      async (_platform: string, platformUserId: string) => ({
        id: platformUserId,
        display_name: platformUserId,
        email: null,
        role: 'member' as const,
        created_at: new Date(),
        updated_at: new Date(),
      })
    );
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID, {
      'X-Archon-User': 'member-other',
    });

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued).toHaveLength(0);
  });

  test('returns 200 for an admin identity that does not own the run', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID, {
      'X-Archon-User': 'user-admin-9',
    });

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued).toHaveLength(0);
  });

  test('returns 200 on an identity-less install', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued).toHaveLength(0);
  });

  test('returns nested 401 before path validation for a gated unauthenticated caller', async () => {
    // Resolve the auth singleton as "disabled" BEFORE flipping the env gate on —
    // getAuth() caches the resolution so no pg.Pool is constructed. Keep the
    // install-wide API gate at its enabled default: the route middleware must
    // run before both that gate and OpenAPI UUID validation so the steering
    // contract's nested 401 wins.
    getAuth();
    const savedDb = process.env.DATABASE_URL;
    const savedSecret = process.env.BETTER_AUTH_SECRET;
    const savedRequired = process.env.ARCHON_WEB_AUTH_REQUIRED;
    process.env.DATABASE_URL = 'postgres://127.0.0.1:1/archon-test';
    process.env.BETTER_AUTH_SECRET = 's'.repeat(32);
    delete process.env.ARCHON_WEB_AUTH_REQUIRED;
    try {
      const { app } = makeApp();
      // Non-UUID path id — 401 must still win over 400.
      const res = await deleteNodeQueue(app, 'not-a-uuid');

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        success: false,
        error: { code: 'unauthenticated', message: 'Authentication required' },
      });
      expect(mockGetWorkflowRun).not.toHaveBeenCalled();
      expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    } finally {
      if (savedDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDb;
      if (savedSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = savedSecret;
      if (savedRequired === undefined) delete process.env.ARCHON_WEB_AUTH_REQUIRED;
      else process.env.ARCHON_WEB_AUTH_REQUIRED = savedRequired;
    }
  });

  // -- Validation -----------------------------------------------------------

  test('returns nested 400 for a non-UUID path messageId', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, 'not-a-uuid', {
      'X-Archon-User': STEER_STARTER_ID,
    });

    await expectSteeringError(res, 400, 'invalid_request');
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
    expectNoSteeringMutation(handle, before);
  });

  // -- Target/refusal ladder -------------------------------------------------

  test('returns 404 for an unknown run', async () => {
    mockGetWorkflowRun.mockResolvedValue(null);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 404, 'not_found');
    expect(getSteeringRegistry().get(STEER_RUN_ID, STEER_NODE_ID)).toBeUndefined();
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown node (no projection, no handle)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', 'other-node')]);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 404, 'not_found');
    expect(getSteeringRegistry().get(STEER_RUN_ID, STEER_NODE_ID)).toBeUndefined();
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 409 for a terminal run even with a stale queued handle', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'completed' }));
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    const handle = getSteeringRegistry().register(STEER_RUN_ID, STEER_NODE_ID);
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 409, 'node_finished');
    expectNoSteeringMutation(handle, before);
  });

  test('returns 409 for each terminal node state even with a stale queued handle', async () => {
    const { app } = makeApp();
    for (const eventType of ['node_completed', 'node_failed', 'node_skipped']) {
      const nodeId = `node-${eventType}`;
      mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
      mockListWorkflowEvents.mockResolvedValue([steerEvent(eventType, nodeId)]);
      const handle = getSteeringRegistry().register(STEER_RUN_ID, nodeId);
      queueSteerItem(handle, STEER_MESSAGE_ID);
      const before = handle.snapshot();

      const res = await deleteNodeQueue(app, STEER_MESSAGE_ID, {}, STEER_RUN_ID, nodeId);

      await expectSteeringError(res, 409, 'node_finished');
      expectNoSteeringMutation(handle, before);
    }
  });

  test('returns 409 for a closed handle', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    handle.close();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 409, 'node_finished');
    expectNoSteeringMutation(handle, before);
  });

  test('returns 422 for a running node with no handle (detached)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 422, 'not_steerable_here');
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns 200 for a live handle with no projected node yet', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([]);
    const handle = getSteeringRegistry().register(STEER_RUN_ID, STEER_NODE_ID);
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    expect(res.status).toBe(200);
    expect(handle.snapshot().queued).toHaveLength(0);
  });

  test('returns 200 for a parked AskHuman handle and removes only that item', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID, 'first');
    queueSteerItem(handle, STEER_MESSAGE_ID_2, 'second');
    handle.park();
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'paused' }));
    mockListPendingInteractions.mockResolvedValue([
      {
        id: 'pi-steer-ask',
        workflow_run_id: STEER_RUN_ID,
        node_id: STEER_NODE_ID,
        tool_use_id: 'toolu_steer_ask',
        kind: 'ask',
        status: 'pending',
        envelope: {},
        answer: null,
        provider_session_id: 'sess-steer',
        created_at: NOW,
        resolved_at: null,
        resolved_by: null,
      },
    ]);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    expect(res.status).toBe(200);
    const snap = handle.snapshot();
    expect(snap.phase).toBe('parked');
    expect(snap.queued.map(m => m.messageId)).toEqual([STEER_MESSAGE_ID_2]);
    expect(snap.acceptedCount).toBe(2);
  });

  test('returns 404 when the run disappears on the final re-read', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const before = handle.snapshot();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun.mockResolvedValueOnce(mockSteerableRun()).mockResolvedValueOnce(null);
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 404, 'not_found');
    expectNoSteeringMutation(handle, before);
  });

  test('returns 409 when the run turns terminal between lookup and final re-read', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const before = handle.snapshot();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun
      .mockResolvedValueOnce(mockSteerableRun())
      .mockResolvedValueOnce(mockSteerableRun({ status: 'cancelled' }));
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 409, 'node_finished');
    expectNoSteeringMutation(handle, before);
  });

  test('returns 409 when the handle closes during the final run read', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const before = handle.snapshot();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun
      .mockResolvedValueOnce(mockSteerableRun())
      // The final status re-read still reports running, but the executor's
      // teardown gate closed the handle during the await.
      .mockImplementationOnce(async () => {
        handle.close();
        return mockSteerableRun();
      });
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 409, 'node_finished');
    // The post-await phase recheck refused before withdraw() could mutate:
    // the item remains queued on the now-closed handle.
    expect(handle.snapshot().queued).toHaveLength(1);
    expect(handle.snapshot().acceptedCount).toBe(before.acceptedCount);
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });

  test('returns nested 500 when the event store throws', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const before = handle.snapshot();
    mockListWorkflowEvents.mockRejectedValue(new Error('event store down'));
    const { app } = makeApp();
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);

    await expectSteeringError(res, 500, 'internal_error');
    expectNoSteeringMutation(handle, before);
  });

  // -- Idempotency and response ----------------------------------------------

  test('returns the exact success shape and stays 200 for repeat, drained, and never-seen ids', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID, 'first');
    queueSteerItem(handle, STEER_MESSAGE_ID_2, 'second');
    const { app } = makeApp();

    // Live queued id — removed, siblings preserved, accepted memory intact.
    const res = await deleteNodeQueue(app, STEER_MESSAGE_ID);
    expect(res.status).toBe(200);
    // Exact wire shape: only `success` and `message_id` — no `removed` leak.
    expect(await res.json()).toEqual({ success: true, message_id: STEER_MESSAGE_ID });
    expect(handle.snapshot().queued.map(m => m.messageId)).toEqual([STEER_MESSAGE_ID_2]);
    expect(handle.snapshot().acceptedCount).toBe(2);

    // Repeat — identical receipt, still mutation-free.
    const repeat = await deleteNodeQueue(app, STEER_MESSAGE_ID);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ success: true, message_id: STEER_MESSAGE_ID });
    expect(handle.snapshot().queued).toHaveLength(1);

    // Already-drained id — identical receipt.
    handle.drain();
    const drained = await deleteNodeQueue(app, STEER_MESSAGE_ID_2);
    expect(drained.status).toBe(200);
    expect(await drained.json()).toEqual({ success: true, message_id: STEER_MESSAGE_ID_2 });
    expect(handle.snapshot().queued).toHaveLength(0);

    // Never-seen valid UUID — identical receipt echoing the requested id.
    const neverSeen = await deleteNodeQueue(app, STEER_MESSAGE_ID_3);
    expect(neverSeen.status).toBe(200);
    expect(await neverSeen.json()).toEqual({ success: true, message_id: STEER_MESSAGE_ID_3 });
    expect(handle.snapshot().queued).toHaveLength(0);
    expect(handle.snapshot().acceptedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/workflows/runs/:runId/nodes/:nodeId/queue — queue snapshot
// ---------------------------------------------------------------------------

function getNodeQueue(
  app: OpenAPIHono,
  headers: Record<string, string> = {},
  runId: string = STEER_RUN_ID,
  nodeId: string = STEER_NODE_ID
): Promise<Response> {
  return app.request(`/api/workflows/runs/${runId}/nodes/${nodeId}/queue`, {
    method: 'GET',
    headers,
  });
}

describe('GET /api/workflows/runs/:runId/nodes/:nodeId/queue — queue snapshot', () => {
  beforeEach(() => {
    getSteeringRegistry().clearForTests();
    mockGetWorkflowRun.mockReset();
    mockListWorkflowEvents.mockReset();
    mockListPendingInteractions.mockReset();
    mockFindOrCreateUserByPlatformIdentity.mockClear();
    mockCreateWorkflowEvent.mockClear();
    mockAddMessage.mockClear();
    mockUpdateWorkflowRun.mockClear();
    mockApiLogError.mockClear();
  });

  /** Running run + node_started projection + live registry handle. */
  function liveSetup(nodeId: string = STEER_NODE_ID): NodeSteeringHandle {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', nodeId)]);
    return getSteeringRegistry().register(STEER_RUN_ID, nodeId);
  }

  /** Reads must leave the queue, transcript, and run state untouched. */
  function expectNoSteeringMutation(
    handle: NodeSteeringHandle,
    before: SteeringHandleSnapshot
  ): void {
    const after = handle.snapshot();
    expect(after.phase).toBe(before.phase);
    expect(after.acceptedCount).toBe(before.acceptedCount);
    expect(after.queued).toEqual(before.queued);
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockUpdateWorkflowRun).not.toHaveBeenCalled();
  }

  async function expectSteeringError(res: Response, status: number, code: string): Promise<void> {
    expect(res.status).toBe(status);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  }

  // -- Snapshot shape ---------------------------------------------------------

  test('returns the exact two-field rows in receipt order for a live handle, with no-store', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID, 'first');
    queueSteerItem(handle, STEER_MESSAGE_ID_2, 'second');
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Exact wire shape: only message_id + message — no operator attribution,
    // no received_at, no accepted-id count, no handle phase.
    expect(await res.json()).toEqual({
      success: true,
      queued: [
        { message_id: STEER_MESSAGE_ID, message: 'first' },
        { message_id: STEER_MESSAGE_ID_2, message: 'second' },
      ],
    });
    expectNoSteeringMutation(handle, before);
  });

  test('returns an empty queue for a live handle with nothing pending', async () => {
    liveSetup();
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, queued: [] });
  });

  test('returns retained rows for a parked handle without changing its phase', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID, 'first');
    queueSteerItem(handle, STEER_MESSAGE_ID_2, 'second');
    handle.park();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      queued: [
        { message_id: STEER_MESSAGE_ID, message: 'first' },
        { message_id: STEER_MESSAGE_ID_2, message: 'second' },
      ],
    });
    expect(handle.snapshot().phase).toBe('parked');
    expectNoSteeringMutation(handle, before);
  });

  test('omits withdrawn and drained rows; accepted-id memory never reaches the wire', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID, 'first');
    queueSteerItem(handle, STEER_MESSAGE_ID_2, 'second');
    queueSteerItem(handle, STEER_MESSAGE_ID_3, 'third');
    handle.withdraw(STEER_MESSAGE_ID);
    const { app } = makeApp();

    const res = await getNodeQueue(app);
    expect(await res.json()).toEqual({
      success: true,
      queued: [
        { message_id: STEER_MESSAGE_ID_2, message: 'second' },
        { message_id: STEER_MESSAGE_ID_3, message: 'third' },
      ],
    });

    handle.drain();
    const drained = await getNodeQueue(app);
    expect(await drained.json()).toEqual({ success: true, queued: [] });
    // Accepted-id memory still counts the three enqueues, but that number is
    // registry-internal — the wire shape above has no field carrying it.
    expect(handle.snapshot().acceptedCount).toBe(3);
  });

  // -- Hot-path cost ----------------------------------------------------------

  test('live and parked 200s use one run lookup and no event/pending-interaction/message reads', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const { app } = makeApp();

    const live = await getNodeQueue(app);
    expect(live.status).toBe(200);
    expect(mockGetWorkflowRun).toHaveBeenCalledTimes(1);
    expect(mockGetWorkflowRun).toHaveBeenCalledWith(STEER_RUN_ID);
    expect(mockListWorkflowEvents).not.toHaveBeenCalled();
    expect(mockListPendingInteractions).not.toHaveBeenCalled();
    expect(mockAddMessage).not.toHaveBeenCalled();

    handle.park();
    mockGetWorkflowRun.mockClear();
    const parked = await getNodeQueue(app);
    expect(parked.status).toBe(200);
    expect(mockGetWorkflowRun).toHaveBeenCalledTimes(1);
    expect(mockListWorkflowEvents).not.toHaveBeenCalled();
    expect(mockListPendingInteractions).not.toHaveBeenCalled();
  });

  // -- Target/status ladder ----------------------------------------------------

  test('returns 404 for an unknown run', async () => {
    mockGetWorkflowRun.mockResolvedValue(null);
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    await expectSteeringError(res, 404, 'not_found');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mockListWorkflowEvents).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown node (no projection, no handle)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started', 'other-node')]);
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    await expectSteeringError(res, 404, 'not_found');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // The cold path reads the event projection to classify the node — but
    // never pending interactions and never a second run lookup.
    expect(mockListWorkflowEvents).toHaveBeenCalledTimes(1);
    expect(mockListPendingInteractions).not.toHaveBeenCalled();
    expect(mockGetWorkflowRun).toHaveBeenCalledTimes(1);
  });

  test('returns 409 for a terminal run even with a stale queued handle', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'completed' }));
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    const handle = getSteeringRegistry().register(STEER_RUN_ID, STEER_NODE_ID);
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    await expectSteeringError(res, 409, 'node_finished');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expectNoSteeringMutation(handle, before);
    expect(mockListWorkflowEvents).not.toHaveBeenCalled();
  });

  test('returns 409 for each terminal projected node state when no handle exists', async () => {
    const { app } = makeApp();
    for (const eventType of ['node_completed', 'node_failed', 'node_skipped']) {
      const nodeId = `node-${eventType}`;
      mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
      mockListWorkflowEvents.mockResolvedValue([steerEvent(eventType, nodeId)]);

      const res = await getNodeQueue(app, {}, STEER_RUN_ID, nodeId);

      await expectSteeringError(res, 409, 'node_finished');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('returns 409 for a closed handle without reading events', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    handle.close();
    const before = handle.snapshot();
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    await expectSteeringError(res, 409, 'node_finished');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expectNoSteeringMutation(handle, before);
    expect(mockListWorkflowEvents).not.toHaveBeenCalled();
  });

  test('returns 422 for a known running node with no in-process handle (detached)', async () => {
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    await expectSteeringError(res, 422, 'not_steerable_here');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mockListPendingInteractions).not.toHaveBeenCalled();
  });

  // -- Actor matrix -------------------------------------------------------------

  test('returns 200 for the run starter', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const { app } = makeApp();
    const res = await getNodeQueue(app, { 'X-Archon-User': STEER_STARTER_ID });

    expect(res.status).toBe(200);
  });

  test('returns 200 for another authenticated member identity', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    mockFindOrCreateUserByPlatformIdentity.mockImplementationOnce(
      async (_platform: string, platformUserId: string) => ({
        id: platformUserId,
        display_name: platformUserId,
        email: null,
        role: 'member' as const,
        created_at: new Date(),
        updated_at: new Date(),
      })
    );
    const { app } = makeApp();
    const res = await getNodeQueue(app, { 'X-Archon-User': 'member-other' });

    expect(res.status).toBe(200);
  });

  test('returns 200 for an admin identity that does not own the run', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const { app } = makeApp();
    const res = await getNodeQueue(app, { 'X-Archon-User': 'user-admin-9' });

    expect(res.status).toBe(200);
  });

  test('returns 200 on an identity-less (auth-disabled solo) install', async () => {
    const handle = liveSetup();
    queueSteerItem(handle, STEER_MESSAGE_ID);
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    expect(res.status).toBe(200);
  });

  test('returns the nested 401 before the generic API gate for a gated unauthenticated caller', async () => {
    // Resolve the auth singleton as "disabled" BEFORE flipping the env gate on —
    // getAuth() caches the resolution so no pg.Pool is constructed. The API
    // gate stays enabled: the queue-read middleware must run before it so the
    // nested steering contract wins.
    getAuth();
    const savedDb = process.env.DATABASE_URL;
    const savedSecret = process.env.BETTER_AUTH_SECRET;
    const savedRequired = process.env.ARCHON_WEB_AUTH_REQUIRED;
    process.env.DATABASE_URL = 'postgres://127.0.0.1:1/archon-test';
    process.env.BETTER_AUTH_SECRET = 's'.repeat(32);
    delete process.env.ARCHON_WEB_AUTH_REQUIRED;
    try {
      const { app } = makeApp();
      const res = await getNodeQueue(app);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        success: false,
        error: { code: 'unauthenticated', message: 'Authentication required' },
      });
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(mockGetWorkflowRun).not.toHaveBeenCalled();
      expect(mockListWorkflowEvents).not.toHaveBeenCalled();
    } finally {
      if (savedDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDb;
      if (savedSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = savedSecret;
      if (savedRequired === undefined) delete process.env.ARCHON_WEB_AUTH_REQUIRED;
      else process.env.ARCHON_WEB_AUTH_REQUIRED = savedRequired;
    }
  });

  // -- Validation and errors ----------------------------------------------------

  test('empty path segments do not match the router (no fabricated params validation)', async () => {
    // The params schema is declared and the steeringValidationErrorHook is
    // registered via registerOpenApiRoute, but an empty runId/nodeId segment
    // never reaches it — Hono's router requires a non-empty segment, so the
    // request falls to the generic 404 instead of the nested steering shape.
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    const { app } = makeApp();

    const res = await app.request('/api/workflows/runs//nodes/plan/queue', {
      method: 'GET',
    });
    expect(res.status).toBe(404);
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    expect(body?.success).not.toBe(false);
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  });

  test('returns nested 500 on a store exception and never logs queued-message text', async () => {
    const handle = liveSetup();
    const sentinel = 'sentinel-queue-text-do-not-log';
    queueSteerItem(handle, STEER_MESSAGE_ID, sentinel);
    const before = handle.snapshot();
    mockGetWorkflowRun.mockRejectedValue(new Error('run store down'));
    const { app } = makeApp();
    const res = await getNodeQueue(app);

    await expectSteeringError(res, 500, 'internal_error');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expectNoSteeringMutation(handle, before);

    // The failure log fires once with the content-free {err, runId, nodeId}
    // envelope — serializing every recorded call must not contain the queued
    // message text or a success event.
    const serialized = JSON.stringify(mockApiLogError.mock.calls);
    expect(serialized).toContain('api.workflow_node_queue_read_failed');
    expect(serialized).toContain(STEER_RUN_ID);
    expect(serialized).toContain(STEER_NODE_ID);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain('queue_read_completed');
  });

  // -- no-store on every outcome --------------------------------------------------

  test('every reachable outcome carries Cache-Control: no-store', async () => {
    const { app } = makeApp();

    // 404
    mockGetWorkflowRun.mockResolvedValue(null);
    expect((await getNodeQueue(app)).headers.get('cache-control')).toBe('no-store');

    // 409 — terminal run
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun({ status: 'failed' }));
    expect((await getNodeQueue(app)).headers.get('cache-control')).toBe('no-store');

    // 422 — running node, no handle
    mockGetWorkflowRun.mockResolvedValue(mockSteerableRun());
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    expect((await getNodeQueue(app)).headers.get('cache-control')).toBe('no-store');

    // 500 — event store throws on the cold path
    mockListWorkflowEvents.mockRejectedValue(new Error('event store down'));
    expect((await getNodeQueue(app)).headers.get('cache-control')).toBe('no-store');

    // 200 — live handle
    mockListWorkflowEvents.mockResolvedValue([steerEvent('node_started')]);
    getSteeringRegistry().register(STEER_RUN_ID, STEER_NODE_ID);
    expect((await getNodeQueue(app)).headers.get('cache-control')).toBe('no-store');
  });
});
