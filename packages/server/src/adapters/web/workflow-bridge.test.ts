import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { WorkflowEmitterEvent } from '@archon/workflows/event-emitter';

const mockLogger = {
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
};

mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

import { mapWorkflowEvent } from './workflow-bridge';

describe('mapWorkflowEvent — tool activity correlation', () => {
  test('forwards tool call IDs and completion metadata', () => {
    const started: WorkflowEmitterEvent = {
      type: 'tool_started',
      runId: 'run-1',
      toolName: 'Bash',
      stepName: 'implement',
      toolCallId: 'call-1',
    };
    const completed: WorkflowEmitterEvent = {
      type: 'tool_completed',
      runId: 'run-1',
      toolName: 'Bash',
      stepName: 'implement',
      durationMs: 42,
      toolCallId: 'call-1',
      toolOutcome: 'error',
      exitCode: 1,
    };

    expect(JSON.parse(mapWorkflowEvent(started) ?? '{}')).toMatchObject({
      type: 'workflow_tool_activity',
      status: 'started',
      toolCallId: 'call-1',
    });
    expect(JSON.parse(mapWorkflowEvent(completed) ?? '{}')).toMatchObject({
      type: 'workflow_tool_activity',
      status: 'completed',
      toolCallId: 'call-1',
      toolOutcome: 'error',
      exitCode: 1,
    });
  });

  test('omits optional completion metadata for legacy events', () => {
    const completed: WorkflowEmitterEvent = {
      type: 'tool_completed',
      runId: 'run-1',
      toolName: 'Bash',
      stepName: 'implement',
      durationMs: 42,
      toolCallId: 'call-1',
    };

    const payload = JSON.parse(mapWorkflowEvent(completed) ?? '{}') as Record<string, unknown>;
    expect(payload).not.toHaveProperty('toolOutcome');
    expect(payload).not.toHaveProperty('exitCode');
  });
});

describe('mapWorkflowEvent — task_activity (Phase 2 of #975)', () => {
  beforeEach(() => {
    mockLogger.warn.mockClear();
  });

  test('task_activity started → workflow_task_activity with description', () => {
    const event: WorkflowEmitterEvent = {
      type: 'task_activity',
      runId: 'run-1',
      nodeId: 'plan',
      taskId: 't-1',
      activity: 'started',
      description: 'Analyzing the bug',
      taskType: 'general-purpose',
    };
    const sse = mapWorkflowEvent(event);
    expect(sse).not.toBeNull();
    const payload = JSON.parse(sse ?? '{}') as Record<string, unknown>;
    expect(payload.type).toBe('workflow_task_activity');
    expect(payload.runId).toBe('run-1');
    expect(payload.nodeId).toBe('plan');
    expect(payload.taskId).toBe('t-1');
    expect(payload.activity).toBe('started');
    expect(payload.description).toBe('Analyzing the bug');
    expect(payload.taskType).toBe('general-purpose');
    expect(payload).toHaveProperty('timestamp');
  });

  test('task_activity progress with summary + usage + lastToolName', () => {
    const event: WorkflowEmitterEvent = {
      type: 'task_activity',
      runId: 'run-1',
      nodeId: 'plan',
      taskId: 't-1',
      activity: 'progress',
      summary: 'Reading auth module',
      usage: { total_tokens: 1234, tool_uses: 3, duration_ms: 28000 },
      lastToolName: 'Read',
    };
    const payload = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(payload.activity).toBe('progress');
    expect(payload.summary).toBe('Reading auth module');
    expect(payload.usage).toEqual({ total_tokens: 1234, tool_uses: 3, duration_ms: 28000 });
    expect(payload.lastToolName).toBe('Read');
  });

  test('task_activity completed', () => {
    const event: WorkflowEmitterEvent = {
      type: 'task_activity',
      runId: 'run-1',
      nodeId: 'plan',
      taskId: 't-1',
      activity: 'completed',
      summary: 'Done',
    };
    expect(JSON.parse(mapWorkflowEvent(event) ?? '{}')).toMatchObject({
      activity: 'completed',
    });
  });
});

describe('mapWorkflowEvent — hook_activity (Phase 2 of #975)', () => {
  beforeEach(() => {
    mockLogger.warn.mockClear();
  });

  test('hook_activity started → workflow_hook_activity', () => {
    const event: WorkflowEmitterEvent = {
      type: 'hook_activity',
      runId: 'run-1',
      nodeId: 'plan',
      hookId: 'h-1',
      hookName: 'Bash',
      hookEvent: 'PreToolUse',
      activity: 'started',
    };
    const payload = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(payload.type).toBe('workflow_hook_activity');
    expect(payload.hookId).toBe('h-1');
    expect(payload.hookName).toBe('Bash');
    expect(payload.hookEvent).toBe('PreToolUse');
    expect(payload.activity).toBe('started');
    expect(payload).not.toHaveProperty('outcome');
  });

  test('hook_activity response with outcome success + exit code', () => {
    const event: WorkflowEmitterEvent = {
      type: 'hook_activity',
      runId: 'run-1',
      nodeId: 'plan',
      hookId: 'h-1',
      hookName: 'Bash',
      hookEvent: 'PreToolUse',
      activity: 'response',
      outcome: 'success',
      exitCode: 0,
    };
    const payload = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(payload.activity).toBe('response');
    expect(payload.outcome).toBe('success');
    expect(payload.exitCode).toBe(0);
  });

  test('hook_activity response with error outcome and no exit code', () => {
    const event: WorkflowEmitterEvent = {
      type: 'hook_activity',
      runId: 'run-1',
      nodeId: 'plan',
      hookId: 'h-2',
      hookName: 'Edit',
      hookEvent: 'PreToolUse',
      activity: 'response',
      outcome: 'error',
    };
    const payload = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(payload.outcome).toBe('error');
    expect(payload).not.toHaveProperty('exitCode');
  });
});

const ASK_PAYLOAD_LEAK_KEYS = [
  'toolUseId',
  'envelope',
  'answer',
  'questions',
  'options',
  'approval',
] as const;

function expectNoAskPayloadLeak(payload: Record<string, unknown>): void {
  for (const key of ASK_PAYLOAD_LEAK_KEYS) {
    expect(payload[key]).toBeUndefined();
  }
}

describe('mapWorkflowEvent — node_awaiting', () => {
  test('maps live node_awaiting to workflow_status paused without approval payload', () => {
    const event: WorkflowEmitterEvent = {
      type: 'node_awaiting',
      runId: 'r1',
      nodeId: 'review',
    };
    const e = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(e).toMatchObject({ type: 'workflow_status', runId: 'r1', status: 'paused' });
    expectNoAskPayloadLeak(e);
  });
});

describe('mapWorkflowEvent — interaction_resolved', () => {
  test('maps live resumed true to workflow_status running without Ask payload', () => {
    const event: WorkflowEmitterEvent = {
      type: 'interaction_resolved',
      runId: 'r1',
      nodeId: 'review',
      resumed: true,
    };
    const e = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(e).toMatchObject({ type: 'workflow_status', runId: 'r1', status: 'running' });
    expectNoAskPayloadLeak(e);
  });

  test('maps live resumed false to workflow_status paused without Ask payload', () => {
    const event: WorkflowEmitterEvent = {
      type: 'interaction_resolved',
      runId: 'r1',
      nodeId: 'review',
      resumed: false,
    };
    const e = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(e).toMatchObject({ type: 'workflow_status', runId: 'r1', status: 'paused' });
    expectNoAskPayloadLeak(e);
  });
});

describe('mapWorkflowEvent — node_turn_interrupted', () => {
  test('maps to its own wire type carrying only run and node identity', () => {
    const event: WorkflowEmitterEvent = {
      type: 'node_turn_interrupted',
      runId: 'r1',
      nodeId: 'review',
    };
    const e = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(e).toMatchObject({ type: 'node_turn_interrupted', runId: 'r1', nodeId: 'review' });
    expectNoAskPayloadLeak(e);
  });
});

describe('mapWorkflowEvent — node_turn_started', () => {
  test('maps to its own wire type carrying only run and node identity', () => {
    const event: WorkflowEmitterEvent = {
      type: 'node_turn_started',
      runId: 'r1',
      nodeId: 'review',
    };
    const e = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(e).toMatchObject({ type: 'node_turn_started', runId: 'r1', nodeId: 'review' });
    expectNoAskPayloadLeak(e);
  });
});

describe('mapWorkflowEvent — DAG node events', () => {
  test('maps live node_started events with runtime AI metadata', () => {
    const event: WorkflowEmitterEvent = {
      type: 'node_started',
      runId: 'run-ai',
      nodeId: 'create-story',
      nodeName: 'create-story',
      provider: 'codex',
      model: 'gpt-5.5',
      tier: 'large',
      modelReasoningEffort: 'xhigh',
    };

    expect(JSON.parse(mapWorkflowEvent(event) ?? '{}')).toMatchObject({
      type: 'dag_node',
      runId: 'run-ai',
      nodeId: 'create-story',
      status: 'running',
      provider: 'codex',
      model: 'gpt-5.5',
      tier: 'large',
      modelReasoningEffort: 'xhigh',
    });
  });

  test('maps live node_routed events with route decision metadata', () => {
    const routeDecision = {
      sources: ['review'],
      outcome: 'exhausted',
      to: 'escalate',
      condition: "$review.output.approved == '<redacted>'",
      condition_result: false,
      negative_count: 3,
      max_iterations: 2,
      attempt: 3,
      execution_seq: 9,
    } as const;

    const event: WorkflowEmitterEvent = {
      type: 'node_routed',
      runId: 'run-route',
      nodeId: 'review-router',
      nodeName: 'Review Router',
      data: routeDecision,
    };

    expect(JSON.parse(mapWorkflowEvent(event) ?? '{}')).toMatchObject({
      type: 'dag_node',
      runId: 'run-route',
      nodeId: 'review-router',
      name: 'Review Router',
      status: 'completed',
      routeDecision,
    });
  });
});

describe('mapWorkflowEvent — container_lifecycle (Phase B)', () => {
  test('container_lifecycle created → workflow_container_lifecycle SSE', () => {
    const event: WorkflowEmitterEvent = {
      type: 'container_lifecycle',
      runId: 'run-1',
      phase: 'created',
      containerId: 'abc123def456',
    };
    const sse = mapWorkflowEvent(event);
    const payload = JSON.parse(sse ?? '{}') as Record<string, unknown>;
    expect(payload.type).toBe('workflow_container_lifecycle');
    expect(payload.runId).toBe('run-1');
    expect(payload.phase).toBe('created');
    expect(payload.containerId).toBe('abc123def456');
  });

  test('container_lifecycle destroyed → SSE without a containerId', () => {
    const event: WorkflowEmitterEvent = {
      type: 'container_lifecycle',
      runId: 'run-1',
      phase: 'destroyed',
    };
    const payload = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(payload.type).toBe('workflow_container_lifecycle');
    expect(payload.phase).toBe('destroyed');
    expect(payload).not.toHaveProperty('containerId');
  });
});

describe('mapWorkflowEvent — node_completed loopProgress (loop display total)', () => {
  test('projects loopProgress onto the node_completed SSE (dag_node) event', () => {
    const completed: WorkflowEmitterEvent = {
      type: 'node_completed',
      runId: 'run-1',
      nodeId: 'ralph-native-preflight',
      nodeName: 'ralph-native-preflight',
      duration: 12,
      loopProgress: { targetNodeId: 'ralph-loop-run', expectedIterations: 20 },
    };
    expect(JSON.parse(mapWorkflowEvent(completed) ?? '{}')).toMatchObject({
      type: 'dag_node',
      status: 'completed',
      nodeId: 'ralph-native-preflight',
      loopProgress: { targetNodeId: 'ralph-loop-run', expectedIterations: 20 },
    });
  });

  test('omits loopProgress when the completed node has none', () => {
    const completed: WorkflowEmitterEvent = {
      type: 'node_completed',
      runId: 'run-1',
      nodeId: 'plain',
      nodeName: 'plain',
      duration: 5,
    };
    const payload = JSON.parse(mapWorkflowEvent(completed) ?? '{}') as Record<string, unknown>;
    expect(payload.loopProgress).toBeUndefined();
  });
});
