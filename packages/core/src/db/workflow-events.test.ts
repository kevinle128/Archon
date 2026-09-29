import { mock, describe, test, expect, beforeEach } from 'bun:test';
import { createMockLogger } from '../test/mocks/logger';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';
import type { WorkflowEventRow } from './workflow-events';

// Mock logger to suppress noisy output during tests
const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
  getArchonHome: mock(() => '/home/test/.archon'),
  getArchonConfigPath: mock(() => '/home/test/.archon/config.yaml'),
  getArchonWorkspacesPath: mock(() => '/home/test/.archon/workspaces'),
  getArchonWorktreesPath: mock(() => '/home/test/.archon/worktrees'),
  getDefaultCommandsPath: mock(() => '/app/.archon/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/app/.archon/workflows/defaults'),
}));

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));

// Mock the connection module before importing the module under test
mock.module('./connection', () => ({
  pool: {
    query: mockQuery,
  },
  getDialect: () => mockPostgresDialect,
  getDatabaseType: () => 'postgresql',
}));

import {
  createWorkflowEvent,
  insertWorkflowEvent,
  listWorkflowEvents,
  listRecentEvents,
  getEpochAwareCompletedDagNodeOutputs,
  getRetryPreservedDagNodeOutputs,
  getDagResumeSnapshot,
  findNonTerminalNodes,
} from './workflow-events';

describe('workflow-events', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockLogger.warn.mockClear();
  });

  const mockEvent: WorkflowEventRow = {
    id: 'evt-123',
    workflow_run_id: 'run-456',
    event_type: 'step_started',
    step_index: 0,
    step_name: 'plan',
    data: {},
    created_at: '2025-01-01T00:00:00.000Z',
  };

  describe('createWorkflowEvent', () => {
    test('calls pool.query with correct SQL and parameters', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await createWorkflowEvent({
        workflow_run_id: 'run-456',
        event_type: 'step_started',
        step_index: 0,
        step_name: 'plan',
        data: { duration: 100 },
      });

      expect(mockQuery).toHaveBeenCalledWith(
        `INSERT INTO remote_agent_workflow_events (id, workflow_run_id, event_type, step_index, step_name, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          expect.any(String), // generated UUID
          'run-456',
          'step_started',
          0,
          'plan',
          JSON.stringify({ duration: 100 }),
        ]
      );
    });

    test('defaults optional fields to null and empty data', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await createWorkflowEvent({
        workflow_run_id: 'run-456',
        event_type: 'workflow_started',
      });

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        expect.any(String),
        'run-456',
        'workflow_started',
        null,
        null,
        '{}',
      ]);
    });

    test('does NOT throw when query fails (fire-and-forget)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      // Should NOT throw — fire-and-forget logs error internally
      await createWorkflowEvent({
        workflow_run_id: 'run-456',
        event_type: 'step_started',
      });
    });
  });

  describe('insertWorkflowEvent', () => {
    test('returns generated id and accepts caller-supplied id', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      const generated = await insertWorkflowEvent(mockQuery, {
        workflow_run_id: 'run-456',
        event_type: 'step_started',
      });
      expect(typeof generated).toBe('string');
      expect(generated.length).toBeGreaterThan(0);

      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      const callerId = await insertWorkflowEvent(mockQuery, {
        id: 'evt-caller',
        workflow_run_id: 'run-456',
        event_type: 'node_usage_recorded',
        step_name: 'planner',
        data: { schema_version: 1 },
      });
      expect(callerId).toBe('evt-caller');
      const [, params] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(params[0]).toBe('evt-caller');
      expect(params[2]).toBe('node_usage_recorded');
    });

    test('ignoreDuplicateId appends ON CONFLICT DO NOTHING only when requested', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      await insertWorkflowEvent(
        mockQuery,
        {
          id: 'evt-dup',
          workflow_run_id: 'run-456',
          event_type: 'node_usage_recorded',
        },
        { ignoreDuplicateId: true }
      );
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ON CONFLICT (id) DO NOTHING');

      mockQuery.mockResolvedValueOnce(createQueryResult([]));
      await insertWorkflowEvent(mockQuery, {
        id: 'evt-plain',
        workflow_run_id: 'run-456',
        event_type: 'step_started',
      });
      const [plainSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(plainSql).not.toContain('ON CONFLICT');
    });
  });

  describe('listWorkflowEvents', () => {
    test('returns rows from query result', async () => {
      const events: WorkflowEventRow[] = [
        mockEvent,
        { ...mockEvent, id: 'evt-124', event_type: 'step_completed', step_index: 1 },
      ];
      mockQuery.mockResolvedValueOnce(createQueryResult(events));

      const result = await listWorkflowEvents('run-456');

      expect(result).toEqual(events);
      expect(mockQuery).toHaveBeenCalledWith(
        `SELECT * FROM remote_agent_workflow_events
       WHERE workflow_run_id = $1
       ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC`,
        ['run-456']
      );
    });

    test('preserves prior route attempts and node_routed metadata in event history', async () => {
      const negativeRouteDecision = {
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
      const positiveRouteDecision = {
        sources: ['review'],
        outcome: 'positive',
        to: 'done',
        condition: "$review.output.result == '<redacted>'",
        condition_result: true,
        negative_count: 1,
        max_iterations: 10,
        attempt: 2,
        execution_seq: 2,
      };

      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockEvent,
            id: 'evt-review-1',
            event_type: 'node_completed',
            step_name: 'review',
            data: JSON.stringify({
              node_id: 'review',
              node_output: '{"result":"negative"}',
              attempt: 1,
              execution_seq: 1,
            }),
          },
          {
            ...mockEvent,
            id: 'evt-routed-1',
            event_type: 'node_routed',
            step_name: 'review-router',
            data: JSON.stringify(negativeRouteDecision),
          },
          {
            ...mockEvent,
            id: 'evt-review-2',
            event_type: 'node_completed',
            step_name: 'review',
            data: JSON.stringify({
              node_id: 'review',
              node_output: '{"result":"positive"}',
              attempt: 2,
              execution_seq: 2,
            }),
          },
          {
            ...mockEvent,
            id: 'evt-routed-2',
            event_type: 'node_routed',
            step_name: 'review-router',
            data: JSON.stringify(positiveRouteDecision),
          },
        ])
      );

      const result = await listWorkflowEvents('run-route-loop');

      expect(result.map(event => event.id)).toEqual([
        'evt-review-1',
        'evt-routed-1',
        'evt-review-2',
        'evt-routed-2',
      ]);
      expect(
        result.filter(event => event.event_type === 'node_completed').map(event => event.data)
      ).toEqual([
        {
          node_id: 'review',
          node_output: '{"result":"negative"}',
          attempt: 1,
          execution_seq: 1,
        },
        {
          node_id: 'review',
          node_output: '{"result":"positive"}',
          attempt: 2,
          execution_seq: 2,
        },
      ]);
      expect(
        result.filter(event => event.event_type === 'node_routed').map(event => event.data)
      ).toEqual([negativeRouteDecision, positiveRouteDecision]);
    });

    test('returns empty array for no results', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await listWorkflowEvents('run-456');

      expect(result).toEqual([]);
    });

    test('throws wrapped error when query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('timeout'));

      await expect(listWorkflowEvents('run-456')).rejects.toThrow(
        'Failed to list workflow events: timeout'
      );
    });
  });

  describe('listRecentEvents', () => {
    test('returns events filtered by since parameter', async () => {
      const events: WorkflowEventRow[] = [mockEvent];
      mockQuery.mockResolvedValueOnce(createQueryResult(events));

      const since = new Date('2025-01-01T00:00:00.000Z');
      const result = await listRecentEvents('run-456', since);

      expect(result).toEqual(events);
      expect(mockQuery).toHaveBeenCalledWith(
        `SELECT * FROM remote_agent_workflow_events
         WHERE workflow_run_id = $1 AND created_at > $2
         ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC`,
        ['run-456', since.toISOString()]
      );
    });

    test('delegates to listWorkflowEvents without since parameter', async () => {
      const events: WorkflowEventRow[] = [mockEvent];
      mockQuery.mockResolvedValueOnce(createQueryResult(events));

      const result = await listRecentEvents('run-456');

      expect(result).toEqual(events);
      // Should use the same query as listWorkflowEvents (no created_at filter)
      expect(mockQuery).toHaveBeenCalledWith(
        `SELECT * FROM remote_agent_workflow_events
       WHERE workflow_run_id = $1
       ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC`,
        ['run-456']
      );
    });

    test('returns empty array for no results', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const since = new Date('2025-06-01T00:00:00.000Z');
      const result = await listRecentEvents('run-456', since);

      expect(result).toEqual([]);
    });

    test('throws wrapped error on query failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection lost'));

      await expect(listRecentEvents('run-456', new Date())).rejects.toThrow(
        'Failed to list recent workflow events: connection lost'
      );
    });
  });

  describe('getDagResumeSnapshot', () => {
    test('returns outputs and summed tokens from node_completed events', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            step_name: 'node-a',
            event_type: 'node_completed',
            data: { node_output: 'output A', tokens: { input: 40, output: 4 } },
          },
          {
            step_name: 'node-b',
            event_type: 'node_completed',
            data: { node_output: 'output B', tokens: { input: 60, output: 6 } },
          },
        ])
      );

      const result = await getDagResumeSnapshot('run-123');

      expect(result.completedNodeOutputs).toEqual(
        new Map([
          ['node-a', 'output A'],
          ['node-b', 'output B'],
        ])
      );
      expect(result.tokens).toEqual({ input: 100, output: 10 });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('node_completed'), [
        'run-123',
      ]);
    });

    test('returns outputs from node_skipped_prior_success events (multi-resume)', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            step_name: 'node-a',
            event_type: 'node_completed',
            data: { node_output: 'output A', tokens: { input: 40, output: 4 } },
          },
          {
            step_name: 'node-b',
            event_type: 'node_skipped_prior_success',
            data: {
              reason: 'prior_success',
              node_output: 'output B',
              tokens: { input: 999, output: 999 },
            },
          },
        ])
      );

      const result = await getDagResumeSnapshot('run-resume');

      expect(result.completedNodeOutputs.size).toBe(2);
      expect(result.completedNodeOutputs.get('node-a')).toBe('output A');
      expect(result.completedNodeOutputs.get('node-b')).toBe('output B');
      expect(result.tokens).toEqual({ input: 40, output: 4 });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('node_skipped_prior_success'),
        ['run-resume']
      );
    });

    test('returns outputs when only node_skipped_prior_success rows exist (no node_completed)', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            step_name: 'node-x',
            event_type: 'node_skipped_prior_success',
            data: { reason: 'prior_success', node_output: 'skipped output X' },
          },
          {
            step_name: 'node-y',
            event_type: 'node_skipped_prior_success',
            data: { reason: 'prior_success', node_output: 'skipped output Y' },
          },
        ])
      );

      const result = await getDagResumeSnapshot('run-all-skipped');

      expect(result.completedNodeOutputs.size).toBe(2);
      expect(result.completedNodeOutputs.get('node-x')).toBe('skipped output X');
      expect(result.completedNodeOutputs.get('node-y')).toBe('skipped output Y');
      expect(result.tokens).toEqual({ input: 0, output: 0 });
    });

    test('parses JSON string data (SQLite path)', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            step_name: 'node-a',
            event_type: 'node_completed',
            data: JSON.stringify({
              node_output: 'parsed output',
              tokens: { input: 8, output: 2 },
            }),
          },
        ])
      );

      const result = await getDagResumeSnapshot('run-456');

      expect(result.completedNodeOutputs.get('node-a')).toBe('parsed output');
      expect(result.tokens).toEqual({ input: 8, output: 2 });
    });

    test('skips rows with null step_name', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            step_name: null,
            event_type: 'node_completed',
            data: { node_output: 'should be skipped', tokens: { input: 99, output: 99 } },
          },
          {
            step_name: 'node-a',
            event_type: 'node_completed',
            data: { node_output: 'kept', tokens: { input: 1, output: 2 } },
          },
        ])
      );

      const result = await getDagResumeSnapshot('run-789');

      expect(result.completedNodeOutputs).toEqual(new Map([['node-a', 'kept']]));
      expect(result.tokens).toEqual({ input: 1, output: 2 });
    });

    test('preserves valid outputs while ignoring malformed and non-finite tokens', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            step_name: 'node-a',
            event_type: 'node_completed',
            data: { node_output: 123, tokens: { input: 10, output: 1 } },
          },
          {
            step_name: 'node-b',
            event_type: 'node_completed',
            data: { duration_ms: 500, tokens: { input: 'bad', output: 2 } },
          },
          {
            step_name: 'node-c',
            event_type: 'node_completed',
            data: { node_output: 'valid', tokens: { input: Number.NaN, output: Infinity } },
          },
          {
            step_name: 'node-d',
            event_type: 'node_completed',
            data: { node_output: 'also valid' },
          },
        ])
      );

      const result = await getDagResumeSnapshot('run-filter');

      expect(result.completedNodeOutputs).toEqual(
        new Map([
          ['node-c', 'valid'],
          ['node-d', 'also valid'],
        ])
      );
      expect(result.tokens).toEqual({ input: 10, output: 1 });
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });

    test('does not warn when completed events omit optional token usage', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            step_name: 'node-a',
            event_type: 'node_completed',
            data: { node_output: 'output without usage' },
          },
        ])
      );

      const result = await getDagResumeSnapshot('run-without-tokens');

      expect(result.completedNodeOutputs).toEqual(new Map([['node-a', 'output without usage']]));
      expect(result.tokens).toEqual({ input: 0, output: 0 });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('skips corrupt JSON rows without losing other rows', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            step_name: 'node-a',
            event_type: 'node_completed',
            data: { node_output: 'good first', tokens: { input: 3, output: 1 } },
          },
          { step_name: 'node-b', event_type: 'node_completed', data: '{bad json' },
          {
            step_name: 'node-c',
            event_type: 'node_completed',
            data: { node_output: 'good last', tokens: { input: 7, output: 2 } },
          },
        ])
      );

      const result = await getDagResumeSnapshot('run-corrupt');

      expect(result.completedNodeOutputs.size).toBe(2);
      expect(result.completedNodeOutputs.get('node-a')).toBe('good first');
      expect(result.completedNodeOutputs.get('node-c')).toBe('good last');
      expect(result.tokens).toEqual({ input: 10, output: 3 });
    });

    test('returns an empty snapshot when no events exist', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await getDagResumeSnapshot('run-empty');

      expect(result.completedNodeOutputs.size).toBe(0);
      expect(result.tokens).toEqual({ input: 0, output: 0 });
    });

    test('throws on DB query error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      await expect(getDagResumeSnapshot('run-error')).rejects.toThrow('connection refused');
    });
  });

  describe('findNonTerminalNodes', () => {
    function eventRow(overrides: Partial<WorkflowEventRow>): WorkflowEventRow {
      return { ...mockEvent, ...overrides };
    }

    // A real agent turn (prompt or loop-iteration body) writes many events
    // between its own node_started/loop_iteration_started and its terminal
    // event — tool_called/tool_completed/node_usage_recorded — and NONE of
    // those carry execution-scope fields (only the lifecycle start/terminal
    // events do, via `executionScopeEventFields`). Reading scope off the
    // LATEST event (the pre-fix behavior) reads one of these bare events
    // instead of the start event that actually owns the open occurrence.
    test('a prompt node orphaned mid-tool-call carries the node_started occurrence, not the bare latest event', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          eventRow({
            id: 'e1',
            step_name: 'prompt-a',
            event_type: 'node_started',
            data: { occurrence_id: 'occ-a', attempt_id: 'att-a-1', retry_epoch: 0, type: 'prompt' },
          }),
          eventRow({
            id: 'e2',
            step_name: 'prompt-a',
            event_type: 'tool_called',
            data: { tool_name: 'Bash', tool_input: {}, tool_call_id: 't1' },
          }),
          eventRow({
            id: 'e3',
            step_name: 'prompt-a',
            event_type: 'tool_completed',
            data: {
              tool_name: 'Bash',
              duration_ms: 10,
              tool_call_id: 't1',
              tool_outcome: 'interrupted',
            },
          }),
          eventRow({
            id: 'e4',
            step_name: 'prompt-a',
            event_type: 'node_usage_recorded',
            data: { retryEpoch: 0, iteration: null },
          }),
        ])
      );

      const result = await findNonTerminalNodes('run-1');

      expect(result).toEqual([
        {
          nodeId: 'prompt-a',
          scope: { occurrence_id: 'occ-a', attempt_id: 'att-a-1', retry_epoch: 0 },
          terminalEventType: 'node_failed',
        },
      ]);
    });

    // A loop node mid-iteration 2 has TWO open executions at once: the
    // container's own node_started (type: loop, never closed until the
    // whole node settles) and the current iteration's loop_iteration_started
    // (its own, distinct occurrence — freshly minted every iteration). Both
    // must be reported so the caller can close both rows.
    test('a loop node orphaned mid-iteration reports both the container and the open iteration', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          eventRow({
            id: 'e1',
            step_name: 'loop-b',
            event_type: 'node_started',
            data: {
              occurrence_id: 'occ-outer',
              attempt_id: 'att-outer',
              retry_epoch: 0,
              type: 'loop',
            },
          }),
          eventRow({
            id: 'e2',
            step_name: 'loop-b',
            event_type: 'loop_iteration_started',
            data: {
              iteration: 1,
              occurrence_id: 'occ-iter-1',
              attempt_id: 'att-iter-1',
              retry_epoch: 0,
            },
          }),
          eventRow({
            id: 'e3',
            step_name: 'loop-b',
            event_type: 'loop_iteration_completed',
            data: {
              iteration: 1,
              occurrence_id: 'occ-iter-1',
              attempt_id: 'att-iter-1',
              retry_epoch: 0,
            },
          }),
          eventRow({
            id: 'e4',
            step_name: 'loop-b',
            event_type: 'loop_iteration_started',
            data: {
              iteration: 2,
              occurrence_id: 'occ-iter-2',
              attempt_id: 'att-iter-2',
              retry_epoch: 0,
            },
          }),
          eventRow({
            id: 'e5',
            step_name: 'loop-b',
            event_type: 'tool_called',
            data: { tool_name: 'Bash', tool_input: {}, tool_call_id: 't2' },
          }),
          eventRow({
            id: 'e6',
            step_name: 'loop-b',
            event_type: 'node_usage_recorded',
            data: { retryEpoch: 0, iteration: 2 },
          }),
        ])
      );

      const result = await findNonTerminalNodes('run-1');

      expect(result).toEqual([
        {
          nodeId: 'loop-b',
          scope: { occurrence_id: 'occ-outer', attempt_id: 'att-outer', retry_epoch: 0 },
          terminalEventType: 'node_failed',
        },
        {
          nodeId: 'loop-b',
          scope: {
            iteration: 2,
            occurrence_id: 'occ-iter-2',
            attempt_id: 'att-iter-2',
            retry_epoch: 0,
          },
          terminalEventType: 'loop_iteration_failed',
        },
      ]);
    });

    test('excludes a node whose scoped occurrence was already closed', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          eventRow({
            id: 'e1',
            step_name: 'done-a',
            event_type: 'node_started',
            data: { occurrence_id: 'occ-done', attempt_id: 'att-done', retry_epoch: 0 },
          }),
          eventRow({
            id: 'e2',
            step_name: 'done-a',
            event_type: 'node_completed',
            data: { occurrence_id: 'occ-done', attempt_id: 'att-done', retry_epoch: 0 },
          }),
        ])
      );

      const result = await findNonTerminalNodes('run-clean');

      expect(result).toEqual([]);
    });

    test('a retried node (failed, then a fresh node_started) is non-terminal again', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          eventRow({
            id: 'e1',
            step_name: 'retry-a',
            event_type: 'node_started',
            data: { occurrence_id: 'occ-1', attempt_id: 'att-1', retry_epoch: 0 },
          }),
          eventRow({
            id: 'e2',
            step_name: 'retry-a',
            event_type: 'node_failed',
            data: { occurrence_id: 'occ-1', attempt_id: 'att-1', retry_epoch: 0 },
          }),
          eventRow({
            id: 'e3',
            step_name: 'retry-a',
            event_type: 'node_started',
            data: { occurrence_id: 'occ-2', attempt_id: 'att-2', retry_epoch: 1 },
          }),
        ])
      );

      const result = await findNonTerminalNodes('run-retry');

      expect(result).toEqual([
        {
          nodeId: 'retry-a',
          scope: { occurrence_id: 'occ-2', attempt_id: 'att-2', retry_epoch: 1 },
          terminalEventType: 'node_failed',
        },
      ]);
    });

    // Legacy rows minted before occurrence_id existed carry no scope at all —
    // the same "latest unscoped start per step_name" pairing the pre-fix
    // implementation used is preserved for this narrow, unscoped-only case.
    test('an unscoped legacy node_started/node_failed pair is still paired by step_name', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          eventRow({ id: 'e1', step_name: 'legacy-a', event_type: 'node_started', data: {} }),
        ])
      );

      const result = await findNonTerminalNodes('run-legacy');

      expect(result).toEqual([{ nodeId: 'legacy-a', scope: {}, terminalEventType: 'node_failed' }]);
    });

    test('returns an empty list when every node reached a terminal event', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      const result = await findNonTerminalNodes('run-clean');

      expect(result).toEqual([]);
    });

    test('propagates the underlying list-events error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      await expect(findNonTerminalNodes('run-error')).rejects.toThrow(
        'Failed to list workflow events: connection refused'
      );
    });
  });

  describe('getEpochAwareCompletedDagNodeOutputs', () => {
    test('treats missing retry_epoch on historical completed events as epoch 0 outputs', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockEvent,
            id: 'evt-a',
            event_type: 'node_completed',
            step_name: 'a',
            data: { node_output: 'A0' },
          },
          {
            ...mockEvent,
            id: 'evt-b',
            event_type: 'node_skipped_prior_success',
            step_name: 'b',
            data: { reason: 'prior_success', node_output: 'B0' },
          },
        ])
      );

      const result = await getEpochAwareCompletedDagNodeOutputs('run-historical');

      expect(result).toEqual(
        new Map([
          ['a', 'A0'],
          ['b', 'B0'],
        ])
      );
    });

    test('drops stale outputs for retry-invalidated nodes until they complete in the active epoch', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockEvent,
            id: 'evt-a',
            event_type: 'node_completed',
            step_name: 'a',
            data: { node_output: 'A0' },
          },
          {
            ...mockEvent,
            id: 'evt-b-old',
            event_type: 'node_completed',
            step_name: 'b',
            data: { node_output: 'B0' },
          },
          {
            ...mockEvent,
            id: 'evt-retry',
            event_type: 'node_retry_requested',
            step_name: 'b',
            data: { node_id: 'b', retry_epoch: 1, invalidated_node_ids: ['b', 'c'] },
          },
          {
            ...mockEvent,
            id: 'evt-b-new',
            event_type: 'node_completed',
            step_name: 'b',
            data: { node_id: 'b', retry_epoch: 1, node_output: 'B1' },
          },
        ])
      );

      const result = await getEpochAwareCompletedDagNodeOutputs('run-retry');

      expect(result).toEqual(
        new Map([
          ['a', 'A0'],
          ['b', 'B1'],
        ])
      );
      expect(result.has('c')).toBe(false);
      expect(mockQuery).toHaveBeenCalledWith(
        `SELECT * FROM remote_agent_workflow_events
       WHERE workflow_run_id = $1
       ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC`,
        ['run-retry']
      );
    });

    test('returns the latest retry epoch output when historical retry events are preserved', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockEvent,
            id: 'evt-b-old',
            event_type: 'node_completed',
            step_name: 'b',
            data: { node_output: 'B0' },
          },
          {
            ...mockEvent,
            id: 'evt-retry-1',
            event_type: 'node_retry_requested',
            step_name: 'b',
            data: { node_id: 'b', retry_epoch: 1, invalidated_node_ids: ['b'] },
          },
          {
            ...mockEvent,
            id: 'evt-b-retry-1',
            event_type: 'node_completed',
            step_name: 'b',
            data: { node_id: 'b', retry_epoch: 1, node_output: 'B1' },
          },
          {
            ...mockEvent,
            id: 'evt-retry-2',
            event_type: 'node_retry_requested',
            step_name: 'b',
            data: { node_id: 'b', retry_epoch: 2, invalidated_node_ids: ['b'] },
          },
          {
            ...mockEvent,
            id: 'evt-b-retry-2',
            event_type: 'node_completed',
            step_name: 'b',
            data: { node_id: 'b', retry_epoch: 2, node_output: 'B2' },
          },
        ])
      );

      const result = await getEpochAwareCompletedDagNodeOutputs('run-multi-retry');

      expect(result).toEqual(new Map([['b', 'B2']]));
    });

    test('projects the latest completed route-loop attempt without dropping prior attempts', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockEvent,
            id: 'evt-review-1',
            event_type: 'node_completed',
            step_name: 'review',
            data: {
              node_id: 'review',
              node_output: '{"result":"negative"}',
              attempt: 1,
              execution_seq: 1,
            },
          },
          {
            ...mockEvent,
            id: 'evt-routed-1',
            event_type: 'node_routed',
            step_name: 'review-router',
            data: {
              sources: ['review'],
              outcome: 'negative',
              to: 'fix',
              condition: "$review.output.result == '<redacted>'",
              condition_result: false,
              negative_count: 1,
              max_iterations: 10,
              attempt: 1,
              execution_seq: 1,
            },
          },
          {
            ...mockEvent,
            id: 'evt-review-2',
            event_type: 'node_completed',
            step_name: 'review',
            data: {
              node_id: 'review',
              node_output: '{"result":"positive"}',
              attempt: 2,
              execution_seq: 2,
            },
          },
          {
            ...mockEvent,
            id: 'evt-routed-2',
            event_type: 'node_routed',
            step_name: 'review-router',
            data: {
              sources: ['review'],
              outcome: 'positive',
              to: 'done',
              condition: "$review.output.result == '<redacted>'",
              condition_result: true,
              negative_count: 1,
              max_iterations: 10,
              attempt: 2,
              execution_seq: 2,
            },
          },
        ])
      );

      const result = await getEpochAwareCompletedDagNodeOutputs('run-route-loop');

      expect(result).toEqual(new Map([['review', '{"result":"positive"}']]));
      expect(mockQuery).toHaveBeenCalledWith(
        `SELECT * FROM remote_agent_workflow_events
       WHERE workflow_run_id = $1
       ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC`,
        ['run-route-loop']
      );
    });
  });

  describe('getRetryPreservedDagNodeOutputs', () => {
    test('returns only completed outputs outside the current retry invalidation set', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockEvent,
            id: 'evt-a',
            event_type: 'node_completed',
            step_name: 'a',
            data: { node_output: 'A0' },
          },
          {
            ...mockEvent,
            id: 'evt-b',
            event_type: 'node_completed',
            step_name: 'b',
            data: { node_output: 'B0' },
          },
          {
            ...mockEvent,
            id: 'evt-c',
            event_type: 'node_completed',
            step_name: 'c',
            data: { node_output: 'C0' },
          },
        ])
      );

      const result = await getRetryPreservedDagNodeOutputs('run-retry', ['b', 'c']);

      expect(result).toEqual(new Map([['a', 'A0']]));
    });

    test('preserves non-invalidated upstream outputs and ignores invalidated stale outputs', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([
          {
            ...mockEvent,
            id: 'evt-a',
            event_type: 'node_completed',
            step_name: 'a',
            data: { node_output: 'A0' },
          },
          {
            ...mockEvent,
            id: 'evt-b',
            event_type: 'node_completed',
            step_name: 'b',
            data: { node_output: 'B0' },
          },
          {
            ...mockEvent,
            id: 'evt-retry',
            event_type: 'node_retry_requested',
            step_name: 'b',
            data: { node_id: 'b', retry_epoch: 1, invalidated_node_ids: ['b', 'c'] },
          },
        ])
      );

      const result = await getRetryPreservedDagNodeOutputs('run-retry-preserve', ['b', 'c']);

      expect(result).toEqual(new Map([['a', 'A0']]));
    });
  });
});
