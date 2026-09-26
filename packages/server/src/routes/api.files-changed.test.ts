import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenAPIHono } from '@hono/zod-openapi';

import type { ConversationLockManager } from '@archon/core';
import type { ChangedFile } from '@archon/git';
import type { WorkflowNodeExecutionEvidence } from '@archon/workflows/store';
import type { WorkflowRun } from '@archon/workflows/schemas/workflow-run';

import type { WebAdapter } from '../adapters/web';
import { mockAllWorkflowModules } from '../test/workflow-mock-factories';
import { validationErrorHook } from './openapi-defaults';

const mockGetWorkflowRun = mock(async (_id: string): Promise<WorkflowRun | null> => null);
const mockGetConversationById = mock(
  async (_id: string): Promise<{ isolation_env_id: string | null } | null> => null
);
const mockGetById = mock(async (_id: string): Promise<{ provider: string } | null> => null);
const mockIsGitWorkTree = mock(async (_workingPath: string): Promise<boolean> => true);
const mockDiffCommitRange = mock(
  async (_workingPath: string, _from: string, _to: string): Promise<ChangedFile[]> => []
);
const mockListEvidence = mock(
  async (_runId: string): Promise<WorkflowNodeExecutionEvidence[]> => []
);

const mockLogger = {
  fatal: mock((_object?: unknown, _message?: string): void => undefined),
  error: mock((_object?: unknown, _message?: string): void => undefined),
  warn: mock((_object?: unknown, _message?: string): void => undefined),
  info: mock((_object?: unknown, _message?: string): void => undefined),
  debug: mock((_object?: unknown, _message?: string): void => undefined),
  trace: mock((_object?: unknown, _message?: string): void => undefined),
  child: mock(function (this: unknown): unknown {
    return this;
  }),
  bindings: mock((): Record<string, string> => ({ module: 'test' })),
  isLevelEnabled: mock((_level: string): boolean => true),
  level: 'info',
};

mock.module('@archon/core/db/workflows', () => ({
  getWorkflowRun: mockGetWorkflowRun,
}));
mock.module('@archon/core/db/conversations', () => ({
  getConversationById: mockGetConversationById,
}));
mock.module('@archon/core/db/isolation-environments', () => ({
  getById: mockGetById,
}));
mock.module('@archon/core/db/workflow-node-execution-evidence', () => ({
  listWorkflowNodeExecutionEvidenceForRun: mockListEvidence,
}));
mock.module('@archon/git', () => ({
  isGitWorkTree: mockIsGitWorkTree,
  diffCommitRange: mockDiffCommitRange,
}));
mock.module('@archon/paths', () => ({
  createLogger: (): typeof mockLogger => mockLogger,
}));
mockAllWorkflowModules();

import { registerApiRoutes } from './api';

let checkoutDir = '';

function runRow(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflow_name: 'test',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'running',
    user_message: 'test',
    metadata: {},
    started_at: new Date('2026-09-06T00:00:00.000Z'),
    completed_at: null,
    last_activity_at: null,
    working_path: checkoutDir,
    user_id: null,
    parent_run_id: null,
    output_root: null,
    ...overrides,
  };
}

function makeEvidence(
  overrides: Partial<WorkflowNodeExecutionEvidence> & { id: string; node_id: string }
): WorkflowNodeExecutionEvidence {
  return {
    workflow_run_id: 'run-1',
    retry_epoch: 0,
    start_checkpoint_ref: `refs/archon/evidence/run-1/${overrides.id}/start`,
    start_commit_sha: `${overrides.id}-start`,
    started_at: '2026-01-01T00:00:00.000Z',
    end_checkpoint_ref: `refs/archon/evidence/run-1/${overrides.id}/end`,
    end_commit_sha: `${overrides.id}-end`,
    ended_at: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const webAdapter = {
    setConversationDbId: mock((_platformId: string, _dbId: string): void => undefined),
    emitSSE: mock(async (): Promise<void> => undefined),
    emitLockEvent: mock(async (): Promise<void> => undefined),
  } as unknown as WebAdapter;
  const lockManager = {
    acquireLock: mock(async (_id: string, callback: () => Promise<void>) => {
      await callback();
      return { status: 'started' as const };
    }),
    getStats: mock(() => ({ active: 0, queued: 0 })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, webAdapter, lockManager);
  return app;
}

beforeEach(async () => {
  checkoutDir = await mkdtemp(join(tmpdir(), 'archon-files-changed-route-'));
  mockGetWorkflowRun.mockReset();
  mockGetConversationById.mockReset();
  mockGetById.mockReset();
  mockIsGitWorkTree.mockReset();
  mockDiffCommitRange.mockReset();
  mockListEvidence.mockReset();
  mockGetWorkflowRun.mockImplementation(async (): Promise<WorkflowRun> => runRow());
  mockGetConversationById.mockImplementation(
    async (): Promise<{ isolation_env_id: null }> => ({ isolation_env_id: null })
  );
  mockGetById.mockImplementation(async (): Promise<null> => null);
  mockIsGitWorkTree.mockImplementation(async (): Promise<boolean> => true);
  mockDiffCommitRange.mockImplementation(async (): Promise<ChangedFile[]> => []);
  mockListEvidence.mockImplementation(async (): Promise<WorkflowNodeExecutionEvidence[]> => []);
  mockLogger.info.mockClear();
  mockLogger.error.mockClear();
});

afterEach(async () => {
  await rm(checkoutDir, { recursive: true, force: true });
});

test('returns 404 for a missing run', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(null);
  const response = await makeApp().request('/api/workflows/runs/missing/files-changed');
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Workflow run not found' });
});

test('returns container CAP-6 before any git read', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });

  const response = await makeApp().request('/api/workflows/runs/run-1/files-changed');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'container', files: [] });
  expect(mockListEvidence).not.toHaveBeenCalled();
});

test('returns the approved empty state when no node execution proved any evidence', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/files-changed');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ files: [] });
  expect(mockDiffCommitRange).not.toHaveBeenCalled();
});

test('attributes a changed path to the node execution that proved it', async () => {
  mockListEvidence.mockResolvedValueOnce([
    makeEvidence({
      id: 'exec-1',
      node_id: 'build',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:05.000Z',
    }),
  ]);
  mockDiffCommitRange.mockImplementation(async (_workingPath, from, to) => {
    if (from === 'exec-1-start' && to === 'HEAD') return [{ path: 'src/a.ts', status: 'M' }];
    if (from === 'exec-1-start' && to === 'exec-1-end') return [{ path: 'src/a.ts', status: 'M' }];
    return [];
  });

  const response = await makeApp().request('/api/workflows/runs/run-1/files-changed');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    files: [
      {
        path: 'src/a.ts',
        status: 'M',
        executions: [
          {
            nodeId: 'build',
            retryEpoch: 0,
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:05.000Z',
          },
        ],
      },
    ],
  });
});

test('reports unknown for a changed path no evidence explains', async () => {
  mockListEvidence.mockResolvedValueOnce([
    makeEvidence({
      id: 'exec-1',
      node_id: 'build',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:05.000Z',
    }),
  ]);
  mockDiffCommitRange.mockImplementation(async (_workingPath, from, to) => {
    if (from === 'exec-1-start' && to === 'HEAD') return [{ path: 'src/mystery.ts', status: 'A' }];
    return [];
  });

  const response = await makeApp().request('/api/workflows/runs/run-1/files-changed');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    files: [{ path: 'src/mystery.ts', status: 'A', executions: [] }],
  });
});

test('returns an opaque 500 and logs no path-bearing error message', async () => {
  mockListEvidence.mockRejectedValueOnce(new Error(`boom at ${checkoutDir}/secret`));

  const response = await makeApp().request('/api/workflows/runs/run-1/files-changed');
  const body = await response.json();

  expect(response.status).toBe(500);
  expect(body).toEqual({ error: 'Could not read changed files' });
  expect(JSON.stringify(body)).not.toContain(checkoutDir);
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(checkoutDir);
});
