process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';

import type { AgentHistoryItem } from '@/lib/agent-history';
import type {
  DagNode,
  WorkflowEventResponse,
  WorkflowNodeMessageResponse,
  WorkflowNodeMessagesResponse,
} from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import type { LogRow } from './build-log-rows';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const notifyManager = reactQuery.notifyManager;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

function workflowEvent(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
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

function row(overrides: Partial<LogRow> & Pick<LogRow, 'id' | 'nodeId' | 'label'>): LogRow {
  return {
    status: 'completed',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
    ...overrides,
  };
}

const SETUP_ROW: LogRow = row({
  id: 'start-setup',
  nodeId: 'setup',
  label: 'Setup',
});

const COMMAND_ROW: LogRow = row({
  id: 'start-command',
  nodeId: 'command',
  label: 'Command node',
  status: 'running',
});

const SHELL_ROW: LogRow = row({
  id: 'start-shell',
  nodeId: 'shell',
  label: 'Shell',
});

const GATE_ROW: LogRow = row({
  id: 'start-review',
  nodeId: 'review',
  label: 'Review',
  status: 'running',
});

const PLANNOTATOR_ROW: LogRow = row({
  id: 'start-gate',
  nodeId: 'gate',
  label: 'Gate',
  status: 'running',
});

const CHILD_ROW: LogRow = row({
  id: 'child-start-new',
  nodeId: 'child',
  label: 'Child',
});

const ROUTE_ROW: LogRow = row({
  id: 'route-2',
  nodeId: 'router',
  label: 'Router #2',
  selection: { kind: 'route_iteration', executionSeq: 2 },
});

const GROUP_ROW: LogRow = row({
  id: 'group-start',
  nodeId: 'group',
  label: 'Group ×2',
  status: 'failed',
  selection: { kind: 'loop_iteration', iteration: 2 },
});

const GROUP_NODE: DagNode = {
  id: 'group',
  loop_group: {
    max_iterations: 2,
    fresh_context: false,
    nodes: [
      { id: 'body', prompt: 'Work' },
      { id: 'check', prompt: 'Check', depends_on: ['body'] },
    ],
  },
};

const ROUTER_NODE: DagNode = {
  id: 'router',
  route_loop: {
    condition: '$review.output',
    max_iterations: 3,
    routes: { positive: 'done', negative: 'fix', exhausted: 'stop' },
  },
};

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function createLoadMessages(): {
  requests: [string, string][];
  loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
} {
  const requests: [string, string][] = [];
  const loadMessages = async (
    runId: string,
    nodeId: string
  ): Promise<WorkflowNodeMessagesResponse> => {
    requests.push([runId, nodeId]);
    return {
      messages: [
        {
          id: 'm1',
          seq: 1,
          kind: 'text',
          payload: { text: 'agent-text' },
          created_at: CREATED_AT,
        },
      ],
    };
  };
  return { requests, loadMessages };
}

function renderStatic(args: {
  row: LogRow | null;
  loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
  definitionNodes?: readonly DagNode[];
  definitionPending?: boolean;
  events?: readonly WorkflowEventResponse[];
  runStatus?: WorkflowRunStatus;
  approval?: unknown;
}): string {
  return renderToStaticMarkup(
    <legacyNodeRoom.LegacyNodeRoom
      runId="run-1"
      row={args.row}
      loadMessages={args.loadMessages}
      definitionNodes={args.definitionNodes ?? []}
      definitionPending={args.definitionPending ?? false}
      events={args.events ?? []}
      runStatus={args.runStatus ?? 'completed'}
      approval={args.approval ?? null}
      onApprove={async (): Promise<void> => undefined}
      onReject={async (): Promise<void> => undefined}
      pendingInteractions={[]}
      ownsUnscopedInteractions
      viewerIsStarter={false}
      starterDisplayName={null}
      actionStates={{}}
      onSubmitAsk={async (): Promise<void> => undefined}
      nodeState={undefined}
    />
  );
}

const INSTALLED_GLOBAL_KEYS = [
  'window',
  'document',
  'self',
  'HTMLElement',
  'Element',
  'Node',
  'Text',
  'DocumentFragment',
  'SVGElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'HTMLFormElement',
  'HTMLIFrameElement',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'InputEvent',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

function snapshotGlobals(): void {
  previousGlobals.clear();
  for (const key of INSTALLED_GLOBAL_KEYS) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
}

function restoreGlobals(): void {
  for (const key of INSTALLED_GLOBAL_KEYS) {
    const descriptor = previousGlobals.get(key);
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.defineProperty(globalThis, key, descriptor);
    }
  }
  previousGlobals.clear();
}

function installHappyDom(): Window {
  snapshotGlobals();
  const win = new Window({ url: 'https://localhost/' });
  const bag: Record<string, unknown> = {
    window: win,
    document: win.document,
    self: win,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    SVGElement: win.SVGElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLButtonElement: win.HTMLButtonElement,
    HTMLSelectElement: win.HTMLSelectElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    HTMLFormElement: win.HTMLFormElement,
    HTMLIFrameElement: win.HTMLIFrameElement,
    navigator: win.navigator,
    location: win.location,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      const handle = win.requestAnimationFrame(cb as unknown as (time: number) => void);
      return Number(handle);
    },
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    MutationObserver: win.MutationObserver,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
    FocusEvent: win.FocusEvent,
    InputEvent: win.InputEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  Object.assign(globalThis as object, bag);
  return win;
}

const legacyNodeRoomImportWindow = installHappyDom();
const legacyNodeRoom = await import('./LegacyNodeRoom');
const nodeRoom = await import('./NodeRoom');
const agentHistory = await import('@/lib/agent-history');
// Radix keeps import-time DOM references; restore globals but keep the window alive.
restoreGlobals();
void legacyNodeRoomImportWindow;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushUntil(host: Element, label: string, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt++) {
    await flush();
    if (predicate()) return;
  }
  throw new Error(`${label}: ${host.textContent ?? ''}`);
}

describe('LegacyNodeRoom static rooms', () => {
  test('renders bash stdout without invoking the transcript boundary', () => {
    let requests = 0;
    const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => {
      requests++;
      return { messages: [] };
    };
    const events = [
      workflowEvent({ id: 'start-setup', step_name: 'setup', event_type: 'node_started' }),
      workflowEvent({
        id: 'done-setup',
        step_name: 'setup',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: 'ready' },
      }),
    ];
    const markup = renderToStaticMarkup(
      <legacyNodeRoom.LegacyNodeRoom
        runId="run-1"
        row={SETUP_ROW}
        loadMessages={loadMessages}
        definitionNodes={[{ id: 'setup', bash: 'echo ready' }]}
        definitionPending={false}
        events={events}
        runStatus="completed"
        approval={null}
        onApprove={async (): Promise<void> => undefined}
        onReject={async (): Promise<void> => undefined}
        pendingInteractions={[]}
        ownsUnscopedInteractions
        viewerIsStarter={false}
        starterDisplayName={null}
        actionStates={{}}
        onSubmitAsk={async (): Promise<void> => undefined}
        nodeState={undefined}
      />
    );
    expect(markup).toContain('ready');
    expect(markup).toContain('Bash');
    expect(markup).toContain('completed');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="setup room"');
    expect(requests).toBe(0);
  });

  test('renders Select a node with no header, region, or message request', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({ row: null, loadMessages });
    expect(visibleText(markup)).toBe('Select a node');
    expect(markup).not.toContain('role="region"');
    expect(markup).not.toContain('<h2');
    expect(requests).toHaveLength(0);
  });

  test('renders script stdout from an event fallback without a definition', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: SHELL_ROW,
      loadMessages,
      events: [
        workflowEvent({
          id: 'start-shell',
          step_name: 'shell',
          event_type: 'node_started',
          data: { type: 'script' },
        }),
        workflowEvent({
          id: 'done-shell',
          step_name: 'shell',
          event_type: 'node_completed',
          data: { type: 'script', node_output: 'script-out' },
        }),
      ],
    });
    expect(markup).toContain('script-out');
    expect(markup).toContain('Script');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="shell room"');
    expect(requests).toHaveLength(0);
  });

  test('renders an approval message without a transcript request', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: GATE_ROW,
      loadMessages,
      definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
      runStatus: 'running',
    });
    expect(markup).toContain('Ship?');
    expect(markup).toContain('Approval');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="review room"');
    expect(requests).toHaveLength(0);
  });

  test('renders Open Plannotator from metadata fallback without a definition', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: PLANNOTATOR_ROW,
      loadMessages,
      runStatus: 'paused',
      approval: {
        nodeId: 'gate',
        message: 'Review the plan',
        type: 'plannotator_gate',
        reviewUrl: 'https://plannotator.example/r/1',
      },
    });
    expect(markup).toContain('Open Plannotator');
    expect(markup).toContain('Plannotator gate');
    expect(markup).toContain('https://plannotator.example/r/1');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="gate room"');
    expect(requests).toHaveLength(0);
  });

  test('renders the selected-attempt child link without a transcript request', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: CHILD_ROW,
      loadMessages,
      definitionNodes: [{ id: 'child', workflow: 'child-wf' }],
      events: [
        workflowEvent({
          id: 'child-start-old',
          step_name: 'child',
          event_type: 'node_started',
        }),
        workflowEvent({
          id: 'child-done-old',
          step_name: 'child',
          event_type: 'node_completed',
          data: { type: 'workflow', child_run_id: 'child-old' },
        }),
        workflowEvent({
          id: 'child-start-new',
          step_name: 'child',
          event_type: 'node_started',
        }),
        workflowEvent({
          id: 'child-done-new',
          step_name: 'child',
          event_type: 'node_completed',
          data: { type: 'workflow', child_run_id: 'child-1' },
        }),
      ],
    });
    expect(markup).toContain('Open child run');
    expect(markup).toContain('href="/legacy/workflows/runs/child-1"');
    expect(markup).not.toContain('child-old');
    expect(markup).toContain('Workflow');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="child room"');
    expect(requests).toHaveLength(0);
  });

  test('renders the matching route execution rather than a later different sequence', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: ROUTE_ROW,
      loadMessages,
      definitionNodes: [ROUTER_NODE],
      events: [
        workflowEvent({
          id: 'route-1',
          step_name: 'router',
          event_type: 'node_routed',
          data: {
            outcome: 'negative',
            to: 'fix',
            condition: '$review.output',
            condition_result: false,
            execution_seq: 1,
          },
        }),
        workflowEvent({
          id: 'route-2',
          step_name: 'router',
          event_type: 'node_routed',
          data: {
            outcome: 'positive',
            to: 'done',
            condition: '$review.output',
            condition_result: true,
            execution_seq: 2,
          },
        }),
        workflowEvent({
          id: 'route-3',
          step_name: 'router',
          event_type: 'node_routed',
          data: {
            outcome: 'exhausted',
            to: 'stop',
            condition: '$review.output',
            condition_result: false,
            execution_seq: 3,
          },
        }),
      ],
    });
    const text = visibleText(markup);
    expect(text).toContain('Route loop');
    expect(text).toContain('positive');
    expect(text).toContain('done');
    expect(text).not.toContain('exhausted');
    expect(text).not.toContain('stop');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="router room"');
    expect(requests).toHaveLength(0);
  });

  test('renders authored loop-group topology and the selected iteration', () => {
    const { requests, loadMessages } = createLoadMessages();
    const markup = renderStatic({
      row: GROUP_ROW,
      loadMessages,
      definitionNodes: [GROUP_NODE],
      runStatus: 'failed',
      events: [
        workflowEvent({
          id: 'group-start',
          step_name: 'group.body',
          event_type: 'node_started',
          data: { iteration: 1 },
        }),
        workflowEvent({
          id: 'body-1-done',
          step_name: 'group.body',
          event_type: 'node_completed',
          data: { iteration: 1 },
        }),
        workflowEvent({
          id: 'check-1-done',
          step_name: 'group.check',
          event_type: 'node_completed',
          data: { iteration: 1 },
        }),
        workflowEvent({
          id: 'body-2-done',
          step_name: 'group.body',
          event_type: 'node_completed',
          data: { iteration: 2 },
        }),
        workflowEvent({
          id: 'check-2-fail',
          step_name: 'group.check',
          event_type: 'node_failed',
          data: { iteration: 2, error: 'check failed' },
        }),
      ],
    });
    const text = visibleText(markup);
    expect(text).toContain('Loop group');
    expect(text).toContain('Body nodes');
    expect(text).toContain('Start');
    expect(text).toContain('After body');
    expect(text).toContain('×1 completed');
    expect(text).toContain('×2 failed');
    expect(markup.match(/<details[^>]*open/g)?.length).toBe(1);
    const openBlock = /<details[^>]*open[\s\S]*?<\/details>/.exec(markup);
    expect(openBlock?.[0]).toContain('×2 failed');
    expect(markup.match(/role="region"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="group room"');
    expect(requests).toHaveLength(0);
  });

  test('renders awaiting header with warning tokens and waiting on you', () => {
    const { requests, loadMessages } = createLoadMessages();
    const bashDef: readonly DagNode[] = [{ id: 'setup', bash: 'echo ready' }];
    const bashEvents = [
      workflowEvent({ id: 'start-setup', step_name: 'setup', event_type: 'node_started' }),
    ];

    const awaitingMarkup = renderStatic({
      row: row({
        id: 'start-setup',
        nodeId: 'setup',
        label: 'Setup',
        status: 'awaiting',
      }),
      loadMessages,
      definitionNodes: bashDef,
      events: bashEvents,
    });
    expect(awaitingMarkup).toContain('waiting on you');
    expect(awaitingMarkup).toContain('text-warning');
    expect(awaitingMarkup).not.toContain('>awaiting<');

    const runningMarkup = renderStatic({
      row: row({
        id: 'start-setup',
        nodeId: 'setup',
        label: 'Setup',
        status: 'running',
      }),
      loadMessages,
      definitionNodes: bashDef,
      events: bashEvents,
    });
    expect(runningMarkup).toContain('running');
    expect(runningMarkup).toContain('text-accent');
    expect(runningMarkup).not.toContain('waiting on you');

    const failedMarkup = renderStatic({
      row: row({
        id: 'start-setup',
        nodeId: 'setup',
        label: 'Setup',
        status: 'failed',
      }),
      loadMessages,
      definitionNodes: bashDef,
      events: bashEvents,
    });
    expect(failedMarkup).toContain('failed');
    expect(failedMarkup).toContain('text-error');
    expect(failedMarkup).not.toContain('waiting on you');
    expect(requests).toHaveLength(0);
  });
});

describe('LegacyNodeRoom dispatcher', () => {
  let win: Window;
  let host: Element;
  let root: Root;
  let queryClient: InstanceType<typeof reactQuery.QueryClient>;

  beforeEach(() => {
    notifyManager.setScheduler((cb: () => void): void => {
      cb();
    });
    notifyManager.setNotifyFunction((cb: () => void): void => {
      act(cb);
    });
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    queryClient = new reactQuery.QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    win.close();
    restoreGlobals();
    notifyManager.setScheduler((cb: () => void): void => {
      setTimeout(cb, 0);
    });
    notifyManager.setNotifyFunction((cb: () => void): void => {
      cb();
    });
  });

  function renderRoom(args: {
    row: LogRow | null;
    loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
    definitionNodes?: readonly DagNode[];
    definitionPending?: boolean;
    events?: readonly WorkflowEventResponse[];
    runStatus?: WorkflowRunStatus;
  }): void {
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(legacyNodeRoom.LegacyNodeRoom, {
          runId: 'run-1',
          row: args.row,
          loadMessages: args.loadMessages,
          definitionNodes: args.definitionNodes ?? [],
          definitionPending: args.definitionPending ?? false,
          events: args.events ?? [],
          runStatus: args.runStatus ?? 'running',
          approval: null,
          onApprove: async (): Promise<void> => undefined,
          onReject: async (): Promise<void> => undefined,
          pendingInteractions: [],
          ownsUnscopedInteractions: true,
          viewerIsStarter: false,
          starterDisplayName: null,
          actionStates: {},
          onSubmitAsk: async (): Promise<void> => undefined,
          nodeState: undefined,
        })
      )
    );
  }

  const bashEvents: readonly WorkflowEventResponse[] = [
    workflowEvent({ id: 'start-setup', step_name: 'setup', event_type: 'node_started' }),
    workflowEvent({
      id: 'done-setup',
      step_name: 'setup',
      event_type: 'node_completed',
      data: { type: 'bash', node_output: 'ready' },
    }),
  ];

  function requiredToolRow(toolUseId: string): Element & { open: boolean } {
    const el = host.querySelector(`details[data-tool-id="${toolUseId}"]`);
    if (el === null) throw new Error(`tool row ${toolUseId} missing: ${host.innerHTML}`);
    return el as Element & { open: boolean };
  }

  test('mounts NodeTranscriptPane for a command row and requests messages once', async () => {
    const { requests, loadMessages } = createLoadMessages();
    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [{ id: 'command', command: 'review' }],
      });
    });
    await flushUntil(
      host,
      'command transcript',
      () => requests.length === 1 && (host.textContent ?? '').includes('agent-text')
    );
    expect(requests).toEqual([['run-1', 'command']]);
    expect(host.textContent).toContain('Command');
    expect(host.textContent).toContain('running');
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="command room"]')).not.toBeNull();
  });

  test('requests messages only after rerendering from bash to command', async () => {
    const { requests, loadMessages } = createLoadMessages();
    await act(async () => {
      renderRoom({
        row: SETUP_ROW,
        loadMessages,
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'command', command: 'review' },
        ],
        events: bashEvents,
        runStatus: 'completed',
      });
    });
    await flush();
    expect(host.textContent).toContain('ready');
    expect(host.textContent).toContain('Bash');
    expect(requests).toHaveLength(0);

    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'command', command: 'review' },
        ],
        events: bashEvents,
      });
    });
    await flushUntil(host, 'command after bash', () => requests.length === 1);
    expect(requests).toEqual([['run-1', 'command']]);
    expect(host.querySelector('[aria-label="command room"]')).not.toBeNull();
  });

  test('keeps one labelled room and does not refetch when leaving command for bash', async () => {
    const { requests, loadMessages } = createLoadMessages();
    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'command', command: 'review' },
        ],
        events: bashEvents,
      });
    });
    await flushUntil(host, 'initial command', () => requests.length === 1);

    await act(async () => {
      renderRoom({
        row: SETUP_ROW,
        loadMessages,
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'command', command: 'review' },
        ],
        events: bashEvents,
        runStatus: 'completed',
      });
    });
    await flush();
    expect(requests).toEqual([['run-1', 'command']]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expect(host.textContent).toContain('ready');
  });

  test('shows Loading node room while the definition is pending, then mounts the command transcript', async () => {
    const { requests, loadMessages } = createLoadMessages();
    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionPending: true,
      });
    });
    await flush();
    expect(host.textContent).toContain('Loading');
    expect(host.textContent).toContain('Loading node room');
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="command room"]')).not.toBeNull();
    expect(requests).toHaveLength(0);

    await act(async () => {
      renderRoom({
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [{ id: 'command', command: 'review' }],
        definitionPending: false,
      });
    });
    await flushUntil(host, 'command after loading', () => requests.length === 1);
    expect(requests).toEqual([['run-1', 'command']]);
    expect(host.textContent).toContain('agent-text');
  });

  test('drained tool calls mount as collapsed disclosure rows', async () => {
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
        row: COMMAND_ROW,
        loadMessages,
        definitionNodes: [{ id: 'command', command: 'review' }],
        runStatus: 'completed',
      });
    });
    await flushUntil(
      host,
      'tool disclosure row',
      () => host.querySelector('details[data-tool-id="tool-use-1"]') !== null
    );
    const toolRow = requiredToolRow('tool-use-1');
    expect(toolRow.open).toBe(false);
    const summary = toolRow.querySelector('summary') as Element;
    expect(summary.textContent).toContain('Read');
    expect(summary.textContent).toContain('a.ts');
    expect(summary.textContent).toContain('succeeded');
    // Diagnostics stay hidden while the row is collapsed.
    for (const nested of Array.from(toolRow.querySelectorAll('details'))) {
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
        row: COMMAND_ROW,
        loadMessages: firstLoad,
        definitionNodes: [{ id: 'command', command: 'review' }],
        runStatus: 'completed',
      });
    });
    await flushUntil(
      host,
      'running tool row',
      () => host.querySelector('details[data-tool-id="tool-use-1"]') !== null
    );
    const running = requiredToolRow('tool-use-1');
    expect(running.open).toBe(false);

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
        row: COMMAND_ROW,
        loadMessages: secondLoad,
        definitionNodes: [{ id: 'command', command: 'review' }],
        runStatus: 'completed',
      });
    });
    await flushUntil(host, 'failed tool row auto-open', () => requiredToolRow('tool-use-1').open);
    const failed = requiredToolRow('tool-use-1');
    expect(failed.open).toBe(true);
    const summary = failed.querySelector('summary') as Element;
    expect(summary.textContent).toContain('failed');
    expect(summary.textContent).toContain('exit 2');
  });
});

describe('LegacyNodeRoom tool disclosure rows', () => {
  const NOW_MS = new Date(CREATED_AT).getTime() + 30_000;

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
    win.close();
    restoreGlobals();
  });

  function callRow(
    toolUseId: string,
    seq: number,
    name: string,
    input: unknown,
    metadata?: Record<string, unknown>
  ): WorkflowNodeMessageResponse {
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
  ): WorkflowNodeMessageResponse {
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
    rows: readonly WorkflowNodeMessageResponse[],
    events: readonly WorkflowEventResponse[] = []
  ): AgentHistoryItem[] {
    return agentHistory.buildAgentHistory({ rows, events, nodeId: 'command', nowMs: NOW_MS });
  }

  function mountItems(
    items: readonly AgentHistoryItem[],
    loadMessage?: (
      runId: string,
      nodeId: string,
      messageId: string
    ) => Promise<WorkflowNodeMessageResponse>
  ): void {
    root.render(
      createElement(nodeRoom.NodeRoom, {
        nodeId: 'command',
        items,
        unknownScope: false,
        runId: 'run-1',
        isPending: false,
        error: null,
        onRetry: (): void => undefined,
        loadMessage,
      })
    );
  }

  function toolRow(toolUseId: string): Element & { open: boolean } {
    const row = host.querySelector(`details[data-tool-id="${toolUseId}"]`);
    if (row === null) throw new Error(`row ${toolUseId} missing: ${host.innerHTML}`);
    return row as Element & { open: boolean };
  }

  function rowSummary(row: Element): HTMLElement {
    const summary = row.querySelector('summary');
    if (summary?.parentElement !== row) {
      throw new Error(`direct summary missing: ${row.outerHTML}`);
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

  const READ_ROWS: readonly WorkflowNodeMessageResponse[] = [
    callRow('t-1', 10, 'Read', { path: 'a.ts' }),
    resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', { outcome: 'success' }),
  ];

  test('mounts one collapsed disclosure row per projected tool call', async () => {
    await act(async () => {
      mountItems(historyItems(READ_ROWS));
    });
    const rows = host.querySelectorAll('details[data-tool-id]');
    expect(rows).toHaveLength(1);
    const row = toolRow('t-1');
    expect(row.open).toBe(false);
    const summary = rowSummary(row);
    expect(summary.textContent).toContain('Read');
    expect(summary.textContent).toContain('a.ts');
    expect(summaryAccessibleName(summary)).toBe('succeeded file · Read a.ts');
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
      mountItems(historyItems(READ_ROWS));
    });
    const row = toolRow('t-1');
    const summary = rowSummary(row);
    await act(async () => {
      click(summary);
    });
    expect(row.open).toBe(true);
    // A later render with freshly-projected items (same identities) preserves the choice.
    await act(async () => {
      mountItems(historyItems(READ_ROWS));
    });
    expect(toolRow('t-1').open).toBe(true);
    await act(async () => {
      click(rowSummary(toolRow('t-1')));
    });
    expect(toolRow('t-1').open).toBe(false);
    await act(async () => {
      mountItems(historyItems(READ_ROWS));
    });
    expect(toolRow('t-1').open).toBe(false);
  });

  test('summary is a native control — no role/tabindex shim — and keeps focus through activation', async () => {
    await act(async () => {
      mountItems(historyItems(READ_ROWS));
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
    const runningRows: readonly WorkflowNodeMessageResponse[] = [
      callRow('t-1', 10, 'Bash', { command: 'npm test' }),
    ];
    await act(async () => {
      mountItems(historyItems(runningRows));
    });
    expect(toolRow('t-1').open).toBe(false);

    const failedRows: readonly WorkflowNodeMessageResponse[] = [
      ...runningRows,
      resultRow('t-1', 11, 'Bash', { command: 'npm test' }, 'boom', {
        outcome: 'error',
        exit_code: 2,
      }),
    ];
    await act(async () => {
      mountItems(historyItems(failedRows));
    });
    expect(toolRow('t-1').open).toBe(true);

    // Still untouched: a later succeeded projection must not close the auto-opened row.
    const succeededRows: readonly WorkflowNodeMessageResponse[] = [
      runningRows[0],
      resultRow('t-1', 11, 'Bash', { command: 'npm test' }, 'ok', { outcome: 'success' }),
    ];
    await act(async () => {
      mountItems(historyItems(succeededRows));
    });
    expect(toolRow('t-1').open).toBe(true);
  });

  test('a touched row never auto-opens and never re-opens after the user closes it', async () => {
    const failedRows: readonly WorkflowNodeMessageResponse[] = [
      callRow('t-1', 10, 'Bash', { command: 'npm test' }),
      resultRow('t-1', 11, 'Bash', { command: 'npm test' }, 'boom', {
        outcome: 'error',
        exit_code: 2,
      }),
    ];
    await act(async () => {
      mountItems(historyItems(failedRows));
    });
    const row = toolRow('t-1');
    expect(row.open).toBe(true);
    await act(async () => {
      click(rowSummary(row));
    });
    expect(row.open).toBe(false);
    // Same failed data re-projected — the touched row stays closed.
    await act(async () => {
      mountItems(historyItems(failedRows));
    });
    expect(toolRow('t-1').open).toBe(false);
  });

  test('a new tool identity resets disclosure to its own initial policy', async () => {
    const failedA: readonly WorkflowNodeMessageResponse[] = [
      callRow('a', 10, 'Bash', { command: 'false' }),
      resultRow('a', 11, 'Bash', { command: 'false' }, 'nope', { outcome: 'error' }),
    ];
    await act(async () => {
      mountItems(historyItems(failedA));
    });
    expect(toolRow('a').open).toBe(true);

    // A different tool_use id replaces the row: fresh mount, fresh initial state.
    const succeededB: readonly WorkflowNodeMessageResponse[] = [
      callRow('b', 12, 'Read', { path: 'b.ts' }),
      resultRow('b', 13, 'Read', { path: 'b.ts' }, 'done', { outcome: 'success' }),
    ];
    await act(async () => {
      mountItems(historyItems(succeededB));
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
      mountItems(historyItems(failedA));
    });
    expect(toolRow('a').open).toBe(true);
    await act(async () => {
      mountItems(historyItems(succeededB));
    });
    expect(toolRow('b').open).toBe(false);
  });

  test('nested Input/Output toggles do not mark the outer row touched', async () => {
    await act(async () => {
      mountItems(historyItems(READ_ROWS));
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
    const failedRows: readonly WorkflowNodeMessageResponse[] = [
      READ_ROWS[0],
      resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'boom', {
        outcome: 'error',
        exit_code: 2,
      }),
    ];
    await act(async () => {
      mountItems(historyItems(failedRows));
    });
    const updated = toolRow('t-1');
    expect(updated.open).toBe(true);
    const updatedInput = updated.querySelectorAll('details')[0] as Element & { open: boolean };
    expect(updatedInput.open).toBe(true);
  });

  test('focus stays on the summary when later items append to the list', async () => {
    await act(async () => {
      mountItems(historyItems(READ_ROWS));
    });
    const summary = rowSummary(toolRow('t-1'));
    summary.focus();
    expect(win.document.activeElement as unknown as Element | null).toBe(summary);
    const appended: readonly WorkflowNodeMessageResponse[] = [
      ...READ_ROWS,
      callRow('t-2', 12, 'Bash', { command: 'ls' }),
      resultRow('t-2', 13, 'Bash', { command: 'ls' }, 'out', { outcome: 'success' }),
    ];
    await act(async () => {
      mountItems(historyItems(appended));
    });
    expect(win.document.activeElement as unknown as Element | null).toBe(summary);
    expect(toolRow('t-2').open).toBe(false);
  });

  test('full-output load disables the button, swaps the output, and refreshes the row badges', async () => {
    let resolveLoad: ((message: WorkflowNodeMessageResponse) => void) | null = null;
    const loadMessage = (): Promise<WorkflowNodeMessageResponse> =>
      new Promise<WorkflowNodeMessageResponse>(resolve => {
        resolveLoad = resolve;
      });
    const rows: readonly WorkflowNodeMessageResponse[] = [
      callRow('t-1', 10, 'Read', { path: 'a.ts' }, { full_output_available: true }),
      resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', {
        outcome: 'success',
        output_state: 'truncated',
        full_output_available: true,
      }),
    ];
    await act(async () => {
      mountItems(historyItems(rows), loadMessage);
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
      resolveLoad?.({
        id: 'result-t-1',
        seq: 11,
        kind: 'tool',
        payload: { name: 'Read', id: 't-1', input: { path: 'a.ts' }, output: 'FULL OUTPUT' },
        created_at: CREATED_AT,
      });
    });
    expect(row.textContent).toContain('FULL OUTPUT');
    // The row re-presented with output_state 'full': the truncated badge is gone.
    expect(rowSummary(row).textContent).not.toContain('truncated');
    expect(row.open).toBe(true);

    // A later poll must refresh outcome facts without discarding the fetched output.
    const failedRows: readonly WorkflowNodeMessageResponse[] = [
      rows[0],
      resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', {
        outcome: 'error',
        exit_code: 2,
        output_state: 'truncated',
        full_output_available: true,
      }),
    ];
    await act(async () => {
      mountItems(historyItems(failedRows), loadMessage);
    });
    expect(rowSummary(toolRow('t-1')).textContent).toContain('failed');
    expect(rowSummary(toolRow('t-1')).textContent).toContain('exit 2');
    expect(toolRow('t-1').textContent).toContain('FULL OUTPUT');
  });

  test('a failed full-output load shows the error and Retry reloads', async () => {
    let attempts = 0;
    const loadMessage = async (): Promise<WorkflowNodeMessageResponse> => {
      attempts++;
      if (attempts === 1) throw new Error('network down');
      return {
        id: 'result-t-1',
        seq: 11,
        kind: 'tool',
        payload: { name: 'Read', id: 't-1', input: { path: 'a.ts' }, output: 'FULL' },
        created_at: CREATED_AT,
      };
    };
    const rows: readonly WorkflowNodeMessageResponse[] = [
      callRow('t-1', 10, 'Read', { path: 'a.ts' }, { full_output_available: true }),
      resultRow('t-1', 11, 'Read', { path: 'a.ts' }, 'chunk', {
        outcome: 'success',
        output_state: 'truncated',
        full_output_available: true,
      }),
    ];
    await act(async () => {
      mountItems(historyItems(rows), loadMessage);
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
});
