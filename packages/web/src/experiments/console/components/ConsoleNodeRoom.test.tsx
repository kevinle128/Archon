process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import type { AgentHistoryItem } from '@/lib/agent-history';

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

function nodeState(
  overrides: Pick<WorkflowNodeState, 'nodeId' | 'name' | 'status'>
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

  beforeEach(() => {
    closed = 0;
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    invalidate('run-node-messages');
    invalidate('console-node-room:idle');
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

  test('renders agent text, tool JSON, status entries, and slices a selected loop iteration', async () => {
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
    // Serialized payloads stay recorded inside the row's closed diagnostics.
    for (const diagnostic of Array.from(toolRowEl?.querySelectorAll('details') ?? [])) {
      expect((diagnostic as Element & { open: boolean }).open).toBe(false);
    }
    expect(toolRowEl?.textContent).toContain('"path": "a.ts"');
    expect(toolRowEl?.textContent).toContain('"ok": true');
    expect(host.textContent).toContain('iteration_started');
    expect(host.textContent).toContain('iteration_failed');
    expect(host.textContent).toContain('waiting on you');
    expect(host.textContent).toContain('Iteration 2');
    expect(host.textContent).not.toContain('first');
    assertNoConversationComposer(host);
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
    expect(host.textContent).toContain('ASSISTANT');
    expect(host.textContent).toContain('hello-md');
    expect(host.textContent).toContain('completed');
    const bashRow = host.querySelector('details[data-tool-id="tool-bash"]');
    expect(bashRow).not.toBeNull();
    expect((bashRow as Element & { open: boolean }).open).toBe(false);
    const bashSummary = bashRow?.querySelector('summary');
    expect(bashSummary?.textContent).toContain('Bash');
    expect(bashSummary?.textContent).toContain(longCmd);
    // Nested Input/Output diagnostics exist in the DOM but stay closed.
    const diagnostics = Array.from(bashRow?.querySelectorAll('details') ?? []);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) {
      expect((diagnostic as Element & { open: boolean }).open).toBe(false);
    }
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
      return agentHistory.buildAgentHistory({ rows, events, nodeId: 'review', nowMs: NOW_MS });
    }

    function mountList(
      items: readonly AgentHistoryItem[],
      onLoadFullOutput?: (item: Extract<AgentHistoryItem, { kind: 'tool' }>) => Promise<unknown>
    ): void {
      root.render(
        createElement(consoleHistoryList.ConsoleAgentHistoryList, {
          items,
          showToolCalls: true,
          showSystem: true,
          onLoadFullOutput: onLoadFullOutput ?? (async (): Promise<unknown> => undefined),
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
      // Diagnostics exist in the DOM but stay closed behind the summary.
      const diagnostics = row.querySelectorAll('details');
      expect(diagnostics).toHaveLength(2);
      for (const diagnostic of Array.from(diagnostics)) {
        expect((diagnostic as Element & { open: boolean }).open).toBe(false);
      }
      expect(row.textContent).toContain('Input');
      expect(row.textContent).toContain('Output');
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

    test('nested Input/Output toggles do not mark the outer row touched', async () => {
      await act(async () => {
        mountList(historyItems(READ_ROWS));
      });
      const row = toolRow('t-1');
      const inputDiagnostic = row.querySelectorAll('details')[0] as Element & { open: boolean };
      await act(async () => {
        click(inputDiagnostic.querySelector('summary') as Element);
      });
      expect(inputDiagnostic.open).toBe(true);
      expect(row.open).toBe(false);

      // Still untouched: the failed transition auto-opens the outer row; the nested
      // diagnostic keeps its own state.
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
      const updatedInput = updated.querySelectorAll('details')[0] as Element & { open: boolean };
      expect(updatedInput.open).toBe(true);
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
      expect(row.open).toBe(true);
      const button = rowButton(row, 'View full output');
      await act(async () => {
        click(button);
      });
      expect(button.disabled).toBe(true);
      await act(async () => {
        resolveLoad?.('FULL OUTPUT');
      });
      expect(row.textContent).toContain('FULL OUTPUT');
      // The row re-presented with output_state 'full': the truncated badge is gone.
      expect(rowSummary(row).textContent).not.toContain('truncated');
      expect(row.open).toBe(true);
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
      const button = rowButton(row, 'View full output');
      await act(async () => {
        click(button);
      });
      expect(row.textContent).toContain('network down');
      const retry = rowButton(row, 'Retry');
      await act(async () => {
        click(retry);
      });
      expect(row.textContent).toContain('FULL');
      expect(row.textContent).not.toContain('network down');
      expect(attempts).toBe(2);
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
      for (const nested of Array.from(drained.querySelectorAll('details'))) {
        expect((nested as Element & { open: boolean }).open).toBe(false);
      }
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
  });
});
