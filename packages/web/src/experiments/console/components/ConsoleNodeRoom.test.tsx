process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import type { AgentHistoryItem } from '@/lib/agent-history';

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
    // Serialized payloads stay out of the DOM while the row's Raw panel is closed.
    const raw = toolRowEl?.querySelector('button[aria-expanded]');
    expect(raw?.textContent).toBe('Raw');
    expect(raw?.getAttribute('aria-expanded')).toBe('false');
    expect(raw?.getAttribute('aria-controls')).toBeNull();
    expect(toolRowEl?.querySelectorAll('details')).toHaveLength(0);
    expect(toolRowEl?.querySelector('pre')).toBeNull();
    expect(toolRowEl?.textContent).not.toContain('"path": "a.ts"');
    expect(toolRowEl?.textContent).not.toContain('"ok": true');
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
    // The Raw control stays closed; no payload panel or nested diagnostics exist.
    const bashRaw = bashRow?.querySelector('button[aria-expanded]');
    expect(bashRaw?.getAttribute('aria-expanded')).toBe('false');
    expect(bashRow?.querySelectorAll('details')).toHaveLength(0);
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
      // One closed Raw control sits in the body; the serialized payload stays out
      // of the DOM while it is closed and the nested Input/Output diagnostics are gone.
      const raw = rawButton(row);
      expect(raw.textContent).toBe('Raw');
      expect(raw.getAttribute('aria-expanded')).toBe('false');
      expect(raw.getAttribute('aria-controls')).toBeNull();
      expect(raw.className).toContain('min-h-[24px]');
      expect(raw.className).toContain('focus-visible:outline-accent-bright!');
      expect(row.querySelectorAll('details')).toHaveLength(0);
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
      expect(row.textContent).not.toContain('chunk');
      expect(row.open).toBe(true);
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
      expect(drained.querySelectorAll('details')).toHaveLength(0);
      expect(rawButton(drained).getAttribute('aria-expanded')).toBe('false');
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
      await act(async () => {
        mountList(historyItems(OMP_TASK_MESSAGES));
      });
      const row = toolRow('task-1');
      expect(row.open).toBe(false);
      const card = subtaskCard(row, 0);
      await act(async () => {
        click(cardSummary(card));
      });
      expect(card.open).toBe(true);
      expect(row.open).toBe(false);

      // Still untouched: the failed transition auto-opens the outer row; the
      // nested card keeps its own state.
      const failedRows: readonly WorkflowNodeMessage[] = [
        ...(OMP_TASK_MESSAGES[0] === undefined ? [] : [OMP_TASK_MESSAGES[0]]),
        resultRow('task-1', 11, 'Task', OMP_TASK_INPUT, 'boom', { outcome: 'error' }),
      ];
      await act(async () => {
        mountList(historyItems(failedRows));
      });
      const updated = toolRow('task-1');
      expect(updated.open).toBe(true);
      expect(subtaskCard(updated, 0).open).toBe(true);
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
      expect(toolRow('task-1').querySelectorAll('details[data-subtask-index]')).toHaveLength(2);
      expect(toolRow('task-2').querySelectorAll('details[data-subtask-index]')).toHaveLength(1);
    });
  });
});
