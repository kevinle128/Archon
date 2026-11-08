import { describe, expect, test } from 'bun:test';
import {
  TASK_TTL_MS,
  buildDetailedTask,
  buildRunSummary,
  buildStatusEventPayload,
  currentNode,
  findPrUrl,
  inputRequestKey,
  selectRunOutput,
  taskStatusOf,
  toIsoTimestamp,
  type RunEventSnapshot,
  type RunSnapshot,
} from './run-task';

const BASE = 'https://archon.example.ts.net';

function makeRun(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: 'run-1',
    workflow_name: 'resolve',
    status: 'running',
    metadata: {},
    started_at: '2026-11-08T00:00:00.000Z',
    completed_at: null,
    last_activity_at: '2026-11-08T00:05:00.000Z',
    ...overrides,
  };
}

function paused(
  approval: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): RunSnapshot {
  return makeRun({
    status: 'paused',
    metadata: {
      approval: {
        nodeId: 'review',
        message: 'Merge it?',
        type: 'approval',
        resolved: null,
        ...approval,
      },
      ...extra,
    },
  });
}

function completed(stepName: string, output: unknown): RunEventSnapshot {
  return {
    event_type: 'node_completed',
    step_name: stepName,
    data: { node_output: typeof output === 'string' ? output : JSON.stringify(output) },
  };
}

function started(stepName: string): RunEventSnapshot {
  return { event_type: 'node_started', step_name: stepName, data: {} };
}

describe('taskStatusOf', () => {
  test.each([
    ['pending', 'working'],
    ['running', 'working'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ])('%s maps to %s', (status, expected) => {
    expect(taskStatusOf(makeRun({ status }))).toBe(expected as ReturnType<typeof taskStatusOf>);
  });

  test('an unresolved approval or interactive-loop pause is input_required', () => {
    expect(taskStatusOf(paused({}))).toBe('input_required');
    expect(taskStatusOf(paused({ type: 'interactive_loop' }))).toBe('input_required');
  });

  test('a pause written before the gate type existed counts as an approval', () => {
    expect(taskStatusOf(paused({ type: undefined }))).toBe('input_required');
  });

  test('a resolved pause waiting for auto-resume is working', () => {
    expect(taskStatusOf(paused({ resolved: 'approved' }))).toBe('working');
    expect(taskStatusOf(paused({ resolved: 'rejected' }))).toBe('working');
  });

  test.each([['child_workflow'], ['writeback'], ['plannotator_gate']])(
    'a %s pause is working because MCP cannot answer it',
    type => {
      expect(taskStatusOf(paused({ type }))).toBe('working');
    }
  );
});

describe('inputRequestKey', () => {
  const requested = (nodeId: string): RunEventSnapshot => ({
    event_type: 'approval_requested',
    step_name: nodeId,
    data: { nodeId, gateType: 'approval' },
  });
  const received = (nodeId: string): RunEventSnapshot => ({
    event_type: 'approval_received',
    step_name: nodeId,
    data: { decision: 'approved' },
  });

  test('the first pause of a node uses approval-<nodeId>', () => {
    expect(inputRequestKey(paused({}), [requested('review')])).toBe('approval-review');
  });

  test('the first pause is approval-<nodeId> before its request event is written', () => {
    expect(inputRequestKey(paused({}), [])).toBe('approval-review');
  });

  test('a second pause of an interactive-loop node after approve-with-feedback gets -2', () => {
    const run = paused({ nodeId: 'loop', type: 'interactive_loop' });
    const events = [requested('loop'), received('loop'), requested('loop')];
    expect(inputRequestKey(run, events)).toBe('approval-loop-2');
  });

  test('the second pause already has -2 before its request event is written', () => {
    const run = paused({ nodeId: 'loop', type: 'interactive_loop' });
    expect(inputRequestKey(run, [requested('loop'), received('loop')])).toBe('approval-loop-2');
  });

  test('a third pause after a rejection gets -3, independent of rejection_count', () => {
    const run = paused({}, { rejection_count: 0 });
    const events = [
      requested('review'),
      received('review'),
      requested('review'),
      received('review'),
      requested('review'),
    ];
    expect(inputRequestKey(run, events)).toBe('approval-review-3');
  });

  test('requests of other nodes do not count', () => {
    expect(inputRequestKey(paused({}), [requested('other'), received('other')])).toBe(
      'approval-review'
    );
  });

  test('no key when nothing is open', () => {
    expect(inputRequestKey(makeRun(), [])).toBeUndefined();
    expect(inputRequestKey(paused({ resolved: 'approved' }), [])).toBeUndefined();
    expect(inputRequestKey(paused({ type: 'writeback' }), [])).toBeUndefined();
  });
});

describe('currentNode', () => {
  test('returns the last started node that has not finished', () => {
    const events = [
      started('a'),
      completed('a', 'x'),
      started('b'),
      started('c'),
      completed('c', 'y'),
    ];
    expect(currentNode(events)).toBe('b');
  });

  test('returns null when every started node finished', () => {
    expect(currentNode([started('a'), completed('a', 'x')])).toBeNull();
  });
});

describe('selectRunOutput / findPrUrl', () => {
  test('prefers the returns node over the last completed node', () => {
    const events = [completed('finalize', { outcome: 'pr_ready' }), completed('later', 'tail')];
    expect(selectRunOutput(events, 'finalize')).toEqual({ outcome: 'pr_ready' });
    expect(selectRunOutput(events)).toBe('tail');
  });

  test('falls back to the last completed node when the returns node did not complete', () => {
    expect(selectRunOutput([completed('a', { x: 1 })], 'finalize')).toEqual({ x: 1 });
  });

  test('is undefined when no node completed', () => {
    expect(selectRunOutput([started('a')])).toBeUndefined();
  });

  test('finds the newest pr_url in a JSON node output', () => {
    const events = [
      completed('publish', { pr_url: 'https://github.com/o/r/pull/1', number: 1 }),
      completed('noise', 'not json {"pr_url": "https://evil"}'),
    ];
    expect(findPrUrl(events)).toBe('https://github.com/o/r/pull/1');
  });
});

describe('buildRunSummary', () => {
  test('includes the question, PR link, and web URL', () => {
    const run = paused({});
    const summary = buildRunSummary(run, [completed('publish', { pr_url: 'https://pr/1' })], {
      baseUrl: `${BASE}/`,
    });
    expect(summary).toMatchObject({
      run_id: 'run-1',
      workflow: 'resolve',
      status: 'paused',
      task_status: 'input_required',
      question: 'Merge it?',
      pr_url: 'https://pr/1',
      url: `${BASE}/runs/run-1`,
      started_at: '2026-11-08T00:00:00.000Z',
      completed_at: null,
    });
  });
});

describe('buildDetailedTask', () => {
  test('every task carries the 30-day TTL and the poll interval', () => {
    for (const run of [makeRun(), paused({}), makeRun({ status: 'completed' })]) {
      const task = buildDetailedTask(run, [], { baseUrl: BASE, elicitation: true });
      expect(task.ttlMs).toBe(TASK_TTL_MS);
      expect(TASK_TTL_MS).toBe(2_592_000_000);
      expect(task.pollIntervalMs).toBe(5000);
      expect(task.taskId).toBe('run-1');
    }
  });

  test('createdAt stays at the first event when a resume moved started_at', () => {
    const run = makeRun({ started_at: '2026-11-08T03:00:00.000Z' });
    const events: RunEventSnapshot[] = [
      {
        event_type: 'workflow_started',
        step_name: null,
        data: {},
        created_at: '2026-11-08T00:00:01.000Z',
      },
      {
        event_type: 'node_started',
        step_name: 'b',
        data: {},
        created_at: '2026-11-08T03:00:01.000Z',
      },
    ];
    const task = buildDetailedTask(run, events, { baseUrl: BASE, elicitation: true });
    expect(task.createdAt).toBe('2026-11-08T00:00:01.000Z');
  });

  test('working carries the running node as the status message', () => {
    const task = buildDetailedTask(makeRun(), [started('resolve')], {
      baseUrl: BASE,
      elicitation: true,
    });
    expect(task).toMatchObject({ status: 'working', statusMessage: 'resolve' });
    expect(task.createdAt).toBe('2026-11-08T00:00:00.000Z');
    expect(task.lastUpdatedAt).toBe('2026-11-08T00:05:00.000Z');
  });

  test('input_required with elicitation carries one form request under the gate key', () => {
    const task = buildDetailedTask(paused({}), [], { baseUrl: BASE, elicitation: true });
    expect(task.status).toBe('input_required');
    expect(Object.keys(task.inputRequests ?? {})).toEqual(['approval-review']);
    expect(task.inputRequests?.['approval-review']).toEqual({
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: `Merge it?\n\nRun: ${BASE}/runs/run-1`,
        requestedSchema: {
          type: 'object',
          properties: {
            decision: { type: 'string', enum: ['approve', 'reject'] },
            comment: { type: 'string' },
          },
          required: ['decision'],
        },
      },
    });
  });

  test('input_required without elicitation sends no request and points to the UI', () => {
    const task = buildDetailedTask(paused({}), [], { baseUrl: BASE, elicitation: false });
    expect(task.status).toBe('input_required');
    expect(task.inputRequests).toEqual({});
    expect(task.statusMessage).toBe(`Merge it? Answer in the Archon UI: ${BASE}/runs/run-1`);
  });

  test('a resolved pause reports the answer as received', () => {
    const task = buildDetailedTask(paused({ resolved: 'approved' }), [], {
      baseUrl: BASE,
      elicitation: true,
    });
    expect(task).toMatchObject({ status: 'working', statusMessage: 'answer received' });
    expect(task.inputRequests).toBeUndefined();
  });

  test('an unanswerable gate names the gate and the run URL', () => {
    const task = buildDetailedTask(paused({ type: 'child_workflow' }), [], {
      baseUrl: BASE,
      elicitation: true,
    });
    expect(task.status).toBe('working');
    expect(task.statusMessage).toContain('child_workflow');
    expect(task.statusMessage).toContain(`${BASE}/runs/run-1`);
  });

  test('completed carries a complete CallToolResult built from the returns node', () => {
    const output = {
      outcome: 'pr_ready',
      pr_url: 'https://github.com/o/r/pull/7',
      ci: { conclusion: 'success', failed: [], checks_url: 'https://github.com/o/r/pull/7/checks' },
    };
    const run = makeRun({ status: 'completed', completed_at: '2026-11-08T01:00:00.000Z' });
    const task = buildDetailedTask(run, [completed('finalize', output), completed('other', 'x')], {
      baseUrl: BASE,
      returnsNodeId: 'finalize',
      elicitation: true,
    });
    expect(task.status).toBe('completed');
    expect(task.lastUpdatedAt).toBe('2026-11-08T01:00:00.000Z');
    expect(task.result?.resultType).toBe('complete');
    expect(task.result?.structuredContent).toEqual({
      run_id: 'run-1',
      workflow: 'resolve',
      outcome: 'pr_ready',
      pr_url: 'https://github.com/o/r/pull/7',
      ci: output.ci,
      url: `${BASE}/runs/run-1`,
      output,
    });
  });

  test('failed carries a JSON-RPC internal error with the run link', () => {
    const run = makeRun({ status: 'failed', metadata: { error: 'node resolve failed' } });
    const task = buildDetailedTask(run, [completed('read', { issue: 3 })], {
      baseUrl: BASE,
      elicitation: true,
    });
    expect(task.status).toBe('failed');
    expect(task.error).toEqual({
      code: -32603,
      message: 'node resolve failed',
      data: { run_id: 'run-1', url: `${BASE}/runs/run-1`, output: { issue: 3 } },
    });
  });

  test('cancelled has no result or error', () => {
    const task = buildDetailedTask(makeRun({ status: 'cancelled' }), [], {
      baseUrl: BASE,
      elicitation: true,
    });
    expect(task.status).toBe('cancelled');
    expect(task.result).toBeUndefined();
    expect(task.error).toBeUndefined();
  });
});

describe('buildStatusEventPayload', () => {
  test('a running run with a PR carries pr_url and no ci', () => {
    const payload = buildStatusEventPayload(
      makeRun(),
      [completed('publish', { pr_url: 'https://pr/2' }), started('wait-ci')],
      { baseUrl: BASE }
    );
    expect(payload).toEqual({
      run_id: 'run-1',
      workflow: 'resolve',
      status: 'running',
      task_status: 'working',
      node: 'wait-ci',
      pr_url: 'https://pr/2',
      url: `${BASE}/runs/run-1`,
    });
  });

  test('the terminal event carries ci from the returns node output', () => {
    const payload = buildStatusEventPayload(
      makeRun({ status: 'completed' }),
      [
        completed('finalize', {
          pr_url: 'https://pr/2',
          ci: { conclusion: 'failure', failed: ['lint'], checks_url: 'u' },
        }),
      ],
      { baseUrl: BASE, returnsNodeId: 'finalize' }
    );
    expect(payload.ci).toEqual({ conclusion: 'failure', failed: ['lint'], checks_url: 'u' });
    expect(payload.pr_url).toBe('https://pr/2');
  });

  test('a paused run carries the question', () => {
    const payload = buildStatusEventPayload(paused({}), [], { baseUrl: BASE });
    expect(payload.question).toBe('Merge it?');
    expect(payload.task_status).toBe('input_required');
  });

  test('a paused run names the gate node, not the last node that ran', () => {
    const payload = buildStatusEventPayload(paused({}), [started('decide')], { baseUrl: BASE });
    expect(payload.node).toBe('review');
  });
});

describe('toIsoTimestamp', () => {
  test('converts the SQLite UTC form, Date objects, and ISO strings to ISO 8601', () => {
    expect(toIsoTimestamp('2026-11-07 18:33:09')).toBe('2026-11-07T18:33:09.000Z');
    expect(toIsoTimestamp('2026-11-07 18:33:09.250')).toBe('2026-11-07T18:33:09.250Z');
    expect(toIsoTimestamp(new Date('2026-11-07T18:33:09Z'))).toBe('2026-11-07T18:33:09.000Z');
    expect(toIsoTimestamp('2026-11-07T18:33:09+07:00')).toBe('2026-11-07T11:33:09.000Z');
  });

  test('keeps null and unparseable values', () => {
    expect(toIsoTimestamp(null)).toBeNull();
    expect(toIsoTimestamp(undefined)).toBeNull();
    expect(toIsoTimestamp('not a date')).toBe('not a date');
  });
});
