process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ReactElement, RefObject } from 'react';
import type { Root } from 'react-dom/client';

import { foldNodeRuns, toRunEvent } from '../primitives/event';
import type { Message } from '../primitives/message';
import type { Run } from '../primitives/run';
import type {
  NodeExecution,
  PendingInteraction,
  WorkflowEvent,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
  WorkflowNodeState,
} from '../skills/runs';
import type { DagNode } from '../skills/workflows';
import { invalidate } from '../store/cache';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import type { ConsoleInspectPaneProps } from './ConsoleInspectPane';
import { buildConsoleLogEntries } from './inspect/build-console-log-entries';
import { buildLogRows } from './inspect/build-log-rows';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const inspectPane = await import('./ConsoleInspectPane');

const act = react.act;
const createElement = react.createElement;
const useState = react.useState;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-06-05T10:00:00.000Z';
const PROJECT_CWD = '/repo path';
const WORKFLOW_NAME = 'inspect-pane';

type ArtifactsAllowed = 'artifacts' extends ConsoleInspectPaneProps['view'] ? true : false;
const artifactsAreAllowed: ArtifactsAllowed = true;

function nodeState(
  overrides: Pick<WorkflowNodeState, 'nodeId' | 'name' | 'status'>
): WorkflowNodeState {
  return { retryEpoch: 0, ...overrides };
}

function workflowEvent(overrides: {
  id: string;
  event_type: string;
  step_name: string;
  created_at?: string;
  data?: Record<string, unknown>;
  event_order?: number;
}): WorkflowEvent {
  return {
    id: overrides.id,
    workflow_run_id: 'run-1',
    event_type: overrides.event_type,
    step_index: null,
    step_name: overrides.step_name,
    data: overrides.data ?? {},
    created_at: overrides.created_at ?? CREATED_AT,
    ...(overrides.event_order === undefined ? {} : { event_order: overrides.event_order }),
  };
}

function assistantMessage(id: string, content: string, timestamp: string): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    toolCalls: [],
    error: null,
    category: null,
    dispatch: null,
    workflowResult: null,
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
    workflow: WORKFLOW_NAME,
    origin: 'cli',
    status: 'running',
    startedAt: CREATED_AT,
    finishedAt: null,
    workingPath: null,
    userMessage: 'inspect',
    envOverlay: null,
    ...overrides,
  };
}

const DEFINITION_NODES: DagNode[] = [
  { id: 'plan', prompt: 'Plan the work.' },
  { id: 'loop', loop: { max_iterations: 2, fresh_context: false } },
];

const NODE_STATES: WorkflowNodeState[] = [
  nodeState({ nodeId: 'plan', name: 'Plan', status: 'completed' }),
  nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' }),
];

const RAW_EVENTS: WorkflowEvent[] = [
  workflowEvent({
    id: 'plan-start',
    event_type: 'node_started',
    step_name: 'plan',
    created_at: '2026-06-05T10:00:01Z',
    data: { name: 'Plan' },
  }),
  workflowEvent({
    id: 'plan-done',
    event_type: 'node_completed',
    step_name: 'plan',
    created_at: '2026-06-05T10:00:02Z',
    data: { name: 'Plan', duration_ms: 1000, num_turns: 2, stop_reason: 'end_turn' },
  }),
  workflowEvent({
    id: 'loop-start',
    event_type: 'node_started',
    step_name: 'loop',
    created_at: '2026-06-05T10:00:03Z',
    data: { name: 'Loop' },
  }),
  workflowEvent({
    id: 'loop-i1-start',
    event_type: 'loop_iteration_started',
    step_name: 'loop',
    created_at: '2026-06-05T10:00:03Z',
    data: { iteration: 1 },
  }),
  workflowEvent({
    id: 'loop-i1-done',
    event_type: 'loop_iteration_completed',
    step_name: 'loop',
    created_at: '2026-06-05T10:00:03.500Z',
    data: { iteration: 1, duration: 2000 },
  }),
  workflowEvent({
    id: 'loop-i2-start',
    event_type: 'loop_iteration_started',
    step_name: 'loop',
    created_at: '2026-06-05T10:00:09Z',
    data: { iteration: 2 },
  }),
];

const LOG_ENTRIES = buildConsoleLogEntries({
  rows: buildLogRows(NODE_STATES, RAW_EVENTS),
  rawEvents: RAW_EVENTS,
  nodeRuns: foldNodeRuns(RAW_EVENTS.map(toRunEvent)),
  runStartedAt: CREATED_AT,
});

const PLAN_TEXT = 'plan-transcript';
const PLAN_MESSAGES: WorkflowNodeMessage[] = [
  {
    id: 'm1',
    seq: 1,
    kind: 'text',
    payload: { text: PLAN_TEXT },
    created_at: CREATED_AT,
  },
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
    metadata: { text_mode: 'delta' },
    created_at: CREATED_AT,
  },
  {
    id: 'r2',
    seq: 2,
    kind: 'text',
    payload: { text: 'report ' },
    metadata: { text_mode: 'delta' },
    created_at: CREATED_AT,
  },
  {
    id: 'r3',
    seq: 3,
    kind: 'text',
    payload: { text: 'body"}' },
    metadata: { text_mode: 'delta' },
    created_at: CREATED_AT,
  },
];
const NESTED_DEFINITION_NODES: DagNode[] = [
  {
    id: 'group',
    loop_group: {
      max_iterations: 1,
      fresh_context: false,
      nodes: [{ id: 'child', prompt: 'Report', output_format: REPORT_SCHEMA }],
    },
  },
];
const CHILD_NODE_STATES: WorkflowNodeState[] = [
  nodeState({ nodeId: 'group', name: 'Group', status: 'completed' }),
  nodeState({ nodeId: 'group.child', name: 'Child', status: 'completed' }),
];
const CHILD_RAW_EVENTS: WorkflowEvent[] = [
  workflowEvent({
    id: 'group-start',
    event_type: 'node_started',
    step_name: 'group',
    created_at: '2026-06-05T10:00:01Z',
    data: { name: 'Group' },
  }),
  workflowEvent({
    id: 'child-start',
    event_type: 'node_started',
    step_name: 'group.child',
    created_at: '2026-06-05T10:00:02Z',
    data: { name: 'Child' },
  }),
  workflowEvent({
    id: 'child-done',
    event_type: 'node_completed',
    step_name: 'group.child',
    created_at: '2026-06-05T10:00:03Z',
    data: { name: 'Child', duration_ms: 1000 },
  }),
  workflowEvent({
    id: 'group-done',
    event_type: 'node_completed',
    step_name: 'group',
    created_at: '2026-06-05T10:00:04Z',
    data: { name: 'Group', duration_ms: 3000 },
  }),
];
const CHILD_LOG_ENTRIES = buildConsoleLogEntries({
  rows: buildLogRows(CHILD_NODE_STATES, CHILD_RAW_EVENTS),
  rawEvents: CHILD_RAW_EVENTS,
  nodeRuns: foldNodeRuns(CHILD_RAW_EVENTS.map(toRunEvent)),
  runStartedAt: CREATED_AT,
});

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

function requireHtmlElement(value: Element | null, label: string): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new Error(label);
  }
  return value;
}

function requireButton(value: Element | null, label: string): HTMLButtonElement {
  if (!(value instanceof HTMLButtonElement)) {
    throw new Error(label);
  }
  return value;
}

function PaneHarness({
  initialView,
  paneProps,
}: {
  initialView: ConsoleInspectPaneProps['view'];
  paneProps: Omit<ConsoleInspectPaneProps, 'view'>;
}): ReactElement {
  const [view, setView] = useState<ConsoleInspectPaneProps['view']>(initialView);
  return createElement(
    'div',
    null,
    createElement(
      'button',
      {
        type: 'button',
        'aria-label': 'Toggle inspect view',
        onClick: (): void => {
          setView((current: ConsoleInspectPaneProps['view']) =>
            current === 'log' ? 'graph' : 'log'
          );
        },
      },
      'toggle-view'
    ),
    createElement(inspectPane.ConsoleInspectPane, { ...paneProps, view })
  );
}

describe('ConsoleInspectPane', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  const logScrollRef: RefObject<HTMLDivElement | null> = { current: null };

  beforeEach(() => {
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
    invalidate('workflow-dag-nodes');
    invalidate('run-node-messages');
    invalidate('console-node-room:idle');
    invalidate('artifacts');
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

  function defaultLoadDefinition(workflowName: string, cwd: string): Promise<DagNode[]> {
    expect(workflowName).toBe(WORKFLOW_NAME);
    expect(cwd).toBe(PROJECT_CWD);
    return Promise.resolve(DEFINITION_NODES);
  }

  function defaultLoadMessages(
    runId: string,
    nodeId: string
  ): Promise<WorkflowNodeMessagesResponse> {
    void runId;
    void nodeId;
    return Promise.resolve({ messages: [...PLAN_MESSAGES] });
  }

  function baseProps(
    overrides: Partial<ConsoleInspectPaneProps> = {}
  ): Omit<ConsoleInspectPaneProps, 'view'> & { view?: ConsoleInspectPaneProps['view'] } {
    return {
      view: 'log',
      run: run(),
      projectId: 'proj/1',
      projectCwd: PROJECT_CWD,
      messages: [assistantMessage('plan-prose', 'plan output', '2026-06-05T10:00:01.500Z')],
      events: RAW_EVENTS.map(toRunEvent),
      rawEvents: RAW_EVENTS,
      nodeStates: NODE_STATES,
      approval: null,
      logEntries: LOG_ENTRIES,
      usage: null,
      streamNodeFilter: 'all',
      selectedNodeId: 'plan',
      selectedLogRowId: 'plan-start',
      showToolCalls: false,
      showSystem: false,
      logHeader: 'Log header',
      logFooter: 'Log footer',
      logScrollRef,
      onSelectNode: (): void => undefined,
      onCloseRoom: (): void => undefined,
      splitMode: 'split',
      loadDefinition: defaultLoadDefinition,
      loadMessages: defaultLoadMessages,
      pendingInteractions: [],
      viewerIsStarter: true,
      starterDisplayName: 'Avery',
      actionStates: {},
      onSubmitAsk: async (): Promise<void> => undefined,
      ...overrides,
    };
  }

  function renderPane(overrides: Partial<ConsoleInspectPaneProps> = {}): void {
    const props = baseProps(overrides);
    const view = props.view ?? 'log';
    root.render(createElement(inspectPane.ConsoleInspectPane, { ...props, view }));
  }

  test('switching log to graph keeps the same mounted room and does not reset the transcript loader', async () => {
    const calls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return Promise.resolve({ messages: [...PLAN_MESSAGES] });
    };
    const pendingAsk: PendingInteraction = {
      id: 'ask-plan',
      workflow_run_id: 'run-1',
      node_id: 'plan',
      tool_use_id: 'tool-not-persisted',
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
    };
    const props = baseProps({ loadMessages, pendingInteractions: [pendingAsk] });

    await act(async () => {
      root.render(
        createElement(PaneHarness, {
          initialView: 'log',
          paneProps: props,
        })
      );
    });
    await flushUntil('plan transcript', () => (host.textContent ?? '').includes(PLAN_TEXT));

    const roomBefore = host.querySelector('[aria-label="plan room"]');
    const formBefore = host.querySelector('form');
    expect(roomBefore).not.toBeNull();
    expect(formBefore).not.toBeNull();
    expect(calls.filter(call => call[0] === 'run-1' && call[1] === 'plan')).toHaveLength(1);
    expect(host.textContent).toContain('Log header');
    expect(host.querySelector('[data-testid="console-run-graph-scroller"]')).toBeNull();

    await act(async () => {
      requireButton(
        host.querySelector('[aria-label="Toggle inspect view"]'),
        'toggle-view'
      ).click();
    });
    await flushUntil(
      'graph after toggle',
      () => host.querySelector('[data-testid="console-run-graph-scroller"]') !== null
    );
    const roomAfter = host.querySelector('[aria-label="plan room"]');
    expect(roomAfter).toBe(roomBefore);
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).toContain(PLAN_TEXT);
    expect(host.textContent).not.toContain('Log header');
  });

  test('clicking a log divider or graph node invokes onSelectNode', async () => {
    const selected: { nodeId: string; rowId?: string }[] = [];
    await act(async () => {
      renderPane({
        view: 'log',
        onSelectNode: (nodeId: string, rowId?: string): void => {
          selected.push(rowId === undefined ? { nodeId } : { nodeId, rowId });
        },
      });
    });
    await flushUntil(
      'plan divider',
      () => host.querySelector('#node-transition-plan-start') !== null
    );

    const planRow = requireHtmlElement(
      host.querySelector('#node-transition-plan-start'),
      'plan row'
    );
    await act(async () => {
      requireButton(planRow.querySelector('button'), 'plan identity').click();
    });
    expect(selected).toEqual([{ nodeId: 'plan', rowId: 'plan-start' }]);

    await act(async () => {
      renderPane({
        view: 'graph',
        onSelectNode: (nodeId: string, rowId?: string): void => {
          selected.push(rowId === undefined ? { nodeId } : { nodeId, rowId });
        },
      });
    });
    await flushUntil('loop card', () => host.querySelector('[data-node-id="loop"]') !== null);

    await act(async () => {
      requireButton(host.querySelector('[data-node-id="loop"]'), 'loop card').click();
    });
    expect(selected).toEqual([{ nodeId: 'plan', rowId: 'plan-start' }, { nodeId: 'loop' }]);
  });

  test('log filter is independent of inspect selection and artifacts is a pane view', async () => {
    expect(artifactsAreAllowed).toBe(true);

    await act(async () => {
      renderPane({
        view: 'log',
        streamNodeFilter: 'plan',
        selectedNodeId: 'loop',
        selectedLogRowId: null,
      });
    });
    await flushUntil('filtered log', () => (host.textContent ?? '').includes('Plan'));

    expect(host.querySelector('#node-transition-plan-start')).not.toBeNull();
    expect(host.querySelector('#node-transition-loop-i1-start')).toBeNull();
    expect(host.querySelector('#node-transition-loop-i2-start')).toBeNull();
    expect(host.querySelector('[aria-label="loop room"]')).not.toBeNull();
    expect(host.textContent).toContain('×2');
  });

  test('selected row prefers the exact log row then the most recent row for the node', async () => {
    await act(async () => {
      renderPane({
        view: 'log',
        selectedNodeId: 'loop',
        selectedLogRowId: null,
      });
    });
    await flushUntil('latest loop row', () => (host.textContent ?? '').includes('×2'));
    expect(host.textContent).toContain('Loop ×2');

    await act(async () => {
      renderPane({
        view: 'log',
        selectedNodeId: 'loop',
        selectedLogRowId: 'loop-i1-start',
      });
    });
    await flushUntil('first loop row', () => (host.textContent ?? '').includes('×1'));
    expect(host.textContent).toContain('Loop ×1');
  });

  test('passes raw approval metadata to the room', async () => {
    const calls: [string, string][] = [];
    await act(async () => {
      renderPane({
        view: 'log',
        run: run({
          status: 'paused',
          approval: {
            nodeId: 'child',
            message: 'normalized approval message',
            completionSignaled: false,
          },
        }),
        selectedNodeId: 'child',
        selectedLogRowId: null,
        nodeStates: [
          ...NODE_STATES,
          nodeState({ nodeId: 'child', name: 'Child workflow', status: 'running' }),
        ],
        approval: {
          nodeId: 'child',
          message: 'Child workflow is paused',
          type: 'child_workflow',
          childRunId: 'child/run',
        },
        loadMessages: (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
          calls.push([runId, nodeId]);
          return Promise.resolve({ messages: [] });
        },
      });
    });
    await flushUntil('child workflow room', () =>
      (host.textContent ?? '').includes('Child workflow is paused')
    );

    expect(host.textContent).toContain('Child run');
    expect(host.textContent).toContain('Open child run');
    expect(host.textContent).not.toContain('Approval required');
    expect(calls.every(([, nodeId]) => nodeId !== 'child')).toBe(true);
  });

  test('definition loading and errors reach the graph while the room uses event fallback', async () => {
    const pending = deferred<DagNode[]>();
    const loadCalls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      loadCalls.push([runId, nodeId]);
      return Promise.resolve({ messages: [...PLAN_MESSAGES] });
    };

    await act(async () => {
      renderPane({
        view: 'graph',
        selectedNodeId: 'plan',
        loadDefinition: (): Promise<DagNode[]> => pending.promise,
        loadMessages,
      });
    });
    await flushUntil('definition pending', () =>
      (host.textContent ?? '').includes('Loading graph')
    );
    expect(host.textContent).toContain('Loading workflow definition');
    expect(loadCalls).toEqual([]);

    await act(async () => {
      pending.resolve(DEFINITION_NODES);
    });
    await flushUntil('definition ready', () => (host.textContent ?? '').includes(PLAN_TEXT));
    expect(host.querySelector('[data-node-id="plan"]')).not.toBeNull();
    expect(loadCalls).toEqual([['run-1', 'plan']]);

    const failed = deferred<DagNode[]>();
    await act(async () => {
      renderPane({
        view: 'graph',
        selectedNodeId: 'plan',
        projectCwd: '/other path',
        loadDefinition: (): Promise<DagNode[]> => failed.promise,
        loadMessages,
      });
    });
    await act(async () => {
      failed.reject(new Error('Workflow not found: missing'));
    });
    await flushUntil('definition error', () =>
      (host.textContent ?? '').includes('Could not load graph: Workflow not found: missing')
    );
    expect(host.querySelector('[data-testid="console-run-graph-canvas"]')).toBeNull();
    expect(host.textContent).toContain(PLAN_TEXT);
    expect(host.querySelector('[aria-label="plan room"]')).not.toBeNull();
  });

  test('inline history unwraps the structured envelope for a nested definition node', async () => {
    const loadMessages = (_runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> =>
      Promise.resolve({
        messages: nodeId === 'group.child' ? [...REPORT_MESSAGES] : [],
      });

    await act(async () => {
      renderPane({
        view: 'log',
        selectedNodeId: null,
        selectedLogRowId: null,
        nodeStates: CHILD_NODE_STATES,
        events: CHILD_RAW_EVENTS.map(toRunEvent),
        rawEvents: CHILD_RAW_EVENTS,
        logEntries: CHILD_LOG_ENTRIES,
        loadDefinition: (): Promise<DagNode[]> => Promise.resolve(NESTED_DEFINITION_NODES),
        loadMessages,
      });
    });
    await flushUntil('nested structured history', () =>
      (host.textContent ?? '').includes(REPORT_TEXT)
    );
    expect(host.textContent).toContain(REPORT_TEXT);
    expect(host.textContent).not.toContain('{"report"');
  });

  test('inline history renders the raw envelope until the nested definition resolves', async () => {
    const pending = deferred<DagNode[]>();
    const loadMessages = (_runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> =>
      Promise.resolve({
        messages: nodeId === 'group.child' ? [...REPORT_MESSAGES] : [],
      });
    const overrides: Partial<ConsoleInspectPaneProps> = {
      view: 'log',
      selectedNodeId: null,
      selectedLogRowId: null,
      nodeStates: CHILD_NODE_STATES,
      events: CHILD_RAW_EVENTS.map(toRunEvent),
      rawEvents: CHILD_RAW_EVENTS,
      logEntries: CHILD_LOG_ENTRIES,
      loadMessages,
    };

    await act(async () => {
      renderPane({ ...overrides, loadDefinition: (): Promise<DagNode[]> => pending.promise });
    });
    await flushUntil('raw inline history', () => (host.textContent ?? '').includes('{"report"'));
    expect(host.textContent).toContain('{"report"');

    await act(async () => {
      pending.resolve(NESTED_DEFINITION_NODES);
    });
    await flushUntil('resolved inline history', () =>
      (host.textContent ?? '').includes(REPORT_TEXT)
    );
    expect(host.textContent).toContain(REPORT_TEXT);
    expect(host.textContent).not.toContain('{"report"');
  });

  test('split layout uses a fixed 520px room and omits the room when unselected', async () => {
    await act(async () => {
      renderPane({
        view: 'log',
        selectedNodeId: null,
        selectedLogRowId: null,
      });
    });
    await flushUntil(
      'unselected layout',
      () => host.querySelector('[data-testid="console-inspect-pane"]') !== null
    );
    expect(host.querySelector('[data-testid="console-inspect-room"]')).toBeNull();
    expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(host.querySelector('[aria-label="Resize node room"]')).toBeNull();
    expect(host.querySelector('#console-run-view')).not.toBeNull();
    expect(host.querySelector('#console-run-room')).toBeNull();

    await act(async () => {
      renderPane({ view: 'log', selectedNodeId: 'plan', selectedLogRowId: 'plan-start' });
    });
    await flushUntil(
      'selected layout',
      () => host.querySelector('[data-testid="console-inspect-room"]') !== null
    );
    const viewPanel = requireHtmlElement(host.querySelector('#console-run-view'), 'console view');
    const roomPanel = requireHtmlElement(host.querySelector('#console-run-room'), 'console room');
    expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(host.querySelector('[aria-label="Resize node room"]')).toBeNull();
    expect(roomPanel.className).toContain('shrink-0');
    expect(roomPanel.style.width).toBe('520px');
    expect(viewPanel.className).toContain('flex-1');
    expect(viewPanel.className).toContain('min-w-0');
    expect(roomPanel.className).toContain('border-l');
    expect(host.querySelector('[data-testid="console-inspect-pane"]')?.className).not.toContain(
      'lg:flex-row'
    );
    expect(
      host.querySelector('[data-testid="console-inspect-room"]')?.className ?? ''
    ).not.toContain('lg:w-[460px]');

    await act(async () => {
      renderPane({ view: 'log', selectedNodeId: 'plan', selectedLogRowId: 'plan-start' });
    });
    await flushUntil(
      'rerendered fixed room',
      () => host.querySelector('#console-run-room') !== null
    );
    expect(
      requireHtmlElement(host.querySelector('#console-run-room'), 'rerender room').style.width
    ).toBe('520px');
  });

  test('single mode keeps the main pane mounted with hidden and Back closes the room', async () => {
    const closes: number[] = [];
    await act(async () => {
      renderPane({ view: 'log', splitMode: 'split' });
    });
    await flushUntil('split room', () => (host.textContent ?? '').includes(PLAN_TEXT));
    const splitMain = requireHtmlElement(
      host.querySelector('#console-run-view'),
      'split main pane'
    );
    expect(
      requireHtmlElement(host.querySelector('#console-run-room'), 'split room').style.width
    ).toBe('520px');

    await act(async () => {
      renderPane({
        view: 'log',
        splitMode: 'single',
        onCloseRoom: (): void => {
          closes.push(1);
        },
      });
    });
    await flushUntil('single room', () => (host.textContent ?? '').includes(PLAN_TEXT));
    const main = requireHtmlElement(host.querySelector('#console-run-view'), 'main pane');
    expect(main).toBe(splitMain);
    expect(main.className.split(/\s+/)).toContain('hidden');
    expect(main.className.split(/\s+/)).not.toContain('flex');
    expect(main.hasAttribute('hidden')).toBe(false);
    expect(host.textContent).toContain('Log header');
    expect(host.querySelector('[role="separator"]')).toBeNull();
    const singleRoom = requireHtmlElement(
      host.querySelector('#console-run-room'),
      'single console room'
    );
    expect(singleRoom.style.width).toBe('');
    expect(singleRoom.className).toContain('flex-1');
    expect(singleRoom.className).toContain('w-full');

    const back = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Back')
    );
    if (back === undefined) throw new Error('missing Back');
    await act(async () => {
      back.click();
    });
    expect(closes).toEqual([1]);

    await act(async () => {
      renderPane({
        view: 'log',
        splitMode: 'single',
        selectedNodeId: null,
        selectedLogRowId: null,
      });
    });
    await flushUntil(
      'single closed',
      () => host.querySelector('[data-testid="console-inspect-room"]') === null
    );
    const restored = requireHtmlElement(host.querySelector('#console-run-view'), 'restored main');
    expect(restored.className.split(/\s+/)).toContain('flex');
    expect(restored.className.split(/\s+/)).not.toContain('hidden');
    expect(host.textContent).toContain('Log header');
  });

  test('ignores stored archon.run-room.ratio keys and never writes them', async () => {
    const key = 'archon.run-room.ratio.console';
    globalThis.localStorage.setItem(key, '48');
    const originalSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    const writes: string[] = [];
    globalThis.localStorage.setItem = (name: string, value: string): void => {
      writes.push(name);
      originalSetItem(name, value);
    };

    try {
      await act(async () => {
        renderPane({ view: 'log', splitMode: 'split' });
      });
      await flushUntil('stale split room', () => host.querySelector('#console-run-room') !== null);
      expect(
        requireHtmlElement(host.querySelector('#console-run-room'), 'stale split room').style.width
      ).toBe('520px');

      await act(async () => {
        renderPane({ view: 'log', splitMode: 'single' });
      });
      await flushUntil('stale single room', () => host.querySelector('#console-run-room') !== null);
      expect(
        requireHtmlElement(host.querySelector('#console-run-room'), 'stale single room').style.width
      ).toBe('');
      expect(writes.some(name => name.includes('run-room.ratio'))).toBe(false);
      expect(globalThis.localStorage.getItem(key)).toBe('48');
    } finally {
      globalThis.localStorage.setItem = originalSetItem;
      globalThis.localStorage.removeItem(key);
    }
  });

  test('Artifacts occupies the main pane while the same room stays docked', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (raw.includes('/artifacts')) {
        return Promise.resolve(
          new Response(JSON.stringify({ files: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ error: raw }), { status: 404 }));
    }) as typeof fetch);

    await act(async () => {
      renderPane({ view: 'log' });
    });
    await flushUntil('log room', () => (host.textContent ?? '').includes(PLAN_TEXT));
    const roomBefore = host.querySelector('[aria-label="plan room"]');
    expect(roomBefore).not.toBeNull();

    await act(async () => {
      renderPane({ view: 'artifacts' });
    });
    await flushUntil('artifacts pane', () =>
      (host.textContent ?? '').includes('No artifacts written to disk for this run.')
    );
    expect(host.querySelector('[aria-label="plan room"]')).toBe(roomBefore);
    expect(host.querySelector('[data-testid="console-inspect-room"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="console-run-graph-scroller"]')).toBeNull();

    await act(async () => {
      renderPane({ view: 'graph' });
    });
    await flushUntil(
      'graph after artifacts',
      () => host.querySelector('[data-testid="console-run-graph-scroller"]') !== null
    );
    expect(host.querySelector('[aria-label="plan room"]')).toBe(roomBefore);
    fetchSpy.mockRestore();
  });

  test('same-lineage finished occurrence shows finished-iteration dock', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      let pathname = raw;
      try {
        pathname = new URL(raw, 'http://localhost').pathname;
      } catch {
        pathname = raw.split('?')[0] ?? raw;
      }
      if (method === 'GET' && pathname.endsWith('/queue')) {
        return new Response(JSON.stringify({ success: true, queued: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && pathname.includes('/messages')) {
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return Promise.reject(new Error(`unexpected fetch ${method} ${raw}`));
    }) as typeof fetch;

    try {
      const executions: NodeExecution[] = [
        {
          node_id: 'loop',
          status: 'completed',
          occurrence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          attempt_id: '11111111-1111-4111-8111-111111111111',
          loop_ancestry: [{ node_id: 'loop', iteration: 1 }],
        },
        {
          node_id: 'loop',
          status: 'running',
          occurrence_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          attempt_id: '22222222-2222-4222-8222-222222222222',
          loop_ancestry: [{ node_id: 'loop', iteration: 2 }],
        },
      ];
      const finishedId =
        'exec:loop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111:0';
      const loopStates = [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })];
      const loopEntries = buildConsoleLogEntries({
        rows: buildLogRows(loopStates, [], executions, CREATED_AT),
        rawEvents: [],
        nodeRuns: [],
        runStartedAt: CREATED_AT,
      });
      const selected: string[] = [];

      await act(async () => {
        renderPane({
          run: run({ id: 'run-loop', status: 'running' }),
          nodeStates: loopStates,
          events: [],
          rawEvents: [],
          logEntries: loopEntries,
          selectedNodeId: 'loop',
          selectedLogRowId: finishedId,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [{ id: 'loop', prompt: 'iterate' }],
          onSelectNode: (nodeId: string, rowId?: string): void => {
            if (rowId !== undefined) selected.push(rowId);
            void nodeId;
          },
        });
      });
      await flush();
      await flushUntil('finished dock', () =>
        (host.textContent ?? '').includes('reading a finished iteration')
      );
      expect(host.textContent).toContain(
        'reading a finished iteration · the agent is working in iteration 2'
      );
      const go = [...host.querySelectorAll('button')].find(
        b => (b.textContent ?? '').trim() === 'Go to iteration 2'
      );
      expect(go).not.toBeUndefined();
      await act(async () => {
        if (go === undefined) throw new Error('missing Go button');
        go.click();
      });
      await flush();
      expect(selected).toEqual([
        'exec:loop:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:22222222-2222-4222-8222-222222222222:1',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('retry-epoch mismatch fail-closes the finished dock', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      let pathname = raw;
      try {
        pathname = new URL(raw, 'http://localhost').pathname;
      } catch {
        pathname = raw.split('?')[0] ?? raw;
      }
      if (method === 'GET' && (pathname.endsWith('/queue') || pathname.includes('/messages'))) {
        return new Response(
          JSON.stringify(
            pathname.endsWith('/queue') ? { success: true, queued: [] } : { messages: [] }
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${method} ${raw}`));
    }) as typeof fetch;

    try {
      const executions: NodeExecution[] = [
        {
          node_id: 'loop',
          status: 'completed',
          occurrence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          attempt_id: '11111111-1111-4111-8111-111111111111',
          retry_epoch: 0,
          loop_ancestry: [{ node_id: 'loop', iteration: 1 }],
        },
        {
          node_id: 'loop',
          status: 'running',
          occurrence_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          attempt_id: '22222222-2222-4222-8222-222222222222',
          retry_epoch: 1,
          loop_ancestry: [{ node_id: 'loop', iteration: 2 }],
        },
      ];
      const finishedId =
        'exec:loop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111:0';
      const loopStates = [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })];
      const loopEntries = buildConsoleLogEntries({
        rows: buildLogRows(loopStates, [], executions, CREATED_AT),
        rawEvents: [],
        nodeRuns: [],
        runStartedAt: CREATED_AT,
      });

      await act(async () => {
        renderPane({
          run: run({ id: 'run-loop', status: 'running' }),
          nodeStates: loopStates,
          events: [],
          rawEvents: [],
          logEntries: loopEntries,
          selectedNodeId: 'loop',
          selectedLogRowId: finishedId,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [{ id: 'loop', prompt: 'iterate' }],
        });
      });
      await flush();
      expect(host.textContent ?? '').not.toContain('reading a finished iteration');
      expect(
        [...host.querySelectorAll('button')].some(b =>
          (b.textContent ?? '').includes('Go to iteration')
        )
      ).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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

  test('T3.16 Console wrapper passes exact node terminal inputs; nodeStates never prove terminal', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      let pathname = raw;
      try {
        pathname = new URL(raw, 'http://localhost').pathname;
      } catch {
        pathname = raw.split('?')[0] ?? raw;
      }
      if (method === 'GET' && (pathname.endsWith('/queue') || pathname.includes('/messages'))) {
        return new Response(
          JSON.stringify(
            pathname.endsWith('/queue') ? { success: true, queued: [] } : { messages: [] }
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${method} ${raw}`));
    }) as typeof fetch;

    try {
      const alphaEvents: WorkflowEvent[] = [
        workflowEvent({
          id: 'start-a',
          event_type: 'node_started',
          step_name: 'alpha',
          data: { occurrence_id: 'occ-a' },
          event_order: 1,
        }),
        workflowEvent({
          id: 'done-a',
          event_type: 'node_completed',
          step_name: 'alpha',
          data: { occurrence_id: 'occ-a' },
          event_order: 2,
        }),
        workflowEvent({
          id: 'start-b',
          event_type: 'node_started',
          step_name: 'beta',
          data: { occurrence_id: 'occ-b' },
          event_order: 3,
        }),
      ];

      const nodeStates = [
        nodeState({ nodeId: 'alpha', name: 'Alpha', status: 'completed' }),
        nodeState({ nodeId: 'beta', name: 'Beta', status: 'running' }),
      ];
      // Settled nodeStates say alpha completed, but raw executions keep alpha running —
      // terminal proof must ignore nodeStates.
      const unsettledExecutions: NodeExecution[] = [
        { node_id: 'alpha', status: 'running', occurrence_id: 'occ-a' },
        { node_id: 'beta', status: 'running', occurrence_id: 'occ-b' },
      ];
      const logEntries = buildConsoleLogEntries({
        rows: buildLogRows(nodeStates, alphaEvents, unsettledExecutions, CREATED_AT),
        rawEvents: alphaEvents,
        nodeRuns: foldNodeRuns(alphaEvents.map(toRunEvent)),
        runStartedAt: CREATED_AT,
      });

      await act(async () => {
        renderPane({
          run: run({ id: 'run-term', status: 'running' }),
          nodeStates,
          events: alphaEvents.map(toRunEvent),
          rawEvents: alphaEvents,
          nodeExecutions: unsettledExecutions,
          logEntries,
          selectedNodeId: 'alpha',
          selectedLogRowId: logEntries.find(e => e.row.nodeId === 'alpha')?.row.id ?? null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [
            { id: 'alpha', prompt: 'A' },
            { id: 'beta', prompt: 'B' },
          ],
        });
      });
      await flush();

      const room = host.querySelector('[data-testid="console-inspect-room"]');
      expect(room).not.toBeNull();
      if (room === null) throw new Error('missing room');
      const openProps = findPropsWithKey(room, 'nodeTerminal');
      expect(openProps?.nodeTerminal).toBe(false);
      expect(openProps?.nodeExecutionKey).toBe('occ-a');

      const settledExecutions: NodeExecution[] = [
        { node_id: 'alpha', status: 'completed', occurrence_id: 'occ-a' },
        { node_id: 'beta', status: 'running', occurrence_id: 'occ-b' },
      ];
      const settledEntries = buildConsoleLogEntries({
        rows: buildLogRows(nodeStates, alphaEvents, settledExecutions, CREATED_AT),
        rawEvents: alphaEvents,
        nodeRuns: foldNodeRuns(alphaEvents.map(toRunEvent)),
        runStartedAt: CREATED_AT,
      });
      await act(async () => {
        renderPane({
          run: run({ id: 'run-term', status: 'running' }),
          nodeStates,
          events: alphaEvents.map(toRunEvent),
          rawEvents: alphaEvents,
          nodeExecutions: settledExecutions,
          logEntries: settledEntries,
          selectedNodeId: 'alpha',
          selectedLogRowId: settledEntries.find(e => e.row.nodeId === 'alpha')?.row.id ?? null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [
            { id: 'alpha', prompt: 'A' },
            { id: 'beta', prompt: 'B' },
          ],
        });
      });
      await flush();

      const settledRoom = host.querySelector('[data-testid="console-inspect-room"]');
      expect(settledRoom).not.toBeNull();
      if (settledRoom === null) throw new Error('missing settled room');
      const settledProps = findPropsWithKey(settledRoom, 'nodeTerminal');
      expect(settledProps?.nodeTerminal).toBe(true);
      expect(settledProps?.nodeExecutionKey).toBe('occ-a');

      // Sibling beta remains nonterminal even with terminal alpha history.
      await act(async () => {
        renderPane({
          run: run({ id: 'run-term', status: 'running' }),
          nodeStates,
          events: alphaEvents.map(toRunEvent),
          rawEvents: alphaEvents,
          nodeExecutions: settledExecutions,
          logEntries: settledEntries,
          selectedNodeId: 'beta',
          selectedLogRowId: settledEntries.find(e => e.row.nodeId === 'beta')?.row.id ?? null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [
            { id: 'alpha', prompt: 'A' },
            { id: 'beta', prompt: 'B' },
          ],
        });
      });
      await flush();
      const betaRoom = host.querySelector('[data-testid="console-inspect-room"]');
      expect(betaRoom).not.toBeNull();
      if (betaRoom === null) throw new Error('missing beta room');
      const betaProps = findPropsWithKey(betaRoom, 'nodeTerminal');
      expect(betaProps?.nodeTerminal).toBe(false);
      expect(betaProps?.nodeExecutionKey).toBe('occ-b');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('T3.17 completed occurrence selection stays nonterminal with stable execution key', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      let pathname = raw;
      try {
        pathname = new URL(raw, 'http://localhost').pathname;
      } catch {
        pathname = raw.split('?')[0] ?? raw;
      }
      if (method === 'GET' && (pathname.endsWith('/queue') || pathname.includes('/messages'))) {
        return new Response(
          JSON.stringify(
            pathname.endsWith('/queue') ? { success: true, queued: [] } : { messages: [] }
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${method} ${raw}`));
    }) as typeof fetch;

    try {
      const finishedId =
        'exec:loop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111:0';
      const liveId =
        'exec:loop:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:22222222-2222-4222-8222-222222222222:1';
      const events: WorkflowEvent[] = [
        workflowEvent({
          id: 'start-1',
          event_type: 'node_started',
          step_name: 'loop',
          data: { occurrence_id: 'logical-key-1' },
          event_order: 1,
        }),
        workflowEvent({
          id: 'start-2',
          event_type: 'node_started',
          step_name: 'loop',
          data: { occurrence_id: 'logical-key-1' },
          event_order: 2,
        }),
      ];

      const executions: NodeExecution[] = [
        {
          node_id: 'loop',
          status: 'completed',
          occurrence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          attempt_id: '11111111-1111-4111-8111-111111111111',
          loop_ancestry: [{ node_id: 'loop', iteration: 1 }],
        },
        {
          node_id: 'loop',
          status: 'running',
          occurrence_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          attempt_id: '22222222-2222-4222-8222-222222222222',
          loop_ancestry: [{ node_id: 'loop', iteration: 2 }],
        },
      ];
      const loopStates = [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })];
      const loopEntries = buildConsoleLogEntries({
        rows: buildLogRows(loopStates, events, executions, CREATED_AT),
        rawEvents: events,
        nodeRuns: foldNodeRuns(events.map(toRunEvent)),
        runStartedAt: CREATED_AT,
      });

      await act(async () => {
        renderPane({
          run: run({ id: 'run-loop', status: 'running' }),
          nodeStates: loopStates,
          events: events.map(toRunEvent),
          rawEvents: events,
          nodeExecutions: executions,
          logEntries: loopEntries,
          selectedNodeId: 'loop',
          selectedLogRowId: finishedId,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [{ id: 'loop', prompt: 'iterate' }],
        });
      });
      await flush();

      const room = host.querySelector('[data-testid="console-inspect-room"]');
      expect(room).not.toBeNull();
      if (room === null) throw new Error('missing room');
      const finishedProps = findPropsWithKey(room, 'nodeTerminal');
      expect(finishedProps?.nodeTerminal).toBe(false);
      expect(finishedProps?.nodeExecutionKey).toBe('logical-key-1');

      await act(async () => {
        renderPane({
          run: run({ id: 'run-loop', status: 'running' }),
          nodeStates: loopStates,
          events: events.map(toRunEvent),
          rawEvents: events,
          nodeExecutions: executions,
          logEntries: loopEntries,
          selectedNodeId: 'loop',
          selectedLogRowId: liveId,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [{ id: 'loop', prompt: 'iterate' }],
        });
      });
      await flush();

      const liveRoom = host.querySelector('[data-testid="console-inspect-room"]');
      expect(liveRoom).not.toBeNull();
      if (liveRoom === null) throw new Error('missing live room');
      const liveProps = findPropsWithKey(liveRoom, 'nodeTerminal');
      expect(liveProps?.nodeTerminal).toBe(false);
      expect(liveProps?.nodeExecutionKey).toBe('logical-key-1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('T4.16 idleAwaitExpired reaches selected room including grp.body', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      let pathname = raw;
      try {
        pathname = new URL(raw, 'http://localhost').pathname;
      } catch {
        pathname = raw.split('?')[0] ?? raw;
      }
      if (method === 'GET' && (pathname.endsWith('/queue') || pathname.includes('/messages'))) {
        return new Response(
          JSON.stringify(
            pathname.endsWith('/queue') ? { success: true, queued: [] } : { messages: [] }
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${method} ${raw}`));
    }) as typeof fetch;

    const expired = 'interrupted by operator, no redirect received';
    try {
      const events: WorkflowEvent[] = [
        workflowEvent({
          id: 'start-body',
          event_type: 'node_started',
          step_name: 'grp.body',
          data: { occurrence_id: 'occ-body' },
          event_order: 1,
        }),
        workflowEvent({
          id: 'fail-body',
          event_type: 'node_failed',
          step_name: 'grp.body',
          data: { occurrence_id: 'occ-body', error: expired },
          event_order: 2,
        }),
        workflowEvent({
          id: 'fail-grp',
          event_type: 'node_failed',
          step_name: 'grp',
          data: { occurrence_id: 'occ-grp', error: `Loop group failed: body: ${expired}` },
          event_order: 3,
        }),
      ];
      const nodeStates = [
        nodeState({ nodeId: 'grp', name: 'Group', status: 'failed' }),
        nodeState({ nodeId: 'grp.body', name: 'Body', status: 'failed' }),
      ];
      const nodeExecutions: NodeExecution[] = [
        {
          node_id: 'grp',
          status: 'failed',
          occurrence_id: 'occ-grp',
          error: `Loop group failed: body: ${expired}`,
        },
        {
          node_id: 'grp.body',
          status: 'failed',
          occurrence_id: 'occ-body',
          error: expired,
        },
      ];
      const logEntries = buildConsoleLogEntries({
        rows: buildLogRows(nodeStates, events, nodeExecutions, CREATED_AT),
        rawEvents: events,
        nodeRuns: foldNodeRuns(events.map(toRunEvent)),
        runStartedAt: CREATED_AT,
      });

      await act(async () => {
        renderPane({
          run: run({ id: 'run-expire', status: 'failed' }),
          nodeStates,
          events: events.map(toRunEvent),
          rawEvents: events,
          nodeExecutions,
          logEntries,
          selectedNodeId: 'grp.body',
          selectedLogRowId: logEntries.find(e => e.row.nodeId === 'grp.body')?.row.id ?? null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [
            {
              id: 'grp',
              loop_group: {
                max_iterations: 1,
                fresh_context: false,
                nodes: [{ id: 'body', prompt: 'Work' }],
              },
            },
          ],
        });
      });
      await flush();

      const bodyRoom = host.querySelector('[data-testid="console-inspect-room"]');
      expect(bodyRoom).not.toBeNull();
      if (bodyRoom === null) throw new Error('missing body room');
      const bodyProps = findPropsWithKey(bodyRoom, 'idleAwaitExpired');
      expect(bodyProps).not.toBeNull();
      expect(bodyProps?.idleAwaitExpired).toBe(true);
      expect(bodyProps?.nodeTerminal).toBe(true);

      await act(async () => {
        renderPane({
          run: run({ id: 'run-expire', status: 'failed' }),
          nodeStates,
          events: events.map(toRunEvent),
          rawEvents: events,
          nodeExecutions,
          logEntries,
          selectedNodeId: 'grp',
          selectedLogRowId: logEntries.find(e => e.row.nodeId === 'grp')?.row.id ?? null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          loadDefinition: async (): Promise<DagNode[]> => [
            {
              id: 'grp',
              loop_group: {
                max_iterations: 1,
                fresh_context: false,
                nodes: [{ id: 'body', prompt: 'Work' }],
              },
            },
          ],
        });
      });
      await flush();

      const groupRoom = host.querySelector('[data-testid="console-inspect-room"]');
      expect(groupRoom).not.toBeNull();
      if (groupRoom === null) throw new Error('missing group room');
      const groupProps = findPropsWithKey(groupRoom, 'idleAwaitExpired');
      expect(groupProps?.idleAwaitExpired).toBe(false);
      expect(groupProps?.nodeTerminal).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
