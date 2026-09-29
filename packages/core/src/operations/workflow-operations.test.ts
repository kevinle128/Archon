import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PendingInteraction } from '@archon/workflows/schemas/pending-interaction';

// ---------------------------------------------------------------------------
// Mock DB modules before importing the module under test
// ---------------------------------------------------------------------------

const mockGetWorkflowRun = mock(() => Promise.resolve(null));
const mockListWorkflowRuns = mock(() => Promise.resolve([]));
const mockUpdateWorkflowRun = mock(() => Promise.resolve());
const mockCancelWorkflowRun = mock(() => Promise.resolve({ cancelled: true }));
const mockFindChildRuns = mock((): Promise<unknown[]> => Promise.resolve([]));
// CAS gate resolvers (#2113): default to "won the race". Tests that simulate a
// concurrent loser override with mockResolvedValueOnce({ resolved: false }).
// resolveApprovalGate = stay-paused resolution (approve, reject stage-rework);
// resolveAndCancelApprovalGate = atomic resolve + cancel (reject terminal paths).
const mockResolveApprovalGate = mock(() => Promise.resolve({ resolved: true }));
const mockResolveAndCancelApprovalGate = mock(() => Promise.resolve({ resolved: true }));
const mockTransitionPlannotatorGate = mock(() =>
  Promise.resolve({ outcome: 'updated' as const, approval: {} })
);

mock.module('../db/workflows', () => ({
  getWorkflowRun: mockGetWorkflowRun,
  listWorkflowRuns: mockListWorkflowRuns,
  updateWorkflowRun: mockUpdateWorkflowRun,
  cancelWorkflowRun: mockCancelWorkflowRun,
  findChildRuns: mockFindChildRuns,
  resolveApprovalGate: mockResolveApprovalGate,
  resolveAndCancelApprovalGate: mockResolveAndCancelApprovalGate,
  transitionPlannotatorGate: mockTransitionPlannotatorGate,
}));

const mockCreateWorkflowEvent = mock(() => Promise.resolve());
interface MockNonTerminalNode {
  nodeId: string;
  scope: Record<string, unknown>;
  terminalEventType: 'node_failed' | 'loop_iteration_failed';
}
const mockFindNonTerminalNodes = mock((): Promise<MockNonTerminalNode[]> => Promise.resolve([]));

mock.module('../db/workflow-events', () => ({
  createWorkflowEvent: mockCreateWorkflowEvent,
  findNonTerminalNodes: mockFindNonTerminalNodes,
}));

const mockDeleteWorkflowNodeSessions = mock(() => Promise.resolve({ deleted: 0 }));

mock.module('../db/workflow-node-sessions', () => ({
  deleteWorkflowNodeSessions: mockDeleteWorkflowNodeSessions,
}));

// abandonWorkflow lazily imports cleanup-service to reclaim a container run's
// resources (M2). Mock it so the dynamic import doesn't pull the docker chain.
const mockReclaimContainerEnv = mock(() => Promise.resolve());
mock.module('../services/cleanup-service', () => ({
  reclaimContainerEnv: mockReclaimContainerEnv,
}));

const mockListPendingInteractions = mock(() => Promise.resolve([] as PendingInteraction[]));
const mockResolvePendingInteraction = mock(() =>
  Promise.resolve({
    interaction: {
      id: 'pi-1',
      workflow_run_id: 'run-1',
      node_id: 'ask-node',
      tool_use_id: 'tool-1',
      kind: 'ask' as const,
      status: 'answered' as const,
      envelope: {},
      answer: { decline: true },
      provider_session_id: 'sess-1',
      created_at: new Date(),
      resolved_at: new Date(),
      resolved_by: 'starter-1',
    },
    resumed: false,
    remaining_pending: 1,
  })
);
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

const mockEmit = mock((_event: unknown) => undefined);
// Default: no run is registered — every existing test in this file exercises
// a run with no live executor in this (test) process, matching production
// reality for a unit test that never starts a real dag-executor.
const mockGetConversationId = mock((_runId: string): string | undefined => undefined);
const mockRegisterRun = mock((_runId: string, _conversationId: string) => undefined);
const mockUnregisterRun = mock((_runId: string) => undefined);
mock.module('@archon/workflows/event-emitter', () => ({
  getWorkflowEventEmitter: () => ({
    emit: mockEmit,
    getConversationId: mockGetConversationId,
    registerRun: mockRegisterRun,
    unregisterRun: mockUnregisterRun,
  }),
}));

interface MockConversation {
  platform_conversation_id: string;
}
// Default: resolves, matching production reality for a run whose conversation
// row still exists — the abandon-of-a-restart-recovered-run tests below exercise
// the null/throw fallbacks explicitly.
const mockGetConversationById = mock(
  (_id: string): Promise<MockConversation | null> =>
    Promise.resolve({ platform_conversation_id: 'web-conv-1' })
);
mock.module('../db/conversations', () => ({
  getConversationById: mockGetConversationById,
}));

const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
};
const mockCaptureApprovalResolved = mock(() => undefined);
mock.module('@archon/paths', () => ({
  captureApprovalResolved: mockCaptureApprovalResolved,
  createLogger: mock(() => mockLogger),
}));

// Import AFTER mocks
const {
  approveWorkflow,
  reviewOpenWorkflow,
  rejectWorkflow,
  getWorkflowStatus,
  resumeWorkflow,
  abandonWorkflow,
  resetWorkflowNodeSessions,
  answerAskHuman,
  AskHumanRunNotFoundError,
  confirmPermission,
  PermissionAuthenticationRequiredError,
  PermissionForbiddenError,
  PermissionRunNotFoundError,
} = await import('./workflow-operations');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePausedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    workflow_name: 'test-workflow',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: 'cb-1',
    status: 'paused',
    user_message: 'test',
    metadata: {
      approval: {
        nodeId: 'review',
        message: 'Please review',
        type: 'approval',
      },
    },
    started_at: new Date(),
    completed_at: null,
    last_activity_at: null,
    working_path: '/workspace/worktree',
    ...overrides,
  };
}

const ANSWER_SENTINEL = 'UNIQUE_ANSWER_SENTINEL_US006';
const PROMPT_SENTINEL = 'UNIQUE_PROMPT_SENTINEL_US006';

function makePendingInteraction(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'pi-1',
    workflow_run_id: 'run-1',
    node_id: 'ask-node',
    tool_use_id: 'tool-1',
    kind: 'ask',
    status: 'pending',
    envelope: { questions: [{ id: 'q1', prompt: PROMPT_SENTINEL }] },
    answer: null,
    provider_session_id: 'sess-1',
    created_at: new Date(),
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function loggerAndEmitPayloads(): string {
  return JSON.stringify([
    ...mockLogger.fatal.mock.calls,
    ...mockLogger.error.mock.calls,
    ...mockLogger.warn.mock.calls,
    ...mockLogger.info.mock.calls,
    ...mockLogger.debug.mock.calls,
    ...mockLogger.trace.mock.calls,
    ...mockEmit.mock.calls,
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reviewOpenWorkflow', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockUpdateWorkflowRun.mockClear();
    mockTransitionPlannotatorGate.mockReset();
    mockTransitionPlannotatorGate.mockResolvedValue({ outcome: 'updated', approval: {} });
  });

  test('atomically rotates an open Plannotator gate and returns explicit resume context', async () => {
    mockGetWorkflowRun.mockResolvedValue(
      makePausedRun({
        metadata: {
          approval: {
            nodeId: 'review',
            message: 'Please review',
            type: 'plannotator_gate',
            gateId: 'old-gate',
            document: '/workspace/review.html',
            phase: 'idle',
          },
        },
      })
    );

    const result = await reviewOpenWorkflow('run-1');

    expect(mockTransitionPlannotatorGate).toHaveBeenCalledTimes(1);
    const transition = mockTransitionPlannotatorGate.mock.calls[0]?.[0];
    expect(transition).toMatchObject({
      runId: 'run-1',
      nodeId: 'review',
      expectedGateId: 'old-gate',
      document: '/workspace/review.html',
      phase: 'opening',
    });
    expect(transition?.nextGateId).toEqual(expect.any(String));
    expect(transition?.nextGateId).not.toBe('old-gate');
    expect(mockUpdateWorkflowRun).not.toHaveBeenCalled();
    expect(result).toEqual({
      document: '/workspace/review.html',
      nodeId: 'review',
      phase: 'opening',
      continuation: 'caller_resume',
      workflowName: 'test-workflow',
      workingPath: '/workspace/worktree',
      userMessage: 'test',
      codebaseId: 'cb-1',
      conversationId: 'conv-1',
    });
  });

  test.each([
    [
      'non-paused',
      makePausedRun({ status: 'running' }),
      "Cannot review-open run with status 'running'",
    ],
    [
      'resolved',
      makePausedRun({
        metadata: {
          approval: {
            nodeId: 'review',
            message: 'Please review',
            type: 'plannotator_gate',
            gateId: 'gate-1',
            document: '/workspace/review.html',
            resolved: 'approved',
          },
        },
      }),
      'already approved',
    ],
    ['non-Plannotator', makePausedRun(), 'not paused at a plannotator_gate'],
    [
      'missing-document',
      makePausedRun({
        metadata: {
          approval: {
            nodeId: 'review',
            message: 'Please review',
            type: 'plannotator_gate',
            gateId: 'gate-1',
          },
        },
      }),
      'no document path',
    ],
  ])('rejects %s runs', async (_case, run, message) => {
    mockGetWorkflowRun.mockResolvedValue(run);

    await expect(reviewOpenWorkflow('run-1')).rejects.toThrow(message);
    expect(mockTransitionPlannotatorGate).not.toHaveBeenCalled();
  });

  test.each([
    [
      { outcome: 'resolved' as const, resolved: 'rejected' as const },
      'already rejected and is awaiting resume',
    ],
    [{ outcome: 'superseded' as const }, 'ownership changed before review-open'],
    [
      { outcome: 'stopped' as const, status: 'cancelled' as const },
      "stopped with status 'cancelled' before review-open",
    ],
  ])('turns transition outcome into an actionable error', async (outcome, message) => {
    mockGetWorkflowRun.mockResolvedValue(
      makePausedRun({
        metadata: {
          approval: {
            nodeId: 'review',
            message: 'Please review',
            type: 'plannotator_gate',
            gateId: 'gate-1',
            document: '/workspace/review.html',
          },
        },
      })
    );
    mockTransitionPlannotatorGate.mockResolvedValue(outcome);

    await expect(reviewOpenWorkflow('run-1')).rejects.toThrow(message);
  });
});

describe('approveWorkflow', () => {
  beforeEach(() => {
    mockCaptureApprovalResolved.mockClear();
    mockGetWorkflowRun.mockClear();
    mockCreateWorkflowEvent.mockClear();
    mockUpdateWorkflowRun.mockClear();
    mockResolveApprovalGate.mockClear();
    mockCancelWorkflowRun.mockClear();
    mockCancelWorkflowRun.mockResolvedValue({ cancelled: true });
    mockFindChildRuns.mockClear();
    mockFindChildRuns.mockResolvedValue([]);
  });

  test('approves standard approval gate — writes node_completed + approval_received', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun());

    const result = await approveWorkflow('run-1', 'Looks good');

    expect(result.type).toBe('approval_gate');
    expect(result.workflowName).toBe('test-workflow');
    expect(result.workingPath).toBe('/workspace/worktree');

    // Operations no longer writes events directly — node_completed + approval_received
    // ride the CAS transaction as its 4th argument (#2146).
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();

    // Stays 'paused' (no status write) — resolution recorded atomically via the
    // CAS on the approval context + rejection state cleared (#2075/#2113), with the
    // audit events written in the same transaction (#2146).
    expect(mockResolveApprovalGate).toHaveBeenCalledWith(
      'run-1',
      { nodeId: 'review', gateId: undefined },
      {
        approval: {
          nodeId: 'review',
          message: 'Please review',
          type: 'approval',
          resolved: 'approved',
        },
        approval_response: 'approved',
        rejection_reason: '',
        rejection_count: 0,
      },
      [
        {
          event_type: 'node_completed',
          step_name: 'review',
          data: { node_output: '', approval_decision: 'approved' },
        },
        {
          event_type: 'approval_received',
          step_name: 'review',
          data: { decision: 'approved', comment: 'Looks good' },
        },
      ]
    );

    // Anonymous telemetry: binary resolution captured exactly once
    expect(mockCaptureApprovalResolved).toHaveBeenCalledTimes(1);
    expect(mockCaptureApprovalResolved).toHaveBeenCalledWith({ resolution: 'approved' });
  });

  test('assigns continuation ownership to a live plannotator supervisor', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      makePausedRun({
        metadata: {
          approval: {
            nodeId: 'review',
            message: 'Review in Plannotator',
            type: 'plannotator_gate',
            gateId: 'gate-1',
          },
        },
      })
    );

    const result = await approveWorkflow('run-1', 'Looks good');

    expect(result.continuation).toBe('live_plannotator_supervisor');
  });

  test('approves interactive_loop — writes only approval_received, stores loop_user_input', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'iterate',
          message: 'Provide feedback',
          type: 'interactive_loop',
          iteration: 2,
        },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    const result = await approveWorkflow('run-1', 'fix the tests');

    expect(result.type).toBe('interactive_loop');

    // Operations no longer writes events directly.
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    // Only approval_received rides the CAS — NOT node_completed (the executor
    // writes that on the real completion signal / at resume).
    const casEvents = mockResolveApprovalGate.mock.calls[0][3] as Array<Record<string, unknown>>;
    expect(casEvents).toHaveLength(1);
    expect(casEvents[0].event_type).toBe('approval_received');

    // Stays 'paused' (no status write) — stores loop_user_input and marks the
    // approval context resolved, preserving iteration for startIteration detection
    expect(mockResolveApprovalGate).toHaveBeenCalledWith(
      'run-1',
      { nodeId: 'iterate', gateId: undefined },
      {
        approval: {
          nodeId: 'iterate',
          message: 'Provide feedback',
          type: 'interactive_loop',
          iteration: 2,
          resolved: 'approved',
        },
        loop_user_input: 'fix the tests',
        // Real feedback ⇒ the resumed loop iterates (#2074)
        loop_feedback_given: true,
      },
      [
        {
          event_type: 'approval_received',
          step_name: 'iterate',
          data: { decision: 'approved', comment: 'fix the tests', iteration: 2 },
        },
      ]
    );
  });

  test('interactive_loop bare approve — loop_feedback_given false, loop_user_input defaults (#2074)', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'iterate',
          message: 'Provide feedback',
          type: 'interactive_loop',
          iteration: 1,
          completionSignaled: true,
          signaledOutput: 'REPORT',
        },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    await approveWorkflow('run-1');

    expect(mockResolveApprovalGate).toHaveBeenCalledWith(
      'run-1',
      { nodeId: 'iterate', gateId: undefined },
      {
        approval: {
          nodeId: 'iterate',
          message: 'Provide feedback',
          type: 'interactive_loop',
          iteration: 1,
          completionSignaled: true,
          signaledOutput: 'REPORT',
          resolved: 'approved',
        },
        // The recorded comment still defaults to 'Approved' (events/$LOOP_USER_INPUT
        // for non-signaled iterate paths) — only the boolean sees the raw undefined.
        loop_user_input: 'Approved',
        loop_feedback_given: false,
      },
      [
        {
          event_type: 'approval_received',
          step_name: 'iterate',
          data: { decision: 'approved', comment: 'Approved', iteration: 1 },
        },
      ]
    );
  });

  test('interactive_loop whitespace-only comment counts as no feedback (#2074)', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'iterate',
          message: 'Provide feedback',
          type: 'interactive_loop',
          iteration: 1,
        },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    await approveWorkflow('run-1', '   ');

    const casMetadata = mockResolveApprovalGate.mock.calls[0][2] as Record<string, unknown>;
    expect(casMetadata.loop_feedback_given).toBe(false);
    // Whitespace-only also gets the documented recorded-comment default —
    // '   ' must never be stored verbatim as $LOOP_USER_INPUT.
    expect(casMetadata.loop_user_input).toBe('Approved');
  });

  test('throws on already-resolved gate (double-approve guard)', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'review',
          message: 'Please review',
          type: 'approval',
          resolved: 'approved',
        },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    await expect(approveWorkflow('run-1')).rejects.toThrow(
      'already approved and is awaiting resume'
    );
    // Fast-path: the in-memory read blocks before any CAS / events / telemetry
    expect(mockResolveApprovalGate).not.toHaveBeenCalled();
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    expect(mockCaptureApprovalResolved).not.toHaveBeenCalled();
    expect(mockUpdateWorkflowRun).not.toHaveBeenCalled();
  });

  test('concurrent loser (CAS miss) writes NO events or telemetry (#2113)', async () => {
    // Both callers read an UNRESOLVED gate (fast-path passes), but only one wins
    // the atomic CAS. The loser must not duplicate events/telemetry.
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun());
    mockResolveApprovalGate.mockResolvedValueOnce({ resolved: false });

    await expect(approveWorkflow('run-1', 'ship it')).rejects.toThrow(
      'already resolved and is awaiting resume'
    );

    // The CAS was attempted (unlike the fast-path guard) but lost — no side effects.
    expect(mockResolveApprovalGate).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    expect(mockCaptureApprovalResolved).not.toHaveBeenCalled();
  });

  test('approves with captureResponse — stores comment as node output', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'review',
          message: 'Review',
          type: 'approval',
          captureResponse: true,
        },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    await approveWorkflow('run-1', 'My review notes');

    // The node_output rides the CAS events (#2146), not a separate event write.
    const casEvents = mockResolveApprovalGate.mock.calls[0][3] as Array<Record<string, unknown>>;
    const nodeCompleted = casEvents.find(e => e.event_type === 'node_completed');
    expect((nodeCompleted?.data as Record<string, unknown>).node_output).toBe('My review notes');
  });

  test('throws on non-paused run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));

    await expect(approveWorkflow('run-1')).rejects.toThrow(
      "Cannot approve run with status 'running'"
    );
  });

  test('throws on missing approval context', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ metadata: {} }));

    await expect(approveWorkflow('run-1')).rejects.toThrow('missing approval context');
  });

  test('throws on run not found', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);

    await expect(approveWorkflow('run-1')).rejects.toThrow('Workflow run not found: run-1');
  });

  test('approves container write-back gate — records approval_response, NO node_completed', async () => {
    const run = makePausedRun({
      metadata: {
        approval: { nodeId: '__writeback__', message: '7 files changed', type: 'writeback' },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    const result = await approveWorkflow('run-1');

    expect(result.type).toBe('approval_gate');
    // The resumed executor's write-back gate reads approval_response to APPLY.
    expect(mockResolveApprovalGate).toHaveBeenCalledWith(
      'run-1',
      { nodeId: '__writeback__', gateId: undefined },
      {
        approval: {
          nodeId: '__writeback__',
          message: '7 files changed',
          type: 'writeback',
          resolved: 'approved',
        },
        approval_response: 'approved',
      },
      [
        {
          event_type: 'approval_received',
          step_name: '__writeback__',
          data: { decision: 'approved', comment: 'Approved', gate: 'writeback' },
        },
      ]
    );
    // No node_completed — there is no DAG node behind the write-back gate.
    const casEvents = mockResolveApprovalGate.mock.calls[0][3] as Array<Record<string, unknown>>;
    expect(casEvents.every(e => e.event_type !== 'node_completed')).toBe(true);
  });

  test('refuses a child_workflow-blocked parent — redirects to the child run, writes nothing', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'implement-qa',
          message: 'Blocked on sub-run',
          type: 'child_workflow',
          childRunId: 'child-run-9',
        },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    await expect(approveWorkflow('run-1')).rejects.toThrow(
      /waiting on sub-run child-run-9.*approve child-run-9/i
    );
    // Nothing resolved, nothing stamped — a fall-through here would write a bogus
    // node_completed for the workflow node and orphan the paused child.
    expect(mockResolveApprovalGate).not.toHaveBeenCalled();
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
  });
});

describe('rejectWorkflow', () => {
  beforeEach(() => {
    mockCaptureApprovalResolved.mockClear();
    mockGetWorkflowRun.mockClear();
    mockCreateWorkflowEvent.mockClear();
    mockUpdateWorkflowRun.mockClear();
    mockCancelWorkflowRun.mockClear();
    mockResolveApprovalGate.mockClear();
    mockResolveAndCancelApprovalGate.mockClear();
  });

  test('rejects with onRejectPrompt under max attempts — stays paused with staged rework', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'review',
          message: 'Review',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    const result = await rejectWorkflow('run-1', 'needs more tests');

    expect(result.cancelled).toBe(false);
    expect(result.workflowName).toBe('test-workflow');
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
    // Stays 'paused' (no status write) — rejection staged atomically via the CAS
    // on the approval context (#2075/#2113), with the audit event in the same
    // transaction (#2146)
    expect(mockResolveApprovalGate).toHaveBeenCalledWith(
      'run-1',
      { nodeId: 'review', gateId: undefined },
      {
        approval: {
          nodeId: 'review',
          message: 'Review',
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
          step_name: 'review',
          data: { decision: 'rejected', reason: 'needs more tests' },
        },
      ]
    );

    expect(mockCaptureApprovalResolved).toHaveBeenCalledTimes(1);
    expect(mockCaptureApprovalResolved).toHaveBeenCalledWith({ resolution: 'rejected' });
  });

  test('throws on already-resolved gate (double-reject guard)', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'review',
          message: 'Review',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          resolved: 'rejected',
        },
        rejection_count: 1,
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    await expect(rejectWorkflow('run-1', 'again')).rejects.toThrow(
      'already rejected and is awaiting resume'
    );
    // Fast-path: the in-memory read blocks before any CAS / events / cancel
    expect(mockResolveApprovalGate).not.toHaveBeenCalled();
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    expect(mockCaptureApprovalResolved).not.toHaveBeenCalled();
    expect(mockUpdateWorkflowRun).not.toHaveBeenCalled();
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
  });

  test('concurrent loser (CAS miss) writes NO events, telemetry, or cancel (#2113)', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'review',
          message: 'Review',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
        },
        rejection_count: 0,
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);
    // Fast-path passes (gate reads unresolved) but the atomic CAS is lost.
    mockResolveApprovalGate.mockResolvedValueOnce({ resolved: false });

    await expect(rejectWorkflow('run-1', 'needs work')).rejects.toThrow(
      'already resolved and is awaiting resume'
    );

    expect(mockResolveApprovalGate).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    expect(mockCaptureApprovalResolved).not.toHaveBeenCalled();
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
  });

  test('rejects at max attempts — cancels run', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'review',
          message: 'Review',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 2,
        },
        rejection_count: 1,
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    const result = await rejectWorkflow('run-1', 'still broken');

    expect(result.cancelled).toBe(true);
    expect(result.maxAttemptsReached).toBe(true);
    // Terminal reject resolves + cancels in ONE atomic CAS (#2113) — never a
    // separate cancelWorkflowRun that could fail and strand the run. The audit
    // event rides the same transaction (#2146).
    expect(mockResolveAndCancelApprovalGate).toHaveBeenCalledWith(
      'run-1',
      { nodeId: 'review', gateId: undefined },
      [
        {
          event_type: 'approval_received',
          step_name: 'review',
          data: { decision: 'rejected', reason: 'still broken' },
        },
      ]
    );
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
  });

  test('rejects without onRejectPrompt — cancels immediately', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      makePausedRun({
        metadata: {
          approval: {
            nodeId: 'review',
            message: 'Please review',
            type: 'approval',
            gateId: 'gate-a',
          },
        },
      })
    );

    const result = await rejectWorkflow('run-1', 'no good');

    expect(result.cancelled).toBe(true);
    expect(result.maxAttemptsReached).toBe(false);
    expect(mockResolveAndCancelApprovalGate).toHaveBeenCalledWith(
      'run-1',
      { nodeId: 'review', gateId: 'gate-a' },
      [
        {
          event_type: 'approval_received',
          step_name: 'review',
          data: { decision: 'rejected', reason: 'no good' },
        },
      ]
    );
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
  });

  test('terminal reject concurrent loser (CAS miss) writes NO event or telemetry (#2113)', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun());
    // No onRejectPrompt ⇒ the atomic resolve-and-cancel CAS is the guard.
    mockResolveAndCancelApprovalGate.mockResolvedValueOnce({ resolved: false });

    await expect(rejectWorkflow('run-1', 'no good')).rejects.toThrow(
      'already resolved and is awaiting resume'
    );

    expect(mockResolveAndCancelApprovalGate).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    expect(mockCaptureApprovalResolved).not.toHaveBeenCalled();
  });

  test('rejects container write-back gate — stays resumable (never cancels), writeBack flag set', async () => {
    const run = makePausedRun({
      metadata: {
        approval: { nodeId: '__writeback__', message: '3 files changed', type: 'writeback' },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    const result = await rejectWorkflow('run-1');

    // The run stays resumable so the resume DISCARDS the overlay + completes.
    expect(result.cancelled).toBe(false);
    expect(result.writeBack).toBe(true);
    expect(mockResolveAndCancelApprovalGate).not.toHaveBeenCalled();
    expect(mockResolveApprovalGate).toHaveBeenCalledWith(
      'run-1',
      { nodeId: '__writeback__', gateId: undefined },
      {
        approval: {
          nodeId: '__writeback__',
          message: '3 files changed',
          type: 'writeback',
          resolved: 'rejected',
        },
        approval_response: 'rejected',
      },
      [
        {
          event_type: 'approval_received',
          step_name: '__writeback__',
          data: { decision: 'rejected', gate: 'writeback' },
        },
      ]
    );
  });

  test('throws on non-paused run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'completed' }));

    await expect(rejectWorkflow('run-1')).rejects.toThrow(
      "Cannot reject run with status 'completed'"
    );
  });

  test('throws on paused run with missing approval context instead of cancelling', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ metadata: {} }));

    await expect(rejectWorkflow('run-1')).rejects.toThrow('missing approval context');

    // Must NOT have called resolveAndCancelApprovalGate — the run must not be cancelled
    expect(mockResolveAndCancelApprovalGate).not.toHaveBeenCalled();
    expect(mockResolveApprovalGate).not.toHaveBeenCalled();
  });

  test('refuses a child_workflow-blocked parent — redirects to the child run, cancels nothing', async () => {
    const run = makePausedRun({
      metadata: {
        approval: {
          nodeId: 'implement-qa',
          message: 'Blocked on sub-run',
          type: 'child_workflow',
          childRunId: 'child-run-9',
        },
      },
    });
    mockGetWorkflowRun.mockResolvedValueOnce(run);

    await expect(rejectWorkflow('run-1')).rejects.toThrow(
      /waiting on sub-run child-run-9.*reject child-run-9/i
    );
    // A fall-through would cancel the parent and silently orphan the paused child.
    expect(mockResolveApprovalGate).not.toHaveBeenCalled();
    expect(mockResolveAndCancelApprovalGate).not.toHaveBeenCalled();
    expect(mockCancelWorkflowRun).not.toHaveBeenCalled();
  });
});

describe('getWorkflowStatus', () => {
  beforeEach(() => {
    mockListWorkflowRuns.mockClear();
  });

  test('returns running and paused runs', async () => {
    const runs = [
      makePausedRun({ status: 'running' }),
      makePausedRun({ id: 'run-2', status: 'paused' }),
    ];
    mockListWorkflowRuns.mockResolvedValueOnce(runs);

    const result = await getWorkflowStatus();

    expect(result.runs).toHaveLength(2);
    expect(mockListWorkflowRuns).toHaveBeenCalledWith({
      status: ['running', 'paused'],
      limit: 50,
    });
  });
});

describe('answerAskHuman', () => {
  const starterId = 'starter-1';
  const answerBody = {
    answers: [{ questionId: 'q1', value: ANSWER_SENTINEL }],
  } as const;

  beforeEach(() => {
    mockGetWorkflowRun.mockReset();
    mockResolvePendingInteraction.mockReset();
    mockResolvePendingInteraction.mockResolvedValue({
      interaction: makePendingInteraction({
        status: 'answered',
        answer: { answers: [{ questionId: 'q1', value: ANSWER_SENTINEL }] },
        resolved_at: new Date(),
        resolved_by: starterId,
      }),
      resumed: false,
      remaining_pending: 1,
    });
    mockEmit.mockClear();
    mockLogger.fatal.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.info.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.trace.mockClear();
  });

  test('defaults a missing actor to admin', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: starterId }));

    await answerAskHuman({
      runId: 'run-1',
      requestId: 'tool-1',
      body: answerBody,
      actorUserId: undefined,
    });

    expect(mockResolvePendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      tool_use_id: 'tool-1',
      answer: answerBody,
      resolved_by: 'admin',
    });
  });

  test('accepts an actor who is not the run starter', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: starterId }));

    await answerAskHuman({
      runId: 'run-1',
      requestId: 'tool-1',
      body: answerBody,
      actorUserId: 'admin-upstream',
    });

    expect(mockResolvePendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      tool_use_id: 'tool-1',
      answer: answerBody,
      resolved_by: 'admin-upstream',
    });
  });

  test('accepts an unowned run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: null }));

    await answerAskHuman({
      runId: 'run-1',
      requestId: 'tool-1',
      body: answerBody,
      actorUserId: starterId,
    });

    expect(mockResolvePendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      tool_use_id: 'tool-1',
      answer: answerBody,
      resolved_by: starterId,
    });
  });

  test('passes the matching starter as resolved_by', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: starterId }));

    await answerAskHuman({
      runId: 'run-1',
      requestId: 'tool-1',
      body: answerBody,
      actorUserId: starterId,
    });

    expect(mockResolvePendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      tool_use_id: 'tool-1',
      answer: answerBody,
      resolved_by: starterId,
    });
  });

  test('throws AskHumanRunNotFoundError when the run is missing', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(null);

    await expect(
      answerAskHuman({
        runId: 'run-missing',
        requestId: 'tool-1',
        body: answerBody,
        actorUserId: starterId,
      })
    ).rejects.toBeInstanceOf(AskHumanRunNotFoundError);
    expect(mockResolvePendingInteraction).not.toHaveBeenCalled();
  });

  test('logs and emits only after persistence resolves and omits answer/prompt sentinels', async () => {
    const pausedRun = makePausedRun({ user_id: starterId });
    mockGetWorkflowRun.mockResolvedValueOnce(pausedRun);
    const answered = makePendingInteraction({
      status: 'answered',
      answer: { answers: [{ questionId: 'q1', value: ANSWER_SENTINEL }] },
      envelope: { questions: [{ id: 'q1', prompt: PROMPT_SENTINEL }] },
      resolved_at: new Date(),
      resolved_by: starterId,
    });
    let resolvePersistence!: (value: {
      interaction: PendingInteraction;
      resumed: boolean;
      remaining_pending: number;
    }) => void;
    const persistence = new Promise<{
      interaction: PendingInteraction;
      resumed: boolean;
      remaining_pending: number;
    }>(resolve => {
      resolvePersistence = resolve;
    });
    mockResolvePendingInteraction.mockReset();
    mockResolvePendingInteraction.mockReturnValueOnce(persistence);

    const pending = answerAskHuman({
      runId: 'run-1',
      requestId: 'tool-1',
      body: answerBody,
      actorUserId: starterId,
    });
    await Promise.resolve();
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();

    resolvePersistence({
      interaction: answered,
      resumed: true,
      remaining_pending: 0,
    });
    const result = await pending;

    expect(result.run).toBe(pausedRun);
    expect(result.interaction).toBe(answered);
    expect(result.resumed).toBe(true);
    expect(result.remainingPending).toBe(0);
    expect(mockLogger.info).toHaveBeenCalledWith(
      {
        workflowRunId: 'run-1',
        nodeId: 'ask-node',
        toolUseId: 'tool-1',
        declined: false,
        resumed: true,
      },
      'workflow.ask_resolved'
    );
    expect(mockEmit).toHaveBeenCalledWith({
      type: 'interaction_resolved',
      runId: 'run-1',
      nodeId: 'ask-node',
      resumed: true,
    });
    const payloads = loggerAndEmitPayloads();
    expect(payloads).not.toContain(ANSWER_SENTINEL);
    expect(payloads).not.toContain(PROMPT_SENTINEL);
  });

  test('logs declined true after a decline commit', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: starterId }));
    mockResolvePendingInteraction.mockResolvedValueOnce({
      interaction: makePendingInteraction({
        status: 'answered',
        answer: { decline: true },
        resolved_at: new Date(),
        resolved_by: starterId,
      }),
      resumed: false,
      remaining_pending: 0,
    });

    await answerAskHuman({
      runId: 'run-1',
      requestId: 'tool-1',
      body: { decline: true },
      actorUserId: starterId,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ declined: true, resumed: false }),
      'workflow.ask_resolved'
    );
  });

  test('propagates typed persistence errors without remapping', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ user_id: starterId }));
    const persistenceError = new Error('already resolved');
    persistenceError.name = 'PendingInteractionAlreadyResolvedError';
    mockResolvePendingInteraction.mockRejectedValueOnce(persistenceError);

    await expect(
      answerAskHuman({
        runId: 'run-1',
        requestId: 'tool-1',
        body: answerBody,
        actorUserId: starterId,
      })
    ).rejects.toBe(persistenceError);
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

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

describe('resumeWorkflow', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockClear();
    mockListPendingInteractions.mockReset();
    mockListPendingInteractions.mockResolvedValue([]);
  });

  test.each(['failed', 'paused', 'cancelled'] as const)(
    'returns run when status is %s',
    async status => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status }));

      const run = await resumeWorkflow('run-1');
      expect(run.id).toBe('run-1');
      expect(run.status).toBe(status);
    }
  );

  test('throws on non-resumable status', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'completed' }));

    await expect(resumeWorkflow('run-1')).rejects.toThrow(
      "Cannot resume run with status 'completed'"
    );
  });

  test('rejects any run with a pending interaction', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'paused' }));
    mockListPendingInteractions.mockResolvedValueOnce([makePendingInteraction()]);

    await expect(resumeWorkflow('run-1')).rejects.toThrow(
      'Answer or decline the Ask before resuming run run-1'
    );
  });

  test('accepts an already-running run with an answered Ask and zero pending', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
    mockListPendingInteractions.mockResolvedValueOnce([
      makePendingInteraction({
        status: 'answered',
        answer: { answers: [{ questionId: 'q1', value: 'yes' }] },
        resolved_at: new Date(),
        resolved_by: 'starter-1',
      }),
    ]);

    const run = await resumeWorkflow('run-1');
    expect(run.status).toBe('running');
  });

  test('rejects a plain running run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));

    await expect(resumeWorkflow('run-1')).rejects.toThrow(
      "Cannot resume run with status 'running'"
    );
  });

  test('throws wrapped message and logs when DB throws', async () => {
    mockGetWorkflowRun.mockRejectedValueOnce(new Error('connection reset'));

    await expect(resumeWorkflow('run-1')).rejects.toThrow(
      'Failed to look up workflow run run-1: connection reset'
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      'operations.workflow_resume_lookup_failed'
    );
  });
});

describe('abandonWorkflow', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockClear();
    mockCancelWorkflowRun.mockClear();
    mockCancelWorkflowRun.mockImplementation(() => Promise.resolve({ cancelled: true }));
    mockReclaimContainerEnv.mockClear();
    mockReclaimContainerEnv.mockImplementation(() => Promise.resolve());
    mockFindChildRuns.mockClear();
    mockFindChildRuns.mockImplementation(() => Promise.resolve([]));
    mockFindNonTerminalNodes.mockClear();
    mockFindNonTerminalNodes.mockImplementation(() => Promise.resolve([]));
    mockCreateWorkflowEvent.mockClear();
    mockEmit.mockClear();
    mockGetConversationId.mockClear();
    mockGetConversationId.mockImplementation(() => undefined);
    mockRegisterRun.mockClear();
    mockUnregisterRun.mockClear();
    mockGetConversationById.mockClear();
    mockGetConversationById.mockImplementation(() =>
      Promise.resolve({ platform_conversation_id: 'web-conv-1' })
    );
  });

  test('cancels a non-terminal run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));

    const { run, cascadeFailures, blockedParentRunId } = await abandonWorkflow('run-1');
    expect(run.id).toBe('run-1');
    expect(cascadeFailures).toBe(0);
    expect(blockedParentRunId).toBeNull();
    expect(mockCancelWorkflowRun).toHaveBeenCalledWith('run-1');
  });

  // #2121 Phase 2 (D7): abandoning a parent cascade-cancels its non-terminal
  // sub-run descendants (children AND grandchildren), skipping already-terminal ones.
  test('cascade-cancels non-terminal sub-run descendants', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
    // run-1 → [child-a (paused), child-done (completed)]; child-a → [grandchild (running)].
    mockFindChildRuns.mockImplementation((parentId: unknown) => {
      if (parentId === 'run-1') {
        return Promise.resolve([
          { id: 'child-a', status: 'paused' },
          { id: 'child-done', status: 'completed' },
        ]);
      }
      if (parentId === 'child-a') {
        return Promise.resolve([{ id: 'grandchild', status: 'running' }]);
      }
      return Promise.resolve([]);
    });

    await abandonWorkflow('run-1');

    const cancelled = mockCancelWorkflowRun.mock.calls.map(c => c[0]);
    expect(cancelled).toContain('run-1'); // the parent itself
    expect(cancelled).toContain('child-a'); // non-terminal child
    expect(cancelled).toContain('grandchild'); // non-terminal grandchild
    expect(cancelled).not.toContain('child-done'); // already terminal — skipped
  });

  // Best-effort resilience: one descendant's cancel throwing must not abort the
  // walk — siblings still get cancelled, and the failure count is surfaced.
  test('cascade continues past a failing descendant and reports the failure count', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
    mockFindChildRuns.mockImplementation((parentId: unknown) => {
      if (parentId === 'run-1') {
        return Promise.resolve([
          { id: 'child-a', status: 'running' },
          { id: 'child-b', status: 'paused' },
          { id: 'child-c', status: 'running' },
        ]);
      }
      return Promise.resolve([]);
    });
    mockCancelWorkflowRun.mockImplementation((id: unknown) =>
      id === 'child-b' ? Promise.reject(new Error('db blip')) : Promise.resolve({ cancelled: true })
    );

    const { cascadeFailures } = await abandonWorkflow('run-1');

    expect(cascadeFailures).toBe(1);
    const cancelled = mockCancelWorkflowRun.mock.calls.map(c => c[0]);
    expect(cancelled).toContain('child-a');
    expect(cancelled).toContain('child-c'); // sibling AFTER the failure still cancelled
  });

  // S1: an unbounded-deep tree hits the MAX_CASCADE_RUNS cap. Truncation must be
  // REPORTED (non-zero cascadeFailures + a log), not silently returned as all-clear —
  // otherwise the caller tells the user "abandoned, 0 failures" while descendants live.
  test('reports truncation (does not silently stop) when the cascade hits its cap', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
    // Infinite chain: every run has exactly one new, unique, non-terminal child. Only
    // the cap terminates the walk — the test completing at all proves the bound holds.
    mockFindChildRuns.mockImplementation((parentId: unknown) =>
      Promise.resolve([{ id: `${String(parentId)}::c`, status: 'running' }])
    );

    const { cascadeFailures } = await abandonWorkflow('run-1');

    // Unreached descendants surface via the failures channel.
    expect(cascadeFailures).toBeGreaterThan(0);
    // The walk was bounded (never looped forever) — findChildRuns was called a
    // finite number of times despite the infinite chain.
    expect(mockFindChildRuns.mock.calls.length).toBeLessThanOrEqual(501);
    expect(mockFindChildRuns.mock.calls.length).toBeGreaterThan(1);
  });

  // Abandoning a CHILD directly strands a parent paused on it — the op surfaces
  // the blocked parent's id so callers can point the user at it.
  test('surfaces the parent run id when abandoning a child its parent is blocked on', async () => {
    const child = makePausedRun({
      id: 'child-1',
      status: 'running',
      parent_run_id: 'parent-1',
    });
    const parent = makePausedRun({
      id: 'parent-1',
      status: 'paused',
      metadata: {
        approval: {
          nodeId: 'sub',
          message: 'Blocked on sub-run',
          type: 'child_workflow',
          childRunId: 'child-1',
        },
      },
    });
    mockGetWorkflowRun.mockImplementation((id: unknown) =>
      Promise.resolve(id === 'child-1' ? child : id === 'parent-1' ? parent : null)
    );

    const { blockedParentRunId } = await abandonWorkflow('child-1');
    expect(blockedParentRunId).toBe('parent-1');

    // Parent paused on a DIFFERENT child → not blocked on us → null.
    (parent.metadata as { approval: { childRunId: string } }).approval.childRunId = 'other-child';
    const second = await abandonWorkflow('child-1');
    expect(second.blockedParentRunId).toBeNull();
    mockGetWorkflowRun.mockReset();
    mockGetWorkflowRun.mockImplementation(() => Promise.resolve(null));
  });

  // The cascade only runs when OUR cancel won the CAS (`cancelled: true`).
  test('does not cascade when the parent cancel loses the race', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'paused' }));
    mockCancelWorkflowRun.mockImplementationOnce(() => Promise.resolve({ cancelled: false }));
    await abandonWorkflow('run-1');
    // findChildRuns is never consulted (no cascade) when the CAS was lost.
    expect(mockFindChildRuns).not.toHaveBeenCalled();
  });

  // M2 — abandoning a CONTAINER run reclaims its container + volume in the SHARED op
  // (so web/chat/manage_run/Slack, not just the CLI, free the resources immediately).
  test('reclaims a container run’s env on abandon', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      makePausedRun({
        status: 'paused',
        metadata: { isolation: 'container', isolation_env_id: 'env-9' },
      })
    );
    await abandonWorkflow('run-1');
    expect(mockReclaimContainerEnv).toHaveBeenCalledWith('env-9');
  });

  test('does not reclaim for a non-container run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
    await abandonWorkflow('run-1');
    expect(mockReclaimContainerEnv).not.toHaveBeenCalled();
  });

  // Race: a concurrent transition already took the run terminal, so our cancel CAS
  // no-ops (`cancelled: false`). The winner OWNS the environment — we must NOT reclaim.
  test('does not reclaim a container run when the cancel loses the race', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      makePausedRun({
        status: 'paused',
        metadata: { isolation: 'container', isolation_env_id: 'env-9' },
      })
    );
    mockCancelWorkflowRun.mockImplementationOnce(() => Promise.resolve({ cancelled: false }));
    await abandonWorkflow('run-1');
    expect(mockReclaimContainerEnv).not.toHaveBeenCalled();
  });

  test('a reclaim failure does not fail the abandon (best-effort)', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(
      makePausedRun({
        status: 'paused',
        metadata: { isolation: 'container', isolation_env_id: 'env-9' },
      })
    );
    mockReclaimContainerEnv.mockImplementationOnce(() => Promise.reject(new Error('docker down')));
    const { run } = await abandonWorkflow('run-1'); // resolves despite the reclaim throw
    expect(run.id).toBe('run-1');
    expect(mockCancelWorkflowRun).toHaveBeenCalledWith('run-1');
  });

  test('cancels a failed run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'failed' }));

    const { run, cascadeFailures, blockedParentRunId } = await abandonWorkflow('run-1');
    expect(run.id).toBe('run-1');
    expect(cascadeFailures).toBe(0);
    expect(blockedParentRunId).toBeNull();
    expect(mockCancelWorkflowRun).toHaveBeenCalledWith('run-1');
  });

  test('throws on completed run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'completed' }));

    await expect(abandonWorkflow('run-1')).rejects.toThrow(
      "Cannot abandon run with status 'completed'"
    );
  });

  test('throws on cancelled run', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'cancelled' }));

    await expect(abandonWorkflow('run-1')).rejects.toThrow(
      "Cannot abandon run with status 'cancelled'"
    );
  });

  // A restart-recovered run has no live executor in THIS process — nothing
  // ever writes the node_failed event a live cancel path would, so the
  // Console/Legacy header stays on a stale "running" projection indefinitely.
  // Abandon is the explicit user action that settles it.
  describe('terminal node events for a run with no live executor here', () => {
    test('writes one node_failed event per non-terminal node, and emits it for a live UI refresh', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
      mockFindNonTerminalNodes.mockResolvedValueOnce([
        { nodeId: 'prompt-a', scope: {}, terminalEventType: 'node_failed' },
        { nodeId: 'loop-b', scope: {}, terminalEventType: 'node_failed' },
      ]);

      await abandonWorkflow('run-1');

      expect(mockFindNonTerminalNodes).toHaveBeenCalledWith('run-1');
      expect(mockCreateWorkflowEvent).toHaveBeenCalledTimes(2);
      expect(mockCreateWorkflowEvent).toHaveBeenCalledWith({
        workflow_run_id: 'run-1',
        event_type: 'node_failed',
        step_name: 'prompt-a',
        data: { error: 'Cancelled by user' },
      });
      expect(mockCreateWorkflowEvent).toHaveBeenCalledWith({
        workflow_run_id: 'run-1',
        event_type: 'node_failed',
        step_name: 'loop-b',
        data: { error: 'Cancelled by user' },
      });
      expect(mockEmit).toHaveBeenCalledWith({
        type: 'node_failed',
        runId: 'run-1',
        nodeId: 'prompt-a',
        nodeName: 'prompt-a',
        error: 'Cancelled by user',
      });
      expect(mockEmit).toHaveBeenCalledWith({
        type: 'node_failed',
        runId: 'run-1',
        nodeId: 'loop-b',
        nodeName: 'loop-b',
        error: 'Cancelled by user',
      });
    });

    // Without a run→conversation mapping, the SSE bridge's own
    // `getConversationId(event.runId)` lookup (workflow-bridge.ts) can never
    // resolve a target, so an already-open Console/Legacy tab never learns the
    // node settled — the durable write lands, but the live push is stranded.
    // Registering the run's own conversation for the span of the emits closes
    // that gap without leaving a permanent mapping behind.
    test('registers the run’s platform conversation before emitting, and unregisters it after', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(
        makePausedRun({ status: 'running', conversation_id: 'conv-7' })
      );
      mockFindNonTerminalNodes.mockResolvedValueOnce([
        { nodeId: 'prompt-a', scope: {}, terminalEventType: 'node_failed' },
      ]);
      mockGetConversationById.mockImplementationOnce((id: unknown) => {
        expect(id).toBe('conv-7');
        return Promise.resolve({ platform_conversation_id: 'web-live-tab' });
      });
      const order: string[] = [];
      mockRegisterRun.mockImplementationOnce((...args: unknown[]) => {
        order.push('register');
        expect(args).toEqual(['run-1', 'web-live-tab']);
      });
      mockEmit.mockImplementationOnce(() => {
        order.push('emit');
      });
      mockUnregisterRun.mockImplementationOnce((runId: unknown) => {
        order.push('unregister');
        expect(runId).toBe('run-1');
      });

      await abandonWorkflow('run-1');

      expect(order).toEqual(['register', 'emit', 'unregister']);
    });

    test('writes the durable event even when the run’s conversation cannot be found, without registering a mapping', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
      mockFindNonTerminalNodes.mockResolvedValueOnce([
        { nodeId: 'prompt-a', scope: {}, terminalEventType: 'node_failed' },
      ]);
      mockGetConversationById.mockImplementationOnce(() => Promise.resolve(null));

      await abandonWorkflow('run-1');

      expect(mockRegisterRun).not.toHaveBeenCalled();
      expect(mockUnregisterRun).not.toHaveBeenCalled();
      expect(mockCreateWorkflowEvent).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    test('writes the durable event even when the conversation lookup fails, without registering a mapping', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
      mockFindNonTerminalNodes.mockResolvedValueOnce([
        { nodeId: 'prompt-a', scope: {}, terminalEventType: 'node_failed' },
      ]);
      mockGetConversationById.mockImplementationOnce(() => Promise.reject(new Error('db blip')));

      await abandonWorkflow('run-1');

      expect(mockRegisterRun).not.toHaveBeenCalled();
      expect(mockUnregisterRun).not.toHaveBeenCalled();
      expect(mockCreateWorkflowEvent).toHaveBeenCalledTimes(1);
    });

    // A loop node's own execution scope (occurrence/attempt/retry epoch,
    // current iteration) must ride along so the synthesized event attaches
    // to the same execution/iteration row a live cancel's own write would —
    // never landing unscoped, which would leave that row's own status stuck.
    test('carries a node’s own execution scope onto the synthesized event', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
      mockFindNonTerminalNodes.mockResolvedValueOnce([
        {
          nodeId: 'loop-b',
          scope: { occurrence_id: 'occ-1', attempt_id: 'att-1', retry_epoch: 0, iteration: 2 },
          terminalEventType: 'node_failed',
        },
      ]);

      await abandonWorkflow('run-1');

      expect(mockCreateWorkflowEvent).toHaveBeenCalledWith({
        workflow_run_id: 'run-1',
        event_type: 'node_failed',
        step_name: 'loop-b',
        data: {
          occurrence_id: 'occ-1',
          attempt_id: 'att-1',
          retry_epoch: 0,
          iteration: 2,
          error: 'Cancelled by user',
        },
      });
    });

    // A loop mid-iteration reports TWO open executions for the same
    // step_name — the container (closed by node_failed) and the current
    // iteration (closed by loop_iteration_failed). Writing only one would
    // leave the other permanently `running` in the execution-history
    // projection (the exact VQ10-3 symptom).
    test('writes a loop_iteration_failed event for an open iteration, distinct from the container node_failed', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
      mockFindNonTerminalNodes.mockResolvedValueOnce([
        {
          nodeId: 'loop-b',
          scope: { occurrence_id: 'occ-outer', attempt_id: 'att-outer', retry_epoch: 0 },
          terminalEventType: 'node_failed',
        },
        {
          nodeId: 'loop-b',
          scope: {
            occurrence_id: 'occ-iter-2',
            attempt_id: 'att-iter-2',
            retry_epoch: 0,
            iteration: 2,
          },
          terminalEventType: 'loop_iteration_failed',
        },
      ]);

      await abandonWorkflow('run-1');

      expect(mockCreateWorkflowEvent).toHaveBeenCalledTimes(2);
      expect(mockCreateWorkflowEvent).toHaveBeenCalledWith({
        workflow_run_id: 'run-1',
        event_type: 'node_failed',
        step_name: 'loop-b',
        data: {
          occurrence_id: 'occ-outer',
          attempt_id: 'att-outer',
          retry_epoch: 0,
          error: 'Cancelled by user',
        },
      });
      expect(mockCreateWorkflowEvent).toHaveBeenCalledWith({
        workflow_run_id: 'run-1',
        event_type: 'loop_iteration_failed',
        step_name: 'loop-b',
        data: {
          occurrence_id: 'occ-iter-2',
          attempt_id: 'att-iter-2',
          retry_epoch: 0,
          iteration: 2,
          error: 'Cancelled by user',
        },
      });
      expect(mockEmit).toHaveBeenCalledWith({
        type: 'node_failed',
        runId: 'run-1',
        nodeId: 'loop-b',
        nodeName: 'loop-b',
        error: 'Cancelled by user',
      });
      expect(mockEmit).toHaveBeenCalledWith({
        type: 'loop_iteration_failed',
        runId: 'run-1',
        nodeId: 'loop-b',
        iteration: 2,
        error: 'Cancelled by user',
      });
    });

    test('writes nothing when a live executor in this process still owns the run', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
      mockGetConversationId.mockImplementation(() => 'conv-1');

      await abandonWorkflow('run-1');

      // The live executor's own cancel path owns this node — never preempted.
      expect(mockFindNonTerminalNodes).not.toHaveBeenCalled();
      expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    });

    test('writes nothing when the run has no non-terminal nodes', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
      mockFindNonTerminalNodes.mockResolvedValueOnce([]);

      await abandonWorkflow('run-1');

      expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      // Nothing to emit — the conversation lookup (and any registration) never runs.
      expect(mockGetConversationById).not.toHaveBeenCalled();
      expect(mockRegisterRun).not.toHaveBeenCalled();
    });

    test('writes nothing when the cancel CAS loses the race (already terminal)', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'paused' }));
      mockCancelWorkflowRun.mockImplementationOnce(() => Promise.resolve({ cancelled: false }));

      await abandonWorkflow('run-1');

      expect(mockFindNonTerminalNodes).not.toHaveBeenCalled();
      expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    });

    test('is idempotent: a second abandon of the same already-cancelled run writes nothing more', async () => {
      mockGetWorkflowRun.mockResolvedValue(makePausedRun({ status: 'running' }));
      mockFindNonTerminalNodes.mockResolvedValueOnce([
        { nodeId: 'prompt-a', scope: {}, terminalEventType: 'node_failed' },
      ]);

      await abandonWorkflow('run-1');
      expect(mockCreateWorkflowEvent).toHaveBeenCalledTimes(1);

      // The second call's CAS loses (the run is already cancelled) — no
      // repeat write, so a double-click never duplicates the terminal event.
      mockCancelWorkflowRun.mockImplementationOnce(() => Promise.resolve({ cancelled: false }));
      await abandonWorkflow('run-1');
      expect(mockCreateWorkflowEvent).toHaveBeenCalledTimes(1);
    });

    test('a lookup failure is logged and never fails the abandon', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(makePausedRun({ status: 'running' }));
      mockFindNonTerminalNodes.mockImplementationOnce(() => Promise.reject(new Error('db blip')));

      const { run } = await abandonWorkflow('run-1');
      expect(run.id).toBe('run-1');
      expect(mockCreateWorkflowEvent).not.toHaveBeenCalled();
    });
  });
});

describe('resetWorkflowNodeSessions', () => {
  beforeEach(() => {
    mockDeleteWorkflowNodeSessions.mockClear();
    mockDeleteWorkflowNodeSessions.mockImplementation(() => Promise.resolve({ deleted: 0 }));
  });

  test('passes workflow_name only when scope and node are absent', async () => {
    mockDeleteWorkflowNodeSessions.mockResolvedValueOnce({ deleted: 3 });
    const result = await resetWorkflowNodeSessions({ workflow_name: 'feature-dev' });
    expect(result).toEqual({ deleted: 3 });
    expect(mockDeleteWorkflowNodeSessions).toHaveBeenCalledWith({ workflow_name: 'feature-dev' });
  });

  test('forwards scope and node filters', async () => {
    mockDeleteWorkflowNodeSessions.mockResolvedValueOnce({ deleted: 1 });
    const result = await resetWorkflowNodeSessions({
      workflow_name: 'feature-dev',
      scope_key: 'conv-1',
      node_id: 'planner',
    });
    expect(result).toEqual({ deleted: 1 });
    expect(mockDeleteWorkflowNodeSessions).toHaveBeenCalledWith({
      workflow_name: 'feature-dev',
      scope_key: 'conv-1',
      node_id: 'planner',
    });
  });

  test('wraps DB errors with a descriptive message', async () => {
    mockDeleteWorkflowNodeSessions.mockRejectedValueOnce(new Error('connection refused'));
    await expect(resetWorkflowNodeSessions({ workflow_name: 'feature-dev' })).rejects.toThrow(
      'Failed to reset workflow node sessions: connection refused'
    );
  });
});
