import { describe, expect, test } from 'bun:test';
import type { WorkflowEventRow } from '@archon/core/schemas/workflow-event';
import type { PendingInteraction } from '@archon/workflows/schemas/pending-interaction';
import { projectWorkflowExecutionHistory } from './workflow-execution-history';

function event(
  overrides: Partial<WorkflowEventRow> & Pick<WorkflowEventRow, 'id' | 'event_type'>
): WorkflowEventRow {
  return {
    workflow_run_id: 'run-1',
    step_index: null,
    step_name: 'review',
    data: {},
    created_at: '2026-09-07T00:00:00.000Z',
    event_order: null,
    ...overrides,
  };
}

const OCCURRENCE_A = '11111111-1111-4111-8111-111111111111';
const OCCURRENCE_B = '33333333-3333-4333-8333-333333333333';
const OCCURRENCE_C = '55555555-5555-4555-8555-555555555555';
const OCCURRENCE_D = '66666666-6666-4666-8666-666666666666';
const ATTEMPT_A = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_B = '44444444-4444-4444-8444-444444444444';
const ATTEMPT_C = '77777777-7777-4777-8777-777777777777';

function freezeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function interaction(
  overrides: Partial<PendingInteraction> & Pick<PendingInteraction, 'id' | 'status' | 'tool_use_id'>
): PendingInteraction {
  return {
    workflow_run_id: 'run-1',
    node_id: 'review',
    kind: 'ask',
    envelope: {},
    answer: null,
    provider_session_id: 'session-1',
    created_at: '2026-09-07T00:00:02.000Z',
    resolved_at: null,
    resolved_by: null,
    execution_scope: {
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_A,
      retry_epoch: 0,
    },
    ...overrides,
  };
}

describe('projectWorkflowExecutionHistory', () => {
  test('groups scoped node_started/completed pairs as distinct occurrences', () => {
    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'prompt' },
        }),
        event({
          id: 'e2',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:02.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A },
        }),
        event({
          id: 'e3',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:03.000Z',
          data: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_A, type: 'prompt' },
        }),
        event({
          id: 'e4',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:04.000Z',
          data: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_A },
        }),
      ],
    });
    expect(executions.map(item => item.occurrence_id)).toEqual([OCCURRENCE_A, OCCURRENCE_B]);
    expect(executions[0]?.status).toBe('completed');
    expect(executions[0]?.duration_ms).toBe(1000);
    expect(executions[0]?.unknown_scope).toBeUndefined();
  });

  test('marks overlapping unscoped starts unknown instead of assigning the first iteration', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { iteration: 1 },
        }),
        event({
          id: 'e2',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:02.000Z',
          data: { iteration: 2 },
        }),
        event({
          id: 'e3',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:03.000Z',
          data: {},
        }),
      ],
    });
    expect(executions.some(item => item.unknown_scope === true)).toBe(true);
    expect(executions.some(item => item.unknown_reason === 'overlapping_unscoped_starts')).toBe(
      true
    );
  });

  test('copies loop_ancestry and route_activation_seq onto history entries', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          step_name: 'inspect-twice',
          event_type: 'loop_iteration_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            loop_ancestry: [{ node_id: 'inspect-twice', iteration: 2 }],
            route_activation_seq: 3,
          },
        }),
        event({
          id: 'e2',
          step_name: 'inspect-twice',
          event_type: 'loop_iteration_completed',
          created_at: '2026-09-07T00:00:02.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A },
        }),
      ],
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.loop_ancestry).toEqual([{ node_id: 'inspect-twice', iteration: 2 }]);
    expect(executions[0]?.route_activation_seq).toBe(3);
  });

  test('pairs executor-shaped start and terminal events that share occurrence identity', () => {
    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            retry_epoch: 0,
            route_activation_seq: 2,
            type: 'prompt',
          },
        }),
        event({
          id: 'e2',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:02.000Z',
          data: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            retry_epoch: 0,
            route_activation_seq: 2,
            duration_ms: 1000,
          },
        }),
      ],
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe('completed');
    expect(executions[0]?.occurrence_id).toBe(OCCURRENCE_A);
    expect(executions[0]?.route_activation_seq).toBe(2);
    expect(executions[0]?.unknown_scope).toBeUndefined();
  });

  test('nests loop iteration terminals under the same node occurrence', () => {
    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'loop' },
        }),
        event({
          id: 'e2',
          event_type: 'loop_iteration_started',
          created_at: '2026-09-07T00:00:02.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, iteration: 1 },
        }),
        event({
          id: 'e3',
          event_type: 'loop_iteration_completed',
          created_at: '2026-09-07T00:00:03.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, iteration: 1 },
        }),
        event({
          id: 'e4',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:04.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A },
        }),
      ],
    });
    expect(executions).toHaveLength(2);
    expect(executions.every(item => item.unknown_scope === undefined)).toBe(true);
    expect(executions.map(item => item.status)).toEqual(['completed', 'completed']);
  });

  test('records a scoped skip without a matching start as skipped, not unknown', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_skipped',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, reason: 'trigger_rule' },
        }),
      ],
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe('skipped');
    expect(executions[0]?.occurrence_id).toBe(OCCURRENCE_A);
    expect(executions[0]?.unknown_scope).toBeUndefined();
  });

  test('preserves same-attempt start timing when an interaction becomes awaiting', () => {
    const pending: PendingInteraction = {
      id: 'pending-same-attempt',
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'tool-same-attempt',
      kind: 'ask',
      status: 'pending',
      envelope: {},
      answer: null,
      provider_session_id: 'session-1',
      created_at: '2026-09-07T00:00:02.000Z',
      resolved_at: null,
      resolved_by: null,
      execution_scope: {
        occurrence_id: OCCURRENCE_A,
        attempt_id: ATTEMPT_A,
        retry_epoch: 0,
      },
    };
    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
        }),
      ],
      pendingInteractions: [pending],
    });

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_A,
      status: 'awaiting',
      started_at: '2026-09-07T00:00:01.000Z',
      start_offset_ms: 1000,
    });
  });

  test('projects a re-asked pending interaction onto its current attempt', () => {
    const pending: PendingInteraction = {
      id: 'pending-1',
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'tool-1',
      kind: 'ask',
      status: 'pending',
      envelope: {},
      answer: null,
      provider_session_id: 'session-1',
      created_at: '2026-09-07T00:00:02.000Z',
      resolved_at: null,
      resolved_by: null,
      execution_scope: {
        occurrence_id: OCCURRENCE_A,
        attempt_id: ATTEMPT_B,
        retry_epoch: 1,
      },
    };
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
        }),
        event({
          id: 'e2',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
        }),
      ],
      pendingInteractions: [pending],
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_B,
      retry_epoch: 1,
      status: 'awaiting',
    });
    expect(executions[0]?.started_at).toBeUndefined();
    expect(executions[0]?.start_offset_ms).toBeUndefined();
  });
  test('projects a successful re-ask terminal onto its current attempt', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
        }),
        event({
          id: 'e2',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_B, retry_epoch: 1 },
        }),
      ],
    });

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_B,
      retry_epoch: 1,
      status: 'completed',
    });
  });

  test('does not copy unknown event data keys onto history entries', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          data: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            secret: 'DO_NOT_COPY',
          },
        }),
      ],
    });
    expect(JSON.stringify(executions)).not.toContain('DO_NOT_COPY');
    expect(executions[0]?.occurrence_id).toBe(OCCURRENCE_A);
  });

  test('T3.1 scoped purged Ask closes exact execution', () => {
    const events = [
      event({
        id: 'e1',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:01.000Z',
        data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'prompt' },
      }),
      event({
        id: 'e-sibling-start',
        step_name: 'other',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:01.500Z',
        data: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_B, type: 'prompt' },
      }),
    ];
    const purged = interaction({
      id: 'purged-exact',
      tool_use_id: 'tool-purge-exact',
      status: 'purged',
      resolved_at: '2026-09-07T00:00:05.000Z',
      resolved_by: null,
      execution_scope: {
        occurrence_id: OCCURRENCE_A,
        attempt_id: ATTEMPT_A,
        retry_epoch: 0,
      },
    });
    const eventsBefore = freezeJson(events);
    const interactionsBefore = freezeJson([purged]);

    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events,
      pendingInteractions: [purged],
    });

    expect(events).toEqual(eventsBefore);
    expect([purged]).toEqual(interactionsBefore);
    expect(executions).toHaveLength(2);

    const closed = executions.find(item => item.occurrence_id === OCCURRENCE_A);
    expect(closed).toMatchObject({
      node_id: 'review',
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_A,
      status: 'failed',
      ended_at: '2026-09-07T00:00:05.000Z',
      duration_ms: 4000,
      started_at: '2026-09-07T00:00:01.000Z',
    });
    expect(closed?.unknown_scope).toBeUndefined();

    const sibling = executions.find(item => item.occurrence_id === OCCURRENCE_B);
    expect(sibling).toMatchObject({
      node_id: 'other',
      status: 'running',
    });
    expect(sibling?.ended_at).toBeUndefined();

    // Date resolved_at normalizes to ISO ended_at without mutating the input Date.
    const resolvedDate = new Date('2026-09-07T00:00:06.000Z');
    const datePurged = interaction({
      id: 'purged-date',
      tool_use_id: 'tool-purge-date',
      status: 'purged',
      resolved_at: resolvedDate,
      execution_scope: {
        occurrence_id: OCCURRENCE_A,
        attempt_id: ATTEMPT_A,
        retry_epoch: 0,
      },
    });
    const dateExecutions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'date-start',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'prompt' },
        }),
      ],
      pendingInteractions: [datePurged],
    });
    expect(datePurged.resolved_at).toBe(resolvedDate);
    expect(dateExecutions[0]?.ended_at).toBe('2026-09-07T00:00:06.000Z');
  });

  test('T3.2 re-ask and loop purge closes scoped owners only', () => {
    const loopOuterOcc = OCCURRENCE_A;
    const loopIterOcc = OCCURRENCE_B;
    const siblingIterOcc = OCCURRENCE_C;
    const bodyOcc = OCCURRENCE_D;
    const events = [
      event({
        id: 'loop-outer-start',
        step_name: 'refine',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:01.000Z',
        data: {
          occurrence_id: loopOuterOcc,
          attempt_id: ATTEMPT_A,
          type: 'loop',
        },
      }),
      event({
        id: 'loop-iter1-start',
        step_name: 'refine',
        event_type: 'loop_iteration_started',
        created_at: '2026-09-07T00:00:02.000Z',
        data: {
          occurrence_id: loopIterOcc,
          attempt_id: ATTEMPT_A,
          iteration: 1,
          loop_ancestry: [{ node_id: 'refine', iteration: 1 }],
        },
      }),
      event({
        id: 'loop-iter2-start',
        step_name: 'refine',
        event_type: 'loop_iteration_started',
        created_at: '2026-09-07T00:00:03.000Z',
        data: {
          occurrence_id: siblingIterOcc,
          attempt_id: ATTEMPT_B,
          iteration: 2,
          loop_ancestry: [{ node_id: 'refine', iteration: 2 }],
        },
      }),
      event({
        id: 'body-start',
        step_name: 'body-step',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:03.500Z',
        data: {
          occurrence_id: bodyOcc,
          attempt_id: ATTEMPT_C,
          type: 'prompt',
          loop_ancestry: [{ node_id: 'refine', iteration: 2 }],
        },
      }),
    ];

    // Re-ask purge: scope attempt B on occurrence A with no open start for B.
    // Use a distinct node so it doesn't collide with the loop fixture above —
    // occurrence A is already the loop outer on refine. Re-ask uses review + OCC_A
    // only after the completed pair; the completed execution is not open, so the
    // re-ask path needs an open same-occurrence execution. Model: open start on
    // attempt A, purge claims attempt B (rollover).
    const reaskEvents = [
      event({
        id: 'reask-open-start',
        step_name: 'review',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:01.000Z',
        data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'prompt' },
      }),
    ];
    const reaskPurged = interaction({
      id: 'purged-reask',
      tool_use_id: 'tool-reask',
      status: 'purged',
      resolved_at: '2026-09-07T00:00:04.000Z',
      execution_scope: {
        occurrence_id: OCCURRENCE_A,
        attempt_id: ATTEMPT_B,
        retry_epoch: 1,
      },
    });
    const reaskExecutions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: reaskEvents,
      pendingInteractions: [reaskPurged],
    });
    expect(reaskExecutions).toHaveLength(1);
    expect(reaskExecutions[0]).toMatchObject({
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_B,
      retry_epoch: 1,
      status: 'failed',
      ended_at: '2026-09-07T00:00:04.000Z',
    });
    // Stale start timing cleared on re-ask adoption.
    expect(reaskExecutions[0]?.started_at).toBeUndefined();
    expect(reaskExecutions[0]?.start_offset_ms).toBeUndefined();
    expect(reaskExecutions[0]?.duration_ms).toBeUndefined();

    const loopPurged = interaction({
      id: 'purged-loop',
      tool_use_id: 'tool-loop',
      status: 'purged',
      node_id: 'body-step',
      resolved_at: '2026-09-07T00:00:05.000Z',
      execution_scope: {
        occurrence_id: bodyOcc,
        attempt_id: ATTEMPT_C,
        retry_epoch: 0,
        loop_ancestry: [{ node_id: 'refine', iteration: 2 }],
      },
    });
    const loopEventsBefore = freezeJson(events);
    const loopInteractionsBefore = freezeJson([loopPurged]);

    const loopExecutions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events,
      pendingInteractions: [loopPurged],
    });

    expect(events).toEqual(loopEventsBefore);
    expect([loopPurged]).toEqual(loopInteractionsBefore);

    const byOcc = (id: string) => loopExecutions.find(item => item.occurrence_id === id);

    // Exact scoped body closed.
    expect(byOcc(bodyOcc)).toMatchObject({
      node_id: 'body-step',
      status: 'failed',
      ended_at: '2026-09-07T00:00:05.000Z',
    });
    // Owning iteration 2 closed.
    expect(byOcc(siblingIterOcc)).toMatchObject({
      node_id: 'refine',
      status: 'failed',
      ended_at: '2026-09-07T00:00:05.000Z',
      loop_ancestry: [{ node_id: 'refine', iteration: 2 }],
    });
    // Outer loop container closed.
    expect(byOcc(loopOuterOcc)).toMatchObject({
      node_id: 'refine',
      status: 'failed',
      ended_at: '2026-09-07T00:00:05.000Z',
      node_type: 'loop',
    });
    // Sibling iteration 1 stays open.
    expect(byOcc(loopIterOcc)).toMatchObject({
      node_id: 'refine',
      status: 'running',
      loop_ancestry: [{ node_id: 'refine', iteration: 1 }],
    });
    expect(byOcc(loopIterOcc)?.ended_at).toBeUndefined();
  });

  test('T3.3 ambiguous or unrelated purge fails closed', () => {
    const openStart = event({
      id: 'e1',
      event_type: 'node_started',
      created_at: '2026-09-07T00:00:01.000Z',
      data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'prompt' },
    });
    const siblingStart = event({
      id: 'e2',
      step_name: 'other',
      event_type: 'node_started',
      created_at: '2026-09-07T00:00:01.500Z',
      data: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_B, type: 'prompt' },
    });
    const baseEvents = [openStart, siblingStart];

    const cases: Array<{
      name: string;
      interaction: PendingInteraction;
      events?: WorkflowEventRow[];
    }> = [
      {
        name: 'missing scope',
        interaction: interaction({
          id: 'no-scope',
          tool_use_id: 't-no-scope',
          status: 'purged',
          resolved_at: '2026-09-07T00:00:05.000Z',
          execution_scope: null,
        }),
      },
      {
        name: 'missing resolved_at',
        interaction: interaction({
          id: 'no-resolved',
          tool_use_id: 't-no-resolved',
          status: 'purged',
          resolved_at: null,
        }),
      },
      {
        name: 'permission kind',
        interaction: interaction({
          id: 'perm',
          tool_use_id: 't-perm',
          status: 'purged',
          kind: 'permission',
          resolved_at: '2026-09-07T00:00:05.000Z',
        }),
      },
      {
        name: 'sibling node scope',
        interaction: interaction({
          id: 'sibling-scope',
          tool_use_id: 't-sibling',
          status: 'purged',
          node_id: 'other',
          resolved_at: '2026-09-07T00:00:05.000Z',
          execution_scope: {
            // Deliberately points at review's occurrence while node_id is other.
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            retry_epoch: 0,
          },
        }),
      },
      {
        name: 'unmatched scope',
        interaction: interaction({
          id: 'unmatched',
          tool_use_id: 't-unmatched',
          status: 'purged',
          resolved_at: '2026-09-07T00:00:05.000Z',
          execution_scope: {
            occurrence_id: OCCURRENCE_D,
            attempt_id: ATTEMPT_C,
            retry_epoch: 0,
          },
        }),
      },
      {
        name: 'pending interaction',
        interaction: interaction({
          id: 'still-pending',
          tool_use_id: 't-pending',
          status: 'pending',
          resolved_at: null,
        }),
      },
      {
        name: 'answered without resume evidence',
        interaction: interaction({
          id: 'answered-only',
          tool_use_id: 't-answered-only',
          status: 'answered',
          resolved_at: '2026-09-07T00:00:05.000Z',
          answer: { decline: false },
        }),
      },
      {
        name: 'multiple same-occurrence open candidates',
        events: [
          openStart,
          event({
            id: 'dup-open',
            event_type: 'node_started',
            created_at: '2026-09-07T00:00:01.200Z',
            // Same occurrence, different attempt — re-ask fallback sees 2 opens.
            data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_B, type: 'prompt' },
          }),
        ],
        interaction: interaction({
          id: 'multi-cand',
          tool_use_id: 't-multi',
          status: 'purged',
          resolved_at: '2026-09-07T00:00:05.000Z',
          execution_scope: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_C,
            retry_epoch: 2,
          },
        }),
      },
    ];

    for (const entry of cases) {
      const events = entry.events ?? baseEvents;
      const eventsBefore = freezeJson(events);
      const interactionsBefore = freezeJson([entry.interaction]);
      const executions = projectWorkflowExecutionHistory({
        events,
        pendingInteractions: [entry.interaction],
      });
      expect(events, entry.name).toEqual(eventsBefore);
      expect([entry.interaction], entry.name).toEqual(interactionsBefore);

      // No non-pending case may terminalize the open review execution as failed.
      if (entry.interaction.status === 'pending') {
        expect(
          executions.some(
            item => item.occurrence_id === OCCURRENCE_A && item.status === 'awaiting'
          ),
          entry.name
        ).toBe(true);
      } else {
        expect(
          executions.some(
            item =>
              item.node_id === 'review' &&
              item.occurrence_id === OCCURRENCE_A &&
              item.status === 'failed'
          ),
          entry.name
        ).toBe(false);
      }

      // Sibling never closed by review-targeted rows.
      const other = executions.find(item => item.occurrence_id === OCCURRENCE_B);
      if (other !== undefined) {
        expect(other.status, entry.name).toBe('running');
        expect(other.ended_at, entry.name).toBeUndefined();
      }
    }

    // Multiple owning candidates for a loop owner leave that owner open.
    const ambiguousOwnerEvents = [
      event({
        id: 'outer-a',
        step_name: 'refine',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:01.000Z',
        data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'loop' },
      }),
      event({
        id: 'outer-b',
        step_name: 'refine',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:01.100Z',
        data: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_B, type: 'loop' },
      }),
      event({
        id: 'iter-start',
        step_name: 'refine',
        event_type: 'loop_iteration_started',
        created_at: '2026-09-07T00:00:02.000Z',
        data: {
          occurrence_id: OCCURRENCE_C,
          attempt_id: ATTEMPT_C,
          iteration: 1,
          loop_ancestry: [{ node_id: 'refine', iteration: 1 }],
        },
      }),
    ];
    const ambiguousPurge = interaction({
      id: 'ambig-owner',
      tool_use_id: 't-ambig-owner',
      status: 'purged',
      node_id: 'refine',
      resolved_at: '2026-09-07T00:00:05.000Z',
      execution_scope: {
        occurrence_id: OCCURRENCE_C,
        attempt_id: ATTEMPT_C,
        retry_epoch: 0,
        loop_ancestry: [{ node_id: 'refine', iteration: 1 }],
      },
    });
    const ambigExecutions = projectWorkflowExecutionHistory({
      events: ambiguousOwnerEvents,
      pendingInteractions: [ambiguousPurge],
    });
    // Exact iteration closes.
    expect(ambigExecutions.find(item => item.occurrence_id === OCCURRENCE_C)?.status).toBe(
      'failed'
    );
    // Two outer containers → leave both open.
    expect(
      ambigExecutions.filter(item => item.node_type === 'loop' && item.status === 'running')
    ).toHaveLength(2);
  });

  test('T3.4 answered Ask resume retires parked segment when proven', () => {
    const resolvedAt = '2026-09-07T00:00:03.000Z';
    const preStart = event({
      id: 'pre-start',
      event_type: 'node_started',
      created_at: '2026-09-07T00:00:01.000Z',
      event_order: 1,
      data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'prompt' },
    });
    const resolvedEvent = event({
      id: 'resolved',
      event_type: 'interaction_resolved',
      created_at: resolvedAt,
      event_order: 2,
      data: {
        node_id: 'review',
        tool_use_id: 'tool-answered',
        kind: 'ask',
        resumed: true,
      },
    });
    const laterStart = event({
      id: 'later-start',
      event_type: 'node_started',
      created_at: '2026-09-07T00:00:04.000Z',
      event_order: 3,
      // Prompt Ask resume re-enters the same scoped execution.
      data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'prompt' },
    });
    const laterTerminal = event({
      id: 'later-done',
      event_type: 'node_completed',
      created_at: '2026-09-07T00:00:05.000Z',
      event_order: 4,
      data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A },
    });
    const answered = interaction({
      id: 'answered-1',
      tool_use_id: 'tool-answered',
      status: 'answered',
      resolved_at: resolvedAt,
      answer: { answers: [{ questionId: 'q1', value: 'yes' }] },
      execution_scope: {
        occurrence_id: OCCURRENCE_A,
        attempt_id: ATTEMPT_A,
        retry_epoch: 0,
      },
    });

    const happyEvents = [preStart, resolvedEvent, laterStart, laterTerminal];
    const happyBefore = freezeJson(happyEvents);
    const answeredBefore = freezeJson([answered]);
    const happy = projectWorkflowExecutionHistory({
      events: happyEvents,
      pendingInteractions: [answered],
    });
    expect(happyEvents).toEqual(happyBefore);
    expect([answered]).toEqual(answeredBefore);

    const retired = happy.find(item => item.occurrence_id === OCCURRENCE_A);
    expect(retired).toMatchObject({
      status: 'failed',
      ended_at: resolvedAt,
      duration_ms: 2000,
    });
    // The lifecycle pair after resume remains present as the terminal segment.
    expect(happy).toHaveLength(2);
    expect(happy[1]).toMatchObject({
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_A,
      status: 'completed',
    });

    // A later retry/other occurrence for the same node is not proof that this
    // scoped Ask resumed. Leave the parked segment open rather than guessing.
    const unrelatedLaterStart = event({
      id: 'unrelated-later-start',
      event_type: 'node_started',
      created_at: '2026-09-07T00:00:04.000Z',
      event_order: 3,
      data: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_B, type: 'prompt' },
    });
    const unrelatedLater = projectWorkflowExecutionHistory({
      events: [preStart, resolvedEvent, unrelatedLaterStart],
      pendingInteractions: [answered],
    });
    expect(unrelatedLater.find(item => item.occurrence_id === OCCURRENCE_A)?.status).toBe(
      'running'
    );

    // resumed:false → no retirement.
    const notResumed = projectWorkflowExecutionHistory({
      events: [
        preStart,
        event({
          id: 'resolved-false',
          event_type: 'interaction_resolved',
          created_at: resolvedAt,
          event_order: 2,
          data: {
            node_id: 'review',
            tool_use_id: 'tool-answered',
            kind: 'ask',
            resumed: false,
          },
        }),
        laterStart,
        laterTerminal,
      ],
      pendingInteractions: [answered],
    });
    expect(notResumed.find(item => item.occurrence_id === OCCURRENCE_A)?.status).toBe('running');

    // No later start → no retirement.
    const noLater = projectWorkflowExecutionHistory({
      events: [preStart, resolvedEvent],
      pendingInteractions: [answered],
    });
    expect(noLater.find(item => item.occurrence_id === OCCURRENCE_A)?.status).toBe('running');

    // Loop answered: retire iteration + outer when each has a later corresponding start.
    const loopOuterOcc = OCCURRENCE_A;
    const loopIterOcc = OCCURRENCE_B;
    const loopOuterLater = OCCURRENCE_C;
    const loopIterLater = OCCURRENCE_D;
    const loopAncestry = [{ node_id: 'refine', iteration: 1 }];
    const loopEvents = [
      event({
        id: 'loop-outer',
        step_name: 'refine',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:01.000Z',
        event_order: 1,
        data: { occurrence_id: loopOuterOcc, attempt_id: ATTEMPT_A, type: 'loop' },
      }),
      event({
        id: 'loop-iter',
        step_name: 'refine',
        event_type: 'loop_iteration_started',
        created_at: '2026-09-07T00:00:02.000Z',
        event_order: 2,
        data: {
          occurrence_id: loopIterOcc,
          attempt_id: ATTEMPT_A,
          iteration: 1,
          loop_ancestry: loopAncestry,
        },
      }),
      event({
        id: 'loop-resolved',
        step_name: 'refine',
        event_type: 'interaction_resolved',
        created_at: resolvedAt,
        event_order: 3,
        data: {
          node_id: 'refine',
          tool_use_id: 'tool-loop-answered',
          kind: 'ask',
          resumed: true,
        },
      }),
      event({
        id: 'loop-iter-later',
        step_name: 'refine',
        event_type: 'loop_iteration_started',
        created_at: '2026-09-07T00:00:04.000Z',
        event_order: 4,
        data: {
          occurrence_id: loopIterLater,
          attempt_id: ATTEMPT_B,
          iteration: 2,
          loop_ancestry: [{ node_id: 'refine', iteration: 2 }],
        },
      }),
      event({
        id: 'loop-outer-later',
        step_name: 'refine',
        event_type: 'node_started',
        created_at: '2026-09-07T00:00:04.500Z',
        event_order: 5,
        data: { occurrence_id: loopOuterLater, attempt_id: ATTEMPT_B, type: 'loop' },
      }),
    ];
    const loopAnswered = interaction({
      id: 'answered-loop',
      tool_use_id: 'tool-loop-answered',
      status: 'answered',
      node_id: 'refine',
      resolved_at: resolvedAt,
      answer: { answers: [] },
      execution_scope: {
        occurrence_id: loopIterOcc,
        attempt_id: ATTEMPT_A,
        retry_epoch: 0,
        loop_ancestry: loopAncestry,
      },
    });
    const loopHappy = projectWorkflowExecutionHistory({
      events: loopEvents,
      pendingInteractions: [loopAnswered],
    });
    expect(loopHappy.find(item => item.occurrence_id === loopIterOcc)?.status).toBe('failed');
    expect(loopHappy.find(item => item.occurrence_id === loopOuterOcc)?.status).toBe('failed');
    expect(loopHappy.find(item => item.occurrence_id === loopIterLater)?.status).toBe('running');
    expect(loopHappy.find(item => item.occurrence_id === loopOuterLater)?.status).toBe('running');

    // Ambiguous pre-resolution candidates change nothing.
    const ambiguous = projectWorkflowExecutionHistory({
      events: [
        preStart,
        event({
          id: 'pre-start-2',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.500Z',
          event_order: 1,
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_B, type: 'prompt' },
        }),
        resolvedEvent,
        laterStart,
        laterTerminal,
      ],
      pendingInteractions: [
        interaction({
          id: 'answered-ambig',
          tool_use_id: 'tool-answered',
          status: 'answered',
          resolved_at: resolvedAt,
          answer: { answers: [] },
          execution_scope: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_C,
            retry_epoch: 0,
          },
        }),
      ],
    });
    expect(
      ambiguous.filter(item => item.occurrence_id === OCCURRENCE_A && item.status === 'running')
    ).toHaveLength(2);
  });
});
