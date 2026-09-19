process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';

import type { WorkflowExecutionBody } from './WorkflowExecution';
import type { WorkflowRunView } from './source-control/dag-run-tabs';
import { getWorkflowRun, type WorkflowEventResponse } from '@/lib/api';

const workflowExecutionImportWindow = new Window({ url: 'https://localhost/' });
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
const previousHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
Object.assign(globalThis as object, {
  document: workflowExecutionImportWindow.document,
  window: workflowExecutionImportWindow,
  self: workflowExecutionImportWindow,
  HTMLElement: workflowExecutionImportWindow.HTMLElement,
});
const workflowExecution = await import('./WorkflowExecution');
const {
  buildWorkflowDagNodeStates,
  emptyAskActionStates,
  mapWorkflowRunDetail,
  resolveWorkflowExecutionBody,
} = workflowExecution;
// Radix keeps import-time DOM references; restore globals but keep the window alive.
if (previousDocument === undefined) {
  Reflect.deleteProperty(globalThis, 'document');
} else {
  Object.defineProperty(globalThis, 'document', previousDocument);
}
if (previousWindow === undefined) {
  Reflect.deleteProperty(globalThis, 'window');
} else {
  Object.defineProperty(globalThis, 'window', previousWindow);
}
if (previousSelf === undefined) {
  Reflect.deleteProperty(globalThis, 'self');
} else {
  Object.defineProperty(globalThis, 'self', previousSelf);
}
if (previousHTMLElement === undefined) {
  Reflect.deleteProperty(globalThis, 'HTMLElement');
} else {
  Object.defineProperty(globalThis, 'HTMLElement', previousHTMLElement);
}

function workflowEvent(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: '2026-06-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildWorkflowDagNodeStates', () => {
  test('enriches server-projected nodeStates with loop iteration events', () => {
    const nodes = buildWorkflowDagNodeStates(
      [
        {
          nodeId: 'loop-node',
          name: 'Loop',
          status: 'completed',
          retryEpoch: 0,
        },
      ],
      [
        workflowEvent({
          id: 'event-1',
          event_type: 'loop_iteration_started',
          step_name: 'loop-node',
          data: { iteration: 1, maxIterations: 2 },
        }),
        workflowEvent({
          id: 'event-2',
          event_type: 'loop_iteration_completed',
          step_name: 'loop-node',
          data: { iteration: 1, maxIterations: 2, duration_ms: 1500 },
        }),
      ]
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      nodeId: 'loop-node',
      status: 'completed',
      currentIteration: 1,
      maxIterations: 2,
      iterations: [{ iteration: 1, status: 'completed', duration: 1500 }],
    });
  });

  test('enriches the target loop node from node_completed loop_progress (REST replay)', () => {
    const nodes = buildWorkflowDagNodeStates(
      [
        { nodeId: 'preflight', name: 'Preflight', status: 'completed', retryEpoch: 0 },
        { nodeId: 'loop-node', name: 'Loop', status: 'running', retryEpoch: 0 },
      ],
      [
        workflowEvent({
          id: 'e1',
          event_type: 'node_completed',
          step_name: 'preflight',
          data: { loop_progress: { targetNodeId: 'loop-node', expectedIterations: 20 } },
        }),
      ]
    );
    expect(nodes.find(n => n.nodeId === 'loop-node')?.expectedIterations).toBe(20);
  });

  test('returns no DAG lifecycle when server nodeStates are absent', () => {
    expect(
      buildWorkflowDagNodeStates(undefined, [
        workflowEvent({ event_type: 'node_started', step_name: 'review' }),
        workflowEvent({ event_type: 'node_routed', step_name: 'router' }),
      ])
    ).toEqual([]);
  });

  test('route decisions enrich an existing node without overriding server status', () => {
    const routeDecision = {
      sources: ['review'],
      outcome: 'negative',
      to: 'fix',
      condition: "$review.output.approved == '<redacted>'",
      condition_result: false,
      negative_count: 1,
      max_iterations: 2,
      attempt: 1,
      execution_seq: 4,
    };

    const nodes = buildWorkflowDagNodeStates(
      [{ nodeId: 'router', name: 'Router', status: 'running', retryEpoch: 0 }],
      [workflowEvent({ event_type: 'node_routed', step_name: 'router', data: routeDecision })]
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.status).toBe('running');
    expect(nodes[0]?.routeDecision).toEqual(routeDecision);
  });

  describe('resolveWorkflowExecutionBody', () => {
    const views: WorkflowRunView[] = ['graph', 'logs', 'chat', 'source-control', 'terminal'];

    test('every DAG inspect view shares the pane and source control stays separate', () => {
      const expected: Record<WorkflowRunView, WorkflowExecutionBody> = {
        graph: 'graph-logs-pane',
        logs: 'graph-logs-pane',
        chat: 'graph-logs-pane',
        'source-control': 'source-control',
        terminal: 'terminal',
      };
      for (const activeView of views) {
        expect(resolveWorkflowExecutionBody({ isDag: true, activeView })).toBe(
          expected[activeView]
        );
      }
      expect(Object.values(expected)).not.toContain('chat');
    });

    test('every non-DAG input returns sequential', () => {
      for (const activeView of views) {
        expect(resolveWorkflowExecutionBody({ isDag: false, activeView })).toBe('sequential');
      }
    });
  });
});

describe('mapWorkflowRunDetail', () => {
  function runDetail(
    overrides: {
      pending_interactions?: Awaited<ReturnType<typeof getWorkflowRun>>['pending_interactions'];
      viewer_is_starter?: boolean;
      starter_display_name?: string | null;
      metadata?: Record<string, unknown>;
    } = {}
  ): Awaited<ReturnType<typeof getWorkflowRun>> {
    return {
      run: {
        id: 'run-1',
        workflow_name: 'demo',
        conversation_id: 'conv-1',
        parent_conversation_id: null,
        codebase_id: 'cb-1',
        status: 'paused',
        user_message: 'go',
        metadata: overrides.metadata ?? { error: 'AskHuman is not supported by provider claude' },
        started_at: '2026-09-07T00:00:00.000Z',
        completed_at: null,
        last_activity_at: null,
        working_path: null,
        user_id: 'user-1',
        parent_run_id: null,
        output_root: null,
        parent_platform_id: 'parent-1',
        conversation_platform_id: null,
      },
      events: [],
      nodeStates: [],
      pending_interactions: overrides.pending_interactions ?? [
        {
          id: 'ask-1',
          workflow_run_id: 'run-1',
          node_id: 'review',
          tool_use_id: 'tool-ask',
          kind: 'ask',
          status: 'pending',
          envelope: { questions: [] },
          answer: null,
          provider_session_id: 'sess-1',
          created_at: '2026-09-07T00:00:00.000Z',
          resolved_at: null,
          resolved_by: null,
        },
      ],
      usage: null,
      viewer_is_starter: overrides.viewer_is_starter ?? true,
      starter_display_name:
        overrides.starter_display_name === undefined ? 'Avery' : overrides.starter_display_name,
    };
  }

  test('maps Ask read-model fields', () => {
    const mapped = mapWorkflowRunDetail(runDetail());
    expect(mapped.pendingInteractions).toHaveLength(1);
    expect(mapped.pendingInteractions[0]?.id).toBe('ask-1');
    expect(mapped.viewerIsStarter).toBe(true);
    expect(mapped.starterDisplayName).toBe('Avery');
    expect(mapped.runError).toBe('AskHuman is not supported by provider claude');

    const nonStringError = mapWorkflowRunDetail(runDetail({ metadata: { error: { code: 7 } } }));
    expect(nonStringError.runError).toBeNull();
  });
});

describe('emptyAskActionStates', () => {
  test('creates fresh Ask action state per run', () => {
    const first = emptyAskActionStates();
    const second = emptyAskActionStates();
    expect(first).toEqual({});
    expect(second).toEqual({});
    expect(first).not.toBe(second);
    first['tool-ask'] = { phase: 'sending' };
    expect(second).toEqual({});
  });
});

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
  'ResizeObserver',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'InputEvent',
  'matchMedia',
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

function stubMatchMedia(): (query: string) => MediaQueryList {
  return (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    }) as MediaQueryList;
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
    ResizeObserver: win.ResizeObserver,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
    FocusEvent: win.FocusEvent,
    InputEvent: win.InputEvent,
    matchMedia: stubMatchMedia(),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  Object.assign(globalThis as object, bag);
  win.document.documentElement.style.fontSize = '16px';
  Object.defineProperty(win.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: (): DOMRect =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1200,
        bottom: 800,
        width: 1200,
        height: 800,
        toJSON: (): Record<string, number> => ({}),
      }) as DOMRect,
  });
  return win;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'https://localhost').pathname;
}

const CREATED_AT = '2026-09-06T00:00:00.000Z';

function visitRunDetail(runId: string): Awaited<ReturnType<typeof getWorkflowRun>> {
  return {
    run: {
      id: runId,
      workflow_name: 'demo',
      conversation_id: 'conv-1',
      parent_conversation_id: null,
      codebase_id: null,
      status: 'completed',
      user_message: 'go',
      metadata: {},
      started_at: CREATED_AT,
      completed_at: '2026-09-06T00:01:00.000Z',
      last_activity_at: CREATED_AT,
      working_path: null,
      user_id: 'user-1',
      parent_run_id: null,
      output_root: null,
      conversation_platform_id: null,
    },
    events: [
      workflowEvent({
        id: 'start-review',
        workflow_run_id: runId,
        event_type: 'node_started',
        step_name: 'review',
      }),
      workflowEvent({
        id: 'iter-1-start',
        workflow_run_id: runId,
        event_type: 'loop_iteration_started',
        step_name: 'group',
        data: { iteration: 1 },
      }),
      workflowEvent({
        id: 'iter-1-done',
        workflow_run_id: runId,
        event_type: 'loop_iteration_completed',
        step_name: 'group',
        data: { iteration: 1 },
      }),
      workflowEvent({
        id: 'iter-2-start',
        workflow_run_id: runId,
        event_type: 'loop_iteration_started',
        step_name: 'group',
        data: { iteration: 2 },
      }),
      workflowEvent({
        id: 'iter-2-fail',
        workflow_run_id: runId,
        event_type: 'loop_iteration_failed',
        step_name: 'group',
        data: { iteration: 2 },
      }),
      workflowEvent({
        id: 'artifact-1',
        workflow_run_id: runId,
        event_type: 'workflow_artifact',
        data: { artifactType: 'commit', label: 'ship-it', url: 'https://example.test/c' },
      }),
    ],
    nodeStates: [
      { nodeId: 'review', name: 'Review', status: 'completed', retryEpoch: 0 },
      { nodeId: 'group', name: 'Group', status: 'failed', retryEpoch: 0 },
    ],
    pending_interactions: [],
    usage: null,
    viewer_is_starter: true,
    starter_display_name: 'Avery',
  };
}

function visitWorkflowDefinition(): {
  workflow: { name: string; description: string; nodes: { id: string; prompt?: string }[] };
  filename: string;
  source: 'project';
} {
  return {
    workflow: {
      name: 'demo',
      description: 'demo',
      nodes: [
        { id: 'review', prompt: 'Review the change.' },
        { id: 'group', prompt: 'Loop group stand-in.' },
      ],
    },
    filename: 'demo.yaml',
    source: 'project',
  };
}

describe('WorkflowExecution room visit', () => {
  let win: Window;
  let host: Element;
  let root: Root;
  let queryClient: QueryClient;
  let fetchSpy: { mockRestore: () => void };

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
    el.style.width = '1200px';
    el.style.height = '800px';
    host = el as unknown as Element;
    root = createRoot(host);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === '/api/workflows/runs/run-1' || path === '/api/workflows/runs/run-2') {
        const runId = path.endsWith('run-2') ? 'run-2' : 'run-1';
        return Promise.resolve(jsonResponse(visitRunDetail(runId)));
      }
      if (path === '/api/workflows/demo') {
        return Promise.resolve(jsonResponse(visitWorkflowDefinition()));
      }
      if (path.includes('/nodes/') && path.endsWith('/messages')) {
        return Promise.resolve(
          jsonResponse({ messages: [], hasMore: false, highWatermark: 0 } satisfies {
            messages: never[];
            hasMore: boolean;
            highWatermark: number;
          })
        );
      }
      return Promise.resolve(jsonResponse({ error: `unmocked ${path}` }, 404));
    }) as typeof fetch);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    fetchSpy.mockRestore();
    win.close();
    restoreGlobals();
    notifyManager.setScheduler((cb: () => void): void => {
      setTimeout(cb, 0);
    });
    notifyManager.setNotifyFunction((cb: () => void): void => {
      cb();
    });
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function flushUntil(label: string, predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await flush();
      if (predicate()) return;
    }
    throw new Error(`${label}: ${host.textContent ?? ''}`);
  }

  async function flushFrames(): Promise<void> {
    await act(async () => {
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }

  function QuerySearchControls(): ReactElement {
    const navigate = useNavigate();
    return createElement(
      'div',
      null,
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'set-node-review',
          onClick: (): void => {
            navigate({ search: '?node=review' });
          },
        },
        'set-review'
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'clear-node',
          onClick: (): void => {
            navigate({ search: '' });
          },
        },
        'clear-node'
      )
    );
  }

  function ExecutionHarness(props: { initialRunId: string; initialSearch?: string }): ReactElement {
    const [runId, setRunId] = useState(props.initialRunId);
    return createElement(
      MemoryRouter,
      {
        initialEntries: [
          `/legacy/workflows/runs/${props.initialRunId}${props.initialSearch ?? ''}`,
        ],
      },
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          'div',
          null,
          createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'switch-run',
              onClick: (): void => {
                setRunId('run-2');
              },
            },
            'switch-run'
          ),
          createElement(QuerySearchControls),
          createElement(workflowExecution.WorkflowExecution, { runId })
        )
      )
    );
  }

  async function renderVisit(initialSearch?: string): Promise<void> {
    await act(async () => {
      root.render(createElement(ExecutionHarness, { initialRunId: 'run-1', initialSearch }));
    });
    await flushUntil('run title', () => (host.textContent ?? '').includes('demo'));
  }

  function pointerEvent(type: string): Event {
    return new win.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
    }) as unknown as Event;
  }

  async function activate(element: Element): Promise<void> {
    await act(async () => {
      element.dispatchEvent(pointerEvent('pointerdown'));
      element.dispatchEvent(pointerEvent('mousedown'));
      element.dispatchEvent(pointerEvent('pointerup'));
      element.dispatchEvent(pointerEvent('mouseup'));
      (element as HTMLElement).click();
    });
  }

  async function clickNamed(label: string): Promise<HTMLElement> {
    const button = Array.from(host.querySelectorAll('button')).find(candidate =>
      (candidate.textContent ?? '').includes(label)
    );
    if (button === undefined) throw new Error(`missing ${label}`);
    await activate(button);
    return button;
  }

  async function clickTab(label: string): Promise<void> {
    const tab = Array.from(host.querySelectorAll('[role="tab"]')).find(
      candidate => (candidate.textContent ?? '').trim() === label
    );
    if (tab === undefined) throw new Error(`missing tab ${label}`);
    await activate(tab);
  }

  async function clickGraphNode(nodeId: string): Promise<void> {
    await flushUntil(`graph node ${nodeId}`, () => {
      return host.querySelector(`.react-flow__node[data-id="${nodeId}"]`) !== null;
    });
    const node = host.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    if (node === null) throw new Error(`missing graph node ${nodeId}`);
    await activate(node);
  }

  test('ordinary visits have no selected room until a log row is opened', async () => {
    await renderVisit();
    expect(host.querySelector('[data-testid="legacy-node-room"]')).toBeNull();
    expect(host.querySelector('[role="separator"]')).toBeNull();

    await clickTab('Logs');
    await flushUntil('log rows', () => (host.textContent ?? '').includes('Review'));
    await clickNamed('Review');
    await flushUntil(
      'opened review',
      () => host.querySelector('[data-testid="legacy-node-room"]') !== null
    );
    expect(host.querySelector('#legacy-log-start-review')?.getAttribute('aria-current')).toBe(
      'true'
    );
    expect(host.querySelector('[data-testid="legacy-node-room"]')?.textContent).toContain('Review');
  });

  test('closing the room restores focus to the log opener', async () => {
    await renderVisit();
    await clickTab('Logs');
    await flushUntil('log rows', () => host.querySelector('#legacy-log-start-review') !== null);
    const opener = host.querySelector('#legacy-log-start-review');
    if (opener === null) throw new Error('missing log opener');
    await activate(opener);
    await flushUntil(
      'room open',
      () => host.querySelector('[data-testid="legacy-node-room"]') !== null
    );
    await clickNamed('Close');
    await flushUntil(
      'room closed',
      () => host.querySelector('[data-testid="legacy-node-room"]') === null
    );
    await flushFrames();
    expect(win.document.activeElement?.id).toBe('legacy-log-start-review');
  });

  test('graph clicks restore the last explicit row after visiting another node', async () => {
    await renderVisit();
    await clickTab('Logs');
    await flushUntil('loop rows', () => (host.textContent ?? '').includes('Group ×1'));
    await clickNamed('Group ×1');
    await flushUntil('explicit iteration', () =>
      (host.querySelector('[data-testid="legacy-node-room"]')?.textContent ?? '').includes(
        'Group ×1'
      )
    );

    await clickTab('Graph');
    await clickGraphNode('review');
    await flushUntil('review from graph', () =>
      (host.querySelector('[data-testid="legacy-node-room"]')?.textContent ?? '').includes('Review')
    );
    await clickGraphNode('group');
    await flushUntil('restored last explicit', () =>
      (host.querySelector('[data-testid="legacy-node-room"]')?.textContent ?? '').includes(
        'Group ×1'
      )
    );
    expect(host.querySelector('[data-testid="legacy-node-room"]')?.textContent).not.toContain(
      'Group ×2'
    );
  });

  test('runtime graph drops the minimap but keeps controls and node selection', async () => {
    await renderVisit();
    await flushUntil('graph mounted', () => host.querySelector('.react-flow') !== null);
    // The runtime graph has no minimap; pan/zoom controls and node click stay.
    expect(host.querySelector('.react-flow__minimap')).toBeNull();
    expect(host.querySelector('.react-flow__controls')).not.toBeNull();
    expect(host.querySelector('.react-flow__controls-fitview')).not.toBeNull();
    await clickGraphNode('review');
    await flushUntil(
      'room opened from graph node',
      () => host.querySelector('[data-testid="legacy-node-room"]') !== null
    );
    expect(host.querySelector('[data-testid="legacy-node-room"]')?.textContent).toContain('Review');
  });

  test('deep-link node query applies once per entry and reopens after leaving', async () => {
    await renderVisit('?node=review');
    await flushUntil(
      'first deep link',
      () => host.querySelector('[data-testid="legacy-node-room"]') !== null
    );
    expect(host.querySelector('[data-testid="legacy-node-room"]')?.textContent).toContain('Review');

    await clickNamed('Close');
    await flushUntil(
      'closed while query present',
      () => host.querySelector('[data-testid="legacy-node-room"]') === null
    );

    await clickNamed('clear-node');
    await flush();
    expect(host.querySelector('[data-testid="legacy-node-room"]')).toBeNull();

    await clickNamed('set-review');
    await flushUntil(
      'second deep link',
      () => host.querySelector('[data-testid="legacy-node-room"]') !== null
    );
    expect(host.querySelector('[data-testid="legacy-node-room"]')?.textContent).toContain('Review');
  });

  test('changing runId clears the previous selection and keeps shell chrome after close', async () => {
    await renderVisit();
    await clickTab('Logs');
    await flushUntil('log rows', () => host.querySelector('#legacy-log-start-review') !== null);
    await clickNamed('Review');
    await flushUntil(
      'room open',
      () => host.querySelector('[data-testid="legacy-node-room"]') !== null
    );

    await clickNamed('Close');
    await flushUntil(
      'room closed',
      () => host.querySelector('[data-testid="legacy-node-room"]') === null
    );
    expect(host.querySelector('[data-testid="legacy-run-shell-chrome"]')?.textContent).toContain(
      'Artifacts'
    );
    expect(host.querySelector('[data-testid="legacy-run-shell-chrome"]')?.textContent).toContain(
      'ship-it'
    );
    expect(host.textContent).toContain('Logs');
    expect(host.textContent).toContain('Graph');

    await clickNamed('switch-run');
    await flushUntil(
      'run reset',
      () => host.querySelector('[data-testid="legacy-node-room"]') === null
    );
    expect(host.querySelector('[data-testid="legacy-node-room"]')).toBeNull();
    expect(host.querySelector('[aria-current="true"]')).toBeNull();
  });

  function askRunDetail(runId: string): Awaited<ReturnType<typeof getWorkflowRun>> {
    const base = visitRunDetail(runId);
    return {
      ...base,
      run: {
        ...base.run,
        status: 'paused',
        parent_platform_id: 'parent-1',
      },
      nodeStates: base.nodeStates.map(state =>
        state.nodeId === 'review' ? { ...state, status: 'awaiting' } : state
      ),
      pending_interactions: [
        {
          id: 'ask-1',
          workflow_run_id: runId,
          node_id: 'review',
          tool_use_id: 'tool-ask',
          kind: 'ask',
          status: 'pending',
          envelope: {
            questions: [
              {
                id: 'q1',
                prompt: 'Notes',
                selection: 'single',
                options: [],
                allowOther: true,
              },
            ],
          },
          answer: null,
          provider_session_id: 'sess-1',
          created_at: CREATED_AT,
          resolved_at: null,
          resolved_by: null,
        },
      ],
    };
  }

  function mockAskFetch(): void {
    fetchSpy.mockRestore();
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === '/api/workflows/runs/run-1' || path === '/api/workflows/runs/run-2') {
        const runId = path.endsWith('run-2') ? 'run-2' : 'run-1';
        return Promise.resolve(jsonResponse(askRunDetail(runId)));
      }
      if (path === '/api/workflows/demo') {
        return Promise.resolve(jsonResponse(visitWorkflowDefinition()));
      }
      if (path.includes('/nodes/') && path.endsWith('/messages')) {
        return Promise.resolve(jsonResponse({ messages: [], hasMore: false, highWatermark: 0 }));
      }
      if (path === '/api/conversations/parent-1') {
        return Promise.resolve(
          jsonResponse({
            id: 'parent-1',
            platform_type: 'web',
            platform_conversation_id: 'web-1',
            codebase_id: null,
            cwd: null,
            isolation_env_id: null,
            ai_assistant_type: 'claude',
            title: 'parent',
            hidden: false,
            deleted_at: null,
            created_at: CREATED_AT,
            updated_at: CREATED_AT,
          })
        );
      }
      if (path === '/api/conversations/parent-1/messages') {
        return Promise.resolve(jsonResponse([]));
      }
      if (path.includes('/ask/') && path.endsWith('/answer')) {
        return Promise.resolve(jsonResponse({ accepted: true, status: 'ok' }));
      }
      return Promise.resolve(jsonResponse({ error: `unmocked ${path}` }, 404));
    }) as typeof fetch);
  }

  function reactOnChange(
    node: Element
  ): ((event: { target: { value: string } }) => void) | undefined {
    const key = Object.keys(node).find(candidate => candidate.startsWith('__reactProps$'));
    if (key === undefined) return undefined;
    const props = (
      node as unknown as Record<
        string,
        { onChange?: (event: { target: { value: string } }) => void }
      >
    )[key];
    return props?.onChange;
  }

  test('shares Ask drafts between the room and Chat and resets them on run change', async () => {
    mockAskFetch();
    await renderVisit();
    await clickTab('Logs');
    await flushUntil('log rows', () => (host.textContent ?? '').includes('Review'));
    await clickNamed('Review');
    await flushUntil('ask in room', () =>
      (host.querySelector('[data-testid="legacy-node-room"]')?.textContent ?? '').includes('Notes')
    );

    const roomCard = host.querySelector(
      '[data-testid="legacy-node-room"] #run-ask-card-tool-ask-room'
    );
    const roomField = roomCard?.querySelector('textarea');
    if (roomField === null || roomField === undefined) throw new Error('missing room textarea');
    await act(async () => {
      reactOnChange(roomField)?.({ target: { value: 'shared-from-room' } });
    });
    await flush();
    expect((roomField as unknown as HTMLTextAreaElement).value).toBe('shared-from-room');

    await clickTab('Chat');
    await flushUntil(
      'chat ask',
      () =>
        (host.textContent ?? '').includes('ask-slot') || (host.textContent ?? '').includes('Notes')
    );
    const chatCard = host.querySelector('#run-ask-card-tool-ask-chat');
    const chatField = chatCard?.querySelector('textarea');
    if (chatField === null || chatField === undefined) throw new Error('missing chat textarea');
    expect((chatField as unknown as HTMLTextAreaElement).value).toBe('shared-from-room');

    await act(async () => {
      reactOnChange(chatField)?.({ target: { value: 'shared-from-chat' } });
    });
    await flush();
    expect((roomField as unknown as HTMLTextAreaElement).value).toBe('shared-from-chat');
    expect((chatField as unknown as HTMLTextAreaElement).value).toBe('shared-from-chat');

    await clickNamed('switch-run');
    await flushUntil('run switched', () => (host.textContent ?? '').includes('demo'));
    const fields = Array.from(host.querySelectorAll('[id^="run-ask-card-tool-ask-"] textarea'));
    for (const field of fields) {
      expect((field as unknown as HTMLTextAreaElement).value).toBe('');
    }
  });

  test('Awaiting input opens the matching Ask without changing the main view', async () => {
    mockAskFetch();
    await renderVisit();
    const graphTab = Array.from(host.querySelectorAll('[role="tab"]')).find(
      tab => (tab.textContent ?? '').trim() === 'Graph'
    );
    expect(
      graphTab?.getAttribute('aria-selected') ?? graphTab?.getAttribute('data-state')
    ).not.toBe('false');
    await clickNamed('Awaiting input');
    await flushUntil(
      'opened from chrome',
      () =>
        host.querySelector(
          '[data-testid="legacy-node-room"] #run-ask-card-tool-ask-room textarea'
        ) !== null
    );
    expect(host.querySelector('[data-testid="legacy-node-room"]')?.textContent ?? '').toContain(
      'Notes'
    );
    for (let i = 0; i < 8; i += 1) {
      await flushFrames();
    }
    const stillGraph = Array.from(host.querySelectorAll('[role="tab"]')).find(
      tab => (tab.textContent ?? '').trim() === 'Graph'
    );
    expect(
      stillGraph?.getAttribute('data-state') === 'active' ||
        stillGraph?.getAttribute('aria-selected') === 'true'
    ).toBe(true);
    const active = win.document.activeElement as { tagName?: string; id?: string } | null;
    const roomAsk = win.document.getElementById('run-ask-card-tool-ask-room');
    expect(
      roomAsk !== null &&
        active !== null &&
        (active === roomAsk || (active instanceof win.Node && roomAsk.contains(active)))
    ).toBe(true);
  });
});
