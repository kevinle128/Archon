import { mock, describe, test, expect, beforeEach, spyOn } from 'bun:test';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';
import type { WorkflowRun } from '@archon/workflows/schemas/workflow-run';
import type { QueryResult } from './adapters/types';

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));
const mockWithTransaction = mock(
  async <T>(fn: <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>): Promise<T> =>
    fn(mockQuery as <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>)
);
const mockDeleteRetryRefsByRunId = mock(async () => ({
  deletedRefs: [] as string[],
  warnings: [] as string[],
}));

// Mock the connection module before importing the module under test.
// `getDatabase().withTransaction` runs its callback against the SAME mockQuery,
// so a transactional function's statements land in mockQuery.mock.calls in
// order, exactly like the non-transactional ones.
mock.module('./connection', () => ({
  pool: {
    query: mockQuery,
  },
  getDatabase: () => ({
    query: mockQuery,
    withTransaction: mockWithTransaction,
    close: mock(() => Promise.resolve()),
    dialect: 'postgres',
    sql: mockPostgresDialect,
  }),
  getDialect: () => mockPostgresDialect,
  getDatabaseType: () => 'postgresql' as const,
}));

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
  deleteRetryRefsByRunId: mockDeleteRetryRefsByRunId,
  changedFiles: mock(async () => ({ files: [], revision: '0'.repeat(64) })),
  isGitWorkTree: mock(async () => false),
  log: mock(async () => ({ commits: [], revision: '0'.repeat(64), truncated: false })),
}));

import {
  createWorkflowRun,
  getWorkflowRun,
  getWorkflowRunStatus,
  getActiveWorkflowRun,
  getActiveWorkflowRunByPath,
  updateWorkflowRun,
  setWorkflowRunEnvOverlay,
  claimWorkflowRunForNodeRetry,
  completeWorkflowRun,
  failWorkflowRun,
  updateWorkflowActivity,
  resolveApprovalGate,
  resolveAndCancelApprovalGate,
  transitionPlannotatorGate,
  persistRouteDecisionTransition,
  WorkflowRouteDecisionStaleWriteError,
  findResumableRun,
  findResumableRunByParentConversation,
  resumeWorkflowRun,
  resumeApprovedGate,
  pauseWorkflowRun,
  cancelWorkflowRun,
  cancelRecoveryWorkflowRun,
  failOrphanedRuns,
  findChildRuns,
  getRunAncestry,
  listWorkflowRuns,
  deleteOldWorkflowRuns,
  deleteWorkflowRun,
  WorkflowNotResumableError,
} from './workflows';
import { getSteeringRegistry } from '@archon/workflows/steering-registry';
import type { EnvOverlaySnapshot } from '@archon/workflows/schemas/env-overlay';

const pendingAskRow = {
  id: 'pi-1',
  node_id: 'review',
  tool_use_id: 'toolu_1',
  kind: 'ask' as const,
};

function mockPendingAskThenPurge(): void {
  mockQuery
    .mockResolvedValueOnce(createQueryResult([pendingAskRow]))
    .mockResolvedValueOnce(createQueryResult([], 1))
    .mockResolvedValueOnce(createQueryResult([], 1));
}

function expectPurgedAskEvent(
  callIndex: number,
  terminalStatus: 'failed' | 'cancelled',
  runId = 'workflow-run-123'
): void {
  expect(mockQuery.mock.calls[callIndex]?.[0] as string).toContain(
    'FROM remote_agent_pending_interactions'
  );
  expect(mockQuery.mock.calls[callIndex]?.[0] as string).toContain("status = 'pending'");
  expect(mockQuery.mock.calls[callIndex + 1]?.[0] as string).toContain("status = 'purged'");
  expect(mockQuery.mock.calls[callIndex + 1]?.[1]).toEqual(['pi-1']);
  const eventSql = mockQuery.mock.calls[callIndex + 2]?.[0] as string;
  const eventParams = mockQuery.mock.calls[callIndex + 2]?.[1] as unknown[];
  expect(eventSql).toContain('INSERT INTO remote_agent_workflow_events');
  expect(eventParams[1]).toBe(runId);
  expect(eventParams[2]).toBe('interaction_resolved');
  expect(eventParams[4]).toBe('review');
  expect(JSON.parse(String(eventParams[5]))).toEqual({
    node_id: 'review',
    tool_use_id: 'toolu_1',
    kind: 'ask',
    purged: true,
    resumed: false,
    terminal_status: terminalStatus,
  });
}

describe('workflows database', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(() => Promise.resolve(createQueryResult([])));
    mockWithTransaction.mockReset();
    mockWithTransaction.mockImplementation(async fn =>
      fn(mockQuery as <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>)
    );
    mockDeleteRetryRefsByRunId.mockClear();
    mockDeleteRetryRefsByRunId.mockResolvedValue({ deletedRefs: [], warnings: [] });
  });

  const mockWorkflowRun: WorkflowRun = {
    id: 'workflow-run-123',
    workflow_name: 'feature-development',
    conversation_id: 'conv-456',
    parent_conversation_id: null,
    codebase_id: 'codebase-789',
    status: 'running',
    user_message: 'Add dark mode support',
    metadata: {},
    started_at: new Date('2025-01-01T00:00:00Z'),
    completed_at: null,
    last_activity_at: new Date('2025-01-01T00:00:00Z'),
    working_path: null,
  };

  describe('createWorkflowRun', () => {
    test('creates a new workflow run', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([mockWorkflowRun]));

      const result = await createWorkflowRun({
        workflow_name: 'feature-development',
        conversation_id: 'conv-456',
        codebase_id: 'codebase-789',
        user_message: 'Add dark mode support',
      });

      expect(result).toEqual(mockWorkflowRun);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO remote_agent_workflow_runs'),
        [
          'feature-development',
          'conv-456',
          'codebase-789',
          'Add dark mode support',
          '{}',
          null,
          null,
          null,
          null,
        ]
      );
    });

    test('creates workflow run with metadata', async () => {
      const runWithMetadata = {
        ...mockWorkflowRun,
        metadata: { github_context: 'Issue #42 context' },
      };
      mockQuery.mockResolvedValueOnce(createQueryResult([runWithMetadata]));

      const result = await createWorkflowRun({
        workflow_name: 'feature-development',
        conversation_id: 'conv-456',
        codebase_id: 'codebase-789',
        user_message: 'Add dark mode support',
        metadata: { github_context: 'Issue #42 context' },
      });

      expect(result.metadata).toEqual({ github_context: 'Issue #42 context' });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO remote_agent_workflow_runs'),
        [
          'feature-development',
          'conv-456',
          'codebase-789',
          'Add dark mode support',
          JSON.stringify({ github_context: 'Issue #42 context' }),
          null,
          null,
          null,
          null,
        ]
      );
    });

    test('creates workflow run without codebase_id', async () => {
      const runWithoutCodebase = { ...mockWorkflowRun, codebase_id: null };
      mockQuery.mockResolvedValueOnce(createQueryResult([runWithoutCodebase]));

      const result = await createWorkflowRun({
        workflow_name: 'feature-development',
        conversation_id: 'conv-456',
        user_message: 'Add dark mode support',
      });

      expect(result.codebase_id).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO remote_agent_workflow_runs'),
        [
          'feature-development',
          'conv-456',
          null,
          'Add dark mode support',
          '{}',
          null,
          null,
          null,
          null,
        ]
      );
    });
  });

  describe('getWorkflowRun', () => {
    test('returns workflow run by id', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([mockWorkflowRun]));

      const result = await getWorkflowRun('workflow-run-123');

      expect(result).toEqual(mockWorkflowRun);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM remote_agent_workflow_runs WHERE id = $1',
        ['workflow-run-123']
      );
    });

    test('returns null for non-existent workflow run', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await getWorkflowRun('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getWorkflowRunStatus', () => {
    test('returns status for existing workflow run', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([{ status: 'running' }]));

      const result = await getWorkflowRunStatus('workflow-run-123');

      expect(result).toBe('running');
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT status FROM remote_agent_workflow_runs WHERE id = $1',
        ['workflow-run-123']
      );
    });

    test('returns null for non-existent workflow run', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await getWorkflowRunStatus('non-existent');

      expect(result).toBeNull();
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(getWorkflowRunStatus('test-id')).rejects.toThrow(
        'Failed to get workflow run status: Connection refused'
      );
    });
  });

  describe('getActiveWorkflowRun', () => {
    test('returns active workflow run for conversation', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([mockWorkflowRun]));

      const result = await getActiveWorkflowRun('conv-456');

      expect(result).toEqual(mockWorkflowRun);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "(conversation_id = $1 OR parent_conversation_id = $2) AND status = 'running'"
        ),
        ['conv-456', 'conv-456']
      );
    });

    test('returns null when no active workflow run', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await getActiveWorkflowRun('conv-456');

      expect(result).toBeNull();
    });
  });

  describe('updateWorkflowRun', () => {
    test('updates status to completed', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateWorkflowRun('workflow-run-123', { status: 'completed' });

      const [query] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('status = $1');
      expect(query).toContain('completed_at = NOW()');
    });

    test('updates status to failed', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateWorkflowRun('workflow-run-123', { status: 'failed' });

      const [query] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('status = $1');
      expect(query).toContain('completed_at = NOW()');
    });

    test('updates metadata', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateWorkflowRun('workflow-run-123', { metadata: { lastStep: 'plan' } });

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('metadata = metadata ||'), [
        JSON.stringify({ lastStep: 'plan' }),
        'workflow-run-123',
      ]);
    });

    // output_root (#2200) is the durable pointer to a run's storage tree. It is
    // write-once at the DB layer via COALESCE so a caller that forgets the
    // null-guard cannot repoint a run mid-life and orphan its artifacts.
    test('writes output_root through COALESCE so the first value wins', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateWorkflowRun('workflow-run-123', { output_root: '/home/u/.archon/ws/acme/x' });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('output_root = COALESCE(output_root, $1)');
      expect(params).toEqual(['/home/u/.archon/ws/acme/x', 'workflow-run-123']);
    });

    test('output_root placeholder is numbered correctly alongside other fields', async () => {
      // The SET clause is built by hand with positional placeholders, so an
      // off-by-one here would silently bind the wrong value.
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateWorkflowRun('workflow-run-123', {
        status: 'running',
        metadata: { step: 'plan' },
        output_root: '/root/x',
      });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('status = $1');
      expect(query).toContain('output_root = COALESCE(output_root, $3)');
      expect(params).toEqual([
        'running',
        JSON.stringify({ step: 'plan' }),
        '/root/x',
        'workflow-run-123',
      ]);
    });

    test('omitting output_root leaves it out of the SET clause entirely', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateWorkflowRun('workflow-run-123', { status: 'completed' });

      const [query] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).not.toContain('output_root');
    });

    test('updates multiple fields', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await updateWorkflowRun('workflow-run-123', {
        status: 'running',
        metadata: { step: 'plan' },
      });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('status = $1');
      expect(query).toContain('metadata = metadata ||');
      expect(params).toEqual(['running', '{"step":"plan"}', 'workflow-run-123']);
    });

    test('does nothing when no updates provided', async () => {
      await updateWorkflowRun('workflow-run-123', {});

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('setWorkflowRunEnvOverlay', () => {
    const completeSnapshot: EnvOverlaySnapshot = {
      envId: 'env-1',
      envName: 'fast',
      workflowName: 'feature-development',
      patches: { plan: { model: 'claude-sonnet-4' } },
      skippedNodeIds: ['gone'],
      latestMissingNodeIds: [],
      resolved: {
        plan: { provider: 'claude', model: 'claude-sonnet-4' },
        stale: { provider: 'claude', model: 'old-model' },
      },
    };

    const secondSnapshot: EnvOverlaySnapshot = {
      envId: 'env-1',
      envName: 'fast',
      workflowName: 'feature-development',
      patches: { plan: { model: 'claude-opus-4' } },
      skippedNodeIds: ['gone'],
      latestMissingNodeIds: ['plan'],
      resolved: {
        plan: { provider: 'claude', model: 'claude-opus-4' },
      },
    };

    test('uses jsonb_set on PostgreSQL and returns the updated run from one transaction', async () => {
      const returned = {
        ...mockWorkflowRun,
        metadata: {
          sibling: true,
          envOverlay: secondSnapshot,
        },
      };
      mockQuery
        .mockResolvedValueOnce(createQueryResult([], 1))
        .mockResolvedValueOnce(createQueryResult([returned]));

      const result = await setWorkflowRunEnvOverlay('workflow-run-123', secondSnapshot);

      expect(result).toEqual(returned);
      const [updateSql, updateParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateSql).toContain(
        "jsonb_set(COALESCE(metadata, '{}'::jsonb), '{envOverlay}', $1::jsonb, true)"
      );
      expect(updateSql).toContain('WHERE id = $2');
      expect(updateSql).not.toContain('RETURNING');
      expect(updateParams).toEqual([JSON.stringify(secondSnapshot), 'workflow-run-123']);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'SELECT * FROM remote_agent_workflow_runs WHERE id = $1',
        ['workflow-run-123']
      );
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });

    test('throws when no run row is affected', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(setWorkflowRunEnvOverlay('missing-run', completeSnapshot)).rejects.toThrow(
        'Workflow run not found (id: missing-run)'
      );
    });

    test('rejects invalid snapshots before writing', async () => {
      await expect(
        setWorkflowRunEnvOverlay('workflow-run-123', {
          envId: 'env-1',
          // missing required complete fields
          patches: {},
        } as unknown as EnvOverlaySnapshot)
      ).rejects.toThrow();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('persistRouteDecisionTransition', () => {
    const nextRouteMetadata = {
      loopCounters: { 'review-router': 1 },
      nodeAttempts: { 'review-router': 1 },
      executionSeq: 1,
      routeActivations: {
        fix: {
          route_loop_node_id: 'review-router',
          outcome: 'negative',
          target_node_id: 'fix',
          attempt: 1,
          execution_seq: 1,
        },
      },
    };
    const eventData = {
      sources: ['review'],
      outcome: 'negative',
      to: 'fix',
      condition: "$review.output.result == '<redacted>'",
      condition_result: false,
      negative_count: 1,
      max_iterations: 10,
      attempt: 1,
      execution_seq: 1,
    };

    test('atomically writes route metadata and route node events in one transaction', async () => {
      const updatedRun = { ...mockWorkflowRun, metadata: nextRouteMetadata };
      mockQuery
        .mockResolvedValueOnce(createQueryResult([{ ...mockWorkflowRun, metadata: {} }]))
        .mockResolvedValueOnce(createQueryResult([updatedRun]))
        .mockResolvedValueOnce(createQueryResult([], 1))
        .mockResolvedValueOnce(createQueryResult([], 1));

      const result = await persistRouteDecisionTransition({
        workflow_run_id: 'workflow-run-123',
        expected_execution_seq: 0,
        metadata: nextRouteMetadata,
        event: {
          step_name: 'review-router',
          data: eventData,
        },
        completed_event: {
          step_name: 'review-router',
          data: { node_output: JSON.stringify(eventData) },
        },
      });

      expect(result).toEqual(updatedRun);
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        'SELECT * FROM remote_agent_workflow_runs WHERE id = $1 FOR UPDATE',
        ['workflow-run-123']
      );

      const [updateSql, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE remote_agent_workflow_runs');
      expect(updateSql).toContain('metadata = metadata || $2::jsonb');
      expect(updateSql).toContain('RETURNING *');
      expect(updateParams).toEqual(['workflow-run-123', JSON.stringify(nextRouteMetadata)]);

      const [routedInsertSql, routedInsertParams] = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(routedInsertSql).toContain('INSERT INTO remote_agent_workflow_events');
      expect(routedInsertParams.slice(1)).toEqual([
        'workflow-run-123',
        'node_routed',
        null,
        'review-router',
        JSON.stringify(eventData),
      ]);

      const [completedInsertSql, completedInsertParams] = mockQuery.mock.calls[3] as [
        string,
        unknown[],
      ];
      expect(completedInsertSql).toContain('INSERT INTO remote_agent_workflow_events');
      expect(completedInsertParams.slice(1)).toEqual([
        'workflow-run-123',
        'node_completed',
        null,
        'review-router',
        JSON.stringify({ node_output: JSON.stringify(eventData) }),
      ]);
    });

    test('rolls back route metadata when the node_routed event write fails', async () => {
      const updatedRun = { ...mockWorkflowRun, metadata: nextRouteMetadata };
      mockQuery
        .mockResolvedValueOnce(createQueryResult([{ ...mockWorkflowRun, metadata: {} }]))
        .mockResolvedValueOnce(createQueryResult([updatedRun]))
        .mockRejectedValueOnce(new Error('event insert failed'));

      await expect(
        persistRouteDecisionTransition({
          workflow_run_id: 'workflow-run-123',
          expected_execution_seq: 0,
          metadata: nextRouteMetadata,
          event: {
            step_name: 'review-router',
            data: eventData,
          },
          completed_event: {
            step_name: 'review-router',
            data: { node_output: JSON.stringify(eventData) },
          },
        })
      ).rejects.toThrow('Failed to persist route decision transition: event insert failed');

      const sqlCalls = mockQuery.mock.calls.map(call => call[0] as string);
      expect(sqlCalls.some(sql => sql.includes('UPDATE remote_agent_workflow_runs'))).toBe(true);
      expect(sqlCalls.some(sql => sql.includes('INSERT INTO remote_agent_workflow_events'))).toBe(
        true
      );
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });

    test('rejects stale route decision writes before mutating metadata or events', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ ...mockWorkflowRun, metadata: { executionSeq: 2 } }])
      );

      await expect(
        persistRouteDecisionTransition({
          workflow_run_id: 'workflow-run-123',
          expected_execution_seq: 1,
          metadata: nextRouteMetadata,
          event: {
            step_name: 'review-router',
            data: eventData,
          },
          completed_event: {
            step_name: 'review-router',
            data: { node_output: JSON.stringify(eventData) },
          },
        })
      ).rejects.toThrow(WorkflowRouteDecisionStaleWriteError);

      const sqlCalls = mockQuery.mock.calls.map(call => call[0] as string);
      expect(sqlCalls.some(sql => sql.includes('UPDATE remote_agent_workflow_runs'))).toBe(false);
      expect(sqlCalls.some(sql => sql.includes('INSERT INTO remote_agent_workflow_events'))).toBe(
        false
      );
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });

    test('rolls back malformed existing route metadata before mutating state', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ ...mockWorkflowRun, metadata: { executionSeq: 1.5 } }])
      );

      await expect(
        persistRouteDecisionTransition({
          workflow_run_id: 'workflow-run-123',
          expected_execution_seq: 1,
          metadata: nextRouteMetadata,
          event: {
            step_name: 'review-router',
            data: eventData,
          },
          completed_event: {
            step_name: 'review-router',
            data: { node_output: JSON.stringify(eventData) },
          },
        })
      ).rejects.toThrow('Failed to persist route decision transition');

      const sqlCalls = mockQuery.mock.calls.map(call => call[0] as string);
      expect(sqlCalls.some(sql => sql.includes('UPDATE remote_agent_workflow_runs'))).toBe(false);
      expect(sqlCalls.some(sql => sql.includes('INSERT INTO remote_agent_workflow_events'))).toBe(
        false
      );
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Plannotator gate transactions', () => {
    const approval = {
      nodeId: 'review',
      message: 'Review the plan',
      type: 'plannotator_gate' as const,
      gateId: 'gate-a',
      document: '/tmp/plan.md',
      phase: 'waiting_decision' as const,
      resolved: null,
    };

    test('locks and replaces the nested approval for a phase transition', async () => {
      mockQuery
        .mockResolvedValueOnce(
          createQueryResult([{ ...mockWorkflowRun, status: 'paused', metadata: { approval } }])
        )
        .mockResolvedValueOnce(createQueryResult([], 1));

      const result = await transitionPlannotatorGate({
        runId: 'workflow-run-123',
        nodeId: 'review',
        expectedGateId: 'gate-a',
        nextGateId: 'gate-b',
        document: '/tmp/reworked-plan.md',
        phase: 'opening',
        reviewUrl: 'https://mac-mini.example.ts.net:19432',
      });

      expect(result).toEqual({
        outcome: 'updated',
        approval: {
          ...approval,
          gateId: 'gate-b',
          document: '/tmp/reworked-plan.md',
          phase: 'opening',
          reviewUrl: 'https://mac-mini.example.ts.net:19432',
          reviewSessionId: null,
          feedbackSubmission: null,
          decisionClaim: null,
        },
      });
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        'SELECT * FROM remote_agent_workflow_runs WHERE id = $1 FOR UPDATE',
        ['workflow-run-123']
      );
      const [updateSql, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain('metadata = metadata || $2::jsonb');
      expect(updateParams).toEqual([
        'workflow-run-123',
        JSON.stringify({
          approval: {
            ...approval,
            gateId: 'gate-b',
            document: '/tmp/reworked-plan.md',
            phase: 'opening',
            reviewUrl: 'https://mac-mini.example.ts.net:19432',
            reviewSessionId: null,
            feedbackSubmission: null,
            decisionClaim: null,
          },
          reviewFeedbackReceipts: {},
        }),
      ]);
    });

    test('writes resolution metadata and audit events only for the winning identity', async () => {
      mockQuery
        .mockResolvedValueOnce(
          createQueryResult([{ ...mockWorkflowRun, status: 'paused', metadata: { approval } }])
        )
        .mockResolvedValueOnce(createQueryResult([], 1))
        .mockResolvedValueOnce(createQueryResult([], 1));

      const metadata = { approval: { ...approval, resolved: 'approved' as const } };
      expect(
        (
          await resolveApprovalGate(
            'workflow-run-123',
            { nodeId: 'review', gateId: 'gate-a' },
            metadata,
            [
              {
                event_type: 'approval_received',
                step_name: 'review',
                data: { decision: 'approved' },
              },
            ]
          )
        ).resolved
      ).toBe(true);

      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        'SELECT * FROM remote_agent_workflow_runs WHERE id = $1 FOR UPDATE',
        ['workflow-run-123']
      );
      const [updateSql, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain("status = 'paused'");
      expect(updateParams).toEqual(['workflow-run-123', JSON.stringify(metadata)]);
      expect(mockQuery.mock.calls[2]?.[0] as string).toContain(
        'INSERT INTO remote_agent_workflow_events'
      );

      mockQuery.mockClear();
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockWorkflowRun,
            status: 'paused',
            metadata: { approval: { ...approval, gateId: 'gate-b' } },
          },
        ])
      );

      expect(
        (
          await resolveApprovalGate(
            'workflow-run-123',
            { nodeId: 'review', gateId: 'gate-a' },
            metadata,
            [
              {
                event_type: 'approval_received',
                step_name: 'review',
                data: { decision: 'approved' },
              },
            ]
          )
        ).resolved
      ).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('locks and rejects a stale terminal resolver before any mutation', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockWorkflowRun,
            status: 'paused',
            metadata: { approval: { ...approval, gateId: 'gate-b' } },
          },
        ])
      );

      const outcome = await resolveAndCancelApprovalGate(
        'workflow-run-123',
        { nodeId: 'review', gateId: 'gate-a' },
        [
          {
            event_type: 'approval_received',
            step_name: 'review',
            data: { decision: 'rejected' },
          },
        ]
      );

      expect(outcome.resolved).toBe(false);
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM remote_agent_workflow_runs WHERE id = $1 FOR UPDATE',
        ['workflow-run-123']
      );
    });

    test('cancels and audits only after the locked terminal identity matches', async () => {
      mockQuery
        .mockResolvedValueOnce(
          createQueryResult([{ ...mockWorkflowRun, status: 'paused', metadata: { approval } }])
        )
        .mockResolvedValueOnce(createQueryResult([], 1))
        .mockResolvedValueOnce(createQueryResult([], 1));

      const outcome = await resolveAndCancelApprovalGate(
        'workflow-run-123',
        { nodeId: 'review', gateId: 'gate-a' },
        [
          {
            event_type: 'approval_received',
            step_name: 'review',
            data: { decision: 'rejected' },
          },
        ]
      );

      expect(outcome.resolved).toBe(true);
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        'SELECT * FROM remote_agent_workflow_runs WHERE id = $1 FOR UPDATE',
        ['workflow-run-123']
      );
      const [updateSql, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain("SET status = 'cancelled'");
      expect(updateSql).toContain("status = 'paused'");
      expect(updateParams).toEqual(['workflow-run-123']);
      expect(mockQuery.mock.calls[2]?.[0] as string).toContain(
        'INSERT INTO remote_agent_workflow_events'
      );
      expect(mockQuery.mock.calls[3]?.[0] as string).toContain(
        'FROM remote_agent_pending_interactions'
      );
    });

    test('purges pending interactions after a winning reject+cancel', async () => {
      mockQuery
        .mockResolvedValueOnce(
          createQueryResult([{ ...mockWorkflowRun, status: 'paused', metadata: { approval } }])
        )
        .mockResolvedValueOnce(createQueryResult([], 1))
        .mockResolvedValueOnce(createQueryResult([], 1));
      mockPendingAskThenPurge();

      const outcome = await resolveAndCancelApprovalGate(
        'workflow-run-123',
        { nodeId: 'review', gateId: 'gate-a' },
        [
          {
            event_type: 'approval_received',
            step_name: 'review',
            data: { decision: 'rejected' },
          },
        ]
      );

      expect(outcome.resolved).toBe(true);
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expectPurgedAskEvent(3, 'cancelled');
    });
  });

  describe('claimWorkflowRunForNodeRetry', () => {
    test('claims a retryable run, clears completion, and increments metadata retry_epoch in one CAS update', async () => {
      const claimedRun = {
        ...mockWorkflowRun,
        status: 'running' as const,
        metadata: { retry_epoch: 3 },
        completed_at: null,
      };
      mockQuery
        .mockResolvedValueOnce(createQueryResult([], 1))
        .mockResolvedValueOnce(createQueryResult([claimedRun]));

      const result = await claimWorkflowRunForNodeRetry('workflow-run-123');

      expect(result).toEqual(claimedRun);
      const [updateSql, updateParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateSql).toContain("SET status = 'running'");
      expect(updateSql).toContain('completed_at = NULL');
      expect(updateSql).toContain("jsonb_set(\n         COALESCE(metadata, '{}'::jsonb)");
      expect(updateSql).toContain(
        "WHERE id = $1 AND status IN ('failed', 'cancelled', 'completed')"
      );
      expect(updateParams).toEqual(['workflow-run-123']);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'SELECT * FROM remote_agent_workflow_runs WHERE id = $1',
        ['workflow-run-123']
      );
    });

    test('throws retry claim conflict when the retryable -> running CAS misses', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([], 0))
        .mockResolvedValueOnce(createQueryResult([{ status: 'running' }]));

      await expect(claimWorkflowRunForNodeRetry('workflow-run-123')).rejects.toThrow(
        'not retry-claimable'
      );
    });
  });

  describe('pauseWorkflowRun', () => {
    test('pauses a running run and resets the gate resolution marker', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await pauseWorkflowRun('workflow-run-123', {
        nodeId: 'review',
        message: 'Please review',
        type: 'approval',
      });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("status = 'paused'");
      expect(query).toContain("AND status = 'running'");
      // resolved must be an EXPLICIT null on every fresh pause: SQLite's
      // json_patch deep-merges the new approval context into the stored one, so
      // an omitted key would let a stale 'approved' from the previous gate
      // survive and falsely block this gate (#2075).
      const payload = JSON.parse(params[1] as string) as {
        approval: Record<string, unknown>;
      };
      expect(payload.approval.resolved).toBeNull();
      expect(payload.approval.nodeId).toBe('review');
      // completionSignaled/signaledOutput follow the same explicit-null rule
      // (#2074): standard approval pauses never set them, so they must be
      // written as null (never omitted — JSON.stringify drops undefined and
      // SQLite would keep a stale value from a previous interactive-loop gate).
      expect(payload.approval.completionSignaled).toBeNull();
      expect(payload.approval.signaledOutput).toBeNull();
      // commandSnapshot (command-backed interactive loops) follows the same
      // rule — a stale snapshot from a prior loop gate must never survive
      // into an unrelated pause.
      expect(payload.approval.commandSnapshot).toBeNull();
      // A stale Plannotator URL must not leak into a later approval gate.
      expect(payload.approval.reviewUrl).toBeNull();
    });

    test('preserves completionSignaled/signaledOutput when the gate provides them (#2074)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await pauseWorkflowRun('workflow-run-123', {
        nodeId: 'refine',
        message: 'gate',
        type: 'interactive_loop',
        iteration: 1,
        completionSignaled: true,
        signaledOutput: 'REPORT',
        commandSnapshot: 'Loaded command body',
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      const payload = JSON.parse(params[1] as string) as {
        approval: Record<string, unknown>;
      };
      expect(payload.approval.completionSignaled).toBe(true);
      expect(payload.approval.signaledOutput).toBe('REPORT');
      expect(payload.approval.commandSnapshot).toBe('Loaded command body');
      expect(payload.approval.resolved).toBeNull();
    });

    test('throws when the run is not running', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(
        pauseWorkflowRun('workflow-run-123', { nodeId: 'review', message: 'Please review' })
      ).rejects.toThrow('not found or not in running state');
    });

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
  });

  describe('completeWorkflowRun', () => {
    test('marks workflow run as completed', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await completeWorkflowRun('workflow-run-123');

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'completed'"), [
        'workflow-run-123',
      ]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('completed_at = NOW()'), [
        'workflow-run-123',
      ]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("AND status = 'running'"), [
        'workflow-run-123',
      ]);
    });

    test('does not purge pending interactions', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await completeWorkflowRun('workflow-run-123');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(String(mockQuery.mock.calls[0]?.[0])).not.toContain('pending_interactions');
    });

    test('throws when rowCount is 0', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(completeWorkflowRun('workflow-run-123')).rejects.toThrow(
        'not found or not in running state'
      );
    });

    test('merges metadata when provided', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      const metadata = { node_counts: { completed: 3, failed: 1, skipped: 0, total: 4 } };
      const expectedMetadataSql =
        "metadata = (COALESCE(metadata, '{}'::jsonb) || $2::jsonb) - 'error'";

      await completeWorkflowRun('workflow-run-123', metadata);

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("status = 'completed'");
      expect(query).toContain(expectedMetadataSql);
      expect(params).toEqual(['workflow-run-123', JSON.stringify(metadata)]);
    });

    test('clears stale failure error when metadata is provided', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      const metadata = { node_counts: { completed: 4, failed: 0, skipped: 0, total: 4 } };
      const expectedMetadataSql =
        "metadata = (COALESCE(metadata, '{}'::jsonb) || $2::jsonb) - 'error'";

      await completeWorkflowRun('workflow-run-123', metadata);

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain(expectedMetadataSql);
      expect(params).toEqual(['workflow-run-123', JSON.stringify(metadata)]);
    });

    test('clears stale failure error when no metadata is provided', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await completeWorkflowRun('workflow-run-123');

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("metadata = (COALESCE(metadata, '{}'::jsonb)) - 'error'");
      expect(params).toEqual(['workflow-run-123']);
    });
  });

  describe('failWorkflowRun', () => {
    test('marks workflow run as failed with error', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await failWorkflowRun('workflow-run-123', 'Step not found: missing.md');

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), [
        'workflow-run-123',
        JSON.stringify({ error: 'Step not found: missing.md' }),
      ]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('completed_at = NOW()'),
        expect.any(Array)
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("AND status IN ('running', 'pending')"),
        expect.any(Array)
      );
    });

    test('stores error in metadata', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await failWorkflowRun('workflow-run-123', 'Timeout exceeded');

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params).toContain(JSON.stringify({ error: 'Timeout exceeded' }));
    });

    test('throws when rowCount is 0', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(failWorkflowRun('workflow-run-123', 'some error')).rejects.toThrow(
        'not found or not in running/pending state'
      );
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(String(mockQuery.mock.calls[0]?.[0])).not.toContain('pending_interactions');
    });

    test('purges pending interactions after a winning fail update', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockPendingAskThenPurge();

      await failWorkflowRun('workflow-run-123', 'Step not found: missing.md');

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0]?.[0] as string).toContain("status = 'failed'");
      expectPurgedAskEvent(1, 'failed');
    });
  });

  describe('error handling', () => {
    test('createWorkflowRun throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        createWorkflowRun({
          workflow_name: 'test',
          conversation_id: 'conv',
          user_message: 'test',
        })
      ).rejects.toThrow('Failed to create workflow run: Connection refused');
    });

    test('getWorkflowRun throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Timeout'));

      await expect(getWorkflowRun('test-id')).rejects.toThrow(
        'Failed to get workflow run: Timeout'
      );
    });

    test('getActiveWorkflowRun throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Invalid query'));

      await expect(getActiveWorkflowRun('conv-123')).rejects.toThrow(
        'Failed to get active workflow run: Invalid query'
      );
    });

    test('updateWorkflowRun throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Update failed'));

      await expect(updateWorkflowRun('test-id', { status: 'completed' })).rejects.toThrow(
        'Failed to update workflow run: Update failed'
      );
    });

    test('completeWorkflowRun throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database locked'));

      await expect(completeWorkflowRun('test-id')).rejects.toThrow(
        'Failed to complete workflow run: Database locked'
      );
    });

    test('failWorkflowRun throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Network error'));

      await expect(failWorkflowRun('test-id', 'Some error')).rejects.toThrow(
        'Failed to fail workflow run: Network error'
      );
    });
  });

  describe('metadata serialization', () => {
    test('throws when critical github_context metadata fails to serialize', async () => {
      // Create metadata with a circular reference
      const circularObj: Record<string, unknown> = { github_context: 'Issue context' };
      circularObj.self = circularObj;

      await expect(
        createWorkflowRun({
          workflow_name: 'test',
          conversation_id: 'conv',
          user_message: 'test',
          metadata: circularObj,
        })
      ).rejects.toThrow('Failed to serialize workflow metadata');
    });

    test('falls back to empty object for non-critical metadata serialization failure', async () => {
      // Create metadata WITHOUT github_context but with circular reference
      const circularObj: Record<string, unknown> = { someKey: 'value' };
      circularObj.self = circularObj;

      mockQuery.mockResolvedValueOnce(createQueryResult([{ ...mockWorkflowRun, metadata: {} }]));

      const result = await createWorkflowRun({
        workflow_name: 'test',
        conversation_id: 'conv',
        user_message: 'test',
        metadata: circularObj,
      });

      // Should succeed with empty metadata fallback
      expect(result.metadata).toEqual({});
      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBe('{}');
    });

    test('serializes github_context metadata successfully under normal conditions', async () => {
      const runWithContext = {
        ...mockWorkflowRun,
        metadata: { github_context: 'Issue #99: Fix bug' },
      };
      mockQuery.mockResolvedValueOnce(createQueryResult([runWithContext]));

      const result = await createWorkflowRun({
        workflow_name: 'test',
        conversation_id: 'conv',
        user_message: 'test',
        metadata: { github_context: 'Issue #99: Fix bug' },
      });

      expect(result.metadata).toEqual({ github_context: 'Issue #99: Fix bug' });
    });
  });

  describe('updateWorkflowActivity', () => {
    test('updates last_activity_at timestamp', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await updateWorkflowActivity('workflow-run-123');

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE remote_agent_workflow_runs SET last_activity_at = NOW() WHERE id = $1',
        ['workflow-run-123']
      );
    });

    test('throws on database error so callers can track failures', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection lost'));

      // Should throw - callers (executor) handle failure tracking
      await expect(updateWorkflowActivity('workflow-run-123')).rejects.toThrow('Connection lost');

      // Verify the query was attempted
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('findResumableRun', () => {
    test('returns the most recent failed run matching workflow name and path', async () => {
      const failedRun = {
        ...mockWorkflowRun,
        status: 'failed' as const,
        working_path: '/repo/path',
      };
      mockQuery.mockResolvedValueOnce(createQueryResult([failedRun]));

      const result = await findResumableRun('feature-development', '/repo/path');

      expect(result).toEqual(failedRun);
      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("status IN ('failed', 'paused', 'cancelled')");
      expect(query).toContain('working_path = $2');
      expect(query).not.toContain('conversation_id');
      expect(query).toContain('ORDER BY started_at DESC');
      expect(query).not.toMatch(/--.*\$\d/); // regression guard for #999: $N in SQL comments breaks convertPlaceholders
      expect(params).toEqual(['feature-development', '/repo/path', 1]);
    });

    test('returns a stale running run (no activity for >1 day)', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const staleRun = {
        ...mockWorkflowRun,
        status: 'running' as const,
        working_path: '/repo/path',
        last_activity_at: twoDaysAgo,
      };
      mockQuery.mockResolvedValueOnce(createQueryResult([staleRun]));

      const result = await findResumableRun('feature-development', '/repo/path');

      expect(result).toEqual(staleRun);
      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("status = 'running'");
      expect(query).toContain('last_activity_at');
      expect(params).toEqual(['feature-development', '/repo/path', 1]);
    });

    test('returns a running run with null last_activity_at (never recorded activity)', async () => {
      const staleRun = {
        ...mockWorkflowRun,
        status: 'running' as const,
        working_path: '/repo/path',
        last_activity_at: null,
      };
      mockQuery.mockResolvedValueOnce(createQueryResult([staleRun]));

      const result = await findResumableRun('feature-development', '/repo/path');

      expect(result).toEqual(staleRun);
      const [query] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('last_activity_at IS NULL');
    });

    test('returns null when no resumable run exists', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await findResumableRun('feature-development', '/repo/path');

      expect(result).toBeNull();
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(findResumableRun('test', '/path')).rejects.toThrow(
        'Failed to find resumable run: Connection refused'
      );
    });
  });

  describe('findResumableRunByParentConversation', () => {
    test('scopes by workflow name, parent conversation and codebase', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([mockWorkflowRun]));

      const result = await findResumableRunByParentConversation('piv', 'conv-1', 'codebase-789');

      expect(result).toEqual(mockWorkflowRun);
      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('workflow_name = $1');
      expect(query).toContain('parent_conversation_id = $2');
      expect(query).toContain('codebase_id = $3');
      expect(params).toEqual(['piv', 'conv-1', 'codebase-789']);
    });

    test('prefers a paused run over a newer failed one (paused-first ordering)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await findResumableRunByParentConversation('piv', 'conv-1', 'cb');

      const [query] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("status IN ('failed', 'paused', 'cancelled')");
      // Status is the primary sort key: an open gate auto-resumes, while a
      // failed candidate is gated behind an explicit user prompt. Ordering by
      // started_at alone lets a newer failure shadow an older waiting gate.
      expect(query).toContain(
        "ORDER BY CASE WHEN status = 'paused' THEN 0 WHEN status = 'failed' THEN 1 ELSE 2 END"
      );
      // Recency still breaks ties within a status.
      expect(query).toContain('started_at DESC');
    });

    test('returns null when no run matches', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await findResumableRunByParentConversation('piv', 'conv-1', 'cb');

      expect(result).toBeNull();
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(findResumableRunByParentConversation('piv', 'conv-1', 'cb')).rejects.toThrow(
        'Failed to find resumable run by parent conversation: Connection refused'
      );
    });
  });

  describe('getActiveWorkflowRunByPath', () => {
    test('returns active or failed run for the given working path', async () => {
      const activeRun = { ...mockWorkflowRun, working_path: '/repo/path' };
      mockQuery.mockResolvedValueOnce(createQueryResult([activeRun]));

      const result = await getActiveWorkflowRunByPath('/repo/path');

      expect(result).toEqual(activeRun);
      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("status IN ('running', 'paused')");
      expect(query).toContain('working_path = $1');
      expect(params).toEqual(['/repo/path']);
    });

    test('includes pending rows within the stale-pending age window', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await getActiveWorkflowRunByPath('/repo/path');

      const [query] = mockQuery.mock.calls[0] as [string, unknown[]];
      // Fresh `pending` counts as active so the lock is held immediately
      // after pre-create — without this, two near-simultaneous dispatches
      // both pass the guard.
      expect(query).toContain("status = 'pending'");
      // Age window cutoff prevents orphaned pending rows (from crashed
      // dispatches) from permanently blocking a path.
      expect(query).toMatch(/started_at >.*INTERVAL.*milliseconds/);
    });

    test('excludes self and applies older-wins tiebreaker when self is provided', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      const startedAt = new Date('2026-04-14T10:00:00Z');

      await getActiveWorkflowRunByPath('/repo/path', { id: 'self-id', startedAt });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('id != $2');
      // PostgreSQL branch: explicit `::timestamptz` cast on the param so
      // the comparison is chronological, not lexical. SQLite branch wraps
      // both sides in datetime() — covered by tests in adapters/sqlite.test.ts
      // because this suite mocks getDatabaseType as 'postgresql'.
      expect(query).toContain('started_at < $3::timestamptz');
      expect(query).toContain('started_at = $3::timestamptz AND id < $2');
      // selfStartedAt serialized to ISO — bun:sqlite rejects Date bindings.
      expect(params).toEqual(['/repo/path', 'self-id', startedAt.toISOString()]);
    });

    test('skips self exclusion + tiebreaker when self is omitted (no caller context)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await getActiveWorkflowRunByPath('/repo/path');

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // Without `self`, neither the id-exclusion nor the tiebreaker apply.
      expect(query).not.toContain('id !=');
      expect(query).not.toContain('started_at <');
      expect(params).toEqual(['/repo/path']);
    });

    test('orders by (started_at ASC, id ASC) so older-wins is deterministic', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await getActiveWorkflowRunByPath('/repo/path');

      const [query] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('ORDER BY started_at ASC, id ASC');
    });

    test('returns null when no active run on path', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await getActiveWorkflowRunByPath('/repo/path');

      expect(result).toBeNull();
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(getActiveWorkflowRunByPath('/repo/path')).rejects.toThrow(
        'Failed to get active workflow run by path: Connection refused'
      );
    });

    // #2121 Phase 2: the ancestor chain of a shared-checkout sub-run must not
    // count as a lock — each id gets its own positional placeholder (no array
    // binding, works on both dialects).
    test('excludes ancestor run ids via NOT IN with positional placeholders', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      const startedAt = new Date('2026-04-14T10:00:00Z');

      await getActiveWorkflowRunByPath('/repo/path', {
        id: 'child-id',
        startedAt,
        excludeRunIds: ['parent-id', 'grandparent-id'],
      });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('id != $2');
      expect(query).toContain('id NOT IN ($3, $4)');
      // The tiebreaker's id comparison must reference SELF ($2) — a positional
      // back-reference once pointed it at $4 (an ancestor id) when excludeRunIds
      // params landed between the self id and startedAt.
      expect(query).toContain('started_at = $5::timestamptz AND id < $2');
      expect(params).toEqual([
        '/repo/path',
        'child-id',
        'parent-id',
        'grandparent-id',
        startedAt.toISOString(),
      ]);
    });

    test('omits the NOT IN clause when excludeRunIds is empty', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await getActiveWorkflowRunByPath('/repo/path', {
        id: 'child-id',
        startedAt: new Date(),
        excludeRunIds: [],
      });

      const [query] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).not.toContain('NOT IN');
    });
  });

  describe('findChildRuns', () => {
    test('selects by parent_run_id ordered oldest-first', async () => {
      const child = { ...mockWorkflowRun, id: 'child-1', parent_run_id: 'parent-1' };
      mockQuery.mockResolvedValueOnce(createQueryResult([child]));

      const result = await findChildRuns('parent-1');

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('child-1');
      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('WHERE parent_run_id = $1');
      // The executor's re-entry picks children[children.length - 1] as "most
      // recent" — that only holds because this ORDER BY pins oldest-first.
      expect(query).toContain('ORDER BY started_at ASC');
      expect(params).toEqual(['parent-1']);
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('boom'));

      await expect(findChildRuns('parent-1')).rejects.toThrow(
        'Failed to find child workflow runs: boom'
      );
    });
  });

  describe('getRunAncestry', () => {
    const runRow = (id: string, parentRunId: string | null) => ({
      ...mockWorkflowRun,
      id,
      parent_run_id: parentRunId,
    });

    test('walks parent_run_id to the root, nearest ancestor first', async () => {
      // child -> parent -> root (each lookup is one getWorkflowRun query).
      mockQuery.mockResolvedValueOnce(createQueryResult([runRow('child', 'parent')]));
      mockQuery.mockResolvedValueOnce(createQueryResult([runRow('parent', 'root')]));
      mockQuery.mockResolvedValueOnce(createQueryResult([runRow('root', null)]));

      const result = await getRunAncestry('child');

      expect(result.map(r => r.id)).toEqual(['parent', 'root']);
    });

    test('stops on cyclic parent data instead of looping forever', async () => {
      // child -> parent -> child (hand-edited/corrupt DB).
      mockQuery.mockResolvedValueOnce(createQueryResult([runRow('child', 'parent')]));
      mockQuery.mockResolvedValueOnce(createQueryResult([runRow('parent', 'child')]));

      const result = await getRunAncestry('child');

      expect(result.map(r => r.id)).toEqual(['parent']);
    });

    test('ends the chain at a deleted parent (ON DELETE SET NULL orphan)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([runRow('child', 'gone')]));
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await getRunAncestry('child');

      expect(result).toEqual([]);
    });
  });

  describe('listWorkflowRuns', () => {
    test('filters by single status string', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await listWorkflowRuns({ status: 'running' });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('status IN ($1)');
      expect(params[0]).toBe('running');
    });

    test('filters by status array with IN clause', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await listWorkflowRuns({ status: ['running', 'failed'] as const });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('status IN ($1, $2)');
      expect(params[0]).toBe('running');
      expect(params[1]).toBe('failed');
    });

    test('single-element array uses IN clause', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await listWorkflowRuns({ status: ['failed'] });

      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('status IN ($1)');
      expect(params[0]).toBe('failed');
    });

    test('returns results from query', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([mockWorkflowRun]));

      const result = await listWorkflowRuns();

      expect(result).toEqual([mockWorkflowRun]);
    });
  });

  describe('failOrphanedRuns', () => {
    test('transitions all running runs to failed with completed_at and returns count', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([{ id: 'orphan-a' }, { id: 'orphan-b' }]))
        .mockResolvedValueOnce(createQueryResult([], 2));

      const result = await failOrphanedRuns();

      expect(result.count).toBe(2);
      expect(mockQuery.mock.calls[0]?.[0] as string).toContain(
        'SELECT id FROM remote_agent_workflow_runs'
      );
      expect(mockQuery.mock.calls[0]?.[0] as string).toContain('FOR UPDATE');
      const [query, params] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(query).toContain("status = 'failed'");
      expect(query).toContain('completed_at = NOW()');
      expect(query).toContain('id IN ($2, $3)');
      expect(query).toContain("status = 'running'");
      expect(params).toEqual([
        JSON.stringify({ failure_reason: 'server_restart' }),
        'orphan-a',
        'orphan-b',
      ]);
    });

    test('returns count 0 when no running runs exist', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await failOrphanedRuns();

      expect(result.count).toBe(0);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(String(mockQuery.mock.calls[0]?.[0])).not.toContain('pending_interactions');
    });

    test('purges pending interactions for each selected orphan before commit', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([{ id: 'orphan-a' }]))
        .mockResolvedValueOnce(createQueryResult([], 1));
      mockPendingAskThenPurge();

      const result = await failOrphanedRuns();

      expect(result.count).toBe(1);
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expectPurgedAskEvent(2, 'failed', 'orphan-a');
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection lost'));

      await expect(failOrphanedRuns()).rejects.toThrow(
        'Failed to fail orphaned workflow runs: Connection lost'
      );
    });
  });

  describe('resumeWorkflowRun', () => {
    test('updates run to running, clears completed_at, and returns updated row', async () => {
      const updatedRun = { ...mockWorkflowRun, status: 'running' as const, completed_at: null };
      // Pre-CAS read of the metadata about to be cleared (no prior error here)
      mockQuery.mockResolvedValueOnce(createQueryResult([{ metadata: {} }]));
      // UPDATE query returns rowCount 1
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      // SELECT query returns the updated row
      mockQuery.mockResolvedValueOnce(createQueryResult([updatedRun]));

      const result = await resumeWorkflowRun('workflow-run-123');

      expect(result.status).toBe('running');
      expect(result.completed_at).toBeNull();
      // First call: the row-pinning read of the error the CAS is about to clear.
      const [priorQuery, priorParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(priorQuery).toContain('SELECT metadata');
      // Postgres row lock — without it the value read is not guaranteed to be the
      // value the CAS clears, so the preserved error could be stale (#2348).
      expect(priorQuery).toContain('FOR UPDATE');
      expect(priorParams).toEqual(['workflow-run-123']);
      // Second call: UPDATE
      const [updateQuery, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateQuery).toContain("status = 'running'");
      expect(updateQuery).toContain('completed_at = NULL');
      expect(updateQuery).toContain('metadata = metadata || $3::jsonb');
      // $1 = id, $2 = ORPHAN_RESUME_STALE_DAYS. The day param MUST be bound or the
      // CAS predicate's `< $2 days` references an unbound placeholder (PR #1830 C1).
      expect(updateParams).toEqual(['workflow-run-123', 1, JSON.stringify({ error: null })]);
      // Third call: SELECT
      const [selectQuery, selectParams] = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(selectQuery).toContain('SELECT *');
      expect(selectParams).toEqual(['workflow-run-123']);
      // No prior error → no audit event (only three statements ran).
      expect(mockQuery.mock.calls).toHaveLength(3);
    });

    test('refreshes started_at to NOW so resumed row competes fairly in the path-lock tiebreaker', async () => {
      // Without this refresh, a resumed row carries its original (potentially
      // hours-old) started_at and sorts ahead of any currently-active holder
      // in the older-wins tiebreaker — slipping past the lock and causing
      // two active workflows on the same working_path.
      mockQuery.mockResolvedValueOnce(createQueryResult([{ metadata: {} }]));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ ...mockWorkflowRun, status: 'running' as const }])
      );

      await resumeWorkflowRun('workflow-run-123');

      const [updateQuery] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateQuery).toContain('started_at = NOW()');
    });

    test('guards the UPDATE with the resumable-status CAS predicate', async () => {
      // The flip to 'running' must only match a row that is still resumable —
      // failed/paused/cancelled, or a stale 'running' orphan — so two concurrent
      // resumers can't both win and double-claim the worktree.
      mockQuery.mockResolvedValueOnce(createQueryResult([{ metadata: {} }]));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ ...mockWorkflowRun, status: 'running' as const }])
      );

      await resumeWorkflowRun('workflow-run-123');

      const [updateQuery, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateQuery).toContain("status IN ('failed', 'paused', 'cancelled')");
      expect(updateQuery).toContain("status = 'running' AND");
      // The stale-orphan arm references $2 — it MUST be bound to the day count.
      expect(updateQuery).toContain('$2');
      expect(updateParams).toEqual(['workflow-run-123', 1, JSON.stringify({ error: null })]);
    });

    test('preserves the cleared error as a workflow_resumed event (CAS winner only)', async () => {
      // The resume clears metadata.error, which for a SIGTERM-killed CLI run is
      // the ONLY record that the run ever failed — no workflow_failed/node_failed
      // event is written on that path (#2348). The clear must not lose it.
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ metadata: { error: 'Process terminated (SIGTERM)' } }])
      );
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1)); // CAS wins
      mockQuery.mockResolvedValueOnce(createQueryResult([])); // event INSERT
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ ...mockWorkflowRun, status: 'running' as const }])
      );

      await resumeWorkflowRun('workflow-run-123');

      const [eventQuery, eventParams] = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(eventQuery).toContain('INSERT INTO remote_agent_workflow_events');
      // [id, workflow_run_id, event_type, step_index, step_name, data]
      expect(eventParams[1]).toBe('workflow-run-123');
      expect(eventParams[2]).toBe('workflow_resumed');
      expect(eventParams[5]).toBe(JSON.stringify({ error: 'Process terminated (SIGTERM)' }));
    });

    test('writes no event when the CAS loses, even though an error was read', async () => {
      // A concurrent resumer already flipped the row: this caller read the error
      // but its UPDATE matched nothing, so it must write NOTHING at all —
      // otherwise a lost race still emits an audit event for a clear it never did.
      mockQuery.mockResolvedValueOnce(
        createQueryResult([{ metadata: { error: 'Process terminated (SIGTERM)' } }])
      );
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0)); // CAS loses
      mockQuery.mockResolvedValueOnce(createQueryResult([{ status: 'running' }])); // probe

      await expect(resumeWorkflowRun('workflow-run-123')).rejects.toThrow(
        WorkflowNotResumableError
      );

      const inserts = mockQuery.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO remote_agent_workflow_events')
      );
      expect(inserts).toHaveLength(0);
    });

    test('throws when no row matched and the run is gone (not found)', async () => {
      // Pre-CAS read finds nothing (row already deleted)
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      // UPDATE returns rowCount 0
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));
      // Probe SELECT finds no row → deleted
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(resumeWorkflowRun('nonexistent-id')).rejects.toThrow(
        'Workflow run not found (id: nonexistent-id)'
      );
    });

    test('throws "not resumable" when the run was concurrently activated (CAS miss)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([{ metadata: {} }]));
      // UPDATE matches nothing because the row is already 'running'
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));
      // Probe SELECT reveals the current status
      mockQuery.mockResolvedValueOnce(createQueryResult([{ status: 'running' }]));

      await expect(resumeWorkflowRun('workflow-run-123')).rejects.toThrow(
        'Workflow run is not resumable (id: workflow-run-123, status: running)'
      );
    });

    test('throws on database error during the disambiguation probe', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([{ metadata: {} }]));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0)); // UPDATE matched nothing
      mockQuery.mockRejectedValueOnce(new Error('Connection lost')); // probe fails

      await expect(resumeWorkflowRun('workflow-run-123')).rejects.toThrow(
        'Failed to resume workflow run: Connection lost'
      );
    });

    test('throws on database error during UPDATE', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([{ metadata: {} }]));
      mockQuery.mockRejectedValueOnce(new Error('Lock timeout'));

      await expect(resumeWorkflowRun('workflow-run-123')).rejects.toThrow(
        'Failed to resume workflow run: Lock timeout'
      );
    });

    test('throws on database error during the pre-CAS read', async () => {
      // The read shares the CAS's try/catch — a failure there must surface as the
      // same resume error, and the transaction rolls back with nothing written.
      mockQuery.mockRejectedValueOnce(new Error('Lock timeout'));

      await expect(resumeWorkflowRun('workflow-run-123')).rejects.toThrow(
        'Failed to resume workflow run: Lock timeout'
      );
    });

    test('throws on database error during SELECT after UPDATE', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([{ metadata: {} }]));
      // UPDATE succeeds
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      // SELECT fails
      mockQuery.mockRejectedValueOnce(new Error('Connection lost'));

      await expect(resumeWorkflowRun('workflow-run-123')).rejects.toThrow(
        'Failed to read workflow run after update: Connection lost'
      );
    });

    test('throws when row vanishes between UPDATE and SELECT', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([{ metadata: {} }]));
      // UPDATE succeeds (rowCount 1)
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      // SELECT returns nothing (row deleted between statements)
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(resumeWorkflowRun('workflow-run-123')).rejects.toThrow(
        'Workflow run vanished after update (id: workflow-run-123)'
      );
    });
  });

  describe('resumeApprovedGate', () => {
    test('atomically resumes only the matching approved paused Plannotator gate', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      await expect(
        resumeApprovedGate('workflow-run-123', { nodeId: 'review', gateId: 'gate-a' })
      ).resolves.toEqual({ resumed: true });

      expect(mockWithTransaction).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [updateSql, updateParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateSql).toContain("SET status = 'running'");
      expect(updateSql).toContain('WHERE id = $1');
      expect(updateSql).toContain("AND status = 'paused'");
      expect(updateSql).toContain("metadata->'approval'->>'type' = 'plannotator_gate'");
      expect(updateSql).toContain("metadata->'approval'->>'resolved' = 'approved'");
      expect(updateSql).toContain("metadata->'approval'->>'nodeId' = $2");
      expect(updateSql).toContain("metadata->'approval'->>'gateId' = $3");
      expect(updateSql).toContain('started_at = NOW()');
      expect(updateParams).toEqual(['workflow-run-123', 'review', 'gate-a']);
    });

    test('returns a CAS miss when any resume predicate does not match', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(
        resumeApprovedGate('workflow-run-123', { nodeId: 'review', gateId: 'gate-a' })
      ).resolves.toEqual({ resumed: false });
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelWorkflowRun', () => {
    test('cancels a non-terminal run and reports { cancelled: true }', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      const result = await cancelWorkflowRun('workflow-run-123');

      expect(result).toEqual({ cancelled: true });
      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("status = 'cancelled'");
      // Must not re-cancel / re-stamp completed_at on an already-finished run.
      expect(query).toContain("status NOT IN ('completed', 'cancelled')");
      expect(params).toEqual(['workflow-run-123']);
    });

    test('reports { cancelled: false } when the run is already terminal (no throw)', async () => {
      // UPDATE matches nothing because the run is completed/cancelled
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(cancelWorkflowRun('workflow-run-123')).resolves.toEqual({ cancelled: false });
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(String(mockQuery.mock.calls[0]?.[0])).not.toContain('pending_interactions');
    });

    test('purges pending interactions after a winning cancel update', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockPendingAskThenPurge();

      const result = await cancelWorkflowRun('workflow-run-123');

      expect(result).toEqual({ cancelled: true });
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0]?.[0] as string).toContain("status = 'cancelled'");
      expectPurgedAskEvent(1, 'cancelled');
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Lock timeout'));

      await expect(cancelWorkflowRun('workflow-run-123')).rejects.toThrow(
        'Failed to cancel workflow run: Lock timeout'
      );
    });

    describe('steering handle cleanup', () => {
      beforeEach(() => {
        getSteeringRegistry().clearForTests();
      });

      test('discards live and parked in-process handles after the transaction commits', async () => {
        const live = getSteeringRegistry().register('workflow-run-123', 'node-a');
        live.enqueue({
          messageId: 'm-1',
          message: 'queued guidance',
          operatorUserId: 'op-1',
          receivedAt: new Date().toISOString(),
        });
        const parked = getSteeringRegistry().register('workflow-run-123', 'node-b');
        parked.park();
        mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

        const result = await cancelWorkflowRun('workflow-run-123');

        expect(result).toEqual({ cancelled: true });
        expect(getSteeringRegistry().get('workflow-run-123', 'node-a')).toBeUndefined();
        expect(getSteeringRegistry().get('workflow-run-123', 'node-b')).toBeUndefined();
        // Discarded handles are closed and emptied so they can never drain.
        expect(live.snapshot()).toEqual({ phase: 'closed', queued: [], acceptedCount: 0 });
      });

      test('discards a deliberately stale handle on an idempotent already-terminal cancel', async () => {
        getSteeringRegistry().register('workflow-run-123', 'node-a');
        mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

        await expect(cancelWorkflowRun('workflow-run-123')).resolves.toEqual({
          cancelled: false,
        });
        expect(getSteeringRegistry().get('workflow-run-123', 'node-a')).toBeUndefined();
      });

      test('leaves handles untouched when the database call fails', async () => {
        getSteeringRegistry().register('workflow-run-123', 'node-a');
        mockQuery.mockRejectedValueOnce(new Error('Lock timeout'));

        await expect(cancelWorkflowRun('workflow-run-123')).rejects.toThrow(
          'Failed to cancel workflow run: Lock timeout'
        );
        expect(getSteeringRegistry().get('workflow-run-123', 'node-a')).toBeDefined();
      });

      test('does not let a cleanup failure fail a committed cancellation', async () => {
        getSteeringRegistry().register('workflow-run-123', 'node-a');
        const registry = getSteeringRegistry();
        const original = registry.discardRun.bind(registry);
        spyOn(registry, 'discardRun').mockImplementation(() => {
          throw new Error('cleanup exploded');
        });
        mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
        try {
          await expect(cancelWorkflowRun('workflow-run-123')).resolves.toEqual({
            cancelled: true,
          });
        } finally {
          registry.discardRun = original;
        }
      });

      test('discards only the named run, never another run', async () => {
        getSteeringRegistry().register('workflow-run-123', 'node-a');
        getSteeringRegistry().register('other-run', 'node-a');
        mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

        await cancelWorkflowRun('workflow-run-123');

        expect(getSteeringRegistry().get('workflow-run-123', 'node-a')).toBeUndefined();
        expect(getSteeringRegistry().get('other-run', 'node-a')).toBeDefined();
      });

      test('recovery cancel discards handles after its transaction commits', async () => {
        getSteeringRegistry().register('workflow-run-123', 'node-a');
        mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

        await expect(cancelRecoveryWorkflowRun('workflow-run-123')).resolves.toEqual({
          cancelled: true,
        });
        expect(getSteeringRegistry().get('workflow-run-123', 'node-a')).toBeUndefined();
      });

      test('recovery cancel leaves handles untouched when the database call fails', async () => {
        getSteeringRegistry().register('workflow-run-123', 'node-a');
        mockQuery.mockRejectedValueOnce(new Error('Lock timeout'));

        await expect(cancelRecoveryWorkflowRun('workflow-run-123')).rejects.toThrow(
          'Failed to cancel recoverable workflow run: Lock timeout'
        );
        expect(getSteeringRegistry().get('workflow-run-123', 'node-a')).toBeDefined();
      });
    });
  });

  describe('cancelRecoveryWorkflowRun', () => {
    test('atomically cancels only provider-recovery eligible states', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

      const result = await cancelRecoveryWorkflowRun('workflow-run-123');

      expect(result).toEqual({ cancelled: true });
      const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("status = 'cancelled'");
      expect(query).toContain("status IN ('running', 'paused', 'failed')");
      expect(params).toEqual(['workflow-run-123']);
    });

    test('reports { cancelled: false } when no eligible state matches (CAS lost)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(cancelRecoveryWorkflowRun('workflow-run-123')).resolves.toEqual({
        cancelled: false,
      });
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(String(mockQuery.mock.calls[0]?.[0])).not.toContain('pending_interactions');
    });

    test('purges pending interactions after a winning recovery cancel', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockPendingAskThenPurge();

      const result = await cancelRecoveryWorkflowRun('workflow-run-123');

      expect(result).toEqual({ cancelled: true });
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expectPurgedAskEvent(1, 'cancelled');
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Lock timeout'));

      await expect(cancelRecoveryWorkflowRun('workflow-run-123')).rejects.toThrow(
        'Failed to cancel recoverable workflow run: Lock timeout'
      );
    });
  });

  describe('deleteOldWorkflowRuns', () => {
    test('cleans retry refs and deletes events then runs via withTransaction', async () => {
      mockQuery
        .mockResolvedValueOnce(
          createQueryResult([{ id: 'old-run-1', working_path: '/workspace/repo' }])
        ) // eligible run SELECT (public)
        .mockResolvedValueOnce(createQueryResult([], 0)) // events DELETE (tx)
        .mockResolvedValueOnce(createQueryResult([], 3)); // runs DELETE (tx)

      const result = await deleteOldWorkflowRuns(30);

      expect(result.count).toBe(3);
      expect(mockDeleteRetryRefsByRunId).toHaveBeenCalledWith('/workspace/repo', 'old-run-1');
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledTimes(3);
      const sqls = mockQuery.mock.calls.map(call => (call as [string, unknown[]])[0]);
      expect(sqls.some(s => s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK')).toBe(false);
      expect(sqls[1]).toContain('remote_agent_workflow_events');
      expect(sqls[2]).toContain("status IN ('completed', 'failed', 'cancelled')");
    });

    test('uses PostgreSQL INTERVAL syntax', async () => {
      mockQuery.mockResolvedValue(createQueryResult([], 0));

      await deleteOldWorkflowRuns(7);

      const [eventsSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(eventsSql).toContain("INTERVAL '7 days'");
    });

    test('continues old-run deletion when retry ref cleanup fails', async () => {
      mockDeleteRetryRefsByRunId.mockRejectedValueOnce(new Error('ref locked'));
      mockQuery
        .mockResolvedValueOnce(
          createQueryResult([{ id: 'old-run-1', working_path: '/workspace/repo' }])
        )
        .mockResolvedValueOnce(createQueryResult([], 0))
        .mockResolvedValueOnce(createQueryResult([], 1));

      const result = await deleteOldWorkflowRuns(30);

      expect(result.count).toBe(1);
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      const sqls = mockQuery.mock.calls.map(call => (call as [string, unknown[]])[0]);
      expect(sqls).not.toContain('COMMIT');
    });

    test('validates olderThanDays is a non-negative integer', async () => {
      await expect(deleteOldWorkflowRuns(-1)).rejects.toThrow('Invalid olderThanDays');
      await expect(deleteOldWorkflowRuns(3.5)).rejects.toThrow('Invalid olderThanDays');
    });

    test('rolls back and throws on database error', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([])) // eligible run SELECT
        .mockRejectedValueOnce(new Error('disk full')); // events DELETE fails inside tx

      await expect(deleteOldWorkflowRuns(30)).rejects.toThrow(
        'Failed to clean up old workflow runs: disk full'
      );
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteWorkflowRun', () => {
    test('deletes events then run within a transaction for terminal run', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([{ status: 'completed', working_path: '/repo' }])) // SELECT guard
        .mockResolvedValueOnce(createQueryResult([], 1)) // events DELETE
        .mockResolvedValueOnce(createQueryResult([], 1)); // run DELETE

      await deleteWorkflowRun('run-123');

      expect(mockDeleteRetryRefsByRunId).toHaveBeenCalledWith('/repo', 'run-123');
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledTimes(3);
      const sqls = mockQuery.mock.calls.map(call => (call as [string, unknown[]])[0]);
      expect(sqls.some(s => s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK')).toBe(false);
      expect(sqls[0]).toContain('SELECT status');
      expect(sqls[1]).toContain('remote_agent_workflow_events');
      expect(sqls[2]).toContain('remote_agent_workflow_runs');
    });

    test('throws "not found" when run does not exist', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([])); // SELECT guard — empty

      await expect(deleteWorkflowRun('missing')).rejects.toThrow('Workflow run not found: missing');
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });

    test('throws when run is not in terminal status', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([{ status: 'running' }])); // SELECT guard

      await expect(deleteWorkflowRun('run-active')).rejects.toThrow(
        "Cannot delete workflow run in 'running' status"
      );
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });

    test('throws on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(deleteWorkflowRun('run-123')).rejects.toThrow(
        'Failed to delete workflow run: constraint violation'
      );
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
