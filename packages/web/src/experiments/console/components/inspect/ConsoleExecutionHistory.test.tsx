process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import type { ConsoleLogEntry } from './build-console-log-entries';
import type { Run } from '../../primitives/run';
import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
} from '../../skills/runs';
import { installHappyDom, restoreHappyDom } from '../../test/install-happy-dom';
import { UNSCOPED_INTERACTION_LIMITATION } from './execution-interactions';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const historyModule = await import('./ConsoleExecutionHistory');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';
const OCC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OCC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTEMPT_A = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_B = '22222222-2222-4222-8222-222222222222';

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
      execution: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B },
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
      execution: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B },
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
      execution: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B },
    },
    created_at: CREATED_AT,
  },
];

function occurrenceEntry(
  id: string,
  occurrenceId: string,
  attemptId: string,
  order: number,
  unknownScope = false
): ConsoleLogEntry {
  return {
    row: {
      id,
      nodeId: 'review',
      label: 'Review',
      status: 'completed',
      order,
      sourceIndex: order,
      selection: { kind: 'occurrence', occurrenceId, attemptId },
      unknownScope,
    },
    displayStatus: 'completed',
    startedAt: CREATED_AT,
    durationMs: null,
    costUsd: null,
    numTurns: null,
    stopReason: null,
    skipReason: null,
    skipExpr: null,
    showNodeUsage: true,
  };
}

function run(): Run {
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
  };
}

function ask(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
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
    provider_session_id: 'session-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

describe('ConsoleExecutionHistory', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  const first = occurrenceEntry('row-a', OCC_A, ATTEMPT_A, 0);
  const second = occurrenceEntry('row-b', OCC_B, ATTEMPT_B, 1);
  const all = [first, second];

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

  function renderHistory(
    overrides: Partial<Parameters<typeof historyModule.ConsoleExecutionHistory>[0]> & {
      loadMessages: (
        runId: string,
        nodeId: string,
        options?: {
          afterSeq?: number;
          limit?: number;
          occurrenceId?: string;
          attemptId?: string;
          signal?: AbortSignal;
        }
      ) => Promise<WorkflowNodeMessagesResponse>;
    }
  ): void {
    act(() => {
      root.render(
        createElement(historyModule.ConsoleExecutionHistory, {
          entry: second,
          allEntries: all,
          run: run(),
          events: [],
          isLive: false,
          pendingInteractions: [],
          showToolCalls: true,
          showSystem: true,
          viewerIsStarter: true,
          starterDisplayName: 'Avery',
          actionStates: {},
          onSubmitAsk: async (_requestId: string, _body: AskAnswerBody): Promise<void> => undefined,
          ...overrides,
        })
      );
    });
  }

  test('loads occurrence B with limit 100 and AbortSignal, then renders only that history', async () => {
    const recorded: {
      occurrenceId?: string;
      attemptId?: string;
      limit?: number;
      afterSeq?: number;
      signal?: AbortSignal;
    }[] = [];
    renderHistory({
      loadMessages: async (_runId, _nodeId, options) => {
        recorded.push({
          occurrenceId: options?.occurrenceId,
          attemptId: options?.attemptId,
          limit: options?.limit,
          afterSeq: options?.afterSeq,
          signal: options?.signal,
        });
        return {
          messages: [
            {
              id: 't-b',
              seq: 1,
              kind: 'text',
              payload: { text: 'occ-b-assistant' },
              created_at: CREATED_AT,
            },
            {
              id: 'tool-b',
              seq: 2,
              kind: 'tool',
              payload: { name: 'Bash', id: 'tool-b', input: { cmd: 'ls' }, output: { ok: true } },
              created_at: CREATED_AT,
            },
          ],
        };
      },
    });
    await flushUntil('occ b', () => (host.textContent ?? '').includes('occ-b-assistant'));
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded[0]?.occurrenceId).toBe(OCC_B);
    expect(recorded[0]?.attemptId).toBe(ATTEMPT_B);
    expect(recorded[0]?.limit).toBe(100);
    expect(recorded[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(host.textContent).toContain('ASSISTANT');
    expect(host.textContent).toContain('Bash');
    expect(host.textContent).not.toContain('occ-a-assistant');
  });

  test('unwraps the structured envelope once outputFormat arrives', async () => {
    const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => ({
      messages: [...REPORT_MESSAGES],
    });
    renderHistory({ loadMessages });
    await flushUntil('raw history', () => (host.textContent ?? '').includes('{"report"'));
    expect(host.textContent).toContain('{"report"');

    renderHistory({ loadMessages, outputFormat: REPORT_SCHEMA });
    await flushUntil('unwrapped history', () => (host.textContent ?? '').includes(REPORT_TEXT));
    expect(host.textContent).toContain(REPORT_TEXT);
    expect(host.textContent).not.toContain('{"report"');
  });

  test('an OMP task dispatch renders context and one card per subtask inside the owning row', async () => {
    const ompInput: Record<string, unknown> = {
      context: 'Read-only review. **Do not edit.**\n\n- report file:line',
      tasks: [
        { name: 'ScoutBackoff', agent: 'scout', task: 'Map every retry_backoff call site.' },
        { name: 'ScoutCI', agent: 'scout', task: 'Where is CARGO_BUILD_JOBS pinned?' },
      ],
    };
    renderHistory({
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 'call-task-1',
            seq: 10,
            kind: 'tool',
            payload: { name: 'Task', id: 'task-1', input: ompInput },
            metadata: { tool_phase: 'call' },
            created_at: CREATED_AT,
          },
          {
            id: 'result-task-1',
            seq: 11,
            kind: 'tool',
            payload: { name: 'Task', id: 'task-1', input: ompInput, output: 'done' },
            metadata: { tool_phase: 'result', outcome: 'success' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil(
      'task row',
      () => host.querySelector('details[data-tool-id="task-1"]') !== null
    );
    const rowEl = host.querySelector('details[data-tool-id="task-1"]');
    if (rowEl === null) throw new Error('task row missing');
    const row = rowEl as Element & { open: boolean };
    // The task body mounts only once the row opens.
    const summary = row.querySelector('summary');
    if (summary === null) throw new Error('task row summary missing');
    await act(async () => {
      summary.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });
    expect(row.open).toBe(true);
    expect(row.textContent).toContain('task · batch · 2 subtasks');
    expect(row.textContent).toContain('Read-only review.');
    const cards = row.querySelectorAll('details[data-subtask-index]');
    expect(cards).toHaveLength(2);
    const firstSummary = cards[0]?.querySelector('summary');
    expect(firstSummary?.textContent).toContain('scout');
    expect(firstSummary?.textContent).toContain('ScoutBackoff');
    expect(firstSummary?.textContent).toContain('Map every retry_backoff call site.');
  });

  test('renders a matching Ask after recorded history', async () => {
    renderHistory({
      pendingInteractions: [
        ask({ execution_scope: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B } }),
      ],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 't-b',
            seq: 1,
            kind: 'text',
            payload: { text: 'occ-b-assistant' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil('ask', () => (host.textContent ?? '').includes('Ship it?'));
    const text = host.textContent ?? '';
    expect(text.indexOf('occ-b-assistant')).toBeLessThan(text.indexOf('Ship it?'));
    expect(host.querySelector('form')).not.toBeNull();
  });

  test('shows the unscoped Ask limitation', async () => {
    renderHistory({
      pendingInteractions: [ask()],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 't-b',
            seq: 1,
            kind: 'text',
            payload: { text: 'occ-b-assistant' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil('limitation', () =>
      (host.textContent ?? '').includes(UNSCOPED_INTERACTION_LIMITATION)
    );
    expect(host.textContent).toContain('Ship it?');
  });

  test('keeps the Ask when Tool and System are hidden', async () => {
    renderHistory({
      showToolCalls: false,
      showSystem: false,
      pendingInteractions: [
        ask({ execution_scope: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B } }),
      ],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 't-b',
            seq: 1,
            kind: 'text',
            payload: { text: 'keep-me' },
            created_at: CREATED_AT,
          },
          {
            id: 'tool-1',
            seq: 2,
            kind: 'tool',
            payload: { name: 'AskHuman', id: 'tool-ask', input: {} },
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
    await flushUntil('ask remains', () => (host.textContent ?? '').includes('Ship it?'));
    expect(host.textContent).toContain('keep-me');
    expect(host.textContent).not.toContain('AskHuman');
    expect(host.textContent).not.toContain('iteration_started');
    expect(host.querySelector('form')).not.toBeNull();
  });

  test('retains page one and Retry when page two is rejected', async () => {
    const pageOne: WorkflowNodeMessage = {
      id: 'p1',
      seq: 1,
      kind: 'text',
      payload: { text: 'page-one' },
      created_at: CREATED_AT,
    };
    renderHistory({
      loadMessages: async (_runId, _nodeId, options): Promise<WorkflowNodeMessagesResponse> => {
        if ((options?.afterSeq ?? 0) === 0) {
          return {
            messages: [pageOne],
            hasMore: true,
            nextCursor: '1',
            highWatermark: 2,
          };
        }
        throw new Error('page two failed');
      },
    });
    await flushUntil('page one', () => (host.textContent ?? '').includes('page-one'));
    expect(host.textContent).toContain('Retry');
    expect(host.textContent).toContain('Failed to load node transcript');
  });

  test('slices fallback loop transcripts to the selected iteration', async () => {
    const loopEntry: ConsoleLogEntry = {
      ...second,
      row: {
        ...second.row,
        selection: { kind: 'loop_iteration', iteration: 2 },
        unknownScope: true,
      },
    };
    renderHistory({
      entry: loopEntry,
      allEntries: [loopEntry],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 'iteration-1-start',
            seq: 1,
            kind: 'status',
            payload: { state: 'iteration_started', detail: '1' },
            created_at: CREATED_AT,
          },
          {
            id: 'iteration-1-text',
            seq: 2,
            kind: 'text',
            payload: { text: 'iteration-one' },
            created_at: CREATED_AT,
          },
          {
            id: 'iteration-2-start',
            seq: 3,
            kind: 'status',
            payload: { state: 'iteration_started', detail: '2' },
            created_at: CREATED_AT,
          },
          {
            id: 'iteration-2-text',
            seq: 4,
            kind: 'text',
            payload: { text: 'iteration-two' },
            created_at: CREATED_AT,
          },
          {
            id: 'iteration-2-end',
            seq: 5,
            kind: 'status',
            payload: { state: 'iteration_completed', detail: '2' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil('iteration two', () => (host.textContent ?? '').includes('iteration-two'));
    expect(host.textContent).not.toContain('iteration-one');
  });

  test('assigns an unscoped route transcript only to the latest route section', async () => {
    const firstRoute: ConsoleLogEntry = {
      ...first,
      row: {
        ...first.row,
        selection: { kind: 'route_iteration', executionSeq: 1 },
        unknownScope: true,
      },
    };
    const secondRoute: ConsoleLogEntry = {
      ...second,
      row: {
        ...second.row,
        selection: { kind: 'route_iteration', executionSeq: 2 },
        unknownScope: true,
      },
    };
    let loads = 0;
    const loadMessages = async (): Promise<WorkflowNodeMessagesResponse> => {
      loads += 1;
      return {
        messages: [
          {
            id: 'route-text',
            seq: 1,
            kind: 'text',
            payload: { text: 'shared-route-history' },
            created_at: CREATED_AT,
          },
        ],
      };
    };
    renderHistory({
      entry: firstRoute,
      allEntries: [firstRoute, secondRoute],
      loadMessages,
    });
    await flush();
    expect(loads).toBe(0);
    expect(host.textContent).not.toContain('shared-route-history');

    renderHistory({
      entry: secondRoute,
      allEntries: [firstRoute, secondRoute],
      loadMessages,
    });
    await flushUntil('latest route history', () =>
      (host.textContent ?? '').includes('shared-route-history')
    );
    expect(loads).toBe(1);
    expect(host.textContent).toContain(
      'Execution scope was not recorded; this history may include other executions of the same node.'
    );
  });

  test('renders the same collapsed tool row contract as the selected room', async () => {
    renderHistory({
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 'call-t-1',
            seq: 1,
            kind: 'tool',
            payload: { name: 'Read', id: 't-1', input: { path: 'a.ts' } },
            metadata: { tool_phase: 'call' },
            created_at: CREATED_AT,
          },
          {
            id: 'result-t-1',
            seq: 2,
            kind: 'tool',
            payload: { name: 'Read', id: 't-1', input: { path: 'a.ts' }, output: 'chunk' },
            metadata: { tool_phase: 'result', outcome: 'success' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil('tool row', () => host.querySelector('details[data-tool-id="t-1"]') !== null);
    const rowEl = host.querySelector('details[data-tool-id="t-1"]');
    if (rowEl === null) throw new Error('tool row missing');
    const row = rowEl as Element & { open: boolean };
    expect(row.open).toBe(false);
    const summaryEl = row.querySelector('summary');
    if (summaryEl === null) throw new Error('summary missing');
    const summary = summaryEl as unknown as HTMLElement;
    expect(summary.parentElement as unknown as Element | null).toBe(row);
    expect(summary.textContent).toContain('Read');
    expect(summary.textContent).toContain('a.ts');
    expect(summary.textContent).toContain('succeeded');
    // Same Console delta: +2 px focus outline offset.
    expect(summary.className).toContain('focus-visible:outline-offset-2');
    expect(summary.className).not.toContain('focus-visible:-outline-offset-2');
    // A collapsed row mounts no expanded region: no family body, no Raw
    // toggle, and never the serialized payload.
    expect(row.querySelector('.tool-family-body')).toBeNull();
    expect(row.querySelector('button[aria-expanded]')).toBeNull();
    expect(row.querySelectorAll('details')).toHaveLength(0);
    expect(row.querySelector('pre')).toBeNull();
    expect(row.textContent).not.toContain('chunk');

    // Pointer toggle opens the row into the family body + Raw swap slot.
    await act(async () => {
      summary.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });
    expect(row.open).toBe(true);
    const rawEl = row.querySelector('button[aria-expanded]');
    if (rawEl === null) throw new Error('Raw toggle missing');
    expect(rawEl.getAttribute('aria-expanded')).toBe('false');
    const body = row.querySelector('.tool-family-body');
    if (body === null) throw new Error('family body missing');
    expect(body.textContent).toContain('a.ts');
    expect(body.textContent).toContain('chunk');
    expect(row.querySelectorAll('details')).toHaveLength(0);
    expect(row.querySelector('pre')).toBeNull();

    // Opening Raw through this caller mounts the shared payload panel.
    await act(async () => {
      rawEl.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });
    expect(rawEl.getAttribute('aria-expanded')).toBe('true');
    const panelId = rawEl.getAttribute('aria-controls');
    if (panelId === null) throw new Error('aria-controls missing');
    const panel = win.document.getElementById(panelId);
    expect(panel?.textContent).toBe(
      JSON.stringify({ name: 'Read', input: { path: 'a.ts' }, output: 'chunk' }, null, 2)
    );
    expect(row.open).toBe(true);
  });

  test('renders no Todo strip section for todo tool input', async () => {
    renderHistory({
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 'call-todo-1',
            seq: 1,
            kind: 'tool',
            payload: {
              name: 'todo',
              id: 'todo-1',
              input: {
                op: 'init',
                phase: 'Research',
                items: ['Read the spec', 'Map the message path'],
              },
            },
            metadata: { tool_phase: 'call' },
            created_at: CREATED_AT,
          },
          {
            id: 'result-todo-1',
            seq: 2,
            kind: 'tool',
            payload: { name: 'todo', id: 'todo-1', output: 'todo updated' },
            metadata: { tool_phase: 'result', outcome: 'success' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil(
      'todo row',
      () => host.querySelector('details[data-tool-id="todo-1"]') !== null
    );
    expect(host.querySelector('section[aria-label="Todo"]')).toBeNull();
  });

  test('polls only active execution rows in a live run', () => {
    expect(historyModule.shouldPollExecutionHistory(true, 'running')).toBe(true);
    expect(historyModule.shouldPollExecutionHistory(true, 'awaiting')).toBe(true);
    expect(historyModule.shouldPollExecutionHistory(true, 'completed')).toBe(false);
    expect(historyModule.shouldPollExecutionHistory(true, 'failed')).toBe(false);
    expect(historyModule.shouldPollExecutionHistory(false, 'running')).toBe(false);
  });

  describe('Console occurrence headings', () => {
    function headings(): Element[] {
      return Array.from(host.querySelectorAll('h3[id]'));
    }

    function headingTexts(): string[] {
      return headings().map(el => el.textContent ?? '');
    }

    test('renders one h3 heading per occurrence group and never a navigator', async () => {
      renderHistory({
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            {
              id: 't-a',
              seq: 1,
              kind: 'text',
              payload: { text: 'alpha' },
              metadata: {
                execution: { occurrence_id: OCC_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
              },
              created_at: CREATED_AT,
            },
            {
              id: 't-b',
              seq: 2,
              kind: 'text',
              payload: { text: 'beta' },
              metadata: {
                execution: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B, retry_epoch: 1 },
              },
              created_at: CREATED_AT,
            },
          ],
        }),
      });
      await flushUntil('beta', () => (host.textContent ?? '').includes('beta'));
      expect(headingTexts()).toEqual(['Run 1', 'Run 2 · retry']);
      const first = headings()[0];
      expect(first?.getAttribute('tabindex')).toBe('-1');
      expect(first?.getAttribute('id')).toContain(OCC_A);
      expect(host.querySelectorAll('select')).toHaveLength(0);
      expect(host.textContent).not.toContain('Jump to');
    });

    test('follows the same visibility rule — filtering to one displayable group removes headings', async () => {
      renderHistory({
        showToolCalls: false,
        showSystem: false,
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            {
              id: 'call-t-1',
              seq: 1,
              kind: 'tool',
              payload: { name: 'Read', id: 't-1', input: { path: 'a.ts' } },
              metadata: {
                tool_phase: 'call',
                execution: { occurrence_id: OCC_A, attempt_id: ATTEMPT_A },
              },
              created_at: CREATED_AT,
            },
            {
              id: 'result-t-1',
              seq: 2,
              kind: 'tool',
              payload: { name: 'Read', id: 't-1', input: { path: 'a.ts' }, output: 'chunk' },
              metadata: {
                tool_phase: 'result',
                outcome: 'success',
                execution: { occurrence_id: OCC_A, attempt_id: ATTEMPT_A },
              },
              created_at: CREATED_AT,
            },
            {
              id: 'st-a',
              seq: 3,
              kind: 'status',
              payload: { state: 'completed' },
              metadata: { execution: { occurrence_id: OCC_A, attempt_id: ATTEMPT_A } },
              created_at: CREATED_AT,
            },
            {
              id: 't-b',
              seq: 4,
              kind: 'text',
              payload: { text: 'beta' },
              metadata: { execution: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B } },
              created_at: CREATED_AT,
            },
          ],
        }),
      });
      await flushUntil('beta', () => (host.textContent ?? '').includes('beta'));
      expect(headings()).toHaveLength(0);
      expect(host.querySelector('details[data-tool-id="t-1"]')).toBeNull();
    });

    test('keeps unanchored Ask extras after grouped history without a synthetic heading', async () => {
      renderHistory({
        pendingInteractions: [ask()],
        loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
          messages: [
            {
              id: 't-a',
              seq: 1,
              kind: 'text',
              payload: { text: 'alpha' },
              metadata: { execution: { occurrence_id: OCC_A, attempt_id: ATTEMPT_A } },
              created_at: CREATED_AT,
            },
            {
              id: 't-b',
              seq: 2,
              kind: 'text',
              payload: { text: 'beta' },
              metadata: { execution: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B } },
              created_at: CREATED_AT,
            },
          ],
        }),
      });
      await flushUntil('ask', () => (host.textContent ?? '').includes('Ship it?'));
      expect(headings()).toHaveLength(2);
      const text = host.textContent ?? '';
      expect(text.indexOf('Ship it?')).toBeGreaterThan(text.indexOf('Run 1 · occurrence 2'));
      expect(host.querySelector('form')).not.toBeNull();
    });
  });
});
