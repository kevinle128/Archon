process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';

import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowEventResponse,
  WorkflowNodeMessageResponse,
  WorkflowNodeMessagesResponse,
  WorkflowNodeStateResponse,
} from '@/lib/api';
import type { NodeMessageLoader } from '@/lib/node-message-pages';
import { nodeMessageScopeKey } from '@/lib/node-message-pages';
import type { WorkflowRunStatus } from '@/lib/types';

import type { LogRow } from './build-log-rows';
import type { Root } from 'react-dom/client';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const notifyManager = reactQuery.notifyManager;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const FIXTURE: readonly WorkflowNodeMessageResponse[] = [
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
    payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
    created_at: CREATED_AT,
  },
  {
    id: 'm7',
    seq: 7,
    kind: 'status',
    payload: { state: 'iteration_failed', detail: '2' },
    created_at: CREATED_AT,
  },
  { id: 'm8', seq: 8, kind: 'status', payload: { state: 'failed' }, created_at: CREATED_AT },
];

const REVIEW_ROW: LogRow = {
  id: 'start-review',
  nodeId: 'review',
  label: 'Review',
  status: 'running',
  order: 0,
  sourceIndex: 0,
  selection: { kind: 'node' },
};

const ITERATION_TWO_ROW: LogRow = {
  id: 'loop-review-2',
  nodeId: 'review',
  label: 'Review \u00d72',
  status: 'failed',
  order: 1,
  sourceIndex: 0,
  selection: { kind: 'loop_iteration', iteration: 2 },
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

let nodeTranscriptPaneModulePromise: Promise<typeof import('./NodeTranscriptPane')> | null = null;

async function loadNodeTranscriptPaneModule(): Promise<typeof import('./NodeTranscriptPane')> {
  if (nodeTranscriptPaneModulePromise === null) {
    let tempWin: Window | null = null;
    if (typeof globalThis.document === 'undefined') {
      tempWin = installHappyDom();
    }
    nodeTranscriptPaneModulePromise = import('./NodeTranscriptPane');
    const module = await nodeTranscriptPaneModulePromise;
    if (tempWin !== null) {
      // Radix keeps import-time DOM references; restore globals but keep the window alive.
      restoreGlobals();
    }
    return module;
  }
  return nodeTranscriptPaneModulePromise;
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

describe('transcriptRefetchInterval', () => {
  test('polls node messages for non-terminal run statuses', async () => {
    const { transcriptRefetchInterval } = await loadNodeTranscriptPaneModule();
    expect(transcriptRefetchInterval('pending')).toBe(1000);
    expect(transcriptRefetchInterval('running')).toBe(1000);
    expect(transcriptRefetchInterval('paused')).toBe(1000);
    expect(transcriptRefetchInterval('completed')).toBe(false);
    expect(transcriptRefetchInterval('failed')).toBe(false);
    expect(transcriptRefetchInterval('cancelled')).toBe(false);
  });
});

describe('NodeTranscriptPane', () => {
  let win: Window;
  let host: Element;
  let root: Root;
  let queryClient: InstanceType<typeof reactQuery.QueryClient>;
  let nodeTranscriptPane: typeof import('./NodeTranscriptPane');

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
    host = el as unknown as Element;
    root = createRoot(host);
    queryClient = new reactQuery.QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    nodeTranscriptPane = await loadNodeTranscriptPaneModule();
  });

  afterEach(async () => {
    jest.useRealTimers();
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

  function renderPane(args: {
    row: LogRow | null;
    runStatus?: WorkflowRunStatus;
    loadMessages: NodeMessageLoader;
    pendingInteractions?: readonly PendingInteraction[];
    ownsUnscopedInteractions?: boolean;
    viewerIsStarter?: boolean;
    starterDisplayName?: string | null;
    actionStates?: Record<string, { phase: 'sending' } | undefined>;
    nodeState?: WorkflowNodeStateResponse;
    onSubmitAsk?: (requestId: string, body: AskAnswerBody) => Promise<void>;
    events?: readonly WorkflowEventResponse[];
    scopeKey?: string;
    initialScrollTop?: number;
    onScrollTopChange?: (scrollTop: number) => void;
  }): void {
    const row = args.row;
    const selection =
      row?.selection.kind === 'occurrence'
        ? {
            kind: 'occurrence' as const,
            occurrenceId: row.selection.occurrenceId,
            attemptId: row.selection.attemptId,
          }
        : { kind: 'node' as const, rowId: row?.id ?? 'none' };
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(nodeTranscriptPane.NodeTranscriptPane, {
          runId: 'run-1',
          row,
          runStatus: args.runStatus ?? 'completed',
          loadMessages: args.loadMessages,
          pendingInteractions: args.pendingInteractions ?? [],
          ownsUnscopedInteractions: args.ownsUnscopedInteractions ?? true,
          viewerIsStarter: args.viewerIsStarter ?? true,
          starterDisplayName:
            args.starterDisplayName === undefined ? 'Avery' : args.starterDisplayName,
          actionStates: args.actionStates ?? {},
          nodeState: args.nodeState,
          onSubmitAsk: args.onSubmitAsk ?? (async (): Promise<void> => undefined),
          events: args.events ?? [],
          scopeKey:
            args.scopeKey ??
            (row === null
              ? 'run:run-1|node:none|sel:node:none'
              : nodeMessageScopeKey('run-1', row.nodeId, selection)),
          initialScrollTop: args.initialScrollTop,
          onScrollTopChange: args.onScrollTopChange ?? ((): void => undefined),
        })
      )
    );
  }

  test('fetches the selected node transcript once', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    const calls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return pending.promise;
    };

    await act(async () => {
      renderPane({ row: REVIEW_ROW, loadMessages });
    });
    await flush();
    expect(host.textContent).toContain('Loading node transcript');

    await act(async () => {
      pending.resolve({ messages: [...FIXTURE] });
    });
    await flushUntil(host, 'first fetch', () => (host.textContent ?? '').includes('first'));

    expect(calls).toEqual([['run-1', 'review']]);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
  });

  test('re-slices the same-node cache when the selected iteration changes', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    const calls: [string, string][] = [];
    const loadMessages = (runId: string, nodeId: string): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      return pending.promise;
    };

    await act(async () => {
      renderPane({ row: REVIEW_ROW, loadMessages });
    });
    await act(async () => {
      pending.resolve({ messages: [...FIXTURE] });
    });
    await flushUntil(host, 'cached fetch', () => (host.textContent ?? '').includes('first'));
    expect(calls).toEqual([['run-1', 'review']]);

    await act(async () => {
      renderPane({ row: ITERATION_TWO_ROW, loadMessages });
    });
    await flush();

    expect(calls[0]).toEqual(['run-1', 'review']);
    expect(calls.every(call => call[0] === 'run-1' && call[1] === 'review')).toBe(true);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(host.textContent).toContain('Read');
    expect(host.textContent).toContain('iteration_started');
    expect(host.textContent).toContain('iteration_failed');
    expect(host.textContent).not.toContain('first');
  });

  test('recovers from a deterministic error through Retry', async () => {
    let shouldFail = true;
    const calls: [string, string][] = [];
    const loadMessages = async (
      runId: string,
      nodeId: string
    ): Promise<WorkflowNodeMessagesResponse> => {
      calls.push([runId, nodeId]);
      if (shouldFail) {
        throw new Error('boom');
      }
      return { messages: [...FIXTURE] };
    };

    await act(async () => {
      renderPane({ row: REVIEW_ROW, loadMessages });
    });
    await flushUntil(host, 'error state', () =>
      (host.textContent ?? '').includes('Failed to load node transcript')
    );
    expect(host.textContent).toContain('Retry');
    expect(calls).toEqual([['run-1', 'review']]);

    shouldFail = false;
    const buttons = Array.from(host.querySelectorAll('button'));
    const retry = buttons.find(button => (button.textContent ?? '').includes('Retry'));
    if (retry === undefined) {
      throw new Error('missing Retry button');
    }

    await act(async () => {
      retry.click();
    });
    await flushUntil(host, 'retry recovery', () => (host.textContent ?? '').includes('first'));

    expect(calls).toEqual([
      ['run-1', 'review'],
      ['run-1', 'review'],
    ]);
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
  });

  function pendingAsk(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
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
      ...overrides,
    };
  }

  function reactProps(node: Element): {
    onChange?: (event: { target: { value: string; checked: boolean } }) => void;
    onSubmit?: (event: { preventDefault: () => void }) => void;
  } | null {
    const key = Object.keys(node).find(candidate => candidate.startsWith('__reactProps$'));
    if (key === undefined) {
      return null;
    }
    const props = (node as unknown as Record<string, unknown>)[key];
    if (props === null || typeof props !== 'object') {
      return null;
    }
    return props as {
      onChange?: (event: { target: { value: string; checked: boolean } }) => void;
      onSubmit?: (event: { preventDefault: () => void }) => void;
    };
  }

  const ASK_TOOL: WorkflowNodeMessageResponse = {
    id: 'm-ask-tool',
    seq: 8,
    kind: 'tool',
    payload: { name: 'AskHuman', id: 'tool-ask', input: { questions: [] } },
    created_at: CREATED_AT,
  };

  test('places an anchored Ask card after the matching tool chip and submits the request id', async () => {
    const submitted: [string, AskAnswerBody][] = [];
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE, ASK_TOOL],
        }),
        pendingInteractions: [pendingAsk()],
        onSubmitAsk: async (requestId, body): Promise<void> => {
          submitted.push([requestId, body]);
        },
      });
    });
    await flushUntil(host, 'anchored ask', () => (host.textContent ?? '').includes('Ship it?'));
    const text = host.textContent ?? '';
    expect(text.indexOf('AskHuman')).toBeGreaterThan(-1);
    expect(text.indexOf('AskHuman')).toBeLessThan(text.indexOf('Ship it?'));
    const ship = host.querySelector('input[type="radio"][value="Ship"]');
    if (!(ship instanceof win.HTMLInputElement)) {
      throw new Error('missing Ship control');
    }
    await act(async () => {
      const onChange = reactProps(ship)?.onChange;
      if (onChange === undefined) {
        throw new Error('missing radio onChange');
      }
      onChange({ target: { value: 'Ship', checked: true } });
    });
    await flush();
    const form = host.querySelector('form[aria-label="question from agent, 1 questions"]');
    if (form === null) {
      throw new Error('missing Ask form');
    }
    await act(async () => {
      form.dispatchEvent(
        new win.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event
      );
    });
    await flush();
    expect(submitted).toEqual([['tool-ask', { answers: [{ questionId: 'q1', value: 'Ship' }] }]]);
  });

  test('keeps unanchored current Asks at the end and hides other-slice and status-row cards', async () => {
    const loopMessages: WorkflowNodeMessageResponse[] = [
      { id: 's1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: CREATED_AT },
      {
        id: 'i1s',
        seq: 2,
        kind: 'status',
        payload: { state: 'iteration_started', detail: '1' },
        created_at: CREATED_AT,
      },
      {
        id: 't1',
        seq: 3,
        kind: 'tool',
        payload: { name: 'Write', id: 'tool-iter-1', input: {} },
        created_at: CREATED_AT,
      },
      {
        id: 'i1c',
        seq: 4,
        kind: 'status',
        payload: { state: 'iteration_completed', detail: '1' },
        created_at: CREATED_AT,
      },
      {
        id: 'i2s',
        seq: 5,
        kind: 'status',
        payload: { state: 'iteration_started', detail: '2' },
        created_at: CREATED_AT,
      },
      {
        id: 't2',
        seq: 6,
        kind: 'tool',
        payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
        created_at: CREATED_AT,
      },
      {
        id: 'i2c',
        seq: 7,
        kind: 'status',
        payload: { state: 'iteration_failed', detail: '2' },
        created_at: CREATED_AT,
      },
      { id: 'tail', seq: 8, kind: 'text', payload: { text: 'after-loop' }, created_at: CREATED_AT },
    ];
    const otherSliceAsk = pendingAsk({
      id: 'ask-iter-1',
      tool_use_id: 'tool-iter-1',
    });
    const unanchored = pendingAsk({
      id: 'ask-open',
      tool_use_id: 'tool-missing',
    });
    await act(async () => {
      renderPane({
        row: ITERATION_TWO_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: loopMessages,
        }),
        pendingInteractions: [otherSliceAsk, unanchored],
      });
    });
    await flushUntil(host, 'iteration two', () => (host.textContent ?? '').includes('Read'));
    expect(host.textContent).toContain('Read');
    expect(host.querySelector('form[aria-label="question from agent, 1 questions"]')).toBeNull();
    expect(host.textContent).not.toContain('Ship it?');
    expect(host.textContent).not.toContain('Ship it?');

    queryClient.clear();
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: loopMessages,
        }),
        pendingInteractions: [unanchored],
      });
    });
    await flushUntil(host, 'unanchored ask', () => (host.textContent ?? '').includes('Ship it?'));
    const text = host.textContent ?? '';
    expect(text.lastIndexOf('Ship it?')).toBeGreaterThan(text.indexOf('Read'));
    expect(text).toContain('Execution scope was not recorded for this interaction.');

    queryClient.clear();
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            ...FIXTURE,
            {
              id: 'm-awaiting',
              seq: 9,
              kind: 'status',
              payload: { state: 'awaiting', detail: 'waiting' },
              created_at: CREATED_AT,
            },
          ],
        }),
        pendingInteractions: [],
      });
    });
    await flushUntil(host, 'status awaiting', () => (host.textContent ?? '').includes('awaiting'));
    expect(host.querySelector('form[aria-label="question from agent, 1 questions"]')).toBeNull();
    expect(host.textContent).not.toContain('Ship it?');
  });

  test('still renders every node Ask after Retry when the transcript query fails', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => {
          throw new Error('boom');
        },
        pendingInteractions: [pendingAsk(), pendingAsk({ id: 'ask-2', tool_use_id: 'tool-b' })],
      });
    });
    await flushUntil(
      host,
      'error asks',
      () =>
        (host.textContent ?? '').includes('Failed to load node transcript') &&
        (host.textContent ?? '').includes('Ship it?')
    );
    expect(host.textContent).toContain('Retry');
    expect(
      host.querySelectorAll('form[aria-label="question from agent, 1 questions"]')
    ).toHaveLength(2);
  });

  test('keeps two pending Asks independent and focuses only the first actionable card', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            ASK_TOOL,
            {
              id: 'm-ask-tool-2',
              seq: 9,
              kind: 'tool',
              payload: { name: 'AskHuman', id: 'tool-b', input: {} },
              created_at: CREATED_AT,
            },
          ],
        }),
        pendingInteractions: [pendingAsk(), pendingAsk({ id: 'ask-2', tool_use_id: 'tool-b' })],
      });
    });
    await flushUntil(
      host,
      'two asks',
      () =>
        host.querySelectorAll('form[aria-label="question from agent, 1 questions"]').length === 2
    );
    expect(
      host.querySelectorAll('form[aria-label="question from agent, 1 questions"]')
    ).toHaveLength(2);
    expect((host.ownerDocument ?? document).activeElement?.id).toBe('room:ask-1:q1:Ship');
  });

  test('renders Invalid Ask payload for a malformed envelope with no mutation actions', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [ASK_TOOL],
        }),
        pendingInteractions: [pendingAsk({ envelope: { questions: [] } })],
      });
    });
    await flushUntil(host, 'invalid ask', () =>
      (host.textContent ?? '').includes('Invalid Ask payload')
    );
    expect(host.querySelector('form[aria-label="question from agent, 1 questions"]')).toBeNull();
    expect(host.textContent).not.toContain('Submit');
    expect(host.textContent).not.toContain('Decline');
  });

  test('shows Submit on a pending Ask when the viewer is not the starter', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        viewerIsStarter: false,
        starterDisplayName: 'Avery',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [ASK_TOOL],
        }),
        pendingInteractions: [pendingAsk()],
      });
    });
    await flushUntil(host, 'answerable Ask', () => (host.textContent ?? '').includes('Submit'));
    expect(host.querySelector('fieldset[disabled]')).toBeNull();
    expect(host.textContent).toContain('Submit');
    expect(host.textContent).toContain('Decline');
    expect(host.textContent).not.toContain('Waiting for Avery to answer');
  });

  const SCOPE_B_ROW: LogRow = {
    id: 'start-other',
    nodeId: 'other',
    label: 'Other',
    status: 'running',
    order: 1,
    sourceIndex: 1,
    selection: { kind: 'node' },
  };

  function textMessage(id: string, seq: number, body: string): WorkflowNodeMessageResponse {
    return { id, seq, kind: 'text', payload: { text: body }, created_at: CREATED_AT };
  }

  test('discards a late page from the previous scope and aborts its signal', async () => {
    const pageA1 = deferred<WorkflowNodeMessagesResponse>();
    const pageA2 = deferred<WorkflowNodeMessagesResponse>();
    const pageB1 = deferred<WorkflowNodeMessagesResponse>();
    const signals: AbortSignal[] = [];
    const savedScopeA: number[] = [];
    const savedScopeB: number[] = [];
    const loadMessages: NodeMessageLoader = async (runId, nodeId, options) => {
      expect(runId).toBe('run-1');
      expect(options.limit).toBe(100);
      if (options.signal !== undefined) signals.push(options.signal);
      if (nodeId === 'review' && options.afterSeq === 0) return pageA1.promise;
      if (nodeId === 'review') return pageA2.promise;
      return pageB1.promise;
    };

    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'running',
        loadMessages,
        onScrollTopChange: (scrollTop: number): void => {
          savedScopeA.push(scrollTop);
        },
      });
    });
    await act(async () => {
      pageA1.resolve({
        messages: [textMessage('a1', 1, 'scope-a-one')],
        hasMore: true,
        nextCursor: '1',
        highWatermark: 2,
      });
    });
    await flushUntil(host, 'scope a page one', () =>
      (host.textContent ?? '').includes('scope-a-one')
    );

    const scopeAScroll = host.querySelector('[data-testid="node-transcript-scroll"]');
    if (!(scopeAScroll instanceof HTMLElement)) throw new Error('missing scope A scroll host');
    scopeAScroll.scrollTop = 37;
    await act(async () => {
      renderPane({
        row: SCOPE_B_ROW,
        runStatus: 'running',
        loadMessages,
        onScrollTopChange: (scrollTop: number): void => {
          savedScopeB.push(scrollTop);
        },
      });
    });
    await flush();
    expect(signals[0]?.aborted).toBe(true);
    expect(savedScopeA).toContain(37);
    expect(savedScopeB).toEqual([]);

    await act(async () => {
      pageA2.resolve({
        messages: [textMessage('a2', 2, 'scope-a-late')],
        hasMore: false,
        nextCursor: '2',
        highWatermark: 2,
      });
      pageB1.resolve({
        messages: [textMessage('b1', 1, 'scope-b-one')],
        hasMore: false,
        nextCursor: '1',
        highWatermark: 1,
      });
    });
    await flushUntil(host, 'scope b', () => (host.textContent ?? '').includes('scope-b-one'));
    expect(host.textContent).not.toContain('scope-a-late');
    expect(host.textContent).not.toContain('scope-a-one');
  });

  test('keeps page-one rows on a later failure and retries from the retained cursor', async () => {
    const pageOne = deferred<WorkflowNodeMessagesResponse>();
    const pageTwo = deferred<WorkflowNodeMessagesResponse>();
    const pageRetry = deferred<WorkflowNodeMessagesResponse>();
    let calls = 0;
    const cursors: number[] = [];
    const loadMessages: NodeMessageLoader = async (_runId, _nodeId, options) => {
      calls += 1;
      cursors.push(options.afterSeq);
      if (calls === 1) return pageOne.promise;
      if (calls === 2) return pageTwo.promise;
      return pageRetry.promise;
    };

    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages });
    });
    await act(async () => {
      pageOne.resolve({
        messages: [textMessage('p1', 1, 'page-one')],
        hasMore: true,
        nextCursor: '1',
        highWatermark: 2,
      });
    });
    await flushUntil(host, 'page one', () => (host.textContent ?? '').includes('page-one'));

    await act(async () => {
      pageTwo.reject(new Error('page-two-failed'));
    });
    await flushUntil(host, 'incomplete', () =>
      (host.textContent ?? '').includes('Failed to load node transcript')
    );
    expect(host.textContent).toContain('page-one');
    expect(host.textContent).toContain('Retry');

    const retry = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Retry')
    );
    if (retry === undefined) throw new Error('missing Retry');
    await act(async () => {
      retry.click();
    });
    await act(async () => {
      pageRetry.resolve({
        messages: [textMessage('p2', 2, 'page-two')],
        hasMore: false,
        nextCursor: '2',
        highWatermark: 2,
      });
    });
    await flushUntil(host, 'retry recovered', () => (host.textContent ?? '').includes('page-two'));
    expect(cursors).toEqual([0, 1, 1]);
    expect(host.textContent).toContain('page-one');
  });

  test('polls a live run from the retained cursor and stops after a terminal drain', async () => {
    jest.useFakeTimers();
    type PageDeferred = ReturnType<typeof deferred<WorkflowNodeMessagesResponse>>;
    const pages: PageDeferred[] = [];
    const cursors: number[] = [];
    const loadMessages: NodeMessageLoader = async (_runId, _nodeId, options) => {
      cursors.push(options.afterSeq);
      const pending = deferred<WorkflowNodeMessagesResponse>();
      pages.push(pending);
      return pending.promise;
    };

    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'running', loadMessages });
    });
    await flush();
    expect(pages).toHaveLength(1);
    await act(async () => {
      pages[0]?.resolve({
        messages: [textMessage('live-1', 1, 'live-one')],
        hasMore: false,
        nextCursor: '1',
        highWatermark: 1,
      });
    });
    await flushUntil(host, 'live one', () => (host.textContent ?? '').includes('live-one'));

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await flush();
    expect(pages).toHaveLength(2);
    expect(cursors).toEqual([0, 1]);
    await act(async () => {
      pages[1]?.resolve({
        messages: [textMessage('live-2', 2, 'live-two')],
        hasMore: false,
        nextCursor: '2',
        highWatermark: 2,
      });
    });
    await flushUntil(host, 'live two', () => (host.textContent ?? '').includes('live-two'));

    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages });
    });
    await flush();
    const afterTerminal = pages.length;
    if (pages.length === afterTerminal) {
      const latest = pages[pages.length - 1];
      if (latest !== undefined && pages.length > 2) {
        await act(async () => {
          latest.resolve({
            messages: [],
            hasMore: false,
            nextCursor: '2',
            highWatermark: 2,
          });
        });
        await flush();
      }
    }
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await flush();
    expect(pages.length).toBe(afterTerminal);
    expect(host.textContent).toContain('live-two');
  });

  test('starts completed history at the top and follows running history until the reader scrolls away', async () => {
    const loadMessages: NodeMessageLoader = async () => ({
      messages: [textMessage('scroll-1', 1, 'scroll-one')],
      hasMore: false,
      nextCursor: '1',
      highWatermark: 1,
    });

    await act(async () => {
      renderPane({
        row: { ...REVIEW_ROW, status: 'completed' },
        runStatus: 'completed',
        loadMessages,
      });
    });
    await flushUntil(host, 'completed scroll', () =>
      (host.textContent ?? '').includes('scroll-one')
    );
    const scroller = host.querySelector('[data-testid="node-transcript-scroll"]');
    if (scroller === null) throw new Error('missing scroller');
    const completedScroller = scroller as unknown as HTMLElement;
    expect(completedScroller.scrollTop).toBe(0);

    const scrolls: number[] = [];
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'running',
        loadMessages,
        onScrollTopChange: (value): void => {
          scrolls.push(value);
        },
      });
    });
    await flushUntil(host, 'running scroll', () => (host.textContent ?? '').includes('scroll-one'));
    const liveScrollerNode = host.querySelector('[data-testid="node-transcript-scroll"]');
    if (liveScrollerNode === null) throw new Error('missing live scroller');
    const liveScroller = liveScrollerNode as unknown as HTMLElement;
    Object.defineProperty(liveScroller, 'scrollHeight', { configurable: true, value: 400 });
    Object.defineProperty(liveScroller, 'clientHeight', { configurable: true, value: 200 });
    await act(async () => {
      liveScroller.scrollTop = 200;
      liveScroller.dispatchEvent(new win.Event('scroll', { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      liveScroller.scrollTop = 175;
      liveScroller.dispatchEvent(new win.Event('scroll', { bubbles: true }) as unknown as Event);
    });
    const jump = Array.from(host.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Jump to latest')
    );
    if (jump === undefined) throw new Error('missing Jump to latest');
    await act(async () => {
      jump.click();
    });
    expect(liveScroller.scrollTop).toBe(200);
  });

  test('aborts the active request on unmount', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    let signal: AbortSignal | undefined;
    const loadMessages: NodeMessageLoader = async (_runId, _nodeId, options) => {
      signal = options.signal;
      return pending.promise;
    };
    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'running', loadMessages });
    });
    await flush();
    expect(signal?.aborted).toBe(false);
    await act(async () => {
      root.unmount();
    });
    expect(signal?.aborted).toBe(true);
  });

  function todoPair(toolUseId: string, seq: number, input: unknown): WorkflowNodeMessageResponse[] {
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

  const TODO_MESSAGES: WorkflowNodeMessageResponse[] = [
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

  function stripButton(): Element {
    const button = stripSection()?.querySelector('button');
    if (button === null || button === undefined) throw new Error('missing strip button');
    return button;
  }

  test('mounts the folded todo strip ahead of the scroller inside one room region', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'completed',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...TODO_MESSAGES],
        }),
      });
    });
    await flushUntil(host, 'todo strip', () => stripSection() !== null);

    const regions = host.querySelectorAll('[role="region"]');
    expect(regions).toHaveLength(1);
    const region = regions[0];
    if (region === undefined) throw new Error('missing room region');
    expect(region.getAttribute('aria-label')).toBe('review room');
    const strip = stripSection();
    const scroller = host.querySelector('[data-testid="node-transcript-scroll"]');
    if (scroller === null) throw new Error('missing scroller');
    // The strip and the scroller are siblings inside the single region.
    expect(region.firstElementChild).toBe(strip);
    expect(strip?.nextElementSibling).toBe(scroller);
    expect(scroller.querySelectorAll('[role="region"]')).toHaveLength(0);
    // The scroller owns scrolling; the region does not scroll.
    const scrollerClass = scroller.getAttribute('class') ?? '';
    expect(scrollerClass).toContain('overflow-y-auto');
    expect(scrollerClass).toContain('flex');
    expect(scrollerClass).toContain('flex-col');
    expect(region.getAttribute('class')).toContain('overflow-hidden');

    // Collapsed header contract.
    const button = stripButton();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const body = strip?.querySelector('[data-testid="todo-list"]');
    if (body === null || body === undefined) throw new Error('missing strip body');
    expect(body.hasAttribute('hidden')).toBe(true);
    expect(button.getAttribute('aria-controls')).toBe(body.id);
    expect(body.id).not.toBe('');
    expect(strip?.textContent).toContain('TODO');
    expect(strip?.textContent).toContain('1/12');
    expect(strip?.textContent).toContain('Map the message path');
    expect(strip?.querySelectorAll('[data-testid="todo-meter"] > span')).toHaveLength(12);
    const headings = Array.from(strip?.querySelectorAll('h3') ?? []).map(h => h.textContent);
    expect(headings).toEqual(['Research', 'Implement']);
    expect(strip?.textContent).toContain('· blocked: CI has one build job');
    expect(strip?.textContent).toContain('· dropped');
    // The strip opens on click.
    await act(async () => {
      (button as HTMLElement).click();
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(body.hasAttribute('hidden')).toBe(false);
    // Todo calls stay one-line tool rows; no checklist markup inside them.
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
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'completed',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil(host, 'fixture rows', () => (host.textContent ?? '').includes('first'));
    expect(stripSection()).toBeNull();
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
  });

  test('merges an initial page and later mutation pages into the final strip state', async () => {
    const loadMessages: NodeMessageLoader = async (_runId, _nodeId, options) => {
      if (options.afterSeq === 0) {
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
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages });
    });
    await flushUntil(host, 'merged strip', () =>
      (stripSection()?.textContent ?? '').includes('1/12')
    );
    const strip = stripSection();
    expect(strip?.textContent).toContain('Map the message path');
    expect(strip?.textContent).toContain('· blocked: CI has one build job');
    expect(strip?.textContent).toContain('· dropped');
  });

  test('keeps strip identity, open state, and focus across same-scope polls', async () => {
    const firstLoad: NodeMessageLoader = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: todoPair('todo-1', 1, TODO_INIT),
      nextCursor: '2',
      highWatermark: 2,
    });
    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages: firstLoad });
    });
    await flushUntil(host, 'initial strip', () =>
      (stripSection()?.textContent ?? '').includes('0/12')
    );
    const strip = stripSection();
    const button = stripButton() as HTMLElement;
    await act(async () => {
      button.focus();
      button.click();
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');

    const secondLoad: NodeMessageLoader = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: todoPair('todo-2', 3, { op: 'done', task: 'Read the spec' }),
      nextCursor: '4',
      highWatermark: 4,
    });
    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages: secondLoad });
    });
    await flushUntil(host, 'polled strip', () =>
      (stripSection()?.textContent ?? '').includes('1/12')
    );
    expect(stripSection()).toBe(strip);
    expect(stripButton().getAttribute('aria-expanded')).toBe('true');
    expect((win.document.activeElement as unknown) === button).toBe(true);
    expect(strip?.textContent).toContain('Map the message path');
  });

  test('unmounts the strip when every todo is removed and remounts collapsed for a new list', async () => {
    const firstLoad: NodeMessageLoader = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: todoPair('todo-1', 1, TODO_INIT),
      nextCursor: '2',
      highWatermark: 2,
    });
    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages: firstLoad });
    });
    await flushUntil(host, 'initial strip', () => stripSection() !== null);
    const strip = stripSection();
    const button = stripButton() as HTMLElement;
    await act(async () => {
      button.click();
    });
    expect(stripButton().getAttribute('aria-expanded')).toBe('true');

    const clearLoad: NodeMessageLoader = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: todoPair('todo-2', 3, { op: 'rm' }),
      nextCursor: '4',
      highWatermark: 4,
    });
    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages: clearLoad });
    });
    await flushUntil(host, 'cleared strip', () => stripSection() === null);

    const freshLoad: NodeMessageLoader = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: todoPair('todo-3', 5, {
        op: 'init',
        list: [{ phase: 'Solo', items: ['Only task'] }],
      }),
      nextCursor: '6',
      highWatermark: 6,
    });
    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages: freshLoad });
    });
    await flushUntil(host, 'fresh strip', () => stripSection() !== null);
    const freshStrip = stripSection();
    expect(freshStrip).not.toBe(strip);
    expect(stripButton().getAttribute('aria-expanded')).toBe('false');
    expect(freshStrip?.textContent).toContain('0/1');
    expect(freshStrip?.textContent).toContain('Only task');
  });

  test('remounts the strip collapsed when the scope changes', async () => {
    const loadMessages: NodeMessageLoader = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: todoPair('todo-1', 1, TODO_INIT),
      nextCursor: '2',
      highWatermark: 2,
    });
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'completed',
        loadMessages,
        scopeKey: 'scope-a',
      });
    });
    await flushUntil(host, 'scope a strip', () => stripSection() !== null);
    const stripA = stripSection();
    await act(async () => {
      (stripButton() as HTMLElement).click();
    });
    expect(stripButton().getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'completed',
        loadMessages,
        scopeKey: 'scope-b',
      });
    });
    await flushUntil(
      host,
      'scope b strip',
      () => stripSection() !== null && stripSection()?.textContent?.includes('0/12') === true
    );
    const stripB = stripSection();
    expect(stripB).not.toBe(stripA);
    expect(stripButton().getAttribute('aria-expanded')).toBe('false');
  });

  test('a later-page failure keeps the last good strip next to the error notice', async () => {
    let calls = 0;
    const loadMessages: NodeMessageLoader = async (_runId, _nodeId, options) => {
      calls += 1;
      if (options.afterSeq === 0) {
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
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages });
    });
    await flushUntil(host, 'page error', () =>
      (host.textContent ?? '').includes('Failed to load node transcript')
    );
    expect(calls).toBe(2);
    const strip = stripSection();
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toContain('0/12');
    expect(strip?.textContent).toContain('Read the spec');
    expect(host.textContent).toContain('Retry');
  });

  test('a first-page failure renders the error placeholder and no strip', async () => {
    const loadMessages: NodeMessageLoader = async (): Promise<WorkflowNodeMessagesResponse> => {
      throw new Error('boom');
    };
    await act(async () => {
      renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages });
    });
    await flushUntil(host, 'first-page error', () =>
      (host.textContent ?? '').includes('Failed to load node transcript')
    );
    expect(stripSection()).toBeNull();
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
  });

  test('loading and empty placeholders keep fill and centring inside the scroller', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'completed',
        loadMessages: (): Promise<WorkflowNodeMessagesResponse> => pending.promise,
      });
    });
    await flushUntil(host, 'loading placeholder', () =>
      (host.textContent ?? '').includes('Loading node transcript')
    );
    const scroller = host.querySelector('[data-testid="node-transcript-scroll"]');
    if (scroller === null) throw new Error('missing scroller');
    const scrollerClass = scroller.getAttribute('class') ?? '';
    expect(scrollerClass).toContain('flex');
    expect(scrollerClass).toContain('flex-col');
    expect(scrollerClass).toContain('overflow-y-auto');
    const placeholder = Array.from(scroller.querySelectorAll('div')).find(el =>
      (el.textContent ?? '').includes('Loading node transcript')
    );
    const placeholderClass = placeholder?.getAttribute('class') ?? '';
    expect(placeholderClass).toContain('flex-1');
    expect(placeholderClass).toContain('items-center');
    expect(placeholderClass).toContain('justify-center');
    expect(stripSection()).toBeNull();

    await act(async () => {
      pending.resolve({ messages: [] });
    });
    await flushUntil(host, 'empty placeholder', () =>
      (host.textContent ?? '').includes("Node hasn't produced output")
    );
    const emptyPlaceholder = Array.from(scroller.querySelectorAll('div')).find(el =>
      (el.textContent ?? '').includes("Node hasn't produced output")
    );
    const emptyClass = emptyPlaceholder?.getAttribute('class') ?? '';
    expect(emptyClass).toContain('flex-1');
    expect(emptyClass).toContain('items-center');
    expect(emptyClass).toContain('justify-center');
  });

  function dockField(): Element | null {
    return host.querySelector('textarea');
  }

  function dockRegionChildren(): Element[] {
    const region = host.querySelector('[role="region"]');
    return region === null ? [] : Array.from(region.children);
  }

  test('mounts the composer dock after the transcript scroller for a live running row', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'running',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil(host, 'composer field', () => dockField() !== null);

    const scroller = host.querySelector('[data-testid="node-transcript-scroll"]');
    const field = dockField();
    if (scroller === null || field === null) throw new Error('missing scroller or field');
    const dockWell = field.parentElement;
    const children = dockRegionChildren();
    expect(children.includes(scroller)).toBe(true);
    expect(children.includes(dockWell ?? scroller)).toBe(true);
    expect(children.indexOf(dockWell ?? scroller)).toBeGreaterThan(children.indexOf(scroller));
    expect(scroller.contains(dockWell)).toBe(false);
    expect(host.textContent).toContain('Cmd/Ctrl+Enter to send · this tab only');
    expect(host.textContent).not.toContain('queued ·');
  });

  test('renders no dock for a terminal row or a non-live run', async () => {
    await act(async () => {
      renderPane({
        row: { ...REVIEW_ROW, status: 'completed' },
        runStatus: 'completed',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil(host, 'completed transcript', () =>
      (host.textContent ?? '').includes('first')
    );
    expect(dockField()).toBeNull();

    // A stale running row on a finished (non-live) run must never steer.
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'completed',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flush();
    expect(dockField()).toBeNull();
  });

  test('a pending ask on this node blocks Queue with the exact visible reason', async () => {
    await act(async () => {
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'running',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE, ASK_TOOL],
        }),
        pendingInteractions: [pendingAsk()],
      });
    });
    await flushUntil(host, 'blocked dock', () =>
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
      renderPane({
        row: REVIEW_ROW,
        runStatus: 'running',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
        pendingInteractions: [pendingAsk({ id: 'ask-sibling', node_id: 'other-node' })],
      });
    });
    await flushUntil(host, 'composer field', () => dockField() !== null);
    expect(host.textContent).not.toContain("answer the agent's question first");
    const button = Array.from(host.querySelectorAll('button')).find(
      el => (el.textContent ?? '').trim() === 'Queue'
    );
    expect(button?.getAttribute('aria-disabled')).toBeNull();
  });

  test('an awaiting row blocks the dock even without a visible ask card', async () => {
    await act(async () => {
      renderPane({
        row: { ...REVIEW_ROW, status: 'awaiting' },
        runStatus: 'paused',
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [...FIXTURE],
        }),
      });
    });
    await flushUntil(host, 'awaiting block', () =>
      (host.textContent ?? '').includes("answer the agent's question first")
    );
    expect(dockField()).not.toBeNull();
  });

  describe('occurrence navigator', () => {
    const OCC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const OCC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const OCC_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    function execMeta(
      occurrenceId: string,
      retryEpoch = 0
    ): { execution: { occurrence_id: string; attempt_id: string; retry_epoch: number } } {
      return {
        execution: {
          occurrence_id: occurrenceId,
          attempt_id: `${occurrenceId}-attempt-1`,
          retry_epoch: retryEpoch,
        },
      };
    }

    function occText(
      seq: number,
      text: string,
      occurrenceId: string,
      retryEpoch = 0
    ): WorkflowNodeMessageResponse {
      return {
        id: `text-${seq}`,
        seq,
        kind: 'text',
        payload: { text },
        metadata: execMeta(occurrenceId, retryEpoch),
        created_at: CREATED_AT,
      };
    }

    function occStatus(
      seq: number,
      state: string,
      occurrenceId: string,
      retryEpoch = 0
    ): WorkflowNodeMessageResponse {
      return {
        id: `status-${seq}`,
        seq,
        kind: 'status',
        payload: { state },
        metadata: execMeta(occurrenceId, retryEpoch),
        created_at: CREATED_AT,
      };
    }

    const TWO_OCCURRENCES: readonly WorkflowNodeMessageResponse[] = [
      occStatus(1, 'started', OCC_A),
      occText(2, 'run-one', OCC_A),
      occStatus(3, 'completed', OCC_A),
      occStatus(4, 'started', OCC_B, 1),
      occText(5, 'run-two', OCC_B, 1),
      occStatus(6, 'completed', OCC_B, 1),
    ];

    function occHeadings(): HTMLElement[] {
      return Array.from(host.querySelectorAll<HTMLElement>('h3[id]'));
    }

    function occurrenceHeading(occurrenceId: string): HTMLElement {
      const heading = host.querySelector(`h3[id$="occ-${occurrenceId}"]`);
      if (!(heading instanceof HTMLElement)) throw new Error(`missing heading ${occurrenceId}`);
      return heading;
    }

    function navigatorSelect(): HTMLSelectElement {
      const select = host.querySelector('select');
      if (!(select instanceof HTMLSelectElement)) throw new Error('missing navigator select');
      return select;
    }

    function scrollerEl(): HTMLElement {
      const el = host.querySelector('[data-testid="node-transcript-scroll"]');
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
        renderPane({
          row: REVIEW_ROW,
          runStatus: 'completed',
          loadMessages: async (runId, nodeId): Promise<WorkflowNodeMessagesResponse> => {
            calls.push([runId, nodeId]);
            return { messages: [...TWO_OCCURRENCES] };
          },
          onScrollTopChange,
        });
      });
      await flushUntil(host, 'occurrences', () => (host.textContent ?? '').includes('run-two'));
      return calls;
    }

    test('no navigator for zero or one displayable occurrence group', async () => {
      await act(async () => {
        renderPane({
          row: REVIEW_ROW,
          runStatus: 'completed',
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [...FIXTURE],
          }),
        });
      });
      await flushUntil(host, 'unscoped fixture', () => (host.textContent ?? '').includes('first'));
      expect(host.querySelector('select')).toBeNull();
      expect(occHeadings()).toHaveLength(0);

      await act(async () => {
        renderPane({
          row: REVIEW_ROW,
          runStatus: 'completed',
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [occText(1, 'solo', OCC_A), occStatus(2, 'completed', OCC_A)],
          }),
        });
      });
      await flushUntil(host, 'single occurrence', () => (host.textContent ?? '').includes('solo'));
      expect(host.querySelector('select')).toBeNull();
    });

    test('renders a labelled select whose options mirror the headings verbatim', async () => {
      await mountTwoOccurrences();
      const select = navigatorSelect();
      const label = host.querySelector(`label[for="${select.id}"]`);
      expect(label?.textContent).toBe('Jump to');
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
      // Native select contract only — no custom key handlers.
      const props = reactProps(select) as Record<string, unknown> | null;
      expect(props?.onKeyDown).toBeUndefined();
      expect(props?.onKeyUp).toBeUndefined();
      expect(props?.onKeyPress).toBeUndefined();
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
      await commitSelect(select, OCC_B);

      expect(select.value).toBe(OCC_B);
      expect(select.getAttribute('aria-controls')).toBe(headingB.getAttribute('id'));
      expect(win.document.activeElement as unknown as Element | null).toBe(headingB);
      expect(scroller.scrollTop).toBe(150);
      expect(positions).toContain(150);
      // The navigator is a scroll action only — no request leaves the room.
      expect(calls).toEqual([['run-1', 'review']]);
      // The running room is now manually held — Jump to latest surfaces.
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
      await commitSelect(select, OCC_B);

      expect(win.document.activeElement as unknown as Element | null).toBe(headingB);
      expect(scroller.scrollTop).toBe(0);
      expect(jumpToLatestButton()?.className).toContain('ml-auto');
    });

    test('new rows arriving after navigation keep the held position', async () => {
      const messages: WorkflowNodeMessageResponse[] = [...TWO_OCCURRENCES];
      const calls: [string, string][] = [];
      const loadMessages: NodeMessageLoader = async (
        runId,
        nodeId
      ): Promise<WorkflowNodeMessagesResponse> => {
        calls.push([runId, nodeId]);
        return { messages: [...messages] };
      };
      await act(async () => {
        renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages });
      });
      await flushUntil(host, 'occurrences', () => (host.textContent ?? '').includes('run-two'));
      const scroller = scrollerEl();
      stubScroller(scroller);
      stubRect(occurrenceHeading(OCC_B), 150, 170);
      await commitSelect(navigatorSelect(), OCC_B);
      expect(scroller.scrollTop).toBe(150);

      messages.push(occText(7, 'run-two-more', OCC_B, 1));
      await act(async () => {
        renderPane({ row: REVIEW_ROW, runStatus: 'completed', loadMessages });
      });
      await flushUntil(host, 'grown rows', () => (host.textContent ?? '').includes('run-two-more'));

      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(scroller.scrollTop).toBe(150);
      expect(jumpToLatestButton()).not.toBeUndefined();
    });

    test('reader scroll after navigation stays manual; Jump to latest restores follow', async () => {
      await mountTwoOccurrences();
      const scroller = scrollerEl();
      stubScroller(scroller);
      stubRect(occurrenceHeading(OCC_B), 150, 170);
      await commitSelect(navigatorSelect(), OCC_B);
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

    test('a scope change drops the select to placeholder and lands focus on the scroller', async () => {
      await mountTwoOccurrences();
      const scroller = scrollerEl();
      stubScroller(scroller);
      stubRect(occurrenceHeading(OCC_B), 150, 170);
      const select = navigatorSelect();
      await commitSelect(select, OCC_B);
      expect(win.document.activeElement as unknown as Element | null).toBe(
        occurrenceHeading(OCC_B)
      );

      await act(async () => {
        renderPane({
          row: SCOPE_B_ROW,
          runStatus: 'completed',
          loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
            messages: [
              occStatus(1, 'started', OCC_A),
              occText(2, 'other-one', OCC_A),
              occStatus(3, 'started', OCC_C, 1),
              occText(4, 'other-three', OCC_C, 1),
            ],
          }),
        });
      });
      await flushUntil(host, 'scope b', () => (host.textContent ?? '').includes('other-three'));

      const after = navigatorSelect();
      expect(after.value).toBe('');
      expect(after.getAttribute('aria-controls')).toBeNull();
      // The focused heading unmounted: focus stays in the room, never on body.
      const active: unknown = win.document.activeElement;
      expect(active === null || active === win.document.body).toBe(false);
    });
  });
});
