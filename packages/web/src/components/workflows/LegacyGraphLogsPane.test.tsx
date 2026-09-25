process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import type {
  AskAnswerBody,
  ConversationResponse,
  DagNode,
  MessageResponse,
  NodeExecution,
  PendingInteraction,
  WorkflowEventResponse,
  WorkflowNodeMessagesResponse,
  WorkflowNodeStateResponse,
} from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';
import type { Root } from 'react-dom/client';
import type { LegacyGraphLogsPaneProps } from './LegacyGraphLogsPane';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const notifyManager = reactQuery.notifyManager;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const PARENT_CONVERSATION: ConversationResponse = {
  id: 'conversation-1',
  platform_type: 'web',
  platform_conversation_id: 'parent-1',
  codebase_id: null,
  cwd: null,
  isolation_env_id: null,
  ai_assistant_type: 'claude',
  title: 'Parent',
  hidden: false,
  deleted_at: null,
  last_activity_at: null,
  user_id: 'user-1',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

interface ParentConversationOverrides {
  parentPlatformId?: string | null;
  loadParentMessages?: (conversationId: string) => Promise<MessageResponse[]>;
  loadParentConversation?: (conversationId: string) => Promise<ConversationResponse>;
  sendParentMessage?: (
    conversationId: string,
    message: string
  ) => Promise<{ accepted: boolean; status: string }>;
}

function parentMessage(overrides: Partial<MessageResponse> = {}): MessageResponse {
  return {
    id: 'message-1',
    conversation_id: 'parent-1',
    role: 'user',
    content: 'Ship it',
    metadata: '{}',
    user_id: 'user-1',
    created_at: CREATED_AT,
    ...overrides,
  };
}

const REVIEW_STATE: WorkflowNodeStateResponse = {
  nodeId: 'review',
  name: 'Review',
  status: 'running',
  retryEpoch: 0,
};

const REVIEW_STARTED: WorkflowEventResponse = {
  id: 'start-review',
  workflow_run_id: 'run-1',
  event_type: 'node_started',
  step_index: null,
  step_name: 'review',
  data: {},
  created_at: CREATED_AT,
};

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

let legacyGraphLogsPaneModulePromise: Promise<typeof import('./LegacyGraphLogsPane')> | null = null;

async function loadLegacyGraphLogsPaneModule(): Promise<typeof import('./LegacyGraphLogsPane')> {
  if (legacyGraphLogsPaneModulePromise === null) {
    let tempWin: Window | null = null;
    if (typeof globalThis.document === 'undefined') {
      tempWin = installHappyDom();
    }
    legacyGraphLogsPaneModulePromise = import('./LegacyGraphLogsPane');
    const module = await legacyGraphLogsPaneModulePromise;
    if (tempWin !== null) {
      // Radix keeps import-time DOM references; restore globals but keep the window alive.
      restoreGlobals();
    }
    return module;
  }
  return legacyGraphLogsPaneModulePromise;
}

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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

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

function expectNoAskHumanChrome(host: Element): void {
  const text = host.textContent ?? '';
  expect(text).not.toContain('AskHuman');
  expect(text).not.toContain('awaiting');
  expect(text).not.toContain('waiting-on-you');
}

describe('LegacyGraphLogsPane', () => {
  let win: Window;
  let host: Element;
  let root: Root;
  let queryClient: InstanceType<typeof reactQuery.QueryClient>;
  let legacyGraphLogsPane: typeof import('./LegacyGraphLogsPane');

  beforeEach(async () => {
    notifyManager.setScheduler((cb: () => void): void => {
      cb();
    });
    notifyManager.setNotifyFunction((cb: () => void): void => {
      act(cb);
    });
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    el.style.width = '1200px';
    el.style.height = '800px';
    host = el as unknown as Element;
    root = createRoot(host);
    queryClient = new reactQuery.QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    legacyGraphLogsPane = await loadLegacyGraphLogsPaneModule();
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

  function defaultRenderGraph(input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }): React.ReactElement {
    return createElement(
      'div',
      { 'data-testid': 'injected-graph' },
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'graph-setup',
          onClick: (): void => {
            input.onNodeClick('setup');
          },
        },
        'graph:setup'
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'graph-review',
          onClick: (): void => {
            input.onNodeClick('review');
          },
        },
        'graph:review'
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'graph-group',
          onClick: (): void => {
            input.onNodeClick('group');
          },
        },
        'graph:group'
      )
    );
  }

  function PaneHarness(
    props: {
      activeView?: 'graph' | 'logs' | 'chat';
      runId: string;
      nodeStates: readonly WorkflowNodeStateResponse[];
      events: readonly WorkflowEventResponse[];
      definitionNodes: readonly DagNode[];
      definitionPending: boolean;
      runStatus: WorkflowRunStatus;
      approval: unknown;
      loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
      onSelectNode: (nodeId: string | null) => void;
      onApprove?: () => Promise<void>;
      onReject?: (reason?: string) => Promise<void>;
      pendingInteractions?: readonly PendingInteraction[];
      viewerIsStarter?: boolean;
      starterDisplayName?: string | null;
      onSubmitAsk?: (requestId: string, body: AskAnswerBody) => Promise<void>;
      nodeExecutions?: readonly NodeExecution[];
      onSelectExecution?: (rowId: string) => void;
      omitSelectExecution?: boolean;
      initialSelectedNodeId?: string | null;
      initialSelectedLogRowId?: string | null;
    } & ParentConversationOverrides
  ): React.ReactElement {
    const [selectedNodeId, setSelectedNodeId] = react.useState<string | null>(
      props.initialSelectedNodeId ?? null
    );
    const [selectedLogRowId, setSelectedLogRowId] = react.useState<string | null>(
      props.initialSelectedLogRowId ?? null
    );
    const [lastExplicitRowByNode, setLastExplicitRowByNode] = react.useState<
      Record<string, string>
    >({});
    const skipRunReset = react.useRef(true);
    const onSelectNodeRef = react.useRef(props.onSelectNode);
    onSelectNodeRef.current = props.onSelectNode;
    react.useEffect(() => {
      if (skipRunReset.current) {
        skipRunReset.current = false;
        return;
      }
      setSelectedNodeId(null);
      setSelectedLogRowId(null);
      setLastExplicitRowByNode({});
      onSelectNodeRef.current(null);
    }, [props.runId]);
    return createElement(legacyGraphLogsPane.LegacyGraphLogsPane, {
      activeView: props.activeView ?? 'logs',
      renderGraph: defaultRenderGraph,
      selectedNodeId,
      selectedLogRowId,
      lastExplicitRowByNode,
      splitMode: 'split',
      onOpenRoom: (rowId: string, nodeId: string): void => {
        setSelectedNodeId(nodeId);
        setSelectedLogRowId(rowId);
        setLastExplicitRowByNode(previous => ({ ...previous, [nodeId]: rowId }));
        props.onSelectNode(nodeId);
      },
      onCloseRoom: (): void => {
        setSelectedNodeId(null);
        setSelectedLogRowId(null);
        props.onSelectNode(null);
      },
      runId: props.runId,
      runStartedAt: CREATED_AT,
      nodeStates: props.nodeStates,
      events: props.events,
      nodeExecutions: props.nodeExecutions,
      loadMessages: props.loadMessages,
      parentPlatformId: props.parentPlatformId === undefined ? 'parent-1' : props.parentPlatformId,
      loadParentMessages: props.loadParentMessages ?? (async (): Promise<MessageResponse[]> => []),
      loadParentConversation:
        props.loadParentConversation ??
        (async (): Promise<ConversationResponse> => PARENT_CONVERSATION),
      sendParentMessage:
        props.sendParentMessage ??
        (async (): Promise<{ accepted: boolean; status: string }> => ({
          accepted: true,
          status: 'accepted',
        })),
      definitionNodes: props.definitionNodes,
      definitionPending: props.definitionPending,
      runStatus: props.runStatus,
      approval: props.approval,
      onApprove: props.onApprove ?? (async (): Promise<void> => undefined),
      onReject: props.onReject ?? (async (): Promise<void> => undefined),
      pendingInteractions: props.pendingInteractions ?? [],
      viewerIsStarter: props.viewerIsStarter ?? true,
      starterDisplayName:
        props.starterDisplayName === undefined ? 'Avery' : props.starterDisplayName,
      actionStates: {},
      onSubmitAsk: props.onSubmitAsk ?? (async (): Promise<void> => undefined),
      onSelectExecution: props.omitSelectExecution
        ? undefined
        : (props.onSelectExecution ??
          ((rowId: string): void => {
            setSelectedLogRowId(rowId);
          })),
    });
  }

  function renderLogs(
    args: {
      activeView?: 'graph' | 'logs' | 'chat';
      runId: string;
      nodeStates: readonly WorkflowNodeStateResponse[];
      events: readonly WorkflowEventResponse[];
      definitionNodes: readonly DagNode[];
      definitionPending: boolean;
      runStatus: WorkflowRunStatus;
      approval: unknown;
      loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
      onSelectNode: (nodeId: string | null) => void;
      onApprove?: () => Promise<void>;
      onReject?: (reason?: string) => Promise<void>;
      pendingInteractions?: readonly PendingInteraction[];
      viewerIsStarter?: boolean;
      starterDisplayName?: string | null;
      onSubmitAsk?: (requestId: string, body: AskAnswerBody) => Promise<void>;
      nodeExecutions?: readonly NodeExecution[];
      onSelectExecution?: (rowId: string) => void;
      omitSelectExecution?: boolean;
      initialSelectedNodeId?: string | null;
      initialSelectedLogRowId?: string | null;
    } & ParentConversationOverrides
  ): void {
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(PaneHarness, args)
      )
    );
  }

  async function clickRow(label: string): Promise<HTMLElement> {
    const button = Array.from(host.querySelectorAll('button')).find(candidate =>
      (candidate.textContent ?? '').includes(label)
    );
    if (button === undefined) throw new Error(`missing ${label} row`);
    await act(async () => {
      button.click();
    });
    return button;
  }

  function requireComposerTextarea(node: Element | null): {
    disabled: boolean;
    value: string;
    placeholder: string;
    dispatchEvent: (event: unknown) => boolean;
  } {
    if (node?.tagName !== 'TEXTAREA') throw new Error('missing run composer');
    return node as unknown as {
      disabled: boolean;
      value: string;
      placeholder: string;
      dispatchEvent: (event: unknown) => boolean;
    };
  }

  function requireComposerForm(node: Element | null): {
    dispatchEvent: (event: unknown) => boolean;
  } {
    if (node?.tagName !== 'FORM') throw new Error('missing run composer form');
    return node as unknown as { dispatchEvent: (event: unknown) => boolean };
  }

  function requireComposerButton(node: Element | null): { disabled: boolean } {
    if (node?.tagName !== 'BUTTON') throw new Error('missing send button');
    return node as unknown as { disabled: boolean };
  }

  function setNativeTextareaValue(element: object, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value');
    if (descriptor === undefined || typeof descriptor.set !== 'function') {
      throw new Error('missing textarea value setter');
    }
    descriptor.set.call(element, value);
  }

  async function clickGraph(testId: string): Promise<void> {
    const button = host.querySelector(`[data-testid="${testId}"]`);
    if (button === null) throw new Error(`missing ${testId}`);
    await act(async () => {
      (button as HTMLElement).click();
    });
  }

  function paneProps(overrides: {
    selectedNodeId: string | null;
    selectedLogRowId: string | null;
    splitMode: 'split' | 'single';
    onCloseRoom?: () => void;
  }): LegacyGraphLogsPaneProps {
    return {
      activeView: 'logs',
      renderGraph: defaultRenderGraph,
      selectedNodeId: overrides.selectedNodeId,
      selectedLogRowId: overrides.selectedLogRowId,
      splitMode: overrides.splitMode,
      lastExplicitRowByNode: {},
      onOpenRoom: (): void => undefined,
      onCloseRoom: overrides.onCloseRoom ?? ((): void => undefined),
      runId: 'run-1',
      runStartedAt: CREATED_AT,
      nodeStates: [REVIEW_STATE],
      events: [REVIEW_STARTED],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
      parentPlatformId: 'parent-1',
      loadParentMessages: async (): Promise<MessageResponse[]> => [],
      loadParentConversation: async (): Promise<ConversationResponse> => PARENT_CONVERSATION,
      sendParentMessage: async (): Promise<{ accepted: boolean; status: string }> => ({
        accepted: true,
        status: 'accepted',
      }),
      definitionNodes: [{ id: 'review', command: 'review' }],
      definitionPending: false,
      runStatus: 'running',
      approval: null,
      onApprove: async (): Promise<void> => undefined,
      onReject: async (): Promise<void> => undefined,
      pendingInteractions: [],
      viewerIsStarter: true,
      starterDisplayName: 'Avery',
      actionStates: {},
      onSubmitAsk: async (): Promise<void> => undefined,
    };
  }

  test('opens a fixed-width room on demand and hides the main view in single mode', async () => {
    const closes: number[] = [];
    const onCloseRoom = (): void => {
      closes.push(1);
    };

    await act(async () => {
      root.render(
        createElement(
          reactQuery.QueryClientProvider,
          { client: queryClient },
          createElement(
            legacyGraphLogsPane.LegacyGraphLogsPane,
            paneProps({
              selectedNodeId: null,
              selectedLogRowId: null,
              splitMode: 'split',
              onCloseRoom,
            })
          )
        )
      );
    });
    await flush();
    expect(host.querySelector('[data-testid="legacy-node-room"]')).toBeNull();
    expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(host.querySelector('[aria-label="Resize node room"]')).toBeNull();

    await act(async () => {
      root.render(
        createElement(
          reactQuery.QueryClientProvider,
          { client: queryClient },
          createElement(
            legacyGraphLogsPane.LegacyGraphLogsPane,
            paneProps({
              selectedNodeId: 'review',
              selectedLogRowId: 'start-review',
              splitMode: 'split',
              onCloseRoom,
            })
          )
        )
      );
    });
    await flush();
    const viewPanel = host.querySelector('#legacy-run-view');
    const roomPanel = host.querySelector('#legacy-run-room');
    if (viewPanel === null) throw new Error('missing legacy view');
    if (roomPanel === null) throw new Error('missing legacy room');
    expect(host.querySelector('[data-testid="legacy-node-room"]')).not.toBeNull();
    expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(host.querySelector('[aria-label="Resize node room"]')).toBeNull();
    expect(roomPanel.className).toContain('shrink-0');
    expect(roomPanel.style.width).toBe('460px');
    expect(viewPanel.className).toContain('flex-1');
    expect(viewPanel.className).toContain('min-w-0');
    expect(roomPanel.className).toContain('border-l');
    // Outer room is the overflow boundary so the transcript scroller owns vertical scroll.
    expect(roomPanel.className).toContain('min-h-0');
    expect(roomPanel.className).toContain('overflow-hidden');
    expect(roomPanel.style.overflow).toBe('hidden');

    // Rerender with the same room open — fixed width must not change.
    await act(async () => {
      root.render(
        createElement(
          reactQuery.QueryClientProvider,
          { client: queryClient },
          createElement(
            legacyGraphLogsPane.LegacyGraphLogsPane,
            paneProps({
              selectedNodeId: 'review',
              selectedLogRowId: 'start-review',
              splitMode: 'split',
              onCloseRoom,
            })
          )
        )
      );
    });
    await flush();
    const rerenderedRoom = host.querySelector('#legacy-run-room');
    if (rerenderedRoom === null) throw new Error('missing rerendered legacy room');
    expect(rerenderedRoom.style.width).toBe('460px');
    expect(rerenderedRoom.className).toContain('shrink-0');

    await act(async () => {
      root.render(
        createElement(
          reactQuery.QueryClientProvider,
          { client: queryClient },
          createElement(
            legacyGraphLogsPane.LegacyGraphLogsPane,
            paneProps({
              selectedNodeId: 'review',
              selectedLogRowId: 'start-review',
              splitMode: 'single',
              onCloseRoom,
            })
          )
        )
      );
    });
    await flush();
    const mainView = host.querySelector('#legacy-run-view');
    if (mainView === null) throw new Error('missing single main');
    expect(mainView).toBe(viewPanel);
    expect(mainView.className.split(/\s+/)).toContain('hidden');
    expect(mainView.className.split(/\s+/)).not.toContain('flex');
    expect(mainView.hasAttribute('hidden')).toBe(false);
    const singleRoom = host.querySelector('#legacy-run-room');
    if (singleRoom === null) throw new Error('missing single legacy room');
    expect(singleRoom.style.width).toBe('');
    expect(singleRoom.className).toContain('flex-1');
    expect(singleRoom.className).toContain('w-full');
    expect(singleRoom.className).not.toContain('shrink-0');
    const back = Array.from(host.querySelectorAll('button')).find(candidate =>
      (candidate.textContent ?? '').includes('Back')
    );
    if (back === undefined) throw new Error('missing Back button');
    await act(async () => {
      back.click();
    });
    expect(closes).toEqual([1]);

    await act(async () => {
      root.render(
        createElement(
          reactQuery.QueryClientProvider,
          { client: queryClient },
          createElement(
            legacyGraphLogsPane.LegacyGraphLogsPane,
            paneProps({
              selectedNodeId: null,
              selectedLogRowId: null,
              splitMode: 'single',
              onCloseRoom,
            })
          )
        )
      );
    });
    await flush();
    const closedMain = host.querySelector('#legacy-run-view');
    if (closedMain === null) throw new Error('missing closed single main');
    expect(closedMain.className.split(/\s+/)).toContain('flex');
    expect(closedMain.className.split(/\s+/)).not.toContain('hidden');
    expect(host.querySelector('[data-testid="legacy-node-room"]')).toBeNull();
  });

  test('ignores stored archon.run-room.ratio keys and never writes them', async () => {
    const key = 'archon.run-room.ratio.legacy';
    globalThis.localStorage.setItem(key, '55');
    const originalSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    const writes: string[] = [];
    globalThis.localStorage.setItem = (name: string, value: string): void => {
      writes.push(name);
      originalSetItem(name, value);
    };

    try {
      await act(async () => {
        root.render(
          createElement(
            reactQuery.QueryClientProvider,
            { client: queryClient },
            createElement(
              legacyGraphLogsPane.LegacyGraphLogsPane,
              paneProps({
                selectedNodeId: 'review',
                selectedLogRowId: 'start-review',
                splitMode: 'split',
              })
            )
          )
        );
      });
      await flush();
      const room = host.querySelector('#legacy-run-room');
      if (room === null) throw new Error('missing room with stale ratio');
      expect(room.style.width).toBe('460px');

      await act(async () => {
        root.render(
          createElement(
            reactQuery.QueryClientProvider,
            { client: queryClient },
            createElement(
              legacyGraphLogsPane.LegacyGraphLogsPane,
              paneProps({
                selectedNodeId: 'review',
                selectedLogRowId: 'start-review',
                splitMode: 'single',
              })
            )
          )
        );
      });
      await flush();
      const singleRoom = host.querySelector('#legacy-run-room');
      if (singleRoom === null) throw new Error('missing single room with stale ratio');
      expect(singleRoom.style.width).toBe('');
      expect(writes.some(name => name.includes('run-room.ratio'))).toBe(false);
      expect(globalThis.localStorage.getItem(key)).toBe('55');
    } finally {
      globalThis.localStorage.setItem = originalSetItem;
      globalThis.localStorage.removeItem(key);
    }
  });

  test('wires pre-selection copy, click-to-loader, and run-change reset', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    const calls: [string, string][] = [];
    const selected: (string | null)[] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return pending.promise;
    };
    const onSelectNode = (nodeId: string | null): void => {
      selected.push(nodeId);
    };

    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [REVIEW_STATE],
        events: [REVIEW_STARTED],
        definitionNodes: [{ id: 'review', command: 'review' }],
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages,
        onSelectNode,
      });
    });
    await flush();

    expect(host.textContent).toContain('Review');
    expect(host.querySelector('[data-testid="legacy-node-room"]')).toBeNull();
    expect(selected).toEqual([]);
    expect(calls).toEqual([]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    expectNoAskHumanChrome(host);

    await clickRow('Review');
    await flush();
    expect(selected).toEqual(['review']);

    await act(async () => {
      pending.resolve({
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      });
    });
    await flushUntil(host, 'selected transcript', () =>
      (host.textContent ?? '').includes('hello from review')
    );

    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);

    await act(async () => {
      renderLogs({
        runId: 'run-2',
        nodeStates: [],
        events: [],
        definitionNodes: [],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode,
      });
    });
    await flushUntil(
      host,
      'run-change reset',
      () => host.querySelector('[data-testid="legacy-node-room"]') === null
    );

    expect(selected).toEqual(['review', null]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    expect(host.querySelector('[data-testid="legacy-node-room"]')).toBeNull();
    expect(host.textContent).not.toContain('hello from review');
    expectNoAskHumanChrome(host);
  });

  test('selecting bash renders captured stdout without requesting node messages', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    const events: WorkflowEventResponse[] = [
      {
        id: 'start-setup',
        workflow_run_id: 'run-1',
        event_type: 'node_started',
        step_index: null,
        step_name: 'setup',
        data: { type: 'bash' },
        created_at: CREATED_AT,
      },
      {
        id: 'done-setup',
        workflow_run_id: 'run-1',
        event_type: 'node_completed',
        step_index: null,
        step_name: 'setup',
        data: { type: 'bash', node_output: 'ready' },
        created_at: CREATED_AT,
      },
    ];
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'setup', name: 'Setup', status: 'completed', retryEpoch: 0 }],
        events,
        definitionNodes: [{ id: 'setup', bash: 'echo ready' }],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
        onApprove: async (): Promise<void> => undefined,
        onReject: async (): Promise<void> => undefined,
      });
    });
    const setup = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Setup')
    );
    if (setup === undefined) throw new Error('missing Setup row');
    await act(async () => {
      setup.click();
    });
    await flushUntil(host, 'bash stdout', () => (host.textContent ?? '').includes('ready'));
    expect(calls).toEqual([]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking an approval row renders the authored message and active controls', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'review', name: 'Review', status: 'running', retryEpoch: 0 }],
        events: [REVIEW_STARTED],
        definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
        definitionPending: false,
        runStatus: 'paused',
        approval: { nodeId: 'review', message: 'Ship?', type: 'approval' },
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Review');
    await flushUntil(host, 'approval message', () => (host.textContent ?? '').includes('Ship?'));
    const buttons = Array.from(host.querySelectorAll('button')).map(
      button => button.textContent ?? ''
    );
    expect(buttons.some(text => text === 'Approve')).toBe(true);
    expect(buttons.some(text => text.includes('Reject'))).toBe(true);
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('active approval pauses remain selectable without lifecycle node state', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [{ id: 'review', approval: { message: 'Ship?' } }],
        definitionPending: false,
        runStatus: 'paused',
        approval: { nodeId: 'review', message: 'Ship?', type: 'approval' },
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('review');
    await flushUntil(host, 'approval row from metadata', () =>
      (host.textContent ?? '').includes('Ship?')
    );

    const buttons = Array.from(host.querySelectorAll('button')).map(
      button => button.textContent ?? ''
    );
    expect(buttons.some(text => text === 'Approve')).toBe(true);
    expect(buttons.some(text => text.includes('Reject'))).toBe(true);
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('active Plannotator pauses remain selectable without lifecycle node state', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [
          { id: 'review', plannotator_gate: { document: 'plan.md', rework: { prompt: 'Fix' } } },
        ],
        definitionPending: false,
        runStatus: 'paused',
        approval: {
          nodeId: 'review',
          message: 'Review the plan',
          type: 'plannotator_gate',
          document: 'plan.md',
          reviewUrl: 'https://plannotator.example/run-1',
        },
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('review');
    await flushUntil(host, 'plannotator row from metadata', () =>
      (host.textContent ?? '').includes('Open Plannotator')
    );

    expect(host.querySelector('a[href="https://plannotator.example/run-1"]')).not.toBeNull();
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('active child workflow pauses remain selectable without lifecycle node state', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [{ id: 'child', workflow: 'review-child' }],
        definitionPending: false,
        runStatus: 'paused',
        approval: {
          nodeId: 'child',
          message: 'Sub-run is paused awaiting review',
          type: 'child_workflow',
          childRunId: 'child-run-1',
        },
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('child');
    await flushUntil(host, 'child workflow row from metadata', () =>
      (host.textContent ?? '').includes('Open child run')
    );

    expect(host.querySelector('a[href="/legacy/workflows/runs/child-run-1"]')).not.toBeNull();
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="child room"]')).not.toBeNull();
    expect(host.textContent).not.toContain('AskHuman');
    expect(host.textContent).not.toContain('waiting-on-you');
  });

  test('clicking a workflow row renders Open child run and does not call loadMessages', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'child', name: 'Child', status: 'completed', retryEpoch: 0 }],
        events: [
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
        definitionNodes: [{ id: 'child', workflow: 'child-wf' }],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Child');
    await flushUntil(host, 'child run link', () =>
      (host.textContent ?? '').includes('Open child run')
    );
    expect(host.querySelector('a[href="/legacy/workflows/runs/child-1"]')).not.toBeNull();
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="child room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking route execution number 2 renders decision number 2', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'router', name: 'Router', status: 'completed', retryEpoch: 0 }],
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
        definitionNodes: [ROUTER_NODE],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Router #2');
    await flushUntil(host, 'route decision 2', () => (host.textContent ?? '').includes('positive'));
    expect(host.textContent).toContain('done');
    expect(host.textContent).not.toContain('exhausted');
    expect(host.textContent).not.toContain('stop');
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="router room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking a loop-group iteration row renders Body nodes and opens that iteration', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [{ nodeId: 'group', name: 'Group', status: 'failed', retryEpoch: 0 }],
        events: [
          workflowEvent({
            id: 'iter-1-start',
            step_name: 'group',
            event_type: 'loop_iteration_started',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'iter-1-done',
            step_name: 'group',
            event_type: 'loop_iteration_completed',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'iter-2-start',
            step_name: 'group',
            event_type: 'loop_iteration_started',
            data: { iteration: 2 },
          }),
          workflowEvent({
            id: 'iter-2-fail',
            step_name: 'group',
            event_type: 'loop_iteration_failed',
            data: { iteration: 2 },
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
        definitionNodes: [GROUP_NODE],
        definitionPending: false,
        runStatus: 'failed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Group ×2');
    await flushUntil(host, 'loop group body', () =>
      (host.textContent ?? '').includes('Body nodes')
    );
    expect(host.textContent).toContain('Start');
    expect(host.textContent).toContain('After body');
    expect(host.textContent).toContain('×1 completed');
    expect(host.textContent).toContain('×2 failed');
    expect(host.querySelectorAll('details[open]')).toHaveLength(1);
    expect(host.querySelector('details[open]')?.textContent).toContain('×2 failed');
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="group room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('active loop-group iterations remain selectable before group terminal state exists', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [],
        events: [
          workflowEvent({
            id: 'iter-1-start',
            step_name: 'group',
            event_type: 'loop_iteration_started',
            data: { iteration: 1 },
          }),
          workflowEvent({
            id: 'body-1-done',
            step_name: 'group.body',
            event_type: 'node_completed',
            data: { iteration: 1 },
          }),
        ],
        definitionNodes: [GROUP_NODE],
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('group ×1');
    await flushUntil(host, 'loop group row from iteration events', () =>
      (host.textContent ?? '').includes('Body nodes')
    );

    expect(host.textContent).toContain('×1 running');
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="group room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking bash then command keeps one navigation, one room, and loads command once', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return {
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      };
    };
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: [
          { nodeId: 'setup', name: 'Setup', status: 'completed', retryEpoch: 0 },
          REVIEW_STATE,
        ],
        events: [
          workflowEvent({
            id: 'start-setup',
            step_name: 'setup',
            event_type: 'node_started',
            data: { type: 'bash' },
          }),
          workflowEvent({
            id: 'done-setup',
            step_name: 'setup',
            event_type: 'node_completed',
            data: { type: 'bash', node_output: 'ready' },
          }),
          REVIEW_STARTED,
        ],
        definitionNodes: [
          { id: 'setup', bash: 'echo ready' },
          { id: 'review', command: 'review' },
        ],
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Setup');
    await flushUntil(host, 'bash first', () => (host.textContent ?? '').includes('ready'));
    expect(calls).toEqual([]);
    expect(host.querySelectorAll('[aria-label="Node runs"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);

    await clickRow('Review');
    await flushUntil(host, 'command after bash', () =>
      (host.textContent ?? '').includes('hello from review')
    );
    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelectorAll('[aria-label="Node runs"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  const SHARED_BASH_COMMAND = {
    nodeStates: [
      { nodeId: 'setup', name: 'Setup', status: 'completed' as const, retryEpoch: 0 },
      REVIEW_STATE,
    ],
    events: [
      workflowEvent({
        id: 'start-setup',
        step_name: 'setup',
        event_type: 'node_started',
        data: { type: 'bash' },
      }),
      workflowEvent({
        id: 'done-setup',
        step_name: 'setup',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: 'ready' },
      }),
      REVIEW_STARTED,
    ],
    definitionNodes: [
      { id: 'setup', bash: 'echo ready' },
      { id: 'review', command: 'review' },
    ] as const,
  };

  const LOOP_EVENTS: WorkflowEventResponse[] = [
    workflowEvent({
      id: 'iter-1-start',
      step_name: 'group',
      event_type: 'loop_iteration_started',
      data: { iteration: 1 },
    }),
    workflowEvent({
      id: 'iter-1-done',
      step_name: 'group',
      event_type: 'loop_iteration_completed',
      data: { iteration: 1 },
    }),
    workflowEvent({
      id: 'iter-2-start',
      step_name: 'group',
      event_type: 'loop_iteration_started',
      data: { iteration: 2 },
    }),
    workflowEvent({
      id: 'iter-2-fail',
      step_name: 'group',
      event_type: 'loop_iteration_failed',
      data: { iteration: 2 },
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
  ];

  test('graph mode renders the injected graph navigation and no Node runs list', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await flush();
    expect(host.querySelector('[data-testid="injected-graph"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Node runs"]')).toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking an injected graph-node button opens the same bash room without loading messages', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return { messages: [] };
    };
    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickGraph('graph-setup');
    await flushUntil(host, 'graph bash stdout', () => (host.textContent ?? '').includes('ready'));
    expect(calls).toEqual([]);
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('clicking an injected command node loads only that node messages', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return {
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      };
    };
    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages,
        onSelectNode: (): void => undefined,
      });
    });
    await clickGraph('graph-review');
    await flushUntil(host, 'graph command transcript', () =>
      (host.textContent ?? '').includes('hello from review')
    );
    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('switching from Graph to Logs preserves the room DOM node and does not refetch', async () => {
    const calls: [string, string][] = [];
    const loadMessages = async (
      requestRunId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([requestRunId, nodeId]);
      return {
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      };
    };
    const paneArgs = {
      runId: 'run-1',
      nodeStates: SHARED_BASH_COMMAND.nodeStates,
      events: SHARED_BASH_COMMAND.events,
      definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
      definitionPending: false,
      runStatus: 'running' as const,
      approval: null,
      loadMessages,
      onSelectNode: (): void => undefined,
    };
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    await clickGraph('graph-review');
    await flushUntil(host, 'graph command before switch', () =>
      (host.textContent ?? '').includes('hello from review')
    );
    const room = host.querySelector('[aria-label="review room"]');
    expect(room).not.toBeNull();
    expect(calls).toEqual([['run-1', 'review']]);

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await flush();
    expect(host.querySelector('[aria-label="review room"]')).toBe(room);
    expect(calls).toEqual([['run-1', 'review']]);
    const selectedRow = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Review')
    );
    expect(selectedRow?.getAttribute('aria-current')).toBe('true');
    expectNoAskHumanChrome(host);
  });

  test('clicking a loop iteration row preserves that iteration selection', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'logs',
        runId: 'run-1',
        nodeStates: [{ nodeId: 'group', name: 'Group', status: 'failed', retryEpoch: 0 }],
        events: LOOP_EVENTS,
        definitionNodes: [GROUP_NODE],
        definitionPending: false,
        runStatus: 'failed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Group ×1');
    await flushUntil(host, 'preserve iteration 1', () =>
      (host.textContent ?? '').includes('Body nodes')
    );
    expect(host.querySelector('details[open]')?.textContent).toContain('×1 completed');
    const first = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Group ×1')
    );
    expect(first?.getAttribute('aria-current')).toBe('true');
  });

  test('clicking the same loop node in Graph resolves the canonical last iteration row', async () => {
    const paneArgs = {
      runId: 'run-1',
      nodeStates: [{ nodeId: 'group', name: 'Group', status: 'failed' as const, retryEpoch: 0 }],
      events: LOOP_EVENTS,
      definitionNodes: [GROUP_NODE],
      definitionPending: false,
      runStatus: 'failed' as const,
      approval: null,
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
      onSelectNode: (): void => undefined,
    };
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await clickRow('Group ×1');
    await flushUntil(host, 'iteration 1 before graph', () =>
      (host.querySelector('details[open]')?.textContent ?? '').includes('×1 completed')
    );

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    await clickGraph('graph-group');
    await flushUntil(host, 'canonical last iteration', () =>
      (host.querySelector('details[open]')?.textContent ?? '').includes('×2 failed')
    );
    expect(host.querySelector('details[open]')?.textContent).not.toContain('×1 completed');

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await flush();
    const last = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Group ×2')
    );
    expect(last?.getAttribute('aria-current')).toBe('true');
    expectNoAskHumanChrome(host);
  });

  test('a run-id change from Graph clears selection and reports null once', async () => {
    const selected: (string | null)[] = [];
    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (nodeId: string | null): void => {
          selected.push(nodeId);
        },
      });
    });
    await clickGraph('graph-setup');
    await flushUntil(host, 'graph setup selected', () =>
      (host.textContent ?? '').includes('ready')
    );
    expect(selected).toEqual(['setup']);

    await act(async () => {
      renderLogs({
        activeView: 'graph',
        runId: 'run-2',
        nodeStates: [],
        events: [],
        definitionNodes: [],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (nodeId: string | null): void => {
          selected.push(nodeId);
        },
      });
    });
    await flushUntil(
      host,
      'graph run-change reset',
      () => host.querySelector('[data-testid="legacy-node-room"]') === null
    );
    expect(selected).toEqual(['setup', null]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    expectNoAskHumanChrome(host);
  });

  test('neither Graph nor Logs contains AskHuman awaiting or waiting-on-you copy', async () => {
    const paneArgs = {
      runId: 'run-1',
      nodeStates: SHARED_BASH_COMMAND.nodeStates,
      events: SHARED_BASH_COMMAND.events,
      definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
      definitionPending: false,
      runStatus: 'completed' as const,
      approval: null,
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
      onSelectNode: (): void => undefined,
    };
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    await flush();
    expectNoAskHumanChrome(host);
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await flush();
    expectNoAskHumanChrome(host);
  });

  test('chat view renders the timeline instead of Node runs or the injected graph', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(
      host,
      'chat timeline',
      () => host.querySelector('[aria-label="Run chat timeline"]') !== null
    );
    expect(host.querySelector('[aria-label="Node runs"]')).toBeNull();
    expect(host.querySelector('[data-testid="injected-graph"]')).toBeNull();
    expect(host.querySelector('[aria-label="Run chat timeline"]')).not.toBeNull();
  });

  test('injected parent user message appears in the timeline and is not a button', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        loadParentMessages: async (): Promise<MessageResponse[]> => [
          parentMessage({ content: 'operator follow-up' }),
        ],
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(host, 'parent user turn', () =>
      (host.textContent ?? '').includes('operator follow-up')
    );
    const bubble = Array.from(host.querySelectorAll('div')).find(
      candidate => (candidate.textContent ?? '') === 'operator follow-up'
    );
    expect(bubble).not.toBeUndefined();
    expect(bubble instanceof win.HTMLButtonElement).toBe(false);
  });

  test('a node_started event for setup appears as a node-status button', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(host, 'setup started button', () =>
      Array.from(host.querySelectorAll('button')).some(button =>
        (button.textContent ?? '').includes('started')
      )
    );
    const started = Array.from(host.querySelectorAll('button')).find(
      button =>
        (button.textContent ?? '').includes('Setup') &&
        (button.textContent ?? '').includes('started')
    );
    expect(started).not.toBeUndefined();
  });

  test('clicking a setup node-status button opens the bash room without loadMessages', async () => {
    const calls: [string, string][] = [];
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (
          requestRunId: string,
          nodeId: string
        ): Promise<WorkflowNodeMessagesResponse> => {
          calls.push([requestRunId, nodeId]);
          return { messages: [] };
        },
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(
      host,
      'chat timeline',
      () => host.querySelector('[aria-label="Run chat timeline"]') !== null
    );
    await clickRow('started');
    await flushUntil(
      host,
      'setup room from chat',
      () => host.querySelector('[aria-label="setup room"]') !== null
    );
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expect(calls).toEqual([]);
  });

  test('clicking a command node-status button for review loads messages once', async () => {
    const calls: [string, string][] = [];
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages: async (
          requestRunId: string,
          nodeId: string
        ): Promise<WorkflowNodeMessagesResponse> => {
          calls.push([requestRunId, nodeId]);
          return {
            messages: [
              {
                id: 'm1',
                seq: 1,
                kind: 'text',
                payload: { text: 'hello from review' },
                created_at: CREATED_AT,
              },
            ],
          };
        },
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(
      host,
      'chat timeline',
      () => host.querySelector('[aria-label="Run chat timeline"]') !== null
    );
    await clickRow('Review');
    await flushUntil(host, 'review room from chat', () =>
      (host.textContent ?? '').includes('hello from review')
    );
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expect(calls).toEqual([['run-1', 'review']]);
  });

  test('clicking a loop-iteration node-status button preserves that iteration', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: [{ nodeId: 'group', name: 'Group', status: 'failed', retryEpoch: 0 }],
        events: LOOP_EVENTS,
        definitionNodes: [GROUP_NODE],
        definitionPending: false,
        runStatus: 'failed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(
      host,
      'chat timeline',
      () => host.querySelector('[aria-label="Run chat timeline"]') !== null
    );
    await clickRow('Group ×1');
    await flushUntil(host, 'preserve iteration 1 from chat', () =>
      (host.textContent ?? '').includes('Body nodes')
    );
    expect(host.querySelector('details[open]')?.textContent).toContain('×1 completed');
  });

  test('graph bash room survives Chat then Logs without fetching node messages', async () => {
    const calls: [string, string][] = [];
    const paneArgs = {
      runId: 'run-1',
      nodeStates: SHARED_BASH_COMMAND.nodeStates,
      events: SHARED_BASH_COMMAND.events,
      definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
      definitionPending: false,
      runStatus: 'completed' as const,
      approval: null,
      loadMessages: async (
        requestRunId: string,
        nodeId: string
      ): Promise<WorkflowNodeMessagesResponse> => {
        calls.push([requestRunId, nodeId]);
        return { messages: [] };
      },
      onSelectNode: (): void => undefined,
    };
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    await clickGraph('graph-setup');
    await flushUntil(host, 'graph bash stdout', () => (host.textContent ?? '').includes('ready'));
    const room = host.querySelector('[aria-label="setup room"]');
    expect(room).not.toBeNull();
    expect(calls).toEqual([]);

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'chat' });
    });
    await flushUntil(
      host,
      'chat after graph',
      () => host.querySelector('[aria-label="Run chat timeline"]') !== null
    );
    expect(host.querySelector('[aria-label="setup room"]')).toBe(room);

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await flush();
    expect(host.querySelector('[aria-label="setup room"]')).toBe(room);
    expect(calls).toEqual([]);
  });

  test('opens the command room from the exact completed status and preserves it across tabs', async () => {
    const calls: [string, string][] = [];
    const paneArgs = {
      runId: 'run-1',
      nodeStates: [REVIEW_STATE],
      events: [
        REVIEW_STARTED,
        workflowEvent({
          id: 'complete-review',
          event_type: 'node_completed',
          step_name: 'review',
          created_at: '2026-09-06T00:00:02.000Z',
        }),
      ],
      definitionNodes: [{ id: 'review', command: 'review' }] satisfies readonly DagNode[],
      definitionPending: false,
      runStatus: 'completed' as const,
      approval: null,
      loadMessages: async (
        requestRunId: string,
        nodeId: string
      ): Promise<WorkflowNodeMessagesResponse> => {
        calls.push([requestRunId, nodeId]);
        return { messages: [] };
      },
      loadParentMessages: async (): Promise<MessageResponse[]> => [],
      onSelectNode: (): void => undefined,
    };
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'chat' });
    });
    await flushUntil(
      host,
      'chat timeline',
      () => host.querySelector('[aria-label="Run chat timeline"]') !== null
    );
    await clickRow('completed');
    const room = host.querySelector('[aria-label="review room"]');
    expect(room).not.toBeNull();
    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('completed');

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    expect(host.querySelector('[aria-label="review room"]')).toBe(room);
    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'chat' });
    });
    expect(host.querySelector('[aria-label="review room"]')).toBe(room);
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('completed');
    expect(calls).toEqual([['run-1', 'review']]);
  });

  test('clicking the user bubble does not change the selected room and does not call loadMessages', async () => {
    const calls: [string, string][] = [];
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (
          requestRunId: string,
          nodeId: string
        ): Promise<WorkflowNodeMessagesResponse> => {
          calls.push([requestRunId, nodeId]);
          return { messages: [] };
        },
        loadParentMessages: async (): Promise<MessageResponse[]> => [
          parentMessage({ content: 'operator follow-up' }),
        ],
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(host, 'parent user turn', () =>
      (host.textContent ?? '').includes('operator follow-up')
    );
    expect(host.querySelector('[aria-label="setup room"]')).toBeNull();
    const bubble = Array.from(host.querySelectorAll('div')).find(
      candidate => (candidate.textContent ?? '') === 'operator follow-up'
    );
    if (bubble === undefined) throw new Error('missing user bubble');
    await act(async () => {
      (bubble as HTMLElement).click();
    });
    await flush();
    expect(host.querySelector('[aria-label="setup room"]')).toBeNull();
    expect(host.querySelector('[aria-label="review room"]')).toBeNull();
    expect(calls).toEqual([]);
  });

  test('parent-message query errors still render node-status buttons', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        loadParentMessages: async (): Promise<MessageResponse[]> => {
          throw new Error('conversation turns exploded');
        },
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(host, 'parent message error', () =>
      (host.textContent ?? '').includes('conversation turns exploded')
    );
    expect(host.querySelector('.text-error')?.textContent).toContain('conversation turns exploded');
    const started = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('started')
    );
    expect(started).not.toBeUndefined();
  });

  test('a disabled parent-message query does not display a permanent loading state', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        parentPlatformId: null,
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await flush();
    expect(host.textContent).not.toContain('Loading conversation turns…');
    expect(host.textContent).toContain('No conversation turns or node-status entries yet.');
  });

  test('polls parent turns for every non-terminal run status', () => {
    expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('pending')).toBe(3000);
    expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('running')).toBe(3000);
    expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('paused')).toBe(3000);
    expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('completed')).toBe(false);
    expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('failed')).toBe(false);
    expect(legacyGraphLogsPane.runChatMessagesRefetchInterval('cancelled')).toBe(false);
  });

  test('chat view renders exactly one regular composer and no AskHuman chrome', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(
      host,
      'chat composer',
      () => host.querySelector('[aria-label="Run conversation composer"]') !== null
    );
    expect(host.querySelectorAll('[aria-label="Run conversation composer"]')).toHaveLength(1);
    expectNoAskHumanChrome(host);
  });

  test('submitting trimmed composer text sends once, clears the draft, and shows the persisted turn', async () => {
    const sendCalls: [string, string][] = [];
    let messages: MessageResponse[] = [];
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        loadParentMessages: async (): Promise<MessageResponse[]> => messages,
        sendParentMessage: async (
          conversationId: string,
          message: string
        ): Promise<{ accepted: boolean; status: string }> => {
          sendCalls.push([conversationId, message]);
          messages = [
            parentMessage({
              id: 'sent-1',
              content: message,
              created_at: '2026-09-06T00:00:03.000Z',
            }),
          ];
          return { accepted: true, status: 'accepted' };
        },
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(host, 'enabled composer', () => {
      const candidate = host.querySelector('[aria-label="Message the run conversation"]');
      return candidate !== null && !candidate.hasAttribute('disabled');
    });
    const textarea = requireComposerTextarea(
      host.querySelector('[aria-label="Message the run conversation"]')
    );
    await act(async () => {
      setNativeTextareaValue(textarea, '  follow up  ');
      textarea.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: '  follow up  ' }));
      const propsKey = Object.keys(textarea).find(key => key.startsWith('__reactProps$'));
      if (propsKey !== undefined) {
        const props = (textarea as unknown as Record<string, unknown>)[propsKey];
        if (props !== null && typeof props === 'object' && 'onChange' in props) {
          const onChange = (props as { onChange?: (event: { target: { value: string } }) => void })
            .onChange;
          onChange?.({ target: { value: '  follow up  ' } });
        }
      }
    });
    const form = requireComposerForm(
      host.querySelector('[aria-label="Run conversation composer"]')
    );
    await act(async () =>
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }))
    );
    await flushUntil(host, 'sent turn', () => (host.textContent ?? '').includes('follow up'));
    expect(sendCalls).toEqual([['parent-1', 'follow up']]);
    expect(textarea.value).toBe('');
  });

  test('a failed send preserves the draft and renders the thrown message without changing the room', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        sendParentMessage: async (): Promise<{ accepted: boolean; status: string }> => {
          throw new Error('send exploded');
        },
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(host, 'enabled composer', () => {
      const candidate = host.querySelector('[aria-label="Message the run conversation"]');
      return candidate !== null && !candidate.hasAttribute('disabled');
    });
    const textarea = requireComposerTextarea(
      host.querySelector('[aria-label="Message the run conversation"]')
    );
    await act(async () => {
      setNativeTextareaValue(textarea, 'keep me');
      textarea.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: 'keep me' }));
      const propsKey = Object.keys(textarea).find(key => key.startsWith('__reactProps$'));
      if (propsKey !== undefined) {
        const props = (textarea as unknown as Record<string, unknown>)[propsKey];
        if (props !== null && typeof props === 'object' && 'onChange' in props) {
          const onChange = (props as { onChange?: (event: { target: { value: string } }) => void })
            .onChange;
          onChange?.({ target: { value: 'keep me' } });
        }
      }
    });
    const form = requireComposerForm(
      host.querySelector('[aria-label="Run conversation composer"]')
    );
    await act(async () =>
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }))
    );
    await flushUntil(host, 'send error', () => (host.textContent ?? '').includes('send exploded'));
    expect(textarea.value).toBe('keep me');
    expect(host.querySelector('[aria-label="setup room"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('send exploded');
  });

  test('a non-Web parent conversation disables the composer and never sends', async () => {
    const sendCalls: [string, string][] = [];
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: [],
        events: [],
        definitionNodes: [],
        definitionPending: false,
        runStatus: 'completed',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        loadParentConversation: async (): Promise<ConversationResponse> => ({
          ...PARENT_CONVERSATION,
          platform_type: 'slack',
        }),
        sendParentMessage: async (
          conversationId: string,
          message: string
        ): Promise<{ accepted: boolean; status: string }> => {
          sendCalls.push([conversationId, message]);
          return { accepted: true, status: 'accepted' };
        },
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(
      host,
      'non-web composer',
      () =>
        host
          .querySelector('[aria-label="Message the run conversation"]')
          ?.hasAttribute('disabled') === true
    );
    const textarea = requireComposerTextarea(
      host.querySelector('[aria-label="Message the run conversation"]')
    );
    const submit = requireComposerButton(
      host.querySelector('[aria-label="Run conversation composer"] button[type="submit"]')
    );
    expect(textarea.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(textarea.placeholder).toBe(
      'Continuing chats from other platforms in the Web UI is coming soon'
    );
    const form = requireComposerForm(
      host.querySelector('[aria-label="Run conversation composer"]')
    );
    await act(async () =>
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }))
    );
    await flush();
    expect(sendCalls).toEqual([]);
  });

  test('a status without a persisted LogRow opens the synthetic fallback room and keeps timeline selection', async () => {
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: [],
        events: [
          workflowEvent({
            id: 'start-ghost',
            step_name: 'ghost',
            event_type: 'node_started',
            data: { type: 'bash' },
          }),
        ],
        definitionNodes: [{ id: 'ghost', bash: 'echo hi' }],
        definitionPending: false,
        runStatus: 'running',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(
      host,
      'ghost timeline',
      () => host.querySelector('[aria-label="Run chat timeline"]') !== null
    );
    await clickRow('started');
    await flushUntil(
      host,
      'ghost synthetic room',
      () => host.querySelector('[aria-label="ghost room"]') !== null
    );
    expect(host.querySelector('[aria-label="ghost room"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('started');
    await flush();
    expect(host.querySelector('[aria-label="ghost room"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('started');
  });

  function pendingReviewAsk(): PendingInteraction {
    return {
      id: 'ask-1',
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'tool-ask',
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
      provider_session_id: 'sess-1',
      created_at: CREATED_AT,
      resolved_at: null,
      resolved_by: null,
    };
  }

  const ASK_MESSAGES: WorkflowNodeMessagesResponse = {
    messages: [
      {
        id: 'm-ask-tool',
        seq: 1,
        kind: 'tool',
        payload: { name: 'AskHuman', id: 'tool-ask', input: {} },
        created_at: CREATED_AT,
      },
    ],
  };

  test('Logs, Graph, and Chat open the same agent room with the same anchored Ask card', async () => {
    const paneArgs = {
      runId: 'run-1',
      nodeStates: SHARED_BASH_COMMAND.nodeStates,
      events: SHARED_BASH_COMMAND.events,
      definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
      definitionPending: false,
      runStatus: 'paused' as const,
      approval: null,
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ASK_MESSAGES,
      pendingInteractions: [pendingReviewAsk()],
      onSelectNode: (): void => undefined,
    };

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'logs' });
    });
    await clickRow('Review');
    await flushUntil(host, 'logs ask', () => (host.textContent ?? '').includes('Ship it?'));
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expect(
      host.querySelector('form[aria-label="question from agent, 1 questions"]')
    ).not.toBeNull();

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'graph' });
    });
    await clickRow('graph:review');
    await flushUntil(host, 'graph ask', () => (host.textContent ?? '').includes('Ship it?'));
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expect(
      host.querySelector('form[aria-label="question from agent, 1 questions"]')
    ).not.toBeNull();

    await act(async () => {
      renderLogs({ ...paneArgs, activeView: 'chat' });
    });
    await flushUntil(host, 'chat review started', () =>
      Array.from(host.querySelectorAll('button')).some(
        button =>
          (button.textContent ?? '').includes('Review') &&
          (button.textContent ?? '').includes('started')
      )
    );
    const started = Array.from(host.querySelectorAll('button')).find(
      button =>
        (button.textContent ?? '').includes('Review') &&
        (button.textContent ?? '').includes('started')
    );
    if (started === undefined) {
      throw new Error('missing Review started timeline entry');
    }
    await act(async () => {
      started.click();
    });
    await flushUntil(host, 'chat ask', () => (host.textContent ?? '').includes('Ship it?'));
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expect(
      host.querySelector('form[aria-label="question from agent, 1 questions"]')
    ).not.toBeNull();
  });

  test('a non-agent room with a pending Ask row keeps its typed room and omits the Ask form', async () => {
    await act(async () => {
      renderLogs({
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'paused',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ASK_MESSAGES,
        pendingInteractions: [
          pendingReviewAsk(),
          { ...pendingReviewAsk(), id: 'ask-setup', node_id: 'setup' },
        ],
        onSelectNode: (): void => undefined,
      });
    });
    await clickRow('Setup');
    await flushUntil(host, 'bash room', () => (host.textContent ?? '').includes('ready'));
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expect(host.textContent).toContain('Bash');
    expect(host.querySelector('form[aria-label="question from agent, 1 questions"]')).toBeNull();
    expect(host.textContent).not.toContain('Ship it?');
  });

  test('the Chat composer stays a parent-conversation path and never answers an Ask', async () => {
    const sendCalls: [string, string][] = [];
    const askCalls: [string, AskAnswerBody][] = [];
    await act(async () => {
      renderLogs({
        activeView: 'chat',
        runId: 'run-1',
        nodeStates: SHARED_BASH_COMMAND.nodeStates,
        events: SHARED_BASH_COMMAND.events,
        definitionNodes: SHARED_BASH_COMMAND.definitionNodes,
        definitionPending: false,
        runStatus: 'paused',
        approval: null,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ASK_MESSAGES,
        pendingInteractions: [pendingReviewAsk()],
        sendParentMessage: async (
          conversationId: string,
          message: string
        ): Promise<{ accepted: boolean; status: string }> => {
          sendCalls.push([conversationId, message]);
          return { accepted: true, status: 'accepted' };
        },
        onSubmitAsk: async (requestId, body): Promise<void> => {
          askCalls.push([requestId, body]);
        },
        onSelectNode: (): void => undefined,
      });
    });
    await flushUntil(host, 'composer isolation', () => {
      const candidate = host.querySelector('[aria-label="Message the run conversation"]');
      return candidate !== null && !candidate.hasAttribute('disabled');
    });
    expect(host.querySelector('[aria-label="Run conversation composer"]')).not.toBeNull();
    const textarea = requireComposerTextarea(
      host.querySelector('[aria-label="Message the run conversation"]')
    );
    await act(async () => {
      const propsKey = Object.keys(textarea).find(key => key.startsWith('__reactProps$'));
      if (propsKey !== undefined) {
        const props = (textarea as unknown as Record<string, unknown>)[propsKey];
        if (props !== null && typeof props === 'object' && 'onChange' in props) {
          const onChange = (props as { onChange?: (event: { target: { value: string } }) => void })
            .onChange;
          onChange?.({ target: { value: 'not an ask' } });
        }
      }
    });
    const form = requireComposerForm(
      host.querySelector('[aria-label="Run conversation composer"]')
    );
    await act(async () =>
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }))
    );
    await flushUntil(host, 'composer sent', () => sendCalls.length === 1);
    expect(sendCalls).toEqual([['parent-1', 'not an ask']]);
    expect(askCalls).toEqual([]);
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
      const finishedId =
        'exec:loop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111:0';
      const selected: string[] = [];
      await act(async () => {
        renderLogs({
          runId: 'run-loop',
          nodeStates: [{ nodeId: 'loop', name: 'Loop', status: 'running', retryEpoch: 0 }],
          events: [],
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          definitionPending: false,
          runStatus: 'running',
          approval: null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          onSelectNode: (): void => undefined,
          nodeExecutions: [
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
          ],
          initialSelectedNodeId: 'loop',
          initialSelectedLogRowId: finishedId,
          onSelectExecution: (rowId): void => {
            selected.push(rowId);
          },
        });
      });
      await flush();
      await flushUntil(host, 'finished dock', () =>
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
      const finishedId =
        'exec:loop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111:0';
      await act(async () => {
        renderLogs({
          runId: 'run-loop',
          nodeStates: [{ nodeId: 'loop', name: 'Loop', status: 'running', retryEpoch: 0 }],
          events: [],
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          definitionPending: false,
          runStatus: 'running',
          approval: null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          onSelectNode: (): void => undefined,
          nodeExecutions: [
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
          ],
          initialSelectedNodeId: 'loop',
          initialSelectedLogRowId: finishedId,
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

  test('without onSelectExecution the finished dock is not rendered', async () => {
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
      await act(async () => {
        renderLogs({
          runId: 'run-loop',
          nodeStates: [{ nodeId: 'loop', name: 'Loop', status: 'running', retryEpoch: 0 }],
          events: [],
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          definitionPending: false,
          runStatus: 'running',
          approval: null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          onSelectNode: (): void => undefined,
          omitSelectExecution: true,
          nodeExecutions: [
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
          ],
          initialSelectedNodeId: 'loop',
          initialSelectedLogRowId: finishedId,
        });
      });
      await flush();
      expect(host.textContent ?? '').not.toContain('reading a finished iteration');
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

  test('T3.15 Legacy wrapper passes exact node terminal inputs; siblings ignored', async () => {
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
      const events: WorkflowEventResponse[] = [
        {
          id: 'start-a',
          workflow_run_id: 'run-1',
          event_type: 'node_started',
          step_index: null,
          step_name: 'alpha',
          data: { occurrence_id: 'occ-a' },
          created_at: CREATED_AT,
          event_order: 1,
        },
        {
          id: 'done-a',
          workflow_run_id: 'run-1',
          event_type: 'node_completed',
          step_index: null,
          step_name: 'alpha',
          data: { occurrence_id: 'occ-a' },
          created_at: CREATED_AT,
          event_order: 2,
        },
        {
          id: 'start-b',
          workflow_run_id: 'run-1',
          event_type: 'node_started',
          step_index: null,
          step_name: 'beta',
          data: { occurrence_id: 'occ-b' },
          created_at: CREATED_AT,
          event_order: 3,
        },
      ];

      await act(async () => {
        renderLogs({
          runId: 'run-1',
          nodeStates: [
            { nodeId: 'alpha', name: 'Alpha', status: 'completed', retryEpoch: 0 },
            { nodeId: 'beta', name: 'Beta', status: 'running', retryEpoch: 0 },
          ],
          events,
          definitionNodes: [
            { id: 'alpha', prompt: 'A' },
            { id: 'beta', prompt: 'B' },
          ],
          definitionPending: false,
          runStatus: 'running',
          approval: null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          onSelectNode: (): void => undefined,
          nodeExecutions: [
            { node_id: 'alpha', status: 'completed', occurrence_id: 'occ-a' },
            { node_id: 'beta', status: 'running', occurrence_id: 'occ-b' },
          ],
          initialSelectedNodeId: 'alpha',
          initialSelectedLogRowId: 'start-a',
        });
      });
      await flush();

      const room = host.querySelector('[data-testid="legacy-node-room"]');
      expect(room).not.toBeNull();
      if (room === null) throw new Error('missing room');
      const props = findPropsWithKey(room, 'nodeTerminal');
      expect(props).not.toBeNull();
      expect(props?.nodeTerminal).toBe(true);
      expect(props?.nodeExecutionKey).toBe('occ-a');

      // Sibling beta is running — click selects it without remounting the harness.
      await clickRow('Beta');
      await flush();
      const betaRoom = host.querySelector('[data-testid="legacy-node-room"]');
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
      const events: WorkflowEventResponse[] = [
        {
          id: 'start-1',
          workflow_run_id: 'run-loop',
          event_type: 'node_started',
          step_index: null,
          step_name: 'loop',
          data: { occurrence_id: 'logical-key-1' },
          created_at: CREATED_AT,
          event_order: 1,
        },
        {
          id: 'start-2',
          workflow_run_id: 'run-loop',
          event_type: 'node_started',
          step_index: null,
          step_name: 'loop',
          data: { occurrence_id: 'logical-key-1' },
          created_at: CREATED_AT,
          event_order: 2,
        },
      ];

      await act(async () => {
        renderLogs({
          runId: 'run-loop',
          nodeStates: [{ nodeId: 'loop', name: 'Loop', status: 'running', retryEpoch: 0 }],
          events,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          definitionPending: false,
          runStatus: 'running',
          approval: null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          onSelectNode: (): void => undefined,
          nodeExecutions: [
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
          ],
          initialSelectedNodeId: 'loop',
          initialSelectedLogRowId: finishedId,
        });
      });
      await flush();

      const room = host.querySelector('[data-testid="legacy-node-room"]');
      expect(room).not.toBeNull();
      if (room === null) throw new Error('missing room');
      const finishedProps = findPropsWithKey(room, 'nodeTerminal');
      expect(finishedProps?.nodeTerminal).toBe(false);
      expect(finishedProps?.nodeExecutionKey).toBe('logical-key-1');

      await act(async () => {
        renderLogs({
          runId: 'run-loop',
          nodeStates: [{ nodeId: 'loop', name: 'Loop', status: 'running', retryEpoch: 0 }],
          events,
          definitionNodes: [{ id: 'loop', prompt: 'iterate' }],
          definitionPending: false,
          runStatus: 'running',
          approval: null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          onSelectNode: (): void => undefined,
          nodeExecutions: [
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
          ],
          initialSelectedNodeId: 'loop',
          initialSelectedLogRowId: liveId,
        });
      });
      await flush();

      const liveRoom = host.querySelector('[data-testid="legacy-node-room"]');
      expect(liveRoom).not.toBeNull();
      if (liveRoom === null) throw new Error('missing live room');
      const liveProps = findPropsWithKey(liveRoom, 'nodeTerminal');
      expect(liveProps?.nodeTerminal).toBe(false);
      expect(liveProps?.nodeExecutionKey).toBe('logical-key-1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('T4.16 idleAwaitExpired reaches selected room including group.body', async () => {
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
      const events: WorkflowEventResponse[] = [
        {
          id: 'start-body',
          workflow_run_id: 'run-1',
          event_type: 'node_started',
          step_index: null,
          step_name: 'group.body',
          data: { occurrence_id: 'occ-body' },
          created_at: CREATED_AT,
          event_order: 1,
        },
        {
          id: 'fail-body',
          workflow_run_id: 'run-1',
          event_type: 'node_failed',
          step_index: null,
          step_name: 'group.body',
          data: { occurrence_id: 'occ-body', error: expired },
          created_at: CREATED_AT,
          event_order: 2,
        },
        {
          id: 'fail-group',
          workflow_run_id: 'run-1',
          event_type: 'node_failed',
          step_index: null,
          step_name: 'group',
          data: { occurrence_id: 'occ-group', error: `Loop group failed: body: ${expired}` },
          created_at: CREATED_AT,
          event_order: 3,
        },
      ];
      const nodeExecutions: NodeExecution[] = [
        {
          node_id: 'group',
          status: 'failed',
          occurrence_id: 'occ-group',
          error: `Loop group failed: body: ${expired}`,
        },
        {
          node_id: 'group.body',
          status: 'failed',
          occurrence_id: 'occ-body',
          error: expired,
        },
      ];

      await act(async () => {
        renderLogs({
          runId: 'run-1',
          nodeStates: [
            { nodeId: 'group', name: 'Group', status: 'failed', retryEpoch: 0 },
            { nodeId: 'group.body', name: 'Body', status: 'failed', retryEpoch: 0 },
          ],
          events,
          definitionNodes: [GROUP_NODE],
          definitionPending: false,
          runStatus: 'failed',
          approval: null,
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages: [] }),
          onSelectNode: (): void => undefined,
          nodeExecutions,
          initialSelectedNodeId: 'group.body',
          initialSelectedLogRowId: 'start-body',
        });
      });
      await flush();

      const bodyRoom = host.querySelector('[data-testid="legacy-node-room"]');
      expect(bodyRoom).not.toBeNull();
      if (bodyRoom === null) throw new Error('missing body room');
      const bodyProps = findPropsWithKey(bodyRoom, 'idleAwaitExpired');
      expect(bodyProps).not.toBeNull();
      expect(bodyProps?.idleAwaitExpired).toBe(true);
      expect(bodyProps?.nodeTerminal).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
