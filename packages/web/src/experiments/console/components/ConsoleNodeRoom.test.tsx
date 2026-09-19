process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
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
        execution: null,
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
});
