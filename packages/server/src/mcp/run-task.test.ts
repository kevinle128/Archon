import { describe, expect, test } from 'bun:test';
import {
  TASK_TTL_MS,
  askAnswerFromContent,
  buildAskRequestedSchema,
  buildDetailedTask,
  buildRunSummary,
  buildStatusEventPayload,
  currentNode,
  findCi,
  findPrUrl,
  inputRequestKey,
  selectRunOutput,
  taskStatusOf,
  toIsoTimestamp,
  type InteractionSnapshot,
  type RunEventSnapshot,
  type RunSnapshot,
} from './run-task';
import type { AskHumanQuestion } from '@archon/workflows/schemas/pending-interaction';

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

const PR = 'https://github.com/o/r/pull/16';
const CI_FAIL = { conclusion: 'failure', failed: ['server-tests'], checks_url: `${PR}/checks` };
/** verify-pr printed the PR, then wait-ci printed the PR plus its CI result. */
const afterCiWait: RunEventSnapshot[] = [
  completed('verify-pr', { pr_url: PR, number: 16 }),
  completed('wait-ci', { pr_url: PR, number: 16, ...CI_FAIL, attempt: 0 }),
  started('fix-ci'),
];

describe('findCi', () => {
  test('reads a top-level CI record and a ci object, newest first', () => {
    expect(findCi(afterCiWait)).toEqual(CI_FAIL);
    const ok = { conclusion: 'success', failed: [], checks_url: 'c' };
    expect(findCi([...afterCiWait, completed('finalize', { pr_url: PR, ci: ok })])).toEqual(ok);
  });

  test('is undefined before any CI result', () => {
    expect(findCi([completed('verify-pr', { pr_url: PR, number: 16 })])).toBeUndefined();
    expect(findCi([completed('read', { conclusion: 'yes' })])).toBeUndefined();
  });
});

describe('buildRunSummary', () => {
  test('a cancelled run still reports the PR and the last CI result', () => {
    const summary = buildRunSummary(makeRun({ status: 'cancelled' }), afterCiWait, {
      baseUrl: BASE,
    });
    expect(summary).toMatchObject({ status: 'cancelled', pr_url: PR, ci: CI_FAIL });
  });

  test('reports the PR as soon as verify-pr completes, before any CI result', () => {
    const summary = buildRunSummary(
      makeRun(),
      [completed('verify-pr', { pr_url: PR, number: 16 }), started('wait-ci')],
      { baseUrl: BASE }
    );
    expect(summary).toMatchObject({ status: 'running', current_node: 'wait-ci', pr_url: PR });
    expect(summary.ci).toBeUndefined();
  });

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

  test('failed carries the PR and the last CI result in the error data', () => {
    const run = makeRun({ status: 'failed', metadata: { error: 'node fix-ci failed' } });
    const task = buildDetailedTask(run, afterCiWait, { baseUrl: BASE, elicitation: true });
    expect(task.error?.data).toMatchObject({ pr_url: PR, ci: CI_FAIL });
  });

  test('cancelled after the PR opened names the PR and the CI result, still with no result', () => {
    const task = buildDetailedTask(makeRun({ status: 'cancelled' }), afterCiWait, {
      baseUrl: BASE,
      elicitation: true,
    });
    expect(task.status).toBe('cancelled');
    expect(task.statusMessage).toBe(
      `Workflow resolve cancelled. PR: ${PR}. CI: failure. Run: ${BASE}/runs/run-1`
    );
    expect(task.result).toBeUndefined();
    expect(task.error).toBeUndefined();
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

  test('a running run after its CI wait carries pr_url but no ci, so CI adds no event', () => {
    const payload = buildStatusEventPayload(makeRun(), afterCiWait, { baseUrl: BASE });
    expect(payload.pr_url).toBe(PR);
    expect(payload.ci).toBeUndefined();
  });

  test('a cancelled or failed terminal event carries pr_url and the last CI result', () => {
    for (const status of ['cancelled', 'failed']) {
      const payload = buildStatusEventPayload(makeRun({ status }), afterCiWait, { baseUrl: BASE });
      expect(payload).toMatchObject({ status, pr_url: PR, ci: CI_FAIL });
    }
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

describe('AskHuman and permission input', () => {
  const question = (overrides: Partial<AskHumanQuestion> = {}): AskHumanQuestion => ({
    id: 'scope',
    prompt: 'Which scope?',
    selection: 'single',
    options: ['small', 'large'],
    allowOther: false,
    ...overrides,
  });
  const ask = (
    toolUseId: string,
    overrides: Partial<InteractionSnapshot> = {}
  ): InteractionSnapshot => ({
    tool_use_id: toolUseId,
    node_id: 'plan',
    kind: 'ask',
    status: 'pending',
    envelope: { questions: [question()] },
    ...overrides,
  });
  const permission = (toolUseId: string): InteractionSnapshot => ({
    tool_use_id: toolUseId,
    node_id: 'deploy',
    kind: 'permission',
    status: 'pending',
    envelope: { secret: 'sensitive envelope data' },
  });
  const waiting = (
    interactions: InteractionSnapshot[],
    overrides: Partial<RunSnapshot> = {}
  ): RunSnapshot => makeRun({ status: 'paused', interactions, ...overrides });
  const detail = (run: RunSnapshot, elicitation = true): ReturnType<typeof buildDetailedTask> =>
    buildDetailedTask(run, [], { baseUrl: BASE, elicitation });

  test('taskStatusOf reports input_required for a paused run with a pending Ask', () => {
    expect(taskStatusOf(waiting([ask('tu-1')]))).toBe('input_required');
  });

  test('taskStatusOf reports working for a running run with a pending Ask row', () => {
    expect(taskStatusOf(waiting([ask('tu-1')], { status: 'running' }))).toBe('working');
  });

  test('taskStatusOf ignores answered and purged interactions', () => {
    const run = waiting([ask('tu-1', { status: 'answered' }), ask('tu-2', { status: 'purged' })]);
    expect(taskStatusOf(run)).toBe('working');
  });

  test('buildDetailedTask lists one ask request per pending Ask in creation order', () => {
    const task = detail(waiting([ask('tu-b'), ask('tu-a'), ask('tu-c', { status: 'answered' })]));
    expect(Object.keys(task.inputRequests ?? {})).toEqual(['ask-tu-b', 'ask-tu-a']);
  });

  test('buildDetailedTask lists the approval request before interaction requests', () => {
    const run = paused({}, { interactions: undefined });
    const task = detail({ ...run, interactions: [ask('tu-1')] });
    expect(Object.keys(task.inputRequests ?? {})).toEqual(['approval-review', 'ask-tu-1']);
  });

  test('ask form maps a single-select question to a required string enum', () => {
    expect(buildAskRequestedSchema([question()])).toEqual({
      type: 'object',
      properties: { q1: { type: 'string', title: 'Which scope?', enum: ['small', 'large'] } },
      required: ['q1'],
    });
  });

  test('ask form maps a multi-select question to a required array of enum', () => {
    const form = buildAskRequestedSchema([question({ selection: 'multi' })]);
    expect(form.properties.q1).toEqual({
      type: 'array',
      title: 'Which scope?',
      minItems: 1,
      items: { type: 'string', enum: ['small', 'large'] },
    });
    expect(form.required).toEqual(['q1']);
  });

  test('ask form adds an optional other field when allowOther is set', () => {
    const form = buildAskRequestedSchema([question({ allowOther: true })]);
    expect(form.properties.q1_other).toEqual({
      type: 'string',
      title: 'Which scope? (other answer)',
    });
    expect(form.required).toEqual([]);
  });

  test('ask form uses a free-text field when a question has no options', () => {
    const form = buildAskRequestedSchema([question({ options: [], allowOther: true })]);
    expect(form.properties).toEqual({ q1: { type: 'string', title: 'Which scope?' } });
    expect(form.required).toEqual(['q1']);
  });

  test('ask form for a corrupt envelope is empty and points to the UI', () => {
    const task = detail(waiting([ask('tu-1', { envelope: { questions: 'broken' } })]));
    const request = (task.inputRequests ?? {})['ask-tu-1'] as {
      params: { message: string; requestedSchema: { properties: object } };
    };
    expect(request.params.requestedSchema.properties).toEqual({});
    expect(request.params.message).toContain('Archon UI');
  });

  test('ask request message carries no run URL', () => {
    const task = detail(waiting([ask('tu-1')]));
    expect(JSON.stringify(task.inputRequests)).not.toContain(BASE);
  });

  test('answer mapping prefers non-blank other text for single-select', () => {
    const questions = [question({ allowOther: true })];
    expect(askAnswerFromContent(questions, { q1: 'small', q1_other: 'medium' })).toEqual({
      ok: true,
      body: { answers: [{ questionId: 'scope', value: 'medium' }] },
    });
    expect(askAnswerFromContent(questions, { q1: 'small', q1_other: '   ' })).toEqual({
      ok: true,
      body: { answers: [{ questionId: 'scope', value: 'small' }] },
    });
  });

  test('answer mapping appends other text to multi-select values', () => {
    const questions = [question({ selection: 'multi', allowOther: true })];
    expect(askAnswerFromContent(questions, { q1: ['small'], q1_other: 'medium' })).toEqual({
      ok: true,
      body: { answers: [{ questionId: 'scope', value: ['small', 'medium'] }] },
    });
  });

  test('answer mapping rejects a missing answer before any request', () => {
    expect(askAnswerFromContent([question()], {})).toEqual({
      ok: false,
      message: 'Question 1 needs an answer',
    });
  });

  test('permission request has one required intent field and no envelope data', () => {
    const task = detail(waiting([permission('tu-p')], { viewer_is_starter: true }));
    const request = (task.inputRequests ?? {})['permission-tu-p'] as {
      params: { requestedSchema: { required: string[] } };
    };
    expect(request.params.requestedSchema.required).toEqual(['intent']);
    expect(JSON.stringify(task)).not.toContain('sensitive envelope data');
  });

  test('permission request is hidden from a caller who did not start the run', () => {
    const task = detail(waiting([permission('tu-p')], { viewer_is_starter: false }));
    expect(task.status).toBe('input_required');
    expect(task.inputRequests).toEqual({});
    expect(task.statusMessage).toContain('run starter');
  });

  test('without elicitation input requests are empty and the status message names the UI', () => {
    const task = detail(waiting([ask('tu-1')]), false);
    expect(task.inputRequests).toEqual({});
    expect(task.statusMessage).toContain('node plan');
    expect(task.statusMessage).toContain(`Answer in the Archon UI: ${BASE}/runs/run-1`);
  });

  test('status event payload lists open Ask and permission keys', () => {
    const payload = buildStatusEventPayload(waiting([ask('tu-1'), permission('tu-p')]), [], {
      baseUrl: BASE,
    });
    expect(payload.input_request_keys).toEqual(['ask-tu-1', 'permission-tu-p']);
    expect(payload.node).toBe('plan');
    expect(JSON.stringify(payload)).not.toContain('Which scope?');
    expect(JSON.stringify(payload)).not.toContain('sensitive envelope data');
  });

  test('status event payload omits input request keys when none are open', () => {
    const payload = buildStatusEventPayload(waiting([ask('tu-1', { status: 'answered' })]), [], {
      baseUrl: BASE,
    });
    expect('input_request_keys' in payload).toBe(false);
  });

  test('status event payload for an approval gate is unchanged', () => {
    const payload = buildStatusEventPayload(paused({}), [], { baseUrl: BASE });
    expect(payload).toEqual({
      run_id: 'run-1',
      workflow: 'resolve',
      status: 'paused',
      task_status: 'input_required',
      node: 'review',
      question: 'Merge it?',
      url: `${BASE}/runs/run-1`,
    });
  });
});
