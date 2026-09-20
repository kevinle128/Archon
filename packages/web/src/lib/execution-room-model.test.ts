import { describe, expect, test } from 'bun:test';

import type { components } from './api.generated';
import {
  applyRoomDeepLink,
  askCardId,
  buildExecutionHeader,
  chooseExecutionForInteraction,
  chooseExecutionForNode,
  closeRoom,
  hasTerminalNodeEvidence,
  hasIdleAwaitExpiredEvidence,
  hasUnsettledNodeExecutions,
  latestNodeExecutionKey,
  openRoom,
  openExplicitRoom,
  rememberRoomScroll,
  resetRoomVisit,
  resolveFinishedIterationView,
  resolveRunDetailRefetchIntervalMs,
  roomOpenerId,
  runtimeForSelection,
  type ExecutionLoopAncestryEntry,
  type ExecutionRow,
  type ExecutionRowSelection,
} from './execution-room-model';

const RUN_STARTED_AT = '2026-09-08T00:00:00.000Z';
const NODE_ID = 'review';

type WorkflowEvent = components['schemas']['WorkflowEvent'];

function row(
  overrides: Partial<ExecutionRow> & Pick<ExecutionRow, 'id' | 'status' | 'order'>
): ExecutionRow {
  return {
    nodeId: NODE_ID,
    label: 'Review',
    selection: { kind: 'node' },
    unknownScope: true,
    ...overrides,
  };
}

function nodeStarted(args: {
  id: string;
  nodeId?: string;
  occurrenceId?: string;
  attemptId?: string;
  provider?: string;
  model?: string;
}): WorkflowEvent {
  const data: Record<string, unknown> = {};
  if (args.occurrenceId !== undefined) data.occurrence_id = args.occurrenceId;
  if (args.attemptId !== undefined) data.attempt_id = args.attemptId;
  if (args.provider !== undefined) data.provider = args.provider;
  if (args.model !== undefined) data.model = args.model;
  return {
    id: args.id,
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: args.nodeId ?? NODE_ID,
    data,
    created_at: RUN_STARTED_AT,
  };
}

describe('chooseExecutionForNode', () => {
  const completedEarly = row({ id: 'completed-early', status: 'completed', order: 0 });
  const running = row({ id: 'running', status: 'running', order: 1 });
  const awaiting = row({ id: 'awaiting', status: 'awaiting', order: 2 });
  const completedLatest = row({ id: 'completed-latest', status: 'completed', order: 3 });
  const rows = [completedEarly, running, awaiting, completedLatest];

  test('a valid last-explicit row wins', () => {
    expect(chooseExecutionForNode(rows, NODE_ID, 'completed-early')).toBe(completedEarly);
  });

  test('awaiting wins over running and completed', () => {
    expect(chooseExecutionForNode(rows, NODE_ID, null)).toBe(awaiting);
  });

  test('running wins without awaiting', () => {
    expect(chooseExecutionForNode([completedEarly, running, completedLatest], NODE_ID, null)).toBe(
      running
    );
  });

  test('latest row by order wins without awaiting or running', () => {
    expect(chooseExecutionForNode([completedEarly, completedLatest], NODE_ID, null)).toBe(
      completedLatest
    );
  });

  test('a stale last-explicit id is ignored', () => {
    expect(chooseExecutionForNode(rows, NODE_ID, 'missing-row')).toBe(awaiting);
  });

  test('returns null for an unknown node', () => {
    expect(chooseExecutionForNode(rows, 'other', 'awaiting')).toBeNull();
  });
});

describe('resolveFinishedIterationView', () => {
  function occurrenceRow(args: {
    id: string;
    status: string;
    order: number;
    iteration: number;
    occurrenceId?: string;
    nodeId?: string;
    retryEpoch?: number;
    routeActivationSeq?: number;
    loopAncestry?: readonly ExecutionLoopAncestryEntry[];
    unknownScope?: boolean;
  }): ExecutionRow {
    const loopAncestry =
      args.loopAncestry ??
      ([{ nodeId: args.nodeId ?? NODE_ID, iteration: args.iteration }] as const);
    const selection: ExecutionRowSelection = {
      kind: 'occurrence',
      occurrenceId: args.occurrenceId ?? args.id,
      iteration: args.iteration,
      ...(args.retryEpoch !== undefined ? { retryEpoch: args.retryEpoch } : {}),
      ...(args.routeActivationSeq !== undefined
        ? { routeActivationSeq: args.routeActivationSeq }
        : {}),
      loopAncestry,
    };
    return row({
      id: args.id,
      status: args.status,
      order: args.order,
      nodeId: args.nodeId ?? NODE_ID,
      selection,
      unknownScope: args.unknownScope ?? false,
    });
  }

  function resolve(
    rows: readonly ExecutionRow[],
    selected: ExecutionRow,
    overrides?: { nodeStatus?: string; live?: boolean }
  ) {
    return resolveFinishedIterationView({
      rows,
      selected,
      nodeStatus: overrides?.nodeStatus ?? 'running',
      live: overrides?.live ?? true,
    });
  }

  test('completed ×1 + live ×2 in the same top-level lineage resolves ×2', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([finished, live], finished)).toEqual({
      liveRowId: 'occ-2',
      liveIteration: 2,
    });
  });

  test('a loop_group body row with the same parent ancestry resolves its later row', () => {
    const ancestry1 = [
      { nodeId: 'outer', iteration: 1 },
      { nodeId: 'body', iteration: 1 },
    ] as const;
    const ancestry2 = [
      { nodeId: 'outer', iteration: 1 },
      { nodeId: 'body', iteration: 2 },
    ] as const;
    const finished = occurrenceRow({
      id: 'body-1',
      status: 'completed',
      order: 0,
      iteration: 1,
      nodeId: 'body',
      loopAncestry: ancestry1,
    });
    const live = occurrenceRow({
      id: 'body-2',
      status: 'running',
      order: 1,
      iteration: 2,
      nodeId: 'body',
      loopAncestry: ancestry2,
    });
    expect(resolve([finished, live], finished)).toEqual({
      liveRowId: 'body-2',
      liveIteration: 2,
    });
  });

  test('selected live row returns null', () => {
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([live], live)).toBeNull();
  });

  test('non-live run returns null', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([finished, live], finished, { live: false })).toBeNull();
  });

  test('terminal node status returns null', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const later = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([finished, later], finished, { nodeStatus: 'completed' })).toBeNull();
  });

  test('no later live candidate returns null', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    expect(resolve([finished], finished)).toBeNull();
  });

  test('only-terminal candidates return null', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const later = occurrenceRow({ id: 'occ-2', status: 'completed', order: 1, iteration: 2 });
    expect(resolve([finished, later], finished)).toBeNull();
  });

  test('node selection returns null', () => {
    const selected = row({
      id: 'node-1',
      status: 'completed',
      order: 0,
      selection: { kind: 'node' },
    });
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([selected, live], selected)).toBeNull();
  });

  test('event-fallback loop_iteration returns null', () => {
    const selected = row({
      id: 'loop-1',
      status: 'completed',
      order: 0,
      selection: { kind: 'loop_iteration', iteration: 1 },
    });
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([selected, live], selected)).toBeNull();
  });

  test('route-only selection returns null', () => {
    const selected = row({
      id: 'route-1',
      status: 'completed',
      order: 0,
      selection: { kind: 'route_iteration', executionSeq: 1 },
    });
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([selected, live], selected)).toBeNull();
  });

  test('outer occurrence with different final loop node returns null', () => {
    const finished = occurrenceRow({
      id: 'outer-1',
      status: 'completed',
      order: 0,
      iteration: 1,
      nodeId: 'outer',
      loopAncestry: [{ nodeId: 'outer', iteration: 1 }],
    });
    const live = occurrenceRow({
      id: 'inner-2',
      status: 'running',
      order: 1,
      iteration: 2,
      nodeId: 'outer',
      loopAncestry: [{ nodeId: 'inner', iteration: 2 }],
    });
    expect(resolve([finished, live], finished)).toBeNull();
  });

  test('different retry epoch returns null', () => {
    const finished = occurrenceRow({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      iteration: 1,
      retryEpoch: 0,
    });
    const live = occurrenceRow({
      id: 'occ-2',
      status: 'running',
      order: 1,
      iteration: 2,
      retryEpoch: 1,
    });
    expect(resolve([finished, live], finished)).toBeNull();
  });

  test('undefined and retry epoch 0 compare as the same initial retry', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const live = occurrenceRow({
      id: 'occ-2',
      status: 'running',
      order: 1,
      iteration: 2,
      retryEpoch: 0,
    });
    expect(resolve([finished, live], finished)).toEqual({
      liveRowId: 'occ-2',
      liveIteration: 2,
    });
  });

  test('route activation absence does not equal a numeric value', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const live = occurrenceRow({
      id: 'occ-2',
      status: 'running',
      order: 1,
      iteration: 2,
      routeActivationSeq: 1,
    });
    expect(resolve([finished, live], finished)).toBeNull();
  });

  test('matching route activation allows resolution', () => {
    const finished = occurrenceRow({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      iteration: 1,
      routeActivationSeq: 3,
    });
    const live = occurrenceRow({
      id: 'occ-2',
      status: 'running',
      order: 1,
      iteration: 2,
      routeActivationSeq: 3,
    });
    expect(resolve([finished, live], finished)).toEqual({
      liveRowId: 'occ-2',
      liveIteration: 2,
    });
  });

  test('selected or candidate unknown scope returns null', () => {
    const finished = occurrenceRow({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      iteration: 1,
      unknownScope: true,
    });
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([finished, live], finished)).toBeNull();

    const knownFinished = occurrenceRow({
      id: 'occ-1b',
      status: 'completed',
      order: 0,
      iteration: 1,
    });
    const unknownLive = occurrenceRow({
      id: 'occ-2b',
      status: 'running',
      order: 1,
      iteration: 2,
      unknownScope: true,
    });
    expect(resolve([knownFinished, unknownLive], knownFinished)).toBeNull();
  });

  test('empty ancestry returns null', () => {
    const finished = row({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      unknownScope: false,
      selection: {
        kind: 'occurrence',
        occurrenceId: 'occ-1',
        iteration: 1,
        loopAncestry: [],
      },
    });
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([finished, live], finished)).toBeNull();
  });

  test('malformed selected final iteration returns null', () => {
    const finished = occurrenceRow({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      iteration: 9,
      loopAncestry: [{ nodeId: NODE_ID, iteration: 1 }],
    });
    // Force disagreement: displayed iteration 9 vs ancestry final 1
    const live = occurrenceRow({ id: 'occ-2', status: 'running', order: 1, iteration: 2 });
    expect(resolve([finished, live], finished)).toBeNull();
  });

  test('malformed candidate final iteration returns null', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const live = occurrenceRow({
      id: 'occ-2',
      status: 'running',
      order: 1,
      iteration: 9,
      loopAncestry: [{ nodeId: NODE_ID, iteration: 2 }],
    });
    expect(resolve([finished, live], finished)).toBeNull();
  });

  test('earlier candidate returns null', () => {
    const finished = occurrenceRow({ id: 'occ-2', status: 'completed', order: 1, iteration: 2 });
    const earlier = occurrenceRow({ id: 'occ-1', status: 'running', order: 0, iteration: 1 });
    expect(resolve([earlier, finished], finished)).toBeNull();
  });

  test('different nested ancestry prefix returns null', () => {
    const finished = occurrenceRow({
      id: 'body-1',
      status: 'completed',
      order: 0,
      iteration: 1,
      nodeId: 'body',
      loopAncestry: [
        { nodeId: 'outer', iteration: 1 },
        { nodeId: 'body', iteration: 1 },
      ],
    });
    const live = occurrenceRow({
      id: 'body-2',
      status: 'running',
      order: 1,
      iteration: 2,
      nodeId: 'body',
      loopAncestry: [
        { nodeId: 'outer', iteration: 2 },
        { nodeId: 'body', iteration: 2 },
      ],
    });
    expect(resolve([finished, live], finished)).toBeNull();
  });

  test('awaiting is preferred to running, then latest order', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const runningEarly = occurrenceRow({
      id: 'occ-run-early',
      status: 'running',
      order: 3,
      iteration: 4,
    });
    const runningLate = occurrenceRow({
      id: 'occ-run-late',
      status: 'running',
      order: 4,
      iteration: 5,
    });
    const awaitingEarly = occurrenceRow({
      id: 'occ-await-early',
      status: 'awaiting',
      order: 1,
      iteration: 2,
    });
    const awaitingLate = occurrenceRow({
      id: 'occ-await-late',
      status: 'awaiting',
      order: 2,
      iteration: 3,
    });
    expect(
      resolve([finished, awaitingEarly, awaitingLate, runningEarly, runningLate], finished)
    ).toEqual({
      liveRowId: 'occ-await-late',
      liveIteration: 3,
    });
    expect(resolve([finished, runningEarly, runningLate], finished)).toEqual({
      liveRowId: 'occ-run-late',
      liveIteration: 5,
    });
  });

  test('never falls back to a terminal row when a live candidate exists only mismatched', () => {
    const finished = occurrenceRow({ id: 'occ-1', status: 'completed', order: 0, iteration: 1 });
    const terminalLater = occurrenceRow({
      id: 'occ-done',
      status: 'completed',
      order: 2,
      iteration: 3,
    });
    const mismatchedLive = occurrenceRow({
      id: 'occ-retry',
      status: 'running',
      order: 1,
      iteration: 2,
      retryEpoch: 1,
    });
    expect(resolve([finished, mismatchedLive, terminalLater], finished)).toBeNull();
  });
});

describe('chooseExecutionForInteraction', () => {
  const first = row({
    id: 'first',
    status: 'completed',
    order: 0,
    selection: {
      kind: 'occurrence',
      occurrenceId: '11111111-1111-4111-8111-111111111111',
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  });
  const second = row({
    id: 'second',
    status: 'awaiting',
    order: 1,
    selection: {
      kind: 'occurrence',
      occurrenceId: '22222222-2222-4222-8222-222222222222',
      attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  });

  test('selects the exact recorded occurrence and attempt', () => {
    expect(
      chooseExecutionForInteraction([first, second], {
        node_id: NODE_ID,
        execution_scope: {
          occurrence_id: '11111111-1111-4111-8111-111111111111',
          attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      })
    ).toBe(first);
  });

  test('does not fall back to a different row for an unknown recorded scope', () => {
    expect(
      chooseExecutionForInteraction([first, second], {
        node_id: NODE_ID,
        execution_scope: {
          occurrence_id: '33333333-3333-4333-8333-333333333333',
          attempt_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      })
    ).toBeNull();
  });

  test('places an unscoped interaction on the latest execution', () => {
    expect(chooseExecutionForInteraction([first, second], { node_id: NODE_ID })).toBe(second);
  });
});

describe('buildExecutionHeader', () => {
  test('labels iteration, route, attempt, and unknown executions from selection data', () => {
    expect(
      buildExecutionHeader({
        row: row({
          id: 'iter',
          status: 'completed',
          order: 0,
          selection: { kind: 'loop_iteration', iteration: 2 },
          unknownScope: true,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Iteration 2');

    expect(
      buildExecutionHeader({
        row: row({
          id: 'route',
          status: 'completed',
          order: 0,
          selection: { kind: 'route_iteration', executionSeq: 2 },
          unknownScope: true,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Route 2');

    expect(
      buildExecutionHeader({
        row: row({
          id: 'attempt',
          status: 'completed',
          order: 0,
          selection: {
            kind: 'occurrence',
            occurrenceId: 'occ-1',
            attemptId: 'att-1',
            retryEpoch: 2,
          },
          unknownScope: false,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Attempt 3');
    expect(
      buildExecutionHeader({
        row: row({
          id: 'scoped-route',
          status: 'completed',
          order: 0,
          selection: {
            kind: 'occurrence',
            occurrenceId: 'occ-route',
            attemptId: 'att-route',
            retryEpoch: 0,
            routeActivationSeq: 4,
          },
          unknownScope: false,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Route 4');

    expect(
      buildExecutionHeader({
        row: row({
          id: 'retried-iteration',
          status: 'completed',
          order: 0,
          selection: {
            kind: 'occurrence',
            occurrenceId: 'occ-loop',
            attemptId: 'att-loop',
            retryEpoch: 1,
            iteration: 2,
          },
          unknownScope: false,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Iteration 2 · Attempt 2');

    expect(
      buildExecutionHeader({
        row: row({
          id: 'unknown',
          status: 'completed',
          order: 0,
          selection: { kind: 'node' },
          unknownScope: true,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Execution unknown');
  });

  test('startedOffsetMs is measured from the run started_at', () => {
    const header = buildExecutionHeader({
      row: row({
        id: 'timed',
        status: 'completed',
        order: 0,
        startedAt: '2026-09-08T00:00:08.000Z',
        durationMs: 400,
      }),
      events: [],
      runStartedAt: RUN_STARTED_AT,
    });
    expect(header.startedOffsetMs).toBe(8000);
  });

  test('duration is absent when the selected execution has no duration_ms', () => {
    const selected = row({
      id: 'selected',
      status: 'running',
      order: 1,
      startedAt: '2026-09-08T00:00:02.000Z',
    });
    const other = row({
      id: 'other',
      status: 'completed',
      order: 0,
      durationMs: 9_000,
    });
    expect(other.durationMs).toBe(9_000);
    expect(
      buildExecutionHeader({
        row: selected,
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).durationMs
    ).toBeNull();
  });

  test('provider and model come from the matching node_started event', () => {
    const selected = row({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      selection: { kind: 'occurrence', occurrenceId: 'occ-1', attemptId: 'att-1' },
      unknownScope: false,
    });
    const header = buildExecutionHeader({
      row: selected,
      events: [
        nodeStarted({
          id: 'start-later',
          occurrenceId: 'occ-2',
          attemptId: 'att-2',
          provider: 'codex',
          model: 'gpt-5',
        }),
        nodeStarted({
          id: 'start-match',
          occurrenceId: 'occ-1',
          attemptId: 'att-1',
          provider: 'claude',
          model: 'sonnet',
        }),
      ],
      runStartedAt: RUN_STARTED_AT,
    });
    expect(header.provider).toBe('claude');
    expect(header.model).toBe('sonnet');
    expect(header.unknownScope).toBe(false);
  });

  test('a later execution event is not used for the selected row', () => {
    const selected = row({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      selection: { kind: 'occurrence', occurrenceId: 'occ-1', attemptId: 'att-1' },
      unknownScope: false,
    });
    const runtime = runtimeForSelection(
      [
        nodeStarted({
          id: 'start-later',
          occurrenceId: 'occ-2',
          attemptId: 'att-2',
          provider: 'codex',
          model: 'gpt-5',
        }),
      ],
      selected
    );
    expect(runtime).toBeNull();
  });

  test('an unscoped row uses the latest unscoped node_started and is unknownScope', () => {
    const selected = row({
      id: 'unscoped',
      status: 'completed',
      order: 1,
      selection: { kind: 'node' },
      unknownScope: true,
    });
    const header = buildExecutionHeader({
      row: selected,
      events: [
        nodeStarted({ id: 'start-early', provider: 'claude', model: 'haiku' }),
        nodeStarted({ id: 'start-late', provider: 'claude', model: 'sonnet' }),
        nodeStarted({
          id: 'start-scoped',
          occurrenceId: 'occ-9',
          attemptId: 'att-9',
          provider: 'codex',
          model: 'gpt-5',
        }),
      ],
      runStartedAt: RUN_STARTED_AT,
    });
    expect(header.provider).toBe('claude');
    expect(header.model).toBe('sonnet');
    expect(header.unknownScope).toBe(true);
  });
});

describe('roomOpenerId and askCardId', () => {
  test('encodes surface, kind, and key with a stable prefix', () => {
    expect(roomOpenerId('legacy', 'log', 'row/1')).toBe('legacy-log-row%2F1');
    expect(roomOpenerId('legacy', 'graph', 'review')).toBe('legacy-graph-review');
    expect(roomOpenerId('console', 'log', 'row 2')).toBe('console-log-row%202');
    expect(roomOpenerId('console', 'graph', 'setup')).toBe('console-graph-setup');
  });

  test('encodes Ask request ids with the run-ask-card- prefix', () => {
    expect(askCardId('tool/use 1')).toBe('run-ask-card-tool%2Fuse%201');
    expect(askCardId('tool/use 1', 'room')).toBe('run-ask-card-tool%2Fuse%201-room');
    expect(askCardId('tool/use 1', 'log:row/1')).toBe('run-ask-card-tool%2Fuse%201-log%3Arow%2F1');
  });
});

describe('room visit transitions', () => {
  const awaiting = row({ id: 'awaiting', status: 'awaiting', order: 2 });
  const completed = row({ id: 'completed', status: 'completed', order: 0 });
  const rows = [completed, awaiting];
  const openerId = 'legacy-log-awaiting';

  test('implicit opening preserves selection without changing explicit memory', () => {
    const opened = openRoom(resetRoomVisit('run-1'), {
      nodeId: NODE_ID,
      rowId: awaiting.id,
      openerId,
    });
    expect(opened.selection).toEqual({
      nodeId: NODE_ID,
      rowId: awaiting.id,
      openerId,
    });
    expect(opened.lastExplicitRowByNode).toEqual({});
  });

  test('explicit opening stores the selected execution', () => {
    const opened = openExplicitRoom(resetRoomVisit('run-1'), {
      nodeId: NODE_ID,
      rowId: awaiting.id,
      openerId,
    });
    expect(opened.lastExplicitRowByNode).toEqual({ [NODE_ID]: awaiting.id });
  });

  test('closing clears only selection', () => {
    const opened = openExplicitRoom(resetRoomVisit('run-1'), {
      nodeId: NODE_ID,
      rowId: awaiting.id,
      openerId,
    });
    const withScroll = rememberRoomScroll(opened, 'run-1:review', 120);
    const closed = closeRoom(withScroll);
    expect(closed.selection).toBeNull();
    expect(closed.lastExplicitRowByNode).toEqual({ [NODE_ID]: awaiting.id });
    expect(closed.scrollTopByScope).toEqual({ 'run-1:review': 120 });
    expect(closed.runId).toBe('run-1');
  });

  test('applyRoomDeepLink with a null query clears only the marker', () => {
    const opened = applyRoomDeepLink(resetRoomVisit('run-1'), NODE_ID, rows);
    const withScroll = rememberRoomScroll(opened, 'scope', 40);
    const cleared = applyRoomDeepLink(withScroll, null, rows);
    expect(cleared.appliedDeepLinkNode).toBeNull();
    expect(cleared.selection).toEqual(opened.selection);
    expect(cleared.lastExplicitRowByNode).toEqual(opened.lastExplicitRowByNode);
    expect(cleared.scrollTopByScope).toEqual({ scope: 40 });
  });

  test('a query value opens once, ignores manual close, and reopens after leaving', () => {
    let state = applyRoomDeepLink(resetRoomVisit('run-1'), NODE_ID, rows);
    expect(state.selection?.rowId).toBe(awaiting.id);
    expect(state.appliedDeepLinkNode).toBe(NODE_ID);

    state = closeRoom(state);
    state = applyRoomDeepLink(state, NODE_ID, rows);
    expect(state.selection).toBeNull();
    expect(state.appliedDeepLinkNode).toBe(NODE_ID);

    state = applyRoomDeepLink(state, null, rows);
    expect(state.appliedDeepLinkNode).toBeNull();

    state = applyRoomDeepLink(state, NODE_ID, rows);
    expect(state.selection?.rowId).toBe(awaiting.id);
    expect(state.appliedDeepLinkNode).toBe(NODE_ID);
  });

  test('an unresolved query stays unapplied so a later execution row can open it', () => {
    const initial = resetRoomVisit('run-1');
    const waiting = applyRoomDeepLink(initial, NODE_ID, []);
    expect(waiting).toBe(initial);
    expect(waiting.selection).toBeNull();
    expect(waiting.appliedDeepLinkNode).toBeNull();

    const opened = applyRoomDeepLink(waiting, NODE_ID, rows);
    expect(opened.selection?.rowId).toBe(awaiting.id);
    expect(opened.appliedDeepLinkNode).toBe(NODE_ID);
  });

  test('an unknown query node is marked applied without opening a room', () => {
    const state = applyRoomDeepLink(resetRoomVisit('run-1'), 'missing', rows);
    expect(state.selection).toBeNull();
    expect(state.appliedDeepLinkNode).toBe('missing');
  });

  test('a valid query reopens after the URL passes through an invalid node', () => {
    let state = applyRoomDeepLink(resetRoomVisit('run-1'), NODE_ID, rows);
    state = closeRoom(state);
    state = applyRoomDeepLink(state, 'missing', rows);
    expect(state.selection).toBeNull();
    expect(state.appliedDeepLinkNode).toBe('missing');

    state = applyRoomDeepLink(state, NODE_ID, rows);
    expect(state.selection?.rowId).toBe(awaiting.id);
    expect(state.appliedDeepLinkNode).toBe(NODE_ID);
  });

  test('a changed run id returns a fresh state with every map empty', () => {
    const previous = rememberRoomScroll(
      openExplicitRoom(resetRoomVisit('run-1'), {
        nodeId: NODE_ID,
        rowId: awaiting.id,
        openerId,
      }),
      'scope',
      80
    );
    const next = resetRoomVisit('run-2');
    expect(next.runId).toBe('run-2');
    expect(next.selection).toBeNull();
    expect(next.lastExplicitRowByNode).toEqual({});
    expect(next.scrollTopByScope).toEqual({});
    expect(next.appliedDeepLinkNode).toBeNull();
    expect(previous.runId).toBe('run-1');
  });
});

type NodeExecution = components['schemas']['NodeExecution'];

function nodeExecution(
  overrides: Partial<NodeExecution> & Pick<NodeExecution, 'node_id' | 'status'>
): NodeExecution {
  return { ...overrides };
}

function orderedEvent(overrides: {
  id: string;
  event_type: string;
  step_name?: string | null;
  created_at?: string;
  event_order?: number | null;
  data?: Record<string, unknown>;
}): WorkflowEvent {
  return {
    id: overrides.id,
    workflow_run_id: 'run-1',
    event_type: overrides.event_type,
    step_index: null,
    step_name: overrides.step_name === undefined ? NODE_ID : overrides.step_name,
    data: overrides.data ?? {},
    created_at: overrides.created_at ?? RUN_STARTED_AT,
    event_order: overrides.event_order,
  };
}

describe('hasUnsettledNodeExecutions (T3.5)', () => {
  test('undefined, empty, and all-terminal history are settled', () => {
    expect(hasUnsettledNodeExecutions(undefined)).toBe(false);
    expect(hasUnsettledNodeExecutions(null)).toBe(false);
    expect(hasUnsettledNodeExecutions([])).toBe(false);
    expect(
      hasUnsettledNodeExecutions([
        nodeExecution({ node_id: 'a', status: 'completed' }),
        nodeExecution({ node_id: 'b', status: 'failed' }),
        nodeExecution({ node_id: 'c', status: 'skipped' }),
      ])
    ).toBe(false);
  });

  test('running, awaiting, pending, and unknown future statuses are unsettled', () => {
    expect(hasUnsettledNodeExecutions([nodeExecution({ node_id: 'a', status: 'running' })])).toBe(
      true
    );
    expect(hasUnsettledNodeExecutions([nodeExecution({ node_id: 'a', status: 'awaiting' })])).toBe(
      true
    );
    expect(hasUnsettledNodeExecutions([nodeExecution({ node_id: 'a', status: 'pending' })])).toBe(
      true
    );
    expect(
      hasUnsettledNodeExecutions([nodeExecution({ node_id: 'a', status: 'future-unknown-status' })])
    ).toBe(true);
    expect(
      hasUnsettledNodeExecutions([
        nodeExecution({ node_id: 'a', status: 'completed' }),
        nodeExecution({ node_id: 'b', status: 'running' }),
      ])
    ).toBe(true);
  });
});

describe('hasTerminalNodeEvidence (T3.6–T3.8)', () => {
  test('missing node or any nonterminal execution is false', () => {
    expect(hasTerminalNodeEvidence(undefined, NODE_ID)).toBe(false);
    expect(hasTerminalNodeEvidence([], NODE_ID)).toBe(false);
    expect(
      hasTerminalNodeEvidence([nodeExecution({ node_id: 'other', status: 'completed' })], NODE_ID)
    ).toBe(false);
    expect(
      hasTerminalNodeEvidence([nodeExecution({ node_id: NODE_ID, status: 'running' })], NODE_ID)
    ).toBe(false);
    expect(
      hasTerminalNodeEvidence([nodeExecution({ node_id: NODE_ID, status: 'awaiting' })], NODE_ID)
    ).toBe(false);
    expect(
      hasTerminalNodeEvidence([nodeExecution({ node_id: NODE_ID, status: 'pending' })], NODE_ID)
    ).toBe(false);
  });

  test('one or more executions all terminal is true', () => {
    expect(
      hasTerminalNodeEvidence([nodeExecution({ node_id: NODE_ID, status: 'completed' })], NODE_ID)
    ).toBe(true);
    expect(
      hasTerminalNodeEvidence(
        [
          nodeExecution({ node_id: NODE_ID, status: 'failed' }),
          nodeExecution({ node_id: NODE_ID, status: 'skipped' }),
        ],
        NODE_ID
      )
    ).toBe(true);
  });

  test('older completed iteration does not mask a live occurrence', () => {
    const mixed = [
      nodeExecution({ node_id: NODE_ID, status: 'completed', occurrence_id: 'occ-1' }),
      nodeExecution({ node_id: NODE_ID, status: 'running', occurrence_id: 'occ-2' }),
    ];
    expect(hasTerminalNodeEvidence(mixed, NODE_ID)).toBe(false);
    expect(
      hasTerminalNodeEvidence(
        [
          nodeExecution({ node_id: NODE_ID, status: 'completed', occurrence_id: 'occ-1' }),
          nodeExecution({ node_id: NODE_ID, status: 'failed', occurrence_id: 'occ-2' }),
        ],
        NODE_ID
      )
    ).toBe(true);
  });

  test('sibling terminal history cannot mark the selected node terminal', () => {
    expect(
      hasTerminalNodeEvidence(
        [
          nodeExecution({ node_id: 'sibling', status: 'completed' }),
          nodeExecution({ node_id: 'sibling', status: 'failed' }),
          nodeExecution({ node_id: NODE_ID, status: 'running' }),
        ],
        NODE_ID
      )
    ).toBe(false);
    expect(
      hasTerminalNodeEvidence(
        [
          nodeExecution({ node_id: 'sibling', status: 'completed' }),
          nodeExecution({ node_id: NODE_ID, status: 'completed' }),
        ],
        NODE_ID
      )
    ).toBe(true);
  });
});

describe('hasIdleAwaitExpiredEvidence (T4.7)', () => {
  const EXPIRED = 'interrupted by operator, no redirect received';

  test('exact latest expiry is true; wrong node/error/status, unsettled, and no row are false', () => {
    expect(hasIdleAwaitExpiredEvidence(undefined, NODE_ID)).toBe(false);
    expect(hasIdleAwaitExpiredEvidence([], NODE_ID)).toBe(false);
    expect(
      hasIdleAwaitExpiredEvidence(
        [nodeExecution({ node_id: 'other', status: 'failed', error: EXPIRED })],
        NODE_ID
      )
    ).toBe(false);
    expect(
      hasIdleAwaitExpiredEvidence(
        [nodeExecution({ node_id: NODE_ID, status: 'failed', error: 'other failure' })],
        NODE_ID
      )
    ).toBe(false);
    expect(
      hasIdleAwaitExpiredEvidence(
        [nodeExecution({ node_id: NODE_ID, status: 'completed', error: EXPIRED })],
        NODE_ID
      )
    ).toBe(false);
    expect(
      hasIdleAwaitExpiredEvidence(
        [
          nodeExecution({ node_id: NODE_ID, status: 'failed', error: EXPIRED }),
          nodeExecution({ node_id: NODE_ID, status: 'running' }),
        ],
        NODE_ID
      )
    ).toBe(false);
    expect(
      hasIdleAwaitExpiredEvidence(
        [nodeExecution({ node_id: NODE_ID, status: 'failed', error: EXPIRED })],
        NODE_ID
      )
    ).toBe(true);
  });

  test('expiry epoch 0 followed by completed epoch 1 is false', () => {
    expect(
      hasIdleAwaitExpiredEvidence(
        [
          nodeExecution({
            node_id: NODE_ID,
            status: 'failed',
            error: EXPIRED,
            retry_epoch: 0,
            started_at: '2026-09-08T00:00:01.000Z',
          }),
          nodeExecution({
            node_id: NODE_ID,
            status: 'completed',
            retry_epoch: 1,
            started_at: '2026-09-08T00:10:00.000Z',
          }),
        ],
        NODE_ID
      )
    ).toBe(false);
  });

  test('timestamp and array position break ties; grp.body vs grp do not cross', () => {
    expect(
      hasIdleAwaitExpiredEvidence(
        [
          nodeExecution({
            node_id: NODE_ID,
            status: 'failed',
            error: 'older',
            retry_epoch: 0,
            started_at: '2026-09-08T00:00:01.000Z',
          }),
          nodeExecution({
            node_id: NODE_ID,
            status: 'failed',
            error: EXPIRED,
            retry_epoch: 0,
            started_at: '2026-09-08T00:00:05.000Z',
          }),
        ],
        NODE_ID
      )
    ).toBe(true);

    // Same epoch + same effective timestamp → later array position wins.
    expect(
      hasIdleAwaitExpiredEvidence(
        [
          nodeExecution({
            node_id: NODE_ID,
            status: 'failed',
            error: 'first',
            retry_epoch: 1,
            started_at: '2026-09-08T00:00:09.000Z',
          }),
          nodeExecution({
            node_id: NODE_ID,
            status: 'failed',
            error: EXPIRED,
            retry_epoch: 1,
            started_at: '2026-09-08T00:00:09.000Z',
          }),
        ],
        NODE_ID
      )
    ).toBe(true);

    expect(
      hasIdleAwaitExpiredEvidence(
        [
          nodeExecution({
            node_id: 'grp',
            status: 'failed',
            error: 'Loop group failed: body: ' + EXPIRED,
          }),
          nodeExecution({
            node_id: 'grp.body',
            status: 'failed',
            error: EXPIRED,
          }),
        ],
        'grp.body'
      )
    ).toBe(true);
    expect(
      hasIdleAwaitExpiredEvidence(
        [
          nodeExecution({
            node_id: 'grp',
            status: 'failed',
            error: 'Loop group failed: body: ' + EXPIRED,
          }),
          nodeExecution({
            node_id: 'grp.body',
            status: 'failed',
            error: EXPIRED,
          }),
        ],
        'grp'
      )
    ).toBe(false);
  });
});

describe('latestNodeExecutionKey (T3.9)', () => {
  test('sorts by event_order then timestamp then id, not array order', () => {
    const events = [
      orderedEvent({
        id: 'late-array-first',
        event_type: 'node_started',
        event_order: 3,
        data: { occurrence_id: 'occ-3' },
      }),
      orderedEvent({
        id: 'early',
        event_type: 'node_started',
        event_order: 1,
        data: { occurrence_id: 'occ-1' },
      }),
      orderedEvent({
        id: 'mid',
        event_type: 'node_started',
        event_order: 2,
        data: { occurrence_id: 'occ-2' },
      }),
    ];
    expect(latestNodeExecutionKey(events, NODE_ID)).toBe('occ-3');
  });

  test('falls back to timestamp and id when event_order ties or is missing', () => {
    const byTime = [
      orderedEvent({
        id: 'b',
        event_type: 'node_started',
        created_at: '2026-09-08T00:00:02.000Z',
        data: { occurrence_id: 'occ-b' },
      }),
      orderedEvent({
        id: 'a',
        event_type: 'node_started',
        created_at: '2026-09-08T00:00:01.000Z',
        data: { occurrence_id: 'occ-a' },
      }),
    ];
    expect(latestNodeExecutionKey(byTime, NODE_ID)).toBe('occ-b');

    const byId = [
      orderedEvent({
        id: 'z-start',
        event_type: 'node_started',
        created_at: RUN_STARTED_AT,
        event_order: 1,
        data: { occurrence_id: 'occ-z' },
      }),
      orderedEvent({
        id: 'a-start',
        event_type: 'node_started',
        created_at: RUN_STARTED_AT,
        event_order: 1,
        data: { occurrence_id: 'occ-a' },
      }),
    ];
    expect(latestNodeExecutionKey(byId, NODE_ID)).toBe('occ-z');
  });

  test('normal starts adopt nonempty occurrence_id or event-id fallback', () => {
    expect(
      latestNodeExecutionKey(
        [
          orderedEvent({
            id: 'start-1',
            event_type: 'node_started',
            event_order: 1,
            data: { occurrence_id: 'occ-1' },
          }),
        ],
        NODE_ID
      )
    ).toBe('occ-1');
    expect(
      latestNodeExecutionKey(
        [orderedEvent({ id: 'start-fallback', event_type: 'node_started', event_order: 1 })],
        NODE_ID
      )
    ).toBe('start-fallback');
    expect(
      latestNodeExecutionKey(
        [
          orderedEvent({
            id: 'start-empty',
            event_type: 'node_started',
            event_order: 1,
            data: { occurrence_id: '' },
          }),
        ],
        NODE_ID
      )
    ).toBe('start-empty');
  });

  test('resumed Ask keeps the prior key across the next same-node start', () => {
    const events = [
      orderedEvent({
        id: 'start-1',
        event_type: 'node_started',
        event_order: 1,
        data: { occurrence_id: 'occ-outer-1' },
      }),
      orderedEvent({
        id: 'ask-resume',
        event_type: 'interaction_resolved',
        event_order: 2,
        data: { kind: 'ask', resumed: true, tool_use_id: 'tool-1' },
      }),
      orderedEvent({
        id: 'start-2',
        event_type: 'node_started',
        event_order: 3,
        data: { occurrence_id: 'occ-outer-2' },
      }),
    ];
    expect(latestNodeExecutionKey(events, NODE_ID)).toBe('occ-outer-1');
  });

  test('resumed Ask with no earlier key adopts the next start identity', () => {
    expect(
      latestNodeExecutionKey(
        [
          orderedEvent({
            id: 'ask-first',
            event_type: 'interaction_resolved',
            event_order: 1,
            data: { kind: 'ask', resumed: true },
          }),
          orderedEvent({
            id: 'start-after',
            event_type: 'node_started',
            event_order: 2,
            data: { occurrence_id: 'occ-after' },
          }),
        ],
        NODE_ID
      )
    ).toBe('occ-after');
  });

  test('retry or generic resume after terminal adopts a new key', () => {
    expect(
      latestNodeExecutionKey(
        [
          orderedEvent({
            id: 'start-1',
            event_type: 'node_started',
            event_order: 1,
            data: { occurrence_id: 'occ-1' },
          }),
          orderedEvent({ id: 'fail-1', event_type: 'node_failed', event_order: 2 }),
          orderedEvent({ id: 'retry-1', event_type: 'node_retry_requested', event_order: 3 }),
          orderedEvent({
            id: 'start-2',
            event_type: 'node_started',
            event_order: 4,
            data: { occurrence_id: 'occ-2' },
          }),
        ],
        NODE_ID
      )
    ).toBe('occ-2');

    expect(
      latestNodeExecutionKey(
        [
          orderedEvent({
            id: 'start-a',
            event_type: 'node_started',
            event_order: 1,
            data: { occurrence_id: 'occ-a' },
          }),
          orderedEvent({ id: 'done-a', event_type: 'node_completed', event_order: 2 }),
          orderedEvent({
            id: 'start-b',
            event_type: 'node_started',
            event_order: 3,
            data: { occurrence_id: 'occ-b' },
          }),
        ],
        NODE_ID
      )
    ).toBe('occ-b');
  });

  test('terminal or retry clears an unused Ask continuation marker', () => {
    expect(
      latestNodeExecutionKey(
        [
          orderedEvent({
            id: 'start-1',
            event_type: 'node_started',
            event_order: 1,
            data: { occurrence_id: 'occ-1' },
          }),
          orderedEvent({
            id: 'ask-resume',
            event_type: 'interaction_resolved',
            event_order: 2,
            data: { kind: 'ask', resumed: true },
          }),
          orderedEvent({ id: 'fail-1', event_type: 'node_failed', event_order: 3 }),
          orderedEvent({
            id: 'start-2',
            event_type: 'node_started',
            event_order: 4,
            data: { occurrence_id: 'occ-2' },
          }),
        ],
        NODE_ID
      )
    ).toBe('occ-2');
  });

  test('ignores loop-iteration starts, siblings, and non-ask resolutions', () => {
    expect(
      latestNodeExecutionKey(
        [
          orderedEvent({
            id: 'start-1',
            event_type: 'node_started',
            event_order: 1,
            data: { occurrence_id: 'occ-1' },
          }),
          orderedEvent({
            id: 'loop-iter',
            event_type: 'loop_iteration_started',
            event_order: 2,
            data: { occurrence_id: 'occ-loop' },
          }),
          orderedEvent({
            id: 'sibling-start',
            event_type: 'node_started',
            step_name: 'sibling',
            event_order: 3,
            data: { occurrence_id: 'occ-sib' },
          }),
          orderedEvent({
            id: 'perm-resolved',
            event_type: 'interaction_resolved',
            event_order: 4,
            data: { kind: 'permission', resumed: true },
          }),
          orderedEvent({
            id: 'ask-not-resumed',
            event_type: 'interaction_resolved',
            event_order: 5,
            data: { kind: 'ask', resumed: false },
          }),
          orderedEvent({
            id: 'start-2',
            event_type: 'node_started',
            event_order: 6,
            data: { occurrence_id: 'occ-2' },
          }),
        ],
        NODE_ID
      )
    ).toBe('occ-2');
  });
});

describe('resolveRunDetailRefetchIntervalMs (T3.10–T3.14 core)', () => {
  test('live and non-terminal statuses always keep the 3 s cadence', () => {
    expect(resolveRunDetailRefetchIntervalMs('running', undefined)).toBe(3000);
    expect(resolveRunDetailRefetchIntervalMs('paused', [])).toBe(3000);
    expect(resolveRunDetailRefetchIntervalMs('pending', undefined)).toBe(3000);
    expect(resolveRunDetailRefetchIntervalMs(undefined, undefined)).toBe(3000);
  });

  test('terminal + unsettled keeps 3 s; settled/empty/missing stops', () => {
    expect(
      resolveRunDetailRefetchIntervalMs('cancelled', [
        nodeExecution({ node_id: 'a', status: 'running' }),
      ])
    ).toBe(3000);
    expect(
      resolveRunDetailRefetchIntervalMs('failed', [
        nodeExecution({ node_id: 'a', status: 'awaiting' }),
      ])
    ).toBe(3000);
    expect(
      resolveRunDetailRefetchIntervalMs('completed', [
        nodeExecution({ node_id: 'a', status: 'failed' }),
      ])
    ).toBe(false);
    expect(resolveRunDetailRefetchIntervalMs('cancelled', [])).toBe(false);
    expect(resolveRunDetailRefetchIntervalMs('cancelled', undefined)).toBe(false);
  });
});
