process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import { buildAgentHistory } from '@/lib/agent-history';

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
const consoleAgentHistoryList = await import('./inspect/ConsoleAgentHistoryList');

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

function toolWire(args: {
  id: string;
  seq: number;
  name: string;
  toolUseId: string;
  input?: unknown;
  output?: unknown;
  metadata: NonNullable<Extract<WorkflowNodeMessage, { kind: 'tool' }>['metadata']>;
}): WorkflowNodeMessage {
  const payload: { name: string; id: string; input?: unknown; output?: unknown } = {
    name: args.name,
    id: args.toolUseId,
  };
  if (args.input !== undefined) payload.input = args.input;
  if (args.output !== undefined) payload.output = args.output;
  return {
    id: args.id,
    seq: args.seq,
    kind: 'tool',
    payload,
    created_at: CREATED_AT,
    metadata: args.metadata,
  };
}

function toolDetails(hostEl: Element, toolUseId: string): HTMLDetailsElement {
  const el = hostEl.querySelector(`details[data-tool-id="${toolUseId}"]`);
  if (el === null) {
    throw new Error(`missing tool details ${toolUseId}`);
  }
  return el as unknown as HTMLDetailsElement;
}

function toolSummary(details: HTMLDetailsElement): HTMLElement {
  const el = details.querySelector('[data-testid="tool-summary"]');
  if (el === null) {
    throw new Error('missing tool-summary');
  }
  return el as unknown as HTMLElement;
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
    expect(host.textContent).toContain('Read');
    expect(host.textContent).toContain('"path": "a.ts"');
    expect(host.textContent).toContain('"ok": true');
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
    await flushUntil('teammate Ask', () =>
      (host.textContent ?? '').includes('Waiting for Avery to answer')
    );
    expect(host.textContent).not.toContain('Submit');
    expect(host.textContent).not.toContain('Decline');

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

  test('renders assistant, tool, and lifecycle history with a closed tool disclosure', async () => {
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
    expect(host.textContent).toContain('Bash');
    expect(host.textContent).toContain(longCmd);
    expect(host.textContent).toContain('completed');
    const details = toolDetails(host, 'tool-bash');
    const summary = toolSummary(details);
    expect(details.open).toBe(false);
    expect(summary.textContent).toContain('Bash');
    expect(summary.textContent).toContain(longCmd);
    expect(summary.textContent).not.toMatch(/[{["]/);
  });

  test('renders a succeeded Read pair as a closed disclosure without raw output in the summary', async () => {
    await act(async () => {
      renderRoom({
        showToolCalls: true,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            toolWire({
              id: 'read-call',
              seq: 1,
              name: 'Read',
              toolUseId: 'read-1',
              input: { path: 'a.ts' },
              metadata: { tool_phase: 'call' },
            }),
            toolWire({
              id: 'read-result',
              seq: 2,
              name: 'Read',
              toolUseId: 'read-1',
              output: 'raw-output-secret',
              metadata: { tool_phase: 'result' },
            }),
          ],
        }),
      });
    });
    await flushUntil(
      'read row',
      () => host.querySelector('details[data-tool-id="read-1"]') !== null
    );
    const details = toolDetails(host, 'read-1');
    const summary = toolSummary(details);
    const summaryText = summary.textContent ?? '';
    expect(details.open).toBe(false);
    expect(summaryText).toContain('✓');
    expect(summaryText).toContain('Read');
    expect(summaryText).toContain('a.ts');
    expect(summaryText).not.toContain('raw-output-secret');
    expect(summaryText).not.toMatch(/[{["]/);
  });

  test('renders a failed Bash pair open with exit 1 and keeps output in the body', async () => {
    await act(async () => {
      renderRoom({
        showToolCalls: true,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            toolWire({
              id: 'bash-call',
              seq: 1,
              name: 'Bash',
              toolUseId: 'bash-1',
              input: { cmd: 'bun test' },
              metadata: { tool_phase: 'call' },
            }),
            toolWire({
              id: 'bash-result',
              seq: 2,
              name: 'Bash',
              toolUseId: 'bash-1',
              output: 'bash-failed-output',
              metadata: { tool_phase: 'result', exit_code: 1 },
            }),
          ],
        }),
      });
    });
    await flushUntil(
      'bash row',
      () => host.querySelector('details[data-tool-id="bash-1"]') !== null
    );
    const details = toolDetails(host, 'bash-1');
    const summary = toolSummary(details);
    const summaryText = summary.textContent ?? '';
    expect(details.open).toBe(true);
    expect(summaryText).toContain('✕');
    expect(summaryText).toContain('Bash');
    expect(summaryText).toContain('bun test');
    expect(summaryText).toContain('exit 1');
    expect(summaryText).not.toContain('bash-failed-output');
    expect(details.textContent).toContain('bash-failed-output');
  });

  test('untouched running Console row auto-opens when the result is error', async () => {
    const running = buildAgentHistory({
      nodeId: 'review',
      events: [],
      rows: [
        toolWire({
          id: 'live-call',
          seq: 1,
          name: 'Bash',
          toolUseId: 'live-1',
          input: { cmd: 'bun test' },
          metadata: { tool_phase: 'call' },
        }),
      ],
    });
    const failed = buildAgentHistory({
      nodeId: 'review',
      events: [],
      rows: [
        toolWire({
          id: 'live-call',
          seq: 1,
          name: 'Bash',
          toolUseId: 'live-1',
          input: { cmd: 'bun test' },
          metadata: { tool_phase: 'call' },
        }),
        toolWire({
          id: 'live-result',
          seq: 2,
          name: 'Bash',
          toolUseId: 'live-1',
          output: 'boom',
          metadata: { tool_phase: 'result', outcome: 'error', exit_code: 1 },
        }),
      ],
    });

    await act(async () => {
      root.render(
        createElement(consoleAgentHistoryList.ConsoleAgentHistoryList, {
          items: running,
          showToolCalls: true,
          showSystem: true,
          onLoadFullOutput: async (): Promise<unknown> => undefined,
        })
      );
    });
    expect(toolDetails(host, 'live-1').open).toBe(false);

    await act(async () => {
      root.render(
        createElement(consoleAgentHistoryList.ConsoleAgentHistoryList, {
          items: failed,
          showToolCalls: true,
          showSystem: true,
          onLoadFullOutput: async (): Promise<unknown> => undefined,
        })
      );
    });
    expect(toolDetails(host, 'live-1').open).toBe(true);
  });

  test('manually toggled Console row stays closed when the result is error', async () => {
    const running = buildAgentHistory({
      nodeId: 'review',
      events: [],
      rows: [
        toolWire({
          id: 'live-call',
          seq: 1,
          name: 'Bash',
          toolUseId: 'live-1',
          input: { cmd: 'bun test' },
          metadata: { tool_phase: 'call' },
        }),
      ],
    });
    const failed = buildAgentHistory({
      nodeId: 'review',
      events: [],
      rows: [
        toolWire({
          id: 'live-call',
          seq: 1,
          name: 'Bash',
          toolUseId: 'live-1',
          input: { cmd: 'bun test' },
          metadata: { tool_phase: 'call' },
        }),
        toolWire({
          id: 'live-result',
          seq: 2,
          name: 'Bash',
          toolUseId: 'live-1',
          output: 'boom',
          metadata: { tool_phase: 'result', outcome: 'error', exit_code: 1 },
        }),
      ],
    });

    await act(async () => {
      root.render(
        createElement(consoleAgentHistoryList.ConsoleAgentHistoryList, {
          items: running,
          showToolCalls: true,
          showSystem: true,
          onLoadFullOutput: async (): Promise<unknown> => undefined,
        })
      );
    });
    const details = toolDetails(host, 'live-1');
    expect(details.open).toBe(false);

    await act(async () => {
      toolSummary(details).click();
    });
    expect(details.open).toBe(true);

    await act(async () => {
      toolSummary(details).click();
    });
    expect(details.open).toBe(false);

    await act(async () => {
      root.render(
        createElement(consoleAgentHistoryList.ConsoleAgentHistoryList, {
          items: failed,
          showToolCalls: true,
          showSystem: true,
          onLoadFullOutput: async (): Promise<unknown> => undefined,
        })
      );
    });
    expect(toolDetails(host, 'live-1').open).toBe(false);
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
});
