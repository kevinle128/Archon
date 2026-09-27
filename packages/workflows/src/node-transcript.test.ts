/**
 * Awaited fail-open transcript append boundary.
 *
 * Own `bun test` shard: mock.module('@archon/paths') must not leak.
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import type { AppendNodeMessageInput, NodeMessage } from './schemas/node-message';
import type { IWorkflowNodeMessageStore } from './store';

const errorCalls: unknown[] = [];

mock.module('@archon/paths', () => ({
  createLogger: () => ({
    fatal() {},
    error(...args: unknown[]) {
      errorCalls.push(args);
    },
    warn() {},
    info() {},
    debug() {},
    trace() {},
  }),
}));

const {
  appendAdvisorTranscript,
  appendNodeTranscript,
  appendOperatorTranscript,
  appendPromptTranscript,
  appendThinkingTranscript,
  appendToolResultTranscript,
} = await import('./node-transcript');

beforeEach(() => {
  errorCalls.length = 0;
});

function collectingStore(received: AppendNodeMessageInput[]): IWorkflowNodeMessageStore {
  return {
    appendNodeMessage: async (input: AppendNodeMessageInput): Promise<NodeMessage> => {
      received.push(input);
      return { ...input, id: 'message-1', seq: 1, created_at: new Date() };
    },
    listNodeMessages: async () => [],
  };
}

test('awaits and forwards one append', async () => {
  const received: AppendNodeMessageInput[] = [];
  await appendNodeTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    kind: 'text',
    payload: { text: 'hello' },
  });
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'hello' },
    },
  ]);
  expect(errorCalls).toEqual([]);
});

test('fails open and excludes the payload from logs', async () => {
  const rejectingStore: IWorkflowNodeMessageStore = {
    appendNodeMessage: async () => {
      throw new Error('DO_NOT_LOG');
    },
    listNodeMessages: async () => [],
  };
  await expect(
    appendNodeTranscript(rejectingStore, {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'tool',
      payload: { name: 'Read', id: 'tool-1', input: { secret: 'DO_NOT_LOG' } },
    })
  ).resolves.toBeUndefined();
  expect(errorCalls).toHaveLength(1);
  const logged = errorCalls[0] as unknown[];
  expect(logged[0]).toEqual({
    workflowRunId: 'run-1',
    nodeId: 'review',
    kind: 'tool',
    errorType: 'Error',
  });
  expect(logged[1]).toBe('workflow.node_message_append_failed');
  expect(JSON.stringify(errorCalls)).not.toContain('DO_NOT_LOG');
});

test('appends a second tool row with output and the same call id', async () => {
  const received: AppendNodeMessageInput[] = [];
  await appendToolResultTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    name: 'Read',
    id: 'tool-1',
    output: 'HITL_TOOL_OUTPUT_VISIBLE',
  });
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'tool',
      payload: { name: 'Read', id: 'tool-1', output: 'HITL_TOOL_OUTPUT_VISIBLE' },
    },
  ]);
});

test('appends one operator text row per drained message in order', async () => {
  const received: AppendNodeMessageInput[] = [];
  const scope = {
    occurrence_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
  };
  await appendOperatorTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    scope,
    messages: [
      {
        message_id: 'm-1',
        message: '  first note\nwith newline  ',
        operator_user_id: 'op-alpha',
      },
      {
        message_id: 'm-2',
        message: 'second note',
        operator_user_id: null,
      },
    ],
  });
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: '  first note\nwith newline  ' },
      metadata: {
        execution: scope,
        origin: 'operator',
        operator_user_id: 'op-alpha',
        message_id: 'm-1',
      },
    },
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'second note' },
      metadata: {
        execution: scope,
        origin: 'operator',
        operator_user_id: null,
        message_id: 'm-2',
      },
    },
  ]);
  expect(JSON.stringify(received)).not.toContain('stream_id');
  expect(JSON.stringify(received)).not.toContain('block_id');
  expect(JSON.stringify(received)).not.toContain('text_mode');
});

test('continues after a rejecting operator append (fail-open)', async () => {
  const received: AppendNodeMessageInput[] = [];
  let calls = 0;
  const store: IWorkflowNodeMessageStore = {
    appendNodeMessage: async input => {
      calls += 1;
      if (calls === 1) {
        throw new Error('DO_NOT_LOG_OPERATOR');
      }
      received.push(input);
      return { ...input, id: 'message-2', seq: 2, created_at: new Date() };
    },
    listNodeMessages: async () => [],
  };
  const scope = {
    occurrence_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
  };
  await expect(
    appendOperatorTranscript(store, {
      workflow_run_id: 'run-1',
      node_id: 'review',
      scope,
      messages: [
        {
          message_id: 'm-1',
          message: 'first',
          operator_user_id: 'op-1',
        },
        {
          message_id: 'm-2',
          message: 'second',
          operator_user_id: 'op-2',
        },
      ],
    })
  ).resolves.toBeUndefined();
  expect(received).toHaveLength(1);
  expect(received[0]?.payload).toEqual({ text: 'second' });
  expect(JSON.stringify(errorCalls)).not.toContain('DO_NOT_LOG_OPERATOR');
  expect(JSON.stringify(errorCalls)).not.toContain('first');
});

test('appends a thinking-origin row with no other metadata', async () => {
  const received: AppendNodeMessageInput[] = [];
  const scope = {
    occurrence_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
  };
  await appendThinkingTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    scope,
    text: 'considering the two approaches',
  });
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'considering the two approaches' },
      metadata: { execution: scope, origin: 'thinking' },
    },
  ]);
});

test('appends a prompt-origin row with actor and source', async () => {
  const received: AppendNodeMessageInput[] = [];
  const scope = {
    occurrence_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
  };
  await appendPromptTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    scope,
    text: 'review this PR',
    actorUserId: 'user-starter-1',
    source: 'node_prompt',
  });
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'review this PR' },
      metadata: {
        execution: scope,
        origin: 'prompt',
        actor_user_id: 'user-starter-1',
        prompt_source: 'node_prompt',
      },
    },
  ]);
});

test('appends a prompt-origin row with a null actor for an unattributed run', async () => {
  const received: AppendNodeMessageInput[] = [];
  const scope = {
    occurrence_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
  };
  await appendPromptTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    scope,
    text: 'review this PR',
    actorUserId: null,
    source: 'reask',
  });
  expect(received[0]?.metadata).toEqual({
    execution: scope,
    origin: 'prompt',
    actor_user_id: null,
    prompt_source: 'reask',
  });
});

test('appends an advisor-origin row with a known model', async () => {
  const received: AppendNodeMessageInput[] = [];
  const scope = {
    occurrence_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
  };
  await appendAdvisorTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    scope,
    text: 'consider a channel-based shutdown pattern',
    advisorModel: 'claude-opus-4-8',
  });
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'consider a channel-based shutdown pattern' },
      metadata: {
        execution: scope,
        origin: 'advisor',
        advisor_model: 'claude-opus-4-8',
      },
    },
  ]);
});

test('appends an advisor-origin row with no model when Archon did not configure one', async () => {
  const received: AppendNodeMessageInput[] = [];
  const scope = {
    occurrence_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
  };
  await appendAdvisorTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    scope,
    text: 'consider a channel-based shutdown pattern',
  });
  expect(received[0]?.metadata).toEqual({ execution: scope, origin: 'advisor' });
});
