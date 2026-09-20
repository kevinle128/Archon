process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Root } from 'react-dom/client';

import type { AgentHistoryItem, TranscriptExecution } from '@/lib/agent-history';
import { groupByOccurrence } from '@/lib/occurrence-groups';

import type { ConsoleAgentHistoryListProps } from './inspect/ConsoleAgentHistoryList';
import type { LogRow } from './inspect/build-log-rows';
import type { Run } from '../primitives/run';
import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowEvent,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
  WorkflowNodeState,
} from '../skills/runs';
import type { DagNode } from '../skills/workflows';
import { invalidate } from '../store/cache';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const consoleNodeRoom = await import('./ConsoleNodeRoom');
const consoleHistoryList = await import('./inspect/ConsoleAgentHistoryList');
const agentHistory = await import('@/lib/agent-history');
const toolPresentation = await import('@/lib/tool-presentation');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const FIXTURE: readonly WorkflowNodeMessage[] = [
  { id: 'm1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: CREATED_AT },
  {
    id: 'm2',
    seq: 2,
    kind: 'status',
    payload: { state: 'iteration_started', detail: '1' },
    created_at: CREATED_AT,
  },
  { id: 'm3', seq: 3, kind: 'text', payload: { text: 'first' }, created_at: CREATED_AT },
  {
    id: 'm4',
    seq: 4,
    kind: 'status',
    payload: { state: 'iteration_completed', detail: '1' },
    created_at: CREATED_AT,
  },
  {
    id: 'm5',
    seq: 5,
    kind: 'status',
    payload: { state: 'iteration_started', detail: '2' },
    created_at: CREATED_AT,
  },
  {
    id: 'm6',
    seq: 6,
    kind: 'tool',
    payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' }, output: { ok: true } },
    created_at: CREATED_AT,
  },
  {
    id: 'm7',
    seq: 7,
    kind: 'status',
    payload: { state: 'iteration_failed', detail: '2' },
    created_at: CREATED_AT,
  },
  {
    id: 'm8',
    seq: 8,
    kind: 'status',
    payload: { state: 'awaiting' },
    created_at: CREATED_AT,
  },
];

const PLAN_MESSAGES: readonly WorkflowNodeMessage[] = [
  { id: 'p1', seq: 1, kind: 'text', payload: { text: 'second' }, created_at: CREATED_AT },
];

const REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { report: { type: 'string' } },
  required: ['report'],
  additionalProperties: false,
};
const REPORT_TEXT = 'Readable report body';
const REPORT_MESSAGES: readonly WorkflowNodeMessage[] = [
  {
    id: 'r1',
    seq: 1,
    kind: 'text',
    payload: { text: '{"report":"Readable ' },
    metadata: {
      text_mode: 'delta',
      execution: {
        occurrence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        attempt_id: '11111111-1111-4111-8111-111111111111',
      },
    },
    created_at: CREATED_AT,
  },
  {
    id: 'r2',
    seq: 2,
    kind: 'text',
    payload: { text: 'report ' },
    metadata: {
      text_mode: 'delta',
      execution: {
        occurrence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        attempt_id: '11111111-1111-4111-8111-111111111111',
      },
    },
    created_at: CREATED_AT,
  },
  {
    id: 'r3',
    seq: 3,
    kind: 'text',
    payload: { text: 'body"}' },
    metadata: {
      text_mode: 'delta',
      execution: {
        occurrence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        attempt_id: '11111111-1111-4111-8111-111111111111',
      },
    },
    created_at: CREATED_AT,
  },
];

function nodeState(
  overrides: Pick<WorkflowNodeState, 'nodeId' | 'name' | 'status'> & Partial<WorkflowNodeState>
): WorkflowNodeState {
  return { retryEpoch: 0, ...overrides };
}

function workflowEvent(overrides: {
  id?: string;
  event_type?: string;
  step_name?: string | null;
  data?: Record<string, unknown>;
}): WorkflowEvent {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: CREATED_AT,
    ...overrides,
  };
}

function row(overrides: Partial<LogRow> & Pick<LogRow, 'nodeId' | 'label'>): LogRow {
  return {
    id: overrides.id ?? overrides.nodeId,
    status: 'completed',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
    ...overrides,
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    projectName: 'demo',
    costUsd: null,
    conversationId: null,
    conversationPlatformId: null,
    workerPlatformId: null,
    workflow: 'inspect',
    origin: 'cli',
    status: 'completed',
    startedAt: CREATED_AT,
    finishedAt: CREATED_AT,
    workingPath: null,
    userMessage: 'inspect',
    envOverlay: null,
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function assertNoConversationComposer(host: Element): void {
  const text = host.textContent ?? '';
  expect(text).not.toContain('ChatComposer');
  expect(text).not.toContain('Reply…');
}

function ask(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-1',
    kind: 'ask',
    status: 'pending',
    envelope: {
      questions: [
        {
          id: 'q1',
          prompt: 'Ship it?',
          selection: 'single',
          options: ['Ship', 'Hold'],
          allowOther: false,
        },
      ],
    },
    answer: null,
    provider_session_id: 'session-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

describe('ConsoleNodeRoom', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let closed = 0;
  let queueFetchSpy: { mockRestore: () => void } | undefined;

  beforeEach(() => {
    closed = 0;
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    // Production docks default-read the shared queue. Stub GET .../queue only;
    // every other URL/method fails loudly so undeclared I/O cannot hide.
    queueFetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      let pathname = raw;
      try {
        pathname = new URL(raw, 'http://localhost').pathname;
      } catch {
        pathname = raw.split('?')[0] ?? raw;
      }
      if (method === 'GET' && pathname.endsWith('/queue')) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, queued: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${method} ${raw}`));
    }) as typeof fetch);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await act(async () => {
      root.unmount();
    });
    invalidate('run-node-messages');
    invalidate('console-node-room:idle');
    queueFetchSpy?.mockRestore();
    queueFetchSpy = undefined;
    win.close();
    restoreHappyDom();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function flushUntil(label: string, predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await flush();
      if (predicate()) return;
    }
    throw new Error(`${label}: ${host.textContent ?? ''}`);
  }

  function renderRoom(
    overrides: Partial<Parameters<typeof consoleNodeRoom.ConsoleNodeRoom>[0]> & {
      loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
    }
  ): void {
    root.render(
      createElement(consoleNodeRoom.ConsoleNodeRoom, {
        run: run(),
        projectId: 'proj/1',
        nodeId: 'review',
        selectedRow: row({ nodeId: 'review', label: 'Review', status: 'running' }),
        definitionNodes: [{ id: 'review', prompt: 'Write' }],
        definitionPending: false,
        nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
        events: [],
        approval: null,
        isLive: false,
        onClose: (): void => {
          closed += 1;
        },
        pendingInteractions: [],
        ownsUnscopedInteractions: true,
        viewerIsStarter: true,
        starterDisplayName: 'Avery',
        actionStates: {},
        onSubmitAsk: async (_requestId: string, _body: AskAnswerBody): Promise<void> => undefined,
        ...overrides,
      })
    );
  }

  test('renders agent text, tool rows, status entries, and slices a selected loop iteration', async () => {
    const calls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return Promise.resolve({ messages: [...FIXTURE] });
    };

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-agent' }),
        loadMessages,
        selectedRow: row({
          nodeId: 'review',
          label: 'Review ×2',
          status: 'awaiting',
          selection: { kind: 'loop_iteration', iteration: 2 },
        }),
      });
    });
    await flushUntil('agent transcript', () => (host.textContent ?? '').includes('Read'));

    expect(calls).toEqual([['run-agent', 'review']]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    const toolRowEl = host.querySelector('details[data-tool-id="tool-1"]');
    expect(toolRowEl).not.toBeNull();
    expect((toolRowEl as Element & { open: boolean }).open).toBe(false);
    const toolSummary = toolRowEl?.querySelector('summary');
    expect(toolSummary?.textContent).toContain('Read');
    expect(toolSummary?.textContent).toContain('a.ts');
    // A closed row mounts nothing: no nested diagnostics, no Raw toggle, no
    // family body, and never the serialized payload.
    expect(toolRowEl?.querySelectorAll('details')).toHaveLength(0);
    expect(toolRowEl?.querySelector('button[aria-expanded]')).toBeNull();
    expect(toolRowEl?.querySelector('.tool-family-body')).toBeNull();
    expect(toolRowEl?.querySelector('pre')).toBeNull();
    expect(toolRowEl?.textContent).not.toContain('"path"');
    expect(toolRowEl?.textContent).not.toContain('"ok"');
    expect(host.textContent).toContain('iteration_started');
    expect(host.textContent).toContain('iteration_failed');
    expect(host.textContent).toContain('waiting on you');
    expect(host.textContent).toContain('Iteration 2');
    expect(host.textContent).not.toContain('first');
    assertNoConversationComposer(host);
  });

  test('unwraps the structured envelope with the selected definition output_format', async () => {
    const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: [...REPORT_MESSAGES],
    });

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-structured' }),
        definitionNodes: [{ id: 'review', prompt: 'Write', output_format: REPORT_SCHEMA }],
        loadMessages,
      });
    });
    await flushUntil('structured transcript', () => (host.textContent ?? '').includes(REPORT_TEXT));
    expect(host.textContent).toContain(REPORT_TEXT);
    expect(host.textContent).not.toContain('{"report"');
  });

  test('keeps the serialized envelope when the selected definition has no output_format', async () => {
    const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: [...REPORT_MESSAGES],
    });

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-plain' }),
        definitionNodes: [{ id: 'review', prompt: 'Write' }],
        loadMessages,
      });
    });
    await flushUntil('raw transcript', () => (host.textContent ?? '').includes('{"report"'));
    expect(host.textContent).toContain('{"report"');
  });

  test('rekeys loadMessages when the selected agent node changes', async () => {
    const calls: [string, string][] = [];
    const savedReview: number[] = [];
    const savedPlan: number[] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      if (nodeId === 'plan') return Promise.resolve({ messages: [...PLAN_MESSAGES] });
      return Promise.resolve({ messages: [...FIXTURE] });
    };
    const definitionNodes: DagNode[] = [
      { id: 'review', prompt: 'Write' },
      { id: 'plan', prompt: 'Plan' },
    ];

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-switch' }),
        definitionNodes,
        loadMessages,
        onScrollTopChange: (scrollTop: number): void => {
          savedReview.push(scrollTop);
        },
      });
    });
    await flushUntil('first agent', () => (host.textContent ?? '').includes('first'));
    expect(calls).toEqual([['run-switch', 'review']]);

    const reviewScroll = host.querySelector('[data-testid="console-node-room-scroll"]');
    if (!(reviewScroll instanceof HTMLElement)) throw new Error('missing review scroll host');
    reviewScroll.scrollTop = 41;
    await act(async () => {
      renderRoom({
        run: run({ id: 'run-switch' }),
        nodeId: 'plan',
        selectedRow: row({ nodeId: 'plan', label: 'Plan', status: 'running' }),
        definitionNodes,
        nodeStates: [
          nodeState({ nodeId: 'review', name: 'Review', status: 'completed' }),
          nodeState({ nodeId: 'plan', name: 'Plan', status: 'running' }),
        ],
        loadMessages,
        onScrollTopChange: (scrollTop: number): void => {
          savedPlan.push(scrollTop);
        },
      });
    });
    await flushUntil('second agent', () => (host.textContent ?? '').includes('second'));
    expect(savedReview).toContain(41);
    expect(savedPlan).toEqual([]);
    expect(calls).toEqual([
      ['run-switch', 'review'],
      ['run-switch', 'plan'],
    ]);
    expect(host.querySelector('[aria-label="plan room"]')).not.toBeNull();
  });

  test('does not fetch messages for bash, approval, workflow, route, or loop-group rooms', async () => {
    const calls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return Promise.resolve({ messages: [] });
    };

    const cases: {
      nodeId: string;
      definitionNodes: DagNode[];
      selectedRow: LogRow;
      events: WorkflowEvent[];
    }[] = [
      {
        nodeId: 'setup',
        definitionNodes: [{ id: 'setup', bash: 'echo hi' }],
        selectedRow: row({ nodeId: 'setup', label: 'Setup' }),
        events: [],
      },
      {
        nodeId: 'review',
        definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
        selectedRow: row({ nodeId: 'review', label: 'Review', status: 'running' }),
        events: [],
      },
      {
        nodeId: 'child',
        definitionNodes: [{ id: 'child', workflow: 'other' }],
        selectedRow: row({ nodeId: 'child', label: 'Child' }),
        events: [],
      },
      {
        nodeId: 'router',
        definitionNodes: [
          {
            id: 'router',
            route_loop: {
              condition: '$review.output',
              max_iterations: 2,
              routes: { positive: 'done', negative: 'fix', exhausted: 'stop' },
            },
          },
        ],
        selectedRow: row({
          nodeId: 'router',
          label: 'Router #1',
          selection: { kind: 'route_iteration', executionSeq: 1 },
        }),
        events: [],
      },
      {
        nodeId: 'group',
        definitionNodes: [
          {
            id: 'group',
            loop_group: {
              max_iterations: 2,
              fresh_context: false,
              nodes: [{ id: 'body', prompt: 'Work' }],
            },
          },
        ],
        selectedRow: row({ nodeId: 'group', label: 'Group' }),
        events: [],
      },
    ];

    for (const item of cases) {
      await act(async () => {
        renderRoom({
          run: run({ id: `run-${item.nodeId}` }),
          nodeId: item.nodeId,
          selectedRow: item.selectedRow,
          definitionNodes: item.definitionNodes,
          nodeStates: [
            nodeState({ nodeId: item.nodeId, name: item.selectedRow.label, status: 'completed' }),
          ],
          events: item.events,
          loadMessages,
        });
      });
      await flush();
    }

    expect(calls).toEqual([]);
  });

  test('holds the unknown agent fallback while the definition is pending, then loads after settle', async () => {
    const calls: [string, string][] = [];
    const pending = deferred<WorkflowNodeMessagesResponse>();
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return pending.promise;
    };

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-unknown' }),
        nodeId: 'ghost',
        selectedRow: row({ nodeId: 'ghost', label: 'Ghost', status: 'completed' }),
        definitionNodes: [],
        definitionPending: true,
        nodeStates: [nodeState({ nodeId: 'ghost', name: 'Ghost', status: 'completed' })],
        loadMessages,
      });
    });
    await flush();
    expect(calls).toEqual([]);
    expect(host.textContent).toContain('Loading workflow definition');

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-unknown' }),
        nodeId: 'ghost',
        selectedRow: row({ nodeId: 'ghost', label: 'Ghost', status: 'completed' }),
        definitionNodes: [],
        definitionPending: false,
        nodeStates: [nodeState({ nodeId: 'ghost', name: 'Ghost', status: 'completed' })],
        loadMessages,
      });
    });
    await flush();
    expect(calls).toEqual([['run-unknown', 'ghost']]);
    expect(host.textContent).toContain('Loading node transcript');

    await act(async () => {
      pending.resolve({ messages: [...FIXTURE] });
    });
    await flushUntil('unknown replay', () => (host.textContent ?? '').includes('first'));
    expect(host.querySelector('[aria-label="ghost room"]')).not.toBeNull();
  });

  test('polls live agent rooms every 1000 ms and does not poll completed rooms', async () => {
    const afterSeqs: number[] = [];
    const burst = Array.from({ length: 100 }, (_, index): WorkflowNodeMessage => {
      const seq = index + 9;
      return {
        id: `fresh-${seq}`,
        seq,
        kind: 'text',
        payload: { text: `fresh-${seq}` },
        created_at: CREATED_AT,
      };
    });
    const loadMessages = async (
      _runId: string,
      _nodeId: string,
      options?: { afterSeq?: number }
    ): Promise<WorkflowNodeMessagesResponse> => {
      const afterSeq = options?.afterSeq ?? 0;
      afterSeqs.push(afterSeq);
      if (afterSeq === 0) {
        return {
          messages: [...FIXTURE],
          nextCursor: '8',
          highWatermark: 8,
          hasMore: false,
        };
      }
      if (afterSeq === 8) {
        return {
          messages: burst,
          nextCursor: '108',
          highWatermark: 109,
          hasMore: true,
        };
      }
      return {
        messages: [
          {
            id: 'fresh-109',
            seq: 109,
            kind: 'text',
            payload: { text: 'fresh-109' },
            created_at: CREATED_AT,
          },
        ],
        nextCursor: '109',
        highWatermark: 109,
        hasMore: false,
      };
    };
    const scheduled: (() => void)[] = [];
    const timeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      delay?: number
    ): ReturnType<typeof setTimeout> => {
      if (delay === 1000) scheduled.push(handler as () => void);
      return 7 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    const clearSpy = spyOn(globalThis, 'clearTimeout').mockImplementation((): void => undefined);

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-live', status: 'running' }),
        isLive: true,
        loadMessages,
      });
    });
    await flushUntil('live agent', () => (host.textContent ?? '').includes('first'));
    expect(scheduled.length).toBeGreaterThan(0);

    const before = scheduled.length;
    await act(async () => {
      scheduled[0]();
    });
    await flushUntil('fresh snapshot drained', () =>
      (host.textContent ?? '').includes('fresh-109')
    );
    expect(afterSeqs).toEqual([0, 8, 108]);
    expect(scheduled.length).toBeGreaterThanOrEqual(before);

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-done' }),
        isLive: false,
        loadMessages,
      });
    });
    await flushUntil('completed agent', () => (host.textContent ?? '').includes('first'));
    expect(clearSpy).toHaveBeenCalled();
    timeoutSpy.mockRestore();
    clearSpy.mockRestore();
  });

  test('recovers from a load error through Retry', async () => {
    let shouldFail = true;
    const calls: [string, string][] = [];
    const loadMessages = async (
      runId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      if (shouldFail) throw new Error('boom');
      return { messages: [...FIXTURE] };
    };

    await act(async () => {
      renderRoom({ run: run({ id: 'run-retry' }), loadMessages });
    });
    await flushUntil('error', () =>
      (host.textContent ?? '').includes('Failed to load node transcript')
    );
    const retry = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Retry')
    );
    expect(retry).toBeDefined();
    shouldFail = false;
    await act(async () => {
      retry?.click();
    });
    await flushUntil('retry', () => (host.textContent ?? '').includes('first'));
    expect(calls).toEqual([
      ['run-retry', 'review'],
      ['run-retry', 'review'],
    ]);
  });

  test('renders bash stdout, truncation metadata, and exit status in a pre', async () => {
    await act(async () => {
      renderRoom({
        run: run({ id: 'run-bash' }),
        nodeId: 'setup',
        selectedRow: row({ nodeId: 'setup', label: 'Setup', status: 'completed' }),
        definitionNodes: [{ id: 'setup', bash: 'echo hi' }],
        nodeStates: [nodeState({ nodeId: 'setup', name: 'Setup', status: 'completed' })],
        events: [
          workflowEvent({ id: 'start-setup', step_name: 'setup' }),
          workflowEvent({
            id: 'done-setup',
            step_name: 'setup',
            event_type: 'node_completed',
            data: {
              type: 'bash',
              node_output: 'hello\nworld',
              node_output_truncated: true,
              node_output_original_bytes: 40000,
            },
          }),
        ],
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('should not load');
        },
      });
    });
    await flush();
    const pre = host.querySelector('pre');
    expect(pre?.textContent).toBe('hello\nworld');
    expect(host.textContent).toContain('Output truncated from 40000 bytes');
    expect(host.textContent).toContain('Exit status: 0');
    assertNoConversationComposer(host);
  });

  test('renders gate message, decision controls, and omits controls when inactive', async () => {
    await act(async () => {
      renderRoom({
        run: run({
          id: 'run-gate',
          status: 'paused',
          approval: { nodeId: 'review', message: 'Ship?', completionSignaled: false },
        }),
        nodeId: 'review',
        selectedRow: row({ nodeId: 'review', label: 'Review', status: 'running' }),
        definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
        nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
        events: [workflowEvent({ id: 'gate-start', step_name: 'review' })],
        approval: { nodeId: 'review', message: 'Ship?', type: 'approval' },
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('should not load');
        },
      });
    });
    await flush();
    expect(host.textContent).toContain('Ship?');
    expect(host.textContent).toContain('Waiting for approval');
    expect(host.textContent).toContain('Continue');
    expect(host.textContent).toContain('Reject');
    assertNoConversationComposer(host);

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-gate-done', status: 'completed' }),
        nodeId: 'review',
        selectedRow: row({ nodeId: 'review', label: 'Review', status: 'completed' }),
        definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
        nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'completed' })],
        events: [
          workflowEvent({ id: 'gate-start', step_name: 'review' }),
          workflowEvent({
            id: 'gate-done',
            step_name: 'review',
            event_type: 'node_completed',
            data: { approval_decision: 'approved', node_output: '' },
          }),
        ],
        approval: null,
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('should not load');
        },
      });
    });
    await flush();
    expect(host.textContent).toContain('Approved');
    expect(host.textContent).not.toContain('Continue');
  });

  test('renders an encoded child-run link, fan-out summary, and not-started copy', async () => {
    await act(async () => {
      renderRoom({
        run: run({ id: 'run-child' }),
        projectId: 'proj/1',
        nodeId: 'child',
        selectedRow: row({ nodeId: 'child', label: 'Child', status: 'completed' }),
        definitionNodes: [{ id: 'child', workflow: 'other' }],
        nodeStates: [nodeState({ nodeId: 'child', name: 'Child', status: 'completed' })],
        events: [
          workflowEvent({ id: 'child-start', step_name: 'child' }),
          workflowEvent({
            id: 'child-done',
            step_name: 'child',
            event_type: 'node_completed',
            data: { type: 'workflow', child_run_id: 'child 1', node_output: 'ok' },
          }),
        ],
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('should not load');
        },
      });
    });
    await flush();
    const link = host.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/console/p/proj%2F1/r/child%201');
    expect(host.textContent).toContain('Open child run');
    expect(host.textContent).toContain('ok');

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-fanout' }),
        nodeId: 'child',
        selectedRow: row({ nodeId: 'child', label: 'Child', status: 'completed' }),
        definitionNodes: [{ id: 'child', workflow: 'other' }],
        nodeStates: [nodeState({ nodeId: 'child', name: 'Child', status: 'completed' })],
        events: [
          workflowEvent({ id: 'child-start', step_name: 'child' }),
          workflowEvent({
            id: 'child-done',
            step_name: 'child',
            event_type: 'node_completed',
            data: { type: 'workflow', fan_out: true, node_output: '3 children completed' },
          }),
        ],
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('should not load');
        },
      });
    });
    await flush();
    expect(host.textContent).toContain('This node spawned multiple child runs');
    expect(host.textContent).toContain('3 children completed');
    expect(host.textContent).not.toContain('Open child run');

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-child-empty' }),
        nodeId: 'child',
        selectedRow: row({ nodeId: 'child', label: 'Child', status: 'pending' }),
        definitionNodes: [{ id: 'child', workflow: 'other' }],
        nodeStates: [nodeState({ nodeId: 'child', name: 'Child', status: 'pending' })],
        events: [],
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('should not load');
        },
      });
    });
    await flush();
    expect(host.textContent).toContain('Child run has not started');
  });

  test('renders the selected route decision and loop-group iteration', async () => {
    await act(async () => {
      renderRoom({
        run: run({ id: 'run-route' }),
        nodeId: 'router',
        selectedRow: row({
          nodeId: 'router',
          label: 'Router #2',
          selection: { kind: 'route_iteration', executionSeq: 2 },
        }),
        definitionNodes: [
          {
            id: 'router',
            route_loop: {
              condition: '$review.output',
              max_iterations: 2,
              routes: { positive: 'done', negative: 'fix', exhausted: 'stop' },
            },
          },
        ],
        nodeStates: [nodeState({ nodeId: 'router', name: 'Router', status: 'completed' })],
        events: [
          workflowEvent({
            id: 'route-1',
            event_type: 'node_routed',
            step_name: 'router',
            data: {
              outcome: 'positive',
              to: 'done',
              condition: '$review.output',
              condition_result: true,
              attempt: 1,
              execution_seq: 1,
              negative_count: 0,
              max_iterations: 2,
            },
          }),
          workflowEvent({
            id: 'route-2',
            event_type: 'node_routed',
            step_name: 'router',
            data: {
              outcome: 'negative',
              to: 'fix',
              condition: '$review.output.approved == true',
              condition_result: false,
              attempt: 2,
              execution_seq: 2,
              negative_count: 1,
              max_iterations: 2,
            },
          }),
        ],
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('should not load');
        },
      });
    });
    await flush();
    expect(host.textContent).toContain('Routing decision');
    expect(host.textContent).toContain('negative');
    expect(host.textContent).toContain('fix');
    expect(host.textContent).toContain('$review.output.approved == true');
    expect(host.textContent).toContain('#2');
    expect(host.textContent).not.toContain('done');

    await act(async () => {
      renderRoom({
        run: run({ id: 'run-group' }),
        nodeId: 'group',
        selectedRow: row({
          nodeId: 'group',
          label: 'Group ×2',
          status: 'failed',
          selection: { kind: 'loop_iteration', iteration: 2 },
        }),
        definitionNodes: [
          {
            id: 'group',
            loop_group: {
              max_iterations: 2,
              fresh_context: false,
              nodes: [
                { id: 'body', prompt: 'Work' },
                { id: 'check', prompt: 'Check', depends_on: ['body'] },
              ],
            },
          },
        ],
        nodeStates: [nodeState({ nodeId: 'group', name: 'Group', status: 'failed' })],
        events: [
          workflowEvent({
            id: 'body-1',
            step_name: 'group.body',
            event_type: 'node_completed',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'check-1',
            step_name: 'group.check',
            event_type: 'node_completed',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'body-2',
            step_name: 'group.body',
            event_type: 'node_completed',
            data: { iteration: 2 },
          }),
          workflowEvent({
            id: 'check-2',
            step_name: 'group.check',
            event_type: 'node_failed',
            data: { iteration: 2 },
          }),
        ],
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('should not load');
        },
      });
    });
    await flush();
    expect(host.textContent).toContain('Loop group');
    expect(host.textContent).toContain('Body nodes');
    expect(host.textContent).toContain('×2 failed');
    expect(host.textContent).toContain('group.check');
    const open = host.querySelector('details[open]');
    expect(open?.getAttribute('aria-current')).toBe('true');
    expect(open?.textContent).toContain('×2 failed');
  });

  test('places independent anchored Ask cards after their tool rows', async () => {
    const messages: WorkflowNodeMessage[] = [
      ...FIXTURE,
      {
        id: 'm9',
        seq: 9,
        kind: 'tool',
        payload: { name: 'AskHuman', id: 'tool-2', input: {} },
        created_at: CREATED_AT,
      },
    ];
    await act(async () => {
      renderRoom({
        selectedRow: row({ nodeId: 'review', label: 'Review', status: 'awaiting' }),
        nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'awaiting' })],
        pendingInteractions: [ask(), ask({ id: 'ask-2', tool_use_id: 'tool-2' })],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages }),
      });
    });
    await flushUntil('two Ask cards', () => host.querySelectorAll('form').length === 2);
    const firstTool = [...host.querySelectorAll('span')].find(
      item => (item.textContent ?? '').trim() === 'Read'
    );
    const firstCard = host.querySelector('form');
    expect(firstTool).toBeDefined();
    expect(firstCard).not.toBeNull();
    if (firstTool === undefined || firstCard === null) {
      throw new Error('missing tool or card');
    }
    expect(
      firstTool.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(host.textContent).toContain('waiting on you');
    expect(host.textContent).toContain('Execution scope was not recorded for this interaction.');
    assertNoConversationComposer(host);
  });

  test('appends an unanchored Ask for an empty transcript and keeps it on fetch error', async () => {
    await act(async () => {
      renderRoom({
        pendingInteractions: [ask({ tool_use_id: 'not-yet-persisted' })],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
      });
    });
    await flushUntil('empty transcript Ask', () => host.querySelector('form') !== null);
    expect(host.textContent).not.toContain("Node hasn't produced output");

    invalidate('run-node-messages');
    await act(async () => {
      renderRoom({
        run: run({ id: 'run-error-ask' }),
        pendingInteractions: [ask({ workflow_run_id: 'run-error-ask', tool_use_id: 'missing' })],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('boom');
        },
      });
    });
    await flushUntil('error and Ask', () =>
      (host.textContent ?? '').includes('Failed to load node transcript')
    );
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).toContain('Retry');
  });

  test('maps malformed and teammate cards but never renders Ask in stdout rooms', async () => {
    await act(async () => {
      renderRoom({
        viewerIsStarter: false,
        pendingInteractions: [ask({ envelope: { broken: true } })],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil('invalid Ask', () => (host.textContent ?? '').includes('Invalid Ask payload'));
    expect(host.textContent).not.toContain('Submit');

    await act(async () => {
      renderRoom({
        viewerIsStarter: false,
        pendingInteractions: [ask()],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil('answerable Ask', () => (host.textContent ?? '').includes('Submit'));
    expect(host.textContent).toContain('Submit');
    expect(host.textContent).toContain('Decline');
    expect(host.textContent).not.toContain('Waiting for Avery to answer');

    await act(async () => {
      renderRoom({
        nodeId: 'setup',
        selectedRow: row({ nodeId: 'setup', label: 'Setup' }),
        definitionNodes: [{ id: 'setup', bash: 'echo ok' }],
        nodeStates: [nodeState({ nodeId: 'setup', name: 'Setup', status: 'completed' })],
        pendingInteractions: [ask({ node_id: 'setup' })],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
      });
    });
    await flush();
    expect(host.querySelector('form')).toBeNull();
  });

  test('renders assistant, tool, and lifecycle history with a collapsed tool row', async () => {
    const longCmd = `bun test ${'x'.repeat(120)} src/lib/agent-history.test.ts`;
    await act(async () => {
      renderRoom({
        showToolCalls: true,
        showSystem: true,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            {
              id: 't1',
              seq: 1,
              kind: 'text',
              payload: { text: 'hello-md' },
              created_at: CREATED_AT,
            },
            {
              id: 'tool-1',
              seq: 2,
              kind: 'tool',
              payload: {
                name: 'Bash',
                id: 'tool-bash',
                input: { cmd: longCmd },
                output: { ok: true },
              },
              created_at: CREATED_AT,
            },
            {
              id: 'st1',
              seq: 3,
              kind: 'status',
              payload: { state: 'completed', detail: 'done' },
              created_at: CREATED_AT,
            },
          ],
        }),
      });
    });
    await flushUntil('history', () => (host.textContent ?? '').includes('hello-md'));
    expect(host.textContent).toContain('assistant');
    expect(host.textContent).toContain('hello-md');
    expect(host.textContent).toContain('completed');
    const bashRow = host.querySelector('details[data-tool-id="tool-bash"]');
    expect(bashRow).not.toBeNull();
    expect((bashRow as Element & { open: boolean }).open).toBe(false);
    const bashSummary = bashRow?.querySelector('summary');
    expect(bashSummary?.textContent).toContain('Bash');
    expect(bashSummary?.textContent).toContain(longCmd);
    // A collapsed row mounts no expanded region at all — no nested
    // diagnostics, no Raw toggle, no family body.
    expect(bashRow?.querySelectorAll('details')).toHaveLength(0);
    expect(bashRow?.querySelector('button[aria-expanded]')).toBeNull();
    expect(bashRow?.querySelector('.tool-family-body')).toBeNull();
    expect(bashRow?.querySelector('pre')).toBeNull();
  });

  test('Tool toggle hides only tool cards and System toggle hides only lifecycle rows', async () => {
    await act(async () => {
      renderRoom({
        showToolCalls: false,
        showSystem: true,
        pendingInteractions: [ask()],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            {
              id: 't1',
              seq: 1,
              kind: 'text',
              payload: { text: 'keep-me' },
              created_at: CREATED_AT,
            },
            {
              id: 'tool-1',
              seq: 2,
              kind: 'tool',
              payload: { name: 'AskHuman', id: 'tool-a', input: {} },
              created_at: CREATED_AT,
            },
            {
              id: 'st1',
              seq: 3,
              kind: 'status',
              payload: { state: 'iteration_started', detail: '1' },
              created_at: CREATED_AT,
            },
          ],
        }),
      });
    });
    await flushUntil('hidden tools', () => (host.textContent ?? '').includes('keep-me'));
    expect(host.textContent).toContain('keep-me');
    expect(host.textContent).not.toContain('AskHuman');
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).toContain('iteration_started');

    await act(async () => {
      renderRoom({
        showToolCalls: true,
        showSystem: false,
        pendingInteractions: [ask()],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            {
              id: 't1',
              seq: 1,
              kind: 'text',
              payload: { text: 'keep-me' },
              created_at: CREATED_AT,
            },
            {
              id: 'tool-1',
              seq: 2,
              kind: 'tool',
              payload: { name: 'AskHuman', id: 'tool-a', input: {} },
              created_at: CREATED_AT,
            },
            {
              id: 'st1',
              seq: 3,
              kind: 'status',
              payload: { state: 'iteration_started', detail: '1' },
              created_at: CREATED_AT,
            },
          ],
        }),
      });
    });
    await flushUntil('hidden system', () => (host.textContent ?? '').includes('AskHuman'));
    expect(host.textContent).toContain('keep-me');
    expect(host.textContent).toContain('AskHuman');
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).not.toContain('iteration_started');
  });

  test('close button calls onClose', async () => {
    await act(async () => {
      renderRoom({
        run: run({ id: 'run-close' }),
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> =>
          Promise.resolve({ messages: [] }),
      });
    });
    await flush();
    const close = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Close')
    );
    expect(close).toBeDefined();
    await act(async () => {
      close?.click();
    });
    expect(closed).toBe(1);
  });

  function dockField(): Element | null {
    return host.querySelector('textarea');
  }

  function regionChildren(): Element[] {
    const region = host.querySelector('[role="region"]');
    return region === null ? [] : Array.from(region.children);
  }

  test('mounts the composer dock after the transcript scroller for a live running row', async () => {
    await act(async () => {
      renderRoom({
        isLive: true,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil('composer field', () => dockField() !== null);

    const scroller = host.querySelector('[data-testid="console-node-room-scroll"]');
    const field = dockField();
    if (scroller === null || field === null) throw new Error('missing scroller or field');
    const dockWell = field.parentElement;
    const children = regionChildren();
    expect(children.includes(scroller)).toBe(true);
    expect(children.includes(dockWell ?? scroller)).toBe(true);
    expect(children.indexOf(dockWell ?? scroller)).toBeGreaterThan(children.indexOf(scroller));
    expect(scroller.contains(dockWell)).toBe(false);
    expect(host.textContent).toContain('Cmd/Ctrl+Enter to send · this tab only');
    expect(host.textContent).not.toContain('queued ·');
  });

  test('renders no dock for a historical (non-live) run or a terminal row', async () => {
    await act(async () => {
      renderRoom({
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil('transcript', () => (host.textContent ?? '').includes('first'));
    expect(dockField()).toBeNull();

    await act(async () => {
      renderRoom({
        isLive: true,
        selectedRow: row({ nodeId: 'review', label: 'Review', status: 'completed' }),
        nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'completed' })],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flush();
    expect(dockField()).toBeNull();
  });

  test('renders no dock for non-agent rooms', async () => {
    await act(async () => {
      renderRoom({
        isLive: true,
        nodeId: 'setup',
        selectedRow: row({ nodeId: 'setup', label: 'Setup', status: 'running' }),
        definitionNodes: [{ id: 'setup', bash: 'echo hi' }],
        nodeStates: [nodeState({ nodeId: 'setup', name: 'Setup', status: 'running' })],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [],
        }),
      });
    });
    await flush();
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expect(dockField()).toBeNull();
  });

  test('a pending ask on this node blocks Queue with the exact visible reason', async () => {
    await act(async () => {
      renderRoom({
        isLive: true,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
        pendingInteractions: [ask()],
      });
    });
    await flushUntil('blocked dock', () =>
      (host.textContent ?? '').includes("answer the agent's question first")
    );
    const field = dockField();
    if (field === null) throw new Error('dock field missing while blocked');
    const button = Array.from(host.querySelectorAll('button')).find(
      el => (el.textContent ?? '').trim() === 'Queue'
    );
    if (button === undefined) throw new Error('missing Queue button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('disabled')).toBeNull();
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId).not.toBeNull();
    expect(host.querySelector(`#${reasonId ?? ''}`)?.textContent).toBe(
      "answer the agent's question first"
    );
  });

  test('a sibling node pending ask does not block this dock', async () => {
    await act(async () => {
      renderRoom({
        isLive: true,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
        pendingInteractions: [ask({ id: 'ask-sibling', node_id: 'other-node' })],
      });
    });
    await flushUntil('composer field', () => dockField() !== null);
    expect(host.textContent).not.toContain("answer the agent's question first");
    // A non-blank draft lifts the semantic disable — a sibling's ask is not
    // this dock's block.
    const field = dockField();
    if (field === null) throw new Error('missing dock field');
    const fiberKey = Object.keys(field).find(key => key.startsWith('__reactProps$'));
    const onChange = (
      field as unknown as Record<
        string,
        { onChange?: (event: { target: { value: string } }) => void }
      >
    )[fiberKey ?? '']?.onChange;
    if (onChange === undefined) throw new Error('missing onChange');
    await act(async () => {
      onChange({ target: { value: 'a message' } });
    });
    const button = Array.from(host.querySelectorAll('button')).find(
      el => (el.textContent ?? '').trim() === 'Queue'
    );
    expect(button?.getAttribute('aria-disabled')).toBeNull();
  });

  test('an awaiting row blocks the dock even without a visible ask card', async () => {
    await act(async () => {
      renderRoom({
        isLive: true,
        selectedRow: row({ nodeId: 'review', label: 'Review', status: 'awaiting' }),
        nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'awaiting' })],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil('awaiting block', () =>
      (host.textContent ?? '').includes("answer the agent's question first")
    );
    expect(dockField()).not.toBeNull();
  });

  test('a generating projection renders Stop in the console dock', async () => {
    await act(async () => {
      renderRoom({
        isLive: true,
        nodeStates: [
          nodeState({
            nodeId: 'review',
            name: 'Review',
            status: 'running',
            steeringSubState: 'generating',
          }),
        ],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil('stop button', () =>
      Array.from(host.querySelectorAll('button')).some(
        el => (el.textContent ?? '').trim() === 'Stop'
      )
    );
    expect(host.textContent).not.toContain('Send now');
  });

  test('an idle-after-interrupt projection renders Send now and the disclosure', async () => {
    await act(async () => {
      renderRoom({
        isLive: true,
        nodeStates: [
          nodeState({
            nodeId: 'review',
            name: 'Review',
            status: 'running',
            steeringSubState: 'idle-after-interrupt',
          }),
        ],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil('send now button', () =>
      Array.from(host.querySelectorAll('button')).some(
        el => (el.textContent ?? '').trim() === 'Send now'
      )
    );
    expect(
      Array.from(host.querySelectorAll('button')).some(
        el => (el.textContent ?? '').trim() === 'Stop'
      )
    ).toBe(false);
    expect(host.textContent).toContain(
      'stopped after the last completed tool call · files already written stay written'
    );
  });

  test('dock removal moves focus to the last transcript row, never body', async () => {
    const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: [...FIXTURE],
    });
    await act(async () => {
      renderRoom({
        isLive: true,
        nodeStates: [
          nodeState({
            nodeId: 'review',
            name: 'Review',
            status: 'running',
            steeringSubState: 'generating',
          }),
        ],
        loadMessages,
      });
    });
    await flushUntil('stop button', () =>
      Array.from(host.querySelectorAll('button')).some(
        el => (el.textContent ?? '').trim() === 'Stop'
      )
    );
    const stop = Array.from(host.querySelectorAll('button')).find(
      el => (el.textContent ?? '').trim() === 'Stop'
    );
    if (stop === undefined) throw new Error('missing Stop');
    await act(async () => {
      (stop as unknown as HTMLElement).focus();
    });

    await act(async () => {
      renderRoom({
        isLive: false,
        nodeStates: [
          nodeState({
            nodeId: 'review',
            name: 'Review',
            status: 'running',
            steeringSubState: 'generating',
          }),
        ],
        loadMessages,
      });
    });
    await flush();
    expect(dockField()).toBeNull();
    const lastRow = host.querySelector('[data-last-row]');
    if (lastRow === null) throw new Error('missing last-row marker');
    expect(lastRow.getAttribute('tabindex')).toBe('-1');
    expect((win.document.activeElement as unknown) === lastRow).toBe(true);
    expect(win.document.activeElement).not.toBe(win.document.body);
  });

  test('with no transcript rows the console scroller takes the fallback focus', async () => {
    const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: [],
    });
    await act(async () => {
      renderRoom({
        isLive: true,
        nodeStates: [
          nodeState({
            nodeId: 'review',
            name: 'Review',
            status: 'running',
            steeringSubState: 'generating',
          }),
        ],
        loadMessages,
      });
    });
    await flushUntil('composer field', () => dockField() !== null);
    const field = dockField();
    if (field === null) throw new Error('missing dock field');
    await act(async () => {
      (field as unknown as HTMLElement).focus();
    });

    await act(async () => {
      renderRoom({
        isLive: false,
        nodeStates: [
          nodeState({
            nodeId: 'review',
            name: 'Review',
            status: 'running',
            steeringSubState: 'generating',
          }),
        ],
        loadMessages,
      });
    });
    await flush();
    expect(dockField()).toBeNull();
    expect(host.querySelector('[data-last-row]')).toBeNull();
    const scroller = host.querySelector('[data-testid="console-node-room-scroll"]');
    if (scroller === null) throw new Error('missing scroller');
    expect((win.document.activeElement as unknown) === scroller).toBe(true);
  });

  describe('Console tool disclosure rows', () => {
    const NOW_MS = new Date(CREATED_AT).getTime() + 30_000;

    function callRow(
      toolUseId: string,
      seq: number,
      name: string,
      input: unknown,
      metadata?: Record<string, unknown>
    ): WorkflowNodeMessage {
      return {
        id: `call-${toolUseId}`,
        seq,
        kind: 'tool',
        payload: { name, id: toolUseId, input },
        metadata: { tool_phase: 'call', ...metadata },
        created_at: CREATED_AT,
      };
    }

    function resultRow(
      toolUseId: string,
      seq: number,
      name: string,
      input: unknown,
      output: unknown,
      metadata?: Record<string, unknown>
    ): WorkflowNodeMessage {
      return {
        id: `result-${toolUseId}`,
        seq,
        kind: 'tool',
        payload: { name, id: toolUseId, input, output },
        metadata: { tool_phase: 'result', ...metadata },
        created_at: CREATED_AT,
      };
    }

    function historyItems(
      rows: readonly WorkflowNodeMessage[],
      events: readonly WorkflowEvent[] = []
    ): AgentHistoryItem[] {
      return agentHistory.buildAgentHistory({ rows, events, nodeId: 'review', nowMs: NOW_MS })
        .items;
    }

    function mountList(
      items: readonly AgentHistoryItem[],
      onLoadFullOutput?: (item: Extract<AgentHistoryItem, { kind: 'tool' }>) => Promise<unknown>,
      extensions: Pick<ConsoleAgentHistoryListProps, 'renderAfterItem' | 'renderAtEnd'> = {}
    ): void {
      root.render(
        createElement(consoleHistoryList.ConsoleAgentHistoryList, {
          items,
          showToolCalls: true,
          showSystem: true,
          onLoadFullOutput: onLoadFullOutput ?? (async (): Promise<unknown> => undefined),
          ...extensions,
        })
      );
    }

    function toolRow(toolUseId: string): Element & { open: boolean } {
      const el = host.querySelector(`details[data-tool-id="${toolUseId}"]`);
      if (el === null) throw new Error(`row ${toolUseId} missing: ${host.innerHTML}`);
      return el as Element & { open: boolean };
    }

    function rowSummary(row: Element): HTMLElement {
      const summary = row.querySelector('summary');
      if (summary === null) throw new Error(`summary missing: ${row.innerHTML}`);
      if (summary.parentElement !== row) {
        throw new Error(`summary is not a direct child: ${row.innerHTML}`);
      }
      return summary as unknown as HTMLElement;
    }

    function click(target: Element): void {
      target.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    }

    function rowButton(row: Element, label: string): HTMLButtonElement {
      const button = Array.from(row.querySelectorAll('button')).find(
        candidate => candidate.textContent === label
      );
      if (button === undefined) throw new Error(`button ${label} missing: ${row.innerHTML}`);
      return button as unknown as HTMLButtonElement;
    }

    function rawButton(row: Element): HTMLButtonElement {
      const button = row.querySelector('button[aria-expanded]');
      if (button === null) throw new Error(`Raw button missing: ${row.innerHTML}`);
      return button as unknown as HTMLButtonElement;
    }

    function rawPanel(row: Element): HTMLElement {
      const button = rawButton(row);
      const panelId = button.getAttribute('aria-controls');
      if (panelId === null) throw new Error(`Raw panel id missing: ${row.innerHTML}`);
      const panel = win.document.getElementById(panelId);
      if (panel === null) throw new Error(`Raw panel ${panelId} missing`);
      return panel as unknown as HTMLElement;
    }

    /** Text a screen reader announces: skips aria-hidden, uses chip aria-label. */
    function summaryAccessibleName(summary: Element): string {
      const parts: string[] = [];
      const walk = (node: unknown): void => {
        const child = node as { nodeType?: number; textContent?: string | null };
        if (child.nodeType === 3) {
          parts.push(child.textContent ?? '');
          return;
        }
        const el = node as Element;
        if (el.getAttribute === undefined) return;
        if (el.getAttribute('aria-hidden') === 'true') return;
        const label = el.getAttribute('aria-label');
        if (label !== null) {
          parts.push(label);
          return;
        }
        for (const grandchild of Array.from(el.childNodes)) walk(grandchild);
      };
      walk(summary);
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    const READ_ROWS: readonly WorkflowNodeMessage[] = [
      callRow('t-1', 10, 'Read', { path: 'a.ts' }),
      resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', { outcome: 'success' }),
    ];

    test('mounts one collapsed disclosure row per projected tool call with the shared anatomy', async () => {
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const rows = host.querySelectorAll('details[data-tool-id]');
      expect(rows).toHaveLength(1);
      const row = toolRow('t-1');
      expect(row.open).toBe(false);
      // The row is transparent at rest — no inset card fill/border/shadow.
      expect(row.className).not.toContain('ptool');
      expect(row.className).not.toContain('bg-surface-inset');
      expect(row.className).not.toContain('border');
      expect(row.className).not.toContain('shadow');
      const summary = rowSummary(row);
      expect(summary.textContent).toContain('Read');
      expect(summary.textContent).toContain('a.ts');
      expect(summaryAccessibleName(summary)).toBe('succeeded file · Read a.ts');
      // Chevron and glyph are decorative; the hidden word carries the state.
      const chevron = Array.from(summary.querySelectorAll('span')).find(
        span => span.textContent === '▶'
      );
      expect(chevron?.getAttribute('aria-hidden')).toBe('true');
      const glyph = Array.from(summary.querySelectorAll('span')).find(
        span => span.textContent === '✓'
      );
      expect(glyph?.getAttribute('aria-hidden')).toBe('true');
      // Chip exposes the family · label title and accessible name.
      const chip = Array.from(summary.querySelectorAll('span')).find(
        span => span.getAttribute('title') === 'file · Read'
      );
      expect(chip?.getAttribute('aria-label')).toBe('file · Read');
      // Console focus delta: the outline offset is +2 px, not Legacy's −2 px.
      expect(summary.className).toContain('focus-visible:outline-offset-2');
      expect(summary.className).not.toContain('focus-visible:-outline-offset-2');
      expect(summary.className).toContain('focus-visible:outline-accent-bright');
      // The summary is the containing block for its absolutely-positioned
      // sr-only status label — same geometry contract as the Legacy row.
      expect(summary.className).toContain('relative');
      // The expanded region is unmounted while collapsed — no Raw toggle, no
      // family body, no serialized payload anywhere in the DOM.
      expect(row.querySelectorAll('details')).toHaveLength(0);
      expect(row.querySelector('button[aria-expanded]')).toBeNull();
      expect(row.querySelector('.tool-family-body')).toBeNull();
      expect(row.querySelector('pre')).toBeNull();
      expect(row.textContent).not.toContain('chunk');
    });

    test('pointer toggles the row and the choice survives polling re-renders', async () => {
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const row = toolRow('t-1');
      const summary = rowSummary(row);
      await act(async () => {
        click(summary);
      });
      expect(row.open).toBe(true);
      // A later render with freshly-projected items (same identities) preserves the choice.
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      expect(toolRow('t-1').open).toBe(true);
      await act(async () => {
        click(rowSummary(toolRow('t-1')));
      });
      expect(toolRow('t-1').open).toBe(false);
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      expect(toolRow('t-1').open).toBe(false);
    });

    test('summary is a native control — no role/tabindex shim — and keeps focus through activation', async () => {
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const row = toolRow('t-1');
      const summary = rowSummary(row);
      expect(summary.tagName).toBe('SUMMARY');
      expect(summary.getAttribute('role')).toBeNull();
      expect(summary.getAttribute('tabindex')).toBeNull();
      summary.focus();
      expect(win.document.activeElement as unknown as Element | null).toBe(summary);
      // happy-dom lacks summary's keydown→click activation default; dispatch the
      // activation click real browsers synthesize for Enter/Space.
      await act(async () => {
        summary.dispatchEvent(
          new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event
        );
        click(summary);
      });
      expect(row.open).toBe(true);
      expect(win.document.activeElement as unknown as Element | null).toBe(summary);
      await act(async () => {
        summary.dispatchEvent(
          new win.KeyboardEvent('keydown', { key: ' ', bubbles: true }) as unknown as Event
        );
        click(summary);
      });
      expect(row.open).toBe(false);
    });

    test('an untouched row that turns failed opens once; later nonfailed updates never auto-close', async () => {
      const runningRows: readonly WorkflowNodeMessage[] = [
        callRow('t-1', 10, 'Bash', { command: 'npm test' }),
      ];
      await act(async () => {
        mountList(historyItems(runningRows));
      });
      expect(toolRow('t-1').open).toBe(false);

      const failedRows: readonly WorkflowNodeMessage[] = [
        ...runningRows,
        resultRow('t-1', 11, 'Bash', { command: 'npm test' }, 'boom', {
          outcome: 'error',
          exit_code: 2,
        }),
      ];
      await act(async () => {
        mountList(historyItems(failedRows));
      });
      expect(toolRow('t-1').open).toBe(true);

      // Still untouched: a later succeeded projection must not close the auto-opened row.
      const succeededRows: readonly WorkflowNodeMessage[] = [
        ...(runningRows[0] === undefined ? [] : [runningRows[0]]),
        resultRow('t-1', 11, 'Bash', { command: 'npm test' }, 'ok', { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(succeededRows));
      });
      expect(toolRow('t-1').open).toBe(true);
    });

    test('a touched row never auto-opens and never re-opens after the user closes it', async () => {
      const failedRows: readonly WorkflowNodeMessage[] = [
        callRow('t-1', 10, 'Bash', { command: 'npm test' }),
        resultRow('t-1', 11, 'Bash', { command: 'npm test' }, 'boom', {
          outcome: 'error',
          exit_code: 2,
        }),
      ];
      await act(async () => {
        mountList(historyItems(failedRows));
      });
      const row = toolRow('t-1');
      expect(row.open).toBe(true);
      await act(async () => {
        click(rowSummary(row));
      });
      expect(row.open).toBe(false);
      // Same failed data re-projected — the touched row stays closed.
      await act(async () => {
        mountList(historyItems(failedRows));
      });
      expect(toolRow('t-1').open).toBe(false);
    });

    test('a new tool identity resets disclosure to its own initial policy', async () => {
      const failedA: readonly WorkflowNodeMessage[] = [
        callRow('a', 10, 'Bash', { command: 'false' }),
        resultRow('a', 11, 'Bash', { command: 'false' }, 'nope', { outcome: 'error' }),
      ];
      await act(async () => {
        mountList(historyItems(failedA));
      });
      expect(toolRow('a').open).toBe(true);

      // A different tool_use id replaces the row: fresh mount, fresh initial state.
      const succeededB: readonly WorkflowNodeMessage[] = [
        callRow('b', 12, 'Read', { path: 'b.ts' }),
        resultRow('b', 13, 'Read', { path: 'b.ts' }, 'done', { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(succeededB));
      });
      expect(host.querySelector('details[data-tool-id="a"]')).toBeNull();
      const bRow = toolRow('b');
      expect(bRow.open).toBe(false);

      // Open 'b', then replace with a fresh 'a' instance — 'a' starts open (failed)
      // and 'b' has no carried-over state when it returns.
      await act(async () => {
        click(rowSummary(bRow));
      });
      expect(bRow.open).toBe(true);
      await act(async () => {
        mountList(historyItems(failedA));
      });
      expect(toolRow('a').open).toBe(true);
      await act(async () => {
        mountList(historyItems(succeededB));
      });
      expect(toolRow('b').open).toBe(false);
    });

    test('the Raw toggle mounts a labelled payload panel and closing it leaves the row open', async () => {
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const row = toolRow('t-1');
      await act(async () => {
        click(rowSummary(row));
      });
      expect(row.open).toBe(true);
      // The file body arm renders; the serialized payload does not.
      const body = row.querySelector('.tool-family-body');
      expect(body?.textContent).toContain('a.ts');
      expect(body?.textContent).toContain('chunk');
      expect(body?.textContent).not.toContain('"name"');

      const raw = rawButton(row);
      await act(async () => {
        click(raw);
      });
      // Toggling Raw never toggles the outer disclosure.
      expect(row.open).toBe(true);
      expect(raw.getAttribute('aria-expanded')).toBe('true');
      // The ▾ marker is decorative; the accessible name stays "Raw".
      const marker = raw.querySelector('span[aria-hidden="true"]');
      expect(marker?.textContent).toBe(' ▾');
      expect(raw.className).toContain('border-border-bright');
      expect(raw.className).toContain('text-text-primary');
      // The family body unmounts while the Raw panel is open.
      expect(row.querySelector('.tool-family-body')).toBeNull();

      // aria-controls appears only while open and resolves to this row's panel.
      const panelId = raw.getAttribute('aria-controls');
      if (panelId === null) throw new Error('aria-controls missing');
      const panel = win.document.getElementById(panelId);
      expect(panel).not.toBeNull();
      expect(panel?.closest('details[data-tool-id]')?.getAttribute('data-tool-id')).toBe('t-1');
      expect(panel?.tagName).toBe('PRE');
      expect(panel?.className).toContain('bg-surface-inset');
      expect(panel?.className).toContain('rounded-[6px]');
      expect(panel?.className).toContain('px-2.5');
      expect(panel?.className).toContain('py-2');
      expect(panel?.className).toContain('text-text-primary');
      expect(panel?.textContent).toBe(
        JSON.stringify({ name: 'Read', input: { path: 'a.ts' }, output: 'chunk' }, null, 2)
      );

      await act(async () => {
        click(raw);
      });
      expect(raw.getAttribute('aria-expanded')).toBe('false');
      expect(raw.getAttribute('aria-controls')).toBeNull();
      expect(win.document.getElementById(panelId)).toBeNull();
      expect(row.querySelector('pre')).toBeNull();
      // The family body remounts with the normalized preview, not the payload.
      expect(row.querySelector('.tool-family-body')?.textContent).toContain('chunk');
      expect(row.querySelector('.tool-family-body')?.textContent).not.toContain('"name"');
      expect(row.open).toBe(true);
    });

    test('toggling Raw inside an open row does not mark the outer row touched or close it', async () => {
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const row = toolRow('t-1');
      await act(async () => {
        click(rowSummary(row));
      });
      expect(row.open).toBe(true);
      const raw = rawButton(row);
      await act(async () => {
        click(raw);
      });
      expect(raw.getAttribute('aria-expanded')).toBe('true');
      expect(row.open).toBe(true);
      expect(rawPanel(row).textContent).toContain('"name": "Read"');

      // The Raw choice persists across re-renders; a later failed transition
      // still auto-opens an untouched outer row only when it was closed.
      const failedRows: readonly WorkflowNodeMessage[] = [
        ...(READ_ROWS[0] === undefined ? [] : [READ_ROWS[0]]),
        resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'boom', {
          outcome: 'error',
          exit_code: 2,
        }),
      ];
      await act(async () => {
        mountList(historyItems(failedRows));
      });
      const updated = toolRow('t-1');
      expect(updated.open).toBe(true);
      expect(rawButton(updated).getAttribute('aria-expanded')).toBe('true');
    });

    test('sibling history lists get distinct useId panel ids that resolve to their own panels', async () => {
      const firstItems = historyItems([
        callRow('t-1', 10, 'Read', { path: 'a.ts' }),
        resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk-one', { outcome: 'success' }),
      ]);
      const secondItems = historyItems([
        callRow('t-2', 12, 'Read', { path: 'b.ts' }),
        resultRow('t-2', 13, 'Read', { path: 'b.ts' }, 'chunk-two', { outcome: 'success' }),
      ]);
      const listProps = {
        showToolCalls: true,
        showSystem: true,
        onLoadFullOutput: async (): Promise<unknown> => undefined,
      };
      await act(async () => {
        root.render(
          createElement(
            'div',
            null,
            createElement(consoleHistoryList.ConsoleAgentHistoryList, {
              ...listProps,
              items: firstItems,
            }),
            createElement(consoleHistoryList.ConsoleAgentHistoryList, {
              ...listProps,
              items: secondItems,
            })
          )
        );
      });
      const first = toolRow('t-1');
      const second = toolRow('t-2');
      await act(async () => {
        click(rowSummary(first));
        click(rowSummary(second));
      });
      await act(async () => {
        click(rawButton(first));
        click(rawButton(second));
      });
      const firstId = rawButton(first).getAttribute('aria-controls');
      const secondId = rawButton(second).getAttribute('aria-controls');
      if (firstId === null || secondId === null) throw new Error('aria-controls missing');
      expect(firstId).not.toBe(secondId);
      const firstPanel = win.document.getElementById(firstId);
      const secondPanel = win.document.getElementById(secondId);
      expect(firstPanel?.textContent).toContain('"output": "chunk-one"');
      expect(secondPanel?.textContent).toContain('"output": "chunk-two"');
      expect(firstPanel?.closest('details[data-tool-id]')?.getAttribute('data-tool-id')).toBe(
        't-1'
      );
      expect(secondPanel?.closest('details[data-tool-id]')?.getAttribute('data-tool-id')).toBe(
        't-2'
      );
    });

    test('a pending card keeps Raw open and updates the panel when its result pairs', async () => {
      const pendingRows: readonly WorkflowNodeMessage[] = [
        callRow('t-1', 10, 'Read', { path: 'a.ts' }),
      ];
      await act(async () => {
        mountList(historyItems(pendingRows));
      });
      const row = toolRow('t-1');
      await act(async () => {
        click(rowSummary(row));
      });
      await act(async () => {
        click(rawButton(row));
      });
      expect(rawButton(row).getAttribute('aria-expanded')).toBe('true');
      expect(rawPanel(row).textContent).not.toContain('"output"');

      // The paired result keeps the same card id: Raw stays open and picks up output.
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const updated = toolRow('t-1');
      expect(updated.open).toBe(true);
      expect(rawButton(updated).getAttribute('aria-expanded')).toBe('true');
      expect(rawPanel(updated).textContent).toContain('"output": "chunk"');
    });

    test('a newly keyed history item starts with Raw closed', async () => {
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const row = toolRow('t-1');
      await act(async () => {
        click(rowSummary(row));
      });
      await act(async () => {
        click(rawButton(row));
      });
      expect(rawButton(row).getAttribute('aria-expanded')).toBe('true');

      const otherRows: readonly WorkflowNodeMessage[] = [
        callRow('t-2', 12, 'Bash', { command: 'ls' }),
        resultRow('t-2', 13, 'Bash', { command: 'ls' }, 'out', { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(otherRows));
      });
      expect(host.querySelector('details[data-tool-id="t-1"]')).toBeNull();

      // The same card id returning later mounts fresh: Raw is closed again.
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const remounted = toolRow('t-1');
      // The remounted row is also freshly closed; Raw stays closed once opened.
      expect(remounted.open).toBe(false);
      await act(async () => {
        click(rowSummary(remounted));
      });
      expect(rawButton(remounted).getAttribute('aria-expanded')).toBe('false');
      expect(rawButton(remounted).getAttribute('aria-controls')).toBeNull();
      expect(remounted.querySelector('pre')).toBeNull();
    });

    test('the Raw panel wraps long unbroken values inside the inset surface', async () => {
      const longValue = `x/${'y'.repeat(300)}.ts`;
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('t-1', 10, 'Read', { path: longValue }),
        resultRow('t-1', 11, 'Read', { path: longValue }, longValue, { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(rows));
      });
      const row = toolRow('t-1');
      await act(async () => {
        click(rowSummary(row));
      });
      await act(async () => {
        click(rawButton(row));
      });
      const panel = rawPanel(row);
      expect(panel.className).toContain('whitespace-pre-wrap');
      expect(panel.className).toContain('[overflow-wrap:anywhere]');
      expect(panel.className).toContain('min-w-0');
      expect(panel.className).toContain('max-w-full');
      expect(panel.className).toContain('border');
      expect(panel.className).toContain('font-mono');
      expect(panel.textContent).toContain(longValue);
    });

    test('focus stays on the summary when later items append to the list', async () => {
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const summary = rowSummary(toolRow('t-1'));
      summary.focus();
      expect(win.document.activeElement as unknown as Element | null).toBe(summary);
      const appended: readonly WorkflowNodeMessage[] = [
        ...READ_ROWS,
        callRow('t-2', 12, 'Bash', { command: 'ls' }),
        resultRow('t-2', 13, 'Bash', { command: 'ls' }, 'out', { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(appended));
      });
      expect(win.document.activeElement as unknown as Element | null).toBe(summary);
      expect(toolRow('t-2').open).toBe(false);
    });

    test('running badge and glyph use the console --running token', async () => {
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('t-run', 10, 'Bash', { command: 'npm test' }),
      ];
      const events: WorkflowEvent[] = [
        workflowEvent({
          id: 'e-called',
          event_type: 'tool_called',
          step_name: 'review',
          data: { tool_call_id: 't-run' },
        }),
      ];
      await act(async () => {
        mountList(historyItems(rows, events));
      });
      const summary = rowSummary(toolRow('t-run'));
      const badge = Array.from(summary.querySelectorAll('span')).find(
        span =>
          span.textContent === 'running · 30.0s' && span.getAttribute('aria-hidden') === 'true'
      );
      expect(badge?.className).toContain('var(--running)');
      const glyph = Array.from(summary.querySelectorAll('span')).find(
        span => span.textContent === '◐'
      );
      expect(glyph?.className).toContain('var(--running)');
    });

    test('todo headline is secondary and extension content keeps explicit spacing', async () => {
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('t-todo', 10, 'TodoWrite', { todos: [{ content: 'x' }] }),
        resultRow('t-todo', 11, 'TodoWrite', { todos: [{ content: 'x' }] }, 'updated', {
          outcome: 'success',
        }),
      ];
      await act(async () => {
        mountList(historyItems(rows), undefined, {
          renderAfterItem: item => `after-${item.id}`,
          renderAtEnd: 'at-end',
        });
      });
      const summary = rowSummary(toolRow('t-todo'));
      const headline = Array.from(summary.querySelectorAll('span')).find(
        span => span.textContent === 'todo updated'
      );
      expect(headline?.className).toContain('text-text-secondary');
      expect(headline?.className).not.toContain('text-text-primary');
      const spaced = Array.from(host.querySelectorAll('div')).filter(
        div => div.className === 'mt-1.5'
      );
      expect(spaced.map(div => div.textContent)).toContain('after-call-t-todo');
      expect(spaced.map(div => div.textContent)).toContain('at-end');
    });

    test('collapsed tool rows sit flush while assistant and lifecycle items keep margins', async () => {
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('t-1', 10, 'Read', { path: 'a.ts' }),
        resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', { outcome: 'success' }),
        callRow('t-2', 12, 'Bash', { command: 'ls' }),
        resultRow('t-2', 13, 'Bash', { command: 'ls' }, 'out', { outcome: 'success' }),
        { id: 'txt', seq: 14, kind: 'text', payload: { text: 'notes' }, created_at: CREATED_AT },
        {
          id: 'st',
          seq: 15,
          kind: 'status',
          payload: { state: 'completed' },
          created_at: CREATED_AT,
        },
      ];
      await act(async () => {
        mountList(historyItems(rows));
      });
      // Collapsed tool rows sit flush: the wrapper carries no margin class.
      for (const id of ['t-1', 't-2']) {
        const wrapper = toolRow(id).parentElement;
        expect(wrapper?.className ?? '').toBe('');
      }
      const first = toolRow('t-1');
      const second = toolRow('t-2');
      expect(
        (first.parentElement as Element).compareDocumentPosition(second.parentElement as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).not.toBe(0);
      expect(first.parentElement?.nextElementSibling).toBe(second.parentElement);
      // Assistant and lifecycle wrappers keep explicit separation.
      const assistant = Array.from(host.querySelectorAll('div')).find(
        div => div.textContent === 'notes' || div.className === 'my-1.5'
      );
      expect(assistant?.className).toContain('my-1.5');
    });

    test('full-output load disables the button, swaps the output, and refreshes the row badges', async () => {
      let resolveLoad: ((output: unknown) => void) | null = null;
      const onLoadFullOutput = (): Promise<unknown> =>
        new Promise<unknown>(resolve => {
          resolveLoad = resolve;
        });
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('t-1', 10, 'Read', { path: 'a.ts' }, { full_output_available: true }),
        resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', {
          outcome: 'success',
          output_state: 'truncated',
          full_output_available: true,
        }),
      ];
      await act(async () => {
        mountList(historyItems(rows), onLoadFullOutput);
      });
      const row = toolRow('t-1');
      expect(rowSummary(row).textContent).toContain('truncated');
      await act(async () => {
        click(rowSummary(row));
      });
      await act(async () => {
        click(rawButton(row));
      });
      expect(row.open).toBe(true);
      expect(rawPanel(row).textContent).toContain('"output": "chunk"');
      const button = rowButton(row, 'View full output');
      await act(async () => {
        click(button);
      });
      expect(button.disabled).toBe(true);
      await act(async () => {
        resolveLoad?.('FULL OUTPUT');
      });
      // The Raw panel re-renders from the complete payload.
      expect(rawPanel(row).textContent).toContain('"output": "FULL OUTPUT"');
      // The row re-presented with output_state 'full': the truncated badge is gone.
      expect(rowSummary(row).textContent).not.toContain('truncated');
      expect(row.open).toBe(true);

      // A later poll must refresh outcome facts without discarding the fetched output.
      const failedRows: readonly WorkflowNodeMessage[] = [
        rows[0],
        resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', {
          outcome: 'error',
          exit_code: 2,
          output_state: 'truncated',
          full_output_available: true,
        }),
      ];
      await act(async () => {
        mountList(historyItems(failedRows), onLoadFullOutput);
      });
      expect(rowSummary(toolRow('t-1')).textContent).toContain('failed');
      expect(rowSummary(toolRow('t-1')).textContent).toContain('exit 2');
      expect(toolRow('t-1').textContent).toContain('FULL OUTPUT');
    });

    test('a failed full-output load shows the error and Retry reloads', async () => {
      let attempts = 0;
      const onLoadFullOutput = async (): Promise<unknown> => {
        attempts++;
        if (attempts === 1) throw new Error('network down');
        return 'FULL';
      };
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('t-1', 10, 'Read', { path: 'a.ts' }, { full_output_available: true }),
        resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', {
          outcome: 'success',
          output_state: 'truncated',
          full_output_available: true,
        }),
      ];
      await act(async () => {
        mountList(historyItems(rows), onLoadFullOutput);
      });
      const row = toolRow('t-1');
      await act(async () => {
        click(rowSummary(row));
      });
      // Loading works with Raw closed: the payload only enters the DOM on demand.
      const button = rowButton(row, 'View full output');
      await act(async () => {
        click(button);
      });
      expect(row.textContent).toContain('network down');
      const retry = rowButton(row, 'Retry');
      await act(async () => {
        click(retry);
      });
      expect(row.textContent).not.toContain('network down');
      expect(attempts).toBe(2);
      // The full payload is loaded even though Raw stayed closed the whole time.
      expect(row.querySelector('pre')).toBeNull();
      await act(async () => {
        click(rawButton(row));
      });
      expect(rawPanel(row).textContent).toContain('"output": "FULL"');
      expect(rowSummary(row).textContent).not.toContain('truncated');
    });

    test('an unusable full-output detail keeps the old presentation, reports the error, and retries', async () => {
      let attempts = 0;
      const onLoadFullOutput = async (): Promise<unknown> => {
        attempts++;
        if (attempts === 1) return undefined;
        return 'FULL';
      };
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('t-1', 10, 'Read', { path: 'a.ts' }, { full_output_available: true }),
        resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', {
          outcome: 'success',
          output_state: 'truncated',
          full_output_available: true,
        }),
      ];
      await act(async () => {
        mountList(historyItems(rows), onLoadFullOutput);
      });
      const row = toolRow('t-1');
      await act(async () => {
        click(rowSummary(row));
      });
      await act(async () => {
        click(rawButton(row));
      });
      const button = rowButton(row, 'View full output');

      // A detail response without output keeps the old presentation and offers retry.
      await act(async () => {
        click(button);
      });
      expect(row.textContent).toContain('Full output is not available for this call');
      expect(rowSummary(row).textContent).toContain('truncated');
      expect(rawPanel(row).textContent).toContain('"output": "chunk"');

      await act(async () => {
        click(rowButton(row, 'Retry'));
      });
      expect(row.textContent).not.toContain('not available');
      expect(attempts).toBe(2);
      expect(rawPanel(row).textContent).toContain('"output": "FULL"');
      expect(rowSummary(row).textContent).not.toContain('truncated');
    });

    test('drained tool calls mount as collapsed disclosure rows in the selected room', async () => {
      const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 'call-tool-use-1',
            seq: 10,
            kind: 'tool',
            payload: { name: 'Read', id: 'tool-use-1', input: { path: 'a.ts' } },
            metadata: { tool_phase: 'call' },
            created_at: CREATED_AT,
          },
          {
            id: 'result-tool-use-1',
            seq: 11,
            kind: 'tool',
            payload: {
              name: 'Read',
              id: 'tool-use-1',
              input: { path: 'a.ts' },
              output: 'chunk',
            },
            metadata: { tool_phase: 'result', outcome: 'success' },
            created_at: CREATED_AT,
          },
        ],
      });
      await act(async () => {
        renderRoom({
          run: run({ id: 'run-drain' }),
          loadMessages,
        });
      });
      await flushUntil(
        'tool disclosure row',
        () => host.querySelector('details[data-tool-id="tool-use-1"]') !== null
      );
      const drained = toolRow('tool-use-1');
      expect(drained.open).toBe(false);
      const summary = rowSummary(drained);
      expect(summary.textContent).toContain('Read');
      expect(summary.textContent).toContain('a.ts');
      expect(summary.textContent).toContain('succeeded');
      // Collapsed rows mount no expanded region: no body, no Raw toggle.
      expect(drained.querySelector('.tool-family-body')).toBeNull();
      expect(drained.querySelector('button[aria-expanded]')).toBeNull();
      expect(drained.querySelectorAll('details')).toHaveLength(0);
      expect(drained.querySelector('pre')).toBeNull();
    });

    test('a poll-updated failure flips an untouched drained row open once', async () => {
      const firstLoad = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 'call-tool-use-1',
            seq: 10,
            kind: 'tool',
            payload: { name: 'Bash', id: 'tool-use-1', input: { command: 'npm test' } },
            metadata: { tool_phase: 'call' },
            created_at: CREATED_AT,
          },
        ],
      });
      await act(async () => {
        renderRoom({
          run: run({ id: 'run-poll-flip' }),
          loadMessages: firstLoad,
        });
      });
      await flushUntil(
        'running tool row',
        () => host.querySelector('details[data-tool-id="tool-use-1"]') !== null
      );
      expect(toolRow('tool-use-1').open).toBe(false);

      // A new loader identity re-drains from afterSeq; the merged result completes the card.
      const secondLoad = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 'call-tool-use-1',
            seq: 10,
            kind: 'tool',
            payload: { name: 'Bash', id: 'tool-use-1', input: { command: 'npm test' } },
            metadata: { tool_phase: 'call' },
            created_at: CREATED_AT,
          },
          {
            id: 'result-tool-use-1',
            seq: 11,
            kind: 'tool',
            payload: {
              name: 'Bash',
              id: 'tool-use-1',
              input: { command: 'npm test' },
              output: 'boom',
            },
            metadata: { tool_phase: 'result', outcome: 'error', exit_code: 2 },
            created_at: CREATED_AT,
          },
        ],
      });
      await act(async () => {
        renderRoom({
          run: run({ id: 'run-poll-flip' }),
          loadMessages: secondLoad,
        });
      });
      await flushUntil('failed tool row auto-open', () => toolRow('tool-use-1').open);
      const failed = toolRow('tool-use-1');
      expect(failed.open).toBe(true);
      const summary = rowSummary(failed);
      expect(summary.textContent).toContain('failed');
      expect(summary.textContent).toContain('exit 2');
    });

    const OMP_TASK_INPUT: Record<string, unknown> = {
      context: 'Read-only review. **Do not edit.**\n\n- skip formatters\n- report file:line',
      tasks: [
        {
          name: 'ScoutBackoff',
          agent: 'scout',
          task: 'Map every call site of retry_backoff and backoff across crates/, recording file:line, the attempt argument, whether the caller overrides the ceiling, and any nearby jitter configuration — TAILMARKER.',
        },
        {
          name: 'ScoutCI',
          agent: 'scout',
          task: 'Where is CARGO_BUILD_JOBS pinned in .github/workflows?',
        },
      ],
    };

    const OMP_TASK_MESSAGES: readonly WorkflowNodeMessage[] = [
      callRow('task-1', 10, 'Task', OMP_TASK_INPUT, { full_output_available: true }),
      resultRow('task-1', 11, 'Task', OMP_TASK_INPUT, 'done', {
        outcome: 'success',
        full_output_available: true,
      }),
    ];

    function subtaskCard(row: Element, index: number): Element & { open: boolean } {
      const card = row.querySelector(`details[data-subtask-index="${index}"]`);
      if (card === null) throw new Error(`subtask card ${index} missing: ${row.innerHTML}`);
      return card as Element & { open: boolean };
    }

    function cardSummary(card: Element): HTMLElement {
      const summary = card.querySelector('summary');
      if (summary === null) throw new Error(`card summary missing: ${card.innerHTML}`);
      return summary as unknown as HTMLElement;
    }

    test('an opened OMP batch row renders the shared body through the selected room', async () => {
      const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [...OMP_TASK_MESSAGES],
      });
      await act(async () => {
        renderRoom({ run: run({ id: 'run-omp' }), loadMessages });
      });
      await flushUntil(
        'task row',
        () => host.querySelector('details[data-tool-id="task-1"]') !== null
      );
      const row = toolRow('task-1');
      await act(async () => {
        click(rowSummary(row));
      });
      expect(row.open).toBe(true);
      expect(row.textContent).toContain('task · batch · 2 subtasks');
      expect(row.textContent).toContain('Read-only review.');
      const cards = row.querySelectorAll('details[data-subtask-index]');
      expect(cards).toHaveLength(2);
      const firstSummary = cardSummary(subtaskCard(row, 0));
      expect(firstSummary.textContent).toContain('scout');
      expect(firstSummary.textContent).toContain('ScoutBackoff');
      expect(firstSummary.textContent).toContain('Map every call site');
      expect(firstSummary.textContent).not.toContain('TAILMARKER');
      const firstCard = subtaskCard(row, 0);
      await act(async () => {
        click(firstSummary);
      });
      expect(firstCard.open).toBe(true);
      expect(firstCard.textContent).toContain('TAILMARKER');
      // Raw lives in the body bar and precedes the cards.
      const raw = rawButton(row);
      expect(raw.getAttribute('aria-expanded')).toBe('false');
      for (const card of Array.from(cards)) {
        expect(raw.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      }
    });

    test('hidden tool calls hide task bodies too', async () => {
      const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [...OMP_TASK_MESSAGES],
      });
      await act(async () => {
        renderRoom({
          run: run({ id: 'run-hidden' }),
          loadMessages,
          showToolCalls: false,
        });
      });
      await flush();
      expect(host.querySelector('details[data-tool-id]')).toBeNull();
      expect(host.textContent).not.toContain('ScoutBackoff');
      expect(host.textContent).not.toContain('task · batch');
    });

    test('a Claude single dispatch renders one card with the single-dispatch bar and no context', async () => {
      const claudeInput: Record<string, unknown> = {
        description: 'Scout retry-backoff call sites',
        prompt: 'Find every caller of retry_backoff() and backoff() in crates/.',
      };
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('task-claude', 10, 'Agent', claudeInput),
        resultRow('task-claude', 11, 'Agent', claudeInput, 'done', { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(rows));
      });
      const row = toolRow('task-claude');
      await act(async () => {
        click(rowSummary(row));
      });
      expect(row.textContent).toContain('task · single dispatch');
      expect(row.textContent).not.toContain('task · batch');
      const cards = row.querySelectorAll('details[data-subtask-index]');
      expect(cards).toHaveLength(1);
      const summary = cardSummary(subtaskCard(row, 0));
      // Null agent: no agent span and no orphan '·' separator.
      expect(summary.textContent).not.toContain('·');
      expect(summary.textContent).toContain('Scout retry-backoff call sites');
      expect(summary.textContent).toContain('— Find every caller');
    });

    test('malformed task input renders bounded generic fields with no cards or count badge', async () => {
      const badInput: Record<string, unknown> = { tasks: 'nope', note: 'x' };
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('task-bad', 10, 'Task', badInput),
        resultRow('task-bad', 11, 'Task', badInput, 'done', { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(rows));
      });
      const row = toolRow('task-bad');
      await act(async () => {
        click(rowSummary(row));
      });
      expect(row.querySelectorAll('details[data-subtask-index]')).toHaveLength(0);
      expect(rowSummary(row).textContent).not.toContain('subagent');
      expect(row.textContent).toContain('tasks');
      expect(row.textContent).toContain('nope');
      expect(row.textContent).toContain('note');
    });

    test('task context markdown suppresses images and unsafe links but keeps structure', async () => {
      const hostileInput: Record<string, unknown> = {
        context:
          'Intro **bold** tail\n\n- first\n- second\n\n![tracker](https://tracker.example/pixel.png)\n\n[click](javascript:alert(1))',
        tasks: [{ name: 'ScoutBackoff', agent: 'scout', task: 'do it' }],
      };
      const rows: readonly WorkflowNodeMessage[] = [
        callRow('task-md', 10, 'Task', hostileInput),
        resultRow('task-md', 11, 'Task', hostileInput, 'done', { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(rows));
      });
      const row = toolRow('task-md');
      await act(async () => {
        click(rowSummary(row));
      });
      // Raw JSON is not in the DOM while closed; sanitize the readable body
      // (through the first card, which holds the prompt).
      const cardAt = row.innerHTML.indexOf('data-subtask-index');
      const body = cardAt < 0 ? row.innerHTML : row.innerHTML.slice(0, cardAt);
      expect(body).toContain('<strong>bold</strong>');
      expect(body).toContain('>first</li>');
      expect(body).not.toContain('<img');
      expect(body).not.toContain('javascript:');
    });

    test('nested subtask card toggles do not mark or flip the outer row', async () => {
      // A failed outcome auto-opens the untouched outer row and mounts the cards.
      const failedRows: readonly WorkflowNodeMessage[] = [
        ...(OMP_TASK_MESSAGES[0] === undefined ? [] : [OMP_TASK_MESSAGES[0]]),
        resultRow('task-1', 11, 'Task', OMP_TASK_INPUT, 'boom', { outcome: 'error' }),
      ];
      await act(async () => {
        mountList(historyItems(failedRows));
      });
      const row = toolRow('task-1');
      expect(row.open).toBe(true);
      const card = subtaskCard(row, 0);
      await act(async () => {
        click(cardSummary(card));
      });
      expect(card.open).toBe(true);
      // The guard keeps the nested toggle from touching or flipping the outer row.
      expect(row.open).toBe(true);
      await act(async () => {
        click(cardSummary(card));
      });
      expect(card.open).toBe(false);
      expect(row.open).toBe(true);
    });

    test('Enter and Space toggle the focused card summary; focus is retained', async () => {
      await act(async () => {
        mountList(historyItems(OMP_TASK_MESSAGES));
      });
      const row = toolRow('task-1');
      await act(async () => {
        click(rowSummary(row));
      });
      const card = subtaskCard(row, 0);
      const summary = cardSummary(card);
      summary.focus();
      expect(win.document.activeElement as unknown as Element | null).toBe(summary);
      await act(async () => {
        summary.dispatchEvent(
          new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event
        );
        click(summary);
      });
      expect(card.open).toBe(true);
      expect(win.document.activeElement as unknown as Element | null).toBe(summary);
      await act(async () => {
        summary.dispatchEvent(
          new win.KeyboardEvent('keydown', { key: ' ', bubbles: true }) as unknown as Event
        );
        click(summary);
      });
      expect(card.open).toBe(false);
      expect(win.document.activeElement as unknown as Element | null).toBe(summary);
    });

    test('same tool identity keeps card state across rerenders; a new identity starts closed', async () => {
      await act(async () => {
        mountList(historyItems(OMP_TASK_MESSAGES));
      });
      const row = toolRow('task-1');
      await act(async () => {
        click(rowSummary(row));
      });
      await act(async () => {
        click(cardSummary(subtaskCard(row, 0)));
      });
      expect(subtaskCard(row, 0).open).toBe(true);
      await act(async () => {
        mountList(historyItems(OMP_TASK_MESSAGES));
      });
      expect(subtaskCard(toolRow('task-1'), 0).open).toBe(true);

      const otherRows: readonly WorkflowNodeMessage[] = [
        callRow('task-9', 20, 'Task', OMP_TASK_INPUT),
        resultRow('task-9', 21, 'Task', OMP_TASK_INPUT, 'done', { outcome: 'success' }),
      ];
      await act(async () => {
        mountList(historyItems(otherRows));
      });
      const fresh = toolRow('task-9');
      await act(async () => {
        click(rowSummary(fresh));
      });
      expect(subtaskCard(fresh, 0).open).toBe(false);
    });

    test('card summaries follow Raw and precede the full-output control in DOM order', async () => {
      await act(async () => {
        mountList(historyItems(OMP_TASK_MESSAGES));
      });
      const row = toolRow('task-1');
      await act(async () => {
        click(rowSummary(row));
      });
      const summaries = Array.from(row.querySelectorAll('summary'));
      expect(summaries[0]).toBe(rowSummary(row));
      expect(summaries[1]).toBe(cardSummary(subtaskCard(row, 0)));
      expect(summaries[2]).toBe(cardSummary(subtaskCard(row, 1)));
      expect(summaries).toHaveLength(3);
      const focusables = Array.from(row.querySelectorAll('summary, button'));
      expect(focusables[0]).toBe(rowSummary(row));
      expect(focusables[1]).toBe(rawButton(row));
      expect(focusables[2]).toBe(cardSummary(subtaskCard(row, 0)));
      expect(focusables[3]).toBe(cardSummary(subtaskCard(row, 1)));
      expect(focusables.indexOf(rowButton(row, 'View full output'))).toBe(4);

      await act(async () => {
        click(rawButton(row));
      });
      expect(rawButton(row).getAttribute('aria-expanded')).toBe('true');
      expect(row.querySelectorAll('details[data-subtask-index]')).toHaveLength(0);
      expect(rawPanel(row).textContent).toContain('"name"');
    });

    test('Console card focus delta: +2 px outline offset with the accent token', async () => {
      await act(async () => {
        mountList(historyItems(OMP_TASK_MESSAGES));
      });
      const row = toolRow('task-1');
      await act(async () => {
        click(rowSummary(row));
      });
      const summary = cardSummary(subtaskCard(row, 0));
      expect(summary.className).toContain('focus-visible:outline-offset-2');
      expect(summary.className).not.toContain('focus-visible:-outline-offset-2');
      expect(summary.className).toContain('focus-visible:outline-accent-bright!');
      const agentGroup = summary.querySelector('.text-node-approval')?.parentElement;
      const name = Array.from(summary.querySelectorAll('span')).find(element =>
        element.className.includes('font-bold')
      );
      for (const [label, element] of [
        ['agent', agentGroup],
        ['name', name],
      ] as const) {
        expect(element, `${label} identifier span`).not.toBeNull();
        expect(element?.className).toContain('min-w-0');
        expect(element?.className).toContain('shrink');
        expect(element?.className).toContain('overflow-hidden');
        expect(element?.className).toContain('text-ellipsis');
        expect(element?.className).not.toContain('flex-none');
      }
      const chevron = summary.querySelector('span[aria-hidden="true"]');
      const classes = (chevron?.getAttribute('class') ?? '').split(' ');
      expect(classes).toContain('group-open/subtask:rotate-90');
      expect(classes).not.toContain('rotate-90');
    });

    test('subtask indexes are scoped inside the owning tool row', async () => {
      const rows: readonly WorkflowNodeMessage[] = [
        ...OMP_TASK_MESSAGES,
        callRow('task-2', 20, 'Task', {
          context: '',
          tasks: [{ name: 'OnlyTask', agent: 'scout', task: 'do it' }],
        }),
        resultRow(
          'task-2',
          21,
          'Task',
          { context: '', tasks: [{ name: 'OnlyTask', agent: 'scout', task: 'do it' }] },
          'done',
          { outcome: 'success' }
        ),
      ];
      await act(async () => {
        mountList(historyItems(rows));
      });
      await act(async () => {
        click(rowSummary(toolRow('task-1')));
        click(rowSummary(toolRow('task-2')));
      });
      expect(toolRow('task-1').querySelectorAll('details[data-subtask-index]')).toHaveLength(2);
      expect(toolRow('task-2').querySelectorAll('details[data-subtask-index]')).toHaveLength(1);
    });
  });

  describe('todo strip', () => {
    type Loader = Parameters<typeof consoleNodeRoom.ConsoleNodeRoom>[0]['loadMessages'];

    function todoPair(toolUseId: string, seq: number, input: unknown): WorkflowNodeMessage[] {
      return [
        {
          id: `call-${toolUseId}`,
          seq,
          kind: 'tool',
          payload: { name: 'todo', id: toolUseId, input },
          metadata: { tool_phase: 'call' },
          created_at: CREATED_AT,
        },
        {
          id: `result-${toolUseId}`,
          seq: seq + 1,
          kind: 'tool',
          payload: { name: 'todo', id: toolUseId, input, output: 'todo updated' },
          metadata: { tool_phase: 'result', outcome: 'success' },
          created_at: CREATED_AT,
        },
      ];
    }

    const TODO_INIT = {
      op: 'init',
      list: [
        {
          phase: 'Research',
          items: [
            'Read the spec',
            'Map the message path',
            'Check contract conflicts',
            'Inspect the mockups',
            'Confirm the tokens',
            'Define acceptance cases',
          ],
        },
        {
          phase: 'Implement',
          items: [
            'Add the fold',
            'Wire Legacy',
            'Wire Console',
            'Add the tests',
            'Run the suite',
            'Review output',
          ],
        },
      ],
    };

    const TODO_MESSAGES: WorkflowNodeMessage[] = [
      ...todoPair('todo-1', 1, TODO_INIT),
      ...todoPair('todo-2', 3, { op: 'done', task: 'Read the spec' }),
      ...todoPair('todo-3', 5, {
        op: 'block',
        task: 'Run the suite',
        reason: 'CI has one build job',
      }),
      ...todoPair('todo-4', 7, { op: 'drop', task: 'Review output' }),
    ];

    function stripSection(): Element | null {
      return host.querySelector('section[aria-label="Todo"]');
    }

    function stripButton(): HTMLElement {
      const button = stripSection()?.querySelector('button');
      if (!(button instanceof HTMLElement)) throw new Error('missing strip button');
      return button;
    }

    test('mounts the folded todo strip ahead of the scroller inside one room region', async () => {
      await act(async () => {
        renderRoom({
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [...TODO_MESSAGES],
          }),
        });
      });
      await flushUntil('todo strip', () => stripSection() !== null);

      const regions = host.querySelectorAll('[role="region"]');
      expect(regions).toHaveLength(1);
      const region = regions[0];
      if (region === undefined) throw new Error('missing room region');
      expect(region.getAttribute('aria-label')).toBe('review room');
      expect(region.getAttribute('class') ?? '').toContain('m-[4px]');
      const strip = stripSection();
      const scroller = host.querySelector('[data-testid="console-node-room-scroll"]');
      if (scroller === null) throw new Error('missing scroller');
      expect(region.firstElementChild).toBe(strip);
      expect(strip?.nextElementSibling).toBe(scroller);
      expect(scroller.querySelectorAll('[role="region"]')).toHaveLength(0);

      const button = stripButton();
      expect(button.getAttribute('aria-expanded')).toBe('false');
      const body = strip?.querySelector('[data-testid="todo-list"]');
      if (body === null || body === undefined) throw new Error('missing strip body');
      expect(body.hasAttribute('hidden')).toBe(true);
      expect(button.getAttribute('aria-controls')).toBe(body.id);
      expect(strip?.textContent).toContain('TODO');
      expect(strip?.textContent).toContain('1/12');
      expect(strip?.textContent).toContain('Map the message path');
      expect(strip?.querySelectorAll('[data-testid="todo-meter"] > span')).toHaveLength(12);
      const headings = Array.from(strip?.querySelectorAll('h3') ?? []).map(h => h.textContent);
      expect(headings).toEqual(['Research', 'Implement']);
      expect(strip?.textContent).toContain('· blocked: CI has one build job');
      expect(strip?.textContent).toContain('· dropped');
      // The Console running token marks the in-progress row.
      const currentRow = Array.from(strip?.querySelectorAll('li') ?? []).find(el =>
        (el.textContent ?? '').includes('Map the message path')
      );
      expect(currentRow?.getAttribute('class') ?? '').toContain(
        'shadow-[inset_2px_0_0_var(--running)]'
      );

      await act(async () => {
        button.click();
      });
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(body.hasAttribute('hidden')).toBe(false);
      const todoRows = host.querySelectorAll('details[data-tool-id]');
      expect(todoRows).toHaveLength(4);
      for (const rowEl of Array.from(todoRows)) {
        expect(rowEl.textContent).toContain('todo updated');
        expect(
          rowEl.querySelector('[data-testid="todo-list"], [data-testid="todo-meter"], ul')
        ).toBeNull();
      }
    });

    test('renders no strip when the transcript has no foldable todo state', async () => {
      await act(async () => {
        renderRoom({
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [...FIXTURE],
          }),
        });
      });
      await flushUntil('fixture rows', () => (host.textContent ?? '').includes('first'));
      expect(stripSection()).toBeNull();
      expect(host.querySelector('[role="region"]')?.getAttribute('class') ?? '').not.toContain(
        'm-[4px]'
      );
    });

    test('merges an initial page and later mutation pages into the final strip state', async () => {
      const loadMessages: Loader = async (_runId, _nodeId, options) => {
        if ((options?.afterSeq ?? 0) === 0) {
          return {
            messages: todoPair('todo-1', 1, TODO_INIT),
            hasMore: true,
            nextCursor: '2',
            highWatermark: 8,
          };
        }
        return {
          messages: [
            ...todoPair('todo-2', 3, { op: 'done', task: 'Read the spec' }),
            ...todoPair('todo-3', 5, {
              op: 'block',
              task: 'Run the suite',
              reason: 'CI has one build job',
            }),
            ...todoPair('todo-4', 7, { op: 'drop', task: 'Review output' }),
          ],
          hasMore: false,
          nextCursor: '8',
          highWatermark: 8,
        };
      };
      await act(async () => {
        renderRoom({ loadMessages });
      });
      await flushUntil('merged strip', () => (stripSection()?.textContent ?? '').includes('1/12'));
      expect(stripSection()?.textContent).toContain('Map the message path');
      expect(stripSection()?.textContent).toContain('· blocked: CI has one build job');
    });

    test('keeps strip identity, open state, and focus across same-scope polls', async () => {
      const firstLoad: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: todoPair('todo-1', 1, TODO_INIT),
        nextCursor: '2',
        highWatermark: 2,
      });
      await act(async () => {
        renderRoom({ loadMessages: firstLoad });
      });
      await flushUntil('initial strip', () => (stripSection()?.textContent ?? '').includes('0/12'));
      const strip = stripSection();
      const button = stripButton();
      await act(async () => {
        button.focus();
        button.click();
      });
      expect(button.getAttribute('aria-expanded')).toBe('true');

      const secondLoad: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: todoPair('todo-2', 3, { op: 'done', task: 'Read the spec' }),
        nextCursor: '4',
        highWatermark: 4,
      });
      await act(async () => {
        renderRoom({ loadMessages: secondLoad });
      });
      await flushUntil('polled strip', () => (stripSection()?.textContent ?? '').includes('1/12'));
      expect(stripSection()).toBe(strip);
      expect(stripButton().getAttribute('aria-expanded')).toBe('true');
      expect((win.document.activeElement as unknown) === button).toBe(true);
      expect(strip?.textContent).toContain('Map the message path');
    });

    test('unmounts the strip when every todo is removed and remounts collapsed for a new list', async () => {
      const firstLoad: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: todoPair('todo-1', 1, TODO_INIT),
        nextCursor: '2',
        highWatermark: 2,
      });
      await act(async () => {
        renderRoom({ loadMessages: firstLoad });
      });
      await flushUntil('initial strip', () => stripSection() !== null);
      const strip = stripSection();
      await act(async () => {
        stripButton().click();
      });
      expect(stripButton().getAttribute('aria-expanded')).toBe('true');

      const clearLoad: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: todoPair('todo-2', 3, { op: 'rm' }),
        nextCursor: '4',
        highWatermark: 4,
      });
      await act(async () => {
        renderRoom({ loadMessages: clearLoad });
      });
      await flushUntil('cleared strip', () => stripSection() === null);

      const freshLoad: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: todoPair('todo-3', 5, {
          op: 'init',
          list: [{ phase: 'Solo', items: ['Only task'] }],
        }),
        nextCursor: '6',
        highWatermark: 6,
      });
      await act(async () => {
        renderRoom({ loadMessages: freshLoad });
      });
      await flushUntil('fresh strip', () => stripSection() !== null);
      const freshStrip = stripSection();
      expect(freshStrip).not.toBe(strip);
      expect(stripButton().getAttribute('aria-expanded')).toBe('false');
      expect(freshStrip?.textContent).toContain('0/1');
    });

    test('remounts the strip collapsed when the scope changes', async () => {
      const loadMessages: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: todoPair('todo-1', 1, TODO_INIT),
        nextCursor: '2',
        highWatermark: 2,
      });
      await act(async () => {
        renderRoom({ loadMessages, scopeKey: 'scope-a' });
      });
      await flushUntil('scope a strip', () => stripSection() !== null);
      const stripA = stripSection();
      await act(async () => {
        stripButton().click();
      });
      expect(stripButton().getAttribute('aria-expanded')).toBe('true');

      await act(async () => {
        renderRoom({ loadMessages, scopeKey: 'scope-b' });
      });
      await flushUntil(
        'scope b strip',
        () => stripSection() !== null && stripSection()?.textContent?.includes('0/12') === true
      );
      const stripB = stripSection();
      expect(stripB).not.toBe(stripA);
      expect(stripButton().getAttribute('aria-expanded')).toBe('false');
    });

    test('a later-page failure keeps the last good strip next to the error notice', async () => {
      const loadMessages: Loader = async (_runId, _nodeId, options) => {
        if ((options?.afterSeq ?? 0) === 0) {
          return {
            messages: todoPair('todo-1', 1, TODO_INIT),
            hasMore: true,
            nextCursor: '2',
            highWatermark: 4,
          };
        }
        throw new Error('page-two-failed');
      };
      await act(async () => {
        renderRoom({ loadMessages });
      });
      await flushUntil('page error', () =>
        (host.textContent ?? '').includes('Failed to load node transcript')
      );
      const strip = stripSection();
      expect(strip).not.toBeNull();
      expect(strip?.textContent).toContain('0/12');
      expect(strip?.textContent).toContain('Read the spec');
      expect(host.textContent).toContain('Retry');
    });

    test('a first-page failure renders the error placeholder and no strip', async () => {
      const loadMessages: Loader = async (): Promise<WorkflowNodeMessagesResponse> => {
        throw new Error('boom');
      };
      await act(async () => {
        renderRoom({ loadMessages });
      });
      await flushUntil('first-page error', () =>
        (host.textContent ?? '').includes('Failed to load node transcript')
      );
      expect(stripSection()).toBeNull();
      expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    });

    test('keeps the strip while tool rows are filtered out by showToolCalls', async () => {
      await act(async () => {
        renderRoom({
          showToolCalls: false,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [...TODO_MESSAGES],
          }),
        });
      });
      await flushUntil('todo strip', () => stripSection() !== null);
      expect(host.querySelectorAll('details[data-tool-id]')).toHaveLength(0);
      expect(stripSection()?.textContent).toContain('1/12');
      expect(stripSection()?.textContent).toContain('Map the message path');
    });

    test('renders no strip for non-agent rooms', async () => {
      const loadMessages: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [...TODO_MESSAGES],
      });
      await act(async () => {
        renderRoom({
          nodeId: 'setup',
          selectedRow: row({ nodeId: 'setup', label: 'Setup' }),
          definitionNodes: [{ id: 'setup', bash: 'echo hi' }],
          nodeStates: [nodeState({ nodeId: 'setup', name: 'Setup', status: 'completed' })],
          loadMessages,
        });
      });
      await flush();
      expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
      expect(stripSection()).toBeNull();
    });
  });

  describe('Console tool family bodies', () => {
    function toolItem(
      overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>> = {}
    ): Extract<AgentHistoryItem, { kind: 'tool' }> {
      const toolUseId = overrides.toolUseId ?? 'tool-use-1';
      const base = {
        kind: 'tool' as const,
        id: `tool-${toolUseId}`,
        seq: 2,
        role: 'tool' as const,
        name: 'Read',
        toolUseId,
        input: { path: 'a.ts' },
        output: 'truncated-output',
        outcome: 'succeeded' as const,
        exitCode: null,
        durationMs: 1500,
        canLoadFullOutput: true,
        outputState: 'truncated' as const,
        messageId: 'msg-tool-1',
        execution: null as TranscriptExecution | null,
        ...overrides,
      };
      return {
        ...base,
        presentation:
          overrides.presentation ??
          toolPresentation.toolRowPresentation(
            { name: base.name, input: base.input, output: base.output },
            {
              outcome: base.outcome,
              exitCode: base.exitCode,
              durationMs: base.durationMs,
              outputState: base.outputState,
            }
          ),
        execution: overrides.execution ?? null,
      };
    }

    /** A settled row that mounts open so the expanded body renders immediately. */
    function openToolItem(
      overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>> = {}
    ): Extract<AgentHistoryItem, { kind: 'tool' }> {
      const item = toolItem(overrides);
      return { ...item, presentation: { ...item.presentation, initialOpen: true } };
    }

    function toolRow(toolUseId: string): Element & { open: boolean } {
      const el = host.querySelector(`details[data-tool-id="${toolUseId}"]`);
      if (el === null) throw new Error(`row ${toolUseId} missing: ${host.innerHTML}`);
      return el as Element & { open: boolean };
    }

    function rowSummary(row: Element): HTMLElement {
      const summary = row.querySelector('summary');
      if (summary === null) throw new Error(`summary missing: ${row.innerHTML}`);
      return summary as unknown as HTMLElement;
    }

    function rawButton(row: Element): HTMLButtonElement {
      const button = row.querySelector('button[aria-expanded]');
      if (button === null) throw new Error(`Raw toggle missing: ${row.innerHTML}`);
      return button as unknown as HTMLButtonElement;
    }

    function bodyBox(row: Element): Element {
      const body = row.querySelector('.tool-family-body');
      if (body === null) throw new Error(`body missing: ${row.innerHTML}`);
      return body;
    }

    function rawPanel(row: Element): HTMLElement {
      const button = rawButton(row);
      const panelId = button.getAttribute('aria-controls');
      if (panelId === null) throw new Error(`Raw panel id missing: ${row.innerHTML}`);
      const panel = win.document.getElementById(panelId);
      if (panel === null) throw new Error(`Raw panel ${panelId} missing`);
      return panel as unknown as HTMLElement;
    }

    function rowButton(row: Element, label: string): HTMLButtonElement {
      const button = Array.from(row.querySelectorAll('button')).find(
        candidate => candidate.textContent === label
      );
      if (button === undefined) throw new Error(`button ${label} missing: ${row.innerHTML}`);
      return button as unknown as HTMLButtonElement;
    }

    function click(target: Element): void {
      target.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    }

    async function mountRows(items: readonly AgentHistoryItem[]): Promise<void> {
      await act(async () => {
        root.render(
          createElement(consoleHistoryList.ConsoleAgentHistoryList, {
            items,
            showToolCalls: true,
            showSystem: true,
            onLoadFullOutput: async (): Promise<unknown> => undefined,
          })
        );
      });
    }

    test('open rows show the family bar with facts and one Raw toggle at the far right', async () => {
      await mountRows([openToolItem({ toolUseId: 't-bar', outcome: 'failed', exitCode: 2 })]);
      const row = toolRow('t-bar');
      const region = row.querySelector('summary + div');
      if (region === null) throw new Error('expanded region missing');
      const bar = region.querySelector('div');
      if (bar === null) throw new Error('family bar missing');
      const barText = bar.querySelector('span');
      expect(barText?.className).toContain('whitespace-nowrap');
      expect(barText?.className).toContain('text-ellipsis');
      expect(barText?.className).toContain('min-w-0');
      expect(barText?.textContent).toBe('file · exit 2 · truncated · 1.5s');
      const raw = rawButton(row);
      expect(raw.getAttribute('aria-expanded')).toBe('false');
      expect(raw.textContent).toContain('Raw');
      expect(raw.className).toContain('flex-none');
      expect(raw.className).toContain('min-h-[24px]');
      expect(raw.className).toContain('focus-visible:outline-accent-bright');
      expect(bar.lastElementChild).toBe(raw);
      expect(row.querySelectorAll('button[aria-expanded]')).toHaveLength(1);
      // Keyboard order: the Raw toggle is the next tabbable control after the
      // row summary — Raw stays far right without leaving the row's tab flow.
      const tabbables = Array.from(row.querySelectorAll('summary, button'));
      expect(tabbables[0]).toBe(rowSummary(row));
      expect(tabbables[1]).toBe(raw);
      // The body precedes the full-output control in reading and tab order.
      expect(region.textContent).toContain('truncated-output');
    });

    test('toolBodyPresentation resolves lazily: never for closed or Raw-open rows, once for the body, once for full output', async () => {
      const spy = spyOn(toolPresentation, 'toolBodyPresentation');
      try {
        const onLoadFullOutput = async (): Promise<unknown> => 'FULL TEXT';
        await act(async () => {
          root.render(
            createElement(consoleHistoryList.ConsoleAgentHistoryList, {
              items: [toolItem({ toolUseId: 't-lazy' })],
              showToolCalls: true,
              showSystem: true,
              onLoadFullOutput,
            })
          );
        });
        const row = toolRow('t-lazy');
        // Collapsed rows never resolve a body.
        expect(row.open).toBe(false);
        expect(spy.mock.calls).toHaveLength(0);

        await act(async () => {
          click(rowSummary(row));
        });
        expect(row.open).toBe(true);
        expect(spy.mock.calls).toHaveLength(1);
        const firstInput = spy.mock.calls[0]?.[0];
        expect(firstInput?.name).toBe('Read');
        expect(firstInput?.output).toBe('truncated-output');
        expect(spy.mock.calls[0]?.[1]).toBe('file');

        // Raw open unmounts the body without a resolve; loading full output
        // while Raw is open still does not resolve.
        await act(async () => {
          click(rawButton(row));
        });
        expect(rawButton(row).getAttribute('aria-expanded')).toBe('true');
        expect(spy.mock.calls).toHaveLength(1);
        await act(async () => {
          click(rowButton(row, 'View full output'));
        });
        expect(spy.mock.calls).toHaveLength(1);
        // Raw stays open over the swap; the refreshed payload lands in the pre.
        expect(row.querySelector('.tool-family-body')).toBeNull();
        expect(rawPanel(row).textContent).toContain('FULL TEXT');

        // Closing Raw remounts the body and resolves exactly once with the
        // fetched output — the swap kept the fresh payload.
        await act(async () => {
          click(rawButton(row));
        });
        expect(spy.mock.calls).toHaveLength(2);
        expect(spy.mock.calls[1]?.[0].output).toBe('FULL TEXT');
        expect(bodyBox(row).textContent).toContain('FULL TEXT');
      } finally {
        spy.mockRestore();
      }
    });

    test('Raw swaps the family body for the exact sent payload and back', async () => {
      await mountRows([openToolItem({ toolUseId: 't-raw' })]);
      const row = toolRow('t-raw');
      const raw = rawButton(row);
      // Body first: the file arm shows path + preview, not serialized JSON.
      expect(bodyBox(row).textContent).toContain('truncated-output');
      expect(bodyBox(row).textContent).not.toContain('"name"');

      await act(async () => {
        click(raw);
      });
      expect(raw.getAttribute('aria-expanded')).toBe('true');
      expect(raw.textContent).toContain('▾');
      // The family body unmounts; the exact payload lives in the Raw panel.
      expect(row.querySelector('.tool-family-body')).toBeNull();
      const payload = rawPanel(row).textContent ?? '';
      expect(payload).toContain('"name": "Read"');
      expect(payload).toContain('"input"');
      expect(payload).toContain('"output"');
      expect(payload).toContain('"path": "a.ts"');

      await act(async () => {
        click(raw);
      });
      expect(raw.getAttribute('aria-expanded')).toBe('false');
      expect(bodyBox(row).textContent).toContain('truncated-output');
      expect(bodyBox(row).textContent).not.toContain('"name"');
    });

    test('terminal body: $ prompt, command, output; failed rows append a bold FAILED word', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-sh',
          name: 'Bash',
          input: { command: 'npm test' },
          output: 'boom',
          outcome: 'failed',
          exitCode: 1,
        }),
        openToolItem({
          toolUseId: 't-run',
          name: 'Bash',
          input: { command: 'npm test' },
          output: undefined,
          outcome: 'running',
          outputState: 'missing',
          canLoadFullOutput: false,
          durationMs: null,
        }),
        openToolItem({
          toolUseId: 't-quiet',
          name: 'Bash',
          input: { command: 'true' },
          output: undefined,
          outputState: 'full',
          canLoadFullOutput: false,
          durationMs: null,
        }),
        openToolItem({
          toolUseId: 't-corrupt',
          name: 'Bash',
          input: { command: 'x' },
          output: '{"unterminated',
          canLoadFullOutput: false,
        }),
      ]);
      const failed = bodyBox(toolRow('t-sh'));
      expect(failed.textContent).toContain('$');
      expect(failed.textContent).toContain('npm test');
      expect(failed.textContent).toContain('boom');
      expect(failed.textContent).toContain('FAILED');
      const failedWord = Array.from(failed.querySelectorAll('span')).find(
        span => span.textContent?.trim() === 'FAILED'
      );
      expect(failedWord?.className).toContain('font-bold');
      expect(bodyBox(toolRow('t-run')).textContent).toContain('running — no output yet');
      expect(bodyBox(toolRow('t-quiet')).textContent).toContain('no output');
      expect(bodyBox(toolRow('t-corrupt')).textContent).toContain('output unreadable — open Raw');
    });

    test('file body: node-command path then preview; no-preview and unreadable states', async () => {
      await mountRows([
        openToolItem({ toolUseId: 't-file', input: { path: 'a.ts' }, output: 'chunk' }),
        openToolItem({
          toolUseId: 't-nopreview',
          input: { path: 'b.ts' },
          output: undefined,
          outputState: 'missing',
          canLoadFullOutput: false,
        }),
        openToolItem({
          toolUseId: 't-unread',
          input: { path: 'c.ts' },
          output: '{"unterminated',
          canLoadFullOutput: false,
        }),
      ]);
      const file = bodyBox(toolRow('t-file'));
      const pathEl = file.querySelector('.text-node-command');
      expect(pathEl?.textContent).toBe('a.ts');
      expect(file.textContent).toContain('chunk');
      const none = bodyBox(toolRow('t-nopreview'));
      expect(none.querySelector('.text-node-command')?.textContent).toBe('b.ts');
      expect(none.textContent).toContain('no preview');
      expect(bodyBox(toolRow('t-unread')).textContent).toContain('output unreadable — open Raw');
    });

    describe('file-edit diff bodies', () => {
      const BACKOFF_BEFORE =
        '  pub fn backoff(attempt: u32) -> Duration {\n' +
        '     let secs = 2u64.pow(attempt).min(31);\n' +
        '     Duration::from_secs(secs + 1)\n' +
        '  }';
      const BACKOFF_AFTER =
        '  pub fn backoff(attempt: u32) -> Duration {\n' +
        '     let secs = 2u64.pow(attempt).min(30);\n' +
        '     Duration::from_secs(secs)\n' +
        '  }';
      const EDIT_INPUT: Record<string, unknown> = {
        file_path: 'src/auto_retry.rs',
        old_string: BACKOFF_BEFORE,
        new_string: BACKOFF_AFTER,
        replace_all: false,
      };

      function editItem(
        toolUseId: string,
        overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>> = {}
      ): Extract<AgentHistoryItem, { kind: 'tool' }> {
        return openToolItem({
          toolUseId,
          name: 'Edit',
          input: EDIT_INPUT,
          output: 'File updated successfully',
          outputState: 'full',
          canLoadFullOutput: false,
          ...overrides,
        });
      }

      function diffTable(row: Element): Element {
        const table = row.querySelector('.tool-diff');
        if (table === null) throw new Error(`diff table missing: ${row.innerHTML}`);
        return table;
      }

      test('changed pair: path first, unified table in jsdiff order, markers, snippet numbers', async () => {
        await mountRows([editItem('t-edit')]);
        const row = toolRow('t-edit');
        const body = bodyBox(row);
        // The path is the first block child; the table follows it.
        const path = body.querySelector('.text-node-command');
        expect(path?.textContent).toBe('src/auto_retry.rs');
        expect(path).toBe(body.firstElementChild);
        const table = diffTable(row);
        expect(table.previousElementSibling).toBe(path);
        expect(table.className).toContain('diff-unified');
        // jsdiff order for this fixture: context, both deletes, both inserts, context.
        const codes = Array.from(table.querySelectorAll('.diff-code')).map(td => td.className);
        expect(codes).toEqual([
          'diff-code diff-code-normal',
          'diff-code diff-code-delete',
          'diff-code diff-code-delete',
          'diff-code diff-code-insert',
          'diff-code diff-code-insert',
          'diff-code diff-code-normal',
        ]);
        // The +/− markers are the required non-color cue, exposed to AT.
        expect(
          Array.from(table.querySelectorAll('.tool-diff-marker')).map(el => el.textContent)
        ).toEqual(['', '−', '−', '+', '+', '']);
        expect(
          Array.from(table.querySelectorAll('.tool-diff-line-number')).map(el => el.textContent)
        ).toEqual(['1', '2', '3', '2', '3', '4']);
        // Only the old-side gutter cell carries content; the duplicated
        // new-side cell stays empty and is hidden by scoped CSS.
        for (const tr of Array.from(table.querySelectorAll('.diff-line'))) {
          expect(tr.children[0]?.querySelector('.tool-diff-line-number')).not.toBeNull();
          expect(tr.children[1]?.textContent).toBe('');
        }
        // One hunk needs no @@ decoration row.
        expect(table.querySelector('tbody.diff-decoration')).toBeNull();
        // Success prose stays behind Raw; the sent payload never serializes.
        expect(body.textContent).not.toContain('File updated successfully');
        expect(body.textContent).not.toContain('old_string');
      });

      test('summary carries +2/−2 badges; the bar shows hunk and replace_all facts without counts', async () => {
        await mountRows([editItem('t-edit')]);
        const row = toolRow('t-edit');
        const summaryText = rowSummary(row).textContent ?? '';
        expect(summaryText).toContain('+2');
        expect(summaryText).toContain('−2');
        const bar = row.querySelector('summary + div div span');
        expect(bar?.textContent).toBe('file · 1 hunk · replace_all: false · 1.5s');
        expect(bar?.textContent).not.toContain('+2');
        expect(bar?.textContent).not.toContain('−2');
      });

      test('a failed row keeps the table and adds its normalized output in a second inset box', async () => {
        await mountRows([
          editItem('t-edit-fail', {
            output: 'edit failed: permission denied',
            outcome: 'failed',
            exitCode: 1,
          }),
        ]);
        const row = toolRow('t-edit-fail');
        const boxes = row.querySelectorAll('.tool-family-body');
        expect(boxes).toHaveLength(2);
        expect(boxes[0]?.querySelector('.tool-diff')).not.toBeNull();
        expect(boxes[0]?.textContent).not.toContain('permission denied');
        expect(boxes[1]?.textContent).toContain('edit failed: permission denied');
        expect(boxes[1]?.className).toContain('mt-1.5');
      });

      test('later hunks get a text-only @@ decoration; the first hunk has none', async () => {
        const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
        const after = Array.from({ length: 20 }, (_, index) =>
          index === 4 || index === 15 ? `line ${index + 1} changed` : `line ${index + 1}`
        ).join('\n');
        await mountRows([
          openToolItem({
            toolUseId: 't-two',
            name: 'Edit',
            input: { file_path: 'src/two.ts', old_string: before, new_string: after },
            output: 'done',
            outputState: 'full',
            canLoadFullOutput: false,
          }),
        ]);
        const row = toolRow('t-two');
        const table = diffTable(row);
        const decorations = table.querySelectorAll('tbody.diff-decoration');
        expect(decorations).toHaveLength(1);
        const decoration = decorations[0];
        expect(decoration?.textContent).toBe('@@ -12,9 +12,9 @@');
        const cell = decoration?.querySelector('td');
        expect(cell?.getAttribute('colspan')).toBe('3');
        // It sits between hunk one's last line and hunk two's first line.
        expect(decoration?.previousElementSibling?.textContent).toContain('line 9');
        expect(decoration?.nextElementSibling?.textContent).toContain('line 12');
        const bar = row.querySelector('summary + div div span');
        expect(bar?.textContent).toBe('file · 2 hunks · 1.5s');
      });

      test('identical sides render the no-changes note with no table or diff badges', async () => {
        const same = 'same content\nsecond line';
        await mountRows([
          openToolItem({
            toolUseId: 't-same',
            name: 'Edit',
            input: { file_path: 'same.ts', old_string: same, new_string: same },
            output: 'done',
            outputState: 'full',
            canLoadFullOutput: false,
          }),
        ]);
        const row = toolRow('t-same');
        const body = bodyBox(row);
        expect(body.querySelector('.text-node-command')?.textContent).toBe('same.ts');
        expect(body.textContent).toContain('no changes');
        expect(row.querySelector('.tool-diff')).toBeNull();
        const summaryText = rowSummary(row).textContent ?? '';
        expect(summaryText).not.toContain('+');
        expect(summaryText).not.toContain('−');
        const bar = row.querySelector('summary + div div span');
        expect(bar?.textContent).toBe('file · no changes · 1.5s');
      });

      test('one-sided, no-input, and refused pairs keep the path-plus-preview fallback', async () => {
        await mountRows([
          openToolItem({
            toolUseId: 't-write',
            name: 'Write',
            input: { file_path: 'w.ts', content: 'brand new file' },
            output: 'written',
          }),
          openToolItem({
            toolUseId: 't-naked',
            name: 'Edit',
            input: {},
            output: 'done',
            outputState: 'full',
            canLoadFullOutput: false,
          }),
          openToolItem({
            toolUseId: 't-huge',
            name: 'Edit',
            input: { file_path: 'big.ts', old_string: 'x'.repeat(70_000), new_string: 'y' },
            output: 'done',
          }),
        ]);
        for (const [id, pathText, preview] of [
          ['t-write', 'w.ts', 'written'],
          ['t-naked', 'Edit', 'done'],
          ['t-huge', 'big.ts', 'done'],
        ] as const) {
          const row = toolRow(id);
          const body = bodyBox(row);
          expect(body.querySelector('.text-node-command')?.textContent).toBe(pathText);
          expect(body.textContent).toContain(preview);
          expect(row.querySelector('.tool-diff')).toBeNull();
          const summaryText = rowSummary(row).textContent ?? '';
          expect(summaryText).not.toContain('+');
          expect(summaryText).not.toContain('−');
          const bar = row.querySelector('summary + div div span');
          expect(bar?.textContent).not.toContain('hunk');
          expect(bar?.textContent).not.toContain('no changes');
        }
      });

      test('control characters render as bounded escapes, one DOM row per change', async () => {
        await mountRows([
          openToolItem({
            toolUseId: 't-ctl',
            name: 'Edit',
            input: {
              file_path: 'ctl.ts',
              old_string: 'plain',
              new_string: 'mark\u{2028}\u{001B}[31mred',
            },
            output: 'done',
            outputState: 'full',
            canLoadFullOutput: false,
          }),
        ]);
        const row = toolRow('t-ctl');
        const table = diffTable(row);
        expect(table.querySelectorAll('.diff-line')).toHaveLength(2);
        const insert = table.querySelector('.diff-code-insert');
        expect(insert?.textContent).toBe('mark\\u{2028}red');
        expect(bodyBox(row).textContent).not.toContain('\u{2028}');
        expect(bodyBox(row).textContent).not.toContain('\u{001B}');
      });

      test('Raw swaps the diff table for the exact payload and back', async () => {
        await mountRows([editItem('t-edit-raw')]);
        const row = toolRow('t-edit-raw');
        expect(bodyBox(row).querySelector('.tool-diff')).not.toBeNull();
        const raw = rawButton(row);
        await act(async () => {
          click(raw);
        });
        expect(raw.getAttribute('aria-expanded')).toBe('true');
        expect(row.querySelector('.tool-diff')).toBeNull();
        expect(row.querySelector('.tool-family-body')).toBeNull();
        expect(rawPanel(row).textContent).toBe(
          JSON.stringify(
            { name: 'Edit', input: EDIT_INPUT, output: 'File updated successfully' },
            null,
            2
          )
        );
        await act(async () => {
          click(raw);
        });
        expect(raw.getAttribute('aria-expanded')).toBe('false');
        expect(bodyBox(row).querySelector('.tool-diff')).not.toBeNull();
      });

      test('the diff contributes no tab stop: summary → Raw → existing controls', async () => {
        await mountRows([
          editItem('t-edit-keys', {
            outputState: 'truncated',
            canLoadFullOutput: true,
          }),
        ]);
        const row = toolRow('t-edit-keys');
        expect(row.querySelector('.tool-diff')).not.toBeNull();
        const focusables = Array.from(row.querySelectorAll('summary, button, [tabindex]'));
        expect(focusables[0]).toBe(rowSummary(row));
        expect(focusables[1]).toBe(rawButton(row));
        expect(focusables[2]).toBe(rowButton(row, 'View full output'));
        expect(
          row.querySelector('.tool-diff button, .tool-diff a, .tool-diff [tabindex]')
        ).toBeNull();
        expect(focusables).toHaveLength(3);
      });
    });

    test('matches body: pattern + scope header, path:line rows, and text-only lines', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-grep',
          name: 'Grep',
          input: { pattern: 'fn x', path: 'crates/', output_mode: 'content' },
          output: 'src/a.ts:12: hit\nplain tail',
        }),
      ]);
      const body = bodyBox(toolRow('t-grep'));
      expect(body.textContent).toContain('fn x');
      expect(body.textContent).toContain(' in crates/');
      expect(body.querySelector('.text-node-command')?.textContent).toBe('src/a.ts');
      expect(body.textContent).toContain(':12');
      expect(body.textContent).toContain('hit');
      expect(body.textContent).toContain('plain tail');
    });

    test('paths body: one node-command path per line for grep files_with_matches and glob', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-paths',
          name: 'Grep',
          input: { pattern: 'x', output_mode: 'files_with_matches' },
          output: { filenames: ['src/a.ts', 'src/b.ts'] },
        }),
        openToolItem({
          toolUseId: 't-glob',
          name: 'glob',
          input: { pattern: '**/*.rs' },
          output: 'src/a.rs\nsrc/b.rs',
        }),
      ]);
      const paths = bodyBox(toolRow('t-paths'));
      expect(paths.textContent).toContain('src/a.ts');
      expect(paths.textContent).toContain('src/b.ts');
      // No line-number parsing on a files_with_matches body.
      expect(paths.textContent).not.toContain(':');
      const glob = bodyBox(toolRow('t-glob'));
      expect(glob.textContent).toContain('src/a.rs');
      expect(glob.textContent).toContain('src/b.rs');
    });

    test('list tails: exact remainder is "+n more", an unknowable tail is "more results omitted"', async () => {
      const longList = Array.from({ length: 502 }, (_, i) => `f${i}.rs`).join('\n');
      await mountRows([
        openToolItem({
          toolUseId: 't-more',
          name: 'glob',
          input: { pattern: '**/*.rs' },
          output: longList,
        }),
        openToolItem({
          toolUseId: 't-omitted',
          name: 'glob',
          input: { pattern: '**/*.rs' },
          output: 'x'.repeat(70_000),
        }),
      ]);
      expect(bodyBox(toolRow('t-more')).textContent).toContain('+2 more');
      const omitted = bodyBox(toolRow('t-omitted'));
      expect(omitted.textContent).toContain('more results omitted');
      expect(omitted.textContent).not.toContain('more\n');
    });

    test('code body: fenced source highlights with the language, result in a second box', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-code',
          name: 'eval',
          input: { code: 'const answer = 42;', language: 'rust' },
          output: 'ok',
        }),
      ]);
      const row = toolRow('t-code');
      const boxes = row.querySelectorAll('.tool-family-body');
      expect(boxes).toHaveLength(2);
      const source = boxes[0];
      const result = boxes[1];
      if (source === undefined || result === undefined) throw new Error('body boxes missing');
      expect(source.querySelector('code')?.className).toContain('language-rust');
      expect(source.innerHTML).toContain('hljs-keyword');
      expect(result.className).toContain('mt-1.5');
      expect(result.textContent).toBe('ok');
    });

    test('code body: unknown language renders plain source and a hostile language stays inert', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-unknown',
          name: 'eval',
          input: { code: 'select 1', language: 'madeuplang' },
          output: undefined,
          outputState: 'missing',
          canLoadFullOutput: false,
        }),
        openToolItem({
          toolUseId: 't-hostile',
          name: 'eval',
          input: { code: 'x', language: 'rust" onload="alert(1)' },
          output: undefined,
          outputState: 'missing',
          canLoadFullOutput: false,
        }),
      ]);
      const unknown = bodyBox(toolRow('t-unknown'));
      expect(unknown.textContent).toContain('select 1');
      expect(unknown.innerHTML).not.toContain('hljs-keyword');
      const hostile = toolRow('t-hostile');
      expect(bodyBox(hostile).textContent).toContain('x');
      // The hostile value can appear only as inert text — never a language
      // class or an element attribute.
      for (const el of Array.from(hostile.querySelectorAll('*'))) {
        expect(el.getAttribute('onload')).toBeNull();
      }
      expect(hostile.querySelector('code[class*="language-"]')).toBeNull();
    });

    test('code body: a fence inside the source can never close the fence early', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-fence',
          name: 'eval',
          input: { code: 'const doc = "```";', language: 'js' },
          output: undefined,
          outputState: 'missing',
          canLoadFullOutput: false,
        }),
      ]);
      const body = bodyBox(toolRow('t-fence'));
      // The inner run survives as literal text inside the highlighted block.
      expect(body.textContent).toContain('```');
      expect(body.textContent).toContain('doc');
    });

    test('web body: inert url header, title, and stored markdown — no anchors, no fetches', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-web',
          name: 'WebFetch',
          input: { url: 'https://doc.io/x' },
          output: { result: 'Read **the** docs', url: 'https://doc.io/x', title: 'Doc Page' },
        }),
        openToolItem({
          toolUseId: 't-search',
          name: 'WebSearch',
          input: { query: 'x' },
          output: { results: [{ title: 'Hit', url: 'https://hit.io' }] },
        }),
      ]);
      const web = bodyBox(toolRow('t-web'));
      expect(web.querySelector('.text-node-command')?.textContent).toBe('https://doc.io/x');
      expect(web.textContent).toContain('Doc Page');
      expect(web.querySelector('strong')?.textContent).toBe('the');
      expect(web.querySelector('a')).toBeNull();
      const search = bodyBox(toolRow('t-search'));
      // Result markdown renders the title plus a parenthesized destination, inert.
      expect(search.textContent).toContain('Hit');
      expect(search.textContent).toContain('(https://hit.io)');
      expect(search.querySelector('a')).toBeNull();
    });

    test('stored markdown attacks render inert: no anchors, images, raw HTML, or scripts', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-attack',
          name: 'WebFetch',
          input: { url: 'https://x.io' },
          output: {
            result:
              '[click](https://e.io) ![pic](https://e.io/p.png) https://auto.io ' +
              '[x](javascript:alert(1)) <script>alert(1)</script> <b onmouseover="hack()">hi</b>',
            url: 'https://x.io',
          },
        }),
      ]);
      const body = bodyBox(toolRow('t-attack'));
      expect(body.querySelector('a')).toBeNull();
      expect(body.querySelector('img')).toBeNull();
      expect(body.querySelector('script')).toBeNull();
      // The hostile markup survives only as text — no element carries it.
      expect(body.querySelector('b')).toBeNull();
      for (const el of Array.from(body.querySelectorAll('*'))) {
        expect(el.getAttribute('onmouseover')).toBeNull();
      }
      expect(body.textContent).not.toContain('javascript:');
      // Link label plus parenthesized destination; bare autolinks dedupe.
      expect(body.textContent).toContain('click');
      expect(body.textContent).toContain('(https://e.io)');
      expect(body.textContent).toContain('pic');
      expect(body.textContent).toContain('[image omitted]');
      expect(body.textContent?.match(/https:\/\/auto\.io/g)?.length).toBe(1);
      // Raw HTML survives only as escaped text — never as live markup.
      expect(body.textContent).toContain('<script>alert(1)</script>');
      expect(body.textContent).toContain('<b onmouseover="hack()">hi</b>');
    });

    test('generic body: at most three key:value rows, {…}/[n] markers, sent name in the bar', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-gen',
          name: 'get_command_or_subagent_output',
          input: { command_id: 'cmd_7f3a', tags: ['a', 'b'], filters: { x: 1 }, extra: 'dropped' },
          output: 'plain note',
        }),
      ]);
      const row = toolRow('t-gen');
      // The 30-char name cannot ride the chip, so the body bar carries it whole.
      expect(row.textContent).toContain('generic · get_command_or_subagent_output');
      const body = bodyBox(row);
      expect(body.querySelectorAll('.w-\\[11ch\\]')).toHaveLength(3);
      expect(body.textContent).toContain('cmd_7f3a');
      expect(body.textContent).toContain('[2]');
      expect(body.textContent).toContain('{…}');
      expect(body.textContent).not.toContain('dropped');
      // No serialized-object syntax survives into the generic body.
      expect(body.innerHTML).not.toContain('&quot;');
      expect(body.textContent).toContain('plain note');
    });

    test('todo and task rows open to the bar and Raw toggle with no body box', async () => {
      await mountRows([
        openToolItem({
          toolUseId: 't-todo',
          name: 'todo',
          input: { todos: [{ content: 'x' }] },
          canLoadFullOutput: false,
        }),
        openToolItem({
          toolUseId: 't-task',
          name: 'Task',
          input: { description: 'd', prompt: 'p' },
          canLoadFullOutput: false,
        }),
      ]);
      for (const id of ['t-todo', 't-task']) {
        const row = toolRow(id);
        expect(row.querySelector('.tool-family-body')).toBeNull();
        expect(rawButton(row).getAttribute('aria-expanded')).toBe('false');
        expect(rawButton(row).textContent).toContain('Raw');
      }
    });
  });

  describe('Console occurrence headings', () => {
    type Loader = Parameters<typeof consoleNodeRoom.ConsoleNodeRoom>[0]['loadMessages'];

    const NOW_MS = new Date(CREATED_AT).getTime() + 30_000;
    const OCC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const OCC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    function executed(
      occurrenceId: string,
      overrides: Partial<TranscriptExecution> = {}
    ): TranscriptExecution {
      return {
        occurrence_id: occurrenceId,
        attempt_id: `${occurrenceId}-attempt-1`,
        ...overrides,
      };
    }

    function textMsg(seq: number, text: string, exec?: TranscriptExecution): WorkflowNodeMessage {
      return {
        id: `text-${seq}`,
        seq,
        kind: 'text',
        payload: { text },
        ...(exec === undefined ? {} : { metadata: { execution: exec } }),
        created_at: CREATED_AT,
      };
    }

    function statusMsg(
      seq: number,
      state: string,
      detail: string | null = null,
      exec?: TranscriptExecution
    ): WorkflowNodeMessage {
      return {
        id: `status-${seq}`,
        seq,
        kind: 'status',
        payload: detail === null ? { state } : { state, detail },
        ...(exec === undefined ? {} : { metadata: { execution: exec } }),
        created_at: CREATED_AT,
      };
    }

    function toolCall(
      toolUseId: string,
      seq: number,
      exec?: TranscriptExecution
    ): WorkflowNodeMessage {
      return {
        id: `call-${toolUseId}`,
        seq,
        kind: 'tool',
        payload: { name: 'Read', id: toolUseId, input: { path: 'a.ts' } },
        metadata: { tool_phase: 'call', ...(exec === undefined ? {} : { execution: exec }) },
        created_at: CREATED_AT,
      };
    }

    function toolResult(
      toolUseId: string,
      seq: number,
      exec?: TranscriptExecution
    ): WorkflowNodeMessage {
      return {
        id: `result-${toolUseId}`,
        seq,
        kind: 'tool',
        payload: { name: 'Read', id: toolUseId, input: { path: 'a.ts' }, output: 'chunk' },
        metadata: {
          tool_phase: 'result',
          outcome: 'success',
          ...(exec === undefined ? {} : { execution: exec }),
        },
        created_at: CREATED_AT,
      };
    }

    function historyItems(rows: readonly WorkflowNodeMessage[]): AgentHistoryItem[] {
      return agentHistory.buildAgentHistory({ rows, events: [], nodeId: 'review', nowMs: NOW_MS })
        .items;
    }

    function mountGroupedList(
      items: readonly AgentHistoryItem[],
      options: {
        showToolCalls?: boolean;
        showSystem?: boolean;
        unknownScope?: boolean;
        renderAfterItem?: ConsoleAgentHistoryListProps['renderAfterItem'];
        renderAtEnd?: ConsoleAgentHistoryListProps['renderAtEnd'];
      } = {}
    ): void {
      root.render(
        createElement(consoleHistoryList.ConsoleAgentHistoryList, {
          items,
          showToolCalls: options.showToolCalls ?? true,
          showSystem: options.showSystem ?? true,
          onLoadFullOutput: async (): Promise<unknown> => undefined,
          occurrenceGrouping: groupByOccurrence(items),
          headingIdPrefix: 'test-room-',
          unknownScope: options.unknownScope ?? false,
          renderAfterItem: options.renderAfterItem,
          renderAtEnd: options.renderAtEnd,
        })
      );
    }

    function headings(): Element[] {
      return Array.from(host.querySelectorAll('h3[id]'));
    }

    function headingTexts(): string[] {
      return headings().map(el => el.textContent ?? '');
    }

    test('renders no occurrence headings and no navigator for zero or one occurrence', async () => {
      const unscoped = historyItems([textMsg(1, 'solo'), statusMsg(2, 'completed')]);
      await act(async () => {
        mountGroupedList(unscoped);
      });
      expect(headings()).toHaveLength(0);
      expect(host.querySelectorAll('select')).toHaveLength(0);

      const single = historyItems([
        textMsg(1, 'solo', executed(OCC_A)),
        statusMsg(2, 'completed', null, executed(OCC_A)),
      ]);
      await act(async () => {
        mountGroupedList(single);
      });
      expect(headings()).toHaveLength(0);
      expect(host.querySelectorAll('select')).toHaveLength(0);
    });

    test('renders one h3 heading per occurrence in group order with the exact core labels', async () => {
      const items = historyItems([
        statusMsg(1, 'started', null, executed(OCC_A, { retry_epoch: 0 })),
        textMsg(2, 'first-run', executed(OCC_A, { retry_epoch: 0 })),
        textMsg(3, 'second-run', executed(OCC_B, { retry_epoch: 1 })),
        statusMsg(4, 'failed', null, executed(OCC_B, { retry_epoch: 1 })),
      ]);
      await act(async () => {
        mountGroupedList(items);
      });
      expect(headingTexts()).toEqual(['Run 1', 'Run 2 · retry · failed']);
      const first = headings()[0];
      const second = headings()[1];
      expect(first?.getAttribute('tabindex')).toBe('-1');
      expect(first?.getAttribute('id')).toBe(`test-room-occ-${OCC_A}`);
      expect(second?.getAttribute('id')).toBe(`test-room-occ-${OCC_B}`);
      const className = first?.getAttribute('class') ?? '';
      expect(className).toContain('font-mono');
      expect(className).toContain('text-[10.5px]');
      expect(className).toContain('uppercase');
      expect(className).toContain('tracking-[0.08em]');
      expect(className).toContain('text-text-secondary');
      expect(className).toContain('mt-[10px]');
      expect(className).toContain('mb-[5px]');
      expect(first?.querySelector('span.bg-border')).not.toBeNull();
      const text = host.textContent ?? '';
      expect(text.indexOf('Run 1')).toBeLessThan(text.indexOf('first-run'));
      expect(text.indexOf('first-run')).toBeLessThan(text.indexOf('Run 2'));
      expect(text.indexOf('Run 2')).toBeLessThan(text.indexOf('second-run'));
    });

    test('disambiguates colliding base labels into distinct B4-qualified headings', async () => {
      const routed = historyItems([
        textMsg(1, 'route one', executed(OCC_A, { retry_epoch: 0, route_activation_seq: 1 })),
        textMsg(2, 'route two', executed(OCC_B, { retry_epoch: 0, route_activation_seq: 2 })),
      ]);
      await act(async () => {
        mountGroupedList(routed);
      });
      expect(headingTexts()).toEqual(['Run 1 #1', 'Run 1 #2']);

      const nested = historyItems([
        textMsg(
          1,
          'x',
          executed(OCC_A, {
            loop_ancestry: [
              { node_id: 'outer', iteration: 1 },
              { node_id: 'inner', iteration: 3 },
            ],
          })
        ),
        textMsg(
          2,
          'y',
          executed(OCC_B, {
            loop_ancestry: [
              { node_id: 'outer', iteration: 2 },
              { node_id: 'inner', iteration: 3 },
            ],
          })
        ),
      ]);
      await act(async () => {
        mountGroupedList(nested);
      });
      expect(headingTexts()).toEqual(['Iteration 1 › Iteration 3', 'Iteration 2 › Iteration 3']);
    });

    test('renders no extra heading for multiple attempts inside one occurrence', async () => {
      const items = historyItems([
        textMsg(1, 'attempt one', executed(OCC_A, { attempt_id: 'att-1', retry_epoch: 0 })),
        textMsg(2, 'attempt two', executed(OCC_A, { attempt_id: 'att-2', retry_epoch: 0 })),
        textMsg(3, 'other', executed(OCC_B, { retry_epoch: 1 })),
      ]);
      await act(async () => {
        mountGroupedList(items);
      });
      expect(headingTexts()).toEqual(['Run 1', 'Run 2 · retry']);
      const text = host.textContent ?? '';
      expect(text.indexOf('attempt one')).toBeLessThan(text.indexOf('attempt two'));
      expect(text.indexOf('attempt two')).toBeLessThan(text.indexOf('Run 2'));
    });

    test('renders a leading unscoped prefix once before the first heading', async () => {
      const items = historyItems([
        textMsg(1, 'before-scope'),
        textMsg(2, 'scoped-a', executed(OCC_A, { retry_epoch: 0 })),
        textMsg(3, 'scoped-b', executed(OCC_B, { retry_epoch: 1 })),
      ]);
      await act(async () => {
        mountGroupedList(items);
      });
      const text = host.textContent ?? '';
      expect(text.match(/before-scope/g)?.length).toBe(1);
      expect(text.indexOf('before-scope')).toBeLessThan(text.indexOf('Run 1'));
      expect(headingTexts()).toEqual(['Run 1', 'Run 2 · retry']);
    });

    test('renders non-contiguous occurrence rows once under one unique heading', async () => {
      const items = historyItems([
        textMsg(1, 'a-first', executed(OCC_A, { retry_epoch: 0 })),
        textMsg(2, 'b-first', executed(OCC_B, { retry_epoch: 1 })),
        textMsg(3, 'a-second', executed(OCC_A, { retry_epoch: 0 })),
      ]);
      await act(async () => {
        mountGroupedList(items);
      });
      expect(headingTexts()).toEqual(['Run 1', 'Run 2 · retry']);
      const text = host.textContent ?? '';
      expect(text.match(/a-second/g)?.length).toBe(1);
      expect(text.indexOf('a-first')).toBeLessThan(text.indexOf('a-second'));
      expect(text.indexOf('a-second')).toBeLessThan(text.indexOf('Run 2'));
      expect(text.indexOf('Run 2')).toBeLessThan(text.indexOf('b-first'));
    });

    test('keeps assistant, tool, and lifecycle order stable inside each group', async () => {
      const items = historyItems([
        textMsg(1, 'notes-a', executed(OCC_A)),
        toolCall('t1', 2, executed(OCC_A)),
        toolResult('t1', 3, executed(OCC_A)),
        statusMsg(4, 'completed', null, executed(OCC_A)),
        textMsg(5, 'notes-b', executed(OCC_B)),
        toolCall('t2', 6, executed(OCC_B)),
        toolResult('t2', 7, executed(OCC_B)),
        statusMsg(8, 'failed', null, executed(OCC_B)),
      ]);
      await act(async () => {
        mountGroupedList(items);
      });
      expect(headingTexts()).toEqual(['Run 1', 'Run 1 · occurrence 2 · failed']);
      const text = host.textContent ?? '';
      const firstRead = text.indexOf('Read');
      const secondRead = text.lastIndexOf('Read');
      const secondHeading = text.indexOf('Run 1 · occurrence 2');
      expect(text.indexOf('notes-a')).toBeLessThan(firstRead);
      expect(firstRead).toBeLessThan(text.indexOf('completed'));
      expect(text.indexOf('completed')).toBeLessThan(secondHeading);
      expect(secondHeading).toBeLessThan(text.indexOf('notes-b'));
      expect(text.indexOf('notes-b')).toBeLessThan(secondRead);
      expect(secondRead).toBeLessThan(text.lastIndexOf('failed'));
    });

    test('keeps renderAfterItem attached to its item and renderAtEnd after all groups', async () => {
      const items = historyItems([
        textMsg(1, 'alpha', executed(OCC_A)),
        toolCall('t1', 2, executed(OCC_B)),
        toolResult('t1', 3, executed(OCC_B)),
      ]);
      await act(async () => {
        mountGroupedList(items, {
          renderAfterItem: (item): string => `after-${item.id}`,
          renderAtEnd: 'end-extension',
        });
      });
      const text = host.textContent ?? '';
      const secondHeading = text.indexOf('Run 1 · occurrence 2');
      expect(text.indexOf('after-text-1')).toBeGreaterThan(text.indexOf('alpha'));
      expect(text.indexOf('after-text-1')).toBeLessThan(secondHeading);
      expect(text.indexOf('after-call-t1')).toBeGreaterThan(secondHeading);
      expect(text.indexOf('end-extension')).toBeGreaterThan(text.indexOf('after-call-t1'));
    });

    test('keeps the partial-page error, retry, and unknown-scope warning visible', async () => {
      const loadMessages: Loader = async (_runId, _nodeId, options) => {
        if ((options?.afterSeq ?? 0) === 0) {
          return {
            messages: [textMsg(1, 'alpha', executed(OCC_A)), textMsg(2, 'beta', executed(OCC_B))],
            hasMore: true,
            nextCursor: '2',
            highWatermark: 3,
          };
        }
        throw new Error('page-two-failed');
      };
      await act(async () => {
        renderRoom({
          loadMessages,
          selectedRow: row({
            nodeId: 'review',
            label: 'Review',
            status: 'running',
            unknownScope: true,
          }),
        });
      });
      await flushUntil('partial error', () =>
        (host.textContent ?? '').includes('Failed to load node transcript')
      );
      expect(headingTexts()).toEqual(['Run 1', 'Run 1 · occurrence 2']);
      expect(host.textContent).toContain('Execution scope was not recorded');
      expect(host.textContent).toContain('Retry');
      const text = host.textContent ?? '';
      expect(text.indexOf('Failed to load node transcript')).toBeGreaterThan(text.indexOf('beta'));
    });

    test('never lets item content text alter the headings', async () => {
      const items = historyItems([
        textMsg(1, 'Run 99', executed(OCC_A)),
        textMsg(2, 'Iteration 99', executed(OCC_B)),
      ]);
      await act(async () => {
        mountGroupedList(items);
      });
      expect(headingTexts()).toEqual(['Run 1', 'Run 1 · occurrence 2']);
    });

    test('hides a group only when no row or attached Ask remains renderable', async () => {
      // Occ A holds only a tool row and a lifecycle row — both hidden by the
      // Console filters and carrying no Ask — so the group leaves the display.
      const loadMessages: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          toolCall('tool-1', 1, executed(OCC_A)),
          toolResult('tool-1', 2, executed(OCC_A)),
          statusMsg(3, 'completed', null, executed(OCC_A)),
          textMsg(4, 'visible-b', executed(OCC_B)),
        ],
      });
      await act(async () => {
        renderRoom({ loadMessages, showToolCalls: false, showSystem: false });
      });
      await flushUntil('visible b', () => (host.textContent ?? '').includes('visible-b'));
      expect(headings()).toHaveLength(0);
      expect(host.querySelector('details[data-tool-id="tool-1"]')).toBeNull();
      expect(host.querySelectorAll('select')).toHaveLength(1);
    });

    test('keeps a hidden tool group visible through its attached Ask card', async () => {
      const loadMessages: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          toolCall('tool-1', 1, executed(OCC_A)),
          toolResult('tool-1', 2, executed(OCC_A)),
          textMsg(3, 'visible-b', executed(OCC_B)),
        ],
      });
      await act(async () => {
        renderRoom({
          loadMessages,
          showToolCalls: false,
          showSystem: false,
          pendingInteractions: [ask({ tool_use_id: 'tool-1' })],
        });
      });
      await flushUntil('ask', () => (host.textContent ?? '').includes('Ship it?'));
      expect(headingTexts()).toEqual(['Run 1', 'Run 1 · occurrence 2']);
      expect(host.querySelector('details[data-tool-id="tool-1"]')).toBeNull();
      const text = host.textContent ?? '';
      expect(text.indexOf('Run 1 · occurrence 2')).toBeLessThan(text.indexOf('visible-b'));
    });

    test('drops all occurrence headings when filters leave one displayable group', async () => {
      const loadMessages: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          toolCall('tool-1', 1, executed(OCC_A)),
          toolResult('tool-1', 2, executed(OCC_A)),
          statusMsg(3, 'completed', null, executed(OCC_A)),
          textMsg(4, 'visible-b', executed(OCC_B)),
        ],
      });
      await act(async () => {
        renderRoom({ loadMessages });
      });
      await flushUntil('both occurrences', () => headings().length === 2);
      expect(headingTexts()).toEqual(['Run 1', 'Run 1 · occurrence 2']);

      await act(async () => {
        renderRoom({ loadMessages, showToolCalls: false, showSystem: false });
      });
      await flushUntil(
        'filtered',
        () => host.querySelector('details[data-tool-id="tool-1"]') === null
      );
      expect(headings()).toHaveLength(0);
      expect(host.textContent).toContain('visible-b');
    });
  });

  describe('Console occurrence navigator', () => {
    type Loader = Parameters<typeof consoleNodeRoom.ConsoleNodeRoom>[0]['loadMessages'];

    const OCC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const OCC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const OCC_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    function executed(occurrenceId: string, retryEpoch = 0): TranscriptExecution {
      return {
        occurrence_id: occurrenceId,
        attempt_id: `${occurrenceId}-attempt-1`,
        retry_epoch: retryEpoch,
      };
    }

    function textMsg(seq: number, text: string, exec?: TranscriptExecution): WorkflowNodeMessage {
      return {
        id: `text-${seq}`,
        seq,
        kind: 'text',
        payload: { text },
        ...(exec === undefined ? {} : { metadata: { execution: exec } }),
        created_at: CREATED_AT,
      };
    }

    function statusMsg(
      seq: number,
      state: string,
      exec?: TranscriptExecution
    ): WorkflowNodeMessage {
      return {
        id: `status-${seq}`,
        seq,
        kind: 'status',
        payload: { state },
        ...(exec === undefined ? {} : { metadata: { execution: exec } }),
        created_at: CREATED_AT,
      };
    }

    function toolCall(
      toolUseId: string,
      seq: number,
      exec?: TranscriptExecution
    ): WorkflowNodeMessage {
      return {
        id: `call-${toolUseId}`,
        seq,
        kind: 'tool',
        payload: { name: 'Read', id: toolUseId, input: { path: 'a.ts' } },
        metadata: { tool_phase: 'call', ...(exec === undefined ? {} : { execution: exec }) },
        created_at: CREATED_AT,
      };
    }

    function toolResult(
      toolUseId: string,
      seq: number,
      exec?: TranscriptExecution
    ): WorkflowNodeMessage {
      return {
        id: `result-${toolUseId}`,
        seq,
        kind: 'tool',
        payload: { name: 'Read', id: toolUseId, input: { path: 'a.ts' }, output: 'chunk' },
        metadata: {
          tool_phase: 'result',
          outcome: 'success',
          ...(exec === undefined ? {} : { execution: exec }),
        },
        created_at: CREATED_AT,
      };
    }

    const TWO_OCCURRENCES: readonly WorkflowNodeMessage[] = [
      statusMsg(1, 'started', executed(OCC_A)),
      textMsg(2, 'run-one', executed(OCC_A)),
      statusMsg(3, 'completed', executed(OCC_A)),
      statusMsg(4, 'started', executed(OCC_B, 1)),
      textMsg(5, 'run-two', executed(OCC_B, 1)),
      statusMsg(6, 'completed', executed(OCC_B, 1)),
    ];

    function occHeadings(): HTMLElement[] {
      return Array.from(host.querySelectorAll<HTMLElement>('h3[id]'));
    }

    function occurrenceHeading(occurrenceId: string): HTMLElement {
      const heading = host.querySelector(`h3[id$="occ-${occurrenceId}"]`);
      if (!(heading instanceof HTMLElement)) throw new Error(`missing heading ${occurrenceId}`);
      return heading;
    }

    function navigatorSelect(): HTMLSelectElement | null {
      const label = Array.from(host.querySelectorAll('label')).find(
        el => (el.textContent ?? '') === 'Jump to'
      );
      const id = label?.getAttribute('for');
      if (id === null || id === undefined) return null;
      return host.querySelector(`select[id="${id}"]`);
    }

    function scrollerEl(): HTMLElement {
      const el = host.querySelector('[data-testid="console-node-room-scroll"]');
      if (!(el instanceof HTMLElement)) throw new Error('missing scroller');
      return el;
    }

    function stubRect(el: Element, top: number, bottom: number): void {
      (el as HTMLElement).getBoundingClientRect = (): DOMRect =>
        ({
          top,
          bottom,
          left: 0,
          right: 0,
          width: 0,
          height: bottom - top,
          x: 0,
          y: top,
          toJSON: (): Record<string, number> => ({}),
        }) as DOMRect;
    }

    function stubScroller(el: HTMLElement): void {
      stubRect(el, 0, 100);
      Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 600 });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: 100 });
    }

    async function commitSelect(select: HTMLSelectElement, value: string): Promise<void> {
      await act(async () => {
        select.value = value;
        select.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
      });
      await flush();
    }

    function jumpToLatestButton(): HTMLElement | undefined {
      return Array.from(host.querySelectorAll('button')).find(button =>
        (button.textContent ?? '').includes('Jump to latest')
      ) as HTMLElement | undefined;
    }

    async function mountTwoOccurrences(
      onScrollTopChange?: (scrollTop: number) => void
    ): Promise<[string, string][]> {
      const calls: [string, string][] = [];
      await act(async () => {
        renderRoom({
          loadMessages: async (runId, nodeId): Promise<WorkflowNodeMessagesResponse> => {
            calls.push([runId, nodeId]);
            return { messages: [...TWO_OCCURRENCES] };
          },
          onScrollTopChange,
        });
      });
      await flushUntil('occurrences', () => (host.textContent ?? '').includes('run-two'));
      return calls;
    }

    test('no navigator for zero or one displayable occurrence group', async () => {
      await act(async () => {
        renderRoom({
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [...FIXTURE],
          }),
        });
      });
      await flushUntil('unscoped fixture', () => (host.textContent ?? '').includes('first'));
      expect(navigatorSelect()).toBeNull();
      expect(occHeadings()).toHaveLength(0);

      await act(async () => {
        renderRoom({
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [
              textMsg(1, 'solo', executed(OCC_A)),
              statusMsg(2, 'completed', executed(OCC_A)),
            ],
          }),
        });
      });
      await flushUntil('single occurrence', () => (host.textContent ?? '').includes('solo'));
      expect(navigatorSelect()).toBeNull();
      // The header Execution filter select is untouched and still present.
      expect(host.querySelector('select[aria-label="Execution"]')).not.toBeNull();
    });

    test('renders a labelled select whose options mirror the headings verbatim', async () => {
      await mountTwoOccurrences();
      const select = navigatorSelect();
      if (select === null) throw new Error('missing navigator select');
      const options = Array.from(select.querySelectorAll('option'));
      expect(options.map(option => option.textContent)).toEqual([
        '2 occurrences',
        'Run 1',
        'Run 2 · retry',
      ]);
      expect(options[0]?.disabled).toBe(true);
      expect(options[0]?.getAttribute('value')).toBe('');
      expect(options[1]?.getAttribute('value')).toBe(OCC_A);
      expect(options[2]?.getAttribute('value')).toBe(OCC_B);
      expect(occHeadings().map(heading => heading.textContent)).toEqual(
        options.slice(1).map(option => option.textContent)
      );
      expect(select.value).toBe('');
      expect(select.getAttribute('aria-controls')).toBeNull();
      expect(select.getAttribute('tabindex')).toBeNull();
    });

    test('committed change scrolls, focuses the heading, holds the room, and issues no request', async () => {
      const positions: number[] = [];
      const calls = await mountTwoOccurrences((scrollTop: number): void => {
        positions.push(scrollTop);
      });
      const scroller = scrollerEl();
      const headingB = occurrenceHeading(OCC_B);
      stubScroller(scroller);
      stubRect(headingB, 150, 170);

      const select = navigatorSelect();
      if (select === null) throw new Error('missing navigator select');
      await commitSelect(select, OCC_B);

      expect(select.value).toBe(OCC_B);
      expect(select.getAttribute('aria-controls')).toBe(headingB.getAttribute('id'));
      expect(win.document.activeElement as unknown as Element | null).toBe(headingB);
      expect(scroller.scrollTop).toBe(150);
      expect(positions).toContain(150);
      expect(calls).toEqual([['run-1', 'review']]);
      expect(jumpToLatestButton()).not.toBeUndefined();
    });

    test('an already-visible target moves focus without scrolling and enters manual hold', async () => {
      await mountTwoOccurrences();
      const scroller = scrollerEl();
      const headingB = occurrenceHeading(OCC_B);
      stubScroller(scroller);
      scroller.scrollTop = 0;
      stubRect(headingB, 40, 60);

      const select = navigatorSelect();
      if (select === null) throw new Error('missing navigator select');
      await commitSelect(select, OCC_B);

      expect(win.document.activeElement as unknown as Element | null).toBe(headingB);
      expect(scroller.scrollTop).toBe(0);
      expect(jumpToLatestButton()?.className).toContain('ml-auto');
    });

    test('reader scroll after navigation stays manual; Jump to latest restores follow', async () => {
      await mountTwoOccurrences();
      const scroller = scrollerEl();
      stubScroller(scroller);
      stubRect(occurrenceHeading(OCC_B), 150, 170);
      const select = navigatorSelect();
      if (select === null) throw new Error('missing navigator select');
      await commitSelect(select, OCC_B);
      expect(jumpToLatestButton()).not.toBeUndefined();

      await act(async () => {
        scroller.scrollTop = 300;
        scroller.dispatchEvent(new win.Event('scroll', { bubbles: true }) as unknown as Event);
      });
      expect(scroller.scrollTop).toBe(300);
      expect(jumpToLatestButton()).not.toBeUndefined();

      const jump = jumpToLatestButton();
      if (jump === undefined) throw new Error('missing Jump to latest');
      await act(async () => {
        jump.click();
      });
      expect(scroller.scrollTop).toBe(500);
      expect(jumpToLatestButton()).toBeUndefined();
    });

    test('a Console filter removal resets the select and lands focus on it', async () => {
      const loadMessages: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          textMsg(1, 'visible-a', executed(OCC_A)),
          statusMsg(2, 'completed', executed(OCC_A)),
          toolCall('tool-1', 3, executed(OCC_B, 1)),
          toolResult('tool-1', 4, executed(OCC_B, 1)),
          textMsg(5, 'visible-c', executed(OCC_C, 2)),
          statusMsg(6, 'completed', executed(OCC_C, 2)),
        ],
      });
      await act(async () => {
        renderRoom({ loadMessages });
      });
      await flushUntil('three groups', () => occHeadings().length === 3);
      const scroller = scrollerEl();
      stubScroller(scroller);
      stubRect(occurrenceHeading(OCC_B), 150, 170);
      const select = navigatorSelect();
      if (select === null) throw new Error('missing navigator select');
      await commitSelect(select, OCC_B);
      expect(win.document.activeElement as unknown as Element | null).toBe(
        occurrenceHeading(OCC_B)
      );

      await act(async () => {
        renderRoom({ loadMessages, showToolCalls: false });
      });
      await flushUntil(
        'tool rows hidden',
        () => host.querySelector('details[data-tool-id="tool-1"]') === null
      );

      // Two displayable groups remain — the select stays and resets to placeholder.
      const after = navigatorSelect();
      if (after === null) throw new Error('navigator should still render');
      expect(after.value).toBe('');
      expect(after.getAttribute('aria-controls')).toBeNull();
      expect(win.document.activeElement as unknown as Element | null).toBe(after);
      expect(host.querySelector(`h3[id$="occ-${OCC_B}"]`)).toBeNull();
      expect(occHeadings()).toHaveLength(2);

      await act(async () => {
        renderRoom({ loadMessages, showToolCalls: true });
      });
      await flushUntil('tool rows restored', () => occHeadings().length === 3);
      expect(navigatorSelect()?.value).toBe('');
    });

    test('a filter removal down to one group drops the navigator and lands focus on the scroller', async () => {
      const loadMessages: Loader = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          textMsg(1, 'visible-a', executed(OCC_A)),
          statusMsg(2, 'completed', executed(OCC_A)),
          toolCall('tool-1', 3, executed(OCC_B, 1)),
          toolResult('tool-1', 4, executed(OCC_B, 1)),
        ],
      });
      await act(async () => {
        renderRoom({ loadMessages });
      });
      await flushUntil('two groups', () => occHeadings().length === 2);
      const scroller = scrollerEl();
      stubScroller(scroller);
      stubRect(occurrenceHeading(OCC_B), 150, 170);
      const select = navigatorSelect();
      if (select === null) throw new Error('missing navigator select');
      await commitSelect(select, OCC_B);
      expect(win.document.activeElement as unknown as Element | null).toBe(
        occurrenceHeading(OCC_B)
      );

      await act(async () => {
        renderRoom({ loadMessages, showToolCalls: false });
      });
      await flushUntil(
        'tool rows hidden',
        () => host.querySelector('details[data-tool-id="tool-1"]') === null
      );

      expect(navigatorSelect()).toBeNull();
      expect(occHeadings()).toHaveLength(0);
      expect(win.document.activeElement as unknown as Element | null).toBe(scroller);
    });

    test('a scope change drops the select to placeholder and keeps focus in the room', async () => {
      await mountTwoOccurrences();
      const scroller = scrollerEl();
      stubScroller(scroller);
      stubRect(occurrenceHeading(OCC_B), 150, 170);
      const select = navigatorSelect();
      if (select === null) throw new Error('missing navigator select');
      await commitSelect(select, OCC_B);
      expect(win.document.activeElement as unknown as Element | null).toBe(
        occurrenceHeading(OCC_B)
      );

      await act(async () => {
        renderRoom({
          scopeKey: 'scope-b',
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [
              statusMsg(1, 'started', executed(OCC_A)),
              textMsg(2, 'other-one', executed(OCC_A)),
              statusMsg(3, 'started', executed(OCC_C, 1)),
              textMsg(4, 'other-three', executed(OCC_C, 1)),
            ],
          }),
        });
      });
      await flushUntil('scope b', () => (host.textContent ?? '').includes('other-three'));

      const after = navigatorSelect();
      if (after === null) throw new Error('missing navigator select');
      expect(after.value).toBe('');
      const active: unknown = win.document.activeElement;
      expect(active === null || active === win.document.body).toBe(false);
    });

    test('removes occurrence navigation when switching to a non-agent room', async () => {
      await mountTwoOccurrences();
      expect(navigatorSelect()).not.toBeNull();

      await act(async () => {
        renderRoom({
          nodeId: 'setup',
          selectedRow: row({ nodeId: 'setup', label: 'Setup', status: 'completed' }),
          definitionNodes: [{ id: 'setup', bash: 'echo hi' }],
          nodeStates: [nodeState({ nodeId: 'setup', name: 'Setup', status: 'completed' })],
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        });
      });

      expect(navigatorSelect()).toBeNull();
      expect(occHeadings()).toHaveLength(0);
    });
  });

  describe('operator history rows', () => {
    let win: Window;
    let host: Element;
    let root: Root;

    beforeEach(() => {
      win = installHappyDom();
      const el = win.document.createElement('div');
      win.document.body.appendChild(el);
      host = el as unknown as Element;
      root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
    });

    afterEach(async () => {
      await act(async () => {
        root.unmount();
      });
      restoreHappyDom();
    });

    function operatorItem(
      overrides: Partial<Extract<AgentHistoryItem, { kind: 'operator' }>> = {}
    ): Extract<AgentHistoryItem, { kind: 'operator' }> {
      return {
        kind: 'operator',
        id: overrides.id ?? 'op-1',
        seq: overrides.seq ?? 1,
        role: 'operator',
        text: overrides.text ?? 'wrong suite — use -p archon-workflows',
        operatorUserId:
          overrides.operatorUserId === undefined
            ? 'abcdef12-3456-4789-a012-3456789abcde'
            : overrides.operatorUserId,
        operatorDisplayName:
          overrides.operatorDisplayName === undefined
            ? 'e2e-starter'
            : overrides.operatorDisplayName,
        messageId: overrides.messageId === undefined ? 'msg-1' : overrides.messageId,
        delivery: 'sent',
        execution: overrides.execution === undefined ? null : overrides.execution,
      };
    }

    function assistantItem(
      overrides: Partial<Extract<AgentHistoryItem, { kind: 'assistant' }>> = {}
    ): Extract<AgentHistoryItem, { kind: 'assistant' }> {
      return {
        kind: 'assistant',
        id: overrides.id ?? 'as-1',
        seq: overrides.seq ?? 2,
        role: 'assistant',
        text: overrides.text ?? 'Understood — switching suites.',
        execution: overrides.execution === undefined ? null : overrides.execution,
      };
    }

    function toolItemInterrupted(): Extract<AgentHistoryItem, { kind: 'tool' }> {
      return {
        kind: 'tool',
        id: 'tool-1',
        seq: 1,
        role: 'tool',
        name: 'Bash',
        toolUseId: 'bash-1',
        input: { cmd: 'cargo test' },
        output: null,
        outcome: 'interrupted',
        exitCode: null,
        durationMs: null,
        canLoadFullOutput: false,
        outputState: 'missing',
        presentation: toolPresentation.toolRowPresentation(
          { name: 'Bash', input: { cmd: 'cargo test' }, output: null },
          {
            outcome: 'interrupted',
            exitCode: null,
            durationMs: null,
            outputState: 'missing',
          }
        ),
        messageId: 'tool-1',
        execution: null,
      };
    }

    function mountList(
      items: readonly AgentHistoryItem[],
      filters: { showToolCalls?: boolean; showSystem?: boolean } = {}
    ): void {
      root.render(
        createElement(consoleHistoryList.ConsoleAgentHistoryList, {
          items,
          showToolCalls: filters.showToolCalls ?? true,
          showSystem: filters.showSystem ?? true,
          onLoadFullOutput: async (): Promise<unknown> => undefined,
        })
      );
    }

    test('renders label, right-aligned sent, raw body text, and approved tokens', async () => {
      await act(async () => {
        mountList([
          operatorItem({
            text: 'keep **bold** and <img src=x onerror=1>\nand a second line',
          }),
        ]);
      });

      const row = host.querySelector('[data-operator-row]');
      if (row === null) throw new Error(`missing operator row: ${host.innerHTML}`);
      expect((row as HTMLElement).style.overflowWrap).toBe('anywhere');

      const label = row.querySelector('[data-operator-label]');
      if (label === null) throw new Error('missing operator label');
      expect(label.textContent).toBe('operator · e2e-starter');

      const roleLine = label.parentElement;
      if (roleLine === null) throw new Error('missing role line');
      expect(roleLine.className).toContain('flex');
      expect(roleLine.className).toContain('w-full');
      expect(roleLine.className).toContain('text-[10px]');
      expect(roleLine.className).toContain('tracking-[0.07em]');
      expect(roleLine.className).toContain('uppercase');
      expect(roleLine.className).toContain('text-text-secondary');
      expect(roleLine.getAttribute('style') ?? '').toContain('margin: 10px 2px 3px');

      const delivery = row.querySelector('[data-operator-delivery]');
      if (delivery === null) throw new Error('missing delivery');
      expect(delivery.textContent).toBe('sent');
      expect(delivery.className).toContain('ml-auto');
      expect(delivery.className).toContain('shrink-0');
      expect(delivery.className).toContain('text-[11px]');
      expect(delivery.className).toContain('normal-case');
      expect(delivery.className).toContain('tracking-normal');
      expect(delivery.className).toContain('text-text-secondary');
      expect(delivery.className).not.toContain('border');
      expect(delivery.className).not.toContain('rounded');
      expect(delivery.className).not.toContain('uppercase');

      const body = row.querySelector('[data-operator-body]');
      if (body === null) throw new Error('missing body');
      expect(body.textContent).toBe('keep **bold** and <img src=x onerror=1>\nand a second line');
      expect(body.querySelector('strong')).toBeNull();
      expect(body.querySelector('img')).toBeNull();
      expect(body.querySelector('p')).toBeNull();
      expect(body.className).toContain('font-sans');
      expect(body.className).toContain('text-[12.5px]');
      expect(body.className).toContain('leading-[1.55]');
      expect(body.className).toContain('font-normal');
      expect(body.className).toContain('text-text-primary');
      expect(body.className).toContain('whitespace-pre-wrap');
      expect((body as HTMLElement).style.margin).toBe('0px 2px 6px');
    });

    test('escapes markup-like display names and omits separator for null identity', async () => {
      await act(async () => {
        mountList([
          operatorItem({
            id: 'op-markup',
            operatorDisplayName: '<b>evil</b>',
            text: 'named',
          }),
          operatorItem({
            id: 'op-null',
            seq: 2,
            operatorUserId: null,
            operatorDisplayName: null,
            text: 'anonymous',
          }),
        ]);
      });

      const labels = Array.from(host.querySelectorAll('[data-operator-label]'));
      expect(labels).toHaveLength(2);
      expect(labels[0]?.textContent).toBe('operator · <b>evil</b>');
      expect(labels[0]?.querySelector('b')).toBeNull();
      expect(labels[1]?.textContent).toBe('operator');
      expect(labels[1]?.textContent).not.toContain('·');
    });

    test('keeps tool interrupted -> operator -> assistant document order', async () => {
      await act(async () => {
        mountList([
          toolItemInterrupted(),
          operatorItem({ id: 'op-mid', seq: 2 }),
          assistantItem({ id: 'as-after', seq: 3 }),
        ]);
      });

      const tool = host.querySelector('details[data-tool-id="bash-1"]');
      const operator = host.querySelector('[data-operator-row]');
      const assistantLabel = Array.from(host.querySelectorAll('div')).find(
        el => el.textContent === 'assistant' && el.className.includes('uppercase')
      );
      if (tool === null || operator === null || assistantLabel === undefined) {
        throw new Error(`missing ordered nodes: ${host.innerHTML}`);
      }
      expect(
        tool.compareDocumentPosition(operator) & win.Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        operator.compareDocumentPosition(assistantLabel) & win.Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    test('operator stays visible when showToolCalls and showSystem are false', async () => {
      await act(async () => {
        mountList(
          [
            toolItemInterrupted(),
            {
              kind: 'lifecycle',
              id: 'life-1',
              seq: 2,
              state: 'iteration_started',
              detail: '1',
              execution: null,
            },
            operatorItem({ id: 'op-visible', seq: 3, text: 'still visible' }),
            assistantItem({ id: 'as-visible', seq: 4, text: 'assistant also visible' }),
          ],
          { showToolCalls: false, showSystem: false }
        );
      });

      expect(host.querySelector('details[data-tool-id="bash-1"]')).toBeNull();
      expect(host.textContent).not.toContain('iteration_started');
      const row = host.querySelector('[data-operator-row]');
      if (row === null) throw new Error('operator row hidden under filters');
      expect(row.querySelector('[data-operator-body]')?.textContent).toBe('still visible');
      expect(host.textContent).toContain('assistant also visible');
    });

    test('operator last under hidden filters still receives focus-marker selection', async () => {
      await act(async () => {
        mountList(
          [
            toolItemInterrupted(),
            {
              kind: 'lifecycle',
              id: 'life-1',
              seq: 2,
              state: 'completed',
              detail: null,
              execution: null,
            },
            operatorItem({ id: 'op-last', seq: 3 }),
          ],
          { showToolCalls: false, showSystem: false }
        );
      });

      const last = host.querySelector('[data-last-row]');
      if (last === null) throw new Error('missing last-row marker');
      expect(last.getAttribute('tabindex')).toBe('-1');
      expect(last.querySelector('[data-operator-row]')).not.toBeNull();
    });

    test('assistant label source is lowercase and body uses text-secondary', async () => {
      await act(async () => {
        mountList([assistantItem({ text: '**hello** world' })]);
      });
      const label = Array.from(host.querySelectorAll('div')).find(
        el => el.textContent === 'assistant' && el.className.includes('text-[10px]')
      );
      if (label === null || label === undefined) throw new Error('missing assistant label');
      expect(label.textContent).toBe('assistant');
      expect(label.className).toContain('tracking-[0.07em]');
      expect(label.className).toContain('uppercase');
      expect(label.className).toContain('text-text-secondary');

      const body = label.nextElementSibling;
      if (body === null) throw new Error('missing assistant body');
      expect(body.className).toContain('text-[12.5px]');
      expect(body.className).toContain('leading-[1.55]');
      expect(body.className).toContain('text-text-secondary');
      expect(body.querySelector('strong')?.textContent).toBe('hello');
    });
  });

  describe('finished-iteration dock', () => {
    const FINISHED_ROW = row({
      id: 'occ-1',
      nodeId: 'loop',
      label: 'Loop ×1',
      status: 'completed',
      order: 0,
      sourceIndex: 0,
      selection: {
        kind: 'occurrence',
        occurrenceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        attemptId: '11111111-1111-4111-8111-111111111111',
        iteration: 1,
        loopAncestry: [{ nodeId: 'loop', iteration: 1 }],
      },
    });
    const LIVE_ROW = row({
      id: 'occ-2',
      nodeId: 'loop',
      label: 'Loop ×2',
      status: 'running',
      order: 1,
      sourceIndex: 1,
      selection: {
        kind: 'occurrence',
        occurrenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        attemptId: '22222222-2222-4222-8222-222222222222',
        iteration: 2,
        loopAncestry: [{ nodeId: 'loop', iteration: 2 }],
      },
    });
    const emptyLoad = async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] });

    test('renders finished dock when descriptor and selection callback are provided', async () => {
      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: FINISHED_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (): void => undefined,
        });
      });
      await flush();
      expect(host.textContent).toContain(
        'reading a finished iteration · the agent is working in iteration 2'
      );
      expect(
        [...host.querySelectorAll('button')].some(
          b => (b.textContent ?? '').trim() === 'Go to iteration 2'
        )
      ).toBe(true);
      expect(host.querySelector('textarea')).toBeNull();
    });

    test('omits finished dock when selection callback is missing', async () => {
      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: FINISHED_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
        });
      });
      await flush();
      expect(host.textContent ?? '').not.toContain('reading a finished iteration');
    });

    test('Go invokes existing selection callback with liveRowId', async () => {
      const selected: string[] = [];
      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: FINISHED_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (id): void => {
            selected.push(id);
          },
        });
      });
      await flush();
      const go = [...host.querySelectorAll('button')].find(
        b => (b.textContent ?? '').trim() === 'Go to iteration 2'
      );
      await act(async () => {
        if (go === undefined) throw new Error('missing Go button');
        go.click();
      });
      await flush();
      expect(selected).toEqual(['occ-2']);
    });

    test('after Go to live row, focus lands on the composer field', async () => {
      const selected: string[] = [];

      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: FINISHED_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (id): void => {
            selected.push(id);
          },
        });
      });
      await flush();

      const go = [...host.querySelectorAll('button')].find(
        b => (b.textContent ?? '').trim() === 'Go to iteration 2'
      );
      await act(async () => {
        if (go === undefined) throw new Error('missing Go button');
        go.click();
      });
      await flush();
      expect(selected).toEqual(['occ-2']);

      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: LIVE_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: null,
          onSelectRow: (id): void => {
            selected.push(id);
          },
        });
      });
      await flush();

      const field = host.querySelector('textarea');
      expect(field).not.toBeNull();
      expect((win.document.activeElement as unknown) === field).toBe(true);
    });

    test('after Go when target became finished, focus lands on the new Go button', async () => {
      const advancedLive = row({
        ...LIVE_ROW,
        id: 'occ-3',
        status: 'completed',
        order: 2,
        label: 'Loop ×2 done',
        selection: {
          kind: 'occurrence',
          occurrenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          attemptId: '33333333-3333-4333-8333-333333333333',
          iteration: 2,
          loopAncestry: [{ nodeId: 'loop', iteration: 2 }],
        },
      });

      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: FINISHED_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (): void => undefined,
        });
      });
      await flush();

      const go = [...host.querySelectorAll('button')].find(
        b => (b.textContent ?? '').trim() === 'Go to iteration 2'
      );
      await act(async () => {
        if (go === undefined) throw new Error('missing Go button');
        go.click();
      });
      await flush();

      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: advancedLive,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-4', liveIteration: 3 },
          onSelectRow: (): void => undefined,
        });
      });
      await flush();

      const newGo = [...host.querySelectorAll('button')].find(
        b => (b.textContent ?? '').trim() === 'Go to iteration 3'
      );
      expect(newGo).not.toBeUndefined();
      expect((win.document.activeElement as unknown) === newGo).toBe(true);
    });

    test('after Go when dock disappears, focus lands on transcript scroller', async () => {
      const terminalRow = row({
        ...LIVE_ROW,
        status: 'completed',
      });

      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: FINISHED_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (): void => undefined,
        });
      });
      await flush();

      const go = [...host.querySelectorAll('button')].find(
        b => (b.textContent ?? '').trim() === 'Go to iteration 2'
      );
      await act(async () => {
        if (go === undefined) throw new Error('missing Go button');
        go.click();
      });
      await flush();

      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: terminalRow,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'completed' })],
          isLive: false,
          loadMessages: emptyLoad,
          finishedIteration: null,
        });
      });
      await flush();

      const scroller = host.querySelector('[data-testid="console-node-room-scroll"]');
      expect(scroller).not.toBeNull();
      expect(host.querySelector('textarea')).toBeNull();
      expect(
        [...host.querySelectorAll('button')].some(b =>
          (b.textContent ?? '').includes('Go to iteration')
        )
      ).toBe(false);
      expect((win.document.activeElement as unknown) === scroller).toBe(true);
    });

    test('unrelated remount does not steal focus', async () => {
      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: FINISHED_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (): void => undefined,
        });
      });
      await flush();

      const outside = win.document.createElement('button');
      outside.textContent = 'outside';
      win.document.body.appendChild(outside);
      outside.focus();
      expect((win.document.activeElement as unknown) === outside).toBe(true);

      await act(async () => {
        renderRoom({
          nodeId: 'loop',
          selectedRow: FINISHED_ROW,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          nodeStates: [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (): void => undefined,
        });
      });
      await flush();

      expect((win.document.activeElement as unknown) === outside).toBe(true);
      outside.remove();
    });
  });

  describe('T3.15–T3.17 node-terminal pass-through and dock rekey', () => {
    function findPropsWithKey(start: Element, key: string): Record<string, unknown> | null {
      const fiberKey = Object.keys(start).find(candidate => candidate.startsWith('__reactFiber$'));
      if (fiberKey === undefined) return null;
      interface Fiber {
        memoizedProps?: unknown;
        child?: Fiber | null;
        sibling?: Fiber | null;
        return?: Fiber | null;
      }
      const startFiber = (start as unknown as Record<string, Fiber>)[fiberKey];
      const stack: Fiber[] = [startFiber];
      const seen = new Set<Fiber>();
      while (stack.length > 0) {
        const fiber = stack.pop();
        if (fiber === undefined || seen.has(fiber)) continue;
        seen.add(fiber);
        const props = fiber.memoizedProps;
        if (
          props !== null &&
          typeof props === 'object' &&
          !Array.isArray(props) &&
          key in (props as Record<string, unknown>)
        ) {
          return props as Record<string, unknown>;
        }
        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
      }
      let up: Fiber | null | undefined = startFiber.return;
      while (up !== null && up !== undefined) {
        const props = up.memoizedProps;
        if (
          props !== null &&
          typeof props === 'object' &&
          !Array.isArray(props) &&
          key in (props as Record<string, unknown>)
        ) {
          return props as Record<string, unknown>;
        }
        up = up.return;
      }
      return null;
    }

    test('T3.16 pass-through pins nodeTerminal and nodeExecutionKey on the dock', async () => {
      const emptyLoad = async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] });
      await act(async () => {
        renderRoom({
          nodeId: 'review',
          selectedRow: row({ nodeId: 'review', label: 'Review', status: 'running' }),
          definitionNodes: [{ id: 'review', prompt: 'Write' }],
          nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          nodeTerminal: true,
          nodeExecutionKey: 'occ-review-1',
        });
      });
      await flush();

      const start = host.querySelector('textarea') ?? host;
      const props = findPropsWithKey(start, 'nodeTerminal');
      expect(props).not.toBeNull();
      expect(props?.nodeTerminal).toBe(true);
      expect(props?.nodeExecutionKey).toBe('occ-review-1');
    });

    test('T3.17 occurrence switch keeps observed receipt under stable run/node dock key', async () => {
      let queued: { message_id: string; message: string }[] = [
        { message_id: 'id-a', message: 'alpha receipt' },
      ];
      queueFetchSpy?.mockRestore();
      queueFetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const raw =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        let pathname = raw;
        try {
          pathname = new URL(raw, 'http://localhost').pathname;
        } catch {
          pathname = raw.split('?')[0] ?? raw;
        }
        if (method === 'GET' && pathname.endsWith('/queue')) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, queued }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.reject(new Error(`unexpected fetch ${method} ${raw}`));
      }) as typeof fetch);

      const emptyLoad = async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [],
        hasMore: false,
        highWatermark: 0,
        nextCursor: '0',
      });
      const occ1 = row({
        id: 'occ-1',
        nodeId: 'review',
        label: 'Review ×1',
        status: 'completed',
        selection: {
          kind: 'occurrence',
          occurrenceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      });
      const occ2 = row({
        id: 'occ-2',
        nodeId: 'review',
        label: 'Review ×2',
        status: 'running',
        selection: {
          kind: 'occurrence',
          occurrenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      });

      await act(async () => {
        renderRoom({
          run: run({ id: 'run-1', status: 'running' }),
          nodeId: 'review',
          selectedRow: occ2,
          definitionNodes: [{ id: 'review', prompt: 'Write' }],
          nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          nodeTerminal: false,
          nodeExecutionKey: 'logical-1',
          scopeKey: 'run:run-1|node:review|sel:occurrence:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        });
      });

      await act(async () => {
        for (let i = 0; i < 40; i += 1) {
          await Promise.resolve();
          if ((host.textContent ?? '').toLowerCase().includes('alpha receipt')) break;
          const { promise, resolve } = Promise.withResolvers<undefined>();
          setTimeout(resolve, 25);
          await promise;
        }
      });
      expect((host.textContent ?? '').toLowerCase()).toContain('alpha receipt');

      queued = [];
      await act(async () => {
        renderRoom({
          run: run({ id: 'run-1', status: 'running' }),
          nodeId: 'review',
          selectedRow: occ1,
          definitionNodes: [{ id: 'review', prompt: 'Write' }],
          nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          nodeTerminal: false,
          nodeExecutionKey: 'logical-1',
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (): void => undefined,
          scopeKey: 'run:run-1|node:review|sel:occurrence:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        });
      });
      await act(async () => {
        for (let i = 0; i < 20; i += 1) {
          await Promise.resolve();
          const { promise, resolve } = Promise.withResolvers<undefined>();
          setTimeout(resolve, 25);
          await promise;
        }
      });

      await act(async () => {
        renderRoom({
          run: run({ id: 'run-1', status: 'running' }),
          nodeId: 'review',
          selectedRow: occ1,
          definitionNodes: [{ id: 'review', prompt: 'Write' }],
          nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
          isLive: true,
          loadMessages: emptyLoad,
          nodeTerminal: true,
          nodeExecutionKey: 'logical-1',
          finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
          onSelectRow: (): void => undefined,
          scopeKey: 'run:run-1|node:review|sel:occurrence:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        });
      });
      await flushUntil('never sent after drain', () =>
        (host.textContent ?? '').includes('node finished · none of this was sent')
      );

      const list = host.querySelector('[aria-label="Never sent, 1"]');
      expect(list).not.toBeNull();
      expect(list?.textContent ?? '').toContain('alpha receipt');
      expect(host.textContent ?? '').toContain('node finished · none of this was sent');
    });
  });

  describe('T3.18–T3.26 node-wide reconciliation drain', () => {
    function completePage(messages: WorkflowNodeMessage[] = []): WorkflowNodeMessagesResponse {
      const maxSeq = messages.reduce((max, row) => Math.max(max, row.seq), 0);
      return {
        messages: [...messages],
        hasMore: false,
        highWatermark: maxSeq,
        nextCursor: String(maxSeq),
      };
    }

    function operatorText(seq: number, messageId: string, text: string): WorkflowNodeMessage {
      return {
        id: `op-${String(seq)}`,
        seq,
        kind: 'text',
        payload: { text },
        metadata: { origin: 'operator', message_id: messageId },
        created_at: CREATED_AT,
      };
    }

    function assistantText(seq: number, messageId: string, text: string): WorkflowNodeMessage {
      return {
        id: `as-${String(seq)}`,
        seq,
        kind: 'text',
        payload: { text },
        metadata: {
          origin: 'assistant',
          message_id: messageId,
        } as unknown as WorkflowNodeMessage['metadata'],
        created_at: CREATED_AT,
      };
    }

    function toolMsg(seq: number, id: string): WorkflowNodeMessage {
      return {
        id: `tool-${String(seq)}`,
        seq,
        kind: 'tool',
        payload: { name: 'Bash', id, input: {} },
        metadata: { message_id: id },
        created_at: CREATED_AT,
      };
    }

    interface LoaderOpts {
      afterSeq?: number;
      limit?: number;
      occurrenceId?: string;
      attemptId?: string;
      signal?: AbortSignal;
    }
    type Loader = (
      runId: string,
      nodeId: string,
      options?: LoaderOpts
    ) => Promise<WorkflowNodeMessagesResponse>;

    const OCC_ROW = row({
      id: 'occ-1',
      nodeId: 'review',
      label: 'Review ×1',
      status: 'completed',
      selection: {
        kind: 'occurrence',
        occurrenceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        attemptId: '11111111-1111-4111-8111-111111111111',
      },
    });
    const LIVE_OCC_ROW = row({
      id: 'occ-2',
      nodeId: 'review',
      label: 'Review ×2',
      status: 'running',
      selection: {
        kind: 'occurrence',
        occurrenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    });

    function installQueued(queued: { message_id: string; message: string }[]): void {
      queueFetchSpy?.mockRestore();
      queueFetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const raw =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        let pathname = raw;
        try {
          pathname = new URL(raw, 'http://localhost').pathname;
        } catch {
          pathname = raw.split('?')[0] ?? raw;
        }
        if (method === 'GET' && pathname.endsWith('/queue')) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, queued }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.reject(new Error(`unexpected fetch ${method} ${raw}`));
      }) as typeof fetch);
    }

    async function waitForText(needle: string): Promise<void> {
      await act(async () => {
        for (let i = 0; i < 40; i += 1) {
          await Promise.resolve();
          if ((host.textContent ?? '').toLowerCase().includes(needle.toLowerCase())) break;
          const { promise, resolve } = Promise.withResolvers<undefined>();
          setTimeout(resolve, 25);
          await promise;
        }
      });
    }

    function baseRoom(overrides: {
      loadMessages: Loader;
      selectedRow?: LogRow;
      nodeTerminal?: boolean;
      nodeExecutionKey?: string | null;
      finishedIteration?: { liveRowId: string; liveIteration: number } | null;
      onSelectRow?: (rowId: string) => void;
      scopeKey?: string;
      isLive?: boolean;
      runStatus?: Run['status'];
    }): Parameters<typeof renderRoom>[0] {
      const selected = overrides.selectedRow ?? LIVE_OCC_ROW;
      return {
        run: run({ id: 'run-1', status: overrides.runStatus ?? 'running' }),
        nodeId: 'review',
        selectedRow: selected,
        definitionNodes: [{ id: 'review', prompt: 'Write' }],
        nodeStates: [
          nodeState({
            nodeId: 'review',
            name: 'Review',
            status: selected.status === 'completed' ? 'running' : selected.status,
          }),
        ],
        isLive: overrides.isLive ?? true,
        loadMessages: overrides.loadMessages,
        nodeTerminal: overrides.nodeTerminal,
        nodeExecutionKey: overrides.nodeExecutionKey,
        finishedIteration: overrides.finishedIteration,
        onSelectRow: overrides.onSelectRow,
        scopeKey: overrides.scopeKey,
      };
    }

    test('T3.18 nodeTerminal false never starts or publishes reconciliation', async () => {
      const nodeWide: LoaderOpts[] = [];
      const loadMessages: Loader = async (_runId, _nodeId, options = {}) => {
        if (options.occurrenceId === undefined) nodeWide.push({ ...options });
        return completePage([]);
      };

      await act(async () => {
        renderRoom(
          baseRoom({
            loadMessages,
            selectedRow: OCC_ROW,
            nodeTerminal: false,
            nodeExecutionKey: 'logical-1',
            isLive: false,
            runStatus: 'cancelled',
          })
        );
      });
      await flush();
      expect(nodeWide).toHaveLength(0);
      expect(host.querySelector('[aria-label^="Never sent"]')).toBeNull();

      await act(async () => {
        renderRoom(
          baseRoom({
            loadMessages,
            selectedRow: OCC_ROW,
            nodeTerminal: false,
            nodeExecutionKey: 'logical-1',
            finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
            onSelectRow: (): void => undefined,
          })
        );
      });
      await flush();
      expect(nodeWide).toHaveLength(0);
      expect(host.querySelector('[aria-label^="Never sent"]')).toBeNull();
    });

    test('T3.19 terminal request is node-wide without occurrence/attempt', async () => {
      const nodeWide: LoaderOpts[] = [];
      const occLoads: LoaderOpts[] = [];
      const displayRows: WorkflowNodeMessage[] = [
        {
          id: 'd1',
          seq: 1,
          kind: 'text',
          payload: { text: 'display-only' },
          created_at: CREATED_AT,
        },
      ];
      const loadMessages: Loader = async (_runId, _nodeId, options = {}) => {
        if (options.occurrenceId !== undefined) {
          occLoads.push({ ...options });
          return completePage(displayRows);
        }
        nodeWide.push({ ...options });
        return completePage([]);
      };

      await act(async () => {
        renderRoom(
          baseRoom({
            loadMessages,
            selectedRow: OCC_ROW,
            nodeTerminal: true,
            nodeExecutionKey: 'logical-1',
            finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
            onSelectRow: (): void => undefined,
          })
        );
      });
      await flushUntil('display row', () => (host.textContent ?? '').includes('display-only'));
      expect(nodeWide.length).toBeGreaterThan(0);
      for (const call of nodeWide) {
        expect(call.occurrenceId).toBeUndefined();
        expect(call.attemptId).toBeUndefined();
      }
      expect(occLoads.length).toBeGreaterThan(0);
      expect(occLoads[0]?.occurrenceId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(occLoads[0]?.attemptId).toBe('11111111-1111-4111-8111-111111111111');
      expect(host.textContent ?? '').toContain('display-only');
    });

    test('T3.20 complete absence restores observed receipt', async () => {
      installQueued([{ message_id: 'id-a', message: 'alpha receipt' }]);
      const loadMessages: Loader = async () => completePage([]);

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: false, nodeExecutionKey: 'logical-1' }));
      });
      await waitForText('alpha receipt');

      installQueued([]);
      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: true, nodeExecutionKey: 'logical-1' }));
      });
      await flushUntil('never sent', () =>
        (host.textContent ?? '').includes('node finished · none of this was sent')
      );
      const list = host.querySelector('[aria-label="Never sent, 1"]');
      expect(list).not.toBeNull();
      expect(list?.textContent ?? '').toContain('alpha receipt');
    });

    test('T3.21 written operator row filters finished box', async () => {
      installQueued([{ message_id: 'id-a', message: 'alpha receipt' }]);
      const loadMessages: Loader = async (_r, _n, options = {}) => {
        if (options.occurrenceId !== undefined) return completePage([]);
        return completePage([operatorText(1, 'id-a', 'alpha receipt')]);
      };

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: false, nodeExecutionKey: 'logical-1' }));
      });
      await waitForText('alpha receipt');

      installQueued([]);
      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: true, nodeExecutionKey: 'logical-1' }));
      });
      await act(async () => {
        for (let i = 0; i < 20; i += 1) {
          await Promise.resolve();
          const { promise, resolve } = Promise.withResolvers<undefined>();
          setTimeout(resolve, 25);
          await promise;
        }
      });
      expect(host.querySelector('[aria-label^="Never sent"]')).toBeNull();
      expect(host.textContent ?? '').not.toContain('node finished · none of this was sent');
    });

    test('T3.22 only operator ids count as delivery', async () => {
      installQueued([{ message_id: 'id-a', message: 'alpha receipt' }]);
      const loadMessages: Loader = async (_r, _n, options = {}) => {
        if (options.occurrenceId !== undefined) return completePage([]);
        return completePage([
          assistantText(1, 'id-a', 'assistant said id-a'),
          toolMsg(2, 'id-a'),
          {
            id: 'm3',
            seq: 3,
            kind: 'text',
            payload: { text: 'malformed' },
            metadata: { origin: 'operator', message_id: 123 as unknown as string },
            created_at: CREATED_AT,
          },
        ]);
      };

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: false, nodeExecutionKey: 'logical-1' }));
      });
      await waitForText('alpha receipt');

      installQueued([]);
      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: true, nodeExecutionKey: 'logical-1' }));
      });
      await flushUntil('never sent despite decoys', () =>
        (host.textContent ?? '').includes('node finished · none of this was sent')
      );
      expect(host.querySelector('[aria-label="Never sent, 1"]')).not.toBeNull();
    });

    test('T3.23 incomplete/error fails safe and retries', async () => {
      jest.useFakeTimers({ now: Date.now() });
      installQueued([{ message_id: 'id-a', message: 'alpha receipt' }]);
      let nodeWideCalls = 0;
      const loadMessages: Loader = async (_r, _n, options = {}) => {
        if (options.occurrenceId !== undefined) return completePage([]);
        nodeWideCalls += 1;
        if (nodeWideCalls === 1) throw new Error('transient transport');
        return completePage([]);
      };

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: false, nodeExecutionKey: 'logical-1' }));
      });
      await waitForText('alpha receipt');

      installQueued([]);
      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: true, nodeExecutionKey: 'logical-1' }));
      });
      await flush();
      expect(nodeWideCalls).toBe(1);
      expect(host.querySelector('[aria-label^="Never sent"]')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
      });
      await flushUntil('retry reconcile', () =>
        (host.textContent ?? '').includes('node finished · none of this was sent')
      );
      expect(nodeWideCalls).toBeGreaterThanOrEqual(2);
      jest.useRealTimers();
    });

    test('T3.24 reset aborts stale work; occurrence-only does not', async () => {
      const pending = deferred<WorkflowNodeMessagesResponse>();
      let nodeWideStarts = 0;
      const loadMessages: Loader = async (_r, _n, options = {}) => {
        if (options.occurrenceId !== undefined) return completePage([]);
        nodeWideStarts += 1;
        if (nodeWideStarts === 1) return pending.promise;
        return completePage([]);
      };

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: true, nodeExecutionKey: 'logical-1' }));
      });
      await flush();
      expect(nodeWideStarts).toBe(1);

      const startsBeforeOcc = nodeWideStarts;
      await act(async () => {
        renderRoom(
          baseRoom({
            loadMessages,
            selectedRow: OCC_ROW,
            nodeTerminal: true,
            nodeExecutionKey: 'logical-1',
            finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
            onSelectRow: (): void => undefined,
          })
        );
      });
      await flush();
      expect(nodeWideStarts).toBe(startsBeforeOcc);

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: true, nodeExecutionKey: 'logical-2' }));
      });
      await flush();
      expect(nodeWideStarts).toBe(startsBeforeOcc + 1);

      await act(async () => {
        pending.resolve(completePage([]));
      });
      await flush();

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: false, nodeExecutionKey: 'logical-2' }));
      });
      await flush();
      // Terminal drop must not keep a finished claim; late aborted drain stays inert.
      expect(host.querySelector('[aria-label^="Never sent"]')).toBeNull();
      expect(host.textContent ?? '').not.toContain('node finished · none of this was sent');
    });

    test('T3.25 same-run/node retry/resume starts fresh on key change', async () => {
      installQueued([{ message_id: 'id-a', message: 'alpha receipt' }]);
      const loadMessages: Loader = async () => completePage([]);
      win.sessionStorage.setItem(
        'archon:steering-draft:run-1:review',
        JSON.stringify({ draft: 'keep this draft', pendingRetry: null })
      );

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: false, nodeExecutionKey: 'logical-1' }));
      });
      await waitForText('alpha receipt');
      const field = host.querySelector('textarea') as unknown as HTMLTextAreaElement | null;
      expect(field?.value ?? '').toBe('keep this draft');

      installQueued([]);
      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: true, nodeExecutionKey: 'logical-1' }));
      });
      await flushUntil('first never sent', () =>
        (host.textContent ?? '').includes('node finished · none of this was sent')
      );
      expect(host.querySelector('[aria-label^="Never sent"]')?.textContent ?? '').toContain(
        'alpha receipt'
      );

      installQueued([]);
      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: true, nodeExecutionKey: 'logical-2' }));
      });
      await flush();
      await act(async () => {
        for (let i = 0; i < 15; i += 1) {
          await Promise.resolve();
          const { promise, resolve } = Promise.withResolvers<undefined>();
          setTimeout(resolve, 25);
          await promise;
        }
      });
      const afterKey = host.querySelector('[aria-label^="Never sent"]');
      expect(afterKey?.textContent ?? '').not.toContain('alpha receipt');

      await act(async () => {
        renderRoom(baseRoom({ loadMessages, nodeTerminal: false, nodeExecutionKey: 'logical-2' }));
      });
      await flush();
      const draftField = host.querySelector('textarea') as unknown as HTMLTextAreaElement | null;
      expect(draftField?.value ?? '').toBe('keep this draft');
    });

    test('T3.26 finished-iteration observer is recovered after overall node evidence', async () => {
      installQueued([{ message_id: 'id-a', message: 'alpha from finished band' }]);
      const loadMessages: Loader = async () => completePage([]);

      await act(async () => {
        renderRoom(
          baseRoom({
            loadMessages,
            selectedRow: OCC_ROW,
            nodeTerminal: false,
            nodeExecutionKey: 'logical-1',
            finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
            onSelectRow: (): void => undefined,
          })
        );
      });
      await waitForText('alpha from finished band');

      installQueued([]);
      await act(async () => {
        renderRoom(
          baseRoom({
            loadMessages,
            selectedRow: OCC_ROW,
            nodeTerminal: true,
            nodeExecutionKey: 'logical-1',
            finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
            onSelectRow: (): void => undefined,
          })
        );
      });
      await flushUntil('finished-iteration restore', () =>
        (host.textContent ?? '').includes('node finished · none of this was sent')
      );
      const list = host.querySelector('[aria-label="Never sent, 1"]');
      expect(list).not.toBeNull();
      expect(list?.textContent ?? '').toContain('alpha from finished band');
    });
  });
});
